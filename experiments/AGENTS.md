# Kameleoon A/B Test Coding Standards

When developing A/B test modifications for clients using Kameleoon, strictly adhere to the following rules.

## General Principles
- **Modern ES6 Syntax**: Always use modern ES6 JavaScript features (arrow functions, template literals, destructuring, etc.).
- **Selector Declaration**: Provide all CSS selectors you will use at the very start of the JavaScript file for clarity and maintainability.
- **Selector Quality**: Use specific, robust selectors (avoid long chains of `:nth-child` or unstable dynamically generated classes).
- **Scope Focus**: Ignore segments, triggers, and goals. Your task is solely to develop the website's modifications.
- **Visual Accuracy**: Modifications must be as close as possible to the provided design images/documents.
- **Relativity & Refreshes**: Every file save triggers a full page refresh automatically. This ensures your changes are always tested against a clean page load, which is essential for reliably testing hydration.
- **Verification & Visual Audit**: Do not consider a task complete until you have performed a final visual audit using the `local-cro-bridge` screenshot tool. These screenshots are for YOUR autonomous verification only and do NOT need to be saved to the filesystem or embedded in the `walkthrough.md`. Check for:
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
- **Verify with the bridge's JS-evaluation tool**: Always verify your selectors in the browser console before implementing them.
- **Use the bridge's "interesting elements" tool**: Get a high-level overview of available buttons, links, and headings.
- **Avoid Prohibited Methods**: Do NOT use native `setTimeout` or `addEventListener`. Always use `Kameleoon.API.Utils`.
- **Click by looking, not by guessing**: if you're not already confident an element is visible and on-screen, take a screenshot with the bridge's screenshot tool first — element-listing tools can return elements that are hidden, stale, or only appear on hover — clicking those errors out (zero size / outside viewport). If you already know the button is available (e.g. you just placed it, or confirmed it earlier in the session), skip the screenshot and click directly. Confirm/build the selector against the live DOM before clicking.

## File Structure
The code consists of three files:
1. **variation.js**: Logic and element modifications using the above patterns.
2. **variation.css**: All styling changes. Injected automatically.
3. **targeting.js**: Kameleoon targeting condition. Use `Kameleoon.API.Core.runWhenElementPresent(selector, () => { setTargeting(true); })` to include visitors on pages where a given element exists. Call `setTargeting(false)` to exclude. Do not modify this file unless the task explicitly involves targeting rules.

The **target tab is set in the Chrome extension popup** by clicking "Target This Tab" while on the tab under test (not via any file or URL). You do not need to set or read a URL from disk.

---

# Local CRO Bridge Context & Workflow

When asked to write, modify, or debug a client-side A/B Test experiment, you must immediately assume that the **Local CRO Bridge** MCP server (`local-cro-bridge`) is active and connected to the user's live Chrome tab. This allows you to interact with the target webpage automatically.

## Bridge Setup

Before using any `local-cro-bridge` tools, ensure the extension is enabled. If tools like JS-evaluation or screenshot capture time out or fail, use the bridge's "set extension enabled" tool with `enabled: true` to re-enable the extension, then retry.

## Core Directives

1. **Do not ask the user for DOM selectors.**
   - ALWAYS use the `local-cro-bridge` DOM-reading tool to fetch the HTML structure of the user's active tab. Use this to identify headers, CTAs, containers, and build your own precise CSS selectors autonomously.
2. **Auto-Injection & Verification**
   - **Save Locally**: Save final variation code (`.js` and `.css`) inside the `experiments/` directory.
   - **Lint & Typecheck**: After every save to `variation.js`, run `npm run lint` and `npm run typecheck`. Fix all errors and warnings before proceeding.
   - **Mandatory Screenshots**: Use the bridge's screenshot tool to confirm visual layout changes. Perform a final audit as defined in the **Coding Standards**. ⛔️ **DO NOT** attempt to save these screenshots to the filesystem or embed them in walkthroughs; they are for autonomous verification only.
   - **Highlight & Trace**: Use the bridge's highlight-element tool if the layout seems off to verify selector targets.
   - **Hydration Log**: Use the bridge's mutation-log tool to observe DOM changes during hydration.
3. **Simulations**
   - Use the bridge's Kameleoon-simulation-toggle tool if you need to manipulate Kameleoon variation cookies.

## Kameleoon Documentation

For API/product questions (custom data, product tracking, remote data, targeting, segments, etc.), use the `mintlify` MCP server — it searches and retrieves live content from `docs.kameleoon.com`. Prefer its results over prior knowledge and cite what it returns; it's read-only and scoped to the public docs site.

## Gotchas Learned From This Workspace

- `Kameleoon.API.Data.setCustomData(name, value, true)` silently no-ops for keys not declared in the Kameleoon project's Custom Data dashboard. No error, no thrown exception — the key just never appears in `Kameleoon.API.CurrentVisit.customData`. Verify by round-tripping a key that's known to already exist before assuming the write code is broken.
- `Kameleoon.API.Products.obtainProductInteractions()` returns `{views:0, cartQuantities:0, boughtQuantities:0}` for any EAN it doesn't recognize — it does not error. Confirm the exact EAN format the site actually tracks under (inspect real `trackProductView`/`trackAddToCart` calls in the network log) before concluding a property has "no data."
- Don't infer that a dataLayer/GTM event exists because it "sounds right" for a flow. Verify by fetching and grepping the actual GTM container (`https://www.googletagmanager.com/gtm.js?id=<GTM-ID>`) for the literal event string before wiring a listener to it.
