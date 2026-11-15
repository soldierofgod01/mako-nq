import type { Bar } from "./sources";

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

export type Profile = { poc: number; vah: number; val: number };

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

export type Shape = { shape: "P" | "b" | "D"; poorHigh: boolean; poorLow: boolean; singlePrints: [number, number][] };

// Auction read of a session from 5-min bars: profile shape, poor high/low (no excess), single prints (30-min TPO).
export function profileShape(rth: Bar[], va: Profile, bin = 5): Shape {
  const hi = Math.max(...rth.map((b) => b.h)), lo = Math.min(...rth.map((b) => b.l));
  const pos = (va.poc - lo) / Math.max(hi - lo, 1e-9);
  const shape = pos > 0.62 ? "P" : pos < 0.38 ? "b" : "D";
  // TPO: 30-min periods
  const per = new Map<number, Bar[]>();
  for (const b of rth) { const k = Math.floor(b.t / 1800e3); if (!per.has(k)) per.set(k, []); per.get(k)!.push(b); }
  // poor extreme = no excess: 2+ thirty-minute periods printing within 5 ticks of the session extreme
  const periods = [...per.values()].map((bs) => ({ h: Math.max(...bs.map((b) => b.h)), l: Math.min(...bs.map((b) => b.l)) }));
  const poorHigh = periods.filter((p) => p.h >= hi - 1.25).length >= 2;
  const poorLow = periods.filter((p) => p.l <= lo + 1.25).length >= 2;
  // single prints: bins touched by exactly one period, in runs of >= 3 bins, away from the extremes
  const tpo = new Map<number, number>();
  for (const bs of per.values()) {
    const h = Math.max(...bs.map((b) => b.h)), l = Math.min(...bs.map((b) => b.l));
    for (let k = Math.floor(l / bin); k <= Math.floor(h / bin); k++) tpo.set(k, (tpo.get(k) ?? 0) + 1);
  }
  const keys = [...tpo.keys()].sort((a, b) => a - b);
  const singlePrints: [number, number][] = [];
  let run: number[] = [];
  const flush = () => { if (run.length >= 3 && run[0] !== keys[0] && run[run.length - 1] !== keys[keys.length - 1]) singlePrints.push([run[0] * bin, (run[run.length - 1] + 1) * bin]); run = []; };
  for (const k of keys) { if (tpo.get(k) === 1 && (!run.length || k === run[run.length - 1] + 1)) run.push(k); else { flush(); if (tpo.get(k) === 1) run.push(k); } }
  flush();
  return { shape, poorHigh, poorLow, singlePrints };
}

export function rthSessions(bars: Bar[]) {
  const byDate = new Map<string, Bar[]>();
  for (const b of bars) {
    const e = et(b.t);
    if (e.min >= RTH_OPEN && e.min < RTH_CLOSE) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date)!.push(b);
    }
  }
  return byDate;
}

export type Override = { vah?: number; poc?: number; val?: number };

export type Levels = {
  rthDate: string;
  prior: { high: number; low: number; close: number; open: number } & Profile & Shape;
  overridden: boolean;
  overnight: { high: number; low: number } & Profile | null;
  last: number;
  lastTime: number;
};

// bars: NQ=F 5m, ~5 days incl. extended hours
export function computeLevels(bars: Bar[], now = Date.now(), ov: Override = {}): Levels {
  const byDate = rthSessions(bars);
  const dates = [...byDate.keys()].sort();
  const n = et(now);
  const inRth = n.min >= RTH_OPEN && n.min < RTH_CLOSE && byDate.has(n.date);
  const rthDate = inRth ? dates[dates.length - 2] : dates[dates.length - 1];
  const rth = byDate.get(rthDate)!;
  const va = valueArea(rth);
  const overridden = !!(ov.vah || ov.poc || ov.val);
  const va2 = { vah: ov.vah ?? va.vah, poc: ov.poc ?? va.poc, val: ov.val ?? va.val };
  const prior = {
    high: Math.max(...rth.map((b) => b.h)), low: Math.min(...rth.map((b) => b.l)),
    open: rth[0].o, close: rth[rth.length - 1].c, ...va2, ...profileShape(rth, va2),
  };
  // overnight = everything after prior RTH close up to next RTH open (or now)
  const closeTs = rth[rth.length - 1].t;
  const nextOpen = dates[dates.indexOf(rthDate) + 1];
  const onBars = bars.filter((b) => b.t > closeTs && !(nextOpen && et(b.t).date === nextOpen && et(b.t).min >= RTH_OPEN));
  const overnight = onBars.length > 3
    ? { high: Math.max(...onBars.map((b) => b.h)), low: Math.min(...onBars.map((b) => b.l)), ...valueArea(onBars) }
    : null;
  const lastBar = bars[bars.length - 1];
  return { rthDate, prior, overridden, overnight, last: lastBar.c, lastTime: lastBar.t };
}

// Naked POCs: prior-session POCs that no later session has traded through. Built from hourly bars
// (09:00 bar counted as RTH), checked against everything traded since, including the current 5-min data.
export function nakedPocs(hourly: Bar[], recent: Bar[], lookback = 20): { date: string; poc: number }[] {
  const shifted = rthSessions(hourly.map((b) => ({ ...b, t: b.t + 30 * 60e3 })));
  const dates = [...shifted.keys()].sort().slice(-lookback - 1);
  const out: { date: string; poc: number }[] = [];
  const allAfter = (d: string) => [
    ...hourly.filter((b) => et(b.t).date > d),
    ...recent.filter((b) => et(b.t).date > d),
  ];
  for (const d of dates.slice(0, -1)) {
    const poc = valueArea(shifted.get(d)!, 5).poc;
    const later = allAfter(d);
    if (later.length && !later.some((b) => b.l <= poc && b.h >= poc)) out.push({ date: d, poc });
  }
  return out;
}
