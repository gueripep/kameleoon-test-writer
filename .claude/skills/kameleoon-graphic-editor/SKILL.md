---
name: kameleoon-graphic-editor
description: Read, fix or edit a variation inside the Kameleoon graphic editor through the bridge — map the Elements list to change keys, reset a change, edit text (Content section, move an added element next to a reference, HTML Content as last resort), click through carousels/menus in the canvas. Use when the target tab is a graphic editor (URL has `kameleoonSelectedVariationId=` and `kameleoon=true`) or the user asks to change something "in the editor".
---

# Driving the graphic editor

The target tab is the client site with the editor overlaid. Read what the variation does with `get_kameleoon_code` first, then work in the editor. Every change autosaves to a draft (header shows "Saved N min ago"), so look at a row before resetting or overwriting it. The campaign only changes when the user clicks **Save** on the setup page after **Continue** (it shows "N Unsaved change" and the content tagged "Unsaved" until then). Leave that Save to the user.

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

## Editing text: the order to try

1. **Element that holds the text:** select it and edit its **Content** section.
2. **No element holds it** (e.g. a slide with no description `<p>`): use an added text element placed **next to a reference element inside the component**, so it moves and hides with it.
3. **HTML Content:** last resort. It rewrites the whole container and clashes with child edits.

## Move an added element

Added rows have no "Edit selector" link; their reference is changed through Move. Select the element, click **Move** (✥) in the toolbar over it, and the right panel shows "Move element":

- **Next to another element** → **Before / Replace / After**, plus a "Move element" selector field for the reference (it shows "N matching element").
- Paste the reference selector, check the canvas highlight jumped to that element, then **Validate**. On the first try the old reference was kept; re-open Move and check the field if the element didn't move.
- Through the bridge: Move is the second button in the toolbar (`li._list__item_18ueu_61 > button`, index 1). The panel opens with an empty field and **After** selected every time. Set `input[placeholder="Type reference selector"]` with the native `value` setter plus an `input` event, *then* click the label whose text is "Before", and confirm it took by reading `checked` from the label's React fiber (the DOM radio's `checked` stays false). Only then click "Validate". Twice the element landed After when Before looked selected but wasn't in React state.
- If the row won't select (row class has `_other-item_`) and real clicks on the canvas don't select either, ask the user to click the element in the preview; the toolbar then appears for you.
- Example that fixed a sentence left visible when its carousel slide collapsed: reference = the slide's button box, **Before**, which put it inside the box that collapses.

Check the result in `doc` (parent and siblings of `[data-kameleoon-key=<key>]`), then open the other states in navigation mode. Also switch the preview to Tablet and Phone: sites can rebuild components at other widths, and the reference selector can then match a different element.

## Edit HTML Content (last resort)

With the element selected, open the right-panel section whose text is "HTML Content" (`div[role=button]`). The editor is Monaco:

```js
const ed = monaco.editor.getEditors()[0], model = ed.getModel();
ed.executeEdits('bridge', [{ range: model.getFullModelRange(), text: html }]);
```

`executeEdits` goes through the editor's change handlers, so the canvas updates and autosave picks it up. Check the result in `doc`.

An HTML Content edit replaces the element's **entire** innerHTML, so include every child you want to keep. Copy the structure from a sibling that's still original.

## Rules that prevent the usual mess

- From the docs: don't combine an HTML Content edit with other edits on its children, because child edits override the parent's. If a container's HTML is edited, reset any separate rows that target elements inside it and put everything into the one HTML edit.
- Selectors you type (Edit selector, Move reference) follow the repo rule: short and class/ID-based, verified unique in `doc` at every width. Don't copy the editor's generated `div:nth-of-type` chains.
- Added elements set "above the page" sit in absolute page coordinates and drift off the component at other widths. Place them before/after a reference element inside the component, so they also hide when it collapses.
- After a long href is pasted twice, the href holds two URLs glued together. Check every `href` in `generatedJsCode` for a second `https://`.

## Checking the result

`get_kameleoon_code` returns the saved campaign, so it shows the previous `generatedJsCode` until the setup-page Save. Don't use it to confirm an editor change before that. Check the canvas in both modes, then a real simulation (`kameleoon-qa` skill) once the user has continued past the editor.
