import type { OptionRow } from "./sources";

// Dealer-gamma estimate from open interest.
// ASSUMPTION (standard, but often wrong at specific strikes): dealers are long calls / short puts
// relative to customers, i.e. call OI adds +gamma, put OI adds -gamma. Real positioning is unknown
// without trade-level data — treat this as a regime gauge, not a precise level.

function normPdf(x: number) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

function bsGamma(S: number, K: number, T: number, iv: number) {
  if (T <= 0 || iv <= 0) return 0;
  const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T));
  return normPdf(d1) / (S * iv * Math.sqrt(T));
}

function yearsTo(expiry: string, now: number) {
  const exp = new Date(`${expiry}T21:00:00Z`).getTime(); // ~4pm ET
  return Math.max((exp - now) / (365 * 864e5), 1 / (365 * 24));
}

export type Gex = {
  spot: number; netGex: number; // $ per 1% move, billions
  flip: number | null; callWall: number; putWall: number;
  pcVolume: number; pcOi: number; maxDays: number;
  profile: { strike: number; gex: number }[];
  key: { strike: number; gex: number }[]; // largest |net gamma| strikes within ±2.5% of spot
};

export function computeGex(spot: number, opts: OptionRow[], maxDays = 45, now = Date.now()): Gex {
  const live = opts.filter((o) => {
    const d = (new Date(`${o.expiry}T21:00:00Z`).getTime() - now) / 864e5;
    return d >= -0.1 && d <= maxDays && o.oi > 0 && o.strike > spot * 0.85 && o.strike < spot * 1.15;
  });
  const netAt = (S: number) => live.reduce((s, o) => {
    const g = bsGamma(S, o.strike, yearsTo(o.expiry, now), o.iv);
    return s + (o.type === "C" ? 1 : -1) * g * o.oi * 100 * S * S * 0.01;
  }, 0);

  const byStrike = new Map<number, { c: number; p: number }>();
  for (const o of live) {
    const g = (o.gamma || bsGamma(spot, o.strike, yearsTo(o.expiry, now), o.iv)) * o.oi * 100 * spot * spot * 0.01;
    const e = byStrike.get(o.strike) ?? { c: 0, p: 0 };
    if (o.type === "C") e.c += g; else e.p += g;
    byStrike.set(o.strike, e);
  }
  const strikes = [...byStrike.entries()].sort((a, b) => a[0] - b[0]);
  const callWall = strikes.reduce((a, b) => (b[1].c > a[1].c ? b : a))[0];
  const putWall = strikes.reduce((a, b) => (b[1].p > a[1].p ? b : a))[0];

  // gamma flip: sweep hypothetical spot, find zero crossing nearest to spot
  let flip: number | null = null, prev: [number, number] | null = null, best = Infinity;
  for (let x = spot * 0.92; x <= spot * 1.08; x += spot * 0.0025) {
    const v = netAt(x);
    if (prev && Math.sign(v) !== Math.sign(prev[1])) {
      const z = prev[0] + (x - prev[0]) * (-prev[1] / (v - prev[1]));
      if (Math.abs(z - spot) < best) { best = Math.abs(z - spot); flip = z; }
    }
    prev = [x, v];
  }
  const sum = (f: (o: OptionRow) => number, t: "C" | "P") => live.filter((o) => o.type === t).reduce((s, o) => s + f(o), 0);
  return {
    spot, netGex: netAt(spot) / 1e9, flip, callWall, putWall, maxDays,
    pcVolume: sum((o) => o.volume, "P") / Math.max(1, sum((o) => o.volume, "C")),
    pcOi: sum((o) => o.oi, "P") / Math.max(1, sum((o) => o.oi, "C")),
    profile: strikes.filter(([k]) => k > spot * 0.95 && k < spot * 1.05).map(([strike, e]) => ({ strike, gex: (e.c - e.p) / 1e9 })),
    key: strikes.filter(([k]) => Math.abs(k - spot) / spot <= 0.025).map(([strike, e]) => ({ strike, gex: (e.c - e.p) / 1e9 }))
      .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 4).sort((a, b) => b.strike - a.strike),
  };
}
