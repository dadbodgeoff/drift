# CHARTER 07 — Symbol and module identity resolution

**Depends on:** 06 · **Est. 3 h** · **Output:** `results/07-identity-resolution.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 07 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 07 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 07` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Determine, live, how strongly Drift knows that "the `auth` you imported" is "the `auth` the
convention accepted". The answer is not one thing: identity is re-implemented at five
structurally distinct sites across three files, at **three different strengths**, with no shared
resolution utility connecting any of them (§22 obs. 7). This charter measures what each strength
can and cannot distinguish, and which enforcement paths get which strength.

## 2. The three tiers

| Tier | What it compares | Sites |
|---|---|---|
| **0** | Name only. Module and import specifier never consulted. | §7 |
| **1** | Name plus the **raw, unresolved import-specifier text**, compared as an exact string. | §7 |
| **2** | Resolved module graph. **One site, confirmed unique.** | §7 |
| (orthogonal) | AST-based value-use classification — a fourth mechanism, not a tier. | §7 |

Alias / re-export / barrel handling runs a fixpoint, `ALIAS_ROUNDS` (`rules.rs`).

Relevant fixtures already committed: `barrel-reexport-db`, `bypass-barrel-reexport`,
`bypass-relative-import`, `workspace-supabase-layer`, `sibling-unresolved-import`.

## 3. Procedure

For each probe: build the shape, accept the relevant convention, run `drift check`, and record
whether the violation is caught. Then record **which tier** the deciding comparison used, by
correlating with the dispatch path (charter 10 owns the dispatch table; here just record the
convention kind and enforcement path).

### Defeating the tiers

| Probe | Shape | Expected to defeat |
|---|---|---|
| P-07-01 | Import the accepted helper by its real name from its real module. Baseline — must be recognized. | none |
| P-07-02 | Import a **different** function that happens to share the accepted helper's name, from a different module. | Tier 0 |
| P-07-03 | **Decoy module.** A different physical file that resolves to the literal accepted specifier string (e.g. a local `./lib/auth` shadowing a workspace `@app/auth`, or a path alias remapped in `tsconfig.json`). | Tier 1 — **§21 flags this as never tested live. This charter closes it.** |
| P-07-04 | Import the real helper via a **barrel** re-export (`index.ts` re-exporting it). | alias fixpoint |
| P-07-05 | Import via a **chain** of barrels, N deep. Increase N until resolution fails, and record the depth at which it does — this measures `ALIAS_ROUNDS` empirically. |
| P-07-06 | Import via `export * from` where the origin is external to the repo (`test/fixtures/external-star-reexports`). |
| P-07-07 | Rename on import: `import { realAuth as auth }`. |
| P-07-08 | Rename on re-export: barrel does `export { realAuth as auth }`. |
| P-07-09 | Relative vs. absolute vs. tsconfig-path-alias spellings of the **same** module. Do all three compare equal? (`bypass-relative-import`) |
| P-07-10 | Same module reached through a workspace package specifier vs. a relative path (`workspace-supabase-layer`). |
| P-07-11 | A sibling file with an unresolved import (`sibling-unresolved-import`) — does one unresolved import degrade identity resolution for the rest of the file? `test/e2e/enforcement-blast-radius.test.ts` reportedly asserts a finding must survive a sibling's unresolved import; drive it live. |
| P-07-12 | Namespace import then member call: `import * as a from "m"; a.auth()`. |
| P-07-13 | Reassignment: `const f = auth; f()`. |
| P-07-14 | Dynamic: `const f = cond ? auth : other; f()`. |

### Which tier is actually load-bearing

| Probe | What to do |
|---|---|
| P-07-15 | For each of the 13 `security_contract` kinds plus `api_route_no_direct_data_access`, determine empirically which tier decides its identity comparison, by running P-07-02 and P-07-03 against each. Produce a **kind × tier** table. |
| P-07-16 | Locate the single Tier 2 site's user-visible behavior: which convention kind benefits from full module-graph resolution, and does that make it measurably harder to defeat than the Tier 1 kinds? |

## 4. Benchmarks

| Metric | How |
|---|---|
| Evasion rate per tier | (# probes P-07-02..14 that evaded) / (# applicable), per tier |
| Barrel depth at which resolution fails | P-07-05, exact N |
| Alias fixpoint wall-time cost vs. depth | Time `drift scan` at barrel depth 1, 5, 10, 20 |
| Cross-check against `pnpm eval:evasion` | Run `scripts/evasion-matrix.mjs` (13 import shapes × 7 eval repos) and reconcile its baseline against these probes |

`scripts/evasion-baseline.json` "records known evasions honestly" (§20d) — read it first, then
report whether this charter found evasions **not** in that baseline. That delta is the charter's
headline number.

## 5. Oracles

- Tier 2 sites resist the decoy-module shape. Tier 1 sites are expected not to; the finding is
  *which kinds* are Tier 1, not that Tier 1 is weak.
- The alias fixpoint resolves realistic barrel depths (≥ 3) and states what it could not resolve.
- No evasion succeeds **silently**: an unresolvable import produces a `parser_gaps` row, a
  diagnostic, or a coverage reduction the user can see.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-07-1 | A same-named, same-specifier-text decoy module defeats Tier 1 identity checks. Source-level reading makes this "highly likely"; no fixture was ever built. | §21 | P-07-03 |
| S-07-2 | Identity is re-implemented at 5+ structurally distinct sites across 3 files at 3 strengths, with no shared "resolve this specifier" utility. | §22 obs. 7 | P-07-15's kind × tier table is the live evidence |
| S-07-3 | Exactly one site uses full module-graph resolution. | §7 | P-07-16 |
| S-07-4 | The audit's counts ("8 independently-written cells", "~15 independently written functions") were never independently reproduced. | §21 | Not a live probe — record whether the observed behavioral spread is consistent with those counts. |
| S-07-5 | `accepted_auth_helper_for_call` and `presence_call_resolves_to_accepted` exist as private fns; only two dispatch arms were spot-checked. | §21 | P-07-15 exercises every arm behaviorally, which is the closure this needs. |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). An evasion that succeeds is a recorded measurement, not
a stop condition. Record the exact fixture so it can be added to `evasion-baseline.json` later —
but **do not** update that baseline from this charter.

## 8. Deliverables

`results/07-identity-resolution.md` with the kind × tier table and the evasion delta against
`evasion-baseline.json`; every constructed evasion fixture under `results/artifacts/07/fixtures/`.
