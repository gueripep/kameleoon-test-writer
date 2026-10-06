---
name: diagnose-kameleoon-app
description: Find why a page in app.kameleoon.com (results, editor, dashboard) isn't loading or shows wrong data. Use when the user reports the Kameleoon app itself misbehaving, not a variation on a client site.
---

# Diagnosing a broken Kameleoon app page

The goal is to name the cause, not to fix it. Work from the outside in, and mark every claim as measured or inferred.

1. **Screenshot first.** A skeleton or spinner with no error means the page is *waiting* on something. An error toast or blank page means something *failed*. Those lead to different searches.
2. **Read the request timeline.** On the app tab, run `performance.getEntriesByType('resource')` via `evaluate_js` and read URL, `responseStatus`, `startTime` and `duration`. GraphQL calls show the operation in `?query=<Name>`. Decide whether the data request **failed** (4xx/5xx, or hung) or was **never sent**. Never sent means the frontend is gating on something: the fault is in its logic or the config, not on the server.
3. **Force a refetch.** Take a harmless read-only action that should re-query (a date preset, a tab switch) and check for a new request. If the UI changes but nothing goes out, the page is blocked before it fetches.
4. **Read the object's config** from the app tab with `fetch('https://api.kameleoon.com/experiments/<id>', {credentials:'include'})`. Use GET only. Look for fields that are **missing**, not only wrong values.
5. **Diff against a working twin.** This step usually finds the cause. List the site's experiments (`GET /experiments?perPage=200&filter=[{"field":"siteId","operator":"EQUAL","parameters":[<siteId>]}]`) and find the field the broken one lacks that every working one has. Open a sibling's working page (the same test on another device, or one launched the same week) and compare request sequences. The first request that appears only on the working page is what the broken page is waiting for.
6. **Report before fixing.** If a config change would confirm the cause and the object is live, tell the user and let them make the change.

## Notes

- `evaluate_js` takes an expression: a top-level `return` is a SyntaxError. Wrap code in an IIFE or return a Promise, and use `JSON.stringify` for readable output.
- The app doesn't expose its Apollo client on `window`, and a `fetch`/XHR hook installed after load may capture nothing. An empty capture after a forced refetch is itself evidence that no request was sent.
- `read_console_logs` may not reflect the app tab, so no errors there is weak evidence.
