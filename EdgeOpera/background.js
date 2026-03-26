let proxyConfig = { type: "socks", host: "127.0.0.1", port: 1080, username: "", password: "" };
let proxyRules = [];

function init() {
  chrome.storage.local.get(["proxyConfig", "proxyRules"], (res) => {
    if (res.proxyConfig) proxyConfig = res.proxyConfig;
    if (res.proxyRules) proxyRules = res.proxyRules;
    applyProxy();
  });
}

function applyProxy() {
  if (!proxyConfig.host) return;

  const proxyType = proxyConfig.type === "socks" ? "SOCKS5" : "PROXY";
  const proxyStr = `${proxyType} ${proxyConfig.host}:${proxyConfig.port}`;
  
  let domains = [];
  proxyRules.forEach(r => {
    let d = r.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    if (d) domains.push(d);
  });

  if (domains.length === 0) {
    chrome.proxy.settings.set({ value: { mode: "system" }, scope: "regular" });
    return;
  }

  const pacCode = `
    function FindProxyForURL(url, host) {
      var domains = ${JSON.stringify(domains)};
      var p = "${proxyStr}";
      
      for (var i = 0; i < domains.length; i++) {
        var d = domains[i];
        if (d.indexOf("*.") === 0) {
           var suffix = d.substring(1);
           if (host === d.substring(2) || host.indexOf(suffix, host.length - suffix.length) !== -1) {
              return p;
           }
        } else {
           if (host === d) {
              return p;
           }
        }
      }
      return "DIRECT";
    }
  `;

  const encodedPac = "data:application/x-ns-proxy-autoconfig;base64," + btoa(pacCode);

  const config = {
    mode: "pac_script",
    pacScript: {
      url: encodedPac
    }
  };

  chrome.proxy.settings.set({ value: config, scope: "regular" }, () => {
    console.log("PAC Script URL applied:", encodedPac);
  });
}

chrome.webRequest.onAuthRequired.addListener(
  function(details, callbackFn) {
    if (details.isProxy && proxyConfig.username && proxyConfig.password) {
      callbackFn({
        authCredentials: { username: proxyConfig.username, password: proxyConfig.password }
      });
    } else {
      callbackFn({});
    }
  },
  {urls: ["<all_urls>"]},
  ["asyncBlocking"]
);

chrome.storage.onChanged.addListener((changes) => {
  let update = false;
  if (changes.proxyConfig) { proxyConfig = changes.proxyConfig.newValue || proxyConfig; update = true; }
  if (changes.proxyRules) { proxyRules = changes.proxyRules.newValue || []; update = true; }
  if (update) applyProxy();
});

init();