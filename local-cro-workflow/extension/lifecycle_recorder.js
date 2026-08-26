// Load-lifecycle timeline recorder — injected at document_start in the MAIN world.
//
// Boots on every navigation but does NOTHING unless a capture has been "armed"
// by the extension writing __kmLifecycleSpec into sessionStorage right before a
// reload (see background.js handleArmLifecycleCapture). It then samples a set of
// expressions on an interval and timestamps cookie/storage/global/event activity
// across the load, buffering everything into sessionStorage. The extension reads
// __kmLifecycleTimeline back once the capture window closes.
//
// See docs/SPEC-lifecycle-timeline.md. Timestamps use performance.now() (ms since
// timeOrigin ≈ navigationStart) so they align 1:1 with paint entries.
(function () {
  const SPEC_KEY = '__kmLifecycleSpec';
  const OUT_KEY = '__kmLifecycleTimeline';
  const RUN_KEY = '__kmLifecycleRun';      // self-reload counter (demo mode)
  const RELOADS_KEY = '__kmLifecycleReloads'; // accumulated pre-consent snapshots (demo mode)
  const INTERNAL_PREFIX = '__kmLifecycle';

  let specRaw;
  try { specRaw = sessionStorage.getItem(SPEC_KEY); } catch (e) { return; }
  if (!specRaw) return;

  let spec;
  try { spec = JSON.parse(specRaw); } catch (e) { return; }
  if (!spec || spec.armed !== true) return;

  const now = () => Math.round(performance.now());

  const expressions = Array.isArray(spec.expressions) ? spec.expressions : [];
  const hooks = spec.hooks || {};
  const sampleIntervalMs = Math.max(10, spec.sampleIntervalMs || 50);
  const maxDurationMs = Math.max(200, spec.maxDurationMs || 8000);
  const selfReload = spec.selfReload || null;

  // ---- Self-reload demo mode --------------------------------------------------
  // On pre-consent demo runs we only snapshot the visitor code, then reload,
  // leaving the spec armed. The final run does the full capture and reports the
  // accumulated snapshots as `reloads`.
  const readInt = (k) => { try { return parseInt(sessionStorage.getItem(k) || '0', 10) || 0; } catch (e) { return 0; } };
  const readReloads = () => { try { return JSON.parse(sessionStorage.getItem(RELOADS_KEY) || '[]'); } catch (e) { return []; } };

  const evalRead = (expr) => {
    // Read-only probe. Any expression with side effects is a caller bug (see spec).
    try {
      // eslint-disable-next-line no-eval
      return eval(expr);
    } catch (e) {
      return '<<error: ' + (e && e.message ? e.message : String(e)) + '>>';
    }
  };

  const MAX_STR = 500;
  const serialize = (v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = typeof v;
    if (t === 'number' || t === 'boolean') return v;
    if (t === 'string') return v.length > MAX_STR ? v.slice(0, MAX_STR) + '…' : v;
    try {
      const s = JSON.stringify(v);
      if (s === undefined) return String(v).slice(0, MAX_STR);
      return s.length > MAX_STR ? s.slice(0, MAX_STR) + '…' : s;
    } catch (e) {
      try { return String(v).slice(0, MAX_STR); } catch (e2) { return '<<unserializable>>'; }
    }
  };

  if (selfReload) {
    const cap = Math.min(3, Math.max(1, selfReload.count || 1));
    const atMs = Math.max(0, selfReload.atMs != null ? selfReload.atMs : 1000);
    const run = readInt(RUN_KEY);
    if (run < cap) {
      // Pre-consent demo run: snapshot the code at atMs, record it, then reload.
      const doSnapshot = () => {
        let code = null;
        try { code = serialize(evalRead('window.Kameleoon && window.Kameleoon.API && window.Kameleoon.API.Visitor && window.Kameleoon.API.Visitor.code')); } catch (e) {}
        let cookieHadCode = false;
        try { cookieHadCode = document.cookie.indexOf('kameleoonVisitorCode') !== -1; } catch (e) {}
        const reloads = readReloads();
        reloads.push({ run, code: code || null, cookieHadCode });
        try {
          sessionStorage.setItem(RELOADS_KEY, JSON.stringify(reloads));
          sessionStorage.setItem(RUN_KEY, String(run + 1));
        } catch (e) {}
        try { location.reload(); } catch (e) {}
      };
      // Fire at atMs from navigation start; clamp if we're already past it.
      const wait = Math.max(0, atMs - now());
      setTimeout(doSnapshot, wait);
      return; // do not start the full capture on demo runs
    }
    // run >= cap: fall through to the full capture (final run).
  }

  // ---- Full capture -----------------------------------------------------------
  const samples = [];
  const events = [];
  const restores = [];
  const seenGlobals = Object.create(null);
  let truncated = false;
  let loadComplete = null;

  const pushEvent = (obj) => {
    obj.t = now();
    events.push(obj);
    if (events.length > 1000) events.shift();
  };

  // Cookie setter hook — HIGHEST-RISK: must forward to native and never throw.
  if (hooks.cookies !== false) {
    try {
      let desc = null;
      let obj = document;
      while (obj && !desc) {
        const d = Object.getOwnPropertyDescriptor(obj, 'cookie');
        if (d && typeof d.get === 'function' && typeof d.set === 'function') desc = d;
        obj = Object.getPrototypeOf(obj);
      }
      if (desc && desc.configurable !== false) {
        const nativeGet = desc.get;
        const nativeSet = desc.set;
        Object.defineProperty(document, 'cookie', {
          configurable: true,
          enumerable: false,
          get() { return nativeGet.call(document); },
          set(val) {
            try {
              const name = String(val).split('=')[0].trim();
              pushEvent({ kind: 'cookie-set', name });
            } catch (e) { /* logging must never block the real write */ }
            return nativeSet.call(document, val);
          }
        });
        // Restore = drop the own property so the prototype descriptor takes over again.
        restores.push(() => { try { delete document.cookie; } catch (e) {} });
      }
    } catch (e) { /* never break the page */ }
  }

  // Storage setItem hook — wraps Storage.prototype so it covers both stores.
  if (hooks.storage !== false) {
    try {
      const nativeSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        try {
          const k = String(key);
          if (k.indexOf(INTERNAL_PREFIX) !== 0) {
            let store = 'other';
            try {
              if (this === window.localStorage) store = 'local';
              else if (this === window.sessionStorage) store = 'session';
            } catch (e) {}
            pushEvent({ kind: 'storage-set', store, key: k });
          }
        } catch (e) { /* logging must never block the real write */ }
        return nativeSetItem.apply(this, arguments);
      };
      restores.push(() => { try { Storage.prototype.setItem = nativeSetItem; } catch (e) {} });
    } catch (e) { /* never break the page */ }
  }

  // Named window/document events.
  if (Array.isArray(hooks.events)) {
    for (const name of hooks.events) {
      try {
        const handler = () => pushEvent({ kind: 'event', name });
        window.addEventListener(name, handler, true);
        document.addEventListener(name, handler, true);
        restores.push(() => {
          try { window.removeEventListener(name, handler, true); } catch (e) {}
          try { document.removeEventListener(name, handler, true); } catch (e) {}
        });
      } catch (e) {}
    }
  }

  // readyState transitions + load marker.
  const onReadyStateChange = () => pushEvent({ kind: 'readystate', value: document.readyState });
  document.addEventListener('readystatechange', onReadyStateChange, true);
  restores.push(() => { try { document.removeEventListener('readystatechange', onReadyStateChange, true); } catch (e) {} });

  const onLoad = () => { if (loadComplete == null) loadComplete = now(); };
  window.addEventListener('load', onLoad, true);
  restores.push(() => { try { window.removeEventListener('load', onLoad, true); } catch (e) {} });

  // Global first-appearance detection (checked each sample tick).
  const checkGlobals = () => {
    if (!Array.isArray(hooks.globals)) return;
    for (const name of hooks.globals) {
      if (seenGlobals[name]) continue;
      let present = false;
      try { present = typeof window[name] !== 'undefined'; } catch (e) {}
      if (present) {
        seenGlobals[name] = true;
        pushEvent({ kind: 'global-appeared', name });
      }
    }
  };

  const takeSample = () => {
    const values = {};
    for (const expr of expressions) {
      values[expr] = serialize(evalRead(expr));
    }
    samples.push({ t: now(), readyState: document.readyState, values });
    if (samples.length > 2000) { samples.shift(); truncated = true; }
    checkGlobals();
  };

  // Immediate first sample so t≈0 is captured before the interval kicks in.
  takeSample();
  const intervalId = setInterval(takeSample, sampleIntervalMs);

  const readPaint = () => {
    const out = {};
    try {
      const entries = performance.getEntriesByType('paint') || [];
      for (const e of entries) out[e.name] = Math.round(e.startTime);
    } catch (e) {}
    return out;
  };

  const finalize = () => {
    clearInterval(intervalId);
    takeSample(); // final snapshot
    for (const r of restores) r();

    const result = {
      navigationStart: 0,
      loadComplete,
      samples,
      events,
      paint: readPaint(),
      truncated,
      done: true,
      captureId: spec.captureId || null
    };
    if (selfReload) result.reloads = readReloads();

    try { sessionStorage.setItem(OUT_KEY, JSON.stringify(result)); } catch (e) {}
    // One-shot: consume the arm + demo state so a later manual reload won't re-run.
    try { sessionStorage.removeItem(SPEC_KEY); } catch (e) {}
    try { sessionStorage.removeItem(RUN_KEY); } catch (e) {}
    try { sessionStorage.removeItem(RELOADS_KEY); } catch (e) {}
  };

  setTimeout(finalize, maxDurationMs);
})();
