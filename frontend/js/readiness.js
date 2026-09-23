"use strict";

(function () {
  const CM = window.CM;
  const RING_R = 86;
  const CIRCUMFERENCE = 2 * Math.PI * RING_R;
  let ringRaf = null;

  function animateRing(score) {
    const ring = document.getElementById("ring-fg");
    ring.setAttribute("stroke-dasharray", CIRCUMFERENCE.toFixed(2));
    ring.classList.remove("good", "warn", "bad");
    ring.classList.add(CM.scoreClass(score));

    const scoreEl = document.getElementById("readiness-score-big");
    if (ringRaf) cancelAnimationFrame(ringRaf);
    const start = performance.now();
    const duration = 1000;
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = score * eased;
      const offset = CIRCUMFERENCE - (current / 100) * CIRCUMFERENCE;
      ring.setAttribute("stroke-dashoffset", offset.toFixed(2));
      scoreEl.textContent = current.toFixed(1);
      if (t < 1) ringRaf = requestAnimationFrame(step);
      else scoreEl.textContent = score.toFixed(1);
    }
    ringRaf = requestAnimationFrame(step);
  }

  function renderBreakdown(data, today) {
    const el = document.getElementById("readiness-breakdown");
    const W = CM.WEIGHTS;
    const safetyDelta = -(today.safety_violation_rate * W.safety);
    const behaviorDelta = -(today.behavior_anomaly_count * W.behavior);
    const securityDelta = -(today.security_anomaly_count * W.security);
    const trainingDelta = today.training_completed_bonus * W.training;

    const rows = [
      { label: "Safety", delta: safetyDelta, pct: today.safety_violation_rate * 100 },
      { label: "Behavior", delta: behaviorDelta, pct: Math.min(100, (today.behavior_anomaly_count / 6) * 100) },
      { label: "Security", delta: securityDelta, pct: Math.min(100, (today.security_anomaly_count / 6) * 100) },
      { label: "Training", delta: trainingDelta, pct: 0 },
    ];

    const bits = [];
    if (today.safety_violation_rate > 0) bits.push(`${Math.round(today.safety_violation_rate * 100)}% safety-alert rate`);
    if (today.behavior_anomaly_count > 0) bits.push(`${today.behavior_anomaly_count} behavior deviation${today.behavior_anomaly_count === 1 ? "" : "s"}`);
    if (today.security_anomaly_count > 0) bits.push(`${today.security_anomaly_count} security anomaly event${today.security_anomaly_count === 1 ? "" : "s"}`);
    const explanation = bits.length
      ? `Decreased due to ${bits.join(", ")} on ${CM.fmtDateOnly(today.date)}.`
      : `No deductions on ${CM.fmtDateOnly(today.date)} — full compliance.`;

    el.innerHTML = `
      <div class="score-explain" style="margin-bottom:14px;">${CM.escapeHTML(explanation)}</div>
      ${rows.map((r) => `
        <div class="breakdown-row">
          <span>${r.label}</span>
          <div class="breakdown-bar"><div class="breakdown-fill ${r.delta < 0 ? "neg" : "pos"}" style="width:${Math.max(2, r.pct)}%"></div></div>
          <span class="breakdown-delta">${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(1)}</span>
        </div>`).join("")}
      <div class="score-explain" style="margin-top:10px;margin-bottom:0;">
        Weights mirror the backend formula (safety ×40, behavior ×6, security ×12, training ×5).
        Training completion isn't scored by the backend yet — see the Training Hub.
      </div>`;
  }

  function renderLeaderboard(leaderboard) {
    const el = document.getElementById("readiness-leaderboard");
    el.innerHTML = leaderboard.map((row, i) => `
      <div class="leaderboard-row ${row.operator_id === CM.state.currentOperator ? "me" : ""}">
        <span class="leaderboard-rank">#${i + 1}</span>
        <span class="leaderboard-operator">${CM.escapeHTML(row.operator_id)}</span>
        <div class="leaderboard-bar"><div class="leaderboard-fill ${CM.scoreClass(row.current_score)}" style="width:${Math.max(2, row.current_score)}%"></div></div>
        <span class="leaderboard-score">${row.current_score.toFixed(1)}</span>
      </div>`).join("");
  }

  async function refresh(operatorId) {
    const breakdownEl = document.getElementById("readiness-breakdown");
    CM.showLoading(breakdownEl);
    try {
      const [data, leaderboard] = await Promise.all([
        CM.fetchJSON(`/trust-score?operator_id=${operatorId}`),
        CM.fetchJSON("/trust-score"),
      ]);
      if (CM.isStale(operatorId, "readiness")) return;
      const today = data.history[data.history.length - 1];
      animateRing(data.current_score);
      renderBreakdown(data, today);
      renderLeaderboard(leaderboard);
    } catch (err) {
      if (CM.isStale(operatorId, "readiness")) return;
      CM.showError(breakdownEl, err);
    }
  }

  CM.registerSection("readiness", { refresh });
})();
