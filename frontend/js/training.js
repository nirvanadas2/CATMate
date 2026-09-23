"use strict";

(function () {
  const CM = window.CM;

  // ---------------------------------------------------------------- e-learning videos
  // Real, officially-uploaded videos from Caterpillar's own YouTube channels -
  // verified by actually rendering each as a live <iframe> embed in a
  // browser (not just an oEmbed lookup, which does NOT guarantee the
  // uploader allows embedding - a prior video list passed oEmbed but threw
  // Error 153 in a real embed).
  const VIDEOS = [
    { id: "sdMTxG5yDE0", title: "Safety Basics: Seat Belts", channel: "Cat® Products", topic: "seatbelt", tag: "Seatbelt & General Safety" },
    { id: "FYXOox-TDGo", title: "Cat® Simulators: Blind Spot Awareness", channel: "Simformotion LLC", topic: "proximity", tag: "Proximity & Hazard Awareness" },
    { id: "OH8F8QCS0Pc", title: "Auto Idle Feature: Cat® Backhoe Loader Operator Tip", channel: "Cat Landscaping and Construction", topic: "idling", tag: "Idle Reduction & Fuel Efficiency" },
    { id: "XIZcC_NRoOE", title: "How to Conduct a Safety Walkaround on Your Machine", channel: "Cat® Products", topic: "general", tag: "Pre-Op Checks & General Safety" },
  ];

  function topicsFromRecs(recs) {
    const topics = new Set();
    recs.forEach((r) => {
      const t = r.title.toLowerCase();
      if (t.includes("seatbelt")) topics.add("seatbelt");
      if (t.includes("proximity")) topics.add("proximity");
      if (t.includes("idle")) topics.add("idling");
    });
    return topics;
  }

  function loadVideo(card, video) {
    const embed = card.querySelector(".video-embed");
    embed.innerHTML = `<iframe src="https://www.youtube.com/embed/${video.id}?autoplay=1" title="${CM.escapeHTML(video.title)}"
      frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }

  function renderVideos(recommendedTopics) {
    const grid = document.getElementById("video-grid");
    grid.innerHTML = VIDEOS.map((v, i) => {
      const recommended = recommendedTopics.has(v.topic);
      return `
        <div class="video-card ${recommended ? "recommended" : ""}" data-video-index="${i}">
          ${recommended ? `<span class="video-recommended-tag">Recommended for you</span>` : ""}
          <div class="video-embed">
            <button type="button" class="video-thumb-btn" style="background-image:url('https://img.youtube.com/vi/${v.id}/hqdefault.jpg')" aria-label="Play ${CM.escapeHTML(v.title)}">
              <span class="video-play-icon">▶</span>
            </button>
          </div>
          <div class="video-meta">
            <div class="video-title">${CM.escapeHTML(v.title)}</div>
            <div class="video-sub">${CM.escapeHTML(v.channel)} · <span class="video-tag">${CM.escapeHTML(v.tag)}</span></div>
          </div>
        </div>`;
    }).join("");

    grid.querySelectorAll(".video-card").forEach((card) => {
      const btn = card.querySelector(".video-thumb-btn");
      btn.addEventListener("click", () => loadVideo(card, VIDEOS[Number(card.dataset.videoIndex)]));
    });
  }

  // ---------------------------------------------------------------- recommended cards (reuses /training)

  function renderRecs(cards, operatorId) {
    const el = document.getElementById("training-recs");
    if (!cards.length) { el.innerHTML = `<p class="hint">No training recommended right now.</p>`; return; }
    el.innerHTML = cards.map((c) => {
      const key = CM.trainingKey(operatorId, c.title);
      const done = localStorage.getItem(key) === "1";
      return `
        <div class="training-card">
          <div class="training-main">
            <span class="training-title">${CM.escapeHTML(c.title)}</span>
            <span class="training-meta">${CM.escapeHTML(c.format)} · ${c.duration_min} min</span>
            <span class="training-reason">${CM.escapeHTML(c.reason)}</span>
          </div>
          <button type="button" class="training-toggle ${done ? "completed" : ""}" data-key="${CM.escapeHTML(key)}">
            ${done ? "✓ Completed" : "Mark Complete"}
          </button>
        </div>`;
    }).join("");

    el.querySelectorAll(".training-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        const nowDone = localStorage.getItem(key) !== "1";
        localStorage.setItem(key, nowDone ? "1" : "0");
        btn.classList.toggle("completed", nowDone);
        btn.textContent = nowDone ? "✓ Completed" : "Mark Complete";
        updateTrainingChip(cards, operatorId);
        if (nowDone) CM.toast("Training marked complete.", "success");
      });
    });
    updateTrainingChip(cards, operatorId);
  }

  function updateTrainingChip(cards, operatorId) {
    CM.setTrainingChip(CM.trainingCompletionPct(operatorId, cards));
  }

  // ---------------------------------------------------------------- instructor booking

  const INSTRUCTORS = [
    { id: "j-alvarez", name: "J. Alvarez", specialty: "Safety Compliance" },
    { id: "r-nguyen", name: "R. Nguyen", specialty: "Proximity & Hazard Awareness" },
    { id: "t-brooks", name: "T. Brooks", specialty: "Efficient Operation" },
  ];
  const TIME_SLOTS = ["08:00", "10:00", "13:00", "15:00"];

  let bookingSelection = { instructor: null, day: null, time: null };

  function bookingsKey(operatorId) { return `catmate_bookings_${operatorId}`; }
  function getBookings(operatorId) {
    try { return JSON.parse(localStorage.getItem(bookingsKey(operatorId))) || []; } catch (_) { return []; }
  }
  function saveBooking(operatorId, booking) {
    const bookings = getBookings(operatorId);
    bookings.push(booking);
    localStorage.setItem(bookingsKey(operatorId), JSON.stringify(bookings));
  }

  function nextDays(n) {
    const days = [];
    const today = new Date();
    for (let i = 1; i <= n; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }

  function renderBookingWidget(operatorId) {
    // A half-made selection or a "Booked with…" note belongs to the previous
    // operator - start clean so Confirm can't book it for this one.
    bookingSelection = { instructor: null, day: null, time: null };
    updateConfirmState();
    const msg = document.getElementById("booking-msg");
    msg.textContent = "";
    msg.className = "booking-msg";

    const instructorsEl = document.getElementById("booking-instructors");
    instructorsEl.innerHTML = INSTRUCTORS.map((ins) => `
      <button type="button" class="instructor-pick" data-id="${ins.id}">
        <span class="instructor-name">${CM.escapeHTML(ins.name)}</span>
        <span class="instructor-specialty">${CM.escapeHTML(ins.specialty)}</span>
      </button>`).join("");

    const daysEl = document.getElementById("booking-days");
    daysEl.innerHTML = nextDays(7).map((d) => {
      const iso = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      return `<button type="button" class="day-pick" data-day="${iso}">${label}</button>`;
    }).join("");

    const timesEl = document.getElementById("booking-times");
    timesEl.innerHTML = TIME_SLOTS.map((t) => `<button type="button" class="time-pick" data-time="${t}">${t}</button>`).join("");

    instructorsEl.querySelectorAll(".instructor-pick").forEach((btn) => {
      btn.addEventListener("click", () => {
        instructorsEl.querySelectorAll(".instructor-pick").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        bookingSelection.instructor = btn.dataset.id;
        updateConfirmState();
      });
    });
    daysEl.querySelectorAll(".day-pick").forEach((btn) => {
      btn.addEventListener("click", () => {
        daysEl.querySelectorAll(".day-pick").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        bookingSelection.day = btn.dataset.day;
        updateConfirmState();
      });
    });
    timesEl.querySelectorAll(".time-pick").forEach((btn) => {
      btn.addEventListener("click", () => {
        timesEl.querySelectorAll(".time-pick").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        bookingSelection.time = btn.dataset.time;
        updateConfirmState();
      });
    });

    renderBookingList(operatorId);
  }

  function updateConfirmState() {
    const btn = document.getElementById("booking-confirm");
    btn.disabled = !(bookingSelection.instructor && bookingSelection.day && bookingSelection.time);
  }

  function renderBookingList(operatorId) {
    const bookings = getBookings(operatorId);
    const el = document.getElementById("booking-list");
    if (!bookings.length) { el.innerHTML = `<p class="hint" style="margin-top:12px;">No sessions booked yet.</p>`; return; }
    el.innerHTML = `<h3 class="booking-list-head">Your bookings</h3>` + bookings.map((b) => {
      const ins = INSTRUCTORS.find((i) => i.id === b.instructor);
      return `<div class="booking-row">${CM.escapeHTML(ins ? ins.name : b.instructor)} — ${CM.escapeHTML(b.day)} at ${CM.escapeHTML(b.time)}</div>`;
    }).join("");
  }

  function setupBookingConfirm() {
    document.getElementById("booking-confirm").addEventListener("click", () => {
      const operatorId = CM.state.currentOperator;
      saveBooking(operatorId, { ...bookingSelection, bookedAt: new Date().toISOString() });
      const ins = INSTRUCTORS.find((i) => i.id === bookingSelection.instructor);
      const msg = document.getElementById("booking-msg");
      msg.textContent = `Booked with ${ins.name} on ${bookingSelection.day} at ${bookingSelection.time}.`;
      msg.className = "booking-msg ok";
      CM.toast("Instructor session booked.", "success");
      bookingSelection = { instructor: null, day: null, time: null };
      document.querySelectorAll(".instructor-pick, .day-pick, .time-pick").forEach((b) => b.classList.remove("selected"));
      updateConfirmState();
      renderBookingList(operatorId);
    });
  }

  // ---------------------------------------------------------------- hazard-spotting simulation

  const SIM_DURATION_S = 9;
  const HAZARD_TYPES = [
    { type: "person", label: "worker too close to the machine's swing radius" },
    { type: "power-line", label: "overhead power line in the work zone" },
    { type: "edge", label: "unguarded edge / drop-off" },
    { type: "rocks", label: "loose rock and debris pile underfoot" },
  ];
  const DECOY_TYPES = ["cone", "toolbox", "vehicle", "barrel"];

  let sim = {
    phase: "idle", // idle | countdown | running | done
    hazards: [], decoys: [],
    hitHazards: new Set(), hitDecoys: new Set(),
    endAt: 0, rafId: null,
  };

  function simRandomPoint(existing) {
    let x, y, tries = 0;
    do {
      x = 50 + Math.random() * 620;
      y = 90 + Math.random() * 250;
      tries++;
    } while (existing.some((p) => Math.hypot(p.x - x, p.y - y) < 60) && tries < 50);
    return { x, y };
  }

  function drawScene(ctx) {
    ctx.clearRect(0, 0, 720, 380);
    ctx.fillStyle = "#dce8f2"; ctx.fillRect(0, 0, 720, 70);
    ctx.fillStyle = "#cdbb8f"; ctx.fillRect(0, 70, 720, 310);
    // simple excavator silhouette - the reference point for "too close"
    ctx.fillStyle = "#f2b705";
    ctx.fillRect(300, 150, 120, 60);
    ctx.beginPath(); ctx.arc(330, 210, 22, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(390, 210, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1c1c1a";
    ctx.fillRect(360, 110, 12, 50);
    ctx.fillRect(300, 100, 60, 20);
  }

  function drawHazardIcon(ctx, p, type, tint) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = tint;
    switch (type) {
      case "person":
        ctx.beginPath(); ctx.arc(0, -15, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-7, -9); ctx.lineTo(7, -9); ctx.lineTo(5, 12); ctx.lineTo(-5, 12); ctx.closePath(); ctx.fill();
        break;
      case "power-line":
        ctx.fillRect(-2, -22, 4, 32);
        ctx.strokeStyle = tint; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-16, -20); ctx.lineTo(16, -20); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(3, -16); ctx.lineTo(-5, -2); ctx.lineTo(1, -2); ctx.lineTo(-4, 12); ctx.lineTo(7, -6); ctx.lineTo(1, -6); ctx.closePath();
        ctx.fill();
        break;
      case "edge":
        ctx.beginPath();
        ctx.moveTo(-18, 4); ctx.lineTo(-7, -7); ctx.lineTo(2, 3); ctx.lineTo(11, -9); ctx.lineTo(18, 2);
        ctx.lineTo(18, 12); ctx.lineTo(-18, 12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#1c1c1a"; ctx.fillRect(-18, 12, 36, 3);
        break;
      case "rocks":
        ctx.beginPath(); ctx.arc(-7, 5, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(6, 3, 9, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -6, 6, 0, Math.PI * 2); ctx.fill();
        break;
    }
    ctx.restore();
  }

  function drawDecoyIcon(ctx, p, type, tint) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = tint;
    switch (type) {
      case "cone":
        ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(9, 11); ctx.lineTo(-9, 11); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillRect(-7, 1, 14, 3);
        break;
      case "toolbox":
        ctx.fillRect(-12, -5, 24, 15);
        ctx.strokeStyle = tint; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(-6, -12); ctx.lineTo(6, -12); ctx.lineTo(6, -5); ctx.stroke();
        break;
      case "vehicle":
        ctx.fillRect(-15, -5, 30, 11);
        ctx.beginPath(); ctx.arc(-9, 8, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(9, 8, 4, 0, Math.PI * 2); ctx.fill();
        break;
      case "barrel":
        ctx.beginPath(); ctx.ellipse(0, 0, 8, 13, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#1c1c1a"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(0, -3, 8, 3, 0, 0, Math.PI * 2); ctx.stroke();
        break;
    }
    ctx.restore();
  }

  function simRedraw() {
    const canvas = document.getElementById("sim-canvas");
    const ctx = canvas.getContext("2d");
    drawScene(ctx);
    if (sim.phase === "idle") return;

    sim.hazards.forEach((h, i) => {
      let tint = "#d9822b"; // unclicked, in play
      if (sim.phase === "done") tint = sim.hitHazards.has(i) ? "#2f7a45" : "#b03636";
      else if (sim.hitHazards.has(i)) tint = "#2f7a45";
      drawHazardIcon(ctx, h.p, h.type, tint);
    });
    sim.decoys.forEach((d, i) => {
      let tint = "#8a8a82";
      if (sim.hitDecoys.has(i)) tint = "#b03636";
      drawDecoyIcon(ctx, d.p, d.type, tint);
    });

    if (sim.phase === "countdown") {
      ctx.fillStyle = "rgba(28,28,26,0.55)";
      ctx.fillRect(0, 0, 720, 380);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 72px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(sim.countdownValue > 0 ? String(sim.countdownValue) : "GO!", 360, 190);
    }
  }

  function simTick() {
    if (sim.phase !== "running") return;
    const remaining = Math.max(0, sim.endAt - Date.now());
    document.getElementById("sim-status").textContent =
      `Time left: ${(remaining / 1000).toFixed(1)}s — ${sim.hitHazards.size}/${HAZARD_TYPES.length} hazards found`;
    if (remaining <= 0) { simEnd(); return; }
    sim.rafId = requestAnimationFrame(simTick);
  }

  function layoutRound() {
    const existing = [];
    sim.hazards = HAZARD_TYPES.map((h) => {
      const p = simRandomPoint(existing); existing.push(p);
      return { p, type: h.type, label: h.label };
    });
    sim.decoys = DECOY_TYPES.map((type) => {
      const p = simRandomPoint(existing); existing.push(p);
      return { p, type };
    });
    sim.hitHazards = new Set();
    sim.hitDecoys = new Set();
  }

  function simStart() {
    if (sim.phase === "countdown" || sim.phase === "running") return;
    document.getElementById("sim-results").hidden = true;
    layoutRound();
    sim.phase = "countdown";
    sim.countdownValue = 3;
    document.getElementById("sim-start").disabled = true;
    document.getElementById("sim-status").textContent = "Get ready…";
    simRedraw();

    const countdownStep = () => {
      sim.countdownValue -= 1;
      simRedraw();
      if (sim.countdownValue > 0) {
        setTimeout(countdownStep, 700);
      } else {
        setTimeout(() => {
          sim.phase = "running";
          sim.endAt = Date.now() + SIM_DURATION_S * 1000;
          simRedraw();
          simTick();
        }, 500);
      }
    };
    setTimeout(countdownStep, 700);
  }

  function simEnd() {
    sim.phase = "done";
    if (sim.rafId) cancelAnimationFrame(sim.rafId);
    simRedraw();

    const found = sim.hitHazards.size;
    const total = HAZARD_TYPES.length;
    const decoysClicked = sim.hitDecoys.size;
    const decoysAvoided = DECOY_TYPES.length - decoysClicked;
    const score = found - decoysClicked;

    const missed = HAZARD_TYPES.filter((_, i) => !sim.hitHazards.has(i));
    let debrief;
    if (found === total && decoysClicked === 0) {
      debrief = "Perfect spotting — every hazard identified with no false positives.";
    } else if (missed.length) {
      debrief = `You spotted ${found} of ${total} hazards — the ${missed[0].label} is easy to miss when focused elsewhere on the scene.`;
    } else {
      debrief = `You found all ${total} hazards, but clicked ${decoysClicked} object${decoysClicked === 1 ? "" : "s"} that weren't hazards — a false alarm still costs time on a real site.`;
    }

    document.getElementById("sim-status").textContent = "Round complete.";
    const results = document.getElementById("sim-results");
    results.hidden = false;
    results.innerHTML = `
      <div class="sim-results-row"><span>Hazards found</span><b>${found} / ${total}</b></div>
      <div class="sim-results-row"><span>Decoys avoided</span><b>${decoysAvoided} / ${DECOY_TYPES.length}</b></div>
      <div class="sim-results-row"><span>Final score</span><b>${score}</b></div>
      <p class="sim-debrief">${CM.escapeHTML(debrief)}</p>`;

    document.getElementById("sim-start").disabled = false;
    document.getElementById("sim-start").textContent = "Play Again";
    CM.toast(`Simulation complete — score ${score}.`, score >= total - 1 ? "success" : "info");
  }

  function simSetup() {
    const canvas = document.getElementById("sim-canvas");
    drawScene(canvas.getContext("2d"));
    document.getElementById("sim-start").addEventListener("click", simStart);
    canvas.addEventListener("click", (e) => {
      if (sim.phase !== "running") return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      sim.hazards.forEach((h, i) => { if (!sim.hitHazards.has(i) && Math.hypot(h.p.x - x, h.p.y - y) < 18) sim.hitHazards.add(i); });
      sim.decoys.forEach((d, i) => { if (!sim.hitDecoys.has(i) && Math.hypot(d.p.x - x, d.p.y - y) < 16) sim.hitDecoys.add(i); });
      simRedraw();
    });
  }

  // ---------------------------------------------------------------- refresh

  async function refresh(operatorId) {
    const recsEl = document.getElementById("training-recs");
    CM.showLoading(recsEl);
    try {
      const cards = await CM.fetchJSON(`/training?operator_id=${operatorId}`);
      if (CM.isStale(operatorId, "training")) return;
      renderRecs(cards, operatorId);
      renderVideos(topicsFromRecs(cards));
    } catch (err) {
      if (CM.isStale(operatorId, "training")) return;
      CM.showError(recsEl, err);
    }
    renderBookingWidget(operatorId);
  }

  simSetup();
  setupBookingConfirm();
  CM.registerSection("training", { refresh });
})();
