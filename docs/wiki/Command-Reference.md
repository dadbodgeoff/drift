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
| [`setup`](#drift-setup) | The guided first run (each proposal, the deployed compose file, the security baseline, the agent integrations, each asked once); the questions only a person can answer | `.drift/config.yaml`; in the guided flow, what a person says yes to (`.drift/conventions.yaml`, `drift.lock`, `.drift/security.lock`, the AGENTS.md block, `.claude/settings.json`) |
| [`investigate`](#drift-investigate) | Every route Drift could not settle, with the evidence; record outcomes | `.drift/config.yaml`, `.drift/findings/`, `.drift/gap-reports/` (only with `--record` or `--answers`) |
| [`findings`](#drift-findings) | What an agent found: local findings and gap reports; an issue draft or a local branch | `--write FILE`; a local branch `drift/<id>` (`--branch`) |
| [`review`](#drift-review) | Accept, block, advise, reject; exceptions; promote a practice; review log | `.drift/conventions.yaml`, `drift.lock` (when it promotes), `.drift/review-log/` |
| [`example`](#drift-example) | The file to copy for a new file | cache |
| [`check`](#drift-check) | Check code against accepted conventions | cache |
| [`security`](#drift-security) | Security inventory | cache |
| [`card`](#drift-card) | One file's place in the repository | cache (with a policy) |
| [`map`](#drift-map) | Packages, layers, dependencies, roles | nothing |
| [`practices`](#drift-practices) | What the codebase does for each concern | nothing |
| [`practices promote`](#drift-practices-promote) | Turn a practice into an accepted convention for one place | `.drift/conventions.yaml`, `drift.lock` (nothing with `--dry-run` or `--list`) |
| [`feedback`](#drift-feedback) | Beta feedback: mark a report true or wrong; write a file of counts you can read and choose to share | `.drift/feedback/` (or `--out FILE`); sends nothing |
| [`hook`](#drift-hook) | Agent hook handler (run by Claude Code) | session state |
| [`mcp`](#drift-mcp) | MCP server over standard input and output | cache; `drift_setup_answer` and `drift_investigate_record` write `.drift/config.yaml`, `.drift/findings/` and `.drift/gap-reports/` (and the experimental `drift_verify_card`, `.drift/verify-cache.json`) |
| [`export`](#drift-export) | Agents block, Claude Code permissions | the file you name |
| [`upgrade`](#drift-upgrade) | After installing a newer Drift: what it reads differently in the files an older one wrote; with `--apply`, only what changes no decision a person made | nothing; with `--apply`, `drift.lock`, `.claude/settings.json`, and `.drift/security.lock` with `--security-baseline` |

The full list of files and when each is written is in [Files Drift Writes](Files-Drift-Writes).

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. For `practices`, `map`, `card`, `census` and `hook`, always 0 unless there is an error; for `security`, unless `--fail-on` or `--ratchet` fails it. |
| 1 | `drift check`: a new violation that fails, or a security finding that is not in the committed baseline (see [`check`](#drift-check)). `drift security`: with `--diff-base` and `--fail-on`, the change introduces a kind named; with `--ratchet`, a finding was added (see [`security`](#drift-security)). `drift setup` and `drift investigate`: one of several answers or outcomes in a run could not be applied. `drift upgrade --apply`: a write failed. |
| 2 | Error: a message beginning `drift:` on standard error. Also a command-line usage error (an unknown subcommand or flag, a missing argument). `drift practices promote` also exits 2 when it refuses, with the reason on standard error and nothing written. |
| 3 | Something still needs doing. `drift upgrade`: the newer Drift reads something differently and the report lists what to do (see [`upgrade`](#drift-upgrade)). `drift setup --yes-to`/`--no-to` (the guided flow from a script): an answer it was given was not recorded, so a script does not take the run for done. |
| 141 | Standard output was a pipe that closed early (`drift census \| head`). Not an error: Drift stops quietly with 141 (128 + SIGPIPE, as a shell reports for `yes \| head`), so `set -o pipefail` sees it. `drift check` decides its code before it writes anything and exits with that instead, so blocking violations still fail when the reader goes away. |

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
| `--suggestions <N>` | Suggestions to list, best first (default 5, or `suggestion_cap` in .drift/conventions.yaml). The default tier is always listed in full (this cap never hides a default-tier proposal; mining's own caps can, see `drift census`) |  |
| `--all` | List every suggestion |  |
| `--explain` | After the summary, print the long account: what the show policy kept back and why, a line per package in a monorepo, and what the practice map offers agents |  |
| `--no-from-map` | Write no proposals from the map (the practices and layering the map shows, which did not go through the miner's measured gates). Proposals from the map that nobody decided are removed from the file; what a person decided is kept |  |

**Examples**

```bash
drift init
```
```bash
drift init --explain
```
```bash
drift init --max 30
```

**Output**

One screen on standard output, in this order:

1. What was read (`Drift read N files of ... in N packages. Nothing left this machine.`).
2. `What the code does`: the practice map's three largest kinds of entry point, each with how its members sign a caller in, check permissions, handle errors, answer and validate, as counts that add up to the total. Printed whether or not anything is proposed; left out where the map knows no entry point.
3. `Worth a look first`: at most five of the map's findings, the costliest first, and how many more `drift practices` has.
4. `From the security inventory (what Drift read; not conventions, and nothing here is checked)`: the first few security findings to look at, in the order of `drift security --top`, each with what Drift read and what it did not. Left out where there is nothing to show. See [`drift security`](#drift-security).
5. `Conventions`: how many are proposed and in which tier, how many weaker candidates were kept back, in a monorepo how many packages they are in, then the default tier in full and the best suggestions. With nothing to propose it says why (`No conventions found: ...`, or `No conventions shown: ...` when every candidate was kept back). On a re-run it says how many earlier decisions were kept and how many proposals are still to decide.
6. `From the map (not mined: these did not go through the miner's measured gates; each advises only once you accept it)`: the proposals from the map, each with its id, what it says, how many units Drift could read there follow it and how many differ, and how many it could not read (`could not be read (never reported)`). Where a mined rule says the same, a line `the same rule read two ways: ...` names it. Then `Proposed in advise mode: nothing is checked and no agent is told of one until you accept it (`drift review`).` and `Also seen, not proposed: N (`drift census --from-map` lists each, with why).` Left out with `--no-from-map`, or when the map has nothing to offer. See [Proposals from the map](Conventions-and-Review#proposals-from-the-map).
7. The files written: `Wrote .drift/conventions.yaml and drift.lock (N existing violations recorded, so only new ones are reported)`.
8. `Next`: one line per command that has something to do here (`drift review`, `drift review --hidden`, `drift setup`, `drift practices --hints`, `drift practices`, `drift security`, `drift init --explain`), each with what it is for. Left out when there is nothing to do.
9. A tip to add `drift.lock merge=union` to `.gitattributes` (it does not edit that file).

`--explain` prints the same screen and then, under `Explained`, the long account: which default-tier proposals wait for a person before agents see them, which mined cards the show policy withheld and why, a line per package in a monorepo, what the practice map offers agents, and the steps to promote a withheld card.

On a re-run, decisions already in the file (accepted, rejected, mode, `agents: show`, exceptions) are kept. Only a convention new to the policy has its current violations baselined. An existing convention is never baselined again, even once all its old violations are fixed, so a violation of it added since is reported, not recorded. Existing lock entries are kept and gain their fingerprint line (see [Files Drift Writes](Files-Drift-Writes#driftlock)). When a rule gained an alternative and so its id changed, the new id comes in as a proposal with the old one's exceptions and a copy of its lock entries; the old card keeps its decision until you decide the new one.

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
| `--listed` | Mine over every entry point Drift lists, not only those the last measured build listed: the routes `drift security` and the practice map read become members of the roles conventions are mined for. A preview of the next measured round: the precision of what it proposes was not measured, and nothing is written |  |
| `--suggestions <N>` | Suggestions to list, best first (default 5, or `suggestion_cap` in .drift/conventions.yaml). The default tier is always listed in full (this cap never hides a default-tier proposal; mining's caps can, and the text then says so) |  |
| `--all` | List every suggestion |  |
| `--why [GATE]` | List what each gate of mining dropped instead of the proposals: how many per gate, then the candidates (role, rule, holders of members, the gate's threshold and the candidate's value, whether the target is the repository's or a dependency's), strongest first. `--why GATE` (`universal`, `wilson`, `lift`, `cap_avoid`, ...): only that gate. With --json, every dropped candidate. Observation only: what is proposed is exactly what `census` proposes. Not with `--coverage` |  |
| `--from-map` | Also list the proposals from the map (practices and layering the map shows, not mined) and what qualified but is not proposed, with why. With --json, as `from_map`. Writes nothing. Not with `--coverage` or `--why` |  |

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
```bash
drift census --why              # what each gate of mining dropped, and why
drift census --why wilson       # only the rules below the lower bound
```
```bash
drift census --from-map         # also what drift init would propose from the map
```

**Output**

Text: a header (`N conventions from M units in K roles`), notes for block candidates and withheld cards, then each proposal with its id, summary, evidence (`holders/total`, lower bound and lift), tier, whether agents are shown it, an example to copy and its outliers (the first three unless `--all-outliers`). It ends with `Preview only: nothing was written.` The default shows the default tier and the best five suggestions (`--suggestions N`, `--all`, or `suggestion_cap` in `.drift/conventions.yaml`).

`--json`: one JSON object (`schema: 1`), with every outlier of every proposal; see [Output and JSON Reference](Output-and-JSON-Reference). It writes no files and uses the fact cache only where `DRIFT_CACHE_DIR` points.

`--coverage`: how much of the repository Drift maps (seven measures, production and test apart, a table per package, the unmapped files by reason); with `--json`, the same as JSON. It writes nothing.

When mining's caps cut default-tier rules, the text says so: `N default-tier rule(s) was not proposed because of mining's caps (...)`, naming how many fell to the cap of 5 per role, to the layering share (at most a quarter of `--max` layering rules per repository) and to the cap of `--max` per repository. `drift census --why` lists them.

`--why`: what mining dropped, gate by gate. It opens:

```text
What mining dropped, gate by gate. Observation only: nothing listed here is proposed, checked or shown to agents, and the proposals are exactly those of `drift census`.
```

Then how far candidates got (`R roles, M of them with 8 or more members across files; N candidate rules observed, D drafted, K mined, P proposed.`), the count dropped per gate in the order mining applies them, each with where its threshold comes from, and then each gate's candidates:

```text
wilson: <n> dropped. Passes: a lower bound of at least 0.75: with one outlier, a role of 19 or more members. Threshold: MIN_LOWER_BOUND = 0.75 (95% Wilson lower bound of holders / members) (engineering, no study; docs/v2/PLAN.md:148; TIER-ADMISSION.md finds the bound does not predict precision).
  <holders> of <members>  <role>: <rule> (<detail>; target defined in the repository; default tier)
```

At most 10 candidates are listed per gate, or 50 with a gate named; the rest are counted (`and N more (`drift census --why <gate> --json` lists every one)`). Where a threshold comes from is one of: `study` (set by a measured study), `pre-registered`, `engineering, no study`, `engineering, rationale written but not measured`. An unknown gate is an error that lists the gate names. `--why --json`: see [Output and JSON Reference](Output-and-JSON-Reference#drift-census---why---json). [How Drift Works](How-Drift-Works) lists the gates.

`--from-map`: after the proposals, the section `drift init` prints under `From the map (not mined: ...)`, then `Also seen, not proposed: N` and one line per practice or layer the map shows that is not proposed: `[<id>] <summary>: not proposed: <why>`. The reasons, in their JSON codes: `passive` (it accepts what code does by doing nothing), `preview_concern` (a concern the map only previews), `python_off` (Python proposals are off), `overlaps` (a stronger proposal of the same concern holds an overlapping place), `same_as_mined` (the miner already proposes it), `not_shown` (the show policy does not show its family) and `over_cap` (more than are proposed at once). With `--json`, the same under `from_map`; see [Output and JSON Reference](Output-and-JSON-Reference#drift-census---from-map---json).

**Exit codes**

0 on success, 2 on error.

**Notes**

Text mode (without `--json` or `--coverage`) reads and fills the fact cache like `scan`. `--candidate`, `--python-proposals`, `--test-roles` and `--kind-roles` are for Drift's own study; they change what is shown, never what is written. A hidden flag for the same study, `--gate-candidate <NAME>` (repeatable: `universal`, `small-roles`, `cap-show-aware`, `cap-after-narrow`, `narrow-recheck`, `avoid-cap-own`), runs a candidate change to one of mining's gates for that census only: each proposal only a candidate makes carries its name (`gate_candidate`) and advises only where it adds a rule. Nothing is written, and no other command reads it.

## drift setup

Two things. `drift setup` alone is the **guided flow** for a person's first run: what Drift read, then each decision asked once, in this order: the proposals one at a time (mined conventions as `drift review` asks them, then the practices and layering from the map), which compose file is deployed (only where the compose files of one service disagree about how exposed its routes are), the security baseline, and the agent integrations Drift writes itself (the AGENTS.md block and the Claude Code permission entries). Nothing is accepted or written without a yes; Enter skips and writes nothing; a no is recorded so it is not asked again, and every rule accepted here advises. It ends with what was decided and written, the command that changes each decision later, and the command to run in CI. Without a terminal and without `--yes-to`/`--no-to`, or in an agent's run, it prints every question with the flag that answers it and changes nothing.

With any other flag it works on the **questions only a person can answer** (which compose files are test stacks, which Terraform target group sends requests to a service, whether a helper is your check) and writes the answers to `.drift/config.yaml`: one at a time with `--interactive`, listed with `--list`. `--yes-to`, `--no-to` and `--guided` do not combine with those flags (exit 2, nothing changed).

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
| `--yes-to <KEYS>` | The guided flow, from a script: say yes to KEYS (comma-separated or repeated): a proposal's id, a compose question's id (yes: only for tests), `baseline`, `agents-md` or `claude-settings`. A person's run (`--by person`, and `DRIFT_SETUP_PERSON=1` without a terminal) |  |
| `--no-to <KEYS>` | The guided flow, from a script: say no to KEYS (recorded, not asked again). What neither `--yes-to` nor `--no-to` names is skipped. A key in both is refused |  |
| `--guided` | The guided flow, asking on standard input even when it is not a terminal (a person's run: with `--by person` and `DRIFT_SETUP_PERSON=1`) |  |
| `--no-from-map` | The guided flow asks about no proposal from the map, and the `drift init` it runs writes none, as `drift init --no-from-map`. Setting the environment variable `DRIFT_NO_FROM_MAP` to anything but empty or `0` does the same |  |

**Examples**

```bash
drift setup
```
```bash
drift setup --by person --yes-to D-1a2b3c,baseline --no-to agents-md
```
```bash
drift setup --interactive
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

- `drift setup` in a terminal (or with `--guided`): the guided flow, one decision at a time; Enter skips. Skip is always the default and writes nothing. Without a terminal, or in an agent's run: each decision with the flag that answers it, and nothing written.
- `--yes-to`, `--no-to`: the same flow answered from the keys given; a key that is asked about nothing now is listed as not used, and an answer that could not be recorded is listed with why.
- `--interactive`: the questions only a person can answer, one at a time.
- `--list`: the open questions, each with its choices and the command that answers it; `Nothing to ask: Drift has no question only you can answer.` when there are none.
- `--json`: the same as JSON (schema `drift-setup-questions`, version 1; see [Output and JSON Reference](Output-and-JSON-Reference)). With `--evidence`, each question also carries the excerpts a careful reader looks at.
- `--answer`, `--answers`, `--forget`: one line per question (`S-abf5: ...`).
- `--review`, `--confirm`, `--reject`: for a person, an agent's waiting answers.
- `--agent-brief`: Markdown instructions for an agent; changes nothing.

An answer by an agent (`--by agent`, which is the default when standard input is not a terminal) takes effect only where it can make Drift more cautious; any other waits for a person. Agent answers require `--reason`.

**Exit codes**

0 on success. The guided flow from a script (`--yes-to`, `--no-to`): 3 when an answer it was given was not recorded (the run says which and why), so a script does not take it for done. With several answers in one run (`--answer` repeated, or `--answers FILE`), 1 if any of them failed (each failure is printed on standard error as `drift: ID: not answered: ...`); the others are still applied. 2 on any other error, including a single answer that cannot be applied, `--review`, `--confirm`, `--reject` or an interactive run with `--by agent`, and an answer by an agent to a question a person already answered.

**Notes**

The guided flow records each decision with the code the single commands use: `drift init` (run first where there is no `.drift/conventions.yaml`), `drift review`'s accept and reject, the answers of `drift setup --answer`, `drift security --write-baseline` and `drift export`. It is for a person: an agent's run (`CLAUDECODE` set, or `DRIFT_AGENT=1`) asks nothing and writes nothing.

The questions (every flag but the guided flow's) read the repository without filling the fact cache. They write only `.drift/config.yaml`; each answer adds a line under `security.not_deployed`, `security.terraform`, `security.internal` or `practices.<concern>`, and a record under `setup:` (see [Configuration Reference](Configuration-Reference)).

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
| `--by <person\|agent>` | Who records: `person` (the default when standard input is a terminal, unless `CLAUDECODE` is set or `DRIFT_AGENT=1`) or `agent` (the default otherwise) |  |
| `--reason <REASON>` | Why, naming what was read: required of an agent (for a finding: why it is a gap; for a skip: the note the person reads) |  |
| `--evidence [<FILE:LINE>...]` | With `--record`: `file:line` of each place read (repeat for more). With `--json`: give each item the excerpts a careful reader looks at |  |
| `--routes [<ROUTE>...]` | With `--record` of a finding: the routes it is about, of the item's (a part of the route or its handler's `file:line`; repeat for more). Without it, the routes whose files `--evidence` names; with neither, all the item's |  |
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

Interactive (no flags): needs a terminal. Keys: `y` accept, `b` block, `a` accept and show to agents, `n` reject, `s` skip, `q` quit; a block candidate asks one question instead: `y` yes, `d` no, these are different, `n` not a convention. It shows the default tier, then the five best suggestions (`--suggestions N`, `--all`). Then the proposals from the map, apart, under `N proposal(s) from the map (not mined). y = accept (advise), n = no (not asked again), s = skip, q = quit`; each card says `(from the map, not mined: it did not go through the miner's measured gates)`, and one that no longer qualifies as the code stands is left as proposed. Accepting a practice from the map writes it as `drift practices promote` would, with its lock lines (`accepted: <id>, advise (N recorded in drift.lock)`). After those it offers the practices that may be promoted ([`drift practices promote --list`](#drift-practices-promote)), each with its preview: `y` promote in advise mode, `b` promote in block mode (needs the replay), `n` no (remembered: not offered again), `s` skip, `q` quit. See [Conventions and Review](Conventions-and-Review#practices-that-may-be-promoted).

With flags: each decision prints a one-line summary on standard output, `N accepted (M block), P proposed, R rejected`, and the ids you gave must exist or nothing is changed. `--list` and `--show` print cards with their outliers; `--list` names the proposals from the map apart (`N proposal(s) from the map, not mined ...`, then `[<id>] <summary> (proposed, from the map: <kind>)`). `--accept`, `--block`, `--advise` or `--show-to-agents` on a practice proposed from the map first writes it as `drift practices promote` writes it, with its lock lines; it refuses, changing nothing, when one no longer qualifies or when a Python one is asked to block (a Python practice advises only). A layering proposal from the map is accepted as a mined one is. `--json` prints each block candidate's question as JSON (schema `drift-review-questions`).

A decision flag (`--accept`, `--reject`, `--block`, `--advise`, `--show-to-agents`) cannot be combined with `--list`, `--show`, `--exempt`, `--unexempt`, `--set-log`, `--export-log`, `--shown`, `--json` or `--answer`; each of those goes alone, and the command refuses with nothing changed.

**Exit codes**

0 on success. 2 on error, including: no `.drift/conventions.yaml` (run `drift init` first), an unknown convention id, a suggestion given to `--block` without `--force`, an id given to both `--advise` and `--block` or `--reject`, and running interactively without a terminal.

**Notes**

Edits `.drift/conventions.yaml` (and `drift.lock` when a card is promoted from the withheld ones with `--hidden --answer`, which baselines its current outliers, or when a practice is promoted in interactive review, which baselines the units that differ). A convention whose role has fewer than 15 members, or an experimental wiring rule, set to block is accepted as advise instead, with a note on standard error; a suggestion needs `--force` to block. `--log` and `--set-log` write `.drift/review-log/`; `--export-log PATH` writes the file you name. Commit `.drift/conventions.yaml` afterwards.

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

Checks the code against accepted conventions, mined ones and practices a person promoted, and reports new violations. Legacy violations baselined in `drift.lock` never fail.

Where the repository committed a security baseline (`.drift/security.lock`, written by `drift security --write-baseline`), a check of the whole tree or of a diff also lists the security findings that are not in it. It exits 1 on any of a kind the baseline sets to fail; a finding of `unscoped-key` only advises unless the baseline sets that kind to fail (text: a `Security baseline` section; `--format json`: `security`; `--format github`: one `::error` annotation each; SARIF: a result each, under a rule `drift-security/<kind>`). A check of named files reads no inventory. Where the repository has no baseline, `drift check --diff-base` lists what the change adds that a baseline would hold, under `Security advice: what this change adds (no security baseline; this does not fail the check)` (JSON `security_advice`). See [Security Inventory](Security-Inventory#the-baseline-what-is-there-is-accepted-what-is-added-is-seen).

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

Accepted mined rules have lines of their own too, and none of them changes the exit code. Each is printed only when it has something to say:

```text
drift: [<id>] <n> of <members> member(s) not checked: Drift could not read what decides the rule for them, and never reports what it cannot read (<holders> follow it)
  why  <reason> (<n>)
drift: [<id>] mined rule is stale: <why>, so it advises until a person looks: `drift review --advise <id>` keeps it as advice, `drift review --reject <id>` drops it
drift: [<id>] was block, now advise because <why>
```

At most three `why` lines are printed; the rest are counted (`+N more reasons: `drift check --format json` lists them all (`standing`)`). What "not checked" and "stale" mean is on [Conventions and Review](Conventions-and-Review#what-drift-check-could-not-tell).

After the list of new violations, under `drift: what each rule that reported a new violation rests on:`, each rule that reported one gets a block: `[<id>] <rule> (blocks|advises)`, then labelled lines. `source` says where the rule came from, one of `mined from the code, accepted by a person`, `mined, withheld from review, promoted by a person`, `promoted from the practice map by a person`, or `proposed by Drift from the practice map (not mined), accepted by a person` (the structure map, for layering; the package manifests). `evidence` sets what the person saw when they accepted it beside what this check read (`accepted at <holders> of <total>; today <holders> of <members>, <n> not checked`; the first half is left out where no accepted evidence was kept). `changed` says why it went stale or why it advises though the file says block, and `not checked` counts the members Drift could not read, never reported. A rule that blocks also gets `copy`, and per violation `here` (where, and what the unit does instead), `holds near it`, and `exception` (the `drift-ignore` comment and where it goes, or the `drift review --exempt` command a person runs). Every rule ends with `wrong rule` and the commands that demote or reject it. What is cut is counted (`+N more rule(s) with new violations not described here: `drift check --format json` has their `standing``). None of this changes a verdict or the exit code.

A practice departure whose place's way `drift practices promote` would take as the code stands ends with `; to make it the rule for new code there: `<command>``, the `drift practices promote` command for it. Agents are never given that command.

A violation of a promoted practice is listed like any other. Two more kinds of line are about promoted practices, and neither changes the exit code: a **stale** promoted practice (no unit of its place uses any of its ways any more, so it fires on nothing until a person looks at it), and the number of units of a promoted practice's place that were **not checked** because the practice map cannot tell what they do (they are never reported).

```
drift: 1 new violation(s) (2 legacy, baselined)
[D-d67d54] Sign-in in app/api: wrapped in withAuth (38/40)
  at   app/api/new/route.ts:1 GET
  like app/api/r00/route.ts#GET
  fix  handle sign-in the way the `like` example does
  mode advise (suggestion)
Advice: follow a convention where it fits the code; where it does not, no action is needed (no change, no comment). Wrong convention: `drift review --reject <id>`.
drift: practices (facts, not rules; they never fail the check): 2 file(s) do a concern differently from the entry points around them
  app/api/r38/route.ts: authn: 38 of the 40 other entry points in app/api use wrap withAuth [P-0f0acb]; here GET:1 does: none: no guard found in what Drift read (copy app/api/r00/route.ts:3 GET)
  app/api/r39/route.ts: authn: 38 of the 40 other entry points in app/api use wrap withAuth [P-0f0acb]; here GET:1 does: none: no guard found in what Drift read (copy app/api/r00/route.ts:3 GET)
```

`--format json`: `violations`, `fixed`, `conventions`, and `practices`, `diff`, `standing`, `security`, `security_advice`, `stale_practices` and `practices_not_checked` when present; see [Output and JSON Reference](Output-and-JSON-Reference). `--format sarif`: SARIF 2.1.0 (new violations only; blocking rules at level `error`, other advice at `warning`, suggestions at `note`; members a convention is not about are listed as notes; unchecked files, unsure findings and practice departures are run notifications, not results). `--format github`: GitHub Actions annotations for new violations (`::error` for block mode, `::warning` for advice, `::notice` for suggestions), `::warning` for files not checked, `::notice` for unsure findings, exempt members and practice departures, a final summary line, and a job summary appended to the file `GITHUB_STEP_SUMMARY` names when that variable is set. Each new violation's annotation also carries what its rule rests on: `Source:`, `Evidence:`, `Changed:` and `Not checked:` lines, and for one that blocks `Here:`, `Holds near it:`, `Exception: a person runs `...`` and `Wrong rule:`. The job summary has the same under `### What each rule rests on`. A practice departure's notice carries its promote command as in text. A stale promoted practice and a promoted practice with units not checked each get a `::notice` (titled `drift [<id>] stale` and `drift [<id>] not checked`). None of these changes the exit code. A departure's promote command is also in `--format json` (`practices.departures[].promote`).

With `--diff-base REF`, only violations introduced since the merge base with REF are reported (in changed lines and added files), and a header says how many files the diff added, changed and deleted. The merge base must be in the local history: in a shallow clone that lacks it, this is an error (use `fetch-depth: 0`).

With `--diff-base`, the practice facts also list the entry points the diff adds (an entry point the merge base does not have, by file, symbol, method and route; where the base cannot be read, an added file or a hunk that adds more lines than it removes) whose authentication is none, identified or unknown (JSON `practices.added`).

**Exit codes**

| Code | Meaning |
| --- | --- |
| 0 | No new violation that fails. Advice, legacy violations, practice departures, stale promoted practices and mined rules, members and units not checked, security advice, and files that could not be checked (without `--strict`) do not fail. |
| 1 | A new violation of a convention in block mode (`mode block` as checked: a role that had fewer than 15 members when it was mined, or a stale mined rule, advises whatever the file says), or, with `--strict`, any new violation, and any file that could not be checked (not parsed for lack of stack, in the tree or at the merge base). Wiring advice never fails, even with `--strict`. Also a security finding not in the security baseline, of a kind the baseline sets to fail. |
| 2 | Error: no `.drift/conventions.yaml`, an unreadable policy, a path outside the repository, `--diff-base` outside a git work tree or with a ref Git cannot find, or a command-line usage error. |

**Notes**

Intentional exception: `// drift-ignore <id>: <reason>` directly above the declaration (`#` in Python); a comment without a reason suppresses nothing. A violation that is about a whole file (a file's exports or directives, a layering import) takes the comment at the top of the file, and a layering violation also on the import's line or directly above it; see [Conventions and Review](Conventions-and-Review#drift-ignore-comments). In SARIF and GitHub output, paths are from the git top level when `--root` is a subdirectory. Run without `--root` in a directory with no `.drift/conventions.yaml`, it uses the nearest one above and makes the file arguments absolute.

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
| `--fail-on <KINDS>` | With --diff-base: exit 1 when the change introduces any of these, separated by commas: `unguarded-reaching`, `no-guard` (one whose guard cannot be read is listed apart as guard unknown and never counted), `guard-gap`, `risky`, `leak`, `public`, or `any`. With --ratchet: only these kinds fail (`unguarded-reaching`, `no-guard`, `guard-gap`, `scope-gap`, `no-authorization`, `unscoped-key`, `risky`, `whole-row`, `workflow`, `workflow-hardening`, `image-hardening`, `dependency`, `kubernetes`, `leak`, or `any`). With --write-baseline: the kinds named are set to fail. Off unless given |  |
| `--write-baseline` | Write the security baseline (`.drift/security.lock`): every finding of the inventory as it is now, keyed by handler and route, never by line, with the inventory version that wrote it. Commit it. Every kind fails `drift check` but `unscoped-key`, which advises; with --fail-on, the kinds named fail too (kept when the baseline is written again) |  |
| `--ratchet` | Report the findings that are not in the security baseline, and those of it that are gone, with no commit to compare with. Exits 1 when a finding was added (with `--fail-on`, only for the kinds named; without it, the kinds the baseline sets to fail) |  |
| `--max <MAX>` | Rows shown per section in text output (entry points with no wrapper or decorator: always the first 50; exceptions per shared guard: the first 10) | `20` |
| `--top [N]` | Only the findings to look at first, ranked by what Drift read (default 10; 0 for all), repeats through one operation on one line; then how many more, and what was not ranked and why (a guard Drift could not read is never ranked). With --json, the inventory gains `top`. Changes no exit code. Not with `--diff-base`, `--ratchet` or `--write-baseline` |  |

**Examples**

```bash
drift security
```
```bash
drift security --top        # the findings to look at first
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

`--top [N]`: under `Security findings to look at first (from the security inventory: what Drift read, in order; nothing here fails a check)`, the first N findings. A finding is one entry point reaching one risky operation, and it is ranked only where a value of the request reaches the operation, a remote caller reaches the entry point, and Drift read what guards it, whether there is a guard or not. Entry points that reach the same operation in the same way are one finding. Each gets three lines: what a caller can do and where (`A caller Drift found no guard for can ...`, `A caller who passes its guard can ...`, `A caller whose signature checks out can ...`), `Read: ...` (the guard, the path the value takes, the validation and exposure Drift read) and `Not read: ...` (always whether the value is checked before the operation, and whatever else Drift did not read). Then how many more are ranked, and `Not ranked: ...`, with how many and why: where Drift could not read the guard, where it read no request value reaching the operation, settings written in the code, started by a queue or a schedule, run locally, or in test or example code. When nothing ranks it says so in one line, with the same reasons. The order is fixed by what Drift read, not by names, so the same inventory always reads the same. `drift init` shows the first few under its own heading.

`--diff-base REF`: only what the change since the merge base introduces: entry points lacking a guard their siblings share, unguarded entry points reaching a risky operation, risky operations and client leaks added, entry points made internet-facing. With `--json` the payload is `guard_gaps`, `unguarded_reaching`, `sinks`, `leaks`, `now_public`, `added_without_guard`, `guard_unknown` (when not empty) and `diff`; with `--github`, notice annotations plus a job summary when `GITHUB_STEP_SUMMARY` is set.

With `--diff-base`, the added handlers in changed files where Drift found no guard are listed (JSON `added_without_guard`); routes already listed under a shared guard, and routes the practice map knows are open on purpose (probes, `AllowAny`, webhook signatures), are left out. Those with no guard and something whose guard cannot be read are listed apart, under `New entry points whose guard is unknown (Drift could not read what may be one; not findings)` (JSON `guard_unknown`), and `--fail-on no-guard` never counts them.

With `--write-baseline`, it prints what it wrote (`Wrote .drift/security.lock (N finding(s)): ...`, a count per kind) and which kinds only advise. Writing it again keeps the kinds the baseline already set to fail and adds those `--fail-on` names.

**Exit codes**

0 on success, including when it lists findings. 1 with `--fail-on`, when the change introduces one of the kinds named (standard error says which), and with `--ratchet`, when a finding that is not in the baseline is found, of a kind that fails. 2 on error: for example `--diff-base` outside a git work tree or with a ref Git cannot find, a `--fail-on` name that is none of the kinds, `--fail-on` without `--diff-base`, `--ratchet` or `--write-baseline`, `--fail-on public` with `--write-baseline` or `--ratchet`, a kind read against the baseline (`scope-gap`, `no-authorization`, `unscoped-key`, `whole-row`, `workflow`, `dependency`, `kubernetes`) with `--diff-base`, and `--ratchet` with no baseline.

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

Where the repository has `.drift/conventions.yaml` and an accepted convention the card lists has new violations in the file (not in `drift.lock`, no `drift-ignore`), the text card adds `Violations here (new: not in drift.lock, no drift-ignore), and what each rule rests on:`, with the same labels as `drift check` (`source`, `evidence`, `changed`, `not checked`, `here`, `holds near it`, and the rest) for the first few. The file is checked as `drift check <file>` checks it. A promoted practice and wiring advice are not listed there; `drift check` lists them. `--json` does not carry this section.

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

Reports what the codebase does for each cross-cutting concern (authentication, authorization, errors, logging, API, validation, config, data access, testing): each variant with its share, where it is, what sets it apart, an example to copy, and what is unknown. Read-only: it states what the code does and checks nothing. To make a practice the rule for new code, see [`drift practices promote`](#drift-practices-promote).

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

## drift practices promote

Turns a practice from the practice map into an accepted convention for one place: a package, a directory of one, one file, or the routes of a package under a route prefix. What it accepts is one or more named ways (variants), a mechanism accepted whole whichever instrument a unit names (`--mechanism`), or any way Drift reads as enforcing the concern (`--any-enforcing`). It writes the convention (rule type `practice`, advise mode, shown to agents) to `.drift/conventions.yaml`, and one `drift.lock` line per unit that differs today, so `drift check` reports only new code. What qualifies and how the rule is checked: [Practices Map](Practices-Map#promoting-a-practice-to-a-convention).

```text
drift practices promote <P-ID> [--in <PATH>] [--with <P-ID>]... [--block] [--force] [--dry-run] [--json]
drift practices promote --concern <ID> (--mechanism <NAME>... | --any-enforcing) [--in <PATH>] [...]
drift practices promote --list [--concern <ID>] [--json]
```

| Argument | Meaning |
| --- | --- |
| `<P-ID>` | The variant to promote: its id as `drift practices --all` prints it, or `concerns[].variants[].id` in `drift practices --json`. Optional with `--concern` and `--mechanism` or `--any-enforcing` |

| Option | Meaning | Default |
| --- | --- | --- |
| `--concern <ID>` | The concern (`authn`, `authz`, `errors`, ...): needed when no variant is named, to accept a mechanism (`--mechanism`) or any enforcing way (`--any-enforcing`). With `--list`, only that concern's practices are listed |  |
| `--mechanism <NAME>` | A mechanism accepted whole, in the map's own words (`dependency`, `wrap`, `membership_guard`, ...: the part before the `:` of a unit's uses in `drift practices --units --json`): a unit that does the concern by it follows, whichever instrument it names (comma-separated or repeated) |  |
| `--any-enforcing` | Accept any way Drift reads as enforcing the concern (sign-in: any way that turns an unsigned caller away; permissions: any check Drift proved compares the caller with what is asked for). A way that opens a route on purpose is not one |  |
| `--in <PATH>` | The place: a path from the repository root, a package directory or a directory inside one (`.` the root package); a unit is in it when its file is in that directory or below. A path that is the file of a unit is that one file. A package, `:` and a route prefix (`apps/api:/api/v2`, `.:/api/x` for the root package) is the routes of that package under the prefix, each parameter matching any parameter; a unit whose route Drift did not read to the end as a literal is never in it, and is counted as not read | the variant's broadest place that qualifies |
| `--with <P-ID>` | Another variant of the same concern, accepted as a way with the first. Repeat for more. Nothing is added unless you name it, including a way that marks a route open on purpose |  |
| `--block` | Write it in block mode. Refused unless the replay allows it: of the 15 units most recently added to the place (by the commit that first added their file) that the map can tell, at least 80% follow it as they stand. Needs git history |  |
| `--force` | Promote although the accepted ways hold less than 80% of the units Drift could read. Lifts nothing else; a forced practice advises only, and `--block --force` is an error |  |
| `--dry-run` | Print the preview and write nothing |  |
| `--list` | List every practice that may be promoted now, without `--force`, one line each with the command to run. Writes nothing |  |
| `--json` | Print JSON on standard output (below) |  |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |

**Examples**

On the sample repository of the [README](https://github.com/dadbodgeoff/drift/blob/main/README.md#a-five-minute-first-run) (40 routes, 38 wrapped in `withAuth`; the variant is `P-0f0acb`):

```bash
drift practices promote --list
```
```bash
drift practices promote P-0f0acb --in app/api --dry-run
```
```bash
drift practices promote P-0f0acb --in app/api
```
```bash
drift practices promote P-0f0acb --in app/api --block
```
```bash
drift practices promote P-0f0acb --in app/api --json
```

From the command's own help:

```bash
drift practices promote --concern authz --mechanism membership_guard --in app/api
drift practices promote --concern authn --any-enforcing --in app/api
drift practices promote --list --concern authn
```

**Output**

Text: the preview, then `Wrote .drift/conventions.yaml and drift.lock.`, or with `--dry-run`, `Dry run: nothing was written.` The preview says how many units of the place follow the practice, names the ones that differ and will be recorded as they are (at most three by name), how many could not be read and are never reported, what `drift check` reports from now on, the mode and how to change it, and the other ways units of the place use that `--with` could add.

```
Sign-in in app/api: wrapped in withAuth in 38 of 40 entry points.
  2 do not, and are recorded as they are (app/api/r38/route.ts:1 GET, app/api/r39/route.ts:1 GET).
  0 could not be read; those are never reported.
From now on `drift check` reports a new entry point here that does it another way, or not at all.
Mode: advise (it never fails a check). `drift practices promote P-0f0acb --in app/api --block` makes it fail one, when the 15 entry points added here most recently follow it.
Also in .drift/conventions.yaml: D-37416b names the same way for code of this package. Where both are accepted, new code that breaks them is reported under each; `drift review --reject <id>` drops one.
Wrote .drift/conventions.yaml and drift.lock.
```

`--list`, text: one line per practice that may be promoted, with the command to run.

```
3 practice(s) may be promoted now. Each becomes an accepted convention in advise mode, with the code that differs today recorded in drift.lock; the command prints what it records (--dry-run writes nothing):
  sign-in in .: wrapped in withAuth in 38 of 40 entry points; 2 differ, 0 could not be read
    drift practices promote P-0f0acb --in .
  errors in .: left to the framework in 40 of 40 entry points; 0 differ, 0 could not be read
    drift practices promote P-6123b9 --in .
  responses in .: built with Response.json in 40 of 40 entry points; 0 differ, 0 could not be read
    drift practices promote P-9fdb90 --in .
```

`--json`, on success:

```json
{
  "written": true,
  "place": "app/api",
  "convention": { "id": "D-d67d54", "summary": "Sign-in in app/api: wrapped in withAuth", "status": "accepted", "mode": "advise", "promoted_from_practice": "P-0f0acb" },
  "candidate": {
    "concern": "authn",
    "unit": "entry_point",
    "place": { "package": "", "dir": "app/api" },
    "ways": [ { "id": "P-0f0acb", "key": "wrap:lib/auth.ts#withAuth", "label": "wrap withAuth", "members": 38 } ],
    "other_ways": [],
    "follows": 38,
    "exceptions": [ { "path": "app/api/r38/route.ts", "symbol": "GET", "line": 1 }, { "path": "app/api/r39/route.ts", "symbol": "GET", "line": 1 } ],
    "unknown": 0,
    "total": 40,
    "example": { "path": "app/api/r00/route.ts", "symbol": "GET", "line": 3 },
    "forced": false
  },
  "baselined": 2,
  "replay": null,
  "same_way": [ "D-37416b" ],
  "preview": "…the preview text…"
}
```

| Field | Meaning |
| --- | --- |
| `written` | `false` with `--dry-run` |
| `place` | The place as output names it (`.` for the root package) |
| `convention` | The convention written (or that would be): `id`, `summary`, `status`, `mode`, `promoted_from_practice` |
| `candidate` | What was counted: `concern`, `unit` (what one unit is), `place` (`package`, `dir`, and `file` for a file place or `route` for a route place, each parameter written `[*]`), `ways` (the accepted ways: `id`, `key`, `label`, `members`), `other_ways` (the other known ways units of the place use, most members first), `follows`, `exceptions` (every unit that differs, sorted by path, line and symbol), `unknown`, `total` (`follows` + exceptions + `unknown`), `example` (a unit that follows, to copy), `forced`; and, each only when set, `passive` (the way is what code does by doing nothing), `jobs` (background jobs not counted, for sign-in and permissions), `mechanisms` (the mechanisms accepted whole, sorted), `any_enforcing` (any enforcing way is accepted), `unread_routes` (of a route place: units counted in `unknown` because Drift did not read their route to the end, so whether they are under the prefix is not known) and `unknown_cause` (`reason`, `instrument`, `units`, and `hint` when a `.drift/config.yaml` line would let Drift read it: the one cause outside them that every unknown unit shares) |
| `baselined` | The number of `drift.lock` lines added (with `--dry-run`, that would be added) |
| `replay` | With `--block`: `{ "recent": 15, "followed": 14 }`, the units the replay read and how many of them follow. Otherwise `null` |
| `same_way` | The ids of the mined conventions, proposed or accepted, whose rule requires the same thing of code in the same package (empty when there is none). With both accepted, new code that breaks them is reported under each |
| `preview` | The text preview |

On refusal, exit 2 and on standard output `{ "refused": { "code": "…", … }, "message": "<the sentence>" }`. The codes and their fields: `unknown_variant` (`id`); `not_a_way` (`id`, `why`: the id names `none`, the tail of one-off ways, or a way only declared, with no unit proven to use it); `other_concern` (`id`, `concern`: a `--with` variant of another concern); `no_such_place` (`place`); `no_place` (`id`, `nearest`: the refusal of the place that came nearest, or null); `too_small` (`place`, `units`, `min`); `below_share` (`place`, `follows`, `read`); `too_unknown` (`place`, `unknown`, `total`, and `cause` in the shape of `unknown_cause` when the unknown units share one); `nothing_accepted` (no way, no mechanism, not any enforcing way); `unknown_concern` (`concern`); `not_a_mechanism` (`concern`, `mechanism`: no unit Drift read does the concern by it); `no_enforcing` (`concern`: the concern has no notion of a way that enforces it). More come from the command line itself and carry only the code, except the last: `no_concern` (`--mechanism` or `--any-enforcing` with no variant and no `--concern`), `no_variant` (no id, no concern with `--mechanism` or `--any-enforcing`, and no `--list`), `block_forced` (`--block` with `--force`), `no_policy` (no `.drift/conventions.yaml`: run `drift init` first), `covered` (another promoted practice already holds the concern in a place that overlaps; `drift review --reject <id>` drops it first), and `block_refused` (`id`, `replay`: the replay that was run, or null when there is no history to read, the place is Python, or the practice was forced).

`--list --json`: `{ "candidates": [ { "place": ".", "command": "drift practices promote P-0f0acb --in .", "candidate": { … } } ], "declined": 0, "promoted": [] }`, with `candidate` as above, sorted by concern, place and variant id. A practice already promoted, or one you declined in `drift review`, is not listed again: `promoted` holds the ids of the conventions that cover what would have been listed, and `declined` counts the ones declined. (On the sample repository the broadest place that qualifies is the root package, `.`, so `--list` names that; `--in app/api` names the directory.)

The preview can carry three more lines: the shared cause of the unknown units (`All N are unknown for one cause outside them: ...`), the background jobs not counted (`N background jobs take no request and are not counted.`), and, for a way of doing nothing, `This is what code here does by doing nothing: new code follows it without trying, so the rule reports only code that does something else.` See [Practices Map](Practices-Map#how-the-rule-is-checked).

**Exit codes**

| Code | Meaning |
| --- | --- |
| 0 | Promoted, or the preview or the list printed |
| 2 | Refused (the reason in one sentence on standard error; nothing written), or a usage error such as `--block` with `--force` |

**Notes**

- Run it again for the same concern in the same place to change the ways: the convention keeps its id, the ways become the set you give, lock lines are added for units that differ under the new set, and a mode a person chose is kept unless `--block` is given.
- A promoted practice is an ordinary convention afterwards: `drift review --advise <id>` returns it to advise mode, `drift review --reject <id>` rejects it, and `// drift-ignore <id>: <reason>` above a declaration suppresses one violation.
- A place of Python code advises only (decision D7).
- `--block` reads git history: when each file of the place was first committed. Without git, or with fewer than 15 units whose first commit is known, block is refused; advise always works.
- Commit `.drift/conventions.yaml` and `drift.lock` afterwards. An older Drift cannot read a `.drift/conventions.yaml` that holds a promoted practice, and a practice that accepts a mechanism whole, any enforcing way, or holds in a file or under a route prefix makes the file's `version:` 3, which a Drift that reads up to 2 refuses: upgrade every machine and CI first ([Versioning and Upgrades](Versioning-and-Upgrades#promoted-practices-and-older-drift)).

## drift feedback

Beta feedback: mark a report true or wrong, and write a file of counts you can read in full and choose to share. Sends nothing. The whole workflow, and every field of the file, is on [Beta Feedback](Beta-Feedback).

```text
drift feedback mark <ID> [PATH#SYMBOL] (--true | --wrong) [--why <TEXT>]
drift feedback export [--out <FILE>] [--dry-run] [--include-reasons]
```

`drift feedback mark`: record your verdict on one report, in `.drift/feedback/marks.json`. Changes no verdict of Drift's.

| Argument or option | Meaning |
| --- | --- |
| `<ID>` | The convention id of the violation (`D-…`, as `drift check` prints it), or a finding's id (`F-…`, as `drift findings` lists it). A whole line of drift.lock (`<id> <path#symbol>`, quoted) works too |
| `[PATH#SYMBOL]` | The member the violation is reported on, as `drift check` and `drift.lock` name it. Not given for a finding |
| `--true` | The report is true: the code really departs from the convention |
| `--wrong` | The report is wrong: Drift misread the code, or the rule does not fit it |
| `--why <TEXT>` | Why, in your words (at most 300 characters). Exported only with `drift feedback export --include-reasons` |

`drift feedback export`: write the feedback file: counts, rule kinds and verdicts, nothing that names the code. It prints what it holds first.

| Option | Meaning | Default |
| --- | --- | --- |
| `--out <FILE>` | Where to write the document. Refused under `.drift/` outside `.drift/feedback/`, and for `drift.lock` | `.drift/feedback/drift-feedback.json` |
| `--dry-run` | Print the document that would be written, and write nothing |  |
| `--include-reasons` | Also include the text of each mark's `--why`. Free text can hold anything: read it before you share the file |  |

`drift feedback`, `drift feedback mark` and `drift feedback export` also take the global `--root <ROOT>` and `--no-cache`.

**Exit codes**

0 on success, 2 on error.

**Notes**

The first mark creates `.drift/feedback/` with its own `.gitignore` of `*` and a random key that hashes ids in the exported file; the key is never written to it. A symbolic link in the way is refused. Nothing in Drift but `drift feedback export` reads the marks. See [Files Drift Writes](Files-Drift-Writes#driftfeedback).

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

`claude-settings`: JSON for `permissions.allow` (`Bash(drift card:*)`, `Bash(drift map:*)`, `Bash(drift example:*)`, `Bash(drift check:*)`, `Bash(drift practices:*)` and the ten read-only MCP tools as `mcp__drift__<tool>`: the eight lookups, `drift_setup_questions` and `drift_investigate_items`), and one entry for `permissions.deny`, `Bash(drift practices promote:*)`: `Bash(drift practices:*)` would otherwise cover the one form of `drift practices` that writes, and a deny wins over an allow. With `--write FILE` it merges them into the file, keeping other settings and writing keys sorted.

**Exit codes**

0 on success, 2 on error (for example `--write` to a file that is not a JSON object for `claude-settings`, or through a symbolic link that leaves the repository).

**Notes**

Re-run `agents-md` after `drift review`; only the text between the markers changes. `agents-md` shows what agents are shown.

## drift upgrade

After installing a newer Drift: what it reads differently in the files an older one wrote, said in one place, and with `--apply` only what changes no decision a person made. The whole report, what `--apply` does and never does, and the JSON are on [Versioning and Upgrades](Versioning-and-Upgrades#what-drift-upgrade-reports).

```text
drift upgrade [OPTIONS]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--apply` | Do what cannot change a decision a person made: baseline the violations that appear only because this Drift reads the code differently, and refresh agent settings an older Drift wrote that nobody edited |  |
| `--root <ROOT>` | Repository root | `.` |
| `--no-cache` | Disable the on-disk fact cache |  |
| `--security-baseline` | With `--apply`: also add to `.drift/security.lock` the findings of kinds and detectors this Drift has and the Drift that wrote it did not (nothing else) |  |
| `--json` | Print the report as JSON (schema `drift-upgrade`, version 1) |  |

**Examples**

```bash
drift upgrade
```
```bash
drift upgrade --apply
```
```bash
drift upgrade --apply --security-baseline
```

**Output**

Per file under `.drift/` and `drift.lock`, what it records of the Drift that wrote it and of its format; per accepted convention, its evidence when accepted against what this Drift reads now; the new violations that appear only because the reading changed, apart from those in code that changed and those Drift cannot tell about; the security baseline against this Drift's inventory; the agent integrations that differ from what this Drift would install; then what is left to do, each with its command.

**Exit codes**

0: nothing needs doing (after `--apply`: nothing is left). 3: something needs doing, by `--apply` or by a person. 1: a write of `--apply` failed; the report lists what was written before it, and nothing after it was. 2: refused with nothing changed, because a file was written by a newer Drift or does not parse (the file and line are named).

**Notes**

Without `--apply` nothing is written but the fact cache (`--no-cache`: nothing at all). `--apply` never accepts, rejects, promotes or demotes a convention, never changes a mode and never deletes a line; a file that needs no change keeps its bytes.

## Commands not in the list

`drift debug` exists and is hidden from `--help`; it prints parser debugging output for Drift's development and is not a supported interface.

See also: [Configuration Reference](Configuration-Reference), [Output and JSON Reference](Output-and-JSON-Reference), [MCP Reference](MCP-Reference), [Hooks Reference](Hooks-Reference), [Files Drift Writes](Files-Drift-Writes), [Glossary](Glossary)
