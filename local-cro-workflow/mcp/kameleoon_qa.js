// Kameleoon QA tools — close the loop: push code → run it in a real Kameleoon
// simulation → verify it held.
//
// The point of these three tools is that the four ways QA fails look identical from
// the outside ("the change isn't there"):
//
//   1. the engine never loaded, so nothing Kameleoon-related ran at all
//   2. the deployed code is not the code you think you are testing
//   3. the code ran, applied the change, and the page took it back milliseconds later
//   4. the code ran and genuinely did nothing
//
// A boolean return collapses all four into one useless word, so nothing here returns a
// boolean verdict on its own — every result carries the evidence that separates them.
//
// Deliberately absent: any tool that injects or overrides variation code in the page.
// The bridge injects at document_start, which wins races the Kameleoon engine loses, so
// anything running variation code at a time the engine would not is a confident lie
// generator. The honest loop is: real code, real engine, sampled result.

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { evaluateJs, openUrl } from '../daemon/server.js';
import { apiRequest, pushVariationCode, readWorkspaceFile } from './kameleoon_push.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Page-side snippets return JSON strings; anything else means the page threw. */
function parsePageJson(raw, what) {
  if (typeof raw !== 'string') {
    throw new Error(`${what}: expected a JSON string from the page, got ${typeof raw} (${JSON.stringify(raw)?.slice(0, 200)})`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    // background.js's eval wrapper returns the stringified exception on a page error.
    throw new Error(`${what}: the page returned "${raw.slice(0, 300)}" instead of JSON`);
  }
}

/**
 * Line endings and trailing whitespace survive round-tripping through the Kameleoon
 * app differently than they do on disk, and neither difference changes what runs.
 */
function normaliseCode(code) {
  if (typeof code !== 'string') return null;
  return code.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

/**
 * Opening this URL establishes a full simulation session on its own — no click on the
 * app's SIMULATE button, no short link, no app tab. baseURL often already carries a
 * query string, so the params go on through the URL API rather than by concatenation.
 */
function buildSimulationUrl(baseURL, experimentId) {
  const url = new URL(baseURL);
  url.searchParams.set('kameleoon-experiment-id', String(experimentId));
  url.searchParams.set('kameleoon-simulation', 'true');
  url.searchParams.set('kameleoon-language', 'en');
  return url.toString();
}

// The engine strips kameleoon-simulation from the URL once the session is established
// and persists the original params in the kameleoonSimulationParameters cookie, so the
// raw opened URL never equals the settled one. Compare with our own params removed —
// what we actually want to know is whether the *page* navigated somewhere else.
const SIM_PARAMS = ['kameleoon-experiment-id', 'kameleoon-simulation', 'kameleoon-language'];

function stripSimParams(href) {
  try {
    const url = new URL(href);
    for (const param of SIM_PARAMS) url.searchParams.delete(param);
    return url.toString();
  } catch {
    return href;
  }
}

// --- page probes -------------------------------------------------------------------

/**
 * Reads everything tool 1 reports, in one page round-trip. Deployed code is read from
 * simulationModeData, which is the only reliable answer to "which code is actually
 * running" and also exposes afterDOMReady (the "run after page load" checkbox).
 */
function simulationProbeSource(variationId, experimentName) {
  const VID = JSON.stringify(variationId);
  const NAME = JSON.stringify(experimentName || null);
  return `(function () {
  try {
    var out = { href: location.href, readyState: document.readyState };
    var K = window.Kameleoon;
    out.kameleoonType = K === undefined ? 'undefined' : (Array.isArray(K) ? 'array' : typeof K);
    out.engineLoaded = !!(K && typeof K === 'object' && !Array.isArray(K) && (K.API || K.Internals));

    try {
      var reqs = performance.getEntriesByType('resource')
        .filter(function (r) { return r.name.indexOf('engine.js') !== -1; })
        .map(function (r) { return { url: r.name, transferSize: r.transferSize || 0, duration: Math.round(r.duration) }; });
      out.engineRequests = reqs;
    } catch (e) { out.engineRequests = []; }
    out.engineScriptTags = Array.prototype.slice
      .call(document.querySelectorAll('script[src*="engine.js"]'))
      .map(function (s) { return s.src; });
    out.engineUrl = out.engineRequests.length
      ? out.engineRequests[out.engineRequests.length - 1].url
      : (out.engineScriptTags[0] || null);

    var rt = K && K.Internals && K.Internals.runtime ? K.Internals.runtime : null;
    var smd = rt ? rt.simulationModeData : null;
    out.hasSMD = !!smd;

    // simMode has no single documented flag, so report what was actually observed
    // rather than inventing one: an explicit runtime boolean if there is one, else
    // the panel element and the cookie the engine writes when it strips the param.
    var evidence = {};
    if (rt) {
      ['simulationMode', 'isSimulationMode', 'simulation'].forEach(function (key) {
        if (typeof rt[key] === 'boolean') evidence['runtime.' + key] = rt[key];
      });
    }
    evidence.panelPresent = !!document.querySelector('kameleoon-simulation');
    evidence.simulationParametersCookie = document.cookie.indexOf('kameleoonSimulationParameters') !== -1;
    var explicit = Object.keys(evidence).filter(function (k) { return k.indexOf('runtime.') === 0; });
    out.simMode = explicit.length
      ? explicit.some(function (k) { return evidence[k]; })
      : (evidence.panelPresent || evidence.simulationParametersCookie);
    out.simModeEvidence = evidence;

    var variation = null;
    if (smd && Array.isArray(smd.variations)) {
      variation = smd.variations.filter(function (v) { return v.id === ${VID}; })[0] || null;
      out.availableVariations = smd.variations.map(function (v) { return { id: v.id, name: v.name }; });
    } else {
      out.availableVariations = [];
    }
    out.variationFoundInSimulationData = !!variation;
    out.deployedCode = variation && variation.javaScriptCode ? (variation.javaScriptCode.code || '') : null;
    out.afterDOMReady = variation && variation.javaScriptCode ? !!variation.javaScriptCode.afterDOMReady : null;
    try {
      out.deployedCssLen = variation && variation.cssCode
        ? (typeof variation.cssCode === 'string' ? variation.cssCode.length : (variation.cssCode.code || '').length)
        : null;
    } catch (e) { out.deployedCssLen = null; }

    // A draft experiment appears at runtime as id -1, so the real numeric id is
    // useless here — match by name, and fall back to the sole entry when there is one.
    var assignedId = null;
    var runtimeExperimentId = null;
    if (smd && smd.variationIdByExperimentId) {
      var map = smd.variationIdByExperimentId;
      var all = [];
      try { all = (K.API && K.API.Experiments && K.API.Experiments.getAll) ? (K.API.Experiments.getAll() || []) : []; } catch (e) {}
      var byName = ${NAME} ? all.filter(function (e) { return e && e.name === ${NAME}; })[0] : null;
      var keys = Object.keys(map);
      if (byName && map[byName.id] !== undefined) {
        runtimeExperimentId = byName.id;
        assignedId = map[byName.id];
      } else if (keys.length === 1) {
        runtimeExperimentId = Number(keys[0]);
        assignedId = map[keys[0]];
      }
      out.variationIdByExperimentId = map;
      out.runtimeExperimentNames = all.map(function (e) { return e && e.name; });
    }
    out.runtimeExperimentId = runtimeExperimentId;
    out.assignedVariationId = assignedId == null ? null : assignedId;
    var assigned = null;
    if (assignedId != null && smd && Array.isArray(smd.variations)) {
      var hit = smd.variations.filter(function (v) { return v.id === assignedId; })[0];
      if (hit) assigned = hit.name;
    }
    if (!assigned && (assignedId === 0 || assignedId === null) && smd) assigned = assignedId === 0 ? 'Original' : null;
    out.assignedVariation = assigned;

    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({ probeError: String(e) });
  }
})()`;
}

/** Five-event sequence the simulation panel's custom elements actually listen for. */
const FIRE_HELPER = `function fire(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, view: window }));
    });
  }`;

const PANEL_ROOT = `var host = document.querySelector('kameleoon-simulation');
  if (!host) return JSON.stringify({ ok: false, reason: 'no_panel' });
  var root = host.shadowRoot;
  if (!root) return JSON.stringify({ ok: false, reason: 'no_shadow_root' });`;

const expandPanelSource = `(function () {
  ${FIRE_HELPER}
  try {
    ${PANEL_ROOT}
    var combo = root.querySelector('[role="combobox"]');
    if (combo) return JSON.stringify({ ok: true, wasExpanded: true });
    var buttons = root.querySelectorAll('button');
    if (!buttons.length) return JSON.stringify({ ok: false, reason: 'no_toggle_button' });
    fire(buttons[buttons.length - 1]);
    return JSON.stringify({ ok: true, wasExpanded: false });
  } catch (e) {
    return JSON.stringify({ ok: false, reason: 'error', error: String(e) });
  }
})()`;

const openComboboxSource = `(function () {
  ${FIRE_HELPER}
  try {
    ${PANEL_ROOT}
    var combo = root.querySelector('[role="combobox"]');
    if (!combo) return JSON.stringify({ ok: false, reason: 'no_combobox' });
    fire(combo);
    return JSON.stringify({ ok: true, comboText: (combo.textContent || '').trim() });
  } catch (e) {
    return JSON.stringify({ ok: false, reason: 'error', error: String(e) });
  }
})()`;

function pickOptionSource(name) {
  const NAME = JSON.stringify(name);
  return `(function () {
  ${FIRE_HELPER}
  try {
    ${PANEL_ROOT}
    var nodes = Array.prototype.slice.call(root.querySelectorAll('[role="option"]'));
    var options = nodes.map(function (o) { return (o.textContent || '').trim(); });
    if (!nodes.length) return JSON.stringify({ ok: false, reason: 'no_options', options: [] });
    var wanted = ${NAME}.trim().toLowerCase();
    var index = options.findIndex(function (t) { return t.toLowerCase() === wanted; });
    if (index === -1) index = options.findIndex(function (t) { return t.toLowerCase().indexOf(wanted) !== -1; });
    if (index === -1) return JSON.stringify({ ok: false, reason: 'no_match', options: options });
    fire(nodes[index]);
    return JSON.stringify({ ok: true, options: options, clicked: options[index] });
  } catch (e) {
    return JSON.stringify({ ok: false, reason: 'error', error: String(e) });
  }
})()`;
}

const readSelectionSource = `(function () {
  try {
    ${PANEL_ROOT}
    var combo = root.querySelector('[role="combobox"]');
    var text = (root.textContent || '');
    var match = text.match(/Variation\\s*:\\s*([^\\n]+)/);
    return JSON.stringify({
      ok: true,
      comboText: combo ? (combo.textContent || '').trim() : null,
      label: match ? match[1].trim() : null
    });
  } catch (e) {
    return JSON.stringify({ ok: false, reason: 'error', error: String(e) });
  }
})()`;

function assertProbeSource(selector, contains, notContains) {
  const SEL = JSON.stringify(selector);
  const C = JSON.stringify(contains ?? null);
  const N = JSON.stringify(notContains ?? null);
  return `(function () {
  try {
    var el = document.querySelector(${SEL});
    var text = el ? (el.innerText || el.textContent || '') : null;
    var contains = ${C};
    var notContains = ${N};
    return JSON.stringify({
      ok: true,
      href: location.href,
      found: !!el,
      textLen: text === null ? 0 : text.length,
      hasContains: contains === null ? null : (text !== null && text.indexOf(contains) !== -1),
      hasNotContains: notContains === null ? null : (text !== null && text.indexOf(notContains) !== -1)
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) });
  }
})()`;
}

// --- tool 3: kameleoon_select_variation ---------------------------------------------

/**
 * Variation selection has no programmatic route: kameleoon-variation-id,
 * kameleoonVariationSelection, kameleoonForcedExperimentVariation (a Debug Assistant
 * key the engine contains zero references to) and assignVariation()+trigger() were all
 * tested and do nothing. Selection lives in memory at
 * simulationModeData.variationIdByExperimentId and is applied by the panel's own
 * re-render, so clicking through the shadow DOM is the only way.
 *
 * The flaky step is reading the options: querying [role="option"] in the same execution
 * frame that opened the combobox returns an empty list about half the time. Each step
 * below is therefore a separate page evaluation with a real delay in between, which is
 * the only reliable way to yield to the panel's render.
 */
async function selectVariation(args) {
  const retries = args.retries ?? 3;
  const tabId = args.tabId;
  const attempts = [];
  let lastOptions = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const trace = { attempt };
    try {
      const expanded = parsePageJson(await evaluateJs(expandPanelSource, 5000, tabId), 'expand panel');
      trace.expand = expanded;
      if (!expanded.ok) {
        attempts.push(trace);
        await sleep(400);
        continue;
      }
      await sleep(expanded.wasExpanded ? 150 : 500);

      const opened = parsePageJson(await evaluateJs(openComboboxSource, 5000, tabId), 'open combobox');
      trace.open = opened;
      if (!opened.ok) {
        attempts.push(trace);
        await sleep(400);
        continue;
      }
      // Yield before reading options — this is the whole reason the steps are split.
      await sleep(350 + attempt * 150);

      const picked = parsePageJson(await evaluateJs(pickOptionSource(args.name), 5000, tabId), 'pick option');
      trace.pick = picked;
      if (Array.isArray(picked.options) && picked.options.length) lastOptions = picked.options;
      if (!picked.ok) {
        attempts.push(trace);
        await sleep(400);
        continue;
      }

      await sleep(500);
      const read = parsePageJson(await evaluateJs(readSelectionSource, 5000, tabId), 'read selection');
      trace.verify = read;
      attempts.push(trace);

      const shown = read.comboText || read.label || '';
      if (shown && shown.toLowerCase().indexOf(args.name.trim().toLowerCase()) !== -1) {
        return { selected: shown, requested: args.name, attempts: attempt, options: lastOptions };
      }
      await sleep(400);
    } catch (err) {
      trace.error = err.message;
      attempts.push(trace);
      await sleep(400);
    }
  }

  const optionText = lastOptions && lastOptions.length
    ? `Options actually found in the panel: ${lastOptions.map(o => `"${o}"`).join(', ')}.`
    : 'No options were readable in the panel at all — check that the page is in a simulation session (kameleoon_push_and_simulate reports hasSMD) and that the panel is present.';
  throw new Error(
    `Could not select variation "${args.name}" in the simulation panel after ${retries} attempt(s). ${optionText} ` +
    `Per-attempt trace: ${JSON.stringify(attempts)}`
  );
}

// --- tool 1: kameleoon_push_and_simulate --------------------------------------------

async function pushAndSimulate(args) {
  const shouldPush = args.push !== false;
  const timeoutMs = args.timeoutMs ?? 20000;

  // A failed push must never be followed by a simulation: the page would show old code
  // and the run would read as a code failure. Propagate verbatim.
  let push = null;
  if (shouldPush) {
    push = await pushVariationCode({
      variationId: args.variationId,
      experimentId: args.experimentId,
      overwrite: args.overwrite
    });
  }

  const { data: experiment } = await apiRequest('GET', `/experiments/${args.experimentId}`);
  if (!experiment) throw new Error(`Experiment ${args.experimentId} not found`);

  const baseURL = experiment.baseURL;
  if (!baseURL) {
    throw new Error(
      `Experiment ${args.experimentId} ("${experiment.name}") has no baseURL set in the Kameleoon app, so there is no page to simulate on. ` +
      `Set the experiment's target URL in the app and retry — this tool will not guess a URL.`
    );
  }
  if (Array.isArray(experiment.variations) && !experiment.variations.includes(args.variationId)) {
    throw new Error(
      `Variation ${args.variationId} is not attached to experiment ${args.experimentId} ("${experiment.name}"), whose variations are [${experiment.variations.join(', ')}]. ` +
      `Simulating it would read another experiment's code.`
    );
  }

  const simulationUrl = buildSimulationUrl(baseURL, args.experimentId);
  const opened = await openUrl(simulationUrl, 15000);
  const tabId = opened && opened.tabId;
  if (!tabId) throw new Error(`Opening ${simulationUrl} returned no tab id: ${JSON.stringify(opened)}`);

  const startedAt = Date.now();
  let state = null;
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      state = parsePageJson(await evaluateJs(simulationProbeSource(args.variationId, experiment.name), 5000, tabId), 'simulation probe');
      if (state.probeError) { lastError = state.probeError; state = null; }
      else if (state.engineLoaded && state.hasSMD) break;
    } catch (err) {
      // Mid-navigation evaluations fail; that is not a result, just a missed sample.
      lastError = err.message;
    }
    await sleep(400);
  }
  const waitedMs = Date.now() - startedAt;

  if (!state) {
    throw new Error(
      `Could not read page state from tab ${tabId} (${simulationUrl}) within ${timeoutMs}ms. Last error: ${lastError || 'none'}. ` +
      `The tab is open — inspect it by hand.`
    );
  }

  let selection = null;
  if (args.variationName) {
    try {
      selection = await selectVariation({ tabId, name: args.variationName, retries: 3 });
      await sleep(400);
      const after = parsePageJson(await evaluateJs(simulationProbeSource(args.variationId, experiment.name), 5000, tabId), 'simulation probe');
      if (!after.probeError) state = after;
    } catch (err) {
      // Reported, not thrown: the session itself may be perfectly fine and worth QAing.
      selection = { error: err.message };
    }
  }

  const local = await readWorkspaceFile('variation.js');
  const localCode = normaliseCode(local.content);
  const deployedCode = normaliseCode(state.deployedCode);
  const codeMatchesLocal = localCode === null || deployedCode === null ? null : localCode === deployedCode;

  const deployedLen = state.deployedCode === null ? null : state.deployedCode.length;
  const localLen = local.content === null ? null : local.content.length;

  let diagnosis;
  let hint;
  if (!state.engineLoaded) {
    diagnosis = 'engine_blocked';
    hint =
      `window.Kameleoon is ${state.kameleoonType} — the engine never loaded, so nothing Kameleoon-related ran and no conclusion about the variation code is possible. ` +
      `Requested engine URL: ${state.engineUrl || '(no engine.js request recorded)'}.`;
  } else if (!state.hasSMD) {
    diagnosis = 'no_session';
    hint =
      `The engine loaded but Kameleoon.Internals.runtime.simulationModeData is still absent after ${waitedMs}ms — the simulation session was not established. ` +
      `Note that the engine strips kameleoon-simulation from the URL once a session IS established, so a missing param in the final URL is not the problem here.`;
  } else if (!state.variationFoundInSimulationData) {
    // The session is live but the variation under test is not in it — whatever the page
    // is doing, it is not this variation. That is failure mode 2, not an "ok" run.
    diagnosis = 'stale_code';
    hint =
      `Variation ${args.variationId} is not present in simulationModeData.variations at all (available: ${JSON.stringify(state.availableVariations)}), so no deployed code could be read. ` +
      `Whatever the page is doing, it is not this variation — check the variation id and that the push landed.`;
  } else if (codeMatchesLocal === false) {
    diagnosis = 'stale_code';
    hint = `The session is fine, but the code running in the page is not the local variation.js (${deployedLen} chars deployed vs ${localLen} local). Push again before reading anything into the page's behaviour.`;
  } else {
    diagnosis = 'ok';
    if (codeMatchesLocal === null) {
      hint = local.content === null
        ? `Engine and session are fine, but no local variation.js was found at ${local.path}, so "is this the code I think it is" could not be answered.`
        : `Engine and session are fine, but no deployed code was readable for variation ${args.variationId}, so the local/deployed comparison was skipped.`;
    } else {
      hint = `Engine loaded, session established, and the deployed code matches local variation.js. This says the right code ran — it does NOT say the change held. Sample it with kameleoon_assert.`;
    }
  }

  return {
    tabId,
    url: state.href,
    openedUrl: simulationUrl,
    engineLoaded: state.engineLoaded,
    engineUrl: state.engineUrl,
    engineRequests: state.engineRequests,
    hasSMD: state.hasSMD,
    simMode: state.simMode,
    simModeEvidence: state.simModeEvidence,
    deployedCodeLen: deployedLen,
    // Surfaced on a mismatch so the size gap is visible at a glance.
    localCodeLen: diagnosis === 'stale_code' ? localLen : undefined,
    codeMatchesLocal,
    afterDOMReady: state.afterDOMReady,
    assignedVariation: state.assignedVariation,
    assignedVariationId: state.assignedVariationId,
    availableVariations: state.availableVariations,
    // True when the PAGE went somewhere else — our own simulation params are stripped
    // from both sides first, because the engine always removes kameleoon-simulation.
    navigated: stripSimParams(state.href) !== stripSimParams(simulationUrl),
    waitedMs,
    pushed: push ? { variationId: push.variationId, verified: push.verified, bytes: push.pushed['variation.js'].bytes } : null,
    variationSelection: selection,
    experiment: { id: experiment.id, name: experiment.name, status: experiment.status, baseURL },
    diagnosis,
    hint
  };
}

// --- tool 2: kameleoon_assert --------------------------------------------------------

/**
 * Samples over time instead of reading once. On a real page a change can apply at 624ms
 * and be reverted by the site at 692ms; a single read at 500ms and a single read at 5s
 * report the opposite of the truth in each direction. Separating "never applied" from
 * "applied then reverted" is the entire reason this tool exists, so it never stops at
 * the first satisfied sample.
 */
async function assertOverTime(args) {
  if (args.contains == null && args.notContains == null) {
    throw new Error('kameleoon_assert needs at least one of contains / notContains — there is nothing to sample for otherwise.');
  }
  const selector = args.selector || 'body';
  const sampleForMs = Math.min(args.sampleForMs ?? 8000, 120000);
  const intervalMs = Math.max(args.intervalMs ?? 250, 50);
  const source = assertProbeSource(selector, args.contains, args.notContains);

  const startedAt = Date.now();
  const transitions = [];
  const navigations = [];
  const errors = [];
  // The page is assumed to start unsatisfied — the change is not there before the code
  // runs — so a satisfied first sample is itself a transition worth timestamping.
  let previousState = 'unsatisfied';
  let firstSatisfiedAt = null;
  let everSatisfied = false;
  let lastHref = null;
  let samples = 0;
  let lastSample = null;

  while (Date.now() - startedAt < sampleForMs) {
    const at = Date.now() - startedAt;
    let sample = null;
    try {
      sample = parsePageJson(await evaluateJs(source, 4000, args.tabId), 'assert probe');
    } catch (err) {
      // A navigation in flight makes evaluation fail. Keep sampling the same tab.
      errors.push({ at, error: err.message });
    }

    if (sample && sample.ok) {
      samples++;
      lastSample = sample;
      if (lastHref !== null && sample.href !== lastHref) {
        navigations.push({ at, from: lastHref, to: sample.href });
      }
      lastHref = sample.href;

      const containsOk = sample.hasContains === null ? true : sample.hasContains === true;
      // A missing element cannot contain the forbidden text, so notContains holds;
      // `found` is reported so a caller can tell that case from a real pass.
      const notContainsOk = sample.hasNotContains === null ? true : sample.hasNotContains === false;
      const state = containsOk && notContainsOk ? 'satisfied' : 'unsatisfied';

      if (state === 'satisfied') {
        everSatisfied = true;
        if (firstSatisfiedAt === null) firstSatisfiedAt = at;
      }
      if (state !== previousState) {
        transitions.push({ at, state });
        previousState = state;
      }
    }

    const elapsed = Date.now() - startedAt - at;
    await sleep(Math.max(0, intervalMs - elapsed));
  }

  const finalState = previousState;
  let verdict;
  if (!everSatisfied) verdict = 'never_applied';
  else if (finalState === 'satisfied') verdict = 'applied_and_held';
  else verdict = 'applied_then_reverted';

  return {
    passed: finalState === 'satisfied',
    verdict,
    firstSatisfiedAt,
    transitions,
    finalState,
    initialStateAssumed: 'unsatisfied',
    samples,
    sampledForMs: Date.now() - startedAt,
    intervalMs,
    selector,
    contains: args.contains ?? null,
    notContains: args.notContains ?? null,
    elementFoundAtEnd: lastSample ? lastSample.found : null,
    navigations,
    navigatedDuringSampling: navigations.length > 0,
    failedSamples: errors.length ? errors : undefined,
    hint:
      verdict === 'applied_then_reverted'
        ? 'The change applied and the page took it back. This is a race with the site, not a broken selector — escalate from runWhenElementPresent to a MutationObserver, or re-apply after the framework settles.'
        : verdict === 'never_applied'
          ? 'The condition was never satisfied at any sample. Check the selector and confirm with kameleoon_push_and_simulate that the engine loaded and the deployed code is current before rewriting the variation.'
          : 'The condition was satisfied at the end of sampling and stayed that way.'
  };
}

// --- schemas & registration ----------------------------------------------------------

const PushAndSimulateSchema = z.object({
  experimentId: z.number().describe("Experiment id. Used to look up baseURL and to scope the variation."),
  variationId: z.number().describe("Target variation id. Also the key used to read the deployed code back out of the running engine."),
  push: z.boolean().optional().describe("Default true. When false, skip the push and only open a simulation session."),
  overwrite: z.boolean().optional().describe("Passed through to push_variation_code when the target already holds code this session did not write."),
  variationName: z.string().optional().describe("If set, select this variation in the simulation panel after load (runs kameleoon_select_variation)."),
  timeoutMs: z.number().optional().describe("Default 20000. How long to wait for the engine and the simulation session.")
});

const AssertSchema = z.object({
  tabId: z.number().describe("Tab to sample — the tabId returned by kameleoon_push_and_simulate."),
  selector: z.string().optional().describe("Scope for the text checks. Defaults to body."),
  contains: z.string().optional().describe("Text that must be present. At least one of contains / notContains is required."),
  notContains: z.string().optional().describe("Text that must be absent. At least one of contains / notContains is required."),
  sampleForMs: z.number().optional().describe("Default 8000. Total sampling window."),
  intervalMs: z.number().optional().describe("Default 250. Time between samples.")
});

const SelectVariationSchema = z.object({
  tabId: z.number().describe("Tab running the simulation session."),
  name: z.string().describe("Variation name exactly as the panel lists it, e.g. \"Original\" or \"Variation 1\"."),
  retries: z.number().optional().describe("Default 3. The panel's option list is genuinely flaky to read; retries are normal, not a sign of failure.")
});

export const kameleoonQaTools = [
  {
    name: "kameleoon_push_and_simulate",
    description: "Pushes variation.js/variation.css to a Kameleoon variation, opens a real simulation session on the experiment's baseURL in a new tab, and reports what actually loaded. Returns a `diagnosis` enum — engine_blocked (window.Kameleoon undefined — the engine never loaded), no_session (engine up, simulationModeData absent), stale_code (session fine, deployed code != local variation.js), ok — plus the deployed code length, the afterDOMReady flag, the assigned variation and whether the page navigated. Never reports ok merely because the tab opened, and `ok` means the right code ran, NOT that the change held: follow it with kameleoon_assert on the returned tabId. The simulation tab is not the bridge's target tab, so nothing is injected into it — the real engine runs the real code.",
    inputSchema: zodToJsonSchema(PushAndSimulateSchema)
  },
  {
    name: "kameleoon_assert",
    description: "Verifies a variation by SAMPLING a tab over time rather than reading it once, and returns a verdict of never_applied / applied_then_reverted / applied_and_held with the timestamp of every transition. Use this instead of a one-shot evaluate_js check: a change that applies at 624ms and is reverted by the site at 692ms reads as a pass at 500ms and a fail at 5s, and only sampling tells them apart. applied_then_reverted means a race with the page, not a broken selector. Survives mid-run navigation and reports it.",
    inputSchema: zodToJsonSchema(AssertSchema)
  },
  {
    name: "kameleoon_select_variation",
    description: "Selects a variation by name in the Kameleoon simulation panel by clicking through its shadow DOM — the only route that works. URL params (kameleoon-variation-id, kameleoonVariationSelection), localStorage (kameleoonForcedExperimentVariation) and Experiments.assignVariation()+trigger() were all tested and do nothing. Reading the panel's options is genuinely flaky, so this retries with a backoff; if QA only needs one arm, setting traffic to 100% in the app is simpler than this tool. Fails with the list of options actually found when the name does not match.",
    inputSchema: zodToJsonSchema(SelectVariationSchema)
  }
];

/** Returns a tool result, or null if the name is not one of ours. */
export async function handleKameleoonQaTool(name, rawArgs) {
  const run = async () => {
    if (name === 'kameleoon_push_and_simulate') return pushAndSimulate(PushAndSimulateSchema.parse(rawArgs || {}));
    if (name === 'kameleoon_assert') return assertOverTime(AssertSchema.parse(rawArgs || {}));
    if (name === 'kameleoon_select_variation') return selectVariation(SelectVariationSchema.parse(rawArgs || {}));
    return undefined;
  };

  let result;
  try {
    result = await run();
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }
  if (result === undefined) return null;
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
