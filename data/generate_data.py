"""
CATMate synthetic data generator (Phase 1).

Produces data/catmate_data.csv (and data/catmate_data.db) matching the schema
in docs/SCOPE.md: one row per sensor/status reading, timestamped, across a
handful of operators and machines over multiple shift-days.

Two deliberate story beats are seeded for the demo (see the SEEDED STORY
PATTERNS section below):
  1. OP1001 shows a gradual multi-day drift (rising idling time, more
     unfastened-seatbelt readings, shrinking proximity distance).
  2. One single reading is corrupted into an implausible, spoofed-looking
     sensor/credential anomaly (impossible proximity value, engine hours
     jumping backwards, unrecognized login device/location).
"""

import random
import sqlite3
from datetime import timedelta, datetime
from pathlib import Path

import numpy as np
import pandas as pd

RANDOM_SEED = 42
random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)

OUT_DIR = Path(__file__).resolve().parent
CSV_PATH = OUT_DIR / "catmate_data.csv"
DB_PATH = OUT_DIR / "catmate_data.db"

OPERATORS = ["OP1001", "OP1002", "OP1003", "OP1004"]
MACHINES = ["EXC001", "EXC002", "LDR001"]
TASK_TYPES = ["Digging", "Loading", "Grading", "Transport"]
FIRMWARE_VERSIONS = {"EXC001": "v2.3.1", "EXC002": "v2.3.1", "LDR001": "v2.2.4"}

NUM_DAYS = 10
START_DATE = datetime(2026, 9, 13)
SHIFT_START_HOUR = 6
SHIFT_END_HOUR = 18
READING_FREQ = "45min"  # multiple readings per operator per day during the shift

TASK_DURATION_RANGE_MIN = {
    "Digging": (60, 180),
    "Loading": (30, 90),
    "Grading": (45, 150),
    "Transport": (20, 90),
}

# Each operator's normal login identity - used for every row except the
# seeded credential/sensor anomaly below.
NORMAL_LOGIN = {
    "OP1001": ("TAB-1001-A", "North Pit - Zone 1"),
    "OP1002": ("TAB-1002-A", "North Pit - Zone 2"),
    "OP1003": ("TAB-1003-A", "South Quarry - Zone 1"),
    "OP1004": ("TAB-1004-A", "South Quarry - Zone 2"),
}

PRIMARY_MACHINE = {
    "OP1001": "EXC001",
    "OP1002": "EXC002",
    "OP1003": "LDR001",
    "OP1004": None,  # OP1004 rotates machines day to day, resolved below
}

# --- Seeded story pattern 2 target: which reading gets corrupted ---
ANOMALY_OPERATOR = "OP1002"
ANOMALY_DAY_IDX = NUM_DAYS // 2
ANOMALY_HOUR = 12


def machine_for(operator: str, day_idx: int) -> str:
    if operator == "OP1004":
        return "EXC001" if day_idx % 2 == 0 else "LDR001"
    return PRIMARY_MACHINE[operator]


def build_task_blocks(reading_times: list) -> list:
    """Split a day's readings into 2-6 contiguous task blocks."""
    blocks = []
    remaining = list(range(len(reading_times)))
    while remaining:
        block_len = min(len(remaining), random.randint(3, 6))
        block_indices = remaining[:block_len]
        remaining = remaining[block_len:]
        blocks.append(block_indices)
    return blocks


def generate() -> pd.DataFrame:
    machine_state = {
        m: {
            "engine_hours": round(random.uniform(800, 3000), 1),
            "fuel_used_L": round(random.uniform(5000, 20000), 1),
            "load_cycles": random.randint(2000, 8000),
        }
        for m in MACHINES
    }

    task_counter = {}
    rows = []

    for day_idx in range(NUM_DAYS):
        day = START_DATE + timedelta(days=day_idx)
        drift_factor = day_idx / (NUM_DAYS - 1)  # 0..1 across the date range

        shift_start = day.replace(hour=SHIFT_START_HOUR, minute=0)
        shift_end = day.replace(hour=SHIFT_END_HOUR, minute=0)
        reading_times = list(pd.date_range(shift_start, shift_end, freq=READING_FREQ))

        for operator in OPERATORS:
            machine_id = machine_for(operator, day_idx)
            device_id, location = NORMAL_LOGIN[operator]

            for block_indices in build_task_blocks(reading_times):
                task_type = random.choice(TASK_TYPES)
                task_counter[operator] = task_counter.get(operator, 0) + 1
                task_id = f"TASK-{operator}-{task_counter[operator]:04d}"
                dur_low, dur_high = TASK_DURATION_RANGE_MIN[task_type]
                task_duration_actual = round(random.uniform(dur_low, dur_high), 1)

                for idx in block_indices:
                    ts = reading_times[idx]
                    state = machine_state[machine_id]
                    state["engine_hours"] = round(state["engine_hours"] + random.uniform(0.8, 1.2), 1)
                    state["fuel_used_L"] = round(state["fuel_used_L"] + random.uniform(12, 22), 1)
                    state["load_cycles"] += random.randint(1, 4)

                    if operator == "OP1001":
                        # SEEDED STORY PATTERN 1: gradual worsening drift over the days.
                        idling = float(np.clip(np.random.normal(5 + 25 * drift_factor, 3), 0, None))
                        unfastened_prob = 0.05 + 0.55 * drift_factor
                        proximity = float(np.clip(np.random.normal(18 - 14 * drift_factor, 3), 0.5, None))
                    else:
                        idling = float(np.clip(np.random.normal(6, 3), 0, None))
                        unfastened_prob = 0.03
                        proximity = float(np.clip(np.random.normal(18, 4), 1.0, None))

                    seatbelt_status = "Unfastened" if random.random() < unfastened_prob else "Fastened"
                    safety_alert = "Yes" if (seatbelt_status == "Unfastened" or proximity < 2.0) else "No"

                    rows.append(
                        {
                            "timestamp": ts,
                            "machine_id": machine_id,
                            "operator_id": operator,
                            "engine_hours": state["engine_hours"],
                            "fuel_used_L": state["fuel_used_L"],
                            "load_cycles": state["load_cycles"],
                            "idling_time_min": round(idling, 1),
                            "seatbelt_status": seatbelt_status,
                            "proximity_distance_m": round(proximity, 1),
                            "safety_alert": safety_alert,
                            "task_id": task_id,
                            "task_type": task_type,
                            "task_duration_actual": task_duration_actual,
                            "login_device_id": device_id,
                            "login_location": location,
                            "data_signature_valid": True,
                            "firmware_version": FIRMWARE_VERSIONS[machine_id],
                        }
                    )

    df = pd.DataFrame(rows).sort_values(["timestamp", "operator_id"]).reset_index(drop=True)
    return df


def seed_cybersecurity_anomaly(df: pd.DataFrame) -> int:
    """SEEDED STORY PATTERN 2: corrupt one reading into a spoofed-sensor /
    credential-anomaly row. Returns the row index that was corrupted."""
    target_date = (START_DATE + timedelta(days=ANOMALY_DAY_IDX)).date()
    mask = (
        (df["operator_id"] == ANOMALY_OPERATOR)
        & (df["timestamp"].dt.date == target_date)
        & (df["timestamp"].dt.hour == ANOMALY_HOUR)
    )
    candidates = df[mask].index
    if len(candidates) == 0:
        raise RuntimeError("No candidate row found for the seeded cybersecurity anomaly.")
    idx = candidates[0]

    prev_engine_hours = df.loc[idx, "engine_hours"]
    df.loc[idx, "data_signature_valid"] = False
    df.loc[idx, "proximity_distance_m"] = -8.4  # impossible negative reading
    df.loc[idx, "engine_hours"] = round(prev_engine_hours - 150.0, 1)  # jumps backwards
    df.loc[idx, "login_device_id"] = "UNKNOWN-DEV-9911"
    df.loc[idx, "login_location"] = "Unregistered - Remote VPN"
    df.loc[idx, "safety_alert"] = "Yes"
    return idx


def save(df: pd.DataFrame) -> None:
    df_out = df.copy()
    df_out["timestamp"] = df_out["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    df_out.to_csv(CSV_PATH, index=False)

    conn = sqlite3.connect(DB_PATH)
    try:
        df_out.to_sql("readings", conn, if_exists="replace", index=False)
    finally:
        conn.close()


def print_summary(df: pd.DataFrame, anomaly_idx: int) -> None:
    print("=" * 60)
    print("CATMate synthetic dataset generated")
    print("=" * 60)
    print(f"Rows:        {len(df)}")
    print(f"Date range:  {df['timestamp'].min()}  ->  {df['timestamp'].max()}")
    print(f"Operators:   {', '.join(sorted(df['operator_id'].unique()))}")
    print(f"Machines:    {', '.join(sorted(df['machine_id'].unique()))}")
    print(f"CSV saved:   {CSV_PATH}")
    print(f"SQLite saved:{DB_PATH}")

    print("\n--- Seeded story pattern 1: OP1001 gradual drift ---")
    daily = (
        df[df["operator_id"] == "OP1001"]
        .assign(date=lambda d: d["timestamp"].dt.date)
        .groupby("date")
        .agg(
            avg_idling_min=("idling_time_min", "mean"),
            pct_unfastened=("seatbelt_status", lambda s: round((s == "Unfastened").mean() * 100, 1)),
            avg_proximity_m=("proximity_distance_m", "mean"),
        )
        .round(1)
    )
    print(daily.to_string())
    print("-> idling time rises, % unfastened rises, proximity distance falls day over day.")

    print("\n--- Seeded story pattern 2: cybersecurity anomaly row ---")
    anomaly_row = df.loc[anomaly_idx]
    print(anomaly_row.to_string())
    print(
        f"-> row index {anomaly_idx}: data_signature_valid=False, impossible proximity_distance_m, "
        "engine_hours jumped backwards, and login_device_id/login_location do not match "
        f"{ANOMALY_OPERATOR}'s normal pattern ({NORMAL_LOGIN[ANOMALY_OPERATOR]})."
    )


def main() -> None:
    df = generate()
    anomaly_idx = seed_cybersecurity_anomaly(df)
    save(df)
    print_summary(df, anomaly_idx)


if __name__ == "__main__":
    main()
