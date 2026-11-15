# F10 freeze record and dev3 pre-registration (WS-F, PLAN-R10 §3.1 and §3.4)

This file is committed and pushed before any census of the dev3 blind pool, and before any label of it. It names no dev3 repo: the pool's repos appear only by opaque key, and only in the run directories `eval/study/runs/dev3-ts-2026-11-08` and `eval/study/runs/dev3-py-2026-11-08`.

## 1. The freeze F10

| Item | Value |
| --- | --- |
| Product commit `F10` | `5151e5cb40b980f3db61416662dadbcf47c2f1ba` (main, "Merge #131"), recorded by the lead as the round-10 freeze. No product change merges until the dev3 report is in. |
| Tree of `F10` | `89e1780dddf52f3798f85296a09515897e9f765a` |
| Binary | `build-verified.sh 67` of a worktree at `F10` (release, codegen-units 67 on the five workspace crates). The build tag check passed (`cgu67-5151e5cb-…`). |
| Binary sha256 | `bf33e175ede9283c26ba7cca1ac257820867e8874e5f76171bac63785db65b11` |
| Toolchain | cargo 1.97.0 (c980f4866 2026-06-30), rustc 1.97.0 (2d8144b78 2026-07-07) |
| Gates on `F10` (`gates.sh`, CGU 67) | `cargo fmt --check` OK; `clippy --all-targets -D warnings` 0 issues; `cargo test --all --locked` 879 passed, 0 failed (against a private verified debug binary, tag `gate67-5151e5cb-…`); `node --test eval/study/*.test.mjs` 173 pass, 0 fail; `select-holdout.mjs verify` OK for primary, heldout2 and dev3 |
| Tier | `eval/study/tier-d7.json` (sha256 `e695112de57a…`), frozen in both dev3 manifests; the census runs with `prepare.mjs --strict-tier`, so the product's `tier:` line must agree with it on every card. |
| Rubric | v3, labeller-facing text sha256 `79316bdc08a6…`, the text approved with D6. |
| Show policy | The product's own at `F10` (#129). The cards `census --max 15` prints are the cards shown. |

## 2. The pool and the census

- **Sets.** These are the current slot occupants of `eval/dev3-2026-11-08.json` (12 TS/JS) and `eval/dev3-2026-11-08-py.json` (8 Python), after their rule-1 swaps. Each repo is named by an opaque key in a derived census manifest inside its run directory. The tier, `max` (15) and `pool` (200) are as frozen.
- **Census.** `prepare.mjs` dev run on the binary above, with `--strict-tier`, one repo at a time. Each run directory's `start.json` is committed and pushed before its census.
- **Failures.** A repo that fails census or `init` is reported as a failure, with no swap (D3).

## 3. Labelling

- **Labellers.** Two fresh labellers per repo, A then B, never at the same time on one repo, with rubric v3:
  - A runs on the session's default model;
  - B runs on a different, smaller model.
- **Collection.** Outputs are collected with `collect.mjs --complete`. An INVALID or MISSING output is relaunched as a fresh agent; its output is never edited.
- **Agreement and adjudication.** `agree.mjs` runs before adjudication. C, a fresh agent that ran neither A nor B, adjudicates the disagreements only. `adjudicate.mjs --merge` then writes `final.jsonl`.
- **Unlabelled.** A card without a final label counts as WRONG in every rate.
- **Not measured.** Recall, extraction and matching are not measured, as for heldout2.

## 4. Measures (pre-registered)

Every rate is over all shown cards, with unlabelled counted as WRONG. Rates are computed per language by `metrics.mjs` (`by_language[]`, the language of the card, as metrics groups it). Each comes with its n, the Wilson 95% interval, and both repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos. The wider cluster interval is the one quoted.

1. **D1: default-tier accept, TS/JS.** ACCEPT / shown in the default tier (tier-d7). Python has no default tier under D7 and gets no D1 figure.
2. **D4: not-wrong, all shown, per language.** (ACCEPT + TRIVIAL) / all shown, both tiers.
3. **Per-card accept, per language and tier.** ACCEPT / shown for the default tier, the suggestion tier and all shown.
4. **Flag precision, per language and tier.** The verdicts counted are the per-outlier verdicts in the A and B label records of the shown cards. Flag precision is (`mistake` + `look`) / all of those verdicts. This is the definition of `research/2026-11-08/r10-history.mjs` §12 and PLAN-PAR secondary metric A. It is reported with its repo range; it has no target.
5. **Yield per repo, per language.** Accepted cards per repo (mean, median, repos with none) and shown cards per repo. Repos with no shown card count as zero.
6. **WRONG causes, per language.** `wrong_because` of the final WRONG labels, and the number of unlabelled cards.
7. **Also reported:** agreement (exact agreement, κ and the confusion matrix), the per-framework-bucket table, and failed repos.

## 5. The D12 dev3-check (PLAN-R10 §3.4, condition 2, verbatim)

> 2. **dev3-check.** dev3 has been censused at `F10` and labelled blind, and its point estimates meet all of these:
>    - TS default-tier accept ≥ 90% with ≥ 8 default-tier cards, so the D1 question can be asked at all;
>    - not-wrong ≥ 70% per language;
>    - the build-set in-sample figure is within 10 points of dev3's for each language. Beyond that, dev is still not predicting, and another dev round is the cheaper test.
>
> If condition 2 fails, there is no D12. dev3 joins the build set, and round 11 draws dev4.

**How each condition is judged** (point estimates; strict wherever the wording is open):

- **(a)** D1 for TS/JS is ≥ 90.0%, and the TS/JS default tier has ≥ 8 shown cards. With fewer than 8 cards, (a) fails whatever the rate.
- **(b)** D4 is ≥ 70.0% for TS/JS and for Python. A language with no shown card has no point estimate, so (b) fails.
- **(c)** For each language, |dev3 − build-set in-sample| ≤ 10.0 points. The dev3 figure is per-card accept over all shown, both tiers, unlabelled counted as WRONG. That is the definition of the in-sample figures #129 reported for the show policy at `F10`:
  - **TS/JS 93.5% (43/46)**;
  - **Python 100% (12/12)**.
  
  A language with no shown dev3 card fails (c).
- **The dev3-check passes** only if (a), (b) and (c) all hold.

**Reported beside them, with no verdict.** These are the other dev readings #129 reported for the same policy:

| Reading | TS/JS | Python |
| --- | --- | --- |
| Undo-named | 63.6% | 88.9% |
| dev-v3 | 69.2% | 85.7% |

## 6. Order

Steps run in this order:

1. This record, committed and pushed.
2. The start records, committed and pushed.
3. The census.
4. A, then B.
5. Agreement.
6. C.
7. The merge.
8. `metrics.mjs`.
9. The report.

Nothing of this file changes after step 2. A deviation is reported in the run READMEs, never edited in here.
