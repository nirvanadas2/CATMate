# CATMate — Live Demo Script

**Target length:** ~3.5 minutes. **Setup before you start:** run `python app.py` in `backend/`,
then open `frontend/index.html` in a browser. Confirm the top-right badge says "Backend
connected" before you begin talking.

All numbers below are real, seeded dataset values confirmed in testing — the demo will show the
same numbers every time you run it.

---

## Opening (10–15s)

> "Caterpillar operators today juggle safety compliance, training, and productivity across
> separate systems. CATMate puts all three in one dashboard, built on a single explainable
> anomaly engine — so every alert tells you not just *what* happened, but *why*, and *what to
> do next*."

---

## Step-by-step

### 1. Land on OP1001 (default operator) — Shift Health strip
**Click/point:** the four chips at the top (Safety, Behavior, Integrity, Training).
> "This is OP1001's shift health at a glance — Safety 35%, Behavior 70%, Integrity 100%,
> Training 0%. All computed live from the last 10 days of machine data, nothing hardcoded."

### 2. Operator Readiness Score card
**Click/point:** the big score number and the breakdown bars.
> "Readiness score: 44.1 out of 100 — down from a clean 100 ten days ago. And it's not a black
> box. Right here you can see exactly why: minus 25.9 points from a 65% safety-alert rate today,
> minus 30 points from 5 behavior deviations today. Full breakdown, every time, using the same
> formula for every operator."

### 3. Behavior & Anomaly Panel — the drift chart
**Click/point:** the line chart, then scroll to one or two anomaly cards.
> "Here's the story behind that score. OP1001's average idling time over 10 days: 4.4 minutes on
> day one, climbing to 30.3 minutes by day ten. That's not one bad reading — that's a trend, and
> our z-score anomaly engine catches it automatically. Each card gives you WHY it fired, WHAT
> it means, and WHAT NEXT — a recommended action, not just a red flag."

### 4. Safety card
**Click/point:** the active red safety banner.
> "Right now OP1001 has an active safety alert — seatbelt unfastened *and* an object 0.5 meters
> away, well under the 2-meter threshold. Same pattern: WHY, WHAT, WHAT NEXT."

### 5. Training Hub
**Click/point:** the two recommended cards.
> "Because we know exactly why this operator is flagged, we recommend targeted training instead
> of a generic course list — a Seatbelt Compliance Refresher and a Proximity Awareness module,
> both tied directly to what tripped the alerts."

### 6. Switch the operator dropdown to OP1002
**Click:** the operator selector, top left.
> "Now watch every panel update instantly." *(click)* "OP1002 looks completely different —
> readiness 89.3, mostly clean shift."

### 7. Machine & Data Integrity card
**Click/point:** the "Sensor integrity: FAILED" badge and the four anomaly cards.
> "But on September 18th, something else happened here — not a behavior problem, a *trust*
> problem. Four things fired on the exact same reading: the login came from an unregistered
> device and location, the sensor's own data signature failed its integrity check, proximity
> showed a physically impossible negative 8.4 meters, and engine hours actually *dropped* by 150
> hours — a counter that can never go down. That reading pulled OP1002's readiness score down to
> 43.6 that day before it recovered. This is the same anomaly engine that caught OP1001's drift —
> just pointed at cybersecurity instead of behavior."

---

## Closing line

> "That's CATMate: one score, one explainable engine, covering safety, behavior, and machine
> trust — so an operator or supervisor never just sees a flag. They see why it fired, and what
> to do about it."

---

## Quick reference — the numbers this script relies on

| Fact | Value |
|---|---|
| OP1001 readiness score, day 1 → day 10 | 100 → 44.1 |
| OP1001 average idling time, day 1 → day 10 | 4.4 min → 30.3 min |
| OP1001 today's safety-alert rate | 65% |
| OP1001 today's behavior deviations | 5 |
| OP1002 readiness score, today | 89.3 |
| OP1002 readiness score, on the anomaly day (2026-09-18) | 43.6 |
| OP1002 anomaly timestamp / machine | 2026-09-18, 12:00 PM, EXC002 |
| OP1002 anomaly #1 | Login from `UNKNOWN-DEV-9911` at "Unregistered - Remote VPN" (usual: `TAB-1002-A` at "North Pit - Zone 2") |
| OP1002 anomaly #2 | Data signature check failed |
| OP1002 anomaly #3 | Proximity sensor reported -8.4 m (impossible) |
| OP1002 anomaly #4 | Engine hours dropped from 1432.6 to 1283.6 |
