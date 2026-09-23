"""CATMate Assistant: a rule-based Q&A copilot.

Keyword/intent matching only - no external LLM call, so it's fully offline
and 100% deterministic for a live demo. Every answer is built from the same
real computed data (df, behavior/security anomalies, trust scores) the rest
of the API serves - nothing here is generic filler text.
"""

import pandas as pd


def _latest_event(operator_id, behavior_anomalies, security_anomalies, alerts_df):
    candidates = []  # (timestamp_str, kind, text)
    for a in behavior_anomalies:
        if a["operator_id"] == operator_id:
            candidates.append((a["timestamp"], "behavior", a["reason"]))
    for a in security_anomalies:
        if a["operator_id"] == operator_id:
            candidates.append((a["timestamp"], "security", a["reason"]))
    for _, row in alerts_df[alerts_df["operator_id"] == operator_id].iterrows():
        bits = []
        if row["seatbelt_status"] == "Unfastened":
            bits.append("seatbelt unfastened")
        if 0 <= row["proximity_distance_m"] < 2.0:
            bits.append(f"an object {row['proximity_distance_m']:.1f} m away")
        candidates.append((row["timestamp"].isoformat(), "safety", ", ".join(bits) or "a safety threshold exceeded"))

    if not candidates:
        return None
    candidates.sort(key=lambda c: c[0], reverse=True)
    return candidates[0]


def answer_question(operator_id, question, df, behavior_anomalies, security_anomalies, trust_scores, latest_date):
    q = (question or "").strip().lower()
    if not q:
        return "Ask me something like “why am I getting this warning?” or “how much idle time did I have today?”"

    history = trust_scores.get(operator_id)
    if not history:
        return f"I don't have data for operator {operator_id}."
    today = history[-1]

    op_rows = df[df["operator_id"] == operator_id]
    today_rows = op_rows[op_rows["timestamp"].dt.date == latest_date]
    op_security_today = [
        a for a in security_anomalies
        if a["operator_id"] == operator_id and a["timestamp"][:10] == str(latest_date)
    ]

    # "why did my readiness score decrease / drop / change"
    if "score" in q and any(w in q for w in ("why", "decrease", "drop", "lower", "down", "change")):
        bits = []
        if today["safety_violation_rate"] > 0:
            bits.append(f"a {today['safety_violation_rate'] * 100:.0f}% safety-alert rate today")
        if today["behavior_anomaly_count"] > 0:
            bits.append(f"{today['behavior_anomaly_count']} flagged behavior deviation(s) today")
        if today["security_anomaly_count"] > 0:
            bits.append(f"{today['security_anomaly_count']} flagged security anomaly event(s) today")
        if not bits:
            return f"Your readiness score is {today['trust_score']}/100 and hasn't dropped today - no safety, behavior, or security flags today."
        return f"Your readiness score is {today['trust_score']}/100. It's down because of {', '.join(bits)}."

    # "how much idle time did I have today"
    if "idle" in q or "idling" in q:
        if today_rows.empty:
            return "I don't have any readings for you today."
        avg_idle = today_rows["idling_time_min"].mean()
        return f"Today you averaged {avg_idle:.1f} minutes of idling per reading, across {len(today_rows)} readings."

    # "is my machine ready for the next task"
    if "ready" in q and ("machine" in q or "task" in q or "next" in q):
        issues = []
        if op_security_today:
            issues.append(f"{len(op_security_today)} unresolved integrity issue(s) flagged today")
        if today["safety_violation_rate"] > 0:
            issues.append("an active safety alert today")
        if issues:
            return f"I wouldn't call it ready yet - {', '.join(issues)}. Check the Integrity and Safety sections before starting."
        return "Yes - no active safety alerts and no integrity issues flagged today. You're clear to start the next task."

    # "what should I check before starting"
    if "check" in q and ("before" in q or "start" in q):
        checklist = ["seatbelt fastened", "clear proximity zone (2m+) before moving"]
        if op_security_today:
            checklist.append("confirm this session's login device/location before trusting sensor data")
        if today["behavior_anomaly_count"] > 0:
            checklist.append("review today's flagged behavior deviations in the Behavior section")
        return "Before starting, check: " + "; ".join(checklist) + "."

    # generic "why am I getting this warning/alert" fallback
    if "why" in q or "warning" in q or "alert" in q:
        latest = _latest_event(operator_id, behavior_anomalies, security_anomalies, df[df["safety_alert"] == "Yes"])
        if not latest:
            return "You don't have any flagged alerts on record."
        ts, kind, text = latest
        when = ts[:16].replace("T", " ")
        return f"Your most recent flagged event was a {kind} alert on {when}: {text}"

    return (
        "I can answer things like: why am I getting this warning, how much idle time I had today, "
        "what to check before starting, whether my machine is ready for the next task, or why my "
        "readiness score changed."
    )
