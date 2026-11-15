# Versioning and Upgrades

How Drift versions its releases and its formats, what happens to the files in `.drift/` and to the cache when you change the binary, and how to upgrade a team safely. This page is for the engineers who install Drift and the leads who decide when a team moves to a new version. The statements are from the code (`crates/drift-core`, `crates/drift-mine`, `crates/drift-cli`), `RELEASING.md` and the project's release documents, and were checked by running `drift 0.1.0-dev`.

## Release versions

Drift uses semantic version numbers (`X.Y.Z`). `drift --version` prints `drift <version>`; this wiki describes `drift 0.1.0-dev`.

- Between releases, the main branch carries the next version with `-dev` (`0.1.0-dev`). The version in `Cargo.toml`, `Cargo.lock` and the Claude Code plugin manifest (`integrations/claude-code/.claude-plugin/plugin.json`) is always the same; the project's CI fails when they disagree.
- A prerelease tag such as `v0.2.0-beta.1` becomes a GitHub prerelease and is published to npm under the `next` dist-tag, not `latest`. Install it with `npm install -g @dadbodgeoff/drift@next`.
- The first beta had not been published when this page was written; its notes are a draft in the repository (`docs/RELEASE-NOTES-beta.md`), and the version, date and publishing repository are open decisions there. Until a release exists, build from source (`cargo install --locked --path crates/drift-cli`, Rust 1.97).
- Releases are built and published only by the project's release workflow: one archive per platform (`x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`, `x86_64-apple-darwin`, `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`), a `SHA256SUMS` file and SLSA build provenance, and npm packages published behind a manual approval. The binaries are not code-signed or notarised; verify them with:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

```bash
gh attestation verify drift-vX.Y.Z-<target>.tar.gz --repo dadbodgeoff/drift
```

There is no separate changelog file; what changed in a release is in its release notes. A project-level compatibility policy beyond what is stated below is not published: this is a pre-release (`0.x`), and anything may change between versions.

## The numbers inside Drift

| Number | Where it lives | Value in this build | What it means |
| --- | --- | --- | --- |
| Drift version | `drift --version`, `engine:` in `.drift/conventions.yaml`, `tool.driver.version` in SARIF | `0.1.0-dev` | The release. `engine` records which Drift mined the conventions. |
| Facts schema | `schema_version` in `drift scan --json`, `facts_schema` in `drift practices --json`, the cache directory name `facts-v11` | 11 | Bumped whenever the shape or meaning of the facts Drift records changes. Part of every fact-cache key. |
| Lowering version | The parser tag of the cache (`ts-l76-0.1.0-dev`, `py-l69-0.1.0-dev`) | TypeScript/JavaScript 76, Python 69 | Bumped when the way a language is turned into facts changes. Part of the cache key. |
| Index versions | `index-v11-1/`, `index-py-v11-5/` in the cache | 1 (TS/JS), 5 (Python) | The version of the file-stamp index that lets later scans read only changed files. |
| Policy format | `version:` in `.drift/conventions.yaml` | 1 or 2 (reads up to 2) | See below. |
| Selector version | `selector_version:` on a convention | up to 3 (4 for test and kind roles) | How a convention's role selector is read. |
| JSON schema versions | `schema`, `version` in the JSON outputs | see [Output and JSON Reference](Output-and-JSON-Reference) | The output formats. |

## What happens to the cache when the binary changes

The fact cache is content-addressed: a parsed file is stored under the facts schema, the parser tag and the file's content hash. The parser tag contains the lowering version **and the Drift version**, so installing any other version of Drift gives every file a new key. Nothing is migrated: the old entries are simply not read, the first scan after an upgrade parses everything again (the slow first run), and later scans are fast again. The file-stamp indexes and the derived-results directory (`derived-v1/`) are likewise keyed by version, and the derived results also by the build and the executable, so they rebuild on their own.

I found no code that deletes old fact-cache entries when they stop being used. After several upgrades `.drift/cache/` can hold several generations; delete the directory to reclaim the space (it is local and safe to delete: see [Files Drift Writes](Files-Drift-Writes)). Session state older than 30 days is pruned automatically.

## What happens to the files you commit

| File | After an upgrade |
| --- | --- |
| `.drift/conventions.yaml` | Read as written. Version 1 files need no migration. A file with a `version` higher than the running Drift knows (above 2 in this build) is refused with `was written by a newer Drift` (exit 2): upgrade the binary. Version 2 appears when `drift init` runs in a repository of several packages, so a team that mixes Drift versions can hit this: a Drift that does not know version 2 cannot read the file. Selectors are frozen when a convention is written, so a new Drift keeps checking the members the convention was written for; a new Drift mines again only when you run `drift init`. |
| `drift.lock` | Read as written; a plain list of lines, with no version. |
| `.drift/config.yaml` | Read as written. A key the running Drift does not know is a warning, never an error, so a file written for a newer Drift is harmless to an older one (it ignores what it does not know). |
| Session state, review log | Local. A session state that cannot be read is replaced; a review log is append-only with its own event version. |

What an upgrade can change without touching any of your files is **what `drift check` finds**, because the facts and the readings of guards and exposure improve between versions: a violation can appear that was invisible before, a baselined violation can disappear (it is then listed as `fixed`), and a practice or security answer can move between `known`, `none` and `unknown`. This is why the upgrade steps below start with a check on your main branch.

`drift init --refresh-kinds` relearns the file-kind vocabulary frozen in `.drift/conventions.yaml`, to adopt new kinds after an upgrade. Existing conventions keep their ids, but the files their roles cover may change, so run `drift check` afterwards and review new violations of accepted conventions (they are not baselined).

## Upgrading

Upgrade the binary, then the repository, in this order:

1. **Install the new binary** on one machine first: replace the binary a teammate gave you, or rebuild from source (`cargo install --locked --path crates/drift-cli`). After the first release you can also use `npm install -g @dadbodgeoff/drift@<version>`, or replace the prebuilt binary and verify its checksum. Confirm with `drift --version`.

```bash
drift --version
```

2. **Run a check on an up-to-date main branch.** Expect one slow run while the cache rebuilds. Read what changed against what you had.

```bash
drift check
```

3. **See what a re-learn would add**, without writing anything.

```bash
drift census
```

4. **Re-run `init` only if you want the new proposals.** It keeps every decision and id and adds new proposals; new proposals get their current violations baselined. Then review them as you did the first time, and commit `.drift/conventions.yaml` and `drift.lock`.

```bash
drift init
```

5. **Move the team and CI together.** Pin the version everywhere: the same Drift version on every machine, and in CI a pinned Drift (the GitHub Action takes a `drift-ref` input, default `main`; pin a tag or a full commit SHA for reproducible CI). Machines on different versions can disagree about what `drift check` finds until all have upgraded.
6. **Update the Claude Code plugin with the binary.** The plugin's hooks call `drift` from the `PATH`, and the plugin and the binary are released with the same version number.

To go back to an older Drift, reinstall the older binary; the cache rebuilds again. An older Drift refuses a `.drift/conventions.yaml` whose format version it does not know (see above), so a downgrade after `drift init` wrote version 2 needs that file restored from git. Downgrades are not tested by the project.

Not built yet: answers in `.drift/config.yaml` that go stale when the evidence they rested on changes (see [Setup Questions](Setup-Questions) and [Drift in CI](Drift-in-CI)). Check the release notes of the version you upgrade to.

What changed in the build this wiki describes, for a script that reads Drift's output: `none` (authentication, authorization) and `internal` (exposure) are worded as what Drift found in what it read, and the JSON gains `basis` and `exposure_basis` (the value `none` and the keys and ids of `none` variants are unchanged); authentication that identifies the caller and turns no one away is a state of its own, `identified` (variant `kind` `identified`, `assignment` `identified`, a count of its own), where it was `known` with an `identifies:` key (the key is unchanged); `drift investigate` and `drift findings` are new, with the schemas `drift-investigate`, `drift-findings`, `drift-finding` and `drift-gap-report`, all version 1; and the Python and TypeScript lowering versions are 65 and 71, so a cache from before rebuilds. See [Release Notes](https://github.com/dadbodgeoff/drift/blob/main/docs/RELEASE-NOTES-beta.md).

See also: [Output and JSON Reference](Output-and-JSON-Reference), [Configuration Reference](Configuration-Reference), [Files Drift Writes](Files-Drift-Writes), [Team Rollout](Team-Rollout), [Drift in CI](Drift-in-CI), [Troubleshooting](Troubleshooting), [Glossary](Glossary)
