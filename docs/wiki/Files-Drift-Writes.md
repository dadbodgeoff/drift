# Files Drift Writes

Every file and directory Drift creates or changes, by command, with what to commit and what to leave out of git. This page is for the person who reviews what Drift does to a repository and for the lead who decides what goes into version control. It was checked against the code and by running each read-only command on a fresh repository to see what it left behind.

Drift reads the working tree and writes only under `.drift/`, to `drift.lock`, and to files you name yourself (`--write`, `--out`, `--export-log`). It never edits source files, never changes `.gitignore` or `.gitattributes`, never runs `git add` or `git commit`, and sends nothing over a network. The one thing it does in git's own storage is `drift findings --branch`, which a person runs to make a local branch from an agent's patch (see below); it never pushes. It never writes through a symbolic link that leaves the repository: such a link at a path it would write is refused (exit 2).

## Summary: commit, or ignore

| Path | Commit? | Why |
| --- | --- | --- |
| `.drift/conventions.yaml` | **Commit** | The team's decisions. `drift check`, the hooks, MCP and CI read it, so everyone gets the same rules. |
| `drift.lock` | **Commit** | The baseline of legacy violations. Without it, old code would fail new checks on every machine. |
| `.drift/config.yaml` | **Commit** | What `drift setup` and people said about deployment, packages and practices, so teammates and CI get the same answers. |
| `.gitattributes` line `drift.lock merge=union` | Commit (you add it) | Lets parallel branches merge the lock without conflicts. Drift only suggests it. |
| `.drift/cache/` | **Ignore** | A local cache of parsed facts, derived results and agent session state. It ignores itself. |
| `.drift/review-log/` | **Ignore** | The opt-in local review log. It ignores itself. |
| `.drift/findings/` | **Ignore** | What an agent found while investigating (`drift investigate`): local findings. It ignores itself (its own `.gitignore` of `*`), and nothing posts or shares it. |
| `.drift/gap-reports/` | **Ignore** | Local reports of constructs Drift does not read, as minimal examples with the repository's names replaced. It ignores itself, and nothing sends it. |
| `.drift/verify-cache.json` | **Ignore** | Verdicts of the experimental agent verifier, written only when `agents.verify: on` is set in `.drift/conventions.yaml`. It does not ignore itself, and Drift reads it whether or not git tracks it, so a committed copy would carry one machine's agent verdicts to every other. |
| `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json` | Your choice | Only if you run `drift export ... --write` on them; they are ordinary project files. |

A suggested block for a repository's `.gitignore`. The four directories are already covered by the `.gitignore` files Drift creates inside them, so listing them is optional; `.drift/verify-cache.json` is needed only if you turn the verifier on, and nothing ignores it for you. The README carries the same block.

```text
# Drift: local state. Commit .drift/conventions.yaml, .drift/config.yaml and drift.lock.
.drift/cache/
.drift/review-log/
.drift/verify-cache.json
.drift/findings/
.drift/gap-reports/
```

Do not ignore `.drift/` as a whole: that would drop the policy teammates and CI need.

## By command

"Cache" means `.drift/cache/` (or where `DRIFT_CACHE_DIR` points); `--no-cache` turns it off and the command then writes nothing there.

| Command | Creates or changes |
| --- | --- |
| `drift scan` | The cache. `--out FILE` writes the fact index to FILE. |
| `drift facts` | The cache. |
| `drift init` | `.drift/conventions.yaml` (created, or merged keeping every decision), `drift.lock` (baseline on first run; new baselines for newly mined conventions later), the cache. |
| `drift census` | The cache in text mode. With `--json` or `--coverage`: nothing, unless `DRIFT_CACHE_DIR` is set. |
| `drift setup` | `.drift/config.yaml`, only when an answer, `--forget`, `--confirm` or `--reject` changes it. Listing, asking and `--json` write nothing; the repository is read without the cache unless `DRIFT_CACHE_DIR` is set. |
| `drift investigate` | Listing, `--json` and `--agent-brief` write nothing (the cache is used as for `drift security`). `--record` and `--answers` write `.drift/config.yaml` (a record under `setup:`, or an agent's proposal under `setup.proposed`; `reachable` also adds a `security.public` entry), and for a finding `.drift/findings/`, for a gap report `.drift/gap-reports/`. |
| `drift findings` | Nothing, except: `--issue ID --write FILE` writes FILE, and `--branch ID` creates a local git branch `drift/<id>` (a commit object and a branch ref; `HEAD`, the index and the working tree are not touched). |
| `drift review` | `.drift/conventions.yaml` on every decision; `drift.lock` when a card is promoted from the withheld ones (its current outliers are baselined) or a practice is promoted (its units that differ are baselined); `.drift/review-log/` when the log is on (`--set-log on`) or `--log` is given; the file named by `--export-log`. |
| `drift example`, `drift check`, `drift security` | The cache. (`example` and `check` need `.drift/conventions.yaml`.) |
| `drift card` | The cache and the derived-results directory, but only when the repository has `.drift/conventions.yaml` (or `DRIFT_CACHE_DIR` is set); otherwise nothing. |
| `drift map`, `drift practices` | Nothing, unless `DRIFT_CACHE_DIR` is set. |
| `drift practices promote` | `.drift/conventions.yaml` (one accepted convention added, or updated under the same id when promoted again) and `drift.lock` (one line per unit that differs today). With `--dry-run` or `--list`, or when it refuses: nothing. |
| `drift hook claude ...` | Session state under `.drift/cache/sessions/` and the cache, only in a repository that has `.drift/conventions.yaml`. In one without, SessionStart builds a brief and writes nothing. |
| `drift mcp` | The cache. `drift_setup_answer` and `drift_investigate_record` write `.drift/config.yaml` (the second also `.drift/findings/` and `.drift/gap-reports/`); `drift_verify_card` (experimental) writes `.drift/verify-cache.json`. |
| `drift export agents-md --write FILE` | FILE: created, or only the text between the `drift:start` and `drift:end` markers replaced. Without `--write`, nothing. |
| `drift export claude-settings --write FILE` | FILE: created, or merged into (other settings kept, keys sorted). Without `--write`, nothing. |

## `.drift/`

```text
.drift/
  conventions.yaml        commit
  config.yaml             commit
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
  verify-cache.json       ignore (experimental verifier only)
```

### `.drift/cache/`

| Entry | Holds | Rebuilt when |
| --- | --- | --- |
| `.gitignore` | `# Created by drift: the fact cache is local.` and `*`. Written once, only if nothing is there, and left alone afterwards. | |
| `facts-v<N>/<parser>/<xx>/<hash>.json` | Parsed facts per file, keyed by facts schema `N` (11 in this build), parser tag (`ts-l72-0.1.0-dev`: language, lowering version, Drift version) and the file's content hash. Entries are immutable. | A file's content, the facts schema, a lowering version or the Drift version changes: a new key, so old entries are simply not read. |
| `index-v<N>-<M>/`, `index-py-v<N>-<M>/` | An index of file stamps (size, times, inode) for TypeScript/JavaScript and Python, so later scans read only the files that changed, and a hook can check one edited file without a full scan. | Its version (`M`) or the facts schema changes. |
| `derived-v1/` | Results derived from a scan (mined conventions, the practice map), kept between runs and keyed by the facts, the Drift version and build, and the `DRIFT_*` variables set. | The facts, the build or those variables change. |
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

### `.drift/verify-cache.json`

Written only with `agents.verify: on` in `.drift/conventions.yaml` (experimental, off by default): the verdicts of the agent verifier, keyed by convention and card content. No `.gitignore` is created for it.

## `drift.lock`

Written by `drift init`, by promoting a withheld card in `drift review`, and by promoting a practice (`drift practices promote`, or the practices step of `drift review`). Never by agents: the hooks deny writes to it, and `drift check` only reads it. Entries that no longer apply are listed as `fixed` in `drift check --format json` and can be removed by hand. See [Configuration Reference](Configuration-Reference) for the format.

## Branches and merges

All three committed files are text and are ordinary merge candidates. `drift.lock` is one sorted line per entry, so `merge=union` is safe for it; `.drift/conventions.yaml` and `.drift/config.yaml` are YAML and conflict like any YAML. After a merge, run `drift check` to see where the combined state stands.

See also: [Configuration Reference](Configuration-Reference), [Command Reference](Command-Reference), [Hooks Reference](Hooks-Reference), [Security and Privacy](Security-and-Privacy), [Team Rollout](Team-Rollout), [Troubleshooting](Troubleshooting)
