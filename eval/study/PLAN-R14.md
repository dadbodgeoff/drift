# Plan, round 14: customer readiness (technical design for implementing agents)

This follows [`PLAN-R13.md`](PLAN-R13.md). It does not replace it: R13 builds the practice
map; this plan closes the gaps a code and method review found on 2026-11-09 at main
`44edcd9`, and amends R13 where the review showed the R13 contract cannot carry what R13
needs.

**PLAN-R13 §9 governs.** The lead's decisions after the first review are recorded there
(#173). Where this plan and §9 speak to the same point, §9 is the decision and this plan
is the implementation detail; each such place below cites its §9 item. Nothing here
reopens a §9 decision.

**Data.** Every finding here comes from reading the product code, the eval scripts and the
committed aggregates. No blind pool, held-out manifest or pilot repository was opened.
Nothing was built or run. File and line references are as of `44edcd9`; **verify each one
before editing**, since several were read once and the tree moves.

## 0. How to use this document

- Each workstream (WS) is independent unless §2 says otherwise. One agent owns one WS.
- Each WS has: the problem with evidence, the design, the files to change, the tests to
  write first, the acceptance bar, and what is out of scope.
- **Tests first.** For every item, write the failing test or fixture named under "Tests"
  before changing product code. A PR without its test is not done.
- Use the repository's PR template and gates (`scripts/gates.sh`; `--studio` for any JSON
  shape the Studio reads). Fill "Not done / known limits" honestly.

### 0.1 Rules that hold for every workstream

1. **No LLM in the scan, mine, check or hook path.** WS-F and WS-E call models, and only
   in `eval/`.
2. **Determinism.** Output is byte-identical across runs, thread counts and checkout
   paths. Ordered maps and sorted collections only. Every new output gets a
   lower-twice (1 and 4 threads) or shuffle-the-input test.
3. **Census stability [STRICT].** `census --json --max 15` on the dev clones is
   byte-identical before and after, apart from `commit`, for every PR except WS-H, which
   exists to change it and must list every changed id.
4. **Precision gates stay** for anything that can block an edit. Nothing in this plan
   shows an unvetted mined convention to an agent.
5. **No tuning on blind or held-out data.** WS-F changes how the next sets are measured,
   not how past ones are read.
6. **"No conventions in code"** (CONTRIBUTING.md). Adapters describe how frameworks run.
   Library vocabularies name what a library call does (rejects a caller, opens a
   transaction); they never say what a team should do.
7. **Version bumps.** A lowering output change bumps that language's `LOWERING_VERSION`
   once per PR. Facts stay at schema 11: every addition in WS-B is
   `#[serde(default, skip_serializing_if = ...)]` and lands before any extractor ships.
8. **Studio pair.** A changed command, flag, JSON field or hook message ships with the
   Studio change or a linked paired PR, and a `apps/studio/docs/SYNC.md` row.
9. **Fail open, say so.** A hook that cannot decide stays silent to the agent and tells
   the person. Unknown is never reported as absent.

## 1. Release gates (what "ready for customers" means)

All of these hold at one frozen binary. Each is measured by the workstream named.

| # | Gate | Bar | Measured by |
|---|---|---|---|
| G1 | Install without a Rust toolchain | A prebuilt binary installs and runs `drift card` on macOS (arm64, x64) and Linux (x64, arm64) | WS-G |
| G2 | First run prints something true on a repo with no conventions | `drift init` ends with map, entry-point and next-step lines on 100% of build-set repos that parse | WS-C |
| G3 | An agent gets an answer with zero accepted conventions | `drift_card`, `drift_map`, `drift_security` answer without `.drift/conventions.yaml`; session start gives a brief | WS-C |
| G4 | A reported guard is an auth guard | On the three practice fixtures and the dev clones' diffs: no dependency or wrapper without proof of rejection is listed under `guards` | WS-A |
| G5 | Hook latency | PostToolUse p50 ≤ 100 ms and p95 ≤ 500 ms on the dev clones, measured on entry-point files under wrapper rules; Stop with no change ≤ 150 ms | WS-D |
| G6 | The A/B can show a difference | Control arm fails on ≥ 20% of headroom tasks in a pre-run; tokens and exploration calls reported per arm, paired | WS-E |
| G7 | Practice-map accuracy, blind | Per concern: cluster lower bound ≥ 80% at ≥ 100 units from ≥ 30 repos (§9.3); FALSE_NONE ≤ 5% of `none`-assigned units, a release gate on `authn` (§9.2) | WS-F with R13 |
| G8 | A human anchor exists | ≥ 100 units or cards labelled by a person; model-vs-human agreement reported | WS-F |

G6 is a gate on the experiment, not on its result. If the A/B then shows no benefit, that
is published, and the positioning moves to exhaustiveness and CI guarantees.

## 2. Order and dependencies

```
Phase 1 (parallel, start now):   WS-A1..A3   WS-B   WS-C   WS-D1..D3   WS-F1..F3   WS-G1..G2
Phase 2 (after Phase 1 merges):  WS-A4..A7   WS-D4..D6   WS-E   WS-I   WS-H   WS-G3..G4
Phase 3 (after R13 slice 1):     WS-J   WS-F4..F6   then the frozen-binary measurement of §1
```

- **WS-B before any R13 extractor PR** (R13 workstreams C and D). It is the one hard
  ordering constraint: the amendments are free now and a schema bump later.
- **WS-A1..A3 before R13 slice 1** (auth). R13's `authn` classifier calls the functions
  WS-A fixes.
- **WS-D1 before WS-D4..D6**: the path log decides which of them matter.
- **WS-E needs WS-C** (the drift arm must have something to say on a repo with few
  accepted conventions) and benefits from WS-D.
- Build slots: follow PLAN-R13 §6.3. WS-C (CLI text), WS-E, WS-F and WS-G need no shared
  cargo slot beyond their own crate builds.

## 3. Workstreams

### WS-A. Guard truth

**Problem.** On the pilot, 0 of 5 guard gaps were real. The causes are in code:

| # | Finding | Where |
|---|---|---|
| a | `EntryRow.guards` is every Call, Decorator, Config and AppHook wrap. `authenticates()` is never consulted, so `Depends(get_db)` is a guard and can form a 90% "shared guard". | `crates/drift-mine/src/security.rs` `inventory_with` (≈1152), `guard_gaps` (≈1728) |
| b | FastAPI turns every dependency **and its sub-dependency closure** into a Call wrap, so `get_db` is a guard even when only reached through `get_current_user`. | `crates/drift-py/src/link.rs` ≈1361 |
| c | `callee_is_guard` grants on a name alone (`names_access_control`: `token`, `session`, `verify`, `internal`, …). PLAN-R13 §1.1 uses it for in-body guard calls. | `security.rs` ≈493 |
| d | `x.use("/p", mw)` is always read as a router mount whose target is the last argument, so `app.use('/admin', requireAdmin)` and Hono `app.use('/api/*', mw)` guard no route. Fastify `addHook` is not read. | `crates/drift-ts/src/routes.rs` ≈374 |
| e | Nest records `@UseGuards` as one decorator wrap with no arguments; `APP_GUARD`, `useGlobalGuards` and `@Public()` are not modelled. | `routes.rs` ≈583, `resolve.rs` ≈1559 |
| f | Rejection shapes missed: redirect through `new URL(...)`, a returned error object, a ternary return, a check two calls deep, 404 as the denial, `next(createError(401))`. Wrongly accepted: a 403 in a body that merely mentions `user` or `token` (feature flag, CSRF). | `crates/drift-ts/src/lower.rs` ≈2767-2810, `security.rs` ≈613 |
| g | Next.js `middleware.ts` is an entry point but is never applied to the routes it matches. | `crates/drift-ts/src/nextjs.rs` ≈158 |

**Design.**

- **A1. Split guards from wrappers.** `EntryRow` gains `wrappers: Vec<String>`. `guards`
  keeps a wrap only when `authenticates(ctx, wrap)` holds, plus Config and AppHook wraps
  as today. `guard_gaps`, `drift card` ("Siblings … carry") and `link_conventions` read
  `guards`; a new line in the card and the security text lists `wrappers` under their own
  label. This is PLAN-R13 §2.8 row 4; do it first and alone.
- **A2. Direct and transitive dependencies.** `link.rs` marks each folded dependency wrap
  as direct or reached-through. Only a dependency whose own body proves rejection is a
  guard; a sub-dependency is never listed separately from the dependency that reaches it.
  No new fact type: carry it as a `meta` marker on the wrap's symbol or as wrap ordering,
  whichever keeps `Wrap` unchanged (a new `Wrap` field would break every struct literal).
- **A3. No grant by name for in-body calls.** Add `callee_proves_guard(ctx, callee)` =
  `authenticates || library_guard || ctx.called_as_guard`, without
  `names_access_control`. The practice classifiers and the security inventory use it.
  `callee_is_guard` stays for mining (its census must not move) and gets a doc line
  saying so. A name may still **veto** (the Public words), never grant.
- **A4. Path-scoped middleware.** In `routes.rs`, `use(path, ...args)` is a mount only
  when the last argument resolves to a router or app object (a binding made by
  `express.Router()`, `new Hono()`, a Fastify plugin). Otherwise every argument is
  middleware scoped to `path`: store `(pattern, middleware)` and apply it to routes
  registered later on the same receiver whose route matches. Matching is literal prefix,
  plus a trailing `/*`; any other pattern marks the affected routes' coverage
  **indeterminate** (rule 9), never guarded. Fastify `addHook('onRequest'|'preHandler',
  fn)` on an instance applies like `use(fn)` to routes registered in that encapsulation
  context; if the context cannot be read, indeterminate.
- **A5. Nest** (§9.5: recorded in TS `decorator_args`, with no wrap change). Fill
  `decorator_args` for `@UseGuards` with each argument's canonical guard class, at class
  and method level (it is always empty today, `resolve.rs` ≈1559), and record
  `{ provide: APP_GUARD, useClass: X }` and `app.useGlobalGuards(new X())` the same way
  on the module or bootstrap symbol. The inventory and the `authn` classifier read the
  guard classes from there and apply `authenticates` to each; the `UseGuards` wrap
  itself stays as it is, so mining and the census do not move. Read a decorator built from `SetMetadata` whose key the global
  guard's body reads as an `opens` marker; if the link cannot be proved, leave the route
  guarded-by-global and add nothing.
- **A6. Rejection shapes.** Extend the visitor that records `REJECTS_CALLER`:
  `NextResponse.redirect(new URL(<literal>, ...))`; a returned object literal with a
  rejection status or a rejection-text key in a server action; ternary and
  concise-arrow returns; `next(<call or new with a 401/403 status>)`. Follow plain calls
  **two** levels in `authenticates` (today one), inside the existing hop and node caps.
  Tighten the 403 rule: the subject identifier must be **read in the rejecting
  condition**, not anywhere in the body. This last change can remove guards mining
  relies on: report the census diff, and if any id changes, keep the old rule for mining
  behind the existing call path and use the strict rule only for A1/A3 consumers.
- **A7. Next.js middleware.** After WS-B gives `RouteMatcher` its `opaque` flag: apply the
  middleware entry point as a `middleware` mechanism to a route only when (1) a readable
  matcher covers the route and (2) the middleware body proves rejection for that branch.
  A Clerk `createRouteMatcher` list used as "public routes" inverts (1). Anything else
  is indeterminate.

**Tests (write first).**
- `crates/drift-cli/tests/security_guard_gaps.rs`: a FastAPI fixture with
  `Depends(get_db)` on 10 of 10 routes and `Depends(get_current_user)` on 9: the gap
  names the 1 route and `get_current_user` only; `get_db` appears under wrappers.
- A fixture where `get_db` is reached only through `get_current_user`: one guard.
- `callee_proves_guard`: `verifyEmailFormat()` and `getSessionToken()` are not guards; a
  helper that throws 401 is.
- Express `app.use('/admin', requireAdmin)` guards `/admin/x` and not `/public/y`;
  `app.use('/v1', router)` is still a mount; Hono `/api/*`; an unreadable pattern gives
  indeterminate.
- Nest: `@UseGuards(JwtAuthGuard, RolesGuard)` yields two guard classes in
  `decorator_args` and two inventory guards; `APP_GUARD`; a `@Public()` route.
- One positive and one negative fixture per A6 shape, plus the CSRF and feature-flag
  403s as negatives.
- Mutation check per [STRICT] branch: indeterminate never becomes guarded or unguarded.

**Acceptance.** G4. `security --json` diffs on the dev clones list every changed entry
with a reason class. Census unchanged (rule 3). Studio Security view shows guards and
wrappers apart.

**Out of scope.** Django middleware beyond what `settings.rs` reads; GraphQL shield;
service meshes.

---

### WS-B. Facts schema 11 amendments (before any extractor ships)

**Problem.** A stress test of 29 common code shapes against the schema-11 types found 12
representable, 13 partly and 4 not. The fixtures also contradict the type docs.

**Changes** (`crates/drift-core/src/facts.rs`, `practice.rs`; all additive):

| # | Change | Why |
|---|---|---|
| B1 | `Symbol.truncated: Vec<String>` and `FileFacts.truncated: Vec<String>`: the names of capped fields that lost entries, set in `normalize()`. | Caps cut silently and with bias (`responses` sorted by status drops 5xx first; `test_requests` sorted by method drops GET first). A classifier must answer Unknown, not `none`, for a truncated field. |
| B2 | `RouteMatcher.opaque: bool` (a pattern was dropped by `valid_route`, or the matcher is not a literal) and `RouteMatcher.polarity`: `applies`, `public`, `unknown`. | Today the Clerk default matcher `/(api|trpc)(.*)` and every negative lookahead validate to an empty list, which reads as "matches nothing". |
| B3 | `CheckOutcome::Invalid` (400, 422). | PLAN-R13 §1.6 "manual validation" cannot be expressed. |
| B4 | `BodyCheck.compares` gains `env` (an env-derived value; the name is not echoed) and a documented orientation rule: **the subject side is `source`**. | Cron and service secrets; TS and Python must key the same check alike. |
| B5 | `LogCall.callee` may be `param:<name>.<level>` for a receiver that is a parameter, and a local binding is traced to its initialiser's callee. `LogCall.bound: bool` for a logger derived with bound fields (`child`, `bind`). | Injected loggers and request-scoped loggers are otherwise invisible or misread as unstructured. |
| B6 | `TestRequest.dynamic: bool` (the route had a non-literal part). `normalize_route` strips a scheme and host, and rejects what is left if it is not a path. | A test using a base-URL constant must read as "route unknown", not "untested". Absolute URLs currently pass `valid_route` as `/http://…`. |
| B7 | `Symbol.scoped_queries: Vec<ScopedQuery { callee, key, source }>`, cap 8: a data-access call whose filter names a tenant-like key, and where the value came from (`session`, `param`, `header`, `literal`, `unknown`). | Filter-only tenancy (R13 §1.2) needs the value's source, not just the key. |
| B8 | `CatchFact.count: u32` (identical clauses in one symbol), the control `returns_error` (a result-type return), a shape check on `ResponseFact.keys` (`^[A-Za-z_][A-Za-z0-9_]{0,31}$`), and a shared status-name table in `practice.rs` (`HttpStatus.*`, `status.HTTP_*`, `http.HTTPStatus.*`). | Dedup loses counts for the catch-clause population; result types have no throw; `keys` is a fourth echoed string kind the policy does not cover. |

Also: change the variant key separator in `practices/mod.rs` from `+` to a character
that cannot occur in a path or canonical reference (SvelteKit files are named
`+server.ts`), and say in the `Use` doc that `uses`, not `key`, is the parseable form.

**Fixture corrections** (`crates/drift-mine/tests/fixtures/practices/*.facts.json`): make
each agree with the docs or change the doc, one way or the other, for: NotFound checks
whose source is not a subject; a Forbidden check without `rejects_caller`; `passes_error`
outside a catch; the Nest route with no link to its guard classes (follows A5); merged
`statuses` across test blocks.

**Tests.** Schema-10 and pre-amendment schema-11 fixtures still deserialize. `normalize`
is idempotent with `truncated` set. Every cap has a test that asserts the `truncated`
entry. `valid_route` and `normalize_route` reject `http://x/y` and accept `/y`. The
insta golden for the empty engine output is unchanged.

**Acceptance.** All eight land in one PR before R13 workstreams C and D open their first
PR. `SUPPORTED_FACTS` unchanged. Studio contract types updated in the same PR.

---

### WS-C. Useful with zero accepted conventions

**Problem.** The common first-run case (15 of 18 unseen repos show nothing) is a dead end
for both people and agents.

| # | Finding | Where |
|---|---|---|
| a | Every MCP tool errors without `.drift/conventions.yaml`, though CLI `card`, `map` and `security` need none. | `crates/drift-cli/src/mcp.rs` `run_tool` (≈821), `project.rs` `with_policy` (≈299) |
| b | Hooks return nothing when no policy is found; SessionStart adds no context when 0 conventions are accepted. | `agent.rs` `handle_event` (≈300), `session_start` (≈445) |
| c | The skill triggers only on repos with a policy and never mentions `drift card` or `drift map`. | `integrations/claude-code/skills/drift/SKILL.md` |
| d | MCP descriptions say what a tool returns, not when to call it. `drift_explain` leads with lower bound and lift. | `mcp.rs` `base_tools` |
| e | `drift init` with nothing to propose prints "No conventions found: roles need roughly 20+ similar symbols…" and stops. | `crates/drift-cli/src/main.rs` ≈853, ≈2041-2094 |
| f | The plugin ships hooks and a skill but not the MCP server, and pre-approves nothing. | `integrations/claude-code/.claude-plugin/` |

**Design.**

- **C1. Policy-free tools.** `drift_map`, `drift_card` and `drift_security` run with no
  policy, exactly as their CLI commands do. The other four return one line: "no accepted
  conventions here; `drift_card <path>` still answers".
- **C2. Session brief.** SessionStart, with or without a policy, emits at most 300 tokens:
  packages with their entry-point counts, and one line naming `drift_card <path>` as the
  first stop before reading sibling files. With accepted conventions, today's count line
  follows. Until R13 slice 1 lands, the brief carries structure only; then it carries the
  recipe (WS-J). Behind `agents.brief: on|off` in `.drift/config.yaml`, default on.
  Without a policy file the hook must not create one; it reads facts read-only like
  `drift card` (#167).
- **C3. Quiet rules.** A hook says nothing when: the edited file is not a source file; it
  has nothing known for the file's package; it already said the same thing this session
  (extend `SessionState.primed`); the edit touches no entry point and no accepted
  convention's role.
- **C4. Skill.** Rewrite the description to trigger on any repository where `drift` is
  installed. First bullet: "Before reading sibling files to learn how a route, handler,
  job or component is built here, run `drift card <path>` (works for a file that does not
  exist yet). Read other files only for what it lists under Not known." Keep the policy
  bullets for repos that have one.
- **C5. Descriptions.** Each MCP description starts with "Call when …" and ends with its
  typical size. Move tier, mode and statistics wording out of descriptions into the
  tool's output. Fix the stale "five read-only tools" in `mcp.rs:1`.
- **C6. Empty state.** `drift init` always ends with: files mapped, packages, entry points
  by kind (from `drift map`), then three commands that work now (`drift card <a real
  entry-point path from this repo>`, `drift map`, `drift security`). The "No conventions
  found" sentence stays, shortened, after them.
- **C7. Plugin.** Add `.mcp.json` to the plugin so one install gives hooks, skill and MCP.
  Document a `Bash(drift card:*)`, `Bash(drift map:*)`, `Bash(drift example:*)`,
  `Bash(drift check:*)` allow rule in the README's setup step.

**Tests.** MCP tests: the three tools answer in a fixture with no `.drift/`. Hook golden
tests for the brief (with and without policy), each quiet rule, and the 300-token cap
(count with a fixed tokenizer approximation: bytes / 4, asserted ≤ 1,200 bytes).
`apps/studio` `coverage.test.ts` recognises the new hook opening. An `init` golden for
the empty state on a fixture with entry points and no proposals.

**Acceptance.** G2, G3. No hook writes to a repo that has no `.drift/`.

---

### WS-D. Hook speed

**Problem.** The perf record measures a one-file PostToolUse at 0.065 s median; the A/B
pilot measured 256–1,567 ms, matching warm full-scan times, and its own note says "a full
scan per edit". Which path today's binary takes on entry-point files under wrapper rules
is not recorded anywhere.

**Design, in order.**

- **D1. Path log.** With `DRIFT_HOOK_TRACE=<file>`, each hook appends one JSON line:
  event, path taken (`single_file`, `full_scan:<reason>`, `skipped:<reason>`), and phase
  times (walk, index load, lower, check, index save). Reasons: `no_cache`, `no_index`,
  `manifest`, `ts_declined`, `py_declined:<why>`, `needs_full_scan:<rule class>`. Off by
  default; no behaviour change. Add a perf script row: 15 **entry-point** files per dev
  clone under an all-accepted policy.
- **D2. Extension test before the walk.** `scan_file` (`crates/drift-cli/src/scan.rs`
  ≈33) walks the whole repository before `scan_file_with` reaches the not-a-source-file
  return (`crates/drift-ts/src/index.rs` ≈358). Return empty facts for a non-source,
  non-manifest path before walking.
- **D3. Stop without a change.** `stop` (`agent.rs` ≈877) full-scans every turn when any
  convention blocks. Keep a stamp digest of the index in `SessionState` at the last Stop;
  if a walk-and-classify shows no changed, added or removed source or config file since
  then, return without scanning or checking. The walk stays (Bash edits are not tracked
  by the Write|Edit matcher); the scan and check go.
- **D4. Narrow the Python decline** (after D1 confirms it matters). `py/lib.rs` ≈457
  declines when any other production file has a base class with the same **bare name**
  as a class in the edited file. Resolve the candidate names through the index before
  declining, so an unrelated `Base` or `Settings` no longer forces a full scan.
- **D5. Index I/O.** The index is one JSON file read and rewritten whole (36,000 entries
  on the largest clone). Switch to a length-prefixed binary encoding with the same
  content, versioned; rewrite only when an entry changed, and write the changed entry
  through an append-and-compact scheme if D1 shows save time above 10 ms.
- **D6. Per-process checks.** `cache_dir` (`project.rs` ≈116) shells out to `git
  ls-files` and reads the cache directories three levels deep on every hook. Remember
  the answer in the cache directory keyed by the mtime and size of `.git/index`; re-run
  when either changes. This is a safety check (a tracked cache could carry forged
  facts): the memo must fail closed.
- **Not now:** a daemon. Decide from D1's numbers after D2–D6. If p95 still misses G5 on
  large repos, design the hook as a thin client of the running `drift mcp` process in a
  follow-up.

**Tests.** D2: a hook on `README.md` performs no walk (assert through the trace). D3: two
Stops with no edit between them, the second traces `skipped:no_change`; an edit made by a
shell command between them is seen. D4: fixture with two unrelated `Base` classes takes
`single_file`; a real subclass elsewhere still declines. D5: old index files are read or
discarded cleanly; output facts byte-identical. D6: a cache file added to git after the
memo is written is refused on the next hook.

**Acceptance.** G5, reported from the trace on the dev clones. Hook and check output
byte-identical before and after on every perf-script row.

---

### WS-E. Agent A/B v3 (`eval/agent-ab/v3/`)

This is the harness for PLAN-R13 §9.7 (step 0 and the three-arm A/B). The step-0 budget
cap (USD 25) and the ≥ 90% rule for dropping the consistency claim on strong models are
§9.7's and stand.

**Problem.** The existing harness cannot show the claimed benefit.

- 20 of 39 tasks name the file that demonstrates the convention; all 10 category-a tasks
  do. A task is valid when an example already sits in the same role
  (`verify-tasks.mjs` 69-93); nothing checks that an unaided agent would fail.
- Control left 0 violations in every v1 and v2 run.
- Only `drift check` violations of accepted conventions are scored. No functional check,
  no tokens, no exploration counts. Cost and turns are unpaired sums.
- The pilot's cost gap is one run of one task (105 vs 62 turns); the other three were
  level.

**Design.**

- **E1. Derive what is already saved.** From each run's transcript and `trajectory.json`:
  input, output, cache-read and cache-write tokens (a token-returning variant of
  `costFromTranscript`, `v2/lib.mjs` ≈440); `exploration_calls` = Read, Grep, Glob and
  read-only Bash before the first Write or Edit; time to first edit. Report all with the
  existing `paired()` and cluster bootstrap. Re-score the v2 pilot with these as a
  self-test; publish nothing from it.
- **E2. Headroom tasks.** Generate tasks mechanically: pick an existing production entry
  point that follows its role's dominant variant, delete it in the task checkout, and
  prompt for it from a behavioural description with the existing banned-word check. The
  prompt names the route and behaviour, not a sibling file or folder. Stratify by repo
  size and by how far the nearest same-role file is from the target path.
- **E3. Outcomes, pre-registered.**
  - Primary 1: **conformance** of the recreated unit to the dominant variant, per concern
    that applies (auth, validation, error mapping, response builder). Until R13 lands,
    use `drift facts` on the new file against the deleted original's wrappers, guards,
    `validates` and thrown classes. Afterwards use `drift practices --path`.
  - Primary 2: **total tokens to a solution that conforms**, paired by task.
  - Secondary: exploration calls, turns, wall time, hook latency from WS-D1's trace.
  - A blind label on a 20% subsample (does the new unit handle auth, validation and
    errors the way its siblings do?) so the product is not judged only by itself.
- **E4. Arms.** (A) control. (B) Drift plugin as shipped after WS-C. (C) the same brief
  and card text written into `AGENTS.md`, no hooks or tools: separates content from
  delivery.
- **E5. Headroom gate.** Before the full run, run arm A once per task on the cheapest
  model. Proceed only if A fails primary 1 on ≥ 20% of tasks; otherwise report that
  result and stop.
- **E6. Fairness.** Both arms get the same Bash allowlist except `drift` subcommands.
  Advise-mode findings are not counted as violations. Exclusions are reported per arm
  with a sensitivity line that counts them as failures.

**Tests.** `selftest.mjs` extended: token and exploration derivation on recorded
transcripts; the task generator is deterministic for a seed; the banned-word check; the
gate arithmetic.

**Acceptance.** G6. `eval/agent-ab/v3/PREREG.md` committed before any run on non-build
repos, with predicted values.

---

### WS-F. Measurement fixes (`eval/study/`)

**Problem.** Several published and planned bars do not measure what they say.

| # | Finding | Where |
|---|---|---|
| a | Labellers see Drift's confidence (`evidence: 25/27 (lower bound 0.77, lift 2.0)`) and the real repo name. | `lib.mjs` ≈518, `REVIEWER-PROMPT.md` ≈55 |
| b | The adjudicator shares labeller A's model and sided with A 26 times to B's 11. Model ids are not committed. | run READMEs |
| c | No human label exists anywhere. | — |
| d | κ is printed at n = 2, 3, 4, 7 with "almost perfect". | `agree.mjs` ≈70-104 |
| e | Flag precision pools A's and B's verdicts and ignores repo clustering (design effect 3.6–10.9 on held-out A labels). | `dev4-check.mjs` ≈110 |
| f | D1 (≥ 95%) has no minimum n. Condition (c) "within 10 points of in-sample" is two-sided, so a perfect blind result fails. | README ≈182, `PREREG-F11` ≈79 |
| g | R13 M-acc: the labeller is shown the assigned label; only assigned units are sampled; pooled accuracy is unweighted over a stratified sample; n ≥ 30 forces 29/30; FALSE_NONE has no denominator. | `PLAN-R13.md` 608-645 |
| h | Rubric R3 accepts an auth card whose every outlier is public by design. | `RUBRIC-v3.md` ≈191, ≈266 |

**Design.**

- **F1.** Strip `lower bound`, `lift` and counts from labeller cards (keep the rule, the
  holders' and outliers' source). Mask the repo name where the source does not reveal
  it. Leak check extended to these strings. New rubric version; old labels are not
  mixed with new ones in one rate.
- **F2.** `agree.mjs`: below n = 30 print raw agreement only; at n ≥ 30 print Cohen's κ
  and Gwet's AC1 with a bootstrap interval. Drop the adjective.
- **F3.** Every rate that pools units within repos reports a repo-cluster interval and
  quotes the widest of Wilson, bootstrap and t. Flags are counted once, from final
  verdicts. D1 gains a minimum n of 30 and is judged on the cluster lower bound.
  Condition (c) becomes one-sided (blind not more than 10 points **below** in-sample).
  Record the change in the README decision log; do not re-read past sets under the new
  rule.
- **F4.** Adjudicator C runs on a third model; A's, B's and C's model ids are committed
  with each run; every rate is also reported with adjudicated items counted as WRONG.
- **F5. Human anchor.** A person labels ≥ 100 items (cards from the build set now;
  practice units after R13 slice 1) with the same rubric through `drift review
  --set-log on` or a plain JSONL form. Report model-vs-human agreement per label. Until
  this exists, no accuracy figure is quoted outside the repository without the sentence
  "labelled by models, not maintainers".
- **F6. Practice-map measurement.** §9.2 and §9.3 already set: `known_only`, FALSE_NONE
  and variant recall as co-primary; n ≥ 100 per concern from ≥ 30 repos; the cluster
  bootstrap as primary interval; `none` oversampled to ≥ 60; a predicted value per
  concern; a failed bar published. This item adds what §9 does not say:
  - The labeller sees the unit and the concern definition, **not** Drift's assignment,
    and writes what the unit does; a second step matches that to the assignment.
  - The variant-recall arm is run on ≥ 2 packages per repo, with no Drift output shown.
  - Accuracy is stratum-weighted to the population.
  - FALSE_NONE = units Drift assigned `none` that do the concern / units assigned `none`.
  - At most 5 units per repo per concern, so no repo dominates a concern's sample.
  - The cluster lower bound of G7 is the pass rule beside §9's point predictions.
  - Auth cards and units are reported apart, with a strict reading where a by-design
    public outlier counts as legitimate.
- **F7. Blind-set hygiene.** New blind manifests are hash-only until reported (as
  apps11). One draw per frozen binary. Record how many repos each draw swapped for the
  parse-size rule.

**Tests.** `agree.test.mjs` (small-n branch, AC1 against a worked example),
`metrics.test.mjs` (cluster interval never narrower than quoted; one-sided (c)),
`lib.test.mjs` (card rendering has no evidence numbers), `practices.test.mjs` (weights
sum to the population; FALSE_NONE denominator).

**Acceptance.** G8, and `PREREG-R13-practices.md` rewritten to F6 before the apps13 draw.

---

### WS-G. Distribution and first screen

**Problem.** There is no tag or release; the version is `0.1.0-dev`. The README leads with
an npm command that does not work yet. Every install pointer names `dadbodgeoff/drift`
(`action.yml` 44, 74; `npm/config.json`; `plugin.json`; `npm/launcher/drift.js`; README
73, 317, 364, 383) while this repository is `GeoffreyFernald/Driftv22`. The Action runs
`cargo install --git` on every cold cache and its cache key moves with Drift's `main`.

**Design.**

- **G1. One source for the owner and repository name.** A single file (`npm/config.json`
  already holds it) from which `action.yml`, the plugin manifest, the launcher and the
  README snippets are generated or checked by a CI test that fails on any other
  spelling. **Which name is correct is the owner's decision (§5, D-1); do not rename
  anything until it is answered.** Ship the check with the current value.
- **G2. README.** First screen: what Drift does for the reader in three sentences
  (deterministic, local, no model calls, answers the agent before it reads files), the
  install path that works **today**, and three commands with their output. Move the
  status caveats to `docs/ACCURACY.md` with one linked sentence left behind. Move the
  tier matrix, limits, verifier and review-log sections to `docs/`. Replace decision
  codes (D7, D13, F12, "show policy", "admission bar") in user-facing README and CLI
  text with plain words; keep the codes in `eval/` and code comments. `drift --help`
  lists `init`, `card`, `map`, `check`, `review`, `security` first; `scan`, `facts`,
  `debug` go under a "plumbing" heading. Add `--hidden` to the review help and correct
  the line "none is hidden from … agents".
- **G3. Release pipeline dry run.** Make `release.yml` produce the four target binaries,
  `SHA256SUMS` and the npm platform packages from a tag, and prove it on a
  pre-release tag in a fork or with `workflow_dispatch` and no publish step. Publishing
  is a person's action.
- **G4. Action.** Download the release binary for the runner and verify it against
  `SHA256SUMS`; fall back to `cargo install` only when no release matches. Default
  `drift-ref` to the latest release tag, not `main`.

**Tests.** The name-consistency check; a README link checker for the moved sections; a
help-text golden; `npm/ci-check.mjs` extended for the launcher's download path against a
local file server.

**Acceptance.** G1, once D-1 is answered and a person publishes the first tag.

---

### WS-H. Mining: three local fixes, then frozen

**Problem.** Mining stays the enforcement layer and is otherwise frozen (§4). Three
verified defects are cheap and local, and one documentation error misleads every reader.

| # | Finding | Where (`crates/drift-mine/src/mine.rs`) |
|---|---|---|
| a | The per-role cap (`MAX_PER_ROLE` 5) is not show-aware; only the per-repo cap got the fix. Five hidden-family drafts in a role evict a showable one. | ≈4380 (compare `cap_shown` ≈4410, ≈4569) |
| b | Caps run before `narrow`, `compiler_enforced`, `subtree` and merge. Drafts dropped later still hold role and repo slots; merged siblings take N slots for one card. | ≈4459-4500 |
| c | `narrow`, `share_role_exemptions` and `subtree` recount evidence but never re-check `MIN_LOWER_BOUND`, lift or score. | ≈4953, ≈5075, ≈5339 |
| d | With one required outlier and a 0.75 Wilson bound the smallest passing role is 18 of 19 (53 for layering at 0.9). `MIN_ROLE_SIZE` 8 and the module doc imply otherwise. | lines 6-7, ≈26-52 |

**Design.** H1: pass the same `hidden` set to the per-role truncation. H2: apply the
caps after refinement and merge, or backfill freed slots from the next-ranked drafts;
choose whichever gives the smaller diff. H3: after each recount, re-apply the gates the
draft first passed and recompute its score; a draft that no longer passes is dropped
with its own funnel code. H4: correct the module doc and `census --help` to state the
effective minimum sizes; change no constant.

**Process.** This is the one workstream that changes the census. Each of H1–H3 is its
own PR, with the before/after census on all build clones, every added, removed or
re-ranked id listed, and the five-fold rule of PLAN-R11 §5 applied. New ids go to blind
labelling before the change merges. If a fix loses an ACCEPT outside its design folds,
it does not merge.

**Tests.** A unit fixture per defect that fails today: five hidden drafts plus one
showable in one role; a draft narrowed out after the cap with a next-ranked draft
waiting; a draft whose recount drops below the bound.

**Acceptance.** Fold rule met, or the PR is closed with the record kept under
`research/`.

---

### WS-I. Python

| # | Problem | Where | Design | Size |
|---|---|---|---|---|
| I1 | Namespace package where one distribution ships an empty `ns/__init__.py`: the merge exists but three paths return before reaching it (absolute import from inside that distribution, `from ns import sub`, relative `from ..sub import x`). | `crates/drift-py/src/resolve.rs` ≈456-460, ≈366, ≈444-449 | Regular package first (unchanged), then the portion merge on all three paths. Gate the merge on the importing project declaring the sibling distribution where a declaration can be read; otherwise resolve and mark the edge `namespace_merged` so the map can show it. CPython fails this import when the distributions are separate path entries, so this models a single-site-packages install; say so in the doc comment. Teach `eval/oracle-py/oracle.py` the same rule. | S |
| I2 | Env reads need a literal key. | `signals.rs` ≈403-428, `lower.rs` ≈1808, ≈1946 | Same-file constants; one-line helpers that return an `os.environ`/`getenv` read of their parameter (through the linker); literal-keyed dicts of names; pydantic `BaseSettings` fields (field name, `alias`, `env_prefix`); django-environ `env("X")`; decouple `config("X")`. Stop counting `os.environ["X"] = v` as a read. | M |
| I3 | Routes with f-strings come out `/?`; a non-literal `APIRouter(prefix=...)` or `Blueprint(url_prefix=...)` is dropped silently. | `adapters.rs` ≈423-429, ≈471-473; `link.rs` ≈1059 | Keep literal segments and turn each interpolation into `{name}`; follow same-file string constants; a non-literal prefix yields a `{?}` segment, never an empty prefix. | S |
| I4 | `dev_only` is declared and always empty; `package_graph` counts test-file imports as production edges; three different is-test predicates. | `packages.rs` ≈176-199, ≈320; `crates/drift-mine/src/map.rs` ≈187-222 | Fill `dev_only` from extras named dev/test/tests/lint, `[dependency-groups]`, poetry groups and uv dev dependencies. `package_graph` returns production and test edges apart (PLAN-R13 §2.8 row 1). One shared is-test predicate in `drift-core`. | S |
| I5 | A router mounted twice keeps one parent; DRF `router.register` needs two positional arguments and a literal prefix. | `link.rs` ≈1207; `adapters.rs` ≈1517-1530 | Keep every mount; accept keyword arguments and same-file constant prefixes. | S |
| I6 | No CLI or consumer entry kinds. | `adapters.rs`, `kinds.rs` | `cli` for click, typer and argparse `__main__`, `[project.scripts]`, Django management commands. `consumer` for Celery/RQ/kombu handlers beyond today's `job`. Agent graphs wait for a customer who needs them. | M |
| I7 | Duplicate roles from namespace nesting; a filename used ≥ 5 times (`registry.py`) becomes its own file kind and leaves its sibling role. | `crates/drift-mine/src/roles.rs` ≈970-1005, ≈805-908 | **Output-side only** (rule 3): collapse equal-membership depth roles in `map`, `practices` and coverage output. Do not change selectors or the file-kind vocabulary without a fold-rule study. | M |

**Tests.** One fixture per row that fails today; the oracle run on the dev clones shows 0
new disagreements; I1 has the three import forms and a not-declared sibling.

**Acceptance.** `eval/run.mjs` and the Python oracle: 0 disagreements, 0 gaps. Census
unchanged for I1, I3–I5, I7. I2 and I6 change facts mining reads: report the census diff
and treat any changed id as WS-H does.

---

### WS-J. Practice-map items beyond PLAN-R13 §9

§9 already decides the recipe-first output (§9.1), the `sets_apart` guards (§9.4), the
three-chain auth model with alternatives and service callers (§9.5) and the deferred
`Practice{concern, any_of}` rule kind (§9.6). They are not repeated here. Two details
remain for whoever builds them:

- **J1. Tests for §9.4 and §9.5.** A 2-member variant in one directory produces no
  `sets_apart` line; a variant of ≥ 5 with no separating attribute is the first finding;
  two authn variants separated by package report as one policy with alternatives, and
  the same two interleaved in one directory report as an unexplained split.
- **J2. Current, not only dominant** (§9.9 item 1, next round). Record each unit's
  first-commit date where history is available; when the most-adopted variant among
  recent units differs from the dominant one, the recipe names the recent one and says
  so. Design the fact now so schema 11 need not change: a per-file `first_seen` in a
  side table of the cache, not in `FileFacts`, because it depends on git and not on
  content.

**Acceptance.** The R13 test suites cover J1. J2 is a design note under `research/`.

## 4. What stops

- Show-table regeneration and family tuning; further blind draws for the default tier.
- New mining mechanisms (layering depth, intra-package layering, kind roles) beyond WS-H.
- History-recall studies.
- The `drift security` step in the Action stays off until G4 is measured.
- Studio: the Practices view is read-only this round (§9.6).
- New `unproposable` filters or per-framework exemptions keyed to a labelled card.

## 5. Decisions for the owner (each has a default so no workstream blocks)

| # | Decision | Default the agents proceed on |
|---|---|---|
| D-1 | The canonical GitHub owner and repository name for installs. | Change nothing; ship only the consistency check (WS-G1). |
| D-2 | Publish a first pre-release tag once G1's dry run passes. | Prepare, do not publish. |
| D-3 | Adopt F6's additions to §9.2–9.3 (labeller blind to the assignment, stratum weights, ≤ 5 units per repo, the cluster lower bound as pass rule). | Yes; write the pre-registration to them. |
| D-4 | Who labels the human anchor (F5), and the budget. | Build the form and the report; label nothing. |
| D-5 | Decided in §9.6: the `Practice` rule kind comes in a later round. | Nothing to build now. |
| D-6 | If the A/B headroom gate fails (control conforms ≥ 80%). | Publish the result; reposition on exhaustiveness and CI. |
| D-7 | Session brief on by default (C2). | On, with `agents.brief: off` available. |

## 6. Risks

| Risk | Mitigation |
|---|---|
| WS-A6's stricter 403 rule removes guards mining relies on. | Census diff per PR; keep the old path for mining if any id moves. |
| WS-B lands after an extractor PR. | B merges first; C and D branch from it (§2). |
| The session brief adds tokens with no benefit. | Arm C in WS-E isolates it; `agents.brief: off`. |
| WS-D3 misses an edit and skips a needed check. | The walk stays; only an unchanged stamp digest skips. Mutation test on the digest. |
| WS-H changes cards with no blind budget left. | One PR per fix; close rather than merge on a fold-rule failure. |
| Line references in this plan are stale. | Verify before editing (§0); cite the new location in the PR. |

## Files

| Path | What |
|---|---|
| `eval/study/PLAN-R13.md` | The practice map; its §9 decisions govern. WS-B amends its §0.2 contract. |
| `eval/perf/2026-11-07/` | The hook and scan timings WS-D starts from. |
| `eval/agent-ab/v2/` | The harness WS-E extends. |
| `docs/ACCURACY.md` | Receives the README's status caveats (WS-G2). |
