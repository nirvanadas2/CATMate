"""Loads the CATMate synthetic dataset once at startup."""

from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CSV_PATH = DATA_DIR / "catmate_data.csv"


def load_data() -> pd.DataFrame:
    df = pd.read_csv(CSV_PATH, parse_dates=["timestamp"])
    return df.sort_values("timestamp").reset_index(drop=True)


DF = load_data()
LATEST_DATE = DF["timestamp"].max().date()  # treated as "today" for demo purposes
