# Hooks Reference

Each Claude Code hook Drift installs: when it runs, what it prints, the time budget Claude Code gives it, and how to install and remove it. This page is for engineers who run Drift under an agent and for the platform people who need to know exactly what runs on a developer's machine when an agent edits code. The behaviour is that of `drift hook claude <Event>` (`crates/drift-cli/src/agent.rs`) and the hook definitions in `integrations/claude-code/hooks/hooks.json`.

## What a hook is

Claude Code runs a command at defined moments of a session and passes it a JSON event on standard input. Drift's command is `drift hook claude <Event>`. It answers with JSON on standard output, or with nothing.

Three rules hold for every hook:

- **Every hook exits 0.** An internal error is reported as `{"systemMessage": "drift: hook error, skipped (...)"}`, never as a block, so a Drift failure cannot stop an agent. State that is missing or unreadable also fails open (see Session state).
- **Only the end of a turn can block.** Everything else is context or advice. The end-of-turn hook blocks only on new violations of conventions in block mode, and steps aside after three blocks or when no progress is made.
- **Nothing is committed and nothing is sent.** Hooks read the working tree and write only under `.drift/cache/`. They make no network call. Drift does not edit your Claude Code settings.

In a repository with no `.drift/conventions.yaml`, the hooks stay silent, except that SessionStart gives a brief (see below). Repository text in a hook message is escaped, length-capped and labelled as data.

## The hooks

| Event | Matcher | Timeout | Command |
| --- | --- | --- | --- |
| `SessionStart` | all | 30 s | `drift hook claude SessionStart` |
| `PreToolUse` | `Write\|Edit\|MultiEdit\|NotebookEdit` | 10 s | `drift hook claude PreToolUse` |
| `PreToolUse` | `Bash` | 5 s | `drift hook claude PreToolUse` |
| `PreToolUse` | `Grep\|Glob` | 5 s | `drift hook claude PreToolUse` |
| `PreToolUse` | `mcp__.*drift.*__drift_.*` | 5 s | `drift hook claude PreToolUse` |
| `PostToolUse` | `Write\|Edit\|MultiEdit\|NotebookEdit` | 20 s | `drift hook claude PostToolUse` |
| `UserPromptSubmit` | all | 5 s | `drift hook claude UserPromptSubmit` |
| `Stop` | all | 30 s | `drift hook claude Stop` |
| `SessionEnd` | `clear` | 5 s | `drift hook claude SessionEnd` |

The timeouts are the plugin's; Claude Code enforces them. Drift's own cost per hook is under "How long a hook takes" below; your repository's will differ, and the first scan of a repository with a cold cache is the slow one (see [Troubleshooting](Troubleshooting)). Any other event name gets no output, and the plugin registers only the events above: subagents get advice through PostToolUse, because blocking them risks nested loops.

### SessionStart

Runs when a session starts or resumes (`source`: `startup`, `resume`, `compact`, `clear`).

1. **Baseline.** Records the repository's current violations, once per session, as the session's baseline: they are not the agent's doing. `resume` and `compact` keep the baseline already recorded. After `/clear`, the next session inherits it (the handoff lasts five minutes) and the advice and block counter start again. A forked session (`--fork-session`) starts with a fresh baseline. If the state was lost, the baseline is taken from violations in files unchanged since `HEAD` (so changed and untracked files still count) and the person is told; without git, every current violation is the baseline. The same scan records the practice departures, security facts, package dependencies and the imports between areas the code already had, so later hooks report only what an edit adds.
2. **Brief.** Unless `agents: {brief: off}` is set in `.drift/config.yaml`, opens with a brief of at most about 300 tokens: the practices for the package of the session's directory (`drift: practices in <package> (facts, not rules; each names a file to copy):`), then the packages with their entry points and `drift card` named as the first stop (`Drift map (facts from this repository, not rules): ...`).
3. **Count.** When conventions are accepted: how many block at the end of the turn and how many only advise. For example:

```text
Drift: 1 of this repo's 1 accepted conventions block at end of turn (a new violation stops the turn from ending), 0 advise. Before creating a file, run `drift example <path>` to see which existing file to copy.
```

With none blocking it says `this repo's N accepted conventions advise only (0 block at end of turn)`. It also writes a small index of entry points (`.drift/cache/sessions/agent-hints.idx`) for the search hint below. Output is `hookSpecificOutput.additionalContext`, plus a `systemMessage` for the person when something could not be checked.

### PreToolUse

One command, four behaviours, chosen by the tool:

| Tool | What it does |
| --- | --- |
| `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | A path under `.drift/` or `drift.lock` (on Windows in any case, and with a trailing dot or space) is **denied**: `.drift/... is Drift's policy or state ... changed by Drift and people only (drift review)`. For an existing file of a kind Drift reads, once the session has its baseline, it tells the agent the accepted rules for that file that the session has not given yet, under `drift: conventions for <file>[ in package <package>] before this edit, the ones that block first (N/M: members of the rule's role that follow it):`, labelled as data: one line per rule, with `; this file already breaks it` where the baseline, an earlier edit's advice or `drift.lock` says it does, within the same caps as for a new file and `+N more: run `drift card <file>`` for the rest. Rules that block come first; within each mode, a rule the file follows now (which the edit could break) comes before one it already breaks. A mined rule and a promoted practice that say the same thing are said once. Each rule is said once a session. It reads the policy and the file's own facts (the one-file scan and its cache) and never scans the repository; it says nothing when no rule is accepted, when every rule was given already, when the file's facts cannot be had, when the policy cannot be read, or with `agents.verify: on`. For a **new** file of a kind Drift reads, it tells the agent the accepted rules for what the file declares (read from the content being written) and a file to copy, once per rule: rules that block first, then default-tier rules, at most four rules of which at most two suggestions, marked `(suggestion)`; rules in block mode are marked `(blocks)`. A new `.md` or `.json` hears nothing. With or without accepted rules, a new file of a kind the practice map has a recipe for (a file named as the package's entry-point files are, such as `route.ts`, or written where files of any name are entry points, such as `app/api/v2/*.py`) gets that recipe once: `drift: practices for <path> (facts, not rules): ...`. |
| `Bash` | A shell command that looks like it writes under `.drift/` or to `drift.lock` is **denied**, best effort: redirections (`>`, `>>`, `&>`), `rm`, `rmdir`, `mv`, `cp`/`ln`/`install` (the destination), `tee`, `truncate`, `shred`, `unlink`, `sed -i`/`perl -i` and `dd of=` that name them. Paths resolve from the session's directory through `cd`, `pushd`/`popd` and subshells. On native Windows they are read as Windows reads them: `C:\repo\.drift`, `C:/repo/.drift`, `\\?\C:\repo\.drift`, a share (`\\server\share\…`), Git Bash's `/c/repo/.drift` and a quoted `.drift\x` are the same directory, and `.DRIFT/x` or `drift.lock.` (case and a trailing dot or space do not matter there) are denied too; a program is known by its name with or without `.exe` (`rm.exe`, `/usr/bin/rm`). A path the text alone cannot place there (`/tmp/x`, which Git Bash puts under its own install, or `C:x`) is not judged. Reads (`cat .drift/conventions.yaml`, `drift check`) pass. It does not see paths built by expansion or commands inside `sh -c '...'`. A command that changes Drift's policy is **denied** ("Policy is changed by people"), in any repository, with or without `.drift/`: `drift init`; `drift review` with `--accept`, `--reject`, `--block`, `--force`, `--advise`, `--show-to-agents`, `--exempt`, `--unexempt`, `--answer`, `--set-apart`, `--confirm-entry` or `--set-log`; `drift setup` with `--confirm`, `--reject`, `--forget`, `--review` or `--by` other than `agent`; `drift investigate` with `--by` other than `agent`; `drift findings --branch`; `drift export claude-settings --write`; `drift practices promote` (it writes an accepted convention; with `--dry-run` or `--list` it only reads and gets the normal prompt); and any command that sets `DRIFT_SETUP_PERSON`. The policy check reads every simple command of a list, pipeline, subshell, compound command (`{ … }`, `if`, `for`, `while`, `case`, `!`) or function body: behind reserved words, assignments and wrappers with their options (`sudo -u`, `doas`, `env -u`, `env -S`, `timeout`, `nice -n`, `time`, `command`, `exec -a`, `xargs`, `watch`), package runners (`npx -p`, `npm exec`, `pnpm dlx`, `yarn`, `bun x`), `cargo run --`, and the strings of `sh -c`, `eval`, `script -c`, `expect -c`, `su -c`, `socat EXEC:` and `python -c`, and the line Windows' `cmd /c` (`cmd //c` from Git Bash) and `powershell -Command`/`pwsh -c` run; `drift.exe`, the npm shim `drift.cmd` and a path to either are Drift. Setting `DRIFT_SETUP_PERSON` or `DRIFT_SETUP_PERSON_NONINTERACTIVE`, unsetting `CLAUDECODE` or `DRIFT_AGENT`, or setting `DRIFT_AGENT` to anything but `1` is denied. Under a pseudo-terminal wrapper (`script`, `unbuffer`, `expect`, `socat … pty`, Python's `pty`) or a cleared environment, a writing `drift setup` or `drift investigate` without `--by agent` is denied. `drift findings --issue --write … --force` is denied. `--help` and read-only runs (`--list`, `--json`) are never denied. What it cannot read gets the normal prompt, never an approval. A command that is exactly one read-only Drift lookup (`drift card`, `drift map`, `drift example`, `drift check` or `drift practices`, not `promote`, no shell syntax) is **approved** without a prompt. |
| `Grep`, `Glob` | When the search is hunting for how a concern is handled (the pattern or glob names auth, middleware, guard, validate, schema, error, exception, logger, route, handler, router and similar, or the glob is over a directory that is mostly entry points) and Drift has entry points where it looks, adds one line: ``drift knows this: `drift card <file>` answers how N entry point(s) ... are guarded, validated and structured, with a file to copy.`` Once per file per session. It stays silent for a plain symbol or string lookup, never blocks the search, and reads only the SessionStart index and the session state: it never scans. |
| `mcp__*drift*__drift_*` | A read-only Drift MCP tool is **approved** without a prompt. `drift_verify_card`, `drift_setup_questions` and `drift_setup_answer` are not approved by the hook. |

### PostToolUse

Runs after an edit. Only that file and the files its facts depend on are re-read. It can say up to five things, all as advice:

| Says | When | Opening |
| --- | --- | --- |
| New violations | The edit introduces a violation of an accepted convention that the baseline did not have, once each. Violations of conventions in block mode are marked `(blocks)`: they will block the end of the turn unless fixed. At most 5 are listed, those that block first; the rest are counted (`+N more (B that block, A advice): run `drift check` to see all`). A file that could not be parsed is reported as not checked, never as clean. | The convention advice (with `(suggestion)` for weaker conventions) |
| A practice departure | The file's entry points do authentication, authorization, validation, errors or the response shape another way than at least 80% of the entry points around them (the narrowest directory with eight or more others decides). Once per entry point and session; what the code already did at session start is not reported. A departure of a concern that an accepted promoted practice shown to agents covers in that file is left out: the check of the edit reports it under that convention. Needs no accepted convention, only `drift init`. It ends `If that is intended, carry on and say so; `drift card <path>` has the rest.` | `drift: <path> departs from the practices around it (facts, not rules; nothing is blocked):` |
| A security fact | The edit adds a risky operation, a path from an entry point to one (with its guard or that it has none), client code reaching server-only code or reading an env var with no public prefix, or an entry point with no guard found while most of the other entry points of its kind in its file (or else its directory) carry one: `while <g> of the <k> other <kind> entry points in <place> carry a guard; one to copy: ...`. That last needs at least three guarded siblings and a share like the departures' (a sibling whose guard is unknown counts for neither side), and is not said for an entry point the departure line already named. One line per entry point, six at most, then `- and N more`; the entry point with no guard comes first. Test files are not looked at. It ends `If that is intended, carry on and say so; `drift security <path>` has the rest.` | `drift: <path> now does what it did not at session start (facts, not rules; nothing is blocked):` |
| A new package dependency | The import makes the file's package depend on a package it did not depend on at session start. Once per pair; tests, imports inside a package and development dependencies make no edge. When the other package already depends on this one, the line adds `so the two now depend on each other`. It ends `If that is intended, carry on and say so; `drift map` lists what each package depends on.` | `drift: <path> makes package X depend on package Y, which it did not depend on at session start (facts, not rules; nothing is blocked): ...` |
| A reversed area dependency | The import makes the file's area (its first two directories) depend on an area that imports it in at least five files, while no file of the file's area imported that area at session start. Once per pair of areas a session; read from the file's own facts and the counts SessionStart recorded, never a scan. Never said for a test file, for an area the file's package declares as a workspace dependency, or where the package line above already says it. | `drift: <path> makes <from> depend on <to>, which imports <from> in N files, while no file of <from> imported <to> when the session started (facts, not rules; nothing is blocked): the import is of <module>.` |

All are `hookSpecificOutput.additionalContext`. A hook that finds nothing says nothing. In a workspace the advice names the package whose conventions apply.

### UserPromptSubmit

Passes on advice queued at the end of the previous turn: today only the experimental wiring rules (code added in the last turn that may not be registered where its siblings are). It prints nothing otherwise.

### Stop

The end of the agent's turn, and the only hook that can block.

- With no accepted convention in block mode and no wiring edits, the blocking part returns at once (`skipped:nothing_blocks`).
- With blocking conventions and no file changed since a Stop that had nothing to say, it returns at once, without a scan (a walk of `stat` stamps, so edits made from the shell count).
- Otherwise it scans and checks. A **new** violation of a convention in block mode (not in the baseline) answers `{"decision": "block", "reason": "..."}` with each violation (at most 5, then a count), a file to copy and the `drift-ignore` way out for an intentional exception: `  if intentional: add `<comment>` <place> (shown to reviewers)`, where the place is `above the declaration`, `directly above the model, or at the top of its file`, `on the import's line, or at the top of the file` or `at the top of the file`, as the violation is about. Where no comment can go (a `package.json`), it says `  if intentional: no drift-ignore comment can go in this file; say so to a person, who can mark it fine (`drift review`)`. Only a violation that blocks is offered the way out; advice needs none.
- The **loop guard**: after three blocks in a session, or when the block set has not shrunk since the last one, Drift steps aside and tells the person: `drift: N unresolved violation(s) of ... left for review: drift stopped blocking the end of the turn (...). They are in block mode: drift check still fails on them, and so do Drift's pre-commit hook and GitHub Action where they are set up.`
- Violations that were unsure at session start (their files read a file that could not be parsed then) block once and are listed as advice after that while their files stay as they are.
- Members the agent's code added that a convention is not about are told to the person once, so a wrong exemption is reviewable. They never block.
- When the agent was told something after an edit (a practice departure, a security fact, a new package dependency) and it still stands, a final `systemMessage` line tells the person how many: `drift: N fact(s) the agent was told about this session's edits still stand (facts, not rules; nothing is blocked): ...`. This is the one Stop that scans without a blocking convention, once per telling; it never blocks, and a turn sent back for a violation is summed up when it ends.

### SessionEnd

Matcher `clear`. Writes the handoff the next session picks up (baseline and what the code was at the start), and clears what the conversation has seen so the MCP server, which outlives `/clear`, does not treat rules as already given. Prints nothing.

## How long a hook takes

The plugin's time budgets above are Claude Code's limits. Drift's own cost, measured on its development repositories with a release build on a shared 4-CPU machine (minimum of 5 runs; [performance record](https://github.com/dadbodgeoff/drift/blob/main/eval/perf/2026-11-07/README.md)):

- **After an edit of a file with no entry point:** only that file and the files its facts depend on are re-read and linked. It took 0.02 to 0.10 s on 12 of the 13 TypeScript development clones with proposals, and 0.22 s on the largest.
- **After an edit of a file that had entry points at session start:** the repository is scanned at once (its trace path is `full_scan:entry_points`), because the practice map is read whole. About 2 s on a 3,200-file monorepo, against 0.2 s for a file with no entry point. This one figure comes from an earlier measurement of a private monorepo and was not re-measured for this wiki.
- **After an edit that adds a risky operation, a path to one or a client leak,** the security facts add about 0.2 to 0.3 s to that full scan. Any other file is scanned further only when its own facts show an operation or leak not seen before; otherwise it costs the one-file scan it already had.
- **After an edit that imports another package:** the file's own imports decide whether anything is looked up. Only a first import of another package costs a full scan.
- **At the end of a turn,** the Stop hook returns at once, without a scan, when no file has changed since a Stop that had nothing to say. Its one scan without a blocking convention is the closing line about facts the agent was told, once per telling.


Measured on the 3,200-file monorepo the first-install runs used (a scratch copy, 4 CPUs, a busy machine; one run with a release build, others with a debug build that overstates): a `PostToolUse` after an edit of a file with entry points took about 8 to 13 s (about 4 s the scan, about 4.5 s the inventory and practice map, recomputed because the edit changed the facts), against the plugin's 20 s budget, which leaves about a factor of two: a slower machine can reach it. `drift mcp` keeps the facts of its last scan while no file in the repository changed (any edit, added or removed file reads it again): on that monorepo the first `drift_card` of a server took 9 to 15 s, later ones about 4 s, and `drift_check` about 0.1 s.
## Session state

Hooks keep state per session in `.drift/cache/sessions/<session_id>.json` (the id is reduced to letters, digits, `-` and `_`, at most 64 characters): the baseline, what was advised, rules already given, the block counter and the keys behind the facts above. Related files in that directory are `agent-hints.idx` (the search-hint index) and `clear-handoff.json`. State untouched for 30 days is deleted at startup, and temporary files left by a writer that died after an hour. Everything there is local: the directory has a `.gitignore` of `*` and is never committed. Deleting it mid-session is safe: the next Stop records a new baseline from files unchanged since `HEAD` and tells the person.

## Install and remove

The hooks ship as a Claude Code plugin; install the `drift` binary first, because the hooks run `drift` from your `PATH`:

```bash
claude plugin marketplace add dadbodgeoff/drift
```

```bash
claude plugin install drift@drift
```

`claude plugin marketplace add /path/to/a/checkout` installs from a local checkout instead. The plugin adds the hooks above, a skill (`integrations/claude-code/skills/drift/SKILL.md`, which tells Claude to ask `drift card` before reading sibling files) and the MCP server (its `.mcp.json` starts `drift mcp`). To remove the hooks, remove the plugin with Claude Code's own plugin commands (`claude plugin --help`); Drift writes nothing into Claude Code's configuration, so there is nothing of Drift's to clean up. The brief alone can be turned off with `agents: {brief: off}`; the hooks' other behaviour has no setting.

A plugin cannot ship permission rules, so the plugin's PreToolUse hook is what approves the read-only lookups. Without the plugin, write the same entries into `.claude/settings.json` with `drift export claude-settings --write .claude/settings.json` (see [Command Reference](Command-Reference)). The plugin's hook commands are plain `drift hook claude <Event>` lines, so wiring them by hand into another configuration is possible; that route is not documented or tested here.

## Trying a hook by hand

From the repository root, pipe the event Claude Code would send:

```bash
echo '{"session_id":"try","hook_event_name":"SessionStart","source":"startup"}' | drift hook claude SessionStart
```

Set `DRIFT_HOOK_TRACE=<file>` to have each hook append one JSON line (`event`, `path`, `answered`, `ms`) to that file: `path` is `single_file`, `full_scan:<reason>`, `skipped:<reason>` or `none`. It changes no behaviour.

Where a hook or a card quotes a `none` or an `internal`, it uses the same words as the command line: "no guard found in what Drift read", "internal in what Drift read", each with a count of what Drift saw and did not read.

See also: [MCP Reference](MCP-Reference), [Command Reference](Command-Reference), [Using Drift with Agents](Using-Drift-with-Agents), [Files Drift Writes](Files-Drift-Writes), [Configuration Reference](Configuration-Reference), [Troubleshooting](Troubleshooting)
