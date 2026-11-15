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
