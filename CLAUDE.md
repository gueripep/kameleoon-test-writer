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

## Publishing to the Kameleoon App (`push_to_kameleoon`)

Once an experiment is verified locally, three MCP tools publish it to the Kameleoon app. Every HTTP call is made by the extension from inside a logged-in `app.kameleoon.com` tab, because the only usable credential is the user's own session cookie — Automation API client credentials are bound to the user's account and are unobtainable for impersonated client accounts. The cookie is never read, stored or transported; only status codes and response bodies come back over the WebSocket. There is deliberately no "get the session token" tool, and the proxy refuses any host other than `api.kameleoon.com` and any method other than GET/POST/PATCH.

The user must already be logged in, and for client work must already have impersonated the client account by hand. **Never automate login or impersonation.** If no `app.kameleoon.com` tab is open, the tools fail with a message saying so — open one, don't work around it.

The flow:

1. `mcp__local-cro-bridge__list_kameleoon_experiments` — read-only. Rank candidates by `siteCode`/`baseURL` host vs the CRO target tab's URL (the response includes `targetTabUrl` for exactly this, and it dominates), then name similarity to the branch / most recent `.archive/` folder / what the user called the test, then `dateModified` and `status`. Archived experiments are excluded and are never valid targets.
2. **Show the user the top candidate and a couple of alternatives, with name, id, status and `baseURL`, and say why the top one won.** If nothing scores well, ask instead of guessing confidently.
3. `mcp__local-cro-bridge__create_kameleoon_variation` — creates a *new* variation (never overwrites one) via `POST /variations` plus an attach `PATCH /experiments/{id}`. The POST alone produces a variation attached to nothing; the PATCH replaces the whole `variations` array and `deviations` map, **rewriting the live traffic split**. It requires `confirmed: true`, which may only be passed after the user has seen the before/after split and said yes. Traffic is split evenly by default; pass an explicit `deviations` map keyed by `"origin"`, the existing variation ids, and `"new"` for the one being created.
4. `mcp__local-cro-bridge__push_variation_code` — writes `variation.js` → `jsCode` and `variation.css` → `cssCode` on an explicit `variationId`, then reads the variation back to verify. Idempotent, so re-run it after a local tweak instead of creating another variation. It refuses to write to a variation owned by a different experiment, or to overwrite code this session did not write unless `overwrite: true`.

Nothing here deletes: `DELETE /variations/{id}` exists and is never called.

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
- MCP tool calls are routed through the daemon as request/response pairs with a 10-second timeout; the Kameleoon API proxy uses a longer one (20s, 30s for `GET /experiments`, which is the slow call on a large account)
- The `kameleoon.d.ts` file documents the full API surface; reference it when writing or reviewing experiment code
