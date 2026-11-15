import type { Bar } from "./sources";
import { rthSessions, valueArea } from "./levels";
import { regimeCall, scoreTouches, type Fade } from "./regime";

// Historical test of the regime call and the implied range, on ~2 years of hourly NQ.
// Gamma has no free history, so the historical regime uses only the VIX curve (live adds gamma + news).
// Hourly bars stamped 09:00–15:00 ET are treated as RTH (the 09:00 bar includes 30 min of pre-open).

type DailyRow = { date: string; close: number; f: Record<string, number> };

export type Bucket = { n: number; days: number; reachedPoc: number; closedInside: number };
export type RegimeBacktest = {
  from: string; to: string; days: number;
  byFade: Record<Fade, Bucket>;
  byTrend: { below: Bucket; above: Bucket };   // NQ below / above its 20-day average
  gapPts: number | null;                        // reach-POC rate FAVORED minus AVOID, percentage points
  verdict: string;
  range: { containment: number; k68: number; days: number }; // share of RTH sessions inside prior close ± 1σ(VXN); multiplier for 68%
};

const empty = (): Bucket => ({ n: 0, days: 0, reachedPoc: 0, closedInside: 0 });

export function backtestRegime(hourly: Bar[], daily: DailyRow[]): RegimeBacktest | null {
  // hourly RTH sessions: bars that start 09:00–15:00 ET
  const sessions = rthSessions(hourly.map((b) => ({ ...b, t: b.t + 30 * 60e3 }))) // shift so 09:00 bar counts as RTH
    ;
  const restore = (bs: Bar[]) => bs.map((b) => ({ ...b, t: b.t - 30 * 60e3 }));
  const dates = [...sessions.keys()].sort();
  const dmap = new Map(daily.map((r) => [r.date, r]));
  const byFade: Record<Fade, Bucket> = { FAVORED: empty(), CAUTION: empty(), AVOID: empty() };
  const byTrend = { below: empty(), above: empty() };
  const ratios: number[] = [];
  let used = 0;

  for (let i = 1; i < dates.length; i++) {
    const prevBars = restore(sessions.get(dates[i - 1])!), today = restore(sessions.get(dates[i])!);
    if (prevBars.length < 5 || today.length < 5) continue;
    const prevDaily = dmap.get(dates[i - 1]);
    if (!prevDaily) continue;
    used++;
    const va = valueArea(prevBars, 5);
    const { fade } = regimeCall({ vixTerm: prevDaily.f.vix_term });
    const touches = scoreTouches(today, va);
    const add = (b: Bucket) => {
      b.days++;
      for (const t of touches) { b.n++; if (t.reachedPoc) b.reachedPoc++; if (t.closedInside) b.closedInside++; }
    };
    add(byFade[fade]);
    add(prevDaily.f.nq_trend < 0 ? byTrend.below : byTrend.above);

    // range calibration vs VXN-implied 1σ from the prior close
    // (reference = prior RTH close from the same hourly series, so price levels are consistent)
    const pc = prevBars[prevBars.length - 1].c;
    const sigma = pc * (prevDaily.f.vxn / 100) / Math.sqrt(252);
    const hi = Math.max(...today.map((b) => b.h)), lo = Math.min(...today.map((b) => b.l));
    ratios.push(Math.max(hi - pc, pc - lo) / sigma);
  }
  if (used < 100) return null;
  ratios.sort((a, b) => a - b);
  const rate = (b: Bucket) => (b.n ? b.reachedPoc / b.n : NaN);
  const fav = byFade.FAVORED, avd = byFade.AVOID;
  const gapPts = fav.n >= 30 && avd.n >= 30 ? (rate(fav) - rate(avd)) * 100 : null;
  const verdict = gapPts == null
    ? `Not enough AVOID-regime touches to judge (${avd.n}); the VIX curve was rarely inverted in this window.`
    : gapPts >= 10 ? `Passes: fades reached POC ${gapPts.toFixed(0)} pts more often on FAVORED than AVOID days.`
    : gapPts >= 5 ? `Inconclusive: ${gapPts.toFixed(0)} pt gap (pass line is 10).`
    : `Fails: ${gapPts.toFixed(0)} pt gap. The VIX-curve part of the regime call adds nothing historically.`;
  return {
    from: dates[0], to: dates[dates.length - 1], days: used, byFade, byTrend, gapPts, verdict,
    range: {
      containment: ratios.filter((r) => r <= 1).length / ratios.length,
      k68: ratios[Math.floor(ratios.length * 0.68)],
      days: ratios.length,
    },
  };
}
