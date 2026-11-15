# Release dry run, 2026-11-07

The whole release path was run on one Linux x86_64 machine, from `main` at
a7d6183 plus this branch's packaging changes (merging main d20953b changed no
release file). Nothing was published, tagged or pushed outside the
development repository. Commands below that publish are marked
**needs user approval**. They were not run.

## What the pipeline produces

| Piece | File(s) | Produces |
|---|---|---|
| Release workflow | `.github/workflows/release.yml` (on a `v*.*.*` tag) | `verify`: the tag, the `Cargo.toml` version and the plugin version must agree. `build`: 5 binaries (linux x64 and arm64 musl, macOS x64 and arm64, Windows x64). `release`: a check that the linux-x64 binary reports the tag version (new), `drift-vX.Y.Z-<target>.tar.gz` ×5, `SHA256SUMS`, SLSA provenance attestations, and a GitHub Release (a prerelease for `-` tags). `npm`: after approval in the `npm` environment, 6 npm packages published with trusted publishing and `--provenance`, under dist-tag `latest`, or `next` for prereleases |
| npm packaging | `npm/config.json`, `npm/build.mjs`, `npm/launcher/drift.js` | `@dadbodgeoff/drift` (the launcher `bin/drift.js`, README, LICENSE; `optionalDependencies` on the 5 platform packages at the same version) and `@dadbodgeoff/drift-<os>-<cpu>` ×5 (`bin/drift[.exe]`, LICENSE; `os`/`cpu` set). No package has install scripts |
| Version tool (new) | `npm/set-version.mjs X.Y.Z` | Writes X.Y.Z into `Cargo.toml` (the workspace and the 4 internal crate dependencies), `Cargo.lock` and `plugin.json` |
| Local dry run | `npm/dry-run.sh [X.Y.Z]` | Everything below except the plugin install, pre-commit and the Action, which were run by hand |
| CI guard | `npm/ci-check.mjs` (the `packaging` job in `ci.yml`) | Runs on stub binaries, without a Rust build |
| Claude Code plugin | `.claude-plugin/marketplace.json`, `integrations/claude-code/` | A marketplace `drift` with one plugin `drift` (6 hooks, 1 skill). The hooks run `drift hook claude <Event>` from `PATH` |
| pre-commit | `.pre-commit-hooks.yaml` | `drift-check` and `drift-check-strict` (`language: system`, so `drift` must be on `PATH`) |
| GitHub Action | `action.yml` | A composite action: it builds Drift from `drift-ref` with `cargo install` (it does not use the npm package or the release tarballs), uploads SARIF, and runs `drift check --format github` (PR mode on `pull_request`) |

## Steps run

All of the following ran from the worktree with the shared-target environment
(`CARGO_TARGET_DIR=/home/user/cargo-shared`, `WORK=<scratch>/dry`).

| # | Command | Result |
|---|---|---|
| 1 | `rustup target add x86_64-unknown-linux-musl` (musl-gcc was already installed) | ok |
| 2 | `DRIFT_BUILD_COMMIT=<tag> cargo build --release --locked -p drift-cli --target x86_64-unknown-linux-musl` | 6m33s. Output: a static-pie ELF of 17.6 MB, `drift 0.1.0-dev`, and `census --json` `commit` equal to the tag, so this is the binary built from this worktree. A second build in step 3 gave a byte-identical binary (same sha256 `1e58923c…`) |
| 3 | `WORK=… DRIFT_BUILD_COMMIT=<tag> npm/dry-run.sh` | exit 0, in 7m38s. Log excerpts follow in 3a–3f |
| 3a | version check (tag = `Cargo.toml` = `plugin.json`) | `0.1.0-dev` in all three |
| 3b | archive + `SHA256SUMS`, `sha256sum -c SHA256SUMS --ignore-missing` | `drift-v0.1.0-dev-x86_64-unknown-linux-musl.tar.gz: OK` (6.9 MB). A copy with one appended byte was **rejected**. The extracted binary prints `drift 0.1.0-dev` |
| 3c | `node npm/build.mjs`, `npm pack` ×6 | `dadbodgeoff-drift-0.1.0-dev.tgz` (22 KB): `LICENSE README.md bin/drift.js package.json`. `dadbodgeoff-drift-linux-x64-0.1.0-dev.tgz` (7.1 MB): `LICENSE bin/drift package.json`. The other 4 platform packages are stubs, as intended |
| 3d | `npm install --offline <platform>.tgz <main>.tgz` in a fresh project, then `npx --no-install drift --version` | `drift 0.1.0-dev`, through the launcher. `--offline` worked: npm skips the 4 other platforms' optional packages without the registry. `command -v drift` resolves to `node_modules/.bin/drift` |
| 3e | synthetic repository (40 routes, 38 wrapped in `withAuth`; 30 helpers; git-initialised): `drift census`, `drift init`, `drift review --block <id>`, `drift check`, then a new unwrapped route and `drift check` again | census: `1 conventions from 143 units in 7 roles`, `[D-37416b] HTTP handlers in app/** (route files) are wrapped in withAuth()`, 38/40, lower bound 0.83, default tier. init wrote the proposal. review: `1 accepted (1 block)`. check: `no new violations (2 legacy, baselined)`, exit 0. With the new route: `1 new violation(s)`, exit **1** |
| 3f | each command in `hooks.json` once, with sample hook JSON on stdin (`session_id`, `cwd`, `hook_event_name`, plus the event's fields) | SessionStart: exit 0, `additionalContext` "Drift: 1 of this repo's 1 accepted conventions block at end of turn…". PreToolUse (Write of a new route): exit 0, the rules for the new file. PostToolUse (after writing an unwrapped route): exit 0, "1 new convention violation(s) (1 marked (blocks) …". UserPromptSubmit: exit 0, no output. Stop: exit 0, `{"decision":"block","reason":"drift: 1 new convention violation(s) (blocks end of turn)…"}`. SessionEnd(`clear`): exit 0. Every non-empty output is valid JSON |
| 4 | `claude plugin validate .` and `claude plugin validate integrations/claude-code` | both pass. One directory warning: no plugin icon (`ICON_MISSING`). That is cosmetic and was not changed |
| 5 | `CLAUDE_CONFIG_DIR=<scratch> claude plugin marketplace add <worktree>`, then `claude plugin install drift@drift`, `plugin list`, `plugin details` | installed and enabled at user scope (scratch config): 6 hooks, 1 skill, about 68 always-on tokens. The cached `hooks/hooks.json` is identical to the source, which is the file step 3f ran |
| 6 | pre-commit 4.7.0 (scratch venv): `.pre-commit-config.yaml` with `repo: <worktree>`, `id: drift-check`, then `pre-commit install` and two commits | a commit adding an unwrapped route was **refused** ("drift check … Failed", exit 1, the violation listed). A clean commit passed |
| 7 | the Action's `Drift check (SARIF)` and `Drift check` steps, taken from `action.yml` and run with `DRIFT_EVENT=pull_request DRIFT_BASE_REF=main` on a feature branch with one bad route, against a local bare `origin` | SARIF step: exit 0, valid SARIF 2.1.0 with 1 result. Check step: exit 1, `::error file=app/api/bad/route.ts,line=1,title=drift D-37416b::…` and "1 new violation(s) introduced by the diff, 1 in block mode". The steps that need github.com (`Resolve Drift ref`, `cargo install --git`) and `upload-sarif` were not run |
| 8 | `node npm/ci-check.mjs <yaml>` | ok. Mutation checks each made it fail: plugin version 0.1.0 against Cargo 0.1.0-dev; an extra file in the main package; the publish step without the already-published skip; the publish step with prereleases tagged `latest` |
| 9 | `node npm/set-version.mjs 0.1.0`, then `ci-check`, then `node npm/set-version.mjs 0.1.0-dev` | ok both ways: Cargo.toml (5 lines), Cargo.lock (5 crates) and plugin.json changed, and the round trip left no diff. `v0.1.0` is refused (exit 2) |

## Bugs found and fixed on this branch

1. **Version drift.** `plugin.json` said `0.1.0` while `Cargo.toml` said `0.1.0-dev`. A tag
   could never pass the `verify` job without hand-editing two files, and nothing caught the
   mismatch before tag time. Fixed: the plugin is `0.1.0-dev`; `npm/set-version.mjs` sets all
   three; `ci-check` fails on any disagreement (Cargo.toml workspace and internal dependencies,
   Cargo.lock, plugin.json, marketplace.json).
2. **Dry run accepted a mismatched version.** `npm/dry-run.sh 0.2.0` built `0.2.0` npm packages
   around a binary that says `0.1.0-dev`, and still passed. It now checks the versions as the
   `verify` job does, and checks that the launcher prints `drift <version>`.
3. **The comment in release.yml claimed the binary's version was checked; nothing checked it.**
   Added a release-job step ("The binary reports the tag version"); ci-check runs it against
   stubs that report the right and the wrong version.
4. **A partial npm publish could not be re-run.** If one of the 6 publishes failed, a re-run
   stopped at the first package already published. The publish step now skips any
   `name@version` that the registry already has; ci-check runs the real step with a stub `npm`
   (order: platform packages first and main last; dist-tag; the skip).
5. **Package contents were only checked for presence.** ci-check now requires the exact file
   list of every package: no scratch files, fixtures or eval data can slip in. It also checks
   `os`/`cpu`, no `scripts`, the `bin` path, and that `optionalDependencies` cover all targets
   at the same version.
6. **One repository URL everywhere.** ci-check checks that `Cargo.toml`, `plugin.json`,
   `action.yml` and the launcher name the `npm/config.json` repository. All agree today.
7. **dry-run.sh** wrote `SHA256SUMS` with `./` prefixes (release.yml writes none); this now
   matches release.yml. It also runs the CLI and the plugin hooks end to end (steps 3e and 3f).

## For the user to decide (not changed)

- **The public repository already has history.** `github.com/dadbodgeoff/drift` exists, and its
  `main` (e371dbf) is not this code base. It has tags `v0.3.0`, `v0.9.33`, `v0.9.46` and
  `native-v0.9.32`, and branches `archive/v1` and `archive/v2`. Releasing `v0.1.0` there makes
  it a lower version than existing tags, and `drift-ref: v0.9.46` in the Action would build the
  old project. Consider a first version above 0.9.46 (for example `0.10.0` or `1.0.0-beta.1`).
  Until the public push, `uses: dadbodgeoff/drift@main` and `claude plugin marketplace add
  dadbodgeoff/drift` reach the old code.
- **npm name.** `@dadbodgeoff/drift` is free (registry 404), and so are the platform names.
  The `dadbodgeoff` npm scope must belong to the publishing account. Check on npmjs.com
  whether a trusted publisher can be added to a package that does not exist yet. If it
  cannot, the first publish of the 6 packages needs a one-time granular token (or a manual
  first publish), which also **needs user approval**.
- **Trusted publishing needs npm ≥ 11.5.1.** The npm job uses `setup-node` with Node 24, whose
  bundled npm is newer than that. Pinning `npm` explicitly would remove the dependence.
- **Binary size.** The release binary is not stripped (17.6 MB; 6.9 MB gzipped).
  `strip = true` in `[profile.release]` would shrink it, but it changes every release build in
  the shared target, so it was left alone.
- **The marketplace follows the default branch.** Users of `claude plugin marketplace add
  dadbodgeoff/drift` get the plugin from `main`, at `X.Y.Z-dev` between releases. The plugin
  needs `drift` on `PATH` (the npm global install), whatever its version.
- **Plugin icon** is missing (a validator warning only).

## Publishing (all of it **needs user approval**; none was run)

```sh
# 0. One-time setup (RELEASING.md "One-time setup"): npm scope + trusted publishers for the
#    6 packages, the `npm` environment with required reviewers, v* tag protection, 2FA.

# 1. Version (pick X.Y.Z; see the note on existing public tags above)
node npm/set-version.mjs X.Y.Z
npm install --prefix /tmp/yaml --no-save --ignore-scripts yaml@2.9.1 && node npm/ci-check.mjs /tmp/yaml
npm/dry-run.sh X.Y.Z                       # publishes nothing; about 8 minutes
git commit -am "Release vX.Y.Z"            # then a pull request, merged to main

# 2. Public push of main to github.com/dadbodgeoff/drift         <- needs user approval
# 3. Tag; CI builds, attaches tarballs, SHA256SUMS, provenance     <- needs user approval
git tag vX.Y.Z && git push origin vX.Y.Z
# 4. Approve the `npm` environment deployment in the Actions run   <- needs user approval
# 5. Back to development
node npm/set-version.mjs X.Y.(Z+1)-dev
```

After the release, check it from a clean machine:

```sh
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify drift-vX.Y.Z-<target>.tar.gz --repo dadbodgeoff/drift
npm install -g @dadbodgeoff/drift && drift --version
```

## Not covered here

- The macOS, Windows and linux-arm64 builds: they need those runners. Their npm packages were
  built from stubs.
- SLSA attestation and `gh attestation verify`: GitHub signs with Sigstore inside the workflow,
  so there is no local key to test with. The pipeline signs nothing with a key of its own, so
  there is no key-based verification path to test.
- The Action's `cargo install --git` and SARIF upload: they need github.com and code scanning.
