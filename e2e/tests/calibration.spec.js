import { expect, test } from "@playwright/test";

// 单格逆向校准：确认写回编辑器、取消不动编辑器、编辑期间到达的旧响应失效。
//
// 用例：3x3 全 0，可调格 (0,0)，观测格 (0,1)，第 1 步观测值 = x/4，
// 目标 5 → 精确命中 x = 20。

const CAL_PAYLOAD = {
  grid: [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
  blockedEdges: [],
  steps: 3,
  boundary: "insulated",
  adjustCell: { r: 0, c: 0 },
  observeCell: { r: 0, c: 1 },
  observeStep: 1,
  target: "5",
};

async function setupGrid(page) {
  await page.goto("/");
  await page.getByTestId("rows-select").selectOption("3");
  await page.getByTestId("cols-select").selectOption("3");
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      await page.getByTestId(`cell-input-${r}-${c}`).fill("0");
    }
  }
  await page.getByTestId("steps-input").fill("3");
  await page.getByTestId("boundary-select").selectOption("insulated");
}

async function runCalibration(page) {
  await page.getByTestId("cal-adjust-row").selectOption("0");
  await page.getByTestId("cal-adjust-col").selectOption("0");
  await page.getByTestId("cal-obs-row").selectOption("0");
  await page.getByTestId("cal-obs-col").selectOption("1");
  await page.getByTestId("cal-step-input").fill("1");
  await page.getByTestId("cal-target-input").fill("5");
  await page.getByTestId("cal-run-button").click();
  await expect(page.getByTestId("cal-result")).toBeVisible();
}

test("校准确认后才写回编辑器", async ({ page, request, baseURL }) => {
  const resp = await request.post(`${baseURL}/api/calibrate`, { data: CAL_PAYLOAD });
  expect(resp.ok()).toBeTruthy();
  const expected = await resp.json();
  expect(expected.status).toBe("exact");
  expect(expected.value).toBe(20);

  await setupGrid(page);
  // 先跑一次原模拟，确认校准不会改写它
  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("frame-indicator")).toHaveText("帧 0/3");

  await runCalibration(page);

  // 状态与精确值
  await expect(page.getByTestId("cal-status")).toHaveAttribute("data-status", "exact");
  await expect(page.getByTestId("cal-value")).toHaveText("20");
  await expect(page.getByTestId("cal-residual")).toHaveAttribute("data-exact", "0");

  // 同一冻结基线上的候选 vs 原模拟：观测格第 1 帧 0 → 5
  await expect(page.getByTestId("cal-frame-indicator")).toHaveText("帧 1/3");
  await expect(page.getByTestId("cal-obs-baseline")).toHaveAttribute("data-exact", "0");
  await expect(page.getByTestId("cal-obs-candidate")).toHaveAttribute("data-exact", "5");

  // 候选热图逐格与服务端候选帧一致；差异格被标出
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      await expect(page.getByTestId(`cal-cand-cell-${r}-${c}`)).toHaveAttribute(
        "data-exact",
        expected.candidate.frames[1][r][c]
      );
      await expect(page.getByTestId(`cal-base-cell-${r}-${c}`)).toHaveAttribute(
        "data-exact",
        expected.baseline.frames[1][r][c]
      );
    }
  }
  await expect(page.getByTestId("cal-cand-cell-0-1")).toHaveClass(/diff/);
  await expect(page.getByTestId("cal-cand-cell-1-1")).not.toHaveClass(/diff/);

  // 曲线：观测格的原/候选双线与目标线
  // （SVG 水平线/平直折线包围盒高度为 0，Playwright 视为 hidden，故用计数断言）
  await expect(page.getByTestId("curve-0-1")).toHaveCount(1);
  await expect(page.getByTestId("curve-cmp-0-1")).toBeVisible();
  await expect(page.getByTestId("target-line")).toHaveCount(1);

  // 确认前编辑器与主模拟都未受影响
  await expect(page.getByTestId("cell-input-0-0")).toHaveValue("0");
  await expect(page.getByTestId("stale-banner")).toHaveCount(0);

  // 确认：写回可调格初温，校准视图关闭，主模拟按编辑规则标记过期
  await page.getByTestId("cal-confirm").click();
  await expect(page.getByTestId("cell-input-0-0")).toHaveValue("20");
  await expect(page.getByTestId("cal-result")).toHaveCount(0);
  await expect(page.getByTestId("stale-banner")).toBeVisible();
});

test("取消校准不改写编辑器与已有模拟", async ({ page }) => {
  await setupGrid(page);
  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("frame-indicator")).toHaveText("帧 0/3");

  await runCalibration(page);
  await expect(page.getByTestId("cal-compare")).toBeVisible();

  await page.getByTestId("cal-cancel").click();
  await expect(page.getByTestId("cal-result")).toHaveCount(0);
  // 编辑器初温未变，主模拟结果也未被标为过期
  await expect(page.getByTestId("cell-input-0-0")).toHaveValue("0");
  await expect(page.getByTestId("stale-banner")).toHaveCount(0);
  await expect(page.getByTestId("frame-indicator")).toHaveText("帧 0/3");
});

test("编辑期间到达的旧校准响应被丢弃", async ({ page }) => {
  await setupGrid(page);

  // 拦住校准请求，等测试放行
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/calibrate", async (route) => {
    await gate;
    await route.continue();
  });

  await page.getByTestId("cal-adjust-row").selectOption("0");
  await page.getByTestId("cal-adjust-col").selectOption("0");
  await page.getByTestId("cal-obs-row").selectOption("0");
  await page.getByTestId("cal-obs-col").selectOption("1");
  await page.getByTestId("cal-step-input").fill("1");
  await page.getByTestId("cal-target-input").fill("5");

  const responsePromise = page.waitForResponse("**/api/calibrate");
  await page.getByTestId("cal-run-button").click();

  // 响应未返回时编辑网格 → 在途响应失效
  await page.getByTestId("cell-input-2-2").fill("3");
  release();
  await responsePromise;

  // 迟到的响应被丢弃：不出现校准结果，也不报校准错误
  await expect(page.getByTestId("cal-result")).toHaveCount(0);
  await expect(page.getByTestId("cal-error")).toHaveCount(0);
  await expect(page.getByTestId("cal-run-button")).toBeEnabled();

  // 重新求解仍可用（(2,2)=3 不影响观测格第 1 步，仍精确命中 20）
  await page.unroute("**/api/calibrate");
  await page.getByTestId("cal-run-button").click();
  await expect(page.getByTestId("cal-result")).toBeVisible();
  await expect(page.getByTestId("cal-status")).toHaveAttribute("data-status", "exact");
  await expect(page.getByTestId("cal-value")).toHaveText("20");
});

test("无精确解与无法命中的状态展示", async ({ page }) => {
  await setupGrid(page);

  // 目标 1/8：x* = 1/2，0 与 1 并列，取较小值 0，残差 -1/8
  await page.getByTestId("cal-adjust-row").selectOption("0");
  await page.getByTestId("cal-adjust-col").selectOption("0");
  await page.getByTestId("cal-obs-row").selectOption("0");
  await page.getByTestId("cal-obs-col").selectOption("1");
  await page.getByTestId("cal-step-input").fill("1");
  await page.getByTestId("cal-target-input").fill("1/8");
  await page.getByTestId("cal-run-button").click();
  await expect(page.getByTestId("cal-status")).toHaveAttribute("data-status", "closest");
  await expect(page.getByTestId("cal-value")).toHaveText("0");
  await expect(page.getByTestId("cal-residual")).toHaveAttribute("data-exact", "-1/8");

  // 观测步 0 且观测格不是可调格：可调格无影响，目标 5 ≠ 初温 0 → 无法命中，无确认按钮
  await page.getByTestId("cal-obs-row").selectOption("1");
  await page.getByTestId("cal-obs-col").selectOption("1");
  await page.getByTestId("cal-step-input").fill("0");
  await page.getByTestId("cal-target-input").fill("5");
  await page.getByTestId("cal-run-button").click();
  await expect(page.getByTestId("cal-status")).toHaveAttribute("data-status", "unreachable");
  await expect(page.getByTestId("cal-residual")).toHaveAttribute("data-exact", "-5");
  await expect(page.getByTestId("cal-confirm")).toHaveCount(0);
});
