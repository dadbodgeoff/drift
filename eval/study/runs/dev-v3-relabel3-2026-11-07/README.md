# Dev relabel 3: the dev cards changed since their newest label, at main e9c6058 (2026-11-07)

**Dev data, in-sample. This is not a held-out run and carries no verdict.**

**Status: labelled (2026-11-07).** Every shown card has a v3 label: 41 relabelled blind (A default model, B Sonnet, C adjudicating disagreements), 217 carried. Results and deviations are at the end.

## What
This run stages a blind relabel, under rubric v3, of every dev card shown at main `e9c6058` whose newest label no longer fits.
- **Product.** Main `e9c6058` is after round 5 (#70–#83) and the tRPC default-import fix (#88, TS `LOWERING_VERSION` 31).
- **Coverage.** All three dev parts:
  - `ts`: the 16 repos of `eval/repos.json`;
  - `py`: 6 repos of `eval/repos-py.json`, without polar and CTFd;
  - `py2`: the 12 repos of `eval/repos-py-2.json`.

| Part | Shown | Default tier (shown / carried / to label) | Suggestion tier (shown / carried / to label) | To label |
|---|---|---|---|---|
| ts | 158 | 29 / 26 / **3** | 129 / 112 / **17** | **20** in 8 repos |
| py | 23 | 0 | 23 / 14 / **9** | **9** in 3 repos |
| py2 | 77 | 0 | 77 / 65 / **12** | **12** in 8 repos |
| **All** | 258 | 29 / 26 / 3 | 229 / 191 / 38 | **41** |

Cards to label, per repo:
- **ts:** cal.com 7, novu 5, supabase 2, midday 2, documenso 1, ai 1, immich 1, infisical 1.
- **py:** netbox 7, fastapi 1, langchain 1.
- **py2:** ralph 3, Django-CRM 2, InvenTree 2, Misago 1, paperless-ngx 1, open-wearables 1, tasking-manager 1, simplelogin 1.

By reason:

| Reason | ts | py | py2 |
|---|---|---|---|
| `new`: no label for the id | 4 | 1 | 4 |
| `outliers`: an outlier added or removed | 14 | 6 | 6 |
| `tier`: the D7 tier changed | 0 | 0 | 0 |
| `other`: another line changed (outliers and tier unchanged) | 0 | 2 | 2 |
| `example`: only the example changed (besides lift) | 2 | 0 | 0 |

### Which product change each card comes from
- **ts: 20 cards.** Every TS label is from `dev-v3-relabel2-2026-11-07`, at `feefad6`.
  - **#88 (tRPC):**
    - `cal.com/D-c54406` (default): 13 → 15 outliers, 2 added;
    - `cal.com/D-bcef5c`: new;
    - `cal.com/D-42ab67`: no longer shown.
  - **Round 5, new ids:** `supabase/D-e93eb6`, a new default-tier call wrapper; `cal.com/D-6c77ce`; `midday/D-b905f9`.
  - **Round 5, outliers removed:**
    - the 10 suggestion cards #83 changed;
    - `cal.com/D-d690c0` (7 → 6) and `novu/D-e79710` (36 → 33);
    - `ai/D-fc5ef7` (default, 1 → 0): its one outlier is now exempt as a factory.
  - **Only the example changed:** `cal.com/D-e5e923` and `midday/D-98e729`.
- **py and py2: 21 cards.** The Python labels are dev-v3's, at `debc33a`. `relabel2` was TS only, so Python cards that changed in round 4 (`debc33a`→`feefad6`) were never relabelled.
  - **Round 5:** `netbox/D-cc1341`, `netbox/D-bc0c7d` and `InvenTree/D-455913` changed, and `Django-CRM/D-b6f0b8` and `D-1a9f79` are new since `feefad6`.
  - **Round 4:** the other 16 cards are identical at `feefad6` and now. Together with `netbox/D-bc0c7d`, which changed in both rounds, they are exactly the 17 cards that `py-plan-2026-11-07/{py,py2}/join.json` holds unlabelled at `feefad6`.
  - **#88:** changed no Python card. The py and py2 cards, and every carry or relabel decision on them, are the same as in the `88d4030` staging; only the wording of the carry reason differs.
- **Cards that now list 0 outliers:** `cal.com/D-8d7d13`; `novu/D-2e9dcc`, `D-67ddb9` and `D-bdd970`; `ai/D-fc5ef7`; `netbox/D-cc1341`, `D-bc0c7d` and `D-e2c3e4`; `paperless-ngx/D-de2489`. All are still shown, so all are relabelled. `netbox/D-310ec7` had no outliers before either.

## Why
Round 5 and #88 changed outliers and added cards. The carried-only figures below count every such card as unlabelled, that is, as WRONG.

## Protocol
- **Product.** The run records commit `7d63aa31e2d2…`. That is this branch's merge of main `e9c6058`, and it differs from `e9c6058` only under `eval/study/runs/` (`git diff e9c6058 7d63aa3 -- . ':(exclude)eval/study/runs'` is empty), so the product is `e9c6058`'s.
  - **Binary.** Built by `build-verified.sh` with codegen-units 29. Its sha256 starts `a7456324d3ff…`, its census `commit` tag is `cgu29-7d63aa3-1794031224`, and `run.json` records `dirty: false`.
  - **Behaviour probe.** The #88 cal.com changes above are in the census.
- **Census.** `prepare.mjs` ran with `--all-outliers --max 15` and pool `--max 200`; all 34 repos were `ok`. `census-json/<repo>.json` holds `census --json --max 15` of each repo, from the same binary.
- **Checkouts and the dev clones.** Each repo was censused on a private checkout, made with `git fetch --depth 1 file://<dev clone> <pin>` into a fresh repository.
  - These checkouts have their own inodes; no `cp -al` copy was made. Each was deleted after its census. Everything ran one repo at a time, with a private `DRIFT_CACHE_DIR`.
  - The dev clones were only read, and each is at its pin.
  - The py2 clone `Misago` already held an ignored `misago/collections/__pycache__/…pyc` that no part of this run created; it was left alone. `stage.mjs` requires clean checkouts, so py2's labellers open private clean checkouts at the pins, made the same way: `<scratchpad>/co-800b9e/py2/<repo>`, kept for labelling. The ts and py labellers open the dev clones.
- **Newest label.** For each shown uid, the label comes from the first of these runs that has one:
  - ts: `dev-v3-relabel2-2026-11-07/ts`, then `dev-v3-relabel-2026-11-06/ts`, then `dev-v3-2026-11-06/ts`;
  - py: `dev-v3-2026-11-06/py`;
  - py2: `dev-v3-2026-11-06/py2`.

  The card is compared with that run's own census: its `queue.json` block and its `views/d7` tier. Every labelled card's repo is at the same pin as now, and every label is v3 at the approved rubric text.
- **Carry rule (the lead's decision, 2026-11-07).** A label is carried only when both hold:
  - the card's labeller-visible text (the census block without its rank and tier line) is byte-identical to the labelled card, except for the lift figure of its evidence line;
  - the D7 tier is the same.

  A changed example, or any other changed line, means a relabel. The reason is recorded as `example`, `outliers`, `tier` or `other`. Each carried row records `carried_card` and `carried_reason`. This is rule 4 plus lift and rank; `relabel2` carried byte-identical cards only. Of the 217 carried labels, 31 differ in lift only, five of them also in rank.
- **`other`: 4 Python cards.** Their outliers and tier are unchanged, but another line changed:
  - `netbox/D-76eb6b`, `netbox/D-310ec7` and `InvenTree/D-47d790` gained an `exempt:` line;
  - `simplelogin/D-2a4960` has a new summary, which now says "and lazy loads of peer or optional dependencies".
- **Superseded staging.** This run was first staged at `88d4030` (commit `fd08262`), under a wider carry rule that also let the example differ. That staging was replaced by this one before any labeller ran, and its prompts and outboxes were deleted. `restage.sh` reproduced the `88d4030` staging exactly from a second build, before this restage.
- **Blinding.** Each prompt holds only its own repo's uids, with no tier, rank, carried or relabel wording, and the outbox paths are neutral. The earlier labels of the cards to relabel are written nowhere in this run. Copy the prompts to neutral file names before launching, as `relabel2` did.
- **Labelling (to do).**
  - **Labellers.** A runs on the session's default model, B on a different, smaller model. Each (labeller, repo) prompt goes to one fresh agent, and B for a repo runs only after A's output for that repo is collected.
  - **Steps:**
    1. `collect.mjs` validates each output.
    2. `agree.mjs` records agreement before any adjudication.
    3. `adjudicate.mjs` and `prompt.mjs adjudicate` handle the disagreements; `adjudicate.mjs --merge` writes the labels.
    4. `node eval/study/stage.mjs final --run <part>` writes `<part>/final.jsonl` (relabelled + carried).
    5. `metrics.mjs` runs on `<part>/views/d7`.

## Files
| Path | What |
|---|---|
| `<part>/run.json`, `queue.json`, `proposals/`, `pool/` | `prepare.mjs` output |
| `census-json/<repo>.json` | `census --json --max 15`, same binary |
| `<part>/carried.jsonl` | the carried labels, with `carried_from`, `carried_card` and `carried_reason`: 138 ts, 14 py, 65 py2 |
| `<part>/relabel/{run,queue}.json` | the uids to label, and the checkouts the labellers open |
| `<part>/relabel/prompts/label/A/<repo>.md`, `prompts/index.json` | labeller A's prompts (B not rendered yet) |
| `<part>/views/d7/` | decision D7's tier as a derived view, and `metrics-carried-only.{md,json}` |
| `batches.json` | one batch per (labeller, repo): 19 repos × A and B = 38 |
| `stage.json` | per part and tier: shown, carried, and to label by reason; per card: source, outliers before and now, and what changed |
| `stage.mjs` | the staging: newest label, carry rule, relabel sub-run, D7 view, batches |
| `restage.sh` | the whole staging in one command, for a new main |

## Carried labels only: what is at stake
These come from `metrics.mjs` on `<part>/views/d7` with `--labels <part>/carried.jsonl`, with the cards to label counted as WRONG. The rate over the labelled cards alone is in brackets. For comparison, `relabel2` at `feefad6` read: default 93.1%; suggestion 40.3%; all shown 50.0% accept and 51.3% not-wrong.

| Part | Tier | Shown | Carried (A / T / W) | Unlabelled | Accept, unlabelled = WRONG | Not-wrong, unlabelled = WRONG | Best case (unlabelled = ACCEPT) |
|---|---|---|---|---|---|---|---|
| ts | Default | 29 | 26 (26 / 0 / 0) | 3 | **89.7%** [Wilson 73.6–96.4] (100% of labelled) | 89.7% | 100% |
| ts | Suggestion | 129 | 112 (49 / 2 / 61) | 17 | 38.0% [30.1–46.6] (43.8%) | 39.5% (45.5%) | 51.2% accept |
| ts | All shown | 158 | 138 (75 / 2 / 61) | 20 | 47.5% [39.8–55.2] (54.3%) | **48.7%** (55.8%) | 60.1% accept, 61.4% not-wrong |
| py | All (suggestion) | 23 | 14 (5 / 0 / 9) | 9 | 21.7% (35.7%) | 21.7% | 60.9% |
| py2 | All (suggestion) | 77 | 65 (20 / 0 / 45) | 12 | 26.0% (30.8%) | 26.0% | 41.6% |

- **TS default tier.** All three unlabelled cards are call wrappers:
  - `supabase/D-e93eb6`: new;
  - `ai/D-fc5ef7`: WRONG at `feefad6`, now with no outliers;
  - `cal.com/D-c54406`: ACCEPT at `feefad6`, now with 2 more outliers.

  `relabel2`'s other default-tier WRONG, `supabase/D-c2e88c`, is no longer shown. The default tier reads 29/29 if all three come back ACCEPT, 28/29 (96.6%) with one WRONG, 27/29 (93.1%) with two, and 26/29 (89.7%) with three.
- **TS suggestion tier.** Of its 17 cards to label, 11 were WRONG, 3 were ACCEPT and 3 are new. Each WRONG that turns ACCEPT adds 0.8 points to the suggestion tier and 0.6 to all shown.

## Restaging on a new main
`restage.sh` repeats the whole staging, from build to batches, in one command. A run is one frozen product, and `stage.mjs` never restages a run whose prompts exist, so the target must be a NEW run directory, or this one with its staging outputs removed before any labeller has run.

```sh
# a clean worktree at the main to measure
git worktree add /home/user/drift-wt/<name> driftv22/main
# optional, once this run is labelled: list the label runs newest first
#   eval/study/runs/<new-run>/sources.json  {"ts": ["dev-v3-relabel3-2026-11-07/ts", "dev-v3-relabel2-2026-11-07/ts", ...], "py": [...], "py2": [...]}
SCRATCH=<scratch folder> eval/study/runs/dev-v3-relabel3-2026-11-07/restage.sh /home/user/drift-wt/<name> <new-run> [CGU]
```

It runs these steps:
1. Build a verified release binary with `build-verified.sh`.
2. Census all 34 repos, one at a time: `prepare.mjs --only`, then `census --json`.
3. Pick the checkouts the labellers open: the dev clones, or private clean copies for a part that has an unclean clone.
4. Run `stage.mjs stage` (newest label, diff, carry or relabel, D7 view), render labeller A's prompts, and write `batches.json` and the carried-only metrics.
5. Check that every dev clone is still at its pin.

## Commands (this run)
```sh
git merge --no-ff driftv22/main          # e9c6058, as 7d63aa3
git rm -r <run>/{ts,py,py2,census-json,stage.json,batches.json}   # the superseded 88d4030 staging (never labelled)
SCRATCH=$S/relabel3prep eval/study/runs/dev-v3-relabel3-2026-11-07/restage.sh . dev-v3-relabel3-2026-11-07 29
```

## Results (labelled 2026-11-07, main `e9c6058`)

**These are dev-set figures, in-sample: the rules were tuned on these repositories. They are not held-out results and carry no verdict.**

Agreement before adjudication (A vs B, the labels C saw): ts 16/20, py 9/9, py2 10/12. C settled the 6 disagreements: siding with A 4 times and B 2 times.

| Part | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ts | Default (TS call wrappers + layering, D7) | 29 | 29 | 0 | 0 | **100.0%** [88.3–100.0], 8 repos | 100.0% |
| ts | Suggestion | 129 | 58 | 2 | 69 | 45.0% [36.6–53.6] | 46.5% |
| ts | All shown | 158 | 87 | 2 | 69 | 55.1% [47.3–62.6] | 56.3% |
| py (Python rows) | All shown (advise only) | 22 | 12 | 0 | 10 | 54.5% [34.7–73.1] | 54.5% |
| py2 (Python rows) | All shown (advise only) | 57 | 15 | 1 | 41 | 26.3% [16.6–39.0] | 28.1% |

For comparison, `relabel2` at `feefad6`: ts default 93.1% (27/29), suggestion 40.3% accept / 41.9% not-wrong, all shown 50.0% / 51.3%. The default tier's two WRONGs then (ai D-fc5ef7, supabase D-c2e88c) are fixed by round 5: D-fc5ef7 now reads ACCEPT with 0 outliers, D-c2e88c is gone and its successor D-e93eb6 is ACCEPT (by adjudication). Full tables: `<part>/metrics.json` (`metrics.mjs` on `<part>/views/d7` with `--labels <part>/final.jsonl`).

## Deviations

- **Two B outputs failed `collect.mjs` validation** (fewer than 2 other member files in `checked`): novu and cal.com. Each invalid output was moved aside, unread, and B was rerun as a fresh agent on the same rendered prompt, with one added sentence restating rubric rule 4 ("open and list in `checked` at least two other member files besides the example and the outliers"). The cal.com rerun failed the same check on one record (D-bcef5c, whose `checked` held only the example and outliers); that record went back to the same B agent, which opened two more members and kept its label. As in `relabel2`.
- **One stray file.** The tasking-manager B labeller also wrote a copy of its own output to its working directory, which was this repository's worktree. Labellers' working directory was the orchestrator's worktree (it holds the collected A labels). An audit of every A, B and C transcript found no tool call touching any path other than the agent's own repository checkout, its prompt and its outbox; no labeller read a label file. Future runs should start labellers in a neutral working directory.
- **ts agreement was first computed before cal.com's B was collected**, then recomputed with all 20 before the adjudication queue was written; `agreement.json` is the second computation, and the queue holds its hashes.

**Since then (2026-11-07, `ws/study-protocol-hardening`)**, the harness enforces what these three deviations relied on by hand:
- `prompt.mjs` gives every prompt a fresh, empty working directory outside any checkout (`cwd` in `prompts/index.json`), and `collect.mjs` rejects an output while that directory is not empty, when its outbox holds another file, when the checkout changed, or when a copy of its records sits in an untracked file of the Drift repository or under the outbox root;
- `collect.mjs` counts as other members only tracked, non-config files the role can have members in, and names each file it does not count;
- `agree.mjs`, `metrics.mjs` and `stage.mjs final` refuse while any repo lacks its A or B labels, unless `--allow-incomplete TEXT`, which they record. `restage.sh`'s carried-only metrics now pass it.

Nothing in this run was recomputed.
