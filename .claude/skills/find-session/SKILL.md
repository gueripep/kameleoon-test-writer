---
name: find-session
description: Find a past Claude Code session (conversation) by topic and give the resume command. Use when the user asks for "the convo about X", "that session where we…", or wants to resume earlier work.
---

# Finding a past Claude Code session

"The convo about X" means a Claude Code session, not Slack or HubSpot. Sessions are JSONL files in `~/.claude/projects/<cwd with / replaced by ->/<session-id>.jsonl`. Most client work is in the folder for `kameleoon-test-writer/experiments`. Also check the parent repo's folder and the Obsidian `Dump` folder.

```bash
cd ~/.claude/projects && grep -lis -e "<term>" -e "<other term>" ./*/*.jsonl
```

- **Prefix the glob with `./`.** The folder names start with `-`, so a bare `*/*.jsonl` is read as grep options and silently returns nothing.
- **Search client-specific terms**, such as the custom data name, the `[ABC]`-style ticket prefix or the ticket id. A brand named in `MEMORY.md` matches every session, because the memory index is loaded into all of them. Rank by hit count (`grep -oi … | wc -l`): a handful of hits is just the memory index, hundreds is the real session.
- **Identify a session** by its first real user prompt (`type: "user"`, content not starting with `<`) and its mtime (`date -r <file>`). Exclude the current session's id.

Give the user the session id and `claude --resume <id>`, to run from that session's folder.
