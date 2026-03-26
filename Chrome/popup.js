const api = typeof browser !== "undefined" ? browser : chrome;

document.addEventListener("DOMContentLoaded", async () => {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".panel");
  const els = {
    domainInput: document.getElementById("domainInput"), statusIcon: document.getElementById("statusIcon"),
    addRule: document.getElementById("addRuleBtn"), removeRule: document.getElementById("removeRuleBtn"),
    addAll: document.getElementById("addAllBtn"),
    rulesStatus: document.getElementById("rulesStatus"), openList: document.getElementById("openListBtn"),
    pType: document.getElementById("proxyType"), pHost: document.getElementById("proxyHost"),
    pPort: document.getElementById("proxyPort"), pUser: document.getElementById("proxyUser"),
    pPass: document.getElementById("proxyPass"), saveProxy: document.getElementById("saveProxyBtn"),
    pStatus: document.getElementById("proxyStatus"), lUrl: document.getElementById("listUrl"),
    lAct: document.getElementById("listAction"), addList: document.getElementById("addListBtn"),
    toggleLists: document.getElementById("toggleListsBtn"), lCont: document.getElementById("listsContainer"),
    lStatus: document.getElementById("listStatus")
  };

  let currentRules = [];
  let currentLists = [];
  let activeTab = null;

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      panels.forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      panels[i].classList.add("active");
    });
  });

  els.toggleLists.addEventListener("click", () => {
    els.lCont.style.display = els.lCont.style.display === "none" ? "block" : "none";
  });

  function normalize(v) { return String(v||"").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""); }
  function toGuiRule(v) { const h = normalize(v).replace(/^\*\./, ""); return h ? `*.${h}` : ""; }
  function matches(h, r) {
    const hh = normalize(h), rr = normalize(r);
    if (!hh || !rr) return false;
    if (rr.startsWith("*.")) { const b = rr.slice(2); return hh === b || hh.endsWith(`.${b}`); }
    return hh === rr;
  }
  function refreshIcon() {
    const v = els.domainInput.value.trim();
    els.statusIcon.textContent = currentRules.some(r => matches(v, r)) ? "✅" : "❌";
  }
  function flash(el, t, c = "#57f287") {
    el.style.color = c; el.textContent = t;
    setTimeout(() => { if (el.textContent === t) el.textContent = ""; }, 2000);
  }

  async function checkAutoReload(rule) {
    if (activeTab && activeTab.url) {
      const url = new URL(activeTab.url);
      if (matches(url.hostname, rule)) {
         if(api.tabs.reload) {
             api.tabs.reload(activeTab.id);
         }
      }
    }
  }

  function renderLists() {
    els.lCont.textContent = "";
    if (currentLists.length > 0) {
      els.toggleLists.style.display = "block";
      els.toggleLists.textContent = `Управление списками (${currentLists.length})`;
    } else {
      els.toggleLists.style.display = "none";
      els.lCont.style.display = "none";
    }

    currentLists.forEach(l => {
      const div = document.createElement("div"); div.className = "list-item";
      const infoDiv = document.createElement("div"); infoDiv.className = "info"; infoDiv.title = l.url;
      const typ = l.type === "block" ? "🛑 Блок" : "🚀 Прокси";
      infoDiv.textContent = `[${typ}] ${l.domains.length} шт.`;
      infoDiv.appendChild(document.createElement("br"));
      const span = document.createElement("span"); span.style.color = "#b5bac1"; span.style.fontSize = "10px"; span.textContent = l.url;
      infoDiv.appendChild(span);
      const delDiv = document.createElement("div"); delDiv.className = "del"; delDiv.dataset.id = l.id; delDiv.textContent = "✖";
      div.appendChild(infoDiv); div.appendChild(delDiv); els.lCont.appendChild(div);
    });

    document.querySelectorAll(".del").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const id = Number(e.target.dataset.id);
        currentLists = currentLists.filter(x => x.id !== id);
        api.storage.local.set({ proxyLists: currentLists }, () => {
           renderLists();
        });
      });
    });
  }

  function loadState() {
    api.storage.local.get(["proxyConfig", "proxyRules", "proxyLists", "lastProxyError"], (res) => {
      currentRules = Array.isArray(res.proxyRules) ? res.proxyRules : [];
      currentLists = Array.isArray(res.proxyLists) ? res.proxyLists : [];
      if (res.proxyConfig) {
        els.pType.value = res.proxyConfig.type || "socks";
        els.pHost.value = res.proxyConfig.host || "127.0.0.1";
        els.pPort.value = res.proxyConfig.port || 1080;
        els.pUser.value = res.proxyConfig.username || "";
        els.pPass.value = res.proxyConfig.password || "";
      }
      renderLists();
      api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url) {
          activeTab = tabs[0];
          try {
             const host = new URL(activeTab.url).hostname;
             if (host) els.domainInput.value = toGuiRule(host);
          } catch(e){}
        }
        refreshIcon();
        if (res.lastProxyError) flash(els.pStatus, res.lastProxyError, "#ff6b6b");
      });
    });
  }

  els.saveProxy.addEventListener("click", () => {
    const c = { 
      type: els.pType.value, host: els.pHost.value.trim(), port: Number(els.pPort.value),
      username: els.pUser.value.trim(), password: els.pPass.value.trim()
    };
    if (!c.host || !c.port) return flash(els.pStatus, "Заполните хост и порт", "#ff6b6b");
    api.storage.local.set({ proxyConfig: c }, () => {
       flash(els.pStatus, "Сохранено");
    });
  });

  els.addRule.addEventListener("click", () => {
    const rule = toGuiRule(els.domainInput.value);
    if (!rule) return flash(els.rulesStatus, "Пустое правило", "#ff6b6b");
    els.domainInput.value = rule;
    if (!currentRules.includes(rule)) { 
        currentRules.push(rule); 
        api.storage.local.set({ proxyRules: currentRules }, () => {
            refreshIcon(); 
            flash(els.rulesStatus, "Добавлено");
            checkAutoReload(rule);
        }); 
    } else {
        refreshIcon(); 
        flash(els.rulesStatus, "Уже есть");
    }
  });

  els.addAll.addEventListener("click", () => {
    if (!activeTab) return;
    els.addAll.textContent = "...";
    api.runtime.sendMessage({action: "getUnproxiedDomains", tabId: activeTab.id}, (res) => {
        if (api.runtime.lastError) {} // Ignore disconnected port error
        if (res && res.domains && res.domains.length > 0) {
          let added = 0;
          res.domains.forEach(d => {
            const rule = `*.${normalize(d).replace(/^\*\./, "")}`;
            if (!currentRules.includes(rule)) { currentRules.push(rule); added++; }
          });
          if (added > 0) {
              api.storage.local.set({ proxyRules: currentRules }, () => {
                  refreshIcon(); 
                  flash(els.rulesStatus, `Добавлено: ${added}`);
                  els.addAll.textContent = "Добавить сайт";
                  if(api.tabs.reload) api.tabs.reload(activeTab.id);
              });
          } else {
              els.addAll.textContent = "Добавить сайт";
          }
        } else {
          flash(els.rulesStatus, "Новых нет");
          els.addAll.textContent = "Добавить сайт";
        }
    });
  });

  els.removeRule.addEventListener("click", () => {
    const rule = toGuiRule(els.domainInput.value);
    if (!rule) return flash(els.rulesStatus, "Пустое правило", "#ff6b6b");
    els.domainInput.value = rule;
    currentRules = currentRules.filter(i => normalize(i) !== normalize(rule));
    api.storage.local.set({ proxyRules: currentRules }, () => {
        refreshIcon(); 
        flash(els.rulesStatus, "Удалено");
        checkAutoReload(rule);
    });
  });

  els.addList.addEventListener("click", () => {
    const url = els.lUrl.value.trim();
    if (!url.startsWith("http")) return flash(els.lStatus, "Введите корректный URL", "#ff6b6b");
    els.addList.textContent = "Загрузка...";
    api.runtime.sendMessage({ action: "fetchList", url, type: els.lAct.value }, (res) => {
        if (api.runtime.lastError) {}
        els.addList.textContent = "Скачать и применить список";
        if (res && res.success) { els.lUrl.value = ""; flash(els.lStatus, "Список применен!"); } 
        else flash(els.lStatus, "Ошибка скачивания", "#ff6b6b");
    });
  });

  els.openList.addEventListener("click", () => {
      const url = api.runtime.getURL("list.html");
      api.tabs.create({ url: url });
  });
  els.domainInput.addEventListener("input", refreshIcon);
  
  api.storage.onChanged.addListener((c, a) => {
    if (a !== "local") return;
    if (c.proxyRules) { currentRules = c.proxyRules.newValue || []; refreshIcon(); }
    if (c.proxyLists) { currentLists = c.proxyLists.newValue || []; renderLists(); }
    if (c.lastProxyError && c.lastProxyError.newValue) flash(els.pStatus, c.lastProxyError.newValue, "#ff6b6b");
  });

  loadState();
});