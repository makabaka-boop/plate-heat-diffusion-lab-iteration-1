"""plate-api：薄板热扩散模拟服务。"""

from flask import Flask, jsonify, request

from calibration import calibrate
from simulation import simulate
from validation import ValidationError, validate_calibration_payload, validate_payload


def create_app():
    app = Flask(__name__)

    @app.after_request
    def add_cors_headers(response):
        # 方便本地开发（vite dev server）直连；容器部署时经 nginx 同源代理。
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return response

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.post("/api/simulate")
    def simulate_route():
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "请求体必须是合法的 JSON"}), 400
        try:
            spec = validate_payload(data)
        except ValidationError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(simulate(**spec))

    @app.post("/api/calibrate")
    def calibrate_route():
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "请求体必须是合法的 JSON"}), 400
        try:
            spec = validate_calibration_payload(data)
        except ValidationError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(calibrate(**spec))

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
