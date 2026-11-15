# Troubleshooting

This page lists common problems with Drift and how to fix them: a slow first run, no conventions proposed, a route that is not listed, `unknown` everywhere, hooks that feel slow, a config line `drift setup` will not edit, and the errors you may see in CI. Every fix here was tried against the current binary. It is for engineers who have Drift installed and something looks wrong.

## The first run is slow

**Symptom.** `drift init`, `drift census` or `drift check` takes much longer the first time than later.

**Cause.** The first run has no fact cache: every file is parsed. Later runs read only the files that changed. On the wiki's small fixture a warm `drift scan` took 0.06 s against 0.12 s uncached; on a large monorepo the CPU time was 5.1 s cold and 2.7 s warm (3,900 files), and 16.2 s cold on the largest development repository, on a shared 4-CPU machine (see [How Drift Works](How-Drift-Works), "How long it takes").

**Fix.**

- Run it once and let the cache fill: `.drift/cache/` (it ignores itself).
- Do not run with `--no-cache` unless you mean to.
- In CI, a fresh cache is used on purpose (see [Drift in CI](Drift-in-CI)); the cost is the parse. The GitHub Action also builds Drift from source on the first run, which takes several minutes; later runs use the cached binary.
- If the cache keeps rebuilding, look at whether `DRIFT_CACHE_DIR` changes between runs, and whether the Drift version changed (a new version, facts schema or lowering version starts a new cache directory; see [Versioning and Upgrades](Versioning-and-Upgrades)).
- Check what was skipped: `drift scan` prints `skipped:` and `parse errors:`.

## Commands take tens of seconds on a large repository

**Symptom.** On a repository of several thousand files, every command that reads the repository takes tens of seconds, a second run is not much faster, and interactive `drift setup` shows nothing before its first question.

**Cause.** Each of those commands reads the whole repository before it answers, and a warm cache did not make a later command fast. Measured on one monorepo of 5,858 files, with a warm cache: `drift check` 8.7 s, `drift security` 6.1 s, `drift practices` 15.6 s, `drift init` 24.7 s, `drift setup --list` 28.2 s, `drift setup --json --evidence` 41.7 s, and a `drift card` for one file 7 to 11 s. Interactive `drift setup` took about 24 s before its first question, and `drift setup --review` about 35 s. Nothing was hung.

**Fix.**

- Wait for the first question of `drift setup`. Do not type ahead: answers that arrive while Drift is still reading go to the next question.
- To answer several setup questions with one read, use `drift setup --answers answers.json` (an agent) instead of one `--answer` per command: each `--answer` reads the repository again.
- Do not turn the cache off (`--no-cache`).

## "No conventions found"

**Symptom.**

```
No conventions found: roles need roughly 20+ similar symbols where one pattern clearly dominates and is rarer elsewhere; the largest role here has 42 members (HTTP handlers in app/api/** (route files)).
```

**Cause.** This is normal. A convention needs a role of roughly 20 or more similar symbols where one pattern dominates, with a few exceptions, and where the pattern is rarer in the rest of the code of that kind. Small or uniform repositories often get none. Drift's own evaluation found most repositories yield no accepted convention (median zero). A role of 42 can still yield nothing, most likely because the pattern is not rarer in the rest of the code (the "lift" test): on the wiki's fixture, a repository of only 42 route files and nothing else yielded no convention, and adding 60 unrelated helper functions made the same routes qualify.

**Fix.**

- Nothing is wrong. `drift practices`, `drift security` and `drift card` need no conventions.
- If you expected a rule, check the evidence by hand: do at least 8 members share it, with the share's 95% lower bound at least 0.75 (0.9 for layering)?
- Check that Python proposals are not turned off (`proposals: {python: off}` in `.drift/config.yaml`), and that your code is not in a directory Drift treats as non-production (tests, stories, fixtures, `examples/`, `demo/`, `playground/`). `drift review --hidden` lists cards mining found and withheld, with the reason.
- In a monorepo, run `drift init` at the root so packages are mined in their own scope; `drift census` lists each package with its cards, or why it is silent.
- If `drift init` said `No conventions shown: Drift found N candidate(s) and none has a track record strong enough to propose`, the cards exist: `drift review --hidden` lists them, and `drift review --hidden --answer <id>=same` promotes one. A promoted suggestion reaches agents only after `drift review --show-to-agents <id>`. See [Getting Started](Getting-Started).

## A route is not listed

**Symptom.** `drift security`, `drift card` or `drift practices` does not show an entry point you know exists.

**Checks, in order.**

1. **Is the file read?** `drift scan` prints `skipped:` files; `drift security` names files "NOT READ" with the reason, for example:

   ```
   1 source file(s) NOT READ, so an entry point or a risky operation in one is not listed: lib/big.ts (too large)
   ```

   Files over 1 MB, minified or generated files, declaration files and files that are not UTF-8 are skipped.
2. **Is it ignored?** Drift respects `.gitignore` and `.ignore` files. A route under an ignored directory is not read. Test, story, fixture and demonstration code is left out of the inventory, with a count.
3. **Is the framework supported?** Entry points are listed only for the frameworks Drift has adapters for (see [Languages and Frameworks](Languages-and-Frameworks)). A route in another framework is not listed.
4. **Is it registered in a way Drift cannot see?** A route table handed to a helper in another file (`register(app, ROUTES)`) lists nothing. A table registered in a loop in the same file is listed under an unknown prefix (`?`).
5. **Does it parse?** `drift scan` shows `parse errors:`.
6. **Is it a command-line program or a queue consumer?** Those stay in the inventory (`local` in `--json`) but are not counted as having no guard.

`drift scan --json` has the full fact index, and `drift facts <file>` the facts for one file, if you need to see what Drift extracted.

## `unknown` everywhere

**Symptom.** Most routes read `unknown` for authorization (and perhaps authentication or exposure).

**Cause.** `unknown` is what Drift says where it cannot prove an answer. For authorization it is the common answer, because `known` needs a check read where it is and proven to run on every request (see [How Drift Works](How-Drift-Works)). For exposure it is common when a deployment description Drift does not read is in the repository, or when more than one stack describes a service.

**Fix, in order of effort.**

1. Read the reason: `drift card <file>`, or `drift practices --all`.
2. Answer the questions only you can: `drift setup` (a test stack to leave out; a Terraform target group to tie; a helper that is your check). See [Setup Questions](Setup-Questions).
3. Declare checks you have verified: `drift practices --hints`, then merge the lines you agree with under `practices:` in `.drift/config.yaml`. A declaration settles a route only where the route runs the check on every path.
4. Say so outright for exposure: `security.internal`, `security.public` and `security.not_deployed` in `.drift/config.yaml` ([Security Inventory](Security-Inventory)).
5. Accept that some will stay `unknown`. That is the correct answer where proof is missing.

## `none` or `internal` looks wrong

Treat both as "nothing found in what Drift read". On code Drift was not tuned on, a share are wrong. Each such answer ends with what Drift saw and did not read (`2 not read: ...`; in JSON `basis.not_read` and `exposure_basis.not_read`): look there first. Open the route's code and the files its reason names, and check the deployment before relying on `internal`. `drift investigate` lists every route Drift could not settle with the evidence to read, and an agent can work through it (see [Using Drift with Agents](Using-Drift-with-Agents#investigating-open-routes)). If you find a check Drift missed, you can declare it (`practices:`); if you find that a `none` is a real gap, that is the point of the finding. See [Accuracy and Limits](Accuracy-and-Limits).

## Hooks are too slow

**Symptom.** The agent pauses after an edit or at the end of a turn.

**Causes.** An edit of a file that has entry points reads the whole practice map, which costs a full scan (about 2 s on a 3,200-file monorepo, against 0.2 s for a file with no entry point; see [Hooks Reference](Hooks-Reference), "How long a hook takes"). The end-of-turn hook scans only when a file changed since a turn that had nothing to say.

**Fix.**

- Measure first. Set `DRIFT_HOOK_TRACE=<file>` and each hook appends one JSON line with the event, the path it took (`single_file`, `full_scan:<reason>`, `skipped:<reason>`), whether it answered, and how long it took in milliseconds:

  ```
  {"event":"SessionStart","path":"none","answered":true,"ms":294}
  ```

  It changes no output and is off by default.
- Keep the cache warm (do not set `--no-cache` in hooks) and put `.drift/cache/` on a fast disk (`DRIFT_CACHE_DIR` moves it).
- The session brief can be turned off with `agents: {brief: off}` in `.drift/config.yaml`.
- Hooks always exit 0 and never block the agent on failure. The time budgets are in the plugin's `hooks.json` ([Hooks Reference](Hooks-Reference)).

## The agent is told nothing about a convention

A default-tier proposal reaches no agent until a person accepts it. Check `drift review --list` or `drift census` for `agents: not shown to agents`, and accept it with `drift review --accept <id>`. Accepting a suggestion is not enough (every Python convention is a suggestion): a suggestion is shown only when its rule family is admitted (none is today) or you chose `drift review --show-to-agents <id>`. A `.drift/conventions.yaml` that does not parse also leaves agents with nothing: the hooks fail open with a note.

## `drift setup` refuses to write a config line

**Symptom.**

```
drift: .drift/config.yaml cannot be edited safely; add this under `security.not_deployed` yourself:
  - "e2e/stack.yml": `security.not_deployed` is written on one line (`not_deployed: "e2e/stack.yml"`), which drift setup does not edit
```

**Cause.** `drift setup` edits `.drift/config.yaml` in place and leaves everything else alone, so it refuses a key written in a form it does not edit: a list or map on one line (`security: {not_deployed: [a]}`) or a scalar where a list is expected. It exits 2 and writes nothing.

**Fix.** Rewrite the key in block form (`security:` then `not_deployed:` then `- "e2e/stack.yml"` on separate lines), or add the line it printed yourself, then run `drift setup` again. Separately, a key of the wrong type is ignored with a warning (`'security.not_deployed' must be a list of directories (ignored)`), and a file that is not valid YAML stops every command that reads it with exit 2, naming the line.

## A policy or config file does not parse

**Symptom.** `drift: parsing ./.drift/conventions.yaml: error: line 33 column 1: ...`, exit 2.

**Fix.** Open the file at that line (a merge conflict marker is the usual cause after a merge) and repair it, then run `drift check`. Commands that read the policy stop; the hooks fail open and tell the agent.

## Errors in CI

| Message | Cause and fix |
| --- | --- |
| `drift: no .drift/conventions.yaml: run drift init first` | the policy is not committed, or the job runs in the wrong directory; commit `.drift/conventions.yaml` and `drift.lock` |
| `--diff-base: base ref ... not found. Fetch it first` (exit 2) | the base branch is not fetched; use `fetch-depth: 0`, or let the Action deepen the clone |
| `fetch-depth: 0 needed` | a shallow clone lacks the merge base; use `fetch-depth: 0` |
| `drift` not found | the pre-commit hook and the hooks run `drift` from `PATH`; install it globally |
| the pre-commit hook does not run | it runs only when a commit stages TypeScript, JavaScript or Python files; a policy-only commit is not checked (`pre-commit run drift-check --all-files`) |
| the check passes locally and fails in CI (or the reverse) | the legacy count differs: your lock or policy is not committed, or the Drift versions differ. Pin both |
| code scanning upload fails | needs `security-events: write`; turn `upload-sarif` off for forks or private repositories without GitHub Advanced Security |

## The legacy count and the proposal count disagree

`drift.lock` covers every proposal, while `drift check` counts legacy violations of accepted conventions only, so its legacy count is smaller until you accept them all. Marking an outlier fine also removes it from the legacy count.

## Still stuck

Run the failing command with `--no-cache` to rule the cache out, and check `drift --version` against the `engine:` line in `.drift/conventions.yaml`. Report a bug through the repository; report a security issue privately through its Security tab (see [Security and Privacy](Security-and-Privacy)).

See also: [Getting Started](Getting-Started), [How Drift Works](How-Drift-Works), [Setup Questions](Setup-Questions), [Drift in CI](Drift-in-CI), [Hooks Reference](Hooks-Reference), [FAQ](FAQ).
