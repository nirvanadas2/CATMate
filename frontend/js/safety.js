"use strict";

(function () {
  const CM = window.CM;
  const SVG_NS = "http://www.w3.org/2000/svg";
  let zoneRects = {}; // name -> {x,y,w,h,cx,cy}
  let zoneNodes = {}; // name -> [{x,y,label}, ...] fixed, in-bounds node positions
  let markerEvents = {}; // marker/node key -> array of event detail objects

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function buildZoneLayout(zones) {
    if (!zones.length) return { real: [], anomalous: [] };
    const maxCount = Math.max(...zones.map((z) => z.reading_count));
    const real = zones.filter((z) => z.reading_count >= maxCount * 0.1);
    const anomalous = zones.filter((z) => z.reading_count < maxCount * 0.1);
    return { real, anomalous };
  }

  // Real jobsite zones only - locations that aren't a real zone (the
  // seeded anomaly's claimed login location) are handled entirely by the
  // dedicated Login Origin Map instead of being force-placed on this grid.
  function renderMapBase(zones) {
    const svg = document.getElementById("threat-map");
    svg.innerHTML = "";
    zoneRects = {};
    zoneNodes = {};

    const { real } = buildZoneLayout(zones);
    const cols = Math.max(1, Math.ceil(Math.sqrt(real.length)));
    const rows = Math.max(1, Math.ceil(real.length / cols));

    const marginX = 24, marginY = 24, gap = 16;
    const gridW = 552, gridH = 340;
    const cellW = (gridW - gap * (cols - 1)) / cols;
    const cellH = (gridH - gap * (rows - 1)) / rows;

    svg.appendChild(svgEl("rect", { x: 6, y: 6, width: gridW + 36, height: 368, rx: 10, fill: "none", stroke: "#e2e1db", "stroke-width": 1 }));

    real.forEach((zone, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = marginX + col * (cellW + gap);
      const y = marginY + row * (cellH + gap);
      const rect = { x, y, w: cellW, h: cellH, cx: x + cellW / 2, cy: y + cellH / 2 };
      zoneRects[zone.name] = rect;
      zoneNodes[zone.name] = layoutNodes(rect);

      svg.appendChild(svgEl("rect", { x, y, width: cellW, height: cellH, rx: 8, class: "zone-rect" }));
      const label = svgEl("text", { x: x + 10, y: y + 20, class: "zone-label" });
      label.textContent = zone.name;
      svg.appendChild(label);
    });

    return svg;
  }

  // Fixed 2x2 node grid inside a zone box - a small, named, never-random set
  // of checkpoints. Padding keeps every node (and its marker radius/pulse)
  // clear of the box edges and the zone label; the final clamp is a hard
  // safety net so a node can never end up outside its own box, regardless
  // of box size.
  function layoutNodes(rect) {
    const padX = 34, padTop = 46, padBottom = 30;
    const left = rect.x + padX;
    const right = rect.x + rect.w - padX;
    const top = rect.y + padTop;
    const bottom = rect.y + rect.h - padBottom;

    const clampX = (v) => Math.min(Math.max(v, rect.x + 16), rect.x + rect.w - 16);
    const clampY = (v) => Math.min(Math.max(v, rect.y + 16), rect.y + rect.h - 16);

    const raw = [
      { x: left, y: top, label: "Checkpoint 1" },
      { x: right, y: top, label: "Checkpoint 2" },
      { x: left, y: bottom, label: "Checkpoint 3" },
      { x: right, y: bottom, label: "Checkpoint 4" },
    ];
    return raw.map((n) => ({ ...n, x: clampX(n.x), y: clampY(n.y) }));
  }

  function nodeFor(location, seed) {
    const nodes = zoneNodes[location];
    if (!nodes) return null; // not a real jobsite zone - handled by the Login Origin Map instead
    const idx = CM.mapNodeKey(location, seed).split("::")[2];
    return { key: CM.mapNodeKey(location, seed), node: nodes[Number(idx)] };
  }

  function bucketEvent(buckets, location, seed, colorClass, detail) {
    const target = nodeFor(location, seed);
    if (!target) return false;
    if (!buckets[target.key]) buckets[target.key] = { node: target.node, colorClass, events: [] };
    // security (red) always wins visually over safety (orange) at a shared checkpoint
    if (colorClass === "red") buckets[target.key].colorClass = "red";
    buckets[target.key].events.push(detail);
    return true;
  }

  function drawBucketMarker(svg, key, bucket) {
    const { node, colorClass, events } = bucket;
    const count = events.length;
    const r = count > 1 ? 9 : 7;

    const g = svgEl("g", { class: `map-marker ${colorClass}`, "data-marker-id": key, tabindex: "0" });
    g.appendChild(svgEl("circle", { cx: node.x, cy: node.y, r }));
    g.appendChild(svgEl("circle", { cx: node.x, cy: node.y, r, class: "marker-pulse" }));
    if (count > 1) {
      const badge = svgEl("text", { x: node.x, y: node.y + 3.5, class: "marker-badge", "text-anchor": "middle" });
      badge.textContent = String(count);
      g.appendChild(badge);
    }
    svg.appendChild(g);
    markerEvents[key] = events;
    g.addEventListener("click", () => showNodeDetail(key));
  }

  function drawNormalMarker(svg, zoneName) {
    const node = zoneNodes[zoneName][0];
    const g = svgEl("g", { class: "map-marker green", "data-marker-id": `normal-${zoneName}` });
    g.appendChild(svgEl("circle", { cx: node.x, cy: node.y, r: 5 }));
    const title = svgEl("title", {});
    title.textContent = `${zoneName}: no flagged events today`;
    g.appendChild(title);
    svg.appendChild(g);
  }

  function renderEventDetail(el, detail) {
    el.innerHTML = `
      <div class="map-detail-title ${detail.kind}">${CM.escapeHTML(detail.title)}</div>
      <div class="map-detail-meta">${CM.escapeHTML(detail.location)} · ${CM.fmtDateTime(detail.timestamp)}</div>
      <div class="wwn"><b>WHY:</b> ${CM.escapeHTML(detail.why)}</div>
      <div class="wwn"><b>WHAT:</b> ${CM.escapeHTML(detail.what)}</div>
      <div class="wwn"><b>WHAT NEXT:</b> ${CM.escapeHTML(detail.whatNext)}</div>`;
  }

  function showNodeDetail(key) {
    const events = markerEvents[key];
    const el = document.getElementById("map-detail");
    if (!events || !events.length) { el.innerHTML = `<p class="hint">No detail available.</p>`; return; }

    document.querySelectorAll(".map-marker").forEach((m) => m.classList.remove("selected"));
    setOriginFocused(false);
    const g = document.querySelector(`.map-marker[data-marker-id="${CSS.escape(key)}"]`);
    if (g) g.classList.add("selected");

    if (events.length === 1) {
      renderEventDetail(el, events[0]);
      return;
    }

    el.innerHTML = `
      <div class="map-detail-title">${events.length} events at this checkpoint</div>
      <div class="map-node-event-list">
        ${events.map((e, i) => `<button type="button" class="map-node-event-btn ${e.kind}" data-idx="${i}">${CM.escapeHTML(e.title)} · ${CM.fmtDateTime(e.timestamp)}</button>`).join("")}
      </div>`;
    el.querySelectorAll(".map-node-event-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        renderEventDetail(el, events[Number(btn.dataset.idx)]);
        const back = document.createElement("button");
        back.type = "button";
        back.className = "map-detail-back";
        back.textContent = "← Back to checkpoint list";
        back.addEventListener("click", () => showNodeDetail(key));
        el.prepend(back);
      });
    });
  }

  // Only the selected operator's events are drawn. Filtering happens inside
  // the loops (not before them) so each seed keeps the event's index in the
  // full list - integrity.js builds "View on Site Map" keys from that index.
  function renderMarkers(svg, zones, alerts, securityAnomalies, operatorId) {
    document.querySelectorAll(".map-marker").forEach((m) => m.remove());
    markerEvents = {};

    const buckets = {};

    alerts.forEach((a, i) => {
      if (a.operator_id !== operatorId) return;
      const seed = `safety-${a.timestamp}-${i}`;
      bucketEvent(buckets, a.login_location, seed, "orange", {
        kind: "safety", title: `Safety alert — ${a.operator_id}`, location: a.login_location, timestamp: a.timestamp,
        why: a.reason, what: CM.explain.safetyWhat(a), whatNext: CM.explain.safetyWhatNext(a),
      });
    });

    securityAnomalies.forEach((a, i) => {
      if (a.operator_id !== operatorId) return;
      const seed = `security-${a.timestamp}-${a.anomaly_type}-${i}`;
      bucketEvent(buckets, a.login_location, seed, "red", securityDetail(a));
    });

    Object.entries(buckets).forEach(([key, bucket]) => drawBucketMarker(svg, key, bucket));

    const usedZones = new Set(Object.keys(buckets).map((k) => k.split("::")[1]));
    zones.forEach((z) => {
      if (!usedZones.has(z.name) && zoneNodes[z.name]) drawNormalMarker(svg, z.name);
    });
  }

  // ---------------------------------------------------------------- login origin map

  const ORIGIN_MARKER_ID = "origin-remote";
  let originEventIds = new Set(); // per-event ids focusable on the Login Origin Map

  function securityDetail(a) {
    return {
      kind: "security", title: `${CM.explain.securityTag(a.anomaly_type)} — ${a.operator_id}`,
      location: a.login_location, timestamp: a.timestamp,
      why: a.reason, what: CM.explain.securityWhat(a.anomaly_type), whatNext: CM.explain.securityWhatNext(a.anomaly_type),
    };
  }

  // Credential mismatches, and anything logged somewhere that isn't a real
  // jobsite zone (so has no node on the grid), belong on this map instead.
  // Must run after renderMapBase so zoneNodes is populated.
  function isOffSite(a) {
    return a.anomaly_type === "login_mismatch" || !zoneNodes[a.login_location];
  }

  function renderLoginOriginMap(operatorId, allSecurityAnomalies) {
    const svg = document.getElementById("login-origin-map");
    const statusEl = document.getElementById("login-origin-status");
    svg.innerHTML = "";
    originEventIds = new Set();

    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: 220, height: 150, rx: 8, class: "origin-bg" }));
    svg.appendChild(svgEl("path", {
      d: "M14,100 Q30,60 80,72 T160,58 Q198,72 200,110 Q150,138 90,132 Q30,128 14,100 Z",
      class: "origin-land",
    }));

    const jobsiteX = 150, jobsiteY = 90;
    const remoteX = 38, remoteY = 34;

    // Ids use the index in the full list - the same scheme integrity.js uses.
    const offSite = allSecurityAnomalies
      .map((a, i) => ({ a, id: `security-${a.timestamp}-${a.anomaly_type}-${i}` }))
      .filter(({ a }) => a.operator_id === operatorId && isOffSite(a));

    if (offSite.length) {
      svg.appendChild(svgEl("line", { x1: jobsiteX, y1: jobsiteY, x2: remoteX, y2: remoteY, class: "origin-link" }));
    }

    const jobsiteG = svgEl("g", {});
    jobsiteG.appendChild(svgEl("circle", { cx: jobsiteX, cy: jobsiteY, r: 6, class: "origin-jobsite-dot" }));
    svg.appendChild(jobsiteG);
    const jobsiteLabel = svgEl("text", { x: jobsiteX - 4, y: jobsiteY + 20, class: "origin-label" });
    jobsiteLabel.textContent = "Jobsite";
    svg.appendChild(jobsiteLabel);

    if (!offSite.length) {
      statusEl.innerHTML = `<span class="origin-status-ok">✓ All logins this shift originated on-site</span> — no location anomalies for ${CM.escapeHTML(operatorId)}.`;
      return;
    }

    const count = offSite.length;
    const r = count > 1 ? 9 : 7;
    const remoteG = svgEl("g", { class: "map-marker red", "data-marker-id": ORIGIN_MARKER_ID, tabindex: "0" });
    remoteG.appendChild(svgEl("circle", { cx: remoteX, cy: remoteY, r }));
    remoteG.appendChild(svgEl("circle", { cx: remoteX, cy: remoteY, r, class: "marker-pulse" }));
    if (count > 1) {
      const badge = svgEl("text", { x: remoteX, y: remoteY + 3.5, class: "marker-badge", "text-anchor": "middle" });
      badge.textContent = String(count);
      remoteG.appendChild(badge);
    }
    svg.appendChild(remoteG);
    const remoteLabel = svgEl("text", { x: remoteX - 30, y: remoteY - 14, class: "origin-label origin-label-alert" });
    remoteLabel.textContent = "Unknown origin";
    svg.appendChild(remoteLabel);

    // The marker opens the full list; each event is also registered on its
    // own so a "View on Site Map" link can open exactly that event.
    markerEvents[ORIGIN_MARKER_ID] = offSite.map(({ a }) => securityDetail(a));
    offSite.forEach(({ a, id }) => {
      markerEvents[id] = [securityDetail(a)];
      originEventIds.add(id);
    });
    remoteG.addEventListener("click", () => {
      showNodeDetail(ORIGIN_MARKER_ID);
      setOriginFocused(true);
    });

    const lead = offSite.find(({ a }) => a.anomaly_type === "login_mismatch") || offSite[0];
    const headline = lead.a.anomaly_type === "login_mismatch" ? "⚠ Login originated off-site" : "⚠ Reading received off-site";
    const more = count > 1 ? ` ${count} off-site events — click the marker to review.` : "";
    statusEl.innerHTML = `<span class="origin-status-bad">${headline}</span> — ${CM.escapeHTML(lead.a.login_location)}, device ${CM.escapeHTML(lead.a.login_device_id)}.${more}`;
  }

  function setOriginFocused(on) {
    document.querySelector(".login-origin-card").classList.toggle("focused", on);
  }

  function focusOriginEvent(id) {
    showNodeDetail(id);
    document.querySelector(`.map-marker[data-marker-id="${ORIGIN_MARKER_ID}"]`)?.classList.add("selected");
    setOriginFocused(true);
  }

  // Routes a "View on Site Map" request. Accepts { nodeKey, eventId } or a
  // bare key. Events shown on the Login Origin Map focus that panel;
  // everything else focuses the zone-grid node it was bucketed into.
  function focusMapTarget(focus) {
    const { nodeKey, eventId } = typeof focus === "string" ? { nodeKey: focus, eventId: focus } : focus;
    if (eventId && originEventIds.has(eventId)) focusOriginEvent(eventId);
    else if (nodeKey && markerEvents[nodeKey]) showNodeDetail(nodeKey);
    else return;
    document.querySelector("#section-safety .map-card").scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function renderSafetyBanner(mine, operatorId) {
    const el = document.getElementById("safety-banner-wrap");
    if (!mine.length) {
      el.innerHTML = `
        <div class="safety-banner clear">
          <div class="safety-banner-title">✓ No safety alerts on record</div>
          <div class="wwn">No unfastened-seatbelt or proximity-hazard readings found for ${CM.escapeHTML(operatorId)}.</div>
        </div>`;
      return;
    }
    const latest = mine[0];
    const isToday = CM.state.latestDate && latest.timestamp.slice(0, 10) === CM.state.latestDate;
    const stateClass = isToday ? "active" : "stale";
    const title = isToday ? "⚠ Active safety alert" : "⚠ Most recent flagged reading (not today)";
    el.innerHTML = `
      <div class="safety-banner ${stateClass}">
        <div class="safety-banner-title">${title}</div>
        <div class="safety-banner-time">${CM.fmtDateTime(latest.timestamp)} · ${CM.escapeHTML(latest.machine_id)} · ${CM.escapeHTML(latest.login_location)}</div>
        <div class="wwn"><b>WHY:</b> ${CM.escapeHTML(latest.reason)}</div>
        <div class="wwn"><b>WHAT:</b> ${CM.escapeHTML(CM.explain.safetyWhat(latest))}</div>
        <div class="wwn"><b>WHAT NEXT:</b> ${CM.escapeHTML(CM.explain.safetyWhatNext(latest))}</div>
        <div class="safety-count">${mine.length} flagged reading${mine.length === 1 ? "" : "s"} total for ${CM.escapeHTML(operatorId)}.</div>
      </div>`;
  }

  // ---------------------------------------------------------------- incident log (unchanged behavior)

  function severityPillClass(severity) {
    const s = severity.toLowerCase();
    if (["high", "medium", "low"].includes(s)) return s;
    return "unspecified";
  }

  function populateIncidentMachineOptions() {
    const sel = document.getElementById("incident-machine");
    sel.innerHTML = CM.MACHINES.map((m) => `<option value="${m}">${m}</option>`).join("");
  }

  function renderIncidents(mine, operatorId) {
    const el = document.getElementById("incident-list");
    if (!mine.length) {
      el.innerHTML = `<p class="hint">No incidents on record for ${CM.escapeHTML(operatorId)}.</p>`;
      return;
    }
    el.innerHTML = `<div class="incident-list-scroll">` + mine.map((i) => `
      <div class="incident-row">
        <div class="incident-row-main">
          <span>${CM.escapeHTML(i.machine_id)} · ${CM.escapeHTML(i.type)}${i.source === "manual" ? " (manual)" : ""}</span>
          ${i.description ? `<span class="incident-row-desc">${CM.escapeHTML(i.description)}</span>` : ""}
          <span class="incident-row-time">${CM.fmtDateTime(i.timestamp)}</span>
        </div>
        <span class="severity-pill ${severityPillClass(i.severity)}">${CM.escapeHTML(i.severity)}</span>
      </div>`).join("") + `</div>`;
  }

  async function refreshIncidents(operatorId) {
    const el = document.getElementById("incident-list");
    CM.showLoading(el);
    try {
      const incidents = await CM.fetchJSON("/incidents");
      if (CM.isStale(operatorId, "safety")) return;
      renderIncidents(incidents.filter((i) => i.operator_id === operatorId), operatorId);
    } catch (err) {
      if (CM.isStale(operatorId, "safety")) return;
      CM.showError(el, err);
    }
  }

  function setupIncidentForm() {
    const form = document.getElementById("incident-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msgEl = document.getElementById("incident-form-msg");
      const btn = document.getElementById("incident-submit");
      const description = document.getElementById("incident-description").value.trim();
      const machine_id = document.getElementById("incident-machine").value;
      if (!description) return;

      btn.disabled = true;
      msgEl.textContent = "Saving…";
      msgEl.className = "incident-form-msg";
      try {
        await CM.postJSON("/incidents", { operator_id: CM.state.currentOperator, machine_id, description });
        document.getElementById("incident-description").value = "";
        msgEl.textContent = "Logged.";
        msgEl.className = "incident-form-msg ok";
        CM.toast("Incident logged.", "success");
        await refreshIncidents(CM.state.currentOperator);
      } catch (err) {
        msgEl.textContent = CM.isOffline(err) ? "Backend unreachable — couldn't save." : err.message;
        msgEl.className = "incident-form-msg err";
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------- refresh

  async function refresh(operatorId) {
    const bannerEl = document.getElementById("safety-banner-wrap");
    CM.showLoading(bannerEl);
    document.getElementById("map-detail").innerHTML = `<p class="hint">Click a marker on the map to see WHY / WHAT / WHAT NEXT.</p>`;

    try {
      const [zones, alerts, securityAnomalies] = await Promise.all([
        CM.fetchJSON("/zones"),
        CM.fetchJSON("/alerts"),
        CM.fetchJSON("/security-anomalies"),
      ]);
      if (CM.isStale(operatorId, "safety")) return;

      const myAlerts = alerts.filter((a) => a.operator_id === operatorId);
      renderSafetyBanner(myAlerts, operatorId);

      // Map shows the selected operator's safety alerts for today (avoids
      // cluttering with historical alerts) plus all of their security
      // anomalies (rare and high-value, so always worth surfacing).
      const todaysAlerts = alerts.filter((a) => a.timestamp.slice(0, 10) === CM.state.latestDate);
      const svg = renderMapBase(zones);
      renderMarkers(svg, zones, todaysAlerts, securityAnomalies, operatorId);
      renderLoginOriginMap(operatorId, securityAnomalies);

      if (CM.state.pendingMapFocus) {
        focusMapTarget(CM.state.pendingMapFocus);
        CM.state.pendingMapFocus = null;
      }
    } catch (err) {
      if (CM.isStale(operatorId, "safety")) return;
      CM.showError(bannerEl, err);
    }

    await refreshIncidents(operatorId);
  }

  populateIncidentMachineOptions();
  setupIncidentForm();
  CM.registerSection("safety", { refresh });
})();
