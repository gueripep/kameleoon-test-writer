// Runs in MAIN world — intercepts console before page scripts execute
window.__kmBridgeLogs = [];
const _kmOriginalConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function _kmIntercept(type, args) {
  try {
    const msg = Array.from(args).map(a => {
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }
      return String(a);
    }).join(' ');
    window.__kmBridgeLogs.push({ ts: Date.now(), type, msg });
    if (window.__kmBridgeLogs.length > 500) window.__kmBridgeLogs.shift();
  } catch (e) {}
  _kmOriginalConsole[type].apply(console, args);
}
console.log = function () { _kmIntercept('log', arguments); };
console.warn = function () { _kmIntercept('warn', arguments); };
console.error = function () { _kmIntercept('error', arguments); };
console.info = function () { _kmIntercept('info', arguments); };
