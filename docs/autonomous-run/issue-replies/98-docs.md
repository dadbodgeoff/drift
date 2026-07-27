# Reply draft — #98 "[Feature] better docs"

> Please have in the readme a simple (one line cli) how to install it into opencode.

Partly addressed, and the specific thing you asked for is **not** built. Taking those separately
so this is not misleading.

## What changed

The README now opens with what Drift does in one sentence and four lines of shell, followed by a
scope table stating what it does *not* do. There are three new documents:

- `docs/quickstart.md` — install through to a first blocked change
- `docs/concepts.md` — facts → contract → baseline → check
- `docs/agent-integration.md` — MCP, hooks, CI

`agent-integration.md` covers running the MCP server, including the caveats: the preflight packet
is around 20,000 tokens, and edit-time hooks are not shipped because a single-file check currently
takes about four seconds against a one-second target.

## What is not built

A one-line installer for opencode. Today it is:

```bash
drift-mcp --db ~/.drift/repos/<repo_id>/drift.sqlite
```

pointed at your client's MCP config, with the repo id from `drift start`. That is two steps and a
lookup, which is not what you asked for.

I have not built the installer because I do not want to ship a command that half-works across
several clients' config formats. If opencode specifically is the priority, say so on this issue
and it becomes a much smaller job than a general solution.

Worth flagging: #99 reports MCP query timeouts, and that is real and only partly fixed. An
installer that makes it easier to reach a slow surface would not be doing you a favour yet.
