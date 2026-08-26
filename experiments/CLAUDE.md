# Kameleoon A/B Test Coding Standards

When developing A/B test modifications for clients using Kameleoon, strictly adhere to the following rules.

## General Principles
- **Modern ES6 Syntax**: Always use modern ES6 JavaScript features (arrow functions, template literals, destructuring, etc.).
- **Selector Declaration**: Provide all CSS selectors you will use at the very start of the JavaScript file for clarity and maintainability.
- **Selector Quality**: Use specific, robust selectors (avoid long chains of `:nth-child` or unstable dynamically generated classes).
- **Scope Focus**: Ignore segments, triggers, and goals. Your task is solely to develop the website's modifications.
- **Visual Accuracy**: Modifications must be as close as possible to the provided design images/documents.
- **Relativity & Refreshes**: Every file save triggers a full page refresh automatically. This ensures your changes are always tested against a clean page load, which is essential for reliably testing hydration.
- **Verification & Visual Audit**: Do not consider a task complete until you have performed a final visual audit using `mcp__local-cro-bridge__capture_screenshot`. These screenshots are for YOUR autonomous verification only and do NOT need to be saved to the filesystem or embedded in the `walkthrough.md`. Check for:
  - Unexpected overlaps or clipping of elements.
  - Unwanted UI artifacts (gradients, default borders).
  - Alignment consistency across containers.
  - Verification across different scroll states.

## Mandatory Kameleoon API Methods
Do NOT use native browser functions for element selection, timeouts, or event listeners. Always use the equivalent Kameleoon API methods.

## 1. Handling React/SPA Hydration (Re-renders)
Modern sites often overwrite DOM changes during hydration. ⛔️ **DO NOT use `runWhenElementPresent(..., null, true)`** for this. Instead, try the simple pattern first, and only use the robust interval-based fix if verification shows it is necessary.

### A. Simple Pattern (Standard)
Use this for simple sites or minor text/style changes. It is the most lightweight approach:
```javascript
Kameleoon.API.Core.runWhenElementPresent(selector, (el) => {
    // --- YOUR MODIFICATIONS HERE ---
});
```

### B. Robust Pattern (MutationObserver)
⚠️ **ONLY use this if Method A fails.** Many modern sites (even Next.js/React) will respect the initial DOM modification. Only implement this if you observe your changes being overwritten or reset during hydration:
```javascript
(() => {
    const selector = 'your-selector';
    const modifier = 'kam-modifier'; // Unique class guard
    Kameleoon.API.Core.runWhenElementPresent(selector, () => {
        const applyChange = () => {
            const el = document.querySelector(`:is(${selector}):not(.${modifier})`);
            if (!el) return;
            el.classList.add(modifier);
            // --- YOUR MODIFICATIONS HERE ---
        };
        applyChange(); // Initial run
        const observer = new MutationObserver(() => applyChange());
        observer.observe(document.body, { childList: true, subtree: true });
        // Cleanup after 3 seconds (hydration is usually complete)
        Kameleoon.API.Utils.setTimeout(() => observer.disconnect(), 3000);
    });
})();
```

## 2. Robust Selector Discovery
- **Verify with `evaluate_js`**: Always verify your selectors in the browser console using `mcp__local-cro-bridge__evaluate_js` before implementing them.
- **Use `get_interesting_elements`**: Use `mcp__local-cro-bridge__get_interesting_elements` to get a high-level overview of available buttons, links, and headings.
- **Avoid Prohibited Methods**: Do NOT use native `setTimeout` or `addEventListener`. Always use `Kameleoon.API.Utils`.
- **Click by looking, not by guessing**: if you're not already confident an element is visible and on-screen, take a screenshot with `mcp__local-cro-bridge__capture_screenshot` first — element lists (`get_interesting_elements`, `find_selector_by_text`) can return elements that are hidden, stale, or only appear on hover — clicking those errors out (zero size / outside viewport). If you already know the button is available (e.g. you just placed it, or confirmed it earlier in the session), skip the screenshot and click directly. Confirm/build the selector against the live DOM (`read_dom` or `evaluate_js`) before clicking.

## File Structure
The code consists of three files:
1. **variation.js**: Logic and element modifications using the above patterns.
2. **variation.css**: All styling changes. Injected automatically.
3. **targeting.js**: Kameleoon targeting condition. Use `Kameleoon.API.Core.runWhenElementPresent(selector, () => { setTargeting(true); })` to include visitors on pages where a given element exists. Call `setTargeting(false)` to exclude. Do not modify this file unless the task explicitly involves targeting rules.

The **target tab is set in the Chrome extension popup** by clicking "Target This Tab" while on the tab under test (not via any file or URL). You do not need to set or read a URL from disk.

---

# Local CRO Bridge Context & Workflow

When asked to write, modify, or debug a client-side A/B Test experiment, you must immediately assume that the **Local CRO Bridge** MCP server is active and connected to the user's live Chrome tab. This allows you to interact with the target webpage automatically.

## Bridge Setup

Before using any `mcp__local-cro-bridge__*` tools, ensure the extension is enabled. If tools like `evaluate_js` or `capture_screenshot` time out or fail, call `mcp__local-cro-bridge__set_extension_enabled` with `enabled: true` to re-enable the extension, then retry.

## Core Directives

1. **Do not ask the user for DOM selectors.**
   - ALWAYS use the `mcp__local-cro-bridge__read_dom` tool to fetch the HTML structure of the user's active tab. Use this to identify headers, CTAs, containers, and build your own precise CSS selectors autonomously.
2. **Auto-Injection & Verification**
   - **Save Locally**: Save final variation code (`.js` and `.css`) inside the `experiments/` directory.
   - **Lint & Typecheck**: After every save to `variation.js`, run `npm run lint` and `npm run typecheck`. Fix all errors and warnings before proceeding.
   - **Mandatory Screenshots**: Use `mcp__local-cro-bridge__capture_screenshot` to confirm visual layout changes. Perform a final audit as defined in the **Coding Standards**. ⛔️ **DO NOT** attempt to save these screenshots to the filesystem or embed them in walkthroughs; they are for autonomous verification only.
   - **Highlight & Trace**: Use `mcp__local-cro-bridge__highlight_element` if the layout seems off to verify selector targets.
   - **Hydration Log**: Use `mcp__local-cro-bridge__read_mutation_log` to observe DOM changes during hydration.
3. **Simulations**
   - Use `mcp__local-cro-bridge__toggle_kameleoon_simulation` if you need to manipulate Kameleoon variation cookies.
