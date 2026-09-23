# CATMate — Scope Lock (Phase 0)

## Project Name

**CATMate** — an intelligent companion for CAT machine operators, covering safety, training, and productivity in one dashboard.

## Locked Feature List (all required, from the problem statement)

- **Daily task dashboard** — scheduled tasks for the day
- **Safety features** — seatbelt compliance, proximity hazards, incident logging
- **Operator training hub** — adaptive micro-learning tied to flagged behavior
- **Unusual behavior detection** — excessive idling, unsafe operation patterns
- **Task time estimation** — predict completion time from past data + conditions
- **Cybersecurity module (novelty add-on)** — anomalous login detection (new device/location per operator), sensor tamper/spoofing detection (implausible values, signature mismatch). Built on the same anomaly engine as unusual-behavior detection, not a separate bolt-on.

## Novelty Angles to Build (not more — keep scope tight)

- **Behavioral fingerprinting** — per-operator baseline, deviations flagged as safety OR security
- **Trust score** — single rolled-up per-operator metric (safety compliance + anomaly count + training completion)
- **Explainability** — every alert shows a plain-English reason, not just a flag

## Stack (locked — do not revisit later)

- **Backend**: Python + Flask, REST API
- **Data store**: SQLite or CSV (decide in Phase 1, assume clean synthetic data)
- **ML**: scikit-learn only, simple/explainable models (linear/decision tree regression, z-score/threshold anomaly detection)
- **Frontend**: plain HTML/CSS/JS, no build step, Chart.js via CDN
- **Run locally**: `python app.py` + opening `index.html` — no cloud deployment needed

## Roles

- **Data/ML**: _(placeholder)_
- **Backend**: _(placeholder)_
- **Frontend**: _(placeholder)_
- **Demo/Deck owner**: _(placeholder)_

## Out of Scope for Today (cut first if time runs short)

- Real training video production (use placeholder cards)
- Site heatmap / digital twin visual
- Auth system, real device integration, cloud deployment
