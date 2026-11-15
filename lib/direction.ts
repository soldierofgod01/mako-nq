import { yahooBars, type Bar } from "./sources";
import { et } from "./levels";
import type { ModelResult } from "./model";

// Fear-reversion direction model — the only signal family that passed the research bar
// (10y QQQ next-session open→close, Dec 2016–Nov 2026). Each rule is re-tested live on every load;
// a rule only counts if its own 10-year record still clears t >= 3.

type Day = { date: string; ret: number; vixChg: number; vxn: number; y: number };

export type RuleStat = {
  id: string; label: string; why: string;
  firesToday: boolean; todayValue: string;
  n: number; hit: number; avgPct: number; basePct: number; t: number; byThird: number[];
  valid: boolean;
};

export type Direction = {
  lean: "LONG" | "NO EDGE";
  summary: string;
  rules: RuleStat[];
  expectedPts: number | null; // average next-session move of the firing rules, in NQ points
  hit: number | null;
  asOf: string;
};

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(a.length - 1, 1)); };
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

export async function directionModel(nqLast: number | null, now = Date.now()): Promise<Direction> {
  const [qqq, nq, vix, vxn] = await Promise.all([
    yahooBars("QQQ", "1d", "10y", 6 * 3600), yahooBars("NQ=F", "1d", "10y", 6 * 3600),
    yahooBars("^VIX", "1d", "10y", 6 * 3600), yahooBars("^VXN", "1d", "10y", 6 * 3600),
  ]);
  const day = (b: Bar) => et(b.t + 12 * 3600e3).date;
  const today = et(now);
  const complete = (b: Bar) => !(day(b) === today.date && today.min < 16 * 60 + 15);
  const close = (bs: Bar[]) => new Map(bs.filter(complete).map((b) => [day(b), b.c]));
  const mN = close(nq), mV = close(vix), mX = close(vxn);
  const q = qqq.filter((b) => b.o > 0);
  const qDates = q.map(day);

  // features known at the prior close → next QQQ session open→close
  const days: Day[] = [];
  const nqDates = [...mN.keys()].sort();
  const prevOf = new Map(nqDates.map((d, i) => [d, i > 0 ? nqDates[i - 1] : null]));
  for (let i = 1; i < q.length; i++) {
    const pd = qDates[i - 1], ppd = prevOf.get(pd);
    if (!ppd || !mN.get(pd) || !mV.get(pd) || !mV.get(ppd) || !mX.get(pd)) continue;
    days.push({ date: qDates[i], ret: mN.get(pd)! / mN.get(ppd)! - 1, vixChg: mV.get(pd)! / mV.get(ppd)! - 1, vxn: mX.get(pd)!, y: q[i].c / q[i].o - 1 });
  }
  // today's features (from the latest completed close)
  const lastD = nqDates[nqDates.length - 1], prevD = prevOf.get(lastD)!;
  const todayF = { ret: mN.get(lastD)! / mN.get(prevD)! - 1, vixChg: mV.get(lastD) && mV.get(prevD) ? mV.get(lastD)! / mV.get(prevD)! - 1 : NaN, vxn: mX.get(lastD) ?? NaN };

  const defs: { id: string; label: string; why: string; f: (d: { ret: number; vixChg: number; vxn: number }) => number; side: "low" | "high"; fmt: (v: number) => string }[] = [
    { id: "selloff", label: "Selloff bounce", why: "Yesterday's Nasdaq drop was in the worst 20% of the past year", f: (d) => d.ret, side: "low", fmt: (v) => `${(v * 100).toFixed(2)}%` },
    { id: "vixjump", label: "VIX-spike bounce", why: "Yesterday's VIX rise was in the top 20% of the past year", f: (d) => d.vixChg, side: "high", fmt: (v) => `${(v * 100).toFixed(1)}%` },
    { id: "calm", label: "Calm-market drift", why: "VXN is in the bottom 20% of the past year", f: (d) => d.vxn, side: "low", fmt: (v) => v.toFixed(1) },
  ];

  const rules: RuleStat[] = defs.map((r) => {
    const hits: number[] = [], all: number[] = [];
    for (let i = 252; i < days.length; i++) {
      const hist = days.slice(i - 252, i).map(r.f).sort((a, b) => a - b);
      const v = r.f(days[i]);
      all.push(days[i].y);
      if (r.side === "low" ? v <= pct(hist, 0.2) : v >= pct(hist, 0.8)) hits.push(days[i].y);
    }
    const hist = days.slice(-252).map(r.f).sort((a, b) => a - b);
    const tv = r.f(todayF);
    const fires = isFinite(tv) && (r.side === "low" ? tv <= pct(hist, 0.2) : tv >= pct(hist, 0.8));
    const t = mean(hits) / (sd(hits) / Math.sqrt(hits.length));
    const byThird = [0, 1, 2].map((j) => mean(hits.slice(Math.floor((j * hits.length) / 3), Math.floor(((j + 1) * hits.length) / 3))) * 100);
    return {
      id: r.id, label: r.label, why: r.why, firesToday: fires, todayValue: r.fmt(tv),
      n: hits.length, hit: hits.filter((x) => x > 0).length / hits.length, avgPct: mean(hits) * 100, basePct: mean(all) * 100, t, byThird,
      valid: t >= 3 && byThird.every((x) => x > 0),
    };
  });

  const firing = rules.filter((r) => r.firesToday && r.valid);
  const lean = firing.length ? "LONG" : "NO EDGE";
  const avg = firing.length ? mean(firing.map((r) => r.avgPct)) : null;
  return {
    lean,
    summary: firing.length
      ? `${firing.map((r) => r.label).join(" + ")}: historically up ${(mean(firing.map((r) => r.hit)) * 100).toFixed(0)}% of sessions like today.`
      : "No tested signal is active today. Trade the levels; don't force a bias.",
    rules,
    expectedPts: avg != null && nqLast ? (avg / 100) * nqLast : null,
    hit: firing.length ? mean(firing.map((r) => r.hit)) : null,
    asOf: lastD,
  };
}

export type { ModelResult };
