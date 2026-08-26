// DOM Mutation Logger & Console Logger — injected at document_start
(function () {
  chrome.storage.local.get({ enabled: true }, (data) => {
    if (!data.enabled) return;

    const MAX_ENTRIES = 200;
    const KEYWORDS = ['hothome', 'kameleoon', 'km-', 'special-offer', 'button-group', 'property-info', 'property-metadata', 'moved'];

    function isRelevant(el) {
      if (!el || el.nodeType !== 1) return false;
      const id = String(el.id || '').toLowerCase();
      const cls = (el.className?.toString?.() || '').toLowerCase();
      return KEYWORDS.some(kw => id.includes(kw) || cls.includes(kw));
    }

    function describe(el) {
      return el.tagName + '#' + String(el.id || '') + '.' + (el.className?.toString?.().substring(0, 60) || '');
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

    // --- SPA Navigation Support (Navigation API) ---
    if (window.navigation) {
      window.navigation.addEventListener('navigate', (event) => {
        // Only trigger for same-document (SPA) navigations
        if (event.canIntercept && !event.hashChange && event.downloadRequest === null) {
          chrome.runtime.sendMessage({ 
            type: 'SPA_NAVIGATION', 
            url: event.destination.url 
          });
        }
      });
    } else {
      // Fallback for older browsers (standard but less reliable in some SPAs)
      let lastHref = window.location.href;
      setInterval(() => {
        if (lastHref !== window.location.href) {
          lastHref = window.location.href;
          chrome.runtime.sendMessage({ 
            type: 'SPA_NAVIGATION', 
            url: lastHref 
          });
        }
      }, 1000);
    }
  });
})();
