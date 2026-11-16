# Files Drift Writes

Every file and directory Drift creates or changes, by command, with what to commit and what to leave out of git. This page is for the person who reviews what Drift does to a repository and for the lead who decides what goes into version control. It was checked against the code and by running each read-only command on a fresh repository to see what it left behind.

Drift reads the working tree and writes only under `.drift/`, to `drift.lock`, and to files you name yourself (`--write`, `--out`, `--export-log`). It never edits source files, never changes `.gitignore` or `.gitattributes`, never runs `git add` or `git commit`, and sends nothing over a network. The one thing it does in git's own storage is `drift findings --branch`, which a person runs to make a local branch from an agent's patch (see below); it never pushes. It never writes through a symbolic link that leaves the repository: such a link at a path it would write is refused (exit 2).

## Summary: commit, or ignore

| Path | Commit? | Why |
| --- | --- | --- |
| `.drift/conventions.yaml` | **Commit** | The team's decisions. `drift check`, the hooks, MCP and CI read it, so everyone gets the same rules. |
| `drift.lock` | **Commit** | The baseline of legacy violations. Without it, old code would fail new checks on every machine. |
| `.drift/security.lock` | **Commit** | The security baseline, written only by `drift security --write-baseline`: the security findings accepted as they are. `drift check` reports what is found later and is not in it. |
| `.drift/config.yaml` | **Commit** | What `drift setup` and people said about deployment, packages and practices, so teammates and CI get the same answers. |
| `.gitattributes` line `drift.lock merge=union` | Commit (you add it) | Lets parallel branches merge the lock without conflicts. Drift only suggests it. |
| `.drift/cache/` | **Ignore** | A local cache of parsed facts, derived results and agent session state. It ignores itself. |
| `.drift/review-log/` | **Ignore** | The opt-in local review log. It ignores itself. |
| `.drift/findings/` | **Ignore** | What an agent found while investigating (`drift investigate`): local findings. It ignores itself (its own `.gitignore` of `*`), and nothing posts or shares it. |
| `.drift/gap-reports/` | **Ignore** | Local reports of constructs Drift does not read, as minimal examples with the repository's names replaced. It ignores itself, and nothing sends it. |
| `.drift/feedback/` | **Ignore** | Your beta feedback marks, the key that hashes ids, and the exported file (`drift feedback`). It ignores itself (its own `.gitignore` of `*`), and nothing sends it. |
| `.drift/verify-cache.json` | **Ignore** | Verdicts of the experimental agent verifier, written only when `agents.verify: on` is set in `.drift/conventions.yaml`. It does not ignore itself, and Drift reads it whether or not git tracks it, so a committed copy would carry one machine's agent verdicts to every other. |
| `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json` | Your choice | Only if you run `drift export ... --write` on them; they are ordinary project files. |

A suggested block for a repository's `.gitignore`. The directories are already covered by the `.gitignore` files Drift creates inside them, so listing them is optional; `.drift/verify-cache.json` is needed only if you turn the verifier on, and nothing ignores it for you. The README carries the same block.

```text
# Drift: local state. Commit .drift/conventions.yaml, .drift/config.yaml and drift.lock.
.drift/cache/
.drift/review-log/
.drift/verify-cache.json
.drift/findings/
.drift/gap-reports/
.drift/feedback/
```

Do not ignore `.drift/` as a whole: that would drop the policy teammates and CI need.

## By command

"Cache" means `.drift/cache/` (or where `DRIFT_CACHE_DIR` points); `--no-cache` turns it off and the command then writes nothing there.

| Command | Creates or changes |
| --- | --- |
| `drift scan` | The cache. `--out FILE` writes the fact index to FILE. |
| `drift facts` | The cache. |
| `drift init` | `.drift/conventions.yaml` (created, or merged keeping every decision; it also holds the proposals from the map, as `proposed`, unless `--no-from-map` is given), `drift.lock` (baseline on first run; later, a baseline only for conventions new to the policy, and fingerprint lines for existing entries), the cache. It never writes `.drift/security.lock`: where there is none, it says what one would hold. |
| `drift census` | The cache in text mode. With `--json` or `--coverage`: nothing, unless `DRIFT_CACHE_DIR` is set. |
| `drift setup` | `.drift/config.yaml`, only when an answer, `--forget`, `--confirm` or `--reject` changes it. Listing, asking and `--json` write nothing; the repository is read without the cache unless `DRIFT_CACHE_DIR` is set. |
| `drift investigate` | Listing, `--json` and `--agent-brief` write nothing (the cache is used as for `drift security`). `--record` and `--answers` write `.drift/config.yaml` (a record under `setup:`, or an agent's proposal under `setup.proposed`; `reachable` also adds a `security.public` entry), and for a finding `.drift/findings/`, for a gap report `.drift/gap-reports/`. |
| `drift findings` | Nothing, except: `--issue ID --write FILE` writes FILE, and `--branch ID` creates a local git branch `drift/<id>` (a commit object and a branch ref; `HEAD`, the index and the working tree are not touched). |
| `drift review` | `.drift/conventions.yaml` on every decision; `drift.lock` when a card is promoted from the withheld ones (its current outliers are baselined) or a practice is promoted or a practice proposed from the map is accepted (its units that differ are baselined); `.drift/review-log/` when the log is on (`--set-log on`) or `--log` is given; the file named by `--export-log`. |
| `drift example`, `drift check`, `drift security` | The cache. (`example` and `check` need `.drift/conventions.yaml`.) `drift security --write-baseline` also writes `.drift/security.lock`. |
| `drift card` | The cache and the derived-results directory, but only when the repository has `.drift/conventions.yaml` (or `DRIFT_CACHE_DIR` is set); otherwise nothing. |
| `drift map`, `drift practices` | Nothing, unless `DRIFT_CACHE_DIR` is set. |
| `drift practices promote` | `.drift/conventions.yaml` (one accepted convention added, or updated under the same id when promoted again) and `drift.lock` (one line per unit that differs today). With `--dry-run` or `--list`, or when it refuses: nothing. |
| `drift feedback mark` | `.drift/feedback/marks.json`, and on the first mark `.drift/feedback/key` and the directory's `.gitignore`. |
| `drift feedback export` | `.drift/feedback/drift-feedback.json`, or the file named by `--out` (refused under `.drift/` outside `.drift/feedback/`, and for `drift.lock`). With `--dry-run`: nothing. |
| `drift hook claude ...` | Session state under `.drift/cache/sessions/` and the cache, only in a repository that has `.drift/conventions.yaml`. In one without, SessionStart builds a brief and writes nothing. |
| `drift mcp` | The cache. `drift_setup_answer` and `drift_investigate_record` write `.drift/config.yaml` (the second also `.drift/findings/` and `.drift/gap-reports/`); `drift_verify_card` (experimental) writes `.drift/verify-cache.json`. |
| `drift export agents-md --write FILE` | FILE: created, or only the text between the `drift:start` and `drift:end` markers replaced. Without `--write`, nothing. |
| `drift export claude-settings --write FILE` | FILE: created, or merged into (other settings kept, keys sorted). Without `--write`, nothing. |

## `.drift/`

```text
.drift/
  conventions.yaml        commit
  config.yaml             commit
  security.lock           commit (only once written)
  cache/                  ignore (has its own .gitignore of *)
    .gitignore
    facts-v11/<parser>/<xx>/<hash>.json
    index-v11-1/
    index-py-v11-5/
    derived-v1/
    sessions/
      <session_id>.json
      agent-hints.idx
      clear-handoff.json
  findings/               ignore (has its own .gitignore of *)
    .gitignore
    F-<id>.json
    F-<id>.md
  gap-reports/            ignore (has its own .gitignore of *)
    .gitignore
    G-<id>/
      fixture/
      expect.md
      gap.json
  review-log/             ignore (has its own .gitignore of *)
    log.jsonl
    log.1.jsonl
    salt
    lock
  feedback/               ignore (has its own .gitignore of *)
    .gitignore
    marks.json
    key
    drift-feedback.json
  verify-cache.json       ignore (experimental verifier only)
```

### `.drift/cache/`

| Entry | Holds | Rebuilt when |
| --- | --- | --- |
| `.gitignore` | `# Created by drift: the fact cache is local.` and `*`. Written once, only if nothing is there, and left alone afterwards. | |
| `facts-v<N>/<parser>/<xx>/<hash>.json` | Parsed facts per file, keyed by facts schema `N` (11 in this build), parser tag (`ts-l87-0.1.0-dev`: language, lowering version, Drift version) and the file's content hash. Entries are immutable. | A file's content, the facts schema, a lowering version or the Drift version changes: a new key, so old entries are simply not read. |
| `index-v<N>-<M>/`, `index-py-v<N>-<M>/` | An index of file stamps (size, times, inode) for TypeScript/JavaScript and Python, so later scans read only the files that changed, and a hook can check one edited file without a full scan. | Its version (`M`) or the facts schema changes. |
| `derived-v1/` | Results derived from a scan (mined conventions, the practice map, the keys of the security inventory, the index of the search hints), kept between runs and keyed by the facts, the Drift version and build, and the `DRIFT_*` variables set. | The facts, the build or those variables change. |
| `sessions/<session_id>.json` | A hook session's state: baseline, advice given, rules given, block counter. See [Hooks Reference](Hooks-Reference). | Deleted when untouched for 30 days (at session start). |
| `sessions/agent-hints.idx` | The index of entry points the search hint reads. | Rewritten at SessionStart. |
| `sessions/clear-handoff.json` | The baseline handed from a cleared session to the next. | Consumed at the next SessionStart; ignored after five minutes. |

The whole directory is safe to delete: the next run rebuilds it, and the first scan of a large repository is the slow one. It is local by design.

**When Drift will not use the cache.** Drift does not use `.drift/cache` (it runs without it, with one warning on standard error) when a symbolic link is in `.drift`, in `.drift/cache` or in its directories, or when git tracks anything under `.drift/cache`. Facts are keyed by content hash alone, so a committed entry could carry forged facts that would hide a violation from `drift check`. The check for tracked files runs `git ls-files`; without git it is skipped. In CI, set `DRIFT_CACHE_DIR` to a fresh directory outside the checkout, as the GitHub Action does, so that a pull request cannot supply cached facts.

### `.drift/review-log/`

Written only when the review log is on (`drift review --set-log on`, or `--log` for one run). It records each decision and each card shown: convention ids, evidence counts and Drift's version. It holds no source code, no file contents, no repository name or remote and nothing about who you are. Nothing is sent anywhere.

| File | Holds |
| --- | --- |
| `log.jsonl` | The events. It is rotated at 4 MiB into `log.1.jsonl`, replacing the older one. |
| `salt` | 32 random bytes (hex), one per repository, used to hash ids and paths in an exported study file so two repositories' exports cannot be joined. |
| `lock` | A lock so the command line and the Studio can append at once. |
| `.gitignore` | `*`, so the log is never committed. |

`drift review --export-log FILE` writes a study file to FILE in which convention ids, members and examples are hashed and reasons are replaced by their length; `--include-paths` keeps them as they are. Turn the log off with `--set-log off`; what the directory holds is kept until you delete it.

### `.drift/findings/` and `.drift/gap-reports/`

Written by `drift investigate` (and the MCP tool `drift_investigate_record`) when an agent or a person records a `finding` or a `drift-gap` outcome. They are local files: each directory is created with its own `.gitignore` (a comment and `*`), a symbolic link in their place is refused, and nothing posts, sends or pushes them. Sharing one is a person's deliberate act.

| Path | Holds |
| --- | --- |
| `.drift/findings/F-<id>.json` | A finding: the item it was found on (`item`, `seen`), `title`, `concern`, what Drift said (`drift_said`), the `routes`, why it is a gap (`why`), the suggested `fix`, the code cited (`excerpts`, `evidence`), an optional `patch` (a unified diff, never applied), who wrote it (`by`) and when (`on`). Schema `drift-finding`, version 1. |
| `.drift/findings/F-<id>.md` | The same, to read. |
| `.drift/gap-reports/G-<id>/fixture/` | The files of a minimal, self-contained example of a construct Drift does not read, with the repository's names replaced by neutral ones. At most 20 files, 64 KB each and 256 KB in all. |
| `.drift/gap-reports/G-<id>/expect.md` | What the example reproduces, what Drift says of it now, and what the right answer is. |
| `.drift/gap-reports/G-<id>/gap.json` | The record: `drift_said`, `expect`, `why`, `files`, `says` (what this Drift says of the fixture now), the Drift version, `by`, `on`. Schema `drift-gap-report`, version 1. |

The id is `F-` or `G-` and the six hex digits of the item (`I-...`), so recording again for the same item replaces the files. `drift findings` lists them; `drift findings --issue ID` prints an issue draft and `drift findings --branch ID` makes a local branch. Neither the agent nor Drift posts anything. Delete a finding by deleting its two files.

### `.drift/feedback/`

Written only by `drift feedback`, which a person runs. The directory is created with its own `.gitignore` (`# Created by drift: feedback marks and their key stay on this machine.` and `*`), a symbolic link in its place is refused, and nothing sends it.

| File | Holds |
| --- | --- |
| `marks.json` | Your marks: which report, verdict (`true` or `wrong`), your reason and the day. Schema `drift-feedback-marks`, version 1. Nothing in Drift reads it but `drift feedback export`; a mark changes no verdict. |
| `key` | 32 random bytes, made with the first mark, used to hash ids in the exported file. It is never written to that file. |
| `drift-feedback.json` | The exported file, schema `drift-feedback`, version 1, written only by `drift feedback export` (or to the file named by `--out`). |

Commit none of them. What the exported file holds, field by field, is on [Beta Feedback](Beta-Feedback).

### `.drift/verify-cache.json`

Written only with `agents.verify: on` in `.drift/conventions.yaml` (experimental, off by default): the verdicts of the agent verifier, keyed by convention and card content. No `.gitignore` is created for it.

## `drift.lock`

Written by `drift init`, by promoting a withheld card in `drift review`, and by promoting a practice (`drift practices promote`, or the practices step of `drift review`). Never by agents: the hooks deny writes to it, and `drift check` only reads it. Entries that no longer apply are listed as `fixed` in `drift check --format json` and can be removed by hand. See [Configuration Reference](Configuration-Reference) for the format.

It opens with `# drift.lock: legacy violations that never block. Fix code to remove lines.` Each entry is a member line, sorted, with its fingerprint line right below it:

```text
D-37416b app/api/r38/route.ts#GET
#~ D-37416b <16 hex digits> app/api/r38/route.ts#GET
```

The first is the member. The second, which starts with `#~`, is a fingerprint of the member's code: 16 hex digits of a BLAKE3 hash of what Drift read of it, with its name, line and own file path left out. For a function or method, that is its kind and what it does (wrappers, calls, rendered components, keys passed, control flow, thrown classes, environment reads, risky operations, the order of its calls, decorator arguments, how many string literals). For a file it is its exported names, the names of the symbols it declares, the packages it imports, its directives and the import a layering rule is about; for a model, its source and fields; for a package, its name and scripts. It is written as a comment so that an older Drift, which skips comments, does not read it as a second entry. A fingerprint line written as `D-37416b ~<16 hex digits> app/api/r38/route.ts#GET` is read the same way.

The fingerprint is what lets old debt move. When a member moves to another file (a function keeps its name; a file keeps its file name), `drift check` baselines its violation by the fingerprint line, but only where Drift read both ends: on a check of the whole repository, with the old member gone from a file Drift read (or its file gone), and with exactly one gone member and exactly one new violation of the same convention, fingerprint and name. Anything else is new: a copy next to the original, two identical handlers where one was deleted, a deletion of one legacy file beside a new file that reads the same, a renamed function or file, and every violation on a check of one file (the hook's check after an edit; the end of the turn checks the whole repository). Removing a member line ends its baseline, even if its fingerprint line is left behind.

A lock without fingerprint lines works as before. `drift init` adds the fingerprint lines to existing entries. Counts of legacy entries count the member lines only.

## `.drift/security.lock`

The security baseline. Written only by `drift security --write-baseline`; `drift init` offers it and writes nothing. Commit it: `drift check` and `drift security --ratchet` then report each finding that is found now and is not in it.

```text
# drift security baseline: what `drift security` found when this was written.
# `drift check` and `drift security --ratchet` report what is found now and is not here.
# Written by `drift security --write-baseline`; do not edit by hand.
# inventory: 3
# fail: <kinds, separated by commas>
<kind>	<key>
```

`# inventory:` is the version of what the inventory finds when the baseline was written (see [Versioning and Upgrades](Versioning-and-Upgrades#the-security-baseline)). `# fail:` lists the kinds whose new findings fail `drift check`; the others advise. Each finding is a line of its kind, a tab, and its key, by handler and route, never by line. A baseline written before these two header lines were added reads as inventory 1, with every kind failing but `unscoped-key`. See [Security Inventory](Security-Inventory#the-baseline-what-is-there-is-accepted-what-is-added-is-seen).

## Branches and merges

All the committed files are text and are ordinary merge candidates. `drift.lock` is sorted lines, so `merge=union` is safe for it; `.drift/conventions.yaml` and `.drift/config.yaml` are YAML and conflict like any YAML. After a merge, run `drift check` to see where the combined state stands.

See also: [Configuration Reference](Configuration-Reference), [Command Reference](Command-Reference), [Hooks Reference](Hooks-Reference), [Security and Privacy](Security-and-Privacy), [Team Rollout](Team-Rollout), [Troubleshooting](Troubleshooting)
