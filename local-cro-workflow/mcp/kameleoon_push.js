// push_to_kameleoon — publishes local variation code to the Kameleoon app.
//
// Every HTTP call is issued by the Chrome extension from inside a logged-in
// app.kameleoon.com tab, because the only credential available is the user's own
// session cookie (Automation API client credentials are bound to the user's account
// and are unobtainable for impersonated client accounts). Nothing here ever reads,
// stores or transports that cookie: the daemon sends a method/url/body and gets back
// a status code and a parsed body.
//
// Three narrow tools, deliberately split so that re-pushing edited code never creates
// another variation:
//   list_kameleoon_experiments  — read-only, feeds the agent's experiment guess
//   create_kameleoon_variation  — POST /variations + attach PATCH (rewrites traffic split)
//   push_variation_code         — PATCH /variations/{id} with the workspace files

import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { kameleoonApiRequest, getWorkspacePath, evaluateJs } from '../daemon/server.js';

const API_ORIGIN = 'https://api.kameleoon.com';

// Variations this process created. Used only to decide whether push_variation_code
// needs an explicit overwrite acknowledgement — never persisted.
const createdVariationIds = new Set();

const LOGGED_OUT_HINT =
  'Log in at https://app.kameleoon.com in Chrome (and impersonate the client account by hand if this is client work), then retry. This tool never logs in for you.';

/**
 * Issues one Automation API call through the browser session and normalizes failures
 * into messages that say what the user has to do about them.
 */
async function apiRequest(method, pathAndQuery, body = null, timeoutMs = 20000) {
  const url = `${API_ORIGIN}${pathAndQuery}`;
  const res = await kameleoonApiRequest({ method, url, body }, timeoutMs);

  if (res.networkError) {
    throw new Error(`${method} ${url} failed inside the browser tab: ${res.networkError}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${method} ${url} returned ${res.status} — the app.kameleoon.com session is not authenticated for this account. ${LOGGED_OUT_HINT}`);
  }
  if (res.body === null && res.rawBody && /<html/i.test(res.rawBody)) {
    throw new Error(`${method} ${url} returned HTML instead of JSON (status ${res.status}) — the session is probably logged out. ${LOGGED_OUT_HINT}`);
  }
  if (res.status === 423) {
    throw new Error(`${method} ${url} returned 423 Locked. The Kameleoon app is holding a lock on this object (someone editing it in the UI is the usual cause). Close the editor and retry; do not force it.`);
  }
  if (!res.ok) {
    const detail = res.body ? JSON.stringify(res.body) : (res.rawBody || '');
    throw new Error(`${method} ${url} failed: ${res.status} ${res.statusText || ''} ${detail}`.trim());
  }
  return { data: res.body, appTabUrl: res.tab ? res.tab.url : null };
}

/**
 * Builds a paramsIO query string. The Automation API takes paramsIO as flat query
 * params — `perPage`, `page` and a URL-encoded JSON `filter` array of
 * {field, operator, parameters} objects.
 */
function buildQuery({ perPage, page, filter, sort } = {}) {
  const parts = [];
  if (perPage != null) parts.push(`perPage=${encodeURIComponent(perPage)}`);
  if (page != null) parts.push(`page=${encodeURIComponent(page)}`);
  if (filter && filter.length) parts.push(`filter=${encodeURIComponent(JSON.stringify(filter))}`);
  if (sort && sort.length) parts.push(`sort=${encodeURIComponent(JSON.stringify(sort))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * The Kameleoon app URL carries an account-specific path prefix before /experiments/,
 * so the only honest way to build a deep link is to derive it from the tab that just
 * served the API call. Returns null rather than guessing.
 */
function deriveExperimentUrl(appTabUrl, experimentId) {
  if (!appTabUrl) return null;
  const match = appTabUrl.match(/^(https:\/\/app\.kameleoon\.com\/[^?#]*?)\/experiments(?:\/|$)/);
  return match ? `${match[1]}/experiments/${experimentId}` : null;
}

const EXPERIMENT_FIELDS = [
  'id', 'name', 'siteId', 'siteCode', 'baseURL', 'status', 'type',
  'variations', 'deviations', 'isArchived', 'dateModified', 'dateCreated'
];

function slimExperiment(exp) {
  const out = {};
  for (const key of EXPERIMENT_FIELDS) {
    if (exp[key] !== undefined) out[key] = exp[key];
  }
  return out;
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Best-effort read of the CRO target tab's URL — the strongest experiment-matching signal. */
async function getTargetTabUrl() {
  try {
    return await evaluateJs('location.href', 3000, null);
  } catch {
    return null;
  }
}

// --- deviations -------------------------------------------------------------------

/**
 * Even split across the original page plus every variation, with the rounding
 * remainder given to `origin` (3 entries → origin 0.34, variations 0.33 each).
 */
function evenDeviations(variationIds) {
  const share = Math.floor(100 / (variationIds.length + 1)) / 100;
  const deviations = {};
  for (const id of variationIds) deviations[String(id)] = share;
  deviations.origin = Number((1 - share * variationIds.length).toFixed(2));
  return deviations;
}

function assertValidDeviations(deviations, expectedKeys) {
  const expected = new Set(expectedKeys.map(String));
  const got = new Set(Object.keys(deviations));
  for (const key of got) {
    if (!expected.has(key)) throw new Error(`deviations contains unknown key "${key}" — keys must be exactly ${[...expected].map(k => `"${k}"`).join(', ')}`);
  }
  for (const key of expected) {
    if (!got.has(key)) throw new Error(`deviations is missing key "${key}" — keys must be exactly ${[...expected].map(k => `"${k}"`).join(', ')}`);
  }
  const sum = Object.values(deviations).reduce((acc, v) => {
    if (typeof v !== 'number' || v < 0 || v > 1) throw new Error(`deviations values must be numbers between 0 and 1, got ${v}`);
    return acc + v;
  }, 0);
  if (Math.abs(sum - 1) > 0.001) throw new Error(`deviations must sum to 1, got ${sum}`);
}

// --- workspace files --------------------------------------------------------------

async function readWorkspaceFile(fileName) {
  const workspace = getWorkspacePath();
  const candidates = [
    path.join(workspace, fileName),
    path.join(workspace, 'experiments', fileName)
  ];
  for (const candidate of candidates) {
    try {
      return { path: candidate, content: await fs.readFile(candidate, 'utf-8') };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return { path: candidates[0], content: null };
}

// --- tools ------------------------------------------------------------------------

const ListExperimentsSchema = z.object({
  siteCode: z.string().optional().describe("Kameleoon siteCode to restrict results to. Resolved to a siteId via GET /sites first."),
  siteId: z.number().optional().describe("Kameleoon siteId to restrict results to. Takes precedence over siteCode."),
  query: z.string().optional().describe("Case-insensitive substring matched against experiment names. Applied client-side after fetching."),
  status: z.string().optional().describe("Status filter passed to the API, e.g. ACTIVE, DRAFT, PAUSED, STOPPED."),
  includeArchived: z.boolean().optional().describe("Include archived experiments (default false — archived ones are never valid publish targets)."),
  perPage: z.number().optional().describe("Page size (default 200)."),
  page: z.number().optional().describe("1-based page number (default 1).")
});

const CreateVariationSchema = z.object({
  experimentId: z.number().describe("Id of the experiment to attach the new variation to."),
  name: z.string().describe("Name for the new variation as it will appear in the Kameleoon app."),
  confirmed: z.boolean().describe("Must be true, and may only be set after the user has explicitly approved BOTH the target experiment and the resulting traffic split. This call rewrites the traffic allocation of a possibly live experiment."),
  deviations: z.record(z.number()).optional().describe("Explicit traffic split to write, e.g. {\"origin\":0.5,\"1284235\":0.25,\"new\":0.25}. Keys are \"origin\", every EXISTING variation id, and the literal \"new\" standing in for the variation about to be created (its id does not exist yet); values are 0–1 doubles summing to 1. Omit to split evenly across the original page and all variations.")
});

const PushVariationCodeSchema = z.object({
  variationId: z.number().describe("Id of the variation to write to. Required and explicit — there is no 'push to whatever seems right' path."),
  experimentId: z.number().describe("Id of the experiment that owns the variation. Checked against the variation's own experimentId before writing."),
  overwrite: z.boolean().optional().describe("Acknowledge overwriting code on a variation this session did not create. Required when the target already holds different non-empty code.")
});

export const kameleoonTools = [
  {
    name: "list_kameleoon_experiments",
    description: "Lists Kameleoon experiments via the Automation API, authenticated by the user's existing app.kameleoon.com browser session. Read-only. Use this to work out which experiment the local variation belongs to: rank candidates by (1) siteCode/baseURL host vs the CRO target tab's URL — by far the strongest signal, and the response includes targetTabUrl for exactly this — then (2) name similarity to the branch / .archive folder / what the user called the test, then (3) dateModified and status (active or draft beats stopped). Archived experiments are excluded by default and are never valid targets. Present the top candidate plus a couple of alternatives with name, id, status and baseURL, say why the top one won, and ask rather than guessing confidently when nothing scores well.",
    inputSchema: zodToJsonSchema(ListExperimentsSchema)
  },
  {
    name: "create_kameleoon_variation",
    description: "Creates a NEW variation on an existing experiment and attaches it — POST /variations (which on its own produces a variation attached to nothing) followed by PATCH /experiments/{id} with the full variations array and deviations map. The second call REWRITES THE LIVE TRAFFIC SPLIT of the experiment, so it requires confirmed:true, which you may only pass after showing the user the target experiment and the before/after split and getting an explicit yes. Never overwrites or deletes an existing variation. Returns the new variation id and the before/after deviations.",
    inputSchema: zodToJsonSchema(CreateVariationSchema)
  },
  {
    name: "push_variation_code",
    description: "Reads variation.js and variation.css from the local workspace and PATCHes them into a Kameleoon variation's jsCode/cssCode (the variation code editor — experiment-level commonJavaScriptCode/globalScript are untouched). Idempotent: safe to re-run after a local edit without creating another variation. Verifies the write by reading the variation back.",
    inputSchema: zodToJsonSchema(PushVariationCodeSchema)
  }
];

async function listExperiments(args) {
  const filter = [];
  let siteId = args.siteId;

  if (siteId == null && args.siteCode) {
    const { data: sites } = await apiRequest(
      'GET',
      `/sites${buildQuery({ perPage: 50, filter: [{ field: 'code', operator: 'EQUAL', parameters: [args.siteCode] }] })}`
    );
    const site = Array.isArray(sites) ? sites.find(s => s.code === args.siteCode) : null;
    if (!site) throw new Error(`No site found with siteCode "${args.siteCode}" in this account. Check the account you are impersonating.`);
    siteId = site.id;
  }

  if (siteId != null) filter.push({ field: 'siteId', operator: 'EQUAL', parameters: [siteId] });
  if (args.status) filter.push({ field: 'status', operator: 'EQUAL', parameters: [args.status.toUpperCase()] });

  const query = buildQuery({ perPage: args.perPage || 200, page: args.page || 1, filter });
  // GET /experiments over a large account is the slowest call here — give it room.
  const { data, appTabUrl } = await apiRequest('GET', `/experiments${query}`, null, 30000);
  const targetTabUrl = await getTargetTabUrl();
  const targetHost = hostOf(targetTabUrl);

  let experiments = Array.isArray(data) ? data : [];
  if (!args.includeArchived) experiments = experiments.filter(e => !e.isArchived);
  if (args.query) {
    const needle = args.query.toLowerCase();
    experiments = experiments.filter(e => (e.name || '').toLowerCase().includes(needle));
  }

  const slimmed = experiments.map(e => {
    const out = slimExperiment(e);
    out.matchesTargetTabHost = targetHost != null && hostOf(e.baseURL) === targetHost;
    return out;
  });

  slimmed.sort((a, b) => {
    if (a.matchesTargetTabHost !== b.matchesTargetTabHost) return a.matchesTargetTabHost ? -1 : 1;
    return String(b.dateModified || '').localeCompare(String(a.dateModified || ''));
  });

  return {
    targetTabUrl,
    targetTabHost: targetHost,
    appTabUrl,
    siteId: siteId ?? null,
    count: slimmed.length,
    hostMatches: slimmed.filter(e => e.matchesTargetTabHost).length,
    note: 'Ranking here is host-match then recency only. Weigh name similarity and status yourself, show the user your reasoning, and get confirmation before creating anything.',
    experiments: slimmed
  };
}

async function createVariation(args) {
  if (args.confirmed !== true) {
    throw new Error(
      'create_kameleoon_variation refused: confirmed must be true. Show the user the target experiment (name, id, status, baseURL) and the before/after traffic split, get an explicit yes, then call again with confirmed:true. This call rewrites the traffic allocation of a possibly live experiment.'
    );
  }

  const { data: experiment, appTabUrl } = await apiRequest('GET', `/experiments/${args.experimentId}`);
  if (!experiment) throw new Error(`Experiment ${args.experimentId} not found`);
  if (experiment.isArchived) throw new Error(`Experiment ${args.experimentId} ("${experiment.name}") is archived — refusing to add a variation to it.`);
  if (experiment.type === 'MVT') {
    throw new Error(`Experiment ${args.experimentId} is an MVT experiment. MVT traffic is allocated through mvtAllocationSettings/mvtVariations, not the deviations map this tool writes. Add the variation in the app instead.`);
  }

  const beforeVariations = Array.isArray(experiment.variations) ? [...experiment.variations] : [];
  const beforeDeviations = { ...(experiment.deviations || {}) };

  // Validated BEFORE the POST: a rejection afterwards would strand an orphaned variation.
  if (args.deviations) {
    assertValidDeviations(args.deviations, ['origin', ...beforeVariations, 'new']);
  }

  const { data: created } = await apiRequest('POST', '/variations', {
    name: args.name,
    siteId: experiment.siteId,
    creationMode: 'CODE_BASE',
    experimentId: args.experimentId
  });

  const variationId = created && created.id;
  if (!variationId) throw new Error(`POST /variations returned no id: ${JSON.stringify(created)}`);
  createdVariationIds.add(variationId);

  // POST ignores experimentId — the variation is orphaned until this PATCH lands.
  const afterVariations = [...beforeVariations, variationId];
  let afterDeviations;
  if (args.deviations) {
    // The caller keys the not-yet-existing variation as "new"; swap in its real id.
    const { new: newShare, ...rest } = args.deviations;
    afterDeviations = { ...rest, [String(variationId)]: newShare };
  } else {
    afterDeviations = evenDeviations(afterVariations);
  }
  assertValidDeviations(afterDeviations, ['origin', ...afterVariations]);

  try {
    await apiRequest('PATCH', `/experiments/${args.experimentId}`, {
      variations: afterVariations,
      deviations: afterDeviations
    });
  } catch (err) {
    throw new Error(
      `Variation ${variationId} ("${args.name}") was created but could NOT be attached to experiment ${args.experimentId}, so it is currently orphaned and invisible in the app. ` +
      `The experiment's traffic split is unchanged. Retry the attach or clean the variation up by hand. Underlying error: ${err.message}`
    );
  }

  return {
    variationId,
    name: args.name,
    experimentId: args.experimentId,
    experimentName: experiment.name,
    experimentStatus: experiment.status,
    siteId: experiment.siteId,
    before: { variations: beforeVariations, deviations: beforeDeviations },
    after: { variations: afterVariations, deviations: afterDeviations },
    experimentUrl: deriveExperimentUrl(appTabUrl, args.experimentId),
    nextStep: `Push the local code with push_variation_code({ variationId: ${variationId}, experimentId: ${args.experimentId} }). The app UI may need a refresh to show the new variation.`
  };
}

async function pushVariationCode(args) {
  const [js, css] = await Promise.all([
    readWorkspaceFile('variation.js'),
    readWorkspaceFile('variation.css')
  ]);
  if (js.content === null && css.content === null) {
    throw new Error(`Neither variation.js nor variation.css was found in the workspace (${getWorkspacePath()}) — nothing to push.`);
  }

  const jsCode = js.content ?? '';
  const cssCode = css.content ?? '';

  const { data: existing, appTabUrl } = await apiRequest('GET', `/variations/${args.variationId}`);
  if (!existing) throw new Error(`Variation ${args.variationId} not found`);
  if (existing.experimentId != null && existing.experimentId !== args.experimentId) {
    throw new Error(`Variation ${args.variationId} belongs to experiment ${existing.experimentId}, not ${args.experimentId}. Refusing to write — check the variation id.`);
  }

  const holdsOtherCode =
    ((existing.jsCode && existing.jsCode !== jsCode) || (existing.cssCode && existing.cssCode !== cssCode));
  if (holdsOtherCode && !createdVariationIds.has(args.variationId) && !args.overwrite) {
    throw new Error(
      `Variation ${args.variationId} ("${existing.name}") already holds code that this session did not write ` +
      `(${(existing.jsCode || '').length} chars JS, ${(existing.cssCode || '').length} chars CSS). ` +
      `Show the user what would be replaced and re-run with overwrite:true if they approve, or create a new variation instead.`
    );
  }

  await apiRequest('PATCH', `/variations/${args.variationId}`, {
    experimentId: args.experimentId,
    jsCode,
    cssCode
  });

  const { data: readBack } = await apiRequest('GET', `/variations/${args.variationId}`);
  const verified = readBack && readBack.jsCode === jsCode && readBack.cssCode === cssCode;

  return {
    variationId: args.variationId,
    variationName: readBack ? readBack.name : existing.name,
    experimentId: args.experimentId,
    pushed: {
      'variation.js': { path: js.path, bytes: jsCode.length, found: js.content !== null },
      'variation.css': { path: css.path, bytes: cssCode.length, found: css.content !== null }
    },
    verified,
    warning: verified ? undefined : 'Read-back did not match what was sent — inspect the variation in the app before relying on it.',
    experimentUrl: deriveExperimentUrl(appTabUrl, args.experimentId)
  };
}

/** Returns a tool result, or null if the name is not one of ours. */
export async function handleKameleoonTool(name, rawArgs) {
  const run = async () => {
    if (name === 'list_kameleoon_experiments') return listExperiments(ListExperimentsSchema.parse(rawArgs || {}));
    if (name === 'create_kameleoon_variation') return createVariation(CreateVariationSchema.parse(rawArgs || {}));
    if (name === 'push_variation_code') return pushVariationCode(PushVariationCodeSchema.parse(rawArgs || {}));
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
