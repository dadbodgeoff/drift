# Run complete

`node scripts/run-log.mjs next` reports **no actionable tasks remain**. Every task in PLAN.md has
an outcome: finished, or recorded with the reason it was not.

**Tree:** green. `pnpm verify:ci` exit 0 · external suite 7/7 · prepare quality 3/3 · e2e 63/63 ·
Rust 24 suites · 789 unit tests. **63 commits. Nothing pushed. Nothing published.**

| Outcome | Count |
|---|---|
| Done | 42 |
| Done (partial — scope stated in each log entry) | 20 |
| Premise false — deliberately no change | 2 |
| Blocked — needs a human decision | 6 |
| Skipped — dependency blocked | 2 |
| Deferred — human-gated by design | 3 |
| Discoveries made while working | 8 |

## Read these six first

Full evidence in `SUMMARY.md`; each is logged with what was attempted and what it needs.

1. **T01c — beta-blocking.** On midday a contract materialises `enforcement_mode: block` but the
   finding reports `enforcement_result: "none"`, so the check exits 0. Only repo using
   `--data-modules`; not reproducible by hand. F3-class silent failure.
2. **T93 — two enforcement bypasses, found by attacking the product.** A relative import of the
   same module, and a barrel re-export, both produce a confident `pass` over a real violation.
   One root cause: matching compares import *specifier strings*, not resolved module paths.
   Fixtures recorded; not fixed, because it changes the core matcher.
3. **T19b — blocks E3 and E4.** Repo identity hashes the absolute path, so no teammate or CI job
   can import a committed contract. `drift.lock` cannot work until this changes.
4. **T18 — the baseline is a permanent per-violation waiver.** Rewriting a baselined violating
   line, or removing and re-adding it, stays exempt forever. Fix implemented and reverted: two
   tests encode the current contract deliberately.
5. **T28 — seven contract fields are accepted, stored, and enforced by nothing**, including
   `enforcement_policy`. Three were found by a tripwire test, not by reading the interface.
6. **T22 — gitignore.** Reverted. `GitignoreBuilder::add()` scopes patterns to the builder root,
   so a bare `app` in one package went repo-wide and swallowed openstatus's routes.

## Not releasable yet, and why

- **3 of 5 engine artifacts are missing** — no Linux or Windows binary can be built here
  (tree-sitter needs a cross C toolchain). `--require-artifacts` makes this fatal in CI.
- **Install verified on macOS arm64 only** — same cause; there is nothing to install elsewhere.
- **T84 npm publish is human-gated**, and publishing now would ship three empty platform packages.

## Resume

```bash
cd ~/drift-falsification/drift        # T82: the workspace is now the repo root
pnpm verify:ci                        # expect exit 0
node scripts/run-log.mjs status
```

To take on the blocked items, start with `SUMMARY.md` — each carries the attempt, the evidence,
the diagnosis, and a recommendation.

## Four things this run established about how to work on this codebase

- **`cargo test` builds debug; the CLI and harness use `target/release`.** Verifying against a
  stale release binary produced a plausible-but-wrong 8.4% and three phantom parser gaps.
- **Fixture-only verification is insufficient.** It passed while T22's gitignore rewrite swallowed
  real routes and while T51's ranking fix never reached MCP. The seven-repo suite caught both, and
  T65's mutation check confirmed why: two core mutations were caught by one unit test but by
  fourteen checks across the real repos.
- **The CLI and MCP surfaces duplicate ~25 functions and diverge silently.** That cost three
  separate bugs in this run alone.
- **A green gate is not a read gate.** `check:boundaries`, six e2e tests and the engine release
  matrix had all been failing or vacuous since before this run started.
