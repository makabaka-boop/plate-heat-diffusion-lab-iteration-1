import { expect, test } from "@playwright/test";

// 主流程：编辑 → 阻断边 → 运行 → 画面与服务端帧逐一核对 → 播放 → 曲线 → 过期废弃。

const GRID = [
  [0, 0, 0],
  [0, 16, 0],
  [0, 0, 0],
];
const BLOCKED = [{ r1: 1, c1: 1, r2: 1, c2: 2 }];
const STEPS = 3;
const BOUNDARY = "fixed-zero";

async function fetchExpected(request, baseURL) {
  const resp = await request.post(`${baseURL}/api/simulate`, {
    data: { grid: GRID, blockedEdges: BLOCKED, steps: STEPS, boundary: BOUNDARY },
  });
  expect(resp.ok()).toBeTruthy();
  return resp.json();
}

async function setupAndRun(page) {
  await page.goto("/");
  await page.getByTestId("rows-select").selectOption("3");
  await page.getByTestId("cols-select").selectOption("3");
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      await page.getByTestId(`cell-input-${r}-${c}`).fill(String(GRID[r][c]));
    }
  }
  await page.getByTestId("edge-1-1-1-2").click();
  await expect(page.getByTestId("edge-1-1-1-2")).toHaveClass(/blocked/);
  await page.getByTestId("steps-input").fill(String(STEPS));
  await page.getByTestId("boundary-select").selectOption(BOUNDARY);
  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("frame-indicator")).toHaveText(`帧 0/${STEPS}`);
}

test("主流程：服务帧、阻断边与画面一致", async ({ page, request, baseURL }) => {
  const expected = await fetchExpected(request, baseURL);
  await setupAndRun(page);

  // 阻断边在热图上表现为加粗边框
  await expect(page.getByTestId("heat-cell-1-1")).toHaveClass(/blk-r/);
  await expect(page.getByTestId("heat-cell-1-2")).toHaveClass(/blk-l/);

  // 逐帧核对：画面每个格子的精确有理数与服务响应完全一致
  for (let f = 0; f <= STEPS; f++) {
    await page.getByTestId("frame-slider").fill(String(f));
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        await expect(page.getByTestId(`heat-cell-${r}-${c}`)).toHaveAttribute(
          "data-exact",
          expected.frames[f][r][c]
        );
      }
    }
    await expect(page.getByTestId("total-temp")).toHaveAttribute(
      "data-exact",
      expected.totalTemperature[f]
    );
  }

  // 每步边界净流量与服务一致
  for (let i = 0; i < STEPS; i++) {
    await expect(page.getByTestId(`flux-${i}`)).toHaveAttribute(
      "data-exact",
      expected.boundaryFlux[i]
    );
  }

  // 阻断边确实影响了结果：与无阻断场景的服务帧不同
  const unblocked = await (
    await request.post(`${baseURL}/api/simulate`, {
      data: { grid: GRID, blockedEdges: [], steps: STEPS, boundary: BOUNDARY },
    })
  ).json();
  expect(expected.frames[STEPS]).not.toEqual(unblocked.frames[STEPS]);

  // 单格曲线：点击热图格子出现折线，再点消失
  await page.getByTestId("heat-cell-1-1").click();
  await expect(page.getByTestId("curve-1-1")).toBeVisible();
  await page.getByTestId("heat-cell-0-0").click();
  await expect(page.getByTestId("curve-0-0")).toBeVisible();
  await page.getByTestId("heat-cell-1-1").click();
  await expect(page.getByTestId("curve-1-1")).toHaveCount(0);

  // 播放：帧号随时间前进
  await page.getByTestId("frame-slider").fill("0");
  await page.getByTestId("speed-select").selectOption("150");
  await page.getByTestId("play-button").click();
  await expect(page.getByTestId("frame-indicator")).not.toHaveText(`帧 0/${STEPS}`, {
    timeout: 3000,
  });
});

test("编辑后旧结果标记过期，重新运行恢复", async ({ page }) => {
  await setupAndRun(page);
  await expect(page.getByTestId("stale-banner")).toHaveCount(0);

  // 修改任一输入 → 旧结果立即标记过期且播放被禁止
  await page.getByTestId("cell-input-0-0").fill("5");
  await expect(page.getByTestId("stale-banner")).toBeVisible();
  await expect(page.getByTestId("play-button")).toHaveText("播放");

  // 切换边界模式同样使旧帧作废
  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("stale-banner")).toHaveCount(0);
  await page.getByTestId("boundary-select").selectOption("insulated");
  await expect(page.getByTestId("stale-banner")).toBeVisible();
});

test("非法输入展示错误", async ({ page }) => {
  await setupAndRun(page);
  await page.getByTestId("steps-input").fill("30");
  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("error-banner")).toBeVisible();
  await expect(page.getByTestId("error-banner")).toContainText("steps");
});
