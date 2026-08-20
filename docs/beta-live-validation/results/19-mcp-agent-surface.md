# CHARTER 19 — MCP and agent-facing surface — RESULTS

**Agent:** Claude Opus 5 (claude-sonnet-5 runtime), beta-live-validation subagent
**Run started:** 2026-08-19T15:30:00-04:00
**Run finished:** 2026-08-19T16:20:00-04:00
**Commit under test:** a0517f3e8804da9ebf95840bc333fc07a0c06573 (`git rev-parse HEAD` in `$DRIFT_BETA_SRC`)
**Working tree:** clean (frozen checkout under `/tmp/drift-beta-freeze/src`)
**Engine binary:** `/tmp/drift-beta-freeze/src/target/release/drift-engine` · env_override · `drift-engine version` → `{"build_profile":"release","engine_version":"0.1.0","schema_version":"engine.version.result.v1"}` · `DRIFT_ENGINE_BIN` exported: yes
**Platform:** `Darwin Mac.lan 24.6.0 Darwin Kernel Version 24.6.0: Mon Jul 14 11:30:40 PDT 2025; root:xnu-11417.140.69~1/RELEASE_ARM64_T8132 arm64`
**Node / pnpm / rustc:** node v25.2.1 · pnpm 10.28.0 · rustc 1.97.0 (2d8144b78 2026-07-07)

Subjects under test: `packages/mcp/dist/bin.js` (the built `drift-mcp` binary) and `packages/cli/dist/main.js`
(the built `drift` CLI), both built from the frozen commit. Two workspaces were used: `taxonomy`
(132 indexed files, `repo_68a494d2b8491ebb`) for all protocol/correctness/error-handling probes,
and `calcom` (5,066 indexed files, `repo_5e88d5e631c551be`) for the large-repo/benchmark probes
that need a bigger corpus. Both cloned from `$DRIFT_EVAL_REPOS` via `workspace.sh`, each in its own
`/tmp/drift-beta.19.*` state root.

## 1. Verdict

The hand-rolled JSON-RPC server survives contact with the real thing: an official
`@modelcontextprotocol/sdk` client connects, negotiates, lists all 12 tools, calls two of them, and
gets a clean protocol-level error on an unknown tool name — a full session, no crash (P-19-05).
Read-only enforcement is solid under adversarial pressure: path traversal, write-shaped extra
fields, and a bogus `--db`-in-arguments field are all rejected by schema validation before they
reach storage, and the database is byte-identical after a 12-tool sweep plus 18 hostile calls
(P-19-12). Staleness is never hidden — `get_scan_status` reports `stale: true` with the exact
changed-file list, and `get_task_preflight --require_fresh` fails closed with a named
`stale_scan` code rather than silently answering from old state (P-19-16), directly refuting the
concern that a stale scan might be served silently. Bad databases (missing, corrupt, unmigrated-forward) all fail closed with
classified `-32000` errors carrying a `user_action` and `recovery_commands`, never a raw SQLite
string (P-19-15).

Against that, four things are now known that were not known before this charter ran, three of them
real defects and one a confirmed-but-intentional design decision:

1. **`--db` is unforgiving in a way the CLI is not.** `drift-mcp` refuses to start without `--db`
   or `DRIFT_DB` — exact message, exit 1, no fallback of any kind (P-19-14). The CLI, given the
   same absent flag, does not complain about `--db` at all: it silently resolves state from
   `~/.drift/repos/<fingerprint>` (P-19-14-cli-contrast).
2. **The line reader crashes uncaught on a broken pipe.** Closing the client's read end of stdout
   and then writing to it throws an unhandled `EPIPE` inside `runReadOnlyMcpStdioServer`, and the
   process dies with exit 1 and a raw Node stack trace on stderr (P-19-10). This is the one
   genuine crash found in this charter; every other adversarial input (malformed JSON, wrong
   `jsonrpc` version, batch arrays, SIGTERM) left the process alive and answering.
3. **`protocolVersion` is not negotiated, and `jsonrpc` is not validated at all.** Sending a client
   `protocolVersion` of `"2025-06-18"` gets back the hard-coded `"2024-11-05"` regardless
   (P-19-02). Independently, and more surprising: a request with `jsonrpc`
   entirely absent, or set to `"1.0"`, is processed as if it were valid — the field is never read
   anywhere in `handleMcpJsonRpcRequest` (P-19-09). A JSON value that parses but is not an object
   (a bare `42`, or a JSON array) throws a `TypeError` on `request.method.startsWith(...)` before
   the method's own `try`/`catch`, and that exception is caught by the *outer* parse-error handler,
   so it is reported as `-32700` (parse error) even though `JSON.parse` succeeded — the wrong error
   family for what actually went wrong, though still well-formed and non-fatal (P-19-09).
4. **`prepare`'s 10-path truncation is real and its disclosure field is a hardcoded lie.**
   `graph-preflight.ts:38`'s `.slice(0, 10)` does cap `paths` at 10 as charted. On a task
   that surfaces 25 relevant files, `graph_context.affected_files` comes back with exactly 10
   entries while `redactions.context_truncated` reads `false` — because `prepare.ts:223` sets
   `context_truncated: false` as a literal, never computed from whether truncation happened
   (P-19-19). An agent reading the redactions block has no way to know 15 files were dropped.
5. **Two tools' payloads diverge structurally from their CLI counterparts, not just cosmetically.**
   `get_findings`'s MCP shape renames `id`→`finding_id`, drops `repo_id`/`check_id`/
   `repo_contract_id`, and replaces the CLI's full `evidence_refs` array with a slimmer
   `file_refs`; `get_capabilities`'s MCP payload has no `claims_manifest`, `engine`, or
   `machine_contract_versions` keys that the CLI's `capabilities --json` carries (P-19-11). Given
   MCP's declared read-only/redaction posture this reads as intentional privacy narrowing rather
   than a bug, but it is still "two surfaces, one truth" divergence per this charter's own
   objective, and it means an agent cannot assume `get_findings` and `findings list --json` name
   the same field for the same fact.

None of the above compromise the two hardest safety properties this charter tested: the database
never mutates through MCP, and no source content or snippet ever appears in a payload declaring
`snippets_included: false` (P-19-12, P-19-18 both hold with a live grep, zero hits).

| | Count |
|---|---|
| Probes specified | 21 |
| Probes executed | 21 (all; several run as multiple named sub-probes to isolate distinct assertions) |
| Probes blocked (could not be executed — see §5) | 0 |
| Probes that behaved as the charter's oracle predicted | 15 |
| Probes that did not | 6 (P-19-02, P-19-06 partial, P-19-09, P-19-10, P-19-11, P-19-19) |
| Defects found not predicted by any suspect-list entry | 2 (uncaught EPIPE crash; `jsonrpc` field never validated) |

## 2. Probe log

One row per probe/sub-probe, in charter order. Full transcripts are under
`results/artifacts/19/<probe-id>.out` / `.err` (copied from the harness ledger's
`$DRIFT_BETA_ARTIFACTS/19/`).

| Probe | Command (verbatim) | Exit | Observed | Oracle | Match |
|---|---|---|---|---|---|
| P-19-01 | `python3 mcp_send.py $WS_DB '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'` | 0 | `protocolVersion:"2024-11-05"`, `capabilities.tools:{}`, `serverInfo` present | shape matches MCP 2024-11-05 initialize response | yes |
| P-19-02 | same, `protocolVersion:"2025-06-18"` in params | 0 | server still returns `"2024-11-05"` regardless of requested version | negotiation or rejection expected | no — no negotiation, see §4 |
| P-19-03 | `tools_list_check.py $WS_DB` (12 names + structural schema check + metaschema-shape validation) | 0 | `tools=12 names_match=True all_schemas_valid=True` | all 12 tools present, valid `inputSchema` | yes |
| P-19-04 | `call_all_tools.py $WS_DB $REPO_ID` (all 12 tools, valid args) | 0 | `n_responses=12 errors=0`; every tool returned a `response_schema`-tagged JSON payload | all 12 tools answer | yes |
| P-19-05 | `client.mjs` (official `@modelcontextprotocol/sdk` v1.30.0 stdio client) — connect, listTools, callTool ×2, callTool on unknown name, close | 0 | `CONNECTED_OK`, `TOOLS_COUNT: 12`, both calls `isError:false`, unknown tool → SDK throws on a well-formed `-32000` error, `CLOSED_OK` | an independent, spec-compliant client completes a full session | yes |
| P-19-06 | `unimplemented_methods.py $WS_DB` — `resources/list`, `prompts/list`, `ping`, `notifications/initialized`, `completion/complete` | 0 | 4 well-formed `-32601` errors (one per non-notification method); the notification got no response, as required | every unimplemented method returns `-32601`, nothing crashes | yes, with a note: `ping` — a core MCP liveness method most servers answer `{}` — is also routed through `-32601` rather than answered; see §6 |
| P-19-07 | `framing_edge_cases.py $WS_DB` — batch array, notification-with-no-id, `id:null`, `id` string, `id` float, duplicate `id` | 0 | see below | framing edge cases handled without crash | no — 2 real findings, see below |
| P-19-08 | `line_reader_edge_cases.py $WS_DB` — 2MB task string, escaped-newline-in-string, CRLF, two objects on one line, one object split across two lines | 0 | all five handled correctly: long line answered normally, CRLF stripped and answered, escaped newline treated as one line and answered, the two malformed-framing cases both got well-formed `-32700` | line-reader edge cases don't corrupt framing or crash | yes |
| P-19-08-large | `big_repo_map.py $WSL_DB $REPO_ID_L` — `get_repo_map` on the 5,066-file `calcom` corpus | 0 | one line, 5,175,237 bytes, valid JSON, 94.62s elapsed | "one enormous line", client can consume it | yes, consumable — but see §3 for the latency this implies |
| P-19-09 | `malformed_input.py $WS_DB` — invalid JSON, JSON `42`, JSON array, missing `jsonrpc`, `jsonrpc:"1.0"`, missing `method`, then a trailing well-formed request | 0 | see below | `-32700`/`-32600` as appropriate; server stays alive | no — 2 real findings, see below |
| P-19-10 | `lifecycle.py $WS_DB` — stdin closed mid-request, no-initialize-first `tools/call`, SIGTERM mid-session, SIGPIPE on stdout | 0 (harness wrapper; SIGPIPE sub-case itself exits 1) | mid-request EOF → clean `-32700`; no-initialize `tools/call` → answered normally (stateless); SIGTERM → exits `-15`, no hang, no garbage; **SIGPIPE → uncaught `EPIPE`, exit 1, raw stack trace** | server survives lifecycle events per Failure Protocol | no — SIGPIPE is a real crash, see §5 F-19-1 |
| P-19-11 | `tool_vs_cli.py $WS_DB $REPO_ID` — 7 tool/CLI pairs compared field-for-field | 0 | `get_scan_status`, `get_repo_contract`, `get_conventions`, `get_audit_status` byte-identical; `get_repo_map` differs only in `generated_at` timestamp; `get_findings` and `get_capabilities` diverge structurally | every tool's answer equals the CLI's answer on the same state | no for 2 of 7 — see §1 and §6 |
| P-19-12 | `readonly_sweep.py $WS_DB $REPO_ID` — 12 valid calls + 6 hostile calls (write-shaped fields, path traversal ×3, forged `--db` arg, forged repo_id traversal), SHA-256 before/after | 0 | `db_unchanged: true`; every hostile call rejected pre-storage by `additionalProperties:false` schema validation or a repo-relative-path check | DB byte-identical after full sweep | yes |
| P-19-13 | `p13_check.py $WS_DB $REPO_ID <path>` — `get_security_context` shape + `get_allowed_context` with `request_full_file_content:true` | 0 | `get_security_context` returns `drift.security.context.v2` with route/proof metadata, no source; `get_allowed_context` denies full file content by default policy (`mode:"denied"`, `approved_snippet_chars:0`) even when explicitly requested | establish exact return shape; charter 21 privacy oracles hold | yes |
| P-19-14 | `node bin.js` (no `--db`, no `DRIFT_DB`) | 1 | stderr byte-exact `Missing --db <path> or DRIFT_DB for drift-mcp.\n` | exact string, exit 1 | yes |
| P-19-14-cli-contrast | `node main.js scan status --repo repo_x` (no `--db`) | 1 | `Unknown repo repo_x. Run drift scan --repo-root <path> first.` — no complaint about a missing `--db` at all | contrast with CLI's per-command resolution | yes — see §4 |
| P-19-15-nonexistent | `mcp_send.py /tmp/does-not-exist-19.db get_scan_status` | 0 | classified `-32000`, `"code":"cli_error"`, "not migrated... Missing migrations: 001...036" | fails closed, not a raw error | yes |
| P-19-15-corrupt | `mcp_send.py <4KB /dev/urandom file> get_scan_status` | 0 | classified `-32000`, `"code":"corrupt_database"`, `"message":"file is not a database"`, recovery commands given | fails closed, classified (not raw SQLite string) | yes |
| P-19-15-newerschema | `mcp_send.py <db + injected 999_future_migration row> get_scan_status` | 0 | classified `-32000`, `"Drift read-only MCP database has unsupported migrations: 999_future_migration."` | fails closed, classified | yes |
| P-19-16 | `get_scan_status` after an uncommitted-then-committed source edit, then `get_task_preflight --require_fresh=true` and without | 0 | `stale:true` with the exact changed-file list; `require_fresh=true` → `-32000 stale_scan`; without → stale context still returned, staleness disclosed in the payload | agent gets stated staleness, not a silent stale answer | yes — refutes a silent-staleness reading |
| P-19-17-text / -json | `drift prepare "..." --repo $REPO_ID [--json]` | 0 / 0 | text and JSON renders of the same payload; JSON carries `response_schema:"drift.task.preflight.v1"` | one payload, two renderings | yes |
| P-19-17-ask-text / -json | `drift ask "..." --repo $REPO_ID [--json]` | 0 / 0 | same pattern for `ask` | one payload, two renderings | yes |
| P-19-18 | `source_leak_sweep.py` — `redactions.snippets_included`/`source_content_included` on `prepare` and `ask`, then a grep of 33 distinctive source lines from the file with an open finding against both payloads | 0 | all four flags `false`; `verbatim_source_hits: []` | declaration matches reality | yes |
| P-19-19 | `truncation_check.py $REPO_ID_L $WSL_DB` — `prepare` on a task with 25 relevant files | 0 | `n_relevant_files:25`, `n_affected_files_in_graph_context:10`, `context_truncated_flag:false`, `actually_truncated:true` | truncation disclosed | no — disclosure field is a hardcoded `false`, see §4 |
| P-19-20-list | `drift checks list --repo $REPO_ID --json` | 0 | 1 required check (the `drift check --diff ... --json` baseline), 0 safe commands approved | lists required checks and safe commands | yes |
| P-19-20-run | `drift checks run --repo $REPO_ID --command "drift check --diff main...HEAD ... --json" --json` | 1 | refused: `"Command is not an approved safe command: ..."`, well-formed error+failure+agent_envelope | required-check loop closes or refuses cleanly | yes — documented refusal, contract-governed (no safe commands approved for this fresh repo) |
| P-19-20-mcp | `get_required_check_executions` via MCP for the same repo | 0 | `executions:[]`, `latest_passed_count:0`, `latest_failed_count:0` — honestly empty, matching that nothing has run | stored proof reflects reality | yes |
| P-19-21-surface-parity | `pnpm check:surface-parity` (`node scripts/surface-parity.mjs`, run from repo root) | 0 | `surface parity: 622 CLI and 131 MCP function bodies compared, 40 recorded duplicate(s) (9 module-private), 0 [unrecorded]` | gate passes | yes |

## 3. Measurements

All via `bench`, warm (2 warmup trials discarded except where noted), same machine, sequential.

| Metric | n | Median | p95 | Min | Max | Command |
|---|---|---|---|---|---|---|
| `drift-mcp --version` startup | 10 | 62.0ms | 100ms | 59ms | 100ms | `bench 19 server-startup -- node bin.js --version` |
| `get_task_preflight` (132-file repo) | 20 | 212.5ms | 228ms | 207ms | 237ms | `bench 19 tool-get_task_preflight -- one_call.py get_task_preflight` |
| `get_runtime_info` (no storage) | 20 | 87.5ms | 111ms | 82ms | 114ms | `bench 19 tool-get_runtime_info -- one_call.py get_runtime_info` |
| `get_scan_status` (132-file repo) | 20 | 152.0ms | 174ms | 148ms | 191ms | `bench 19 tool-get_scan_status -- one_call.py get_scan_status` |
| `get_findings` (132-file repo) | 20 | 152.5ms | 175ms | 148ms | 202ms | `bench 19 tool-get_findings -- one_call.py get_findings` |
| `get_allowed_context` (132-file repo) | 20 | 235.0ms | 274ms | 208ms | 279ms | `bench 19 tool-get_allowed_context -- one_call.py get_allowed_context` |
| `get_repo_map` (132-file repo) | 10 | 218.5ms | 234ms | 217ms | 234ms | `bench 19 repo-map-132files -- one_call.py get_repo_map` — DRIFT flagged (downward drift, warmup bled in); still fits within min–max band above |
| `get_repo_map` (5,066-file repo) | 3 | 88,268ms | 90,778ms | 87,641ms | 90,778ms | `bench 19 repo-map-5066files -- one_call.py get_repo_map` (calcom, `$WSL_DB`); CV=1.9%, no warmup — n too small (3) for the harness's own drift test, but the three trials cluster tightly (627ms MAD) |
| Sustained throughput: 1,000 sequential `tools/call` (one persistent process) | 1 | — | — | — | — | 32.07s total, 32.07ms/call avg, 31.2 calls/s, 1000/1000 succeeded, no errors, no exit-code degradation observed |
| Peak RSS over a 100-call session | 1 | — | — | — | — | `/usr/bin/time -l node bin.js --db $WS_DB < 100_calls.jsonl` → 253,034,496–254,033,920 bytes (~241–242 MiB) maximum resident set size across two runs; 223,883,440 bytes (~213 MiB) peak memory footprint |

Every per-tool bench above is process-per-call latency (each trial starts a fresh `node bin.js`
process for one request), not per-call latency inside one long-lived session — the sustained-
throughput row (31.2 calls/s in one persistent process, avg 32.07ms/call) is the number that
applies once a client keeps the process warm across a session; it is markedly faster than any
single process-per-call bench above because Node/V8 startup cost (>150ms of every process-per-call
number) is paid once instead of per request.

`get_repo_map` on the 20,000-file tier the charter specifies was not run — the largest corpus
available under `$DRIFT_EVAL_REPOS` is `calcom` at 5,066 indexed files; see §7. The size jump from
132 to 5,066 files (38x) takes `get_repo_map` from a median 218.5ms to a median 88,268ms (404x) —
clearly superlinear, though with only two size points this charter cannot fit a curve, only report
the two measured ends. At 5,066 files the response is a single 5,175,237-byte line (P-19-08-large)
delivered after 88-91 seconds — a latency an interactive agent session would treat as a hang, not a
tool call.

## 4. Suspect list disposition

| ID | Claim under test | Disposition | Evidence |
|---|---|---|---|
| S-19-1 | The server is hand-rolled JSON-RPC over a manual stdio line reader with zero MCP SDK dependency. | CONFIRMED (mechanism) but its practical cost is small | Read `index.ts:694-798`: no `StdioServerTransport`, no SDK import, `createInterface` over `process.stdin`. P-19-05 is the real cost test: an independent `@modelcontextprotocol/sdk` v1.30.0 client completed initialize→listTools→callTool×2→close without incident. The one place the hand-rolled implementation actually shows is the uncaught EPIPE crash (P-19-10, F-19-1) and the two JSON-RPC conformance gaps an SDK would have enforced for free — no `jsonrpc` validation, and notifications recognized only by method-name prefix rather than by "no `id` member" (P-19-07, P-19-09) |
| S-19-2 | `DRIFT_MCP_PROTOCOL_VERSION` is a hard-coded literal with no negotiation. | CONFIRMED | P-19-02: client requests `protocolVersion:"2025-06-18"`, server responds with `"2024-11-05"` unconditionally. Matches `index.ts:130` and the `response()` call at `initialize` — no comparison of `request.params.protocolVersion` anywhere in `handleMcpJsonRpcRequest` |
| S-19-3 | MCP applies one strict `--db` rule uniformly across all 12 tools, unlike the CLI's per-command resolution. | CONFIRMED | P-19-14: `drift-mcp` with no `--db`/`DRIFT_DB` refuses before any tool runs, exact message, exit 1. P-19-14-cli-contrast: the CLI given the identical omission does not mention `--db` at all — it silently resolves via `~/.drift/repos/<fingerprint>` (visible in the `doctor` output during setup: `State: /Users/geoffreyfernald/.drift/repos/repo_68a494d2b8491ebb/drift.sqlite`) |
| S-19-4 | `ask` and `prepare` declare no snippets and no source content are included. | CONFIRMED, and the declaration matches reality | P-19-17: both commands' `--json` output carry `redactions.snippets_included:false` and `redactions.source_content_included:false`. P-19-18: a grep of 33 distinctive lines from the one source file with an open finding against it found zero verbatim hits in either payload |
| S-19-5 | `prepare` silently caps at 10 paths. | CONFIRMED | P-19-19: on a 25-relevant-file task against the 5,066-file `calcom` repo, `graph_context.affected_files` returns exactly 10 entries (matching the `.slice(0, 10)` at `graph-preflight.ts:38`) while `redactions.context_truncated` reads `false` — traced to `commands/prepare.ts:223`, which sets `context_truncated: false` as a source-level literal, not a computed value. The field exists specifically to disclose this and cannot, as written, ever report `true` |
| S-19-6 | `test/e2e/mcp-bin.test.ts` exists; its assertions were never read. Determine what it covers and what these probes add. | CONFIRMED (exists) — coverage is minimal | The file is 18 lines, one `it()`: it execs the built binary with `--help` and asserts the usage string and `DRIFT_DB` appear in stdout with empty stderr. It exercises zero JSON-RPC behavior — no `initialize`, no `tools/list`, no `tools/call`, no error path, no read-only enforcement. Every protocol/correctness/error-handling finding in this charter (P-19-01 through P-19-20) is coverage this test does not provide |

## 5. Failures and blocks

### F-19-1 — Uncaught EPIPE crashes the server when the client's stdout read end closes

- **Probe:** P-19-10 (`sigpipe_on_stdout` case)
- **Command:** verbatim, from `lifecycle.py`:
  ```python
  proc2 = subprocess.Popen(["node", mcp, "--db", db], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
  proc2.stdout.close()      # reader gone
  proc2.stdin.write(b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n')
  proc2.stdin.flush()
  ```
- **Expected:** per the Failure Protocol, the process either handles the write failure and stays
  alive, or exits in a controlled way; a JSON-RPC server writing to a closed pipe is a routine
  operational event (a client that disconnects or crashes), not exceptional.
- **Observed:** exit code 1, and on stderr:
  ```
  node:events:486
        throw er; // Unhandled 'error' event
        ^

  Error: write EPIPE
      at afterWriteDispatched (node:internal/stream_base_commons:159:15)
      at writeGeneric (node:internal/stream_base_commons:150:3)
      at Socket._writeGeneric (node:net:966:11)
      at Socket._write (node:net:978:8)
      at writeOrBuffer (node:internal/streams/writable:570:12)
      at _write (node:internal/streams/writable:499:10)
      at Writable.write (node:internal/streams/writable:508:10)
      at runReadOnlyM[...elided, full text in results/artifacts/19/P-19-10.out]
  ```
- **Cause:** `runReadOnlyMcpStdioServer` (`index.ts:764-798`) calls `output.write(...)` directly on
  every response with no error handler and no `'error'` listener on the stream. Node's default
  behavior for an unhandled `'error'` event on a Writable is to throw, which is unhandled at the
  process level and terminates the process. Any client that closes its reading end while the
  server still has output queued — a crash, a timeout-and-disconnect, a supervisor sending SIGKILL
  to the client process but not the server — reproduces this.
- **Blast radius:** this charter only; no other charter's probes write to a closed drift-mcp
  stdout. It does mean a client-side crash or ungraceful disconnect takes the drift-mcp server
  process down too, which an agent orchestrator restarting a crashed client would not expect.
- **Reproduction:** the Python snippet above, or equivalently: start `drift-mcp --db <path>`,
  redirect its stdout to a pipe, close the read end, then write one line of valid JSON-RPC to
  its stdin.
- **Charter continued at:** P-19-11.

## 6. Discovered surface not in the charter

- **`ping` is routed through the generic `-32601 Unsupported MCP method` path**, not answered.
  `ping` is a core MCP method most servers treat as a liveness no-op returning `{}`; here it is
  indistinguishable from a genuinely unimplemented method like `completion/complete`. Not a crash,
  not silence — satisfies the letter of the charter's oracle for P-19-06 — but a client that pings
  before every batch of calls (a common health-check pattern) will see every ping fail.
- **`jsonrpc` version is never read.** Not merely unvalidated for wrong values — the field is not
  referenced anywhere in `handleMcpJsonRpcRequest`; a request missing `jsonrpc` entirely is
  processed identically to one with `jsonrpc:"2.0"` (P-19-09).
- **Notifications are recognized by method-name prefix (`"notifications/"`), not by the JSON-RPC
  spec's actual rule ("no `id` member").** A request with `method:"tools/list"` and no `id` field
  at all is answered anyway, with `id:null` in the response (P-19-07 `notification_no_id` case) —
  a real JSON-RPC 2.0 client that omits `id` on purpose to mean "don't answer me" would still get
  an answer.
- **A JSON value that is valid JSON but not an object crashes into the parse-error path.** `42` or
  `["a","b"]` as a full line causes `request.method.startsWith(...)` to throw a `TypeError`
  *before* `handleMcpJsonRpcRequest`'s own `try`/`catch` begins, and that exception is caught one
  level up by the line-parsing `catch`, so it is reported as `-32700` (parse error) — even though
  `JSON.parse` succeeded and the actual problem is a different one (P-19-07, P-19-09). Cosmetic —
  the error code family is wrong but the response is still well-formed and the server stays alive
  — but worth knowing if any client branches on `-32700` specifically to mean "resend, my framing
  was bad" versus `-32600` "resend, your payload was structurally wrong."
- **`get_findings` and `get_capabilities` diverge from their CLI counterparts by more than a
  timestamp** (P-19-11) — see §1 item 4. `get_repo_map`'s only observed divergence was
  `generated_at`, which is expected (two separate invocations, ~200ms apart).
- **The agent-response-contract.md envelope shape is not literally what ships.** The spec
  (`docs/architecture/agent-response-contract.md`) prescribes a top-level `AgentResponseEnvelope`
  with `freshness`, `truncated: boolean`, `repo_id`, and `next_commands` as sibling fields. The
  actual `agent_envelope` in `prepare --json` output nests the equivalent information under
  different names (`scan: {stale, required_fresh, latest_scan_id}` instead of `freshness`; no
  top-level `truncated` boolean — the closest fields are `redactions.context_truncated` and
  `policy_proof.context_truncated`, both of which are the same hardcoded-`false` field found in
  P-19-19), and `repo_id`/`next_commands` live at the outer payload level, not inside
  `agent_envelope`. Functionally equivalent information is present; the literal shape the doc
  describes is not what is implemented. Not chased further — out of this charter's probe list, but
  worth naming since P-19-21 asked for a validation against this document.

## 7. What this charter did not cover

- **The 20,000-file tier of the `get_repo_map` size/latency benchmark.** The largest corpus under
  `$DRIFT_EVAL_REPOS` is `calcom` at 5,066 indexed TS/JS files (17,348 files on disk, most not
  indexable). This charter benchmarked 132 vs. 5,066 files and did not synthesize a larger corpus
  to reach 20,000 — doing so was judged out of scope for a single charter's time budget and risked
  the disk-usage ceiling in binding rule 8. The 5,066-file measurement (§3) already shows the
  latency curve is steep enough to be actionable: see §3's pending large-repo row once filled, and
  P-19-08-large's single-trial 94.6s figure for the same corpus.
- **Batch JSON-RPC requests as the spec defines them** (an array of *independent* request objects,
  each individually processed and individually responded to) were not tested as a first-class
  feature — the server has no batch support at all (confirmed indirectly: a batch array crashes
  into the parse-error path per P-19-07), so there was nothing further to characterize once that
  was established.
- **Concurrent/parallel client connections.** `drift-mcp` is a single stdio process per client by
  design (one process, one stdin/stdout pair); this charter did not test multiple simultaneous
  `drift-mcp` processes against the same `--db` file for SQLite-level contention, which is a
  storage-layer question more than an MCP-surface one and was judged out of scope here.
- **`ping` and `notifications/initialized` semantics beyond what P-19-06/P-19-07 already surfaced**
  (§6) — established that they're miscategorized, did not chase what a stricter conformance test
  suite (e.g., the MCP Inspector or a full conformance harness) would additionally flag.
- **Charter 21's full privacy sweep.** P-19-13 established that `get_allowed_context` denies full
  file content by default and `get_security_context` carries no source; the charter explicitly
  defers the exhaustive privacy sweep to charter 21 and this results file does not attempt it.
