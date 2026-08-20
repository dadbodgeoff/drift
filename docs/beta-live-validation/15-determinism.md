# CHARTER 15 — Determinism

**Depends on:** 10 · **Est. 4 h** · **Output:** `results/15-determinism.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 15 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 15 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 15` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Settle an open contradiction. The prior audit **measured** a 42–52% evidence-symbol flicker rate
across independently-fresh cold scans of unchanged content. The forensics pass then traced the
mechanism and found it deterministic **by every mechanism it could trace**: content-addressed
graph-edge ids, `BTreeMap` storage, `ORDER BY kind, id` SQL, zero relevant `HashMap`/`HashSet`
usage, and `files.sort()` immediately after discovery (`main.rs:216`).

Both cannot be right. §21 lists three candidate explanations and says only live re-execution can
distinguish them. This charter does that.

## 2. The three candidates (§21)

- **(a)** The flicker was specific to the older commit and has since been fixed by code the
  forensics pass could not date.
- **(b)** It lives in a path never read in full — module-resolution tie-breaks in
  `resolve_import()`, the TypeScript fallback scanner
  (`packages/cli/src/engine/ts-fallback-scanner.ts`), or subprocess JSON round-tripping.
- **(c)** It requires live re-execution to observe at all.

The charter's job is to determine which, with evidence.

## 3. Procedure

### Reproduce or refute the flicker

| Probe | What to do |
|---|---|
| P-15-01 | **N ≥ 30 independently-fresh cold scans** of one unchanged repo — fresh state root, fresh DB, fresh process each trial. For each trial, dump: every finding's fingerprint, `enforcement_result`, `status`, `diff_status`, **and every `evidence_refs` entry's file, line, symbol, import_source, and fact ids**. Diff trial-to-trial. Report the fraction of trials whose evidence selection differs from trial 1. |
| P-15-02 | Repeat on ≥ 3 of the `$DRIFT_EVAL_REPOS` corpus repos, including at least one large one. Flicker may be size-dependent. |
| P-15-03 | If flicker appears: bisect it. Same-process repeated scan vs. fresh process; same DB vs. fresh DB; engine invoked directly vs. through the CLI. This localizes it to engine, subprocess boundary, storage, or CLI. |
| P-15-04 | If flicker does **not** appear: prove the probe could have detected it. Artificially perturb evidence selection (e.g. a fixture with two equally-qualifying facts differing only in symbol) and confirm the harness reports a difference. A negative result from a blind instrument is not a negative result. |
| P-15-05 | Test the specific shape most likely to flicker: **a finding backed by multiple qualifying facts differing only in which symbol was picked** (§22 obs. 17 says the repo's own digest is structurally incapable of detecting a change here). Build it deliberately. |
| P-15-06 | `git log` bisect between the audit's commit `c1738b14` and current `main` for anything touching evidence selection, `resolve_import()` tie-breaks, or graph id construction — this is what distinguishes candidate (a). |
| P-15-07 | Exercise the TypeScript fallback scanner (`ts-fallback-scanner.ts`) deliberately — determine what makes the CLI fall back, force it, and re-run P-15-01 in that mode. This is candidate (b). |
| P-15-08 | Subprocess JSON round-tripping: compare the engine's raw stdout for two identical runs byte-for-byte. If the engine is byte-identical but the stored result is not, the nondeterminism is downstream. |

### The repo's own harness

| Probe | What to do |
|---|---|
| P-15-09 | Run `pnpm eval:determinism` (`scripts/determinism.mjs`) against `determinism-baseline.json`. Record its verdict. |
| P-15-10 | Read what its digest actually captures: fingerprint, `enforcement_result`, `status`, `diff_status`, and **only `evidence_refs[0]`'s file, line, and import_source** (`determinism.mjs:93-104`). It captures **neither the evidence symbol nor fact ids**. Demonstrate this blindness live: construct a case (P-15-05) where evidence selection changes and the digest does not. |
| P-15-11 | `scripts/worktree-contamination.mjs` guards against a dirty worktree contaminating results. Confirm it actually catches a dirty tree — deliberately dirty one and run. |
| P-15-12 | `verify:evals` (which contains `eval:determinism`) is **not** run by CI (§20e, charter 22). Confirm, and record how many commits have landed without it running. |

### Other determinism surfaces

| Probe | What to do |
|---|---|
| P-15-13 | Ordering: is finding order stable across runs? Receipt order? `repo map` output order? `contract export` key order? |
| P-15-14 | Parallelism: the scan loop is sequential (§3.1), so scan order is fixed. Confirm nothing downstream introduces concurrency — check for `Promise.all` over ordered results in the CLI/query layer. |
| P-15-15 | Environment sensitivity: same repo, different cwd; different `--state-root`; different absolute path (copy the repo elsewhere); different locale (`LC_ALL`); different `TZ`. Do any of these change output? Path-derived repo identity with no symlink canonicalization (§22 obs. 1) makes the path probes non-trivial. |
| P-15-16 | Time sensitivity: does any output embed a timestamp that makes two runs differ? Distinguish cosmetic timestamps from ones that feed a fingerprint. |

## 4. Benchmarks

| Metric | How |
|---|---|
| Evidence-selection flicker rate | (trials differing from trial 1) / N, N ≥ 30, per repo — **the headline number** |
| Fingerprint flicker rate | Same, on fingerprints alone |
| Full-output flicker rate | Byte-diff of the complete `--json` payload, modulo known timestamps |
| Digest blindness | Cases where output changed and `determinism.mjs` reported no change |

Report the audit's original 42–52% alongside this charter's measurement, on the same axis.

## 5. Oracles

- Two cold runs over identical content produce identical findings, identical fingerprints, and
  identical evidence selection.
- Where the output legitimately varies (timestamps, durations), that variation is confined to
  fields that feed nothing downstream.
- The repo's own determinism harness can detect the kinds of change that matter.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-15-1 | Evidence-symbol selection flickers at 42–52% across fresh cold scans of unchanged content. | audit, carried into §13/§19d/§21 as unreconciled | P-15-01, P-15-02 |
| S-15-2 | Every traceable mechanism is deterministic — content-addressed ids, `BTreeMap`, `ORDER BY kind, id`, no relevant `HashMap`/`HashSet`, sorted file list. | §13, §19d | P-15-03 localizes any residual nondeterminism |
| S-15-3 | `determinism.mjs`'s digest captures neither evidence symbol nor fact ids, so it is structurally incapable of detecting exactly the change the audit measured. | §22 obs. 17, `determinism.mjs:93-104` | P-15-10 |
| S-15-4 | `eval:determinism` never runs in CI. | §22 obs. 16, §20e | P-15-12, charter 22 |
| S-15-5 | The nondeterminism may live in `resolve_import()` tie-breaks or the TypeScript fallback scanner — paths never read in full. | §21 | P-15-07 |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). **A negative result must be defended.** If no flicker
reproduces, P-15-04 is mandatory, not optional — the results file must show the instrument works.

## 8. Deliverables

`results/15-determinism.md` with per-repo flicker rates and the disposition of candidates (a)/(b)/(c);
all N trial dumps under `results/artifacts/15/trials/`.
