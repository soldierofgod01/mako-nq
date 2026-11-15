import { buildReport } from "@/lib/bias";
import { parseOverrides } from "@/lib/params";

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
  const d = r.direction, lv = r.levels, g = r.gex, m = r.model, tr = r.track;
  const stale = r.freshness.some((f) => f.stale);
  const above = r.zones.filter((z) => z.kind === "res").slice(-5);
  const below = r.zones.filter((z) => z.kind === "sup").slice(0, 5);
  const long = d?.lean === "LONG";

  return (
    <main>
      <header className="top">
        <div className="brand"><b>Mako NQ</b><span>Plan for {r.session}</span></div>
        <div className="price">
          <div className="num">{n0(r.last)}</div>
          <div className="fresh"><i className={`dot ${stale ? "stale" : ""}`} />{r.freshness[0]?.asOf ?? ""}</div>
        </div>
      </header>

      {/* 1 — the call */}
      <section className={`card hero ${long ? "long" : ""}`}>
        <div>
          <p className="label">Session direction</p>
          <div className={`call ${long ? "up" : "none"}`}>{d ? (long ? "LONG" : "NO EDGE") : "—"}</div>
          <div className="callsub">
            {long && d?.hit != null ? <>Up <b className="num">{pc(d.hit)}</b> of similar sessions · avg <b className="num">{d.expectedPts != null ? sgn(d.expectedPts) : "—"}</b> pts open→close</> : "No tested signal active"}
          </div>
        </div>
        <div>
          <p className="summary">{d?.summary ?? "Direction model unavailable."}</p>
          <div className="rules">
            {d?.rules.map((x) => (
              <div key={x.id} className={`rule ${x.firesToday && x.valid ? "on" : ""}`}>
                <i className="ind" />
                <div><div className="name">{x.label} {!x.valid && <span className="warn" style={{ fontSize: 11 }}>· failed re-check</span>}</div><div className="why">{x.why} · today {x.todayValue}</div></div>
                <div className="stats num">{pc(x.hit)} up · {x.n} days<br />t {n2(x.t, 1)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 2 — context */}
      <section className="grid3">
        <div className="card">
          <p className="label">Expected move</p>
          <div className="big num">±{n0(r.expectedRange)}<span className="mut" style={{ fontSize: 14, fontWeight: 400 }}> pts</span></div>
          {r.expectedRange && lv && <p className="note num">{n0(lv.prior.close - r.expectedRange)} – {n0(lv.prior.close + r.expectedRange)}</p>}
          <p className="note">68% band from VXN, calibrated on 2 years of sessions.</p>
        </div>
        <div className="card">
          <p className="label">Options positioning · QQQ</p>
          {g ? <>
            <div className={`big ${g.netGex >= 0 ? "up" : "dn"}`}>{g.netGex >= 0 ? "Positive γ" : "Negative γ"}</div>
            <div className="kv"><span>Net GEX</span><span className="num">{n2(g.netGex)}B / 1%</span></div>
            <div className="kv"><span>Gamma flip</span><span className="num">{n0(g.nq.flip)}</span></div>
            <div className="kv"><span>Call wall · Put wall</span><span className="num">{n0(g.nq.callWall)} · {n0(g.nq.putWall)}</span></div>
            <div className="kv"><span>Put/Call (vol · OI)</span><span className="num">{n2(g.pcVolume)} · {n2(g.pcOi)}</span></div>
            <p className="note">{g.netGex >= 0 ? "Dealers dampen moves." : "Dealers amplify moves."} Context, not a direction call. Live flow coming after the data test.</p>
          </> : <p className="mut">Unavailable</p>}
        </div>
        <div className="card">
          <p className="label">Today</p>
          {r.events.length ? r.events.map((e) => (
            <div className="kv" key={e.title + e.etTime}><span className={e.impact === "High" ? "dn" : "warn"}>{e.title}</span><span className="num">{e.etTime.replace(" ET", "")}</span></div>
          )) : <p className="mut">No major US data.</p>}
          {lv && <p className="note">Prior session: {lv.prior.shape}-shape{lv.prior.poorHigh ? " · poor high" : ""}{lv.prior.poorLow ? " · poor low" : ""}{lv.prior.singlePrints.length ? ` · ${lv.prior.singlePrints.length} single-print zone(s)` : ""}</p>}
        </div>
      </section>

      {/* 3 — levels + record */}
      <section className="grid2">
        <div className="card">
          <p className="label">Levels {lv?.overridden && <span className="up">· your levels</span>}</p>
          <div className="lv">
            {above.map((z) => <Row key={z.label} z={z} last={r.last} cls="dn" />)}
            <div className="div"><span className="num">{n0(r.last)}</span></div>
            {below.map((z) => <Row key={z.label} z={z} last={r.last} cls="up" />)}
          </div>
          <form method="get" className="ov">
            {(["vah", "poc", "val"] as const).map((k) => <input key={k} name={k} placeholder={k.toUpperCase()} defaultValue={ov[k] ?? ""} inputMode="decimal" />)}
            <button type="submit">Use my levels</button>
          </form>
        </div>
        <div className="card">
          <p className="label">Live record</p>
          {!r.storeConnected ? <p className="warn" style={{ fontSize: 13 }}>Connect a Vercel Blob store to start logging calls.</p>
            : tr && tr.days ? <>
              <div className="kv"><span>LONG calls</span><span className="num">{tr.longCalls}</span></div>
              <div className="kv"><span>Hit rate</span><span className="num">{tr.longCalls ? pc(tr.longWins / tr.longCalls) : "—"}</span></div>
              <div className="kv"><span>Avg pts per call</span><span className="num">{tr.longCalls ? sgn(tr.longPts / tr.longCalls) : "—"}</span></div>
              <div className="kv"><span>Avg pts, no-edge days</span><span className="num">{tr.noEdgeDays ? sgn(tr.noEdgePts / tr.noEdgeDays) : "—"}</span></div>
              <div className="kv"><span>Range held</span><span className="num">{tr.rangeDays ? pc(tr.contained / tr.rangeDays) : "—"}</span></div>
            </> : <p className="mut" style={{ fontSize: 13 }}>Collecting — first result after the next session.</p>}
          <p className="note">Every call is saved before the open and scored after the close.</p>
        </div>
      </section>

      {/* 4 — research, collapsed */}
      <details>
        <summary>Research · how the direction rules were tested</summary>
        <div className="body">
          <p className="mut" style={{ fontSize: 13 }}>Rules are re-tested on every load against 10 years of QQQ next-session open→close moves. A rule only counts if t ≥ 3 and it was positive in each third of the decade.</p>
          {d && <table><thead><tr><th>Rule</th><th className="r">Days</th><th className="r">Hit</th><th className="r">Avg</th><th className="r">All days</th><th className="r">By third</th><th className="r">t</th></tr></thead>
            <tbody>{d.rules.map((x) => <tr key={x.id}><td>{x.label}</td><td className="r num">{x.n}</td><td className="r num">{pc(x.hit)}</td><td className="r num">{n2(x.avgPct, 3)}%</td><td className="r num">{n2(x.basePct, 3)}%</td><td className="r num">{x.byThird.map((v) => n2(v, 2)).join(" / ")}</td><td className="r num">{n2(x.t, 1)}</td></tr>)}</tbody></table>}
          {m && <>
            <p className="label" style={{ marginTop: 24 }}>Macro factors vs next-day NQ (direction vs move size)</p>
            <table><thead><tr><th>Factor</th><th className="r">Today</th><th className="r">Direction IC (out-of-sample)</th><th className="r">Move-size IC</th></tr></thead>
              <tbody>{m.factors.map((x) => <tr key={x.id}><td>{x.label}</td><td className="r num">{["vix_term", "vxn"].includes(x.id) ? n2(x.value) : x.id === "tnx_chg" ? `${n2(x.value, 1)}bp` : pc(x.value, 2)}</td><td className="r num">{n2(x.icOOS, 3)} <span className="dim">(t {n2(x.tOOS, 1)})</span></td><td className="r num">{n2(x.volIcOOS, 2)}</td></tr>)}</tbody></table>
          </>}
          {r.errors.length > 0 && <div style={{ marginTop: 16 }}>{r.errors.map((e) => <div key={e} className="err">{e}</div>)}</div>}
        </div>
      </details>
    </main>
  );
}

function Row({ z, last, cls }: { z: { label: string; price: number }; last: number | null; cls: string }) {
  return <>
    <span className={cls}>{z.label}</span>
    <span className="r num">{n0(z.price)}</span>
    <span className="r num dim">{last ? sgn(z.price - last) : ""}</span>
  </>;
}
