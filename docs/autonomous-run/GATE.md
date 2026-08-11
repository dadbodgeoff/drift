# Full gate run (T90)

Run at the end of the autonomous run, from the repo root after T82's surgery.

| Gate | Command | Result |
|---|---|---|
| Release gate | `pnpm verify:ci` | **exit 0** |
| External repos | `pnpm eval:external` | **7 / 7** |
| Prepare quality | `pnpm eval:prepare` | **3 / 3** (rank 4, 1, 1) |
| Harness self-tests | `pnpm test:harness` | **6 / 6** |
| Engine artifacts | `validate-engine-release-matrix.mjs` | 1 verified, 1 unverified, **3 missing** |
| Fresh-machine install | `installed-flow.test.ts` | **macOS arm64 only** |

`verify:ci` chains build, typecheck, unit tests (789 across nine packages), e2e (63), harness
self-tests, rustfmt, clippy, architecture boundaries, the release matrix, claims validation, the
beta proof, and `git diff --check`.

## External suite detail

Every repo passes every assertion, including the negative controls:

```
ok  taxonomy    onboard=y contract=y injected=y evidence=y cleanFP=no neg=ok subpath=y
ok  dub         onboard=y contract=y injected=y evidence=y cleanFP=no neg=ok subpath=y
ok  formbricks  onboard=y contract=y injected=y evidence=y cleanFP=no neg=ok subpath=y
ok  calcom      onboard=y contract=y injected=y evidence=y cleanFP=no neg=ok subpath=y
ok  papermark   onboard=y contract=y injected=y evidence=y cleanFP=no neg=ok subpath=y
ok  midday      onboard=y contract=y injected=y evidence=y cleanFP=no neg=ok subpath=y f4gap=y
ok  openstatus  onboard=y contract=y injected=y evidence=y cleanFP=no neg=ok subpath=y
```

`cleanFP=no` is the false-positive control: a properly layered route is never flagged.
`neg=ok` covers the type-only import and lookalike-module controls. `subpath=y` proves a genuine
data-layer subpath is still caught. `f4gap=y` on midday asserts the whitelist gap is *exercised* —
without it the suite would pass whether or not the feature existed.

## Two gates that do not pass, and should not be claimed as passing

**Engine artifacts: 3 of 5 missing.** Linux x64, Linux arm64 and Windows x64 have no binary,
because tree-sitter's C build scripts need a cross toolchain for the target. They must be built in
CI on their own platform. `--require-artifacts` makes this fatal, which is what the release job
should use.

**Install verified on macOS arm64 only.** Same root cause: there is no Linux or Windows binary to
install. See `../architecture/install-verification.md`.

Neither blocks the work done here; both block a release, and the T30 false-positive definition and
T31 claim-coverage tests exist so that gap cannot be quietly papered over.

## What "green" does and does not mean

It means every check that can run on this machine passes, and the seven-repo suite — the thing
that caught both regressions during this run, while unit tests stayed green — is clean.

It does not mean the product is releasable. Six items are blocked pending human decisions, and
T01c in particular is beta-blocking: on midday a block-mode contract reports
`enforcement_result: "none"`, so the check exits 0. See `SUMMARY.md`.
