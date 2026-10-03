"""薄板热扩散精确模拟。

所有温度以 fractions.Fraction 表示，保证任意步数后结果仍是精确有理数。

传热规则（每一步，所有更新同步进行）：
  * 每条未阻断的内部边 (u, v)：把两端温差的 1/4 从高温格转向低温格，
    即 u 失去 (T_u - T_v)/4，v 得到 (T_u - T_v)/4。
  * insulated 边界：板与外界无任何交换。
  * fixed-zero 边界：每条外边与零温环境交换同样的 1/4，
    即格子失去 (T_cell - 0)/4，这部分计入该步边界净流量。

阻断边只作用于相邻格之间的内部边，不影响外边。
"""

from fractions import Fraction

INSULATED = "insulated"
FIXED_ZERO = "fixed-zero"
BOUNDARY_MODES = (INSULATED, FIXED_ZERO)


def edge_key(a, b):
    """无向边的规范化键，a、b 为 (row, col) 元组。"""
    return (a, b) if a <= b else (b, a)


def _snapshot(grid):
    return [[str(cell) for cell in row] for row in grid]


def _total(grid):
    return str(sum((cell for row in grid for cell in row), Fraction(0)))


def simulate(grid, blocked_edges, steps, boundary):
    """运行模拟并返回全部帧、每步边界净流量与每帧总温。

    参数:
        grid: rows x cols 的整数矩阵（list[list[int]]）。
        blocked_edges: 可迭代元素为 ((r1, c1), (r2, c2)) 的阻断边。
        steps: 时间步数。
        boundary: "insulated" 或 "fixed-zero"。

    返回:
        dict，包含 frames（steps+1 帧，元素为有理数字符串）、
        boundaryFlux（每步一个，长度为 steps）、
        totalTemperature（每帧一个，长度为 steps+1）。
    """
    if boundary not in BOUNDARY_MODES:
        raise ValueError(f"unknown boundary mode: {boundary!r}")

    rows = len(grid)
    cols = len(grid[0])
    blocked = {edge_key(a, b) for a, b in blocked_edges}

    current = [[Fraction(grid[r][c]) for c in range(cols)] for r in range(rows)]

    frames = [_snapshot(current)]
    boundary_flux = []
    totals = [_total(current)]

    for _ in range(steps):
        # 同步更新：先基于当前帧算出所有增量，再一次性应用。
        delta = [[Fraction(0) for _ in range(cols)] for _ in range(rows)]
        flux = Fraction(0)

        for r in range(rows):
            for c in range(cols):
                # 每条内部边只处理一次（向右、向下）。
                for dr, dc in ((0, 1), (1, 0)):
                    r2, c2 = r + dr, c + dc
                    if r2 >= rows or c2 >= cols:
                        continue
                    if edge_key((r, c), (r2, c2)) in blocked:
                        continue
                    d = (current[r][c] - current[r2][c2]) / 4
                    delta[r][c] -= d
                    delta[r2][c2] += d

                if boundary == FIXED_ZERO:
                    # 每条外边与零温环境交换温差的 1/4。
                    sides = 0
                    if r == 0:
                        sides += 1
                    if r == rows - 1:
                        sides += 1
                    if c == 0:
                        sides += 1
                    if c == cols - 1:
                        sides += 1
                    for _ in range(sides):
                        d = current[r][c] / 4
                        delta[r][c] -= d
                        flux += d

        current = [
            [current[r][c] + delta[r][c] for c in range(cols)] for r in range(rows)
        ]
        frames.append(_snapshot(current))
        boundary_flux.append(str(flux))
        totals.append(_total(current))

    return {
        "rows": rows,
        "cols": cols,
        "steps": steps,
        "boundary": boundary,
        "blockedEdges": [
            {"r1": a[0], "c1": a[1], "r2": b[0], "c2": b[1]} for a, b in sorted(blocked)
        ],
        "frames": frames,
        "boundaryFlux": boundary_flux,
        "totalTemperature": totals,
    }
