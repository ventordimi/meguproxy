let proxyConfig = { type: "socks", host: "127.0.0.1", port: 1080, username: "", password: "" };
let proxyRules = [];
let proxyLists = [];

function init() {
  chrome.storage.local.get(["proxyConfig", "proxyRules", "proxyLists"], (res) => {
    if (res.proxyConfig) proxyConfig = res.proxyConfig;
    if (res.proxyRules) proxyRules = res.proxyRules;
    if (res.proxyLists) proxyLists = res.proxyLists;
    applyProxy();
  });
}

function applyProxy() {
  let proxiedDomains = [...proxyRules];
  
  proxyLists.forEach(list => {
    if (list.type === "proxy" && list.domains) {
      proxiedDomains = proxiedDomains.concat(list.domains);
    }
  });

  if (proxiedDomains.length === 0) {
    chrome.proxy.settings.set({
      value: { mode: "direct" },
      scope: "regular"
    }, () => {
      chrome.storage.local.set({ lastProxyError: "" });
    });
    return;
  }

  const proxyStr = `${proxyConfig.type === "socks" ? "SOCKS5" : "PROXY"} ${proxyConfig.host}:${proxyConfig.port}`;
  
  const rulesList = proxiedDomains.map(d => {
    let host = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    if (host.startsWith("*.")) return host.slice(2);
    return host;
  });

  const pacCode = `function FindProxyForURL(url, host) {
    var rules = ${JSON.stringify(rulesList)};
    var proxy = "${proxyStr}; DIRECT";
    host = (host || "").toLowerCase();
    
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (host === r || host.endsWith("." + r)) {
        return proxy;
      }
    }
    return "DIRECT";
  }`;

  const dataUrl = `data:application/x-ns-proxy-autoconfig;charset=utf-8,${encodeURIComponent(pacCode)}`;

  chrome.proxy.settings.set({
    value: {
      mode: "pac_script",
      pacScript: {
        url: dataUrl,
        mandatory: false
      }
    },
    scope: "regular"
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("Chrome Proxy Error:", chrome.runtime.lastError.message);
      chrome.storage.local.set({ lastProxyError: chrome.runtime.lastError.message });
    } else {
      console.log("Прокси успешно применен в Chrome!");
      chrome.storage.local.set({ lastProxyError: "" });
    }
  });
}

chrome.webRequest.onAuthRequired.addListener(
  function(details, callbackFn) {
    if (details.isProxy && proxyConfig.username && proxyConfig.password) {
      callbackFn({ authCredentials: { username: proxyConfig.username, password: proxyConfig.password } });
    } else {
      callbackFn({});
    }
  },
  {urls: ["<all_urls>"]},
  ["asyncBlocking"] // В Chrome обязателен asyncBlocking
);

chrome.storage.onChanged.addListener((changes) => {
  let needsUpdate = false;
  if (changes.proxyConfig) { proxyConfig = changes.proxyConfig.newValue || proxyConfig; needsUpdate = true; }
  if (changes.proxyRules) { proxyRules = changes.proxyRules.newValue || []; needsUpdate = true; }
  if (changes.proxyLists) { proxyLists = changes.proxyLists.newValue || []; needsUpdate = true; }
  
  if (needsUpdate) applyProxy();
});

init();