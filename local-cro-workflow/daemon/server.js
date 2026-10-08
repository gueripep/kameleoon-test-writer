import http from 'http';
import { execSync } from 'child_process';
import { WebSocketServer } from 'ws';
import { broadcastCurrentFiles, replyCurrentFiles, getFiles } from './watcher.js';
import { importTicket } from './ticket_import.js';

let wss = null;
let httpServer = null;
let releasedTo = null;
const pendingEvaluations = new Map();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function initWebSocketServer(port = 5678) {
  httpServer = http.createServer(handleControlRequest);
  wss = new WebSocketServer({ server: httpServer });
  // ws re-emits the http server's errors here; they are handled in listenOrTakeOver and below.
  wss.on('error', () => {});

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

  await listenOrTakeOver(port);
  httpServer.on('error', (err) => console.error(`WebSocket server error: ${err.message}`));
  console.log(`WebSocket server listening on ws://127.0.0.1:${port}`);
}

// A new session asks the running bridge to hand the port over rather than killing it, so the
// old session's tools fail with a clear message instead of its MCP server dying.
async function listenOrTakeOver(port) {
  const listen = () => new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const tryListen = async () => {
    try {
      await listen();
      return true;
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
      return false;
    }
  };

  if (await tryListen()) return;
  console.log(`Port ${port} is in use; asking the running bridge to hand it over...`);
  if (!(await requestRelease(port))) {
    // Old bridge without /release, or hung. -sTCP:LISTEN matters: without it lsof also lists
    // Chrome's end of the WebSocket, and that process would be killed instead.
    try {
      const pids = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`).toString().trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        console.log(`Bridge did not answer; killing listener ${pid}`);
        process.kill(Number(pid), 'SIGKILL');
      }
    } catch (e) {
      // lsof exits non-zero when nothing is listening
    }
  }
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    if (await tryListen()) return;
  }
  throw new Error(`Port ${port} is still in use after asking the running bridge to release it.`);
}

function requestRelease(port) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/release', method: 'POST', timeout: 2000,
      headers: { 'X-CRO-Client': 'vscode', 'Content-Type': 'application/json' }
    }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end(JSON.stringify({ pid: process.pid }));
  });
}

function takenOverMessage() {
  return `The browser bridge was taken over by another Claude session (PID ${releasedTo}). Run /mcp here to take it back.`;
}

// Gives the port to a newer session. This process keeps running so its MCP tools can explain why they stopped.
function releasePort(newOwner) {
  releasedTo = newOwner;
  console.log(`Handing the bridge over to PID ${newOwner}.`);
  for (const client of wss.clients) client.terminate();
  wss.close();
  httpServer.close();
  for (const [id, pending] of pendingEvaluations) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(takenOverMessage()));
    pendingEvaluations.delete(id);
  }
}

// Control API for the VS Code extension. Loopback only, and a request carrying an Origin
// (any web page) is refused, so a site open in Chrome cannot drive it.
async function handleControlRequest(req, res) {
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (!loopback || req.headers.origin || req.headers['x-cro-client'] !== 'vscode') {
    return send(403, { error: 'forbidden' });
  }
  try {
    if (req.method === 'GET' && req.url === '/status') {
      const { daemon, extensions, warning } = await getStatus(1500);
      return send(200, { pid: daemon.pid, workspace: daemon.workspace, connectedExtensions: daemon.connectedExtensions, extensions, warning });
    }
    if (req.method !== 'POST') return send(404, { error: 'not found' });
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === '/release') {
      send(200, { released: true });
      return res.on('finish', () => releasePort(Number(body.pid) || 'unknown'));
    }
    if (req.url === '/import-ticket') return send(200, await importHubspotTicketByUrl(String(body.url || '')));
    send(404, { error: 'not found' });
  } catch (e) {
    send(500, { error: e.message });
  }
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
    if (releasedTo) return reject(new Error(takenOverMessage()));
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
        status: releasedTo ? 'taken_over' : 'online',
        port: 5678,
        pid: process.pid,
        connectedExtensions: clientsCount,
        workspace: currentWorkspace,
        files: getFiles(),
        uptime: process.uptime()
      },
      extensions: []
    };

    if (releasedTo) status.error = takenOverMessage();
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

export function openUrl(url, setTarget = true, timeoutMs = 10000) {
  return sendExtensionRequest('open_url', { url, setTarget }, timeoutMs);
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
