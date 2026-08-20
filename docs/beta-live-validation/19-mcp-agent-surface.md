# CHARTER 19 — MCP and agent-facing surface

**Depends on:** 09 · **Est. 3 h** · **Output:** `results/19-mcp-agent-surface.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 19 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 19 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 19` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Drift's agent surface is a **hand-rolled** JSON-RPC 2.0 implementation over a manual stdio line
reader, with no dependency on the official Model Context Protocol SDK (§22 obs. 19). This charter
tests protocol conformance against a real MCP client, tool correctness against the CLI's own
answers, and behavior under malformed input — the three things an SDK would otherwise have given
for free.

## 2. Mechanism under test

`packages/mcp/src/` — `index.ts`, `tools.ts`, `types.ts`, `security-context.ts`, `bin.ts`.

- `handleMcpJsonRpcRequest` (`index.ts:694-762`) matches on `request.method` with if-statements for
  `"initialize"`, `"tools/list"`, `"tools/call"`, constructing `{jsonrpc, id, result}` by hand
  (`:915-921, 923-938`).
- `runReadOnlyMcpStdioServer` (`:764-798`) — `node:readline` over `process.stdin`, one JSON per
  line, `JSON.stringify(result)+"\n"` to stdout. No `StdioServerTransport`.
- `DRIFT_MCP_PROTOCOL_VERSION = "2024-11-05"`, a literal constant (`:130`).
- **12 tools** (`tools.ts:4-193`, `DRIFT_READ_ONLY_MCP_TOOLS`): `get_runtime_info`,
  `get_capabilities`, `get_audit_status`, `get_scan_status`, `get_repo_contract`, `get_repo_map`,
  `get_security_context`, `get_task_preflight`, `get_conventions`, `get_findings`,
  `get_required_check_executions`, `get_allowed_context`. Handlers in `createReadOnlyMcpHandlers`
  (`:133-691`).
- `--db` is required **exactly** — `resolveMcpDatabasePath` (`:955-963`) has no fallback of any
  kind. Missing → `Missing --db <path> or DRIFT_DB for drift-mcp.\n`, exit 1 (`:826-829`).
- CLI-side agent surface: `drift ask` (`commands/ask.ts:15-139`) and `drift prepare`
  (`commands/prepare.ts:28-391`), both single-payload with a render-time branch, both declaring
  `snippets_included: false, source_content_included: false` (`ask.ts:116-117`).

## 3. Procedure

### Protocol conformance

| Probe | What to do |
|---|---|
| P-19-01 | `initialize` handshake. Confirm the response's `protocolVersion`, `capabilities`, and `serverInfo` shape against the MCP 2024-11-05 specification. |
| P-19-02 | Negotiate a **different** `protocolVersion` from the client. What does a server with a hard-coded literal do? |
| P-19-03 | `tools/list`. Confirm all 12 tools with valid JSON Schema `inputSchema` for each. Validate each schema against the JSON Schema metaschema. |
| P-19-04 | `tools/call` for each of the 12, with valid arguments. Record the full response. |
| P-19-05 | Connect a **real** MCP client (Claude Desktop, `mcp` CLI, or the official SDK's client) and drive the full session end to end. A hand-rolled server passing hand-rolled tests proves nothing; an independent client is the oracle. |
| P-19-06 | Methods the server does not implement: `resources/list`, `prompts/list`, `ping`, `notifications/initialized`, `completion/complete`. Oracle: a well-formed JSON-RPC error object with code `-32601`, not a crash and not silence. |
| P-19-07 | JSON-RPC framing: a batch request (array); a notification (no `id`); `id: null`; `id` as a string; `id` as a float; a duplicate `id`. |
| P-19-08 | Line-reader edge cases — the transport is a manual line reader, so these are the real risk: a request longer than the reader's buffer; a request with an embedded newline in a string value; `\r\n` endings; two JSON objects on one line; one JSON object split across two lines; a very large response (a `get_repo_map` on a 20,000-file repo — does it emit one enormous line, and can a client consume it?). |
| P-19-09 | Malformed input: invalid JSON, valid JSON that is not an object, missing `jsonrpc`, wrong `jsonrpc` version, missing `method`. Oracle: `-32700` / `-32600` as appropriate; the server stays alive. |
| P-19-10 | Lifecycle: stdin closed mid-request; SIGTERM; SIGPIPE on stdout; a client that never sends `initialize` and calls `tools/call` first. |

### Tool correctness

| Probe | What to do |
|---|---|
| P-19-11 | For each of the 12 tools, compare its answer against the equivalent CLI command's `--json` output on the same state. Any divergence is a finding: two surfaces, one truth. Mapping is roughly `get_scan_status`↔`scan status`, `get_repo_contract`↔`contract show`, `get_repo_map`↔`repo map`, `get_conventions`↔`conventions accepted`, `get_findings`↔`findings list`, `get_task_preflight`↔`prepare`, `get_capabilities`↔`capabilities`, `get_audit_status`↔`audit verify`. Establish the rest empirically. |
| P-19-12 | **Read-only enforcement.** The package declares itself read-only. Attempt to mutate through every tool: arguments that look like writes, path traversal in a repo/path argument, a `--db` pointing at a database the process should not touch. Confirm the database is byte-identical before and after a full tool sweep (checksum it). |
| P-19-13 | `get_security_context` and `get_allowed_context` — these gate what an agent is allowed to see. Establish exactly what they return and confirm charter 21's privacy oracles hold for them. |
| P-19-14 | Missing `--db`: confirm the exact string `Missing --db <path> or DRIFT_DB for drift-mcp.` and exit **1**. Confirm no auto-resolution of any kind — contrast with the CLI's per-command inconsistency (charter 03). |
| P-19-15 | A `--db` pointing at: a nonexistent file, a corrupt database, a database at a newer schema version. |
| P-19-16 | Stale state: run tools while the repo has changed since the last scan. Does the agent get a stale answer, or a stated staleness? An agent acting on a silently stale contract is the failure mode that matters here. |

### The CLI agent surface

| Probe | What to do |
|---|---|
| P-19-17 | `drift prepare "<task>"` and `drift ask "<question>"`, text and `--json`. Confirm the single-payload/branch-at-render structure holds — one payload, two renderings, no divergence. |
| P-19-18 | Confirm `redactions.snippets_included === false` and `source_content_included === false` in the payload, then **grep the entire payload for source content** from the repo. The declaration and the reality are two different claims. (Charter 21 owns the full sweep.) |
| P-19-19 | `prepare` with ≥ 10 touched paths — the `.slice(0, 10)` ceiling (`graph-preflight.ts:35-38`). Is the truncation disclosed to the agent, or silent? An agent told about 10 of 30 affected files, without being told there are 30, is being misled. |
| P-19-20 | `get_required_check_executions` and `drift checks run` — the required-check loop an agent is expected to close. Drive it end to end. |
| P-19-21 | Validate every response against `docs/architecture/agent-response-contract.md`. Run `pnpm check:surface-parity` and reconcile. |

## 4. Benchmarks

| Metric | How |
|---|---|
| Per-tool latency | 20 trials each, warm |
| `get_repo_map` latency and payload size vs. repo size | 500 / 5,000 / 20,000 |
| `get_task_preflight` p95 | 20 trials — the number an interactive agent pays |
| Server startup time | 10 trials |
| Peak RSS over a 100-call session | 1 |
| Sustained throughput | 1,000 sequential `tools/call`s; look for leaks or degradation |

## 5. Oracles

- An independent, spec-compliant MCP client completes a full session.
- Every unimplemented method returns a well-formed JSON-RPC error; nothing crashes the server.
- Every tool's answer equals the CLI's answer on the same state.
- The database is byte-identical after a full tool sweep.
- No source content appears in any response.
- Every truncation is disclosed.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-19-1 | The server is hand-rolled JSON-RPC over a manual stdio line reader with zero MCP SDK dependency. | §20g, §22 obs. 19 | P-19-05 is the real test of what that costs |
| S-19-2 | `DRIFT_MCP_PROTOCOL_VERSION` is a hard-coded literal with no negotiation. | §20g, `index.ts:130` | P-19-02 |
| S-19-3 | MCP applies one strict `--db` rule uniformly across all 12 tools, unlike the CLI's per-command resolution. | §20g, §22 obs. 19 | P-19-14 |
| S-19-4 | `ask` and `prepare` declare no snippets and no source content are included. | §20g, `ask.ts:116-117` | P-19-18 |
| S-19-5 | `prepare` silently caps at 10 paths. | §3.2, §19c, `graph-preflight.ts:35-38` | P-19-19 |
| S-19-6 | `test/e2e/mcp-bin.test.ts` exists; its assertions were never read. Determine what it covers and what these probes add. | §20b | Read it first |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). A server crash gets the request that caused it recorded
verbatim, plus whether the process stayed alive; then the charter continues with a fresh server.

## 8. Deliverables

`results/19-mcp-agent-surface.md` with the 12-tool × CLI-parity table and the protocol conformance
matrix; full JSON-RPC session transcripts under `results/artifacts/19/`.
