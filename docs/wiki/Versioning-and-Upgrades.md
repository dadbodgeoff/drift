# Versioning and Upgrades

How Drift versions its releases and its formats, what happens to the files in `.drift/` and to the cache when you change the binary, and how to upgrade a team safely. This page is for the engineers who install Drift and the leads who decide when a team moves to a new version. The statements are from the code (`crates/drift-core`, `crates/drift-mine`, `crates/drift-cli`), `RELEASING.md` and the project's release documents, and were checked by running `drift 0.1.0-dev`.

## Release versions

Drift uses semantic version numbers (`X.Y.Z`). `drift --version` prints `drift <version>`; this wiki describes `drift 0.1.0-dev`.

- Between releases, the main branch carries the next version with `-dev` (`0.1.0-dev`). The version in `Cargo.toml`, `Cargo.lock` and the Claude Code plugin manifest (`integrations/claude-code/.claude-plugin/plugin.json`) is always the same; `node npm/set-version.mjs X.Y.Z` sets all of them, `node npm/set-version.mjs --check` lists any that disagree, and the project's CI fails when they do.
- A prerelease tag such as `v0.2.0-beta.1` becomes a GitHub prerelease and is published to npm under the `next` dist-tag, not `latest`. Install it with `npm install -g @dadbodgeoff/drift@next`.
- The first beta had not been published when this page was written; its notes are a draft in the repository (`docs/RELEASE-NOTES-beta.md`), and the version, date and publishing repository are open decisions there. Until a release exists, build from source (`cargo install --locked --path crates/drift-cli`, Rust 1.97).
- Releases are built and published only by the project's release workflow: one archive per platform (`x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`, `x86_64-apple-darwin`, `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`), a `SHA256SUMS` file and SLSA build provenance, and npm packages published behind a manual approval. Before a tag is pushed, the same workflow can be run by hand as a rehearsal: it builds, archives, packs and install-tests everything on Linux, macOS and Windows and publishes nothing. The binaries are not code-signed or notarised; verify them with:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

```bash
gh attestation verify drift-vX.Y.Z-<target>.tar.gz --repo dadbodgeoff/drift
```

Every change a user can see is recorded in `CHANGELOG.md` at the repository root, with each breaking change marked **Breaking:**; what changed in a release is also in its release notes. A project-level compatibility policy beyond what is stated below is not published: this is a pre-release (`0.x`), and anything may change between versions.

## Platforms

Linux and macOS are where Drift is built and tested. Native Windows (`x86_64-pc-windows-msvc`) is built by the release, and the project's CI runs the whole test suite on `windows-latest` on pull requests that change the Rust build, but that job does not fail the run and has not yet been seen green, so native Windows is not yet supported: use WSL, where Drift is the Linux binary. What the code does for native Windows, pinned by tests that run on every system:

- One spelling of the repository root: a `\\?\C:\…` path from the system is read as `C:\…`, and the keys Drift writes to `drift.lock` and `.drift/security.lock` are repository paths with `/` on every system, so a lock written on Windows matches on Linux.
- Drift's own files read the same with CRLF line endings (Git for Windows checks text out so by default) or a UTF-8 byte-order mark: `drift.lock`, `.drift/security.lock`, `.drift/conventions.yaml` and `.drift/config.yaml`.
- The agent hooks deny writes to `.drift/` and `drift.lock` in the Windows spellings of the path listed there, from Git Bash commands too ([Hooks Reference](Hooks-Reference)).
- File permissions (a private `0600` file) are set on Unix only; on Windows the file gets the directory's access rules.

Not expected to work on native Windows yet: anything the Windows CI job still shows failing, and the agent hooks under a shell other than Git Bash (a `PowerShell` tool's commands are not read).

## The numbers inside Drift

| Number | Where it lives | Value in this build | What it means |
| --- | --- | --- | --- |
| Drift version | `drift --version`, `engine:` in `.drift/conventions.yaml`, `tool.driver.version` in SARIF | `0.1.0-dev` | The release. `engine` records which Drift mined the conventions. |
| Facts schema | `schema_version` in `drift scan --json`, `facts_schema` in `drift practices --json`, the cache directory name `facts-v11` | 11 | Bumped whenever the shape or meaning of the facts Drift records changes. Part of every fact-cache key. |
| Lowering version | The parser tag of the cache (`ts-l86-0.1.0-dev`, `py-l74-0.1.0-dev`) | TypeScript/JavaScript 86, Python 74 | Bumped when the way a language is turned into facts changes. Part of the cache key. |
| Index versions | `index-v11-1/`, `index-py-v11-5/` in the cache | 1 (TS/JS), 5 (Python) | The version of the file-stamp index that lets later scans read only changed files. |
| Policy format | `version:` in `.drift/conventions.yaml` | 1, 2 or 3 (reads up to 3) | See below. |
| Selector version | `selector_version:` on a convention | up to 3 (4 for test and kind roles) | How a convention's role selector is read. |
| Inventory version | `# inventory:` in `.drift/security.lock` | 2 | The version of what the security inventory finds, stamped in the baseline it writes. See below. |
| JSON schema versions | `schema`, `version` in the JSON outputs | see [Output and JSON Reference](Output-and-JSON-Reference) | The output formats. |

## What happens to the cache when the binary changes

The fact cache is content-addressed: a parsed file is stored under the facts schema, the parser tag and the file's content hash. The parser tag contains the lowering version **and the Drift version**, so installing any other version of Drift gives every file a new key. Nothing is migrated: the old entries are simply not read, the first scan after an upgrade parses everything again (the slow first run), and later scans are fast again. The file-stamp indexes and the derived-results directory (`derived-v1/`) are likewise keyed by version, and the derived results also by the build and the executable, so they rebuild on their own.

I found no code that deletes old fact-cache entries when they stop being used. After several upgrades `.drift/cache/` can hold several generations; delete the directory to reclaim the space (it is local and safe to delete: see [Files Drift Writes](Files-Drift-Writes)). Session state older than 30 days is pruned automatically.

## What happens to the files you commit

| File | After an upgrade |
| --- | --- |
| `.drift/conventions.yaml` | Read as written. Version 1 files need no migration. A file with a `version` higher than the running Drift knows (above 3 in this build) is refused with `was written by a newer Drift` (exit 2): upgrade the binary. Version 2 appears when `drift init` runs in a repository of several packages, and version 3 when the file holds a promoted practice of a newer form (below), so a team that mixes Drift versions can hit this: a Drift that does not know the version cannot read the file. The version is decided from the content on every write, so a file with none of a newer format's forms is written as before, byte for byte, and a file whose last such form is removed goes back down. Selectors are frozen when a convention is written, so a new Drift keeps checking the members the convention was written for; a new Drift mines again only when you run `drift init`. A file that holds a promoted practice cannot be read by a Drift from before promotion (below). |
| `drift.lock` | Read as written; a plain list of lines, with no version. A lock without fingerprint lines works as before; the next `drift init` adds them. Fingerprint lines are written as comments (`#~ <id> <fingerprint> <path#symbol>`), so an older Drift, which skips comments, reads only the member lines. A fingerprint line in the earlier form `<id> ~<fingerprint> <path#symbol>` is still read, and never written. |
| `.drift/security.lock` | Read as written. Its `# inventory:` line says which inventory wrote it (below). |
| `.drift/config.yaml` | Read as written. A key the running Drift does not know is a warning, never an error, so a file written for a newer Drift is harmless to an older one (it ignores what it does not know). |
| Session state, review log | Local. A session state that cannot be read is replaced; a review log is append-only with its own event version. |

What an upgrade can change without touching any of your files is **what `drift check` finds**, because the facts and the readings of guards and exposure improve between versions: a violation can appear that was invisible before, a baselined violation can disappear (it is then listed as `fixed`), and a practice or security answer can move between `known`, `none` and `unknown`. This is why the upgrade steps below start with a check on your main branch.

`drift init --refresh-kinds` relearns the file-kind vocabulary frozen in `.drift/conventions.yaml`, to adopt new kinds after an upgrade. Existing conventions keep their ids, but the files their roles cover may change, so run `drift check` afterwards and review new violations of accepted conventions (they are not baselined).

## The security baseline

`.drift/security.lock` records the version of the inventory that wrote it (`# inventory: 2` in this build). The version is raised whenever a kind of finding is added, or a detector whose findings a baseline holds (a kind of risky operation). Version 1 is every kind and detector before the stamp; version 2 added `unscoped-key`. A baseline written before the stamp reads as version 1.

After an upgrade, a finding of a kind newer than the baseline's version is not the change's doing: `drift check` and `drift security --ratchet` list it apart, as new in this version of Drift, and it fails nothing until `drift security --write-baseline` records it. So upgrading Drift never fails every check at once. A new kind also starts as advice: `unscoped-key` advises until a person sets it to fail (`drift security --write-baseline --fail-on unscoped-key`).

## Promoted practices and older Drift

`drift practices promote` writes a convention whose rule type is `practice`. A Drift from before promotion does not know that rule type, and it cannot read a `.drift/conventions.yaml` that holds one **at all**: every command that reads the policy (`drift check`, `drift review`, the hooks, CI) stops with a parse error that names the rule type, exit 2. It does not skip the one convention and go on.

A practice promoted by named ways in a package or a directory leaves the file's `version:` as it was, so a Drift from before promotion does not say `was written by a newer Drift`; the parse error is what you see. A file with no promoted practice is unchanged and reads as before.

Three forms of a promoted practice make the file version 3: one that accepts a mechanism whole (`--mechanism`), one that accepts any enforcing way (`--any-enforcing`), and one that holds in one file or under a route prefix (`--in` with a file or `<package>:/<prefix>`). A Drift that reads up to version 2 would read each of these as a narrower or wider rule than it is (without the mechanism, every unit that uses it by another instrument would be a violation; a file or a route place would be read as its whole directory), so the version is raised and such a Drift refuses the file instead of checking it wrongly. Two newer fields do not raise it, because a Drift that skips them checks the same rules: `from_map` (where a proposal came from; rewritten by such a Drift, the label is lost) and `accepted_evidence` (lost the same way, and frozen again at the next `drift init`).

What a Drift says when the file is newer than it reads: on the command line, `<file> was written by a newer Drift (policy format N; this Drift reads up to 3). Upgrade Drift to the version that wrote it (`drift --version` shows the one installed here; every machine and CI that reads this repository needs it), or restore the file from before that change` (exit 2); to an agent, through the hooks, `.drift/conventions.yaml was written by a newer Drift (format N): upgrade Drift (`drift --version` shows this one); no convention is shown to agents until then`. This build reads the version alone before the rest of the file, so it gives that message even when it could not parse the rest.

So, before anyone promotes the first practice in a repository:

1. Upgrade Drift on every machine that runs it: each teammate's, and the Claude Code plugin's `drift` on the `PATH`.
2. Upgrade CI: pin the Action (`uses: dadbodgeoff/drift@<tag>`, which runs the Drift of that ref) or your pipeline's Drift to the same version.
3. Then promote, and commit `.drift/conventions.yaml` and `drift.lock`.

A machine left on the older Drift fails open in the hooks (the agent is told the policy could not be read) and fails `drift check` with exit 2: never a pass. To go back to an older Drift after a practice was promoted, restore `.drift/conventions.yaml` from before the promotion, or delete the promoted practice's entry from the file by hand. Rejecting it is not enough: a rejected convention stays in the file, with its rule type.

## Upgrading

Upgrade the binary, then the repository, in this order:

1. **Install the new binary** on one machine first: replace the binary a teammate gave you, or rebuild from source (`cargo install --locked --path crates/drift-cli`). After the first release you can also use `npm install -g @dadbodgeoff/drift@<version>`, or replace the prebuilt binary and verify its checksum. Confirm with `drift --version`.

```bash
drift --version
```

2. **Ask what the new Drift reads differently**, on an up-to-date main branch with the policy committed. It changes nothing (exit 0: nothing to do; exit 3: something is). Expect one slow run while the cache rebuilds.

```bash
drift upgrade
```

3. **Let it do what changes no decision**, then read what is left: each item names its command.

```bash
drift upgrade --apply
```

Drift Studio shows the same report in its Upgrade view, at the foot of the sidebar. It offers Apply only for the work Drift lists as its own, and runs it only after you confirm in a dialog. `--security-baseline` is added only if you tick it there.

4. **See what a re-learn would add**, without writing anything; re-run `init` only if you want the new proposals (it keeps every decision and id; new proposals get their current violations baselined). Then review them as you did the first time, and commit `.drift/conventions.yaml` and `drift.lock`.

```bash
drift census
```

```bash
drift init
```

5. **Move the team and CI together.** Pin the version everywhere: the same Drift version on every machine, and in CI a pinned Drift (the GitHub Action takes a `drift-ref` input, default `main`; pin a tag or a full commit SHA for reproducible CI). Machines on different versions can disagree about what `drift check` finds until all have upgraded.
6. **Update the Claude Code plugin with the binary.** The plugin's hooks call `drift` from the `PATH`, and the plugin and the binary are released with the same version number. The plugin is installed outside the repository; `drift upgrade` does not read it.

### What `drift upgrade` reports

- **Each file Drift wrote**, with what it records of the Drift that wrote it, and its format against what this Drift reads and writes. Most files record no writer; the report says so and never guesses one:

| File | Records of its writer | Records of its format |
| --- | --- | --- |
| `.drift/conventions.yaml` | `engine:`: the Drift that last ran `drift init` here (`drift review` and `drift practices promote` keep it as it was). No record of which Drift made any later change. | `version:` (1, 2 or 3); per convention `selector_version` (absent is 1); `accepted_evidence` once a Drift that keeps it met the convention accepted. |
| `drift.lock` | Nothing. | Nothing: plain lines `<id> <path#symbol>`, and below those written since fingerprints a comment line `#~ <id> <fingerprint> <path#symbol>` (the older form `<id> ~<fingerprint> <path#symbol>` is read too). The report counts lines without one. |
| `.drift/security.lock` | Nothing. | `# inventory:` (absent: read as 1) and `# fail:`. |
| `.drift/config.yaml` | Nothing (an answer `drift setup` recorded carries its day). | Nothing. |
| `.drift/review-log/log.jsonl` | Each event: `drift.version`. The report shows the last event's. | Each event: `v`. |
| `.drift/feedback/marks.json` | Nothing. | `schema`, `version`. |
| `.drift/cache/` | The parser tag of each directory (`ts-l86-0.1.0-dev`) holds the Drift version. | `facts-v11`. Generations this Drift does not read are listed; the cache is local and safe to delete. Nothing is deleted. In `--json`, `present` here says whether the cache is in use (not `--no-cache`), so the report reads the same before and after a run creates it. |

- **Every accepted convention**: its evidence when accepted (`accepted_evidence`; "not recorded" for one accepted before Drift kept it) against what this Drift reads now (members, those that follow it, those it cannot tell, its mode), and what changed class: `stale` (it advises until a person looks), `newly_violated_by_unchanged_code`, `no_longer_checkable` (Drift cannot tell any of its members), or `unchanged`.
- **New violations, in three groups.** *Only because the reading changed*: the commit that first wrote the convention into `.drift/conventions.yaml` also wrote `drift.lock`; checked with this Drift at that commit (as `drift check --diff-base` checks a merge base), the violation was already there, in a declaration no line of which has changed since, and the lock written then did not hold it. *In code that changed*: `drift check` reports them as before. *Drift cannot tell*: no git history, a shallow clone, a policy never committed, a convention whose rule or role changed since, a file Drift could not parse at that commit, `drift.lock` unreadable at that commit, a lock line for it taken out since (committed, or only in the working copy), a file renamed since, or git failing to say; each with its reason, for a person. None of these is ever baselined.
- **The security baseline**: its inventory version against this Drift's, and the findings of kinds or detectors added since, which fail nothing until the baseline records them. Findings of kinds the baseline knows that are not in it fail `drift check` as before; they are counted, for a person, because Drift cannot tell a change's from an old kind it now reads in more places.
- **Agent integrations**, compared by content with what this Drift writes: the Drift block in `AGENTS.md`, `CLAUDE.md` or `.claude/CLAUDE.md`, and Drift's entries in `.claude/settings.json` or `.claude/settings.local.json`.

### What `--apply` does, and never does

In order, and only where a file would change (a file that needs none keeps its bytes and its modification time):

1. Formats: no file needs a new format today. A `.drift/conventions.yaml` that holds a form of a newer format than its `version:` says is reported for a person, not raised: raising it makes every older Drift refuse the file.
2. The violations that appear only because the reading changed are baselined in `drift.lock`, each as a member line and its fingerprint line, as `drift init` writes them, appended at the end of the file: every line already there, comments included, keeps its bytes.
3. Drift's entries in `.claude/settings.json` are refreshed when they are exactly what an older Drift wrote (the project keeps each older list): the entries this Drift adds are merged in, nothing is removed. Entries that match no Drift's list were edited by a person and are left, with the command to refresh them. The `AGENTS.md` block is never rewritten: its older wording is not kept, so Drift cannot tell an older block from an edited one; the report names `drift export agents-md --write <file>`.
4. `.drift/security.lock` only with `--security-baseline`: the findings new in this Drift are added and the stamp raised; every finding it held is kept, and the kinds that fail stay as they were.

It never accepts, rejects, promotes or demotes a convention, never changes a mode, and never deletes a line. Running it twice is the same as once. An upgrade never makes a check fail that passed (it only adds lock lines), and never passes one that failed for a change (only violations in unchanged code that the lock written for their convention did not hold are baselined).

### Exit codes and refusals

| Exit | Meaning |
| --- | --- |
| 0 | Nothing needs doing (after `--apply`: nothing is left). |
| 3 | Something needs doing: by `--apply`, with `--security-baseline`, or by a person. Each item in "Left to do" names its command. |
| 1 | A write of `--apply` failed: the report's `Done` (`done`) lists what was written before it, and nothing after it was (`failed` says which write). |
| 2 | Refused, nothing changed: `.drift/conventions.yaml` or `.drift/security.lock` was written by a newer Drift (upgrade Drift), or `.drift/conventions.yaml`, `drift.lock`, `.drift/security.lock` or `.drift/config.yaml` does not parse (the file and the line are named). |

No hook and no `drift check` says an upgrade report is pending: the plan does not ask for it.

### `--json`

`drift upgrade --json` prints the same report as one object, deterministic (every list sorted, no time): `schema` `drift-upgrade`, `version` 1, `drift` (this Drift's version), `apply`, `files` (`path`, `present`, `records`, `written_by`, `format`, `this_drift`, `notes`), `conventions` (`id`, `summary`, `rule` `mined`, `practice` or `wiring`, `accepted`, `now` with `role`, `members`, `holders`, `not_checked`, `stale`, `mode`, `unchecked`; `classes`, `reading_only`, `changed_code`, `cannot_tell`), `violations` (`reading_only`, `changed_code`, `cannot_tell`: each `id`, `member`, `line`, and `base` or `why`), `security` (`present`, `inventory`, `stamped`, `this_inventory`, `new_in_drift` by kind, `new_in_drift_total`, `failing_not_in_baseline`), `integrations` (`path`, `kind` `agents-md` or `claude-settings`, `state` `current`, `older`, `edited` or `differs`, `note`), `done`, `failed` (only when a write failed), `left` (`what`, `command`, `by` `apply`, `security_baseline` or `person`) and `pending`. A refusal is `{"schema", "version", "drift", "refused": true, "newer": [...], "unreadable": [...]}`, exit 2.

To go back to an older Drift, reinstall the older binary; the cache rebuilds again. An older Drift refuses a `.drift/conventions.yaml` whose format version it does not know (see above), so a downgrade after `drift init` wrote version 2, or after a practice of a version-3 form was promoted, needs that file restored from git; the same holds after a practice was promoted ([above](#promoted-practices-and-older-drift)). Downgrades are not tested by the project.

Not built yet: answers in `.drift/config.yaml` that go stale when the evidence they rested on changes (see [Setup Questions](Setup-Questions) and [Drift in CI](Drift-in-CI)). Check the release notes of the version you upgrade to.

What changed in the build this wiki describes, for a script that reads Drift's output: `none` (authentication, authorization) and `internal` (exposure) are worded as what Drift found in what it read, and the JSON gains `basis` and `exposure_basis` (the value `none` and the keys and ids of `none` variants are unchanged); authentication that identifies the caller and turns no one away is a state of its own, `identified` (variant `kind` `identified`, `assignment` `identified`, a count of its own), where it was `known` with an `identifies:` key (the key is unchanged); `drift investigate` and `drift findings` are new, with the schemas `drift-investigate`, `drift-findings`, `drift-finding` and `drift-gap-report`, all version 1; and the Python and TypeScript lowering versions are 65 and 71, so a cache from before rebuilds. See [Release Notes](https://github.com/dadbodgeoff/drift/blob/main/docs/RELEASE-NOTES-beta.md).

See also: [Output and JSON Reference](Output-and-JSON-Reference), [Configuration Reference](Configuration-Reference), [Files Drift Writes](Files-Drift-Writes), [Team Rollout](Team-Rollout), [Drift in CI](Drift-in-CI), [Troubleshooting](Troubleshooting), [Glossary](Glossary)
