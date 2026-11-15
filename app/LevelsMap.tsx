import type { BiasReport } from "@/lib/bias";

// Levels map: one price scale with the expected-move band, prior value area, overnight range,
// naked POCs, gamma flip / walls, and dealer gamma by strike lined up on the right.

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

export default function LevelsMap({ r }: { r: BiasReport }) {
  const lv = r.levels, g = r.gex, last = r.last;
  if (!lv || !last) return <p className="mut">Levels unavailable.</p>;
  const P = lv.prior, on = lv.overnight, em = r.expectedRange, pc = P.close;

  const naked = r.naked.filter((n) => Math.abs(n.poc - last) / last < 0.05);
  const reach = (em ?? last * 0.012) * 1.6; // zoom on the tradable zone; far walls are shown as edge markers
  const core = [P.high, P.low, P.vah, P.val, last, on?.high, on?.low, em ? pc + em : null, em ? pc - em : null];
  const optional = [g?.nq.flip, g?.nq.callWall, g?.nq.putWall, ...naked.map((n) => n.poc)];
  const vals = [...core, ...optional.filter((v) => v != null && Math.abs(v - last) <= reach)]
    .filter((v): v is number => v != null && isFinite(v));
  const span = Math.max(...vals) - Math.min(...vals);
  const lo = Math.min(...vals) - span * 0.06, hi = Math.max(...vals) + span * 0.06;
  const W = 1000, H = 640, yTop = 28, bot = 610, X0 = 64, LX = 430, X1 = 590, G0 = 660, G1 = 990, GZ = (G0 + G1) / 2;
  const Y = (p: number) => bot - ((p - lo) / (hi - lo)) * (bot - yTop);
  const step = [25, 50, 100, 200, 250, 500, 1000].find((s) => (hi - lo) / s <= 14) ?? 1000;
  const ticks: number[] = []; for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) ticks.push(p);

  type L = { n: string; p: number; c: string };
  const labels: L[] = [
    g && { n: "Call wall", p: g.nq.callWall, c: "var(--long)" },
    g?.nq.flip && { n: "Gamma flip", p: g.nq.flip, c: "var(--warn)" },
    g && { n: "Put wall", p: g.nq.putWall, c: "var(--short)" },
    { n: `Prior high${P.poorHigh ? " (poor)" : ""}`, p: P.high, c: "var(--txt)" },
    { n: "VAH", p: P.vah, c: "var(--txt)" },
    { n: "POC", p: P.poc, c: "var(--txt)" },
    { n: "VAL", p: P.val, c: "var(--txt)" },
    { n: `Prior low${P.poorLow ? " (poor)" : ""}`, p: P.low, c: "var(--txt)" },
    on && { n: "ON high", p: on.high, c: "var(--mut)" },
    on && { n: "ON low", p: on.low, c: "var(--mut)" },
    ...naked.map((x) => ({ n: `nPOC ${x.date.slice(5)}`, p: x.poc, c: "var(--accent)" })),
  ].filter((x): x is L => !!x);
  const off = labels.filter((l) => l.p <= lo || l.p >= hi);
  const placed = labels.filter((l) => l.p > lo && l.p < hi).map((l) => ({ ...l, y: Y(l.p) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < placed.length; i++) if (placed[i].y - placed[i - 1].y < 16) placed[i].y = placed[i - 1].y + 16;
  for (let i = placed.length - 2; i >= 0; i--) { if (placed[i + 1].y > bot) placed[i + 1].y = bot; if (placed[i + 1].y - placed[i].y < 16) placed[i].y = placed[i + 1].y - 16; }

  const prof = (g?.profile ?? []).map((s) => ({ p: s.strike * (g?.nqRatio ?? 1), v: s.gex, k: s.strike })).filter((s) => s.p > lo && s.p < hi);
  const gmax = Math.max(1e-9, ...prof.map((s) => Math.abs(s.v)));
  const bigCut = gmax * 0.25;
  const cx0 = 140, cx1 = 300, ox = 370;
  const across = (p: number | null | undefined, color: string, dash: string) => p && p > lo && p < hi ? <line x1={X0} x2={LX - 8} y1={Y(p)} y2={Y(p)} stroke={color} strokeDasharray={dash} strokeWidth={1.3} /> : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Levels map: value area, overnight range, gamma flip and walls, dealer gamma by strike">
      {ticks.map((p) => <g key={p}><line x1={X0} x2={X1} y1={Y(p)} y2={Y(p)} stroke="var(--grid)" /><text x={X0 - 8} y={Y(p) + 4} textAnchor="end" fontSize={10.5} fill="var(--dim)" className="mono">{fmt(p)}</text></g>)}
      {em && <g>
        <rect x={X0} y={Y(pc + em)} width={LX - 8 - X0} height={Y(pc - em) - Y(pc + em)} fill="rgba(96,165,250,.06)" stroke="rgba(96,165,250,.3)" strokeDasharray="4 4" />
        <text x={X0 + 8} y={Y(pc + em) + 13} fontSize={10.5} fill="var(--accent)">+1σ {fmt(pc + em)}</text>
        <text x={X0 + 8} y={Y(pc - em) - 5} fontSize={10.5} fill="var(--accent)">−1σ {fmt(pc - em)}</text>
      </g>}
      <rect x={cx0 + 60} y={Y(P.high)} width={40} height={Y(P.low) - Y(P.high)} fill="rgba(232,234,237,.035)" stroke="var(--line2)" />
      <rect x={cx0} y={Y(P.vah)} width={cx1 - cx0} height={Y(P.val) - Y(P.vah)} fill="rgba(232,234,237,.09)" rx={3} />
      <line x1={cx0} x2={cx1} y1={Y(P.poc)} y2={Y(P.poc)} stroke="var(--txt)" strokeWidth={2} />
      <text x={(cx0 + cx1) / 2} y={Y(P.high) - 7} textAnchor="middle" fontSize={9.5} fontWeight={600} letterSpacing=".08em" fill="var(--dim)">PRIOR {P.shape}-SHAPE</text>
      {P.singlePrints.map(([a, b], i) => <rect key={i} x={cx1 - 6} y={Y(b)} width={6} height={Math.max(2, Y(a) - Y(b))} fill="var(--accent)" opacity={0.6} />)}
      {on && <g>
        <line x1={ox} x2={ox} y1={Y(on.high)} y2={Y(on.low)} stroke="var(--mut)" strokeWidth={3} strokeDasharray="5 3" />
        <line x1={ox - 9} x2={ox + 9} y1={Y(on.high)} y2={Y(on.high)} stroke="var(--mut)" strokeWidth={2} />
        <line x1={ox - 9} x2={ox + 9} y1={Y(on.low)} y2={Y(on.low)} stroke="var(--mut)" strokeWidth={2} />
        <text x={ox} y={Y(on.high) - 8} textAnchor="middle" fontSize={9.5} fontWeight={600} letterSpacing=".08em" fill="var(--dim)">ON</text>
      </g>}
      {naked.map((n) => <line key={n.date} x1={X0} x2={LX - 8} y1={Y(n.poc)} y2={Y(n.poc)} stroke="var(--accent)" strokeDasharray="1 3" strokeWidth={1.2} />)}
      {across(g?.nq.flip, "var(--warn)", "6 4")}
      {across(g?.nq.callWall, "var(--long)", "2 4")}
      {across(g?.nq.putWall, "var(--short)", "2 4")}
      <line x1={X0} x2={LX - 8} y1={Y(last)} y2={Y(last)} stroke="var(--txt)" opacity={0.55} />
      {placed.map((l) => {
        const d = l.p - last;
        return <g key={l.n}>
          <line x1={LX - 6} x2={LX - 2} y1={Y(l.p)} y2={l.y - 4} stroke="var(--line2)" />
          <text x={LX} y={l.y} fontSize={11.5} fill={l.c}>{l.n}</text>
          <text x={X1} y={l.y} textAnchor="end" fontSize={10.5} fill="var(--mut)" className="mono">{fmt(l.p)} {d >= 0 ? "+" : ""}{fmt(d)}</text>
        </g>;
      })}
      {off.map((l, i) => {
        const upSide = l.p >= hi, yy = upSide ? yTop + 2 + 14 * off.filter((x, j) => j < i && x.p >= hi).length : bot - 2 - 14 * off.filter((x, j) => j < i && x.p <= lo).length;
        return <text key={`off${l.n}`} x={X0 + 6} y={yy} fontSize={10.5} fill={l.c} className="mono">{upSide ? "▲" : "▼"} {l.n} {fmt(l.p)} ({l.p - last >= 0 ? "+" : ""}{fmt(l.p - last)})</text>;
      })}
      <path d={`M${X1 + 4} ${Y(last)} l10 -8 h60 v16 h-60 z`} fill="var(--txt)" />
      <text x={X1 + 44} y={Y(last) + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--bg)" className="mono">{fmt(last)}</text>
      <text x={GZ} y={14} textAnchor="middle" fontSize={9.5} fontWeight={600} letterSpacing=".08em" fill="var(--dim)">DEALER GAMMA BY STRIKE (QQQ→NQ)</text>
      <line x1={GZ} x2={GZ} y1={yTop} y2={bot} stroke="var(--line2)" />
      {prof.map((s) => {
        const w = (Math.abs(s.v) / gmax) * (GZ - G0 - 78), big = Math.abs(s.v) >= bigCut;
        return <g key={s.k}>
          <rect x={s.v >= 0 ? GZ : GZ - w} y={Y(s.p) - (big ? 4 : 2)} width={Math.max(w, 1)} height={big ? 8 : 4} rx={1.5} fill={s.v >= 0 ? "var(--long)" : "var(--short)"} opacity={big ? 0.95 : 0.45}><title>{`${s.k} (NQ ${fmt(s.p)}): ${s.v.toFixed(2)}B per 1%`}</title></rect>
          {big && <text x={s.v >= 0 ? GZ + w + 6 : GZ - w - 6} y={Y(s.p) + 4} textAnchor={s.v >= 0 ? "start" : "end"} fontSize={10} fill="var(--mut)" className="mono">{s.k} {s.v > 0 ? "+" : ""}{s.v.toFixed(2)}B</text>}
        </g>;
      })}
      <text x={G0} y={bot + 20} fontSize={10} fill="var(--dim)">← short γ, moves extend</text>
      <text x={G1} y={bot + 20} textAnchor="end" fontSize={10} fill="var(--dim)">long γ, moves dampen →</text>
    </svg>
  );
}
