"""单格逆向校准测试：手算用例 + 逐一枚举合法初温的独立模型对拍 + API 校验。

对拍方式：对小网格把可调格初温 x 从 -100 到 100 全部枚举，
用独立的逐格通量参考模型（tests/reference_model.py）算出每个 x 的观测温度，
由此推出精确命中值 / 误差最小值（并列取较小）/ 全部命中 / 无法命中，
再与被测的 calibrate()（基于 simulation.simulate 的仿射求解）逐一比对。
"""

import random
from fractions import Fraction

import pytest

from app import create_app
from calibration import calibrate
from simulation import FIXED_ZERO, INSULATED, simulate
from tests.reference_model import reference_frames
from validation import MAX_TEMP, MIN_TEMP


def make_grid(rows, cols, fill=0):
    return [[fill] * cols for _ in range(rows)]


def calibrate_case(grid, blocked, steps, boundary, adjust, observe, step, target):
    return calibrate(
        grid=grid,
        blocked_edges=blocked,
        steps=steps,
        boundary=boundary,
        adjust_cell=adjust,
        observe_cell=observe,
        observe_step=step,
        target=Fraction(target),
    )


# ---------- 手算精确用例 ----------

def test_exact_hit_simple():
    # 3x3 全 0，可调 (0,0)，观测 (0,1)，第 1 步观测值 = x/4，目标 5 → x = 20。
    result = calibrate_case(make_grid(3, 3), [], 1, INSULATED, (0, 0), (0, 1), 1, 5)
    assert result["status"] == "exact"
    assert result["value"] == 20
    assert result["residual"] == "0"
    assert result["observed"] == "5"
    assert result["slope"] == "1/4"
    # 候选模拟与直接以 20 为初温的模拟完全一致
    grid = make_grid(3, 3)
    grid[0][0] = 20
    assert result["candidate"] == simulate(grid, [], 1, INSULATED)
    # 基线保持原网格
    assert result["baseline"] == simulate(make_grid(3, 3), [], 1, INSULATED)


def test_closest_tie_prefers_smaller_value():
    # 目标 1/8 → x* = 1/2，0 与 1 误差都是 1/8，取较小的 0。
    result = calibrate_case(
        make_grid(3, 3), [], 1, INSULATED, (0, 0), (0, 1), 1, Fraction(1, 8)
    )
    assert result["status"] == "closest"
    assert result["value"] == 0
    assert result["observed"] == "0"
    assert result["residual"] == "-1/8"


def test_closest_negative_tie_prefers_smaller_value():
    # 目标 -1/8 → x* = -1/2，-1 与 0 并列，取 -1。
    result = calibrate_case(
        make_grid(3, 3), [], 1, INSULATED, (0, 0), (0, 1), 1, Fraction(-1, 8)
    )
    assert result["status"] == "closest"
    assert result["value"] == -1
    assert result["observed"] == "-1/4"
    assert result["residual"] == "-1/8"


def test_closest_clamps_to_legal_range():
    # 目标 1000 → x* = 4000，钳到 100，残差 = 25 - 1000。
    result = calibrate_case(make_grid(3, 3), [], 1, INSULATED, (0, 0), (0, 1), 1, 1000)
    assert result["status"] == "closest"
    assert result["value"] == MAX_TEMP
    assert result["observed"] == "25"
    assert result["residual"] == "-975"
    # 负方向同理。
    result = calibrate_case(make_grid(3, 3), [], 1, INSULATED, (0, 0), (0, 1), 1, -1000)
    assert result["value"] == MIN_TEMP
    assert result["residual"] == "975"


def test_all_values_hit_when_no_influence():
    # 阻断 (0,0) 的两条内部边使其完全孤立；观测格温度与 x 无关。
    # (2,2) 初温 8，第 1 步向 (1,2)、(2,1) 各转出 2，剩 4 → 目标 4 恒命中。
    grid = make_grid(3, 3)
    grid[0][0] = 55
    grid[2][2] = 8
    blocked = [((0, 0), (0, 1)), ((0, 0), (1, 0))]
    result = calibrate_case(grid, blocked, 3, INSULATED, (0, 0), (2, 2), 1, 4)
    assert result["status"] == "all"
    assert result["slope"] == "0"
    assert result["value"] == 55  # 任意值都命中，保持当前初温
    assert result["residual"] == "0"
    assert result["candidate"] == result["baseline"]


def test_unreachable_when_no_influence():
    # 同上但目标 5 ≠ 恒定的 4：任何合法初温都无法命中。
    grid = make_grid(3, 3)
    grid[2][2] = 8
    blocked = [((0, 0), (0, 1)), ((0, 0), (1, 0))]
    result = calibrate_case(grid, blocked, 3, INSULATED, (0, 0), (2, 2), 1, 5)
    assert result["status"] == "unreachable"
    assert result["value"] is None
    assert result["observed"] == "4"
    assert result["residual"] == "-1"
    assert result["candidate"] is None
    # 基线模拟仍然完整返回
    assert result["baseline"]["frames"]


def test_observe_step_zero_self():
    # 第 0 帧就是初温：观测格即可调格时 T(x) = x。
    result = calibrate_case(make_grid(3, 3), [], 4, FIXED_ZERO, (1, 1), (1, 1), 0, 42)
    assert result["status"] == "exact"
    assert result["value"] == 42
    # 观测格不是可调格时，第 0 帧与 x 无关。
    result = calibrate_case(make_grid(3, 3), [], 4, FIXED_ZERO, (0, 0), (1, 1), 0, 1)
    assert result["status"] == "unreachable"
    result = calibrate_case(make_grid(3, 3), [], 4, FIXED_ZERO, (0, 0), (1, 1), 0, 0)
    assert result["status"] == "all"


def test_fixed_zero_boundary_exact():
    # fixed-zero 下 (0,0) 有两条外边：T(0,1) 第 1 步 = x/4 不变（外边只影响 (0,0) 自身）。
    result = calibrate_case(make_grid(3, 3), [], 1, FIXED_ZERO, (0, 0), (0, 1), 1, 5)
    assert result["status"] == "exact"
    assert result["value"] == 20
    # 第 2 步中心格观测值 = x/8（边界外流已计入模型），目标 13/8 → x = 13。
    result = calibrate_case(
        make_grid(3, 3), [], 2, FIXED_ZERO, (0, 0), (1, 1), 2, Fraction(13, 8)
    )
    assert result["status"] == "exact"
    assert result["value"] == 13
    assert result["slope"] == "1/8"


# ---------- 逐一枚举合法初温的独立模型对拍 ----------

def brute_force_oracle(grid, blocked, steps, boundary, adjust, observe, step, target):
    """独立参考模型枚举所有合法初温，推出期望的求解结论。"""
    ar, ac = adjust
    observations = {}
    for x in range(MIN_TEMP, MAX_TEMP + 1):
        g = [list(row) for row in grid]
        g[ar][ac] = x
        frames, _, _ = reference_frames(g, blocked, steps, boundary)
        observations[x] = Fraction(frames[step][observe[0]][observe[1]])

    exact = [x for x, obs in observations.items() if obs == target]
    if len(exact) == MAX_TEMP - MIN_TEMP + 1:
        return "all", grid[ar][ac], Fraction(0)
    if exact:
        assert len(exact) == 1, "仿射函数至多一个精确解"
        return "exact", exact[0], Fraction(0)
    slope = observations[MIN_TEMP + 1] - observations[MIN_TEMP]
    if slope == 0:
        return "unreachable", None, observations[MIN_TEMP] - target
    # 无精确解：误差最小，并列取较小初温（枚举顺序即从小到大）。
    best_x = min(observations, key=lambda x: (abs(observations[x] - target), x))
    return "closest", best_x, observations[best_x] - target


def random_calibrate_case(rng):
    rows = rng.randint(3, 4)
    cols = rng.randint(3, 4)
    grid = [[rng.randint(-20, 20) for _ in range(cols)] for _ in range(rows)]
    all_edges = []
    for r in range(rows):
        for c in range(cols):
            if c + 1 < cols:
                all_edges.append(((r, c), (r, c + 1)))
            if r + 1 < rows:
                all_edges.append(((r, c), (r + 1, c)))
    rng.shuffle(all_edges)
    blocked = all_edges[: rng.randint(0, min(6, len(all_edges)))]
    steps = rng.randint(1, 4)
    boundary = rng.choice([INSULATED, FIXED_ZERO])
    adjust = (rng.randrange(rows), rng.randrange(cols))
    observe = (rng.randrange(rows), rng.randrange(cols))
    step = rng.randint(0, steps)
    target = Fraction(rng.randint(-30, 30), rng.choice([1, 2, 4, 8]))
    return grid, blocked, steps, boundary, adjust, observe, step, target


@pytest.mark.parametrize("seed", range(30))
def test_matches_brute_force_enumeration(seed):
    rng = random.Random(10_000 + seed)
    grid, blocked, steps, boundary, adjust, observe, step, target = random_calibrate_case(rng)
    result = calibrate_case(grid, blocked, steps, boundary, adjust, observe, step, target)
    exp_status, exp_value, exp_residual = brute_force_oracle(
        grid, blocked, steps, boundary, adjust, observe, step, target
    )
    assert result["status"] == exp_status
    assert result["value"] == exp_value
    assert Fraction(result["residual"]) == exp_residual
    if result["candidate"] is not None:
        # 候选模拟的观测格温度与报告的观测值一致
        obs = result["candidate"]["frames"][step][observe[0]][observe[1]]
        assert Fraction(obs) == Fraction(result["observed"])
        assert Fraction(obs) - target == exp_residual


# ---------- API 校验与响应 ----------

@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


def calibrate_payload(**overrides):
    payload = {
        "grid": [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
        "blockedEdges": [],
        "steps": 2,
        "boundary": "insulated",
        "adjustCell": {"r": 0, "c": 0},
        "observeCell": {"r": 0, "c": 1},
        "observeStep": 1,
        "target": "5",
    }
    payload.update(overrides)
    return payload


def test_calibrate_api_exact(client):
    resp = client.post("/api/calibrate", json=calibrate_payload())
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "exact"
    assert data["value"] == 20
    assert data["residual"] == "0"
    assert data["adjustCell"] == {"r": 0, "c": 0}
    assert data["observeCell"] == {"r": 0, "c": 1}
    assert data["observeStep"] == 1
    assert data["target"] == "5"
    # 基线/候选都是完整的模拟结果
    for key in ("baseline", "candidate"):
        assert len(data[key]["frames"]) == 3
        assert len(data[key]["boundaryFlux"]) == 2
        assert len(data[key]["totalTemperature"]) == 3
    # 基线第 0 帧即原网格
    assert data["baseline"]["frames"][0] == [["0"] * 3] * 3
    # 候选第 0 帧的可调格是求解值
    assert data["candidate"]["frames"][0][0][0] == "20"
    # 候选观测格第 1 步精确命中目标
    assert data["candidate"]["frames"][1][0][1] == "5"


def test_calibrate_api_accepts_rational_and_int_target(client):
    resp = client.post("/api/calibrate", json=calibrate_payload(target="13/2"))
    assert resp.status_code == 200
    assert resp.get_json()["value"] == 26
    resp = client.post("/api/calibrate", json=calibrate_payload(target=5))
    assert resp.status_code == 200
    assert resp.get_json()["value"] == 20
    resp = client.post("/api/calibrate", json=calibrate_payload(target="-9/4"))
    assert resp.status_code == 200
    assert resp.get_json()["value"] == -9


def test_calibrate_api_all_and_unreachable(client):
    blocked = [
        {"r1": 0, "c1": 0, "r2": 0, "c2": 1},
        {"r1": 0, "c1": 0, "r2": 1, "c2": 0},
    ]
    grid = [[0, 0, 0], [0, 0, 0], [0, 0, 8]]
    payload = calibrate_payload(
        grid=grid, blockedEdges=blocked, observeCell={"r": 2, "c": 2}, target="4"
    )
    data = client.post("/api/calibrate", json=payload).get_json()
    assert data["status"] == "all"
    assert data["value"] == 0
    payload["target"] = "5"
    data = client.post("/api/calibrate", json=payload).get_json()
    assert data["status"] == "unreachable"
    assert data["value"] is None
    assert data["candidate"] is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"adjustCell": {"r": 3, "c": 0}},                    # 可调格越界
        {"adjustCell": {"r": 0}},                            # 缺 c
        {"adjustCell": {"r": 0.5, "c": 0}},                  # 非整数坐标
        {"observeCell": {"r": 0, "c": -1}},                  # 观测格越界
        {"observeStep": -1},
        {"observeStep": 3},                                  # 超过 steps=2
        {"observeStep": 1.5},
        {"target": "abc"},
        {"target": "1/0"},                                   # 分母为 0
        {"target": "1/2/3"},
        {"target": 1.5},                                     # 浮点目标不精确，拒绝
        {"target": True},
        {"target": "1 / 2"},                                 # 含空白
    ],
)
def test_calibrate_api_invalid_payloads_return_400(client, overrides):
    resp = client.post("/api/calibrate", json=calibrate_payload(**overrides))
    assert resp.status_code == 400
    assert "error" in resp.get_json()


@pytest.mark.parametrize("field", ["adjustCell", "observeCell", "observeStep", "target"])
def test_calibrate_api_missing_fields_return_400(client, field):
    payload = calibrate_payload()
    del payload[field]
    assert client.post("/api/calibrate", json=payload).status_code == 400


def test_calibrate_api_reuses_base_validation(client):
    # 冻结基线本身的校验与 /api/simulate 一致
    assert client.post("/api/calibrate", json=calibrate_payload(steps=0)).status_code == 400
    assert (
        client.post("/api/calibrate", json=calibrate_payload(boundary="periodic")).status_code
        == 400
    )
    resp = client.post("/api/calibrate", data="not json", content_type="application/json")
    assert resp.status_code == 400


def test_simulate_api_unaffected_by_calibration(client):
    # 原模拟 API 行为保持不变
    payload = {
        "grid": [[0, 0, 0], [0, 16, 0], [0, 0, 0]],
        "steps": 2,
        "boundary": "insulated",
    }
    data = client.post("/api/simulate", json=payload).get_json()
    assert data["frames"][1][1][1] == "0"
    assert data["totalTemperature"] == ["16", "16", "16"]
