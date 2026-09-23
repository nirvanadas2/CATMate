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


def safety_alert_reason(row) -> str:
    """WHY text for one safety-flagged reading - shared by /alerts and the
    shift handoff so the same reading always reads the same way."""
    reasons = []
    if row["seatbelt_status"] == "Unfastened":
        reasons.append("seatbelt unfastened")
    if 0 <= row["proximity_distance_m"] < PROXIMITY_HAZARD_THRESHOLD_M:
        reasons.append(
            f"object detected {row['proximity_distance_m']:.1f} m away "
            f"(threshold {PROXIMITY_HAZARD_THRESHOLD_M:.0f} m)"
        )
    return (" and ".join(reasons) or "safety threshold exceeded").capitalize() + "."


def _with_delta(df: pd.DataFrame, column: str) -> pd.DataFrame:
    """Some fields (load_cycles, fuel_used_L, engine_hours) are cumulative
    counters; the per-reading *increment* is the behaviorally meaningful
    signal, so we diff them per operator. Adds an f"{column}_delta" column."""
    df = df.sort_values(["operator_id", "timestamp"]).copy()
    df[f"{column}_delta"] = df.groupby("operator_id")[column].diff().fillna(0)
    return df


def _with_load_cycle_delta(df: pd.DataFrame) -> pd.DataFrame:
    return _with_delta(df, "load_cycles")


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
        base = {
            "operator_id": operator_id,
            "machine_id": row["machine_id"],
            "timestamp": ts,
            "login_location": row["login_location"],
            "login_device_id": row["login_device_id"],
        }
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
                "sensor": "proximity",
                "reason": (
                    f"Proximity sensor reported {row['proximity_distance_m']:.1f} m — a physically "
                    "impossible negative distance, indicating a spoofed or malfunctioning sensor."
                ),
            })

        if pd.notna(row["engine_hours_prev"]) and row["engine_hours"] < row["engine_hours_prev"]:
            anomalies.append({
                **base,
                "anomaly_type": "implausible_sensor_value",
                "sensor": "engine_hours",
                "reason": (
                    f"Engine hours dropped from {row['engine_hours_prev']:.1f} to "
                    f"{row['engine_hours']:.1f} — a cumulative counter cannot decrease, indicating "
                    "rolled-back or spoofed telemetry."
                ),
            })

    anomalies.sort(key=lambda a: a["timestamp"], reverse=True)
    return anomalies


def compute_integrity_summary(df: pd.DataFrame, operator_id: str, on_date) -> dict:
    """Per-category PASS/FAIL check counts for one operator's readings on one
    day - the same checks compute_security_anomalies already runs (device
    identity, data signature, sensor plausibility) plus a firmware check,
    rolled up as category totals instead of a flat event list, so the
    Integrity panel always shows real, live work even when nothing is
    currently flagged."""
    op_rows = df[(df["operator_id"] == operator_id) & (df["timestamp"].dt.date == on_date)].copy()
    if op_rows.empty:
        return {"operator_id": operator_id, "date": on_date.isoformat(), "total_checks": 0, "total_flagged": 0, "categories": []}

    total = len(op_rows)

    valid_sig_rows = df[df["data_signature_valid"] & (df["operator_id"] == operator_id)]
    usual_device = valid_sig_rows["login_device_id"].mode()
    usual_location = valid_sig_rows["login_location"].mode()
    usual_device = usual_device.iat[0] if not usual_device.empty else None
    usual_location = usual_location.iat[0] if not usual_location.empty else None
    device_pass = int(((op_rows["login_device_id"] == usual_device) & (op_rows["login_location"] == usual_location)).sum())

    signature_pass = int(op_rows["data_signature_valid"].sum())

    op_sorted = op_rows.sort_values("timestamp")
    engine_hours_delta = op_sorted.groupby("machine_id")["engine_hours"].diff()
    plausible = (op_sorted["proximity_distance_m"] >= 0) & (engine_hours_delta.isna() | (engine_hours_delta >= 0))
    plausibility_pass = int(plausible.sum())

    machine_expected_fw = df.groupby("machine_id")["firmware_version"].agg(lambda s: s.mode().iat[0])
    expected_fw = op_rows["machine_id"].map(machine_expected_fw)
    firmware_pass = int((op_rows["firmware_version"] == expected_fw).sum())

    categories = [
        {"key": "device_identity", "label": "Device Identity", "passed": device_pass, "total": total},
        {"key": "data_signature", "label": "Data Signature", "passed": signature_pass, "total": total},
        {"key": "sensor_plausibility", "label": "Sensor Plausibility", "passed": plausibility_pass, "total": total},
        {"key": "firmware_version", "label": "Firmware Version", "passed": firmware_pass, "total": total},
    ]
    total_flagged = sum(c["total"] - c["passed"] for c in categories)

    return {
        "operator_id": operator_id,
        "date": on_date.isoformat(),
        "total_checks": total * len(categories),
        "total_flagged": total_flagged,
        "categories": categories,
    }
