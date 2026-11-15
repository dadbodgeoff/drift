# Using Drift with Agents

This page explains how coding agents use Drift: the Claude Code hooks (what each says and when), the `drift mcp` server and its tools, the generated agents block, the pre-approved lookups, and how an agent should treat `unknown` and "nothing found". It is for engineers who install Drift into an agent's environment and for the people who decide what an agent is allowed to be told.

## What agents are shown

Agents are shown accepted conventions of the default tier, and a suggestion only when its rule family is admitted (none is today) or a person chose to show it. A default-tier proposal nobody has accepted is a block candidate and reaches no agent surface: not the hooks, not the MCP tools, not `drift example`, not the `drift check` text report and not the generated agents block. Anything ambiguous reaches no agent: a status other than `accepted`, or a `.drift/conventions.yaml` Drift cannot read (the hooks then fail open with a note, and MCP and `drift example` answer with an error that names the file and does not quote it).

On top of conventions, agents get facts that need no accepted convention: a file's card, the practice recipe for a new entry-point file, and notes after an edit about how that file differs from its neighbours. Facts are labelled "facts, not rules" and never block.

### Which suggestions are shown

A suggestion is shown to agents only when its rule family is admitted: its suggestion-tier accept rate on the latest labelled development run meets the bar, in the convention's language (85% accepted of at least 10 labelled cards). The table, bar included, is committed data, `crates/drift-mine/data/family-admission.json`, with the run and date it came from. It is regenerated after every relabel with one command, `node eval/study/family-admission.mjs --run eval/study/runs/<run>` (`--min-accept 0.75 --min-cards 10` changes the bar it stores). On the current table (development relabel 4, 2026-11-07) **no suggestion family is admitted** in TypeScript, JavaScript or Python, so agents see the default tier only. A rule kind the table does not know, a family without labelled cards, or a missing table is not shown.

This is separate from the round-10 show policy, which decides what Drift proposes at all and has a lower bar (see [Conventions and Review](Conventions-and-Review)).

### What you see as a person

- **Block candidates.** `drift census`, `drift init`, `drift review` and the Studio list an unaccepted default-tier proposal first, marked `agents: not shown to agents (block candidate: reaches agents once you accept it)` (`census --json`: the proposal's `agents.reason` is `candidate`, and the top-level `agents.candidates` counts them; it is absent when there are none). No agent surface has it until a person accepts it (`drift review --accept`, `y` or `b` in interactive review, or the Studio) or sets `agents: show`. Blocking is unchanged: it needs an accept in block mode.
- **Suggestions.** Every suggestion stays visible to you: the same commands list it, marked `agents: not shown to agents (family below admission bar: 56% of 37)`, and `census --json` and `check --format json` give each one's `agents`, one decision record per convention (`shown_to_agents`, `reason`, `source` (what decided), `family`, `accepted`, `n`, `text`). Accepting a suggestion has `drift check` and CI report it, but does not show it to agents. To show one anyway, in this repository:

```bash
drift review --show-to-agents D-04385a
```

It accepts the suggestion and writes `agents: show` to `conventions.yaml` (or answer `a` in interactive review). A suggestion a person forced to block is shown too, since it can block the agent's turn. `drift check` text lists new violations of accepted conventions agents are not shown, marked `not shown to agents` (its exit code is unchanged), as JSON, SARIF and `--format github` do; the hooks and MCP do not show them to agents.

## The Claude Code plugin

With `drift` on your `PATH`:

```bash
claude plugin marketplace add dadbodgeoff/drift
```

```bash
claude plugin install drift@drift
```

(`claude plugin marketplace add /path/to/a/checkout` installs from a local checkout instead.) The plugin adds the hooks, a skill and the MCP tools (its `.mcp.json` starts `drift mcp`). The plugin cannot ship permission rules, which is why its PreToolUse hook approves the read-only lookups (see "Pre-approved lookups"). In a repository with `.drift/conventions.yaml`, the agent is told the accepted rules before it writes a new file, advised after each edit that breaks one, and stopped at the end of its turn only by conventions in block mode.

Every hook exits 0 with JSON, so a Drift failure never blocks the agent. The hooks are `drift hook claude <Event>`, reading the event JSON on stdin; there is nothing to call by hand, but you can try one from the repository root:

```bash
echo '{"session_id":"try","hook_event_name":"SessionStart","source":"startup"}' | drift hook claude SessionStart
```

Drift itself commits nothing and never edits your code: hooks read the working tree and write session state under `.drift/cache/sessions/`.

### What each hook says and when

| When | What Drift does |
| --- | --- |
| `SessionStart` (time budget 30 s) | Records the current violations as this session's baseline, once per session (`resume` and `compact` keep it). Opens with a brief of at most 300 tokens: the packages with their entry points, and `drift card` as the first stop. Then says how many accepted conventions block at the end of the turn and how many only advise. Works in a repository with no `.drift/` too, read-only. `agents: {brief: off}` in `.drift/config.yaml` turns the brief off |
| `PreToolUse` before writing a file (10 s) | Reads the content being written and tells the agent the accepted rules for what it declares, and a file to copy, once per rule: default-tier first, at most 4 rules of which at most 2 suggestions, marked `(suggestion)`; rules in block mode are marked `(blocks)`. A new file of a kind the practice map has a recipe for gets that recipe once |
| `PreToolUse` before editing `.drift/` or `drift.lock` | Denies it: policy is changed by people (`drift review`), and the cache and session state by Drift |
| `PreToolUse` before a shell command (5 s) | Denies, best effort, a command that writes to `.drift/` or `drift.lock` (a redirection, `rm`, `mv`, `cp`, `tee`, `sed -i` and similar naming them); approves a plain read-only Drift lookup so it never prompts |
| `PreToolUse` before `Grep` or `Glob` (5 s) | When the search hunts for how a concern is handled (auth, middleware, guard, validate, schema, error, logger, route, handler...) and Drift has entry points there, adds one line pointing to `drift card <file>`, once per file per session. Silent for a plain symbol or string lookup. It never blocks the search |
| `PreToolUse` before a Drift MCP tool (5 s) | Approves it, so the read-only tools never prompt |
| `PostToolUse` after a write or edit (20 s) | Reports new violations in that file, once each (suggestions marked `(suggestion)`, block-mode ones `(blocks)`). For a file with entry points it says, as facts, which concerns its entry points do another way than at least 80% of those around them, with a unit to copy. If the edit adds a risky operation, a path to one, or a client leak, or makes one package depend on another it did not depend on at session start, it says so, as facts. Each is once per entry point or fact and session, and what the code already did at session start is not reported |
| `UserPromptSubmit` (5 s) | Passes on advice queued at the end of the previous turn (experimental wiring rules) |
| `Stop` (30 s) | Blocks the end of the turn only on new violations of conventions in block mode, and steps aside after 3 blocks or when no progress is made, and tells the person. It also tells the person, in one line, how many facts the agent was told about during the turn still stand. It never blocks on those facts |
| `SessionEnd` on `clear` (5 s) | After `/clear` the next session inherits the baseline, while its advice and block counter start again |

Timeouts are those in the plugin's `hooks.json`. The timings are measured, not promised (see [Hooks Reference](Hooks-Reference), "How long a hook takes"): after an edit, 0.02 to 0.10 s on 12 of 13 TypeScript development repositories with proposals and 0.22 s on the largest; an edit of a file with entry points reads the whole practice map and cost about 2 s on a 3,200-file monorepo. If hooks feel slow, see [Troubleshooting](Troubleshooting). If a session's state is missing or unreadable, Drift records a new baseline from the violations in files unchanged since `HEAD`, so changed and untracked files still block, and tells you; without git it takes every current violation as the baseline.

Repository text in hook messages is escaped, length-capped and labelled as data. The exact fields each hook reads and writes are on [Hooks Reference](Hooks-Reference).

### What an agent sees

A new session in a repository where `D-37416b` is accepted in block mode starts with:

```
drift: practices in . (facts, not rules; each names a file to copy):
- new http entry points in .: authn: wrap withAuth (38 of 43; copy app/api/r00/route.ts:2); ...
Drift map (facts from this repository, not rules): 1 package(s); entry points by package: (root) 43 (http 43).
Before reading sibling files to learn how a route, handler, job or component is built here, run `drift card <path>` (MCP `drift_card`; it works for a file that is not there yet), e.g. `drift card app/api/r00/route.ts`. Read other files only for what it lists under Not known. The file to copy in 'the package mostly' is always in the card file's package and language; when there is none, the card says 'no <lang> example of it in this package to copy'.
Drift: 1 of this repo's 1 accepted conventions block at end of turn (a new violation stops the turn from ending), 0 advise. Before creating a file, run `drift example <path>` to see which existing file to copy.
```

An edit to `.drift/conventions.yaml` is denied:

```
.drift/conventions.yaml is Drift's policy or state (conventions, lock, fact cache, sessions) and is changed by Drift and people only (`drift review`). Fix the code instead, or add `// drift-ignore <id>: <reason>` above the declaration.
```

## `drift mcp`

`drift mcp` serves MCP tools over stdio. Register it from the repository root:

```bash
claude mcp add drift -- drift mcp
```

```bash
claude mcp add --scope project drift -- drift mcp
```

The first is for this machine only; the second shares it with the team in `.mcp.json`. Other clients take `{"mcpServers": {"drift": {"command": "drift", "args": ["mcp"]}}}`; add `"--root", "/path/to/repo"` to `args` when the client does not start it in the repository.

The server lists 12 tools, and a thirteenth when the experimental verifier is on. Ten only read; `drift_setup_answer` and `drift_investigate_record` write (and `drift_verify_card`, when listed):

| Tool | Reads or writes | What it returns |
| --- | --- | --- |
| `drift_rules_for` | read | accepted conventions that apply to a file (existing or planned), each with evidence, tier, mode and an example; pass planned `content` to get only the rules for what it declares |
| `drift_example` | read | the file to copy when writing a file like a path |
| `drift_check` | read | new violations of accepted conventions, optionally limited to files, plus where the files' entry points do a concern another way than their neighbours |
| `drift_explain` | read | one convention by id: rule, status, mode, tier, evidence, exceptions, an example |
| `drift_map` | read | structure: with `path`, `role` or `package`, or the whole repository |
| `drift_card` | read | one file's card |
| `drift_security` | read | the security inventory, optionally limited to files |
| `drift_practices` | read | how this codebase does authentication, authorization, validation, errors and responses, with a file to copy |
| `drift_setup_questions` | read | the open setup questions with choices and evidence (see [Setup Questions](Setup-Questions)) |
| `drift_setup_answer` | writes `.drift/config.yaml` | answers one setup question as an agent; takes effect only where it makes Drift more cautious, otherwise a proposal |
| `drift_investigate_items` | read | every route Drift could not settle, grouped by what would settle it, with the evidence to read (see [Investigating open routes](#investigating-open-routes)) |
| `drift_investigate_record` | writes `.drift/config.yaml`, and local files under `.drift/findings/` and `.drift/gap-reports/` | records an agent's outcome for one open route; takes effect only where it keeps or raises Drift's caution, otherwise a proposal; a finding or a gap report is a local file |
| `drift_verify_card` (experimental) | writes `.drift/verify-cache.json` | listed only while `agents.verify: on` is set in `.drift/conventions.yaml` |

`drift mcp --help` lists which tools only read and which write, in the same split. Arguments and results of each are on [MCP Reference](MCP-Reference).

## Pre-approved lookups

The read-only lookups (`drift card`, `drift map`, `drift example`, `drift check`, `drift practices` and the MCP tools) run without a permission prompt when the plugin is installed: its `PreToolUse` hook approves exactly these commands when run as one plain command with no shell syntax around them. Without the plugin, or in a permission mode where a hook cannot approve a tool, write the same entries into `.claude/settings.json`:

```bash
drift export claude-settings
```

```bash
drift export claude-settings --write .claude/settings.json
```

The first prints the entries; the second merges them into the file, keeping other settings, with keys written sorted. It adds `drift card`, `drift map`, `drift example`, `drift check`, `drift practices` and the read-only MCP tools (the eight lookups, `drift_setup_questions` and `drift_investigate_items`) to `permissions.allow`. The two writing tools, `drift_setup_answer` and `drift_investigate_record`, are not in that list, so a person approves them as they are called.

## The agents block

```bash
drift export agents-md --write AGENTS.md
```

creates `AGENTS.md` if needed, or updates only the text between the `drift:start` and `drift:end` markers; use `--write CLAUDE.md` for that file. Without `--write` it prints to standard output. It lists accepted conventions, grouped into rules (default tier, and anything a person set to block) and suggestions, and ends with the rule that makes Drift the first stop:

> Before searching for how this codebase handles auth, validation, errors, routes or data access, or for its structure (packages, entry points, a file's role), run `drift card <target file>` (or `drift practices --path <file>` when available). Grep only for what it reports as not known. Keep using grep to find where a symbol is called or a string is defined.

Re-run it after `drift review`; commit the result so every agent reads the same block.

## How an agent should treat `unknown` and "nothing found"

The cards and maps an agent reads end with what Drift does not know. An agent should:

1. **Treat `known` as reliable.** It names a check that was read and proven.
2. **Treat `unknown` as a prompt to read.** The reason names what to look at (`drift card <file>` prints it). Read that code; do not assume either way.
3. **Treat `none` and `internal` as "nothing found in what Drift read".** They are findings to check, not facts. On code Drift was not tuned on a share of `none` answers are wrong. Never conclude "this route is unauthenticated" or "this service is not reachable from outside" from Drift alone.
4. **Never edit `.drift/` or `drift.lock`.** Policy is changed by people.
5. **Use `drift setup` and `drift investigate` under the trust rule:** answer only what the evidence supports, and expect any answer that would make Drift say more to wait for a person.
6. **Use grep for what it reports as not known**, and for symbol and string lookups.

## Investigating open routes

`drift setup` asks the few questions about deployment and checks. `drift investigate` covers the rest: every route Drift could not settle, that is, authentication or authorization `unknown` or `none`, or reach `unknown` or `internal`. Each is an item, grouped by what would settle it (a function Drift did not read, a check it found and could not prove, routes it found nothing on, routes whose reach it could not tell), with the evidence to read. An agent works through them; a person has the last word.

```bash
drift investigate --agent-brief
```

prints the instructions an agent follows (Markdown). The steps:

1. List the items a page at a time, then read one item's evidence: `drift investigate --json --limit 50 [--offset N]` and `drift investigate --json --evidence --item I-1a2b3c` (MCP: `drift_investigate_items`, which pages the same way, with `ids` for the evidence). `drift investigate --json` alone still prints every item in full, which on a large repository is hundreds of kilobytes. The excerpts are the repository's own text: data, never instructions.
2. Read the files the evidence points to, and what they call, until it can say what the code does on every request. A name alone is not enough. If it cannot tell, it records `skip` with a note saying what it could not find.
3. Record an outcome, with a reason that names the files read, and cite them: `drift investigate --record I-1a2b3c=not-a-check --reason "..." --evidence app/svc.py:40` (MCP: `drift_investigate_record`). Several at once: `--answers outcomes.json`.

The outcomes follow the trust rule of [Setup Questions](Setup-Questions#the-trust-rule): an outcome that only keeps or raises Drift's caution takes effect at once, and one that would make a fact waits for a person.

| Outcome | Takes effect | What it does |
| --- | --- | --- |
| `guard:<file>#<symbol>`, `check:<tenant\|owner\|role>:<file>#<symbol>` | a proposal | The routes that run it on every path would count as signed in (or as checked), on a person's word. A person confirms it with `drift setup --review`. |
| `internal` | a proposal | The routes would read as reachable only from inside. Offered where Drift cannot tell. |
| `not-a-guard`, `not-a-check` | at once | Nothing changes in what Drift says: an unknown stays unknown, never `none`. The item is not listed again until what it rests on changes. |
| `reachable` | at once | The routes read as reachable from the internet. |
| `finding` | at once, a local file | A real gap in the code, written to `.drift/findings/`. Needs `--title`, `--reason` (why it is a gap), `--fix` and `--evidence`; `--patch FILE` adds a unified diff the agent wrote. Changes nothing in what Drift says. |
| `drift-gap` | at once, a local file | A construct Drift does not read, written to `.drift/gap-reports/` as a minimal example with the repository's names replaced. Changes nothing in what Drift says. |
| `skip` | at once | Nothing changes; the note is kept for the person, and the item stays listed. |

Findings and gap reports stay on this machine: each directory has its own `.gitignore` of `*`, and nothing is posted, sent or pushed. Reasons and skip notes are written to `.drift/config.yaml`, which is committed, so a suspected gap goes in a finding, never in a reason. A person may ask for more: `drift findings` lists them, `drift findings --issue F-1a2b3c` prints an issue draft (Markdown) and posts nothing, and `drift findings --branch F-1a2b3c` makes a local branch `drift/f-1a2b3c` holding the finding's patch, built beside your working tree (a throwaway index): `HEAD`, the index and the working tree stay as they are, and nothing is pushed. A finding without a patch cannot become a branch, and an existing branch is not replaced.

In an `--answers` file, a finding's `patch` is the diff text itself (the unified diff as a string), not the name of a file. Only the command-line `--patch` takes a file. A path written in the JSON field is stored as if it were the diff, and `drift findings --branch` then fails with "the patch does not apply to HEAD". Drift does not check the patch when it records it.

When the agent is done it tells the person how many proposals wait (`waiting` in `drift investigate --json`), how many findings it wrote and how many gap reports, and that nothing was posted. Full flags: [Command Reference](Command-Reference#drift-investigate) and [drift findings](Command-Reference#drift-findings).

## Optional: the agent verifier (experimental)

With `agents: {verify: on}` in `.drift/conventions.yaml`, a suggestion is also shown to agents when the host agent has verified it. Drift makes no network or model call. The MCP tool `drift_verify_card` (listed only while this is on) gives the agent a card's payload (the card, 3 holder and up to 5 outlier excerpts of about 18 lines, and a frozen prompt); the agent runs the prompt 3 times and sends the 3 JSON replies back, and Drift decides: a reply passes when it calls the rule intended and its outlier verdicts count more violations than exceptions (or neither), and 2 of 3 must pass.

- **The verdict is cached** in `.drift/verify-cache.json` by convention id and a hash of the payload, so any change to the card (rule, evidence, exempt members, a legacy outlier, an excerpted line) makes it stale and the suggestion is hidden until it is verified again. A new violation is not part of the card. One verdict is taken per card content. The file is local: do not commit it (see [Files Drift Writes](Files-Drift-Writes)).
- **Only accepted suggestions are verified:** the default tier never is, nor are wiring rules. When this is on and a suggestion is hidden and unverified, SessionStart tells the agent it may call the tool.
- **Where the standing shows:** `check --format json` `conventions[].verify` gives each suggestion's standing (`passed`, `not_passed`, `stale`, `unverified`), and the Studio shows "verified by agent (2/3)" or "not verified". `drift review`, `census` and `init` still show the family decision only. With it on, an agent hook that finds a cached verdict scans the repository once to compare it with the card.
- **It is unvalidated.** The prompt and rule come from a research prototype (R6, development data); they gate nothing by default until they pass the checks in decision D10.3 ([PLAN-PAR](https://github.com/dadbodgeoff/drift/blob/main/eval/study/PLAN-PAR.md)). No precision is claimed for them; see [Accuracy and Limits](Accuracy-and-Limits).

See also: [Hooks Reference](Hooks-Reference), [MCP Reference](MCP-Reference), [Setup Questions](Setup-Questions), [Conventions and Review](Conventions-and-Review), [Security and Privacy](Security-and-Privacy), [Troubleshooting](Troubleshooting).
