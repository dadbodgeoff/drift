# Dev relabel 6: the labelled mined pool of the 50 Python build-set repos (2026-11-10)

**Dev data, in-sample. Not a held-out run; it carries no verdict.** It is the labelled set the show table (`crates/drift-mine/data/show-policy.json`) is regenerated from in round 12 (python12, [`../../research/2026-11-10/python12.md`](../../research/2026-11-10/python12.md) §9). The TypeScript part is relabel 5's, unchanged.

## What is in this directory

Only the parts the show table reads: for each part, `views/d7/queue.json` (the cards) and `final.jsonl` (their labels). `show-policy.json` records the sha256 of each, and `show-policy.mjs --check` regenerates the table from them.

The census the parts were cut from (`census/`, a debug build of `3f2bd7b3`, sha256 `629981251dd142066a22edc93b9033e68b866b13495fc2e0b9c8171212db6d59`, run with `DRIFT_TEST_UNSHOWN=1 drift --root <clone> census --all-outliers --all --max 15 --python-proposals`) and the script that staged the parts from it (`stage.mjs`, with `--check`) are not in the tree: `git show 6d5df8d:eval/study/runs/dev-v3-relabel6-2026-11-10/<path>`.

## The parts

**Python: every card of the mined pool** (before the show table) of the 50 fold repos, each with a v3 label: the 18 scanned repos of `eval/repos-py.json` and `eval/repos-py-2.json`, the 8 of dev3 and the 24 of dev4. **139 cards: 79 ACCEPT, 2 TRIVIAL, 58 WRONG.** dev3 and dev4 joined the build set after their reports; their hidden families had no label until the two python12 rounds ([`../py12-pool-2026-11-10`](../py12-pool-2026-11-10/README.md), [`../py12-pool2-2026-11-10`](../py12-pool2-2026-11-10/README.md): their agreement and adjudication are kept there). A label is used only on a card whose text is the text its labeller saw (rule 4).

| Part | Suggestion cards | Of them Python (A / T / W) | From |
|---|---|---|---|
| `ts` | 117 | 0 | relabel 5's `ts`, byte for byte ([`../dev-v3-relabel5-2026-11-07`](../dev-v3-relabel5-2026-11-07/README.md)); not re-censused |
| `py` | 17 | 16 (10 / 0 / 6) | relabel 5's `py`, carried by rule 4 to the census: one card's text changed (fastapi `D-499c0e`) and is replaced by the card as it is now, with its python12 label (ACCEPT, as before) |
| `py2` | 60 | 42 (30 / 0 / 12) | relabel 5's `py2`: every Python card is byte-identical in the census |
| `py3` | 21 | 21 (7 / 2 / 12) | the dev3 mined pool: 2 cards labelled in dev3's own run, 19 in the python12 rounds |
| `py4` | 60 | 60 (32 / 0 / 28) | the dev4 mined pool: 3 cards labelled in dev4's own run, 57 in the python12 rounds |

## The table it gives

`node eval/study/show-policy.mjs --run eval/study/runs/dev-v3-relabel6-2026-11-10`. The bar, the cap and the hidden families are the tool's, unchanged: 60% of at least 5 labelled cards with any one repo left out; at most 1 outlier; Python `ordering` and `repo` hidden.

| Python family | Relabel 5 table | This table | Worst leave-one-repo-out | Admitted |
|---|---|---|---|---|
| naming | 11/12 | 15/18 | 81.3% | yes (as before) |
| control | 4/4 | 12/16 | 71.4% | **yes, new** |
| layering | 1/1 | 8/10 | 71.4% | **yes, new** |
| wrapper | 5/6 | 8/10 | 71.4% | **yes, new** |
| avoids_other | 0/1 | 3/4 | under 5 cards | no |
| calls | 7/11 | 8/15 | 46.2% | no |
| decorator | 4/7 | 7/13 | 40.0% | no |
| argument_key | 2/4 | 8/16 | 46.7% | no |
| base_class | 5/8 | 7/28 | 19.2% | no |
| import_source | 1/1 | 1/2 | under 5 cards | no |
| repo | 0/3 | 2/7 | – | hidden outright |

The TypeScript half of the table is identical (naming and control admitted).

## Deviations from how a dev round is staged

1. **Staged by the run's own script, not `prepare.mjs`.** The parts were assembled from existing records (relabel 5's parts, the dev3 and dev4 runs, the two python12 rounds) against a census kept as text. There is no `run.json`.
2. **TypeScript is not re-censused.** The `ts` part and the TypeScript cards inside `py` and `py2` are relabel 5's, so the TypeScript counts are relabel 5's by construction.
3. **dev3 and dev4 are in it.** A blind dev pool joins the build set after its report (PLAN-R10 §3.4). `show-policy.mjs` refuses a run that names a blind dev pool until that pool's report is in the tree (`lib.mjs` `BLIND_POOLS`, `runProblem`); both reports are in the tree, and `show-policy.mjs --check` finds the committed table byte-identical.
4. **The census is `3f2bd7b3`'s**, earlier than the branch head; later Python cards were not censused here.
