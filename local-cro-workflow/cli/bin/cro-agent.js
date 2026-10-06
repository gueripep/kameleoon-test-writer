#!/usr/bin/env node

// Redirect console.log and warn to console.error to prevent JSON-RPC stream corruption over Stdio MCP
console.log = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

import { initWebSocketServer, setWorkspacePath } from '../../daemon/server.js';
import { initWatcher } from '../../daemon/watcher.js';
import { initMcpServer } from '../../mcp/mcp_server.js';
import path from 'path';

const args = process.argv.slice(2);
let workspaceDir = args[0] ? path.resolve(args[0]) : process.cwd();

// Auto-detect project root if we are inside local-cro-workflow
if (workspaceDir.endsWith('local-cro-workflow')) {
  workspaceDir = path.dirname(workspaceDir);
}

async function main() {
  console.error(`Starting Local CRO Bridge MCP Server (PID: ${process.pid}) pointing to workspace: ${workspaceDir}`);

  // Takes the port over from a running bridge (another session) if there is one.
  await initWebSocketServer(5678);
  setWorkspacePath(workspaceDir);
  initWatcher(workspaceDir);
  await initMcpServer();
}

main().catch(err => {
  console.error("Fatal error starting agent:", err);
  process.exit(1);
});
