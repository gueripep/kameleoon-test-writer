# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

A **Local CRO (Conversion Rate Optimization) Bridge** that connects a local filesystem workspace to a live Chrome tab via WebSocket. It enables AI agents to develop, inject, and visually verify Kameleoon A/B test variations in real-time without page refreshes. The MCP server exposes browser control tools (JS evaluation, screenshot capture, DOM reading, etc.) to Claude.

## Project Structure

```
local-cro-workflow/     # Core bridge infrastructure
  cli/bin/cro-agent.js  # Main entry point — starts all three subsystems
  daemon/server.js      # WebSocket server (port 5678) — routes between extension and MCP
  daemon/watcher.js     # Chokidar watcher — detects file saves, broadcasts to extension
  mcp/mcp_server.js     # MCP server — 20+ browser control tools for AI agents
  extension/            # Chrome Manifest V3 extension
    background.js       # Service worker — injects code into target tabs
    content_logger.js   # Content script — captures console logs and DOM mutations
    rules.json          # CSP bypass + engine.js sitecode swap via Declarative Net Request
                        #   rule 2 redirects any *.kameleoon.io|eu /engine.js to your own
                        #   sitecode's engine — edit the redirect URL + excludedRequestDomains
                        #   to change sitecode; reload the extension after editing

experiments/            # AI agent workspace for writing A/B test variations
  variation.js          # Test JavaScript (edit this to write experiments)
  variation.css         # Test CSS
  targeting.js          # Kameleoon targeting condition — returns boolean (true = include visitor)
  kameleoon.d.ts        # Full TypeScript type definitions for Kameleoon API
  CLAUDE.md             # Coding standards for A/B test agents (see below)
```

## Running the Bridge

```bash
# From local-cro-workflow/
npm start

# Or explicitly:
node local-cro-workflow/cli/bin/cro-agent.js /absolute/path/to/experiments
```

The daemon starts a WebSocket server on `ws://127.0.0.1:5678`. The Chrome extension must be installed and connected before the bridge is functional.

## Linting (experiments workspace)

```bash
cd experiments
npm run lint        # ESLint with modern JS rules
npm run lint:fix    # Auto-fix
```

ESLint enforces ES6+: arrow functions required, no `function` declarations, no `var`.

## MCP Server Integration

Add to Claude Desktop / Cursor config:
```json
{
  "mcpServers": {
    "local-cro-bridge": {
      "command": "node",
      "args": [
        "/absolute/path/to/local-cro-workflow/cli/bin/cro-agent.js",
        "/absolute/path/to/experiments"
      ]
    }
  }
}
```

## Browser Tooling: Always Use the Local CRO Bridge

For all Kameleoon experiment work (selector discovery, DOM reading, JS evaluation, screenshots, clicking), always use the `mcp__local-cro-bridge__*` tools — never `mcp__claude-in-chrome__*`. The bridge targets the user's actual tracked tab (via "Target This Tab" in the extension popup) and is the intended workflow for this project. If the bridge tools aren't showing up as available, that means the MCP server isn't connected in the current session — say so and ask the user to check the daemon/extension connection rather than silently falling back to claude-in-chrome.

## How File Injection Works

1. Agent saves changes to `experiments/variation.js` or `variation.css`
2. Watcher wraps JS in try-catch, triggers a full page reload, and broadcasts the updated files via WebSocket
3. Extension injects the cached files into matching tabs after the page reloads

The **target tab is set directly in the Chrome extension popup** — while on the tab you want to work on, click the extension icon and press "Target This Tab". The tab is moved into a labeled "CRO Target" tab group and pinned by tab ID (not URL), so it stays targeted across reloads and navigations. No config file needed. If no tab is targeted, injection falls back to the active tab.

## A/B Test Coding Standards

See `experiments/CLAUDE.md` for the full coding standards. Key rules:

- **Every save triggers a full page reload** — required for reliable hydration testing; no special comment needed
- **Use Kameleoon API only** — never native `setTimeout`, `addEventListener`, or `querySelector` directly; use `Kameleoon.API.Utils` and `Kameleoon.API.Core.runWhenElementPresent()`
- **Verify selectors** with `mcp__local-cro-bridge__evaluate_js` before coding, and read DOM structure via `mcp__local-cro-bridge__read_dom`
- **Screenshot audit** with `mcp__local-cro-bridge__capture_screenshot` before considering a task complete — do not save screenshots to disk
- **Hydration pattern**: start with `runWhenElementPresent()` (simple); only escalate to MutationObserver if verification shows changes are being overwritten

## Key Architectural Notes

- The extension service worker reconnects automatically (5s–60s exponential backoff) when the daemon restarts
- `server.js` maintains a single `extensionSocket` reference — only one extension connection is active at a time
- MCP tool calls are routed through the daemon as request/response pairs with a 10-second timeout
- The `kameleoon.d.ts` file documents the full API surface; reference it when writing or reviewing experiment code
