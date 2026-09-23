"use strict";

(function () {
  const CM = window.CM;

  function renderChecksSummary(summary) {
    const grid = document.getElementById("integrity-checks-grid");
    const counter = document.getElementById("integrity-run-counter");

    if (!summary.categories.length) {
      grid.innerHTML = `<p class="hint">No readings on record for this operator today.</p>`;
      counter.textContent = "";
      return;
    }

    grid.innerHTML = `<div class="checks-grid">` + summary.categories.map((c) => {
      const pass = c.passed === c.total;
      const failedCount = c.total - c.passed;
      return `
        <div class="check-tile ${pass ? "pass" : "fail"}">
          <div class="check-tile-label">${CM.escapeHTML(c.label)}</div>
          <div class="check-tile-verdict">${pass ? "PASS" : "FAIL"}</div>
          <div class="check-tile-detail">${pass ? `${c.passed}/${c.total} readings verified` : `${failedCount}/${c.total} readings flagged`}</div>
        </div>`;
    }).join("") + `</div>`;

    counter.textContent = `${summary.total_checks} integrity checks performed this shift, ${summary.total_flagged} flagged`;
  }

  function renderList(all, mine) {
    const el = document.getElementById("integrity-list-full");
    const badge = document.getElementById("integrity-badge");

    if (!mine.length) {
      el.innerHTML = `<p class="hint">No integrity issues flagged for this operator — logins, signatures, and sensor values all check out.</p>`;
      badge.textContent = "Integrity: OK";
      badge.className = "integrity-badge ok";
      return;
    }

    el.innerHTML = `<div class="anomaly-grid">` + mine.map((a) => {
      // Pass both the event's own id and the zone-grid node it would bucket
      // into (same key the map computes); safety.js knows which zones are
      // real and routes off-site events to the Login Origin Map instead.
      const seed = `security-${a.timestamp}-${a.anomaly_type}-${all.indexOf(a)}`;
      const nodeKey = CM.mapNodeKey(a.login_location, seed);
      return `
        <div class="anomaly-card integrity">
          <span class="integrity-tag ${CM.explain.securitySeverity(a.anomaly_type)}">${CM.escapeHTML(CM.explain.securityTag(a.anomaly_type))}</span>
          <div class="anomaly-meta">
            <span class="anomaly-metric">${CM.escapeHTML(a.machine_id)} · ${CM.escapeHTML(a.login_location)}</span>
            <span class="anomaly-time">${CM.fmtDateTime(a.timestamp)}</span>
          </div>
          <div class="wwn"><b>WHY:</b> ${CM.escapeHTML(a.reason)}</div>
          <div class="wwn"><b>WHAT:</b> ${CM.escapeHTML(CM.explain.securityWhat(a.anomaly_type))}</div>
          <div class="wwn"><b>WHAT NEXT:</b> ${CM.escapeHTML(CM.explain.securityWhatNext(a.anomaly_type))}</div>
          <button type="button" class="map-link-btn" data-event-id="${CM.escapeHTML(seed)}" data-node-key="${CM.escapeHTML(nodeKey)}">View on Site Map →</button>
        </div>`;
    }).join("") + `</div>`;

    const failed = mine.some((a) => a.anomaly_type === "invalid_signature");
    badge.textContent = failed ? "Sensor integrity: FAILED" : "Integrity: REVIEW";
    badge.className = "integrity-badge " + (failed ? "fail" : "warn");

    el.querySelectorAll(".map-link-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        CM.state.pendingMapFocus = { eventId: btn.dataset.eventId, nodeKey: btn.dataset.nodeKey };
        CM.showSection("safety");
      });
    });
  }

  function renderOriginFlag(operatorId, all) {
    const el = document.getElementById("integrity-origin-flag");
    const mismatch = all.find((a) => a.operator_id === operatorId && a.anomaly_type === "login_mismatch");
    if (!mismatch) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `
      <div class="origin-inline-flag">
        <span class="origin-status-bad">⚠ Login origin mismatch</span> —
        this reading came from ${CM.escapeHTML(mismatch.login_location)} (device ${CM.escapeHTML(mismatch.login_device_id)}), not this operator's usual access point.
        <button type="button" class="map-link-btn" id="origin-flag-map-link">View on Login Origin Map →</button>
      </div>`;
    document.getElementById("origin-flag-map-link").addEventListener("click", () => {
      CM.state.pendingMapFocus = `security-${mismatch.timestamp}-${mismatch.anomaly_type}-${all.indexOf(mismatch)}`;
      CM.showSection("safety");
    });
  }

  async function refresh(operatorId) {
    const el = document.getElementById("integrity-list-full");
    const checksEl = document.getElementById("integrity-checks-grid");
    CM.showLoading(el);
    CM.showLoading(checksEl);
    try {
      const [all, summary] = await Promise.all([
        CM.fetchJSON("/security-anomalies"),
        CM.fetchJSON(`/integrity-summary?operator_id=${operatorId}`),
      ]);
      if (CM.isStale(operatorId, "integrity")) return;
      renderChecksSummary(summary);
      renderOriginFlag(operatorId, all);
      renderList(all, all.filter((a) => a.operator_id === operatorId));
    } catch (err) {
      if (CM.isStale(operatorId, "integrity")) return;
      CM.showError(el, err);
      CM.showError(checksEl, err);
      const badge = document.getElementById("integrity-badge");
      badge.textContent = "—";
      badge.className = "integrity-badge";
    }
  }

  CM.registerSection("integrity", { refresh });
})();
