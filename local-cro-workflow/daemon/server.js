import { WebSocketServer } from 'ws';
import { broadcastCurrentFiles, replyCurrentFiles, getFiles } from './watcher.js';
import { importTicket } from './ticket_import.js';

let wss = null;
const pendingEvaluations = new Map();

export function initWebSocketServer(port = 5678) {
  try {
    wss = new WebSocketServer({ port, host: '0.0.0.0' });
    wss.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n!!! ERROR: Port ${port} is already in use.`);
        console.error(`Check if another instance of the Local CRO Bridge is running.`);
        console.error(`The agent tried to clear this port automatically, but it might have failed.\n`);
      } else {
        console.error(`WebSocket server error: ${err.message}`);
      }
      process.exit(1);
    });
  } catch (err) {
    console.error(`Failed to create WebSocket server: ${err.message}`);
    throw err;
  }
  
  wss.on('connection', (ws, req) => {
    const remoteAddress = req.socket.remoteAddress;
    console.log(`Extension connected to WebSocket daemon from ${remoteAddress}`);
    
    // Automatically send initial state and files on connection
    replyCurrentFiles(ws);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        } else if (data.type === 'request_all_files') {
          // Reply directly on THIS connection, not broadcast to all
          replyCurrentFiles(ws, data.tabId);
        } else if (data.type === 'status_result') {
          handleStatusResult(data);
        } else if (data.type === 'import_ticket') {
          // Extension-initiated request (the popup's Import ticket button). This is the
          // one inbound direction that expects a reply, so it correlates on the id the
          // extension minted rather than through pendingEvaluations.
          handleImportTicket(ws, data);
        } else if (['evaluate_result', 'click_result', 'press_key_result', 'screenshot_result', 'mutation_log_result', 'tabs_result', 'activate_result', 'open_url_result', 'dom_result', 'viewport_result', 'network_result', 'clear_emulation_result', 'set_enabled_result', 'response_headers_result', 'lifecycle_timeline_result', 'kameleoon_api_result', 'scrape_ticket_result'].includes(data.type)) {
          handleExtensionResult(data);
        }
      } catch (err) {
        console.error('Failed to parse WS message:', err);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`Extension disconnected (code: ${code}, reason: ${reason}).`);
    });
  });

  console.log(`WebSocket server listening on ws://0.0.0.0:${port} (Accessible via localhost and 127.0.0.1)`);
}

async function handleImportTicket(ws, data) {
  const reply = (msg) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'import_ticket_result', messageId: data.messageId, ...msg }));
    }
  };
  try {
    const result = await importTicket(data.ticket, getWorkspacePath());
    console.log(`Imported HubSpot ticket ${data.ticket?.ticketId} -> ${result.folder} ` +
      `(${result.imageCount}/${result.imageTotal} images, ${result.commentCount} comments)`);
    for (const w of result.warnings) console.warn(`  ticket import warning: ${w}`);
    reply({ result });
  } catch (e) {
    console.error(`Ticket import failed: ${e.message}`);
    reply({ error: e.message });
  }
}

export function broadcast(payload) {
  if (!wss) {
    console.warn('WebSocket server not initialized');
    return;
  }
  
  if (wss.clients.size === 0) {
    // Silent if no clients, avoiding noise during file changes
    return;
  }

  const message = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
}

function sendExtensionRequest(event, payload = {}, timeoutMs = 5000, waitForConnection = true) {
  return new Promise(async (resolve, reject) => {
    if (waitForConnection && (!wss || wss.clients.size === 0)) {
      await new Promise(r => setTimeout(r, Math.min(timeoutMs, 5000)));
      if (!wss || wss.clients.size === 0) {
        return reject(new Error('No extension connected'));
      }
    }

    const messageId = Math.random().toString(36).substring(7);
    
    const timeout = setTimeout(() => {
      pendingEvaluations.delete(messageId);
      reject(new Error(`${event} timed out`));
    }, timeoutMs);

    pendingEvaluations.set(messageId, { resolve, reject, timeout });

    broadcast({
      event,
      payload: { ...payload, messageId }
    });
  });
}

export function handleExtensionResult(data) {
  const pending = pendingEvaluations.get(data.messageId);
  if (pending) {
    if (data.error) {
      // Don't reject immediately if other clients may still respond successfully
      pending.errorCount = (pending.errorCount || 0) + 1;
      const clientCount = wss ? wss.clients.size : 1;
      if (pending.errorCount >= clientCount) {
        clearTimeout(pending.timeout);
        pendingEvaluations.delete(data.messageId);
        pending.reject(new Error(data.error));
      }
    } else {
      clearTimeout(pending.timeout);
      pendingEvaluations.delete(data.messageId);
      pending.resolve(data.result);
    }
  }
}

export function evaluateJs(code, timeoutMs = 5000, tabId = null) {
  return sendExtensionRequest('evaluate_js', { code, targetTabId: tabId }, timeoutMs);
}

export function clickElement(selector, tabId = null, offsetX = 0, offsetY = 0, timeoutMs = 5000) {
  return sendExtensionRequest('click_element', { selector, targetTabId: tabId, offsetX, offsetY }, timeoutMs);
}

export function pressKey(key, tabId = null, shift = false, times = 1, delayMs = 150, timeoutMs = 15000) {
  return sendExtensionRequest('press_key', { key, targetTabId: tabId, shift, times, delayMs }, timeoutMs);
}

export function toggleSimulation(enable) {
  broadcast({
    event: 'toggle_simulation',
    payload: { enable }
  });
}

export function captureScreenshot(rect = null, timeoutMs = 10000, tabId = null) {
  return sendExtensionRequest('capture_screenshot', { rect, targetTabId: tabId }, timeoutMs);
}

export function reloadPage(tabId = null) {
  broadcast({ event: 'reload_page', payload: { targetTabId: tabId } });
}

export function activateTab(tabId, timeoutMs = 5000, setTarget = false) {
  return sendExtensionRequest('activate_tab', { tabId, setTarget }, timeoutMs);
}

let currentWorkspace = process.cwd();

export function setWorkspacePath(p) {
  currentWorkspace = p;
}

export function getWorkspacePath() {
  return currentWorkspace;
}

// Proxies a single api.kameleoon.com call through a logged-in app.kameleoon.com tab.
// Only status + body come back; the session cookie never leaves the browser.
export function kameleoonApiRequest({ method, url, body = null }, timeoutMs = 20000) {
  return sendExtensionRequest('kameleoon_api', { method, url, body }, timeoutMs);
}

// Asks the extension to scrape a HubSpot ticket by URL, finding or opening the tab.
// Generous timeout: it may have to open the tab and wait for HubSpot's timeline to render.
// 90s, not 60: the extension may spend up to 45s waiting for the ticket to render and
// still has the scrape and the image-URL resolution to do after that.
export function scrapeTicket(url, timeoutMs = 90000) {
  return sendExtensionRequest('scrape_ticket', { url }, timeoutMs);
}

// Scrape + write, for the MCP tool. The popup button path does the same two steps from
// the other side (extension scrapes, then sends import_ticket here).
export async function importHubspotTicketByUrl(url) {
  const scraped = await scrapeTicket(url);
  const result = await importTicket(scraped.ticket, getWorkspacePath());
  return { ...result, openedTab: scraped.openedTab, tabId: scraped.tabId };
}

export function getStatus(timeoutMs = 5000) {
  return new Promise(async (resolve, reject) => {
    const clientsCount = wss ? wss.clients.size : 0;
    
    // Always return daemon info
    const status = {
      daemon: {
        status: 'online',
        port: 5678,
        pid: process.pid,
        connectedExtensions: clientsCount,
        workspace: currentWorkspace,
        files: getFiles(),
        uptime: process.uptime()
      },
      extensions: []
    };

    if (clientsCount === 0) {
      return resolve(status);
    }

    const messageId = Math.random().toString(36).substring(7);
    const timeout = setTimeout(() => {
      pendingEvaluations.delete(messageId);
      // Return partial status on timeout
      status.error = 'Timed out waiting for extension status';
      resolve(status);
    }, timeoutMs);

    // We store the partial status and we'll collect results from all clients?
    // For now, let's just resolve with the first extension that responds for simplicity, 
    // or aggregate if we want to be fancy. Let's aggregate for 1s.
    const results = [];
    pendingEvaluations.set(messageId, { 
      resolve: (res) => {
        results.push(res);
        // If we have all clients or it's been long enough
        if (results.length === clientsCount) {
          clearTimeout(timeout);
          status.extensions = results;
          if (clientsCount > 1) {
            const enabledCount = results.filter(r => r.isEnabled).length;
            if (enabledCount > 1) {
              status.warning = `⚠️  ${enabledCount} of ${clientsCount} connected extensions report isEnabled:true — this causes a race condition where the disabled extension's error response wins. Disable all but one extension instance.`;
            } else {
              status.warning = `⚠️  ${clientsCount} extensions connected — only the enabled one will handle requests. Stale connections from disabled extensions may still interfere if the isEnabled guard is missing.`;
            }
          }
          resolve(status);
        }
      }, 
      reject, 
      timeout 
    });

    broadcast({
      event: 'get_status',
      payload: { messageId }
    });
  });
}

function handleStatusResult(data) {
  const pending = pendingEvaluations.get(data.messageId);
  if (pending) {
    pending.resolve(data.result);
  }
}

export function listTabs(timeoutMs = 5000) {
  return sendExtensionRequest('list_tabs', {}, timeoutMs);
}

export function readMutationLog(timeoutMs = 5000, tabId = null) {
  return sendExtensionRequest('read_mutation_log', { targetTabId: tabId }, timeoutMs, false);
}

export function clearMutationLog(timeoutMs = 5000, tabId = null) {
  return sendExtensionRequest('clear_mutation_log', { targetTabId: tabId }, timeoutMs, false);
}

export function openUrl(url, timeoutMs = 10000) {
  return sendExtensionRequest('open_url', { url }, timeoutMs);
}

export function setViewport(width, height, mobile = false, tabId = null, timeoutMs = 5000) {
  return sendExtensionRequest('set_viewport', { width, height, mobile, targetTabId: tabId }, timeoutMs);
}

export function emulateNetwork(conditions, tabId = null, timeoutMs = 5000) {
  return sendExtensionRequest('emulate_network', { ...conditions, targetTabId: tabId }, timeoutMs);
}

export function clearEmulation(tabId = null, timeoutMs = 5000) {
  return sendExtensionRequest('clear_emulation', { targetTabId: tabId }, timeoutMs);
}

export function setExtensionEnabled(enabled, timeoutMs = 5000) {
  return sendExtensionRequest('set_enabled', { enabled }, timeoutMs);
}

export function readResponseHeaders(url = null, tabId = null, requestContext = 'top-level', includeSubresources = false, urlFilter = null, timeoutMs = 15000) {
  return sendExtensionRequest('read_response_headers', { url, targetTabId: tabId, requestContext, includeSubresources, urlFilter }, timeoutMs);
}

export function captureLifecycleTimeline(spec = {}, tabId = null, timeoutMs = 20000) {
  return sendExtensionRequest('arm_lifecycle_capture', { ...spec, targetTabId: tabId }, timeoutMs);
}
