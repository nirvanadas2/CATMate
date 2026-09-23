"use strict";

(function () {
  const CM = window.CM;
  let lastHandoff = null; // what "Copy note" copies - always the rendered operator's

  function fmtClock(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function fmtNumber(v) {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  function renderHeader(h) {
    const badge = document.getElementById("handoff-status");
    const attention = h.status === "needs_attention";
    badge.textContent = attention ? `Needs attention · ${h.status_reasons.join(", ")}` : "Normal";
    badge.className = "handoff-status " + (attention ? "attention" : "normal");

    document.getElementById("handoff-meta").innerHTML = `
      <span><b>${CM.escapeHTML(h.machine_id)}</b></span>
      <span>${CM.escapeHTML(h.operator_id)}</span>
      <span>${CM.fmtDateOnly(h.shift.date)} · ${fmtClock(h.shift.start)}–${fmtClock(h.shift.end)}</span>
      <span>${h.shift.readings} readings</span>`;
    document.getElementById("handoff-summary").textContent = h.summary;
  }

  function renderMetrics(h) {
    document.getElementById("handoff-metrics").innerHTML = h.metrics.map((m) => {
      let compare = `<span class="handoff-metric-compare">no earlier shifts to compare</span>`;
      if (m.ratio !== null) {
        const pct = Math.round((m.ratio - 1) * 100);
        const dir = pct > 0 ? `+${pct}%` : `${pct}%`;
        compare = `<span class="handoff-metric-compare ${m.flag ? "flagged" : ""}">${dir} vs. usual (${fmtNumber(m.baseline)} ${m.unit})</span>`;
      }
      return `
        <div class="handoff-metric ${m.flag ? "flagged" : ""}">
          <div class="handoff-metric-label">${CM.escapeHTML(m.label)}</div>
          <div class="handoff-metric-value">${fmtNumber(m.value)} <span>${CM.escapeHTML(m.unit)}</span></div>
          ${compare}
        </div>`;
    }).join("");
  }

  function eventRow(kindClass, tag, time, reason) {
    return `
      <li class="handoff-event ${kindClass}">
        <span class="handoff-event-time">${time}</span>
        <span class="handoff-event-tag">${CM.escapeHTML(tag)}</span>
        <span class="handoff-event-reason">${CM.escapeHTML(reason)}</span>
      </li>`;
  }

  function renderEvents(h) {
    const el = document.getElementById("handoff-events");
    const rows = [
      ...h.security_anomalies.map((a) => ({ t: a.timestamp, html: eventRow("security", CM.explain.securityTag(a.anomaly_type), fmtClock(a.timestamp), a.reason) })),
      ...h.safety_alerts.map((a) => ({ t: a.timestamp, html: eventRow("safety", `Safety · ${a.kind}`, fmtClock(a.timestamp), a.reason) })),
      ...h.behavior_deviations.map((a) => ({ t: a.timestamp, html: eventRow("behavior", CM.explain.metricLabel(a.metric), fmtClock(a.timestamp), a.reason) })),
    ].sort((a, b) => a.t.localeCompare(b.t));

    if (!rows.length) {
      el.innerHTML = `<p class="hint">Nothing flagged this shift — no safety alerts, integrity issues, or behavior deviations.</p>`;
      return;
    }
    el.innerHTML = `<ul class="handoff-event-list">${rows.map((r) => r.html).join("")}</ul>`;
  }

  function renderMaintenance(h) {
    const el = document.getElementById("handoff-maintenance");
    if (!h.maintenance.length) {
      el.innerHTML = `<p class="hint">No maintenance action needed — fuel, idle time, and sensor data all look normal for this machine.</p>`;
      return;
    }
    el.innerHTML = h.maintenance.map((m) => `
      <div class="handoff-maint">
        <div class="handoff-maint-check">${CM.escapeHTML(m.check)}</div>
        <div class="handoff-maint-reason">${CM.escapeHTML(m.reason)}</div>
      </div>`).join("");
  }

  function noteText(h) {
    const lines = [
      `Shift handoff — ${h.machine_id}, ${h.operator_id}, ${CM.fmtDateOnly(h.shift.date)} ${fmtClock(h.shift.start)}–${fmtClock(h.shift.end)}`,
      `Status: ${h.status === "needs_attention" ? "Needs attention" : "Normal"}`,
      "",
      h.summary,
      "",
      ...h.metrics.map((m) => `${m.label}: ${fmtNumber(m.value)} ${m.unit}${m.baseline !== null ? ` (usual ${fmtNumber(m.baseline)})` : ""}`),
    ];
    if (h.maintenance.length) {
      lines.push("", "Maintenance:", ...h.maintenance.map((m) => `- ${m.check}`));
    }
    return lines.join("\n");
  }

  function setupCopyButton() {
    document.getElementById("handoff-copy").addEventListener("click", async () => {
      if (!lastHandoff) return;
      try {
        await navigator.clipboard.writeText(noteText(lastHandoff));
        CM.toast("Handoff note copied.", "success");
      } catch (_) {
        CM.toast("Couldn't access the clipboard in this browser.", "info");
      }
    });
  }

  function setContentVisible(visible) {
    document.getElementById("handoff-body").hidden = !visible;
    document.getElementById("handoff-copy").disabled = !visible;
  }

  async function refresh(operatorId) {
    const summaryEl = document.getElementById("handoff-summary");
    const badge = document.getElementById("handoff-status");
    lastHandoff = null;
    setContentVisible(false);
    badge.textContent = "—";
    badge.className = "handoff-status";
    document.getElementById("handoff-meta").innerHTML = "";
    CM.showLoading(summaryEl);

    try {
      const h = await CM.fetchJSON(`/shift-handoff?operator_id=${operatorId}`);
      if (CM.isStale(operatorId, "handoff")) return;
      lastHandoff = h;
      renderHeader(h);
      renderMetrics(h);
      renderEvents(h);
      renderMaintenance(h);
      setContentVisible(true);
    } catch (err) {
      if (CM.isStale(operatorId, "handoff")) return;
      CM.showError(summaryEl, err);
    }
  }

  setupCopyButton();
  CM.registerSection("handoff", { refresh });
})();
