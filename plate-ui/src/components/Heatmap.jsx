import { edgeKey, formatRational, parseRational } from "../rational.js";

function colorFor(v, min, max) {
  if (max <= min) return "rgb(255,255,255)";
  const t = (v - min) / (max - min);
  let r, g, b;
  if (t < 0.5) {
    const u = t / 0.5;
    r = 37 + (255 - 37) * u;
    g = 99 + (255 - 99) * u;
    b = 235 + (255 - 235) * u;
  } else {
    const u = (t - 0.5) / 0.5;
    r = 255 - (255 - 220) * u;
    g = 255 - (255 - 38) * u;
    b = 255 - (255 - 38) * u;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// 热图：颜色标尺固定为全部帧的最小/最大值，保证动画帧之间可比。
// name 用于区分多个热图的 testid；highlight 是需要标出差异的格子集合。
export default function Heatmap({ frames, frameIdx, blocked, selected, onToggleCell, highlight, name }) {
  const rows = frames[0].length;
  const cols = frames[0][0].length;
  let min = Infinity;
  let max = -Infinity;
  for (const frame of frames) {
    for (const row of frame) {
      for (const s of row) {
        const v = parseRational(s);
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }

  const frame = frames[frameIdx];
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const exact = frame[r][c];
      const v = parseRational(exact);
      const t = max > min ? (v - min) / (max - min) : 0.5;
      const classes = ["heat-cell"];
      if (c + 1 < cols && blocked.has(edgeKey(r, c, r, c + 1))) classes.push("blk-r");
      if (r + 1 < rows && blocked.has(edgeKey(r, c, r + 1, c))) classes.push("blk-b");
      if (c > 0 && blocked.has(edgeKey(r, c, r, c - 1))) classes.push("blk-l");
      if (r > 0 && blocked.has(edgeKey(r, c, r - 1, c))) classes.push("blk-t");
      if (selected.has(`${r},${c}`)) classes.push("picked");
      if (highlight && highlight.has(`${r},${c}`)) classes.push("diff");
      cells.push(
        <div
          key={`${r}-${c}`}
          data-testid={name ? `${name}-cell-${r}-${c}` : `heat-cell-${r}-${c}`}
          data-exact={exact}
          className={classes.join(" ")}
          style={{
            background: colorFor(v, min, max),
            color: t < 0.22 || t > 0.78 ? "#fff" : "#1a1a1a",
          }}
          title={`(${r},${c}) = ${exact}`}
          onClick={onToggleCell ? () => onToggleCell(r, c) : undefined}
        >
          {formatRational(exact)}
        </div>
      );
    }
  }
  return (
    <div
      className="heatmap"
      data-testid={name ? `${name}-heatmap` : "heatmap"}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(44px, 1fr))` }}
    >
      {cells}
    </div>
  );
}
