# CHARTER 10 — Enforcement cell matrix

**Depends on:** 09 · **Est. 6 h** · **Output:** `results/10-enforcement-cell-matrix.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 10 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 10 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 10` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Answer the central question of this entire program: **when Drift says "pass", is it because it
checked and found nothing, or because it checked nothing?**

The repo maintains its own answer in `test/canary/convention-cell-ledger.json` — 18 cells of
(convention kind × enforcement path), each declaring itself `firing`, `quarantined`, or
`needs-review`. This charter measures whether those declarations are true.

## 2. The ledger

```bash
node -e "const c=require('./test/canary/convention-cell-ledger.json');
  console.log(c.derived_from);
  for(const x of c.cells) console.log(x.state.padEnd(14), x.id ?? '', x.canary ?? '')"
pnpm check:cell-ledger
```

Baseline at time of writing — **18 cells: 11 `firing`, 2 `quarantined`, 5 `needs-review`**,
`baseline_sha: 255f2208`, `enumerated_on: 2026-08-16`. If these numbers have moved, that is the
first line of the results file.

- `firing` (11): the materialized/graph data-access cell, the two presence cells (auth helper,
  request validation), auth proof, request-validation proof, CORS phase6 proof, sensitive-response
  phase5, secret-exposure phase5, tenant-scope phase4, authorization phase4, session-trust phase4.
- `quarantined` (2): `api_route_requires_service_delegation::no_dispatch_arm`,
  `middleware_must_cover_routes::no_dispatch_arm`.
- `needs-review` (5): rate-limit presence, SSRF phase6, raw-SQL phase6, CSRF phase6, rate-limit
  phase6.

Dispatch splits into `engine_direct`, `engine_phase6`, `cli`, and `none`
(`packages/vocabulary/src/index.ts:241-265`, cross-checked against `check_command.rs:204-436`).

## 3. Procedure

### Per-cell, for all 18

Each cell gets a **positive** fixture (a real violation that must be caught) and a **negative**
fixture (a compliant shape that must not be flagged). Most already exist under `test/fixtures/` —
`security-*` and `gt-*` directories cover the security kinds; `security-*-pass` directories are the
negatives. Enumerate them first and record which cells have no committed negative.

| Step | Record |
|---|---|
| C1 | Positive fixture → `drift check`. Finding produced? Exit 2 under block mode? |
| C2 | The finding's **receipt**: `reached`, `inputs_considered`, `enforcement_result`. |
| C3 | The finding's **evidence**: file, line, symbol, import source. Is it the right one? |
| C4 | Negative fixture → no finding, and `reached: true` with `inputs_considered > 0`. A negative that passes because nothing ran is a **false pass**, and is the single most important thing this charter can find. |
| C5 | The **starve guard**: drive the cell to a state where coverage gaps zero its `enforcement_result`. Does the run refuse (exit 3), or silently pass? |
| C6 | For `quarantined` cells: confirm no dispatch arm exists, and confirm the user is told rather than getting a silent pass. |
| C7 | For `needs-review` cells: determine empirically whether they fire, and on what. This is what "needs review" means; resolve it. |

### Cross-cutting

| Probe | What to do |
|---|---|
| P-10-01 | For every cell, produce a shape that **should** violate it but is written in a way the detection step cannot see. §22 obs. 8: every proof-building function for the twelve security kinds — except the presence-path resolver — bottoms out in at least one raw line-substring `.contains(...)` check, consulting no AST node type, no reachability, no dataflow. Exploit that directly: the call in a comment, in a string, behind a ternary, in dead code, split across lines, aliased. |
| P-10-02 | Run `pnpm eval:evasion` (13 import shapes × 7 corpus repos) against `scripts/evasion-baseline.json`. Report new evasions not in the baseline. |
| P-10-03 | Run `pnpm eval:presence` (`scripts/presence-precision-recall.mjs`) and record precision/recall per kind per repo. |
| P-10-04 | Run `pnpm eval:breadth` (`scripts/detection-breadth.mjs`) against `detection-breadth-baseline.json`. Record the ratchet's current position. |
| P-10-05 | Run `pnpm eval:bench` (`scripts/beta-bench.mjs`) — the ordinary-edit refusal bench, 8 non-violating everyday edit shapes. Record the refusal rate. A tool that refuses ordinary edits is unusable regardless of its detection quality. |
| P-10-06 | `test/e2e/gt-canary.test.ts` asserts ledger↔test correspondence in both directions. Run it; then independently verify that each `firing` cell's named canary test genuinely exercises that cell rather than passing vacuously. |
| P-10-07 | The **glob-scope route-group gap** (§13): a case where the audit's finding "partly holds and partly does not". Reproduce both halves precisely, using charter 08's P-08-07 shape. |

## 4. Benchmarks

| Metric | How |
|---|---|
| Per-cell precision and recall | Positive/negative fixtures, per cell |
| Evasion catch rate | (# evasion shapes caught) / (# attempted), per cell — the audit measured "7 of 12 evasion variants caught" for one cell; reproduce per cell |
| Ordinary-edit refusal rate | `eval:bench`, 8 shapes |
| False-pass count | Cells where a negative passed **and** `inputs_considered == 0` — report this number in §1 of the results file, prominently |
| `drift check` wall time by cell count | 1, 5, 11, 18 accepted cells |

## 5. Oracles

- Every `firing` cell fires on its positive fixture and does not fire on its negative.
- Every negative that passes does so with `reached: true` and `inputs_considered > 0`.
- Every `quarantined` cell is visibly quarantined to the user, never a silent pass.
- Every `needs-review` cell is resolved by this charter to `firing` or `not firing`, with evidence.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-10-1 | Every proof-building function for the 12 security kinds except one bottoms out in a raw line-substring `.contains(...)`, consulting no AST, reachability, or dataflow. | §22 obs. 8, §16c | P-10-01 |
| S-10-2 | The audit's per-cell live results ("7 of 12 evasion variants caught") were never reproduced by the forensics pass. | §21 | P-10-01, P-10-02 reproduce them |
| S-10-3 | Two cells are quarantined for having no dispatch arm — `api_route_requires_service_delegation` and `middleware_must_cover_routes`. | ledger, §9a | C6 |
| S-10-4 | Five cells are `needs-review` and their true state is undetermined. | ledger | C7 |
| S-10-5 | CORS policy parsing is implemented by two to three independently-written parsers with different preconditions at different pipeline stages. | §16d, §22 | Drive a CORS shape each parser handles differently; find the disagreement. |
| S-10-6 | The data-access proposal-time allowlist is not consulted at enforcement time. | §22 obs. 9 | Cross-reference charter 09 S-09-4 |
| S-10-7 | `check_command.rs`'s per-kind evaluator bodies (lines 204-436) were verified for dispatch membership only, not for internal correctness — e.g. whether `ApiRouteForbidsSecretExposure`'s `engine_direct` arm at `:364` functions correctly internally. | §21 | C1–C4 per cell is the behavioral closure |
| S-10-8 | `res.setHeader` vs `.set(` — a CORS false-positive mechanism whose exact consequence was never traced. | §21 (F-03-5) | Build both shapes; compare. |
| S-10-9 | Indirection through an intermediate module is out of scope by construction for data access (`rules.rs:105-134` file-set filter). | §21 (F-DA-4) | Build a two-hop indirection; confirm it escapes, and confirm whether the user is told. |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). **A false pass is never "just a failed probe."** Any
cell where a negative fixture passes with `inputs_considered == 0` gets its own `F-10-n` block with
a full cause trace, and is listed again in §1.

## 8. Deliverables

`results/10-enforcement-cell-matrix.md` with the 18-cell × C1–C7 matrix, precision/recall per cell,
the evasion delta, and the false-pass count; fixtures under `results/artifacts/10/fixtures/`.
