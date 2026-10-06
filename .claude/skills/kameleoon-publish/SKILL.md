---
name: kameleoon-publish
description: Publish a locally verified variation to the Kameleoon app — find the right experiment, create a variation, push variation.js/css, or create goals and draft experiments. Use when the user says push, publish, upload, ship to Kameleoon, create a variation/goal/experiment in the app.
---

# Publishing to the Kameleoon app

Every call goes through a logged-in `app.kameleoon.com` tab using the user's own session. If no such tab is open, the tools fail saying so: ask the user to open one and, for client work, to impersonate the client account themselves. Never automate login or impersonation, and never try to obtain the session token.

## Flow

1. **Find the experiment** with `list_kameleoon_experiments`. Its description gives the ranking (host match with `targetTabUrl` dominates). Show the user the top candidate and two alternatives with name, id, status and `baseURL`, and say why the top one won. If nothing scores well, ask.
2. **Reuse before creating.** If the experiment already has a variation this work belongs to, skip to step 4. `push_variation_code` is idempotent, so re-run it after a local tweak instead of creating another variation.
3. **Create a variation** with `create_kameleoon_variation`. This rewrites the live traffic split. Show the before/after split, get an explicit yes, and only then pass `confirmed: true`. Traffic is split evenly by default. For a custom split, pass `deviations` keyed by `"origin"`, the existing variation ids, and `"new"`.
4. **Push the code** with `push_variation_code` and an explicit `variationId`. It refuses a variation owned by another experiment, and refuses to overwrite code this session did not write unless `overwrite: true`. Only pass that after the user agrees.
5. **QA it in a real simulation.** Use the `kameleoon-qa` skill.

## Goals and experiments

- `create_kameleoon_goal` creates a CUSTOM goal (converted with `Kameleoon.API.Goals.processConversion(id)`). It reuses a goal of the same name and only appends to experiments' goal lists. Confirm the goal name and the target experiments with the user before attaching.
- `create_kameleoon_experiment` creates a draft (it never launches and has no variations), reusing a same-name experiment on the site. Keep the default `DEVELOPER` (code editor) type. Pass `CLASSIC` only when the user asks for the graphic editor.

Nothing here deletes. `DELETE /variations/{id}` exists and is never called.
