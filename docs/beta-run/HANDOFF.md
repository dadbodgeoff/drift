# Run 3 handoff — paused 2026-08-02

Paused by Geoffrey mid-batch. Tree is **clean and green** at `1e3a4c55`. Nothing is half-applied.

## Resume in one command

```bash
cd ~/drift-falsification/drift && git stash pop   # restores S10 work-in-progress
```

Then continue the batch below. Read `docs/beta-run/PLAN.md` (rev 2) and `PROTOCOL.md` first;
`log.jsonl` is the append-only source of truth for every task outcome.

---

## State of the gates

| Gate | Status |
|---|---|
| G0 Oracle | **MET** — O-1 verified; suite asserts exit code, strict enforcement agreement, attribution; proven fallible by perturbation four ways |
| G1 Enforcement | **substantially met, one gap** — B-1 measured CLOSED (91-cell matrix); S10 side-effect imports still `known_evasion` on 7/7 (work stashed, ~80% done) |
| G2 Coverage | **not started** — E-7 (parser gaps, 3-agent-day box) and E-8 (midday) |
| G3 Hot path | **not started** — P-1..P-4; needs a quiet machine for honest measurement |
| G4 Portability | **met pending X-3** — shallow refusal + diff diagnosis landed; X-3 CI round-trip not written |
| G5 Distribution | **partial** — 5/5 built, 4/5 executed and verified; win32 honestly unverified; D-3/D-4 not started |
| G6 Robustness | **MET** — R-1 20/20 clean, R-2 no BUSY, R-3 gaps all fixed (F-1..F-3) |
| G7 Honesty | **not started** — H-1/H-2/H-3 |

## Verification ledger (who checked what)

**Blind-verified PASS** (independent agent, isolated clone, DoD only):
`O-1` · `E-2/E-3/E-4` · `E-5/E-1` (+ decoy adjudication)

**Landed but NOT yet blind-verified** — the verification run was interrupted:
`E-6` `O-3` `O-4` · `F-1`…`F-5` · `X-1` `X-2` `X-T`
→ **First action on resume: re-dispatch that verifier at HEAD.** It reported "HEAD is not at
8299a2c — someone moved the clone" before it was stopped; the audit clone needs re-checkout and
`pnpm install` (a disk-reclaim pass deleted its `node_modules`, and F-3 added an mcp devDependency).

## Work remaining

1. **S10** — finish the stashed work: Rust was green, TS suites unrun. Then full-suite
   `eval:evasion:update`; the 7 S10 cells must flip from `known_evasion` to caught/enforced.
2. **DET-1** — fact-count mismatch. Root-caused: full-scan counts engine emissions *before* id-dedup,
   incremental counts DB rows *after*. Seams: `crates/drift-engine/src/facts.rs` (~:376-393, no
   column/occurrence discriminator), `packages/cli/src/engine/fact-extraction.ts` (~:114, id hash
   omits it), `packages/cli/src/domain/scan-status.ts:131`. Preferred fix adds the discriminator so
   the dropped second occurrence survives.
3. **DET-2** — harness contamination guard: refuse a repo whose worktree carries foreign
   modifications instead of measuring contaminated state; record the injected file list.
4. **X-3** — CI round-trip test (export from full clone → import in a different full clone,
   detached; shallow case asserts the X-1 refusal).
5. **E-7** (time-boxed 3 agent-days, then advisory-mode fallback) and **E-8** (midday finding).
6. **P-1..P-4** — delta payload (decision D-1 chose design (a)), memory ceiling, hooks pack,
   scan GC (must reclaim freelist: R-1 measured 59% free pages never returned).
7. **D-3/D-4** — clean-machine install, publish dry-run that STOPS. **D-4 needs decision D-7
   (npm package identity) confirmed by Geoffrey — still unanswered.**
8. **H-1/H-2/H-3** — perf reference from this run's numbers only, claims ledger, final gate.

## Environment facts a resuming agent must know

- **Eval repos** `~/drift-falsification/repos/` were rebuilt as **full clones** (working trees
  byte-identical, origins preserved, single synthetic root commit). They were depth-1 shallow, which
  X-1's refusal would have failed. `repos-audit/` is **still shallow** — unshallow it the same way
  before using it with a post-X-1 build.
- The **main checkout was itself depth-130 shallow**; unshallowed to 489 commits, HEAD unchanged.
- **Disk is the binding constraint**: ~5GB free, 98% used, the plan's halt floor. Largest lever is
  Docker (~17GB reclaimable: 11.7GB unused images, 5.6GB build cache) but that is Geoffrey's, from
  other projects — surfaced, deliberately not reclaimed. `scripts/reclaim-disk.sh` handles our own.
- **Run every suite in the FOREGROUND.** Backgrounded evals stalled agents three times this run;
  each cost more wall-clock than the suite itself.
- **Revised tiering** (evasion matrix was added mid-run and doubled T2 cost): full T2 per commit for
  enforcement-semantics changes only; T1 per commit elsewhere with one consolidated T2 per batch.

## Open decisions for Geoffrey

1. **D-7 npm package identity** — pre-registered as `driftdetect@1.0.0-beta.N`; publishing over the
   v1 audience rather than beside it. D-4 forks on this. **Unanswered.**
2. **Windows** — built via `x86_64-pc-windows-gnu`, never executed (no host). The release matrix
   declares msvc; the validator now demands an explicit
   `--accept-target-mismatch engine-win32-x64:x86_64-pc-windows-gnu` to ship it. Ship with the
   caveat, or drop the platform per D-5?
3. **S10** — if it proves expensive, shipping with a documented known evasion is honest and
   already recorded in the matrix. Fix or document?

## Commits this run

`4b5cb37` seed → `1e3a4c55`. Every task has a `log.jsonl` entry; nothing pushed, nothing published.
