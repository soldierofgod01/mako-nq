// Single source of truth for the "fade VAH/VAL?" call — used live, in the backtest and in daily scoring.
export type Fade = "FAVORED" | "CAUTION" | "AVOID";

export type RegimeInputs = {
  vixTerm: number | null;        // VIX / VIX3M
  netGex?: number | null;        // $B per 1% (live only — no free history)
  belowFlip?: boolean | null;    // price below gamma flip (live only)
  highImpactNews?: string[];     // titles of today's high-impact USD events
};

export function regimeCall(x: RegimeInputs): { fade: Fade; reasons: string[] } {
  let fade: Fade = "FAVORED";
  const why: string[] = [];
  if (x.netGex != null) {
    if (x.netGex < 0) { fade = "AVOID"; why.push(`dealer gamma negative (${x.netGex.toFixed(2)}B/1%)`); }
    else why.push(`dealer gamma positive (+${x.netGex.toFixed(2)}B/1%)`);
  }
  if (x.belowFlip) { fade = "AVOID"; why.push("price below gamma flip"); }
  if (x.vixTerm != null) {
    if (x.vixTerm > 1) { fade = "AVOID"; why.push(`VIX curve inverted (${x.vixTerm.toFixed(2)})`); }
    else if (x.vixTerm > 0.95 && fade === "FAVORED") { fade = "CAUTION"; why.push(`VIX curve flat (${x.vixTerm.toFixed(2)})`); }
    else why.push(`VIX curve normal (${x.vixTerm.toFixed(2)})`);
  }
  if (x.highImpactNews?.length && fade === "FAVORED") { fade = "CAUTION"; why.push(`high-impact news: ${x.highImpactNews.join(", ")}`); }
  return { fade, reasons: why };
}

// Did a value-area edge fade work? Shared by backtest (hourly) and live scoring (5-min).
// Only counts touches from inside value (session opened between VAL and VAH).
export type TouchResult = { edge: "VAH" | "VAL"; reachedPoc: boolean; closedInside: boolean };

export function scoreTouches(
  bars: { h: number; l: number; c: number; o: number }[],
  va: { vah: number; val: number; poc: number },
): TouchResult[] {
  if (!bars.length) return [];
  const open = bars[0].o, close = bars[bars.length - 1].c;
  if (open > va.vah || open < va.val) return [];
  const out: TouchResult[] = [];
  const iH = bars.findIndex((b) => b.h >= va.vah);
  const iL = bars.findIndex((b) => b.l <= va.val);
  // after the touch bar, did price get back to POC? (the touch bar itself is ambiguous on bar data)
  if (iH >= 0) out.push({ edge: "VAH", reachedPoc: bars.slice(iH + 1).some((b) => b.l <= va.poc), closedInside: close < va.vah });
  if (iL >= 0) out.push({ edge: "VAL", reachedPoc: bars.slice(iL + 1).some((b) => b.h >= va.poc), closedInside: close > va.val });
  return out;
}
