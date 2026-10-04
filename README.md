# 薄板热扩散模拟

React 网格编辑器 + Flask 模拟服务。服务端用**精确有理数**一次性算完全部帧，
页面只负责播放，避免“前端逐帧临时计算导致边界格丢热、切换边界条件后播放旧帧”的问题。

## 物理模型

- 网格 3~12 行 × 3~12 列，初温为 -100~100 的整数。
- 每一步，对每条**未阻断内部边** (u, v)：把温差的 1/4 从高温格转向低温格
  （u 失去 `(T_u - T_v)/4`，v 得到等量）。
- 边界模式：
  - `insulated`：外边不与外界交换，**总温守恒**；
  - `fixed-zero`：每条外边与零温环境交换同样的 1/4，流出量计入该步边界净流量。
- 所有更新**同步**进行（先算完全部增量再一次应用），不边算边改邻格。
- 阻断边（至多 30 条）只作用于相邻格之间的内部边。

## 目录结构

```
plate-api/        Flask 服务（精确有理数模拟）
  simulation.py   核心模拟（fractions.Fraction）
  calibration.py  单格逆向校准（仿射精确求解）
  validation.py   请求校验
  tests/          pytest：手算用例 + 守恒性质 + 独立逐格通量模型对拍 + API 校验
plate-ui/         React + Vite 前端（nginx 伺服，/api 反代到 plate-api）
e2e/              Playwright 浏览器主流程测试
docker-compose.yml
```

## 运行（Docker Compose）

```bash
docker compose up --build
# 前端 http://localhost:8080 （/api 由 nginx 代理到 plate-api:5000）
# 后端 http://localhost:5000/api/health
```

## 本地开发

```bash
# 后端
cd plate-api
pip install -r requirements-dev.txt
python app.py            # http://localhost:5000

# 前端（dev server 与 preview 都会把 /api 代理到 localhost:5000）
cd plate-ui
npm ci
npm run dev              # http://localhost:5173
```

## 测试

```bash
# 单元 / 对拍测试（134 个）
cd plate-api && python -m pytest

# 浏览器主流程（需先启动服务：docker compose up，或本地 flask + npm run preview）
cd e2e
npm ci && npx playwright install chromium
npm test                 # 默认打 http://localhost:8080，可用 UI_URL 覆盖
```

## API

### `POST /api/simulate`

```json
{
  "grid": [[0, 0, 0], [0, 16, 0], [0, 0, 0]],
  "blockedEdges": [{"r1": 1, "c1": 1, "r2": 1, "c2": 2}],
  "steps": 3,
  "boundary": "fixed-zero"
}
```

- `grid`：3~12 × 3~12，整数 -100~100（必填）
- `blockedEdges`：至多 30 条相邻格之间的边，不可重复（可选，默认空）
- `steps`：1~25（必填）
- `boundary`：`insulated` | `fixed-zero`（必填）

响应（所有温度/流量都是精确有理数字符串，如 `"7/4"`、`"-3"`）：

```json
{
  "rows": 3, "cols": 3, "steps": 3, "boundary": "fixed-zero",
  "blockedEdges": [{"r1": 1, "c1": 1, "r2": 1, "c2": 2}],  // 规范化回显
  "frames": [[[...]], ...],           // steps+1 帧
  "boundaryFlux": ["0", "4", ...],    // 每步边界净流量，长度 steps
  "totalTemperature": ["16", ...]     // 每帧总温，长度 steps+1
}
```

非法输入返回 `400 {"error": "..."}`。

### `POST /api/calibrate`

单格逆向校准：冻结网格、阻断边、边界模式与步数，反求可调格初温，
使观测格在指定步达到有理数目标温度。

```json
{
  "grid": [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
  "blockedEdges": [],
  "steps": 3,
  "boundary": "insulated",
  "adjustCell": {"r": 0, "c": 0},
  "observeCell": {"r": 0, "c": 1},
  "observeStep": 1,
  "target": "5"
}
```

- `adjustCell` / `observeCell`：网格内的 `{r, c}`（必填）
- `observeStep`：观测帧号，0~steps（必填）
- `target`：JSON 整数或 `"p/q"` 形式字符串（必填；浮点数一律拒绝，保证精确）

求解原理：模型关于初温是线性的，观测温度是可调格初温 x 的精确仿射函数
`T(x) = a·x + b`；服务端用两次精确模拟确定 a、b，再在有理数上求解，
在 -100~100 的整数范围内给出结论，不做浮点试探。

响应：

```json
{
  "status": "exact",               // exact | closest | all | unreachable
  "value": 20,                     // 求解初温；unreachable 时为 null
  "observed": "5",                 // 取 value 时观测格在 observeStep 的精确温度
  "residual": "0",                 // 精确残差 observed - target
  "slope": "1/4",                  // 仿射斜率 a（0 表示可调格对观测格无影响）
  "target": "5",
  "adjustCell": {"r": 0, "c": 0},
  "observeCell": {"r": 0, "c": 1},
  "observeStep": 1,
  "baseline": { ... },             // 当前初温下的完整模拟（同 /api/simulate 响应）
  "candidate": { ... }             // 取 value 后的完整模拟；unreachable 时为 null
}
```

- `exact`：范围内唯一精确命中值。
- `closest`：无精确解，返回误差最小的合法值与精确残差；误差并列时取较小初温。
- `all`：可调格对观测格无影响且观测值恒等于目标——所有合法初温都命中，
  `value` 回显当前初温（无需修改）。
- `unreachable`：可调格对观测格无影响且观测值不等于目标——任何值都无法命中。

非法输入返回 `400 {"error": "..."}`。

## 前端要点

- 编辑任何输入（初温、阻断边、步数、边界、尺寸）都会使请求序号 +1：
  在途响应返回时序号不匹配即被丢弃，旧结果置灰并提示“已过期”，播放停止。
- 热图色标固定为全部帧的最小/最大值，动画帧之间可比；阻断边以加粗黑边显示。
- 点击热图格子可切换该格温度曲线（SVG 折线图，虚线光标指示当前帧）。
- 单格逆向校准：指定可调格、观测格、观测步与目标温度后由服务端精确求解；
  结果页以同一冻结基线并排展示候选与原模拟的帧（差异格虚线标出）和观测格曲线
  （实线原模拟、虚线候选、红色点线目标）。只有点击“采用该初温”才写回编辑器；
  取消或编辑任何输入都会丢弃校准结果，编辑期间到达的旧校准响应同样失效。
