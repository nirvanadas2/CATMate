"""Simple, explainable task-duration regression model.

Linear regression over four readily-available features. Deliberately not
state-of-the-art: coefficients are directly explainable in a live Q&A.
"""

import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

FEATURES = ["engine_hours", "load_cycles", "fuel_used_L", "idling_time_min"]
TARGET = "task_duration_actual"


def train_duration_model(df: pd.DataFrame):
    X = df[FEATURES]
    y = df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = LinearRegression()
    model.fit(X_train, y_train)

    metrics = {
        "r2": round(float(r2_score(y_test, model.predict(X_test))), 3),
        "mae_min": round(float(mean_absolute_error(y_test, model.predict(X_test))), 1),
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "coefficients": {f: round(float(c), 4) for f, c in zip(FEATURES, model.coef_)},
        "intercept": round(float(model.intercept_), 2),
    }
    return model, metrics


def predict_duration(model: LinearRegression, features: dict) -> float:
    X = pd.DataFrame([[features[f] for f in FEATURES]], columns=FEATURES)
    return float(max(0.0, model.predict(X)[0]))
