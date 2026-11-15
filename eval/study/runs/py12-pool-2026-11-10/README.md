# python12, first labelling round: the unlabelled mined pool of 17 build-set Python repos

> **Kept in the tree:** this README, `DEVIATIONS.md`, `agreement.md`, `adjudication/queue.json` and the final labels (`final.jsonl`). The queues, pool, prompts, A/B/C labels, `agreement.json`, `manifest.json` and `run.json` are at `git show 6d5df8d:eval/study/runs/py12-pool-2026-11-10/<path>`.

The round python12 asked for ([`../../research/2026-11-10/python12.md`](../../research/2026-11-10/python12.md) §4): every Python card of the **mined pool** (before the show table) that carried no label in the tree, on the Python build-set repos that were on the machine at the time. The second round, [`../py12-pool2-2026-11-10`](../py12-pool2-2026-11-10/README.md), covers the ten repos fetched later. Build-set data: dev3 and dev4 joined the build set after their reports.

## Product and census

- **Binary.** A debug build of `3f2bd7b3` (`cargo build --locked -p drift-cli`), sha256 `629981251dd142066a22edc93b9033e68b866b13495fc2e0b9c8171212db6d59` ([`run.json`](run.json)). A debug build because the mined pool is read with `DRIFT_TEST_UNSHOWN=1` (`drift_mine::show::TEST_UNSHOWN_ENV`), which release builds do not read.
- **Harness.** `prepare.mjs` at `95938224` (the python12 workstream's branch; the study tools there are those of `3f2bd7b3`). Labelling tools (`prompt.mjs`, `collect.mjs`, `agree.mjs`, `adjudicate.mjs`) at the main branch as the lead ran them, with the parser fix of `06bb22ba` ([`DEVIATIONS.md`](DEVIATIONS.md) 1).
- **Census, as `prepare.mjs` runs a dev census**, one repo at a time, `--no-cache`, with `DRIFT_TEST_UNSHOWN=1` in the environment and `--python-proposals`:
  - `drift --root <checkout> --no-cache census --all-outliers --all --python-proposals --max 15` → `proposals/<key>.txt`
  - `drift --root <checkout> --no-cache census --all --python-proposals --max 200` → `pool/<key>.txt`
  - `drift --root <checkout> --no-cache init --max 200`, with `proposals: {python: on}` in the checkout's `.drift/config.yaml`; its `.drift/` removed again and the checkout verified clean → `proposals/<key>.yaml`
  - The whole command: `DRIFT_TEST_UNSHOWN=1 node eval/study/prepare.mjs --drift <drift> --manifest manifest.json --run <run> --cache <cache> --python-proposals --drift-commit 3f2bd7b3`.
- **Checkouts.** Full copies of the pinned clones, one per key; the pinned clones themselves were never written.

## The queue

- [`queue-all.json`](queue-all.json) is what `prepare.mjs` wrote: 65 cards from 17 repos.
- [`queue.json`](queue.json) is what was labelled: the **55** of them that are Python cards (`language: py` in `census --json`) and had no label on a byte-identical card in the tree (rule 4; the label sources are the v3 runs `dev-v3-2026-11-06`, `dev-v3-relabel3/4/5`, `dev3-py-2026-11-08`, `dev4-py-2026-11-09`). The 10 left out are cards that already carry a label and the TypeScript cards of these repos.
- The mechanisms of python12 add no card and change no card's text, so there is no second variant of any card.

**Repos.** Named by fresh opaque keys in every file a labeller saw; [`manifest.json`](manifest.json) pins each key's repository. The keys against the census manifests:

| Key | Set | Key there | Bucket | Cards |
|---|---|---|---|---|
| L01 | build (`eval/repos-py.json`) | fastapi | fastapi | 1 |
| L02 | dev3 | P04 | fastapi | 2 |
| L03 | dev4 | P24 | other | 2 |
| L04 | dev4 | P15 | flask | 3 |
| L05 | dev4 | P11 | fastapi | 5 |
| L06 | dev4 | P20 | other | 1 |
| L07 | dev4 | P07 | django | 1 |
| L08 | dev4 | P09 | fastapi | 2 |
| L09 | dev3 | P06 | flask | 4 |
| L10 | dev4 | P01 | django | 1 |
| L11 | dev4 | P13 | fastapi | 4 |
| L12 | dev4 | P10 | fastapi | 10 |
| L13 | dev4 | P02 | django | 8 |
| L14 | dev4 | P04 | django | 1 |
| L15 | dev4 | P12 | fastapi | 3 |
| L16 | dev3 | P01 | django | 6 |
| L17 | dev3 | P03 | fastapi | 1 |

L01 is one card of a fold-3 repo whose text changed since its last label (fastapi `D-499c0e`).

## Labelling

Rubric v3 (`79316bdc…`, the D6 text), prompts rendered by `prompt.mjs label` and `prompt.mjs adjudicate`. Recorded by role:
- **A:** the session's default model, one fresh agent per repo.
- **B:** a different, smaller model, one fresh agent per repo, launched after A's output for that repo was collected.
- **C:** a fresh agent that was neither, on the disagreements only.

The python12 workstream, which built the mechanisms and this queue, labelled nothing and did not open `labels/` or an outbox while labelling ran.

| | |
|---|---|
| Labelled by both | 55 of 55 |
| Exact agreement | 80.0% |
| Cohen's κ | 0.60 (bootstrap over 17 repos, 95% 0.37–0.81) |
| Gwet's AC1 | 0.73 (0.58–0.87) |
| Adjudicated by C | 11; C sided with A 7 times, with B 4 |

The full table is [`agreement.md`](agreement.md).

## Results ([`final.jsonl`](final.jsonl))

**26 ACCEPT, 0 TRIVIAL, 29 WRONG.**

| Family | ACCEPT / TRIVIAL / WRONG |
|---|---|
| base_class | 2 / 0 / 14 |
| control | 5 / 0 / 3 |
| argument_key | 4 / 0 / 4 |
| layering | 6 / 0 / 1 |
| decorator | 3 / 0 / 3 |
| wrapper | 3 / 0 / 0 |
| repo | 1 / 0 / 2 |
| calls | 0 / 0 / 1 |
| import_source | 0 / 0 / 1 |
| naming | 1 / 0 / 0 |
| avoids_other | 1 / 0 / 0 |

WRONG by reason: `mixed_group` 13, `false_outliers` 9, `incidental` 5, `legit_outliers` 2.

## Deviations

[`DEVIATIONS.md`](DEVIATIONS.md), written by the lead, who ran the labellers: the outlier-path parser fix and the recomputed `outlier_files` of four cards; seven B outputs rerun; single records sent back to the same B agent. The files it names beside the run (`queue*.before-outlier-fix.json`, `rejected/`) stayed in the lead's scratch and are not in the tree.

Also:
- **The queue is a filter of the prepared queue**, made by a script of the python12 workstream, not by `stage.mjs`: `stage.mjs` carries from one earlier run, and these labels come from six.
- **Paths.** `run.json`, `prompts/index.json` and `agreement.md` name scratch paths of the machine the round ran on.
