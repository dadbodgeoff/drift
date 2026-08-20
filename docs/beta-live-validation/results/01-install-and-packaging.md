# CHARTER 01 — Install and packaging — RESULTS

**Agent:** Claude Sonnet 5 (subagent session)
**Run started:** 2026-08-19T11:31:00-07:00
**Run finished:** 2026-08-19T08:45:00-07:00
**Commit under test:** a0517f3e8804da9ebf95840bc333fc07a0c06573  (`git rev-parse HEAD`)
**Working tree:** dirty (`git status --porcelain` — untracked `docs/architecture/*.md` and `docs/beta-live-validation/` only; no product source touched)
**Engine binary:** `/tmp/drift-beta-freeze/src/target/release/drift-engine` · built 2026-08-18T22:31 (per freeze) · `DRIFT_ENGINE_BIN` exported: yes (by env.sh; unset explicitly for every probe that tests discovery-without-override)
**Platform:** Darwin Mac.lan 24.6.0 Darwin Kernel Version 24.6.0 arm64 (darwin-arm64 only)
**Node / pnpm / rustc:** v25.2.1 / 10.28.0 / rustc 1.97.0 (2d8144b78 2026-07-07)

## 1. Verdict

The packed `@drift/cli` tarball cannot be installed on a clean machine as delivered: `npm install
-g` of `drift-cli-0.1.0.tgz` fails with `E404` on `@drift/core@0.1.0` (P-01-03), because `@drift/cli`'s
`package.json` lists five internal `@drift/*` workspace packages as regular (non-optional)
dependencies pinned to plain `0.1.0` (correctly de-`workspace:`'d by `pnpm pack`, confirming
confirmed separately, §4), and none of those packages — nor the CLI itself — are published anywhere the public
registry or this environment can reach; there is no `.npmrc` registry override, no local registry,
and the frozen source tree is read-only so the missing sibling tarballs cannot be produced here
either (re-running `pnpm pack` on the frozen tree reproduces the identical mechanism: `tsc` cannot
write `dist/`, `EACCES`, confirming the freeze's read-only enforcement is real, not a workaround).
This is the charter's headline: **the artifact a beta user is actually handed does not install
standalone**, independent of anything the CLI does after starting. Per §8's continuation protocol,
every remaining probe ran against the working-tree build (`node .../packages/cli/dist/main.js`),
clearly labelled, which is a materially different code path for engine discovery than a real
install would exercise (see §7). Within that substitute: `--version`/`--version --json` report
`storage_schema_version` 36 as `runtime.supported_sqlite_schema_version` (my own oracle initially
looked for a top-level field that does not exist — corrected, not a defect); `doctor` and
`capabilities` succeed with no state; a broken `DRIFT_ENGINE_BIN` (chmod 000) is refused cleanly at
`scan` with exit 3 and `code: "missing_engine"` (P-01-07); and `drift-mcp` with no `--db`/`DRIFT_DB`
prints the exact documented string on stderr and exits 1 (P-01-09, exact match). A genuinely new
finding not on the suspect list: `DRIFT_ENGINE_BIN`'s "checksum" is self-referential
(`expectedSha256: sha256File(binaryPath)` in `rust-engine.ts:508-509`) — any executable file is
reported `checksum_matches: true` by `doctor`; only the packaged-optional-dependency path checks
against an independently-sourced `engine-manifest.json` hash. A binary of the right name but wrong
contents supplied via `DRIFT_ENGINE_BIN` is caught only when actually spawned, as a generic
operational error (`cli_error`, exit 1, "Drift engine stream did not complete"), not a provenance
refusal.

| | Count |
|---|---|
| Probes specified | 11 |
| Probes executed | 11 (P-01-01–P-01-10 fully; P-01-11 could not run — single platform) |
| Probes blocked (could not be executed — see §5) | 2 (engine-carrier repacking; second-platform run) |
| Probes that behaved as the charter's oracle predicted | 7 |
| Probes that did not | 3 (P-01-03 install fails; P-01-07/doctor is not exit-3 for a broken engine — my oracle, not a defect; P-01-08 is not exit-3 for wrong-contents — real gap, see above) |
| Defects found not predicted by any suspect-list entry | 2 (unpublished internal-package dependency graph blocks standalone install; self-referential `DRIFT_ENGINE_BIN` checksum) |

## 2. Probe log

| Probe | Command (verbatim) | Exit | Observed | Oracle | Match |
|---|---|---|---|---|---|
| P-01-01 | `ls -la $DRIFT_BETA_TARBALLS` (P-01-01a); `tar tzf drift-cli-0.1.0.tgz` (P-01-01b, exit 0, 300 files); `tar tzf drift-mcp-0.1.0.tgz` (P-01-01c, exit 0, 12 files); `pnpm pack` re-run from frozen tree (P-01-01d, exit 2 — `tsc` `EACCES` on read-only `dist/`, expected given the freeze's read-only enforcement); `ls node_modules/.pnpm` (P-01-01e). Engine-carrier packages (5) not packed — see F-01-2. | 0 / 0 / 0 / 2 / 0 | Two tarballs present, listed, well-formed; re-pack fails cleanly on permissions, not a crash | Every packed tarball inspectable | yes (cli/mcp); blocked (5 engine carriers, see §5) |
| P-01-02 | grep tarball listing for `fixtures`/`test/`/`.env$` (P-01-02a, exit 1, empty ⇒ none found); grep extracted tree for `geoffreyfernald` (P-01-02b, exit 1, empty); grep mcp listing (P-01-02c, exit 1, empty); inspect `.js.map` `sources` field (`../src/index.ts`, relative, no `sourceRoot`) | 1/1/1/n-a | No fixtures, no builder home dir, no absolute source-map paths | Tarball contains only what a consumer needs | yes |
| P-01-03 | `npm install -g --prefix /tmp/drift-beta-freeze/npm-global-1 $DRIFT_BETA_TARBALLS/drift-cli-0.1.0.tgz` | 1 | `npm error code E404 ... @drift/core@0.1.0 could not be found` | Tarball installs on a clean machine | **no** — see F-01-1 |
| P-01-04 | P-01-04a `node dist/main.js --version` → `0.1.0`; P-01-04b `node dist/main.js --version --json` | 0 / 0 | `.runtime.supported_sqlite_schema_version = 36` | `--version --json` parses, carries schema version 36 | yes (field path corrected from my first, wrong guess `.storage_schema_version`) |
| P-01-05 | `node dist/main.js capabilities` ; `node dist/main.js capabilities --json` | 0 / 0 | Text and JSON both succeed with no state anywhere | `capabilities` runs before DB open, no state needed | yes |
| P-01-06 | P-01-06b `node dist/main.js doctor --repo-root <empty ws> --state-root <empty ws>`, `DRIFT_ENGINE_BIN` unset | 0 | `OK Rust engine: release binary built from this source checkout at .../target/release/drift-engine`; `WARN Drift state: not initialized` (no DB written) | With no state/repo, `doctor` succeeds; engine found via `optionalDependencies` without help | **partial** — engine *was* found, but via `workspace_release_binary` (dev-checkout detection, `rust-engine.ts:399-407`, `findCargoWorkspaceRoot` walking up from the CLI file's own `import.meta.url`), not `packaged_optional_dependency`. See §7 — the real discovery path is untested because P-01-03 blocks a real install, and this frozen tree never staged any engine-carrier's `bin/`/`engine-manifest.json` (P-01-06d attempted to force the packaged path from a copy outside the cargo workspace and instead hit a missing third-party dep, `better-sqlite3`, in my own copy — my test-setup gap, not a product finding; INCONCLUSIVE, not reported as a defect) |
| P-01-07 | P-01-07a `doctor` with `DRIFT_ENGINE_BIN` pointed at a chmod-000 copy of the real engine (exit 1, `FAIL Rust engine: DRIFT_ENGINE_BIN is invalid ...`); P-01-07b/c `scan` with the same broken binary (exit 3, `code: "missing_engine"`) | 1 / 3 | `doctor` reports a stated `FAIL` at exit 1 (a readiness-check report, correctly not a refusal); `scan` refuses at exit 3 with `missing_engine` | Missing/unusable engine → `missing_engine`/exit 3, not a crash | yes for `scan`; my first assertion wrongly expected exit 3 from `doctor` itself — `doctor` is a diagnostic, not an operation, so its own top-level exit vocabulary (0 pass / 1 check failed) is correct as observed, not a defect |
| P-01-08 | `scan` with `DRIFT_ENGINE_BIN` pointed at a chmod-755 shell script (`#!/bin/sh\nexit 0`) — right name, wrong contents | 1 | `doctor` (P-01-08b) reports `available`, `checksum_matches: true` for this fake binary (self-referential hash, see Verdict); `scan` fails only when it actually spawns the binary — `code: "cli_error"`, "Drift engine stream did not complete" | A binary of the right name but wrong contents is caught by a provenance check | **no** for `DRIFT_ENGINE_BIN`/env_override — no independent content check exists there (`rust-engine.ts:494-509`); the `packaged_optional_dependency` path (`rust-engine.ts:465-476`) does check against `engine-manifest.json`'s `sha256`, but was not reachable live (no manifest ever staged in this frozen tree) |
| P-01-09 | `node dist/bin.js` (mcp), no `--db`/`DRIFT_DB` | 1 | stderr: `Missing --db <path> or DRIFT_DB for drift-mcp.` (exact match); stdout empty | Exact string, exit 1 | yes |
| P-01-10 | `find /tmp/drift-beta-freeze/npm-global-1 -type f` after the failed P-01-03 install | 0 | empty — nothing was left on disk | Clean uninstall leaves nothing behind | yes, vacuously — there was nothing to uninstall because the install never wrote anything (npm aborts dependency resolution before staging files) |
| P-01-11 | — | — | Only one platform (darwin-arm64) available in this environment | Re-run P-01-03..06 on a second platform if available | blocked — no second platform; not claiming cross-platform coverage |

Full output for every probe: `/tmp/drift-beta-freeze/artifacts/01/<probe-id>.out` / `.err` (referenced
above by probe id; not copied into the repo per the freeze's own artifact convention — paths are
reproducible from the commands in this table plus `env.sh`).

Additional sub-probes run and recorded in the ledger, folded into the rows above rather than given
their own row: P-01-05j (`capabilities --json`, exit 0, PASS — folded into P-01-05); P-01-07a-json
(`doctor --json` against the broken engine, exit 1, PASS) and P-01-07c (`scan --json` against the
same broken engine, exit 3, PASS — both folded into P-01-07); P-01-09-stderr (`cat` of the recorded
`.err` file, exit 0, PASS — the harness has no `--expect-out`-on-stderr assertion, so the
exact-string check for P-01-09 was done as this follow-on read of the artifact file rather than
against the probe's own stdout); P-01-s3-stderr (same pattern, folded into the beta-proof
self-attestation suspect's evidence, §4). P-01-01d (`pnpm pack` re-run from the frozen tree)
carried no declared oracle — it was exploratory, confirming the read-only mechanism rather than
testing a stated claim — and is correctly UNJUDGED rather than PASS or FAIL.

## 3. Measurements

| Metric | n | Median | p95 | Min | Max | Command |
|---|---|---|---|---|---|---|
| Tarball size: `drift-cli-0.1.0.tgz` | 1 | 367286 B | — | — | — | `ls -l $DRIFT_BETA_TARBALLS/drift-cli-0.1.0.tgz` |
| Tarball size: `drift-mcp-0.1.0.tgz` | 1 | 45885 B | — | — | — | `ls -l $DRIFT_BETA_TARBALLS/drift-mcp-0.1.0.tgz` |
| Cold install wall time (time-to-fail — install cannot succeed here, see P-01-03) | 5 | 891 ms | 1412 ms | 884 ms | 1412 ms | `bench 01 install-wall-time --trials 5 --warmup 1 --require-exit 1 -- npm install -g --prefix <fresh prefix> drift-cli-0.1.0.tgz`. CV 22.7%, 2 outliers by modified z-score; too few trials (n=5) for the drift test. Every trial exited 1 identically (E404) — a consistent, not partial, measurement. |
| `drift --version` cold start | 20 | 71.0 ms | 75 ms | 69 ms | 76 ms | `bench 01 version-cold-start --trials 20 --warmup 2 --require-exit 0 -- node .../packages/cli/dist/main.js --version`. rho=0.567, "significant upward drift — re-run cold before trusting these timings" (flagged by the harness itself; all 20 trials ran back-to-back in one process burst with no cooldown). Reported as-is, per binding rule 3 (record the number, not a judgment) — but the harness's own drift verdict should be read alongside it. |
| `drift doctor` on an empty dir | 10 | 103.0 ms | 110 ms | 102 ms | 110 ms | `bench 01 doctor-empty-dir --trials 10 --warmup 2 --require-exit 0 -- node .../dist/main.js doctor --repo-root <empty ws> --state-root <empty ws>`. rho=-0.576, no drift distinguishable from noise. |

Both cold-start numbers were taken against the **working-tree build**, not an installed package —
see §7. This is the floor on every other command's latency; a real global install (once installable
at all) would add module-resolution overhead this number does not capture.

## 4. Suspect list disposition

| ID | Claim under test | Disposition | Evidence |
|---|---|---|---|
| S-01-1 | The five engine carrier packages are empty binary carriers consumed as `optionalDependencies`; if the platform is unmatched there is no fallback. | CONFIRMED | `packages/cli/package.json` lists all five under `optionalDependencies`, pinned `workspace:*` in the working tree and `0.1.0` in the packed tarball (P-01-e2). Re-packing from the frozen tree (P-01-01d) surfaced pnpm's own platform gate live: `WARN Unsupported platform: wanted: {"cpu":["x64"],"os":["darwin"]...} (current: {"os":"darwin","cpu":"arm64"})` for `engine-darwin-x64`, `engine-linux-arm64-gnu`, `engine-linux-x64-gnu`, `engine-win32-x64` — only the matching `engine-darwin-arm64` would be installed. No fallback mechanism was found in `rust-engine.ts`'s resolution order (`env_override` → `workspace_release_binary`/`workspace_cargo` → `packaged_optional_dependency` → `undefined`) — an unmatched platform simply has no `optionalDependencies` entry to resolve, and `resolvePackagedEngine()` (`rust-engine.ts:449-463`) returns `undefined` rather than degrading. |
| S-01-2 | `release-hygiene.test.ts` asserts engine binary package versions stay exact and workspace-free. | CONFIRMED | Extracted `package/package.json` from `drift-cli-0.1.0.tgz` (P-01-e2): `optionalDependencies` are all `"0.1.0"`, zero occurrences of `workspace:` anywhere in the file (`--refute-out "workspace:"` passed). |
| S-01-3 | `beta:proof` cannot be self-attested via env vars. | CONFIRMED | Live-drove `node scripts/generate-release-proof.mjs --require-beta-proof` with all 16 `DRIFT_RELEASE_*`/`DRIFT_VERIFY_CI_STATUS` env vars the test sets (P-01-s3): exit 1, stderr `Release proof failed: --require-beta-proof requires --beta-proof-file from scripts/run-beta-proof.mjs.` — the exact refusal `release-hygiene.test.ts:391-417` asserts, reproduced directly against the frozen source, not just its test suite. |

## 5. Failures and blocks

### F-01-1 — Packed `@drift/cli` tarball cannot be installed standalone

- **Probe:** P-01-03
- **Command:** `npm install -g --prefix /tmp/drift-beta-freeze/npm-global-1 /tmp/drift-beta-freeze/tarballs/drift-cli-0.1.0.tgz`
- **Expected:** clean install onto a machine that has never built Drift.
- **Observed:** `npm error code E404` / `404 Not Found - GET https://registry.npmjs.org/@drift%2fcore` / `404  The requested resource '@drift/core@0.1.0' could not be found`. Exit 1. Full text: `/tmp/drift-beta-freeze/artifacts/01/P-01-03.err`.
- **Cause:** `packages/cli/package.json` `dependencies` (lines 20-26) list `@drift/core`, `@drift/engine-contract`, `@drift/storage`, `@drift/factgraph`, `@drift/query` as regular (non-optional) dependencies. `pnpm pack` correctly rewrites `workspace:*` to the pinned `0.1.0` (S-01-2), but none of these five packages — nor `@drift/cli` itself — exist on the public npm registry, and this workspace has no `.npmrc` registry override and no local/private registry configured (`$DRIFT_BETA_SRC/.npmrc` does not exist; `pnpm-workspace.yaml` only declares `packages/*`). Re-packing the missing sibling tarballs from the frozen tree to test a local, registry-free install was attempted and fails identically to the CLI's own re-pack (`packages/core/package.json`'s `"prepack": "pnpm build"` hits the same `tsc` `EACCES` on the read-only `dist/`, per freeze.sh's `chmod -R a-w`) — this is the freeze's read-only enforcement working as designed, not a way around the underlying gap. `scripts/validate-engine-release-matrix.mjs:132` references `npm_config_provenance=true npm publish` as the intended release step, confirming a full publish of all `@drift/*` packages is the expected (but, at this frozen pre-release SHA, not-yet-performed) precondition for a standalone install to work.
- **Blast radius:** P-01-06/07/08/09 could not exercise the real `packaged_optional_dependency` engine-discovery path or a truly "installed" binary; every downstream probe in this charter ran against the working-tree build instead, labelled accordingly. Any later charter that assumes "the user has `drift` on `PATH` from a real install" inherits this same gap unless it stands up its own install path.
- **Reproduction:** `source /tmp/drift-beta-freeze/env.sh && npm install -g --prefix $(mktemp -d) $DRIFT_BETA_TARBALLS/drift-cli-0.1.0.tgz`
- **Charter continued at:** P-01-04, against `node $DRIFT_BETA_SRC/packages/cli/dist/main.js` in place of an installed `drift`.

### F-01-2 — Engine carrier packages were never packed by the freeze; re-packing them here is out of budget

- **Probe:** P-01-01 (engine-carrier portion), P-01-08 (packaged-path portion)
- **Command:** would be `(cd packages/engine-darwin-arm64 && pnpm pack)`
- **Expected:** a tarball listing per carrier package, per P-01-01.
- **Observed:** not run.
- **Cause:** `freeze.sh` (harness) only packs `packages/cli` and `packages/mcp` (`freeze.sh:64-66`); no engine-carrier tarball or staged `bin/`/`engine-manifest.json` exists anywhere in `$DRIFT_BETA_FREEZE`. Packing one live requires its `prepack` script, `scripts/prepare-engine-package.mjs`, which unconditionally runs `cargo build --release --target <triple>` into a **new** target directory (`prepare-engine-package.mjs:24-28`) — distinct from the existing `target/release` — before staging the binary. Per the freeze's own sizing comment (`freeze.sh:24`), a cargo release target costs ~2.5GB. This session's disk has ~2.8GB free (binding rule 8: no probe may write more than ~200MB). Running this probe risks exhausting the disk for every other agent sharing this freeze.
- **Blast radius:** the `packaged_optional_dependency` engine-discovery path (the one a real install would actually use) could not be exercised end-to-end anywhere in this charter — see F-01-1's blast radius, same root limitation from a different angle.
- **Reproduction:** `cd $DRIFT_BETA_SRC/packages/engine-darwin-arm64 && pnpm pack` (not run; would trigger the cargo build described above).
- **Charter continued at:** P-01-01 close-out (cli/mcp tarballs fully inspected); P-01-08 answered instead for the `env_override` source, which was reachable.

## 6. Discovered surface not in the charter

- `doctor --json`'s `.engine` object exposes `source`, `checksum_matches`, `override_active`,
  `target_triple`, `package_name`/`package_version` — a richer provenance surface than the charter's
  suspect list anticipated, and the mechanism by which P-01-08's finding (self-referential checksum
  for `env_override`) was established.
- `resolveRustEngineCommand`'s resolution order has a fourth, undocumented-in-this-charter source,
  `workspace_cargo` (falls back to `cargo run` when no `target/release/drift-engine` exists in a
  detected cargo workspace) — not exercised here since the frozen tree always has the release
  binary, but visible in `rust-engine.ts:391-413` and guarded against by a dedicated `cargoMissing`
  check in `engine-provenance.ts` (comment there references a real regression: a prior version
  reported `{"status":"available"}` for this path with nothing actually verified).
- `drift doctor`'s plain-text and `--json` renderers were both exercised (P-01-06b/P-01-08b) and
  agreed on every fact checked (engine source, status); no divergence found, though the check was
  not exhaustive across every field per binding rule 4's caution.

## 7. What this charter did not cover

- **Real `npm install -g` success.** Blocked by F-01-1. Everything from P-01-04 onward ran against
  the working-tree build (`node .../dist/main.js`), which resolves the engine via
  `workspace_release_binary` (dev-checkout detection walking up from the CLI file's own location)
  rather than `packaged_optional_dependency` (the real installed-package path). These are different
  code paths in `rust-engine.ts`; a defect specific to `packaged_optional_dependency` resolution
  would not have been caught by anything in this run.
- **Cross-platform coverage (P-01-11).** Only darwin-arm64 was available. Nothing here says
  anything about darwin-x64, linux-arm64-gnu, linux-x64-gnu, or win32-x64 install or engine
  discovery.
- **Engine-carrier package contents** (P-01-01/P-01-02 for the five carrier tarballs specifically).
  Blocked by F-01-2 (disk budget). The cli/mcp tarballs were fully inspected; the carriers were not.
- **Provenance verification for the `packaged_optional_dependency` path**, live. The code was read
  (`rust-engine.ts:465-476`, genuine `engine-manifest.json` `sha256` comparison) but never exercised
  against a real manifest in this session, for the same reason as above.
- **What "second platform" (P-01-11) or a genuinely fresh user account/container** would show. This
  charter ran entirely on the one machine the freeze was built on; "a machine that has never built
  Drift" was approximated by isolated temp state roots and an unset `DRIFT_ENGINE_BIN`, not by an
  actually distinct filesystem/user.
