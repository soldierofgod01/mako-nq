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

export type Levels = {
  rthDate: string;
  prior: { high: number; low: number; close: number; open: number } & Profile;
  overnight: { high: number; low: number } & Profile | null;
  last: number;
  lastTime: number;
};

// bars: NQ=F 5m, ~5 days incl. extended hours
export function computeLevels(bars: Bar[], now = Date.now()): Levels {
  const byDate = new Map<string, Bar[]>();
  for (const b of bars) {
    const e = et(b.t);
    if (e.min >= RTH_OPEN && e.min < RTH_CLOSE) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date)!.push(b);
    }
  }
  const dates = [...byDate.keys()].sort();
  const n = et(now);
  const inRth = n.min >= RTH_OPEN && n.min < RTH_CLOSE && byDate.has(n.date);
  const rthDate = inRth ? dates[dates.length - 2] : dates[dates.length - 1];
  const rth = byDate.get(rthDate)!;
  const prior = {
    high: Math.max(...rth.map((b) => b.h)), low: Math.min(...rth.map((b) => b.l)),
    open: rth[0].o, close: rth[rth.length - 1].c, ...valueArea(rth),
  };
  // overnight = everything after prior RTH close up to next RTH open (or now)
  const closeTs = rth[rth.length - 1].t;
  const nextOpen = dates[dates.indexOf(rthDate) + 1];
  const onBars = bars.filter((b) => b.t > closeTs && !(nextOpen && et(b.t).date === nextOpen && et(b.t).min >= RTH_OPEN));
  const overnight = onBars.length > 3
    ? { high: Math.max(...onBars.map((b) => b.h)), low: Math.min(...onBars.map((b) => b.l)), ...valueArea(onBars) }
    : null;
  const lastBar = bars[bars.length - 1];
  return { rthDate, prior, overnight, last: lastBar.c, lastTime: lastBar.t };
}
