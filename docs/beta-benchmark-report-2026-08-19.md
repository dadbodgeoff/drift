# Drift beta — independent evaluation and benchmark report

**Subject:** `dadbodgeoff/drift` @ `a0517f3e` (main, tree clean apart from five untracked doc paths)
**Date:** 2026-08-19 · **Host:** Apple M4, 10 cores, 16 GB, macOS 15.6 (24G84), on AC
**Toolchain:** node v25.2.1 · pnpm 10.28.0 · rustc/cargo 1.97.0
**Corpus:** the seven pinned repos at `~/drift-falsification/repos`, last fetched 2026-08-02, all
clean at audit time — `taxonomy@adab025`, `papermark@9068310`, `midday@3b46ca6`,
`openstatus@3846e73`, `formbricks@41ac233`, `dub@ad4c29d`, `calcom@7772068`.

Everything below was executed against a live build. Where a number is the vendor's own, it is
labelled *vendor suite*. Where it is mine, it is labelled *independent* and the harness is on disk.

> **Bottom line.** The product is stronger than its measurement layer.
>
> Detection is wide (18/21 adversarial shapes caught out-of-sample), precision on a real 497-route
> repo is **perfect after hand-adjudication — zero false positives, zero misses**, every run is
> bit-identical, **0 of 56 ordinary edits are refused**, nothing touches the network, the README
> quickstart works cold on the first try, and the engine's core survives **8/8 injected faults in
> 187 seconds**.
>
> Against that: **two of the six eval suites that produce every published number exit `1` on a clean
> checkout of `main`** — traced here to one commit, `7b95504c`, whose change was a *correctness fix*
> the baselines were never re-recorded to absorb. There is **one silent false pass**: a diff
> containing a non-ASCII file path returns exit `0` with the violation unexamined. Two convention
> kinds the project itself lists as unverified turn out to **crash `drift check`** the first time
> their code path executes, and an accepted auth convention is **satisfied by any function sharing
> the helper's name, from any module** — a do-nothing stub passes the proof. And the agent surface has two hard edges: `get_repo_map` returns ~500k
> tokens by default with `limit` unable to bound it, while a one-file `check` costs a whole-repo scan.
>
> The claim the product is built on — that an agent given the repo's conventions writes better code —
> **still has no evidence.** A paired A/B run here came back 18/18 clean in *both* arms: the base rate
> was already zero, so there was nothing to improve. That is a bound on the experiment, not a verdict
> on Drift, and §20 names the three conditions under which the real answer could be measured.
---

## 1. What Drift is, structurally

| Layer | Where | Size | Job |
|---|---|---|---|
| Scan engine | `crates/drift-engine` (Rust, tree-sitter) | 26.3k lines src | Parse TS/JS → facts; own the route/import/data-layer vocabulary |
| Engine contract | `packages/engine-contract` | 1.4k | Zod-typed request/response schemas between CLI and engine |
| Fact graph | `packages/factgraph` | 0.7k | `factgraph.v2` node/edge model |
| Storage | `packages/storage` (better-sqlite3) | 4.5k | SQLite schema v36, audit chain, backups |
| Query | `packages/query` | 6.4k | Repo map, preflight packets, findings queries |
| CLI | `packages/cli` | 22.7k | Diff parsing, scope, baseline, exceptions/waivers, governance, exit codes |
| MCP | `packages/mcp` | 3.6k | 12 read-only tools over stdio JSON-RPC |
| Core / vocabulary / adapters | `packages/{core,vocabulary,adapters}` | 8.6k | Claims manifest, capability gating, shared enums |

**The split that matters.** The engine decides *whether an import is forbidden*; the CLI decides
*which files are in scope*, and applies exceptions, waivers, governance, baseline and diff status.
`crates/drift-engine/src/check_command.rs` deliberately binds those contract fields to `_`. That is
documented (`docs/architecture/enforcement-layers.md`) and pinned by
`packages/cli/test/contract-field-enforcement.test.ts`. It is also the seam every finding in §6 of
this report lives on: the engine was right about the code in every case I could construct; the
misses are in the CLI's scope selection and in the gates that watch the engine.

**Pipeline:** `files → facts → contract → baseline → check`. A convention is inferred from the
violations already present; minority-violating ⇒ `block`, majority-violating ⇒ `warn`. Exit
vocabulary is `0` pass / `2` blocked / `3` refused (fail-closed) / `1` error.

**Declared scope:** TypeScript/JavaScript, Next.js API routes, one convention family
(`api_route_no_direct_data_access`), local-only, read-only MCP. The claims manifest
(`docs/internal/architecture/beta-claims.json`) explicitly *blocks* `cloud_sync`, `desktop_ui`,
`python_adapter`, `general_ai_code_review`, `broad_language_support`,
`automatic_convention_inference_for_any_data_layer`. `pnpm validate:claims` passes, and the blocked
list is enforced against runtime capabilities rather than asserted in prose.
---

## 2. What a beta evaluation of this product has to answer

Drift is a guardrail. The failure that matters is not "it missed something" — it is **"it said
`pass` and had not looked."** Everything else is secondary. So the requirement set is ordered by
how badly a wrong answer hurts, not by how easy it is to measure.

| # | Requirement | Why a beta user cares | Instrument |
|---|---|---|---|
| R1 | **No silent false pass.** Every `exit 0` is backed by a scope that was actually examined | A green CI that enforces nothing is worse than no CI | Adversarial scope probes; coverage-vs-verdict reconciliation |
| R2 | **Recall on realistic violation shapes**, including laundering through barrels and indirection | An agent writes whatever compiles; the shapes it emits are not the tutorial shape | Out-of-sample shape matrix with auditor-held ground truth |
| R3 | **Precision.** Properly layered code is never flagged | One false block and the tool is disabled | Negative controls at the same scale as positives |
| R4 | **Abstention rate on ordinary edits.** How often does it refuse to answer? | Refusals are the usability tax; a tool that refuses on normal work is unusable | 8 ordinary edits × 7 real repos |
| R5 | **Determinism.** Same input, same verdict | A flaky gate is not a gate | Repeated scans on a frozen tree, engine and CLI separately |
| R6 | **Latency and footprint at real-repo size** | An edit-time guardrail that costs seconds gets turned off | Cold/warm scan, single-file check p50/p95, peak RSS, DB size |
| R7 | **Agent surface is consumable.** MCP payloads fit a context window | The differentiator is agent-queryable; a 500k-token answer is not an answer | Per-tool byte/token measurement on toy and real repos |
| R8 | **Exit-code and refusal contract is stable and legible** | CI and agents branch on it | Every documented code provoked and compared to the doc |
| R9 | **First run works from the README, cold** | Beta install is build-from-source; there is no second chance | Literal quickstart in a clean `$HOME` |
| R10 | **State is durable and bounded** | It is a local database on the user's disk | Corruption, truncation, backup/restore, size scaling |
| R11 | **Nothing leaves the machine** | Stated as a core property | Dependency and call-graph inspection |
| R12 | **The published numbers reproduce** | Every claim in the README is a promise | Run the vendor's own suites on a clean checkout |
| R13 | **The gates that guard all of the above are themselves live** | A dead gate is how a regression ships | Gate-liveness inspection, ratchet direction review |

R12 and R13 are the ones most evaluations skip, and they are where this audit found the most.
---

## 3. Instruments built for this audit

Everything here is new work, not a re-run of the vendor's harness. It lives under
`…/scratchpad/audit/` and is reproducible.

**3.1 Out-of-sample repo with auditor-held ground truth** (`gen-base.mjs`). A synthetic but
realistic Next.js App Router repo — 6 service modules, 30 properly layered routes, 3 pre-existing
direct-access routes so that onboarding infers the convention at *minority* ratio and lands in
`block` mode. Drift has never seen it; none of the vendor's tuning could have overfit to it.
Onboarding it: `Scanned 41 files. Stored 408 facts. Found 3 convention candidates. Accepted
"api_route_no_direct_data_access" in BLOCK mode (3 existing violations baselined)`, exit `0`.

**3.2 A 29-cell shape matrix** (`oos-shapes.mjs`, `run-oos.mjs`). Each cell is one branch off the
base commit containing exactly one shape, checked with a *fresh copy of the onboarded state*, so no
cell can contaminate another. 21 positives (must be flagged, at the named route), 8 negatives (must
stay silent). Deliberately extends past the vendor's own 13-shape evasion matrix into Pages Router,
`.js`/`.tsx`/`.mjs` route extensions, route groups, dynamic segments, `export *` barrels, and two
laundering shapes the vendor's own source comments name as untested.

**3.3 An independent import oracle** (`oracle.mjs`) — multi-line-aware, comment-stripping,
type-only-aware — so route and import counts can be checked without asking the thing under test.

**3.4 A frozen private copy of `openstatus`** at the same sha, outside `$DRIFT_EVAL_REPOS`, so
determinism could be measured on a tree no other process was mutating. This mattered: my first
determinism run was contaminated by the vendor's own evasion harness injecting into the shared
corpus, and reported variance that does not exist (see §5.3).

**3.5 A commit sweep** (`sweep.sh`) rebuilding the engine at each of the 18 merge commits on
`main` since the last eval-baseline update and re-scanning the frozen tree, to attribute a metric
movement to a commit rather than to a sprint.

**3.6 An MCP payload harness** (`mcp-size.mjs`) driving the stdio server directly with JSON-RPC and
measuring per-tool latency and response size.
---

## 4. Detection quality — independent, out-of-sample

**Headline: 18/21 positives caught, 0/8 false positives, on a repo the product has never seen.**
Every caught cell exited `2` and named the correct `file:line` in `evidence_refs[0]`.

| Shape | Expected | exit | Result |
|---|---|---|---|
| `A01-named-import` | flag | 2 | caught |
| `A02-default-import` | flag | 2 | caught |
| `A03-aliased-import` | flag | 2 | caught |
| `A04-namespace-import` | flag | 2 | caught |
| `A05-route-group` | flag | 2 | caught |
| `A06-dynamic-segment` | flag | 2 | caught |
| `A07-pages-router` | flag | 2 | caught |
| `A08-js-route` | flag | 2 | caught |
| `A09-jsx-route` | flag | 2 | caught |
| `A10-relative-specifier` | flag | 2 | caught |
| `A11-mjs-route` | flag | 0 | **MISSED** |
| `N01-service-call` | silent | 0 | silent |
| `N02-comment-mention` | silent | 0 | silent |
| `N03-string-mention` | silent | 0 | silent |
| `N04-type-only-import` | silent | 0 | silent |
| `N05-lookalike-specifier` | silent | 0 | silent |
| `N06-non-route-direct` | silent | 0 | silent |
| `N07-clean-route-group` | silent | 0 | silent |
| `N08-clean-pages-router` | silent | 0 | silent |
| `E01-barrel-reexport` | flag | 2 | caught |
| `E02-barrel-2hop` | flag | 2 | caught |
| `E03-renamed-reexport` | flag | 2 | caught |
| `E04-import-then-const-export` | flag | 0 | **MISSED** |
| `E05-factory-function` | flag | 0 | **MISSED** |
| `E06-dynamic-import` | flag | 2 | caught |
| `E07-side-effect-import` | flag | 2 | caught |
| `E08-require-call` | flag | 2 | caught |
| `E09-deep-subpath` | flag | 2 | caught |
| `E10-export-star-barrel` | flag | 2 | caught |

### 4.1 What it caught that a naive implementation would not

`A05`/`A06` (route groups `(admin)` and dynamic segments `[id]`), `A07` (Pages Router),
`A08`/`A09` (`.js` and `.tsx` route files), `A10` (relative specifier `../../../lib/db`),
`E01`–`E03` (1-hop, 2-hop and renamed re-export barrels), `E06` (`await import()`),
`E07` (bare side-effect `import "@/lib/db"`), `E08` (`require()`), `E09` (deep subpath through an
index barrel), `E10` (`export *` barrel). That is a genuinely wide net — and it is wide in the
directions an LLM actually writes code, not just the tutorial direction.

The negative controls are equally load-bearing: a specifier mentioned only in a **comment**, only
in a **string literal**, imported **type-only**, a **lookalike specifier** (`@/lib/db-legacy-archive`),
and a **non-route file** importing the data layer directly, all stayed silent. Zero false positives
across 8 negatives. The type-only exclusion is not cosmetic — the repo's own history records it
taking dub's false-positive rate from 8.5% to 3.1%.

### 4.2 The three misses, characterised

| Miss | What happens | Severity |
|---|---|---|
| `E04-import-then-const-export` — `import {db}; export const client = db;` then import `client` | exit `0`, `complete: true`, no finding | **Real evasion.** Two lines of laundering defeats the barrel chase. Named in the vendor's own source comments (`scripts/evasion-matrix.mjs`) as a shape it deliberately does not test — so it is known, and it is not in any gate. |
| `E05-factory-function` — `export function getClient() { return db }` | exit `0`, no finding | **Real evasion**, same class. Not named anywhere I could find. |
| `A11-mjs-route` — `app/api/x/route.mjs` | exit `0`, no finding | **Scope, not defect.** Next.js does not route `.mjs` by default; `crates/drift-engine/src/next_routes.rs:53` matches `route.{ts,tsx,js,jsx}`, which is exactly Next's default `pageExtensions`. A repo that sets `pageExtensions: ['mjs']` would be silently unenforced. Worth one line in the scope table. |

`E04`/`E05` matter more than their count suggests: they are precisely the shapes a coding agent
produces when told "don't import the database in a route" and left to improvise. Chain detection
follows **re-export statements**; it does not follow a value through a local binding. The engine
comment at `crates/drift-engine/src/facts.rs:1013` (`reexport_value_identifiers`) is the boundary.

### 4.3 Vendor suites, re-run on this machine

| Suite | Result | Note |
|---|---|---|
| `pnpm eval:evasion` | **PASS**, 87/87 testable cells, 4 `UNTESTABLE`, 0 `FAIL`, no change vs baseline | README still says "66/66" — the suite has grown and the README understates it |
| `pnpm eval:external` | **FAIL (exit 1)** | 7/7 repos individually `ok`; the run fails on baseline comparison (§5.1) |
| `pnpm eval:breadth` | **FAIL (exit 1)** | all 7 repos flagged `exported_symbols_fell (detection regression)` (§5.1) |
| `pnpm eval:bench` | **PASS** | `ordinary-edit refusal rate: 0/56 across 7 repos`, ratchet ok |
| `pnpm eval:presence` | **PASS** | 10 kind/repo cells, `precision=1 recall=1 (50 ok / 50 bad, fp=0, fn=0)` on every one, no change vs baseline |
| `pnpm eval:determinism` | **PASS** | `7/7 repo(s) deterministic over 3 runs`, digests match the committed baseline |
| `pnpm test` (unit) | PASS — 1,220 TS tests across 109 files + 430 Rust tests across 40 suites, 47.7 s | |
| `pnpm test:e2e` | PASS — 157 tests / 33 files | |
| `pnpm test:harness` | PASS — 227 tests / 18 files | |
| `pnpm typecheck`, `lint:engine` (clippy `-D warnings`), `format:engine:check`, `check:boundaries` | PASS | |
| `check:storage-lifecycle`, `storage-invariants`, `error-contract`, `vocabulary`, `surface-parity`, `payload-invariants`, `cell-ledger`, `engine-schema-parity`, `validate:claims`, `beta:proof`, release-matrix | PASS (11/11) | `error-contract` reconciles 19 codes — 12 refusals, 7 errors — all documented |
---

## 5. The finding that matters most: two of six eval suites are red on `main`

### 5.1 `pnpm eval:breadth` and `pnpm eval:external` both fail on a clean checkout

```
$ pnpm eval:breadth
  FAIL taxonomy    exported_symbols: 311 -> 282 (detection regression)
  FAIL dub         exported_symbols: 6187 -> 5659 (detection regression)
  FAIL formbricks  exported_symbols: 5409 -> 5385 (detection regression)
  FAIL calcom      exported_symbols: 7315 -> 6960 (detection regression)
  FAIL papermark   exported_symbols: 2805 -> 2215 (detection regression)
  FAIL midday      exported_symbols: 4246 -> 4131 (detection regression)
  FAIL openstatus  exported_symbols: 4382 -> 4221 (detection regression)
7 repo(s) not passing            exit 1
```

```
$ pnpm eval:external
  ok  taxonomy … ok openstatus          # all 7 repos individually pass
changed vs baseline:
  dub:        baselined: 400 -> 349
  calcom:     baselined:  39 ->  28
  papermark:  baselined: 264 -> 237
  openstatus: baselined:  34 ->  17     exit 1
```

`pnpm verify:evals` — and therefore `pnpm verify:full` — cannot pass on `main` today. These are the
suites that back every headline number in the README.

### 5.2 Attributed to one commit, and it is a *correctness fix*, not a regression

I rebuilt the engine at each of the 18 merge commits on `main` since the last baseline update and
re-scanned a frozen copy of `openstatus` (same sha, outside the shared corpus). The metric is safe to
compare across a busy machine because I first established it is bit-identical run to run (§8):

| Commit | `exported_symbol` |
|---|---|
| `fcf2d1f5` (last baseline update) | 4382 |
| `4cf1fc67` #117 | 4382 |
| `77c326d2` #118 | 4382 |
| **`7b95504c` #119** — ground-truth remediation (D1, D2, D4, D5) | **4221** |
| `8687dd20` #120 … `1e2813f0` #134 (13 further merges) | 4221 |
| `a0517f3e` HEAD | 4221 |

One commit, one step, flat everywhere else. `files` (2185) and `re_export_used` (1041) never move.

Reading the diff at `crates/drift-engine/src/facts.rs` in that merge, the change is **D2**, and its
own comment states the intent plainly: `export default function handler()` used to emit a *second*
`exported_symbol` fact named `handler`, and

> `export default function handler()` does not create a named export `handler` — nothing can write
> `import { handler } from "./orders"` — and `exported_symbols_by_file` keys purely on `fact.name`,
> so the engine resolved that import against a module exporting no such name. **A false resolution,
> not a duplicate.**

So the −161 is 161 *false* symbols removed. I then confirmed the second metric lands on the same
commit: rebuilding engine **and** CLI and onboarding the same frozen `openstatus`,

| Commit | `baselined_count` |
|---|---|
| `77c326d2` #118 | **34** |
| `7b95504c` #119 | **17** |

Both numbers step at exactly one commit, and it is the same one. The baselined-count drop follows
from the same cause:
fewer phantom symbols ⇒ fewer false import resolutions ⇒ fewer chain-derived violations at
onboarding. This is Drift getting **more** correct, and the gates reading it as a regression.

### 5.3 So what is actually broken

Not the engine — the **measurement layer**.

1. **The baselines were never re-recorded** when a deliberate change moved the metric. The repo's
   own convention (`07bdbb6f "baselines move for W7, with each delta named"`) is to move a baseline
   *with the delta named*. That did not happen for #119, and 13 merges have landed on top of a red
   gate since.
2. **`detection-breadth`'s direction rule is wrong for this metric.** `exported_symbols_fell` is
   hard-coded to mean "detection regression". A precision fix that removes phantom facts can only
   ever be reported as a regression. A metric whose only legal direction is *up* rewards
   over-emission — the exact failure the fix repaired.
3. **Neither suite pins the corpus shas.** `scripts/external-eval-baseline.json` records
   `baselined: 400` for dub with no repo sha beside it, so "changed vs baseline" cannot distinguish
   *Drift changed* from *the repo changed*. Here I could only rule out the corpus by checking that
   its `.git/HEAD` had not been touched since 2026-08-02, two weeks before the baseline commit —
   which is luck, not instrumentation.
4. **CI does not run them,** by design (`.github/workflows/ci.yml` header: evals need the seven
   cloned repos, so they are "a local gate — run `pnpm verify:full` before citing a 'verified'
   claim"). The gate is honest about being local. The consequence is that nothing mechanically
   catches a baseline going stale, and it stayed stale for 147 commits.

**None of this means detection got worse.** I verified that independently in §4: an out-of-sample
repo at HEAD catches 18/21 shapes with zero false positives, and the vendor's own evasion matrix is
green at 87/87. The damage is to *trust in the numbers*: today a user who follows the repo's own
instruction — run `verify:full` before believing a claim — gets two red suites and no way to tell
"this is a stale baseline" from "this product regressed" without doing what I just did.
---

## 6. Defects found (for the post-mortem)

Ordered by how much damage a user takes. Every one has a reproduction and, where I could establish
it, a cause at `file:line`. **I fixed nothing.**

### D-1 — Non-ASCII file paths silently drop out of diff scope  ·  *high*

A route whose path contains non-ASCII characters is **never checked** in `--scope changed-hunks`,
because `git diff` C-quotes such paths and Drift's diff parser does not unquote them.

```
$ git diff --name-only main...HEAD
"app/api/\303\274n\303\257cod\303\251/x/route.ts"          # git's default core.quotepath

$ drift check --diff main...HEAD --scope changed-hunks     # diff = 1 unicode + 1 ASCII file
Findings: 0
Checked 1 file (1 file missing from working tree)
exit 0                                                     # ← the violation is real and unseen
```

`summary.affected_scope.missing_files` records
`"\"b/app/api/\\303\\274n\\303\\257cod\\303\\251/x/route.ts\""` — note that **both** the `b/`
prefix and the octal escaping survive. `partial_coverage.complete` is `false`, yet
`readiness.decision` is `blocking_allowed` with `confidence: 1`, and the check reports `pass`.

**Cause.** `packages/cli/src/check/diff.ts:42` shells out to `git diff --unified=0 <range>` without
`-c core.quotepath=false`; `normalizeDiffPath` at `:261-267` strips the prefix with `/^[ab]\//`,
which cannot match a line that begins with `"`. The Rust side has the same shape at
`crates/drift-engine/src/diff.rs:186-196`.

**Blast radius.** Diff-scoped checks only — this is the CI and agent path. The engine itself is
fine: `--scope full` finds the same route correctly at `app/api/ünïcodé/x/route.ts:2`. Any repo
with accented, CJK or emoji path segments is affected.

**Why no existing gate caught it.** None of the seven corpus repos contains a single non-ASCII path
(`git ls-files | grep '[^ -~]'` → 0 on all seven). The corpus cannot express the shape, so no suite
built on it can fail on it. This is a corpus blind spot, not a gap in test discipline — and it is
the argument for keeping a small synthetic fixture repo alongside the real ones, which the project
already does for stacks (`test/fixtures/detection-breadth-stacks`) and could extend to paths.

**Mitigating.** When the non-ASCII file is the *only* file in the diff, the `stale_diff_scope` guard
at `packages/cli/src/check/run-check.ts:484` fires and Drift refuses with exit `3` — fail-closed.
The false pass needs a mixed diff, which is the common case in practice.

### D-2 — Two laundering shapes defeat chain detection  ·  *medium*

`E04` (`import {db}; export const client = db`) and `E05` (`export function getClient(){return db}`)
both exit `0` with `complete: true`. Chain detection follows re-export *statements*
(`crates/drift-engine/src/facts.rs:1013`), not a value bound to a local. `E04` is named in
`scripts/evasion-matrix.mjs`'s own comments as a known-untested shape; `E05` appears nowhere.
Neither is in any gate, so neither can regress *or* be fixed detectably.

### D-3 — The documented CI recipe is a silent no-op  ·  *medium*

`docs/agent-integration.md` states *"CI adopts the committed contract; it does **not** onboard
itself"* and gives two lines:

```yaml
- run: drift contract import drift.lock --repo "$DRIFT_REPO_ID" --confirm --json
- run: drift check --diff origin/main...HEAD --scope changed-hunks --json
```

Run literally against a fresh state root, step 1 **exits 0 having imported nothing**:

```json
{ "imported": false,
  "compatibility": { "compatible": false, "reasons": ["target_repo_missing"] } }
```

and step 2 then fails with exit `1`, `cli_error`, `"Unknown repo repo_…"`. The working sequence is
`scan` → `import` → `check` (verified: `imported: true`, then exit `2` on a violating diff). The
repo's own workflow `.github/workflows/drift-check-self.yml` runs `start --repo-root . --accept-defaults`
*before* `contract import`, so the shipped pipeline is fine — it is the documented one, and the
sentence claiming CI does not onboard, that are wrong. Underneath the doc bug sits the real defect:
`contract import` exits `0` while reporting `imported: false`.

### D-4 — The empty-diff remediation leads to a second refusal  ·  *medium*

The most common agent action is *create a new file*. An untracked file produces an empty `git diff`,
so Drift refuses:

```
exit 3  Refusing to report a verdict: the diff scope is empty … or use --scope full to check the
        whole repository.
```

Following that advice on a block-mode contract refuses again:

```
exit 3  failure.code = full_scope_cannot_block
        "--scope full cannot block: it attributes every finding to touched_existing …"
```

Both refusals are individually correct and fail-closed. Together they are a dead end, and the fix
the user actually needs — `git add -N <file>`, after which the check works and correctly exits `2` —
is not mentioned. Verified: with `git add -N`, `app/api/agentnew/route.ts:2` is flagged, exit `2`.

### D-5 — `--repo-root` pointing at a non-existent path is not diagnosed  ·  *low*

`drift check --repo-root /nope/nothing` returns exit `1` with
`"Unknown repo repo_2f108b581cb04ff3."` and `user_action: "Read the diagnostic message and rerun
with corrected inputs."` The diagnostic never says the directory does not exist. It also silently
*creates* a state entry keyed to the bogus fingerprint.

### D-6 — `drift doctor` on a non-repo directory reports OK and recommends onboarding  ·  *low*

`drift doctor --repo-root /tmp` exits `0`, reports `OK TS/JS files: 65965 indexable files`,
`OK API routes: 5223 API route files`, and prints `Next command: drift start --repo-root /tmp …`.
It does warn `not inside a Git worktree` and `package.json not found`, but the headline verdict and
the suggested next command point a user at a multi-gigabyte scan of their temp directory.

### D-7 — Backups ignore `--db` and land in the real `$HOME`  ·  *low*

`drift backup create --db <scratch state>/drift.sqlite --confirm` writes to
`/Users/…/.drift/backups/repo_…/…drift-backup.sqlite`. The backup path derives from the default
state root, not from the database being backed up, so a user running with an explicit `--db`
(as every CI and every one of these probes does) gets backups somewhere else.

### D-8 — A clobbered SQLite header surfaces the raw driver error  ·  *low*

Overwriting the first 12 bytes of the state DB yields exit `1` and the bare line
`file is not a database` — no remediation, no `failure` envelope, no pointer at
`drift restore` or at deleting the state root. Mid-file corruption (8 KB zeroed) was survived: the
check still returned exit `2` with the correct finding.

### D-9 — README numbers are stale in both directions  ·  *low*

README: "Evasion shapes caught … **66 / 66** testable cells". The suite now reports **87/87**
testable (91 cells, 4 `UNTESTABLE`). README: "False-positive rate (dub, 494 routes) 3.1%" against a
current measured `route_files: 497`. Understating is the benign direction, but both numbers are
presented as measured and neither reproduces.

### D-10 — Accepting the raw-SQL convention makes `drift check` die  ·  *high (within the experimental surface)*

`api_route_forbids_raw_sql_without_params` is one of the five cells the ledger marks `needs-review`
because nothing ever reached it. Reached (§19), it fails immediately:

```
$ drift check --repo <id> --scope full --json
exit 1   error.code = cli_error
"Invalid Drift engine check result: proven raw SQL proof cannot include
 unparameterized raw SQL calls or missing proof"
```

The engine builds a proof object labelled `proven` that also carries unparameterized raw-SQL calls,
and the CLI-side schema validator — correctly — rejects its own engine's output. Note the exit code:
`1`, an operational error, not `3`. The check does not refuse, it breaks.

### D-11 — Accepting the SSRF convention makes `drift check` die  ·  *high (within the experimental surface)*

Identical shape, different proof:

```
exit 1   "Invalid Drift engine check result: proven SSRF proof cannot include
          untrusted outbound URLs or missing proof"
```

D-10 and D-11 are both behind `--experimental-security` **and** below the `min_coverage_ratio: 0.2`
low-confidence floor, so reaching them takes two deliberate overrides. That is mitigation, not
absolution: the two sibling cells accepted the same way (CSRF, rate-limit) work fine, so a user who
finds one working has no signal that the next will not.

### D-12 — Security candidates are gated by two different flags  ·  *low*

`drift start --experimental-security --json` lists the security candidates. `drift conventions list
--experimental-security --json` does **not** — it reports `experimental_security: {included: true}`
and then hides the same five candidates under `low_confidence: {hidden_count: 5, included: false}`,
reachable only with a second, differently-named flag (`--include-low-confidence`). Two gates, one
set, and the flag whose name matches the concept is not the one that reveals them.

### D-13 — A same-named function from any module satisfies an auth proof  ·  *high*

`api_route_requires_auth_helper`, accepted in `block` mode, records the helper's module in the
contract (`"import": "@/lib/auth/session"`). A route that imports a **different** `requireSession`
from `@/lib/util/impostor` — a stub returning `{ userId: "anonymous" }` — is credited with the auth
proof and exits `0`, while a control route with no guard exits `2` in the same state.

**Cause.** `crates/drift-engine/src/security_patterns.rs:124-136`
(`accepted_auth_helper_for_call`) matches on `fact.name == call.name` and
`fact.imported_name == helper.symbol` and nothing else. Its sibling at `:138-155`
(`accepted_phase4_auth_helper_for_call`) adds `helper_import_matches(...)` — the module check — but
this convention does not take that path.

**Boundary, measured.** A locally-defined `requireSession` (no import) is flagged; an aliased
`unrelated as requireSession` is flagged. Only a genuine export of the right *name* from the wrong
*module* gets through. So the hole is narrow and specific — and it is exactly the shape a re-export
or a same-named wrapper produces. See §21.1.

### D-14 — `conventions exception add` suppresses a finding with no trace in the payload  ·  *medium*

Of the five mechanisms for making a finding go away, four are disclosed in the check result: a
waiver reports `waived_findings_count` and its reason, suppress and accept-drift set a visible
`status`, and a baselined finding shows `diff_status: "touched_existing"`. An **exception** removes
the file from the input set before evaluation — `evaluation_receipts[].inputs_considered` drops to
`0` — and the payload says nothing else about it: `waived_findings: []`,
`waived_findings_count: 0`, no exception field anywhere.

A consumer can only detect it by knowing what `inputs_considered` should have been. In a product
built on "every check reports what it actually inspected," the one mechanism that shrinks the
inspected set is the one that reports nothing. See §21.2.
---

## 7. Refusal and exit-code contract — behaved

This is the part of Drift that is most carefully built, and it holds up. Every documented code was
provoked and matched its documentation.

| Probe | Expected | Observed |
|---|---|---|
| Clean tree, `--diff HEAD` | `3` `empty_diff_scope` | `3`, and the message names the three real causes and prints the `git diff` command that shows what Drift saw |
| `--diff nosuchref...HEAD` | `1` operational | `1`, `cli_error`, git's own message quoted |
| `--scope full` on a block-mode contract | `3` `full_scope_cannot_block` | `3`, with the mechanism spelled out ("attributes every finding to `touched_existing`") |
| Fresh state, no contract | `1` | `1`, `"Unknown repo …"` |
| Unknown flag | `1` | `1`, `"Unknown flag: --frobnicate"` |
| Diff naming only absent files | `3` `stale_diff_scope` | `3`, with the file named and `git status --short` suggested |
| Violating diff, block mode | `2` | `2`, `blocked_reasons: {new_blocking_violation_in_changed_hunk: 1}` |
| `--json` on a refusal | valid JSON on stdout | valid JSON on stdout, 2386 bytes; the human line goes to stderr |

`scripts/error-contract.mjs` independently reconciles 19 codes (12 refusals at exit `3`, 7 errors at
exit `1`) against the documentation, and passes. The `failure.code` discriminator is present on
refusals and absent on pass/block, exactly as `docs/reference/enforcement.md` says.

Edge shapes that behaved correctly and are worth recording as *working*:

- **CRLF line endings** — caught, correct line number.
- **Minified single-line route** — caught at `:1`.
- **Paths containing spaces** — caught (git does not quote these; see D-1 for the ones it does).
- **`node_modules/` route file** — correctly excluded (the engine uses `ignore` with real
  per-directory `.gitignore` semantics).
- **Rewriting a baselined violation into a different import shape** — re-fires and blocks (exit `2`).
- **`git mv` of a baselined violation** — stays baselined, `diff_status: touched_existing`, exit `0`.
  Correct: no new violation was introduced.
- **Copying a baselined violation into a brand-new route** — blocks (exit `2`). This is the
  agent-realistic case and it is handled.

## 8. Determinism — clean

Measured on a frozen copy of `openstatus` outside the shared corpus, with nothing else running.

| Level | Trials | Result |
|---|---|---|
| Engine `scan-repo` | 8× taxonomy, 5× openstatus (frozen), 3× openstatus (live corpus) | **bit-identical every run** — taxonomy `facts=1850 exported_symbol=282 import_used=547 files=132 diags=7`; openstatus `facts=90940 exported_symbol=4221 files=2185 diags=712` |
| Full CLI onboarding | 6× | **identical every run** — `files=2185 facts=90940 baselined=17 candidates=7`, same learned `forbidden_imports` |

**A correction worth recording, because it nearly became a finding.** My first determinism run —
against the *shared* corpus while the vendor's evasion harness was injecting into it — reported
`files=2187 / 2186 / 2185` and looked like real flicker. It was contention. A bisect I ran under the
same contention blamed a docs-only commit. The lesson generalises: **any measurement of this product
taken while another Drift harness is running against the same corpus is void.** The repo already
knows this (`scripts/worktree-contamination.mjs` exists for it); the harnesses that inject into
shared repos should hold a lock.
### 8.1 Incremental reuse, verified as claimed

`incremental_reuse` is one of the seven capabilities the claims manifest asserts. It is real and it
self-reports. Onboarding `taxonomy`, touching exactly one route file, then rescanning:

```json
"incremental_changes": { "added": 0, "modified": 1, "deleted": 0, "unchanged": 131, "total": 132 },
"incremental_plan":    { "previous_scan_id": "scan_3c087d5f29147e4b",
                         "execution_mode": "incremental_reuse", "reuse_applied": true,
                         "reusable_file_count": 131, "changed_file_count": 1,
                         "blocked_reasons": [] }
```

Fact counts stay identical across the reused scan (`fact_count: 1850` before and after), and
`blocked_reasons` is the field that would say *why* reuse was refused — so a degraded run is
distinguishable from a fast one. That is the same disclosure discipline as the coverage fields, and
it is the thing that makes the performance numbers in §7 trustworthy rather than a black box.
---

## 9. Agent surface (MCP) — works, and one tool is unusable at real-repo scale

12 read-only tools over stdio JSON-RPC. `initialize` in ~100 ms, correct protocol revision
(`2024-11-05`), typed argument validation with actionable errors
(`"Invalid arguments for get_findings: missing required field repo_id"`), and no mutation tool
exists — matching the `mutation_capable_mcp` block in the claims manifest.

Median of 3 calls each, payload measured as returned text:

| Tool | 41-file repo | | `openstatus` (2,185 indexed files) | |
|---|---|---|---|---|
| | latency | tokens (≈chars/4) | latency | tokens |
| `get_repo_contract` | 3 ms | 1.3k | 3 ms | 4.9k |
| `get_conventions` | 2 ms | 0.8k | 3 ms | 4.3k |
| `get_audit_status` | 4 ms | 0.4k | — | — |
| `get_required_check_executions` | 2 ms | 0.2k | — | — |
| `get_findings` | 32 ms | 2.3k | — | — |
| `get_security_context` | 11 ms | 16.6k | 816 ms | **29.7k** |
| `get_scan_status` | 36 ms | 1.3k | 2,250 ms | **82.7k** |
| `get_task_preflight` | 68 ms | 14.3k | — | — |
| `get_repo_map` | 62 ms | 15.7k | **28,969 ms** | **≈500k** |

**`get_repo_map` returns ~2.0 MB / ~500,000 tokens in 29 seconds on a mid-sized repo.** That is
larger than any current model's context window, so the call cannot be consumed at all — the agent's
only option is to discard it. The tool *does* accept `limit`/`offset`, but the default is unbounded
and nothing in `docs/agent-integration.md` says to paginate. `get_scan_status` at 83k tokens is the
same problem one order of magnitude down.

The docs are candid about the cost of the tool they recommend — "a preflight packet is roughly
20,000 tokens on a small repo" (I measured 14.3k, so if anything conservative) — but say nothing
about the two tools that are 4× and 25× that. For a product whose stated differentiator is that an
agent can *query* the repo, an unbounded default on the map tool is the highest-leverage fix in this
report after D-1.

### 9.1 Where the MCP bytes actually go

`get_repo_map` accepts `limit`/`offset`, so the obvious mitigation is to paginate. It does not work.
Measured on `openstatus`:

| `limit` | latency | payload |
|---|---|---|
| unbounded | 29.0 s | 1,999,385 chars (≈500k tok) |
| `50` | 37.6 s | 821,690 chars (≈205k tok) |
| `5` | 45.3 s | 797,648 chars (≈199k tok) |
| `1` | 44.2 s | 796,269 chars (≈199k tok) |

`limit` bounds exactly one field. At `limit: 1` the 796 KB payload decomposes as:

| Section | bytes | share |
|---|---|---|
| `topology` | 399,212 | 50 % |
| `scan_status` | 330,773 | 42 % — of which **`parser_gaps` alone is 322,587** |
| `routes` | 43,621 | 5 % |
| `framework_entrypoints` | 14,895 | 2 % |
| **`files`** (the field `limit` bounds) | **290** | 0.04 % |

The itemized parser-gap records are the same ones commit `3853968e` measured and wrote up:
*"on openstatus the records are 359,973 of 714,662 bytes — 50.4 % of the envelope … BB-6 had already
removed those same records from `task_preflight_packet` after measuring them; they re-entered the
same document one level up."* They are still there, and they now dominate `get_repo_map` and
`get_scan_status` too. `get_task_preflight` is 66k tokens / 7.8 s on the same repo, against a
documented expectation of "roughly 20,000 tokens on a small repo".

This is the cheapest large win available: cap or summarise `parser_gaps` in the agent-facing packets
and make `limit` bound the whole document, and three tools drop by an order of magnitude.
---

## 10. State, durability, privacy

**Footprint.** SQLite state scales with indexed files, and it is not small:

| Repo | indexed files | repo on disk | `drift.sqlite` | per file |
|---|---|---|---|---|
| oos-shop (synthetic) | 41 | — | 0.5 MB | ~12 KB |
| taxonomy | 132 | — | 8.1 MB | ~61 KB |
| openstatus | 2,185 | 217 MB | **368 MB** | ~168 KB |

`drift doctor` estimated "about 0.5 GB needed" for openstatus against 368 MB actual — a
conservative, honest estimate. The repo's own docs note a 189 MB papermark state DB, so this is
known. It is still worth a line in the README: onboarding a mid-sized monorepo costs roughly
**1.7× the repo's own size** in local state.

**Durability.** `audit verify` and `backup create` both succeed and produce a manifest with
`checksum_sha256`, `repo_fingerprint`, `schema_version` and size. `pnpm beta:proof` verifies an
8-event hash chain with `"valid": true, "strict": true`. Corruption behaviour: 8 KB zeroed mid-file
was survived with the correct verdict still returned; a clobbered header fails closed at exit `1`
(see D-8 for the message quality).

**Privacy — nothing leaves the machine, verified structurally.** The engine's entire dependency set
is `serde`, `serde_json`, `sha2`, `tree-sitter`, `tree-sitter-typescript`, `ignore` — no HTTP, no
TLS, no socket crate. Every TypeScript package depends only on workspace siblings plus `zod` and
`better-sqlite3`. The only occurrences of `fetch`/`axios`/`http` in shipped source are *string
literals inside the security pattern matcher* (`security_phase6.rs:826-829`), i.e. Drift looking for
egress in **your** code. There is no network code to disable.
---

## 11. First run, cold, from the README verbatim

Run in a scratch `$HOME` with no prior Drift state, against an out-of-sample repo, using exactly the
commands the README prints and nothing else:

```
$ drift doctor --repo-root .
… WARN Drift state: not initialized
Next command: drift start --repo-root <path> --accept-defaults          exit 0

$ drift start --repo-root . --accept-defaults
Drift is ready for this repo.
Scanned 41 files. Stored 408 facts. Found 3 convention candidates.
Accepted "api_route_no_direct_data_access" in BLOCK mode
  (3 existing violations baselined — new violations exit 2).                exit 0

# agent commits a route that queries the database directly
$ drift check --diff HEAD~1...HEAD --scope changed-hunks
Findings: 1  Blocking: 1  Checked 1 file
  finding_394850684bafb3da error/block new new_in_diff
  app/api/readme/route.ts:2 - API route imports data access directly        exit 2
```

**The README quickstart works, cold, first try, with no undocumented steps.** `doctor` chains into
`start` chains into `check`; each command prints the next one with the flags already filled in.
That is the single best thing about this product's UX and it deserves saying plainly. `start` also
states the enforcement mode *and* what it implies (`new violations exit 2`) rather than leaving the
user to discover it from an exit code.

## 12. Published claims vs. what reproduces today

| README claim | Reproduces? | Evidence |
|---|---|---|
| Onboards, learns the data layer, catches an injected violation — **7/7** | **yes** | `eval:external`, all seven rows `ok` |
| Correct `file:line` evidence — **7/7** | **yes** | same, `evidence=y` on every row |
| A properly layered route falsely flagged — **0/7** | **yes** | same, `cleanFP=no` on every row |
| Evasion shapes caught — **66/66** | **stale (better)** | suite now reports 87/87 testable, 4 `UNTESTABLE`, 0 `FAIL` |
| Ordinary edits refused — **0/56** | **yes** | `eval:bench`, `refused 0/8` per repo |
| Local import resolution **96.1 %–99.9 %** | **yes** | `eval:bench`: calcom 96.1, taxonomy 97.8, papermark 98.6, formbricks 99.5, dub 99.9 |
| False-positive rate on dub **3.1 %** | **not reproducible** | no suite computes it; the number lives only in prose at `docs/concepts.md:26` as a historical before/after. Nothing would notice if it moved. |
| "dub, 494 routes" | **stale** | current measurement is 497 route files |
| Runs entirely on your machine | **yes** | §10 — no network dependency exists in any shipped package |
| Read-only MCP, no mutation tools | **yes** | §9 — 12 tools, all `get_*`; enforced by the claims manifest |
| Every check reports its own coverage | **yes, with one exception** | `partial_coverage`, `import_coverage`, `evaluation_receipts` are present on every check I ran; D-1 is the case where `complete: false` is reported but the verdict is still `pass` |

Two of the six suites that produce these numbers exit `1` today (§5). The individual claims above
still hold — I read them out of the per-row output, which is printed before the baseline comparison
that fails — but a user cannot confirm them the way the repo instructs, by running `verify:full` and
seeing green.
---

## 13. Precision and recall on a real repo, adjudicated by hand

The README's "3.1 % false-positive rate on dub" is the one published number no suite computes
(§12). So I measured it independently on a frozen copy of `dub` (497 route files, 4,083 TS files),
onboarded fresh: `baselined 349`, `warn` mode, learned
`forbidden_imports: ["@/lib/prisma", "@/lib/prisma/edge", "@prisma/client"]`.

`drift check --scope full` returns **349 findings across 325 distinct route files**. My independent
oracle — multi-line-aware, comment-stripping, type-only-aware — finds **326 route files** containing
a value import of one of those three specifiers. Two files disagreed. I read both:

| File | Oracle says | Drift says | Adjudication |
|---|---|---|---|
| `…/api/cron/sitemaps/queue/route.ts` | violates via `@/lib/prisma` | flagged, but citing `@prisma/client` at line 5 | **Drift correct.** It found the route; it cited the other forbidden import. Line 3 (`prisma.$queryRaw`) is the stronger evidence and line 5 is what the finding names — a minor evidence-selection nit, not a miss. |
| `…/api/partner-profile/programs/[programId]/route.ts` | violates via `@prisma/client` | not flagged | **Drift correct.** `Reward` is used only in a type predicate `(r): r is Reward`. Erased at runtime. My oracle over-counted. |

**Result: 325 / 325 precision, 325 / 325 recall, zero hard false positives** — no file was flagged
that contains no runtime import of a forbidden specifier, and no file containing one was missed.

The same effect at scale: of the 94 route files importing `@prisma/client`, Drift flags **25**. I
sampled the other 69 and they are all type-position uses — `Prisma.FraudAlertUpdateManyArgs["data"]`,
`let workflow: Workflow | null`, `Pick<Project, "id" | …>`. TypeScript erases every one of them.
This is the "type-only bindings are not facts" design doing exactly what the repo claims it does,
and it is the difference between a usable tool and 69 false blocks on one repo.

**Residual I cannot rule out:** both my oracle and this comparison only see *direct* imports of the
learned specifiers. A dub route violating through a barrel neither of us traced would be invisible
to both. The shape matrix in §4 is the instrument for that class, and it says barrels are caught.

The vendor's own `eval:presence` suite reports the same picture on synthetic fixtures —
`precision=1 recall=1 (50 ok / 50 bad, fp=0, fn=0)` per repo per convention.
---

## 14. Performance at real-repo size

Apple M4 / 10 cores / 16 GB, on AC, nothing else running. Every cell is a median with its trial
count; the single-file check is the number that decides whether an edit-time guardrail is possible.

| Repo | indexed / TS files | engine `scan-repo` (med, n=5) | peak RSS | `start` onboarding (med, n=2) | `drift.sqlite` | **single-file `check`** (med / p95, n=5) | `check --scope full` (med, n=2) |
|---|---|---|---|---|---|---|---|
| `oos-shop` | 41 | 0.01 s | 5 MB | 0.39 s | 1.7 MB | **0.17 s** / 0.17 s | 0.18 s |
| `taxonomy` | 132 | 0.09 s | 9 MB | 0.63 s | 7.1 MB | **0.22 s** / 0.22 s | 0.23 s |
| `papermark` | 1342 | 2.37 s | 56 MB | 10.51 s | 193.2 MB | **1.58 s** / 1.62 s | 2.11 s |
| `openstatus` | 2185 | 3.66 s | 106 MB | 15.65 s | 367.8 MB | **3.14 s** / 3.17 s | 3.34 s |
| `formbricks` | 2819 | 5.97 s | 148 MB | 30.56 s | 659.5 MB | **4.88 s** / 4.91 s | 5.57 s |
| `dub` | 4083 | 8.43 s | 116 MB | 31.58 s | 502 MB | **6.68 s** / 6.76 s | 8.43 s |
| `calcom` | 5025 | 7.73 s | 164 MB | 36.29 s | 732.1 MB | **6.02 s** / 6.13 s | 7.03 s |

**A one-file check costs a whole-repo scan.** That is the single most important line in the grid.
On `dub`, checking a one-line diff in one file takes **6.68 s** while `--scope full` over 4,083
files takes 8.43 s — the same order, not the same order of magnitude apart. The reason is visible in
the payload:

```json
"scan_status": { "mode": "check_time_collection", "stored_scan_required": false, "stale": false }
```

`check` re-collects facts at check time rather than reusing the stored scan, so cost tracks repo
size, not diff size. `changed_file_count: 1` and the run still pays for 4,083 files.

This is why `docs/agent-integration.md` says edit-time hooks are **not shipped** — "a single-file
check currently takes ~3.9 seconds on a 4,000-file repo, against a target of under one second… a
guardrail that pauses four seconds on every edit gets disabled". The honesty is exactly right. The
number has moved: on this machine a 4,083-file repo costs **6.68 s**, ~1.7× the documented figure.
Whether that is drift in the product or in the measuring machine I cannot say — there is no
committed performance baseline to compare against, and that absence is itself the finding. Five of
the six eval suites ratchet correctness; **none ratchets latency.**

The rest of the grid is unremarkable in the good sense: scan time and memory are close to linear in
file count (peak RSS 5 MB → 164 MB across a 120× range in files), onboarding is a one-time 30–36 s
on the largest repos, and nothing degraded or thrashed. `formbricks` is the outlier on database
size (659 MB for 2,819 files) — its 217 parser gaps and high unresolved-symbol count mean more
stored diagnostics per file.

**What this means for the two intended use cases.** For **CI on a pull request**, 3–8 s is nothing;
Drift is comfortably fast enough. For an **agent inner loop** — a check after every edit — 3–8 s per
call is disqualifying, and the project already says so rather than shipping the hook. The fix is
architectural (reuse the stored scan for the diff's files, the way `scan` already reuses 131 of 132
files in §8.1), not a constant-factor optimisation.
---

## 15. The experimental security surface — smoke-tested, and the gate is earning its keep

`--experimental-security` is a beta surface a user may reasonably switch on, so I built a fixture for
it: 10 routes calling `requireSession(req)` before touching a service, 2 routes with no guard, one
auth module. Onboarding with the flag:

```
candidates: api_route_no_direct_data_access(candidate),
            api_route_requires_service_delegation(candidate),
            api_route_requires_auth_helper(candidate),      required_calls: ["listSessions"]   ← wrong
            api_route_requires_auth_helper(candidate)       required_calls: ["requireSession"] ← right
accepted:   api_route_no_direct_data_access                 (security kinds are NOT auto-accepted)
```

Two findings, in tension, and both worth recording:

**The candidate inference is name-based and produced a false one.** `listSessions` is my *service*
function for the sessions domain — ordinary CRUD — and the heuristic proposed it as a required auth
call with 5 pieces of "evidence". Any repo with a `listSessions`, `getSession`, `checkAccess`-shaped
service function will get the same. This is precisely what "heuristics, not proofs" means, and it is
why `--accept-defaults` refuses to accept these kinds and why the flag exists. **The gate is doing
its job.**

**The enforcement logic behind it is not naive.** Accepting the correct candidate explicitly
(`drift conventions accept … --mode block --confirm`) and then testing three shapes:

| New route | Verdict |
|---|---|
| No guard at all | **exit 2** — `app/api/open/new/route.ts:6 — API route missing required auth proof` |
| `await requireSession(req)` before the work | **exit 0**, no finding |
| `if (header !== "1") { await requireSession(req) }` — guard present but **not dominating** | **exit 2** — `app/api/secure/cond/route.ts:10` |

The third case is the one that separates real analysis from a grep: the helper is imported, called,
and spelled correctly, and Drift still flags it because the call does not dominate the handler's
exit paths. That is control-flow-aware, and it is the right answer.

**What this does not establish.** One fixture, one convention kind, on a 55-file repo. The security
subsystem is ~6,900 of the engine's 26,300 lines and covers tenant isolation, sensitive-field
exposure, middleware matching, rate limiting and secret sinks. Nothing here measures those. The
project's own audit of them is at `docs/internal/architecture/security-heuristic-audit.md`, and the
`test/canary/convention-cell-ledger.json` records 18 cells with 11 firing, 2 quarantined and 5
needs-review — a ledger that says, in the product's own voice, that this surface is not finished.
Treat §15 as evidence that the surface is *alive and gated correctly*, not that it is *validated*.
---

## 16. Coverage of this audit, and what it does not cover

**Covered, executed, evidence on disk.** Architecture inventory; full unit/e2e/harness suites; all
11 static and invariant gates; all six vendor eval suites; a 29-cell out-of-sample shape matrix with
auditor-held ground truth; an independent import oracle and a hand-adjudicated precision/recall run
on `dub`; the refusal and exit-code contract; determinism at engine and CLI level on a frozen tree;
a per-commit attribution sweep across 18 merges; MCP payload and latency measurement; state
footprint, corruption and backup behaviour; dependency-level egress analysis; a verbatim cold README
run; a performance grid over seven repos; incremental-reuse verification; **mutation-testing the
eval suite (8 mutants); reachability of the convention-cell ledger (6 of 18 cells); an agent-in-the-
loop A/B (18 runs over two repo shapes); and four probes taken from the architecture map** — Tier 0
identity resolution, the five suppression mechanisms, a framework with no adapter, and behavioural
CLI ↔ MCP parity.

**Not covered. This list is the honest remainder, not a formality.**

*Convention surface*

- **12 of 18 ledger cells are still unreached.** §19 and §21.1 cover data-access, auth, CSRF,
  rate-limit, SSRF and raw-SQL. Untouched: tenant scope, authorization, session trust, sensitive
  response fields, secret exposure, CORS, the request-validation proof path, and the two
  `quarantined` cells (service delegation, middleware coverage) whose "refused at acceptance, by
  name" claim was never tested. The technique for reaching them is now known (§19); applying it is
  rote.
- **Multi-convention composition.** Every check here ran with one or two conventions accepted. Real
  contracts accumulate several; whether enforcement, findings volume and payload size compose
  sanely is untested.
- **The 29-shape matrix ran on one synthetic repo.** The vendor's own matrix is 13 shapes × 7 real
  repos; mine is 29 × 1. Neither covers the union, and real repos add resolver conditions —
  workspace aliases, deep tsconfig paths — a fixture does not.

*Architecture paths never executed*

- **The TypeScript fallback scanner.** A whole second scanner behind the `typescript_fallback_used`
  refusal; Drift was never once run without the Rust binary.
- **Schema migration from an older database.** `sqlite-storage.ts:196-204` refuses unrecognised
  migrations; nobody has opened a pre-v36 state with a v36 binary. Every upgrading beta user hits
  this exactly once.
- **Audit-chain tamper detection.** `audit verify` was run on a clean chain only; no row was ever
  edited and re-verified.
- **Concurrency.** Storage is WAL with no `busy_timeout` found. An agent, a CI job and an editor
  against one `drift.sqlite` is the local-first use case and it is unmeasured.
- **The `graph_hash` streaming invariant** and **adversarial contract import** (a hostile or
  malformed `drift.lock`, path traversal in globs).

*Lifecycle and platform*

- **Baseline across history rewrites** — rebase, squash-merge, force-push. Baseline semantics were
  tested on linear history only, and this is the realistic CI failure mode.
- **`--scope changed-files`**, the third scope mode, was never run.
- **Windows.** `validate-engine-release-matrix` reports `0 of 5 engine release targets verified`.
  Nothing here exercises Windows path separators, CRLF-native checkouts, or a case-insensitive
  filesystem — which matters more than usual given D-1.
- **Long-running incremental behaviour**, **multi-developer / shared state**, and the
  **`--data-modules`** escape hatch end-to-end.

**A note on statistical power, stated once.** The A/B is N=18 with a zero event rate; the
performance grid is n=5 per cell (n=2 for onboarding and full-scope checks); determinism is 6 CLI
runs and 8 engine runs. These support "no effect detected at this sample size" and "approximately
this fast." They do not support any claim about small differences, and no confidence interval in
this report should be inferred where none is given.
---

## 17. Beta readiness — evidence against the questions that decide it

I am not voting. Here is the evidence against each question a beta gate should ask.

**Can a new user get from install to a first true verdict without help?**
Yes. §11 — the verbatim README flow works cold, and every command prints the next one. The install
itself is build-from-source (no npm publish), which the README states up front. `drift doctor`
diagnoses the toolchain before anything else and refuses to be silent about a missing engine.

**When Drift says `pass`, is it because it checked, or because it checked nothing?**
Mostly the former, with one exception that must be fixed. Coverage is reported on every check
(`partial_coverage`, `import_coverage`, `evaluation_receipts`, `readiness`), refusals are
fail-closed and outnumber errors 12:7 in the error contract, and `--scope full` refuses rather than
pretending it can block. **D-1 is the counter-example**: a mixed diff containing a non-ASCII path
returns `pass` with `complete: false` and the violation unexamined. That is exactly the failure
class this whole product exists to prevent, and it is a ~5-line fix
(`-c core.quotepath=false`, or unquote in `normalizeDiffPath`).

**Does it catch what an agent actually writes?**
18/21 on shapes I chose adversarially and out of sample, including every barrel form, dynamic
`import()`, `require()`, side-effect import, Pages Router, `.js`/`.tsx`, route groups and dynamic
segments. The two real misses (D-2) are value-laundering through a local binding — worth fixing,
and worth a *gate* more than a fix, since neither shape is currently pinned by anything.

**Does it stay quiet on code that is fine?**
Zero false positives on 8 negative controls, `cleanFP=no` on all seven real repos, and **0 of 56
ordinary edits refused**. This is the number that decides whether a first session is tolerable, and
it is clean.

**Are two runs over identical input identical?**
Yes — 8/8 and 5/5 at the engine, 6/6 through the full CLI, bit-identical. The one apparent flicker I
saw was my own contention and I retract it.

**Does it stay usable at the size of a real repo?**
For CI, yes: 3–8 s per check on 2,000–5,000-file repos, 30–36 s one-time onboarding, peak RSS
164 MB at the largest. For an agent's inner loop, no — and the project says so. §14 shows why: a
one-file check re-collects the whole repo (`mode: check_time_collection`), so it costs 6.68 s on
`dub` where `--scope full` costs 8.43 s. Local state is the other cost: 368 MB for `openstatus`,
732 MB for `calcom`.

**Is it precise on a real codebase, not just on fixtures?**
Yes, and this is the strongest result in the report. On `dub` — 497 route files — Drift's 325
flagged files match a hand-adjudicated oracle exactly: **zero false positives, zero misses** (§13).
The two apparent disagreements both resolved in Drift's favour.

**Does an agent consuming Drift get a contract it can rely on?**
The schema surface is unusually disciplined — versioned `response_schema` on every payload, a
machine-contract-versions block, typed refusal codes, and a parity gate comparing 622 CLI and 131
MCP function bodies. But `get_repo_map` returning half a million tokens by default (§9) means the
headline agent tool cannot be called as documented on a real repo.

**Does anything leave the machine?**
No. There is no network dependency in any shipped package.

**If Drift broke, would anyone find out?**
For the engine's core, yes and quickly: 8 injected faults in alias resolution, symbol identity,
helper matching and convention scope were all caught, every one by the 20-second Rust suite (§18).
For the *published numbers*, no — that is §5.

**Are the conventions the product ships actually wired up?**
Partly. Of 18 declared cells I reached 6. Two of the five the project marks `needs-review` are not
unverified but **broken** — `drift check` exits `1` on an engine/CLI proof-invariant violation the
first time their path runs (§19, D-10/D-11). Two others fire correctly once reached.

**Do the security conventions prove what they claim to prove?**
Not all of them. The auth convention's contract records the helper's module and its enforcement
ignores it, so a same-named stub from an unrelated module passes (§21.1, D-13). A local definition
and an alias are both correctly caught, so the hole is narrow — and it is precisely the shape a
re-export produces. Against that, the honest-refusal behaviour on a framework Drift cannot parse is
the strongest single result in this report (§21.3).

**Does giving an agent the conventions change what it writes?**
Unknown, and the honest answer is that nobody — including this report — has shown that it does. A
paired A/B over two repo shapes came back 18/18 clean in both arms at +5.8 % tokens for the arm with
Drift (§20). The base rate was zero, so the experiment bounds rather than answers.

**Do the published numbers reproduce?**
The individual per-repo results do. `pnpm verify:evals` does not — two suites exit `1` on a clean
checkout (§5), for a reason that is a *correctness improvement* the baselines were never updated to
absorb.

### What I would fix before calling it beta

1. **D-1** — quote-safe diff paths, both parsers. Silent false pass; smallest fix in the report.
2. **Re-record `detection-breadth` and `external-eval` baselines with the #119 delta named**, and
   pin the corpus shas beside each row so the next movement is attributable without a commit sweep.
3. **Stop treating `exported_symbols_fell` as automatically a regression** — a precision fix can
   only lower it, and a metric that may only rise rewards over-emission.
4. **Bound `get_repo_map` (and `get_scan_status`) by default** and say so in the agent docs.
5. **Fix the CI recipe in `docs/agent-integration.md`** (add the onboarding step) and make
   `contract import` exit non-zero when it imports nothing.
6. **Pin `E04`/`E05` as known-evasion cells** in the evasion matrix so their state is recorded
   rather than folklore.
7. **Mention `git add -N`** in the `empty_diff_scope` remediation.
8. **Add a latency baseline to the eval suite.** Six suites ratchet correctness and none ratchets
   time, which is how a documented 3.9 s becomes an unremarked 6.7 s.
9. **Fix D-10/D-11** — the raw-SQL and SSRF proof invariants — and commit the conformance-majority
   fixture from §19 so those cells can leave `needs-review` on evidence rather than on inspection.
10. **Wire the mutation harness into the routine.** It is written, it works, it takes 187 seconds,
   and it had never been run. It is the cheapest gate in the repo per unit of assurance.
11. **Route the auth-helper convention through the Tier 1 resolver** (D-13). The module-checking
   function already exists one definition below the one in use.
12. **Disclose exceptions in the check payload** (D-14) — a count and a reason, as waivers already do.
13. **Run the A/B that §20 specifies** — weaker model, larger repo, a task the service layer cannot
   express, and `check`-as-gate as its own arm — before the differentiator is claimed in the README.

Items 2, 3 and 6 are measurement-layer work, and they are the ones that decide whether the next
regression is caught by a gate or by an auditor.
---

## 18. Mutation-testing the eval suite

The repo ships a harness (`docs/beta-live-validation/harness/mutate`) whose premise is sharper than
any other gate here: *"Every eval in this repo asks 'does Drift catch violations?' The question none
of them ask is 'if Drift stopped working, would we find out?'"* It had never been run. Its 8 mutants
target the identity-resolution and scope code the S4/S6 sprints rewrote.

All 8 anchors still matched at `a0517f3e`. I ran them in a throwaway worktree, each applied once,
built once, then climbed a gate ladder until something went red. **`eval:breadth` and `eval:external`
were excluded from the ladder: they are already red at HEAD (§5), and a gate that is red before the
mutation cannot be said to have caught it.**

| Mutant | File | Killed by | Manifest expected |
|---|---|---|---|
| `alias-fixpoint-off` | `rules.rs` | `test:engine` | test:engine, eval:evasion, eval:breadth |
| `alias-one-hop` | `rules.rs` | `test:engine` | test:engine, eval:evasion |
| `symbol-identity-off` | `security_patterns.rs` | `test:engine` | test:engine, test:e2e, eval:presence |
| `helper-module-any` | `security_patterns.rs` | `test:engine` | test:engine, test:e2e, eval:presence |
| `helper-spelling-any` | `security_patterns.rs` | `test:engine` | test:engine, eval:presence |
| `repo-resolved-any-file` | `security_patterns.rs` | `test:engine` | test:engine, eval:presence |
| `scope-matches-nothing` | `check_command.rs` | `test:engine` | test:e2e, cell-ledger, eval:presence |
| `phase5-scope-everything` | `check_command.rs` | `test:engine` | test:engine, eval:presence |

**Mutation score 8/8, total wall clock 187 seconds.** Every fault died at the *first and cheapest*
gate. `scope-matches-nothing` is the standout: the manifest did not expect `test:engine` to catch it
at all, and it did.

This is a genuinely good result and it sharpens §5 rather than softening it. The engine's core is
guarded by a 20-second Rust suite, not by the hour-long external evals — so the two red suites,
while a real problem for *trust in the published numbers*, are not the last line of defence for
correctness. It also partially updates `docs/architecture/mutation-check.md`, which concluded from a
different 5-mutant set that "the external suite — not the unit tests — is what actually guards
enforcement." For this 8-mutant set the opposite holds.

## 19. Reaching the five cells the ledger marks `needs-review`

`test/canary/convention-cell-ledger.json` declares 18 cells. Five are `needs-review`, and the
ledger gives one root cause for all of them: *no fixture induces the proposer to emit a candidate of
that kind, so the enforcement arm was never entered* — "swept all 79" fixtures.

Reading the emission conditions in `crates/drift-engine/src/candidate_command.rs` explains why. The
proposer infers from **conformance** evidence and needs ≥2 route files calling the same helper:
SSRF wants a symbol matching `allowlist|allow+url|sanitizeurl|safeurl`; CSRF wants one containing
`csrf`; rate-limit wants `ratelimit|rate_limit|throttle|limiter`; raw-SQL wants
`parameterized_sql_used` facts. Every existing `security-*` fixture shows only the *violation*, so
there is never anything to infer from. I built the missing shape — 24 conforming routes, 8 violating
— and all four kinds proposed immediately, 6 evidence refs each.

Then I accepted each in `block` mode, one per isolated state, and checked:

| Cell | Ledger | Reality once reached |
|---|---|---|
| `api_route_requires_csrf_for_mutation::phase6_proof` | needs-review | **fires** — `reached=true`, flags both `csrf-bad` routes |
| `api_route_requires_rate_limit::phase6_proof` | needs-review | **fires** — `reached=true`, flags both `rl-bad` routes |
| `api_route_forbids_raw_sql_without_params::phase6_proof` | needs-review | **D-10 — `drift check` dies, exit `1`** |
| `api_route_forbids_untrusted_ssrf::phase6_proof` | needs-review | **D-11 — `drift check` dies, exit `1`** |

Two of the five were never merely unverified — they are **broken**, and the first execution of the
path proves it. Both cells' emission code, dispatch arm and proof builder all exist; what does not
hold is the invariant between them.

One further observation about the two that do fire: a candidate inferred from **6 conforming routes
out of 32** is proposed as a repo-wide rule, and accepting it produces 26 findings — every POST route
that does not call the helper, including routes that were never about that concern. The enforcement
is literally correct given the accepted contract; the *inference* generalises from a 19% sample. The
project's own guard caught this: 6/32 = 0.1875 sits just under the `min_coverage_ratio: 0.2`
low-confidence floor, which is why these candidates are hidden until you pass
`--include-low-confidence`. **The safety machinery worked; I had to deliberately override two
separate gates to reach the defects.**
---

## 20. Does Drift change what an agent writes? A paired A/B

Every other measurement in this report tests the *instrument*. This one tests the **claim**: that an
agent which can query the repo's conventions before writing produces conforming code more often than
one that cannot.

**Design.** Two arms, isolated repo copies, one agent per cell, all agents Opus-class with identical
instructions except the variable under test:

- **Arm A** — repo + task. No Drift, no mention of it. Instruction ends *"follow the patterns already
  established in the codebase."*
- **Arm B** — byte-identical, plus: *"read this preflight briefing describing the conventions this
  repository enforces"* (`drift prepare` output, ~1.3 KB).

Scored twice and independently: my own grep oracle for a direct data-layer import in the new route,
and `drift check` against a state onboarded at the base commit.

Run on two repo shapes, because the first result made the second necessary:

| Repo | Shape | Mode | Arm A violations | Arm B violations |
|---|---|---|---|---|
| `oos-shop` | 30 clean routes : 3 violating | block | **0 / 5** | **0 / 5** |
| `legacy-shop` | 4 clean routes : 26 violating (a dub-shaped repo) | warn | **0 / 4** | **0 / 4** |

**18 / 18 clean. The preflight changed nothing, because the base rate was already zero.**

The arm-A agents volunteered the reasoning unprompted. One: *"all 25 non-legacy routes go through a
service; only the 3 `app/api/legacy/*` routes import `@/lib/db` directly, violating the stated
convention — I did not follow those."* Another, in the repo where 26 of 30 routes violate: *"followed
the existing service-backed route pattern as used by `app/api/users/route.ts`."* Given a service layer
that exists at all, these agents picked it — even when it was the minority pattern by 26 to 4.

**What this costs.** Per-task token spend, measured from the runs:

| Repo shape | No Drift | With preflight | Delta |
|---|---|---|---|
| clean-majority | 34,539 | 36,555 | +2,017 (+5.8 %) |
| violating-majority | 32,790 | 34,674 | +1,883 (+5.7 %) |
| **pooled (n=9 vs 9)** | | | **+1,957 tok/task (+5.8 %)** |

The briefing itself is only ~320 tokens; the rest is the agent reading and reasoning about it. So on
this evidence the preflight costs ~6 % more tokens per task and buys no measurable behavioural change.

**What this does and does not establish.** It is an upper bound on the base rate, not a verdict on
Drift. You cannot measure a reduction from zero. Four honest limits:

1. **The model is strong.** These are Opus-class agents that read the repo before writing. A cheaper
   model, or one with a full context window and less room to explore, is the population where a
   preflight should matter most, and it is untested here.
2. **The repos are small.** 30 routes, fully readable. On calcom (5,025 files) an agent cannot read
   everything, and the preflight's exemplar list is doing work that exploration cannot.
3. **The task shape was favourable.** Every task was "add a list endpoint," and a service layer
   already existed to extend. The tempting case is a task the service layer *cannot* express — an
   aggregate, a join, a filter — where writing a new service is more work than importing the client.
   That is the experiment I would run next, and it needs no new machinery.
4. **`check` was never the variable.** Arm C — Drift as a post-hoc gate rather than as context — was
   designed as a paired follow-on to arm A, and with zero arm-A violations it had nothing to act on.
   Whether the *check* alone delivers the benefit the *preflight* is credited with is still open, and
   it is the comparison that decides whether the MCP surface earns its 66k tokens (§9).

The negative result is worth as much as a positive one would have been: it says the published
evidence for Drift's core differentiator does not yet exist, and it names the three conditions under
which it could be produced.
---

## 21. Probes taken from the architecture map

An architecture map of this repo (traced from source at the same commit) names four things this
report had not tested. Each is a falsifiable claim, so each got a probe.

### 21.1 Tier 0 identity resolution — the evasion the map predicted, confirmed

The map's §05 says the weakest resolver "matches only the imported symbol's *name* — not where it
came from. Any re-export or wrapper sharing that name satisfies it," and that every security
convention but one sits on Tier 0 or Tier 1. Tested against an accepted, block-mode
`api_route_requires_auth_helper` convention whose contract explicitly records the module:

```json
"auth_helpers": [{ "guard_id": "auth:requireSession",
                   "import": "@/lib/auth/session", "symbol": "requireSession" }]
```

Four routes, same state, same convention, each its own check:

| Route | Guard used | Auth receipt | Result |
|---|---|---|---|
| control | none | `reached=true inputs=1 emitted=1` | flagged, exit `2` |
| **D1** | `requireSession` imported from **`@/lib/util/impostor`** — a stub that returns `{userId:"anonymous"}` | `reached=true inputs=1 emitted=0` | **passes, exit `0`** |
| D2 | `requireSession` defined locally in the route, no import | `emitted=1` | flagged, exit `2` |
| D3 | `unrelated as requireSession` (aliased to the accepted name) | `emitted=1` | flagged, exit `2` |

**D1 is a security false negative.** The contract names the module, the enforcement ignores it, and a
route that calls a do-nothing function is credited with an auth proof. The boundary is precise and
narrower than the map implies — a local definition and an alias are both caught — which is what makes
it credible: the resolver requires a real `ImportUsed` fact whose *original exported name* matches,
and checks nothing else.

The cause is two functions sitting adjacent in the same file:

```rust
// security_patterns.rs:124  — Tier 0, the path this convention takes
pub fn accepted_auth_helper_for_call(...) {
    accepted_auth_helpers.iter().find(|helper| facts.iter().any(|fact|
        fact.kind == FactKind::ImportUsed
            && fact.name == call.name
            && fact.imported_name.as_deref() == Some(helper.symbol.as_str())))   // ← no module check
}

// security_patterns.rs:138  — Tier 1, the phase-4 path
pub fn accepted_phase4_auth_helper_for_call(...) {
    ... same three conditions ...
            && helper_import_matches(fact, policy.auth_helper_imports.iter()...)  // ← module check
}
```

This also explains §18: the `helper-module-any` mutant *was* killed, because it mutates
`helper_import_matches` — which the phase-4 path uses and this path does not. **The tests cover the
resolver that checks the module; nothing covers the absence of that check in its sibling.**

### 21.2 The five ways to make a finding disappear — only one is silent

The map's §04 compares five mechanisms but treats exception and waiver as equivalent silent-pass
gates. Measured, on one new violating route, one mechanism per isolated state:

| Mechanism | Finding created? | Disclosed in the check payload? | Exit |
|---|---|---|---|
| `conventions exception add` | **No** — `inputs_considered` drops to `0` | **Nothing. No count, no reason, no field.** | `0` |
| `contract waiver add` | Yes | Yes — `waived_findings_count: 1`, with the reason string | `0` |
| `findings suppress` | Yes | Yes — `status: "suppressed"`, `enforcement_result` retained | `0` |
| `findings accept-drift` | Yes | Yes — `status: "accepted_drift"` | `0` |
| `baseline create` | Yes | Yes — `diff_status: "touched_existing"` (§7) | `0` |

Four of the five leave a legible trace. **The exception leaves none** — the only signal is that the
receipt's `inputs_considered` fell, which a consumer can detect only by knowing what it should have
been. For a product whose stated principle is that every check reports what it actually inspected,
the mechanism that removes files from the input set before evaluation should be the *most* disclosed,
not the least.

### 21.3 A framework with no adapter — the honest-refusal case, passed cleanly

The map's §06 records that ten of eleven frameworks in the wire schema have no adapter behind them.
The question that matters is not whether the code exists but what a user gets. Onboarding a Fastify
repo containing eight textbook violations (every handler importing `@/lib/prisma` directly):

```
WARN API routes: 0 API route files
Drift scanned this repo but accepted no conventions, so `drift check` will refuse until one is accepted.
Found 0 convention candidates.

Route-convention proposals currently recognise Next.js API routes only: app-router
`**/app/**/route.{ts,tsx,js,jsx}` and pages-router `**/pages/api/**`. Routes declared by
Express, Fastify, NestJS or SvelteKit are indexed and their facts stored, but they are not
recognised as routes — so this repo will keep producing zero candidates however often it is
rescanned. That is a scope limit, not a property of your repo.
```

And the follow-through, on a diff adding a ninth violating handler:

```
exit 3   "…this check would examine the diff against an empty ruleset. Reporting a pass here
          would be indistinguishable from a repo that was actually checked, so Drift refuses instead."
```

**This is the best result in the report.** The easiest place to fake a green check is a repo you
cannot see, and Drift names the limitation, the exact globs, the frameworks by name, and refuses.

### 21.4 CLI ↔ MCP parity, compared by output rather than by source

`check:surface-parity` compares 622 CLI and 131 MCP *function bodies*; nothing compares what the two
surfaces actually return. Running all pairs against one state:

| Pair | Result |
|---|---|
| `get_audit_status`, `get_scan_status`, `get_repo_contract`, `get_conventions` | **identical on every shared key** (8, 25, 7, 8 keys) |
| `get_repo_map`, `get_task_preflight` | 24/26 and 32/35 keys identical; the rest is envelope |
| `get_findings` | same three findings, **same facts under an agent-facing vocabulary** — `finding_id`/`file_refs`/`lifecycle` where the CLI says `id`/`evidence_refs`/`status`, plus an explicit `redaction_state: "line_only"`. Not data loss; a deliberate rename that `surface-parity` cannot see. |
| `get_runtime_info` ↔ `doctor` | **zero shared keys** — genuinely different documents |
| `get_capabilities` ↔ `capabilities` | **zero shared keys**, and neither carries a `response_schema` — the one pair where the "MATCH" is vacuous |

Parity is real where it counts. The gap is that it is asserted structurally and never checked
behaviourally, so a field rename on one side would not fail anything.

### 21.5 Two corrections to the map itself

**The exit-code table is wrong in a way a CI author would act on.** It reads `0 — Check passed, no
unwaived findings above threshold` and `2 — Blocked, findings exist that the contract doesn't waive`.
Measured (§20's warn-mode repo): `drift check` returns **exit `0` with 26 unwaived findings**. Exit
`2` requires three conditions together — `new_in_diff`, inside a changed hunk, *and* a `block`-mode
convention — which is exactly why the `full_scope_cannot_block` refusal exists.
`docs/reference/enforcement.md` states this correctly; the map compressed it into something false.

**One CLI pairing is missing a subcommand:** `get_required_check_executions` maps to `checks list`,
not `checks` (bare `checks` exits `1`, `Unknown command`). `get_security_context ↔ security audit`
is correct as written.
---

## 22. The cost of the evidence, which is itself a finding

The repo's instruction is *"run `pnpm verify:full` before citing a 'verified' claim in docs/"*.
Measured on this machine:

| Suite | wall time | peak RSS |
|---|---|---|
| `eval:breadth` | 35 s | 565 MB |
| `eval:external` | 4 m 05 s | 2.90 GB |
| `eval:evasion` | 12 m 12 s | — |
| `eval:bench` | 26 m 31 s | — |
| `eval:presence` | > 25 m (7 repos × 3 conventions × 100 fixtures) | — |
| `eval:determinism` | 3 runs × 7 repos at `--scope full` | — |
| `verify:ci` (build, typecheck, 2,034 tests, 11 gates) | ~6 m | — |

`verify:full` is therefore a **90-plus-minute serial local gate that no CI runs**, on a corpus the
user must clone themselves. That is a defensible engineering choice — hosted runners genuinely
cannot hold seven Next.js monorepos — but it is also the mechanism by which a stale baseline
survived 147 commits. Two cheap mitigations exist and neither needs CI: pin the corpus shas in the
baselines so a mismatch is self-diagnosing, and run the 35-second `eval:breadth` on every push using
only the committed `test/fixtures/detection-breadth-stacks` row, which needs no external corpus at
all and already exists.

`eval:external` peaking at **2.9 GB resident** is worth its own line — that is the suite, not the
product, but it is the number that decides whether a contributor can run the gate on a 16 GB laptop
while doing anything else.

---

## 23. Reproducing this report

Everything is on disk under
`…/3d0ed7c0-…/scratchpad/`:

| Path | What |
|---|---|
| `audit/gen/gen-base.mjs` | out-of-sample repo generator |
| `audit/gen/oos-shapes.mjs` | the 29-shape catalogue with expected verdicts |
| `audit/gen/run-oos.mjs` | shape matrix runner (fresh state per cell) |
| `audit/gen/oracle.mjs` | independent import oracle |
| `audit/gen/sweep.sh` | per-merge engine rebuild + rescan |
| `audit/gen/baseline-attrib.sh` | per-merge full CLI onboarding |
| `audit/gen/perf.mjs` | performance benchmark |
| `audit/mcp-size.mjs`, `audit/mcp-probe.mjs` | MCP payload/latency harnesses |
| `audit/gen/mutrun.py`, `mutants-result.json` | mutation driver (gate ladder) and its results |
| `audit/gen/gen-reach.mjs`, `audit/repos/sec-reach/` | the conformance-majority fixture that reaches the five `needs-review` cells |
| `audit/gen/gen-legacy.mjs`, `audit/repos/legacy-shop/` | the dub-shaped majority-violating repo |
| `audit/gen/adjudicate.sh`, `adjudicate2.sh`, `ab/`, `ab2/` | the A/B harness, 18 isolated repos and their scored outputs |
| `audit/repos/sec-probe/` (branches `spoof-d1..d3`, `ctl-none`) | the Tier 0 identity-spoof probes |
| `audit/repos/fastify-app/`, `audit/mech-*.json` | the no-adapter-framework probe and the five suppression mechanisms |
| `audit/parity.mjs`, `audit/parity2.mjs` | CLI ↔ MCP behavioural parity harness |
| `audit/oos-out/matrix.json` | every shape cell's raw verdict and JSON |
| `audit/robust/*.txt`, `*.json` | every refusal/edge-case probe, verbatim |
| `sweep-log.txt`, `baseline-attrib.txt` | the two attribution sweeps |
| `eval-*.log` | all six vendor suites, full output including `/usr/bin/time -l` |
| `perf.json`, `perf-out.txt` | the performance grid |

The subject was never modified: `git status --porcelain` on `/Users/geoffreyfernald/drift-w7`
reports the same five untracked doc paths at the end as at the start. The bisect and sweep ran in a
detached worktree at `scratchpad/bisect-wt` with its own `CARGO_TARGET_DIR`, and the corpus repos
were left clean.
---

## Appendix A — the 29 shape cells in full

Each cell is one branch off the base commit, checked against a fresh copy of the onboarded state.
`flag` means a finding must attribute to the named route; `silent` means no finding may.

| Shape | Class | Expect | exit | Verdict | Route |
|---|---|---|---|---|---|
| `A01-named-import` | positive | flag | 2 | caught | `app/api/probe-a01/route.ts` |
| `A02-default-import` | positive | flag | 2 | caught | `app/api/probe-a02/route.ts` |
| `A03-aliased-import` | positive | flag | 2 | caught | `app/api/probe-a03/route.ts` |
| `A04-namespace-import` | positive | flag | 2 | caught | `app/api/probe-a04/route.ts` |
| `A05-route-group` | positive | flag | 2 | caught | `app/api/(admin)/probe-a05/route.ts` |
| `A06-dynamic-segment` | positive | flag | 2 | caught | `app/api/orders/[id]/probe-a06/route.ts` |
| `A07-pages-router` | positive | flag | 2 | caught | `pages/api/probe-a07.ts` |
| `A08-js-route` | positive | flag | 2 | caught | `app/api/probe-a08/route.js` |
| `A09-jsx-route` | positive | flag | 2 | caught | `app/api/probe-a09/route.tsx` |
| `A10-relative-specifier` | positive | flag | 2 | caught | `app/api/probe-a10/route.ts` |
| `A11-mjs-route` | positive | flag | 0 | **MISSED** | `app/api/probe-a11/route.mjs` |
| `N01-service-call` | negative | silent | 0 | silent | `app/api/probe-n01/route.ts` |
| `N02-comment-mention` | negative | silent | 0 | silent | `app/api/probe-n02/route.ts` |
| `N03-string-mention` | negative | silent | 0 | silent | `app/api/probe-n03/route.ts` |
| `N04-type-only-import` | negative | silent | 0 | silent | `app/api/probe-n04/route.ts` |
| `N05-lookalike-specifier` | negative | silent | 0 | silent | `app/api/probe-n05/route.ts` |
| `N06-non-route-direct` | negative | silent | 0 | silent | `lib/util/report.ts` |
| `N07-clean-route-group` | negative | silent | 0 | silent | `app/api/(admin)/probe-n07/route.ts` |
| `N08-clean-pages-router` | negative | silent | 0 | silent | `pages/api/probe-n08.ts` |
| `E01-barrel-reexport` | evasion | flag | 2 | caught | `app/api/probe-e01/route.ts` |
| `E02-barrel-2hop` | evasion | flag | 2 | caught | `app/api/probe-e02/route.ts` |
| `E03-renamed-reexport` | evasion | flag | 2 | caught | `app/api/probe-e03/route.ts` |
| `E04-import-then-const-export` | evasion | flag | 0 | **MISSED** | `app/api/probe-e04/route.ts` |
| `E05-factory-function` | evasion | flag | 0 | **MISSED** | `app/api/probe-e05/route.ts` |
| `E06-dynamic-import` | evasion | flag | 2 | caught | `app/api/probe-e06/route.ts` |
| `E07-side-effect-import` | evasion | flag | 2 | caught | `app/api/probe-e07/route.ts` |
| `E08-require-call` | evasion | flag | 2 | caught | `app/api/probe-e08/route.ts` |
| `E09-deep-subpath` | evasion | flag | 2 | caught | `app/api/probe-e09/route.ts` |
| `E10-export-star-barrel` | evasion | flag | 2 | caught | `app/api/probe-e10/route.ts` |
