# Security and Privacy

This page states what Drift reads, what it writes and where, whether it uses the network, what can leave the machine, how the Studio behaves, what permissions it needs, how to use it safely on proprietary code, and what its supply chain looks like. It is for the security and platform people who approve tools, and for engineers who must answer their questions. Each statement below was checked against the code at the head of this repository, and the page says how to check it yourself.

## Summary

- Drift is a local command-line program. It reads your working tree and writes under `.drift/`, to `drift.lock`, and to files you name with `--write` or `--out`.
- **No command of the `drift` binary makes a network connection.** The binary has no network dependencies, and it never calls home. It has no telemetry.
- **Nothing leaves the machine by default.** Its findings, answers and gap reports stay on disk, in the repository.
- The one way repository text can reach another party is through an agent you connect to it: hook and MCP output is read by the agent, and so by the model provider behind that agent. See "What leaves the machine".
- Drift runs no repository code. It parses text.

## What Drift reads

| Source | When | Notes |
| --- | --- | --- |
| Source files in the working tree: TypeScript, JavaScript, Python | every command that scans | Respects `.gitignore` and `.ignore` files; skips dependency and build directories, files over 1 MB, declaration files, generated and minified code, and (for mining) tests and demonstration code. Never follows a symbolic link out of the repository |
| Project files: `package.json`, `tsconfig`, `pyproject.toml`, `requirements*.txt`, `setup.cfg`, `setup.py`, workspace manifests, lint configs (ESLint, oxlint, Biome: read, not run) | scans | Read as text |
| Deployment descriptions: compose files, nginx, Traefik and Caddy configuration, Terraform for the tied code, and recognised-but-unread files | `drift security`, `drift practices`, `drift card` | Read as text; only a recognised file's name and shape is used when it is not read |
| `.drift/conventions.yaml`, `.drift/config.yaml`, `drift.lock` | most commands | Your policy and answers |
| Git metadata, through the `git` program if it is on `PATH` | `--diff-base`, the hooks, cache checks | `git diff`, `git merge-base`, `git ls-files`, `git rev-parse`, `git rev-list`, `git config --get` (to detect a shallow or partial clone). For the experimental `wiring` rules only, `git log --name-only` over recent commits to see which files change together. For `drift practices promote --block` only, the history of the files in the place, to find the commit that first added each one. Never `commit`, `add`, `checkout`, `fetch`, `push` or `stash` |
| Hook event JSON on standard input | `drift hook` | Sent by the agent host |
| `~/.claude/projects/` | the Studio only | Claude Code transcripts for the repository, to show agent sessions |

Drift reads the working tree, not git history, for its conventions, practice map and security inventory. The one exception besides the wiring rules is block mode for a promoted practice: `drift practices promote --block` reads when each file of the place was first committed, to pick the most recently added units, and then reads those units as they stand in the working tree. In pull-request mode it also reads the merge base: the base files are written to a temporary directory through a temporary git index, scanned, and removed; your working tree and index are never touched.

Environment variables the binary reads include `DRIFT_CACHE_DIR`, `DRIFT_EXPERIMENTAL`, `DRIFT_HOOK_TRACE`, `GITHUB_STEP_SUMMARY` and `HOME`; the full list is on [Configuration Reference](Configuration-Reference).

## What Drift writes, and where

| Where | What |
| --- | --- |
| `.drift/conventions.yaml`, `drift.lock` | `drift init`, `drift review` |
| `.drift/config.yaml` | `drift setup`, `drift_setup_answer` (MCP) |
| `.drift/cache/` | the fact cache, derived results and hook session state, from most commands and the hooks; it writes its own `.gitignore` of `*` |
| `.drift/review-log/` | only with the review log on; has its own `.gitignore` of `*` and a random per-repository salt |
| `.drift/verify-cache.json` | only with the experimental verifier on |
| a file you name | `drift export agents-md --write`, `drift export claude-settings --write`, `drift scan --out`, `drift review --export-log` |
| a temporary directory | pull-request mode's merge-base copy, removed afterwards |
| `DRIFT_CACHE_DIR` | where the cache goes instead, when set |

Drift never writes through a symbolic link that leaves the repository, and an issue draft (`drift findings --issue --write`) is never written through a symbolic link inside the repository, nor into `.drift/` or `drift.lock`; a gap report writes only inside its own fixture: such a link at `.drift/conventions.yaml`, `drift.lock` or an export target is refused with exit 2. The Claude Code hooks deny agent edits to `.drift/` and `drift.lock` (best effort for shell commands). The complete list by command is on [Files Drift Writes](Files-Drift-Writes).

## Network access

Three checks, each of which you can repeat:

1. **Dependencies.** The `Cargo.lock` of 225 packages holds no HTTP client, TLS library, async runtime or socket library (no `reqwest`, `hyper`, `ureq`, `curl`, `tokio`, `openssl`, `rustls`, `native-tls`). `grep -E '^name = "(reqwest|hyper|ureq|curl|tokio|openssl|rustls)"' Cargo.lock` finds nothing.
2. **Source.** A search of `crates/` finds no use of `TcpStream`, `TcpListener`, `UdpSocket` or an HTTP library. The only child process the binary starts for repository work is `git` (and `mkfifo` in tests).
3. **Behaviour.** `drift mcp` speaks only over standard input and output; it opens no port. `drift hook` reads standard input and writes standard output.

What does touch the network is around Drift, not inside it:

- **Installing it:** `npm install`, downloading a release archive, or `cargo install` fetching crates.
- **The GitHub Action:** it resolves the Drift to run with `git ls-remote`, downloads a released binary and its `SHA256SUMS` from the GitHub release (or builds from source with cargo), fetches the base branch history, uploads SARIF to GitHub code scanning, and, when asked, posts a pull request comment and a commit status or check run through the GitHub API. That is your CI talking to GitHub, by design.
- **Your agent:** hooks and MCP tools hand text to it (below).

`drift --version` and every other command make no update check.

## What leaves the machine

- **By default, nothing.** Drift sends no source code, no findings and no usage data anywhere. There is no telemetry.
- **Findings and gap reports stay local.** What Drift concludes about your code is written only under `.drift/` in your repository. Where a person chooses to commit `.drift/conventions.yaml`, `drift.lock` or `.drift/config.yaml`, those go wherever your repository goes. The review log is never committed (its directory ignores itself) and records no source code, file contents, repository name, remote, or user identity; `drift review --export-log` hashes ids, members and examples with a per-repository random salt and replaces reasons by their length, unless you pass `--include-paths`.
- **Through an agent.** When you connect an agent, Drift's hook and MCP output is text in that agent's context: convention summaries, file paths and symbol names, example paths, short code excerpts in setup evidence, and `unknown` reasons. That text goes wherever the agent's model provider takes it, under that provider's terms. Drift cannot see or limit that. If your code must not reach a provider, do not connect an agent to Drift (the command-line tool alone sends nothing). Repository text in this output is escaped, length-capped and labelled as data, so a hostile comment cannot pass for an instruction.

`drift investigate` hands an agent each open route with evidence (the same "Through an agent" point applies) and, when the agent records a finding or a gap report, writes it as a local file under `.drift/findings/` or `.drift/gap-reports/`. Each directory ignores itself, and Drift never posts, sends or pushes them. Two commands act on a finding only when a person asks: `drift findings --issue ID` prints an issue draft and posts nothing, and `drift findings --branch ID` makes a local git branch with the agent's patch, through a throwaway index, without touching `HEAD`, the index or the working tree, and never pushes. Reasons and skip notes an agent records go to `.drift/config.yaml`, which you may commit, so a suspected gap belongs in a finding, not in a reason. A gap report has the repository's names replaced by neutral ones and is meant to be sent to Drift's maintainers only if you choose to; nothing sends it for you.

## The Studio

The Studio is an Electron desktop app over the same CLI. You run it from a checkout (`npm ci`, then `npm run start -w drift-studio`) or from an unsigned package that CI builds (see `apps/studio/README.md`, Packaging). A package carries its platform's `drift` binary and runs it unless Settings names another; it has no updater and no update feed, so it never checks for a new version. It is not code-signed or notarised yet, so macOS and Windows warn before opening it.

- **Network:** its content security policy is `default-src 'self'; ... connect-src 'self'; frame-src 'none'; object-src 'none'`, so the renderer cannot load or connect to anything outside the app. Its settings page states: "Nothing is sent anywhere: no telemetry, no network access except what you ask for." (The development server allows local `ws:` and `http://localhost:*` connections, for development only.)
- **Processes:** it runs the `drift` binary with `execFile`, never through a shell, and does not run `git` (it reads `.git` files directly for provenance).
- **Files:** it reads the repository, `.drift/`, and Claude Code transcripts under `~/.claude/projects/`; it writes through `drift review` (so the same files as the CLI) and its own settings under the application's user-data directory.

## Permissions

- **Filesystem:** read access to the repository and write access to `.drift/`, `drift.lock` and any file you name. It does not need or use administrator rights.
- **Processes:** the `git` program, if present. If git is missing, commands that need it degrade (the hooks take every current violation as the baseline; `--diff-base` is an error).
- **Network:** none.
- **Agent hosts:** the Claude Code plugin registers hooks that run `drift hook claude <event>` on session start, before and after edits, before searches and shell commands, at end of turn, and on `/clear`, with the time budgets in its `hooks.json`. Every hook exits 0, so a Drift failure never blocks the agent. The read-only lookups are approved without a permission prompt; the setup answer tool writes `.drift/config.yaml`, and the verifier tool writes its cache only when enabled. See [Hooks Reference](Hooks-Reference).

## Safe use on proprietary code

- Run the binary locally or in your own CI. Nothing is uploaded.
- Do not commit `.drift/cache/`. It holds facts derived from your files (names, paths and structure), and there is no reason to share it; it ignores itself. A cache that git tracks is not used. Do not commit `.drift/verify-cache.json` either (it exists only with the experimental verifier on, and Drift does not ignore it for you): it holds verdicts an agent returned on one machine, which Drift reads whether or not git tracks the file.
- Review what you commit: `.drift/conventions.yaml` contains rule text, evidence counts, paths and symbol names from your code, as do `exceptions` and their reasons. It is policy, and it is as sensitive as your paths and symbol names are.
- Decide whether to connect an agent (see "Through an agent").
- Keep the opt-in review log off unless you are collecting maintainer decisions. It is local either way.
- Treat `none` and `internal` as "nothing found in what Drift read", not as assurance; Drift is a guardrail, not a security control. See [Accuracy and Limits](Accuracy-and-Limits).
- On untrusted repositories: Drift never runs repository scripts, never follows symlinks out of the repository, skips files over 1 MB, parses each file in its own bounded arena, and refuses a gateway configuration nested more than 32 levels. Output is deterministic and byte-identical across runs.

## Supply chain

- **Dependencies:** a Rust workspace (`drift-core`, `drift-ts`, `drift-py`, `drift-mine`, `drift-cli`) with 225 packages in `Cargo.lock`, built with `--locked`. The parsers are oxc (TypeScript and JavaScript) and Astral's ruff parser (Python), the latter pinned exactly.
- **`deny.toml` policy**, enforced in CI by `cargo deny check` (and part of the contribution checklist):
  - advisories: yanked crates are denied;
  - licences: an allow list (Apache-2.0, Apache-2.0 with LLVM exception, MIT, BSD-3-Clause, Unicode-3.0, Zlib, CC0-1.0, BSL-1.0), with one named exception for a Unicode data licence in one crate;
  - bans: wildcard version requirements are denied (wildcard path dependencies allowed), multiple versions of a crate warn;
  - sources: only the crates.io registry; unknown registries and unknown git sources are denied.
- **Releases** happen only in CI, with no long-lived tokens: the tag, `Cargo.toml` and the plugin version must agree; five targets are built; archives, `SHA256SUMS` and SLSA build provenance are attached to the GitHub Release; npm publishing waits for a person's approval and uses trusted publishing. Verify a download with `sha256sum -c SHA256SUMS --ignore-missing` and `gh attestation verify drift-vX.Y.Z-<target>.tar.gz --repo dadbodgeoff/drift`. The binaries are not code-signed or notarised; the checksums and provenance are what you can verify. Release status: no release has been published yet; see [Getting Started](Getting-Started).
- **The Action** pins the actions it uses to commit SHAs, runs the Drift of its own ref (or of the commit `drift-ref` resolves to), checks a downloaded release archive against the release's `SHA256SUMS` and its `drift --version` against the tag, and shows text from the repository in its pull request comment only as escaped code.
- **Reporting a vulnerability:** privately, through the repository's Security tab (see [SECURITY.md](https://github.com/dadbodgeoff/drift/blob/main/SECURITY.md)); in scope are the CLI and libraries, hook output (including prompt injection through repository content), the Action and release artifacts.
- **License:** Apache-2.0.

See also: [Files Drift Writes](Files-Drift-Writes), [Hooks Reference](Hooks-Reference), [Using Drift with Agents](Using-Drift-with-Agents), [Accuracy and Limits](Accuracy-and-Limits), [Versioning and Upgrades](Versioning-and-Upgrades), [FAQ](FAQ).
