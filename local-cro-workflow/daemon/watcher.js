import chokidar from 'chokidar';
import fs from 'fs/promises';
import path from 'path';
import { broadcast, reloadPage } from './server.js';

let watcher = null;
const currentFiles = new Map();
let currentWorkspacePath = null;
let isReady = false;

function broadcastState() {
  if (!isReady) return;

  const files = Array.from(currentFiles.keys()).map(p => path.relative(currentWorkspacePath, p));
  broadcast({
    event: 'state_update',
    payload: {
      workspacePath: currentWorkspacePath,
      workspaceName: path.basename(currentWorkspacePath),
      files: files
    }
  });
}

async function processFile(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();

    const content = await fs.readFile(filePath, 'utf-8');
    
    let type;
    let wrappedContent = content;

    if (ext === '.js') {
      type = 'javascript';
      // Defer execution to the Kameleoon engine via kameleoonQueue so the variation
      // never races ahead of Kameleoon. If the engine is already loaded the queue's
      // push() runs the callback synchronously; otherwise it's queued and replayed
      // once the engine is ready.
      wrappedContent = `(function() {
  window.kameleoonQueue = window.kameleoonQueue || [];
  window.kameleoonQueue.push(function() {
    try {
      ${content}
    } catch(e) {
      console.error('Kameleoon Local Injection Error:', e);
    }
  });
})();`;
    } else if (ext === '.css') {
      type = 'css';
    } else {
      return; 
    }

    currentFiles.set(filePath, { type, content: wrappedContent });

    if (isReady) {
      console.log(`Updated cache and broadcasting for ${filePath}`);
      broadcast({
        event: 'hot_reload',
        payload: {
          type,
          content: wrappedContent,
          timestamp: Date.now(),
          filePath
        }
      });
      broadcastState();
    }

    // Reload only after the extension has the fresh content cached and
    // broadcast — otherwise the reload's webNavigation.onCommitted early
    // injection can race ahead of this hot_reload message and inject stale
    // (or no) cached content.
    reloadPage();
    
  } catch (err) {
    console.error(`Error processing file change for ${filePath}`, err);
  }
}

export function initWatcher(workspacePath) {
  currentWorkspacePath = workspacePath;
  console.log(`Watching workspace: ${workspacePath}`);
  
  watcher = chokidar.watch(workspacePath, {
    ignored: /(^|[\/\\])\..|node_modules/, 
    persistent: true,
    ignoreInitial: false
  });

  watcher.on('add', processFile);
  watcher.on('change', processFile);
  watcher.on('unlink', (filePath) => {
    currentFiles.delete(filePath);
    broadcastState();
  });

  watcher.on('ready', () => {
    isReady = true;
    broadcastState();
  });
}

export function broadcastCurrentFiles(targetTabId) {
  for (const [filePath, fileData] of currentFiles.entries()) {
    broadcast({
      event: 'hot_reload',
      payload: {
        type: fileData.type,
        content: fileData.content,
        timestamp: Date.now(),
        filePath,
        targetTabId
      }
    });
  }
}

export function replyCurrentFiles(ws, targetTabId) {
  // Send state so extension knows workspace context
  const files = Array.from(currentFiles.keys()).map(p => path.relative(currentWorkspacePath, p));
  ws.send(JSON.stringify({
    event: 'state_update',
    payload: {
      workspacePath: currentWorkspacePath,
      workspaceName: path.basename(currentWorkspacePath),
      files: files
    }
  }));

  for (const [filePath, fileData] of currentFiles.entries()) {
    const payload = JSON.stringify({
      event: 'hot_reload',
      payload: {
        type: fileData.type,
        content: fileData.content,
        timestamp: Date.now(),
        filePath,
        targetTabId
      }
    });
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

export function getFiles() {
  return Array.from(currentFiles.keys()).map(p => path.relative(currentWorkspacePath, p));
}
