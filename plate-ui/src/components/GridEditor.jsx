import { edgeKey } from "../rational.js";

// 编辑网格：格子是温度输入框，格子之间的缝隙是可点击的阻断边。
export default function GridEditor({ rows, cols, grid, blocked, onCellChange, onToggleEdge }) {
  const cells = [];
  for (let i = 0; i < 2 * rows - 1; i++) {
    for (let j = 0; j < 2 * cols - 1; j++) {
      const r = Math.floor(i / 2);
      const c = Math.floor(j / 2);
      if (i % 2 === 0 && j % 2 === 0) {
        cells.push(
          <input
            key={`cell-${r}-${c}`}
            data-testid={`cell-input-${r}-${c}`}
            className="cell-input"
            type="number"
            min={-100}
            max={100}
            step={1}
            value={grid[r][c]}
            onChange={(e) => onCellChange(r, c, e.target.value)}
          />
        );
      } else if (i % 2 === 0) {
        // 竖直缝隙： (r, c) 与 (r, c+1) 之间的边
        const key = edgeKey(r, c, r, c + 1);
        cells.push(
          <div
            key={`e-${i}-${j}`}
            data-testid={`edge-${r}-${c}-${r}-${c + 1}`}
            className={`edge edge-v${blocked.has(key) ? " blocked" : ""}`}
            title={`边 (${r},${c})-(${r},${c + 1})`}
            onClick={() => onToggleEdge(key)}
          />
        );
      } else if (j % 2 === 0) {
        // 水平缝隙： (r, c) 与 (r+1, c) 之间的边
        const key = edgeKey(r, c, r + 1, c);
        cells.push(
          <div
            key={`e-${i}-${j}`}
            data-testid={`edge-${r}-${c}-${r + 1}-${c}`}
            className={`edge edge-h${blocked.has(key) ? " blocked" : ""}`}
            title={`边 (${r},${c})-(${r + 1},${c})`}
            onClick={() => onToggleEdge(key)}
          />
        );
      } else {
        cells.push(<div key={`x-${i}-${j}`} className="corner" />);
      }
    }
  }
  return (
    <div
      className="editor-grid"
      data-testid="editor-grid"
      style={{
        gridTemplateColumns: Array.from({ length: 2 * cols - 1 }, (_, j) =>
          j % 2 === 0 ? "48px" : "14px"
        ).join(" "),
        gridTemplateRows: Array.from({ length: 2 * rows - 1 }, (_, i) =>
          i % 2 === 0 ? "40px" : "14px"
        ).join(" "),
      }}
    >
      {cells}
    </div>
  );
}
