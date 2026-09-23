"""Rule-based mapping from flagged anomaly type -> recommended training card."""

import pandas as pd

SEATBELT_UNFASTENED_RATE_THRESHOLD = 0.10  # flag if unfastened in >10% of readings

TRAINING_CARDS = {
    "seatbelt": {"title": "Seatbelt Compliance Refresher", "format": "Micro-video", "duration_min": 5},
    "proximity": {"title": "Proximity Awareness & Hazard Zones", "format": "Interactive simulation", "duration_min": 10},
    "idling": {"title": "Idle Time Reduction & Fuel Efficiency", "format": "Micro-video", "duration_min": 6},
    "security": {"title": "Cybersecurity Basics: Device & Login Hygiene", "format": "Reading + quiz", "duration_min": 8},
    "general": {"title": "General Safe Operating Practices", "format": "Micro-video", "duration_min": 7},
}


def recommend_training(
    operator_id: str,
    df: pd.DataFrame,
    behavior_anomalies: list[dict],
    security_anomalies: list[dict],
) -> list[dict]:
    op_rows = df[df["operator_id"] == operator_id]
    if op_rows.empty:
        return []

    recs = []

    unfastened_rate = (op_rows["seatbelt_status"] == "Unfastened").mean()
    if unfastened_rate > SEATBELT_UNFASTENED_RATE_THRESHOLD:
        recs.append({
            **TRAINING_CARDS["seatbelt"],
            "reason": (
                f"{operator_id} had an unfastened seatbelt in {unfastened_rate * 100:.0f}% of "
                "readings — above the 10% threshold."
            ),
        })

    op_behavior = [a for a in behavior_anomalies if a["operator_id"] == operator_id]

    if any(a["metric"] == "proximity_distance_m" for a in op_behavior):
        recs.append({
            **TRAINING_CARDS["proximity"],
            "reason": f"{operator_id} has proximity-distance readings flagged well below their own baseline.",
        })

    if any(a["metric"] == "idling_time_min" for a in op_behavior):
        recs.append({
            **TRAINING_CARDS["idling"],
            "reason": f"{operator_id} has idling-time readings flagged well above their own baseline.",
        })

    op_security = [a for a in security_anomalies if a["operator_id"] == operator_id]
    if op_security:
        recs.append({
            **TRAINING_CARDS["security"],
            "reason": (
                f"{operator_id} has {len(op_security)} flagged security anomaly event(s) "
                "(login mismatch, invalid signature, or implausible sensor value)."
            ),
        })

    if not recs:
        recs.append({
            **TRAINING_CARDS["general"],
            "reason": f"No flagged anomalies for {operator_id} — general refresher to maintain compliance.",
        })

    return recs
