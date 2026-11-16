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

## 0. Open question: release identity (blocks everything else)

The code lives in the development repository (GeoffreyFernald/Driftv22). Every
release-facing file names **dadbodgeoff/drift** and the npm package
**@dadbodgeoff/drift**:

| Where | What it names |
| --- | --- |
| `npm/config.json` | `name: @dadbodgeoff/drift`, `repository: https://github.com/dadbodgeoff/drift` (platform packages are `@dadbodgeoff/drift-<platform>`) |
| `Cargo.toml` (`[workspace.package] repository`) | `https://github.com/dadbodgeoff/drift` |
| `integrations/claude-code/.claude-plugin/plugin.json` | `homepage` and `repository`: `https://github.com/dadbodgeoff/drift` |
| `action.yml` | builds Drift with `cargo install --git https://github.com/dadbodgeoff/drift` |
| `README.md` | `npm install -g @dadbodgeoff/drift`, `claude plugin marketplace add dadbodgeoff/drift`, `uses: dadbodgeoff/drift@…`, the pre-commit `repo:` URL |
| `RELEASING.md` | `gh attestation verify … --repo dadbodgeoff/drift` |

`npm/ci-check.mjs` checks that `Cargo.toml`, `plugin.json`, `action.yml`, the npm
launcher and `RELEASING.md` all name the repository in `npm/config.json`.

The intended answer (owner's task) is to **push v2 to dadbodgeoff/drift and
publish under the npm scope @dadbodgeoff**. Before that is done, decide and
record:

- [ ] **How v2 reaches dadbodgeoff/drift.** Push this repository's `main`
      history there, or replace what is there. What dadbodgeoff/drift holds
      today was **not checked** for this checklist (the session had no access
      to it). Anything published from it now (its default branch, its tags) is
      what `uses: dadbodgeoff/drift@main`, the pre-commit hook and the plugin
      marketplace command give users today.
- [ ] **The release runs in dadbodgeoff/drift.** Trusted publishing,
      provenance (`gh attestation verify --repo dadbodgeoff/drift`) and the
      Action's `cargo install --git` all assume the workflow runs there, not in
      the development repository.
- [ ] **The npm scope.** `@dadbodgeoff` must be the owner's npm user or
      organisation. On 2026-11-08 the registry answered "Not found" for
      `@dadbodgeoff/drift`: the name is not published yet. Who owns the scope
      was not checked.
- [ ] **If the identity changes** (another owner, repository or package name),
      change `npm/config.json` first, then every row of the table above, and
      run `node npm/ci-check.mjs` (it fails on any file that disagrees).

## 1. One-time setup in the release repository and on npm

From [RELEASING.md](../RELEASING.md), "One-time setup":

- [ ] **GitHub Actions are enabled** in the release repository. (They are off in
      the development repository: no workflow there has been run on GitHub,
      including CI's `packaging` job.)
- [ ] **Trusted publishing** on npmjs.com for `@dadbodgeoff/drift` and each
      platform package (`-linux-x64`, `-linux-arm64`, `-darwin-x64`,
      `-darwin-arm64`, `-win32-x64`), bound to that repository and
      `release.yml`.
- [ ] **An `npm` environment with required reviewers** in that repository, so
      every npm publish waits for a person.
- [ ] **Tag protection** on `v*`, so only maintainers can push release tags.
- [ ] **2FA** on GitHub and npm for every maintainer.

## 2. The release commit

- [ ] **Version.** `node npm/set-version.mjs X.Y.Z` on a release branch, for
      example `0.1.0-beta.1` for the beta. A prerelease tag is published to npm
      under `next`, not `latest`, and becomes a GitHub prerelease. The version
      number is the owner's choice.
- [ ] **Gates pass on the release commit** (GitHub Actions are off here, so
      locally):
  - [ ] `cargo fmt --all --check`
  - [ ] `cargo clippy --all-targets --locked -- -D warnings`
  - [ ] `RUSTFLAGS="-D warnings" INSTA_UPDATE=no cargo test --all --locked`
  - [ ] `node --test eval/study/*.test.mjs`
  - [ ] `cargo deny check`
  - [ ] Studio: `npm ci --ignore-scripts`, then typecheck, lint, vitest and build
  - [ ] `node npm/ci-check.mjs <dir with the yaml package>` (CI's `packaging` job)
- [ ] **Dry run.** `npm/dry-run.sh X.Y.Z` passes: versions agree, the linux-x64
      release binary builds, a tampered archive fails `sha256sum -c`, the npm
      packages install into a scratch project, and `census`, `init`,
      `review --block`, `check` and each Claude Code hook run once on a
      synthetic repository.
- [ ] **The release commit is the measured product, or the difference is
      stated.** The out-of-sample figures in [ACCURACY.md](ACCURACY.md) were
      measured at the round-10 freeze `F10` (`5151e5c`); the D13 changes since
      left the TypeScript/JavaScript card set unchanged. If anything that
      changes mining, check or what agents see merges after the current main,
      either re-run the dev3 census comparison (as
      `eval/study/runs/dev3-recensus-2026-11-08/`) or say in the release notes
      that the figures are for an earlier product.

## 3. Documentation is honest

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
- [ ] [RELEASE-NOTES-beta.md](RELEASE-NOTES-beta.md) has the final version,
      date and repository, and its "Known limits" are still true.

## 4. Product state for this beta

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

## 5. Not part of this publish

- **The Studio** is packaged unsigned by `.github/workflows/studio-package.yml`
  (CI artifacts only); it is not signed, notarised, attached to a release or in
  any npm package. What its first signed release needs is in
  `apps/studio/README.md` (Packaging).
- **Code signing.** The release binaries are not code-signed or notarised;
  checksums and SLSA build provenance are what users can verify.

## 6. Publish (only after the owner's go-ahead)

- [ ] The owner's go-ahead is recorded (who, when, version, commit).
- [ ] Merge the release pull request, then push the tag from the release
      repository: `git tag vX.Y.Z && git push origin vX.Y.Z`.
- [ ] The `verify` job agrees on the tag, `Cargo.toml` and `plugin.json`
      versions; the release job checks `drift --version` of the built binary.
- [ ] A person approves the `npm` environment only after checking the GitHub
      Release: five tarballs, `SHA256SUMS`, provenance.

## 7. After publishing

- [ ] On a clean machine: `npm install -g @dadbodgeoff/drift@next` (or the
      version), `drift --version`, then `drift census` on a small repository.
- [ ] `sha256sum -c SHA256SUMS --ignore-missing` and `gh attestation verify
      drift-vX.Y.Z-<target>.tar.gz --repo dadbodgeoff/drift` pass for a
      downloaded tarball.
- [ ] `claude plugin marketplace add dadbodgeoff/drift` and `claude plugin
      install drift@drift` install the plugin of this version.
- [ ] `node npm/set-version.mjs X.Y.(Z+1)-dev` on `main`.
