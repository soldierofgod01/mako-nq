// Fear-reversion probability model — pure functions, no I/O.
// Target: QQQ next-session open→close > 0. Features known at the prior close:
//   r1    = prior-day Nasdaq futures return
//   vchg  = prior-day VIX % change
//   vxnPct= VXN percentile within its trailing year
//   trend = Nasdaq futures vs 20-day average
// Walk-forward: expanding-window logistic regression, refit every 63 sessions, scored only out-of-sample.

export type Series = { date: string; o?: number; c: number }[];
type Row = { date: string; x: number[]; y: number; ret: number };

export type FearModel = {
  pUp: number | null;              // today's probability of an up session
  baseUp: number;                  // unconditional up-rate (training)
  oos: {
    from: string; to: string; n: number;
    brierSkill: number;            // >0 = better than always predicting the base rate
    calib: { lo: number; hi: number; n: number; upRate: number; avgPred: number }[];
    signal: { threshold: number; n: number; hit: number; avgPct: number; t: number; byThird: number[]; allAvgPct: number };
  };
  weights: { name: string; w: number }[];
  today: { r1: number; vchg: number; vxnPct: number; trend: number };
  valid: boolean;                  // signal passes: t >= 3, positive in each third, Brier skill > 0
};

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(a.length - 1, 1)); };
const sig = (z: number) => 1 / (1 + Math.exp(-z));

function fitLogit(X: number[][], y: number[], l2 = 1e-3, iters = 400, lr = 0.5) {
  const k = X[0].length; let w = new Array(k + 1).fill(0);
  const n = X.length;
  for (let it = 0; it < iters; it++) {
    const g = new Array(k + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const p = sig(w[0] + X[i].reduce((s, v, j) => s + v * w[j + 1], 0));
      const e = p - y[i];
      g[0] += e; for (let j = 0; j < k; j++) g[j + 1] += e * X[i][j];
    }
    w = w.map((wj, j) => wj - lr * (g[j] / n + (j ? l2 * wj : 0)));
  }
  return w;
}

const NAMES = ["prior-day return", "VIX change", "VXN percentile", "vs 20-day avg"];

export function buildRows(qqq: Series, nq: Series, vix: Series, vxn: Series): { rows: Row[]; today: number[] | null } {
  const mN = new Map(nq.map((b) => [b.date, b.c])), mV = new Map(vix.map((b) => [b.date, b.c])), mX = new Map(vxn.map((b) => [b.date, b.c]));
  const nd = nq.map((b) => b.date);
  const idx = new Map(nd.map((d, i) => [d, i]));
  const feat = (d: string): number[] | null => {
    const i = idx.get(d); if (i == null || i < 252) return null;
    const p = nd[i - 1], c = mN.get(d)!, pc = mN.get(p)!;
    const v = mV.get(d), pv = mV.get(p), x = mX.get(d);
    if (!v || !pv || !x) return null;
    const hist = nd.slice(i - 252, i).map((q) => mX.get(q)).filter((z): z is number => z != null).sort((a, b) => a - b);
    const sma = nd.slice(i - 19, i + 1).reduce((s, q) => s + mN.get(q)!, 0) / 20;
    return [c / pc - 1, v / pv - 1, hist.filter((h) => h <= x).length / hist.length, c / sma - 1];
  };
  const rows: Row[] = [];
  const qd = qqq.map((b) => b.date);
  for (let i = 1; i < qqq.length; i++) {
    const f = feat(qd[i - 1]); const o = qqq[i].o;
    if (!f || !o) continue;
    rows.push({ date: qd[i], x: f, y: qqq[i].c > o ? 1 : 0, ret: qqq[i].c / o - 1 });
  }
  return { rows, today: feat(nd[nd.length - 1]) };
}

export function fearModel(rows: Row[], today: number[] | null, threshold = 0.55): FearModel {
  const start = 756, step = 63;
  const preds: { p: number; r: Row; base: number }[] = [];
  let lastW: number[] = [], lastMu: number[] = [], lastSd: number[] = [], lastBase = 0.5;
  for (let s = start; s < rows.length; s += step) {
    const train = rows.slice(0, s);
    const mu = [0, 1, 2, 3].map((j) => mean(train.map((r) => r.x[j]))), sdv = [0, 1, 2, 3].map((j) => sd(train.map((r) => r.x[j])) || 1);
    const Z = (x: number[]) => x.map((v, j) => (v - mu[j]) / sdv[j]);
    const w = fitLogit(train.map((r) => Z(r.x)), train.map((r) => r.y));
    const base = mean(train.map((r) => r.y));
    for (const r of rows.slice(s, s + step)) preds.push({ p: sig(w[0] + Z(r.x).reduce((a, v, j) => a + v * w[j + 1], 0)), r, base });
    lastW = w; lastMu = mu; lastSd = sdv; lastBase = base;
  }
  // final fit on everything for today's call
  const muA = [0, 1, 2, 3].map((j) => mean(rows.map((r) => r.x[j]))), sdA = [0, 1, 2, 3].map((j) => sd(rows.map((r) => r.x[j])) || 1);
  const ZA = (x: number[]) => x.map((v, j) => (v - muA[j]) / sdA[j]);
  const wA = fitLogit(rows.map((r) => ZA(r.x)), rows.map((r) => r.y));
  void lastW; void lastMu; void lastSd;
  const pUp = today ? sig(wA[0] + ZA(today).reduce((a, v, j) => a + v * wA[j + 1], 0)) : null;

  const brier = mean(preds.map((q) => (q.p - q.r.y) ** 2)), brierBase = mean(preds.map((q) => (q.base - q.r.y) ** 2));
  const edges = [0, 0.45, 0.5, 0.55, 0.6, 1];
  const calib = edges.slice(0, -1).map((lo, i) => {
    const b = preds.filter((q) => q.p >= lo && q.p < edges[i + 1]);
    return { lo, hi: edges[i + 1], n: b.length, upRate: mean(b.map((q) => q.r.y)), avgPred: mean(b.map((q) => q.p)) };
  });
  const sel = preds.filter((q) => q.p >= threshold).map((q) => q.r.ret);
  const t = mean(sel) / (sd(sel) / Math.sqrt(sel.length));
  const byThird = [0, 1, 2].map((j) => mean(sel.slice(Math.floor((j * sel.length) / 3), Math.floor(((j + 1) * sel.length) / 3))) * 100);
  const skill = 1 - brier / brierBase;
  return {
    pUp, baseUp: lastBase,
    oos: {
      from: preds[0]?.r.date ?? "", to: preds.at(-1)?.r.date ?? "", n: preds.length, brierSkill: skill, calib,
      signal: { threshold, n: sel.length, hit: sel.filter((x) => x > 0).length / sel.length, avgPct: mean(sel) * 100, t, byThird, allAvgPct: mean(preds.map((q) => q.r.ret)) * 100 },
    },
    weights: NAMES.map((name, j) => ({ name, w: wA[j + 1] })),
    today: today ? { r1: today[0], vchg: today[1], vxnPct: today[2], trend: today[3] } : { r1: NaN, vchg: NaN, vxnPct: NaN, trend: NaN },
    valid: t >= 3 && byThird.every((x) => x > 0) && skill > 0,
  };
}
