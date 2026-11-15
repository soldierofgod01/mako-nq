import { buildReport, toSnapshot } from "@/lib/bias";
import { runDaily } from "@/lib/daily";
import { yahooBars } from "@/lib/sources";
import { storeEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Weekday pre-market job: save the day's call, score finished sessions, post to Discord.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });

  const r = await buildReport();
  const snap = toSnapshot(r);
  let scored: string[] = [];
  if (snap && storeEnabled()) {
    const bars = await yahooBars("NQ=F", "5m", "5d");
    scored = await runDaily(snap, bars);
  }

  let discord = "skipped";
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (hook) {
    const lv = r.levels?.prior;
    const content = [
      `**NQ plan — ${r.session}**`,
      `Regime: **${r.regime.fade}** — ${r.regime.label}`,
      r.expectedRange ? `68% range: ±${r.expectedRange.toFixed(0)} pts` : null,
      lv ? `Prior VAH ${lv.vah} · POC ${lv.poc} · VAL ${lv.val} · ${lv.shape}-shape${lv.poorHigh ? " · poor high" : ""}${lv.poorLow ? " · poor low" : ""}` : null,
      r.gex?.nq.flip ? `Gamma flip ~${r.gex.nq.flip.toFixed(0)} · call wall ~${r.gex.nq.callWall.toFixed(0)} · put wall ~${r.gex.nq.putWall.toFixed(0)}` : null,
      r.events.length ? `Events: ${r.events.map((e) => `${e.etTime} ${e.title}`).join(", ")}` : null,
      `> ${r.bottomLine}`,
    ].filter(Boolean).join("\n");
    const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content.slice(0, 1900) }) });
    discord = res.ok ? "posted" : `failed ${res.status}`;
  }
  return Response.json({ session: r.session, saved: !!snap && storeEnabled(), scored, discord, errors: r.errors });
}
