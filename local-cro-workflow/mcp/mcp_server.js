import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { kameleoonTools, handleKameleoonTool } from "./kameleoon_push.js";
import { kameleoonQaTools, handleKameleoonQaTool } from "./kameleoon_qa.js";
import { hubspotTicketTools, handleHubspotTicketTool } from "./hubspot_ticket.js";
import { evaluateJs, clickElement, pressKey, toggleSimulation, broadcast, captureScreenshot, readMutationLog, clearMutationLog, listTabs, activateTab, getStatus, openUrl, setViewport, emulateNetwork, clearEmulation, reloadPage, setExtensionEnabled, readResponseHeaders, captureLifecycleTimeline } from "../daemon/server.js";

const server = new Server(
  {
    name: "local-cro-workflow",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const EvaluateJsSchema = z.object({
  code: z.string().describe("JavaScript code to evaluate in the targeted browser tab"),
  tabId: z.number().optional().describe("Optional tab ID to target"),
  timeoutMs: z.number().optional().describe("Timeout for evaluation in ms"),
});

const ClickElementSchema = z.object({
  selector: z.string().describe("CSS selector for the element to click"),
  offsetX: z.number().optional().describe("Horizontal offset in px from the element's center (default 0)"),
  offsetY: z.number().optional().describe("Vertical offset in px from the element's center (default 0)"),
  tabId: z.number().optional().describe("Optional tab ID to target"),
  timeoutMs: z.number().optional().describe("Timeout for the click in ms"),
});

const PressKeySchema = z.object({
  key: z.string().describe("Key to press: Tab, Enter, Escape, Space, Backspace, ArrowUp/Down/Left/Right, Home, End, or a single character"),
  shift: z.boolean().optional().describe("Hold Shift (e.g. Shift+Tab to move focus backwards)"),
  times: z.number().optional().describe("Number of presses, 1-50 (default 1); focus is recorded after each one"),
  delayMs: z.number().optional().describe("Wait between presses in ms, so the site can react (default 150)"),
  tabId: z.number().optional().describe("Optional tab ID to target"),
  timeoutMs: z.number().optional().describe("Timeout for the whole call in ms (default 15000)"),
});

const InjectCodeSchema = z.object({
  type: z.enum(["javascript", "css"]).describe("Code type to inject"),
  content: z.string().describe("The raw code (JS or CSS) to inject into the active tab"),
  tabId: z.number().optional().describe("Optional tab ID to target"),
});

const ToggleSimulationSchema = z.object({
  enable: z.boolean().describe("Whether to enable or disable Kameleoon simulation"),
  parameters: z.record(z.any()).optional().describe("Custom Kameleoon simulation parameters configuration"),
});

const ReloadPageSchema = z.object({
  tabId: z.number().optional().describe("Optional tab ID to target"),
});
const OpenUrlSchema = z.object({
  url: z.string().describe("The URL to open in a new tab"),
  setTarget: z.boolean().optional().describe("Pin the new tab as the bridge's target (default true). Pass false to open a side tab without retargeting"),
  timeoutMs: z.number().optional().describe("Timeout for opening the URL in ms"),
});

const ReadDomSchema = z.object({
  selector: z.string().optional().describe("Optional CSS selector to target specific DOM element instead of document body"),
  tabId: z.number().optional().describe("Optional tab ID to target"),
});

const HighlightElementSchema = z.object({
  selector: z.string().describe("CSS selector for the element(s) to highlight"),
  color: z.string().optional().describe("Highlight color (default: 'red')"),
  durationMs: z.number().optional().describe("Duration of highlight in ms (default: 2000)"),
  tabId: z.number().optional().describe("Optional tab ID to target"),
});

const CaptureScreenshotSchema = z.object({
  tabId: z.number().optional().describe("Optional tab ID to target"),
});

const ReadMutationLogSchema = z.object({
  delayMs: z.number().optional().describe("Optional delay in ms before reading the log (e.g. 2000 to wait for page load mutations)"),
  tabId: z.number().optional().describe("Optional tab ID to target"),
});
const ClearMutationLogSchema = z.object({});

const GetFrameworkStatusSchema = z.object({});
const GetKameleoonStateSchema = z.object({});

const WatchSelectorSchema = z.object({
  selector: z.string().describe("CSS selector to watch for mutations"),
  durationMs: z.number().optional().describe("Duration to watch in ms (default 5000)"),
}).strict();

const ReadNetworkLogSchema = z.object({
  urlFilter: z.string().optional().describe("Optional substring to filter URLs (e.g. 'kameleoon')"),
});

const ReadConsoleLogsSchema = z.object({
  clearLogs: z.boolean().optional().describe("Whether to clear the console logs after fetching"),
});

const GetInterestingElementsSchema = z.object({
  includeButtons: z.boolean().optional().default(true),
  includeLinks: z.boolean().optional().default(true),
  includeHeadings: z.boolean().optional().default(true),
  includeInputs: z.boolean().optional().default(true),
});

const GetUniqueSelectorSchema = z.object({
  query: z.string().describe("Text content or partial selector to identify the element."),
  preferDataTestId: z.boolean().optional().default(true).describe("Whether to prefer data-testid attributes if available."),
});

const GetElementContextSchema = z.object({
  selector: z.string().describe("CSS selector for the element to inspect."),
  depth: z.number().optional().default(2).describe("How many levels of parents/children to include."),
});

const VerifyCssSupportSchema = z.object({
  feature: z.string().describe("CSS feature or selector to check support for (e.g., ':has()', 'container-type')."),
});

const FindSelectorByTextSchema = z.object({
  query: z.string().describe("The exact or partial text to search for (case-insensitive, ignores extra whitespace)."),
  context: z.string().optional().describe("Optional CSS selector to scope the search (e.g. '.header')."),
});

const CaptureElementScreenshotSchema = z.object({
  selector: z.string().describe("CSS selector for the element to capture."),
});

const SetViewportSchema = z.object({
  width: z.number().describe("Viewport width in pixels"),
  height: z.number().describe("Viewport height in pixels"),
  mobile: z.boolean().optional().default(false).describe("Whether to emulate a mobile device"),
  tabId: z.number().optional().describe("Optional tab ID to target"),
});

const EmulateDeviceSchema = z.object({
  device: z.enum(["iPhone 14", "iPhone SE", "Pixel 7", "iPad Air", "Desktop (1440p)", "Desktop (1080p)"]).describe("Predefined device to emulate"),
  tabId: z.number().optional().describe("Optional tab ID to target"),
});

const EmulateNetworkSchema = z.object({
  type: z.enum(["Slow 3G", "Fast 3G", "4G", "Offline", "No Throttling"]).describe("Predefined network conditions"),
  tabId: z.number().optional().describe("Optional tab ID to target"),
});

const ClearEmulationSchema = z.object({
  tabId: z.number().optional().describe("Optional tab ID to target"),
});

const SetExtensionEnabledSchema = z.object({
  enabled: z.boolean().describe("Whether to enable or disable the connected Chrome extension(s)"),
});

const ReadResponseHeadersSchema = z.object({
  url: z.string().optional().describe("URL to capture headers for. Defaults to the current tab's URL. A reload (or iframe load) is triggered to capture the live navigation response."),
  tabId: z.number().optional().describe("Optional tab ID to target. Defaults to the configured target tab or the active tab."),
  requestContext: z.enum(["top-level", "iframe"]).optional().default("top-level").describe("Request context. 'top-level' reloads the page normally. 'iframe' loads the URL inside a hidden iframe so the browser sends Sec-Fetch-Dest: iframe — useful when servers return different headers (e.g. X-Frame-Options, CSP frame-ancestors) based on embedding context."),
  includeSubresources: z.boolean().optional().default(false).describe("If true, also captures response headers for sub-resources (scripts, stylesheets, XHR, etc.) loaded during the navigation, not just the main document."),
  urlFilter: z.string().optional().describe("Substring filter applied when includeSubresources is true. Only responses whose URL contains this string are returned."),
  timeoutMs: z.number().optional().describe("How long to wait for the response (default 15000ms). Increase for slow pages."),
});

// Default probe set tuned to the driving use case: when does the Kameleoon engine
// appear, when does legal consent resolve, and when is the visitor-code cookie written.
// NOTE: consent is Kameleoon.API.Visitor.experimentLegalConsent (a Visitor property,
// kameleoon.d.ts:449) — NOT custom data.
const DEFAULT_LIFECYCLE_EXPRESSIONS = [
  "typeof window.Kameleoon",
  "window.Kameleoon && window.Kameleoon.API && window.Kameleoon.API.Visitor && window.Kameleoon.API.Visitor.code",
  "window.Kameleoon && window.Kameleoon.API && window.Kameleoon.API.Visitor && window.Kameleoon.API.Visitor.experimentLegalConsent",
  "document.cookie.indexOf('kameleoonVisitorCode') !== -1",
  "document.readyState",
];

const CaptureLifecycleTimelineSchema = z.object({
  expressions: z.array(z.string()).optional().describe("Read-only JS expressions sampled on an interval across the load. MUST be side-effect-free. Defaults to a Kameleoon consent/visitor-code probe set when omitted."),
  hooks: z.object({
    cookies: z.boolean().optional().describe("Timestamp each document.cookie write (default true)."),
    storage: z.boolean().optional().describe("Timestamp each localStorage/sessionStorage setItem (default true)."),
    globals: z.array(z.string()).optional().describe("Global names to timestamp on first appearance, e.g. ['Kameleoon']."),
    events: z.array(z.string()).optional().describe("window/document event names to timestamp, e.g. ['Kameleoon::consent']."),
  }).optional().describe("Load-lifecycle hooks. Defaults to cookies+storage on with globals:['Kameleoon']."),
  sampleIntervalMs: z.number().optional().describe("Sampling interval in ms (default 50)."),
  maxDurationMs: z.number().optional().describe("Hard stop for the capture window in ms (default 8000). Must exceed the moment you care about (consent fires ~2s)."),
  freshVisitor: z.boolean().optional().describe("Clear ALL client-side state for the target origin BEFORE arming — cookies (origin + registrable domain), localStorage, sessionStorage, IndexedDB, CacheStorage, service workers, and Web SQL — to land as close as possible to the browser state of a brand-new visitor. Without this a returning visitor reuses existing cookies/storage and no persistence gap is visible. The __kmLifecycle* arm/buffer keys are preserved. Default false."),
  selfReload: z.object({
    count: z.number().optional().describe("Number of pre-consent reloads to force (hard-capped at 3)."),
    atMs: z.number().optional().describe("When in the pre-consent window to reload, in ms (default 1000)."),
  }).optional().describe("Demo-only: makes the recorder reload itself during the pre-consent window to show a fresh visitor code being generated and discarded each load. Not needed to prove the mechanism; omit for the correctness capture."),
  maxEvents: z.number().optional().describe("Cap on returned cookie/storage/event records (default 200). Beyond this the list is truncated and `eventsSummary` reports the full counts by kind and key."),
  eventFilter: z.string().optional().describe("Substring filter applied to each event's name/key before the cap. Use it to keep only the writes you care about (e.g. 'kameleoon')."),
  tabId: z.number().optional().describe("Optional tab ID to target."),
}).strict();

// Layout over time: samples geometry on an interval WITHOUT reloading, optionally driving
// scroll. capture_lifecycle_timeline can only describe a load; this describes what happens
// after one, which is where interaction-triggered layout bugs live.
// A tool result that cannot be read is a tool that did not run: one unfiltered capture in
// this session returned 109,586 characters and was rejected for exceeding the token limit.
const capLifecycleEvents = (result, maxEvents, eventFilter) => {
  if (!result || !Array.isArray(result.events)) return result;
  const cap = maxEvents != null ? Math.max(0, maxEvents) : 200;
  const label = (e) => e.name || e.key || e.value || "";
  let events = result.events;
  const beforeFilter = events.length;
  if (eventFilter) {
    const needle = eventFilter.toLowerCase();
    events = events.filter((e) => label(e).toLowerCase().includes(needle));
  }
  const byKind = {};
  for (const e of events) {
    const k = e.kind || "unknown";
    byKind[k] = (byKind[k] || 0) + 1;
  }
  const topKeys = {};
  for (const e of events) {
    const key = (e.kind || "unknown") + ":" + label(e);
    topKeys[key] = (topKeys[key] || 0) + 1;
  }
  const noisiest = Object.entries(topKeys).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, count]) => ({ key, count }));
  const kept = events.slice(0, cap);
  return {
    ...result,
    events: kept,
    eventsSummary: {
      total: beforeFilter,
      matchedFilter: eventFilter ? events.length : undefined,
      returned: kept.length,
      omitted: events.length - kept.length,
      truncated: events.length > kept.length,
      byKind,
      noisiest,
    },
  };
};

const WatchLayoutSchema = z.object({
  selectors: z.array(z.string()).optional().describe("Elements to measure. Per sample, the first match's height, document-relative top, computed display, and the match count."),
  expressions: z.array(z.string()).optional().describe("Extra read-only JS expressions sampled alongside the geometry. MUST be side-effect-free."),
  durationMs: z.number().optional().describe("How long to sample for (default 5000, hard cap 30000)."),
  sampleIntervalMs: z.number().optional().describe("Sampling interval in ms (default 100, floor 16)."),
  scroll: z.object({
    to: z.array(z.number()).optional().describe("scrollY offsets to visit in order, e.g. [0, 1200, 2400, 0]."),
    stepMs: z.number().optional().describe("Dwell per offset in ms (default 250)."),
    repeat: z.number().optional().describe("Cycles through `to` (default 1, cap 10)."),
  }).strict().optional().describe("Omit to observe passively and drive nothing."),
  includeAllSamples: z.boolean().optional().describe("Return the raw sample series instead of change-only output (default false)."),
  focusTab: z.boolean().optional().describe("Activate the target tab before sampling (default true). Chrome clamps timers to ~1s and stops firing requestAnimationFrame in a background tab, so sampling a hidden tab silently samples at 1Hz."),
  tabId: z.number().optional().describe("Optional tab ID to target."),
}).strict();

// Unknown keys are a loud error, not a silent default: capture_lifecycle_timeline accepting
// `selectors` (a key it does not define) and sampling its defaults instead sent a real
// diagnosis down the wrong path for several turns.
const parseArgs = (schema, args, toolName) => {
  const result = schema.safeParse(args || {});
  if (result.success) return result.data;
  const unknown = result.error.issues
    .filter((i) => i.code === "unrecognized_keys")
    .flatMap((i) => i.keys);
  if (unknown.length) {
    const valid = Object.keys(schema.shape || {}).join(", ");
    throw new Error(`${toolName}: unknown parameter(s) ${unknown.join(", ")}. Valid parameters: ${valid}.`);
  }
  throw new Error(`${toolName}: ${result.error.issues.map((i) => `${i.path.join(".") || "(root)"} — ${i.message}`).join("; ")}`);
};

const buildWatchLayoutScript = (spec) => `(function() {
  return new Promise((resolve) => {
    const SPEC = ${JSON.stringify(spec)};
    const sels = SPEC.selectors || [];
    const exprSrcs = SPEC.expressions || [];
    const t0 = performance.now();
    const originalY = window.scrollY;
    const viewport = window.innerHeight;
    const samples = [];
    const exprErrors = {};
    let requestedY = null;
    let finished = false;

    const compiled = exprSrcs.map((src) => {
      try { return { src: src, fn: new Function('return (' + src + ')') }; }
      catch (e) { exprErrors[src] = 'compile: ' + e.message; return { src: src, fn: null }; }
    });

    const measure = (sel) => {
      let nodes;
      try { nodes = document.querySelectorAll(sel); }
      catch (e) { return { count: 0, error: 'invalid selector: ' + e.message }; }
      if (!nodes.length) return { count: 0, height: null, top: null, display: null };
      const el = nodes[0];
      const r = el.getBoundingClientRect();
      let display = null;
      try { display = getComputedStyle(el).display; } catch (e) {}
      return { count: nodes.length, height: Math.round(r.height), top: Math.round(r.top + window.scrollY), display: display };
    };

    const takeSample = () => {
      if (finished) return;
      const s = {
        t: Math.round(performance.now() - t0),
        docH: document.documentElement.scrollHeight,
        scrollY: Math.round(window.scrollY)
      };
      if (document.visibilityState !== 'visible') s.hidden = true;
      if (requestedY !== null) s.requestedY = requestedY;
      if (sels.length) {
        s.selectors = {};
        for (const sel of sels) s.selectors[sel] = measure(sel);
      }
      if (compiled.length) {
        s.expressions = {};
        for (const c of compiled) {
          if (!c.fn) { s.expressions[c.src] = null; continue; }
          try {
            const v = c.fn();
            s.expressions[c.src] = (v !== null && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
          } catch (e) {
            if (!exprErrors[c.src]) exprErrors[c.src] = e.message;
            s.expressions[c.src] = null;
          }
        }
      }
      samples.push(s);
    };

    const scrollTimers = [];
    if (SPEC.scroll && SPEC.scroll.to && SPEC.scroll.to.length) {
      const queue = [];
      for (let r = 0; r < SPEC.scroll.repeat; r++) queue.push.apply(queue, SPEC.scroll.to);
      queue.forEach((offset, i) => {
        scrollTimers.push(setTimeout(() => {
          if (finished) return;
          requestedY = offset;
          // behavior:'instant' overrides a site's CSS scroll-behavior:smooth, which would
          // otherwise read as a huge clamp on the next-frame sample.
          try { window.scrollTo({ top: offset, left: 0, behavior: 'instant' }); }
          catch (e) { window.scrollTo(0, offset); }
          takeSample();
          requestAnimationFrame(takeSample);
        }, i * SPEC.scroll.stepMs));
      });
    }

    takeSample();
    const ticker = setInterval(takeSample, SPEC.sampleIntervalMs);

    setTimeout(() => {
      takeSample();
      finished = true;
      clearInterval(ticker);
      scrollTimers.forEach(clearTimeout);
      try { window.scrollTo({ top: originalY, left: 0, behavior: 'instant' }); }
      catch (e) { window.scrollTo(0, originalY); }
      resolve(JSON.stringify({
        samples: samples,
        viewport: viewport,
        originalScrollY: Math.round(originalY),
        visibility: document.visibilityState,
        expressionErrors: Object.keys(exprErrors).map((k) => ({ expression: k, message: exprErrors[k] }))
      }));
    }, SPEC.durationMs);
  });
})();`;

// Everything below turns the raw series into the change-only report. Kept in Node so the
// in-page sampler stays a pure reader.
const summarizeLayoutSamples = (raw, spec) => {
  const samples = raw.samples || [];
  const sels = spec.selectors || [];
  const exprs = spec.expressions || [];

  // scrollY is deliberately NOT a tracked value: when driving scroll it changes every
  // sample, which would make every sample a "transition" and defeat change-only output.
  const trackedKey = (s) => JSON.stringify([
    s.docH,
    sels.map((sel) => {
      const m = (s.selectors || {})[sel] || {};
      return [m.count, m.height, m.display];
    }),
    exprs.map((e) => (s.expressions || {})[e]),
  ]);

  const transitions = [];
  let lastKey = null;
  samples.forEach((s, i) => {
    const key = trackedKey(s);
    if (i === 0 || i === samples.length - 1 || key !== lastKey) {
      const t = { t: s.t, docH: s.docH, scrollY: s.scrollY };
      if (s.requestedY !== undefined) t.requestedY = s.requestedY;
      if (s.selectors) t.selectors = s.selectors;
      if (s.expressions) t.expressions = s.expressions;
      transitions.push(t);
    }
    lastKey = key;
  });

  const clamps = [];
  let lastClampKey = null;
  for (const s of samples) {
    if (s.requestedY === undefined) continue;
    const lost = s.requestedY - s.scrollY;
    if (lost <= 2) continue;
    const key = s.requestedY + ":" + s.scrollY;
    if (key === lastClampKey) continue;
    lastClampKey = key;
    clamps.push({ t: s.t, requestedY: s.requestedY, actualY: s.scrollY, lostPx: lost, docH: s.docH });
  }

  const heights = samples.map((s) => s.docH);
  const docH = heights.length
    ? { min: Math.min(...heights), max: Math.max(...heights), first: heights[0], last: heights[heights.length - 1] }
    : { min: null, max: null, first: null, last: null };

  // Largest peak-to-trough drop, not first-to-last: a section that collapses and is
  // re-added still clamped the scroll on the way down.
  let runningMax = -Infinity;
  let maxDrop = 0;
  for (const h of heights) {
    if (h > runningMax) runningMax = h;
    if (runningMax - h > maxDrop) maxDrop = runningMax - h;
  }

  const selectorSummary = {};
  for (const sel of sels) {
    const series = samples.map((s) => (s.selectors || {})[sel] || {});
    const withNodes = series.filter((m) => m.count > 0);
    const hs = withNodes.map((m) => m.height).filter((h) => typeof h === "number");
    const counts = series.map((m) => m.count || 0);
    let disappearedAt = null;
    for (let i = 1; i < series.length; i++) {
      const before = series[i - 1];
      const after = series[i];
      const wasThere = before.count > 0 && before.height > 0 && before.display !== "none";
      const goneNow = !after.count || after.height === 0 || after.display === "none";
      if (wasThere && goneNow) { disappearedAt = samples[i].t; break; }
    }
    selectorSummary[sel] = {
      minHeight: hs.length ? Math.min(...hs) : null,
      maxHeight: hs.length ? Math.max(...hs) : null,
      displays: [...new Set(series.map((m) => m.display).filter(Boolean))],
      countRange: [Math.min(...counts), Math.max(...counts)],
      disappearedAt,
      error: series.find((m) => m.error) ? series.find((m) => m.error).error : undefined,
    };
  }

  // Oscillation = a tracked value returning to a value it already held, more than twice.
  const seriesList = [heights];
  for (const sel of sels) {
    seriesList.push(samples.map((s) => JSON.stringify((s.selectors || {})[sel] ? [(s.selectors[sel].count), (s.selectors[sel].height), (s.selectors[sel].display)] : null)));
  }
  for (const e of exprs) seriesList.push(samples.map((s) => JSON.stringify((s.expressions || {})[e] ?? null)));
  let oscillating = false;
  for (const series of seriesList) {
    const seen = new Set();
    let prev;
    let revisits = 0;
    series.forEach((v, i) => {
      if (i > 0 && v !== prev) {
        if (seen.has(v)) revisits++;
        seen.add(prev);
      }
      prev = v;
    });
    if (revisits > 2) { oscillating = true; break; }
  }

  const viewport = raw.viewport || 800;
  let verdict;
  if (maxDrop > viewport && clamps.length) verdict = "collapsed_and_clamped";
  else if (docH.last !== null && docH.last < docH.first - 24) verdict = "collapsed";
  else if (oscillating) verdict = "oscillating";
  else if (docH.max > docH.first) verdict = "grew";
  else verdict = "stable";

  const hints = {
    collapsed_and_clamped: `Document shrank ${maxDrop}px and the browser clamped scroll by ${clamps.reduce((m, c) => Math.max(m, c.lostPx), 0)}px (first at t=${clamps[0] ? clamps[0].t : "?"}ms); something removed content below the viewport and dropped the visitor further down the page.`,
    collapsed: `Document ended ${docH.first - docH.last}px shorter than it started (${docH.first} → ${docH.last}) with no scroll clamp observed; content was removed, but not while the visitor was below it.`,
    oscillating: `A tracked value changed back and forth repeatedly — this is the signature of code fighting the framework (re-insertion against React), not a bad selector.`,
    grew: `Document only grew (${docH.first} → ${docH.max}px); consistent with lazy loading and usually benign.`,
    stable: `Nothing tracked moved over ${spec.durationMs}ms${spec.scroll ? " while scroll was driven" : " (passive observation — nothing drove the page)"}.`,
  };

  const warnings = [];
  const effectiveIntervalMs = samples.length > 1
    ? Math.round((samples[samples.length - 1].t - samples[0].t) / (samples.length - 1))
    : null;
  if (effectiveIntervalMs !== null && effectiveIntervalMs > spec.sampleIntervalMs * 2) {
    warnings.push(`Requested a sample every ${spec.sampleIntervalMs}ms but got one every ~${effectiveIntervalMs}ms. Chrome throttles timers in a hidden or backgrounded tab; short-lived changes may have been missed entirely.`);
  }
  if (samples.some((s) => s.hidden)) {
    warnings.push("The tab was not visible during sampling, so requestAnimationFrame never fired and the post-scroll frame samples are missing. Re-run with the tab in the foreground.");
  }

  return {
    verdict,
    durationMs: spec.durationMs,
    sampleIntervalMs: spec.sampleIntervalMs,
    samples: samples.length,
    viewport,
    docH,
    maxDropPx: maxDrop,
    transitions,
    clamps,
    selectorSummary,
    expressionErrors: raw.expressionErrors || [],
    scrollDriven: !!spec.scroll,
    effectiveIntervalMs,
    warnings,
    hint: hints[verdict],
  };
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      ...kameleoonTools,
      ...kameleoonQaTools,
      ...hubspotTicketTools,
      {
        name: "evaluate_js",
        description: "Executes JavaScript in the active Chrome tab via the Extension and returns the result synchronousy.",
        inputSchema: zodToJsonSchema(EvaluateJsSchema),
      },
      {
        name: "click_element",
        description: "Clicks an element matched by a CSS selector using real, trusted mouse events dispatched via the Chrome Debugger (Input.dispatchMouseEvent at the element's real screen coordinates) — the same mechanism Puppeteer/Playwright use. Use this instead of el.click() via evaluate_js, which produces an untrusted synthetic click that some listeners (isTrusted checks, native form controls, third-party SDKs) silently ignore. Scrolls the element into view first, then verifies the click point actually lands on the element (in viewport, and not covered by another element such as a modal/overlay/sticky header) before dispatching — errors out instead of clicking the wrong thing. Attaches the debugger only for the duration of the click if it wasn't already attached (e.g. by set_viewport).",
        inputSchema: zodToJsonSchema(ClickElementSchema),
      },
      {
        name: "press_key",
        description: "Presses a key with real, trusted keyboard events dispatched via the Chrome Debugger (Input.dispatchKeyEvent), so the browser performs the default action: Tab really moves focus, Enter really submits. A KeyboardEvent dispatched from evaluate_js does neither. Records document.activeElement before and after every press, so `key: \"Tab\", times: 20` walks the tab order in one call — the tool for keyboard-accessibility checks such as a focus trap or a focus-stealing variation. Brings the tab and its window to the front first, because focus events are deferred while the window lacks OS focus.",
        inputSchema: zodToJsonSchema(PressKeySchema),
      },
      {
        name: "inject_experiment_code",
        description: "Injects experiment code (CSS or JS) directly into the active Chrome tab.",
        inputSchema: zodToJsonSchema(InjectCodeSchema),
      },
      {
        name: "toggle_kameleoon_simulation",
        description: "Toggles the Kameleoon simulation parameters in cookies and reloads the active tab.",
        inputSchema: zodToJsonSchema(ToggleSimulationSchema),
      },
      {
        name: "reload_page",
        description: "Programmatically reloads the active browser tab. This is a fire-and-forget broadcast — it does not confirm which tab reloaded and does not imply that request-response tools (evaluate_js, capture_screenshot, etc.) are functional.",
        inputSchema: zodToJsonSchema(ReloadPageSchema),
      },
      {
        name: "read_dom",
        description: "Requests the active tab's sanitized DOM structure to identify available elements for A/B testing variations.",
        inputSchema: zodToJsonSchema(ReadDomSchema),
      },
      {
        name: "highlight_element",
        description: "Temporarily highlights element(s) matching a CSS selector with a colored overlay for visual debugging.",
        inputSchema: zodToJsonSchema(HighlightElementSchema),
      },
      {
        name: "capture_screenshot",
        description: "Captures a PNG screenshot of the active browser tab and returns it as a base64 image.",
        inputSchema: zodToJsonSchema(CaptureScreenshotSchema),
      },
      {
        name: "read_mutation_log",
        description: "Reads the DOM mutation log captured by the content script. Shows timestamped additions, removals, and attribute changes for experiment-relevant elements since page load.",
        inputSchema: zodToJsonSchema(ReadMutationLogSchema),
      },
      {
        name: "clear_mutation_log",
        description: "Clears the stored DOM mutation log.",
        inputSchema: zodToJsonSchema(ClearMutationLogSchema),
      },
      {
        name: "list_tabs",
        description: "Lists all open tabs in the current Chrome window with their titles and URLs.",
        inputSchema: zodToJsonSchema(z.object({})),
      },
      {
        name: "activate_tab",
        description: "Focuses and activates a specific Chrome tab by its ID. Pass setTarget:true to also pin it as the bridge's target tab (equivalent to clicking 'Target This Tab' in the extension popup) — all subsequent tool calls without an explicit tabId will act on it, and it gets moved into the labeled 'CRO Target' tab group. Use list_tabs first to find candidate tab IDs.",
        inputSchema: zodToJsonSchema(z.object({
          tabId: z.number().describe("The ID of the tab to activate"),
          setTarget: z.boolean().optional().describe("If true, also pins this tab as the bridge's target so future tool calls default to it")
        })),
      },
      {
        name: "open_url",
        description: "Opens a URL in a new Chrome tab and, by default, pins it as the bridge's target tab (in the 'CRO Target' group) so the user sees which tab the agent is working on. Pass setTarget:false to leave the target unchanged.",
        inputSchema: zodToJsonSchema(OpenUrlSchema),
      },
      {
        name: "get_status",
        description: "Returns a comprehensive status report of the local CRO bridge (daemon health and connected extensions).",
        inputSchema: zodToJsonSchema(z.object({ timeoutMs: z.number().optional().describe("Timeout in milliseconds") })),
      },
      {
        name: "get_framework_status",
        description: "Determines the underlying JS framework (React, Next.js, Vue, etc.) and hydration status of the active tab.",
        inputSchema: zodToJsonSchema(GetFrameworkStatusSchema),
      },
      {
        name: "get_kameleoon_state",
        description: "Extracts structured data about active experiments, variations, Visitor, CurrentVisit and global configuration.",
        inputSchema: zodToJsonSchema(GetKameleoonStateSchema),
      },
      {
        name: "watch_selector",
        description: "A focused mutation observer that records additions, removals, and attribute changes for a specific selector over a set duration.",
        inputSchema: zodToJsonSchema(WatchSelectorSchema),
      },
      {
        name: "read_network_log",
        description: "Checks for loaded assets and slow API requests using the generic Performance API. Useful for catching failing Kameleoon scripts.",
        inputSchema: zodToJsonSchema(ReadNetworkLogSchema),
      },
      {
        name: "read_console_logs",
        description: "Fetches intercepted console logs (log, warn, error, info) from the active tab. Useful for debugging injections.",
        inputSchema: zodToJsonSchema(ReadConsoleLogsSchema),
      },
      {
        name: "get_interesting_elements",
        description: "Returns a structured summary of 'interesting' DOM elements (buttons, links, headings, inputs) for faster selector discovery.",
        inputSchema: zodToJsonSchema(GetInterestingElementsSchema),
      },
      {
        name: "get_unique_selector",
        description: "Takes a text query or partial selector and returns the most stable, unique CSS selector for that element by analyzing the DOM hierarchy.",
        inputSchema: zodToJsonSchema(GetUniqueSelectorSchema),
      },
      {
        name: "get_element_context",
        description: "Returns a mini-DOM tree (parents, siblings, and direct children) for the matching element, providing context without a full DOM dump.",
        inputSchema: zodToJsonSchema(GetElementContextSchema),
      },
      {
        name: "verify_css_support",
        description: "Checks if the current browser session supports a specific modern CSS feature or selector (e.g. :has(), subgrid).",
        inputSchema: zodToJsonSchema(VerifyCssSupportSchema),
      },
      {
        name: "find_selector_by_text",
        description: "Finds the best unique CSS selector for an element based on its text content. Highly robust against nested structures.",
        inputSchema: zodToJsonSchema(FindSelectorByTextSchema),
      },
      {
        name: "capture_element_screenshot",
        description: "Captures a cropped PNG screenshot of a specific element identified by a selector. Useful for visual validation.",
        inputSchema: zodToJsonSchema(CaptureElementScreenshotSchema),
      },
      {
        name: "inject_vibe_tokens",
        description: "Injects a set of CSS variables (design tokens) into the :root of the active tab for holistic aesthetic shifts.",
        inputSchema: zodToJsonSchema(z.object({ 
          tokens: z.record(z.string()).describe("Key-value pairs of CSS variables (e.g. { '--vibe-primary': '#ff0000' })")
        })),
      },
      {
        name: "set_viewport",
        description: "Precisely resizes the browser viewport using the Chrome Debugger. Ideal for responsive design testing.",
        inputSchema: zodToJsonSchema(SetViewportSchema),
      },
      {
        name: "emulate_device",
        description: "Emulates a predefined mobile or desktop device (viewport, user agent, etc.).",
        inputSchema: zodToJsonSchema(EmulateDeviceSchema),
      },
      {
        name: "emulate_network",
        description: "Simulates specific network conditions (3G, 4G, Offline) using the Chrome Debugger.",
        inputSchema: zodToJsonSchema(EmulateNetworkSchema),
      },
      {
        name: "clear_emulation",
        description: "Resets all viewport and network emulations, and detaches the debugger.",
        inputSchema: zodToJsonSchema(ClearEmulationSchema),
      },
      {
        name: "set_extension_enabled",
        description: "Enables or disables the connected Chrome extension. Use this when get_status shows the extension is disabled and tools like evaluate_js or capture_screenshot are failing. Broadcasts to all connected extension instances.",
        inputSchema: zodToJsonSchema(SetExtensionEnabledSchema),
      },
      {
        name: "read_response_headers",
        description: "Captures the real HTTP response headers for a page as seen by the browser during navigation — including security headers like X-Frame-Options, Content-Security-Policy (frame-ancestors), CORS, Set-Cookie, etc. that are invisible to JavaScript. Triggers a page reload (or iframe load) to intercept the live response via the Chrome debugger. Use requestContext='iframe' to simulate how an embedding page (e.g. an iframe-based editor) would load the URL — the browser will send Sec-Fetch-Dest: iframe, which some servers use to return different headers.",
        inputSchema: zodToJsonSchema(ReadResponseHeadersSchema),
      },
      {
        name: "capture_lifecycle_timeline",
        description: "Observes the page DURING load — the window that evaluate_js is blind to (it only runs after readyState:complete). Arms a document_start recorder, reloads the target tab, and returns a timestamped timeline: sampled expression values over the load, plus timestamped cookie writes, storage writes, global first-appearances, named events, and paint (FP/FCP) timing. Purpose-built for flicker, hydration races, and consent/engine-init timing. For the Kameleoon consent/visitor-code question, call with freshVisitor:true and the defaults — the timeline shows Visitor.code populating in memory while no kameleoonVisitorCode cookie-set fires, then consent flipping and the cookie write happening together, proving the code isn't persisted until consent.",
        inputSchema: zodToJsonSchema(CaptureLifecycleTimelineSchema),
      },
      {
        name: "watch_layout",
        description: "Samples page geometry over a window of time WITHOUT reloading, optionally driving scroll while it samples. Answers 'did the layout move after load, when, and did the browser clamp the scroll position' — the post-load, interaction-triggered bug class that capture_lifecycle_timeline (which reloads, and can only describe a load) cannot see. Per sample it records document scrollHeight, actual vs requested scrollY, and each selector's height/top/display/count. Output is change-only by default. Use this instead of hand-writing sampling probes into variation.js.",
        inputSchema: zodToJsonSchema(WatchLayoutSchema),
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const kameleoonResult = await handleKameleoonTool(request.params.name, request.params.arguments);
  if (kameleoonResult) return kameleoonResult;

  const kameleoonQaResult = await handleKameleoonQaTool(request.params.name, request.params.arguments);
  if (kameleoonQaResult) return kameleoonQaResult;

  const hubspotTicketResult = await handleHubspotTicketTool(request.params.name, request.params.arguments);
  if (hubspotTicketResult) return hubspotTicketResult;

  if (request.params.name === "evaluate_js") {
    const args = EvaluateJsSchema.parse(request.params.arguments);
    try {
      const result = await evaluateJs(args.code, args.timeoutMs || 5000, args.tabId);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, result }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "click_element") {
    const args = ClickElementSchema.parse(request.params.arguments);
    try {
      const result = await clickElement(args.selector, args.tabId, args.offsetX || 0, args.offsetY || 0, args.timeoutMs || 5000);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, result }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "press_key") {
    const args = PressKeySchema.parse(request.params.arguments);
    try {
      const result = await pressKey(args.key, args.tabId, args.shift || false, args.times || 1, args.delayMs ?? 150, args.timeoutMs || 15000);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, result }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "inject_experiment_code") {
    const args = InjectCodeSchema.parse(request.params.arguments);
    try {
      let wrappedContent = args.content;
      if (args.type === "javascript") {
        wrappedContent = `(function(){ try { ${args.content} } catch(e) { console.error('Agent inject_experiment_code Error:', e); } })();`;
      }
      broadcast({
        event: "hot_reload",
        payload: {
          type: args.type,
          content: wrappedContent,
          timestamp: Date.now(),
          targetTabId: args.tabId
        },
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message: `Injected ${args.type} successfully.` }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "toggle_kameleoon_simulation") {
    const args = ToggleSimulationSchema.parse(request.params.arguments);
    try {
      toggleSimulation(args.enable);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message: `Toggled simulation parameters: ${args.enable}` }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "reload_page") {
    const args = ReloadPageSchema.parse(request.params.arguments);
    try {
      reloadPage(args.tabId);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message: "Page reload command sent to extension." }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "read_dom") {
    const args = ReadDomSchema.parse(request.params.arguments);
    try {
      const selector = args.selector || 'body';
      const jsCommand = `(function() {
        const robustSelector = (sel) => {
           try { document.querySelector(sel); return sel; } catch(e) {}
           return sel.replace(/(?<!\\\\):([^\\s]+)/g, '\\\\:$1');
        };
        const el = document.querySelector(robustSelector('${selector.replace(/'/g, "\\'")}'));
        if (!el) return 'Element not found';
        const clone = el.cloneNode(true);
        
        // D2Snap: Remove purely technical/invisible noise
        const noisy = clone.querySelectorAll('script, style, svg, iframe, noscript, link, meta, base, [aria-hidden="true"], [hidden]');
        noisy.forEach(s => s.remove());
        
        function isLayoutOnly(node) {
          if (node.tagName !== 'DIV' && node.tagName !== 'SPAN' && node.tagName !== 'SECTION') return false;
          if (node.innerText && node.innerText.trim().length > 0) return false;
          if (node.attributes.length > 1) return false;
          if (node.attributes.length === 1 && node.attributes[0].name !== 'class') return false;
          if (node.children.length !== 1) return false;
          return true;
        }

        function clean(node) {
          if (node.nodeType === 1) { // ELEMENT_NODE
            while (node.children.length === 1 && isLayoutOnly(node.children[0])) {
              const child = node.children[0];
              while (child.firstChild) {
                node.appendChild(child.firstChild);
              }
              child.remove();
            }
            const allowedAttrs = ['id', 'class', 'href', 'src', 'alt', 'role', 'aria-label', 'data-testid', 'value', 'placeholder'];
            const attrs = Array.from(node.attributes);
            attrs.forEach(attr => {
              if (!allowedAttrs.includes(attr.name)) {
                node.removeAttribute(attr.name);
              }
            });
            Array.from(node.childNodes).forEach(clean);
          } else if (node.nodeType === 8) { // COMMENT_NODE
            node.remove();
          } else if (node.nodeType === 3) { // TEXT_NODE
            if (node.textContent.trim().length === 0) {
               node.remove();
            }
          }
        }
        clean(clone);
        return clone.outerHTML;
      })();`;
      
      const domResult = await evaluateJs(jsCommand, 10000, args.tabId);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, dom: domResult }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "highlight_element") {
    const args = HighlightElementSchema.parse(request.params.arguments);
    const color = args.color || 'red';
    const duration = args.durationMs || 2000;
    try {
      const jsCommand = `(function() {
        const robustSelector = (sel) => {
           try { document.querySelectorAll(sel); return sel; } catch(e) {}
           return sel.replace(/(?<!\\\\):([^\\s]+)/g, '\\\\:$1');
        };
        const els = document.querySelectorAll(robustSelector('${args.selector.replace(/'/g, "\\'")}'));
        if (els.length === 0) return JSON.stringify({ count: 0, message: 'No elements found' });
        els.forEach(el => {
          const prev = { outline: el.style.outline, boxShadow: el.style.boxShadow, background: el.style.background };
          el.style.outline = '3px solid ${color}';
          el.style.boxShadow = '0 0 10px ${color}';
          el.style.background = '${color}22';
          setTimeout(() => {
            el.style.outline = prev.outline;
            el.style.boxShadow = prev.boxShadow;
            el.style.background = prev.background;
          }, ${duration});
        });
        return JSON.stringify({ count: els.length, message: els.length + ' element(s) highlighted for ${duration}ms' });
      })();`;
      const result = await evaluateJs(jsCommand, 5000);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...JSON.parse(result) }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "capture_screenshot") {
    const args = CaptureScreenshotSchema.parse(request.params.arguments);
    try {
      const dataUrl = await captureScreenshot(null, 10000, args.tabId);
      // dataUrl is "data:image/png;base64,<data>"
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      
      // Save for agent verification
      try {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.join(process.cwd(), 'last_screenshot.png');
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        console.error(`MCP: Saved screenshot to ${filePath}`);
      } catch (saveErr) {
        console.error(`MCP: Failed to save screenshot: ${saveErr.message}`);
      }

      return {
        content: [{ type: "image", data: base64Data, mimeType: "image/png" }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "read_mutation_log") {
    const args = ReadMutationLogSchema.parse(request.params.arguments);
    try {
      if (args.delayMs) {
        await new Promise(r => setTimeout(r, args.delayMs));
      }
      const result = await readMutationLog(5000 + (args.delayMs || 0), args.tabId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "clear_mutation_log") {
    try {
      const result = await clearMutationLog(5000);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "get_status") {
    const args = z.object({ timeoutMs: z.number().optional() }).parse(request.params.arguments);
    try {
      const result = await getStatus(args.timeoutMs || 5000);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "list_tabs") {
    try {
      const result = await listTabs(5000);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "activate_tab") {
    const args = z.object({ tabId: z.number(), setTarget: z.boolean().optional() }).parse(request.params.arguments);
    try {
      const result = await activateTab(args.tabId, 5000, args.setTarget || false);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "open_url") {
    const args = OpenUrlSchema.parse(request.params.arguments);
    try {
      const result = await openUrl(args.url, args.setTarget !== false, args.timeoutMs || 10000);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...result }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "get_framework_status") {
    try {
      const jsCommand = `(function() {
        return JSON.stringify({
          frameworksFound: [
            window.__NEXT_DATA__ ? 'Next.js' : null,
            (window.React || document.querySelector('[data-reactroot]')) ? 'React' : null,
            (window.__VUE__ || document.querySelector('[data-v-app]')) ? 'Vue' : null,
            window.__NUXT__ ? 'Nuxt.js' : null,
            window.ng ? 'Angular' : null,
            window.__svelte ? 'Svelte' : null,
          ].filter(Boolean),
          nextHydrated: window.next && typeof window.next.isReady === 'function' ? window.next.isReady() : (window.next && window.next.isReady),
          isSPA: true
        });
      })();`;
      const result = await evaluateJs(jsCommand, 5000);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...JSON.parse(result) }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "get_kameleoon_state") {
    try {
      const jsCommand = `(function() {
        if (!window.Kameleoon) return JSON.stringify({ available: false, message: 'Kameleoon object not found' });
        
        let experiments = [];
        try {
          if (window.Kameleoon.Experiments) {
             for (const id in window.Kameleoon.Experiments) {
                const exp = window.Kameleoon.Experiments[id];
                experiments.push({ id, variationId: exp.variationId, name: exp.name });
             }
          }
        } catch(e) {}
        
        let extractObj = (obj) => {
           if(!obj) return obj;
           let res = {};
           for (let key in obj) {
              try {
                if (typeof obj[key] !== 'function') {
                   res[key] = obj[key];
                }
              } catch(e) {}
           }
           return res;
        };

        return JSON.stringify({
          available: true,
          simulation: window.Kameleoon.Simulation ? true : false,
          experiments: experiments,
          visitor: extractObj(window.Kameleoon.API && window.Kameleoon.API.Visitor),
          currentVisit: extractObj(window.Kameleoon.API && window.Kameleoon.API.CurrentVisit),
          siteCode: window.kameleoonSiteCode
        });
      })();`;
      const result = await evaluateJs(jsCommand, 5000);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...JSON.parse(result) }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "watch_selector") {
    const args = parseArgs(WatchSelectorSchema, request.params.arguments, "watch_selector");
    const duration = args.durationMs || 5000;
    try {
      const jsCommand = `(function() {
        return new Promise((resolve) => {
          const robustSelector = (sel) => {
             try { document.querySelector(sel); return sel; } catch(e) {}
             return sel.replace(/(?<!\\\\):([^\\s]+)/g, '\\\\:$1');
          };
          const targetSelector = robustSelector('${args.selector.replace(/'/g, "\\'")}');
          const mutationsLog = [];
          
          const MAX_MUTATIONS = 400;
          const observer = new MutationObserver((mutations) => {
             mutations.forEach(mut => {
                if (mutationsLog.length >= MAX_MUTATIONS) return;
                if (mut.type === 'childList') {
                   mut.addedNodes.forEach(node => {
                      if (node.nodeType === 1 && (node.matches(targetSelector) || node.querySelector(targetSelector))) {
                         mutationsLog.push({ time: Date.now(), type: 'added', html: node.outerHTML ? node.outerHTML.substring(0, 100) : 'Element' });
                      }
                   });
                   mut.removedNodes.forEach(node => {
                      if (node.nodeType === 1 && (node.matches(targetSelector) || node.querySelector(targetSelector))) {
                         mutationsLog.push({ time: Date.now(), type: 'removed', html: node.outerHTML ? node.outerHTML.substring(0, 100) : 'Element' });
                      }
                   });
                   // Fix: previously only nodes that matched (or contained) the selector were
                   // logged, so children arriving INSIDE a matched element — the common case,
                   // e.g. a sticky CTA mounting as #root's first child — returned mutations: [].
                   const t = mut.target;
                   const container = t && t.nodeType === 1
                      ? (t.matches(targetSelector) ? t : t.closest(targetSelector))
                      : null;
                   if (container) {
                      mut.addedNodes.forEach(node => {
                         if (node.nodeType === 1 && !node.matches(targetSelector)) {
                            mutationsLog.push({ time: Date.now(), type: 'child_added', html: node.outerHTML ? node.outerHTML.substring(0, 100) : 'Element' });
                         }
                      });
                      mut.removedNodes.forEach(node => {
                         if (node.nodeType === 1 && !node.matches(targetSelector)) {
                            mutationsLog.push({ time: Date.now(), type: 'child_removed', html: node.outerHTML ? node.outerHTML.substring(0, 100) : 'Element' });
                         }
                      });
                   }
                } else if (mut.type === 'attributes') {
                   if (mut.target.nodeType === 1 && mut.target.matches(targetSelector)) {
                      mutationsLog.push({ time: Date.now(), type: 'attribute_changed', attr: mut.attributeName });
                   }
                }
             });
          });
          
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          
          setTimeout(() => {
             observer.disconnect();
             resolve(JSON.stringify({ duration: ${duration}, selector: '${args.selector.replace(/'/g, "\\'")}', truncated: mutationsLog.length >= MAX_MUTATIONS, mutations: mutationsLog }));
          }, ${duration});
        });
      })();`;
      const result = await evaluateJs(jsCommand, duration + 2000); 
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...JSON.parse(result) }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "read_network_log") {
    const args = ReadNetworkLogSchema.parse(request.params.arguments);
    try {
      const filter = args.urlFilter || '';
      const jsCommand = `(function() {
         const resources = performance.getEntriesByType('resource');
         const filtered = resources.filter(r => r.name.includes('${filter.replace(/'/g, "\\'")}'));
         const log = filtered.map(r => ({
            name: r.name,
            type: r.initiatorType,
            duration: Math.round(r.duration),
            transferSize: r.transferSize || null
         }));
         return JSON.stringify({ count: log.length, resources: log.slice(-50) }); 
      })();`;
      const result = await evaluateJs(jsCommand, 5000);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...JSON.parse(result) }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "read_console_logs") {
    const args = ReadConsoleLogsSchema.parse(request.params.arguments);
    try {
      const jsCommand = `(function() {
         const logs = window.__kmBridgeLogs || [];
         const copy = [...logs];
         ${args.clearLogs ? 'window.__kmBridgeLogs = [];' : ''}
         return JSON.stringify({ count: copy.length, logs: copy });
      })();`;
      const result = await evaluateJs(jsCommand, 5000);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...JSON.parse(result) }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "get_interesting_elements") {
    const args = GetInterestingElementsSchema.parse(request.params.arguments);
    try {
      const jsCommand = `(function() {
        const results = {
          headings: [],
          buttons: [],
          links: [],
          inputs: []
        };
        
        if (${args.includeHeadings}) {
          document.querySelectorAll('h1, h2, h3').forEach(el => {
            const r = el.getBoundingClientRect();
            results.headings.push({ 
              tag: el.tagName, 
              text: el.innerText.trim(), 
              className: el.className,
              rect: { x: r.x, y: r.y, w: r.width, h: r.height }
            });
          });
        }
        
        if (${args.includeButtons}) {
          document.querySelectorAll('button, [role="button"], .btn, .button').forEach(el => {
            const r = el.getBoundingClientRect();
            results.buttons.push({ 
              tag: el.tagName, 
              text: el.innerText.trim(), 
              id: el.id, 
              className: el.className,
              ariaLabel: el.getAttribute('aria-label'),
              rect: { x: r.x, y: r.y, w: r.width, h: r.height }
            });
          });
        }
        
        if (${args.includeLinks}) {
          document.querySelectorAll('a[href]').forEach(el => {
            if (el.innerText.trim().length > 0 || el.querySelector('img')) {
              const r = el.getBoundingClientRect();
              results.links.push({ 
                text: el.innerText.trim() || '[Image Link]', 
                href: el.getAttribute('href'),
                className: el.className,
                rect: { x: r.x, y: r.y, w: r.width, h: r.height }
              });
            }
          });
        }
        
        if (${args.includeInputs}) {
          document.querySelectorAll('input, select, textarea').forEach(el => {
            const r = el.getBoundingClientRect();
            results.inputs.push({ 
              tag: el.tagName, 
              type: el.type, 
              name: el.name, 
              placeholder: el.getAttribute('placeholder'),
              id: el.id,
              rect: { x: r.x, y: r.y, w: r.width, h: r.height }
            });
          });
        }
        
        return JSON.stringify(results);
      })();`;
      const result = await evaluateJs(jsCommand, 5000);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...JSON.parse(result) }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "get_unique_selector") {
    const args = GetUniqueSelectorSchema.parse(request.params.arguments);
    try {
      const jsCommand = `(function() {
        const query = "${args.query.replace(/"/g, '\\"').replace(/\n/g, ' ')}";
        let target = null;
        
        // Find elements by text content or selector
        try { target = document.querySelector(query); } catch(e) {}
        if (!target) {
          const els = Array.from(document.querySelectorAll('a, button, span, div, h1, h2, h3, h4, h5, h6, label, p'));
          target = els.find(el => el.textContent.trim() === query || el.innerText.trim() === query);
          if (!target) target = els.find(el => el.textContent.includes(query) || el.innerText.includes(query));
        }
        
        if (!target) return JSON.stringify({ success: false, message: 'No target element found' });
        
        const isUnique = (sel) => {
          try { return document.querySelectorAll(sel).length === 1; } catch(e) { return false; }
        };
        
        const getBestAttributes = (el) => {
          const attrs = [];
          if (el.id) attrs.push('#' + CSS.escape(el.id));
          if (${args.preferDataTestId}) {
             for (const attr of el.attributes) {
               if (attr.name === 'data-testid' || attr.name === 'data-qa' || attr.name === 'data-cy') {
                 attrs.push('[' + attr.name + '="' + CSS.escape(attr.value) + '"]');
               }
             }
          }
          if (el.getAttribute('aria-label')) attrs.push('[aria-label="' + CSS.escape(el.getAttribute('aria-label')) + '"]');
          if (el.getAttribute('name')) attrs.push('[name="' + CSS.escape(el.getAttribute('name')) + '"]');
          
          // Filter out unstable classes
          const classes = Array.from(el.classList).filter(c => {
             // Heuristic: ignore long random-looking hashed classes
             if (c.length > 20 && /\\d/.test(c)) return false; 
             // Ignore purely numeric or too short if possible
             return c.length > 2;
          });
          classes.forEach(c => attrs.push('.' + CSS.escape(c)));
          return attrs;
        };
        
        // 1. Check if direct attributes are unique
        const directAttrs = getBestAttributes(target);
        for (const attr of directAttrs) {
          if (isUnique(attr)) return JSON.stringify({ success: true, selector: attr, method: 'direct_attribute' });
        }
        
        // 2. Try simple tag + attribute combos
        const tag = target.tagName.toLowerCase();
        for (const attr of directAttrs) {
          if (isUnique(tag + attr)) return JSON.stringify({ success: true, selector: tag + attr, method: 'tag_attribute_combo' });
        }
        
        // 3. Try building a path
        let current = target;
        let pathParts = [];
        let iterations = 0;
        while (current && current !== document.body && iterations < 5) {
          const tagName = current.tagName.toLowerCase();
          const attrs = getBestAttributes(current);
          let part = tagName;
          if (attrs.length > 0) part += attrs[0]; // Use the "best" attribute
          
          pathParts.unshift(part);
          const currentSelector = pathParts.join(' > ');
          if (isUnique(currentSelector)) return JSON.stringify({ success: true, selector: currentSelector, method: 'hierarchical_path' });
          
          current = current.parentElement;
          iterations++;
        }
        
        // 4. Try :has() if appropriate
        if (target.children.length > 0) {
           for (const child of target.children) {
             const childAttrs = getBestAttributes(child);
             if (childAttrs.length > 0) {
                const hasSelector = tag + ':has(> ' + child.tagName.toLowerCase() + childAttrs[0] + ')';
                if (isUnique(hasSelector)) return JSON.stringify({ success: true, selector: hasSelector, method: 'has_child_anchor' });
             }
           }
        }

        // 5. Fallback: Absolute nth-child path from body
        current = target;
        let fallbackPath = [];
        while (current && current !== document.documentElement) {
          let selectorPart = current.tagName.toLowerCase();
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children);
            if (siblings.filter(s => s.tagName === current.tagName).length > 1) {
              const index = siblings.indexOf(current) + 1;
              selectorPart += ':nth-child(' + index + ')';
            }
          }
          fallbackPath.unshift(selectorPart);
          const sel = fallbackPath.join(' > ');
          if (isUnique(sel)) return JSON.stringify({ success: true, selector: sel, method: 'absolute_nth_child' });
          current = parent;
        }
        
        return JSON.stringify({ success: false, message: 'Could not generate a simple unique selector' });
      })();`;
      const result = await evaluateJs(jsCommand, 5000);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "get_element_context") {
    const args = GetElementContextSchema.parse(request.params.arguments);
    try {
      const jsCommand = `(function() {
        const el = document.querySelector("${args.selector.replace(/"/g, '\\"').replace(/\n/g, ' ')}");
        if (!el) return 'Element not found';
        
        const cleanNode = (node) => {
           const clone = node.cloneNode(false);
           clone.removeAttribute('style');
           // Remove noisy attributes if too long
           Array.from(clone.attributes).forEach(attr => {
              if (attr.value.length > 40 && attr.name !== 'class') clone.removeAttribute(attr.name);
           });
           return clone.outerHTML.replace(/<\\/.*>/, ''); // Return opening tag only
        };
        
        const context = {
          target: el.outerHTML.substring(0, 500) + (el.outerHTML.length > 500 ? '...' : ''),
          parents: [],
          siblings: [],
          children: []
        };
        
        let curr = el.parentElement;
        for (let i = 0; i < ${args.depth}; i++) {
          if (curr) {
            context.parents.push(cleanNode(curr));
            curr = curr.parentElement;
          }
        }
        
        Array.from(el.parentElement?.children || []).forEach(sib => {
          if (sib !== el) context.siblings.push(cleanNode(sib));
        });
        
        Array.from(el.children).slice(0, 5).forEach(child => {
           context.children.push(cleanNode(child));
        });
        
        return JSON.stringify(context, null, 2);
      })();`;
      const result = await evaluateJs(jsCommand, 5000);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "verify_css_support") {
    const args = VerifyCssSupportSchema.parse(request.params.arguments);
    try {
      const jsCommand = `(function() {
        const feature = "${args.feature.replace(/"/g, '\\"')}";
        const isSelector = feature.includes(':') || feature.includes('>') || feature.includes('[');
        
        let supported = false;
        try {
          if (isSelector) {
            document.querySelector(feature);
            supported = true;
          } else {
            supported = CSS.supports(feature) || CSS.supports(feature, 'initial');
          }
        } catch(e) {
          supported = false;
        }
        
        return JSON.stringify({ feature, supported, userAgent: navigator.userAgent });
      })();`;
      const result = await evaluateJs(jsCommand, 5000);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "find_selector_by_text") {
    const args = FindSelectorByTextSchema.parse(request.params.arguments);
    try {
      const jsCommand = `(function() {
        const query = "${args.query.replace(/"/g, '\\"').toLowerCase().trim().replace(/\\s+/g, ' ')}";
        const contextSelector = "${(args.context || '').replace(/"/g, '\\"')}";
        const context = contextSelector ? document.querySelector(contextSelector) : document;
        if (contextSelector && !context) return JSON.stringify({ success: false, message: 'Context element not found' });

        const allElements = Array.from(context.querySelectorAll('*'));
        // Filter elements that contain the text (own text or children)
        const matches = allElements.filter(el => {
          const text = (el.innerText || el.textContent || '').toLowerCase().trim().replace(/\\s+/g, ' ');
          return text.includes(query);
        });

        if (matches.length === 0) return JSON.stringify({ success: false, message: 'No element found with that text' });

        // Sort by depth (number of parents) descending to find the "deepest" match
        const getDepth = (el) => {
          let depth = 0;
          while (el.parentElement) { depth++; el = el.parentElement; }
          return depth;
        };
        
        // We want the deepest element that contains the text and doesn't have a child that also contains the EXACT text if possible
        // Actually, often the deepest element is a <span> or <b>, which is good.
        matches.sort((a, b) => getDepth(b) - getDepth(a));
        
        const target = matches[0];

        // Reuse unique selector logic
        const isUnique = (sel) => {
          try { return document.querySelectorAll(sel).length === 1; } catch(e) { return false; }
        };
        
        const getBestAttributes = (el) => {
          const attrs = [];
          if (el.id) attrs.push('#' + CSS.escape(el.id));
          for (const attr of el.attributes) {
            if (['data-testid', 'data-qa', 'data-cy', 'name', 'aria-label'].includes(attr.name)) {
              attrs.push('[' + attr.name + '="' + CSS.escape(attr.value) + '"]');
            }
          }
          const classes = Array.from(el.classList).filter(c => c.length > 2 && !/\\d/.test(c));
          classes.forEach(c => attrs.push('.' + CSS.escape(c)));
          return attrs;
        };

        const generateSelector = (el) => {
          const attrs = getBestAttributes(el);
          const tag = el.tagName.toLowerCase();
          
          if (tag === 'a' && el.getAttribute('href')) {
             const hrefSel = tag + '[href="' + CSS.escape(el.getAttribute('href')) + '"]';
             if (isUnique(hrefSel)) return hrefSel;
          }
          
          for (const attr of attrs) {
            if (isUnique(attr)) return attr;
            if (isUnique(tag + attr)) return tag + attr;
          }
          
          let current = el;
          let path = [];
          for (let i = 0; i < 5 && current && current !== document.body; i++) {
            const bestAttr = getBestAttributes(current)[0] || '';
            path.unshift(current.tagName.toLowerCase() + bestAttr);
            const sel = path.join(' > ');
            if (isUnique(sel)) return sel;
            current = current.parentElement;
          }

          // Fallback: Absolute nth-child path
          current = el;
          path = [];
          while (current && current !== document.documentElement) {
            let selectorPart = current.tagName.toLowerCase();
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children);
              if (siblings.filter(s => s.tagName === current.tagName).length > 1) {
                const index = siblings.indexOf(current) + 1;
                selectorPart += ':nth-child(' + index + ')';
              }
            }
            path.unshift(selectorPart);
            const sel = path.join(' > ');
            if (isUnique(sel)) return sel;
            current = parent;
          }

          return null;
        };

        const selector = generateSelector(target);
        if (!selector) return JSON.stringify({ success: false, message: 'Found element but could not generate unique selector', elementInfo: target.tagName });

        return JSON.stringify({ success: true, selector, text: target.innerText.substring(0, 100), tagName: target.tagName });
      })();`;
      const result = await evaluateJs(jsCommand, 5000);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }

  if (request.params.name === "capture_element_screenshot") {
    const args = CaptureElementScreenshotSchema.parse(request.params.arguments);
    try {
      // 1. Get element bounds
      const boundsJs = `(function() {
        const el = document.querySelector("${args.selector.replace(/"/g, '\\"')}");
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        return new Promise(resolve => {
          setTimeout(() => {
            const rect = el.getBoundingClientRect();
            resolve({
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              devicePixelRatio: window.devicePixelRatio
            });
          }, 100);
        });
      })();`;
      const bounds = await evaluateJs(boundsJs, 5000);
      if (!bounds) throw new Error('Element not found: ' + args.selector);

      // 2. Capture and crop
      const dataUrl = await captureScreenshot(bounds, 15000);
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

      return {
        content: [{ type: "image", data: base64Data, mimeType: "image/png" }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }

  if (request.params.name === "inject_vibe_tokens") {
    const args = z.object({ tokens: z.record(z.string()) }).parse(request.params.arguments);
    try {
      const cssRules = Object.entries(args.tokens)
        .map(([key, val]) => `${key}: ${val} !important;`)
        .join('\\n');
      const content = `:root {\\n${cssRules}\\n}`;
      
      broadcast({
        event: "hot_reload",
        payload: {
          type: "css",
          content: content,
          timestamp: Date.now(),
        },
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message: 'Vibe tokens injected successfully' }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (request.params.name === "set_viewport") {
    const args = SetViewportSchema.parse(request.params.arguments);
    try {
      const result = await setViewport(args.width, args.height, args.mobile, args.tabId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }

  if (request.params.name === "emulate_device") {
    const args = EmulateDeviceSchema.parse(request.params.arguments);
    try {
      const devices = {
        "iPhone 14": { width: 390, height: 844, mobile: true, deviceScaleFactor: 3 },
        "iPhone SE": { width: 375, height: 667, mobile: true, deviceScaleFactor: 2 },
        "Pixel 7": { width: 412, height: 915, mobile: true, deviceScaleFactor: 2.6 },
        "iPad Air": { width: 820, height: 1180, mobile: true, deviceScaleFactor: 2 },
        "Desktop (1440p)": { width: 2560, height: 1440, mobile: false, deviceScaleFactor: 1 },
        "Desktop (1080p)": { width: 1920, height: 1080, mobile: false, deviceScaleFactor: 1 },
      };
      const config = devices[args.device];
      const result = await setViewport(config.width, config.height, config.mobile, args.tabId);
      return {
        content: [{ type: "text", text: JSON.stringify({ device: args.device, ...result }, null, 2) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }

  if (request.params.name === "emulate_network") {
    const args = EmulateNetworkSchema.parse(request.params.arguments);
    try {
      const conditions = {
        "Slow 3G": { offline: false, latency: 400, downloadThroughput: 400, uploadThroughput: 400 },
        "Fast 3G": { offline: false, latency: 150, downloadThroughput: 1500, uploadThroughput: 750 },
        "4G": { offline: false, latency: 20, downloadThroughput: 4000, uploadThroughput: 3000 },
        "Offline": { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
        "No Throttling": { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
      };
      const result = await emulateNetwork(conditions[args.type], args.tabId);
      return {
        content: [{ type: "text", text: JSON.stringify({ type: args.type, ...result }, null, 2) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }

  if (request.params.name === "clear_emulation") {
    const args = ClearEmulationSchema.parse(request.params.arguments);
    try {
      const result = await clearEmulation(args.tabId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }

  if (request.params.name === "set_extension_enabled") {
    const args = SetExtensionEnabledSchema.parse(request.params.arguments);
    try {
      const result = await setExtensionEnabled(args.enabled);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...result }, null, 2) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }

  if (request.params.name === "read_response_headers") {
    const args = ReadResponseHeadersSchema.parse(request.params.arguments);
    try {
      const result = await readResponseHeaders(
        args.url || null,
        args.tabId || null,
        args.requestContext || 'top-level',
        args.includeSubresources || false,
        args.urlFilter || null,
        args.timeoutMs || 15000
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }

  if (request.params.name === "capture_lifecycle_timeline") {
    const args = parseArgs(CaptureLifecycleTimelineSchema, request.params.arguments, "capture_lifecycle_timeline");
    try {
      const maxDurationMs = args.maxDurationMs || 8000;
      const selfReload = args.selfReload
        ? { count: Math.min(3, Math.max(1, args.selfReload.count || 1)), atMs: args.selfReload.atMs != null ? args.selfReload.atMs : 1000 }
        : null;
      const spec = {
        expressions: args.expressions && args.expressions.length ? args.expressions : DEFAULT_LIFECYCLE_EXPRESSIONS,
        hooks: args.hooks || { cookies: true, storage: true, globals: ["Kameleoon"] },
        sampleIntervalMs: args.sampleIntervalMs || 50,
        maxDurationMs,
        freshVisitor: !!args.freshVisitor,
        selfReload,
      };

      // Daemon timeout must outlast the extension's capture window + self-reload
      // overhead + its polling margin (see background.js handleArmLifecycleCapture).
      const cap = selfReload ? selfReload.count : 0;
      const atMs = selfReload ? selfReload.atMs : 0;
      const timeoutMs = maxDurationMs + cap * (atMs + 2500) + 12000;

      const result = await captureLifecycleTimeline(spec, args.tabId || null, timeoutMs);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...capLifecycleEvents(result, args.maxEvents, args.eventFilter) }, null, 2) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }

  if (request.params.name === "watch_layout") {
    const args = parseArgs(WatchLayoutSchema, request.params.arguments, "watch_layout");
    if (!(args.selectors && args.selectors.length) && !(args.expressions && args.expressions.length)) {
      return {
        isError: true,
        content: [{ type: "text", text: "watch_layout: nothing to sample for — pass `selectors` (elements to measure) and/or `expressions` (read-only JS)." }],
      };
    }
    try {
      const spec = {
        selectors: args.selectors || [],
        expressions: args.expressions || [],
        durationMs: Math.min(30000, Math.max(200, args.durationMs || 5000)),
        sampleIntervalMs: Math.max(16, args.sampleIntervalMs || 100),
        scroll: args.scroll && args.scroll.to && args.scroll.to.length
          ? {
              to: args.scroll.to,
              stepMs: Math.max(16, args.scroll.stepMs || 250),
              repeat: Math.min(10, Math.max(1, args.scroll.repeat || 1)),
            }
          : null,
      };
      if (args.focusTab !== false) {
        try {
          let id = args.tabId;
          if (!id) {
            const status = await getStatus();
            const ext = (status.extensions || [])[0];
            id = ext && (ext.targetTabId || (ext.activeTab && ext.activeTab.id));
          }
          if (id) await activateTab(id, 5000, false);
        } catch (e) { /* non-fatal: the throttling warning below explains the timing */ }
      }
      const raw = JSON.parse(await evaluateJs(buildWatchLayoutScript(spec), spec.durationMs + 5000, args.tabId));
      const report = summarizeLayoutSamples(raw, spec);
      if (args.includeAllSamples) report.allSamples = raw.samples;
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, ...report }, null, 2) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }

  throw new Error("Tool not found");
});

export async function initMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}
