import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { evaluateJs, toggleSimulation, broadcast, captureScreenshot, readMutationLog, clearMutationLog, listTabs, activateTab, getStatus } from "../daemon/server.js";

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
  code: z.string().describe("JavaScript code to evaluate in the active browser tab"),
  timeoutMs: z.number().optional().describe("Timeout for evaluation in ms"),
});

const InjectCodeSchema = z.object({
  type: z.enum(["javascript", "css"]).describe("Code type to inject"),
  content: z.string().describe("The raw code (JS or CSS) to inject into the active tab"),
});

const ToggleSimulationSchema = z.object({
  enable: z.boolean().describe("Whether to enable or disable Kameleoon simulation"),
  parameters: z.record(z.any()).optional().describe("Custom Kameleoon simulation parameters configuration"),
});

const ReloadPageSchema = z.object({});

const ReadDomSchema = z.object({
  selector: z.string().optional().describe("Optional CSS selector to target specific DOM element instead of document body"),
});

const HighlightElementSchema = z.object({
  selector: z.string().describe("CSS selector for the element(s) to highlight"),
  color: z.string().optional().describe("Highlight color (default: 'red')"),
  durationMs: z.number().optional().describe("Duration of highlight in ms (default: 2000)"),
});

const CaptureScreenshotSchema = z.object({});

const ReadMutationLogSchema = z.object({
  delayMs: z.number().optional().describe("Optional delay in ms before reading the log (e.g. 2000 to wait for page load mutations)"),
});
const ClearMutationLogSchema = z.object({});

const GetFrameworkStatusSchema = z.object({});
const GetKameleoonStateSchema = z.object({});

const WatchSelectorSchema = z.object({
  selector: z.string().describe("CSS selector to watch for mutations"),
  durationMs: z.number().optional().describe("Duration to watch in ms (default 5000)"),
});

const ReadNetworkLogSchema = z.object({
  urlFilter: z.string().optional().describe("Optional substring to filter URLs (e.g. 'kameleoon')"),
});

const ReadConsoleLogsSchema = z.object({
  clearLogs: z.boolean().optional().describe("Whether to clear the console logs after fetching"),
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "evaluate_js",
        description: "Executes JavaScript in the active Chrome tab via the Extension and returns the result synchronousy.",
        inputSchema: zodToJsonSchema(EvaluateJsSchema),
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
        description: "Programmatically reloads the active browser tab.",
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
        description: "Focuses and activates a specific Chrome tab by its ID.",
        inputSchema: zodToJsonSchema(z.object({ tabId: z.number().describe("The ID of the tab to activate") })),
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
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "evaluate_js") {
    const args = EvaluateJsSchema.parse(request.params.arguments);
    try {
      const result = await evaluateJs(args.code, args.timeoutMs || 5000);
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
    try {
      broadcast({ event: "reload_page" });
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
           return sel.replace(/(?<!\\\\):([^\\s]+)/g, '\\\\:$1'); // Auto-escape pseudo-colons like md:block
        };
        const el = document.querySelector(robustSelector('${selector.replace(/'/g, "\\'")}'));
        if (!el) return 'Element not found';
        const clone = el.cloneNode(true);
        const scripts = clone.querySelectorAll('script, style, svg, iframe, noscript');
        scripts.forEach(s => s.remove());
        
        function clean(node) {
          if (node.nodeType === 1) { // ELEMENT_NODE
            node.removeAttribute('style');
            const attrs = Array.from(node.attributes);
            attrs.forEach(attr => {
               if (attr.name.startsWith('data-') || attr.value.length > 50) {
                 if (attr.name !== 'class') {
                   node.removeAttribute(attr.name);
                 }
               }
            });
            Array.from(node.childNodes).forEach(clean);
          }
        }
        clean(clone);
        return clone.outerHTML;
      })();`;
      
      const domResult = await evaluateJs(jsCommand, 10000);
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
    try {
      const dataUrl = await captureScreenshot(10000);
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
      const result = await readMutationLog(5000 + (args.delayMs || 0));
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
    const args = z.object({ tabId: z.number() }).parse(request.params.arguments);
    try {
      const result = await activateTab(args.tabId, 5000);
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

  if (request.params.name === "get_framework_status") {
    try {
      const jsCommand = `(function() {
        return {
          frameworksFound: [
            window.__NEXT_DATA__ ? 'Next.js' : null,
            (window.React || document.querySelector('[data-reactroot]')) ? 'React' : null,
            (window.__VUE__ || document.querySelector('[data-v-app]')) ? 'Vue' : null,
            window.__NUXT__ ? 'Nuxt.js' : null,
            window.ng ? 'Angular' : null,
            window.__svelte ? 'Svelte' : null,
          ].filter(Boolean),
          nextHydrated: window.next && window.next.isReady,
          isSPA: true
        };
      })();`;;
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
    const args = WatchSelectorSchema.parse(request.params.arguments);
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
          
          const observer = new MutationObserver((mutations) => {
             mutations.forEach(mut => {
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
             resolve(JSON.stringify({ duration: ${duration}, selector: '${args.selector.replace(/'/g, "\\'")}', mutations: mutationsLog }));
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

  throw new Error("Tool not found");
});

export async function initMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}
