# Releasing Drift

Releases happen only in CI (`.github/workflows/release.yml`). No long-lived
tokens exist anywhere, and nothing is published from a developer machine.

## One-time setup

1. **npm name.** Set the package name in `npm/config.json` (a founder
   decision; the bare name `drift` is likely taken).
2. **Trusted publishing.** On npmjs.com, add this repository and the `release.yml`
   workflow as a trusted publisher for the main package and each platform
   package (`<name>-linux-x64`, `-linux-arm64`, `-darwin-x64`, `-darwin-arm64`,
   `-win32-x64`).
3. **Approval gate.** In GitHub, create an environment named `npm` with
   required reviewers. Every npm publish waits for a person.
4. **Tag protection.** Protect `v*` tags so only maintainers can push them.
5. **2FA** on GitHub and npm for every maintainer.

## Cutting a release

1. Set the version everywhere at once: `node npm/set-version.mjs X.Y.Z` updates
   the workspace and internal crate versions in `Cargo.toml`, `Cargo.lock` and the
   plugin version in `integrations/claude-code/.claude-plugin/plugin.json`. Between
   releases `main` carries the next version with `-dev` (`0.1.0-dev`), the same in
   all three; CI's `packaging` job fails when they disagree.
2. Dry-run the packaging locally (publishes nothing): `npm/dry-run.sh X.Y.Z`
   checks that the versions agree, builds the linux-x64 release binary, archives
   and checksums it (and checks that a tampered archive fails `sha256sum -c`),
   builds and packs the npm packages, installs them into a scratch project and
   runs `drift --version` through the launcher, then `census`, `init`,
   `review --block` and `check` on a small synthetic repository, and each Claude
   Code plugin hook once with sample input. CI's `packaging` job
   (`npm/ci-check.mjs`) covers the same path on every pull request with stub
   binaries: the YAML of the Action and workflows, the version and repository
   agreement, the archive step, the npm packages and their exact file lists,
   the launcher, and the npm publish step against a stub `npm`.
3. Commit the version change (`Release vX.Y.Z`) and open a pull request.
4. Merge to `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. CI first checks that the tag, the `Cargo.toml` version and the plugin version
   agree, then builds five targets, attaches tarballs, `SHA256SUMS` and SLSA build
   provenance to the GitHub Release, then waits for approval to publish npm. A
   prerelease tag (`v0.2.0-beta.1`) becomes a GitHub prerelease and is published
   to npm under the `next` dist-tag, not `latest`. A package version npm already
   has is skipped, so re-running a partly failed npm job finishes the rest.
6. Set `main` to the next development version: `node npm/set-version.mjs X.Y.(Z+1)-dev`.

## Verifying a download

```sh
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify drift-vX.Y.Z-<target>.tar.gz --repo dadbodgeoff/drift
```
