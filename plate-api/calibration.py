"""单格逆向校准：在冻结的网格/阻断边/边界模式/步数下，反求某个可调格的初温。

物理模型关于初温是线性的（每步都是当前温度向量的线性变换，fixed-zero 边界
与零温环境交换同样是线性的），因此观测格在指定步的温度是可调格初温 x 的
精确仿射函数 T(x) = a*x + b。用两次精确模拟（x=0 与 x=1）确定 a、b，
之后全部在有理数上求解，不做任何浮点试探：

  * a != 0：x* = (target - b) / a。x* 是范围内的整数则精确命中；
    否则取使 |T(v) - target| 最小的合法整数，并列（x* 恰为半整数）取较小初温。
  * a == 0：可调格对观测格没有影响。观测值恒等于目标则所有合法值都命中；
    否则任何值都无法命中，两种情形必须区分报告。
"""

from fractions import Fraction

from simulation import simulate
from validation import MAX_TEMP, MIN_TEMP

STATUS_EXACT = "exact"            # 范围内存在唯一精确命中值
STATUS_CLOSEST = "closest"        # 无精确解，返回误差最小的合法值
STATUS_ALL = "all"                # 可调格无影响且观测值恒等于目标：所有值都命中
STATUS_UNREACHABLE = "unreachable"  # 可调格无影响且观测值不等于目标：无值可命中


def _observed(result, cell, step):
    return Fraction(result["frames"][step][cell[0]][cell[1]])


def _nearest_legal_integer(x_star):
    """返回离 x* 最近的 [MIN_TEMP, MAX_TEMP] 内整数，并列取较小者。"""
    floor = x_star.numerator // x_star.denominator  # 向下取整
    candidates = [v for v in (floor, floor + 1) if MIN_TEMP <= v <= MAX_TEMP]
    if not candidates:
        return MIN_TEMP if x_star < MIN_TEMP else MAX_TEMP
    # 误差相同（x* 恰为半整数）时取较小初温。
    return min(candidates, key=lambda v: (abs(v - x_star), v))


def calibrate(
    grid,
    blocked_edges,
    steps,
    boundary,
    adjust_cell,
    observe_cell,
    observe_step,
    target,
):
    """求解可调格初温，并返回候选/原模拟的完整帧供页面对比。

    参数:
        grid, blocked_edges, steps, boundary: 与 simulate() 相同的冻结基线。
        adjust_cell: (r, c) 可调初温格。
        observe_cell: (r, c) 观测格。
        observe_step: 观测步（0..steps 的帧号）。
        target: fractions.Fraction 目标温度。

    返回:
        dict，含 status、value（unreachable 时为 None）、精确残差、
        观测值、斜率、回显参数，以及 baseline/candidate 两次完整模拟结果。
    """
    ar, ac = adjust_cell

    def grid_with(x):
        g = [list(row) for row in grid]
        g[ar][ac] = x
        return g

    # 两次精确模拟确定仿射系数 a、b，再补一次当前初温下的基线模拟。
    sim0 = simulate(grid_with(0), blocked_edges, steps, boundary)
    sim1 = simulate(grid_with(1), blocked_edges, steps, boundary)
    intercept = _observed(sim0, observe_cell, observe_step)
    slope = _observed(sim1, observe_cell, observe_step) - intercept
    baseline = simulate(grid, blocked_edges, steps, boundary)

    echo = {
        "adjustCell": {"r": ar, "c": ac},
        "observeCell": {"r": observe_cell[0], "c": observe_cell[1]},
        "observeStep": observe_step,
        "target": str(target),
        "slope": str(slope),
    }

    if slope == 0:
        if intercept == target:
            # 所有合法值都命中：保持当前初温即可，候选与基线相同。
            return {
                **echo,
                "status": STATUS_ALL,
                "value": grid[ar][ac],
                "observed": str(intercept),
                "residual": "0",
                "baseline": baseline,
                "candidate": baseline,
            }
        return {
            **echo,
            "status": STATUS_UNREACHABLE,
            "value": None,
            "observed": str(intercept),
            "residual": str(intercept - target),
            "baseline": baseline,
            "candidate": None,
        }

    x_star = (target - intercept) / slope
    value = _nearest_legal_integer(x_star)
    observed = slope * value + intercept
    residual = observed - target
    status = STATUS_EXACT if residual == 0 else STATUS_CLOSEST

    candidate = simulate(grid_with(value), blocked_edges, steps, boundary)
    # 内部一致性：候选模拟的观测值必须与仿射预测精确相等。
    assert _observed(candidate, observe_cell, observe_step) == observed

    return {
        **echo,
        "status": status,
        "value": value,
        "observed": str(observed),
        "residual": str(residual),
        "baseline": baseline,
        "candidate": candidate,
    }
