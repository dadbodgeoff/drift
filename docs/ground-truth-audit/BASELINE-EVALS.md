# Baseline eval state at `255f2208` (recorded during phase 0a)

§6 makes "confirm `eval:determinism` / `eval:external` green at baseline" part of 0a's exit
criteria. One of the two is green. The other is not, and it is not green for reasons that
predate this remediation.

## `eval:determinism` — green, 7/7

```
taxonomy    3 runs, identical (f208ce7ce3bef7a0)
dub         3 runs, identical (c70e148eece4d5db)
formbricks  3 runs, identical (7688627ceb26f485)
calcom      3 runs, identical (dadb600b6b9a2af7)
papermark   3 runs, identical (f1ab19a78d5fe5d9)
midday      3 runs, identical (fac88193fe379565)
openstatus  3 runs, identical (a5d7e0bd99b1b1e3)
7/7 repo(s) deterministic over 3 runs        exit 0
```

**A first attempt reported `dub` and `calcom` flapping.** That run is void: `eval:determinism`
and `eval:external` had been launched concurrently, and the determinism harness explicitly
refuses to measure a worktree another process has touched. Re-run alone and serially, all
seven repos are identical across three runs. Recorded here because the digests above are the
reference for T3 comparisons, and because the failure mode — a concurrent process making
determinism look broken — is the exact thing the "all tracks quiescent during T3" rule exists
to prevent. It cost one wasted run here; during a track it would have been debugged as a
product regression.

## `eval:external` — RED at baseline, 5/7 repos

```
5 repo(s) failing: dub, formbricks, calcom, papermark, openstatus     exit 1
```

Every failure is the same assertion, `packet_within_envelope_budget`, defined at
`scripts/external-eval.mjs:452` as `byteLength(prepare --json stdout) < 500_000`. The
`prepare` envelope has grown past 500 KB on every repo with a substantial parser-gap count.
Alongside it, `guidance_bytes` is up by a uniform +5 bytes on all seven repos — a systematic
content change, not per-repo drift — and `openstatus.baselined` moved 30 → 31.

`scripts/external-eval-baseline.json` was last blessed at `d2517b96` (2026-08-13); `255f2208`
landed 2026-08-15. The regression is in that window and is unrelated to this remediation.

**This contradicts the TDD.** §0.2's "baseline pre-verified" covers `pnpm build:engine` and
`pnpm test:engine` only — both genuinely green — but §6 and §9.4.6 read as though the eval
suites are green too. They are not, and the §9.4.6 merge gate ("`pnpm verify:evals` green")
is therefore unsatisfiable by any change this remediation makes.

See `ENVELOPE-BUDGET-INVESTIGATION.md` for the diagnosis and the disposition.
