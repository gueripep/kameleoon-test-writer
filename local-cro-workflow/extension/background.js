const WS_URL = 'ws://127.0.0.1:5678';
let socket = null;
let keepAliveInterval = null;
let _logPending = false;
let isEnabled = true;
let pinnedTabId = null; // tab id pinned via the popup's "Target This Tab" button
const TARGET_GROUP_TITLE = 'CRO Target';
let currentState = {
  workspacePath: null,
  workspaceName: null,
  files: []
};
let injectedTabs = new Map();
let connectionStatus = 'disconnected'; // 'connected', 'connecting', 'disconnected'
let reconnectDelay = 5000;
const MAX_RECONNECT_DELAY = 60000;

// Cache of variation files keyed by absolute path. Persisted to chrome.storage.local
// so it survives service-worker restarts and is available before the WS reconnects.
// Used by the webNavigation.onCommitted listener to inject at ~document_start timing.
let cachedFiles = new Map();
let cachedTargeting = null; // JS expression evaluated in the tab; injection skipped if falsy
let lastTargetingResult = undefined; // last resolved targeting value; undefined = never evaluated
const earlyInjectedTabs = new Set(); // tabIds already injected for the current navigation

chrome.storage.local.get({ cachedVariationFiles: [], cachedTargeting: null, pinnedTabId: null }, (data) => {
  pinnedTabId = data.pinnedTabId || null;
  for (const item of data.cachedVariationFiles || []) {
    if (item && item.filePath && item.type && typeof item.content === 'string') {
      cachedFiles.set(item.filePath, { type: item.type, content: item.content });
    }
  }
  cachedTargeting = data.cachedTargeting || null;
});

function persistCachedFiles() {
  const arr = Array.from(cachedFiles.entries()).map(([filePath, val]) => ({
    filePath, type: val.type, content: val.content
  }));
  chrome.storage.local.set({ cachedVariationFiles: arr });
}

function persistTargeting() {
  chrome.storage.local.set({ cachedTargeting });
  lastTargetingResult = undefined; // reset until next injection evaluates it
}

// Resolves the tab the bridge should act on: the pinned tab if one is set and
// still open, otherwise the active tab of the current window.
async function resolveTargetTab() {
  if (pinnedTabId) {
    const tab = await chrome.tabs.get(pinnedTabId).catch(() => null);
    if (tab) return tab;
  }
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTabs[0] || null;
}

// Pins a tab as the bridge's target and moves it into a labeled tab group so
// it's visually obvious which tab the AI agent is working on.
async function setTargetTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error(`Tab ${tabId} not found`);

  pinnedTabId = tabId;
  await chrome.storage.local.set({ pinnedTabId });
  injectedTabs.clear();

  try {
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title: TARGET_GROUP_TITLE, color: 'green' });
  } catch (e) {
    console.warn('[Local CRO Bridge] Failed to group target tab:', e);
  }

  return tab;
}

async function clearTargetTab() {
  pinnedTabId = null;
  await chrome.storage.local.set({ pinnedTabId: null });
}

function matchesUrl(tabUrl, targetUrl) {
  if (!tabUrl || !targetUrl) return false;

  // Regex support: if targetUrl starts/ends with / or contains common regex markers
  const isExplicitRegex = targetUrl.startsWith('/') && targetUrl.endsWith('/') && targetUrl.length > 2;
  const looksLikeRegex = targetUrl.includes('^') || targetUrl.includes('$') || targetUrl.includes('.*');

  if (isExplicitRegex || looksLikeRegex) {
    try {
      const pattern = isExplicitRegex ? targetUrl.slice(1, -1) : targetUrl;
      const regex = new RegExp(pattern);
      if (regex.test(tabUrl)) return true;
      if (isExplicitRegex) return false; // If explicit regex, don't fall back to string matching
    } catch (e) {
      if (isExplicitRegex) return false;
    }
  }

  try {
    const tabHost = new URL(tabUrl).hostname;
    const targetHost = new URL(targetUrl).hostname;
    // Strict match: hostnames must match exactly
    return tabHost === targetHost;
  } catch (e) {
    return tabUrl.includes(targetUrl);
  }
}

// Initialize isEnabled and setup reconnection alarm
chrome.storage.local.get({ enabled: true }, (data) => {
  isEnabled = data.enabled;
  if (isEnabled) connect();
  
  // Reconnection heartbeat every minute to catch any missed states
  chrome.alarms.create('reconnectHeartbeat', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'reconnectHeartbeat' && isEnabled) {
    if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      if (connectionStatus !== 'connecting') {
        console.log('Heartbeat: Attempting reconnection...');
      }
      connect();
    }
  }
});

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return; // Already connecting or connected
  }
  
  connectionStatus = 'connecting';
  console.log('Attempting to connect to Local CRO Daemon at:', WS_URL);
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    connectionStatus = 'connected';
    reconnectDelay = 5000; // Reset backoff on successful connection
    console.log('Connected to Local CRO Daemon');
    keepAliveInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000); // Slightly more frequent ping
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.event === 'hot_reload') {
        handleHotReload(data.payload);
      } else if (data.event === 'state_update') {
        currentState = data.payload;
        console.log('State updated from daemon:', currentState);
      } else if (data.event === 'evaluate_js') {
        handleEvaluateJs(data.payload);
      } else if (data.event === 'click_element') {
        handleClickElement(data.payload);
      } else if (data.event === 'toggle_simulation') {
        handleToggleSimulation(data.payload);
      } else if (data.event === 'reload_page') {
        const targetTabId = data.payload.targetTabId;
        if (targetTabId) {
          chrome.tabs.reload(targetTabId);
        } else {
          const tab = await resolveTargetTab();
          if (tab) chrome.tabs.reload(tab.id);
        }
      } else if (data.event === 'capture_screenshot') {
        handleCaptureScreenshot(data.payload);
      } else if (data.event === 'read_mutation_log') {
        handleReadMutationLog(data.payload);
      } else if (data.event === 'clear_mutation_log') {
        handleClearMutationLog(data.payload);
      } else if (data.event === 'get_status') {
        handleGetStatus(data.payload);
      } else if (data.event === 'set_enabled') {
        handleSetEnabled(data.payload);
      } else if (data.event === 'config_update') {
        if ('targeting' in data.payload) {
          cachedTargeting = data.payload.targeting || null;
          persistTargeting();
        }
      } else if (data.event === 'list_tabs') {
        handleListTabs(data.payload);
      } else if (data.event === 'activate_tab') {
        handleActivateTab(data.payload);
      } else if (data.event === 'open_url') {
        handleOpenUrl(data.payload);
      } else if (data.event === 'set_viewport') {
        handleSetViewport(data.payload);
      } else if (data.event === 'emulate_network') {
        handleEmulateNetwork(data.payload);
      } else if (data.event === 'clear_emulation') {
        handleClearEmulation(data.payload);
      } else if (data.event === 'read_response_headers') {
        handleReadResponseHeaders(data.payload);
      } else if (data.event === 'arm_lifecycle_capture') {
        handleArmLifecycleCapture(data.payload);
      } else if (data.event === 'kameleoon_api') {
        handleKameleoonApi(data.payload);
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  };

  socket.onclose = (event) => {
    if (connectionStatus === 'connected') {
      console.log(`Disconnected (Code: ${event.code}, Reason: ${event.reason}). Reconnecting in ${reconnectDelay/1000}s...`);
    }
    connectionStatus = 'disconnected';
    clearInterval(keepAliveInterval);
    
    // Exponential backoff
    setTimeout(() => {
        connect();
    }, reconnectDelay);
    
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  };

  socket.onerror = (error) => {
    // Only log error details if we were previously connected or if it's not a standard connection refused
    if (connectionStatus === 'connected') {
      console.error('WebSocket Error details:', error);
    }
    
    if (socket.readyState === WebSocket.CLOSED && connectionStatus === 'connected') {
      console.error('Connection refused or lost. Protocol:', socket.protocol, 'URL:', socket.url);
    }
    connectionStatus = 'disconnected';
    socket.close();
  };
}

async function evaluateTargeting(tabId) {
  if (!cachedTargeting || !cachedTargeting.trim()) return true;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (code) => {
        return new Promise((resolve) => {
          const key = '__kamLocalSetTargeting';
          window[key] = (value) => {
            delete window[key];
            resolve(!!value);
          };
          const script = document.createElement('script');
          script.textContent = `(function(){
            const setTargeting = (v) => window['${key}'] && window['${key}'](v);
            const Kameleoon = { API: { Core: {
              runWhenElementPresent: (selector, cb) => {
                const el = document.querySelector(selector);
                if (el) { cb(el); return; }
                const obs = new MutationObserver(() => {
                  const found = document.querySelector(selector);
                  if (found) { obs.disconnect(); cb(found); }
                });
                obs.observe(document.documentElement, { childList: true, subtree: true });
              }
            }}};
            ${code}
          })();`;
          document.documentElement.appendChild(script);
          script.remove();
        });
      },
      args: [cachedTargeting],
      world: 'MAIN'
    });
    lastTargetingResult = results[0]?.result === true;
    return lastTargetingResult;
  } catch (e) {
    console.warn(`[Local CRO Bridge] Could not evaluate targeting for tab ${tabId}:`, e);
    lastTargetingResult = false;
    return false;
  }
}

async function handleHotReload(payload) {
  if (!isEnabled) return;

  // Sync targeting from payload so it's always in step with the variation files.
  if ('targeting' in payload) {
    cachedTargeting = payload.targeting || null;
    persistTargeting();
  }

  // Keep cache in sync so webNavigation.onCommitted can inject at document_start
  // on subsequent navigations.
  if (payload.filePath && payload.type && typeof payload.content === 'string') {
    cachedFiles.set(payload.filePath, { type: payload.type, content: payload.content });
    persistCachedFiles();
  }

  let targetIds = [];

  if (payload.targetTabId) {
    targetIds = [payload.targetTabId];
  } else {
    const tab = await resolveTargetTab();
    if (!tab) return;
    targetIds = [tab.id];
  }

  for (const targetId of targetIds) {
    try {
      const passes = await evaluateTargeting(targetId);
      if (!passes) {
        console.log(`[Local CRO Bridge] Targeting condition not met for tab ${targetId}, skipping injection.`);
        continue;
      }

      // Record injection state
      const tab = await chrome.tabs.get(targetId);
      injectedTabs.set(targetId, {
        title: tab.title,
        url: tab.url,
        lastInjected: Date.now()
      });

      if (payload.type === 'javascript') {
        await chrome.scripting.executeScript({
          target: { tabId: targetId },
          func: (code) => {
            try {
              const script = document.createElement('script');
              script.textContent = code;
              (document.head || document.documentElement).appendChild(script);
              script.remove();
            } catch (e) {
              console.error('Injection error:', e);
            }
          },
          args: [payload.content],
          world: 'MAIN'
        });
      } else if (payload.type === 'css') {
        await chrome.scripting.insertCSS({
          target: { tabId: targetId },
          css: payload.content
        });
      }

      // Debounced log for this tab
      if (!_logPending) {
        _logPending = true;
        setTimeout(() => {
          chrome.scripting.executeScript({ target: { tabId: targetId }, func: () => console.log('✅ [Local CRO Bridge] Code injected successfully.') }).catch(() => {});
          _logPending = false;
        }, 100);
      }
    } catch (err) {
      console.error(`Failed to inject into tab ${targetId}:`, err);
    }
  }
}

async function handleEvaluateJs(payload) {
  if (!isEnabled) return;
  try {
    let targetTabId = payload.targetTabId;

    if (!targetTabId) {
      const tab = await resolveTargetTab();
      if (tab) targetTabId = tab.id;
    }

    if (!targetTabId) throw new Error('No target tab found');

    // Check if the tab still exists and get its URL for chrome:// check
    const targetTab = await chrome.tabs.get(targetTabId).catch(() => null);
    if (!targetTab) throw new Error(`Tab with ID ${targetTabId} not found`);
    if (targetTab.url.startsWith('chrome://')) throw new Error('Cannot access a chrome:// URL');

    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: (code) => {
        try {
          return eval(code);
        } catch (e) {
          return e.toString();
        }
      },
      args: [payload.code],
      world: 'MAIN'
    });
    
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'evaluate_result',
        messageId: payload.messageId,
        result: results[0]?.result
      }));
    }
  } catch(e) {
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'evaluate_result',
        messageId: payload.messageId,
        error: e.toString()
      }));
    }
  }
}

async function handleClickElement(payload) {
  if (!isEnabled) return;
  let tabId = payload.targetTabId;
  let weAttached = false;
  try {
    if (!tabId) {
      const tab = await resolveTargetTab();
      if (tab) tabId = tab.id;
    }
    if (!tabId) throw new Error('No target tab found');

    const targetTab = await chrome.tabs.get(tabId).catch(() => null);
    if (!targetTab) throw new Error(`Tab with ID ${tabId} not found`);
    if (targetTab.url.startsWith('chrome://')) throw new Error('Cannot access a chrome:// URL');

    // Bring the tab to the foreground — CDP-dispatched clicks land on the right
    // tab either way, but if it isn't active/focused the click is invisible to
    // whoever is watching, and some sites gate click handling on document focus.
    await chrome.tabs.update(tabId, { active: true }).catch(() => {});
    if (targetTab.windowId != null) {
      await chrome.windows.update(targetTab.windowId, { focused: true }).catch(() => {});
    }

    const rectResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector, offsetX, offsetY) => {
        const el = document.querySelector(selector);
        if (!el) return { found: false };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2 + offsetX;
        const y = rect.top + rect.height / 2 + offsetY;

        const describe = (node) => {
          if (!node) return 'null';
          const tag = node.tagName ? node.tagName.toLowerCase() : String(node);
          const id = node.id ? `#${node.id}` : '';
          const cls = node.classList && node.classList.length ? `.${[...node.classList].join('.')}` : '';
          return `${tag}${id}${cls}`;
        };

        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
          return {
            found: true,
            clickable: false,
            reason: `Click point (${Math.round(x)}, ${Math.round(y)}) is outside the viewport (${window.innerWidth}x${window.innerHeight})`,
            x, y, width: rect.width, height: rect.height
          };
        }

        const topEl = document.elementFromPoint(x, y);
        if (!topEl || !(topEl === el || el.contains(topEl) || topEl.contains(el))) {
          return {
            found: true,
            clickable: false,
            reason: `Element "${selector}" is obscured at (${Math.round(x)}, ${Math.round(y)}) by ${describe(topEl)} — the click would not reach it`,
            x, y, width: rect.width, height: rect.height
          };
        }

        return { found: true, clickable: true, x, y, width: rect.width, height: rect.height };
      },
      args: [payload.selector, payload.offsetX || 0, payload.offsetY || 0],
      world: 'MAIN'
    });

    const rect = rectResults[0]?.result;
    if (!rect || !rect.found) throw new Error(`Element not found for selector: ${payload.selector}`);
    if (rect.width === 0 || rect.height === 0) throw new Error(`Element matched by "${payload.selector}" has zero size (not visible or not rendered)`);
    if (!rect.clickable) throw new Error(rect.reason);

    const x = rect.x;
    const y = rect.y;

    weAttached = !attachedDebuggers.has(tabId);
    await attachDebugger(tabId);

    // Real, trusted mouse events via CDP — indistinguishable from a genuine user click,
    // unlike el.click()/dispatchEvent() which produce untrusted synthetic events that
    // some listeners (isTrusted checks, native browser controls) silently ignore.
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });

    if (weAttached) {
      chrome.debugger.detach({ tabId }, () => { attachedDebuggers.delete(tabId); });
    }

    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'click_result',
        messageId: payload.messageId,
        result: { success: true, tabId, x, y }
      }));
    }
  } catch (e) {
    if (weAttached && tabId) {
      chrome.debugger.detach({ tabId }, () => { attachedDebuggers.delete(tabId); });
    }
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'click_result',
        messageId: payload.messageId,
        error: e.toString()
      }));
    }
  }
}

async function handleToggleSimulation(payload) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) return;
  const url = new URL(tabs[0].url);
  
  if (payload.enable) {
    await chrome.cookies.set({
      url: url.origin,
      name: 'kameleoonSimulationParameters',
      value: JSON.stringify(payload.parameters || { simulation: true }),
      path: '/'
    });
  } else {
    await chrome.cookies.remove({
      url: url.origin,
      name: 'kameleoonSimulationParameters'
    });
  }
  
  chrome.tabs.reload(tabs[0].id);
}

async function handleReadMutationLog(payload) {
  try {
    const data = await chrome.storage.local.get({ kmMutationLog: [], kmLogStart: null });
    const targetTab = await resolveTargetTab();
    const targetUrl = targetTab ? targetTab.url : null;
    const filteredLog = data.kmMutationLog.filter(entry => !entry.u || !targetUrl || matchesUrl(entry.u, targetUrl));
    
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'mutation_log_result',
        messageId: payload.messageId,
        result: {
          log: filteredLog,
          startedAt: data.kmLogStart
        }
      }));
    }
  } catch (e) {
    console.error('Failed to read mutation log:', e);
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'mutation_log_result',
        messageId: payload.messageId,
        error: e.toString()
      }));
    }
  }
}

async function handleClearMutationLog(payload) {
  try {
    const data = await chrome.storage.local.get({ kmMutationLog: [] });
    const targetTab = await resolveTargetTab();
    const targetUrl = targetTab ? targetTab.url : null;
    const remainingLog = data.kmMutationLog.filter(entry => entry.u && !(targetUrl && matchesUrl(entry.u, targetUrl)));
    
    await chrome.storage.local.set({ kmMutationLog: remainingLog, kmLogStart: Date.now() });
    
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'mutation_log_result',
        messageId: payload.messageId,
        result: { cleared: true, scopedTo: targetUrl }
      }));
    }
  } catch (e) {
    console.error('Failed to clear mutation log:', e);
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'mutation_log_result',
        messageId: payload.messageId,
        error: e.toString()
      }));
    }
  }
}

async function handleSetEnabled(payload) {
  isEnabled = !!payload.enabled;
  await chrome.storage.local.set({ enabled: isEnabled });
  if (isEnabled && (!socket || socket.readyState === WebSocket.CLOSED)) {
    connect();
  }
  if (socket.readyState === WebSocket.OPEN && payload.messageId) {
    socket.send(JSON.stringify({
      type: 'set_enabled_result',
      messageId: payload.messageId,
      result: { isEnabled }
    }));
  }
}

async function handleGetStatus(payload) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabInfo = tabs.length > 0 ? { id: tabs[0].id, url: tabs[0].url, title: tabs[0].title } : null;

    // Report the pinned target tab, if any and still open
    const pinnedTab = pinnedTabId ? await chrome.tabs.get(pinnedTabId).catch(() => null) : null;

    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'status_result',
        messageId: payload.messageId,
        result: {
          activeTab: tabInfo,
          targetTabId: pinnedTab ? pinnedTab.id : null,
          targetTabUrl: pinnedTab ? pinnedTab.url : null,
          isEnabled: isEnabled,
          version: '1.0.2'
        }
      }));
    }
  } catch (e) {
    console.error('Failed to get status:', e);
  }
}

async function handleCaptureScreenshot(payload) {
  if (!isEnabled) return;
  try {
    let targetTabId = payload.targetTabId;
    let targetTab = null;

    if (targetTabId) {
      targetTab = await chrome.tabs.get(targetTabId).catch(() => null);
    } else {
      targetTab = await resolveTargetTab();
    }

    if (targetTab) {
      if (!targetTab.active) {
        await chrome.tabs.update(targetTab.id, { active: true });
        if (targetTab.windowId) {
          await chrome.windows.update(targetTab.windowId, { focused: true });
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!targetTab) throw new Error('No target tab found');
    if (targetTab.url.startsWith('chrome://')) throw new Error('Cannot capture chrome:// URLs');

    let dataUrl = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(targetTab.windowId, { format: 'png' }, (data) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!data) reject(new Error('Captured image data is empty'));
        else resolve(data);
      });
    });

    // Handle cropping if rect is provided
    if (payload.rect) {
      const { x, y, width, height, devicePixelRatio = 1 } = payload.rect;
      try {
        // Fetch the captured image into a blob
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);

        const canvas = new OffscreenCanvas(width * devicePixelRatio, height * devicePixelRatio);
        const ctx = canvas.getContext('2d');
        
        ctx.drawImage(
          imageBitmap,
          x * devicePixelRatio, y * devicePixelRatio, width * devicePixelRatio, height * devicePixelRatio,
          0, 0, width * devicePixelRatio, height * devicePixelRatio
        );

        const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
        const arrayBuffer = await croppedBlob.arrayBuffer();
        const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        dataUrl = `data:image/png;base64,${base64}`;
      } catch (cropErr) {
        console.error('Cropping failed, returning full screenshot:', cropErr);
      }
    }
    
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'screenshot_result',
        messageId: payload.messageId,
        result: dataUrl
      }));
    }
  } catch (e) {
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'screenshot_result',
        messageId: payload.messageId,
        error: e.toString()
      }));
    }
  }
}

async function handleListTabs(payload) {
  if (!isEnabled) return;
  try {
    const tabs = await chrome.tabs.query({});
    const result = tabs.map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active,
      windowId: tab.windowId
    }));

    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'tabs_result',
        messageId: payload.messageId,
        result: result
      }));
    }
  } catch (e) {
    console.error('Failed to list tabs:', e);
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'tabs_result',
        messageId: payload.messageId,
        error: e.toString()
      }));
    }
  }
}

// --- Kameleoon Automation API proxy ------------------------------------------------
// Issues api.kameleoon.com calls from inside a logged-in app.kameleoon.com tab so they
// inherit the user's session cookie. The cookie itself is never read, stored or sent
// anywhere: only the HTTP status and the parsed response body come back over the socket.
const KAMELEOON_API_ORIGIN = 'https://api.kameleoon.com';
const KAMELEOON_APP_TAB_MATCH = 'https://app.kameleoon.com/*';
// DELETE is deliberately absent — this bridge creates and updates, it never destroys.
const KAMELEOON_ALLOWED_METHODS = ['GET', 'POST', 'PATCH'];

async function handleKameleoonApi(payload) {
  if (!isEnabled) return;
  const { messageId, method, url, body } = payload || {};

  const respond = (msg) => {
    if (socket && socket.readyState === WebSocket.OPEN && messageId) {
      socket.send(JSON.stringify({ type: 'kameleoon_api_result', messageId, ...msg }));
    }
  };

  try {
    const verb = String(method || 'GET').toUpperCase();
    if (!KAMELEOON_ALLOWED_METHODS.includes(verb)) {
      throw new Error(`Method ${verb} is not allowed by the Kameleoon API proxy (allowed: ${KAMELEOON_ALLOWED_METHODS.join(', ')})`);
    }
    if (typeof url !== 'string' || !url.startsWith(`${KAMELEOON_API_ORIGIN}/`)) {
      throw new Error(`Refusing to call ${url} — the Kameleoon API proxy only calls ${KAMELEOON_API_ORIGIN}`);
    }

    const tabs = await chrome.tabs.query({ url: KAMELEOON_APP_TAB_MATCH });
    const tab = tabs.find(t => !t.discarded && t.status === 'complete') || tabs.find(t => !t.discarded) || tabs[0];
    if (!tab) {
      throw new Error('No app.kameleoon.com tab is open. Open https://app.kameleoon.com in Chrome and log in (impersonating the client account first, if this is client work), then retry. The bridge never logs in for you.');
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (verb, url, body) => {
        try {
          const init = { method: verb, credentials: 'include', headers: { Accept: 'application/json' } };
          if (body !== null && body !== undefined && verb !== 'GET') {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
          }
          const res = await fetch(url, init);
          const text = await res.text();
          let parsed = null;
          let isJson = false;
          try {
            parsed = text ? JSON.parse(text) : null;
            isJson = true;
          } catch (e) { /* non-JSON body, e.g. an HTML login page */ }
          return {
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            body: isJson ? parsed : null,
            rawBody: isJson ? null : text.slice(0, 2000)
          };
        } catch (e) {
          return { ok: false, status: 0, networkError: String(e) };
        }
      },
      args: [verb, url, body === undefined ? null : body],
      world: 'MAIN'
    });

    const result = results && results[0] ? results[0].result : null;
    if (!result) throw new Error(`No response from the app.kameleoon.com tab (${tab.id}) — it may have navigated mid-request`);

    respond({ result: { ...result, method: verb, url, tab: { id: tab.id, url: tab.url } } });
  } catch (e) {
    respond({ error: e.toString() });
  }
}

async function handleActivateTab(payload) {
  if (!isEnabled) return;
  try {
    const tab = await chrome.tabs.update(payload.tabId, { active: true });
    // Also focus the window if needed
    if (tab.windowId) {
       await chrome.windows.update(tab.windowId, { focused: true });
    }

    if (payload.setTarget) {
      await setTargetTab(payload.tabId);
    }

    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'activate_result',
        messageId: payload.messageId,
        result: { success: true, tabId: payload.tabId, targeted: !!payload.setTarget }
      }));
    }
  } catch (e) {
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'activate_result',
        messageId: payload.messageId,
        error: e.toString()
      }));
    }
  }
}

async function handleOpenUrl(payload) {
  if (!isEnabled) return;
  try {
    const tab = await chrome.tabs.create({ url: payload.url });
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'open_url_result',
        messageId: payload.messageId,
        result: { success: true, tabId: tab.id, url: tab.url }
      }));
    }
  } catch (e) {
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'open_url_result',
        messageId: payload.messageId,
        error: e.toString()
      }));
    }
  }
}

// --- Debugger & Emulation Handlers ---

const attachedDebuggers = new Set();

// Pending read_response_headers captures: messageId -> capture state
const pendingHeaderCaptures = new Map();

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== 'Network.responseReceived') return;
  for (const capture of pendingHeaderCaptures.values()) {
    if (capture.tabId !== source.tabId) continue;
    const responseUrl = params.response.url;
    const responseType = params.type; // 'Document', 'Script', 'Stylesheet', etc.
    const isMainDocument = responseType === 'Document';
    const urlToMatch = capture.targetUrl ? capture.targetUrl.replace(/#.*$/, '') : null;
    const matchesTarget = !urlToMatch || responseUrl === urlToMatch || responseUrl.startsWith(urlToMatch);
    const matchesFilter = !capture.urlFilter || responseUrl.includes(capture.urlFilter);
    const shouldCapture = capture.includeSubresources ? matchesFilter : (isMainDocument && matchesTarget);
    if (!shouldCapture) continue;
    capture.results.push({
      url: responseUrl,
      type: responseType,
      status: params.response.status,
      statusText: params.response.statusText,
      headers: params.response.headers,
      mimeType: params.response.mimeType,
      protocol: params.response.protocol || null,
      fromCache: !!(params.response.fromDiskCache || params.response.fromServiceWorker),
      remoteIPAddress: params.response.remoteIPAddress || null,
    });
    if (!capture.includeSubresources && isMainDocument && matchesTarget) {
      capture.resolve();
    }
  }
});

async function attachDebugger(tabId) {
  if (attachedDebuggers.has(tabId)) return;
  
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        if (chrome.runtime.lastError.message.includes('already attached')) {
          attachedDebuggers.add(tabId);
          resolve();
        } else {
          reject(new Error(chrome.runtime.lastError.message));
        }
      } else {
        attachedDebuggers.add(tabId);
        resolve();
      }
    });
  });
}

async function handleSetViewport(payload) {
  if (!isEnabled) return;
  try {
    const tab = payload.targetTabId ? null : await resolveTargetTab();
    const tabId = payload.targetTabId || tab?.id;
    if (!tabId) throw new Error('No target tab found for viewport resize');

    await attachDebugger(tabId);

    const metrics = {
      width: payload.width,
      height: payload.height,
      deviceScaleFactor: payload.deviceScaleFactor || 0,
      mobile: !!payload.mobile,
      screenOrientation: payload.mobile ? { angle: 0, type: 'portraitPrimary' } : undefined
    };

    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', metrics);

    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'viewport_result',
        messageId: payload.messageId,
        result: { success: true, tabId, metrics }
      }));
    }
  } catch (e) {
    console.error('Viewport resizing failed:', e);
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'viewport_result',
        messageId: payload.messageId,
        error: e.toString()
      }));
    }
  }
}

async function handleEmulateNetwork(payload) {
  if (!isEnabled) return;
  try {
    const tab = payload.targetTabId ? null : await resolveTargetTab();
    const tabId = payload.targetTabId || tab?.id;
    if (!tabId) throw new Error('No target tab found for network emulation');

    await attachDebugger(tabId);

    await chrome.debugger.sendCommand({ tabId }, 'Network.emulateNetworkConditions', {
      offline: !!payload.offline,
      latency: payload.latency || 0,
      downloadThroughput: (payload.downloadThroughput || -1) * 1024 / 8, // Convert kbps to bytes/sec if needed? CDPS uses bytes/sec
      uploadThroughput: (payload.uploadThroughput || -1) * 1024 / 8,
      connectionType: payload.connectionType || 'none'
    });

    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'network_result',
        messageId: payload.messageId,
        result: { success: true, tabId }
      }));
    }
  } catch (e) {
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'network_result',
        messageId: payload.messageId,
        error: e.toString()
      }));
    }
  }
}

async function handleClearEmulation(payload) {
  if (!isEnabled) return;
  try {
    const tab = payload.targetTabId ? null : await resolveTargetTab();
    const tabId = payload.targetTabId || tab?.id;
    if (!tabId) throw new Error('No target tab found to clear emulation');

    if (attachedDebuggers.has(tabId)) {
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride');
      await chrome.debugger.sendCommand({ tabId }, 'Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1
      });
      
      chrome.debugger.detach({ tabId }, () => {
        attachedDebuggers.delete(tabId);
      });
    }

    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'clear_emulation_result',
        messageId: payload.messageId,
        result: { success: true, tabId }
      }));
    }
  } catch (e) {
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'clear_emulation_result',
        messageId: payload.messageId,
        error: e.toString()
      }));
    }
  }
}

async function handleReadResponseHeaders(payload) {
  if (!isEnabled) return;
  const { messageId, targetTabId, url, requestContext = 'top-level', includeSubresources = false, urlFilter, timeoutMs = 15000 } = payload;

  const sendResult = (result) => {
    if (socket.readyState === WebSocket.OPEN && messageId) {
      socket.send(JSON.stringify({ type: 'response_headers_result', messageId, result }));
    }
  };
  const sendError = (err) => {
    if (socket.readyState === WebSocket.OPEN && messageId) {
      socket.send(JSON.stringify({ type: 'response_headers_result', messageId, error: err.toString() }));
    }
  };

  let captureTabId = null;
  let ephemeralTab = null;

  try {
    // Resolve the target tab
    let tabId = targetTabId;
    if (!tabId) {
      const resolved = await resolveTargetTab();
      if (resolved) tabId = resolved.id;
    }
    if (!tabId) throw new Error('No target tab found');

    const tab = await chrome.tabs.get(tabId);
    const targetUrl = url || tab.url;
    if (!targetUrl || targetUrl.startsWith('chrome://')) throw new Error('Cannot capture headers for chrome:// URLs');

    if (requestContext === 'iframe') {
      // Create a synthetic tab that loads the URL inside an iframe so the browser
      // sends Sec-Fetch-Dest: iframe, which some servers use to vary their response headers.
      const encodedSrc = targetUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      const html = encodeURIComponent(`<html><body style="margin:0"><iframe src="${encodedSrc}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe></body></html>`);
      ephemeralTab = await chrome.tabs.create({ url: 'about:blank', active: false });
      captureTabId = ephemeralTab.id;
    } else {
      captureTabId = tabId;
    }

    await attachDebugger(captureTabId);
    await chrome.debugger.sendCommand({ tabId: captureTabId }, 'Network.enable');

    const results = [];
    const captureKey = messageId;

    const cleanup = async () => {
      pendingHeaderCaptures.delete(captureKey);
      try { await chrome.debugger.sendCommand({ tabId: captureTabId }, 'Network.disable'); } catch (e) {}
      if (ephemeralTab) {
        chrome.tabs.remove(ephemeralTab.id).catch(() => {});
        attachedDebuggers.delete(ephemeralTab.id);
      }
    };

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        await cleanup();
        if (results.length > 0) resolve();
        else reject(new Error('Timed out waiting for response headers — no matching responses captured'));
      }, timeoutMs);

      pendingHeaderCaptures.set(captureKey, {
        tabId: captureTabId,
        targetUrl,
        urlFilter: urlFilter || null,
        includeSubresources: !!includeSubresources,
        results,
        timeout,
        resolve: async () => { clearTimeout(timeout); await cleanup(); resolve(); },
        reject: async (err) => { clearTimeout(timeout); await cleanup(); reject(err); },
      });

      if (requestContext === 'iframe') {
        const encodedSrc = targetUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const html = encodeURIComponent(`<html><body style="margin:0"><iframe src="${encodedSrc}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe></body></html>`);
        chrome.tabs.update(captureTabId, { url: `data:text/html,${html}` }).catch(reject);
      } else {
        chrome.tabs.reload(captureTabId).catch(reject);
      }
    });

    sendResult({ url: targetUrl, requestContext, responses: results });
  } catch (e) {
    sendError(e.message || e.toString());
  }
}

// --- Lifecycle timeline capture ---
// Arms lifecycle_recorder.js (document_start, MAIN world) by writing a spec into
// the target tab's sessionStorage, reloads, then polls the buffered timeline back.
async function handleArmLifecycleCapture(payload) {
  if (!isEnabled) return;
  const { messageId } = payload;

  const sendResult = (result) => {
    if (socket.readyState === WebSocket.OPEN && messageId) {
      socket.send(JSON.stringify({ type: 'lifecycle_timeline_result', messageId, result }));
    }
  };
  const sendError = (err) => {
    if (socket.readyState === WebSocket.OPEN && messageId) {
      socket.send(JSON.stringify({ type: 'lifecycle_timeline_result', messageId, error: err.toString() }));
    }
  };

  try {
    // Resolve the target tab (same precedence as evaluate_js).
    let targetTabId = payload.targetTabId;
    if (!targetTabId) {
      const tab = await resolveTargetTab();
      if (tab) targetTabId = tab.id;
    }
    if (!targetTabId) throw new Error('No target tab found');

    const tab = await chrome.tabs.get(targetTabId).catch(() => null);
    if (!tab) throw new Error(`Tab with ID ${targetTabId} not found`);
    if (tab.url.startsWith('chrome://')) throw new Error('Cannot access a chrome:// URL');

    const cap = payload.selfReload ? Math.min(3, Math.max(1, payload.selfReload.count || 1)) : 0;
    const atMs = payload.selfReload ? (payload.selfReload.atMs != null ? payload.selfReload.atMs : 1000) : 0;

    const spec = {
      armed: true,
      captureId: messageId,
      expressions: payload.expressions || [],
      hooks: payload.hooks || {},
      sampleIntervalMs: payload.sampleIntervalMs || 50,
      maxDurationMs: payload.maxDurationMs || 8000,
      selfReload: payload.selfReload ? { count: cap, atMs } : null
    };

    // Optional: wipe ALL client-side state for the origin so we land as close as
    // possible to a brand-new visitor. Every clear here is best-effort — one
    // failing store must not abort the capture.
    if (payload.freshVisitor) {
      const origin = new URL(tab.url).origin;

      // 1. Broadest origin-scoped wipe: cookies, localStorage, IndexedDB,
      //    CacheStorage, service workers, Web SQL, filesystems. sessionStorage is
      //    NOT covered by browsingData (it is per-tab) — handled separately below.
      try {
        await chrome.browsingData.remove(
          { origins: [origin], since: 0 },
          {
            cacheStorage: true,
            cookies: true,
            fileSystems: true,
            indexedDB: true,
            localStorage: true,
            serviceWorkers: true,
            webSQL: true,
          }
        );
      } catch (e) { /* browsingData wipe best-effort */ }

      // 2. Sweep cookies again via chrome.cookies. browsingData's origin filter can
      //    miss cookies scoped to the registrable/parent domain (e.g. `.example.com`),
      //    so remove every cookie visible for this URL explicitly.
      try {
        const cookies = await chrome.cookies.getAll({ url: origin });
        await Promise.all(
          cookies.map(c => {
            const proto = c.secure ? 'https://' : 'http://';
            const host = c.domain.replace(/^\./, '');
            const url = `${proto}${host}${c.path || '/'}`;
            return chrome.cookies.remove({ url, name: c.name }).catch(() => {});
          })
        );
      } catch (e) { /* cookie sweep best-effort */ }

      // 3. Clear sessionStorage (not covered by browsingData). Preserve only the
      //    __kmLifecycle* arm/buffer keys so the recorder can still be armed.
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: () => {
          try {
            const keys = [];
            for (let i = 0; i < window.sessionStorage.length; i++) {
              const k = window.sessionStorage.key(i);
              if (k) keys.push(k);
            }
            keys.forEach(k => { if (k.indexOf('__kmLifecycle') !== 0) window.sessionStorage.removeItem(k); });
          } catch (e) {}
        },
        world: 'MAIN'
      }).catch(() => {});
    }

    // Arm: write the spec into sessionStorage and clear any stale buffer/counters.
    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: (specJson) => {
        try {
          sessionStorage.setItem('__kmLifecycleSpec', specJson);
          sessionStorage.removeItem('__kmLifecycleTimeline');
          sessionStorage.removeItem('__kmLifecycleRun');
          sessionStorage.removeItem('__kmLifecycleReloads');
        } catch (e) {}
      },
      args: [JSON.stringify(spec)],
      world: 'MAIN'
    });

    // Reload to trigger the document_start recorder.
    await chrome.tabs.reload(targetTabId);

    // Poll the buffered timeline back. Budget = capture window + self-reload
    // overhead + margin.
    const deadline = spec.maxDurationMs + cap * (atMs + 2500) + 5000;
    const readTimeline = async () => {
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: () => { try { return sessionStorage.getItem('__kmLifecycleTimeline'); } catch (e) { return null; } },
        world: 'MAIN'
      }).catch(() => null);
      return res && res[0] ? res[0].result : null;
    };

    const start = Date.now();
    while (Date.now() - start < deadline) {
      await new Promise(r => setTimeout(r, 400));
      const raw = await readTimeline();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.done) { sendResult(parsed); return; }
        } catch (e) {}
      }
    }

    // Deadline hit — return whatever partial buffer exists, if any.
    const raw = await readTimeline();
    if (raw) {
      try { sendResult({ ...JSON.parse(raw), timedOut: true }); return; } catch (e) {}
    }
    throw new Error('Lifecycle capture timed out with no buffered timeline');
  } catch (e) {
    sendError(e.message || e.toString());
  }
}

// Cleanup debuggers and stale target pin on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  attachedDebuggers.delete(tabId);
  if (tabId === pinnedTabId) clearTargetTab();
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TOGGLE_ENABLED') {
    isEnabled = message.enabled;
    if (isEnabled) {
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        connect();
      }
    }
    
    // Reload active tab
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs.length > 0) chrome.tabs.reload(tabs[0].id);
    });
  } else if (message.type === 'SET_TARGET_TAB') {
    (async () => {
      try {
        const tab = await setTargetTab(message.tabId);
        sendResponse({ ok: true, tab: { id: tab.id, url: tab.url, title: tab.title } });
      } catch (e) {
        sendResponse({ ok: false, error: e.toString() });
      }
    })();
  } else if (message.type === 'CLEAR_TARGET_TAB') {
    (async () => {
      await clearTargetTab();
      sendResponse({ ok: true });
    })();
  } else if (message.type === 'GET_DETAILED_STATE') {
    (async () => {
      const targetingResult = !cachedTargeting || !cachedTargeting.trim() ? null : lastTargetingResult;
      const targetTab = pinnedTabId ? await chrome.tabs.get(pinnedTabId).catch(() => null) : null;
      // Pinned tab was closed — drop the stale reference.
      if (pinnedTabId && !targetTab) await clearTargetTab();
      sendResponse({
        isEnabled,
        connectionStatus,
        currentState,
        injectedTabs: Array.from(injectedTabs.values()),
        targetingResult,
        targetTab: targetTab ? { id: targetTab.id, url: targetTab.url, title: targetTab.title } : null
      });
    })();
  } else if (message.type === 'SPA_NAVIGATION') {
    // Re-trigger injection for SPA soft-navigations on the pinned tab
    if (isEnabled && pinnedTabId && sender.tab && sender.tab.id === pinnedTabId) {
      console.log('SPA Navigation detected, re-applying injections...');
      // Request all files from daemon to ensure sync
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'request_all_files', tabId: sender.tab.id }));
      }
    }
  }
  return true; // Keep channel open for async response
});

async function injectCachedFiles(tabId) {
  const passes = await evaluateTargeting(tabId);
  if (!passes) {
    console.log(`[Local CRO Bridge] Targeting condition not met for tab ${tabId}, skipping injection.`);
    return;
  }
  let injectedAny = false;
  // CSS first — order doesn't affect timing for stylesheets.
  for (const fileData of cachedFiles.values()) {
    if (fileData.type !== 'css') continue;
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, frameIds: [0] },
        css: fileData.content
      });
      injectedAny = true;
    } catch (e) { /* tab navigated away or closed */ }
  }
  for (const fileData of cachedFiles.values()) {
    if (fileData.type !== 'javascript') continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: (code) => {
          try {
            const script = document.createElement('script');
            script.textContent = code;
            (document.head || document.documentElement).appendChild(script);
            script.remove();
          } catch (e) {
            console.error('[Local CRO Bridge] Early injection error:', e);
          }
        },
        args: [fileData.content],
        world: 'MAIN',
        injectImmediately: true
      });
      injectedAny = true;
    } catch (e) { /* tab navigated away or closed */ }
  }
  if (injectedAny) {
    chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => console.log('✅ [Local CRO Bridge] Code injected successfully.')
    }).catch(() => {});
  }
}

// Inject at navigation-commit time (≈ document_start) so the variation runs
// before the page's own scripts and before any framework hydration.
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (!isEnabled) return;
  if (details.frameId !== 0) return;

  if (!pinnedTabId || details.tabId !== pinnedTabId) return;
  if (cachedFiles.size === 0) return; // cold start — fall through to the onUpdated path

  earlyInjectedTabs.add(details.tabId);
  // Auto-clear in case onUpdated 'complete' never fires (e.g. aborted navigation)
  setTimeout(() => earlyInjectedTabs.delete(details.tabId), 10000);

  await injectCachedFiles(details.tabId);

  try {
    const tab = await chrome.tabs.get(details.tabId);
    injectedTabs.set(details.tabId, {
      title: tab.title,
      url: tab.url,
      lastInjected: Date.now()
    });
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isEnabled) return;
  if (changeInfo.status === 'complete') {
    // Skip the late re-injection if webNavigation.onCommitted already handled this nav.
    if (earlyInjectedTabs.has(tabId)) {
      earlyInjectedTabs.delete(tabId);
      return;
    }
    if (tab.url && tab.url.startsWith('http') && pinnedTabId && tabId === pinnedTabId) {
      const msg = JSON.stringify({ type: 'request_all_files', tabId: tabId });
      
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(msg);
      } else if (isEnabled) {
        if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
           connect();
        }
        const waitAndSend = () => {
           if (isEnabled) socket.send(msg);
           socket.removeEventListener('open', waitAndSend);
        };
        socket.addEventListener('open', waitAndSend);
      }
    }
  }
});
