import { yahooBars, cboeChain, usdCalendar, type CalEvent } from "./sources";
import { computeLevels, et, type Levels } from "./levels";
import { computeGex, type Gex } from "./gex";
import { loadRows, fitModel, type ModelResult } from "./model";
import { RULES, GEX_SYMBOL } from "./config";

export type Zone = { label: string; price: number; kind: "res" | "sup" };

export type BiasReport = {
  generatedAt: number;
  last: number | null;
  model: ModelResult | null;
  levels: Levels | null;
  gex: (Gex & { nqRatio: number; nq: { flip: number | null; callWall: number; putWall: number } }) | null;
  events: (CalEvent & { etTime: string })[];
  expectedRange: number | null;
  lean: "LONG" | "SHORT" | "NEUTRAL";
  leanStrength: string;
  regime: { label: string; detail: string; fade: "FAVORED" | "CAUTION" | "AVOID" };
  zones: Zone[];
  floor: Zone | null;
  bottomLine: string;
  rules: string[];
  errors: string[];
};

async function settle<T>(name: string, p: Promise<T>, errors: string[]): Promise<T | null> {
  try { return await p; } catch (e: any) { errors.push(`${name}: ${e?.message ?? e}`); return null; }
}

export async function buildReport(now = Date.now()): Promise<BiasReport> {
  const errors: string[] = [];
  const [intraday, rows, chain, cal, qqqBars] = await Promise.all([
    settle("NQ intraday", yahooBars("NQ=F", "5m", "5d"), errors),
    settle("Macro history", loadRows(now), errors),
    settle("Options chain", cboeChain(GEX_SYMBOL), errors),
    settle("Calendar", usdCalendar(), errors),
    settle("QQQ", yahooBars(GEX_SYMBOL, "5m", "1d"), errors),
  ]);

  const levels = intraday?.length ? computeLevels(intraday, now) : null;
  const model = rows && rows.length > 300 ? fitModel(rows) : null;
  const last = levels?.last ?? null;

  let gex: BiasReport["gex"] = null;
  if (chain && last) {
    const g = computeGex(chain.spot, chain.options, 45, now);
    // map ETF levels to NQ by current price ratio (approximate — basis and tracking drift)
    const etfPx = qqqBars?.length ? qqqBars[qqqBars.length - 1].c : chain.spot;
    const r = last / etfPx;
    gex = { ...g, nqRatio: r, nq: { flip: g.flip ? g.flip * r : null, callWall: g.callWall * r, putWall: g.putWall * r } };
  }

  const todayEt = et(now).date;
  const events = (cal ?? [])
    .map((e) => ({ ...e, etTime: e.time }))
    .filter((e) => { const t = Date.parse(e.time); return !isNaN(t) && et(t).date === todayEt; })
    .map((e) => { const p = et(Date.parse(e.time)); return { ...e, etTime: `${String(Math.floor(p.min / 60)).padStart(2, "0")}:${String(p.min % 60).padStart(2, "0")} ET` }; });

  const vxn = model?.factors.find((f) => f.id === "vxn")?.value;
  const expectedRange = last && vxn ? last * (vxn / 100) / Math.sqrt(252) : null;

  // ---- directional lean (only from factors that survived out-of-sample) ----
  const usable = model?.factors.filter((f) => f.usable) ?? [];
  const c = model?.composite ?? 0;
  let lean: BiasReport["lean"] = "NEUTRAL";
  let leanStrength = "No validated macro edge today — trade the levels, not a direction.";
  if (usable.length && Math.abs(c) > 0.02) {
    lean = c > 0 ? "LONG" : "SHORT";
    const edge = model!.oos.hitRate;
    leanStrength = `Weak statistical lean from ${usable.length} validated factor(s). OOS hit rate ${(edge * 100).toFixed(1)}% vs ${(model!.oos.baseUpRate * 100).toFixed(1)}% base up-rate — size accordingly.`;
  }

  // ---- regime: should you fade VAH/VAL today? ----
  const term = model?.factors.find((f) => f.id === "vix_term")?.value ?? 0.9;
  const highImpact = events.filter((e) => e.impact === "High");
  let fade: BiasReport["regime"]["fade"] = "FAVORED";
  const why: string[] = [];
  if (gex) {
    if (gex.netGex < 0) { fade = "AVOID"; why.push(`dealer gamma negative (${gex.netGex.toFixed(2)}B/1%) → moves tend to extend`); }
    else why.push(`dealer gamma positive (+${gex.netGex.toFixed(2)}B/1%) → moves tend to get absorbed`);
    if (gex.nq.flip && last && last < gex.nq.flip) { fade = "AVOID"; why.push(`price below gamma flip ~${gex.nq.flip.toFixed(0)}`); }
  }
  if (term > 1) { fade = "AVOID"; why.push(`VIX curve inverted (${term.toFixed(2)})`); }
  else if (term > 0.95 && fade === "FAVORED") { fade = "CAUTION"; why.push(`VIX curve flat (${term.toFixed(2)})`); }
  if (highImpact.length && fade === "FAVORED") { fade = "CAUTION"; why.push(`high-impact news: ${highImpact.map((e) => e.title).join(", ")}`); }
  const regime = {
    fade,
    label: fade === "FAVORED" ? "Balance / mean-reversion" : fade === "CAUTION" ? "Mixed — fade only with confirmation" : "Expansion risk — don't fade",
    detail: why.join("; ") || "Insufficient data",
  };

  // ---- zones ----
  const z: Zone[] = [];
  const add = (label: string, price: number | null | undefined) => { if (price && last) z.push({ label, price, kind: price > last ? "res" : "sup" }); };
  if (levels) {
    add("Prior VAH", levels.prior.vah); add("Prior POC", levels.prior.poc); add("Prior VAL", levels.prior.val);
    add("Prior RTH high", levels.prior.high); add("Prior RTH low", levels.prior.low);
    if (levels.overnight) { add("Overnight high", levels.overnight.high); add("Overnight low", levels.overnight.low); }
  }
  if (gex) { add(`Call wall (${GEX_SYMBOL}→NQ)`, gex.nq.callWall); add(`Put wall (${GEX_SYMBOL}→NQ)`, gex.nq.putWall); add("Gamma flip", gex.nq.flip); }
  const zones = z.sort((a, b) => b.price - a.price);

  const supports = zones.filter((x) => x.kind === "sup");
  const floor = supports.find((x) => x.label === "Gamma flip" && expectedRange && last! - x.price < expectedRange)
    ?? supports.find((x) => x.label === "Prior VAL") ?? supports[0] ?? null;

  const leanTxt = lean === "NEUTRAL" ? "No directional edge" : `${lean} lean (weak)`;
  const fadeTxt = fade === "FAVORED" ? "Fading VAH/VAL is in-regime" : fade === "CAUTION" ? "Fade only after footprint confirmation (absorption/delta divergence)" : "Do NOT fade — trade acceptance/retest or sit out";
  const bottomLine = `${leanTxt}. ${fadeTxt}.${floor ? ` Loss of ${floor.label} ${floor.price.toFixed(0)} shifts control to sellers.` : ""}${expectedRange ? ` Implied range ±${expectedRange.toFixed(0)} pts.` : ""}`;

  const rules = [
    `Max ${RULES.maxContracts} contracts.`,
    `Time stop: out if not working within ${RULES.timeStopMin} min.`,
    `Daily max loss $${RULES.dailyMaxLoss} — flat and done when hit.`,
    `Stopped ${RULES.maxStopsAtLevel}× at the same level → stop trading that level today.`,
    ...highImpact.map((e) => `Flat 5 min before/after ${e.title} (${e.etTime}).`),
  ];

  return { generatedAt: now, last, model, levels, gex, events, expectedRange, lean, leanStrength, regime, zones, floor, bottomLine, rules, errors };
}
