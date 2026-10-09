---
name: kameleoon-graphic-editor
description: Read, fix or edit a variation inside the Kameleoon graphic editor through the bridge — map the Elements list to change keys, reset a change, edit an element's HTML Content, click through carousels/menus in the canvas. Use when the target tab is a graphic editor (URL has `kameleoonSelectedVariationId=` and `kameleoon=true`) or the user asks to change something "in the editor".
---

# Driving the graphic editor

The target tab is the client site with the editor overlaid. Read what the variation does with `get_kameleoon_code` first, then work in the editor. Every change autosaves (header shows "Saved N min ago"), so look at a row before resetting or overwriting it.

## Opening the editor

Open it on a variation with `open_url`, using the campaign's `baseURL` from `get_kameleoon_code`:

- Experiment: `<baseURL>?kameleoon=true&kameleoonSelectedVariationId=<variationId>&experimentId=<id>&kameleoonReplica=false`
- Personalization: `<baseURL>?kameleoon=true&kameleoonSelectedVariationId=<variationId>&personalizationId=<id>`

Keep any query string the page itself needs; editor params are just appended to it.

## Where things are

- **Editor UI** (header, left Elements list, right Design panel) is in the top `document`. `click_element` works on it.
- **Canvas** is `iframe#kameleoonClientFrame` inside the shadow root of the only element with a `shadowRoot`. It's same-origin:
  ```js
  const doc = [...document.querySelectorAll('*')].find(e => e.shadowRoot)
      .shadowRoot.querySelector('#kameleoonClientFrame').contentDocument;
  ```
  Changed elements carry `data-kameleoon-key="<key>"`, the same key as in `generatedJsCode`. The canvas is scaled to fit, so don't compute screen coordinates from its rects.
- Class names below are CSS-module hashes and change when Kameleoon deploys. If one stops matching, find the element by its visible text and update this file.

## Modes: switch for every QA pass

Header switches are `._mode-item_1i3og_52` in this order: **edit** (pen), **navigation**, **comments**. Click with `click_element` on `._mode-item_1i3og_52:nth-of-type(N) label`.

- In **edit** mode a canvas click selects an element, so carousels, tabs and menus don't react. Row actions only work in this mode.
- In **navigation** mode the page behaves normally. QA every state (each slide, open menu, hover card) here, then go back to edit mode to change things.
- To edit something only visible after a click or hover: in navigation mode open the state, hold Cmd and click the element. The editor returns to edit mode with it selected (per the docs).
- To drive the canvas, `el.click()` on an element in `doc` works for ordinary site handlers. `click_element` can't reach into the shadow root.

## Elements list → change keys

The rows only say "A Modified", "DIV Modified", and so on. Get the key for each row from React:

```js
const lis = [...document.querySelectorAll('section._section_r60cr_1 li')];
const f = lis[0][Object.keys(lis[0]).find(k => k.startsWith('__reactFiber'))].return.return.return;
f.memoizedProps.items.map((it, i) => `${i}: ${it.id}`);   // row index → data-kameleoon-key
```

Tag the row you want (`lis[i].id = 'kam-row'`) so `click_element` has a stable selector.

- **Select:** click `#kam-row ._main_1x8qr_37`. The row expands with its CSS selector and an "Edit selector" link, and the right panel shows its Design sections.
- **Reset:** the small row button `#kam-row button._button_4s3b1_1` resets immediately. It isn't a menu. The row turns into "Reset? Yes / No", and `button[title="Yes"]` removes every change on that element. Confirm the key first.

## Edit HTML Content

With the element selected, open the right-panel section whose text is "HTML Content" (`div[role=button]`). The editor is Monaco:

```js
const ed = monaco.editor.getEditors()[0], model = ed.getModel();
ed.executeEdits('bridge', [{ range: model.getFullModelRange(), text: html }]);
```

`executeEdits` goes through the editor's change handlers, so the canvas updates and autosave picks it up. Check the result in `doc`.

An HTML Content edit replaces the element's **entire** innerHTML, so include every child you want to keep. Copy the structure from a sibling that's still original.

## Rules that prevent the usual mess

- From the docs: don't combine an HTML Content edit with other edits on its children, because child edits override the parent's. If a container's HTML is edited, reset any separate rows that target elements inside it and put everything into the one HTML edit.
- Prefer editing text inside the existing component over "Add → text element". Added elements are positioned "above the page" in absolute page coordinates, so they drift off the component at other widths.
- After a long href is pasted twice, the href holds two URLs glued together. Check every `href` in `generatedJsCode` for a second `https://`.

## Checking the result

After autosave, `get_kameleoon_code` kept returning the previous `generatedJsCode` (measured once; the docs don't say when it's rebuilt). Don't use it to confirm an editor change. Check the canvas in both modes, then a real simulation (`kameleoon-qa` skill) once the user has continued past the editor.
