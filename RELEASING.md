# Releasing Drift

Releases happen only in CI (`.github/workflows/release.yml`). No long-lived
tokens exist anywhere, and nothing is published from a developer machine.

## One-time setup

1. **npm name.** Set the package name in `npm/config.json` (a founder
   decision; the bare name `drift` is likely taken).
2. **Trusted publishing.** On npmjs.com, add this repository and the `release.yml`
   workflow as a trusted publisher for the main package and each platform
   package (`<name>-linux-x64`, `-linux-arm64`, `-darwin-x64`, `-darwin-arm64`,
   `-win32-x64`). If npm offers the trusted-publisher setting only for a package
   that already exists, the very first publish of each of the six names needs
   another way in (a one-time granular token, or a first publish by hand); the
   workflow reads no secret, so that is a decision for the owner, not a step that
   is already set up.
3. **Approval gate.** In GitHub, create an environment named `npm` with
   required reviewers. Every npm publish waits for a person.
4. **Tag protection.** Protect `v*` tags so only maintainers can push them.
5. **2FA** on GitHub and npm for every maintainer.
6. **GitHub Actions enabled** in the repository the release runs from.

## Cutting a release

1. Set the version everywhere at once: `node npm/set-version.mjs X.Y.Z` updates
   the workspace version and the internal crates' versions in `Cargo.toml`, the
   workspace members in `Cargo.lock` and the plugin version in
   `integrations/claude-code/.claude-plugin/plugin.json`.
   `node npm/set-version.mjs --check` lists any of these that disagree. Between
   releases `main` carries the next version with `-dev` (`0.1.0-dev`), the same in
   all of them; CI's `packaging` job fails when they disagree. The npm packages
   hold no version in the repository: `npm/build.mjs` stamps the tag's version.
2. Dry-run the packaging locally (publishes nothing): `npm/dry-run.sh X.Y.Z`
   checks that the versions agree, builds the linux-x64 release binary (or takes
   one from `BIN=<path>`), archives and checksums it with `npm/archive.sh` (and
   checks that a tampered archive fails `sha256sum -c`), builds and packs the npm
   packages with `npm/pack.sh`, installs the tarballs into a scratch project and
   runs `drift --version` through the launcher (`npm/install-test.sh`), then
   `census`, `init`, `review --block` and `check` on a small synthetic repository,
   and each Claude Code plugin hook once with sample input. These are the same
   scripts the release workflow runs. CI's `release-rehearsal` job runs this
   script on every pull request that touches the release path; CI's `packaging`
   job (`npm/ci-check.mjs`) runs the workflow's own steps on stub binaries on
   every pull request, and checks that a rehearsal cannot publish.
3. Commit the version change (`Release vX.Y.Z`) and open a pull request.
4. **Rehearse the whole release on the release commit** (publishes nothing):

   ```sh
   gh workflow run release.yml --ref <release-branch>      # dry_run defaults to true
   gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')"
   ```

   It runs every job a release runs, at the version in `Cargo.toml`: the five
   target builds, the binary's `--version`, the archives and `SHA256SUMS`, the
   six npm tarballs, and the install test from those tarballs on Linux x64,
   Linux arm64, macOS (arm64) and Windows. It keeps them as workflow artifacts
   (`release-archives`, `npm-tarballs`, `bin-<target>`; `gh run download <id>`)
   for 14 days. It creates no tag and no GitHub Release, makes no attestation and
   publishes nothing to npm; a manual run with `dry_run` unticked is refused.
   Look at the artifacts before going on.
5. Merge to `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
6. CI first checks that the tag and every version in the repository agree, then
   builds five targets, archives, checksums and packs them, install-tests the
   tarballs on each OS, attaches the archives, `SHA256SUMS` and SLSA build
   provenance to the GitHub Release, then waits for approval to publish npm. The
   npm job publishes the tarballs the install test ran, platform packages first.
   A prerelease tag (`v0.2.0-beta.1`) becomes a GitHub prerelease and is published
   to npm under the `next` dist-tag, not `latest`. A package version npm already
   has is skipped, so re-running a partly failed npm job finishes the rest.
7. Set `main` to the next development version: `node npm/set-version.mjs X.Y.(Z+1)-dev`.

## Verifying a download

```sh
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify drift-vX.Y.Z-<target>.tar.gz --repo dadbodgeoff/drift
```
