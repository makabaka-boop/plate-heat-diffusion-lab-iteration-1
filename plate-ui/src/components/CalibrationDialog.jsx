import { useEffect, useMemo, useRef, useState } from "react";
import { calibrate } from "../api.js";
import { edgeKey, formatRational, parseTargetInput } from "../rational.js";
import CompareHeatmap from "./CompareHeatmap.jsx";
import CalibrationChart from "./CalibrationChart.jsx";

const STATUS_TEXT = {
  exact: "精确命中",
  nearest: "无精确解，已给出误差最小的合法值",
  all: "可调格对观测格无影响：所有合法初温都命中",
  none: "可调格对观测格无影响：无任何合法初温可命中",
};

function CellSelect({ rName, cName, rows, cols, value, onChange }) {
  return (
    <span className="cell-select">
      <select
        data-testid={rName}
        value={value.r}
        onChange={(e) => onChange({ ...value, r: Number(e.target.value) })}
      >
        {Array.from({ length: rows }, (_, i) => (
          <option key={i} value={i}>{i}</option>
        ))}
      </select>
      <select
        data-testid={cName}
        value={value.c}
        onChange={(e) => onChange({ ...value, c: Number(e.target.value) })}
      >
        {Array.from({ length: cols }, (_, i) => (
          <option key={i} value={i}>{i}</option>
        ))}
      </select>
    </span>
  );
}

// 单格逆向校准对话框。snapshot 是打开瞬间冻结的基线；对话框内部拥有独立的
// 请求序号，迟到的旧响应一律丢弃；只有点击“采用”才通过 onApply 写回编辑器。
export default function CalibrationDialog({ snapshot, onClose, onApply }) {
  const { rows, cols, grid, blockedEdges, steps, boundary } = snapshot;

  const [adjust, setAdjust] = useState({ r: 0, c: 0 });
  const [observe, setObserve] = useState({ r: Math.min(1, rows - 1), c: Math.min(1, cols - 1) });
  const [targetText, setTargetText] = useState("0");
  const [pickMode, setPickMode] = useState("adjust");

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [frame, setFrame] = useState(0);
  const [view, setView] = useState("candidate");

  const seqRef = useRef(0);
  const blocked = useMemo(
    () => new Set(blockedEdges.map((e) => edgeKey(e.r1, e.c1, e.r2, e.c2))),
    [blockedEdges]
  );

  const target = parseTargetInput(targetText);
  const targetInvalid = targetText.trim() !== "" && target === null;

  // 参数变化即按冻结基线重新校准（防抖）；每个在途请求带独立序号，
  // 编辑期间到达的旧响应直接丢弃，不会覆盖最新结论。
  useEffect(() => {
    if (target === null) {
      // 作废旧参数下在途的请求，避免合法目标的迟到响应回填到非法输入状态。
      seqRef.current += 1;
      setLoading(false);
      setResult(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      const id = ++seqRef.current;
      setLoading(true);
      setError(null);
      calibrate({
        grid,
        blockedEdges,
        steps,
        boundary,
        adjust,
        observe,
        target,
      })
        .then((data) => {
          if (id !== seqRef.current) return; // 迟到响应，丢弃
          setResult(data);
          setFrame(0);
        })
        .catch((e) => {
          if (id !== seqRef.current) return;
          setError(e.message || "校准请求失败");
          setResult(null);
        })
        .finally(() => {
          if (id === seqRef.current) setLoading(false);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [grid, blockedEdges, steps, boundary, adjust, observe, target]);

  const pickCell = (r, c) => {
    if (pickMode === "adjust") setAdjust({ r, c });
    else setObserve({ r, c });
  };

  const confirm = () => {
    if (!result || result.status === "none") return;
    if (result.candidateValue !== result.originalValue) {
      onApply(result.adjust.r, result.adjust.c, result.candidateValue);
    }
    onClose();
  };

  const status = result && result.status;
  const unchanged = result && result.candidateValue === result.originalValue;

  return (
    <div className="modal-backdrop" data-testid="calibration-dialog">
      <div className="modal" role="dialog" aria-label="单格逆向校准">
        <div className="modal-head">
          <h2>单格逆向校准</h2>
          <button data-testid="cal-close" onClick={onClose}>×</button>
        </div>

        <p className="frozen-summary" data-testid="cal-frozen">
          冻结基线：{rows} 行 × {cols} 列，{steps} 步，{boundary}
          {boundary === "insulated" ? "（绝热）" : "（零温环境）"}，阻断边 {blockedEdges.length} 条
        </p>

        <div className="cal-controls">
          <label className="cal-field">
            可调初温格
            <CellSelect
              rName="cal-adjust-r"
              cName="cal-adjust-c"
              rows={rows}
              cols={cols}
              value={adjust}
              onChange={setAdjust}
            />
          </label>
          <label className="cal-field">
            观测格（第 {steps} 步）
            <CellSelect
              rName="cal-observe-r"
              cName="cal-observe-c"
              rows={rows}
              cols={cols}
              value={observe}
              onChange={setObserve}
            />
          </label>
          <label className="cal-field target-field">
            目标温度（有理数）
            <input
              data-testid="cal-target-input"
              className={targetInvalid ? "invalid-input" : ""}
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              placeholder="如 6、7/4、-3、0.25"
            />
          </label>
          <div className="cal-field" role="group">
            点格选择
            <label>
              <input
                data-testid="cal-pick-adjust"
                type="radio"
                checked={pickMode === "adjust"}
                onChange={() => setPickMode("adjust")}
              />
              可调格
            </label>
            <label>
              <input
                data-testid="cal-pick-observe"
                type="radio"
                checked={pickMode === "observe"}
                onChange={() => setPickMode("observe")}
              />
              观测格
            </label>
          </div>
        </div>

        {targetInvalid && (
          <div className="banner error" data-testid="cal-target-invalid">
            目标温度必须是整数或有理数（如 7/4、-3、0.25）。
          </div>
        )}
        {loading && (
          <div className="banner stale" data-testid="cal-loading">
            校准计算中…
          </div>
        )}
        {error && (
          <div className="banner error" data-testid="cal-error">
            {error}
          </div>
        )}

        {result && (
          <div className={`cal-result cal-${status}`} data-testid="cal-result">
            <div className="cal-status-line">
              <strong data-testid="cal-status">{STATUS_TEXT[status]}</strong>
            </div>
            <div className="cal-numbers">
              <span>
                建议初温
                <b data-testid="cal-candidate-value">{result.candidateValue}</b>
                （原 {result.originalValue}）
              </span>
              <span>
                第 {result.observe.step} 步观测
                <b data-testid="cal-observed" title={result.observed}>
                  {formatRational(result.observed, 4)}
                </b>
                目标 {formatRational(result.target, 4)}
              </span>
              <span>
                精确残差
                <b
                  data-testid="cal-residual"
                  data-exact={result.residual}
                  title={result.residual}
                >
                  {result.residual}
                </b>
                （|误差| = {result.absError}）
              </span>
            </div>
          </div>
        )}

        {result && (
          <>
            <div className="cal-view-row">
              <div className="view-switch" role="tablist">
                <button
                  data-testid="cal-view-candidate"
                  className={view === "candidate" ? "active" : ""}
                  onClick={() => setView("candidate")}
                >
                  候选帧
                </button>
                <button
                  data-testid="cal-view-baseline"
                  className={view === "baseline" ? "active" : ""}
                  onClick={() => setView("baseline")}
                >
                  原模拟帧
                </button>
                <button
                  data-testid="cal-view-diff"
                  className={view === "diff" ? "active" : ""}
                  onClick={() => setView("diff")}
                >
                  逐帧差值
                </button>
              </div>
              <div className="cal-scrub">
                <input
                  data-testid="cal-frame-slider"
                  type="range"
                  min={0}
                  max={steps}
                  value={frame}
                  onChange={(e) => setFrame(Number(e.target.value))}
                />
                <span data-testid="cal-frame-indicator" className="frame-indicator">
                  帧 {frame}/{steps}
                </span>
              </div>
            </div>

            <CompareHeatmap
              baselineFrames={result.baseline.frames}
              candidateFrames={result.candidate.frames}
              frameIdx={frame}
              rows={rows}
              cols={cols}
              blocked={blocked}
              adjust={result.adjust}
              observe={result.observe}
              mode={view}
              onPickCell={pickCell}
            />
            <div className="cal-legend">
              <span className="badge adjust-badge">可调格</span>
              <span className="badge observe-badge">观测格</span>
              <span className="hint">点击下方热图格子可改选（由“点格选择”决定改哪一个）。</span>
            </div>

            <CalibrationChart
              baseline={result.baseline}
              candidate={result.candidate}
              adjust={result.adjust}
              observe={result.observe}
              target={result.target}
              currentFrame={frame}
            />
          </>
        )}

        {!result && !error && !loading && (
          <p className="hint">输入合法的目标温度后将自动按冻结基线反求初温。</p>
        )}

        <div className="modal-actions">
          <button data-testid="cal-cancel" onClick={onClose}>
            取消
          </button>
          <button
            data-testid="cal-confirm"
            className="primary"
            disabled={!result || status === "none"}
            onClick={confirm}
          >
            {status === "all" || unchanged ? "确认（不改动初温）" : `采用初温 ${result ? result.candidateValue : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
