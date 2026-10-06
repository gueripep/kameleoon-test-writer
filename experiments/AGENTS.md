# Kameleoon A/B Test Coding Standards

Rules for writing client A/B test variations in this folder. The bridge is assumed connected to the user's live tab. Don't ask the user for selectors: read the DOM yourself.

## Files

- **`variation.js`**: Line 1 is always `// Site: <hostname>`, the host of the target tab (`evaluate_js` → `location.hostname`), e.g. `// Site: www.example.com`. The archive namer and the VS Code panel read it, and `npm run lint` fails without it.
- **`variation.css`**: All styling. Injected automatically.
- **`kameleoon.d.ts`**: The full Kameleoon API surface. Check it before using an API method.
- Ignore segments, triggers and goals. The task is the site modification only.

## Code style

- Modern ES6: arrow functions, template literals, destructuring, no `var`, no `function` declarations (ESLint enforces this).
- Declare every selector at the top of the JS file. Prefer robust selectors: no long `:nth-child` chains or generated class names.
- **Comments:** single-line only (`//` in JS, one-line `/* */` in CSS), and **at most 2 consecutive comment lines anywhere**, including the top of the file. Stacked `//` lines count as a block. The header is one line (the `// Site:` line doesn't count). Rationale that needs more room goes in your summary to the user, not in the code.
- Match the provided designs as closely as possible.

## Kameleoon API, not native APIs

Wait for elements with `Kameleoon.API.Core.runWhenElementPresent()`, and use `Kameleoon.API.Utils` for timers and event listeners. Never use native `setTimeout`/`setInterval`/`addEventListener`, and never poll for elements yourself. Reading the DOM with `document.querySelector` inside a callback is fine, as in pattern B below.

## Hydration (React/SPA re-renders)

Never use `runWhenElementPresent(..., null, true)` for this. Start with A, and move to B only after you have *observed* the change being overwritten.

**A. Simple (default)**
```javascript
Kameleoon.API.Core.runWhenElementPresent(selector, (el) => {
    // modifications
});
```

**B. MutationObserver (only if A is measured to fail)**
```javascript
(() => {
    const selector = 'your-selector';
    const modifier = 'kam-modifier';
    Kameleoon.API.Core.runWhenElementPresent(selector, () => {
        const applyChange = () => {
            const el = document.querySelector(`:is(${selector}):not(.${modifier})`);
            if (!el) return;
            el.classList.add(modifier);
            // modifications
        };
        applyChange();
        const observer = new MutationObserver(() => applyChange());
        observer.observe(document.body, { childList: true, subtree: true });
        Kameleoon.API.Utils.setTimeout(() => observer.disconnect(), 3000);
    });
})();
```

## Workflow

1. **Discover**: Use `read_dom` and `get_interesting_elements` for structure, and verify every selector with `evaluate_js` before coding. Element lists can include hidden or hover-only elements, so screenshot first unless you already know the element is on screen.
2. **Save**: Every save reloads the page and re-injects, so each check runs on a clean load.
3. **Lint**: After every save to `variation.js`, run `npm run lint` and `npm run typecheck`. Fix what your change introduced. Report pre-existing problems without fixing them.
4. **Audit**: Before calling a task done, take a screenshot with `capture_screenshot` and check for overlaps, clipping, stray borders and gradients, alignment, and different scroll states. Never save screenshots to disk.
5. **Debug**: If something looks off, use `highlight_element` to check targets and `read_mutation_log` to see hydration overwrites. If tools time out, call `set_extension_enabled` with `enabled: true` and retry.
6. **QA in the real engine**: The bridge injects at `document_start`, far earlier than Kameleoon. A bridge pass is a draft. Don't report a variation as working until the real engine ran it (see the `kameleoon-qa` skill), and say which one you checked.

## Fixing bugs: minimal and verified

The deliverable is the smallest change that fixes the reported symptom.

- **Reproduce first.** Confirm the bug live with `evaluate_js` and find the root cause from real page state, not from reading the code.
- **Say measured or inferred, every time.** If you haven't measured it, the sentence starts with "I think".
- **Use this file before the platform.** Work the hydration ladder above before investigating engine internals, network config or platform behaviour.
- **Fix only what was reported.** No refactors, renames or tidying, and no fixing lint errors you didn't introduce. Report them instead.
- **No speculative guards.** Only defend against a failure you actually reproduced. A hazard you can't trigger goes in your summary, not in code.
- **Verify the transition.** Re-run the exact sequence that caused the bug. Also check a case where the outcome should *differ* (e.g. a page where the element must not appear).
- **Distrust comments.** Check what a comment claims against the live page.
- **Report honestly.** Say what you changed, what you left alone, and what you couldn't verify.

## Kameleoon gotchas

- Read custom data with `Kameleoon.API.CurrentVisit.customData['Key']`. There is no `getCustomData()`.
- `Kameleoon.API.Data.setCustomData()` silently does nothing for keys not declared in the project's Custom Data settings. Round-trip a known key before blaming the code.
- `Kameleoon.API.Products.obtainProductInteractions()` returns all zeros for an EAN it doesn't recognize. Check the exact EAN format in the site's real tracking calls before concluding there's no data.
- Don't assume a dataLayer/GTM event exists because it sounds right. Grep the live container (`https://www.googletagmanager.com/gtm.js?id=<GTM-ID>`) for the literal event name.
- For API and product questions, search the Kameleoon docs MCP (Mintlify, docs.kameleoon.com) before relying on memory.

## Archiving

Past experiments live in `.archive/<date>-<name>/` (dot-prefixed so the watcher ignores them). Run these with the shell; there are no MCP tools for them:
- `./scripts/archive.sh [name]` archives and empties both variation files. Without a name, it generates one from the code. It skips the copy (but still empties the files) when they are empty or identical to an existing archive.
- `./scripts/restore.sh [.archive/<folder>]` restores a folder (the most recent one by default). It archives current work first unless both files are empty, so a restore can always be undone.
- Versions of one test share a `.test-id`. Restore carries the archive's id into the workspace, Start From Ticket sets it to the ticket id, and archiving copies it. The VS Code panel groups archives by it, so never edit or delete `.test-id` files by hand.

Archive before starting unrelated work on top of a finished experiment, or when the user asks to park or checkpoint the test. Both scripts trigger a page reload.
