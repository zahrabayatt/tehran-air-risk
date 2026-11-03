export type PlotPoint = { cx: number; cy: number; r: number; fill: string; stroke: string; op: number };
export type PlotLine = { d: string; stroke: string; width: number; dash: string };
export type PlotBar = { x: number; y: number; w: number; h: number; fill: string; stroke: string; op: number };
export type PlotText = { x: number; y: number; anchor: 'start' | 'middle' | 'end'; size: number; t: string };
export type PlotXTick = { x: number; y1: number; y2: number; ty: number; label: string };
export type PlotYTick = { x1: number; x2: number; y: number; tx: number; ty: number; label: string };

export type PlotSpec = {
  points: PlotPoint[];
  lines: PlotLine[];
  bars: PlotBar[];
  texts: PlotText[];
  xTicks: PlotXTick[];
  yTicks: PlotYTick[];
  legend: string[];
  xLabel: string;
  yLabel: string;
};

export const emptyPlot = (): PlotSpec => ({
  points: [],
  lines: [],
  bars: [],
  texts: [],
  xTicks: [],
  yTicks: [],
  legend: [],
  xLabel: '',
  yLabel: '',
});

/** True when every value is a finite number, so a bad value never reaches the SVG. */
const finite = (...values: number[]) => values.every((v) => Number.isFinite(v));

type PlotProps = { spec: PlotSpec; label: string };

/** Renders a PlotSpec as an SVG on the design's 720 by 400 canvas. Colors come from CSS tokens. */
export function Plot({ spec, label }: PlotProps) {
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox="0 0 720 400" role="img" aria-label={label} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {spec.yTicks
          .filter((k) => finite(k.x1, k.x2, k.y, k.tx, k.ty))
          .map((k, i) => (
            <g key={`y${i}`}>
              <line x1={k.x1} x2={k.x2} y1={k.y} y2={k.y} stroke="var(--rule)" strokeWidth={1} />
              <text x={k.tx} y={k.ty} textAnchor="end" fontSize={12} fill="var(--mut)">
                {k.label}
              </text>
            </g>
          ))}
        {spec.xTicks
          .filter((k) => finite(k.x, k.y1, k.y2, k.ty))
          .map((k, i) => (
            <g key={`x${i}`}>
              <line x1={k.x} x2={k.x} y1={k.y1} y2={k.y2} stroke="var(--rule)" strokeWidth={1} />
              <text x={k.x} y={k.ty} textAnchor="middle" fontSize={12} fill="var(--mut)">
                {k.label}
              </text>
            </g>
          ))}
        {spec.bars
          .filter((b) => finite(b.x, b.y, b.w, b.h, b.op))
          .map((b, i) => (
            <rect key={`b${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.fill} stroke={b.stroke} fillOpacity={b.op} />
          ))}
        {spec.lines
          .filter((l) => l.d.length > 0 && !/NaN|Infinity/.test(l.d))
          .map((l, i) => (
            <path key={`l${i}`} d={l.d} fill="none" stroke={l.stroke} strokeWidth={l.width} strokeDasharray={l.dash || undefined} />
          ))}
        {spec.points
          .filter((p) => finite(p.cx, p.cy, p.r, p.op))
          .map((p, i) => (
            <circle key={`p${i}`} cx={p.cx} cy={p.cy} r={p.r} fill={p.fill} stroke={p.stroke} fillOpacity={p.op} />
          ))}
        {spec.texts
          .filter((t) => finite(t.x, t.y, t.size))
          .map((t, i) => (
            <text key={`t${i}`} x={t.x} y={t.y} textAnchor={t.anchor} fontSize={t.size} fill="var(--ink)">
              {t.t}
            </text>
          ))}
        <text x={392} y={394} textAnchor="middle" fontSize={13} fill="var(--ink)">
          {spec.xLabel}
        </text>
        <text x={14} y={200} textAnchor="middle" fontSize={13} fill="var(--ink)" transform="rotate(-90 14 200)">
          {spec.yLabel}
        </text>
      </svg>
      {spec.legend.length > 0 ? (
        <figcaption
          style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 14, color: 'var(--mut)', marginTop: 8 }}
        >
          {spec.legend.map((g, i) => (
            <span key={i}>{g}</span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}
