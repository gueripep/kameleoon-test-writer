# AGENTS.md

This file provides guidance to Codex when working with code in this repository. It mirrors the CLAUDE.md file used by Claude Code for the same workspace, adapted for Codex's tool names and conventions.

## What This Project Does

A **Local CRO (Conversion Rate Optimization) Bridge** that connects a local filesystem workspace to a live Chrome tab via WebSocket. It enables AI agents to develop, inject, and visually verify Kameleoon A/B test variations in real-time without page refreshes. The MCP server (`local-cro-bridge`) exposes browser control tools (JS evaluation, screenshot capture, DOM reading, etc.) to Codex.

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
  AGENTS.md             # Coding standards for A/B test agents (see below)
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
npm run typecheck   # tsc --noEmit against kameleoon.d.ts
```

ESLint enforces ES6+: arrow functions required, no `function` declarations, no `var`.

## MCP Servers Available to Codex in This Workspace

Configured globally in `~/.codex/config.toml` (Codex has no per-project MCP scoping), but relevant specifically here:

- **`local-cro-bridge`** — stdio server, launched against this `experiments/` folder. Exposes browser control tools: JS evaluation, screenshot capture (element and full-page), DOM reading, selector discovery, click simulation, network/console log reading, viewport/device emulation, Kameleoon state inspection, and more.
- **`mintlify`** — streamable HTTP server at `https://docs.kameleoon.com/mcp`. Public, read-only search/retrieval over the Kameleoon Documentation site. Prefer its results over prior knowledge when answering Kameleoon API/product questions; cite what it returns.

## Browser Tooling: Always Use the Local CRO Bridge

For all Kameleoon experiment work (selector discovery, DOM reading, JS evaluation, screenshots, clicking), always use the `local-cro-bridge` MCP tools — never any general-purpose browser automation tool. The bridge targets the user's actual tracked tab (via "Target This Tab" in the extension popup) and is the intended workflow for this project. If the bridge tools aren't showing up as available, that means the MCP server isn't connected in the current session — say so and ask the user to check the daemon/extension connection rather than silently falling back to something else.

## How File Injection Works

1. Agent saves changes to `experiments/variation.js` or `variation.css`
2. Watcher wraps JS in try-catch, triggers a full page reload, and broadcasts the updated files via WebSocket
3. Extension injects the cached files into matching tabs after the page reloads

The **target tab is set directly in the Chrome extension popup** — while on the tab you want to work on, click the extension icon and press "Target This Tab". The tab is moved into a labeled "CRO Target" tab group and pinned by tab ID (not URL), so it stays targeted across reloads and navigations. No config file needed. If no tab is targeted, injection falls back to the active tab.

## A/B Test Coding Standards

See `experiments/AGENTS.md` for the full coding standards. Key rules:

- **Every save triggers a full page reload** — required for reliable hydration testing; no special comment needed
- **Use Kameleoon API only** — never native `setTimeout`, `addEventListener`, or `querySelector` directly; use `Kameleoon.API.Utils` and `Kameleoon.API.Core.runWhenElementPresent()`
- **Verify selectors** with the bridge's JS-evaluation tool before coding, and read DOM structure via the bridge's DOM-reading tool
- **Screenshot audit** with the bridge's screenshot tool before considering a task complete — do not save screenshots to disk
- **Hydration pattern**: start with `runWhenElementPresent()` (simple); only escalate to MutationObserver if verification shows changes are being overwritten

## Key Architectural Notes

- The extension service worker reconnects automatically (5s–60s exponential backoff) when the daemon restarts
- `server.js` maintains a single `extensionSocket` reference — only one extension connection is active at a time
- MCP tool calls are routed through the daemon as request/response pairs with a 10-second timeout
- The `kameleoon.d.ts` file documents the full API surface; reference it when writing or reviewing experiment code
- `Kameleoon.API.Data.setCustomData(name, value, true)` silently no-ops if `name` isn't declared as custom data in the Kameleoon project UI — it does not throw. Verify new custom data keys exist in the dashboard before assuming a write failed on the code side.
- `Kameleoon.API.Products.obtainProductInteractions(eans, cb, timeBegin, timeEnd)` reads real view/cart/purchase counters per EAN from Kameleoon's servers — useful for social-proofing/demand-signal features. An unknown EAN silently returns `{views:0, cartQuantities:0, boughtQuantities:0}` rather than erroring, which is easy to misread as "no data exists" when it's really "wrong key." Double-check the exact EAN format (check the site's own tracking calls, e.g. via `trackProductView`) before concluding a counter is empty.
