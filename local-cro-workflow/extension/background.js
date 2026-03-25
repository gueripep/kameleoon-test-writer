const WS_URL = 'ws://127.0.0.1:5678';
let socket = null;
let keepAliveInterval = null;
let _logPending = false;
let isEnabled = true;
let cachedUrl = null;
let currentState = {
  workspacePath: null,
  workspaceName: null,
  files: [],
  url: null,
  previewUrl: null
};
let injectedTabs = new Map();
let connectionStatus = 'disconnected'; // 'connected', 'connecting', 'disconnected'
let reconnectDelay = 5000;
const MAX_RECONNECT_DELAY = 60000;

function getUrl() {
  return cachedUrl || currentState.url || null;
}

function getPreviewUrl() {
  return currentState.previewUrl || getUrl();
}

function isValidUrl(str) {
  if (!str) return false;
  try {
    new URL(str);
    return true;
  } catch (e) {
    return false;
  }
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
      } else if (data.event === 'toggle_simulation') {
        handleToggleSimulation(data.payload);
      } else if (data.event === 'reload_page') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) chrome.tabs.reload(tabs[0].id);
      } else if (data.event === 'capture_screenshot') {
        handleCaptureScreenshot(data.payload);
      } else if (data.event === 'read_mutation_log') {
        handleReadMutationLog(data.payload);
      } else if (data.event === 'clear_mutation_log') {
        handleClearMutationLog(data.payload);
      } else if (data.event === 'get_status') {
        handleGetStatus(data.payload);
      } else if (data.event === 'config_update') {
        const oldUrl = getUrl();
        cachedUrl = data.payload.url;
        if (oldUrl !== cachedUrl) {
          injectedTabs.clear();
        }
        console.log('Syncing dynamic config from config.json:', cachedUrl);
      } else if (data.event === 'list_tabs') {
        handleListTabs(data.payload);
      } else if (data.event === 'activate_tab') {
        handleActivateTab(data.payload);
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

async function handleHotReload(payload) {
  if (!isEnabled) return;
  let targetIds = [];
  
  if (payload.targetTabId) {
    // If it's a direct target, we still double-check the URL to be safe,
    // unless it was a manual triggers (which usually don't have payload.url)
    if (payload.url) {
       const tab = await chrome.tabs.get(payload.targetTabId).catch(() => null);
       if (tab && !matchesUrl(tab.url, payload.url)) {
         console.log(`Skipping injection for tab ${payload.targetTabId} as its URL ${tab.url} does not match target ${payload.url}`);
         return;
       }
    }
    targetIds = [payload.targetTabId];
  } else if (payload.url) {
    // Find all tabs that match the target URL
    const allTabs = await chrome.tabs.query({});
    targetIds = allTabs.filter(t => matchesUrl(t.url, payload.url)).map(t => t.id);
    
    if (targetIds.length === 0) {
      const openUrl = (payload.previewUrl && isValidUrl(payload.previewUrl)) ? payload.previewUrl : (isValidUrl(payload.url) ? payload.url : null);
      if (openUrl) {
        console.log(`Target URL not found, opening priority URL: ${openUrl}...`);
        await chrome.tabs.create({ url: openUrl });
        return;
      }
    }
  }

  // Fallback to active tab only if specifically requested and no URL filter is active
  if (targetIds.length === 0 && !payload.url && !payload.targetTabId) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    targetIds = [tabs[0].id];
  }

  for (const targetId of targetIds) {
    try {
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
  try {
    let targetTab = null;
    const allTabs = await chrome.tabs.query({});
    const shopTab = allTabs.find(t => t.url && matchesUrl(t.url, getUrl()));
    
    if (shopTab) {
      targetTab = shopTab;
    } else {
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTabs.length > 0) targetTab = activeTabs[0];
    }

    if (!targetTab) throw new Error('No target tab found');
    if (targetTab.url.startsWith('chrome://')) throw new Error('Cannot access a chrome:// URL');

    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
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
    const targetUrl = getUrl();
    const filteredLog = data.kmMutationLog.filter(entry => !entry.u || matchesUrl(entry.u, targetUrl));
    
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
    const targetUrl = getUrl();
    const remainingLog = data.kmMutationLog.filter(entry => entry.u && !matchesUrl(entry.u, targetUrl));
    
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

async function handleGetStatus(payload) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabInfo = tabs.length > 0 ? { id: tabs[0].id, url: tabs[0].url, title: tabs[0].title } : null;
    
    // Also find if ShopEasy is open in the background
    const allTabs = await chrome.tabs.query({});
    const shopTab = allTabs.find(t => t.url && matchesUrl(t.url, getUrl()));
    
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'status_result',
        messageId: payload.messageId,
        result: {
          activeTab: tabInfo,
          shopTabOpen: !!shopTab,
          shopTabUrl: shopTab ? shopTab.url : null,
          syncedUrl: getUrl(),
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
  try {
    let targetTab = null;
    const window = await chrome.windows.getLastFocused({ populate: true });
    
    // Manual filtering to be safer
    const allTabs = await chrome.tabs.query({});
    console.log(`Found ${allTabs.length} total tabs. Searching for target tab...`);
    
    const targetQuery = getUrl();
    const previewQuery = getPreviewUrl();
    let shopTab = allTabs.find(t => t.url && matchesUrl(t.url, targetQuery));
    
    if (!shopTab) {
      const openUrl = isValidUrl(previewQuery) ? previewQuery : (isValidUrl(targetQuery) ? targetQuery : null);
      if (openUrl) {
        console.log(`Target tab not found, opening it now via ${openUrl}...`);
        shopTab = await chrome.tabs.create({ url: openUrl });
        // Wait for it to load at least partially
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (shopTab) {
      console.log('Targeting ShopEasy tab:', shopTab.id, shopTab.url);
      targetTab = shopTab;
      // Activate and focus
      if (!targetTab.active) {
        await chrome.tabs.update(targetTab.id, { active: true });
        if (targetTab.windowId) {
          await chrome.windows.update(targetTab.windowId, { focused: true });
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!targetTab) {
      throw new Error('No target tab found');
    }

    if (targetTab.url.startsWith('chrome://')) {
      throw new Error('Cannot capture chrome:// URLs');
    }

    const dataUrl = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(targetTab.windowId, { format: 'png' }, (data) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!data) {
          reject(new Error('Captured image data is empty'));
        } else {
          resolve(data);
        }
      });
    });
    
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

async function handleActivateTab(payload) {
  try {
    const tab = await chrome.tabs.update(payload.tabId, { active: true });
    // Also focus the window if needed
    if (tab.windowId) {
       await chrome.windows.update(tab.windowId, { focused: true });
    }
    
    if (socket.readyState === WebSocket.OPEN && payload.messageId) {
      socket.send(JSON.stringify({
        type: 'activate_result',
        messageId: payload.messageId,
        result: { success: true, tabId: payload.tabId }
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
  } else if (message.type === 'GET_DETAILED_STATE') {
    sendResponse({
      isEnabled,
      connectionStatus,
      currentState,
      injectedTabs: Array.from(injectedTabs.values())
    });
  }
  return true; // Keep channel open for async response
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isEnabled) return;
  if (changeInfo.status === 'complete') {
    const targetUrl = getUrl();
    if (tab.url && tab.url.startsWith('http') && targetUrl && matchesUrl(tab.url, targetUrl)) {
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
