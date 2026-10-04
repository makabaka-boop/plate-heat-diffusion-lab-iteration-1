"""单格逆向校准：在冻结的网格/阻断边/边界模式/步数下，反求某个可调初温格
的合法初温，使指定观测格在指定步的温度命中有理数目标值。

计算严格沿用 simulation.simulate（同步通量 + 边界交换，fractions.Fraction 精确值），
不做任何前端浮点试探。

模型关于初温是线性的：冻结其余格后，观测温度 T(x) = a*x + b，
其中 x 为可调格初温。用两次精确模拟即可求出 a、b：
  * b = T(0)：可调格置 0 的模拟；
  * a = T(1) - T(0)：可调格置 1 再模拟一次。

合法初温是 -100~100 的整数。结论分三类：
  * exact          a≠0，且方程的唯一解是该范围内的整数，精确命中；
  * nearest        a≠0，但解不是合法整数（或超出范围），
                   取范围内 |残差| 最小的合法整数，等距时取较小初温；
  * all / none     a=0，观测格与可调格完全无关（如被阻断边隔离）：
                     - 常数温度恰好等于目标 ⇒ 所有值都命中（all）；
                     - 否则 ⇒ 无值可命中（none），候选统一取范围内最小值 -100。
"""

from fractions import Fraction

from simulation import simulate
from validation import MAX_TEMP, MIN_TEMP

# 校准结论状态码。
EXACT = "exact"
NEAREST = "nearest"
ALL = "all"
NONE = "none"


def _run(grid, blocked_edges, steps, boundary, target_r, target_c):
    result = simulate(grid, blocked_edges, steps, boundary)
    return Fraction(result["frames"][steps][target_r][target_c]), result


def calibrate(grid, blocked_edges, steps, boundary, adjust, observe, target):
    """反求可调格初温并返回候选/基线两套完整模拟结果。

    参数:
        grid: rows x cols 的整数矩阵；其余格初温被冻结。
        blocked_edges / steps / boundary: 与 simulate 相同，全部冻结。
        adjust: (r, c) 可调初温格坐标。
        observe: (r, c) 观测格坐标。
        target: fractions.Fraction，观测步的目标温度（有理数）。

    返回 dict（均可直接 JSON 序列化，温度均为有理数字符串）。
    """
    ar, ac = adjust
    orow, ocol = observe

    base_grid = [list(row) for row in grid]
    one_grid = [list(row) for row in grid]
    base_grid[ar][ac] = 0
    one_grid[ar][ac] = 1

    b, baseline = _run(
        base_grid, blocked_edges, steps, boundary, orow, ocol
    )
    t_one, _ = _run(one_grid, blocked_edges, steps, boundary, orow, ocol)
    slope = t_one - b

    if slope == 0:
        # 可调格对观测格没有任何影响：整段轨迹与候选无关。
        if b == target:
            status, value = ALL, grid[ar][ac]
        else:
            status, value = NONE, MIN_TEMP
        residual = b - target
    else:
        x = (target - b) / slope
        if x.denominator == 1 and MIN_TEMP <= x.numerator <= MAX_TEMP:
            status, value = EXACT, x.numerator
            residual = Fraction(0)
        else:
            # 在合法整数范围内取残差绝对值最小者；等距时取较小初温。
            candidates = [
                max(MIN_TEMP, min(MAX_TEMP, x.numerator // x.denominator)),
                max(MIN_TEMP, min(MAX_TEMP, -((-x.numerator) // x.denominator))),
                MIN_TEMP,
                MAX_TEMP,
            ]
            best = min(
                candidates,
                key=lambda v: (abs(slope * v + b - target), v),
            )
            status, value = NEAREST, best
            residual = slope * best + b - target

    cand_grid = [list(row) for row in grid]
    cand_grid[ar][ac] = value
    observed, candidate = _run(
        cand_grid, blocked_edges, steps, boundary, orow, ocol
    )

    return {
        "status": status,
        "adjust": {"r": ar, "c": ac},
        "observe": {"r": orow, "c": ocol, "step": steps},
        "originalValue": grid[ar][ac],
        "candidateValue": value,
        "target": str(target),
        "observed": str(observed),
        "residual": str(residual),
        "absError": str(abs(residual)),
        "slope": str(slope),
        "intercept": str(b),
        "baseline": baseline,
        "candidate": candidate,
    }
