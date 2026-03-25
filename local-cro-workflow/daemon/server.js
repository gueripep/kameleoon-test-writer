import { WebSocketServer } from 'ws';
import { broadcastCurrentFiles, replyCurrentFiles, getFiles } from './watcher.js';

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
        } else if (['evaluate_result', 'screenshot_result', 'mutation_log_result', 'tabs_result', 'activate_result'].includes(data.type)) {
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
    clearTimeout(pending.timeout);
    pendingEvaluations.delete(data.messageId);
    if (data.error) {
      pending.reject(new Error(data.error));
    } else {
      pending.resolve(data.result);
    }
  }
}

export function evaluateJs(code, timeoutMs = 5000) {
  return sendExtensionRequest('evaluate_js', { code }, timeoutMs);
}

export function toggleSimulation(enable) {
  broadcast({
    event: 'toggle_simulation',
    payload: { enable }
  });
}

export function captureScreenshot(timeoutMs = 10000) {
  return sendExtensionRequest('capture_screenshot', {}, timeoutMs);
}

export function reloadPage() {
  broadcast({ event: 'reload_page' });
}

export function activateTab(tabId, timeoutMs = 5000) {
  return sendExtensionRequest('activate_tab', { tabId }, timeoutMs);
}

let currentWorkspace = process.cwd();

export function setWorkspacePath(p) {
  currentWorkspace = p;
}

export function getStatus(timeoutMs = 5000) {
  return new Promise(async (resolve, reject) => {
    const clientsCount = wss ? wss.clients.size : 0;
    
    // Always return daemon info
    const status = {
      daemon: {
        status: 'online',
        port: 5678,
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

export function readMutationLog(timeoutMs = 5000) {
  return sendExtensionRequest('read_mutation_log', {}, timeoutMs, false);
}

export function clearMutationLog(timeoutMs = 5000) {
  return sendExtensionRequest('clear_mutation_log', {}, timeoutMs, false);
}
