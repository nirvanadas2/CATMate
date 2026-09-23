"use strict";

(function () {
  const CM = window.CM;
  let chart = null;

  const FEATURE_LABEL = {
    engine_hours: "Engine hours",
    load_cycles: "Load cycles",
    fuel_used_L: "Fuel used (L)",
    idling_time_min: "Idling time (min)",
  };

  function renderChart(history) {
    const canvas = document.getElementById("tasktime-chart");
    const ordered = history.slice().reverse(); // oldest -> newest, left to right
    const labels = ordered.map((r) => `${r.task_type}\n${CM.fmtDateOnly(r.timestamp.slice(0, 10))}`);
    if (chart) chart.destroy();
    chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Predicted (min)", data: ordered.map((r) => r.predicted_duration_min), backgroundColor: "#f2b705" },
          { label: "Actual (min)", data: ordered.map((r) => r.actual_duration_min), backgroundColor: "#3a5a8c" },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { font: { size: 11 } } } },
        scales: { y: { beginAtZero: true, title: { display: true, text: "minutes" } }, x: { ticks: { font: { size: 9 } } } },
      },
    });
  }

  function renderFeatureImportance(modelMetrics, features, task) {
    const el = document.getElementById("feature-importance");
    const coeffs = modelMetrics.coefficients;
    const rows = Object.keys(coeffs).map((f) => ({
      label: FEATURE_LABEL[f] || f,
      value: features[f],
      contribution: coeffs[f] * features[f],
    }));
    rows.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.contribution)));

    el.innerHTML = `
      <p class="page-sub" style="margin-top:0;">Real linear-regression coefficients applied to task <b>${CM.escapeHTML(task.task_id)}</b>'s actual feature values (intercept ${modelMetrics.intercept} min):</p>
      ${rows.map((r) => `
        <div class="breakdown-row" style="grid-template-columns:120px 1fr 90px;">
          <span>${CM.escapeHTML(r.label)}</span>
          <div class="breakdown-bar"><div class="breakdown-fill ${r.contribution >= 0 ? "pos" : "neg"}" style="width:${Math.max(2, (Math.abs(r.contribution) / maxAbs) * 100)}%"></div></div>
          <span class="breakdown-delta">${r.contribution >= 0 ? "+" : ""}${r.contribution.toFixed(1)} min</span>
        </div>`).join("")}
      <p class="hint" style="margin-top:10px;">Input value used: ${rows.map((r) => `${CM.escapeHTML(r.label)} = ${r.value}`).join(", ")}.</p>`;
  }

  function renderModelNote(metrics) {
    document.getElementById("model-metrics-note").innerHTML = `
      <h2>Model Honesty Check</h2>
      <p class="page-sub" style="margin:0;">
        Linear regression, trained on ${metrics.n_train} readings, tested on ${metrics.n_test}.
        R² = ${metrics.r2}, mean absolute error = ${metrics.mae_min} min. This is a deliberately simple,
        explainable model — the R² is honestly low because in this synthetic dataset task duration wasn't
        generated as a function of these features. It's shown here transparently, not hidden.
      </p>`;
  }

  async function refresh(operatorId) {
    const chartCard = document.getElementById("tasktime-chart").closest(".panel-card");
    const importanceEl = document.getElementById("feature-importance");
    CM.showLoading(importanceEl);
    try {
      const history = await CM.fetchJSON(`/task-history?operator_id=${operatorId}&limit=12`);
      if (CM.isStale(operatorId, "tasktime")) return;

      if (!history.length) {
        importanceEl.innerHTML = `<p class="hint">No task history for this operator.</p>`;
        if (chart) { chart.destroy(); chart = null; }
        return;
      }

      renderChart(history);

      const latest = history[0];
      const qs = Object.entries(latest.features).map(([k, v]) => `${k}=${v}`).join("&");
      const pred = await CM.fetchJSON(`/predict-task-time?${qs}`);
      if (CM.isStale(operatorId, "tasktime")) return;

      renderFeatureImportance(pred.model_metrics, latest.features, latest);
      renderModelNote(pred.model_metrics);
    } catch (err) {
      if (CM.isStale(operatorId, "tasktime")) return;
      CM.showError(importanceEl, err);
    }
  }

  CM.registerSection("tasktime", { refresh });
})();
