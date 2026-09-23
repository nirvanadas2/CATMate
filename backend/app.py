"""CATMate backend (Phase 2): Flask REST API over the synthetic dataset.

Run with: python app.py  (serves on http://localhost:5000)
"""

from flask import Flask, jsonify, request
from flask_cors import CORS

import incidents as incidents_module
from anomaly_engine import (
    _with_delta,
    compute_behavior_anomalies,
    compute_integrity_summary,
    compute_security_anomalies,
    safety_alert_reason,
)
from copilot import answer_question
from data_loader import DF, LATEST_DATE
from handoff import compute_shift_handoff
from ml_model import FEATURES, predict_duration, train_duration_model
from training import recommend_training
from trust_score import compute_trust_scores

app = Flask(__name__)
CORS(app)

# Computed once at startup - dataset is small and static for the demo.
BEHAVIOR_ANOMALIES = compute_behavior_anomalies(DF)
SECURITY_ANOMALIES = compute_security_anomalies(DF)
TRUST_SCORES = compute_trust_scores(DF, BEHAVIOR_ANOMALIES, SECURITY_ANOMALIES)
DURATION_MODEL, DURATION_MODEL_METRICS = train_duration_model(DF)


@app.route("/tasks")
def get_tasks():
    operator_id = request.args.get("operator_id")
    if not operator_id:
        return jsonify({"error": "operator_id query param is required"}), 400

    today_rows = DF[(DF["operator_id"] == operator_id) & (DF["timestamp"].dt.date == LATEST_DATE)]
    if today_rows.empty:
        return jsonify([])

    max_ts = today_rows["timestamp"].max()
    tasks = []
    for task_id, g in today_rows.groupby("task_id"):
        last_row = g.sort_values("timestamp").iloc[-1]
        features = {f: float(last_row[f]) for f in FEATURES}
        predicted = predict_duration(DURATION_MODEL, features)
        tasks.append({
            "task_id": task_id,
            "task_type": last_row["task_type"],
            "status": "In Progress" if last_row["timestamp"] == max_ts else "Completed",
            "predicted_duration_min": round(predicted, 1),
        })

    tasks.sort(key=lambda t: t["task_id"])
    return jsonify(tasks)


@app.route("/alerts")
def get_alerts():
    flagged = DF[DF["safety_alert"] == "Yes"].sort_values("timestamp", ascending=False)

    alerts = []
    for _, row in flagged.iterrows():
        alerts.append({
            "timestamp": row["timestamp"].isoformat(),
            "operator_id": row["operator_id"],
            "machine_id": row["machine_id"],
            "seatbelt_status": row["seatbelt_status"],
            "proximity_distance_m": round(float(row["proximity_distance_m"]), 1),
            "login_location": row["login_location"],
            "reason": safety_alert_reason(row),
        })

    return jsonify(alerts)


@app.route("/incidents", methods=["GET", "POST"])
def incidents_endpoint():
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        operator_id = body.get("operator_id")
        machine_id = body.get("machine_id")
        description = body.get("description")
        if not operator_id or not machine_id or not description:
            return jsonify({"error": "operator_id, machine_id and description are required"}), 400

        incident = incidents_module.add_manual_incident(
            operator_id, machine_id, description, body.get("timestamp")
        )
        return jsonify(incident), 201

    return jsonify(incidents_module.all_incidents(DF))


@app.route("/behavior-anomalies")
def get_behavior_anomalies():
    return jsonify(BEHAVIOR_ANOMALIES)


@app.route("/security-anomalies")
def get_security_anomalies():
    return jsonify(SECURITY_ANOMALIES)


@app.route("/training")
def get_training():
    operator_id = request.args.get("operator_id")
    if not operator_id:
        return jsonify({"error": "operator_id query param is required"}), 400

    recs = recommend_training(operator_id, DF, BEHAVIOR_ANOMALIES, SECURITY_ANOMALIES)
    return jsonify(recs)


@app.route("/trust-score")
def get_trust_score():
    operator_id = request.args.get("operator_id")

    if operator_id:
        history = TRUST_SCORES.get(operator_id)
        if not history:
            return jsonify({"error": f"unknown operator_id '{operator_id}'"}), 404
        return jsonify({
            "operator_id": operator_id,
            "current_score": history[-1]["trust_score"],
            "history": history,
        })

    leaderboard = [
        {"operator_id": op, "current_score": history[-1]["trust_score"]}
        for op, history in TRUST_SCORES.items()
    ]
    leaderboard.sort(key=lambda r: r["current_score"], reverse=True)
    return jsonify(leaderboard)


# metric name -> source column to diff (None = metric is already per-reading, no diff needed)
METRIC_SOURCE_COLUMN = {
    "idling_time_min": None,
    "proximity_distance_m": None,
    "load_cycles_delta": "load_cycles",
    "fuel_used_L_delta": "fuel_used_L",
}


@app.route("/operator-history")
def get_operator_history():
    """Daily mean of one metric for one operator, across the full dataset,
    plus that operator's overall baseline mean/std for the same metric -
    powers the frontend's drift chart, heatmap calendar, and radar chart
    (no existing endpoint exposes raw historical trends or per-metric
    baselines, only flagged-anomaly rows or daily rollup counts)."""
    operator_id = request.args.get("operator_id")
    metric = request.args.get("metric", "idling_time_min")

    if not operator_id:
        return jsonify({"error": "operator_id query param is required"}), 400
    if metric not in METRIC_SOURCE_COLUMN:
        return jsonify({"error": f"metric must be one of {sorted(METRIC_SOURCE_COLUMN)}"}), 400

    source_col = METRIC_SOURCE_COLUMN[metric]
    df = _with_delta(DF, source_col) if source_col else DF

    op_rows = df[df["operator_id"] == operator_id].copy()
    if op_rows.empty:
        return jsonify({
            "operator_id": operator_id, "metric": metric, "daily": [],
            "baseline_mean": None, "baseline_std": None,
        })

    baseline_mean = float(op_rows[metric].mean())
    baseline_std = float(op_rows[metric].std() or 0)

    op_rows["date"] = op_rows["timestamp"].dt.date
    daily = op_rows.groupby("date")[metric].mean().round(2).sort_index()

    return jsonify({
        "operator_id": operator_id,
        "metric": metric,
        "baseline_mean": round(baseline_mean, 2),
        "baseline_std": round(baseline_std, 2),
        "daily": [{"date": d.isoformat(), "value": float(v)} for d, v in daily.items()],
    })


@app.route("/zones")
def get_zones():
    """Distinct login_location values seen in the dataset, most-common first -
    powers the Site Threat Map's zone layout. A real jobsite zone has many
    readings; a one-off value (like the seeded anomaly's 'Unregistered -
    Remote VPN') sorts to the bottom, naturally separating real zones from
    anomalous ones without hardcoding either list."""
    counts = DF["login_location"].value_counts()
    zones = [{"name": name, "reading_count": int(count)} for name, count in counts.items()]
    return jsonify(zones)


@app.route("/task-history")
def get_task_history():
    """Recent tasks (across all days, not just today) for one operator, with
    both the real actual duration and the model's predicted duration -
    powers the Task Time Estimation section's predicted-vs-actual chart."""
    operator_id = request.args.get("operator_id")
    limit = request.args.get("limit", default=12, type=int)
    if not operator_id:
        return jsonify({"error": "operator_id query param is required"}), 400

    op_rows = DF[DF["operator_id"] == operator_id]
    if op_rows.empty:
        return jsonify([])

    records = []
    for task_id, g in op_rows.groupby("task_id"):
        last_row = g.sort_values("timestamp").iloc[-1]
        features = {f: float(last_row[f]) for f in FEATURES}
        predicted = predict_duration(DURATION_MODEL, features)
        records.append({
            "task_id": task_id,
            "task_type": last_row["task_type"],
            "timestamp": last_row["timestamp"].isoformat(),
            "actual_duration_min": round(float(last_row["task_duration_actual"]), 1),
            "predicted_duration_min": round(predicted, 1),
            "features": {f: round(v, 2) for f, v in features.items()},
        })

    records.sort(key=lambda r: r["timestamp"], reverse=True)
    return jsonify(records[:limit])


@app.route("/integrity-summary")
def get_integrity_summary():
    operator_id = request.args.get("operator_id")
    if not operator_id:
        return jsonify({"error": "operator_id query param is required"}), 400
    return jsonify(compute_integrity_summary(DF, operator_id, LATEST_DATE))


@app.route("/shift-handoff")
def get_shift_handoff():
    operator_id = request.args.get("operator_id")
    if not operator_id:
        return jsonify({"error": "operator_id query param is required"}), 400
    if operator_id not in TRUST_SCORES:
        return jsonify({"error": f"unknown operator_id '{operator_id}'"}), 404
    return jsonify(compute_shift_handoff(DF, operator_id, BEHAVIOR_ANOMALIES, SECURITY_ANOMALIES))


@app.route("/copilot", methods=["GET", "POST"])
def copilot_endpoint():
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        operator_id = body.get("operator_id")
        question = body.get("question")
    else:
        operator_id = request.args.get("operator_id")
        question = request.args.get("question")

    if not operator_id:
        return jsonify({"error": "operator_id is required"}), 400
    if operator_id not in TRUST_SCORES:
        return jsonify({"error": f"unknown operator_id '{operator_id}'"}), 404

    answer = answer_question(
        operator_id, question, DF, BEHAVIOR_ANOMALIES, SECURITY_ANOMALIES, TRUST_SCORES, LATEST_DATE
    )
    return jsonify({"operator_id": operator_id, "question": question, "answer": answer})


@app.route("/predict-task-time")
def get_predict_task_time():
    try:
        features = {f: float(request.args[f]) for f in FEATURES}
    except (KeyError, ValueError):
        return jsonify({
            "error": f"all of these query params are required as numbers: {', '.join(FEATURES)}"
        }), 400

    predicted = predict_duration(DURATION_MODEL, features)
    return jsonify({
        "predicted_duration_min": round(predicted, 1),
        "features_used": features,
        "model": "LinearRegression",
        "model_metrics": DURATION_MODEL_METRICS,
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
