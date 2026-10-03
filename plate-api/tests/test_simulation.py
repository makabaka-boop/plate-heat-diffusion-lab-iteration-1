import random
from fractions import Fraction

import pytest

from simulation import FIXED_ZERO, INSULATED, simulate
from tests.reference_model import reference_frames


def make_grid(rows, cols, fill=0):
    return [[fill] * cols for _ in range(rows)]


# ---------- 手算精确用例 ----------

def test_hot_center_insulated_one_step_exact():
    # 3x3，中心 16，其余 0，一步后中心把 16/4=4 分给四个边中点。
    grid = make_grid(3, 3)
    grid[1][1] = 16
    result = simulate(grid, [], 1, INSULATED)
    assert result["frames"][1] == [
        ["0", "4", "0"],
        ["4", "0", "4"],
        ["0", "4", "0"],
    ]
    assert result["boundaryFlux"] == ["0"]
    assert result["totalTemperature"] == ["16", "16"]


def test_hot_center_fixed_zero_two_steps_exact():
    # 第 1 步与绝热相同（边界格初温为 0，尚无外流）；
    # 第 2 步四个边中点各向环境流出 4/4=1，并向中心、两角各转 1。
    grid = make_grid(3, 3)
    grid[1][1] = 16
    result = simulate(grid, [], 2, FIXED_ZERO)
    assert result["frames"][1] == [
        ["0", "4", "0"],
        ["4", "0", "4"],
        ["0", "4", "0"],
    ]
    assert result["frames"][2] == [
        ["2", "0", "2"],
        ["0", "4", "0"],
        ["2", "0", "2"],
    ]
    assert result["boundaryFlux"] == ["0", "4"]
    assert result["totalTemperature"] == ["16", "16", "12"]


def test_blocked_edge_prevents_transfer():
    # 阻断中心与上方边中点之间的边：中心只向三个方向转移。
    grid = make_grid(3, 3)
    grid[1][1] = 16
    result = simulate(grid, [((1, 1), (0, 1))], 1, INSULATED)
    assert result["frames"][1] == [
        ["0", "0", "0"],
        ["4", "4", "4"],
        ["0", "4", "0"],
    ]
    assert result["totalTemperature"] == ["16", "16"]


def test_fractional_values_are_exact():
    # 温差不能被 4 整除时必须得到精确分数，而不是浮点近似。
    grid = [[0, 0, 0], [0, 1, 0], [0, 0, 0]]
    result = simulate(grid, [], 1, INSULATED)
    assert result["frames"][1][0][1] == "1/4"
    assert result["frames"][1][1][1] == "0"
    # 再验证一步后的复合分数。
    result2 = simulate(grid, [], 2, INSULATED)
    assert result2["frames"][2][1][1] == str(Fraction(1, 4))
    assert result2["frames"][2][0][0] == str(Fraction(1, 8))


def test_negative_temperatures_flow_to_colder_side():
    grid = [[0, 0, 0], [-8, 0, 0], [0, 0, 0]]
    result = simulate(grid, [], 1, INSULATED)
    # 热量从 0 流向 -8：-8 格有 3 个邻居，各流入 (0-(-8))/4 = 2，共 +6。
    assert result["frames"][1][1][0] == "-2"
    assert result["frames"][1][0][0] == "-2"
    assert result["totalTemperature"] == ["-8", "-8"]


# ---------- 守恒与流量性质 ----------

@pytest.mark.parametrize("steps", [1, 5, 25])
def test_insulated_conserves_total_temperature(steps):
    rng = random.Random(42)
    grid = [[rng.randint(-100, 100) for _ in range(6)] for _ in range(5)]
    result = simulate(grid, [], steps, INSULATED)
    assert len(set(result["totalTemperature"])) == 1
    assert all(flux == "0" for flux in result["boundaryFlux"])


def test_fixed_zero_total_drops_by_boundary_flux():
    rng = random.Random(7)
    grid = [[rng.randint(-100, 100) for _ in range(4)] for _ in range(4)]
    result = simulate(grid, [], 10, FIXED_ZERO)
    totals = [Fraction(t) for t in result["totalTemperature"]]
    fluxes = [Fraction(f) for f in result["boundaryFlux"]]
    for i in range(10):
        assert totals[i + 1] == totals[i] - fluxes[i]


def test_output_shapes():
    result = simulate(make_grid(3, 4), [], 7, INSULATED)
    assert len(result["frames"]) == 8
    assert len(result["boundaryFlux"]) == 7
    assert len(result["totalTemperature"]) == 8
    for frame in result["frames"]:
        assert len(frame) == 3
        assert all(len(row) == 4 for row in frame)


def test_totals_match_frame_sums():
    rng = random.Random(1)
    grid = [[rng.randint(-50, 50) for _ in range(4)] for _ in range(3)]
    for boundary in (INSULATED, FIXED_ZERO):
        result = simulate(grid, [], 6, boundary)
        for frame, total in zip(result["frames"], result["totalTemperature"]):
            assert sum(Fraction(v) for row in frame for v in row) == Fraction(total)


# ---------- 与独立参考模型对拍 ----------

def random_case(rng):
    rows = rng.randint(3, 12)
    cols = rng.randint(3, 12)
    grid = [[rng.randint(-100, 100) for _ in range(cols)] for _ in range(rows)]
    all_edges = []
    for r in range(rows):
        for c in range(cols):
            if c + 1 < cols:
                all_edges.append(((r, c), (r, c + 1)))
            if r + 1 < rows:
                all_edges.append(((r, c), (r + 1, c)))
    rng.shuffle(all_edges)
    blocked = all_edges[: rng.randint(0, min(30, len(all_edges)))]
    steps = rng.randint(1, 25)
    boundary = rng.choice([INSULATED, FIXED_ZERO])
    return grid, blocked, steps, boundary


@pytest.mark.parametrize("seed", range(40))
def test_matches_independent_flux_model(seed):
    rng = random.Random(seed)
    grid, blocked, steps, boundary = random_case(rng)
    result = simulate(grid, blocked, steps, boundary)
    frames, fluxes, totals = reference_frames(grid, blocked, steps, boundary)
    assert result["frames"] == frames
    assert result["boundaryFlux"] == fluxes
    assert result["totalTemperature"] == totals
