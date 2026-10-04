import { expect, test } from "@playwright/test";

// 单格逆向校准：确认、取消、迟到响应废弃。
// 3x3 中心 16，绝热 1 步，无阻断：
//   T(0,1) = 4 + x/4   （x 为 (0,0) 初温）
// 目标 2 ⇒ x = -8。

const GRID = [
  [0, 0, 0],
  [0, 16, 0],
  [0, 0, 0],
];
const STEPS = 1;
const BOUNDARY = "insulated";

async function setupGrid(page) {
  await page.goto("/");
  await page.getByTestId("rows-select").selectOption("3");
  await page.getByTestId("cols-select").selectOption("3");
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      await page.getByTestId(`cell-input-${r}-${c}`).fill(String(GRID[r][c]));
    }
  }
  await page.getByTestId("steps-input").fill(String(STEPS));
  await page.getByTestId("boundary-select").selectOption(BOUNDARY);
}

async function openDialog(page) {
  await page.getByTestId("calibrate-button").click();
  await expect(page.getByTestId("calibration-dialog")).toBeVisible();
}

test("校准确认：精确命中写回初温，候选/基线帧与差值同基线展示", async ({
  page,
  request,
  baseURL,
}) => {
  const expected = await (
    await request.post(`${baseURL}/api/calibrate`, {
      data: {
        grid: GRID,
        blockedEdges: [],
        steps: STEPS,
        boundary: BOUNDARY,
        adjust: { r: 0, c: 0 },
        observe: { r: 0, c: 1 },
        target: "2",
      },
    })
  ).json();
  expect(expected.status).toBe("exact");
  expect(expected.candidateValue).toBe(-8);

  await setupGrid(page);
  await openDialog(page);

  // 冻结基线回显
  await expect(page.getByTestId("cal-frozen")).toContainText("3 行 × 3 列");
  await expect(page.getByTestId("cal-frozen")).toContainText("1 步");

  // 默认参数与目标
  await expect(page.getByTestId("cal-adjust-r")).toHaveValue("0");
  await expect(page.getByTestId("cal-adjust-c")).toHaveValue("0");
  await expect(page.getByTestId("cal-observe-r")).toHaveValue("1");
  await page.getByTestId("cal-observe-r").selectOption("0");
  await page.getByTestId("cal-target-input").fill("2");

  await expect(page.getByTestId("cal-status")).toContainText("精确命中");
  await expect(page.getByTestId("cal-candidate-value")).toHaveText("-8");
  await expect(page.getByTestId("cal-residual")).toHaveText("0");
  await expect(page.getByTestId("cal-residual")).toHaveAttribute("data-exact", "0");
  await expect(page.getByTestId("cal-observed")).toHaveText("2");

  // 候选末帧逐格与服务响应一致
  await page.getByTestId("cal-frame-slider").fill(String(STEPS));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      await expect(page.getByTestId(`cal-heat-cell-${r}-${c}`)).toHaveAttribute(
        "data-exact",
        expected.candidate.frames[STEPS][r][c]
      );
    }
  }

  // 基线视图：与冻结网格的原模拟一致
  await page.getByTestId("cal-view-baseline").click();
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      await expect(page.getByTestId(`cal-heat-cell-${r}-${c}`)).toHaveAttribute(
        "data-exact",
        expected.baseline.frames[STEPS][r][c]
      );
    }
  }

  // 差值视图：观测格 (0,1) 差为候选 2 − 基线 4 = -2（精确有理数字符串）
  await page.getByTestId("cal-view-diff").click();
  await expect(page.getByTestId("cal-heat-cell-0-1")).toHaveAttribute(
    "data-exact",
    "-2/1"
  );

  // 确认后写回编辑器，对话框关闭；未自动重跑，结果区仍是原模拟占位提示
  await page.getByTestId("cal-view-candidate").click();
  await page.getByTestId("cal-confirm").click();
  await expect(page.getByTestId("calibration-dialog")).toHaveCount(0);
  await expect(page.getByTestId("cell-input-0-0")).toHaveValue("-8");
  // 写回只是编辑，不会自动发起模拟；运行后才得到候选初温的结果
  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("frame-indicator")).toHaveText(`帧 0/${STEPS}`);
  await page.getByTestId("frame-slider").fill(String(STEPS));
  await expect(page.getByTestId("heat-cell-0-1")).toHaveAttribute(
    "data-exact",
    expected.candidate.frames[STEPS][0][1]
  );
});

test("校准取消：不写回编辑器，不影响已有模拟", async ({ page }) => {
  await setupGrid(page);
  // 先跑一次原模拟
  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("frame-indicator")).toHaveText(`帧 0/${STEPS}`);
  const before = await page.getByTestId("heat-cell-0-1").getAttribute("data-exact");

  await openDialog(page);
  await page.getByTestId("cal-observe-r").selectOption("0");
  await page.getByTestId("cal-target-input").fill("2");
  await expect(page.getByTestId("cal-candidate-value")).toHaveText("-8");

  await page.getByTestId("cal-cancel").click();
  await expect(page.getByTestId("calibration-dialog")).toHaveCount(0);
  await expect(page.getByTestId("cell-input-0-0")).toHaveValue("0");
  // 原模拟未被改写
  await expect(page.getByTestId("stale-banner")).toHaveCount(0);
  await expect(page.getByTestId("heat-cell-0-1")).toHaveAttribute("data-exact", before);

  // 右上角 × 同样只是关闭
  await page.getByTestId("calibrate-button").click();
  await page.getByTestId("cal-close").click();
  await expect(page.getByTestId("calibration-dialog")).toHaveCount(0);
});

test("迟到的校准响应被丢弃，最终展示最新参数的结论", async ({ page, baseURL }) => {
  await setupGrid(page);

  // 目标 6（x=8）的第一发请求挂起；目标 2（x=-8）的第二发立即放行。
  // 之后再放行第一发：迟到响应不得覆盖最新结论。
  let releaseSlow;
  const slowGate = new Promise((res) => {
    releaseSlow = res;
  });
  await page.route("**/api/calibrate", async (route) => {
    const body = route.request().postDataJSON();
    if (body && body.target === "6") {
      await slowGate;
    }
    await route.continue();
  });

  await openDialog(page);
  await page.getByTestId("cal-observe-r").selectOption("0");
  await page.getByTestId("cal-target-input").fill("6"); // x = 8
  await expect(page.getByTestId("cal-loading")).toBeVisible();

  // 改为目标 2（x = -8），第二发立即放行
  await page.getByTestId("cal-target-input").fill("2");
  await expect(page.getByTestId("cal-candidate-value")).toHaveText("-8", {
    timeout: 5000,
  });

  // 放行迟到的第一发（目标 6，x=8），结论仍必须是最新的 -8
  releaseSlow();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("cal-candidate-value")).toHaveText("-8");
  await expect(page.getByTestId("cal-target-input")).toHaveValue("2");
  await expect(page.getByTestId("cal-status")).toContainText("精确命中");

  await page.unroute("**/api/calibrate");
});

test("可调格无影响时区分“所有值都命中”与“无值可命中”；非法目标不发请求", async ({
  page,
}) => {
  await setupGrid(page);
  // 阻断角格 (0,0) 的全部两条内部边 ⇒ 与 (0,1) 完全隔离
  await page.getByTestId("edge-0-0-0-1").click();
  await page.getByTestId("edge-0-0-1-0").click();

  await openDialog(page);
  await page.getByTestId("cal-observe-r").selectOption("0"); // 观测格 (0,1)

  // 一步绝热下 (0,1) 恒为 4：目标 4 ⇒ 所有合法初温都命中
  await page.getByTestId("cal-target-input").fill("4");
  await expect(page.getByTestId("cal-status")).toContainText("所有合法初温都命中");
  await expect(page.getByTestId("cal-candidate-value")).toHaveText("0");
  await expect(page.getByTestId("cal-confirm")).toBeEnabled();

  // 目标 5 ⇒ 无值可命中，残差为常数 −1，确认按钮禁用
  await page.getByTestId("cal-target-input").fill("5");
  await expect(page.getByTestId("cal-status")).toContainText("无任何合法初温可命中");
  await expect(page.getByTestId("cal-candidate-value")).toHaveText("-100");
  await expect(page.getByTestId("cal-residual")).toHaveText("-1");
  await expect(page.getByTestId("cal-confirm")).toBeDisabled();

  // 非法有理数只给前端提示，不出现结果区
  await page.getByTestId("cal-target-input").fill("abc");
  await expect(page.getByTestId("cal-target-invalid")).toBeVisible();
  await expect(page.getByTestId("cal-result")).toHaveCount(0);

  // 取消后编辑器不被改动（仍是阻断两条边、初温全 0）
  await page.getByTestId("cal-cancel").click();
  await expect(page.getByTestId("cell-input-0-0")).toHaveValue("0");
});
