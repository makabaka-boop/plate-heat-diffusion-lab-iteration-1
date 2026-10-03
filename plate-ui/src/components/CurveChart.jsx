import { parseRational } from "../rational.js";

export const PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#00b3c7", "#f032e6", "#9acd32", "#469990", "#9a6324",
];

export function colorForIndex(i) {
  return PALETTE[i % PALETTE.length];
}

// 单格温度随时间变化的折线图（SVG，无第三方依赖）。
export default function CurveChart({ frames, selected, currentFrame }) {
  const W = 640;
  const H = 260;
  const PAD = 40;
  const steps = frames.length - 1;
  const keys = [...selected];

  const series = keys.map((key, i) => {
    const [r, c] = key.split(",").map(Number);
    return {
      key,
      label: `(${r},${c})`,
      color: colorForIndex(i),
      values: frames.map((f) => parseRational(f[r][c])),
    };
  });

  let ymin = Infinity;
  let ymax = -Infinity;
  for (const s of series) {
    for (const v of s.values) {
      if (v < ymin) ymin = v;
      if (v > ymax) ymax = v;
    }
  }
  if (!Number.isFinite(ymin)) {
    ymin = 0;
    ymax = 1;
  }
  if (ymax - ymin < 1e-9) {
    ymin -= 1;
    ymax += 1;
  }
  const padY = (ymax - ymin) * 0.08;
  ymin -= padY;
  ymax += padY;

  const x = (i) => PAD + (i * (W - 2 * PAD)) / Math.max(steps, 1);
  const y = (v) => H - PAD - ((v - ymin) / (ymax - ymin)) * (H - 2 * PAD);

  const yTicks = [];
  for (let k = 0; k <= 4; k++) {
    const v = ymin + ((ymax - ymin) * k) / 4;
    yTicks.push(v);
  }

  return (
    <div className="curve-chart" data-testid="curve-chart">
      {series.length === 0 ? (
        <p className="hint">点击热图格子，可切换该格的温度曲线。</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="img">
            <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#888" />
            <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#888" />
            {yTicks.map((v, i) => (
              <g key={i}>
                <line x1={PAD} y1={y(v)} x2={W - PAD} y2={y(v)} stroke="#eee" />
                <text x={PAD - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#666">
                  {v.toFixed(1)}
                </text>
              </g>
            ))}
            {Array.from({ length: steps + 1 }, (_, i) => (
              <text key={i} x={x(i)} y={H - PAD + 14} textAnchor="middle" fontSize="10" fill="#666">
                {i}
              </text>
            ))}
            <line
              data-testid="frame-cursor"
              x1={x(currentFrame)}
              y1={PAD}
              x2={x(currentFrame)}
              y2={H - PAD}
              stroke="#333"
              strokeDasharray="4 3"
            />
            {series.map((s) => (
              <g key={s.key}>
                <polyline
                  data-testid={`curve-${s.key.replace(",", "-")}`}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                />
                {s.values.map((v, i) => (
                  <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={s.color} />
                ))}
              </g>
            ))}
          </svg>
          <div className="legend">
            {series.map((s) => (
              <span key={s.key} className="legend-item">
                <span className="legend-swatch" style={{ background: s.color }} />
                T{s.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
