# Reply draft — #99 "[Bug] Queries time out"

Reproduced. Thank you for reporting it with the detail you did — the fact that it was the *MCP*
surface specifically is what made it findable.

## What is actually happening

`get_task_preflight` (and `drift prepare`, the same code path) loads and traverses the entire fact
graph on every call. Measured on a synthetic 20,000-file repository:

| Operation | Before | After |
|---|---|---|
| `prepare` / `get_task_preflight` | 30.8s | 27.7s |
| `repo map` | ~100s | ~100s |
| `ask` | 2.2s | **0.7s** |
| `scan status` | 2.1s | **0.6s** |

CPU profiling attributed the cost to `listGraphNodes`, `listGraphEdges` and `listGraphEvidence`,
each called several times per request, plus around five seconds of resulting garbage collection.

Part of that was a regression I had introduced: `getFactGraphArtifact` was hydrating the graph's
bulk collections eagerly, so every call ran three full table scans. That is now lazy, which is
where the improvement to `ask` and `scan status` comes from.

**The rest is not fixed.** `prepare` and `repo map` genuinely traverse the graph, and making them
fast needs scoped loading — `prepare` needs the neighbourhood of about ten files, not the whole
repository. That work is scoped but not done, and I would rather say so than leave you waiting on
a fix that has not shipped.

There is a second cost worth knowing about: a preflight packet is roughly 20,000 tokens. If your
client has a request timeout, a large packet over a slow call is likely what is hitting it.

## Workaround for now

`drift ask` and `drift scan status` are both sub-second and cover a lot of what preflight is used
for. If you are calling `get_task_preflight` on every turn, calling it once per task will help
considerably.

## On the second half of your request

> I would love it if one can with one cli just install the mcp into opencode

Not built. It is a fair ask and #98 asks for the same thing. I have not committed to it here
because I would rather not promise a command that does not exist.

Details: `docs/reference/performance.md`.
