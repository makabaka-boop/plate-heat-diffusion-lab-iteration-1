"""单格逆向校准测试。

重点是“逐一枚举合法初温”的独立模型对拍：对每个小网格冻结配置，
用 tests.reference_model（逐格视角、与被测实现结构独立）把 -100~100 的
201 个合法整数初温全部跑一遍，暴力找出命中/最优结论，再与 calibration.calibrate
基于线性关系给出的精确结论逐字段对比，候选/基线的全部帧也要与参考模型一致。
"""

import random
from fractions import Fraction

import pytest

from calibration import ALL, EXACT, NEAREST, NONE, calibrate
from simulation import FIXED_ZERO, INSULATED
from tests.reference_model import reference_frames


def make_grid(rows, cols, fill=0):
    return [[fill] * cols for _ in range(rows)]


# ---------- 手算精确用例 ----------

def test_exact_hit_positive():
    # 3x3 中心 16：一步后 T(0,1) = 4 + x/4（x 为 (0,0) 初温）。
    grid = make_grid(3, 3)
    grid[1][1] = 16
    r = calibrate(grid, [], 1, INSULATED, (0, 0), (0, 1), Fraction(6))
    assert r["status"] == EXACT
    assert r["candidateValue"] == 8
    assert r["observed"] == "6"
    assert r["residual"] == "0"
    assert r["absError"] == "0"
    assert r["slope"] == "1/4"
    assert r["intercept"] == "4"


def test_exact_hit_negative():
    # 角格 (0,0) 绝热一步：T = x - 2*(x/4) = x/2；目标 -3 ⇒ x = -6。
    r = calibrate(make_grid(3, 3), [], 1, INSULATED, (0, 0), (0, 0), Fraction(-3))
    assert r["status"] == EXACT
    assert r["candidateValue"] == -6
    assert r["observed"] == "-3"


def test_nearest_tie_prefers_smaller_value():
    # 目标 33/8 对应 x=1/2，x=0 与 x=1 等距（残差绝对值都是 1/8），取较小者 0。
    grid = make_grid(3, 3)
    grid[1][1] = 16
    r = calibrate(grid, [], 1, INSULATED, (0, 0), (0, 1), Fraction(33, 8))
    assert r["status"] == NEAREST
    assert r["candidateValue"] == 0
    assert r["observed"] == "4"
    assert r["residual"] == "-1/8"
    assert r["absError"] == "1/8"


def test_nearest_non_integer_solution_picks_closest():
    # T = 4 + x/4，目标 41/8 ⇒ x = 9/2，最优 4（残差 -1/8，优于 5 的 +1/8? 等距→较小）。
    grid = make_grid(3, 3)
    grid[1][1] = 16
    r = calibrate(grid, [], 1, INSULATED, (0, 0), (0, 1), Fraction(41, 8))
    assert r["status"] == NEAREST
    assert r["candidateValue"] == 4
    assert r["observed"] == "5"
    assert r["residual"] == "-1/8"


def test_nearest_solution_above_range_clamps_to_100():
    grid = make_grid(3, 3)
    grid[1][1] = 16
    r = calibrate(grid, [], 1, INSULATED, (0, 0), (0, 1), Fraction(30))
    assert r["status"] == NEAREST
    assert r["candidateValue"] == 100
    assert r["observed"] == "29"
    assert r["residual"] == "-1"


def test_nearest_solution_below_range_clamps_to_minus_100():
    grid = make_grid(3, 3)
    grid[1][1] = 16
    r = calibrate(grid, [], 1, INSULATED, (0, 0), (0, 1), Fraction(-30))
    assert r["status"] == NEAREST
    assert r["candidateValue"] == -100
    assert r["observed"] == "-21"
    assert r["residual"] == "9"


def test_disconnected_all_values_hit():
    # 用阻断边把 (0,0) 完全隔离；绝热下 (0,1) 一步恒为 4，与 x 无关。
    grid = make_grid(3, 3)
    grid[1][1] = 16
    blocked = [((0, 0), (0, 1)), ((0, 0), (1, 0))]
    r = calibrate(grid, blocked, 1, INSULATED, (0, 0), (0, 1), Fraction(4))
    assert r["status"] == ALL
    assert r["slope"] == "0"
    assert r["residual"] == "0"
    assert r["observed"] == "4"
    # “所有值都命中”时候选取当前初温，确认不会改动编辑器。
    assert r["candidateValue"] == 0
    assert r["originalValue"] == 0


def test_disconnected_no_value_can_hit_uses_min_temp():
    grid = make_grid(3, 3)
    grid[1][1] = 16
    blocked = [((0, 0), (0, 1)), ((0, 0), (1, 0))]
    r = calibrate(grid, blocked, 3, FIXED_ZERO, (0, 0), (1, 1), Fraction(999))
    assert r["status"] == NONE
    assert r["slope"] == "0"
    assert r["candidateValue"] == -100
    assert r["residual"] == f"{Fraction(r['observed']) - 999}"
    assert r["absError"] == str(abs(Fraction(r["observed"]) - 999))


def test_baseline_and_candidate_frames_match_direct_simulation():
    from simulation import simulate

    grid = make_grid(3, 3)
    grid[1][1] = 16
    blocked = [((0, 0), (0, 1)), ((0, 0), (1, 0))]
    r = calibrate(grid, blocked, 3, FIXED_ZERO, (0, 0), (1, 1), Fraction(7))

    zero_grid = [row[:] for row in grid]
    zero_grid[0][0] = 0
    assert r["baseline"] == simulate(zero_grid, blocked, 3, FIXED_ZERO)

    cand_grid = [row[:] for row in grid]
    cand_grid[0][0] = r["candidateValue"]
    assert r["candidate"] == simulate(cand_grid, blocked, 3, FIXED_ZERO)
    assert r["observed"] == r["candidate"]["frames"][3][1][1]


def test_all_values_are_exact_rational_strings():
    grid = make_grid(3, 3)
    grid[1][1] = 3
    r = calibrate(grid, [], 2, FIXED_ZERO, (0, 0), (2, 2), Fraction(1, 7))
    assert isinstance(r["observed"], str) and isinstance(r["residual"], str)
    for key in ("baseline", "candidate"):
        for frame in r[key]["frames"]:
            for row in frame:
                for v in row:
                    assert isinstance(v, str)
                    Fraction(v)  # 必须是可解析的精确有理数


# ---------- 逐一枚举合法初温的独立模型对拍 ----------

def small_case(rng):
    """随机小网格冻结配置（3~4 行/列，1~3 步），便于完整枚举 201 个初温。"""
    rows = rng.randint(3, 4)
    cols = rng.randint(3, 4)
    grid = [[rng.randint(-8, 8) for _ in range(cols)] for _ in range(rows)]
    all_edges = []
    for r in range(rows):
        for c in range(cols):
            if c + 1 < cols:
                all_edges.append(((r, c), (r, c + 1)))
            if r + 1 < rows:
                all_edges.append(((r, c), (r + 1, c)))
    rng.shuffle(all_edges)
    blocked = all_edges[: rng.randint(0, min(10, len(all_edges)))]
    steps = rng.randint(1, 3)
    boundary = rng.choice([INSULATED, FIXED_ZERO])
    ar, ac = rng.randrange(rows), rng.randrange(cols)
    orow, ocol = rng.randrange(rows), rng.randrange(cols)
    return grid, blocked, steps, boundary, (ar, ac), (orow, ocol)


def observe_with(grid, blocked, steps, boundary, orow, ocol):
    frames, fluxes, totals = reference_frames(grid, blocked, steps, boundary)
    return Fraction(frames[steps][orow][ocol]), frames, fluxes, totals


def make_target(rng, obs):
    """混合目标：整数、分数、等距中点（强制 tie）、极端值、带 1/7 偏移。"""
    kind = rng.randrange(5)
    if kind == 0:
        return Fraction(rng.randint(-30, 30))
    if kind == 1:
        return Fraction(rng.randint(-20, 20), rng.choice([2, 3, 4, 8]))
    if kind == 2:
        # 相邻合法初温观测值的中点，必然等距，检验 tie-break。
        k = rng.randint(-100, 99)
        return (obs[k] + obs[k + 1]) / 2
    if kind == 3:
        return Fraction(rng.choice([1000, -1000, 10**6]))
    return obs[rng.randint(-100, 100)] + Fraction(rng.choice([1, -1]), 7)


def all_observations(grid, blocked, steps, boundary, adjust, observe):
    """枚举 -100~100 全部 201 个合法初温，返回 {初温: 观测温度}。"""
    ar, ac = adjust
    orow, ocol = observe
    obs = {}
    for x in range(-100, 101):
        gx = [row[:] for row in grid]
        gx[ar][ac] = x
        obs[x], *_ = observe_with(
            gx, blocked, steps, boundary, orow, ocol
        )
    return obs


def enumerate_expectation(obs, original_value, target):
    """从暴力枚举的观测表得出应有结论：状态、候选值、观测值、残差。"""
    distinct = set(obs.values())
    if len(distinct) == 1:
        const = obs[0]
        if const == target:
            status, value = ALL, original_value
        else:
            status, value = NONE, -100
    else:
        hits = [x for x in range(-100, 101) if obs[x] == target]
        if hits:
            # 线性且斜率非零，至多一个精确解。
            assert len(hits) == 1
            status, value = EXACT, hits[0]
        else:
            status = NEAREST
            value = min(range(-100, 101), key=lambda x: (abs(obs[x] - target), x))
    return status, value, obs[value], obs[value] - target


@pytest.mark.parametrize("seed", range(18))
def test_matches_bruteforce_enumeration(seed):
    rng = random.Random(1000 + seed)
    grid, blocked, steps, boundary, adjust, observe = small_case(rng)
    ar, ac = adjust
    orow, ocol = observe

    obs = all_observations(grid, blocked, steps, boundary, adjust, observe)
    target = make_target(rng, obs)

    status, value, observed, residual = enumerate_expectation(
        obs, grid[ar][ac], target
    )

    r = calibrate(grid, blocked, steps, boundary, adjust, observe, target)
    assert r["status"] == status
    assert r["candidateValue"] == value
    assert r["observed"] == str(observed)
    assert r["residual"] == str(residual)
    assert r["absError"] == str(abs(residual))
    assert r["slope"] == str(obs[1] - obs[0])
    assert r["intercept"] == str(obs[0])
    assert r["target"] == str(target)
    assert r["adjust"] == {"r": ar, "c": ac}
    assert r["observe"] == {"r": orow, "c": ocol, "step": steps}

    # 候选与基线整套帧/流量/总温也必须与独立参考模型一致。
    g_cand = [row[:] for row in grid]
    g_cand[ar][ac] = value
    observed2, f_cand, fl_cand, tot_cand = observe_with(
        g_cand, blocked, steps, boundary, orow, ocol
    )
    assert observed2 == observed
    assert r["candidate"]["frames"] == f_cand
    assert r["candidate"]["boundaryFlux"] == fl_cand
    assert r["candidate"]["totalTemperature"] == tot_cand

    g_zero = [row[:] for row in grid]
    g_zero[ar][ac] = 0
    _, f_zero, fl_zero, tot_zero = observe_with(
        g_zero, blocked, steps, boundary, orow, ocol
    )
    assert r["baseline"]["frames"] == f_zero
    assert r["baseline"]["boundaryFlux"] == fl_zero
    assert r["baseline"]["totalTemperature"] == tot_zero


def test_enumeration_covers_all_four_statuses():
    # 主动构造目标，确保整套对拍确实触达过四种状态，而不是只测了某一支。
    seen = set()
    for seed in range(60):
        rng = random.Random(2000 + seed)
        grid, blocked, steps, boundary, adjust, observe = small_case(rng)
        obs = all_observations(grid, blocked, steps, boundary, adjust, observe)
        if len(set(obs.values())) == 1:
            # 无关格：常数等于目标 ⇒ all；不等于目标 ⇒ none。
            const = obs[0]
            for target, expected in ((const, ALL), (const + 1, NONE)):
                r = calibrate(
                    grid, blocked, steps, boundary, adjust, observe, target
                )
                assert r["status"] == expected
                seen.add(expected)
        else:
            # 相关格：取某个真实观测值 ⇒ exact；取其偏移 1/7 ⇒ nearest。
            some_x = rng.randint(-100, 100)
            r = calibrate(
                grid, blocked, steps, boundary, adjust, observe, obs[some_x]
            )
            assert r["status"] == EXACT
            seen.add(EXACT)
            r = calibrate(
                grid,
                blocked,
                steps,
                boundary,
                adjust,
                observe,
                obs[some_x] + Fraction(1, 7),
            )
            assert r["status"] == NEAREST
            seen.add(NEAREST)
        if seen == {EXACT, NEAREST, ALL, NONE}:
            break
    assert seen == {EXACT, NEAREST, ALL, NONE}


