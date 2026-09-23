"use strict";

/**
 * Shared state, fetch helpers, and the section registry every section
 * module (tasks.js, safety.js, ...) attaches itself to. Loaded first.
 */
window.CM = (function () {
  const API_BASE = "http://127.0.0.1:5000";
  const MACHINES = ["EXC001", "EXC002", "LDR001"];

  // Mirrors backend/trust_score.py weights.
  const WEIGHTS = { safety: 40, behavior: 6, security: 12, training: 5 };

  // Fixed node count per zone on the Site Threat Map - shared so any module
  // that needs to point at a zone-grid marker (e.g. the Integrity panel's
  // "View on Site Map" link) computes the exact same key the map itself
  // uses to bucket events onto nodes.
  const NODES_PER_ZONE = 4;
  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }
  function mapNodeKey(location, seed) {
    return `node::${location}::${hashString(seed) % NODES_PER_ZONE}`;
  }

  const state = {
    currentOperator: "OP1001",
    activeSection: "tasks",
    latestDate: null, // "YYYY-MM-DD"
  };

  const sections = {}; // name -> { refresh(operatorId) }

  // ---------------------------------------------------------------- fetch

  async function fetchJSON(path) {
    const res = await fetch(API_BASE + path);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body.error) msg = body.error;
      } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }

  async function postJSON(path, payload) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body.error) msg = body.error;
      } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }

  function isOffline(err) {
    return err instanceof TypeError || /Failed to fetch|NetworkError/i.test(err.message || "");
  }

  function offlineMessageHTML() {
    return `Can't reach the CATMate backend at <code>${API_BASE}</code>. Start it with ` +
      `<code>python app.py</code> from the <code>backend/</code> folder, then refresh this page.`;
  }

  function showLoading(el) { el.innerHTML = `<p class="hint">Loading…</p>`; }

  function showError(el, err) {
    el.innerHTML = `<div class="error-box">${isOffline(err) ? offlineMessageHTML() : escapeHTML(err.message)}</div>`;
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ---------------------------------------------------------------- formatting

  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function fmtDateOnly(isoDate) {
    return new Date(isoDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function scoreClass(score) { return score >= 80 ? "good" : score >= 60 ? "warn" : "bad"; }
  function setChipClass(chip, pct) {
    chip.classList.remove("good", "warn", "bad");
    chip.classList.add(pct >= 80 ? "good" : pct >= 60 ? "warn" : "bad");
  }

  // True once a newer operator switch (or section switch) has superseded
  // this in-flight request - lets stale async work discard its own result.
  function isStale(operatorId, section) {
    if (operatorId !== state.currentOperator) return true;
    if (section && section !== state.activeSection) return true;
    return false;
  }

  // ---------------------------------------------------------------- toast

  function toast(message, kind = "info") {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast toast-${kind}`;
    el.textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  // ---------------------------------------------------------------- connectivity

  function setConnStatus(ok) {
    const wrap = document.getElementById("conn-status");
    const text = document.getElementById("conn-text");
    wrap.classList.remove("ok", "down");
    wrap.classList.add(ok ? "ok" : "down");
    text.textContent = ok ? "Backend connected" : "Backend unreachable";
  }

  async function ensureLatestDate() {
    if (state.latestDate) return state.latestDate;
    const data = await fetchJSON(`/trust-score?operator_id=OP1001`);
    state.latestDate = data.history[data.history.length - 1].date;
    return state.latestDate;
  }

  // ---------------------------------------------------------------- shift health (top bar)

  async function refreshShiftHealth(operatorId) {
    try {
      const data = await fetchJSON(`/trust-score?operator_id=${operatorId}`);
      if (operatorId !== state.currentOperator) return;
      const today = data.history[data.history.length - 1];

      const safetyPct = Math.round((1 - today.safety_violation_rate) * 100);
      const behaviorPct = Math.max(0, Math.round(100 - today.behavior_anomaly_count * WEIGHTS.behavior));
      const securityPct = Math.max(0, Math.round(100 - today.security_anomaly_count * WEIGHTS.security));

      setChip("safety", `${safetyPct}%`, safetyPct);
      setChip("behavior", `${behaviorPct}%`, behaviorPct);
      setChip("security", `${securityPct}%`, securityPct);

      const bits = [`${today.behavior_anomaly_count} behavior deviation${today.behavior_anomaly_count === 1 ? "" : "s"}`];
      if (today.security_anomaly_count > 0) {
        bits.push(`${today.security_anomaly_count} security anomaly event${today.security_anomaly_count === 1 ? "" : "s"}`);
      }
      bits.push(today.safety_violation_rate > 0 ? "an active safety alert today" : "no critical safety risk");
      document.getElementById("shift-summary").textContent =
        `Today's attention (${fmtDateOnly(today.date)}): ${bits.join(", ")}.`;

      setConnStatus(true);
      return today;
    } catch (err) {
      if (operatorId !== state.currentOperator) return;
      ["safety", "behavior", "security"].forEach((name) => {
        const chip = document.querySelector(`[data-chip="${name}"]`);
        chip.querySelector(".chip-value").textContent = "—";
        chip.classList.remove("good", "warn", "bad");
      });
      document.getElementById("shift-summary").textContent = "Couldn't load shift summary — backend unreachable.";
      setConnStatus(false);
      throw err;
    }
  }

  function setChip(name, text, pct) {
    const chip = document.querySelector(`[data-chip="${name}"]`);
    chip.querySelector(".chip-value").textContent = text;
    setChipClass(chip, pct);
  }
  function setTrainingChip(pct) { setChip("training", `${pct}%`, pct); }

  // ---------------------------------------------------------------- training completion
  // Completion is only recorded in this browser (the Training Hub's "Mark
  // Complete" toggles), so the chip is computed here against the operator's
  // recommended modules - on every operator change, not only when the
  // Training Hub tab happens to be open.

  function trainingKey(operatorId, title) { return `catmate_training_${operatorId}_${title}`; }

  function trainingCompletionPct(operatorId, cards) {
    if (!cards.length) return 100; // nothing recommended = nothing outstanding
    const done = cards.filter((c) => localStorage.getItem(trainingKey(operatorId, c.title)) === "1").length;
    return Math.round((done / cards.length) * 100);
  }

  async function refreshTrainingChip(operatorId) {
    try {
      const cards = await fetchJSON(`/training?operator_id=${operatorId}`);
      if (operatorId !== state.currentOperator) return;
      setTrainingChip(trainingCompletionPct(operatorId, cards));
    } catch (err) {
      if (operatorId !== state.currentOperator) return;
      const chip = document.querySelector('[data-chip="training"]');
      chip.querySelector(".chip-value").textContent = "—";
      chip.classList.remove("good", "warn", "bad");
    }
  }

  // ---------------------------------------------------------------- section registry + nav

  function registerSection(name, mod) { sections[name] = mod; }

  async function showSection(name) {
    if (!sections[name]) return;
    state.activeSection = name;

    document.querySelectorAll(".page-section").forEach((el) => { el.hidden = el.id !== `section-${name}`; });
    document.querySelectorAll(".tab").forEach((btn) => { btn.classList.toggle("active", btn.dataset.section === name); });

    try {
      await sections[name].refresh(state.currentOperator);
    } catch (_) { /* section renders its own error state */ }
  }

  async function onOperatorChange(operatorId) {
    state.currentOperator = operatorId;
    document.getElementById("incident-operator").value = operatorId;
    await Promise.allSettled([
      refreshShiftHealth(operatorId),
      refreshTrainingChip(operatorId),
      sections[state.activeSection] ? sections[state.activeSection].refresh(operatorId) : Promise.resolve(),
    ]);
  }

  async function init() {
    document.getElementById("operator-select").addEventListener("change", (e) => onOperatorChange(e.target.value));
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => showSection(btn.dataset.section));
    });

    try { await ensureLatestDate(); } catch (_) { /* panels show their own errors */ }

    document.getElementById("incident-operator").value = state.currentOperator;
    await Promise.allSettled([
      refreshShiftHealth(state.currentOperator),
      refreshTrainingChip(state.currentOperator),
      showSection(state.activeSection),
    ]);
  }

  // ---------------------------------------------------------------- shared explanation text
  // Used by both the Safety/Attack-Map section and the Integrity section so
  // the same event reads identically in both places (item 6: "linked
  // visually and consistently").

  const explain = {
    metricLabel(metric) {
      return { idling_time_min: "Idling time", proximity_distance_m: "Proximity distance", load_cycles_delta: "Load-cycle activity" }[metric] || metric;
    },
    behaviorWhat(metric) {
      return {
        idling_time_min: "Extended idling burns fuel and may signal disengagement from the assigned task.",
        proximity_distance_m: "Operating closer to hazards than usual raises collision risk for people and equipment nearby.",
        load_cycles_delta: "An unusual cycle rate can mean rushed, unsafe operation or an unexplained task blockage.",
      }[metric] || "";
    },
    behaviorWhatNext(a) {
      if (a.metric === "idling_time_min") return "Check in with the operator; confirm no equipment fault is causing the downtime.";
      if (a.metric === "proximity_distance_m") return "Flag for a proximity-awareness check-in and verify hazard-zone markings on site.";
      if (a.metric === "load_cycles_delta") {
        return a.current_value > a.baseline_value
          ? "Compare against the task assignment; confirm the pace is safe, not rushed."
          : "Confirm the operator isn't blocked or idle when cycles should be running.";
      }
      return "Review with the operator.";
    },
    safetyWhat(a) {
      const bits = [];
      if (a.seatbelt_status === "Unfastened") bits.push("elevated injury risk in a sudden stop, tip, or rollover");
      if (a.proximity_distance_m >= 0 && a.proximity_distance_m < 2) bits.push("elevated collision risk with people or equipment nearby");
      return bits.length ? `Operator has ${bits.join(" and ")}.` : "A safety threshold was exceeded on this reading.";
    },
    safetyWhatNext(a) {
      const bits = [];
      if (a.seatbelt_status === "Unfastened") bits.push("Fasten seatbelt before continuing operation.");
      if (a.proximity_distance_m >= 0 && a.proximity_distance_m < 2) bits.push("Stop, check surroundings, and maintain at least 2m clearance.");
      return bits.join(" ") || "Review the reading with the operator.";
    },
    securityTag(anomalyType) {
      return {
        login_mismatch: "Credential check: MISMATCH",
        invalid_signature: "Sensor integrity: FAILED",
        implausible_sensor_value: "Sensor plausibility: FAILED",
      }[anomalyType] || anomalyType;
    },
    securitySeverity(anomalyType) {
      return { login_mismatch: "warn", invalid_signature: "critical", implausible_sensor_value: "critical" }[anomalyType] || "critical";
    },
    securityWhat(anomalyType) {
      return {
        login_mismatch: "This reading wasn't authenticated from the operator's normal device or location, which may indicate credential misuse.",
        invalid_signature: "This reading's integrity check failed, so it can't be trusted for safety or performance decisions.",
        implausible_sensor_value: "Downstream systems (proximity alerts, maintenance schedules) may act on corrupted data if this isn't caught.",
      }[anomalyType] || "";
    },
    securityWhatNext(anomalyType) {
      return {
        login_mismatch: "Verify the operator's identity before trusting this session; rotate credentials if unconfirmed.",
        invalid_signature: "Quarantine this reading and inspect the sensor/firmware for tampering.",
        implausible_sensor_value: "Flag the machine for a physical sensor inspection before the next shift.",
      }[anomalyType] || "Review with the site security lead.";
    },
  };

  return {
    API_BASE, MACHINES, WEIGHTS, state, explain, NODES_PER_ZONE, mapNodeKey,
    fetchJSON, postJSON, isOffline, offlineMessageHTML, showLoading, showError, escapeHTML,
    fmtDateTime, fmtDateOnly, scoreClass, setChipClass, isStale, toast,
    setTrainingChip, trainingKey, trainingCompletionPct, registerSection, showSection, init,
  };
})();
