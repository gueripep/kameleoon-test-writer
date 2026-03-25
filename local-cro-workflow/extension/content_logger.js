// DOM Mutation Logger & Console Logger — injected at document_start
(function () {
  chrome.storage.local.get({ enabled: true }, (data) => {
    if (!data.enabled) return;

    // --- Inject Console Logger into MAIN world ---
    const script = document.createElement('script');
    script.textContent = `
      window.__kmBridgeLogs = [];
      const _kmOriginalConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
      function _kmIntercept(type, args) {
         try {
            const msg = Array.from(args).map(a => {
               if (typeof a === 'object') {
                  try { return JSON.stringify(a); } catch(e) { return String(a); }
               }
               return String(a);
            }).join(' ');
            window.__kmBridgeLogs.push({ ts: Date.now(), type, msg });
            if (window.__kmBridgeLogs.length > 500) window.__kmBridgeLogs.shift();
         } catch(e) {}
         _kmOriginalConsole[type].apply(console, args);
      }
      console.log = function() { _kmIntercept('log', arguments); };
      console.warn = function() { _kmIntercept('warn', arguments); };
      console.error = function() { _kmIntercept('error', arguments); };
      console.info = function() { _kmIntercept('info', arguments); };
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    // ---------------------------------------------

    const MAX_ENTRIES = 200;
    const KEYWORDS = ['hothome', 'kameleoon', 'km-', 'special-offer', 'button-group', 'property-info', 'property-metadata', 'moved'];

    function isRelevant(el) {
      if (!el || el.nodeType !== 1) return false;
      const id = (el.id || '').toLowerCase();
      const cls = (el.className?.toString?.() || '').toLowerCase();
      return KEYWORDS.some(kw => id.includes(kw) || cls.includes(kw));
    }

    function describe(el) {
      return el.tagName + '#' + (el.id || '') + '.' + (el.className?.toString?.().substring(0, 60) || '');
    }

    // Clear log on fresh navigation
    chrome.storage.local.set({ kmMutationLog: [], kmLogStart: Date.now() });

    const observer = new MutationObserver(function (muts) {
      const entries = [];
      muts.forEach(function (m) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(function (n) {
            if (isRelevant(n)) {
              entries.push({
                t: Date.now(),
                action: 'ADDED',
                node: describe(n),
                parent: describe(m.target),
                u: window.location.href
              });
            }
          });
          m.removedNodes.forEach(function (n) {
            if (isRelevant(n)) {
              entries.push({
                t: Date.now(),
                action: 'REMOVED',
                node: describe(n),
                parent: describe(m.target),
                u: window.location.href
              });
            }
          });
        } else if (m.type === 'attributes' && isRelevant(m.target)) {
          entries.push({
            t: Date.now(),
            action: 'ATTR',
            node: describe(m.target),
            attr: m.attributeName,
            oldValue: m.oldValue?.substring(0, 60),
            u: window.location.href
          });
        }
      });

      if (entries.length > 0) {
        chrome.storage.local.get({ kmMutationLog: [] }, function (data) {
          const log = data.kmMutationLog.concat(entries).slice(-MAX_ENTRIES);
          chrome.storage.local.set({ kmMutationLog: log });
        });
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class', 'style', 'data-moved']
    });
  });
})();
