import { useEffect, useRef, useState } from "react";
import { calibrate, simulate } from "./api.js";
import { edgeFromKey, edgeKey, formatRational } from "./rational.js";
import GridEditor from "./components/GridEditor.jsx";
import Heatmap from "./components/Heatmap.jsx";
import CurveChart from "./components/CurveChart.jsx";
import PlaybackControls from "./components/PlaybackControls.jsx";
import CalibrationPanel from "./components/CalibrationPanel.jsx";

const MIN_DIM = 3;
const MAX_DIM = 12;

function defaultGrid(rows, cols) {
  const g = Array.from({ length: rows }, () => Array(cols).fill("0"));
  // 默认放一个 2x2 热源，方便直接演示。
  const r0 = Math.floor((rows - 2) / 2);
  const c0 = Math.floor((cols - 2) / 2);
  for (let dr = 0; dr < 2; dr++) {
    for (let dc = 0; dc < 2; dc++) g[r0 + dr][c0 + dc] = "100";
  }
  return g;
}

// 把编辑器里的字符串网格解析为整数矩阵，失败抛错。
function parseGrid(grid) {
  return grid.map((row, r) =>
    row.map((v, c) => {
      const n = Number(v);
      if (v.trim() === "" || !Number.isInteger(n) || n < -100 || n > 100) {
        throw new Error(`第 ${r + 1} 行第 ${c + 1} 列必须是 -100~100 的整数`);
      }
      return n;
    })
  );
}

export default function App() {
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(4);
  const [grid, setGrid] = useState(() => defaultGrid(4, 4));
  const [blocked, setBlocked] = useState(() => new Set());
  const [steps, setSteps] = useState(8);
  const [boundary, setBoundary] = useState("insulated");

  const [result, setResult] = useState(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(400);
  const [selected, setSelected] = useState(() => new Set());

  // 逆向校准：结果只用于对比展示，确认后才写回编辑器。
  const [calResult, setCalResult] = useState(null);
  const [calError, setCalError] = useState(null);
  const [calLoading, setCalLoading] = useState(false);
  const [calFrame, setCalFrame] = useState(0);

  // 请求序号：每次编辑或发起新请求都 +1；
  // 响应返回时序号不匹配说明是过期响应，直接丢弃。
  const reqSeq = useRef(0);
  // 校准请求独立计数；任何编辑同样使其 +1，编辑期间到达的旧校准响应即失效。
  const calSeq = useRef(0);

  const markEdited = () => {
    reqSeq.current += 1;
    calSeq.current += 1;
    setPlaying(false);
    setStale(true);
    // 冻结基线已变化，旧校准结论作废；在途响应将被丢弃，视为求解结束。
    setCalResult(null);
    setCalError(null);
    setCalLoading(false);
  };

  const resize = (newRows, newCols) => {
    setGrid((g) =>
      Array.from({ length: newRows }, (_, r) =>
        Array.from({ length: newCols }, (_, c) => (g[r] && g[r][c]) ?? "0")
      )
    );
    setBlocked((b) => {
      const next = new Set();
      for (const key of b) {
        const { r1, c1, r2, c2 } = edgeFromKey(key);
        if (r2 < newRows && c2 < newCols) next.add(key);
      }
      return next;
    });
    setSelected((s) => {
      const next = new Set();
      for (const key of s) {
        const [r, c] = key.split(",").map(Number);
        if (r < newRows && c < newCols) next.add(key);
      }
      return next;
    });
    setRows(newRows);
    setCols(newCols);
    markEdited();
  };

  const onCellChange = (r, c, value) => {
    setGrid((g) => g.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row)));
    markEdited();
  };

  const onToggleEdge = (key) => {
    setBlocked((b) => {
      const next = new Set(b);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    markEdited();
  };

  const onToggleCell = (r, c) => {
    setSelected((s) => {
      const next = new Set(s);
      const key = `${r},${c}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const run = async () => {
    setError(null);
    let gridNums;
    try {
      gridNums = parseGrid(grid);
    } catch (e) {
      setError(e.message);
      return;
    }
    const payload = {
      grid: gridNums,
      blockedEdges: [...blocked].map(edgeFromKey),
      steps,
      boundary,
    };
    const id = ++reqSeq.current;
    setLoading(true);
    try {
      const data = await simulate(payload);
      if (id !== reqSeq.current) return; // 过期响应，丢弃
      setResult(data);
      setStale(false);
      setFrame(0);
      setPlaying(false);
      setSelected(new Set());
    } catch (e) {
      if (id !== reqSeq.current) return;
      setError(e.message || "请求失败");
      setResult(null);
    } finally {
      if (id === reqSeq.current) setLoading(false);
    }
  };

  // 逆向校准：冻结当前编辑器输入向服务端求解；不影响已有模拟结果。
  const runCalibration = async ({ adjustR, adjustC, obsR, obsC, obsStep, target }) => {
    setCalError(null);
    let gridNums;
    try {
      gridNums = parseGrid(grid);
    } catch (e) {
      setCalError(e.message);
      return;
    }
    if (!/^[+-]?\d+(\/[+-]?\d+)?$/.test(target.trim())) {
      setCalError('目标温度必须是整数或 "p/q" 形式的有理数');
      return;
    }
    const payload = {
      grid: gridNums,
      blockedEdges: [...blocked].map(edgeFromKey),
      steps,
      boundary,
      adjustCell: { r: adjustR, c: adjustC },
      observeCell: { r: obsR, c: obsC },
      observeStep: obsStep,
      target: target.trim(),
    };
    const id = ++calSeq.current;
    setCalLoading(true);
    try {
      const data = await calibrate(payload);
      if (id !== calSeq.current) return; // 编辑期间到达的旧响应，丢弃
      setCalResult(data);
      setCalFrame(data.observeStep);
    } catch (e) {
      if (id !== calSeq.current) return;
      setCalError(e.message || "请求失败");
      setCalResult(null);
    } finally {
      if (id === calSeq.current) setCalLoading(false);
    }
  };

  // 确认：按响应回显的冻结坐标写回编辑器（markEdited 会清空校准结果）。
  const confirmCalibration = () => {
    if (!calResult || calResult.value == null) return;
    const { r, c } = calResult.adjustCell;
    onCellChange(r, c, String(calResult.value));
  };

  const cancelCalibration = () => {
    calSeq.current += 1;
    setCalResult(null);
    setCalError(null);
    setCalLoading(false);
  };

  // 播放：到最后一帧自动停止。
  useEffect(() => {
    if (!playing || !result || stale) return;
    const timer = setInterval(() => {
      setFrame((f) => {
        if (f + 1 >= result.frames.length) {
          setPlaying(false);
          return f;
        }
        return f + 1;
      });
    }, speed);
    return () => clearInterval(timer);
  }, [playing, speed, result, stale]);

  const seek = (f) => {
    setPlaying(false);
    setFrame(f);
  };

  const play = () => {
    if (!result || stale) return;
    if (frame >= result.frames.length - 1) setFrame(0);
    setPlaying(true);
  };

  return (
    <div className="app">
      <header>
        <h1>薄板热扩散模拟</h1>
        <p className="subtitle">
          服务端以精确有理数计算全部帧；编辑任何输入后旧结果与在途响应立即作废。
        </p>
      </header>

      <main>
        <section className="panel editor-panel">
          <h2>初始设置</h2>
          <div className="controls-row">
            <label>
              行数
              <select
                data-testid="rows-select"
                value={rows}
                onChange={(e) => resize(Number(e.target.value), cols)}
              >
                {Array.from({ length: MAX_DIM - MIN_DIM + 1 }, (_, i) => MIN_DIM + i).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              列数
              <select
                data-testid="cols-select"
                value={cols}
                onChange={(e) => resize(rows, Number(e.target.value))}
              >
                {Array.from({ length: MAX_DIM - MIN_DIM + 1 }, (_, i) => MIN_DIM + i).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              时间步
              <input
                data-testid="steps-input"
                type="number"
                min={1}
                max={25}
                value={steps}
                onChange={(e) => {
                  setSteps(Number(e.target.value));
                  markEdited();
                }}
              />
            </label>
            <label>
              边界
              <select
                data-testid="boundary-select"
                value={boundary}
                onChange={(e) => {
                  setBoundary(e.target.value);
                  markEdited();
                }}
              >
                <option value="insulated">insulated（绝热）</option>
                <option value="fixed-zero">fixed-zero（零温环境）</option>
              </select>
            </label>
          </div>

          <p className="hint">点击格子之间的缝隙可阻断/恢复该条边（当前 {blocked.size}/30 条）。</p>
          <GridEditor
            rows={rows}
            cols={cols}
            grid={grid}
            blocked={blocked}
            onCellChange={onCellChange}
            onToggleEdge={onToggleEdge}
          />

          <div className="controls-row">
            <button data-testid="run-button" className="primary" onClick={run} disabled={loading}>
              {loading ? "计算中…" : "运行模拟"}
            </button>
            <button
              data-testid="clear-blocked"
              onClick={() => {
                setBlocked(new Set());
                markEdited();
              }}
            >
              清空阻断
            </button>
            <button
              data-testid="reset-grid"
              onClick={() => {
                setGrid(defaultGrid(rows, cols));
                markEdited();
              }}
            >
              重置初温
            </button>
          </div>
          {error && (
            <div className="banner error" data-testid="error-banner">
              {error}
            </div>
          )}
        </section>

        <section className="panel result-panel">
          <h2>结果</h2>
          {!result && <p className="hint">设置初温、阻断边与边界模式后点击“运行模拟”。</p>}
          {result && stale && (
            <div className="banner stale" data-testid="stale-banner">
              输入已修改，以下结果已过期，请重新运行。
            </div>
          )}
          {result && (
            <div className={stale ? "result stale-result" : "result"}>
              <PlaybackControls
                frame={frame}
                steps={result.steps}
                playing={playing}
                speed={speed}
                onPlay={play}
                onPause={() => setPlaying(false)}
                onSeek={seek}
                onSpeedChange={setSpeed}
              />
              <Heatmap
                frames={result.frames}
                frameIdx={frame}
                blocked={new Set(result.blockedEdges.map((e) => edgeKey(e.r1, e.c1, e.r2, e.c2)))}
                selected={selected}
                onToggleCell={onToggleCell}
              />
              <div className="stats">
                <div>
                  当前帧总温：
                  <span data-testid="total-temp" data-exact={result.totalTemperature[frame]}>
                    {formatRational(result.totalTemperature[frame], 4)}
                  </span>
                  {result.boundary === "insulated" && <em>（绝热，总温守恒）</em>}
                </div>
                <div className="flux-row">
                  每步边界净流量：
                  {result.boundaryFlux.map((f, i) => (
                    <span
                      key={i}
                      data-testid={`flux-${i}`}
                      data-exact={f}
                      className={i === frame - 1 ? "flux-chip current" : "flux-chip"}
                      title={f}
                    >
                      {formatRational(f, 3)}
                    </span>
                  ))}
                </div>
              </div>
              <CurveChart frames={result.frames} selected={selected} currentFrame={frame} />
            </div>
          )}
        </section>

        <CalibrationPanel
          rows={rows}
          cols={cols}
          steps={steps}
          loading={calLoading}
          error={calError}
          result={calResult}
          frame={calFrame}
          onFrameChange={setCalFrame}
          onRun={runCalibration}
          onConfirm={confirmCalibration}
          onCancel={cancelCalibration}
        />
      </main>
    </div>
  );
}
