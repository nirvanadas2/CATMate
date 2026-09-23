"""Shift Handoff: an end-of-shift note for the next operator.

Everything here is derived from the operator's most recent shift in the
dataset plus the anomaly engine's existing output (safety alert reasons,
security anomalies, behavior deviations) - the summary sentence is assembled
from whichever of those flags actually fired, not from a fixed template.
"""

import pandas as pd

from anomaly_engine import PROXIMITY_HAZARD_THRESHOLD_M, safety_alert_reason

# A shift metric is called out when it's this far from the operator's usual
# shift (median of their earlier shifts - robust to one spoofed day).
IDLE_HIGH_RATIO = 1.25
FUEL_HIGH_RATIO = 1.15
LOAD_LOW_RATIO = 0.75
ENGINE_HOURS_HIGH_RATIO = 1.25

NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]

SECURITY_LABELS = {
    "login_mismatch": "login from an unrecognized device/location",
    "invalid_signature": "failed sensor-data signature",
    "implausible_sensor_value": "physically implausible sensor reading",
}

BEHAVIOR_LABELS = {
    "idling_time_min": "idling",
    "proximity_distance_m": "proximity",
    "load_cycles_delta": "load-cycle",
}


def _count(n: int, noun: str, capitalize: bool = False) -> str:
    word = NUMBER_WORDS[n] if n < len(NUMBER_WORDS) else str(n)
    if capitalize:
        word = word.capitalize()
    return f"{word} {noun}{'' if n == 1 else 's'}"


def _clock(ts: pd.Timestamp) -> str:
    return ts.strftime("%I:%M %p").lstrip("0")


def _shift_totals(rows: pd.DataFrame) -> dict:
    """Fuel, load cycles and engine hours are cumulative per-machine counters,
    so a shift's usage is last-minus-first within each machine."""
    by_machine = rows.groupby("machine_id")
    span = lambda col: float(by_machine[col].agg(lambda s: s.max() - s.min()).sum())
    return {
        "fuel_used_L": span("fuel_used_L"),
        "idling_time_min": float(rows["idling_time_min"].sum()),
        "load_cycles": span("load_cycles"),
        "engine_hours": span("engine_hours"),
    }


def _alert_kind(row) -> str:
    kinds = []
    if row["seatbelt_status"] == "Unfastened":
        kinds.append("seatbelt")
    if 0 <= row["proximity_distance_m"] < PROXIMITY_HAZARD_THRESHOLD_M:
        kinds.append("proximity")
    return " and ".join(kinds) or "safety"


def _idle_rise_streak(daily_idle: pd.Series) -> int:
    """How many consecutive shifts (ending with the latest) idle time rose."""
    streak = 0
    values = daily_idle.tolist()
    for prev, cur in zip(reversed(values[:-1]), reversed(values)):
        if cur > prev:
            streak += 1
        else:
            break
    return streak


def compute_shift_handoff(df: pd.DataFrame, operator_id: str, behavior_anomalies: list[dict], security_anomalies: list[dict]) -> dict:
    op_rows = df[df["operator_id"] == operator_id].copy()
    op_rows["date"] = op_rows["timestamp"].dt.date
    shift_date = op_rows["date"].max()
    shift = op_rows[op_rows["date"] == shift_date].sort_values("timestamp")
    earlier = op_rows[op_rows["date"] < shift_date]

    machine_id = shift["machine_id"].mode().iat[0]
    totals = _shift_totals(shift)
    history = {d: _shift_totals(g) for d, g in earlier.groupby("date")}
    baseline = {k: float(pd.Series([h[k] for h in history.values()]).median()) if history else None for k in totals}

    def ratio(key):
        return totals[key] / baseline[key] if baseline[key] else None

    daily_idle = op_rows.groupby("date")["idling_time_min"].sum().sort_index()
    idle_streak = _idle_rise_streak(daily_idle)

    # ---------------------------------------------------------------- events this shift
    day = shift_date.isoformat()
    alert_rows = shift[shift["safety_alert"] == "Yes"]
    safety_alerts = [{
        "timestamp": row["timestamp"].isoformat(),
        "machine_id": row["machine_id"],
        "kind": _alert_kind(row),
        "reason": safety_alert_reason(row),
    } for _, row in alert_rows.iterrows()]

    security = [a for a in security_anomalies if a["operator_id"] == operator_id and a["timestamp"][:10] == day]
    behavior = [a for a in behavior_anomalies if a["operator_id"] == operator_id and a["timestamp"][:10] == day]

    # ---------------------------------------------------------------- metrics
    metrics = []
    for key, label, unit, high, low in [
        ("fuel_used_L", "Fuel used", "L", FUEL_HIGH_RATIO, None),
        ("idling_time_min", "Idle time", "min", IDLE_HIGH_RATIO, None),
        ("load_cycles", "Load cycles", "cycles", None, LOAD_LOW_RATIO),
    ]:
        r = ratio(key)
        flag = "high" if high and r and r >= high else "low" if low and r and r <= low else None
        metrics.append({
            "key": key, "label": label, "unit": unit,
            "value": round(totals[key], 1),
            "baseline": round(baseline[key], 1) if baseline[key] is not None else None,
            "ratio": round(r, 2) if r else None,
            "flag": flag,
        })
    flagged = {m["key"]: m for m in metrics if m["flag"]}

    # ---------------------------------------------------------------- maintenance
    maintenance = []
    if "idling_time_min" in flagged:
        maintenance.append({
            "check": "Inspect the hydraulic system and engine auto-idle settings",
            "reason": f"Idle time was {flagged['idling_time_min']['ratio']:.1f}x this operator's usual shift — rule out a hydraulic or idle-control fault before assuming it's operator behavior.",
        })
    if "fuel_used_L" in flagged:
        maintenance.append({
            "check": "Check for fuel leaks and a restricted air filter",
            "reason": f"Fuel use was {flagged['fuel_used_L']['ratio']:.1f}x the usual shift.",
        })
    sensors = {a.get("sensor") for a in security if a["anomaly_type"] == "implausible_sensor_value"}
    if "proximity" in sensors:
        maintenance.append({"check": "Verify proximity sensor calibration", "reason": "The proximity sensor reported a physically impossible negative distance this shift."})
    if "engine_hours" in sensors:
        maintenance.append({"check": "Verify the engine-hour meter and ECU telemetry", "reason": "Engine hours went backwards this shift — the counter can't be trusted for service scheduling until checked."})
    if any(a["anomaly_type"] == "invalid_signature" for a in security):
        maintenance.append({"check": "Inspect the telematics module and firmware for tampering", "reason": "Sensor data failed its integrity signature this shift."})
    eh_ratio = ratio("engine_hours")
    if not sensors and eh_ratio and eh_ratio >= ENGINE_HOURS_HIGH_RATIO:
        maintenance.append({"check": "Bring the next service interval forward", "reason": f"The machine logged {totals['engine_hours']:.1f} engine hours this shift, {eh_ratio:.1f}x the usual."})

    # ---------------------------------------------------------------- status
    status_reasons = []
    if safety_alerts:
        n = len(safety_alerts)
        status_reasons.append(f"{n} safety alert{'' if n == 1 else 's'}")
    if security:
        n = len(security)
        status_reasons.append(f"{n} integrity issue{'' if n == 1 else 's'}")
    status = "needs_attention" if status_reasons else "normal"

    # ---------------------------------------------------------------- summary
    sentences = []

    metric_clauses = []
    if "idling_time_min" in flagged:
        m = flagged["idling_time_min"]
        clause = f"idle time was {round((m['ratio'] - 1) * 100)}% higher than baseline ({m['value']:.0f} vs. {m['baseline']:.0f} min)"
        if idle_streak >= 3:
            clause += f" and has risen for {idle_streak} shifts in a row"
        metric_clauses.append(clause)
    if "fuel_used_L" in flagged:
        m = flagged["fuel_used_L"]
        metric_clauses.append(f"fuel use was {round((m['ratio'] - 1) * 100)}% above baseline")
    if "load_cycles" in flagged:
        m = flagged["load_cycles"]
        metric_clauses.append(f"load cycles were {round((1 - m['ratio']) * 100)}% below baseline ({m['value']:.0f} vs. {m['baseline']:.0f})")

    opener = f"{machine_id} operated normally" if status == "normal" else f"{machine_id} needs attention before the next shift"
    if metric_clauses:
        sentences.append(f"{opener}{', but ' if status == 'normal' else ' — '}{'; '.join(metric_clauses)}.")
    elif status == "normal":
        sentences.append(f"{opener}, with fuel use, idle time and load cycles all in line with {operator_id}'s usual shift.")
    else:
        sentences.append(f"{opener}.")

    if safety_alerts:
        last = pd.Timestamp(safety_alerts[0]["timestamp"])
        if len(safety_alerts) == 1:
            sentences.append(f"One {safety_alerts[0]['kind']} alert occurred during the shift, at {_clock(last)}.")
        else:
            last = max(pd.Timestamp(a["timestamp"]) for a in safety_alerts)
            seatbelt = sum("seatbelt" in a["kind"] for a in safety_alerts)
            proximity = sum("proximity" in a["kind"] for a in safety_alerts)
            n = len(safety_alerts)
            share = lambda k: ("both" if n == 2 else f"all {n}") if k == n else str(k)
            parts = [p for p in [f"{share(seatbelt)} involved an unfastened seatbelt" if seatbelt else "", f"{share(proximity)} a proximity hazard" if proximity else ""] if p]
            sentences.append(f"{_count(n, 'safety alert', capitalize=True)} occurred during the shift ({' and '.join(parts)}); the last was at {_clock(last)}.")
    else:
        sentences.append("No safety alerts were raised.")

    if security:
        kinds = sorted({SECURITY_LABELS.get(a["anomaly_type"], a["anomaly_type"]) for a in security})
        sentences.append(f"{_count(len(security), 'integrity issue', capitalize=True)} {'was' if len(security) == 1 else 'were'} flagged ({', '.join(kinds)}) — don't trust this machine's sensor data until it's been checked.")

    if behavior:
        by_metric = pd.Series([a["metric"] for a in behavior]).value_counts()
        parts = [BEHAVIOR_LABELS.get(metric, metric) if len(by_metric) == 1 else f"{n} {BEHAVIOR_LABELS.get(metric, metric)}" for metric, n in by_metric.items()]
        sentences.append(f"The anomaly engine also flagged {_count(len(behavior), 'behavior deviation')} ({', '.join(parts)}).")

    return {
        "operator_id": operator_id,
        "machine_id": machine_id,
        "shift": {
            "date": day,
            "start": shift["timestamp"].min().isoformat(),
            "end": shift["timestamp"].max().isoformat(),
            "readings": int(len(shift)),
            "baseline_shifts": len(history),
        },
        "status": status,
        "status_reasons": status_reasons,
        "metrics": metrics,
        "idle_rise_streak": idle_streak,
        "safety_alerts": safety_alerts,
        "security_anomalies": security,
        "behavior_deviations": [{"timestamp": a["timestamp"], "metric": a["metric"], "reason": a["reason"]} for a in behavior],
        "maintenance": maintenance,
        "summary": " ".join(sentences),
    }
