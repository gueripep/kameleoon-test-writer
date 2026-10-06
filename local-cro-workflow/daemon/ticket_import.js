// HubSpot ticket import.
//
// Receives a scraped ticket from the extension (see background.js `scrapeHubspotTicket`)
// and writes it to <workspace>/.tickets/<ticketId>-<slug>/ as Objective.md plus one file
// per inline image.
//
// The destination is dot-prefixed on purpose: daemon/watcher.js watches the whole
// workspace and its `ignored` regex skips dot-entries. A ticket attachment named
// `foo.js` landing in a watched folder would be cached, wrapped in the kameleoonQueue
// shim and injected into the live page. Dot-prefixing makes that structurally
// impossible rather than relying on extension filtering.
//
// Images are downloaded here, by Node, never base64'd over the WebSocket — the PNGs run
// ~650KB each and bridge request/response pairs are on short timeouts.

import fs from 'fs/promises';
import path from 'path';

const MAX_SLUG = 50;

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '') || 'ticket';

// --- HTML → markdown ---------------------------------------------------------------
// HubSpot rich text is a small, predictable subset: p/h1-h4/strong/em/ul/ol/li/a/img/br/
// code/blockquote. A full parser would be more than this needs.

const decodeEntities = (s) =>
  s.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

/**
 * Linear scan rather than balanced-pair regexes: HubSpot nests <ul> inside <li>, and a
 * non-greedy `<li>([\s\S]*?)</li>` matches the inner close first, flattening the nesting.
 * Reacting to open/close tags in document order keeps depth correct at any nesting level.
 *
 * @param {string} html
 * @param {{ urls: string[] }} imageSink collects image URLs in document order; the
 *   markdown gets `@@IMAGE:n@@` placeholders resolved later by position.
 */
const htmlToMarkdown = (html, imageSink) => {
  const src = String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');

  const out = [];
  const listStack = [];      // { type: 'ul'|'ol', n: number }
  const linkStack = [];      // { at: number, href: string }
  let inListItem = false;

  const push = (t) => { if (t) out.push(t); };
  const lastText = () => out.join('');
  // Block break that never stacks up more than one blank line.
  const blockBreak = () => {
    const t = lastText();
    if (!t || /\n\n$/.test(t)) return;
    push(/\n$/.test(t) ? '\n' : '\n\n');
  };
  const lineBreak = () => { if (lastText() && !/\n$/.test(lastText())) push('\n'); };

  const startListItem = () => {
    lineBreak();
    const depth = Math.max(0, listStack.length - 1);
    const cur = listStack[listStack.length - 1];
    const marker = cur && cur.type === 'ol' ? `${++cur.n}. ` : '- ';
    push('  '.repeat(depth) + marker);
    inListItem = true;
  };

  const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|[^<]+/g;
  let m;
  while ((m = TOKEN.exec(src)) !== null) {
    const raw = m[0];
    if (raw.startsWith('<!--')) continue;

    if (!raw.startsWith('<')) {
      const text = decodeEntities(raw).replace(/\s+/g, ' ');
      if (!text.trim()) {
        // Keep a single separating space between inline runs, never leading whitespace
        // (a line starting with spaces would render as an indented code block).
        if (text === ' ' && lastText() && !/[\s]$/.test(lastText())) push(' ');
        continue;
      }
      push(/\n$/.test(lastText()) || !lastText() ? text.replace(/^\s+/, '') : text);
      continue;
    }

    const tag = (m[1] || '').toLowerCase();
    const attrs = m[2] || '';
    const closing = raw[1] === '/';

    switch (tag) {
      case 'img': {
        if (closing) break;
        const srcAttr = (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
        if (!srcAttr) break;
        const alt = (attrs.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
        imageSink.urls.push(decodeEntities(srcAttr));
        blockBreak();
        push(`@@IMAGE:${imageSink.urls.length - 1}:${alt}@@`);
        blockBreak();
        break;
      }
      case 'br':
        if (inListItem) push(' ');
        else lineBreak();
        break;
      case 'p':
      case 'div':
        // Inside a list item HubSpot wraps the text in <p>; treating that as a block
        // would break the bullet onto its own line.
        if (inListItem) { if (closing) push(' '); }
        else blockBreak();
        break;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        blockBreak();
        if (!closing) push(`${'#'.repeat(Number(tag[1]))} `);
        else blockBreak();
        break;
      }
      case 'strong': case 'b': push('**'); break;
      case 'em': case 'i': push('*'); break;
      case 'code': push('`'); break;
      case 'ul': case 'ol':
        if (closing) { listStack.pop(); inListItem = false; if (!listStack.length) blockBreak(); }
        else { lineBreak(); listStack.push({ type: tag, n: 0 }); }
        break;
      case 'li':
        if (closing) inListItem = false;
        else startListItem();
        break;
      case 'blockquote':
        blockBreak();
        if (!closing) push('> ');
        break;
      case 'a': {
        if (closing) {
          const link = linkStack.pop();
          if (!link) break;
          const text = out.splice(link.at).join('').trim();
          push(text ? `[${text}](${link.href})` : '');
        } else {
          const href = (attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
          if (href) linkStack.push({ at: out.length, href: decodeEntities(href) });
        }
        break;
      }
      default:
        break;
    }
  }

  return out.join('')
    .replace(/\*\*\s*\*\*/g, '')          // empty bold from decorative markup
    .split('\n')
    // Strip stray leading whitespace, which markdown would read as an indented code
    // block — but keep the indent on list lines, where it carries the nesting level.
    .map((line) => (/^\s*(?:[-*]|\d+\.)\s/.test(line) ? line.trimEnd() : line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// --- image download ----------------------------------------------------------------

const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif'
};

// The extension comes from the response content-type, not the URL path: HubSpot paths
// carry a display name with spaces and percent-encoding, and the filemanager
// signed-url-redirect form has no extension at all.
const downloadImage = async (url, index, destDir, warnings) => {
  const label = `image-${String(index + 1).padStart(2, '0')}`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      // A CloudFront signature that has aged out is the one failure a user can fix.
      const hint = (res.status === 403 || res.status === 401)
        ? ' — image link expired or needs the HubSpot session; reopen the ticket and re-import'
        : '';
      warnings.push(`${label}: HTTP ${res.status}${hint}`);
      return null;
    }
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE[type];
    if (!ext) {
      warnings.push(`${label}: unexpected content-type "${type || 'none'}" — not saved`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) {
      warnings.push(`${label}: empty response body`);
      return null;
    }
    const filename = `${label}.${ext}`;
    await fs.writeFile(path.join(destDir, filename), buf);
    return filename;
  } catch (e) {
    warnings.push(`${label}: ${e.message}`);
    return null;
  }
};

// --- entry point -------------------------------------------------------------------

/**
 * @param {object} ticket scraped payload from the extension
 * @param {string} workspacePath
 * @returns {Promise<{folder:string, imageCount:number, warnings:string[], route:string}>}
 */
export async function importTicket(ticket, workspacePath) {
  const { ticketId, url, subject, bodyHtml, comments = [], route = 'unknown' } = ticket || {};
  if (!ticketId) throw new Error('No ticketId in the scraped ticket');
  if (!bodyHtml && comments.length === 0) {
    // Distinguish "nothing rendered" from "rendered, but this ticket's content is an
    // email thread" — the second is a real ticket shape this importer does not read,
    // not a breakage, and the two need very different responses from the caller.
    if (ticket.timelineEventCount > 0) {
      throw new Error(
        `Ticket ${ticketId} rendered with ${ticket.timelineEventCount} timeline event(s) but no ` +
        `readable Note body, no Description and no comments. If those events are emails, this ` +
        `importer does not read email threads — only the Note + comments and Description shapes. ` +
        `If one of them IS a note, its body selector has changed and scrapeHubspotTicket needs updating.`
      );
    }
    throw new Error(
      `Extraction (route: ${route}) returned an empty ticket — no body and no comments. ` +
      `The ticket may still be loading, or HubSpot's DOM changed.`
    );
  }

  const ticketsRoot = path.join(workspacePath, '.tickets');
  const folderName = `${ticketId}-${slugify(subject)}`;
  const destDir = path.join(ticketsRoot, folderName);

  // Re-import replaces. Drop any earlier folder for this same ticket id — including one
  // written under a different slug, and any image-NN files a shorter import would orphan.
  await fs.mkdir(ticketsRoot, { recursive: true });
  for (const entry of await fs.readdir(ticketsRoot).catch(() => [])) {
    if (entry === folderName || !entry.startsWith(`${ticketId}-`)) continue;
    await fs.rm(path.join(ticketsRoot, entry), { recursive: true, force: true });
  }
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(destDir, { recursive: true });

  const imageSink = { urls: [] };
  const bodyMd = htmlToMarkdown(bodyHtml, imageSink);
  const commentBlocks = comments.map((c) => {
    const heading = [c.author, c.timestamp].filter(Boolean).join(' — ') || 'Comment';
    return `## ${heading}\n\n${htmlToMarkdown(c.html, imageSink)}`;
  });

  const warnings = [];
  const localNames = [];
  for (let i = 0; i < imageSink.urls.length; i++) {
    localNames.push(await downloadImage(imageSink.urls[i], i, destDir, warnings));
  }

  // Plain markdown, not Obsidian wikilinks, so the file renders anywhere.
  // A failed download keeps its original URL so the page is still readable.
  const resolve = (md) => md.replace(/@@IMAGE:(\d+):([\s\S]*?)@@/g, (_, idx, alt) => {
    const i = Number(idx);
    return `![${alt}](${localNames[i] || imageSink.urls[i]})`;
  });

  const header = [
    `# ${subject || `Ticket ${ticketId}`}`,
    '',
    `- Ticket: ${ticketId}`,
    `- URL: ${url || ''}`,
    `- Imported: ${new Date().toISOString()}`,
    `- Extracted via: ${route}`,
    '',
    '---',
    ''
  ].join('\n');

  const markdown = [header, resolve(bodyMd), ...commentBlocks.map(resolve)]
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n') + '\n';

  await fs.writeFile(path.join(destDir, 'Objective.md'), markdown, 'utf8');

  return {
    folder: path.join('.tickets', folderName),
    imageCount: localNames.filter(Boolean).length,
    imageTotal: imageSink.urls.length,
    commentCount: comments.length,
    warnings,
    route
  };
}
