let proxyConfig = { type: "socks", host: "127.0.0.1", port: 1080 };
let proxyRules = [];
let proxyLists = [];

function normalizeRule(rule) {
  return String(rule || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

function parseList(text) {
  const domains = new Set();
  const lines = text.split('\n');
  for (let line of lines) {
    line = line.trim().toLowerCase();
    if (!line || line.startsWith('!') || line.startsWith('#')) continue;

    const matchHosts = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s]+)/);
    if (matchHosts) {
      domains.add(matchHosts[1]);
      continue;
    }

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
  const pExact = {}; const pSuffix = {};
  const bExact = {}; const bSuffix = {};

  proxyRules.forEach(r => {
    r = normalizeRule(r);
    if (r.startsWith("*.")) pSuffix["." + r.slice(2)] = 1;
    else pExact[r] = 1;
  });

  proxyLists.forEach(list => {
    const tExact = list.type === "block" ? bExact : pExact;
    const tSuffix = list.type === "block" ? bSuffix : pSuffix;
    list.domains.forEach(d => {
      if (d.startsWith("*.")) {
        tSuffix["." + d.slice(2)] = 1;
      } else {
        tExact[d] = 1;
        tSuffix["." + d] = 1;
      }
    });
  });

  const proxyStr = `${proxyConfig.type === "socks" ? "SOCKS5" : "PROXY"} ${proxyConfig.host}:${proxyConfig.port}`;

  return `
    var pE = ${JSON.stringify(pExact)};
    var pS = ${JSON.stringify(pSuffix)};
    var bE = ${JSON.stringify(bExact)};
    var bS = ${JSON.stringify(bSuffix)};
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
      value: {
        proxyType: "autoConfig",
        autoConfigUrl: `data:application/x-ns-proxy-autoconfig;charset=utf-8,${encodeURIComponent(pac)}`
      }
    });
    await browser.storage.local.set({ lastProxyError: "" });
  } catch (e) {
    await browser.storage.local.set({ lastProxyError: String(e.message || e) });
  }
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
});

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
