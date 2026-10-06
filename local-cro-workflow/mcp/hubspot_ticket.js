// HubSpot ticket import, agent-invocable.
//
// The popup button and this tool are two front doors onto the same two steps — scrape
// the ticket tab, then write the folder. The button exists because that is where the
// user already is; this exists because iterating on the importer through a button the
// agent cannot press is miserable.
//
// The tab is found by ticket id, or opened and waited on. Login is never automated: if
// HubSpot bounces to a login page the tool says so and stops.

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { importHubspotTicketByUrl } from '../daemon/server.js';

const ImportTicketSchema = z.object({
  url: z.string().describe(
    'HubSpot ticket record URL, e.g. https://app.hubspot.com/contacts/<portalId>/record/0-5/<ticketId>/ ' +
    '(a trailing slash and an ?eschref=... query string are both fine)'
  )
});

export const hubspotTicketTools = [
  {
    name: 'import_hubspot_ticket',
    description:
      "Imports a HubSpot ticket into the local workspace from its record URL: writes " +
      "experiments/.tickets/<ticketId>-<slug>/Objective.md (ticket body plus the comment thread " +
      "in order, with author and timestamp) and downloads each inline image beside it as " +
      "image-NN.<ext>. Uses the Chrome tab already showing that ticket, or opens one and waits " +
      "for HubSpot's timeline to render, then closes it again if it opened it. " +
      "Re-importing replaces that ticket's folder, so iterate freely. " +
      "A failed image download is a warning, not a failure — Objective.md is still written and " +
      "keeps the original URL for that image, so check `warnings` and `imageCount`/`imageTotal` " +
      "rather than assuming success. Never logs in: if HubSpot redirects to login it says so and stops. " +
      "The destination is dot-prefixed so the file watcher never injects anything a ticket carries.",
    inputSchema: zodToJsonSchema(ImportTicketSchema)
  }
];

/** Returns a tool result, or null if the name is not one of ours. */
export async function handleHubspotTicketTool(name, rawArgs) {
  if (name !== 'import_hubspot_ticket') return null;
  try {
    const { url } = ImportTicketSchema.parse(rawArgs || {});
    const result = await importHubspotTicketByUrl(url);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}
