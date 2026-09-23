"use strict";

(function () {
  const CM = window.CM;
  let lineChart = null, radarChart = null, gaugeChart = null;
  let gaugeAnim = { raf: null, current: 0, target: 0 };

  const RADAR_METRICS = [
    { metric: "idling_time_min", label: "Idling" },
    { metric: "load_cycles_delta", label: "Load Cycles" },
    { metric: "proximity_distance_m", label: "Proximity" },
    { metric: "fuel_used_L_delta", label: "Fuel Use" },
  ];

  // ---------------------------------------------------------------- line chart

  function renderLineChart(history) {
    const canvas = document.getElementById("behavior-line-chart");
    const labels = history.daily.map((d) => CM.fmtDateOnly(d.date));
    const values = history.daily.map((d) => d.value);
    if (lineChart) lineChart.destroy();
    lineChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets: [{ label: "Idling (min/day avg)", data: values, borderColor: "#f2b705", backgroundColor: "rgba(242,183,5,0.14)", borderWidth: 2, pointRadius: 3, pointBackgroundColor: "#f2b705", tension: 0.25, fill: true }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } } },
    });
  }

  // ---------------------------------------------------------------- heatmap

  function heatColor(z) {
    if (z <= 0) return "#fdf6df";
    if (z < 1) return "#fbe4a3";
    if (z < 2) return "#f2b705";
    if (z < 3) return "#d9822b";
    return "#b03636";
  }

  function renderHeatmap(history) {
    const el = document.getElementById("behavior-heatmap");
    const { baseline_mean, baseline_std } = history;
    el.innerHTML = `<div class="heatmap-row">` + history.daily.map((d) => {
      const z = baseline_std > 0 ? (d.value - baseline_mean) / baseline_std : 0;
      const color = heatColor(z);
      return `<div class="heatmap-cell" style="background:${color}" title="${CM.escapeHTML(CM.fmtDateOnly(d.date))}: ${d.value} min (z=${z.toFixed(1)})">
        <span class="heatmap-date">${CM.escapeHTML(CM.fmtDateOnly(d.date))}</span>
      </div>`;
    }).join("") + `</div>
    <div class="heatmap-legend">
      <span>Less idling</span>
      <span class="heatmap-swatch" style="background:#fdf6df"></span>
      <span class="heatmap-swatch" style="background:#fbe4a3"></span>
      <span class="heatmap-swatch" style="background:#f2b705"></span>
      <span class="heatmap-swatch" style="background:#d9822b"></span>
      <span class="heatmap-swatch" style="background:#b03636"></span>
      <span>More idling (vs. own baseline)</span>
    </div>`;
  }

  // ---------------------------------------------------------------- radar chart

  function renderRadar(radarData) {
    const canvas = document.getElementById("behavior-radar-chart");
    const labels = radarData.map((d) => d.label);
    const currentPct = radarData.map((d) => d.pct);
    if (radarChart) radarChart.destroy();
    radarChart = new Chart(canvas.getContext("2d"), {
      type: "radar",
      data: {
        labels,
        datasets: [
          { label: "Current (% of baseline)", data: currentPct, borderColor: "#b03636", backgroundColor: "rgba(176,54,54,0.15)", pointBackgroundColor: "#b03636" },
          { label: "Baseline", data: labels.map(() => 100), borderColor: "#9a9a92", backgroundColor: "rgba(154,154,146,0.08)", borderDash: [4, 4], pointRadius: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { font: { size: 10 }, boxWidth: 12 } } },
        scales: { r: { min: 0, suggestedMax: 200, ticks: { font: { size: 9 }, backdropColor: "transparent" }, pointLabels: { font: { size: 11 } } } },
      },
    });
  }

  // ---------------------------------------------------------------- gauge

  const gaugeNeedlePlugin = {
    id: "gaugeNeedle",
    afterDatasetsDraw(chart) {
      if (chart.config._catmateGauge !== true) return;
      const meta = chart.getDatasetMeta(0);
      if (!meta.data.length) return;
      const arc = meta.data[0];
      const cx = arc.x, cy = arc.y;
      const radius = arc.outerRadius;
      const fraction = Math.max(0, Math.min(1, gaugeAnim.current));
      const thetaDeg = -90 + fraction * 180;
      const ctx = chart.ctx;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((thetaDeg * Math.PI) / 180);
      ctx.beginPath();
      ctx.moveTo(-4, 6);
      ctx.lineTo(4, 6);
      ctx.lineTo(0, -(radius - 8));
      ctx.closePath();
      ctx.fillStyle = "#1c1c1a";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  };

  function renderGauge(ratio, label) {
    const canvas = document.getElementById("behavior-gauge-chart");
    const maxRatio = 5;
    if (gaugeChart) gaugeChart.destroy();
    gaugeChart = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: { datasets: [{ data: [1.5, 1.5, 2], backgroundColor: ["#2f7a45", "#f2b705", "#b03636"], borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        rotation: -90, circumference: 180, cutout: "72%",
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        animation: false,
      },
      plugins: [gaugeNeedlePlugin],
    });
    gaugeChart.config._catmateGauge = true;

    const target = Math.max(0, Math.min(1, ratio / maxRatio));
    gaugeAnim.current = 0;
    gaugeAnim.target = target;
    if (gaugeAnim.raf) cancelAnimationFrame(gaugeAnim.raf);
    const start = performance.now();
    const duration = 900;
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      gaugeAnim.current = gaugeAnim.target * eased;
      gaugeChart.draw();
      if (t < 1) gaugeAnim.raf = requestAnimationFrame(step);
    }
    gaugeAnim.raf = requestAnimationFrame(step);

    document.getElementById("gauge-label").textContent =
      ratio > 0 ? `${ratio.toFixed(1)}x baseline — ${label}` : "No deviation flagged today";
  }

  // ---------------------------------------------------------------- anomaly list (with severity tiers)

  const CRITICAL_Z = 3.5;

  function renderAnomalyList(items) {
    const el = document.getElementById("behavior-anomaly-list");
    if (!items.length) { el.innerHTML = `<p class="hint">No behavior deviations flagged for this operator.</p>`; return; }
    el.innerHTML = `<div class="anomaly-grid">` + items.map((a) => {
      const ratio = a.baseline_value !== 0 ? (a.current_value / a.baseline_value).toFixed(1) + "x baseline" : "n/a";
      const critical = Math.abs(a.z_score) >= CRITICAL_Z;
      return `
        <div class="anomaly-card behavior">
          <span class="anomaly-severity ${critical ? "critical" : "watch"}">${critical ? "Critical" : "Watch"}</span>
          <div class="anomaly-meta">
            <span class="anomaly-metric">${CM.escapeHTML(CM.explain.metricLabel(a.metric))}</span>
            <span class="anomaly-time">${CM.fmtDateTime(a.timestamp)}</span>
          </div>
          <div class="anomaly-values">Current ${a.current_value} · Baseline ${a.baseline_value} · ${ratio} · z=${a.z_score}</div>
          <div class="wwn"><b>WHY:</b> ${CM.escapeHTML(a.reason)}</div>
          <div class="wwn"><b>WHAT:</b> ${CM.escapeHTML(CM.explain.behaviorWhat(a.metric))}</div>
          <div class="wwn"><b>WHAT NEXT:</b> ${CM.escapeHTML(CM.explain.behaviorWhatNext(a))}</div>
        </div>`;
    }).join("") + `</div>`;
  }

  // ---------------------------------------------------------------- refresh

  async function refresh(operatorId) {
    const listEl = document.getElementById("behavior-anomaly-list");
    CM.showLoading(listEl);
    try {
      const [idlingHistory, allAnomalies, ...radarHistories] = await Promise.all([
        CM.fetchJSON(`/operator-history?operator_id=${operatorId}&metric=idling_time_min`),
        CM.fetchJSON("/behavior-anomalies"),
        ...RADAR_METRICS.map((m) => CM.fetchJSON(`/operator-history?operator_id=${operatorId}&metric=${m.metric}`)),
      ]);
      if (CM.isStale(operatorId, "behavior")) return;

      renderLineChart(idlingHistory);
      renderHeatmap(idlingHistory);

      const radarData = RADAR_METRICS.map((m, i) => {
        const h = radarHistories[i];
        const current = h.daily.length ? h.daily[h.daily.length - 1].value : 0;
        const baseline = h.baseline_mean || 0;
        const pct = baseline !== 0 ? Math.min(220, Math.max(0, (current / baseline) * 100)) : 0;
        return { label: m.label, pct };
      });
      renderRadar(radarData);

      // Gauge always tracks idling - the section's headline drift metric -
      // rather than whichever metric has the highest z-score (a rare
      // load-cycle spike can technically outscore it but tells a confusing,
      // off-story number on the dial).
      const idlingBaseline = idlingHistory.baseline_mean;
      const idlingCurrent = idlingHistory.daily.length ? idlingHistory.daily[idlingHistory.daily.length - 1].value : 0;
      renderGauge(idlingBaseline ? idlingCurrent / idlingBaseline : 0, "Idling time");

      const mine = allAnomalies.filter((a) => a.operator_id === operatorId);

      renderAnomalyList(mine);
    } catch (err) {
      if (CM.isStale(operatorId, "behavior")) return;
      CM.showError(listEl, err);
    }
  }

  CM.registerSection("behavior", { refresh });
})();
