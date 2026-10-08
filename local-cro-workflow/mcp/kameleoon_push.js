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
//   get_kameleoon_results       — read-only, results report with breakdowns (POST computes, GET polls)
//   create_kameleoon_variation  — POST /variations + attach PATCH (rewrites traffic split)
//   push_variation_code         — PATCH /variations/{id} with the workspace files
//   create_kameleoon_goal       — POST /goals (CUSTOM) + optional append to experiments' goals
//   create_kameleoon_experiment — POST /experiments (always a draft) + optional goal attach
//   push_experiment_script      — PATCH /experiments/{id} globalScript ("Experiment custom script"; never the site's)

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
export async function apiRequest(method, pathAndQuery, body = null, timeoutMs = 20000) {
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

export async function readWorkspaceFile(fileName) {
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

const GetCodeSchema = z.object({
  personalizationId: z.number().optional().describe("Read every content (variation) of this personalization."),
  experimentId: z.number().optional().describe("Read every variation of this experiment, plus its experiment-level script if any."),
  variationId: z.number().optional().describe("Read a single variation / personalization content."),
  maxCodeChars: z.number().optional().describe("Truncate each code field to this many characters (default 20000). Full lengths are always reported.")
});

const GetResultsSchema = z.object({
  experimentId: z.number().describe("Experiment (or feature experiment) to read results for."),
  goalIds: z.array(z.number()).optional().describe("Goals to include. Omit for every goal attached to the experiment."),
  breakdown: z.object({
    type: z.string().describe("INTERVAL, DEVICE_TYPE, BROWSER, COUNTRY, NEW_VISITOR, CUSTOM_DATUM, CROSS_CAMPAIGN, … (full list in the Automation API docs)."),
    interval: z.enum(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']).optional().describe("Required with type INTERVAL."),
    index: z.number().optional().describe("Custom data index, required with type CUSTOM_DATUM."),
    experiments: z.array(z.number()).optional().describe("For CROSS_CAMPAIGN."),
    personalizations: z.array(z.number()).optional().describe("For CROSS_CAMPAIGN.")
  }).optional().describe("Split each variation's data by one dimension. Omit for totals only."),
  start: z.string().optional().describe("ISO date-time without timezone, e.g. 2026-10-07T00:00:00. Omit both start and end for the whole experiment."),
  end: z.string().optional().describe("ISO date-time without timezone, e.g. 2026-10-07T23:59:59."),
  visitorData: z.boolean().optional().describe("true counts unique visitors instead of visits (default false, like the results page)."),
  filters: z.array(z.record(z.any())).optional().describe("Raw Automation API filters, passed through unchanged, e.g. [{\"type\":\"DEVICE_TYPE\",\"values\":[\"PHONE\"],\"include\":true}]."),
  maxRowsPerVariation: z.number().optional().describe("Cap on breakdown rows returned per variation (default 200). Rows are sorted by key; the response says when it truncated.")
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

const CreateGoalSchema = z.object({
  siteId: z.number().describe("Kameleoon siteId of the project the goal belongs to (an experiment's siteId)."),
  name: z.string().describe("Goal name as it will appear in the app. Must not collide with an existing non-CUSTOM goal of the same name on the site."),
  description: z.string().optional().describe("Optional goal description."),
  hasMultipleConversions: z.boolean().optional().describe("Count every conversion instead of one per visit (default false)."),
  attachToExperimentIds: z.array(z.number()).optional().describe("Experiments to add the goal to. Appended to each experiment's existing goals — nothing is removed and mainGoalId is untouched.")
});

const CreateExperimentSchema = z.object({
  siteId: z.number().describe("Kameleoon siteId of the project to create the experiment in (from GET /sites or an existing experiment)."),
  name: z.string().describe("Experiment name as it will appear in the app."),
  baseURL: z.string().url().describe("URL loaded in the editor and in preview/simulation mode. For login goals use the storefront's /account/login (the sign-in page it redirects to has one-time params and no Kameleoon engine)."),
  type: z.enum(['DEVELOPER', 'CLASSIC']).optional().describe("DEVELOPER (default) is a code-editor experiment, which is what QA and all bridge work use. Pass CLASSIC only if the user explicitly asks for a graphic-editor experiment."),
  description: z.string().optional().describe("Optional experiment description."),
  goalIds: z.array(z.number()).optional().describe("Goals to attach after creation (appended, nothing removed). Must belong to the same site."),
  mainGoalId: z.number().optional().describe("Optional main goal. Must also be listed in goalIds."),
  updateExisting: z.boolean().optional().describe("When an experiment with this name already exists, set its baseURL (and type, if passed) to the requested values. Only allowed on DRAFT experiments; refused otherwise.")
});

const PushExperimentScriptSchema = z.object({
  experimentId: z.number().describe("Id of the experiment whose 'Experiment custom script' to write."),
  code: z.string().describe("JavaScript for the experiment custom script. Replaces the whole field."),
  overwrite: z.boolean().optional().describe("Acknowledge replacing a different non-empty experiment script. Required when one is already there."),
  confirmed: z.boolean().optional().describe("Required when the experiment is not a draft: the script runs for all its visitors as soon as Kameleoon loads, regardless of targeting. Only pass after the user said yes.")
});

export const kameleoonTools = [
  {
    name: "list_kameleoon_experiments",
    description: "Lists Kameleoon experiments via the Automation API, authenticated by the user's existing app.kameleoon.com browser session. Read-only. Use this to work out which experiment the local variation belongs to: rank candidates by (1) siteCode/baseURL host vs the CRO target tab's URL — by far the strongest signal, and the response includes targetTabUrl for exactly this — then (2) name similarity to the branch / .archive folder / what the user called the test, then (3) dateModified and status (active or draft beats stopped). Archived experiments are excluded by default and are never valid targets. Present the top candidate plus a couple of alternatives with name, id, status and baseURL, say why the top one won, and ask rather than guessing confidently when nothing scores well.",
    inputSchema: zodToJsonSchema(ListExperimentsSchema)
  },
  {
    name: "get_kameleoon_code",
    description: "Read-only. Returns the code a personalization or experiment actually runs, whatever editor produced it: graphic editor and Widget Studio contents compile to generatedJsCode/generatedCssCode, code editor and prompt contents live in jsCode/cssCode, redirects in redirection. Pass exactly one of personalizationId, experimentId or variationId. widgetTemplateInput holds the editor's positioning settings, which can disagree with the generated code — when they do, the generated code is what runs.",
    inputSchema: zodToJsonSchema(GetCodeSchema)
  },
  {
    name: "get_kameleoon_results",
    description: "Read-only. Fetches an experiment's results through the Automation API (POST /experiments/{id}/results, then polls GET /results?dataCode=) and returns a compact table per variation: visits, visitors, and per goal conversions, revenue, average cart, conversion rate, improvement rate and reliability. Use it to investigate a results page: an INTERVAL breakdown by DAY then HOUR finds revenue spikes and outliers, DEVICE_TYPE/BROWSER/COUNTRY breakdowns find segment effects. Numbers follow the API's timezone, which may differ from the app's display.",
    inputSchema: zodToJsonSchema(GetResultsSchema)
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
  },
  {
    name: "create_kameleoon_goal",
    description: "Creates a CUSTOM goal (converted from code with Kameleoon.API.Goals.processConversion(goalId)) via POST /goals, optionally attaching it to experiments by appending to their goals list. Idempotent by name: if a non-archived CUSTOM goal with the same name already exists on the site it is reused, not duplicated, so re-running after a restart is safe. Attaching edits the client's experiment, so confirm the goal names and target experiments with the user first. Returns the goal id and, per experiment, the goals list before/after.",
    inputSchema: zodToJsonSchema(CreateGoalSchema)
  },
  {
    name: "create_kameleoon_experiment",
    description: "Creates a DRAFT code-editor (DEVELOPER) experiment via POST /experiments (never sends a status, never launches, creates no variations), then optionally attaches goals. Idempotent by name: if a non-archived experiment with the same name already exists on the site it is reused, not duplicated — its baseURL/type are NOT changed unless updateExisting:true (drafts only), and the response says so. Confirm the site, name and baseURL with the user before calling. Returns the experiment id, status (verified DRAFT on read-back), baseURL, goals and an app link.",
    inputSchema: zodToJsonSchema(CreateExperimentSchema)
  },
  {
    name: "push_experiment_script",
    description: "Writes an experiment's 'Experiment custom script' — the API field is confusingly named globalScript on PATCH /experiments/{id}, but it is scoped to that one experiment. It NEVER touches the project-wide Global custom script (trackingScript on /sites/{id}); it reads that script before and after and errors if it changed. The experiment script runs before experiment/variation code and regardless of targeting. Refuses to replace a different existing script without overwrite:true, and to write a non-draft experiment without confirmed:true. Verifies by read-back.",
    inputSchema: zodToJsonSchema(PushExperimentScriptSchema)
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

// Every content type shares one variation schema; only which of these fields is filled differs.
const CODE_FIELDS = ['jsCode', 'cssCode', 'generatedJsCode', 'generatedCssCode'];
const CAMPAIGN_CODE_FIELDS = ['globalScript', 'commonJavaScriptCode', 'commonCssCode'];

function isBlank(value) {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function truncateCode(value, maxChars) {
  if (value.length <= maxChars) return { code: value, length: value.length };
  return { code: value.slice(0, maxChars), length: value.length, truncated: true };
}

function describeSource(variation) {
  const hasHandCode = !isBlank(variation.jsCode) || !isBlank(variation.cssCode);
  const hasGenerated = !isBlank(variation.generatedJsCode) || !isBlank(variation.generatedCssCode);
  if (!isBlank(variation.redirection)) return 'redirect';
  if (variation.creationMode === 'WIDGET') return 'widget';
  if (variation.aiBuilder && hasHandCode) return 'prompt';
  if (hasHandCode && hasGenerated) return 'graphic editor + code editor';
  if (hasHandCode) return 'code editor';
  if (hasGenerated) return 'graphic editor';
  return 'empty';
}

function slimVariationCode(variation, maxChars) {
  const code = {};
  for (const field of CODE_FIELDS) {
    if (!isBlank(variation[field])) code[field] = truncateCode(variation[field], maxChars);
  }
  const out = {
    id: variation.id,
    name: variation.name,
    source: describeSource(variation),
    creationMode: variation.creationMode,
    aiBuilder: variation.aiBuilder || false,
    shadowDom: variation.shadowDom,
    isJsCodeAfterDomReady: variation.isJsCodeAfterDomReady,
    code
  };
  if (!isBlank(variation.redirection)) {
    out.redirection = variation.redirection;
    out.redirectionStrings = variation.redirectionStrings;
  }
  if (variation.widgetTemplateInput) out.widgetTemplateInput = variation.widgetTemplateInput;
  return out;
}

async function getCode(args) {
  const given = ['personalizationId', 'experimentId', 'variationId'].filter(k => args[k] != null);
  if (given.length !== 1) throw new Error('Pass exactly one of personalizationId, experimentId or variationId.');
  const maxChars = args.maxCodeChars || 20000;

  if (args.variationId != null) {
    const { data } = await apiRequest('GET', `/variations/${args.variationId}`);
    return { variations: [slimVariationCode(data, maxChars)] };
  }

  const isPersonalization = args.personalizationId != null;
  const id = isPersonalization ? args.personalizationId : args.experimentId;
  const { data: campaign } = await apiRequest('GET', `/${isPersonalization ? 'personalizations' : 'experiments'}/${id}`);
  const variationIds = (isPersonalization ? campaign.variationIds : campaign.variations) || [];

  const variations = [];
  for (const variationId of variationIds) {
    const { data } = await apiRequest('GET', `/variations/${variationId}`);
    variations.push(slimVariationCode(data, maxChars));
  }

  const campaignCode = {};
  for (const field of CAMPAIGN_CODE_FIELDS) {
    if (!isBlank(campaign[field])) campaignCode[field] = truncateCode(campaign[field], maxChars);
  }

  return {
    kind: isPersonalization ? 'personalization' : 'experiment',
    id: campaign.id,
    name: campaign.name,
    type: campaign.type,
    status: campaign.status,
    siteId: campaign.siteId,
    baseURL: campaign.baseURL,
    campaignCode,
    variations
  };
}

const RESULT_GOAL_FIELDS = ['conversionCount', 'convertedVisitCount', 'revenueCount', 'averageCart', 'conversionRate', 'improvementRate', 'reliability'];

function slimResultRow(generalData, goalNames) {
  const goals = {};
  for (const [goalId, g] of Object.entries(generalData.goalsData || {})) {
    const row = { name: goalNames[goalId] };
    for (const field of RESULT_GOAL_FIELDS) {
      if (g[field] != null) row[field] = g[field];
    }
    goals[goalId] = row;
  }
  return { visits: generalData.visitCount, visitors: generalData.visitorCount, goals };
}

async function getResults(args) {
  const { data: experiment } = await apiRequest('GET', `/experiments/${args.experimentId}?optionalFields=goals`);
  const goalIds = args.goalIds || experiment.goals || null;

  const goalNames = {};
  for (const goalId of goalIds || []) {
    try {
      goalNames[goalId] = (await apiRequest('GET', `/goals/${goalId}`)).data.name;
    } catch {
      goalNames[goalId] = null;
    }
  }

  const variationNames = {};
  for (const variationId of experiment.variations || []) {
    try {
      variationNames[variationId] = (await apiRequest('GET', `/variations/${variationId}`)).data.name;
    } catch {
      variationNames[variationId] = null;
    }
  }

  const body = {
    goalsIds: goalIds,
    referenceVariationId: '0',
    visitorData: args.visitorData ?? false,
    conversionType: 'ALL_CONVERSION',
    ...(args.breakdown ? { breakdown: args.breakdown } : {}),
    ...(args.filters ? { filters: args.filters } : {}),
    ...(args.start || args.end ? { dateIntervals: [{ start: args.start, end: args.end }] } : {})
  };
  // POST only asks Kameleoon to compute a report; nothing on the experiment changes.
  const { data: requested } = await apiRequest('POST', `/experiments/${args.experimentId}/results`, body, 30000);
  const dataCode = requested && requested.dataCode;
  if (!dataCode) throw new Error(`POST /experiments/${args.experimentId}/results returned no dataCode: ${JSON.stringify(requested)}`);

  let report;
  for (let attempt = 0; attempt < 30; attempt++) {
    report = (await apiRequest('GET', `/results?dataCode=${dataCode}`, null, 30000)).data;
    if (report && report.status === 'READY') break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (!report || report.status !== 'READY') throw new Error(`Results for experiment ${args.experimentId} were still ${report ? report.status : 'missing'} after 60s. Retry, or narrow the request.`);

  const maxRows = args.maxRowsPerVariation || 200;
  const variations = {};
  let truncated = false;
  for (const [variationId, variationData] of Object.entries(report.data.variationData || {})) {
    const rows = Object.entries(variationData.breakdownData || {}).sort(([a], [b]) => a.localeCompare(b));
    if (rows.length > maxRows) truncated = true;
    const breakdown = {};
    for (const [key, value] of rows.slice(0, maxRows)) {
      breakdown[key] = slimResultRow(value.generalData || {}, goalNames);
    }
    variations[variationId] = { name: variationNames[variationId] ?? (variationId === '_reference' ? 'Original' : null), breakdown };
  }

  return {
    experimentId: experiment.id,
    experimentName: experiment.name,
    type: experiment.type,
    status: experiment.status,
    dateStarted: experiment.dateStarted,
    mainGoalId: experiment.mainGoalId,
    request: body,
    breakdownKeyNote: args.breakdown ? undefined : 'No breakdown requested: each variation has a single "_reference" row holding its totals.',
    truncated: truncated ? `Some variations had more than ${maxRows} breakdown rows; raise maxRowsPerVariation or narrow start/end.` : undefined,
    variations
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

export async function pushVariationCode(args) {
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

async function attachGoal(experimentId, goalId) {
  const { data: experiment } = await apiRequest('GET', `/experiments/${experimentId}?optionalFields=goals`);
  if (!experiment) throw new Error(`Experiment ${experimentId} not found`);
  if (experiment.isArchived) throw new Error(`Experiment ${experimentId} ("${experiment.name}") is archived — refusing to attach a goal to it.`);

  const before = Array.isArray(experiment.goals) ? [...experiment.goals] : [];
  if (before.includes(goalId)) {
    return { experimentId, experimentName: experiment.name, attached: false, note: 'already attached', goals: before };
  }

  // PATCH replaces the whole goals list, so send everything already there plus the new one.
  const after = [...before, goalId];
  await apiRequest('PATCH', `/experiments/${experimentId}`, { goals: after });

  const { data: readBack } = await apiRequest('GET', `/experiments/${experimentId}?optionalFields=goals`);
  const readBackGoals = (readBack && readBack.goals) || [];
  return {
    experimentId,
    experimentName: experiment.name,
    attached: readBackGoals.includes(goalId),
    lostGoals: before.filter(id => !readBackGoals.includes(id)),
    before,
    after: readBackGoals
  };
}

async function createGoal(args) {
  const filter = [
    { field: 'siteId', operator: 'EQUAL', parameters: [args.siteId] },
    { field: 'name', operator: 'EQUAL', parameters: [args.name] }
  ];
  const { data: sameName } = await apiRequest('GET', `/goals${buildQuery({ perPage: 50, filter })}`);
  const matches = (Array.isArray(sameName) ? sameName : []).filter(g => g.name === args.name && !g.isArchived);

  const clash = matches.find(g => g.type !== 'CUSTOM');
  if (clash) {
    throw new Error(`A ${clash.type} goal named "${args.name}" already exists on site ${args.siteId} (id ${clash.id}). Pick a different name so the two are distinguishable in results.`);
  }

  let goal = matches[0];
  const created = !goal;
  if (created) {
    const { data } = await apiRequest('POST', '/goals', {
      name: args.name,
      siteId: args.siteId,
      type: 'CUSTOM',
      hasMultipleConversions: args.hasMultipleConversions ?? false,
      status: 'ACTIVE',
      ...(args.description ? { description: args.description } : {})
    });
    goal = data;
    if (!goal || !goal.id) throw new Error(`POST /goals returned no id: ${JSON.stringify(data)}`);
  }

  // Sequential on purpose: each attach is a read-modify-write of one experiment.
  const attachments = [];
  for (const experimentId of args.attachToExperimentIds || []) {
    try {
      attachments.push(await attachGoal(experimentId, goal.id));
    } catch (err) {
      attachments.push({ experimentId, attached: false, error: err.message });
    }
  }

  return {
    goalId: goal.id,
    name: goal.name,
    type: goal.type,
    hasMultipleConversions: goal.hasMultipleConversions,
    created,
    note: created ? undefined : 'An existing CUSTOM goal with this name was reused.',
    attachments,
    usage: `Kameleoon.API.Goals.processConversion(${goal.id});`
  };
}

async function createExperiment(args) {
  if (args.mainGoalId != null && !(args.goalIds || []).includes(args.mainGoalId)) {
    throw new Error(`mainGoalId ${args.mainGoalId} must also be listed in goalIds.`);
  }

  const { data: sites } = await apiRequest(
    'GET',
    `/sites${buildQuery({ perPage: 50, filter: [{ field: 'id', operator: 'EQUAL', parameters: [args.siteId] }] })}`
  );
  const site = Array.isArray(sites) ? sites.find(s => s.id === args.siteId) : null;
  if (!site) throw new Error(`No site with id ${args.siteId} in this account. Check the account you are impersonating.`);

  const filter = [
    { field: 'siteId', operator: 'EQUAL', parameters: [args.siteId] },
    { field: 'name', operator: 'EQUAL', parameters: [args.name] }
  ];
  const { data: sameName } = await apiRequest('GET', `/experiments${buildQuery({ perPage: 50, filter })}`, null, 30000);
  let experiment = (Array.isArray(sameName) ? sameName : []).find(e => e.name === args.name && !e.isArchived);
  const created = !experiment;

  let updated;
  if (!created && args.updateExisting) {
    if (String(experiment.status).toUpperCase() !== 'DRAFT') {
      throw new Error(`Experiment ${experiment.id} ("${experiment.name}") is ${experiment.status}, not a draft — refusing to change its baseURL/type. Edit it in the app if that is really intended.`);
    }
    const patch = {};
    if (experiment.baseURL !== args.baseURL) patch.baseURL = args.baseURL;
    if (args.type && experiment.type !== args.type) patch.type = args.type;
    if (Object.keys(patch).length) {
      await apiRequest('PATCH', `/experiments/${experiment.id}`, patch);
      updated = { before: { baseURL: experiment.baseURL, type: experiment.type }, requested: patch };
    }
  }

  if (created) {
    // No status field on purpose: the API defaults a new experiment to DRAFT.
    const { data } = await apiRequest('POST', '/experiments', {
      name: args.name,
      siteId: site.id,
      siteCode: site.code,
      baseURL: args.baseURL,
      type: args.type || 'DEVELOPER',
      ...(args.description ? { description: args.description } : {})
    });
    if (!data || !data.id) throw new Error(`POST /experiments returned no id: ${JSON.stringify(data)}`);
    experiment = data;
  }

  // Sequential on purpose: each attach is a read-modify-write of the experiment.
  const attachments = [];
  for (const goalId of args.goalIds || []) {
    try {
      attachments.push(await attachGoal(experiment.id, goalId));
    } catch (err) {
      attachments.push({ goalId, attached: false, error: err.message });
    }
  }
  if (args.mainGoalId != null) {
    await apiRequest('PATCH', `/experiments/${experiment.id}`, { mainGoalId: args.mainGoalId });
  }

  const { data: readBack, appTabUrl } = await apiRequest('GET', `/experiments/${experiment.id}?optionalFields=goals`);
  const warnings = [];
  if (String(readBack.status).toUpperCase() !== 'DRAFT') warnings.push(`Status is ${readBack.status}, not DRAFT — check the experiment in the app before doing anything else with it.`);
  if (!created && readBack.baseURL !== args.baseURL) warnings.push(`Reused an existing experiment whose baseURL is ${readBack.baseURL}; the requested ${args.baseURL} was NOT applied${args.updateExisting ? '' : ' (pass updateExisting:true to change it)'}.`);
  if (updated && updated.requested.type && readBack.type !== updated.requested.type) warnings.push(`type change to ${updated.requested.type} did not stick — the experiment is still ${readBack.type}. The API may not allow changing type after creation.`);
  if (created && readBack.baseURL !== args.baseURL) warnings.push(`Read-back baseURL ${readBack.baseURL} differs from the requested ${args.baseURL}.`);

  return {
    experimentId: readBack.id,
    name: readBack.name,
    siteId: readBack.siteId,
    siteCode: readBack.siteCode,
    status: readBack.status,
    type: readBack.type,
    baseURL: readBack.baseURL,
    goals: readBack.goals || [],
    mainGoalId: readBack.mainGoalId ?? null,
    created,
    note: created ? undefined : 'An existing experiment with this name was reused.',
    updated,
    attachments,
    warnings: warnings.length ? warnings : undefined,
    experimentUrl: deriveExperimentUrl(appTabUrl, readBack.id)
  };
}

async function pushExperimentScript(args) {
  const { data: experiment, appTabUrl } = await apiRequest('GET', `/experiments/${args.experimentId}?optionalFields=globalScript`);
  if (!experiment) throw new Error(`Experiment ${args.experimentId} not found`);
  if (experiment.isArchived) throw new Error(`Experiment ${args.experimentId} ("${experiment.name}") is archived — refusing to write its script.`);
  const isDraft = String(experiment.status).toUpperCase() === 'DRAFT';
  if (!isDraft && args.confirmed !== true) {
    throw new Error(`Experiment ${args.experimentId} ("${experiment.name}") is ${experiment.status}, not a draft. Its custom script would run for every visitor as soon as Kameleoon loads. Get an explicit yes from the user, then re-run with confirmed:true.`);
  }

  const existing = experiment.globalScript || '';
  if (existing && existing !== args.code && !args.overwrite) {
    throw new Error(`Experiment ${args.experimentId} already has a ${existing.length}-char custom script that differs from this one. Show the user what would be replaced and re-run with overwrite:true if they approve.`);
  }

  // Snapshot the project-wide script so we can prove it was not touched.
  const siteScript = async () => {
    const { data: site } = await apiRequest('GET', `/sites/${experiment.siteId}`);
    return site ? site.trackingScript ?? null : null;
  };
  const siteBefore = await siteScript();

  await apiRequest('PATCH', `/experiments/${args.experimentId}`, { globalScript: args.code });

  const { data: readBack } = await apiRequest('GET', `/experiments/${args.experimentId}?optionalFields=globalScript`);
  const siteAfter = await siteScript();
  if (siteAfter !== siteBefore) {
    throw new Error(`The project-wide Global custom script of site ${experiment.siteId} CHANGED during this call (before ${String(siteBefore).length} chars, after ${String(siteAfter).length}). This tool never writes it — check the site's global script in the app immediately.`);
  }

  const verified = readBack && readBack.globalScript === args.code;
  return {
    experimentId: args.experimentId,
    experimentName: experiment.name,
    status: experiment.status,
    field: 'globalScript (Experiment custom script)',
    bytes: args.code.length,
    replaced: existing ? existing.length : 0,
    verified,
    siteGlobalScriptUnchanged: true,
    warning: verified ? undefined : 'Read-back did not match what was sent — inspect the experiment in the app before relying on it.',
    experimentUrl: deriveExperimentUrl(appTabUrl, args.experimentId)
  };
}

/** Returns a tool result, or null if the name is not one of ours. */
export async function handleKameleoonTool(name, rawArgs) {
  const run = async () => {
    if (name === 'list_kameleoon_experiments') return listExperiments(ListExperimentsSchema.parse(rawArgs || {}));
    if (name === 'get_kameleoon_code') return getCode(GetCodeSchema.parse(rawArgs || {}));
    if (name === 'get_kameleoon_results') return getResults(GetResultsSchema.parse(rawArgs || {}));
    if (name === 'create_kameleoon_variation') return createVariation(CreateVariationSchema.parse(rawArgs || {}));
    if (name === 'push_variation_code') return pushVariationCode(PushVariationCodeSchema.parse(rawArgs || {}));
    if (name === 'create_kameleoon_goal') return createGoal(CreateGoalSchema.parse(rawArgs || {}));
    if (name === 'create_kameleoon_experiment') return createExperiment(CreateExperimentSchema.parse(rawArgs || {}));
    if (name === 'push_experiment_script') return pushExperimentScript(PushExperimentScriptSchema.parse(rawArgs || {}));
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
