import { buildReport } from "@/lib/bias";
import { parseOverrides } from "@/lib/params";
import type { Bucket as BtBucket } from "@/lib/backtest";
import type { Bucket as TrBucket } from "@/lib/daily";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const f0 = (n: number | null | undefined) => (n == null || isNaN(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
const f2 = (n: number | null | undefined, d = 2) => (n == null || isNaN(n) ? "—" : n.toFixed(d));
const pct = (n: number) => (isNaN(n) ? "—" : `${(n * 100).toFixed(1)}%`);
const rate = (a: number, n: number) => (n ? pct(a / n) : "—");

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ov = parseOverrides((k) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; });
  const r = await buildReport(Date.now(), ov);
  const m = r.model, bt = r.backtest, lv = r.levels;
  const leanCls = r.lean === "LONG" ? "up" : r.lean === "SHORT" ? "dn" : "mut";
  const fadeCls = r.regime.fade === "FAVORED" ? "up" : r.regime.fade === "CAUTION" ? "warn" : "dn";
  const genEt = new Date(r.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

  return (
    <main>
      <div className="head">
        <div><h1>NQ plan — {r.session}</h1><div className="mut">Generated {genEt} ET · NQ last {f0(r.last)}</div></div>
        <div className="mut" style={{ fontSize: 12 }}>{r.freshness.map((x) => <div key={x.label} className={x.stale ? "warn" : ""}>{x.label}: {x.asOf}{x.stale ? " — stale" : ""}</div>)}</div>
      </div>

      <div className="bl" style={{ marginBottom: 14 }}><b>Bottom line:</b> {r.bottomLine}</div>

      <div className="grid">
        <div className="card">
          <h2>Regime — fade VAH/VAL?</h2>
          <div className={`big ${fadeCls}`}>{r.regime.fade}</div>
          <p><b>{r.regime.label}.</b> <span className="mut">{r.regime.detail}</span></p>
          {bt && <p className="mut" style={{ fontSize: 12 }}>Historical test: {bt.verdict}</p>}
        </div>
        <div className="card">
          <h2>Range</h2>
          <div className="big">{r.expectedRange ? `±${f0(r.expectedRange)}` : "—"} <span className="mut" style={{ fontSize: 14 }}>pts</span></div>
          {r.expectedRange && r.levels && <p className="mut">{f0(r.levels.prior.close - r.expectedRange)} – {f0(r.levels.prior.close + r.expectedRange)} around prior close {f0(r.levels.prior.close)}</p>}
          <p className="mut" style={{ fontSize: 12 }}>VXN 1σ = {f0(r.sigma)} pts × {f2(r.rangeK)} calibration{bt ? ` (±1σ held only ${pct(bt.range.containment)} of ${bt.range.days} sessions; ×${f2(bt.range.k68)} held 68%)` : ""}. Size down on wide days.</p>
        </div>
        <div className="card">
          <h2>Risk rules</h2>
          <ul>{r.rules.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="mut" style={{ fontSize: 12 }}>Direction: <span className={leanCls}>{r.lean}</span> — {r.leanStrength}</p>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Levels</h2>
          <table><thead><tr><th>Level</th><th className="r">Price</th><th className="r">Dist</th></tr></thead>
            <tbody>
              {r.zones.map((z) => (
                <tr key={z.label}>
                  <td className={z.kind === "res" ? "dn" : "up"}>{z.label}{r.floor?.label === z.label ? " ◆ critical floor" : ""}</td>
                  <td className="r">{f0(z.price)}</td><td className="r mut">{r.last ? f0(z.price - r.last) : ""}</td>
                </tr>
              ))}
            </tbody></table>
          {lv && <p className="mut" style={{ fontSize: 12 }}>
            Prior RTH {lv.rthDate}: {lv.prior.shape}-shape profile{lv.prior.poorHigh ? ", poor high" : ""}{lv.prior.poorLow ? ", poor low" : ""}{lv.prior.singlePrints.length ? `, ${lv.prior.singlePrints.length} single-print zone(s)` : ""}.
            {lv.overridden ? " Value area overridden with your levels." : " Value area estimated from 5-min bars — paste your MotiveWave levels below if they differ."}
          </p>}
          <form method="get" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {(["vah", "poc", "val"] as const).map((k) => <input key={k} name={k} placeholder={k.toUpperCase()} defaultValue={ov[k] ?? ""} inputMode="decimal" style={{ width: 90, background: "#0b0d10", color: "inherit", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 6px" }} />)}
            <button type="submit" style={{ background: "#1f2937", color: "inherit", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 10px" }}>Use my levels</button>
          </form>
        </div>
        <div className="card">
          <h2>Dealer gamma (QQQ)</h2>
          {r.gex ? <>
            <table><tbody>
              <tr><td>Net GEX (≤{r.gex.maxDays}d)</td><td className={`r ${r.gex.netGex >= 0 ? "up" : "dn"}`}>{f2(r.gex.netGex)}B / 1%</td></tr>
              <tr><td>Gamma flip</td><td className="r">{f2(r.gex.flip)} → NQ {f0(r.gex.nq.flip)}</td></tr>
              <tr><td>Call wall</td><td className="r">{r.gex.callWall} → NQ {f0(r.gex.nq.callWall)}</td></tr>
              <tr><td>Put wall</td><td className="r">{r.gex.putWall} → NQ {f0(r.gex.nq.putWall)}</td></tr>
              <tr><td>P/C volume · P/C OI</td><td className="r">{f2(r.gex.pcVolume)} · {f2(r.gex.pcOi)}</td></tr>
            </tbody></table>
            <p className="mut" style={{ fontSize: 12 }}>Assumes dealers long calls / short puts. OI-based — a regime gauge, not tick-precise. Gamma has no free history, so it isn&apos;t in the historical test; the live track record below tests it.</p>
          </> : <p className="mut">Unavailable</p>}
        </div>
        <div className="card">
          <h2>Events ({r.session})</h2>
          {r.events.length ? <table><tbody>{r.events.map((e) => (
            <tr key={e.title + e.etTime}><td>{e.etTime}</td><td className={e.impact === "High" ? "dn" : "warn"}>{e.title}</td><td className="r mut">{e.forecast || ""}</td></tr>
          ))}</tbody></table> : <p className="mut">No medium/high-impact USD events.</p>}
        </div>
      </div>

      <div className="grid" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Does the regime call work? — history</h2>
          {bt ? <>
            <p className="mut">VAH/VAL touches from inside value, {bt.from} → {bt.to} ({bt.days} sessions, hourly bars). Regime from the VIX curve only.</p>
            <BucketTable rows={[["FAVORED", bt.byFade.FAVORED], ["CAUTION", bt.byFade.CAUTION], ["AVOID", bt.byFade.AVOID], ["NQ below 20d avg", bt.byTrend.below], ["NQ above 20d avg", bt.byTrend.above]]} />
            <p><b>{bt.verdict}</b></p>
          </> : <p className="mut">Unavailable (needs Yahoo hourly history).</p>}
        </div>
        <div className="card">
          <h2>Does the regime call work? — live track record</h2>
          {!r.storeConnected ? <p className="warn">Storage not connected — connect a Vercel Blob store to this project so each day&apos;s call is saved and scored.</p>
            : r.track && r.track.days ? <>
              <p className="mut">{r.track.days} scored sessions (full regime incl. gamma and news).</p>
              <TrackTable b={r.track.byFade} />
              <p className="mut">Range: realized move stayed inside the band on {rate(r.track.contained, r.track.rangeDays)} of {r.track.rangeDays} days (target ~68%).</p>
            </> : <p className="mut">Collecting — the first score appears the session after the first saved call.</p>}
        </div>
      </div>

      {m && <div className="card" style={{ marginTop: 14 }}>
        <h2>Macro factor test (direction vs move size)</h2>
        <p className="mut">Each factor vs NQ next-day return. Trained {m.nIS} days, tested on {m.nOOS} days from {m.splitDate}. Used for direction only if significant (|t| ≥ 1.5) with the same sign in both periods.</p>
        <table><thead><tr><th>Factor</th><th className="r">Today</th><th className="r">z</th><th className="r">IC in-sample (t)</th><th className="r">IC out-of-sample (t)</th><th className="r">Move-size IC</th><th>Used</th></tr></thead>
          <tbody>{m.factors.map((x) => (
            <tr key={x.id}>
              <td>{x.label}<div className="mut" style={{ fontSize: 11 }}>{x.desc}</div></td>
              <td className="r">{["vix_term", "vxn"].includes(x.id) ? f2(x.value) : x.id === "tnx_chg" ? `${f2(x.value, 1)}bp` : pct(x.value)}</td>
              <td className="r">{f2(x.z)}</td>
              <td className="r">{f2(x.icIS, 3)} ({f2(x.tIS, 1)})</td>
              <td className="r">{f2(x.icOOS, 3)} ({f2(x.tOOS, 1)})</td>
              <td className="r">{f2(x.volIcOOS, 2)}</td>
              <td>{x.usable ? <span className="pill up">yes</span> : <span className="mut">no</span>}</td>
            </tr>
          ))}</tbody></table>
        <p className="mut" style={{ fontSize: 12 }}>Combined model out-of-sample: {pct(m.oos.hitRate)} hit rate vs {pct(m.oos.baseUpRate)} for always-long · IC {f2(m.oos.ic, 3)} (t {f2(m.oos.t, 1)}).</p>
      </div>}

      {r.errors.length > 0 && <div className="card" style={{ marginTop: 14 }}><h2>Data errors</h2>{r.errors.map((e) => <div key={e} className="err">{e}</div>)}</div>}
    </main>
  );
}

function BucketTable({ rows }: { rows: [string, BtBucket][] }) {
  return <table><thead><tr><th>Bucket</th><th className="r">Days</th><th className="r">Touches</th><th className="r">Reached POC</th><th className="r">Closed back inside</th></tr></thead>
    <tbody>{rows.map(([k, b]) => <tr key={k}><td>{k}</td><td className="r">{b.days}</td><td className="r">{b.n}</td><td className="r">{rate(b.reachedPoc, b.n)}</td><td className="r">{rate(b.closedInside, b.n)}</td></tr>)}</tbody></table>;
}

function TrackTable({ b }: { b: Record<string, TrBucket> }) {
  return <table><thead><tr><th>Regime</th><th className="r">Days</th><th className="r">Touches</th><th className="r">Reached POC</th><th className="r">Closed back inside</th></tr></thead>
    <tbody>{Object.entries(b).map(([k, x]) => <tr key={k}><td>{k}</td><td className="r">{x.days}</td><td className="r">{x.touches}</td><td className="r">{rate(x.reachedPoc, x.touches)}</td><td className="r">{rate(x.closedInside, x.touches)}</td></tr>)}</tbody></table>;
}
