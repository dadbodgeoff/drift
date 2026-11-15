# Dev run at drift-main (2026-11-05): validation of the study scripts

**Dev set, not held-out.** These 16 repos (`eval/repos.json`) are the ones Drift was tuned on.

This run checks that `prepare.mjs`, `metrics.mjs` and `agree.mjs` reproduce the numbers of the first study ([STUDY-2026-11-05.md](../../../../docs/v2/STUDY-2026-11-05.md)) from its v1 labels ([labels.jsonl](../../labels.jsonl)).

## Commands

```sh
node eval/study/prepare.mjs --drift $SCRATCH/bin/drift-main --manifest eval/repos.json \
  --run eval/study/runs/dev-2026-11-05 --cache $SCRATCH/eval-cache --drift-commit 2e83ec29 --reset-clones
node eval/study/metrics.mjs --run eval/study/runs/dev-2026-11-05 --labels eval/study/labels.jsonl  > metrics-v1-labels.md
node eval/study/agree.mjs --a eval/study/labels.jsonl --b eval/study/second-opinion.jsonl          > agreement-v1-sample.md
node eval/study/recall.mjs sources --run eval/study/runs/dev-2026-11-05                            # recall/sources/
```

Settings:

- binary sha256 `a343b8633a87…`, `drift 0.1.0-dev`, built from main at `2e83ec29`. This commit was recorded with `--drift-commit`, not verified.
- census `--max 15 --all-outliers`; pool `--max 200`.

The proposal IDs are identical to the study's final census, for all 16 repos.

The run was re-prepared after the review fixes to PR #2. The proposal and pool files are byte-identical, and so are the numbers.

`--reset-clones` removed the `.drift/cache` that `eval/run.mjs` had left in the shared clones.

## Result

| | Study (after fixes) | This run |
| --- | --- | --- |
| Proposals shown | 181 | 181 |
| Labelled | 181 | **180** |
| ACCEPT / TRIVIAL / WRONG | 108 / 30 / 43 | 108 / **29** / 43 |
| Accept rate | 60% (108/181) | 60.0% (108/180) [52.7–66.9] |
| Not-wrong rate | 76% (138/181) | 76.1% (137/180) [69.4–81.8] |
| Per-family accept (wrappers, decorators, base classes, argument keys, layering, rendered components, calls, other avoidance) | 91, 59, 82, 69, 62, 54, 44, 31% | identical |
| Naming accept | 42% (10/24) | **43% (10/23)** |
| Agreement on the 40-proposal second opinion | 73%, κ 0.51, ACCEPT-vs-not 75%, WRONG 8/8 | 72.5%, κ 0.51, 75.0%, WRONG 8/8 |
| Over all 181 shown, unlabelled = WRONG | – | accept 59.7%, not-wrong 75.7% |

## The only difference, and why

`novu/D-b386b6` ("apps/dashboard: functions in src/hooks/** are named `use*`") has no label of its own.

- **Drift IDs are not unique across repos.** midday and novu both have an `apps/dashboard` package with a `src/hooks` dir, so the two proposals hash to the same ID.
- **The first study joined labels by ID alone.** novu's proposal therefore inherited midday's TRIVIAL label, without any reviewer opening novu.
- **The new scripts key every proposal as `<repo>/<id>`.** They report it as unlabelled.

That accounts for the one TRIVIAL, and for naming showing 10/23 instead of 10/24. Counted either way, the rates move by less than 0.3 points: accept 59.7–60.2%.

## Other observations

**Labels for proposals no longer shown.** 50 of the 230 labels in `labels.jsonl` are for proposals that only existed before the fixes. `metrics.mjs` ignores them.

**The "before" row cannot be reproduced.** The study reported 183 proposals and 52% accept before the fixes. No record says which binary produced that census. `drift-base` in the scratchpad is not it: it gives different proposals, and panics on trpc and immich. This is why every run now records the binary hash and the product commit.

**Default tier = everything shown, at drift-main.** The smallest role among the 181 shown proposals has 19 members, so a tier of ≥ 15 members changes nothing yet. With `--tier-min`:

| Tier | Proposals | Accept |
| --- | --- | --- |
| ≥ 15 members | 181 | 60.0% |
| ≥ 30 members | 153 | 59.9% |
| ≥ 50 members | 120 | 55.5% |

Role size alone is not a precision signal. The tier needs another definition, by rule family or by evidence, before "default-tier accept ≥ 95%" can mean something.

**Pooled intervals are too narrow.** Proposals in one repo are correlated. The repo-cluster intervals for accept (14 repos with proposals) are the honest ones: bootstrap 54.5–66.5%, cluster-t 53.3–66.7%. The κ of 0.51 on the 40-proposal sample has a repo-bootstrap interval of 0.15–0.77. That sample was too small to say much about agreement.
