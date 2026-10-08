---
name: variation-patterns
description: Tested code patterns for variations that a site keeps undoing — React/SPA re-renders stripping inserted nodes, changes wiped after hydration, containers collapsing when the original is hidden. Use when pattern A in experiments/AGENTS.md was measured to fail, or before writing a variation for a React site whose structure is known to re-render.
---

# Variation patterns

B is the standard template; every pattern after it shipped in a real variation and was verified live. Copy it and adapt the selectors; don't rewrite the mechanism. Start with pattern A in `experiments/AGENTS.md`, and come here once you've *measured* that it doesn't hold.

To add a pattern: copy it from code that ran, strip every client selector, URL and name (this repo is public), and say what failure it fixes and how you measured that.

## B. Re-apply with a short-lived MutationObserver

**Fixes:** the site re-renders the element once or twice after hydration and wipes the change. Confirm with `read_mutation_log` first.

**Mechanism:** a marker class makes the change idempotent; the observer re-applies it to any fresh copy of the element and disconnects after 3s, once hydration has settled.

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

**Limits:** it loses when the site re-renders continuously (for example, on scroll) or strips the nodes you inserted. Use C then.

## C. Nothing for React to strip: flag on `<html>`, everything visual in CSS

**Fixes:** the site re-renders a container and strips sibling nodes Kameleoon inserted (for example, when a sticky element mounts on scroll). Pattern B's observer re-inserts and loses the race every time. Measured: 20 re-inserts in 3s, all stripped. The section collapses, the document shrinks, and the browser clamps `scrollY`, which users report as "the footer appears early".

**Mechanism:** React never reconciles `<html>`'s classes, so a class there survives every re-render. Everything visual is CSS keyed on that class: replacement imagery as stacked `background-image` layers on a stable container, and `aspect-ratio` set to the summed asset ratio so the container can't collapse. The original is hidden by selector, not by a tagged attribute React would drop.

```javascript
const isPhone = Kameleoon.API.CurrentVisit.device.type === 'Phone';
document.documentElement.classList.add(isPhone ? 'kam-x-phone' : 'kam-x-wide');
```

```css
/* Stacked backgrounds instead of inserted nodes: nothing for a re-render to strip */
html.kam-x-wide .stable-container,
html.kam-x-phone .stable-container {
    background-repeat: no-repeat;
    background-size: 100% auto;
}

html.kam-x-wide .stable-container {
    aspect-ratio: 1512 / 1687; /* width / summed height of all layers */
    background-image: url('part-1.png'), url('part-2.png'), url('part-3.png');
    background-position: 0 0%, 0 50%, 0 100%;
}

/* Selector-based hide survives React replacing the original node */
html.kam-x-wide .stable-container .original-content,
html.kam-x-phone .stable-container .original-content { display: none !important; }
```

**Limits:** it only works for content you can express as CSS, such as imagery, layout and hiding. Interactive inserted content still needs B, or a container React doesn't own.
