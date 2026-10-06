# Bridge development

Read this when changing the bridge itself. Setup lives in `README.md`.

## Architecture

- `cli/bin/cro-agent.js` starts the daemon, the watcher and the MCP stdio server.
- `daemon/server.js` keeps a single `extensionSocket`, so only one extension connection is active at a time.
- MCP tool calls go through the daemon as request/response pairs with a 10s timeout. The Kameleoon API proxy waits longer: 20s, and 30s for `GET /experiments`, which is slow on a large account.
- The same port serves a small HTTP control API (`GET /status`, `POST /import-ticket`, and `POST /release` for session handover) for the VS Code extension in `experiments/scripts/vscode-extension/`. It only answers loopback requests that carry `X-CRO-Client: vscode` and no `Origin`, so web pages can't drive it.
- The bridge listens on `127.0.0.1` only. A new session takes the port over by asking the running bridge (`POST /release`). The old process stays up and its tools say they were taken over (`/mcp` takes the bridge back). Only a bridge that doesn't answer gets killed, and only its listening PID: a bare `lsof -ti:5678` also lists Chrome's end of the socket.
- The watcher only serves `variation.js` and `variation.css`. Every file it serves is injected into the page, so don't widen it.
- The extension service worker reconnects with backoff (5s–60s) when the daemon restarts.
- `extension/background.js` has two injection paths: hot reload, and cached injection after a page reload. A change to one usually needs the same change in the other.

## Design rules

- **Tool guidance belongs in the tool's `description`.** That's what an agent reads when choosing a tool. Put only cross-tool procedures in a skill (`.claude/skills/`), and don't repeat a description in `AGENTS.md`.
- **Never return a bare boolean from a verification tool.** "The change isn't there" has several causes that look the same. Return an enum that names which one it is, plus timestamps.
- **The Kameleoon proxy never exposes the session.** The cookie is never read, stored or sent over the WebSocket. Only status codes and bodies come back. The proxy refuses any host but `api.kameleoon.com` and any method but GET/POST/PATCH. Don't add a "get token" tool or a DELETE route.
- **No tool runs variation code in a simulation tab.** Running it at a time the engine wouldn't makes the result meaningless.
- **Destructive or traffic-changing writes need `confirmed: true`**, which the agent may only pass after the user has seen the effect.
