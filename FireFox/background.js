let proxyConfig = { type: "socks", host: "127.0.0.1", port: 1080, username: "", password: "" };
let proxyRules = [];
let proxyLists = [];

let pE = {}, pS = {}, bE = {}, bS = {};

function normalizeRule(rule) {
  return String(rule || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

function rebuildMaps() {
  pE = {}; pS = {}; bE = {}; bS = {};
  proxyRules.forEach(r => {
    r = normalizeRule(r);
    if (r.startsWith("*.")) pS["." + r.slice(2)] = 1;
    else pE[r] = 1;
  });
  proxyLists.forEach(list => {
    const tExact = list.type === "block" ? bE : pE;
    const tSuffix = list.type === "block" ? bS : pS;
    list.domains.forEach(d => {
      if (d.startsWith("*.")) tSuffix["." + d.slice(2)] = 1;
      else { tExact[d] = 1; tSuffix["." + d] = 1; }
    });
  });
}

function parseList(text) {
  const domains = new Set();
  const lines = text.split('\n');
  for (let line of lines) {
    line = line.trim().toLowerCase();
    if (!line || line.startsWith('!') || line.startsWith('#')) continue;
    const matchHosts = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s]+)/);
    if (matchHosts) { domains.add(matchHosts[1]); continue; }
    if (line.startsWith('||')) {
      let endIdx = line.indexOf('^');
      if (endIdx === -1) endIdx = line.indexOf('/');
      if (endIdx === -1) endIdx = line.indexOf(':');
      if (endIdx === -1) endIdx = line.length;
      let domain = line.substring(2, endIdx).split('$')[0];
      if (domain) domains.add(domain);
      continue;
    }
    if (/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i.test(line)) {
      domains.add(line);
    }
  }
  return Array.from(domains);
}

function buildPacScript() {
  rebuildMaps();
  const proxyStr = `${proxyConfig.type === "socks" ? "SOCKS5" : "PROXY"} ${proxyConfig.host}:${proxyConfig.port}`;
  return `
    var pE = ${JSON.stringify(pE)};
    var pS = ${JSON.stringify(pS)};
    var bE = ${JSON.stringify(bE)};
    var bS = ${JSON.stringify(bS)};
    function FindProxyForURL(url, host) {
      host = (host || "").toLowerCase();
      if (bE[host]) return "PROXY 0.0.0.0:0";
      var parts = host.split('.');
      var current = "";
      for (var i = parts.length - 1; i >= 0; i--) {
        current = "." + parts[i] + current;
        if (bS[current]) return "PROXY 0.0.0.0:0";
      }
      if (pE[host]) return "${proxyStr}; DIRECT";
      current = "";
      for (var i = parts.length - 1; i >= 0; i--) {
        current = "." + parts[i] + current;
        if (pS[current]) return "${proxyStr}; DIRECT";
      }
      return "DIRECT";
    }
  `;
}

async function applyProxy() {
  try {
    const pac = buildPacScript();
    await browser.proxy.settings.set({
      value: { proxyType: "autoConfig", autoConfigUrl: `data:application/x-ns-proxy-autoconfig;charset=utf-8,${encodeURIComponent(pac)}` }
    });
    await browser.storage.local.set({ lastProxyError: "" });
  } catch (e) {
    await browser.storage.local.set({ lastProxyError: String(e.message || e) });
  }
}

browser.webRequest.onAuthRequired.addListener(
  function(details) {
    if (details.isProxy && proxyConfig.username && proxyConfig.password) {
      return { authCredentials: { username: proxyConfig.username, password: proxyConfig.password } };
    }
    return {};
  },
  {urls: ["<all_urls>"]},
  ["blocking"]
);

const tabDomains = {};
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId >= 0) {
      try {
        const host = new URL(details.url).hostname;
        if (host) {
          if (!tabDomains[details.tabId]) tabDomains[details.tabId] = new Set();
          tabDomains[details.tabId].add(host);
        }
      } catch(e){}
    }
  },
  {urls: ["<all_urls>"]}
);
browser.tabs.onRemoved.addListener((tabId) => { delete tabDomains[tabId]; });

function isProxiedOrBlocked(host) {
  host = (host || "").toLowerCase();
  if (bE[host]) return true;
  let parts = host.split('.');
  let current = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    current = "." + parts[i] + current;
    if (bS[current]) return true;
  }
  if (pE[host]) return true;
  current = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    current = "." + parts[i] + current;
    if (pS[current]) return true;
  }
  return false;
}

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "fetchList") {
    fetch(msg.url)
      .then(r => r.text())
      .then(text => {
        const domains = parseList(text);
        proxyLists.push({ id: Date.now(), url: msg.url, type: msg.type, domains });
        return browser.storage.local.set({ proxyLists });
      })
      .then(applyProxy)
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: String(e) }));
    return true;
  }
  if (msg.action === "getUnproxiedDomains") {
    const domains = tabDomains[msg.tabId] ? Array.from(tabDomains[msg.tabId]) : [];
    const unproxied = domains.filter(d => !isProxiedOrBlocked(d));
    sendResponse({ domains: unproxied });
    return true;
  }
});

browser.alarms.create("updateLists", { periodInMinutes: 10 });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "updateLists") updateAllLists();
});

async function updateAllLists() {
  if (proxyLists.length === 0) return;
  let updated = false;
  for (let list of proxyLists) {
    try {
      const r = await fetch(list.url, { cache: 'no-store' });
      if (r.ok) {
        const text = await r.text();
        const domains = parseList(text);
        list.domains = domains;
        updated = true;
      }
    } catch(e) {}
  }
  if (updated) await browser.storage.local.set({ proxyLists });
}

browser.storage.onChanged.addListener(async (changes) => {
  if (changes.proxyConfig) proxyConfig = changes.proxyConfig.newValue || proxyConfig;
  if (changes.proxyRules) proxyRules = changes.proxyRules.newValue || [];
  if (changes.proxyLists) proxyLists = changes.proxyLists.newValue || [];
  await applyProxy();
});

browser.storage.local.get(["proxyConfig", "proxyRules", "proxyLists"]).then(res => {
  if (res.proxyConfig) proxyConfig = res.proxyConfig;
  if (res.proxyRules) proxyRules = res.proxyRules;
  if (res.proxyLists) proxyLists = res.proxyLists;
  applyProxy();
});
