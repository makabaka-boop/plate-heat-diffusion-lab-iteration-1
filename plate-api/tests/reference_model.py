"""独立参考模型：以“格子视角”逐格汇总净流入，与被测的“边视角”实现结构不同。

被测 simulation.simulate 按边枚举转移量再同步累加；
这里对每个格子分别计算它从每个邻居/环境流入的量，二者互相独立，
用于对拍验证任意随机输入下逐帧完全一致。
"""

from fractions import Fraction


def reference_frames(grid, blocked, steps, boundary):
    rows = len(grid)
    cols = len(grid[0])
    blocked = {frozenset(edge) for edge in blocked}

    current = [[Fraction(v) for v in row] for row in grid]
    frames = [[[str(v) for v in row] for row in current]]
    fluxes = []
    totals = [str(sum(sum(row) for row in current))]

    for _ in range(steps):
        nxt = [[None] * cols for _ in range(rows)]
        flux = Fraction(0)
        for r in range(rows):
            for c in range(cols):
                t = current[r][c]
                gain = Fraction(0)
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    r2, c2 = r + dr, c + dc
                    if 0 <= r2 < rows and 0 <= c2 < cols:
                        if frozenset(((r, c), (r2, c2))) in blocked:
                            continue
                        gain += (current[r2][c2] - t) / 4
                    elif boundary == "fixed-zero":
                        out = t / 4
                        gain -= out
                        flux += out
                nxt[r][c] = t + gain
        current = nxt
        frames.append([[str(v) for v in row] for row in current])
        fluxes.append(str(flux))
        totals.append(str(sum(sum(row) for row in current)))

    return frames, fluxes, totals
