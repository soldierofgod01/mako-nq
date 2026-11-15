import type { OptionRow } from "./sources";

// Options-implied structure from the (free, delayed) chain: ATM IV term structure, 25-delta skew,
// and volume/OI by strike. No trade-side data here — this is positioning and pricing, not flow.

export type TermPoint = { expiry: string; days: number; atmIv: number; skew25: number | null };
export type StrikeVol = { strike: number; callVol: number; putVol: number; callOi: number; putOi: number };
export type OptionsView = { term: TermPoint[]; byStrike: StrikeVol[]; pcVolPremiumProxy: number | null };

function normCdf(x: number) { // Abramowitz-Stegun
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
function bsDelta(S: number, K: number, T: number, iv: number, type: "C" | "P") {
  if (T <= 0 || iv <= 0) return NaN;
  const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T));
  return type === "C" ? normCdf(d1) : normCdf(d1) - 1;
}

export function optionsView(spot: number, opts: OptionRow[], now = Date.now()): OptionsView {
  const byExp = new Map<string, OptionRow[]>();
  for (const o of opts) { if (!byExp.has(o.expiry)) byExp.set(o.expiry, []); byExp.get(o.expiry)!.push(o); }
  const term: TermPoint[] = [];
  for (const [expiry, rows] of [...byExp.entries()].sort()) {
    const T = (new Date(`${expiry}T21:00:00Z`).getTime() - now) / (365 * 864e5);
    const days = T * 365;
    if (days < 0.5 || days > 120) continue;
    const valid = rows.filter((r) => r.iv > 0.01 && r.iv < 3);
    if (valid.length < 10) continue;
    const atmK = valid.reduce((a, b) => (Math.abs(b.strike - spot) < Math.abs(a.strike - spot) ? b : a)).strike;
    const atm = valid.filter((r) => r.strike === atmK);
    const atmIv = atm.reduce((s, r) => s + r.iv, 0) / atm.length;
    const d = (r: OptionRow) => (isFinite(r.delta) && r.delta !== 0 ? r.delta : bsDelta(spot, r.strike, T, r.iv, r.type));
    const near = (type: "C" | "P", target: number) => {
      const c = valid.filter((r) => r.type === type).map((r) => ({ r, dd: Math.abs(d(r) - target) })).filter((x) => isFinite(x.dd));
      if (!c.length) return null;
      const best = c.reduce((a, b) => (b.dd < a.dd ? b : a));
      return best.dd < 0.08 ? best.r.iv : null;
    };
    const p25 = near("P", -0.25), c25 = near("C", 0.25);
    term.push({ expiry, days, atmIv, skew25: p25 != null && c25 != null ? p25 - c25 : null });
  }
  // volume / OI by strike within ±6% of spot, near-term (≤ 10 days) to reflect what's active now
  const m = new Map<number, StrikeVol>();
  for (const o of opts) {
    const days = (new Date(`${o.expiry}T21:00:00Z`).getTime() - now) / 864e5;
    if (days < -0.1 || days > 10 || o.strike < spot * 0.94 || o.strike > spot * 1.06) continue;
    const e = m.get(o.strike) ?? { strike: o.strike, callVol: 0, putVol: 0, callOi: 0, putOi: 0 };
    if (o.type === "C") { e.callVol += o.volume; e.callOi += o.oi; } else { e.putVol += o.volume; e.putOi += o.oi; }
    m.set(o.strike, e);
  }
  const byStrike = [...m.values()].sort((a, b) => a.strike - b.strike);
  const cv = byStrike.reduce((s, x) => s + x.callVol, 0), pv = byStrike.reduce((s, x) => s + x.putVol, 0);
  return { term, byStrike, pcVolPremiumProxy: cv ? pv / cv : null };
}
