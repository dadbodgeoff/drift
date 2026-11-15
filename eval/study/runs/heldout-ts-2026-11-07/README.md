# Primary held-out run, TypeScript/JavaScript (ts-primary-2026-11-05), 2026-11-07

**Status: reported (2026-11-07); the lead approved the step-9 report on PR #111.** Results are final and nothing is relabelled. The run directory is committed as runbook step 7 lists, with `techcheck.json` (runbook step 4).

## Freeze checklist (runbook, before step 3; decision D9)
| Item | Value | Check |
| --- | --- | --- |
| Product `F` (D9: the product tree) | main `29f4cd675c80b641bef411b219e3f9f330bdb785`. The tree outside `eval/` is `6c88cac98c0e971a0ad41bfc99e40ec742c0149f` | the run commit has the same tree outside `eval/`, and `git diff --stat 29f4cd6 <run commit> -- . ':(exclude)eval'` is empty |
| Run commit (`run.json` `drift.commit`) | `ab1a8f348039310fcf908f65b99cb6d90cc1f5e3` (tree `3de3267420f1…`). This is main `29f4cd6` plus eval-only commits: D9, the D9 reserves, the rule-1 swaps and a test fix | `prepare.mjs` builds it from `git archive` |
| Binary sha256 | `e199f1cfd067e232273c0ac61e9784335d27e5e28b85923d843e2c1c24dc991c`, the same for both runs and for every build of the product tree of `29f4cd6` made today (`prepare.mjs` at four eval-only commits, and the step-2 dry-run build). It differs from the runbook's `feefad6` hash because 132 files under `crates/` changed since `feefad6` | step 3: both `binary_sha256` equal, each equal to `sha256sum` of its copy |
| Verified build | `build-verified.sh` at codegen-units 49 has census `commit` `cgu49-29f4cd6-1794073594`. The run binary's census `commit` is null, because it is built from `git archive` with no `.git`. Behaviour probe: both binaries give a byte-identical `census --json --max 15` of a dev repo (minus `root` and `commit`), identical to `dev-v3-relabel4-2026-11-07`'s | — |
| Versions | facts schema 10; TS `LOWERING_VERSION` 36; Python `LOWERING_VERSION` 15; `cargo 1.97.0 (c980f4866 2026-06-30)`; `rustc 1.97.0 (2d8144b78 2026-07-07)`, LLVM 22.1.6, x86_64-unknown-linux-gnu; no user cargo config | `run.json` `drift.build` |
| Tier | `tier-d7.json` (sha256 `e695112de57a…`), decision D7; `params.tier_pre_registered: true`. This run is the D7 view: a held-out run has no derived view (`stage.mjs` refuses one) | step 0 checks 1 and 4; census `tier:` lines all equal `tierOf` |
| Rubric | v3, labeller-facing sha256 `79316bdc08a6…` (D6) | step 1 rubric line; `prompts/index.json` rubric `v3` |
| Decision log | D1–D9; D9 recorded and pushed before any held-out census | `select-holdout.mjs verify` passes |
| Manifest | `eval/holdout-primary.json`, `role: primary`, `max` 15, `pool` 200; core extended by D9 reserves; 10 rule-1 swaps in `replaced` | `prepare.mjs` history check; `select-holdout.mjs verify` |

## Steps and their results (counts only)
- **0. Freeze checks:** tier OK; sha256 OK; `verify` OK; rubric v3 approved text. Rerun on the swap commit: the same.
- **1. Gates on `29f4cd6`:** `cargo fmt` OK; clippy 0 issues; `cargo test --all` 765 passed, 0 failed; tier tests (cargo 10, node 15) pass. Node study tests: 99/99 at `29f4cd6` and 101/101 at the run commit.
- **2. Dry run on dev repos:** every command exited 0 at `29f4cd6`, and `dry-run.mjs check` ended with "recall match the synthetic rule".
- **3. Binary:** above.
- **4. Technical check:** at `29f4cd6`, reserves ran out (TypeScript/JavaScript 3 slots, Python 1), so decision D9 applied. The D9 reserves were drawn and committed before they were checked. All slots are filled.
- **5. Census:** `start.json` was committed and pushed (`06af9eb`); `git diff --stat` against the run commit lists only the two start records. 18 repos, every one `ok`, none failed (D3). 57 cards: 7 default tier (3 call wrappers, 4 layering, in 6 repos) and 50 suggestion, from 15 repos; 3 repos have no card.
- **6. Labeller A prompts:** rendered with rubric v3. Each has a fresh, empty working directory and a fresh outbox, outside every checkout and repository, under one neutral root in the operator's scratch. `collect.mjs --stage label --labeller A`: no problems, all waiting. Every checkout's `git status` was clean when the prompts were rendered.

## Labelling (to do)
- **Labellers.** A runs on the session's default model, and B on a different, smaller model. Each (labeller, repo) prompt gets one fresh agent, started in its `cwd` and given only its prompt. The lead keeps the model identifiers outside the repository.
- **Order.** `collect.mjs --stage label --labeller A --complete`, then `prompt.mjs label --labeller B` (B is rendered only after A is collected), then `collect.mjs --stage label --complete`, then `agree.mjs`, before adjudication (runbook steps 6–8).

## Deviations and notes
- **The agent A/B expectations** (runbook step 0) were not regenerated. The A/B is not part of this run (D9, point 4).
- **`drift.commit` is not `29f4cd6`.** The run commit is main `29f4cd6` plus eval-only commits. Under D9 it measures the product tree of `29f4cd6`, and the binary is identical.
- **The dry run (step 2) ran at `29f4cd6`,** before the D9 harness change. That change touches only `lib.mjs` `amendmentAllows` and `DECISIONS`, and `select-holdout.mjs`. The study tests, `pipeline.test.mjs` included, pass at the run commit. The dry run was not repeated because there was too little disk.
- **Relaunch notes (labelling deviation 1).** When `collect.mjs` rejected an output, the operator moved it aside unread and wrote a `retry_note` into the launch map: the validator's problem text, with repo names and paths replaced. The lead relaunched a fresh agent on the same prompt, in the same `cwd`. The relaunch prompts carried a paraphrase of that note, and from the 4th round a "state the role's scope first" instruction. The checklist says a relaunched agent gets only its prompt, so these notes are a deviation. Every note concerned the "What to open" evidence rule, almost always the two other member files of the role (once also `confidence` or outlier coverage), and none concerned a label. No output was relaunched for its labels or for effort. An effort check (reason length, duplicate reasons, number of checked files, never the label values) flagged none.
- **A padded `checked` list, disclosed (labelling deviation 2).** One relaunched B labeller of the TypeScript/JavaScript run disclosed that it listed files in `checked` that it had not read, from grep listings and suppressed output, and wrote its output with a script. The validator had rejected that output anyway. By the lead's decision it is discarded whatever the validator says, kept unread, and the agent is relaunched with an explicit honesty rule.
- **Undetectable padding (labelling deviation 3).** Other relaunched outputs may have padded `checked` in ways `collect.mjs` cannot detect, since it checks paths, not reads. Only A/B agreement, adjudication by C and the post-report transcript audit (checklist, "Not detectable from an output") mitigate this.
- **The validator was not changed during labelling.** The lead asked whether the "other members" rule could be met on every rejected card. By the validator's own role bound (`memberFileInfo`), all 87 distinct cards of the rejected outputs could meet it (78 bounded roles, each with at least 4 candidate files; 9 unbounded). The rule already asks for min(2, available), so nothing was amended.
- **Help with evidence locations on final relaunches (labelling deviation 4; lead decision).** The B rows of 3 repos (2 TypeScript/JavaScript, 1 Python) were rejected again and again on the "other members" rule. Their final relaunches came with a file per row that lists, for each card, up to 10 files the validator counts as other members of the role. These were computed by the validator's own role bound (`memberFileInfo`/`memberFileBound`), and for package roles they are other member packages' manifests. The file gives evidence locations only: no label, and no count beyond what the card shows. No accepted row received such a file.
- **A known validator limitation, to fix after the run.** For package-kind roles (`package_has`), the validator counts as another member only another package's manifest (`package.json`, `pyproject.toml`, `setup.py`, `setup.cfg`). Every other config file, `tsconfig.json` included, is "a config file" even when the card's rule is about that file, and the validator gives such roles no file bound. A labeller who honestly opens the other members' `tsconfig` files, the files the rule is about, therefore fails the rule unless it also lists two other member packages' manifests. A run never changes the validator after its start record (decision log), so the fix comes after the run: for a package role, count the member packages' files that the rule names.
- **The candidate lists are file-level (a limitation of deviation 4).** The candidate files come from the validator's role bound, which over-approximates the role's files from its selector (package, directory, file kind). It does not check membership, so it can list a file that holds no member of the role. A labeller in the Python run reported two such files on one card, and confirmed members from another in-scope file instead.
- **A held-out repo token reached the lead (rule 3).** A labeller's reply to the lead included what looks like a repo-name prefix on a card id (the uid form `<repo>/<D-id>`). The lead saw one held-out repo token this way and did not repeat it anywhere.
- **An operator collection error and two `--force` uses (labelling deviation 5).** The operator collected one TypeScript/JavaScript extractor's output after it had been unchanged for 20 s, while the agent was still writing (58 of its 276 records). `collect.mjs` then deleted the agent's outbox and working directory, as it does after every collection. The agent's rewrite was moved aside unread. By the lead's decision, E1 for that repo was re-rendered with `prompt.mjs extract --force`, with a fresh outbox and cwd, a fresh extractor was launched, and its output (271 records, matching its report) replaced the partial one with `collect.mjs --force --stage extract --labeller E1`. No other output was present for that stage and labeller when it ran. After this, outputs were collected only once the lead reported the agent done, and per labeller (`--labeller`). Every collected extraction's record count was checked against the count the agent reported: all 25 earlier collections and every later one match.
- **A matcher's reply exposed repository-internal paths to the lead (rule 3).** One TypeScript/JavaScript matcher's reply to the lead included match counts and repository-specific paths and item ids, beyond the requested path and record count. The lead did not open the repo or the output, and no label or score was affected.
- **Isolation.** The checkout and outbox paths in each prompt name this run as held-out (`heldout-…`) but give no tier, rank or label.
- **Costs** (wall clock, one machine): census 9 s (TypeScript/JavaScript) and 18 s (Python) of drift time; each release build took 2–5 min. Agent-session costs are not recorded yet.
## Post-report diagnostics (2026-11-07)

These diagnostics were run after the lead approved the step-9 report. **They never change `final.jsonl` or any metric:** nothing was relabelled and no figure above is recomputed from them. They name no repo and no repository path.

### (a) The 9 matched documented conventions labelled WRONG

For each conflict, the operator read the card, the A, B and C rationales and the matched documented item, and classified it.

| Class | Count |
| --- | --- |
| (i) Rule right, flagged members legitimate (WRONG for false outliers) | 2 |
| (ii) Rule right, wrong scope or mixed group | 4 |
| (iii) Bad match: the documented item is not the same rule | 2 |
| (iv) Stale or unenforced doc | 1 |
| (v) Labelling error | 0 |

1. **TS, default tier, call wrapper (i).** The doc requires the query-key factory, as the card does. But 5–6 of its 7 flagged members do call the factory (multi-line or indirect calls), so the card's outliers are false.
2. **TS, naming (ii).** The `*Keys` names follow the documented factory pattern. The role, however, also holds a non-key constant, which would be wrongly flagged.
3. **TS, ordering (iii).** The doc says which query keys a mutation invalidates and that callbacks are forwarded. It says nothing about call order, which the card's rule is about.
4. **TS, naming (iv).** The doc says validation files hold only validators. The code keeps several non-validator helpers there, so the doc is not followed.
5. **TS, try in controllers (i).** The doc requires try/catch in handlers. Both flagged controllers do it through a local helper.
6. **TS, naming (ii).** The doc names the per-language maps. The directory also holds facet-description tables, a different kind of export.
7. **TS, throws (iii).** The doc says errors must be the framework's error type. It does not say that every procedure throws, and the one flagged procedure has no error path.
8. **Python, registration call (ii).** The doc says new diagnostic codes must be registered. The flagged members are lookup tables, not codes.
9. **Python, naming (ii).** The doc names plugin classes. Plugin init files also hold helper classes.

Reading: no conflict is a labelling error. Six of the nine are cases where the documented rule is right and Drift's card is wrong: its outliers are false (2), or its scope is wider than the doc's (4).

### (b) Transcript audit of `checked` (checklist "Not detectable from an output")

- **What was audited:** every accepted label row, not a sample. That is 54 rows (A 24, B 24, C 6, both runs), with 210 records and 1,787 `checked` entries.
- **The transcripts:** for each row, the transcript of the attempt that wrote the collected output. These are the subagent transcripts of the lead's session, and they are on this machine.
- **Method:** a script listed the checkout files each transcript opened: the Read tool, content Grep, and shell read commands, with `cd` targets, shell variables and globs resolved. Each `checked` entry was then compared with that list.

| Category | Entries |
| --- | --- |
| Opened explicitly | 1,652 |
| Named in a read command the parser could not resolve (loops, quoted paths); 10 of 10 spot-checks were real reads | 112 |
| Seen only in a listing or grep output, never opened | 13 (in 10 rows) |
| **Never appears in any command or tool output: padding** | **10, in 3 records of 2 rows** |

The 2 padded rows are 1 A row of the Python run and 1 B row of the TypeScript/JavaScript run. This is apart from the B output that a labeller disclosed as padded, which was already discarded (labelling deviation 2). In the other 52 rows, every listed file was opened or named in a read command, apart from the 13 listing-only entries.

### (c) Overlap of the second extractor (E2) on the 6 E2 repos

The counts are over in-scope items (enabled, code-checkable).
- **Step 1, automatic pairing:** E1 and E2 items were paired one-to-one when they cite the same source file and have the same quote, or near lines and similar statements. A spot-check of 25 pairs found 25 correct.
- **Step 2, judgement:** the operator read each of the 186 items left unpaired against its 3 nearest items in the other list, and counted it as having a counterpart when the other list states the same rule (possibly at another granularity, or from another doc).

| Repo | E1 items with an E2 counterpart | E2 items with an E1 counterpart |
| --- | --- | --- |
| TS repo 1 | 91 / 95 | 95 / 135 |
| TS repo 2 | 88 / 89 | 87 / 91 |
| TS repo 3 | 66 / 66 | 69 / 74 |
| Python repo 1 | 52 / 52 | 50 / 58 |
| Python repo 2 | 160 / 165 | 168 / 180 |
| Python repo 3 | 74 / 89 | 56 / 70 |
| **All 6** | **531 / 556 (95.5%)** | **525 / 608 (86.3%)** |

E2 tends to extract more items, often from skill or guideline documents that E1 left out. The recall denominators above are E1's.
