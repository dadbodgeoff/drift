# Security policy

Drift parses untrusted code and runs inside AI agents' hooks, so we treat
security reports as the highest priority.

## Reporting a vulnerability

Please report privately through GitHub's **Report a vulnerability** button on
this repository's Security tab. Do not open a public issue.

We aim to acknowledge reports within 2 business days and to agree a fix and
disclosure date with you. We credit reporters unless you prefer otherwise.

## Scope

In scope: the `drift` CLI and libraries, hook output (including prompt
injection through repository content), the GitHub Action, and release
artifacts. Findings about third-party repositories that Drift happened to scan
are out of scope; report those to their maintainers.

## Dependency alerts

GitHub's dependency alerts for this repository are, today, all in sample
projects under `apps/studio/fixtures/`. They are not vulnerabilities of Drift:

- Those directories hold small synthetic repositories (their `package.json` and
  `pyproject.toml` files included) that Drift Studio shows as test input. They
  are written by the scripts in `apps/studio/scripts/` (`make-fixtures.mjs`
  and its siblings), which run `drift`, `git`, the Claude Code plugin's hooks
  and Drift's own Node scripts; none of them runs `npm`, `npx`, `pip` or a
  fixture's own scripts.
- Nothing installs or runs them. The npm workspaces in the root `package.json`
  are `packages/ui` and `apps/studio` only, `package-lock.json` has no entry
  under `apps/studio/fixtures/`, and CI's `npm ci --ignore-scripts` installs
  from that lock file. Studio's fixture mode reads a fixture's `sources/` files
  as text to display them (`apps/studio/src/shared/api/fixture.ts`,
  `readSource`).
- They are not shipped: the release builds only the `drift` binary, and the npm
  packages hold only that binary, a launcher script and a README.

How we handle an alert: we check which file it is in. An alert in
`apps/studio/fixtures/` is dismissed as test input, with that reason. An alert in
anything that is built, installed or shipped (`Cargo.lock`, the root
`package-lock.json`, the workspaces `packages/ui` and `apps/studio`) is treated
as a real dependency problem and fixed like any other bug; `cargo deny check`
runs on every pull request for the Rust dependencies. If a fixture ever needs a
real fix, for example because it is copied into a real project, the fixture is
updated.
