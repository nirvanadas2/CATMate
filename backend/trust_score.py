"""Per-operator, per-day trust score.

trust_score = 100
              - (safety_violation_rate * W_SAFETY)
              - (behavior_anomaly_count * W_BEHAVIOR)
              - (security_anomaly_count * W_SECURITY)
              + (training_completed_bonus * W_TRAINING)

training_completed_bonus is a placeholder (always 0) until Phase 3+ tracks
real training completions; the weight is kept so the formula/endpoint shape
is already correct for that hookup.
"""

import pandas as pd

W_SAFETY = 40.0
W_BEHAVIOR = 6.0
W_SECURITY = 12.0
W_TRAINING = 5.0


def compute_trust_scores(
    df: pd.DataFrame,
    behavior_anomalies: list[dict],
    security_anomalies: list[dict],
) -> dict[str, list[dict]]:
    df = df.copy()
    df["date"] = df["timestamp"].dt.date

    behavior_df = pd.DataFrame(behavior_anomalies)
    if not behavior_df.empty:
        behavior_df["date"] = pd.to_datetime(behavior_df["timestamp"]).dt.date

    security_df = pd.DataFrame(security_anomalies)
    if not security_df.empty:
        security_df["date"] = pd.to_datetime(security_df["timestamp"]).dt.date

    results: dict[str, list[dict]] = {}
    for operator_id, g in df.groupby("operator_id"):
        daily = []
        for date, day_rows in g.groupby("date"):
            safety_violation_rate = float((day_rows["safety_alert"] == "Yes").mean())

            behavior_count = 0
            if not behavior_df.empty:
                behavior_count = int(
                    ((behavior_df["operator_id"] == operator_id) & (behavior_df["date"] == date)).sum()
                )

            security_count = 0
            if not security_df.empty:
                security_count = int(
                    ((security_df["operator_id"] == operator_id) & (security_df["date"] == date)).sum()
                )

            training_completed_bonus = 0

            score = (
                100.0
                - (safety_violation_rate * W_SAFETY)
                - (behavior_count * W_BEHAVIOR)
                - (security_count * W_SECURITY)
                + (training_completed_bonus * W_TRAINING)
            )
            score = max(0.0, min(100.0, score))

            daily.append({
                "date": date.isoformat(),
                "trust_score": round(score, 1),
                "safety_violation_rate": round(safety_violation_rate, 3),
                "behavior_anomaly_count": behavior_count,
                "security_anomaly_count": security_count,
                "training_completed_bonus": training_completed_bonus,
            })

        daily.sort(key=lambda d: d["date"])
        results[operator_id] = daily

    return results
