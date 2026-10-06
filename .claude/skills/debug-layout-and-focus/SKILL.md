---
name: debug-layout-and-focus
description: Debug variation bugs that appear after load — layout jumping or collapsing on scroll, the page dropping the visitor further down, or keyboard/Tab focus being blocked or trapped. Use when the user reports scroll jumps, layout shifts after interaction, or accessibility/keyboard issues.
---

# Bugs that only appear after load

`capture_lifecycle_timeline` reloads the tab, so it can only describe a load. Bugs triggered by interaction need the tools below. Don't write sampling probes into `variation.js`: each attempt costs a reload.

## Layout over time: `watch_layout`

- `collapsed_and_clamped` is the classic signature. The document shrank below `scrollY + innerHeight`, so the browser silently reduced `scrollY` and dropped the visitor further down the page.
- `oscillating` means the code is fighting the framework. It is not a bad selector.
- The tool brings the tab to the front because background tabs throttle timers to ~1Hz and stop `requestAnimationFrame`, which also stops the site's own scroll handlers, so the bug won't reproduce. If `warnings` mentions throttling, re-run with the tab in front. Don't trust those numbers.
- `watch_selector` answers *what* changed the DOM. `watch_layout` answers *whether and when the layout moved*, which matches what users actually report.

## Keyboard: `press_key`

Real keystrokes: `key: "Tab", times: 20` walks the tab order in one call, and `shift: true` does Shift+Tab. Don't fake it with `el.focus()` or a dispatched `KeyboardEvent`: variations can override `focus()`, and sites trap focus on `keydown`.

When a client reports that Tab is "blocked":
1. Walk the tab order with the variation on, then again with the variation code commented out. A difference between the two runs is caused by the variation.
2. The usual cause is the site's own focus trap (a `keydown` listener on `document` that cancels Tab), left active by a variation that keeps a modal-style panel open.
3. To find who cancels Tab, patch `Event.prototype.preventDefault` to log a stack when `key === 'Tab'`.
4. After the fix, re-check the site's own dialogs (cart drawer, mobile menu). They must still keep focus inside and close on Escape.
