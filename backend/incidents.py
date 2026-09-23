"""Incident log: auto-generated from safety_alert=Yes rows, plus an in-memory
store for manually-logged incidents (POST /incidents)."""

import itertools
from datetime import datetime, timezone

import pandas as pd

HIGH_SEVERITY_PROXIMITY_M = 1.0

_manual_id_counter = itertools.count(1)
_manual_incidents: list[dict] = []


def _incident_type(row: pd.Series) -> str:
    seatbelt = row["seatbelt_status"] == "Unfastened"
    proximity = row["proximity_distance_m"] < 2.0 and row["proximity_distance_m"] >= 0
    if seatbelt and proximity:
        return "seatbelt+proximity"
    if seatbelt:
        return "seatbelt"
    if proximity:
        return "proximity"
    return "other"


def _severity(row: pd.Series) -> str:
    seatbelt = row["seatbelt_status"] == "Unfastened"
    proximity_m = row["proximity_distance_m"]
    if seatbelt and proximity_m < 2.0:
        return "High"
    if 0 <= proximity_m < HIGH_SEVERITY_PROXIMITY_M:
        return "High"
    if seatbelt or proximity_m < 2.0:
        return "Medium"
    return "Low"


def auto_incidents(df: pd.DataFrame) -> list[dict]:
    flagged = df[df["safety_alert"] == "Yes"]
    incidents = []
    for idx, row in flagged.iterrows():
        incidents.append({
            "id": f"INC-AUTO-{idx:04d}",
            "timestamp": row["timestamp"].isoformat(),
            "machine_id": row["machine_id"],
            "operator_id": row["operator_id"],
            "type": _incident_type(row),
            "severity": _severity(row),
            "source": "auto",
            "description": None,
        })
    return incidents


def add_manual_incident(operator_id: str, machine_id: str, description: str, timestamp: str | None) -> dict:
    incident = {
        "id": f"INC-MANUAL-{next(_manual_id_counter):04d}",
        "timestamp": timestamp or datetime.now(timezone.utc).isoformat(),
        "machine_id": machine_id,
        "operator_id": operator_id,
        "type": "manual",
        "severity": "Unspecified",
        "source": "manual",
        "description": description,
    }
    _manual_incidents.append(incident)
    return incident


def all_incidents(df: pd.DataFrame) -> list[dict]:
    incidents = auto_incidents(df) + list(_manual_incidents)
    incidents.sort(key=lambda i: i["timestamp"], reverse=True)
    return incidents
