// Mako NQ research lab — shared data helpers
const UA = { "User-Agent": "Mozilla/5.0 (nq-bias)", Accept: "application/json,text/csv,*/*" };

// fetch with retries: Yahoo rate-limits and occasionally 5xx's. Retries on network errors, 429 and 5xx.
async function get(url: string, init: RequestInit & { next?: { revalidate: number } }, tries = 3): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 400 * 2 ** i));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

export async function yahooBars(symbol: string, interval: string, range: string, revalidate = 0): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await get(url, revalidate ? { headers: UA, next: { revalidate } } : { headers: UA, cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`Yahoo ${symbol}: no data`);
  const q = r.indicators.quote[0];
  const out: Bar[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = q.close[i];
    if (c == null || q.open[i] == null) continue;
    out.push({ t: r.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c, v: q.volume[i] ?? 0 });
  }
  return out;
}


const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
});

export function et(ts: number) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const hour = parseInt(p.hour, 10) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, min: hour * 60 + parseInt(p.minute, 10), dow: p.weekday as string };
}

const RTH_OPEN = 9 * 60 + 30, RTH_CLOSE = 16 * 60;

type Profile = { poc: number; vah: number; val: number };

// Volume-at-price from OHLCV bars: each bar's volume spread evenly over its range.
export function valueArea(bars: Bar[], bin = 5, pct = 0.7): Profile {
  const hist = new Map<number, number>();
  for (const b of bars) {
    const lo = Math.floor(b.l / bin), hi = Math.floor(b.h / bin);
    const n = hi - lo + 1;
    for (let k = lo; k <= hi; k++) hist.set(k, (hist.get(k) ?? 0) + b.v / n);
  }
  const keys = [...hist.keys()].sort((a, b) => a - b);
  const total = keys.reduce((s, k) => s + hist.get(k)!, 0);
  let pocI = 0;
  keys.forEach((k, i) => { if (hist.get(k)! > hist.get(keys[pocI])!) pocI = i; });
  let lo = pocI, hi = pocI, acc = hist.get(keys[pocI])!;
  while (acc < total * pct && (lo > 0 || hi < keys.length - 1)) {
    const up = hi < keys.length - 1 ? hist.get(keys[hi + 1])! : -1;
    const dn = lo > 0 ? hist.get(keys[lo - 1])! : -1;
    if (up >= dn) acc += hist.get(keys[++hi])!; else acc += hist.get(keys[--lo])!;
  }
  const mid = (k: number) => k * bin + bin / 2;
  return { poc: mid(keys[pocI]), vah: keys[hi] * bin + bin, val: keys[lo] * bin };
}


const SYMBOLS = {
  nq: "NQ=F", qqq: "QQQ", vix: "^VIX", vix3m: "^VIX3M", vxn: "^VXN",
  tnx: "^TNX", dxy: "DX-Y.NYB", hyg: "HYG", smh: "SMH",
} as const;
type Key = keyof typeof SYMBOLS;

const FACTORS: { id: string; label: string; desc: string }[] = [
  { id: "nq_ret1", label: "NQ prior-day return", desc: "Momentum (+) vs mean reversion (−)" },
  { id: "nq_trend", label: "NQ vs 20d SMA", desc: "Distance from 20-day average" },
  { id: "vix_chg", label: "VIX 1d % change", desc: "Fear spike / crush" },
  { id: "vix_term", label: "VIX / VIX3M", desc: ">1 = backwardation (stress)" },
  { id: "vxn", label: "VXN level", desc: "Nasdaq implied vol" },
  { id: "tnx_chg", label: "10Y yield 1d change (bp)", desc: "Rates pressure on duration/tech" },
  { id: "dxy_chg", label: "DXY 1d % change", desc: "Dollar strength" },
  { id: "hyg_ret5", label: "HYG 5d return", desc: "Credit risk appetite" },
  { id: "smh_rel5", label: "SMH − QQQ 5d", desc: "Semis leadership" },
];

export type Row = { date: string; f: Record<string, number>; next: number | null; close: number };

function dailyMap(bars: Bar[], now: number) {
  const today = et(now);
  const m = new Map<string, number>();
  for (const b of bars) {
    const d = et(b.t + 12 * 3600e3).date; // daily bars are stamped at session start; shift to trade date
    if (d === today.date && today.min < 16 * 60 + 15) continue; // drop today's incomplete bar
    m.set(d, b.c);
  }
  return m;
}

export async function loadRows(now = Date.now()): Promise<Row[]> {
  const keys = Object.keys(SYMBOLS) as Key[];
  const data = await Promise.all(keys.map((k) => yahooBars(SYMBOLS[k], "1d", "10y", 6 * 3600)));
  const maps = Object.fromEntries(keys.map((k, i) => [k, dailyMap(data[i], now)])) as Record<Key, Map<string, number>>;
  const dates = [...maps.nq.keys()].filter((d) => keys.every((k) => maps[k].has(d))).sort();
  const s = (k: Key, i: number) => maps[k].get(dates[i])!;
  const rows: Row[] = [];
  for (let i = 20; i < dates.length; i++) {
    const sma20 = dates.slice(i - 19, i + 1).reduce((a, _, j) => a + s("nq", i - 19 + j), 0) / 20;
    rows.push({
      date: dates[i],
      close: s("nq", i),
      next: i + 1 < dates.length ? s("nq", i + 1) / s("nq", i) - 1 : null,
      f: {
        nq_ret1: s("nq", i) / s("nq", i - 1) - 1,
        nq_trend: s("nq", i) / sma20 - 1,
        vix_chg: s("vix", i) / s("vix", i - 1) - 1,
        vix_term: s("vix", i) / s("vix3m", i),
        vxn: s("vxn", i),
        tnx_chg: (s("tnx", i) - s("tnx", i - 1)) * 100, // ^TNX quotes yield in % (e.g. 4.25) → bp
        dxy_chg: s("dxy", i) / s("dxy", i - 1) - 1,
        hyg_ret5: s("hyg", i) / s("hyg", i - 5) - 1,
        smh_rel5: s("smh", i) / s("smh", i - 5) - s("qqq", i) / s("qqq", i - 5),
      },
    });
  }
  return rows;
}


// Research harness: every candidate direction signal tested on free historical data.
// Unit of test = one RTH session. Entry at the signal time, exit at the RTH close.
// pts are NQ points per contract, net of COST (round-trip slippage + commission).

