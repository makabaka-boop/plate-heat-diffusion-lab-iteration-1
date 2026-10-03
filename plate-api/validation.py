"""请求体验证：把 JSON 负载转成 simulate() 可用的规范化参数。"""

from simulation import BOUNDARY_MODES, edge_key

MIN_DIM = 3
MAX_DIM = 12
MIN_TEMP = -100
MAX_TEMP = 100
MAX_BLOCKED_EDGES = 30
MIN_STEPS = 1
MAX_STEPS = 25


class ValidationError(ValueError):
    pass


def _is_int(value):
    # bool 是 int 的子类，必须显式排除。
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_grid(raw):
    if not isinstance(raw, list) or not raw:
        raise ValidationError("grid 必须是非空的二维数组")
    if not all(isinstance(row, list) for row in raw):
        raise ValidationError("grid 必须是二维数组")
    rows = len(raw)
    cols = len(raw[0])
    if not (MIN_DIM <= rows <= MAX_DIM):
        raise ValidationError(f"行数必须在 {MIN_DIM}~{MAX_DIM} 之间")
    if not (MIN_DIM <= cols <= MAX_DIM):
        raise ValidationError(f"列数必须在 {MIN_DIM}~{MAX_DIM} 之间")
    if any(len(row) != cols for row in raw):
        raise ValidationError("grid 每一行的列数必须一致")
    for r, row in enumerate(raw):
        for c, value in enumerate(row):
            if not _is_int(value):
                raise ValidationError(f"grid[{r}][{c}] 必须是整数")
            if not (MIN_TEMP <= value <= MAX_TEMP):
                raise ValidationError(
                    f"grid[{r}][{c}] 必须在 {MIN_TEMP}~{MAX_TEMP} 之间"
                )
    return [list(row) for row in raw]


def _validate_blocked_edges(raw, rows, cols):
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValidationError("blockedEdges 必须是数组")
    if len(raw) > MAX_BLOCKED_EDGES:
        raise ValidationError(f"blockedEdges 最多 {MAX_BLOCKED_EDGES} 条")
    edges = []
    seen = set()
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValidationError(f"blockedEdges[{i}] 必须是对象")
        coords = []
        for name in ("r1", "c1", "r2", "c2"):
            value = item.get(name)
            if not _is_int(value):
                raise ValidationError(f"blockedEdges[{i}].{name} 必须是整数")
            coords.append(value)
        r1, c1, r2, c2 = coords
        for rr, cc in ((r1, c1), (r2, c2)):
            if not (0 <= rr < rows and 0 <= cc < cols):
                raise ValidationError(f"blockedEdges[{i}] 超出网格范围")
        if abs(r1 - r2) + abs(c1 - c2) != 1:
            raise ValidationError(f"blockedEdges[{i}] 必须连接相邻的两个格子")
        key = edge_key((r1, c1), (r2, c2))
        if key in seen:
            raise ValidationError(f"blockedEdges[{i}] 与前面的边重复")
        seen.add(key)
        edges.append(key)
    return edges


def _validate_steps(raw):
    if not _is_int(raw):
        raise ValidationError("steps 必须是整数")
    if not (MIN_STEPS <= raw <= MAX_STEPS):
        raise ValidationError(f"steps 必须在 {MIN_STEPS}~{MAX_STEPS} 之间")
    return raw


def _validate_boundary(raw):
    if raw not in BOUNDARY_MODES:
        raise ValidationError(f"boundary 必须是 {' 或 '.join(BOUNDARY_MODES)}")
    return raw


def validate_payload(data):
    """验证 POST /api/simulate 的 JSON 负载。

    返回 dict，可直接 ** 展开传给 simulate()。验证失败抛 ValidationError。
    """
    if not isinstance(data, dict):
        raise ValidationError("请求体必须是 JSON 对象")
    if "grid" not in data:
        raise ValidationError("缺少 grid 字段")
    if "steps" not in data:
        raise ValidationError("缺少 steps 字段")
    if "boundary" not in data:
        raise ValidationError("缺少 boundary 字段")

    grid = _validate_grid(data["grid"])
    rows, cols = len(grid), len(grid[0])
    return {
        "grid": grid,
        "blocked_edges": _validate_blocked_edges(
            data.get("blockedEdges"), rows, cols
        ),
        "steps": _validate_steps(data["steps"]),
        "boundary": _validate_boundary(data["boundary"]),
    }
