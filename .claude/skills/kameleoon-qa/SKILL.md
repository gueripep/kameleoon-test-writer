---
name: kameleoon-qa
description: Final QA of a variation in a real Kameleoon simulation — push the code, open a simulation tab, check the change applied and held, switch variations in the simulation panel. Use before reporting any variation as working, when the user says QA, simulate, test in Kameleoon, or "the change isn't there".
---

# Final QA in a real simulation

A green result from the bridge is a draft. The bridge injects at `document_start`, which wins races the engine loses. A variation is only "working" once the real engine ran it here. Tell the user which of the two you checked.

"The change isn't there" has four causes that look the same from outside. The tools exist to tell them apart, so don't collapse their output to pass/fail:

| Cause | Detected by |
|---|---|
| Engine never loaded | `kameleoon_push_and_simulate` → `engine_blocked` / `no_session` |
| Deployed code ≠ local code | `kameleoon_push_and_simulate` → `stale_code` |
| Applied, then the site reverted it | `kameleoon_assert` → `applied_then_reverted` |
| Code did nothing | `kameleoon_assert` → `never_applied` |

## Steps

1. `kameleoon_push_and_simulate`. It pushes the code and opens `<baseURL>&kameleoon-experiment-id=<id>&kameleoon-simulation=true&kameleoon-language=en` in a new tab. That URL alone creates the session (no SIMULATE button and no app tab needed). `ok` means the right code ran, not that the change held.
2. `kameleoon_assert` on the returned `tabId`. Never replace it with a one-shot `evaluate_js` check. `applied_then_reverted` is a race with the site, so climb the hydration ladder in `experiments/AGENTS.md`. It does not mean the selector is wrong.
3. To check another arm, use `kameleoon_select_variation`. Retries are normal. If only one arm matters, setting its traffic to 100% in the app is simpler.

## Things that mislead

- Don't read `engine.js` to check a draft: only launched experiments are published there.
- Runtime experiment ids aren't real ids (a draft is `id: -1`), so match experiments by `name` at runtime. Variation ids are real.
- The engine strips `kameleoon-simulation` from the URL and keeps the params in the `kameleoonSimulationParameters` cookie. A missing URL param does not mean the session is broken.
- The simulation tab is not the bridge's target tab, so nothing is injected into it. Don't add a way to inject code there: running variation code at a time the engine wouldn't makes the result meaningless.
