import pytest

from app import create_app


@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


def valid_payload(**overrides):
    payload = {
        "grid": [[10, 0, -10], [0, 20, 0], [-10, 0, 10]],
        "blockedEdges": [{"r1": 0, "c1": 0, "r2": 0, "c2": 1}],
        "steps": 5,
        "boundary": "insulated",
    }
    payload.update(overrides)
    return payload


def test_health(client):
    assert client.get("/api/health").get_json() == {"status": "ok"}


def test_simulate_ok(client):
    resp = client.post("/api/simulate", json=valid_payload())
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["rows"] == 3 and data["cols"] == 3
    assert data["steps"] == 5
    assert data["boundary"] == "insulated"
    assert len(data["frames"]) == 6
    assert len(data["boundaryFlux"]) == 5
    assert len(data["totalTemperature"]) == 6
    # 阻断边回显为规范化后的列表
    assert data["blockedEdges"] == [{"r1": 0, "c1": 0, "r2": 0, "c2": 1}]
    # 绝热模式总温守恒
    assert len(set(data["totalTemperature"])) == 1


def test_simulate_fixed_zero_reports_flux(client):
    payload = valid_payload(boundary="fixed-zero", blockedEdges=[])
    data = client.post("/api/simulate", json=payload).get_json()
    assert any(flux != "0" for flux in data["boundaryFlux"])


def test_blocked_edges_optional(client):
    payload = valid_payload()
    del payload["blockedEdges"]
    assert client.post("/api/simulate", json=payload).status_code == 200


@pytest.mark.parametrize(
    "overrides",
    [
        {"grid": [[1, 2], [3, 4]]},                       # 行/列太小
        {"grid": [[0] * 13 for _ in range(3)]},           # 列太多
        {"grid": [[0, 0, 0], [0, 0, 0], [0, 0]]},         # 行长度不一致
        {"grid": [[0, 0, 0], [0, 101, 0], [0, 0, 0]]},    # 温度超上限
        {"grid": [[0, 0, 0], [0, -101, 0], [0, 0, 0]]},   # 温度超下限
        {"grid": [[0, 0, 0], [0, 1.5, 0], [0, 0, 0]]},    # 非整数温度
        {"grid": [[0, 0, 0], [0, True, 0], [0, 0, 0]]},   # 布尔不是合法整数
        {"steps": 0},
        {"steps": 26},
        {"steps": 2.5},
        {"boundary": "periodic"},
        {"blockedEdges": [{"r1": 0, "c1": 0, "r2": 0, "c2": 2}]},   # 不相邻
        {"blockedEdges": [{"r1": 0, "c1": 0, "r2": 0, "c2": 0}]},   # 自环
        {"blockedEdges": [{"r1": 0, "c1": 0, "r2": 9, "c2": 9}]},   # 越界
        {"blockedEdges": [                                            # 重复边
            {"r1": 0, "c1": 0, "r2": 0, "c2": 1},
            {"r1": 0, "c1": 1, "r2": 0, "c2": 0},
        ]},
        {"blockedEdges": [{"r1": 0, "c1": 0, "r2": 0}]},              # 缺字段
    ],
)
def test_invalid_payloads_return_400(client, overrides):
    resp = client.post("/api/simulate", json=valid_payload(**overrides))
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_too_many_blocked_edges(client):
    edges = []
    for r in range(12):
        for c in range(11):
            edges.append({"r1": r, "c1": c, "r2": r, "c2": c + 1})
    assert len(edges) > 30
    payload = valid_payload(grid=[[0] * 12 for _ in range(12)], blockedEdges=edges[:31])
    assert client.post("/api/simulate", json=payload).status_code == 400
    payload["blockedEdges"] = edges[:30]
    assert client.post("/api/simulate", json=payload).status_code == 200


def test_missing_fields_and_bad_json(client):
    assert client.post("/api/simulate", json={}).status_code == 400
    resp = client.post(
        "/api/simulate", data="not json", content_type="application/json"
    )
    assert resp.status_code == 400


def test_exactly_30_blocked_edges_accepted(client):
    edges = []
    for r in range(12):
        for c in range(11):
            edges.append({"r1": r, "c1": c, "r2": r, "c2": c + 1})
    payload = valid_payload(grid=[[0] * 12 for _ in range(12)], blockedEdges=edges[:30])
    assert client.post("/api/simulate", json=payload).status_code == 200
