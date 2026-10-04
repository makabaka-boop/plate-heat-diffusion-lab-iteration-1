import { parseRational } from "../rational.js";

// 逆向校准曲线对比：基线与候选在 可调格 / 观测格 上的逐帧轨迹。
// 观测步处用横虚线标出目标温度、实心点标出候选观测值。
const SERIES = [
  { key: "observe", label: "观测格·基线", color: "#4363d8", dash: "6 4", src: "baseline" },
  { key: "observe", label: "观测格·候选", color: "#e6194b", dash: "", src: "candidate" },
  { key: "adjust", label: "可调格·基线", color: "#888888", dash: "6 4", src: "baseline" },
  { key: "adjust", label: "可调格·候选", color: "#111111", dash: "", src: "candidate" },
];

export default function CalibrationChart({ baseline, candidate, adjust, observe, target, currentFrame }) {
  const W = 640;
  const H = 240;
  const PAD = 42;
  const steps = baseline.frames.length - 1;
  const cells = { adjust, observe };

  const series = SERIES.map((s) => ({
    ...s,
    values: baseline.frames.map(
      (f, i) => parseRational((s.src === "baseline" ? baseline : candidate).frames[i][cells[s.key].r][cells[s.key].c])
    ),
  }));
  const targetV = parseRational(target);

  let ymin = targetV;
  let ymax = targetV;
  for (const s of series) for (const v of s.values) {
    if (v < ymin) ymin = v;
    if (v > ymax) ymax = v;
  }
  if (ymax - ymin < 1e-9) {
    ymin -= 1;
    ymax += 1;
  }
  const padY = (ymax - ymin) * 0.1;
  ymin -= padY;
  ymax += padY;

  const x = (i) => PAD + (i * (W - 2 * PAD)) / Math.max(steps, 1);
  const y = (v) => H - PAD - ((v - ymin) / (ymax - ymin)) * (H - 2 * PAD);

  const observedAtStep = candidate.frames[steps][observe.r][observe.c];

  return (
    <div className="curve-chart" data-testid="cal-curve-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#888" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#888" />
        {Array.from({ length: steps + 1 }, (_, i) => (
          <text key={i} x={x(i)} y={H - PAD + 14} textAnchor="middle" fontSize="10" fill="#666">
            {i}
          </text>
        ))}
        {/* 观测步的目标温度横虚线 */}
        <line
          data-testid="cal-target-line"
          x1={x(steps) - 18}
          y1={y(targetV)}
          x2={W - PAD}
          y2={y(targetV)}
          stroke="#e6194b"
          strokeDasharray="3 3"
        />
        <circle
          data-testid="cal-observed-dot"
          cx={x(steps)}
          cy={y(parseRational(observedAtStep))}
          r={4}
          fill="#e6194b"
          stroke="#fff"
          strokeWidth={1}
        />
        <line
          data-testid="cal-frame-cursor"
          x1={x(currentFrame)}
          y1={PAD}
          x2={x(currentFrame)}
          y2={H - PAD}
          stroke="#333"
          strokeDasharray="4 3"
        />
        {series.map((s, si) => (
          <polyline
            key={si}
            data-testid={`cal-curve-${s.src}-${s.key}`}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dash}
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
          />
        ))}
      </svg>
      <div className="legend">
        {series.map((s, i) => (
          <span key={i} className="legend-item">
            <span
              className="legend-swatch"
              style={{ background: s.color, opacity: s.dash ? 0.55 : 1 }}
            />
            {s.label}
          </span>
        ))}
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: "#e6194b" }} />
          目标（第 {steps} 步）
        </span>
      </div>
    </div>
  );
}
