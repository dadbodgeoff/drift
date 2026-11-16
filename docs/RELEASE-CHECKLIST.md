# Pre-publish checklist (beta)

Everything here must be true **before anyone pushes a release tag**: pushing a
`v*` tag starts `.github/workflows/release.yml`, which builds the binaries,
creates the GitHub Release and then waits for approval to run `npm publish`
([RELEASING.md](../RELEASING.md) has the full procedure).

> **Publishing needs the owner's explicit go-ahead.** No agent and no
> contributor pushes a release tag, approves the `npm` environment or runs
> `npm publish` on their own judgement. Record the go-ahead (who, when, which
> version, which commit) in the release pull request before the tag is pushed.
> A checked box below is not a go-ahead.

A box is ticked only when someone verified it, with the date and how. Ticks from
2026-11-16 were made on the `gap/release-dryrun` branch (based on
`map-to-enforcement` at `525d956a`) on a Linux x86_64 machine with no GitHub
Actions; nothing was run on GitHub.

## A. Only the owner can do these

These need the owner's accounts (GitHub repository settings, npm scope) or are
the owner's decisions. Nobody else can tick them.

### A1. Release identity (blocks everything else)

The code lives in the development repository (GeoffreyFernald/Driftv22). Every
release-facing file names **dadbodgeoff/drift** and the npm package
**@dadbodgeoff/drift**:

| Where | What it names |
| --- | --- |
| `npm/config.json` | `name: @dadbodgeoff/drift`, `repository: https://github.com/dadbodgeoff/drift` (platform packages are `@dadbodgeoff/drift-<platform>`) |
| `Cargo.toml` (`[workspace.package] repository`) | `https://github.com/dadbodgeoff/drift` |
| `integrations/claude-code/.claude-plugin/plugin.json` | `homepage` and `repository`: `https://github.com/dadbodgeoff/drift` |
| `scripts/action/install.sh` (the Action) | downloads release archives from, and builds Drift from, `https://github.com/dadbodgeoff/drift` (`scripts/action/test.sh` checks it matches `npm/config.json`) |
| `README.md` | `npm install -g @dadbodgeoff/drift`, `claude plugin marketplace add dadbodgeoff/drift`, `uses: dadbodgeoff/drift@…`, the pre-commit `repo:` URL |
| `RELEASING.md` | `gh attestation verify … --repo dadbodgeoff/drift` |

`npm/ci-check.mjs` checks that `Cargo.toml`, `plugin.json`, `action.yml`, the npm
launcher and `RELEASING.md` all name the repository in `npm/config.json`.

- [ ] **How v2 reaches dadbodgeoff/drift.** Push this repository's `main`
      history there, or replace what is there. The 2026-11-07 dry run
      ([DRYRUN.md](../eval/release/2026-11-07/DRYRUN.md)) found that
      dadbodgeoff/drift's `main` is another code base with tags up to `v0.9.46`:
      a first version of `0.1.0` would sort below them. Until the push,
      `uses: dadbodgeoff/drift@main` and `claude plugin marketplace add
      dadbodgeoff/drift` reach the old code.
- [ ] **The release runs in dadbodgeoff/drift.** Trusted publishing,
      provenance (`gh attestation verify --repo dadbodgeoff/drift`) and the
      Action's release download (and its fallback build from source) all assume the workflow runs there, not in
      the development repository.
- [ ] **The npm scope.** `@dadbodgeoff` must be the owner's npm user or
      organisation (npmjs.com, signed in: `https://www.npmjs.com/settings/dadbodgeoff/packages`).
      On 2026-11-08 the registry answered "Not found" for `@dadbodgeoff/drift`.
- [ ] **If the identity changes** (another owner, repository or package name),
      change `npm/config.json` first, then every row of the table above, and
      run `node npm/ci-check.mjs <dir with the yaml package>` (it fails on any
      file that disagrees).

### A2. One-time setup in the release repository and on npm

- [ ] **GitHub Actions are enabled** in the release repository (Settings >
      Actions > General). They are off in the development repository: no
      workflow there has run on GitHub.
- [ ] **Trusted publishing** on npmjs.com for `@dadbodgeoff/drift` and each
      platform package (`-linux-x64`, `-linux-arm64`, `-darwin-x64`,
      `-darwin-arm64`, `-win32-x64`), bound to the release repository and the
      workflow file `release.yml`, environment `npm` (each package's page >
      Settings > Trusted publishing).
- [ ] **The first publish of each name.** Not verified (the npm documentation
      was not reachable from the machine that wrote this): if npm lets a trusted
      publisher be added only to a package that already exists, the first
      publish of the six names needs a one-time granular token or a first
      publish by hand. The workflow reads no secret, so this would fail on the
      first tag unless decided beforehand.
- [ ] **An `npm` environment with required reviewers** (Settings >
      Environments > New environment `npm` > Required reviewers), so every npm
      publish waits for a person.
- [ ] **Tag protection** on `v*` (Settings > Rules > Rulesets > New tag
      ruleset, target `v*`, restrict creation to maintainers).
- [ ] **2FA** on GitHub and npm for every maintainer.

### A3. The release itself

- [ ] **The version number**, then `node npm/set-version.mjs X.Y.Z` on a
      release branch (for example `0.1.0-beta.1`, or above `0.9.46`: see A1). A
      prerelease tag is published to npm under `next`, not `latest`, and becomes
      a GitHub prerelease.
- [ ] **The full rehearsal ran green on the release commit** in the release
      repository: `gh workflow run release.yml --ref <release-branch>`, then
      `gh run watch <run id>`, then `gh run download <run id>` and a look at
      `release-archives` (five tarballs and `SHA256SUMS`) and `npm-tarballs`
      (six tarballs). Needs Actions (A2).
- [ ] **The owner's go-ahead is recorded** (who, when, version, commit) in the
      release pull request.
- [ ] Merge the release pull request, then push the tag from the release
      repository: `git tag vX.Y.Z && git push origin vX.Y.Z`.
- [ ] A person approves the `npm` environment (the run's page > Review
      deployments) only after checking the GitHub Release: five tarballs,
      `SHA256SUMS`, provenance.

## B. The release path (anyone can verify; tick with date and how)

- [x] **The versions agree, and one command sets them.** 2026-11-16:
      `node npm/set-version.mjs --check` prints `version 0.1.0-dev: 11 places
      agree` (Cargo.toml workspace version and 4 path dependencies, Cargo.lock's
      5 members, plugin.json); `node --test npm/set-version.test.mjs` passes 8
      tests (set and round trip on a copy, a failure for each place that
      disagrees).
- [x] **CI's `packaging` job passes locally.** 2026-11-16: `node
      npm/ci-check.mjs <dir with yaml 2.9.1>` ok (Node 22, npm 10.9.9). It ran
      release.yml's verify, version, archive, pack, install-test and publish
      steps on stubs. 11 hand-made breakages were each caught: the npm job
      without its tag-only condition, `dry_run` defaulting to false, a matrix
      artifact name without the target, a manual run that publishes, an
      archive step that drops the executable bit, write permission on a job that
      publishes nothing, the main package published before the platform
      packages, a plugin version that disagrees, a secret read, a launcher that
      drops arguments, and a platform binary packed without its executable bit.
- [ ] **Dry run on a release binary.** `npm/dry-run.sh X.Y.Z` (it builds the
      `x86_64-unknown-linux-musl` release binary; about 7 minutes). On
      2026-11-16 it was **not** run with a release build: `BIN=<debug build of
      this branch> npm/dry-run.sh` passed (versions, archive, `SHA256SUMS`, a
      tampered archive rejected, six npm tarballs, install from the tarballs
      offline, `drift 0.1.0-dev` through the launcher, census, init, review
      --block, check exit 0 then 1 on a new unwrapped route, practices promote,
      and all six plugin hooks with Stop blocking). The release-profile musl
      build last ran on 2026-11-07 ([DRYRUN.md](../eval/release/2026-11-07/DRYRUN.md)).
      CI's `release-rehearsal` job runs the full script on GitHub.
- [ ] **Gates pass on the release commit:**
  - [ ] `cargo fmt --all --check`
  - [ ] `cargo clippy --all-targets --locked -- -D warnings`
  - [ ] `RUSTFLAGS="-D warnings" INSTA_UPDATE=no cargo test --all --locked`
  - [ ] `node --test eval/study/*.test.mjs`
  - [ ] `cargo deny check`
  - [ ] Studio: `npm ci --ignore-scripts`, then typecheck, lint, vitest and build
  - [ ] `node npm/ci-check.mjs <dir with the yaml package>` and
        `node --test npm/set-version.test.mjs` (CI's `packaging` job)
- [ ] **The release commit is the measured product, or the difference is
      stated.** The out-of-sample figures in [ACCURACY.md](ACCURACY.md) were
      measured at the round-10 freeze `F10` (`5151e5c`). If anything that
      changes mining, check or what agents see merged since, either re-run the
      dev3 census comparison (as `eval/study/runs/dev3-recensus-2026-11-08/`)
      or say in the release notes that the figures are for an earlier product.

## C. Documentation is honest

- [ ] [ACCURACY.md](ACCURACY.md) matches the committed run and plan READMEs it
      cites, marks every figure in-sample or out-of-sample, and quotes no card
      from a blind or held-out pool.
- [ ] Nothing in the README, the release notes, the npm description, the plugin
      description or the GitHub Release claims ≥ 95%, a held-out pass, a
      real-maintainer accept rate or a verifier precision. None of these exists.
- [ ] If the dev4 report (round 11) is committed before the release, ACCURACY.md
      and the README's "Limits of the beta" are updated from it. If it is not,
      no dev4 figure appears anywhere.
- [ ] Every command in the README's "Getting started" matches `drift --help`
      and `drift <command> --help` of the release binary.
- [ ] The README renders on the npm package page (npm ships the root
      `README.md` in the main package): its relative links to `docs/` and
      `eval/` resolve, or are made absolute to the release repository.
- [ ] The README's Install section says the npm package and the release
      archives exist (today it says nothing is published, which stays true until
      the tag).
- [ ] [RELEASE-NOTES-beta.md](RELEASE-NOTES-beta.md) has the final version,
      date and repository, and its "Known limits" are still true.

## D. Product state for this beta

These describe the round-11 product (decision D13). Check each on the release
binary with a synthetic repository (the dry run's is enough):

- [ ] `drift init` proposes everything in advise mode; `drift check` exits 0
      until a person sets a convention to block.
- [ ] A default-tier proposal is listed as a block candidate and is **not** in
      the SessionStart or PreToolUse hook output, `drift example`, MCP or the
      AGENTS.md export until it is accepted.
- [ ] With no `.drift/config.yaml`, a Python repository gets its mined proposals,
      every one a suggestion, and `census --json` has no `python_proposals`. With
      `proposals: {python: off}` it gets none, and `census --json` reports
      `python_proposals.withheld`.
- [ ] `drift review --block <suggestion id>` is refused without `--force`.
- [ ] `crates/drift-mine/data/family-admission.json` admits no family, and
      `show-policy.json` is the committed table (`node --test
      eval/study/show-policy.test.mjs`).
- [ ] `agents.verify`, `review_log` and `experimental: [wiring]` are off by
      default.

## E. Not part of this publish

- **The Studio** is packaged unsigned by `.github/workflows/studio-package.yml`
  (CI artifacts only); it is not signed, notarised, attached to a release or in
  any npm package. What its first signed release needs is in
  `apps/studio/README.md` (Packaging).
- **Code signing.** The release binaries are not code-signed or notarised;
  checksums and SLSA build provenance are what users can verify.
- **darwin-x64** is cross-compiled on Apple silicon and has no runner of its
  own: the rehearsal's install test covers linux-x64, linux-arm64, darwin-arm64
  and win32-x64.

## F. After publishing (owner, or anyone the owner asks)

- [ ] The `verify` job agreed on the tag and the repository's versions; the
      package job checked `drift --version` of the built binary.
- [ ] On a clean machine: `npm install -g @dadbodgeoff/drift@next` (or the
      version), `drift --version`, then `drift census` on a small repository.
- [ ] `sha256sum -c SHA256SUMS --ignore-missing` and `gh attestation verify
      drift-vX.Y.Z-<target>.tar.gz --repo dadbodgeoff/drift` pass for a
      downloaded tarball.
- [ ] `claude plugin marketplace add dadbodgeoff/drift` and `claude plugin
      install drift@drift` install the plugin of this version.
- [ ] `node npm/set-version.mjs X.Y.(Z+1)-dev` on `main`.
