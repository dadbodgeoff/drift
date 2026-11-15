# Command Reference

Every `drift` subcommand and every flag, with what it prints and the exit codes it returns. This page is for anyone running Drift by hand, in a script or in CI. The flag tables are generated from `drift --help` and `drift <command> --help` of the build this wiki describes (`drift 0.1.0-dev`); run `drift <command> --help` on your own build for the authoritative text.

## Synopsis

```bash
drift [--root <ROOT>] [--no-cache] <command> [options]
```

| Global option | Meaning | Default |
| --- | --- | --- |
| `--root <ROOT>` | Repository root. Accepted before or after the subcommand. | `.` |
| `--no-cache` | Disable the on-disk fact cache: nothing is read from or written to `.drift/cache/`. | cache on |
| `-h`, `--help` | Print help (`-h` a summary, `--help` the long text, for commands that have one). | |
| `-V`, `--version` | Print the version (`drift 0.1.0-dev` for this build). | |

`drift help <command>` is the same as `drift <command> --help`.

## Commands at a glance

| Command | Purpose | Writes |
| --- | --- | --- |
| [`scan`](#drift-scan) | Index the repository; print a summary or the full fact index | cache; `--out FILE` |
| [`facts`](#drift-facts) | Print the facts for one file | cache |
| [`init`](#drift-init) | Learn conventions; write proposals and the baseline | `.drift/conventions.yaml`, `drift.lock`, cache |
| [`census`](#drift-census) | Preview what `init` would propose, with evidence | cache (text mode) |
| [`setup`](#drift-setup) | Answer the questions only a person can answer | `.drift/config.yaml` |
| [`investigate`](#drift-investigate) | Every route Drift could not settle, with the evidence; record outcomes | `.drift/config.yaml`, `.drift/findings/`, `.drift/gap-reports/` (only with `--record` or `--answers`) |
| [`findings`](#drift-findings) | What an agent found: local findings and gap reports; an issue draft or a local branch | `--write FILE`; a local branch `drift/<id>` (`--branch`) |
| [`review`](#drift-review) | Accept, block, advise, reject; exceptions; review log | `.drift/conventions.yaml`, `.drift/review-log/` |
| [`example`](#drift-example) | The file to copy for a new file | cache |
| [`check`](#drift-check) | Check code against accepted conventions | cache |
| [`security`](#drift-security) | Security inventory | cache |
| [`card`](#drift-card) | One file's place in the repository | cache (with a policy) |
| [`map`](#drift-map) | Packages, layers, dependencies, roles | nothing |
| [`practices`](#drift-practices) | What the codebase does for each concern | nothing |
| [`hook`](#drift-hook) | Agent hook handler (run by Claude Code) | session state |
| [`mcp`](#drift-mcp) | MCP server over standard input and output | cache; `drift_setup_answer` and `drift_investigate_record` write `.drift/config.yaml`, `.drift/findings/` and `.drift/gap-reports/` (and the experimental `drift_verify_card`, `.drift/verify-cache.json`) |
| [`export`](#drift-export) | Agents block, Claude Code permissions | the file you name |

The full list of files and when each is written is in [Files Drift Writes](Files-Drift-Writes).

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. For `security`, `practices`, `map`, `card`, `census` and `hook`, always 0 unless there is an error. |
| 1 | `drift check`: a new violation that fails (see [`check`](#drift-check)). `drift setup`: one of several answers in a run could not be applied. |
| 2 | Error: a message beginning `drift:` on standard error. Also a command-line usage error (an unknown subcommand or flag, a missing argument). |

Reading from a pipe that closes early (`drift census | head`) is not an error: Drift exits quietly with the code it had decided (for `check`, the check's).

## Standard output and standard error

Reports go to standard output. Progress summaries (`scan`), notes (a relearned vocabulary, a wiring feature that is off, config warnings) and errors go to standard error, so `--json` output can be piped without filtering.

## Running from a subdirectory

`check`, `review`, `example` and `export`, run without `--root` in a directory that has no `.drift/conventions.yaml`, use the nearest one in a parent directory; file arguments you gave relative to the working directory still name the same files. With `--root`, or with a policy in the current directory, nothing changes.

## drift scan

Parses every source file and prints a summary of what was found, or, with `--json`, the full fact index. It reads the working tree and fills the fact cache; it learns and checks nothing.

```text
drift scan [OPTIONS]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--json` | Print the full fact index as JSON to stdout instead of the summary |  |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--out <OUT>` | Write the fact index as JSON to this file |  |
| `--threads <THREADS>` | Worker threads (0 = one per CPU) | `0` |

**Examples**

```bash
drift scan
```
```bash
drift scan --json > facts.json
```

**Output**

The summary goes to standard error: files scanned and the time, cache hits, parse errors, files skipped, symbols, entry points and imports (in-repo and unresolved). Standard output stays empty unless you pass `--json`, which prints the fact index (a JSON object with `schema_version`, `files`, `skipped`, `packages` and, where present, models and lint settings; see [Output and JSON Reference](Output-and-JSON-Reference)). `--out FILE` writes the same JSON to a file and still prints the summary.

**Exit codes**

0 on success, 2 on error.

**Notes**

Writes the fact cache under `.drift/cache/` unless you pass `--no-cache`. `--threads 0` uses one worker per CPU.

## drift facts

Prints the facts Drift recorded for one file, as indented JSON.

```text
drift facts [OPTIONS] <FILE>
```

| Argument | Meaning |
| --- | --- |
| `<FILE>` | Repo-relative path of the file |

| Option | Meaning | Default |
| --- | --- | --- |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |

**Examples**

```bash
drift facts app/api/orders/route.ts
```

**Output**

One JSON object: the file's path, content hash, language, package, symbols with their wrappers and calls, imports, entry points and so on. This is the same record `drift scan --json` holds for that file.

**Exit codes**

0 on success. 2 if the file was not scanned (not a source file, ignored by `.gitignore`, or skipped for size, generation or depth) or was not parsed for lack of stack.

**Notes**

The path is repo-relative; a leading `./` is accepted.

## drift init

Mines the repository's conventions and writes them as proposals to `.drift/conventions.yaml`, with a baseline of legacy violations in `drift.lock`. Re-running keeps every decision and id and adds new proposals.

```text
drift init [OPTIONS]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--max <MAX>` | Maximum conventions proposed | `15` |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--refresh-kinds` | Relearn the file-kind vocabulary frozen in the conventions file (to adopt new kinds after an upgrade). Existing conventions keep their ids, but the files their roles cover may change |  |
| `--suggestions <N>` | Suggestions to list, best first (default 5, or `suggestion_cap` in .drift/conventions.yaml). The default tier is always listed in full |  |
| `--all` | List every suggestion |  |

**Examples**

```bash
drift init
```
```bash
drift init --max 30
```

**Output**

A summary on standard output: how many conventions were learned and in which tier, notes about proposals withheld by the show policy, per-package lines in a monorepo, the files written (`Wrote .drift/conventions.yaml`, `Wrote drift.lock (N legacy violations baselined)`), the default tier in full and the best suggestions, and a pointer to `drift review`. It ends with a tip to add `drift.lock merge=union` to `.gitattributes` (it does not edit that file) and, where the practice map knows recipes, a note about them. In a repository with nothing to learn it says why (`No conventions found: ...`) and still writes both files.

On a re-run, decisions already in the file (accepted, rejected, mode, `agents: show`, exceptions) are kept. New proposals get their current violations baselined; existing lock entries are kept.

**Exit codes**

0 on success. 2 on error, including: files that could not be parsed for lack of thread stack (nothing is written, because conventions learned without them would be wrong), a `.drift/conventions.yaml` written by a newer Drift, an unreadable `.drift/config.yaml`, and a symbolic link in the way of a file it would write.

**Notes**

With `--refresh-kinds`, the file-kind vocabulary frozen in `conventions.yaml` is relearned; existing conventions keep their ids but the files their roles cover may change, so run `drift check` afterwards. Wiring conventions are dropped when the experimental `wiring` feature is off.

## drift census

Shows the conventions Drift would propose, with their evidence, without changing `.drift/conventions.yaml` or `drift.lock`. The default tier (conventions a person may set to block) is listed first, then suggestions.

```text
drift census [OPTIONS]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--max <MAX>` | Maximum conventions shown | `15` |
| `--root <ROOT>` | Repository root | `.` |
| `--all-outliers` | Show every outlier instead of the first three |  |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--json` | Print the proposals as JSON (every outlier included). Writes no files |  |
| `--tier <TIER>` | Only list proposals of this tier (ranks stay those of the full list). Values: `default`: Default-tier conventions only (those a person may set to block); `suggestion`: Suggestions only (advice; blocking one needs `drift review --block <id> --force`); `all`: Both tiers | `all` |
| `--candidate <CANDIDATE>` | With --json: also give each proposal the tier a pre-registered candidate decision would give it (`candidate`). Study use only: the tier, blocking and advice of every convention stay those of the shipped tier. Values: `d8`: Decision D8, pre-registered and not adopted (`eval/study/tier-d8-candidate.json`): D7 for TypeScript/JavaScript; Python call wrappers whose every alternative is a guard, and layering, with in-repo targets, in roles of 50 or more members |  |
| `--python-proposals` | Propose Python conventions whatever `proposals.python` in .drift/config.yaml says. They are on by default since decision D13-py was closed, so this changes a census only where a person turned them off (`proposals: {python: off}`). For the study's view; writes nothing |  |
| `--test-roles` | Also form and mine test roles (selector version 4), as `test_roles` in the config's `experimental` list does: off by default. For the study; writes nothing |  |
| `--kind-roles` | Also form and mine kind roles (selector version 4): roles of one structural kind (components, hooks, pydantic models, routers, ...) across the repository, as `kind_roles` in the config's `experimental` list does: off by default. For the study; writes nothing |  |
| `--coverage` | How much of the repository Drift maps: the seven coverage measures (parsed, in a package, in a structural role, imports resolved, entry points, under a mined and under a shown convention), the production and test maps apart, a table per package and the unmapped files by reason. With --json, as JSON. Writes nothing |  |
| `--suggestions <N>` | Suggestions to list, best first (default 5, or `suggestion_cap` in .drift/conventions.yaml). The default tier is always listed in full |  |
| `--all` | List every suggestion |  |

**Examples**

```bash
drift census
```
```bash
drift census --tier default --all-outliers
```
```bash
drift census --json > census.json
```
```bash
drift census --coverage
```

**Output**

Text: a header (`N conventions from M units in K roles`), notes for block candidates and withheld cards, then each proposal with its id, summary, evidence (`holders/total`, lower bound and lift), tier, whether agents are shown it, an example to copy and its outliers (the first three unless `--all-outliers`). It ends with `Preview only: nothing was written.` The default shows the default tier and the best five suggestions (`--suggestions N`, `--all`, or `suggestion_cap` in `.drift/conventions.yaml`).

`--json`: one JSON object (`schema: 1`), with every outlier of every proposal; see [Output and JSON Reference](Output-and-JSON-Reference). It writes no files and uses the fact cache only where `DRIFT_CACHE_DIR` points.

`--coverage`: how much of the repository Drift maps (seven measures, production and test apart, a table per package, the unmapped files by reason); with `--json`, the same as JSON. It writes nothing.

**Exit codes**

0 on success, 2 on error.

**Notes**

Text mode (without `--json` or `--coverage`) reads and fills the fact cache like `scan`. `--candidate`, `--python-proposals`, `--test-roles` and `--kind-roles` are for Drift's own study; they change what is shown, never what is written.

## drift setup

Asks the few questions only a person can answer (which compose files are test stacks, which Terraform target group sends requests to a service, whether a helper is your check) and writes the answers to `.drift/config.yaml`. Without a terminal it lists the questions with the command that answers each.

```text
drift setup [OPTIONS]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--list` | Print the open questions, each with the command that answers it, and change nothing |  |
| `--root <ROOT>` | Repository root | `.` |
| `--json` | Print the open questions as JSON (schema `drift-setup-questions`) and change nothing |  |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--answer <ID=ANSWER>...` | Answer a question: ID=ANSWER, as `--list` prints them (several: repeat it, or give several pairs; all in one run). `skip` changes nothing |  |
| `--answers <FILE>` | Answer several questions in one run from a JSON file (`-` for standard input): a list of `{"id", "answer", "reason", "evidence": ["file:line"]}` |  |
| `--forget <ID>` | Take out what the answer to ID wrote, so the question is asked again |  |
| `--all` | Ask (or list) every question again, the answered ones too |  |
| `--interactive` | Ask on standard input even when it is not a terminal (a person's run: with `--by person` and DRIFT_SETUP_PERSON=1 when standard input is not a terminal) |  |
| `--by <person\|agent>` | Who answers: `person` (the default when standard input is a terminal) or `agent` (the default otherwise). An agent's answer takes effect only where it can make Drift more cautious; any other waits for a person (`--review`). Without a terminal, `person` writes only with DRIFT_SETUP_PERSON=1, set by the person who runs the script. A person's word is typed at a terminal: `--confirm`, `--reject`, `--review` (the first id once, then `y` for each) and a person's answer that makes a fact ask for the id on `/dev/tty`, never standard input. Without `--by`, a run is an agent's where `CLAUDECODE` is set or `DRIFT_AGENT=1`, on a terminal too; agents set `DRIFT_AGENT=1`. A script a person runs sets `DRIFT_SETUP_PERSON=1`, and `DRIFT_SETUP_PERSON_NONINTERACTIVE=1` to skip typing ids; both are for scripts a person runs, and an agent never sets them. A terminal is weak evidence of a person and no command-line tool can prove one: every confirmation is recorded (`confirmed_by` in `.drift/config.yaml`), so the review of the committed diff is the final check. |  |
| `--reason <REASON>` | Why the answer is right, naming what was read: required of an agent |  |
| `--evidence [<FILE:LINE>...]` | With --answer: `file:line` of each place read to decide (repeat for more). With --json: give each question the excerpts a careful reader looks at |  |
| `--review` | For a person: each answer an agent gave that waits, with its reason; confirm, reject or skip it |  |
| `--confirm <ID>` | For a person: confirm the agent's answer to ID (repeat for more) |  |
| `--reject <ID>` | For a person: reject the agent's answer to ID; it is not asked again on the same evidence (repeat for more) |  |
| `--agent-brief` | Print the instructions an agent follows to answer the questions (Markdown), and change nothing |  |

**Examples**

```bash
drift setup
```
```bash
drift setup --list
```
```bash
drift setup --answer S-abf5=tests-only
```
```bash
drift setup --forget S-abf5
```

**Output**

- In a terminal, one question at a time; Enter skips. Skip is always the default and writes nothing.
- `--list`: the open questions, each with its choices and the command that answers it; `Nothing to ask: Drift has no question only you can answer.` when there are none.
- `--json`: the same as JSON (schema `drift-setup-questions`, version 1; see [Output and JSON Reference](Output-and-JSON-Reference)). With `--evidence`, each question also carries the excerpts a careful reader looks at.
- `--answer`, `--answers`, `--forget`: one line per question (`S-abf5: ...`).
- `--review`, `--confirm`, `--reject`: for a person, an agent's waiting answers.
- `--agent-brief`: Markdown instructions for an agent; changes nothing.

An answer by an agent (`--by agent`, which is the default when standard input is not a terminal) takes effect only where it can make Drift more cautious; any other waits for a person. Agent answers require `--reason`.

**Exit codes**

0 on success. With several answers in one run (`--answer` repeated, or `--answers FILE`), 1 if any of them failed (each failure is printed on standard error as `drift: ID: not answered: ...`); the others are still applied. 2 on any other error, including a single answer that cannot be applied, `--review`, `--confirm`, `--reject` or an interactive run with `--by agent`, and an answer by an agent to a question a person already answered.

**Notes**

`drift setup` reads the repository without filling the fact cache. It writes only `.drift/config.yaml`; each answer adds a line under `security.not_deployed`, `security.terraform`, `security.internal` or `practices.<concern>`, and a record under `setup:` (see [Configuration Reference](Configuration-Reference)).

## drift investigate

Lists every route Drift could not settle (authentication or authorization `unknown` or `none`, reach `unknown` or `internal`), grouped by what would settle it, with the evidence to read; and records the outcome an agent or a person reached for each. An outcome that would make a fact waits for a person (`drift setup --review`). For the workflow, see [Investigating open routes](Using-Drift-with-Agents#investigating-open-routes).

```text
drift investigate [OPTIONS]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--list` | Print the open items, each with the command that records an outcome, and change nothing | the default |
| `--root <ROOT>` | Repository root | `.` |
| `--json` | Print the items as JSON (schema `drift-investigate`) and change nothing |  |
| `--limit N`, `--offset M` | With `--json`: one short page of the list instead (schema `drift-investigate-page`: each item's `id`, `kind`, `concern`, `status`, a one-line `what`, `route_count` and `setup`, with `total`, `offset`, `limit` and `next_offset`); `--limit` 1 to 200 |  |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--all` | List every item, the settled ones too |  |
| `--item <ID>` | Only these items (with `--json`; repeat for more) |  |
| `--record <ID=OUTCOME>...` | Record an outcome: ID=OUTCOME, as `--list` prints them (several: repeat it) |  |
| `--answers <FILE>` | Record several outcomes in one run from a JSON file (`-` for standard input): a list of `{"id", "outcome", "reason", "evidence": ["file:line"], ...}` |  |
| `--by <person\|agent>` | Who records: `person` (the default when standard input is a terminal) or `agent` (the default otherwise) |  |
| `--reason <REASON>` | Why, naming what was read: required of an agent (for a finding: why it is a gap; for a skip: the note the person reads) |  |
| `--evidence [<FILE:LINE>...]` | With `--record`: `file:line` of each place read (repeat for more). With `--json`: give each item the excerpts a careful reader looks at |  |
| `--title <TITLE>` | A finding's title |  |
| `--fix <FIX>` | A finding's suggested fix, in words |  |
| `--patch <FILE>` | A finding's patch: a unified diff file the agent wrote (not applied) |  |
| `--agent-brief` | Print the instructions an agent follows to work through the items (Markdown), and change nothing |  |

**Outcomes** (what follows `ID=`):

| Outcome | Takes effect | Meaning |
| --- | --- | --- |
| `guard:<file>#<symbol>` | a proposal | The function is the guard that turns away callers who are not signed in, on every path. |
| `check:<tenant\|owner\|role>:<file>#<symbol>` | a proposal | The function is a tenant, owner or role check on every path. |
| `internal` | a proposal | The routes are reachable only from inside, where Drift cannot tell. |
| `not-a-guard`, `not-a-check` | at once | Drift's reading stands; an unknown never becomes `none`. |
| `reachable` | at once | The routes are reachable from outside. |
| `finding` | at once | A real gap in the code: a local finding in `.drift/findings/`. Takes `--title`, `--reason`, `--fix`, `--evidence` and optionally `--patch`. |
| `drift-gap` | at once | A construct Drift does not read: a local gap report in `.drift/gap-reports/`. Takes `files`, `expect`, `replace` and `reason` from an `--answers` file. |
| `skip` | at once | Nothing changes; the note given with it is kept for the person. |

**Examples**

```bash
drift investigate
```
```bash
drift investigate --json --evidence --item I-1a2b3c
```
```bash
drift investigate --record I-1a2b3c=not-a-check --reason "reads no comparison" --evidence app/svc.py:40
```
```bash
drift investigate --record I-1a2b3c=finding --title "Admin route open" --reason "..." --fix "..." --evidence app/svc.py:40 --patch fix.diff
```
```bash
drift investigate --answers outcomes.json
```
```bash
drift investigate --agent-brief
```

**Output**

- The default and `--list`: `N items Drift could not settle, covering M routes (open, waiting for a person, skipped with a note, settled)`, then per item its id, kind (`reach`, `nothing found`, `not read`, `a check not proven`; in JSON `exposure`, `nothing_found`, `unread`, `check`), concern, the routes it would settle with their handler's `file:line`, and the command that records an outcome. `Nothing open: ...` when there is none.
- `--json`: schema `drift-investigate`, version 1: `items` (each with `id`, `kind`, `concern`, `status`, `what`, `not_read`, `routes`, `route_count`, `outcomes`, `how_to_decide`, `command`, `evidence`, and with `--evidence` a `context`), and the counts `open`, `waiting`, `skipped`, `settled`, `routes`. See [Output and JSON Reference](Output-and-JSON-Reference). Item ids are `I-` and six hex digits, stable for what the item is about.
- `--record`, `--answers`: one line per item (`I-1a2b3c: ...`), then `N answers by an agent wait for a person` when proposals wait. A finding prints `F-...` and its path; a gap report prints `G-...`, its directory and what Drift says of the example now.
- `--agent-brief`: Markdown instructions for an agent; changes nothing.

An outcome by an agent (`--by agent`, the default when standard input is not a terminal) requires `--reason` and follows the trust rule of [Setup Questions](Setup-Questions#the-trust-rule): where it could only keep or raise caution it takes effect, otherwise it waits for a person. An agent's outcome is refused where a person's record stands for the item. `--by person` writes only in a terminal, or with `DRIFT_SETUP_PERSON=1` for that run.

**Exit codes**

0 on success. With several outcomes in one run (`--record` repeated, or `--answers FILE`), 1 if any failed (each failure is printed on standard error as `drift: ID: not recorded: ...`); the others are still recorded. 2 on any other error, including a single outcome that cannot be recorded and a `--patch` file that cannot be read.

**Notes**

`--patch FILE` reads the file's text and attaches it to every `--record` of that run. In an `--answers` file the `patch` field is the diff text itself, not a file name (see [Using Drift with Agents](Using-Drift-with-Agents#investigating-open-routes)). The listing does not write anything. Recording writes `.drift/config.yaml` (a record under `setup:`, as `drift setup` does) and, for a finding or a gap report, the files described under [`drift findings`](#drift-findings). Nothing is posted or sent.

## drift findings

Lists what an agent found while investigating: local findings (`.drift/findings/`) and gap reports (`.drift/gap-reports/`), both git-ignored and never posted. On a person's request, prints an issue draft or makes a local branch with the agent's patch.

```text
drift findings [OPTIONS]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--json` | Print them as JSON (schema `drift-findings`) |  |
| `--root <ROOT>` | Repository root | `.` |
| `--issue <ID>` | Print an issue draft (Markdown) for finding ID; nothing is posted |  |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--write <FILE>` | With `--issue`: write the draft to this new file instead: never under `.drift/`, to `drift.lock`, or through a symbolic link (the file, or a directory from the repository down) |  |
| `--force` | With `--issue --write`: replace an existing file. A person's flag: the plugin's hook denies it to agents |  |
| `--branch <ID>` | Make a local branch `drift/<id>` with the patch of finding ID, without touching the working tree; nothing is pushed. A patch that changes `.drift/` or `drift.lock` is refused, as is recording such a finding |  |

**Examples**

```bash
drift findings
```
```bash
drift findings --issue F-1a2b3c --write issue.md
```
```bash
drift findings --branch F-1a2b3c
```

**Output**

- The default: each finding (`F-...`, concern, route count, who and when, title, the path of its `.md` file, and the commands for an issue draft and, with a patch, a branch), then the gap reports (`G-...`). `No finding in .drift/findings.` when there is none.
- `--json`: schema `drift-findings`, version 1: `findings` (each `drift-finding`: `id`, `item`, `seen`, `title`, `concern`, `drift_said`, `routes`, `why`, `fix`, `excerpts`, `evidence`, `patch` when there is one, `by`, `on`) and `gap_reports` (each `drift-gap-report`: `id`, `item`, `seen`, `drift_said`, `expect`, `why`, `files`, `says`, `drift`, `by`, `on`).
- `--issue`: the draft in Markdown (title, where, what is wrong, the code, a suggested fix), or with `--write FILE` one line saying where it went. Nothing is posted.
- `--branch`: one line naming the branch (`drift/` and the lower-case id, for example `drift/f-1a2b3c`) and the commit.

**Exit codes**

0 on success. 2 on error: an unknown id, a finding with no patch, a patch that does not apply to `HEAD`, or a branch that already exists.

**Notes**

`--branch` builds a commit with the patch on `HEAD` through a throwaway index and points a new branch at it. `HEAD`, the current branch, the index and the working tree stay as they are, nothing is pushed, and Drift does not replace an existing branch. It is the one command that creates a git branch, and only when a person asks. Findings and gap reports are written by `drift investigate`; each directory holds its own `.gitignore` of `*`, and a link in place of the directory is refused. A gap report holds the repository's names replaced by neutral ones; Drift refuses one where a marked name remains. Nothing is sent to anyone: if a person decides to share a finding or a gap report, that is a deliberate act of theirs.

## drift review

Accepts, blocks, sets to advise, or rejects conventions, interactively or by id; lists and shows cards; records exceptions; answers a block candidate's one question; manages the local review log.

```text
drift review [OPTIONS]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--accept <ACCEPT>` | Accept these convention ids (comma-separated) in advise mode |  |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--reject <REJECT>` | Reject these convention ids (comma-separated) |  |
| `--block <BLOCK>` | Accept these and set them to block (default-tier conventions; see --force) |  |
| `--force` | With --block: also block suggestion-tier conventions. Roles with fewer than 15 members never block |  |
| `--advise <ADVISE>` | Set these to advise, keeping them accepted: the way back from --block. A proposed or rejected convention is accepted in advise mode |  |
| `--show-to-agents <SHOW_TO_AGENTS>` | Accept these (keeping their mode) and show them to agents whatever their rule family's track record (`agents: show` in conventions.yaml). Accepting alone shows agents only the default tier and suggestions of an admitted family |  |
| `--list` | Print the cards interactive review would ask about, each with its outliers, and change nothing |  |
| `--show <IDS>` | Print these cards (any status) with their outliers, and change nothing |  |
| `--all-outliers` | List every outlier on each card, not the first 5 |  |
| `--exempt <ID>` | Mark an outlier of convention ID as a legitimate exception ("fine because…"): with --member and --reason. `drift check`, the hooks and CI then list it as exempt instead of as a violation; nothing else about the convention changes |  |
| `--unexempt <ID>` | Remove the exception of --member from convention ID |  |
| `--member <PATH#SYMBOL>` | With --exempt or --unexempt: the member, as path#symbol (`drift review --show <id>` prints it for each outlier) |  |
| `--reason <TEXT>` | With --exempt: why the member is fine, in one line of at most 120 characters (agents see it) |  |
| `--log` | Record this run's decisions and the cards it shows in the review log (`.drift/review-log/`, local only: nothing is ever sent), even when `review_log` is off in .drift/conventions.yaml |  |
| `--set-log <on\|off>` | Turn the review log on or off for every later `drift review` and the Studio (`review_log: on` in .drift/conventions.yaml; off unless set) Values: on, off. |  |
| `--export-log <PATH>` | Write the review log as a study file to PATH, for `eval/study/maintainer-log.mjs`. Convention ids, members and examples are replaced by hashes keyed with this repository's random salt, and reasons by their length, unless --include-paths |  |
| `--include-paths` | With --export-log: keep convention ids, members (path#symbol), examples and reasons as they are |  |
| `--shown <IDS>` | Only record in the review log that these cards were shown (the Studio does when it opens one); changes nothing, and records nothing while the log is off |  |
| `--json` | Print, as JSON, the one question each block candidate asks ("Are these the same kind of thing?"): the convention, its holders and the members it would flag, by file. Changes nothing |  |
| `--answer <ID=ANSWER>` | Answer a block candidate's question: ID=same (accept it), ID=different (accept it with --set-apart's files exempt as a different kind) or ID=not-a-convention (reject it). Unanswered, a candidate stays one: no agent is shown it as a convention |  |
| `--set-apart <PATHS>` | With --answer ID=different: the files (comma-separated) whose flagged members are a different kind of thing, as `--json` lists them. `drift check` exempts their members from this convention, by path |  |
| `--confirm-entry <PATH#SYMBOL>` | With --set-apart: an entry point under an auth or validation rule (path#symbol, comma-separated) to set apart too. Without it such an entry point stays flagged |  |
| `--hidden` | List the cards mining found and withheld (the show policy, or Python proposals off), with their evidence and why each was withheld. No agent is shown one as a convention (`drift card <file>` states the strong ones as facts about the code, not rules). Changes nothing. With --answer ID=same\|different\|not-a-convention a person promotes one: written to .drift/conventions.yaml as accepted by them (`promoted_from_hidden: true`; not-a-convention rejects it), after which it follows the normal tier and agent rules. With --json, each card's question |  |
| `--suggestions <N>` | Suggestions to list, best first (default 5, or `suggestion_cap` in .drift/conventions.yaml). The default tier is always listed in full |  |
| `--all` | List every suggestion |  |

**Examples**

```bash
drift review
```
```bash
drift review --accept D-e0a68b
```
```bash
drift review --block D-e0a68b
```
```bash
drift review --exempt D-e0a68b --member app/api/ping/route.ts#GET --reason "health check, public by design"
```
```bash
drift review --answer D-e0a68b=different --set-apart lib/seed.ts
```

**Output**

Interactive (no flags): needs a terminal. Keys: `y` accept, `b` block, `a` accept and show to agents, `n` reject, `s` skip, `q` quit; a block candidate asks one question instead: `y` yes, `d` no, these are different, `n` not a convention. It shows the default tier, then the five best suggestions (`--suggestions N`, `--all`).

With flags: each decision prints a one-line summary on standard output, `N accepted (M block), P proposed, R rejected`, and the ids you gave must exist or nothing is changed. `--list` and `--show` print cards with their outliers. `--json` prints each block candidate's question as JSON (schema `drift-review-questions`).

A decision flag (`--accept`, `--reject`, `--block`, `--advise`, `--show-to-agents`) cannot be combined with `--list`, `--show`, `--exempt`, `--unexempt`, `--set-log`, `--export-log`, `--shown`, `--json` or `--answer`; each of those goes alone, and the command refuses with nothing changed.

**Exit codes**

0 on success. 2 on error, including: no `.drift/conventions.yaml` (run `drift init` first), an unknown convention id, a suggestion given to `--block` without `--force`, an id given to both `--advise` and `--block` or `--reject`, and running interactively without a terminal.

**Notes**

Edits `.drift/conventions.yaml` (and `drift.lock` when a card is promoted from the withheld ones with `--hidden --answer`, which baselines its current outliers). A convention whose role has fewer than 15 members, or an experimental wiring rule, set to block is accepted as advise instead, with a note on standard error; a suggestion needs `--force` to block. `--log` and `--set-log` write `.drift/review-log/`; `--export-log PATH` writes the file you name. Commit `.drift/conventions.yaml` afterwards.

## drift example

Names the existing file to copy when writing a new file like FILE, with the accepted conventions it is the example of.

```text
drift example [OPTIONS] <FILE>
```

| Argument | Meaning |
| --- | --- |
| `<FILE>` | Repo-relative path of the file to write; it need not exist yet |

| Option | Meaning | Default |
| --- | --- | --- |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |

**Examples**

```bash
drift example app/api/new-thing/route.ts
```

**Output**

One line per example: `path#symbol  ([id] summary; [id] summary)`. For a file that is not there yet and no content, the examples are grouped by what the file will declare (`if it exports HTTP handlers:`). `no learned role covers FILE` when no accepted convention applies; then, when the file has entry points whose siblings share a guard, a `to copy:` line with the file `drift card FILE` names (same package and language), marked as a fact about the code, not a rule.

**Exit codes**

0 on success, 2 on error (for example no `.drift/conventions.yaml`).

**Notes**

Shows only what agents are shown: accepted conventions of the default tier, suggestions whose family is admitted or that a person chose to show, and conventions set to block. Run without `--root` in a subdirectory that has no `.drift/conventions.yaml`, it uses the nearest one above.

## drift check

Checks the code against accepted conventions and reports new violations. Legacy violations baselined in `drift.lock` never fail.

```text
drift check [OPTIONS] [FILES]...
```

| Argument | Meaning |
| --- | --- |
| `[FILES]...` | Only report these files (repo-relative) |

| Option | Meaning | Default |
| --- | --- | --- |
| `--format <FORMAT>` | Output format. Values: `text`; `json`; `sarif`: SARIF 2.1.0, for GitHub code scanning and IDEs (new violations only); `github`: GitHub Actions annotations (new violations only), plus a job summary when GITHUB_STEP_SUMMARY is set | `text` |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--strict` | Fail on any new violation, not only those in block mode, and when a file could not be checked (not parsed for lack of stack, in the tree or at the merge base); by default that fails open, with the files named |  |
| `--diff-base <REF>` | Report only violations introduced since the merge base with REF (a pull request's base branch, e.g. origin/main): in changed lines and added files. The merge base must be in the local history: in a shallow clone that lacks it this is an error (use `fetch-depth: 0` in CI; the GitHub Action deepens the clone itself) |  |
| `--include-hidden` | Kept for scripts; changes nothing. Text output always lists violations of accepted conventions agents are not shown, marked `not shown to agents` (JSON, SARIF and `--format github` list them too, with `conventions[].agents`) |  |

**Examples**

```bash
drift check
```
```bash
drift check --diff-base origin/main
```
```bash
drift check --strict
```
```bash
drift check --format sarif > drift.sarif
```
```bash
drift check app/api/orders/route.ts
```

**Output**

Text (default): `drift: N new violation(s) (M legacy, baselined)`, then per violation the convention id and summary with its evidence, `at path:line symbol`, a file to copy (`like`), and its mode; a closing line on how to fix it, make an intentional exception or reject a wrong convention. After the violations, under their own heading, the practice map's departures for the files looked at (facts, never part of the exit code). Violations of accepted conventions agents are not shown are listed too, marked `not shown to agents` on their mode line; the legacy count includes theirs.

`--format json`: `violations`, `fixed`, `conventions`, and `practices` and `diff` when present; see [Output and JSON Reference](Output-and-JSON-Reference). `--format sarif`: SARIF 2.1.0 (new violations only; blocking rules at level `error`, other advice at `warning`, suggestions at `note`; members a convention is not about are listed as notes; unchecked files, unsure findings and practice departures are run notifications, not results). `--format github`: GitHub Actions annotations for new violations (`::error` for block mode, `::warning` for advice, `::notice` for suggestions), `::warning` for files not checked, `::notice` for unsure findings, exempt members and practice departures, a final summary line, and a job summary appended to the file `GITHUB_STEP_SUMMARY` names when that variable is set.

With `--diff-base REF`, only violations introduced since the merge base with REF are reported (in changed lines and added files), and a header says how many files the diff added, changed and deleted. The merge base must be in the local history: in a shallow clone that lacks it, this is an error (use `fetch-depth: 0`).

With `--diff-base`, the practice facts also list the entry points the diff adds (an entry point the merge base does not have, by file, symbol, method and route; where the base cannot be read, an added file or a hunk that adds more lines than it removes) whose authentication is none, identified or unknown (JSON `practices.added`).

**Exit codes**

| Code | Meaning |
| --- | --- |
| 0 | No new violation that fails. Advice, legacy violations, practice departures and files that could not be checked (without `--strict`) do not fail. |
| 1 | A new violation of a convention in block mode (`mode block` as checked: a role of fewer than 15 members advises whatever the file says), or, with `--strict`, any new violation, and any file that could not be checked (not parsed for lack of stack, in the tree or at the merge base). Wiring advice never fails, even with `--strict`. |
| 2 | Error: no `.drift/conventions.yaml`, an unreadable policy, a path outside the repository, `--diff-base` outside a git work tree or with a ref Git cannot find, or a command-line usage error. |

**Notes**

Intentional exception: `// drift-ignore <id>: <reason>` directly above the declaration (`#` in Python); a comment without a reason suppresses nothing. In SARIF and GitHub output, paths are from the git top level when `--root` is a subdirectory. Run without `--root` in a directory with no `.drift/conventions.yaml`, it uses the nearest one above and makes the file arguments absolute.

## drift security

Prints the security inventory: entry points and their guards, risky operations they reach, client code reaching server code or secrets, and environment reads. Facts for a reader to judge, not rules; it never fails a check.

```text
drift security [OPTIONS] [FILES]...
```

| Argument | Meaning |
| --- | --- |
| `[FILES]...` | Only report these files (repo-relative) |

| Option | Meaning | Default |
| --- | --- | --- |
| `--json` | Print the full inventory as JSON (FILES does not filter it) |  |
| `--root <ROOT>` | Repository root | `.` |
| `--diff-base <REF>` | Report only what the change since the merge base with this ref introduces: entry points lacking a guard their siblings share, unguarded entry points reaching a risky operation, risky operations and client leaks added, and entry points made internet-facing. Facts for a pull request; exit 0 |  |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--github` | With --diff-base: GitHub Actions output (notice annotations, and a job summary when GITHUB_STEP_SUMMARY is set) |  |
| `--max <MAX>` | Rows shown per section in text output (entry points with no wrapper or decorator: always the first 50; exceptions per shared guard: the first 10) | `20` |

**Examples**

```bash
drift security
```
```bash
drift security app/api/export/route.ts
```
```bash
drift security --json
```
```bash
drift security --diff-base origin/main --github
```

**Output**

Text: a summary line (entry points, how many have no guard, how many have a guard that cannot be read, how many reach a risky operation, risky operations, client leaks, env reads), the guards most entry points of a kind share with the members lacking them and a file to copy, the entry points with no guard, those whose guard cannot be read, and a closing `Not covered:` line. Rows per section are capped at `--max` (default 20; entry points with no wrapper or decorator always show the first 50; exceptions per shared guard the first 10).

`--json`: the full inventory (`FILES` does not filter it); see [Output and JSON Reference](Output-and-JSON-Reference).

`--diff-base REF`: only what the change since the merge base introduces: entry points lacking a guard their siblings share, unguarded entry points reaching a risky operation, risky operations and client leaks added, entry points made internet-facing. With `--json` the payload is `guard_gaps`, `unguarded_reaching`, `sinks`, `leaks`, `now_public`, `added_without_guard` and `diff`; with `--github`, notice annotations plus a job summary when `GITHUB_STEP_SUMMARY` is set.

With `--diff-base`, a section 'New entry points where Drift found no guard, or cannot tell' (JSON `added_without_guard`) lists added handlers in changed files whose guard is none or unknown; routes already listed under a shared guard, and routes the practice map knows are open on purpose (probes, `AllowAny`, webhook signatures), are left out.

**Exit codes**

0 on success, including when it lists findings. 2 on error (for example `--diff-base` outside a git work tree or with a ref Git cannot find).

**Notes**

`--github` is only used with `--diff-base`. Reads `.drift/config.yaml` (`security:`) and the deployment descriptions it recognises; see [Security Inventory](Security-Inventory).

## drift card

One file's place in the repository, for an agent about to touch it: package, entry points with their guards and exposure, risky operations, what its siblings of the same kind carry (and one to copy from), the accepted conventions covering it, what nearly all the code of its kind in its place does where no convention says so, and what Drift does not know. The file need not exist yet.

```text
drift card [OPTIONS] <PATH>
```

| Argument | Meaning |
| --- | --- |
| `<PATH>` | Repo-relative path of the file (existing or planned) |

| Option | Meaning | Default |
| --- | --- | --- |
| `--json` | Print the card as JSON (schema 1), with every convention covering the file, accepted or proposed, with its status and mode, and its `regularities` |  |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |

**Examples**

```bash
drift card app/api/orders/route.ts
```
```bash
drift card app/api/new-thing/route.ts --json
```

**Output**

Text: the file's package and language, its entry points (`GET /api/new [http] GET: no wrapper or decorator; exposure unknown`), sibling counts with a file to copy, the accepted conventions that cover it, `Practices here` (facts, not rules), and a last line `Not known: ...`. The file to copy in 'the package mostly' is always in the card file's package and language; when there is none, the card says 'no <lang> example of it in this package to copy'. A file Drift cannot answer for says `No answer for this file` (it has no entry points, risky operations, siblings, accepted conventions, strong regularities or copied helpers).

The card also states what nearly all the code of the file's kind in its place does where no convention says so (`Regularities here`: mined facts held by at least 80% of a role of 8 or more members, never checked, also for a file with no entry point). One a person accepted is listed under `Accepted conventions here` instead: `drift check` checks it, and it is shown to agents as a rule only after `drift review --show-to-agents <id>`. For a file with entry points it gives the logger, config read, data access and covering tests of its handlers, each marked `(preview)`. Last, it names the functions the file defines that other files define too (`Defined elsewhere too`), with each other copy's path and line: a change to one copy does not reach the rest. The recipe an agent gets before writing a new entry-point file adds, marked `(preview)`, what at least 60% of the package does for logging, config and data access and where the tests of such entry points live.

`--json`: the card as JSON (`schema: 1`) with every convention covering the file, accepted or proposed, with its status and mode, and its `regularities`; see [Output and JSON Reference](Output-and-JSON-Reference).

**Exit codes**

0 on success, 2 on error (a path outside the repository, or the repository root).

**Notes**

Fills the fact cache and a derived-results cache only when the repository has a `.drift/conventions.yaml` (or where `DRIFT_CACHE_DIR` points); otherwise it writes nothing.

## drift map

Describes the repository's structure: packages, layers, the package dependency graph, entry points and structural roles; or, for one file, its package, layer, roles and typical peers; or one role and its typical members. Read-only: no convention is mined or written.

```text
drift map [OPTIONS]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--file <FILE>` | Describe one file (repo-relative): its package, layer and roles |  |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--package <PACKAGE>` | Describe one package (its directory, `.` for the root package) |  |
| `--role <ROLE>` | Describe one role by id (`R-xxxxxx`, from the overview or --file) |  |
| `--json` | Print the JSON |  |
| `--max <MAX>` | Roles listed in the overview | `25` |

**Examples**

```bash
drift map
```
```bash
drift map --file apps/web/lib/auth.ts
```
```bash
drift map --package apps/web
```
```bash
drift map --role R-1a2b3c
```

**Output**

Text: the repository's package count and files, each package with its layers and entry points, and the largest roles (`R-xxxxxx`, with member counts). `--json` prints the same as JSON (`schema: 1`, with `scope`, `files`, `files_in_a_role`, `test_roles`, `packages` and `roles`). `--package .` names the root package. `--role` takes an id from the overview or from `--file`.

**Exit codes**

0 on success, 2 on error (a package or role that is not in the map, a file outside the repository).

**Notes**

Writes nothing; the fact cache is used only where `DRIFT_CACHE_DIR` points. A few further `map` options exist for Drift's own study and are hidden from `--help`; they are not part of the supported interface.

## drift practices

Reports what the codebase does for each cross-cutting concern (authentication, authorization, errors, logging, API, validation, config, data access, testing): each variant with its share, where it is, what sets it apart, an example to copy, and what is unknown. Facts, not rules: read-only.

```text
drift practices [OPTIONS]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--concern <CONCERN>` | Only this concern (`authn`, `authz`, `errors`, `logging`, `api`, `validation`, `config`, `data_access`, `testing`) |  |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--package <PACKAGE>` | Only this package (its directory, `.` for the root package) |  |
| `--path <PATH>` | Only the units of this file (repo-relative) |  |
| `--json` | Print the JSON (version 1) |  |
| `--all` | Every concern's variant table, every variant (the default text is the recipe per kind of entry point and the findings) |  |
| `--units` | With --json: every unit of each concern with its assignment (variant, none, or unknown and why), for measurement |  |
| `--hints` | Only the `.drift/config.yaml` lines that would classify what Drift cannot tell alone (an in-repo logger, a wrapper it cannot read), as one block to merge by hand, with the units each line settles. A line for an instrument a `drift setup` or `drift investigate` answer said is not a check or guard (`no`, `not-a-check`, `not-a-guard`) is left out, with a `# left out: … answered not a check by <id>` line, and so is a check or guard an agent proposed that a person rejected (`# left out: … rejected by a person in <id>`); `drift setup --forget <id>` brings either back; under `testing`, only a test library's or a test file's instruments are offered |  |

**Examples**

```bash
drift practices
```
```bash
drift practices --all
```
```bash
drift practices --concern authn --all
```
```bash
drift practices --package apps/web --json
```
```bash
drift practices --hints
```

**Output**

Default text: the findings, then the recipe per package and kind of entry point (`authn`, `authz`, `validation`, `errors`, `api`; `logging`, `config`, `data_access` and `testing` are a preview and appear in a recipe only where at least 60% of the package does the same). `--all`: every concern's variant table. `--json`: the report (`version: 1`); `--units` adds, per concern, every unit with its assignment. `--hints`: only the `.drift/config.yaml` lines that would classify what Drift cannot tell alone, as one block to merge by hand, each with the units it settles.

An answer is one of three things: a variant (`known`), `none` (a recorded absence), or `unknown` with a reason. Unknown units are counted against coverage, never hidden.

**Exit codes**

0 on success (always, whatever it finds); 2 on error (`no concern ...`, `no package ...`, a path outside the repository).

**Notes**

Writes nothing; the fact cache is used only where `DRIFT_CACHE_DIR` points. Warnings about `practices:` lines in `.drift/config.yaml` (an unknown concern, a line that names nothing in the repository) go to standard error. Valid `--concern` values: `authn`, `authz`, `errors`, `logging`, `api`, `validation`, `config`, `data_access`, `testing`.

## drift hook

The agent hook handler. Claude Code runs it (see [Hooks Reference](Hooks-Reference)); there is nothing to call by hand. It reads the hook event JSON on standard input and answers with JSON on standard output, or nothing.

```text
drift hook [OPTIONS] <AGENT> <EVENT>
```

| Argument | Meaning |
| --- | --- |
| `<AGENT>` | [possible values: claude] |
| `<EVENT>` | Hook event name: SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop or SessionEnd |

| Option | Meaning | Default |
| --- | --- | --- |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |

**Examples**

```bash
echo '{"session_id":"try","hook_event_name":"SessionStart","source":"startup"}' | drift hook claude SessionStart
```

**Output**

JSON on standard output (`hookSpecificOutput`, `systemMessage` or, at the end of a turn, `decision: block`), or nothing. See [Hooks Reference](Hooks-Reference) for what each event says.

**Exit codes**

0 for every event, including after an internal error: a failure is reported as a `systemMessage` (`drift: hook error, skipped (...)`) and never blocks the agent. A command-line usage error (a missing argument) is 2.

**Notes**

The agent argument is `claude`. An event name Drift does not handle gets no output. With `DRIFT_HOOK_TRACE=<file>` set, each hook appends one JSON line (event, path taken, whether it answered, milliseconds).

## drift mcp

Serves Drift's tools to an MCP client over standard input and output (JSON-RPC 2.0, one message per line). See [MCP Reference](MCP-Reference).

```text
drift mcp [OPTIONS]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |

**Examples**

```bash
claude mcp add drift -- drift mcp
```
```bash
claude mcp add --scope project drift -- drift mcp
```

**Output**

JSON-RPC replies on standard output, one per line; nothing else is written there. Other clients use `{"mcpServers": {"drift": {"command": "drift", "args": ["mcp"]}}}`, adding `"--root", "/path/to/repo"` to the arguments when the client does not start the server in the repository.

**Exit codes**

0 when standard input closes. 2 if an error ends the server.

**Notes**

The server serves 12 tools. Ten only read (the eight lookups, `drift_setup_questions` and `drift_investigate_items`); `drift_setup_answer` and `drift_investigate_record` write `.drift/config.yaml` (the second also `.drift/findings/` and `.drift/gap-reports/`); a thirteenth, the experimental `drift_verify_card`, writes `.drift/verify-cache.json` and is listed only with the verifier on. `drift mcp --help` lists the same split. See [MCP Reference](MCP-Reference).

## drift export

Exports accepted conventions for agents: a generated block for AGENTS.md or CLAUDE.md, or Claude Code permission entries.

```text
drift export [OPTIONS] <WHAT>
```

| Argument | Meaning |
| --- | --- |
| `<WHAT>` | . Values: `agents-md`: A generated block for AGENTS.md or CLAUDE.md; `claude-settings`: Claude Code permission entries (`.claude/settings.json`) that let Drift's read-only lookups run without a prompt |

| Option | Meaning | Default |
| --- | --- | --- |
| `--root <ROOT>` | Repository root | `.` |
| `--write <WRITE>` | File to update in place (between drift markers); prints to stdout when omitted |  |
| `--no-cache` | Disable the on-disk fact cache |  |

**Examples**

```bash
drift export agents-md
```
```bash
drift export agents-md --write AGENTS.md
```
```bash
drift export claude-settings --write .claude/settings.json
```

**Output**

`agents-md`: a block between `<!-- drift:start ... -->` and `<!-- drift:end -->` markers: rules (the default tier and anything set to block) and suggestions, at most 10 in all, each with its evidence (`N/M follow it`), whether it blocks, and an example; then a paragraph pointing to `drift setup --agent-brief` and `drift investigate --agent-brief`, and the rule to run `drift card` before searching. Without `--write` it prints the block; with `--write FILE` it creates the file or replaces only the text between the markers, and prints `created FILE` or `updated FILE`.

`claude-settings`: JSON for `permissions.allow` (`Bash(drift card:*)`, `Bash(drift map:*)`, `Bash(drift example:*)`, `Bash(drift check:*)`, `Bash(drift practices:*)` and the ten read-only MCP tools as `mcp__drift__<tool>`: the eight lookups, `drift_setup_questions` and `drift_investigate_items`), all under `permissions.allow`. With `--write FILE` it merges them into the file, keeping other settings and writing keys sorted.

**Exit codes**

0 on success, 2 on error (for example `--write` to a file that is not a JSON object for `claude-settings`, or through a symbolic link that leaves the repository).

**Notes**

Re-run `agents-md` after `drift review`; only the text between the markers changes. `agents-md` shows what agents are shown.

## Commands not in the list

`drift debug` exists and is hidden from `--help`; it prints parser debugging output for Drift's development and is not a supported interface. `drift practices promote` is not a subcommand of this build (it fails with `unexpected argument 'promote'`); a practice cannot yet be turned into a checked convention, so the practice map advises and never blocks.

See also: [Configuration Reference](Configuration-Reference), [Output and JSON Reference](Output-and-JSON-Reference), [MCP Reference](MCP-Reference), [Hooks Reference](Hooks-Reference), [Files Drift Writes](Files-Drift-Writes), [Glossary](Glossary)
