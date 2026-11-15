# dev3 blind dev pool, TS/JS part: census at F10 and blind labelling (WS-F)

This is the dev3 run of PLAN-R10 §3.1, set `ts-dev3-2026-11-08`, with 12 repos. It was pre-registered in [`../../PREREG-F10-dev3-check.md`](../../PREREG-F10-dev3-check.md). The Python part is [`../dev3-py-2026-11-08`](../dev3-py-2026-11-08). The combined report, with the D12 dev3-check, is [`dev3-check.md`](dev3-check.md), produced by [`dev3-check.mjs`](dev3-check.mjs).

## Freeze

| Item | Value |
| --- | --- |
| `F10` | `5151e5cb40b9` (tree `89e1780dddf5`). `run.json` `drift.commit` records it (`--drift-commit`). |
| Binary | `build-verified.sh` at CGU 67, sha256 `bf33e175ede9283c26ba7cca1ac257820867e8874e5f76171bac63785db65b11` (`run.json` `drift.binary_sha256`) |
| Gates on `F10` | fmt OK; clippy 0; `cargo test` 879/0; study tests 173/0; `verify` OK ×3 |
| Tier and rubric | `tier-d7.json` (census `--strict-tier`); rubric v3, approved text |
| Order | Pre-registration `16de2f7`, then start records `55a283b` (both pushed), then census, A, B, agreement, merge, metrics |

## Pool and census

- **Repos.** The 12 current slot occupants of `eval/dev3-2026-11-08.json` (its `repos` after its 6 rule-1 swaps). Each is named by an opaque key, T01 to T18, in [`manifest.json`](manifest.json). `prepare.mjs` ran a dev run (role `dev`, `holdout: false`), one repo at a time, `--strict-tier`, max 15, pool 200.
- **Census status.** All 12 repos are `ok`; none failed.
- **Cards.** 12 cards from 5 repos (7 repos show none): 5 in the default tier and 7 suggestions.

## Labelling

- **Labellers.** One fresh agent per (labeller, repo), each in its own empty cwd:
  - A ran on the session's default model;
  - B ran on a different, smaller model, never at the same time as A on the same repo.
  - The lead keeps the model identifiers.
- **Collection.** Every output went through `collect.mjs`.
- **Agreement.** `agree.mjs` ran before adjudication: exact agreement 12/12, κ 1.0, no disagreements. So no C prompt was needed, and `final.jsonl` holds the agreed labels. No card is unlabelled.
- **Recall.** Recall, extraction and matching were not run, as for heldout2.

## Results

[`dev3-check.md`](dev3-check.md) and [`metrics.md`](metrics.md) give the full results; the main ones are below.

- **D1 / default-tier accept:** 20.0% (1/5); Wilson [3.6%, 62.4%]; cluster t [0%, 88.9%] over 4 repos.
  - Of the 5 default-tier cards:
    - 4 are layering (`avoids:import`): 1 ACCEPT, 1 TRIVIAL (lint), 2 WRONG (1 `mixed_group`, 1 `legit_outliers`).
    - 1 is a call wrapper: WRONG `mixed_group`.
- **Suggestion-tier accept:** 85.7% (6/7).
- **Per-card accept, all shown:** 58.3% (7/12).
- **D4 / not-wrong:** 66.7% (8/12); Wilson [39.1%, 86.2%]; cluster t [24.4%, 100%] over 5 repos.
- **Flag precision:**
  - default tier: 31.3% (5/16);
  - suggestion tier: 54.5% (6/11);
  - all: 40.7% (11/27).
- **Yield:** 7 accepted over 12 repos (mean 0.58, median 0, 8 repos with none); 1.0 shown per repo.
- **WRONG causes:** `mixed_group` 3, `legit_outliers` 1.

## Deviations

- **Census manifest by key.** The census ran from `manifest.json`, a keyed copy of the frozen manifest's current occupants. A dev run of `prepare.mjs` reads `repos`, not the `replaced` swaps, and the keys keep every path and message free of repo names. `manifest.json` records the frozen manifest's sha256 and core.
- **Start records.** `start.json` was written by hand with `held_out: false`, because `prepare.mjs` writes start records only for held-out runs. It was committed and pushed before the census.
- **Checkouts.** The shared disk ran low. I deleted the checkouts of the 7 zero-card repos after the census. The 5 checkouts with cards were deleted while the Python part was re-censused, then re-fetched at their pinned shas (each verified clean) before any label prompt was rendered. The census outputs were not touched.
- **A relaunch.** T18's first B output was INVALID: one record listed one other member file in `checked`, and rubric v3 needs two. It was moved aside unread and unedited, and a fresh B agent was launched with a new prompt, cwd and outbox. The second output was valid.
- **Isolation.** The checkouts, outboxes and working directories were under the operator's `scratchpad/dev3/`. Nobody building product opened them.
