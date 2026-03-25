import chokidar from 'chokidar';
import fs from 'fs/promises';
import path from 'path';
import { broadcast } from './server.js';

let watcher = null;
const currentFiles = new Map();
let currentUrl = null;
let currentPreviewUrl = null;
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
      url: currentUrl,
      previewUrl: currentPreviewUrl,
      files: files
    }
  });
}

async function processFile(filePath) {
  try {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    if (fileName === 'config.json') {
      const content = await fs.readFile(filePath, 'utf-8');
      try {
        const config = JSON.parse(content);
        currentUrl = config.url || null;
        currentPreviewUrl = config.previewUrl || null;
        console.log(`Updated configuration: url=${currentUrl}, previewUrl=${currentPreviewUrl}`);
        broadcast({
          event: 'config_update',
          payload: { url: currentUrl, previewUrl: currentPreviewUrl }
        });
        broadcastState();
      } catch (e) {
        console.error(`Error parsing config.json: ${e.message}`);
      }
      return;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    
    let type;
    let wrappedContent = content;

    if (ext === '.js') {
      type = 'javascript';
      wrappedContent = `(function() {
  try {
    ${content}
  } catch(e) {
    console.error('Kameleoon Local Injection Error:', e);
  }
})();`;
    } else if (ext === '.css') {
      type = 'css';
    } else {
      return; 
    }

    // Check for reload trigger
    if (/\/\/\s?@reload/.test(content) || /\/\*\s?@reload/.test(content)) {
      console.log(`🚀 Reload trigger detected in ${filePath}. Triggering page reload...`);
      import('./server.js').then(server => server.reloadPage());
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
          filePath,
          url: currentUrl,
          previewUrl: currentPreviewUrl
        }
      });
      broadcastState();
    }
    
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
    if (path.basename(filePath) === 'config.json') {
      currentUrl = null;
      currentPreviewUrl = null;
    } else {
      currentFiles.delete(filePath);
    }
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
        targetTabId,
        url: currentUrl,
        previewUrl: currentPreviewUrl
      }
    });
  }
}

export function replyCurrentFiles(ws, targetTabId) {
  // Send state first so extension knows context
  const files = Array.from(currentFiles.keys()).map(p => path.relative(currentWorkspacePath, p));
  ws.send(JSON.stringify({
    event: 'state_update',
    payload: {
      workspacePath: currentWorkspacePath,
      workspaceName: path.basename(currentWorkspacePath),
      url: currentUrl,
      previewUrl: currentPreviewUrl,
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
        targetTabId,
        url: currentUrl,
        previewUrl: currentPreviewUrl
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
