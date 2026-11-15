import type { StrikeVol } from "@/lib/options";

// Near-term (≤10 day) option volume by strike, calls up / puts down, with net dealer gamma underneath.
// Volume is unsigned: it shows where activity is, not who initiated it.
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const k = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v));

export default function StrikeChart({ rows, gamma, spot, ratio, last }: { rows: StrikeVol[]; gamma: { strike: number; gex: number }[]; spot: number; ratio: number; last: number }) {
  const R = rows.filter((r) => Math.abs(r.strike - spot) / spot <= 0.04);
  if (R.length < 5) return <p className="mut">Not enough strikes.</p>;
  const W = 1000, H = 300, x0 = 56, x1 = 950, mid = 130, vh = 100, gTop = 236, gh = 34;
  const lo = R[0].strike, hi = R[R.length - 1].strike;
  const X = (s: number) => x0 + ((s - lo) / (hi - lo)) * (x1 - x0);
  const bw = Math.max(2, ((x1 - x0) / (hi - lo)) * 0.7);
  const vmax = Math.max(...R.map((r) => Math.max(r.callVol, r.putVol)));
  const G = gamma.filter((g) => g.strike >= lo && g.strike <= hi), gmax = Math.max(1e-9, ...G.map((g) => Math.abs(g.gex)));
  const topC = [...R].sort((a, b) => b.callVol - a.callVol).slice(0, 3).map((r) => r.strike);
  const topP = [...R].sort((a, b) => b.putVol - a.putVol).slice(0, 3).map((r) => r.strike);
  const step = (hi - lo) > 40 ? 10 : 5;
  const ticks: number[] = []; for (let s = Math.ceil(lo / step) * step; s <= hi; s += step) ticks.push(s);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Near-term option volume by strike with net dealer gamma">
      <line x1={x0} x2={x1} y1={mid} y2={mid} stroke="var(--line2)" />
      <text x={x0 - 8} y={mid - vh + 8} textAnchor="end" fontSize={10} fill="var(--long)">calls</text>
      <text x={x0 - 8} y={mid + vh - 2} textAnchor="end" fontSize={10} fill="var(--short)">puts</text>
      {R.map((r) => {
        const hc = (r.callVol / vmax) * vh, hp = (r.putVol / vmax) * vh;
        return <g key={r.strike}>
          <rect x={X(r.strike) - bw / 2} y={mid - hc} width={bw} height={hc} rx={1} fill="var(--long)" opacity={topC.includes(r.strike) ? 0.95 : 0.5}><title>{`${r.strike} calls: ${fmt(r.callVol)} vol · ${fmt(r.callOi)} OI`}</title></rect>
          <rect x={X(r.strike) - bw / 2} y={mid} width={bw} height={hp} rx={1} fill="var(--short)" opacity={topP.includes(r.strike) ? 0.95 : 0.5}><title>{`${r.strike} puts: ${fmt(r.putVol)} vol · ${fmt(r.putOi)} OI`}</title></rect>
          {topC.includes(r.strike) && <text x={X(r.strike)} y={mid - hc - 5} textAnchor="middle" fontSize={10} fill="var(--txt)" className="num">{r.strike} · {k(r.callVol)}</text>}
          {topP.includes(r.strike) && <text x={X(r.strike)} y={mid + hp + 12} textAnchor="middle" fontSize={10} fill="var(--txt)" className="num">{r.strike} · {k(r.putVol)}</text>}
        </g>;
      })}
      <line x1={X(spot)} x2={X(spot)} y1={mid - vh - 6} y2={gTop + gh} stroke="var(--txt)" strokeDasharray="3 3" opacity={0.6} />
      <text x={X(spot)} y={mid - vh - 10} textAnchor="middle" fontSize={10} fill="var(--txt)" className="num">QQQ {spot.toFixed(2)} · NQ {fmt(last)}</text>
      <text x={x0 - 8} y={gTop + gh / 2 + 4} textAnchor="end" fontSize={10} fill="var(--dim)">net γ</text>
      <line x1={x0} x2={x1} y1={gTop + gh / 2} y2={gTop + gh / 2} stroke="var(--line)" />
      {G.map((g) => { const h = (Math.abs(g.gex) / gmax) * (gh / 2); return <rect key={g.strike} x={X(g.strike) - bw / 2} y={g.gex >= 0 ? gTop + gh / 2 - h : gTop + gh / 2} width={bw} height={Math.max(h, 0.5)} fill={g.gex >= 0 ? "var(--long)" : "var(--short)"} opacity={0.7}><title>{`${g.strike}: ${g.gex.toFixed(2)}B per 1%`}</title></rect>; })}
      {ticks.map((s) => <text key={s} x={X(s)} y={H - 6} textAnchor="middle" fontSize={9.5} fill="var(--dim)" className="num">{s}<tspan fill="var(--line2)"> · </tspan>{fmt(s * ratio)}</text>)}
    </svg>
  );
}
