"use strict";

(function () {
  const CM = window.CM;
  const SUGGESTIONS = [
    "Why am I getting this warning?",
    "How much idle time did I have today?",
    "What should I check before starting?",
    "Is my machine ready for the next task?",
    "Why did my readiness score decrease?",
  ];

  function addMessage(text, from) {
    const el = document.createElement("div");
    el.className = `chat-msg ${from}`;
    el.textContent = text;
    const container = document.getElementById("chatbot-messages");
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  async function ask(question) {
    addMessage(question, "user");
    const container = document.getElementById("chatbot-messages");
    const thinking = document.createElement("div");
    thinking.className = "chat-msg bot thinking";
    thinking.textContent = "…";
    container.appendChild(thinking);
    container.scrollTop = container.scrollHeight;

    // If the operator changes while this is in flight, the answer still
    // describes the operator it was asked about - label it so it can't be
    // read as being about the newly selected one.
    const operatorId = CM.state.currentOperator;
    try {
      const res = await CM.fetchJSON(`/copilot?operator_id=${operatorId}&question=${encodeURIComponent(question)}`);
      thinking.remove();
      addMessage(operatorId === CM.state.currentOperator ? res.answer : `(About ${operatorId}) ${res.answer}`, "bot");
    } catch (err) {
      thinking.remove();
      addMessage(CM.isOffline(err) ? "I can't reach the backend right now — start python app.py and try again." : `Error: ${err.message}`, "bot");
    }
  }

  function renderSuggestions() {
    document.getElementById("chatbot-suggestions").innerHTML =
      SUGGESTIONS.map((s) => `<button type="button" class="chat-suggestion">${CM.escapeHTML(s)}</button>`).join("");
    document.querySelectorAll(".chat-suggestion").forEach((btn) => btn.addEventListener("click", () => ask(btn.textContent)));
  }

  function setup() {
    const widget = document.getElementById("chatbot-widget");
    const panel = document.getElementById("chatbot-panel");

    document.getElementById("chatbot-toggle").addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      widget.classList.toggle("expanded", !panel.hidden);
      if (!panel.hidden && !document.getElementById("chatbot-messages").children.length) {
        addMessage(`Hi, I'm the CATMate Assistant. Ask me about ${CM.state.currentOperator}'s shift — or tap a suggestion below.`, "bot");
      }
    });
    document.getElementById("chatbot-close").addEventListener("click", () => {
      panel.hidden = true;
      widget.classList.remove("expanded");
    });
    document.getElementById("chatbot-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("chatbot-input");
      const q = input.value.trim();
      if (!q) return;
      input.value = "";
      ask(q);
    });
    document.getElementById("operator-select").addEventListener("change", (e) => {
      if (document.getElementById("chatbot-messages").children.length) {
        addMessage(`Switched to ${e.target.value}. Ask me anything about this operator's shift.`, "bot");
      }
    });

    renderSuggestions();
  }

  setup();
})();
