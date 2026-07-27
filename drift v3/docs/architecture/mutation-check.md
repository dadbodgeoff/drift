# Mutation check on the enforcement core (T65)

T03's negative controls prove the enforcement predicate does not **over**-fire: a type-only
import, a lookalike module and a genuine subpath are each handled correctly on seven real repos.
Nothing proved the tests would catch it **under**-firing — a guardrail that silently stops
enforcing looks identical to a clean repo.

So each of the five load-bearing behaviours was deliberately broken, and the suites re-run.

| # | Mutation | Caught by |
|---|---|---|
| M1 | `**/` requires a leading segment — the exact F9 glob bug | **23** core tests |
| M2 | `is_api_route_path` always false — nothing is ever a route | 1 Rust suite + **14** external repo checks |
| M3 | `is_forbidden_import` always false — nothing is ever forbidden | 1 Rust suite + **14** external repo checks |
| M4 | `diff_status` never `new_in_diff` — every finding looks pre-existing (an A5 regression) | **7** CLI tests |
| M5 | Blocking counts `warn` instead of `block` — block-mode conventions stop blocking | **16** CLI tests |

Every mutation was caught. No new tests were required.

## What this does and does not establish

It establishes that the five behaviours are genuinely covered, not incidentally exercised. M2 and
M3 are the interesting ones: they are caught by a single Rust unit suite but by **fourteen**
checks across the seven evaluation repos, which is the clearest evidence yet that the external
suite — not the unit tests — is what actually guards enforcement. That matches how this project
went: the unit tests passed throughout the two regressions the suite caught (T22's gitignore
rewrite and T51's ranking divergence).

It does not establish coverage of the surrounding surface — reporting, exit codes, governance —
only these five predicates.

## Method

Mutations must **compile** to be valid. The first attempt at M2 renamed a function rather than
changing its body, so the build failed and the test count came back zero, which reads exactly
like "no test caught it". A mutation that does not build proves nothing; check the build before
believing the result.

Reproduce by applying each mutation, running `pnpm -r test` (or `cargo test -p drift-engine` plus
`pnpm eval:external` for engine changes), then reverting with `git checkout --`.
