# AGENTS.md

A local bridge between this workspace and a live Chrome tab. The agent edits `experiments/variation.{js,css}`, the daemon (`local-cro-workflow/`) injects them into the targeted tab, and the `local-cro-bridge` MCP tools read, drive and screenshot that tab. Setup and MCP config are in `local-cro-workflow/README.md`.

Instructions live only in `AGENTS.md` files, which both Claude Code and Codex read natively. Don't create a `CLAUDE.md` here: Claude Code then stops reading every `AGENTS.md` on the path.

Tool names in these files are bare `local-cro-bridge` tool names (`evaluate_js`). In Claude Code they appear as `mcp__local-cro-bridge__evaluate_js`.

## Push back with a better idea

If what the user asks for has a better solution, say so before doing it, in one or two sentences, with your recommendation. Then do what they decide. This is most important for general engineering and tooling: how to structure code, where a rule belongs, how to enforce something, how to use AI tools. There, offer your own view instead of complying by default. On Kameleoon and client specifics, the user's experience wins. Still flag it if something contradicts what you can measure.

## Browser work goes through the bridge

For experiment work (selectors, DOM, JS, screenshots, clicks), always use the `local-cro-bridge` tools and never a general-purpose browser tool such as claude-in-chrome. The bridge targets the user's real tab. If its tools aren't available, the MCP server isn't connected: say so and ask the user to check the daemon and extension. Don't fall back silently.

The **target tab** is set in the extension popup with "Target This Tab". It's pinned by tab ID, so it survives reloads and navigation. Without one, injection falls back to the active tab. Every save to a variation file wraps the JS in try/catch, reloads the page and re-injects.

## The Kameleoon app: hard rules

- Kameleoon API calls run inside the user's logged-in `app.kameleoon.com` tab. **Never automate login or client impersonation**, and never try to read the session. If no app tab is open, ask the user to open one.
- **Reading is free.** Use the read-only tools (`list_kameleoon_experiments`, `get_kameleoon_code`, `get_kameleoon_results`) or `GET` calls to `api.kameleoon.com` from the app tab whenever they help, without asking.
- **Any change in the app needs the user's explicit yes first**, every time: creating or editing experiments, variations, goals or scripts, pushing code, changing traffic or status. Say exactly what you will change, then wait. A yes covers that one change, not later ones. The results `POST` in `get_kameleoon_results` is the exception: it only computes a report.
- That yes is also what allows `confirmed: true` or `overwrite: true`. Never pass either on your own.
- Nothing is ever deleted.

## Procedures

These live in `.claude/skills/<name>/SKILL.md`. Claude Code loads them automatically. Other agents should read the file when the task matches.

| Skill | When |
|---|---|
| `kameleoon-publish` | Push or publish to the Kameleoon app; create variations, goals or experiments |
| `kameleoon-qa` | Verify a variation in a real simulation, before calling it working |
| `kameleoon-graphic-editor` | Read, fix or edit a variation inside the graphic editor tab |
| `variation-patterns` | Tested code for changes a site keeps undoing, once the hydration ladder didn't hold |
| `debug-layout-and-focus` | Layout jumps or collapses after load, scroll jumps, Tab/focus problems |
| `diagnose-kameleoon-app` | A page in app.kameleoon.com won't load or shows wrong data |
| `find-session` | Find a past Claude Code conversation |

## Memory

Your persistent memory (in Claude Code, the auto-memory folder; its `MEMORY.md` index is loaded each session) holds findings, not rules. Manage it without being asked.

**Reuse.** Before working on a client, site, experiment or tool, scan the index for its name, sitecode or topic and read the matching notes. Past code for the same site is in `experiments/.archive/*/variation.js`; grep their `// Site: <host>` line. Verify a note against the live page or code before relying on it, and fix or delete it if it's wrong.

**When to consider saving:** at the end of an investigation or bug fix, after the user corrects you, or when something surprised you because you measured it.

**Save only if all three hold:**
1. It isn't already in the Kameleoon docs (search the Mintlify MCP), in an `AGENTS.md`, in a skill, or in the code or git history.
2. Rediscovering it would cost real time: a measured client quirk, an app internal, a diagnostic pattern, a dead end.
3. It will still be true next month, or carries a date when it may not be.

**How:** update an existing note before creating one. Keep the measured facts with their date, link to the docs instead of restating them, and decide what's general before filing anything under a client. Take out the site's name, selectors and data: if what's left still explains the fix, it's a general mechanism; if it's the site's data or configuration, it's site-specific. Most findings are both, so split them. Promote a mechanism to the skill only when it's understood (framework or browser behaviour) or has been seen on a second site; otherwise mark it "likely general" in the note and promote it when it repeats. Keep code where it's found. A technique that would work on other sites goes in the `variation-patterns` skill, copied from code that ran and stripped of client details. A client-only trick goes in its note as a short snippet copied from code that ran (never rewritten from memory), with the archive folder (`experiments/.archive/<folder>`) as its source. Keep client names and sitecodes in memory, never in the repo. A general *rule* the user gives you belongs in this file or a skill (propose the edit), not in memory. When saving, tell the user in one line what you saved; when you skip something because it's already covered, say nothing.

## Committing and pushing

When a change to the bridge itself (`local-cro-workflow/`, `scripts/`, `.claude/skills/`, these instruction files, lint config) is done and verified, commit it and push to `origin main` without asking. Verified means it ran: the tool was exercised live, or the daemon restarted cleanly and the changed path was hit. Make one commit per logical change, with a message that says what changed and why.

**The GitHub repo is public.** Client material must never be committed:
- Stage explicit paths only. Never use `git add -A`, `git add .` or `git commit -a`.
- Never stage `experiments/.archive/`, `experiments/.tickets/`, `memory/`, `variation.js`, `variation.css`, or anything containing a client name, sitecode, ticket id, client URL or credential.
- Read `git diff --cached` for client data before committing. If in doubt, leave it out and ask.

If the push fails, report it and keep the commit local. Never force-push, and never rebase or amend pushed commits.
