# python12, second labelling round: the unlabelled mined pool of the ten repos fetched later

> **Kept in the tree:** this README, `DEVIATIONS.md`, `agreement.md`, `adjudication/queue.json` and the final labels (`final.jsonl`). The queues, pool, prompts, A/B/C labels, `agreement.json`, `manifest.json` and `run.json` are at `git show 6d5df8d:eval/study/runs/py12-pool2-2026-11-10/<path>`.

The second part of the round described in [`../py12-pool-2026-11-10/README.md`](../py12-pool-2026-11-10/README.md). When the first queue was made, ten census repos of dev3 and dev4 were not on the machine ([`../../research/2026-11-10/python12.md`](../../research/2026-11-10/python12.md) §0.1). They were fetched at their pinned commits afterwards; this is their queue. With it, every Python card of the mined pool of the 50 fold repos at `3f2bd7b3` carries a label.

## Product and census

- **Binary.** The same debug build of `3f2bd7b3`, sha256 `629981251dd142066a22edc93b9033e68b866b13495fc2e0b9c8171212db6d59` ([`run.json`](run.json)).
- **Harness.** `prepare.mjs` and `lib.mjs` of the main branch at `06bb22ba`, which has the outlier-path parser fix; `run.json` records it. No kept card has an outlier path with a space, so the fix changes nothing here.
- **Census.** As in the first round: `DRIFT_TEST_UNSHOWN=1 node eval/study/prepare.mjs --drift <drift> --manifest manifest.json --run <run> --cache <cache> --python-proposals --drift-commit 3f2bd7b3`, which runs, per checkout, `census --all-outliers --all --python-proposals --max 15`, `census --all --python-proposals --max 200` and `init --max 200` with `--no-cache`.
- **Pins.** Each of the ten clones was checked against its pinned commit before use. Checkouts are full copies; the clones were never written.

## The queue

- [`queue-all.json`](queue-all.json): 25 cards from 6 repos, as prepared. [`queue.json`](queue.json): the **22** that are Python cards with no label in the tree, by the first round's rule. Left out: dev3 P09's naming card, which carries its dev3 label byte for byte, and two TypeScript cards.
- **Four of the ten repos have no card**: dev3 P10 and P12, dev4 P16 and P18. Their mined pool is empty, so they are in no file here.
- Keys continue the first round's numbering:

| Key | Set | Key there | Bucket | Cards |
|---|---|---|---|---|
| L18 | dev4 | P19 | flask | 1 |
| L19 | dev3 | P09 | django | 6 |
| L20 | dev4 | P17 | flask | 1 |
| L21 | dev4 | P22 | fastapi | 12 |
| L22 | dev4 | P21 | django | 1 |
| L23 | dev4 | P23 | django | 1 |

## Labelling

As in the first round, recorded by role: **A** the session's default model, one fresh agent per repo; **B** a different, smaller model, one fresh agent per repo, after A's output was collected; **C** a fresh agent that was neither, on the disagreements. Rubric v3.

| | |
|---|---|
| Labelled by both | 22 of 22 |
| Exact agreement | 81.8% (chance-corrected agreement is not reported under 30 cards) |
| Adjudicated by C | 4; C sided with A each time |

The full table is [`agreement.md`](agreement.md).

## Results ([`final.jsonl`](final.jsonl))

**11 ACCEPT, 2 TRIVIAL, 9 WRONG.**

| Family | ACCEPT / TRIVIAL / WRONG |
|---|---|
| control | 4 / 0 / 1 |
| base_class | 0 / 0 / 4 |
| argument_key | 2 / 2 / 0 |
| calls | 1 / 0 / 2 |
| layering | 1 / 0 / 1 |
| avoids_other | 2 / 0 / 0 |
| repo | 1 / 0 / 0 |
| wrapper | 0 / 0 / 1 |

WRONG by reason: `mixed_group` 7, `legit_outliers` 1, `incidental` 1. Both TRIVIAL cards are `framework`.

**Both rounds together, 77 cards: 37 ACCEPT, 2 TRIVIAL, 38 WRONG.**

## Deviations

[`DEVIATIONS.md`](DEVIATIONS.md), written by the lead: B's wrapper restates one rubric rule from the first launch; one B output's records went back to the same agent. As in the first round, the queue is a filter of the prepared queue, and three files name scratch paths.
