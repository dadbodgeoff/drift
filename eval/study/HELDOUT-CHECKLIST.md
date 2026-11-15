# Held-out run: labelling checklist

The short form of [HELDOUT-RUNBOOK.md](HELDOUT-RUNBOOK.md) steps 2 and 5–8, for one run directory. Run it once per run: the TypeScript/JavaScript run, then the Python run, or both side by side. It lists each command in order, the checks the command makes, and what to do when one fails. The runbook and the [README](README.md#held-out-rules) win where they differ.

## Placeholders

| Placeholder | What it is |
| --- | --- |
| `$MANIFEST` | the frozen primary manifest of this run (the runbook names both) |
| `$R` | this run's directory, `eval/study/runs/heldout-<lang>-<date>` |
| `$CACHE` | the cache with a few GB free, outside every checkout (`run.json` `params.cache`) |
| `<cwd>`, `<outbox>` | the working directory and outbox that `prompt.mjs` prints for each prompt |

Run every command from the root of the Drift checkout. Every command prints counts, statuses and paths, never labels.

## Before you start

- [ ] Runbook steps 0–4 are done: freeze checks, gates on `F`, the binary and its sha256, and the technical check.
- [ ] The dry run (runbook step 2) passed on this harness. It now runs `collect.mjs --complete`.
- [ ] `git status --porcelain --untracked-files=all` prints nothing. `collect.mjs` searches the untracked files of this checkout for stray copies of outputs.
- [ ] You know how to start an agent in a given working directory. Every agent starts in its prompt's own `<cwd>`, never in this checkout.

## Commands, in order

| # | Command | What it checks | If it fails |
| --- | --- | --- | --- |
| 1 | `node eval/study/prepare.mjs --manifest $MANIFEST --run $R --drift-src . --cache $CACHE` (twice: the first run writes `start.json`; commit and push it, then run again) | The held-out history, the manifest's registered core sha256, the tier (D7), the approved rubric text (D6), the frozen binary's sha256, and that every census `tier:` line matches. It also writes the start record before any census. | Stop. Do not swap repos. A repo whose census fails stays a reported failure (D3). |
| 2 | `node eval/study/prompt.mjs label --run $R --labeller A --rubric v3` | It renders one prompt per repo with the approved rubric text, which it refuses to change on a held-out run. It makes a fresh outbox and a fresh, **empty** working directory for each prompt, and refuses a root that is inside any git work tree, the Drift repository, `$R`, a checkout or the outbox root. It records `cwd` and the checkout's `git status`. | Pass `--workdir-root DIR` with a neutral directory. |
| 3 | Launch: one fresh agent per prompt, **started in that prompt's `<cwd>`**, given only its prompt. | Not automated. The prompt tells the agent to write nothing except `<outbox>/out.jsonl`. | — |
| 4 | `node eval/study/collect.mjs --run $R --stage label --labeller A --complete` | **Records:** the schema, the rubric, exactly the repo's uids, and `checked` (below). **Placement:** `<cwd>` is still empty, the outbox holds only `out.jsonl`, the checkout is unchanged, no copy of the records is anywhere else (untracked files of this checkout, the outbox root, other agents' working directories), the output is not byte-identical to another, and it carries no `labeller` or `rubric_sha256`. **`--complete`:** nothing is `MISSING`, and every repo has an A set. | `INVALID` or `MISSING`: move the output and any stray files aside unread, to a folder outside every checkout. Record it in `$R/README.md`, then relaunch a fresh agent on the same prompt in the same `<cwd>`, which is empty again. Never edit an output. |
| 5 | `node eval/study/prompt.mjs label --run $R --labeller B` | It renders B's prompt only for repos whose A output is collected, so A and B never work on one repo at once. B gets new outboxes and working directories. | — |
| 6 | Launch B as in row 3, on a different, smaller model than A. | Not automated. | — |
| 7 | `node eval/study/collect.mjs --run $R --stage label --complete` | Everything in row 4. Also, no B record repeats the reason of A's collected label of the same uid. **`--complete`:** every repo has complete A **and** B sets. | As in row 4. Do not go on until it exits 0. |
| 8 | `node eval/study/agree.mjs --run $R --json $R/agreement.json > $R/agreement.md` | It refuses while any repo lacks an A or B label, or has a label prompt that is not collected. It also refuses two rubric texts, and refuses to run once `adjudication/queue.json` exists. It records the sha256 of both label sets. | Finish row 7. `--allow-incomplete TEXT` only for a labeller that cannot run at all. It is recorded in both outputs, and it is a deviation. |
| 9 | `node eval/study/adjudicate.mjs --run $R` | It re-validates A and B under the same rules. It writes the queue only if `agreement.json` holds these labels' sha256 and no proposal lacks a label. | If a labeller cannot run: `--exclude-repos a --exclude-reason TEXT` (recorded, and those proposals count as WRONG). |
| 10 | `node eval/study/prompt.mjs adjudicate --run $R`, then launch C (a fresh agent, never an A or B session) in each `<cwd>`, then `node eval/study/collect.mjs --run $R --stage adjudicate --complete` | Everything in row 4, for C's records (`sided_with` included). | As in row 4. |
| 11 | `node eval/study/adjudicate.mjs --run $R --merge` | A and B are unchanged since the queue was written, every case is adjudicated, `sided_with` matches C's label, and there is one rubric text. It writes `final.jsonl`. | Stop and find out what changed. |
| 12 | (recall) `recall.mjs sources`, `prompt.mjs extract` / `match`, each agent launched in its `<cwd>`, `collect.mjs --stage extract\|match --complete`, `recall.mjs score` | Placement checks as in row 4. Match prompts are rendered only after `final.jsonl` exists. | As in row 4. |
| 13 | `node eval/study/metrics.mjs --run $R --json $R/metrics.json > $R/metrics.md` | It refuses while the A or B sets are incomplete (repos excluded at row 9 are left out of this check) and refuses any rubric text other than the approved one. | — |
| 14 | `node -p "const m = require('./$R/metrics.json'); [m.headline_eligible, m.tier.pre_registered, 'incomplete' in m].join(' ')"` | Must print `true true false`. | A `true` third field means metrics were forced on incomplete sets: not a headline. |

## What `collect.mjs` checks in `checked`

A record must list:

- the example's file;
- min(3, outlier files) of the outliers' files;
- min(2, the role's other files) further files that can hold a member of the role.

A further file counts only when it is a tracked file of the checkout, is not a lint, compiler, package or framework config, and, when the role's files can be bounded from its selector, is one of them. The message names each file it did not count, and why.

## Not detectable from an output: audit after the report

- **That each counted "other member" file holds a member of the role that follows the rule.** The census names only the example and the outliers. Take a sample of records (all of B's, say). Open each counted file at the run's pin, and find a member of the card's role that follows its rule.
- **That the agent opened every file it lists in `checked`.** Read the agent's transcript for a read of each file.
- **That the agent wrote nothing outside the places `collect.mjs` searches** (for example in its home directory). Read the transcript's tool calls, as `dev-v3-relabel3-2026-11-07` did.

Under rule 3, the audit is done by someone who does not work on the product, after the run is reported. Report its result next to the agreement.

## Never on a held-out run, except as a reported deviation

`--allow-partial`, `--allow-incomplete`, `--force` (collect or prompt), `--after-adjudication` (refused anyway), an edited output, or an agent started outside its `<cwd>`. Write each in `$R/README.md` under "Deviations", with the reason.
