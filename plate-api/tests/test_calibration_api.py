"""POST /api/calibrate 的 API 测试。"""

from fractions import Fraction

import pytest

from app import create_app
from simulation import simulate


@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


def base_payload(**overrides):
    payload = {
        "grid": [[0, 0, 0], [0, 16, 0], [0, 0, 0]],
        "blockedEdges": [],
        "steps": 1,
        "boundary": "insulated",
        "adjust": {"r": 0, "c": 0},
        "observe": {"r": 0, "c": 1},
        "target": "6",  # T(0,1) = 4 + x/4 ⇒ x = 8
    }
    payload.update(overrides)
    return payload


def post(client, **overrides):
    return client.post("/api/calibrate", json=base_payload(**overrides))


def test_exact_hit_ok(client):
    resp = post(client)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "exact"
    assert data["candidateValue"] == 8
    assert data["observed"] == "6"
    assert data["residual"] == "0"
    assert data["adjust"] == {"r": 0, "c": 0}
    assert data["observe"] == {"r": 0, "c": 1, "step": 1}
    assert data["target"] == "6"
    assert data["originalValue"] == 0
    assert data["slope"] == "1/4"
    assert data["intercept"] == "4"
    # 基线/候选都带完整帧（steps+1），且回显冻结参数。
    for key in ("baseline", "candidate"):
        assert len(data[key]["frames"]) == 2
        assert data[key]["boundary"] == "insulated"
        assert len(data[key]["boundaryFlux"]) == 1
    cand_grid = [[8, 0, 0], [0, 16, 0], [0, 0, 0]]
    assert data["candidate"]["frames"] == simulate(cand_grid, [], 1, "insulated")["frames"]


def test_nearest_hit_with_fraction_target(client):
    # 目标 33/8 ⇒ x = 1/2，等距 tie 取 0。
    data = post(client, target="33/8").get_json()
    assert data["status"] == "nearest"
    assert data["candidateValue"] == 0
    assert data["residual"] == "-1/8"
    assert data["absError"] == "1/8"


def test_integer_target_accepted(client):
    assert post(client, target=6).get_json()["candidateValue"] == 8


def test_decimal_string_target_accepted_as_exact_fraction(client):
    # 0.25 = 1/4：T = 4 + x/4 = 1/4 ⇒ x = -15
    data = post(client, target="0.25").get_json()
    assert data["status"] == "exact"
    assert data["candidateValue"] == -15
    assert data["target"] == "1/4"
    assert data["residual"] == "0"


def test_all_status_when_disconnected_and_constant_matches(client):
    blocked = [
        {"r1": 0, "c1": 0, "r2": 0, "c2": 1},
        {"r1": 0, "c1": 0, "r2": 1, "c2": 0},
    ]
    data = post(client, blockedEdges=blocked, target="4").get_json()
    assert data["status"] == "all"
    assert data["slope"] == "0"
    assert data["candidateValue"] == 0
    assert data["residual"] == "0"


def test_none_status_when_disconnected_and_constant_misses(client):
    blocked = [
        {"r1": 0, "c1": 0, "r2": 0, "c2": 1},
        {"r1": 0, "c1": 0, "r2": 1, "c2": 0},
    ]
    data = post(client, blockedEdges=blocked, steps=3, target="999").get_json()
    assert data["status"] == "none"
    assert data["slope"] == "0"
    assert data["candidateValue"] == -100
    assert Fraction(data["residual"]) != 0


def test_frozen_baseline_matches_current_grid_simulation(client):
    # 基线（候选 x=0 的那一套）必须与冻结网格上 /api/simulate 的结果一致。
    payload = base_payload(target="11/3")
    data = client.post("/api/calibrate", json=payload).get_json()
    sim = client.post(
        "/api/simulate",
        json={
            "grid": payload["grid"],
            "blockedEdges": payload["blockedEdges"],
            "steps": payload["steps"],
            "boundary": payload["boundary"],
        },
    ).get_json()
    zero_grid = [row[:] for row in payload["grid"]]
    zero_grid[0][0] = 0
    expected = simulate(
        zero_grid, [], payload["steps"], payload["boundary"]
    )
    assert data["baseline"]["frames"] == sim["frames"] == expected["frames"]


def test_simulate_endpoint_unchanged(client):
    # 新接口不得影响原模拟接口。
    payload = {
        "grid": [[0, 0, 0], [0, 16, 0], [0, 0, 0]],
        "blockedEdges": [],
        "steps": 2,
        "boundary": "fixed-zero",
    }
    resp = client.post("/api/simulate", json=payload)
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["frames"]) == 3
    assert set(data) == {
        "rows",
        "cols",
        "steps",
        "boundary",
        "blockedEdges",
        "frames",
        "boundaryFlux",
        "totalTemperature",
    }


@pytest.mark.parametrize(
    "overrides",
    [
        {"adjust": {"r": 0, "c": 3}},                          # 越界
        {"adjust": {"r": -1, "c": 0}},                         # 负坐标
        {"adjust": {"r": 0}},                                  # 缺 c
        {"adjust": "0,0"},                                     # 类型错
        {"observe": {"r": 3, "c": 0}},                         # 越界
        {"observe": {"r": 0, "c": 0.5}},                       # 非整数坐标
        {"target": "abc"},                                     # 非法有理数
        {"target": "1/0"},                                     # 零分母
        {"target": None},                                      # 空目标
        {"target": {"x": 1}},                                  # 对象目标
        {"grid": [[0] * 2 for _ in range(3)]},                 # 网格太小
        {"grid": [[0, 0, 0], [0, 101, 0], [0, 0, 0]]},         # 温度越界
        {"steps": 0},
        {"steps": 26},
        {"boundary": "periodic"},
        {"blockedEdges": [{"r1": 0, "c1": 0, "r2": 0, "c2": 2}]},  # 不相邻
    ],
)
def test_invalid_payloads_return_400(client, overrides):
    resp = post(client, **overrides)
    assert resp.status_code == 400
    assert "error" in resp.get_json()


@pytest.mark.parametrize("missing", ["grid", "steps", "boundary", "adjust", "observe", "target"])
def test_missing_fields_return_400(client, missing):
    payload = base_payload()
    del payload[missing]
    resp = client.post("/api/calibrate", json=payload)
    assert resp.status_code == 400
    assert missing in resp.get_json()["error"]


def test_bad_json_body_returns_400(client):
    resp = client.post(
        "/api/calibrate", data="not json", content_type="application/json"
    )
    assert resp.status_code == 400


def test_blocked_edges_cut_influence_and_carry_into_frames(client):
    # 阻断可调格全部内部边（角格两条），绝热 ⇒ 与观测格无关，且候选帧里阻断边回显。
    blocked = [
        {"r1": 0, "c1": 0, "r2": 0, "c2": 1},
        {"r1": 0, "c1": 0, "r2": 1, "c2": 0},
    ]
    data = post(client, blockedEdges=blocked, steps=2, target="0").get_json()
    assert data["status"] in ("all", "none")
    assert data["baseline"]["blockedEdges"] == blocked
    assert data["candidate"]["blockedEdges"] == blocked
