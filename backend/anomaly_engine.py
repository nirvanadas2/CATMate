"""Shared anomaly engine.

Both the "unusual behavior" story (operator drifting into risky habits) and the
"cybersecurity" story (spoofed sensors / credential anomalies) are detected
here with the same building blocks: per-operator baselines + z-scores for
behavior, and rule checks against plausibility/identity for security. Kept in
one module per docs/SCOPE.md ("built on the same anomaly engine ... not a
separate bolt-on").
"""

import pandas as pd

Z_THRESHOLD = 2.0
PROXIMITY_HAZARD_THRESHOLD_M = 2.0


def _with_load_cycle_delta(df: pd.DataFrame) -> pd.DataFrame:
    """load_cycles is a cumulative counter; the per-reading *increment* is the
    behaviorally meaningful signal, so we diff it per operator."""
    df = df.sort_values(["operator_id", "timestamp"]).copy()
    df["load_cycles_delta"] = df.groupby("operator_id")["load_cycles"].diff().fillna(0)
    return df


def compute_behavior_anomalies(df: pd.DataFrame) -> list[dict]:
    """Per-operator baseline (mean/std) vs each reading; flag z-score outliers
    in the direction that actually indicates risk."""
    df = _with_load_cycle_delta(df)
    anomalies: list[dict] = []

    for operator_id, g in df.groupby("operator_id"):
        idling_mean, idling_std = g["idling_time_min"].mean(), g["idling_time_min"].std()
        prox_mean, prox_std = g["proximity_distance_m"].mean(), g["proximity_distance_m"].std()
        load_mean, load_std = g["load_cycles_delta"].mean(), g["load_cycles_delta"].std()

        for _, row in g.iterrows():
            ts = row["timestamp"].isoformat()
            base = {
                "operator_id": operator_id,
                "machine_id": row["machine_id"],
                "timestamp": ts,
            }

            if idling_std > 0:
                z = (row["idling_time_min"] - idling_mean) / idling_std
                if z > Z_THRESHOLD:
                    ratio = row["idling_time_min"] / max(idling_mean, 0.1)
                    anomalies.append({
                        **base,
                        "metric": "idling_time_min",
                        "current_value": round(float(row["idling_time_min"]), 1),
                        "baseline_value": round(float(idling_mean), 1),
                        "z_score": round(float(z), 2),
                        "reason": (
                            f"Idling time ({row['idling_time_min']:.1f} min) is {ratio:.1f}x "
                            f"{operator_id}'s average ({idling_mean:.1f} min)."
                        ),
                    })

            if prox_std > 0:
                z = (row["proximity_distance_m"] - prox_mean) / prox_std
                if z < -Z_THRESHOLD:
                    pct_below = (1 - row["proximity_distance_m"] / max(prox_mean, 0.1)) * 100
                    anomalies.append({
                        **base,
                        "metric": "proximity_distance_m",
                        "current_value": round(float(row["proximity_distance_m"]), 1),
                        "baseline_value": round(float(prox_mean), 1),
                        "z_score": round(float(z), 2),
                        "reason": (
                            f"Proximity distance ({row['proximity_distance_m']:.1f} m) is "
                            f"{pct_below:.0f}% below {operator_id}'s average ({prox_mean:.1f} m)."
                        ),
                    })

            if load_std > 0:
                z = (row["load_cycles_delta"] - load_mean) / load_std
                if abs(z) > Z_THRESHOLD:
                    direction = "higher" if z > 0 else "lower"
                    anomalies.append({
                        **base,
                        "metric": "load_cycles_delta",
                        "current_value": round(float(row["load_cycles_delta"]), 1),
                        "baseline_value": round(float(load_mean), 1),
                        "z_score": round(float(z), 2),
                        "reason": (
                            f"Load-cycle activity ({row['load_cycles_delta']:.0f} cycles since last "
                            f"reading) is {direction} than {operator_id}'s average "
                            f"({load_mean:.1f} cycles)."
                        ),
                    })

    anomalies.sort(key=lambda a: a["timestamp"], reverse=True)
    return anomalies


def compute_security_anomalies(df: pd.DataFrame) -> list[dict]:
    """Login-identity mismatches, failed signature checks, and physically
    implausible sensor values."""
    df = df.sort_values(["machine_id", "operator_id", "timestamp"]).copy()
    # Compared within the same (machine, operator) stream, not machine alone:
    # two operators can share a machine on different days/shifts, and their
    # interleaved-by-timestamp readings aren't a real consecutive sequence.
    df["engine_hours_prev"] = df.groupby(["machine_id", "operator_id"])["engine_hours"].shift(1)

    usual = (
        df[df["data_signature_valid"]]
        .groupby("operator_id")[["login_device_id", "login_location"]]
        .agg(lambda s: s.mode().iat[0])
    )

    anomalies: list[dict] = []
    for _, row in df.iterrows():
        operator_id = row["operator_id"]
        ts = row["timestamp"].isoformat()
        base = {"operator_id": operator_id, "machine_id": row["machine_id"], "timestamp": ts}
        usual_device = usual.loc[operator_id, "login_device_id"]
        usual_location = usual.loc[operator_id, "login_location"]

        if row["login_device_id"] != usual_device or row["login_location"] != usual_location:
            anomalies.append({
                **base,
                "anomaly_type": "login_mismatch",
                "reason": (
                    f"Login from device '{row['login_device_id']}' at '{row['login_location']}' "
                    f"does not match {operator_id}'s usual device/location "
                    f"('{usual_device}' at '{usual_location}')."
                ),
            })

        if not row["data_signature_valid"]:
            anomalies.append({
                **base,
                "anomaly_type": "invalid_signature",
                "reason": "Sensor data failed the integrity/signature check — possible tampering or spoofed telemetry.",
            })

        if row["proximity_distance_m"] < 0:
            anomalies.append({
                **base,
                "anomaly_type": "implausible_sensor_value",
                "reason": (
                    f"Proximity sensor reported {row['proximity_distance_m']:.1f} m — a physically "
                    "impossible negative distance, indicating a spoofed or malfunctioning sensor."
                ),
            })

        if pd.notna(row["engine_hours_prev"]) and row["engine_hours"] < row["engine_hours_prev"]:
            anomalies.append({
                **base,
                "anomaly_type": "implausible_sensor_value",
                "reason": (
                    f"Engine hours dropped from {row['engine_hours_prev']:.1f} to "
                    f"{row['engine_hours']:.1f} — a cumulative counter cannot decrease, indicating "
                    "rolled-back or spoofed telemetry."
                ),
            })

    anomalies.sort(key=lambda a: a["timestamp"], reverse=True)
    return anomalies
