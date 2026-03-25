#!/usr/bin/env node

// Redirect console.log and warn to console.error to prevent JSON-RPC stream corruption over Stdio MCP
console.log = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

import { initWebSocketServer, setWorkspacePath } from '../../daemon/server.js';
import { initWatcher } from '../../daemon/watcher.js';
import { initMcpServer } from '../../mcp/mcp_server.js';
import path from 'path';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
let workspaceDir = args[0] ? path.resolve(args[0]) : process.cwd();

// Auto-detect project root if we are inside local-cro-workflow
if (workspaceDir.endsWith('local-cro-workflow')) {
  workspaceDir = path.dirname(workspaceDir);
}

async function main() {
  console.error(`Starting Local CRO Bridge MCP Server pointing to workspace: ${workspaceDir}`);
  
  // Ensure port 5678 is free (especially important when started directly by IDE/MCP client)
  try {
    console.error("Ensuring port 5678 is free...");
    // Try to find the process ID using the port
    const pid = execSync('lsof -ti:5678').toString().trim();
    if (pid) {
      console.error(`Killing process ${pid} on port 5678...`);
      execSync(`kill -9 ${pid} 2>/dev/null || true`);
      // Wait a bit for the OS to release the socket
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (e) {
    // Ignore errors if lsof fails (usually means no process found on port)
  }

  initWebSocketServer(5678);
  setWorkspacePath(workspaceDir);
  initWatcher(workspaceDir);
  await initMcpServer();
}

main().catch(err => {
  console.error("Fatal error starting agent:", err);
  process.exit(1);
});
