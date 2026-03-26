const api = typeof browser !== "undefined" ? browser : chrome;

document.addEventListener("DOMContentLoaded", () => {
  const editor = document.getElementById("rulesEditor");
  const saveBtn = document.getElementById("saveBtn");
  const status = document.getElementById("status");

  function normalizeRule(rule) { return String(rule || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""); }
  function flash(text, color = "#57f287") { status.style.color = color; status.textContent = text; setTimeout(() => { if (status.textContent === text) status.textContent = ""; }, 1800); }

  api.storage.local.get(["proxyRules"], (res) => {
      const rules = Array.isArray(res.proxyRules) ? res.proxyRules : [];
      editor.value = rules.join("\n");
  });

  saveBtn.addEventListener("click", () => {
    const unique = [...new Set(editor.value.split("\n").map(normalizeRule).filter(Boolean))];
    api.storage.local.set({ proxyRules: unique }, () => {
        editor.value = unique.join("\n");
        flash("Сохранено");
    });
  });
});