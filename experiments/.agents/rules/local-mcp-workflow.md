---
trigger: always_on
description: How to use the Local CRO Bridge MCP Server for Kameleoon experiments
globs: experiments/**/*.js, experiments/**/*.css
---

# Local CRO Bridge Context & Workflow

When asked to write, modify, or debug a client-side A/B Test experiment, you must immediately assume that the **Local CRO Bridge** MCP server is active and connected to the user's live Chrome tab. This allows you to interact with the target webpage automatically.

## Core Directives

1. **Do not ask the user for DOM selectors.**
   - ALWAYS use the `mcp_local-cro-bridge_read_dom` tool to fetch the HTML structure of the user's active tab. Use this to identify headers, CTAs, containers, and build your own precise CSS selectors autonomously.
2. **Auto-Injection**
   - Save your final variation code (`.js` and `.css`) inside the `experiments/` directory (e.g., `experiments/variation.js`). 
   - ANY file saved in the `experiments/` directory is **instantly injected** into the Chrome tab. You do not need to ask the user to manually test it.

3. **Debugging and Verification**
   - If a selector fails, use `mcp_local-cro-bridge_evaluate_js` to run small test queries synchronously.
   - Use `mcp_local-cro-bridge_highlight_element` to draw an outline over an element to visually verify your selector targets the correct element on the user's screen.
   - Use `mcp_local-cro-bridge_capture_screenshot` to confirm visual layout changes.
   - If you need to observe how the underlying framework mutates the DOM, use `mcp_local-cro-bridge_read_mutation_log` and `mcp_local-cro-bridge_clear_mutation_log`.
4. **Simulations**
   - Use `mcp_local-cro-bridge_toggle_kameleoon_simulation` if you need to manipulate Kameleoon variation cookies.