import { buildReport } from "@/lib/bias";
import { parseOverrides } from "@/lib/params";
import LevelsMap from "./LevelsMap";
import TermChart from "./TermChart";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const n0 = (n: number | null | undefined) => (n == null || isNaN(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
const n2 = (n: number | null | undefined, d = 2) => (n == null || isNaN(n) ? "—" : n.toFixed(d));
const pc = (n: number | null | undefined, d = 0) => (n == null || isNaN(n) ? "—" : `${(n * 100).toFixed(d)}%`);
const sgn = (n: number) => (n > 0 ? `+${n0(n)}` : n0(n));

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ov = parseOverrides((k) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; });
  const r = await buildReport(Date.now(), ov);
  const d = r.direction, lv = r.levels, g = r.gex, tr = r.track, o = r.options;
  const long = d?.lean === "LONG";
  const chg = lv && r.last ? r.last - lv.prior.close : null;
  const front = o?.term[0], back = o?.term.at(-1);

  return (
    <div className="term">
      <header className="bar">
        <div className="logo">MAKO<span>NQ</span></div>
        <div className="tick"><span className="sym">NQ</span><span className="num px">{n0(r.last)}</span>{chg != null && <span className={`num ${chg >= 0 ? "up" : "dn"}`}>{sgn(chg)} ({pc(chg / (lv!.prior.close), 2)})</span>}</div>
        <div className="meta">Session <b>{r.session}</b></div>
        <div className="meta grow" />
        {r.freshness.map((f) => <div key={f.label} className={`meta ${f.stale ? "warn" : ""}`} title={f.label}><i className={`dot ${f.stale ? "stale" : ""}`} />{f.label.split(" ")[0]} {f.asOf === "unknown" ? "delayed" : f.asOf}</div>)}
      </header>

      <main className="grid">
        {/* levels map */}
        <section className="panel span8">
          <h3>Levels map {lv?.overridden && <em className="up">· your levels</em>}
            <form method="get" className="ov">{(["vah", "poc", "val"] as const).map((k) => <input key={k} name={k} placeholder={k.toUpperCase()} defaultValue={ov[k] ?? ""} inputMode="decimal" />)}<button type="submit">Set</button></form>
          </h3>
          <LevelsMap r={r} />
        </section>

        <div className="col span4">
        {/* direction */}
        <section className={`panel dir ${long ? "long" : ""}`}>
          <h3>Direction</h3>
          <div className={`call ${long ? "up" : "none"}`}>{d ? (long ? "LONG" : "NO EDGE") : "—"}</div>
          <div className="sub">{long && d?.hit != null ? <>Up <b className="num">{pc(d.hit)}</b> of similar sessions · avg <b className="num">{d.expectedPts != null ? sgn(d.expectedPts) : "—"}</b> pts</> : d?.summary ?? "Model unavailable"}</div>
          <div className="rules">
            {d?.rules.map((x) => (
              <div key={x.id} className={`rule ${x.firesToday && x.valid ? "on" : ""}`} title={x.why}>
                <i className="ind" /><span className="nm">{x.label}</span>
                <span className="num st">{x.valid ? `${pc(x.hit)} · t ${n2(x.t, 1)}` : "failed re-check"}</span>
              </div>
            ))}
          </div>
        </section>

        {/* key stats */}
        <section className="panel">
          <h3>Expected move · positioning</h3>
          <div className="stats">
            <Stat k="68% move" v={r.expectedRange ? `±${n0(r.expectedRange)}` : "—"} sub={r.expectedRange && lv ? `${n0(lv.prior.close - r.expectedRange)} – ${n0(lv.prior.close + r.expectedRange)}` : ""} />
            <Stat k="Net GEX" v={g ? `${n2(g.netGex)}B` : "—"} cls={g ? (g.netGex >= 0 ? "up" : "dn") : ""} sub={g ? (g.netGex >= 0 ? "dealers dampen" : "dealers amplify") : ""} />
            <Stat k="Gamma flip" v={n0(g?.nq.flip)} sub={g?.nq.flip && r.last ? `${sgn(g.nq.flip - r.last)} pts` : ""} />
            <Stat k="Call / put wall" v={g ? `${n0(g.nq.callWall)}` : "—"} sub={g ? `put ${n0(g.nq.putWall)}` : ""} />
            <Stat k="ATM IV front" v={front ? `${n2(front.atmIv * 100, 1)}%` : "—"} sub={front && back ? `${front.atmIv > back.atmIv ? "inverted" : "normal"} curve` : ""} cls={front && back && front.atmIv > back.atmIv ? "dn" : ""} />
            <Stat k="25Δ skew" v={front?.skew25 != null ? `${n2(front.skew25 * 100, 1)}` : "—"} sub="put − call, vol pts" />
          </div>
        </section>

        {/* events / profile */}
        <section className="panel">
          <h3>Session context</h3>
          {r.events.length ? r.events.map((e) => (
            <div className="row" key={e.title + e.etTime}><span className={e.impact === "High" ? "dn" : "warn"}>{e.title}</span><span className="num">{e.etTime.replace(" ET", "")} ET</span></div>
          )) : <div className="row"><span className="mut">No major US data</span><span /></div>}
          {lv && <>
            <div className="row"><span className="mut">Prior profile</span><span>{lv.prior.shape}-shape{lv.prior.poorHigh ? " · poor high" : ""}{lv.prior.poorLow ? " · poor low" : ""}</span></div>
            <div className="row"><span className="mut">Open vs value</span><span>{r.last! > lv.prior.vah ? "above VAH" : r.last! < lv.prior.val ? "below VAL" : "inside value"}</span></div>
            <div className="row"><span className="mut">Naked POCs nearby</span><span className="num">{(() => { const nk = r.naked.filter((x) => r.last && Math.abs(x.poc - r.last) / r.last < 0.03); return nk.length ? nk.slice(-3).map((x) => n0(x.poc)).join(" · ") : "none"; })()}</span></div>
          </>}
        </section>

        </div>
        {/* vol structure */}
        <section className="panel span7">
          <h3>QQQ vol term structure &amp; skew</h3>
          {o ? <TermChart term={o.term} /> : <p className="mut">Unavailable</p>}
        </section>

        {/* record */}
        <section className="panel span5">
          <h3>Live record</h3>
          {!r.storeConnected ? <p className="warn small">Connect a Vercel Blob store to log calls.</p>
            : tr && tr.days ? <div className="stats two">
              <Stat k="LONG calls" v={String(tr.longCalls)} />
              <Stat k="Hit rate" v={tr.longCalls ? pc(tr.longWins / tr.longCalls) : "—"} />
              <Stat k="Avg pts / call" v={tr.longCalls ? sgn(tr.longPts / tr.longCalls) : "—"} />
              <Stat k="No-edge days avg" v={tr.noEdgeDays ? sgn(tr.noEdgePts / tr.noEdgeDays) : "—"} />
            </div> : <p className="mut small">Collecting — first result after the next session.</p>}
        </section>
      </main>

      <details className="research">
        <summary>Research · rule tests</summary>
        {d && <table><thead><tr><th>Rule</th><th className="r">Days</th><th className="r">Hit</th><th className="r">Avg</th><th className="r">All days</th><th className="r">By third</th><th className="r">t</th></tr></thead>
          <tbody>{d.rules.map((x) => <tr key={x.id}><td>{x.label}<div className="mut small">{x.why}</div></td><td className="r num">{x.n}</td><td className="r num">{pc(x.hit)}</td><td className="r num">{n2(x.avgPct, 3)}%</td><td className="r num">{n2(x.basePct, 3)}%</td><td className="r num">{x.byThird.map((v) => n2(v, 2)).join(" / ")}</td><td className="r num">{n2(x.t, 1)}</td></tr>)}</tbody></table>}
        {r.errors.length > 0 && <div style={{ marginTop: 12 }}>{r.errors.map((e) => <div key={e} className="err">{e}</div>)}</div>}
      </details>
    </div>
  );
}

function Stat({ k, v, sub, cls = "" }: { k: string; v: string; sub?: string; cls?: string }) {
  return <div className="stat"><div className="k">{k}</div><div className={`v num ${cls}`}>{v}</div>{sub ? <div className="s">{sub}</div> : null}</div>;
}
