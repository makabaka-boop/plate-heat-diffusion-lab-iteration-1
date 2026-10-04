import { useEffect, useMemo, useState } from "react";
import { edgeKey, formatRational } from "../rational.js";
import Heatmap from "./Heatmap.jsx";
import CurveChart from "./CurveChart.jsx";

const STATUS_TEXT = {
  exact: "精确命中",
  closest: "无精确解，已取误差最小的合法值",
  all: "任意初温都命中",
  unreachable: "任何初温都无法命中",
};

function CellSelect({ prefix, r, c, rows, cols, onChange }) {
  return (
    <span className="cell-select">
      (
      <select
        data-testid={`${prefix}-row`}
        value={r}
        onChange={(e) => onChange(Number(e.target.value), c)}
      >
        {Array.from({ length: rows }, (_, i) => (
          <option key={i} value={i}>{i}</option>
        ))}
      </select>
      ,
      <select
        data-testid={`${prefix}-col`}
        value={c}
        onChange={(e) => onChange(r, Number(e.target.value))}
      >
        {Array.from({ length: cols }, (_, i) => (
          <option key={i} value={i}>{i}</option>
        ))}
      </select>
      )
    </span>
  );
}

// 单格逆向校准：冻结当前编辑器输入，反求可调格初温；
// 结果只用于对比展示，确认后才写回编辑器。
export default function CalibrationPanel({
  rows,
  cols,
  steps,
  loading,
  error,
  result,
  frame,
  onFrameChange,
  onRun,
  onConfirm,
  onCancel,
}) {
  const [adjustR, setAdjustR] = useState(0);
  const [adjustC, setAdjustC] = useState(0);
  const [obsR, setObsR] = useState(0);
  const [obsC, setObsC] = useState(1);
  const [obsStep, setObsStep] = useState(1);
  const [target, setTarget] = useState("5");

  // 网格尺寸/步数变化时钳制表单，避免提交越界坐标。
  useEffect(() => {
    setAdjustR((v) => Math.min(v, rows - 1));
    setObsR((v) => Math.min(v, rows - 1));
    setAdjustC((v) => Math.min(v, cols - 1));
    setObsC((v) => Math.min(v, cols - 1));
  }, [rows, cols]);
  useEffect(() => {
    setObsStep((v) => Math.min(Math.max(v, 0), steps));
  }, [steps]);

  const submit = () => {
    onRun({ adjustR, adjustC, obsR, obsC, obsStep, target });
  };

  const blockedSet = useMemo(
    () =>
      result
        ? new Set(result.baseline.blockedEdges.map((e) => edgeKey(e.r1, e.c1, e.r2, e.c2)))
        : new Set(),
    [result]
  );

  // 当前帧下候选与基线温度不同的格子（精确字符串比较）。
  const diffCells = useMemo(() => {
    const diff = new Set();
    if (!result || !result.candidate) return diff;
    const a = result.baseline.frames[frame];
    const b = result.candidate.frames[frame];
    for (let r = 0; r < a.length; r++) {
      for (let c = 0; c < a[0].length; c++) {
        if (a[r][c] !== b[r][c]) diff.add(`${r},${c}`);
      }
    }
    return diff;
  }, [result, frame]);

  const obsKey = result ? `${result.observeCell.r},${result.observeCell.c}` : null;
  const canApply = result && (result.status === "exact" || result.status === "closest");

  return (
    <section className="panel cal-panel">
      <h2>单格逆向校准</h2>
      <p className="hint">
        冻结当前网格、阻断边、边界模式与步数，反求可调格初温，使观测格在指定步达到目标温度
        （有理数，如 7/2）。结果经服务端精确求解，确认后才会写回编辑器。
      </p>
      <div className="controls-row">
        <label>
          可调格
          <CellSelect
            prefix="cal-adjust"
            r={adjustR}
            c={adjustC}
            rows={rows}
            cols={cols}
            onChange={(r, c) => {
              setAdjustR(r);
              setAdjustC(c);
            }}
          />
        </label>
        <label>
          观测格
          <CellSelect
            prefix="cal-obs"
            r={obsR}
            c={obsC}
            rows={rows}
            cols={cols}
            onChange={(r, c) => {
              setObsR(r);
              setObsC(c);
            }}
          />
        </label>
        <label>
          观测步
          <input
            data-testid="cal-step-input"
            type="number"
            min={0}
            max={steps}
            step={1}
            value={obsStep}
            onChange={(e) => setObsStep(Number(e.target.value))}
          />
        </label>
        <label>
          目标温度
          <input
            data-testid="cal-target-input"
            className="target-input"
            type="text"
            value={target}
            placeholder="如 7/2"
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <button data-testid="cal-run-button" className="primary" onClick={submit} disabled={loading}>
          {loading ? "求解中…" : "求解初温"}
        </button>
      </div>

      {error && (
        <div className="banner error" data-testid="cal-error">
          {error}
        </div>
      )}

      {result && (
        <div className="cal-result" data-testid="cal-result">
          <div
            className={`banner cal-${result.status}`}
            data-testid="cal-status"
            data-status={result.status}
          >
            {STATUS_TEXT[result.status]}
          </div>
          <div className="stats">
            <div>
              求解初温（可调格 ({result.adjustCell.r},{result.adjustCell.c})）：
              <span data-testid="cal-value" data-value={result.value ?? ""}>
                {result.value ?? "—"}
              </span>
            </div>
            <div>
              观测格 ({result.observeCell.r},{result.observeCell.c}) 第 {result.observeStep} 步观测值：
              <span data-testid="cal-observed" data-exact={result.observed}>
                {formatRational(result.observed, 4)}
              </span>
              （目标 {formatRational(result.target, 4)}）
            </div>
            <div>
              精确残差（观测值 − 目标）：
              <span data-testid="cal-residual" data-exact={result.residual}>
                {formatRational(result.residual, 4)}
              </span>
            </div>
            {result.status === "all" && (
              <div>可调格对观测格没有影响，且观测值已恒等于目标，无需修改。</div>
            )}
            {result.status === "unreachable" && (
              <div>可调格对观测格没有影响，观测值恒定，无法通过该格命中目标。</div>
            )}
          </div>

          {result.candidate && (
            <div className="cal-compare" data-testid="cal-compare">
              <div className="controls-row">
                <input
                  data-testid="cal-frame-slider"
                  type="range"
                  min={0}
                  max={result.baseline.steps}
                  value={frame}
                  onChange={(e) => onFrameChange(Number(e.target.value))}
                />
                <span data-testid="cal-frame-indicator" className="frame-indicator">
                  帧 {frame}/{result.baseline.steps}
                </span>
              </div>
              <div className="cal-compare-grids">
                <div>
                  <h3>原模拟（当前初温）</h3>
                  <Heatmap
                    name="cal-base"
                    frames={result.baseline.frames}
                    frameIdx={frame}
                    blocked={blockedSet}
                    selected={new Set()}
                    highlight={diffCells}
                  />
                </div>
                <div>
                  <h3>候选（初温 = {result.value}）</h3>
                  <Heatmap
                    name="cal-cand"
                    frames={result.candidate.frames}
                    frameIdx={frame}
                    blocked={blockedSet}
                    selected={new Set()}
                    highlight={diffCells}
                  />
                </div>
              </div>
              <div className="stats">
                <div>
                  观测格第 {frame} 帧：原{" "}
                  <span
                    data-testid="cal-obs-baseline"
                    data-exact={result.baseline.frames[frame][result.observeCell.r][result.observeCell.c]}
                  >
                    {formatRational(
                      result.baseline.frames[frame][result.observeCell.r][result.observeCell.c],
                      4
                    )}
                  </span>{" "}
                  → 候选{" "}
                  <span
                    data-testid="cal-obs-candidate"
                    data-exact={result.candidate.frames[frame][result.observeCell.r][result.observeCell.c]}
                  >
                    {formatRational(
                      result.candidate.frames[frame][result.observeCell.r][result.observeCell.c],
                      4
                    )}
                  </span>
                </div>
              </div>
              <CurveChart
                frames={result.baseline.frames}
                compareFrames={result.candidate.frames}
                selected={new Set([obsKey])}
                currentFrame={frame}
                target={result.target}
              />
            </div>
          )}

          <div className="controls-row">
            {canApply && (
              <button data-testid="cal-confirm" className="primary" onClick={onConfirm}>
                采用该初温（{result.value}）
              </button>
            )}
            <button data-testid="cal-cancel" onClick={onCancel}>
              取消
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
