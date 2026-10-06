# Local CRO Workflow Bridge (for AI Agents & Developers)

This repository contains a local development bridge tailored for Conversion Rate Optimization (CRO) and Kameleoon A/B Testing. It bridges your local filesystem with an active Chrome tab via a Manifest V3 extension, and exposes these capabilities to AI agents (like Claude Desktop or Cursor) via the Model Context Protocol (MCP).

## Architecture

1. **Chrome Extension (`extension/`)**: 
   - A Manifest V3 extension featuring a background Service Worker that maintains a persistent WebSocket connection (`ws://localhost:5678`). 
   - Features a one-click toggle popup UI for manually enabling/disabling script execution on the fly.
   - Uses `declarativeNetRequest` to strip strict Content-Security-Policy rules that prevent local script evaluation.
   - Reliably queries the workspace and injects JavaScript and CSS payloads into the active browser tab immediately at Document completion to prevent underlying race conditions.

2. **Daemon & File Sync (`daemon/`)**:
   - `watcher.js`: Leverages `chokidar` to automatically monitor your target workflow directory for `.js` and `.css` modifications, wrapping and broadcasting changes instantly to the Chrome extension.
   - `server.js`: The WebSocket bridge handling incoming connections, payload delivery, and two-way communication (e.g., returning results of JS evaluations).

3. **Tab Targeting**:
   - Click the extension icon while on the tab you want the agent to work on, then press **Target This Tab**. The extension moves that tab into a labeled "CRO Target" tab group and pins it as the sole injection target by tab ID.
   - If no tab is targeted, the bridge falls back to whichever tab is currently active.

4. **MCP Server (`mcp/` & `cli/`)**:
   - Exposed as an MCP (Model Context Protocol) Server via standard IO (`stdio`).
   - The primary entrypoint is `cli/bin/cro-agent.js`.

## How to Use as an AI Agent

When functioning as an MCP server, you (the AI agent) will automatically load `cro-agent.js`. This starts both the file watcher AND the MCP stdio interface. The following tools will immediately become available in your context:

- **`read_dom`**: Returns a sanitized version of the active tab's HTML structure. Use this to orient yourself on the target page.
- **`evaluate_js`**: Executes JavaScript in the active Chrome tab via the Extension and returns the result synchronously. Perfect for debugging and DOM inspection.
- **`inject_experiment_code`**: Pushes JavaScript or CSS live to the browser without requiring a page refresh. Essential for zero-latency hot-reloading.
- **`capture_screenshot`**: Captures a PNG screenshot of the active browser tab for instant visual UI validation.
- **`highlight_element`**: Temporarily paints CSS outlines over selected elements for precise visual testing and selector verification.
- **`read_mutation_log` & **`clear_mutation_log`**: Monitors and records timestamped DOM changes (additions, removals, attribute modifications) occurring after page load.
- **`watch_selector`**: A focused mutation observer that records changes for a specific selector over a set duration.
- **`get_framework_status`**: Determines the underlying JS framework (React, Next.js, Vue, etc.) and hydration status of the active tab.
- **`get_kameleoon_state`**: Extracts structured data about active experiments, variations, Visitor data, and global configuration.
- **`toggle_kameleoon_simulation`**: Configures the underlying browser session with specific simulation parameters to spoof being placed into a variation or control group.
- **`list_tabs` & **`activate_tab`**: Allows the agent to list all open tabs and switch focus between them by ID.
- **`read_network_log`**: Checks for loaded assets and slow API requests using the generic Performance API. Useful for catching failing Kameleoon scripts or slow dependencies.
- **`read_console_logs`**: Fetches intercepted console logs (log, warn, error, info) from the active tab. Useful for debugging injections.
- **`get_status`**: Returns a comprehensive status report of the local CRO bridge, including daemon health and connected extension IDs.
- **`reload_page`**: Programmatically triggers a hard reload of the active browser tab.



### 🔄 Streamlined Page Reloading

Sometimes injection isn't enough, and you need a full page reload. We've added two ways to do this without leaving VS Code:

1. **Comment Trigger**: Add `// @reload` or `/* @reload */` anywhere in your `variation.js` or `variation.css` and save the file. The daemon will automatically trigger a full browser reload.
2. **CLI / Keyboard Shortcut**: You can run the reload script manually:
   ```bash
   node local-cro-workflow/cli/bin/reload.js
   ```
   **Pro Tip**: Bind this command to a keyboard shortcut in VS Code (e.g., `Cmd+Alt+R`) using a "Run Shell Command" extension or a VS Code Task.

## Setup Instructions

1.  **Chrome Extension**: 
    - Open `chrome://extensions` in Chrome.
    - Enable **Developer Mode**.
    - Click **Load unpacked** and select the `local-cro-workflow/extension` directory.
2.  **MCP Integration**:
    - In your MCP-compatible client (e.g., Claude Desktop or Cursor), add the following to your configuration:
    ```json
    {
      "mcpServers": {
        "local-cro-bridge": {
          "command": "node",
          "args": [
            "/absolute/path/to/local-cro-workflow/cli/bin/cro-agent.js",
            "/absolute/path/to/your/experiments/folder"
          ]
        }
      }
    }
    ```

The bridge will now monitor your experiments folder and sync changes to your active tab instantly.

For Claude Code, copy `experiments/.mcp.json.example` to `experiments/.mcp.json` and fill in your paths. The copy is gitignored.

To run it by hand instead, run `npm start` from `local-cro-workflow/`, or `node local-cro-workflow/cli/bin/cro-agent.js /absolute/path/to/experiments`. The daemon listens on `ws://127.0.0.1:5678`, and the extension has to be loaded and connected before any tool works.

## VS Code Extension

`experiments/scripts/vscode-extension/` adds three things to VS Code:
- a status bar item showing whether the bridge is up, whether Chrome is connected and which tab is targeted (it also shows when injection is paused in the Chrome popup);
- a **Kameleoon Experiments** panel in the Explorer listing the current experiment, the archives (open, compare with current, restore) and the imported tickets;
- **Start From HubSpot Ticket**, which imports a ticket, archives the current work, opens the brief and starts Claude on it.

To install it, link the folder into VS Code's extensions and reload the window:
```bash
ln -s "$PWD/experiments/scripts/vscode-extension" ~/.vscode/extensions/local.kameleoon-experiment-archive-1.0.0
```

## Automatic Startup (VS Code)

This project includes a `.vscode/tasks.json` that can run the daemon automatically:
1.  Open the project in VS Code.
2.  When prompted, click **Allow and Run** for workspace tasks.
3.  The daemon will start in a background terminal named **Start CRO Daemon**.

To start it manually, press `Cmd+Shift+P`, type `Run Task`, and select `Start CRO Daemon`.
