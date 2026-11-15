import type { Bar } from "./sources";
import { et, rthSessions } from "./levels";
import { scoreTouches, type Fade, type TouchResult } from "./regime";
import { saveJson, readJson, listPaths } from "./store";

// The daily track record: what the app said before the open vs what NQ actually did.

export type Snapshot = {
  date: string; generatedAt: number; fade: Fade; reasons: string[];
  levels: { vah: number; poc: number; val: number }; prevClose: number;
  expectedRange: number | null; bottomLine: string; lean?: "LONG" | "NO EDGE";
};
export type Score = {
  date: string; fade: Fade; touches: TouchResult[];
  rthHigh: number; rthLow: number; maxExcursion: number; expectedRange: number | null; contained: boolean | null;
  lean?: "LONG" | "NO EDGE"; sessionPts?: number;
};
export type Bucket = { days: number; touches: number; reachedPoc: number; closedInside: number };
export type Summary = { updated: number; days: number; byFade: Record<Fade, Bucket>; contained: number; rangeDays: number; longCalls: number; longWins: number; longPts: number; noEdgeDays: number; noEdgePts: number };

// The session a pre-market run is planning for: today (ET) before the close, else the next weekday.
export function targetSession(now = Date.now()): string {
  const e = et(now);
  let t = now;
  if (e.min >= 16 * 60) t += 864e5;
  for (let i = 0; i < 4; i++) { const d = new Date(t).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }); if (d !== "Sat" && d !== "Sun") break; t += 864e5; }
  return et(t).date;
}

export function scoreDay(snap: Snapshot, rth: Bar[]): Score {
  const hi = Math.max(...rth.map((b) => b.h)), lo = Math.min(...rth.map((b) => b.l));
  const exc = Math.max(hi - snap.prevClose, snap.prevClose - lo);
  return {
    date: snap.date, fade: snap.fade, touches: scoreTouches(rth, snap.levels),
    rthHigh: hi, rthLow: lo, maxExcursion: exc, expectedRange: snap.expectedRange,
    contained: snap.expectedRange ? exc <= snap.expectedRange : null,
    lean: snap.lean, sessionPts: rth[rth.length - 1].c - rth[0].o,
  };
}

const emptyB = (): Bucket => ({ days: 0, touches: 0, reachedPoc: 0, closedInside: 0 });

export function summarize(scores: Score[]): Summary {
  const byFade: Record<Fade, Bucket> = { FAVORED: emptyB(), CAUTION: emptyB(), AVOID: emptyB() };
  let contained = 0, rangeDays = 0, longCalls = 0, longWins = 0, longPts = 0, noEdgeDays = 0, noEdgePts = 0;
  for (const s of scores) {
    if (s.lean === "LONG" && s.sessionPts != null) { longCalls++; longPts += s.sessionPts; if (s.sessionPts > 0) longWins++; }
    else if (s.sessionPts != null) { noEdgeDays++; noEdgePts += s.sessionPts; }
    const b = byFade[s.fade]; b.days++;
    for (const t of s.touches) { b.touches++; if (t.reachedPoc) b.reachedPoc++; if (t.closedInside) b.closedInside++; }
    if (s.contained != null) { rangeDays++; if (s.contained) contained++; }
  }
  return { updated: Date.now(), days: scores.length, byFade, contained, rangeDays, longCalls, longWins, longPts, noEdgeDays, noEdgePts };
}

// Called by the cron: save today's call, score any finished sessions that have a snapshot but no score.
export async function runDaily(snap: Snapshot, intraday: Bar[], now = Date.now()) {
  await saveJson(`snapshots/${snap.date}.json`, snap);
  const sessions = rthSessions(intraday);
  const today = et(now).date;
  const scored: string[] = [];
  for (const [date, rth] of sessions) {
    if (date >= today || rth.length < 70) continue; // only complete sessions (78 five-minute bars)
    if (await readJson(`scores/${date}.json`)) continue;
    const s = await readJson<Snapshot>(`snapshots/${date}.json`);
    if (!s) continue;
    await saveJson(`scores/${date}.json`, scoreDay(s, rth));
    scored.push(date);
  }
  if (scored.length) {
    const paths = (await listPaths("scores/")).slice(-500);
    const all = (await Promise.all(paths.map((p) => readJson<Score>(p)))).filter((x): x is Score => !!x);
    await saveJson("summary.json", summarize(all));
  }
  return scored;
}

export const readSummary = () => readJson<Summary>("summary.json");
