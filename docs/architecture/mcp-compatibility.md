# MCP compatibility finding (T47)

**Verdict: ship the MCP surface at beta as-is. Not launch-blocking.**

## What was measured

The server is hand-rolled and pins `DRIFT_MCP_PROTOCOL_VERSION = "2024-11-05"`. The concern was
that a beta whose agent surface speaks a retired revision would undermine the differentiator.

Probed `packages/mcp/dist/bin.js` over stdio with four client-declared protocol versions:

| Client declares | Server response |
|---|---|
| `2024-11-05` | accepted, replies `2024-11-05` |
| `2025-03-26` | accepted, replies `2024-11-05` |
| `2025-06-18` | accepted, replies `2024-11-05` |
| `2026-07-28` | accepted, replies `2024-11-05` |

It never rejects. It ignores what the client asked for and states its own version — which is the
**spec-correct** posture: the server declares what it supports and the client decides whether to
proceed or disconnect.

A full session then completes against a client declaring `2025-06-18`:

```
initialize  -> ok, server version 2024-11-05
tools/list  -> 12 tools
tools/call  -> ok, returned content
```

So the failure mode is not the server rejecting modern clients. It is a client refusing an old
revision, which is client-side policy.

## Why the cited breaking changes mostly do not apply

The plan flags three changes: removal of the `initialize` handshake and `Mcp-Session-Id`, moving
version and capabilities into per-request `_meta`, and replacing SSE round-trips with
`InputRequiredResult`.

Two of those are **HTTP transport concerns**. This server is stdio-only: it has no
`Mcp-Session-Id`, no SSE, and no HTTP surface at all, so their removal changes nothing here. The
handshake change would matter, but a server that answers `initialize` and also tolerates being
sent one it does not need is compatible in both directions.

## Honest limit on this finding

**I could not verify the 2026-07-28 revision exists or what it contains.** My knowledge cutoff
predates it, and I have no network evidence in this run. Everything above is measured against the
server's actual behaviour, which is solid regardless — but the specific claim that a revision
lands on 2026-07-28 removing the handshake is *unverified*, and the go/no-go below should be
re-checked against the real specification before launch.

The other limit: I tested one client implementation (a scripted stdio client following the spec).
The DoD asked for two real clients. A second — Claude Code or another agent host connecting to
`drift-mcp` — would strengthen this, and is the one thing worth doing before relying on it.

## Go / no-go

**Go**, with two conditions:

1. Confirm the 2026-07-28 revision's contents against the published spec. If it genuinely removes
   `initialize`, add tolerance for its absence — a few lines, since the server already ignores
   what it does not recognise.
2. Connect one real agent host end-to-end and record the result.

Neither blocks beta. The server negotiates correctly, degrades gracefully, and serves a working
session to a client two revisions newer than its own.

## If a client does reject 2024-11-05

The cheapest fix is to echo the client's requested version when it is one the server can honestly
serve, rather than always asserting its own. That is a real decision, not a formality: echoing a
version implies supporting its semantics, so it should only be done for revisions whose
differences do not affect a stdio server. T52 (adopt the official SDK) removes the question
entirely by making negotiation someone else's problem.
