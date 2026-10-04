import { edgeKey, formatRational, parseRational, subRational } from "../rational.js";

function divergingColor(v, maxAbs) {
  // 以 0 为白、正负向红/蓝发散的色标；三种视图共用同一标尺。
  if (maxAbs === 0) return "rgb(255,255,255)";
  const t = Math.max(-1, Math.min(1, v / maxAbs));
  if (t === 0) return "rgb(255,255,255)";
  const mag = Math.min(1, Math.abs(t));
  if (t > 0) {
    return `rgb(${255},${Math.round(255 - 217 * mag)},${Math.round(255 - 217 * mag)})`;
  }
  return `rgb(${Math.round(255 - 217 * mag)},${Math.round(255 - 217 * mag)},255)`;
}

// 逆向校准对比热图：同一冻结基线下并列展示 基线 / 候选 / 精确差值。
// 所有视图共用同一固定色标，逐格 data-exact 暴露精确有理数值。
export default function CompareHeatmap({
  baselineFrames,
  candidateFrames,
  frameIdx,
  rows,
  cols,
  blocked,
  adjust,
  observe,
  mode,
  onPickCell,
}) {
  const values = [];
  for (const frames of [baselineFrames, candidateFrames]) {
    for (const frame of frames) {
      for (const row of frame) for (const s of row) values.push(parseRational(s));
    }
  }
  for (let i = 0; i < baselineFrames.length; i++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        values.push(parseRational(subRational(candidateFrames[i][r][c], baselineFrames[i][r][c])));
      }
    }
  }
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 0);

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let exact;
      if (mode === "baseline") exact = baselineFrames[frameIdx][r][c];
      else if (mode === "candidate") exact = candidateFrames[frameIdx][r][c];
      else exact = subRational(candidateFrames[frameIdx][r][c], baselineFrames[frameIdx][r][c]);
      const v = parseRational(exact);
      const classes = ["heat-cell"];
      if (c + 1 < cols && blocked.has(edgeKey(r, c, r, c + 1))) classes.push("blk-r");
      if (r + 1 < rows && blocked.has(edgeKey(r, c, r + 1, c))) classes.push("blk-b");
      if (c > 0 && blocked.has(edgeKey(r, c, r, c - 1))) classes.push("blk-l");
      if (r > 0 && blocked.has(edgeKey(r, c, r - 1, c))) classes.push("blk-t");
      if (adjust.r === r && adjust.c === c) classes.push("adjust-cell");
      if (observe.r === r && observe.c === c) classes.push("observe-cell");
      cells.push(
        <div
          key={`${r}-${c}`}
          data-testid={`cal-heat-cell-${r}-${c}`}
          data-exact={exact}
          className={classes.join(" ")}
          style={{
            background: divergingColor(v, maxAbs),
            color: Math.abs(v) > maxAbs * 0.55 ? "#fff" : "#1a1a1a",
          }}
          title={`(${r},${c}) = ${exact}`}
          onClick={() => onPickCell && onPickCell(r, c)}
        >
          {formatRational(exact)}
        </div>
      );
    }
  }
  return (
    <div
      className="heatmap compare-heatmap"
      data-testid="cal-heatmap"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(34px, 1fr))` }}
    >
      {cells}
    </div>
  );
}
