"use strict";

(function () {
  const CM = window.CM;
  let cardStatus = {}; // task_id -> 'todo' | 'in-progress' | 'completed'
  let allTasks = [];   // last-loaded task records, keyed by task_id

  function mapBackendStatus(status) {
    return status === "In Progress" ? "in-progress" : "completed";
  }

  // Build 1-2 "To Do" suggestions for task types this operator hasn't
  // already got today, using that type's most recent real model prediction
  // from task-history (real number, not fabricated).
  function buildSuggestions(history, todayTaskTypes) {
    const seenTypes = new Set(todayTaskTypes);
    const suggestions = [];
    for (const rec of history) {
      if (suggestions.length >= 2) break;
      if (seenTypes.has(rec.task_type)) continue;
      seenTypes.add(rec.task_type);
      suggestions.push({
        task_id: `SUGGESTED-${rec.task_type}`,
        task_type: rec.task_type,
        predicted_duration_min: rec.predicted_duration_min,
        suggested: true,
      });
    }
    return suggestions;
  }

  function cardHTML(task) {
    const durLabel = task.suggested ? "Suggested next" : "Predicted";
    return `
      <div class="kanban-card" draggable="true" data-task-id="${CM.escapeHTML(task.task_id)}">
        <div class="kanban-card-type">${CM.escapeHTML(task.task_type)}</div>
        <div class="kanban-card-id">${CM.escapeHTML(task.task_id)}</div>
        <div class="kanban-card-duration">${durLabel}: ~${task.predicted_duration_min} min</div>
      </div>`;
  }

  function attachDrag(root) {
    root.querySelectorAll(".kanban-card").forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", card.dataset.taskId);
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
    });
  }

  function attachDropzones() {
    document.querySelectorAll(".kanban-drop").forEach((zone) => {
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("drag-over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("drag-over");
        const taskId = e.dataTransfer.getData("text/plain");
        moveCard(taskId, zone.dataset.status);
      });
    });
  }

  function moveCard(taskId, newStatus) {
    const card = document.querySelector(`.kanban-card[data-task-id="${CSS.escape(taskId)}"]`);
    if (!card) return;
    const prevStatus = cardStatus[taskId];
    if (prevStatus === newStatus) return;

    cardStatus[taskId] = newStatus;
    document.getElementById(`drop-${newStatus}`).appendChild(card);
    updateCounts();
    updateProgress();

    if (newStatus === "completed" && prevStatus !== "completed") {
      const task = allTasks.find((t) => t.task_id === taskId);
      CM.toast(`${task ? task.task_type : "Task"} marked complete.`, "success");
    }
  }

  function updateCounts() {
    ["todo", "in-progress", "completed"].forEach((status) => {
      const count = Object.values(cardStatus).filter((s) => s === status).length;
      document.getElementById(`count-${status}`).textContent = count;
    });
  }

  function updateProgress() {
    const total = Object.keys(cardStatus).length;
    const done = Object.values(cardStatus).filter((s) => s === "completed").length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    document.getElementById("task-progress-fill").style.width = `${pct}%`;
    document.getElementById("task-progress-text").textContent = `${done} / ${total} completed`;
  }

  function render(tasks, history) {
    allTasks = tasks;
    cardStatus = {};
    ["drop-todo", "drop-in-progress", "drop-completed"].forEach((id) => { document.getElementById(id).innerHTML = ""; });

    if (!tasks.length) {
      document.getElementById("drop-todo").innerHTML = `<p class="hint">No scheduled tasks found for today.</p>`;
      updateCounts();
      updateProgress();
      return;
    }

    const todayTypes = tasks.map((t) => t.task_type);
    const suggestions = buildSuggestions(history, todayTypes);

    suggestions.forEach((t) => {
      cardStatus[t.task_id] = "todo";
      document.getElementById("drop-todo").insertAdjacentHTML("beforeend", cardHTML(t));
    });
    tasks.forEach((t) => {
      const status = mapBackendStatus(t.status);
      cardStatus[t.task_id] = status;
      document.getElementById(`drop-${status}`).insertAdjacentHTML("beforeend", cardHTML(t));
    });

    allTasks = allTasks.concat(suggestions);
    attachDrag(document.getElementById("kanban-board"));
    updateCounts();
    updateProgress();
  }

  async function refresh(operatorId) {
    // Errors go in their own slot: writing into #kanban-board would destroy
    // the drop columns, and the board could never re-render on recovery.
    const errorEl = document.getElementById("tasks-error");
    try {
      const [tasks, history] = await Promise.all([
        CM.fetchJSON(`/tasks?operator_id=${operatorId}`),
        CM.fetchJSON(`/task-history?operator_id=${operatorId}&limit=20`),
      ]);
      if (CM.isStale(operatorId, "tasks")) return;
      errorEl.innerHTML = "";
      render(tasks, history);
    } catch (err) {
      if (CM.isStale(operatorId, "tasks")) return;
      ["drop-todo", "drop-in-progress", "drop-completed"].forEach((id) => { document.getElementById(id).innerHTML = ""; });
      cardStatus = {};
      updateCounts();
      updateProgress();
      document.getElementById("task-progress-text").textContent = "—";
      CM.showError(errorEl, err);
      throw err;
    }
  }

  attachDropzones();
  CM.registerSection("tasks", { refresh });
})();
