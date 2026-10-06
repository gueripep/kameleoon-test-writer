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
- Anything that changes live traffic or overwrites code requires the user's explicit yes before you pass `confirmed: true` or `overwrite: true`.
- Nothing is ever deleted.

## Procedures

These live in `.claude/skills/<name>/SKILL.md`. Claude Code loads them automatically. Other agents should read the file when the task matches.

| Skill | When |
|---|---|
| `kameleoon-publish` | Push or publish to the Kameleoon app; create variations, goals or experiments |
| `kameleoon-qa` | Verify a variation in a real simulation, before calling it working |
| `debug-layout-and-focus` | Layout jumps or collapses after load, scroll jumps, Tab/focus problems |
| `diagnose-kameleoon-app` | A page in app.kameleoon.com won't load or shows wrong data |
| `find-session` | Find a past Claude Code conversation |

## Committing and pushing

When a change to the bridge itself (`local-cro-workflow/`, `scripts/`, `.claude/skills/`, these instruction files, lint config) is done and verified, commit it and push to `origin main` without asking. Verified means it ran: the tool was exercised live, or the daemon restarted cleanly and the changed path was hit. Make one commit per logical change, with a message that says what changed and why.

**The GitHub repo is public.** Client material must never be committed:
- Stage explicit paths only. Never use `git add -A`, `git add .` or `git commit -a`.
- Never stage `experiments/.archive/`, `experiments/.tickets/`, `memory/`, `variation.js`, `variation.css`, or anything containing a client name, sitecode, ticket id, client URL or credential.
- Read `git diff --cached` for client data before committing. If in doubt, leave it out and ask.

If the push fails, report it and keep the commit local. Never force-push, and never rebase or amend pushed commits.
