# Agent A/B v2

The same Claude Code task with and without Drift, repeated, and scored on the whole session
rather than only on the final diff. It closes study gaps S4–S8 in
[`docs/v2/GAPS-2026-11-05.md`](../../../docs/v2/GAPS-2026-11-05.md); v1 (`../run.mjs`,
`../score.mjs`) is kept for the published 2026-11-05 numbers.

## Design

| | |
| --- | --- |
| Arms | **control**: the repo as is. **drift**: the reviewed policy committed, the Drift plugin (`integrations/claude-code`: hooks and skill, with a generated manifest) loaded with `--plugin-dir`, fact cache warm. Same prompt, tools, turn limit and model. |
| Sandbox | `sandbox.mjs`. The child's environment is an allowlist (PATH, a throwaway per-run HOME and TMPDIR, LANG, and API credentials only if set). `--restricted` confines the file tools to the checkout and ignores user/project/local settings; `--strict-mcp-config`; `--tools` names the only tools (Bash, Edit, Glob, Grep, Read, Skill, Write) and `--disallowedTools` the rest; Bash is pre-approved only for `ls`, `git status` and, in the drift arm, `drift check`/`drift example` (the `drift` on PATH refuses other subcommands and `--root`). The init message's tools, skills, plugins and MCP servers are checked before the first turn, also across arms (they may differ only by the Drift plugin); after the session, files modified outside the checkout (work dir, dev repo, harness repo, real HOME) make the run invalid. |
| Checkouts | `git clone --shared --no-checkout` of the dev repo per run, sparse (no media); the dev repo is not modified. At most 6 at a time, deleted after scoring. |
| Policy (S7) | Only conventions labelled ACCEPT in `eval/study/labels.jsonl` are accepted; every other proposal is rejected. The A/B measures the tiered product as shipped: accepted conventions block when `drift census --json` puts them in the default tier, and advise otherwise (suggestions and roles under 15 members; `--force` is never used). Built once per repo in `<work>/policy/<repo>/`, keyed on the drift binary's sha256, and refused unless the checkout is at the sha pinned in `eval/repos.json`, every proposal is labelled, the accepted set equals `policy-expect.json` `repos`, and the block-mode set equals its `block` (a drift build that renames or re-tiers conventions fails before any session runs). Its hash is in every `score.json`. |
| Tasks (S5) | `tasks.json`: 39 tasks in 8 repos, six categories (a edit next to existing code, b new area, c multi-file feature, d vague/pressure prompt, e refactor across roles, f three chained prompts with `--resume`). `verify-tasks.mjs` checks each target with `drift example` per convention and, for new files, on a stub copied from the convention's example (new-file matching ignores symbol kind), and bans words like convention/auth/Drift/pattern in prompts. |
| Recorder | A silent hook (`recorder.mjs`, PostToolUse and PostToolUseFailure, both arms, passed with `--settings`) snapshots files changed by every Write/Edit/MultiEdit/Bash call, and hashes `.drift/conventions.yaml`, `drift.lock` and `.claude/`. |
| Trajectory (S4) | `score.mjs` replays in recorder order: Write/Edit/MultiEdit from the transcript (checked against the snapshot, which wins on a mismatch or a missing `old_string`), every other change in a step's snapshot from the recorder (failed Bash, subagents, anything unexplained), and `drift check --format json` on the touched files after each step. |
| Security (facts) | `drift security --diff-base HEAD --json` on the final tree: entry points the run added that lack a guard most of their siblings have (and whether an accepted convention also says so), unguarded ones reaching a risky operation, risky operations and client leaks added. Facts, not violations: they fail nothing and are reported apart, paired by task like the rest. Null for a drift build without `security --diff-base`. |
| Metrics | final violations (v1's score); introduced at any point; fixed later; regressions (an existing symbol that satisfied a rule stops satisfying it, e.g. a route inserted between a decorator and its handler); a renamed violation counts once; legacy code that only moved (`moved_legacy`) is counted apart; suppressions; tampering (calls and final hashes); whether the hooks reported each introduced violation; hook latency; cost, turns, time. Runs that are invalid or whose replay disagrees with the final tree are excluded from rates and listed per arm. |
| Repeats and stats (S6) | `--repeats N` (default 5) per task × arm × model, seeded random order, `--jobs` parallel. `report.mjs`: the paired per-task difference with a bootstrap over tasks is primary (overall and per category); per-arm rates use a cluster bootstrap over tasks; fewer than 5 tasks prints "n too small". |
| Cost | Every `claude` call goes to `<work>/ledger.jsonl` when it returns (a resumed call reports the session's cumulative cost; the increase is recorded; a killed call is priced from its transcript). `--budget-usd` checks the ledger plus per-arm in-flight estimates. `estimate.mjs`: v1 mean cost per model × category × arm multipliers, or those observed in an earlier work dir (`--calibrate`). A unit without a score is retried up to `--max-attempts` (2); the dead attempt moves to `runs/<id>/attempt-<n>/`. |
| CI (S8) | Before a checkout is removed, `drift check` runs on the final tree as the GitHub action does (exit code, `--strict`, SARIF) into `runs/<run>/ci/`. `ci.mjs` re-derives it from the saved patch alone (control arm by default): "would Drift in CI have caught what the agent left?". |

## Use

**Before the next run:** tiering (PR #15) changed which accepted conventions block (20 of the 76 expected ACCEPT ids are suggestions and now advise), so policy hashes change. Re-verify the tasks against main with `verify-tasks.mjs --write-expect`, which regenerates `policy-expect.json` (`repos` and `block`), before the next run. Results from earlier runs used the untiered policy (block when `evidence.total >= 15`).

```sh
DRIFT=target/release/drift REPOS=<eval cache>/repos WORK=<dir>
node eval/agent-ab/v2/verify-tasks.mjs --drift $DRIFT --repos $REPOS --work $WORK   # --write-expect after a drift change
node eval/agent-ab/v2/selftest.mjs     --drift $DRIFT --repos $REPOS --work $WORK   # scorer and report, no model calls
node eval/agent-ab/v2/run.mjs --drift $DRIFT --repos $REPOS --work $WORK \
     --models haiku,sonnet,opus --repeats 5 --jobs 4 --budget-usd 700 [--dry-run]
node eval/agent-ab/v2/report.mjs --work $WORK --out $WORK/report.md
node eval/agent-ab/v2/ci.mjs --drift $DRIFT --repos $REPOS --work $WORK --arm control
node eval/agent-ab/v2/score.mjs --drift $DRIFT --repos $REPOS --work $WORK --run <id>   # rescore from artifacts
```

A stopped run resumes with the same arguments and the same drift binary (runs with a
`score.json` are skipped). The budget counts the whole ledger of `<work>`.
