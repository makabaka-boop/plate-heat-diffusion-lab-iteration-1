# 薄板热扩散模拟

React 网格编辑器 + Flask 模拟服务。服务端用**精确有理数**一次性算完全部帧，
页面只负责播放，避免“前端逐帧临时计算导致边界格丢热、切换边界条件后播放旧帧”的问题。

此外提供**单格逆向校准**：冻结当前网格/阻断边/边界/步数后，反求某个可调初温格的
合法整数初温，使指定观测格在末帧命中有理数目标；结论同样由服务端用精确有理数给出，
页面对比候选与原模拟的帧/曲线差异，只有用户确认才写回编辑器。

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
  calibration.py  单格逆向校准（线性反求 + 最近合法整数，精确有理数）
  validation.py   请求校验
  tests/          pytest：手算用例 + 守恒性质 + 独立逐格通量模型对拍 +
                  合法初温逐一枚举对拍校准 + API 校验
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
# 单元 / 对拍测试
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

单格逆向校准。网格、阻断边、步数、边界与 `/api/simulate` 同规则（同一套冻结基线、
同一套同步通量/边界交换模型），另需指定可调格、观测格与有理数目标：

```json
{
  "grid": [[0, 0, 0], [0, 16, 0], [0, 0, 0]],
  "blockedEdges": [],
  "steps": 1,
  "boundary": "insulated",
  "adjust": {"r": 0, "c": 0},
  "observe": {"r": 0, "c": 1},
  "target": "33/8"
}
```

- `target`：精确有理数，整数或 `"p/q"` 字符串（也接受 `"0.25"`，内部转为精确分数）。
- 观测温度在冻结步数对应的末帧采样。

模型对初温线性：`T_obs(x) = a·x + b`，服务端用两次精确模拟求出 `a = T(1)−T(0)`、
`b = T(0)`，再在 **-100～100 整数**范围内反求。响应：

```json
{
  "status": "nearest",
  "adjust": {"r": 0, "c": 0},
  "observe": {"r": 0, "c": 1, "step": 1},
  "originalValue": 0,
  "candidateValue": 0,
  "target": "33/8",
  "observed": "4",
  "residual": "-1/8",
  "absError": "1/8",
  "slope": "1/4",
  "intercept": "4",
  "baseline":  { "...完整 simulate 响应（可调格置 0）" },
  "candidate": { "...完整 simulate 响应（应用 candidateValue）" }
}
```

`status` 四种结论（均为精确有理数推导，不做前端浮点试探）：

- `exact`：`a≠0` 且唯一解是范围内整数，`residual = 0`；
- `nearest`：无精确解，`candidateValue` 为范围内 `|残差|` 最小的合法整数，
  等距时取较小初温，并给出精确 `residual` / `absError`；
- `all`：`a=0`（可调格被阻断边等完全隔离，对观测格无影响）且常数温度等于目标，
  **所有合法值都命中**，候选保持当前初温不改写；
- `none`：`a=0` 且常数不等于目标，**无值可命中**，候选统一为 `-100`，
  残差为常数偏差（前端禁用确认）。

`baseline` 与 `candidate` 各含一整套 `frames / boundaryFlux / totalTemperature`，
供页面在同一冻结基线上对比候选与原模拟的帧和曲线差异。

## 前端要点

- 编辑任何输入（初温、阻断边、步数、边界、尺寸）都会使请求序号 +1：
  在途响应返回时序号不匹配即被丢弃，旧结果置灰并提示“已过期”，播放停止。
- 热图色标固定为全部帧的最小/最大值，动画帧之间可比；阻断边以加粗黑边显示。
- 点击热图格子可切换该格温度曲线（SVG 折线图，虚线光标指示当前帧）。
- “单格逆向校准”打开时冻结当前网格/阻断边/边界/步数为不可变快照；对话框使用
  独立请求序号，参数变动自动防抖重算，迟到响应一律丢弃。候选帧、原模拟帧与逐帧
  差值（精确有理数减法）共用同一色标，并叠加可调格/观测格曲线与目标标记。
- 只有点击“采用”才把候选初温写回单个格子（与普通编辑一致：旧结果置过期，不会
  自动重跑）；取消/失败/迟到响应都不改写已有模拟与编辑器。
