# Blind relabel of changed TypeScript default-tier cards at main fcec231, 2026-11-06

**These are dev-set figures, measured in-sample, and not held-out.** Drift was tuned on `eval/repos.json`, so every figure here is optimistic. None is a headline result, and none gives a verdict on a target.

## What and why

[`runs/dev-v3-2026-11-06`](../dev-v3-2026-11-06/README.md) labelled every TypeScript dev proposal blind under rubric v3, at main `debc33a`. Main has moved to `fcec231`, and since then the product has changed some cards: a labeller sees the census block without its rank and its `tier:` line. A v3 label holds only for the card it was given. This run relabels, blind and under the same protocol, the TypeScript proposals in **decision D7's default tier** whose card is new or changed, then recomputes the D7 default-tier figures at `fcec231`.

| Part | Manifest | Repos | What it is |
| --- | --- | --- | --- |
| `ts/` | `eval/repos.json` | 16 | the TypeScript/JavaScript dev set, at main `fcec231` |

The D7 default tier at `fcec231` holds 29 proposals (`stage.json`):

| Card vs dev-v3 | n | Label used here |
| --- | --- | --- |
| identical | 10 | dev-v3's v3 final label, carried (rule 4) |
| **summary text only** (#49) | 10 | dev-v3's v3 final label, **kept** (see below) |
| new | 7 | **relabelled here**: cal.com `D-c54406`; documenso `D-32c861`, `D-a0eee5`; dub `D-345913`; infisical `D-c4efb8`, `D-f674a5`; midday `D-50255f` |
| changed | 2 | **relabelled here**: ai `D-fc5ef7`, supabase `D-c2e88c`; both were WRONG under v3 |

**The 10 wording-only cards keep their v3 labels.** Each differs from the card dev-v3 labelled only in its first line, the summary text changed by #49. Their evidence, example and outlier lines are byte-identical (`stage.mjs` checks this). All 10 are layering rules: formbricks `D-b8f1ee`; cal.com `D-2f232d`, `D-441d0e`, `D-31be39`, `D-f26528`; documenso `D-041293`, `D-7b5140`, `D-2a51e9`, `D-c3b713`; midday `D-b8cff6`. Every one was ACCEPT. Carrying them is the lead's decision for this round, and `carried.jsonl` marks each with `carried_card: "summary-only"`.

The two changed cards changed their outlier lines. In ai `D-fc5ef7`, 4 of the 5 `lib/` outliers became `exempt:` lines ("shared part used by N members"), and the evidence went from 109/114 to 109/110. In supabase `D-c2e88c`, the outlier `apps/docs/app/page.tsx` became an `exempt:` line (a framework root file), and the evidence went from 29/30 to 29/29.

**The suggestion tier is out of scope.** 76 suggestion-tier cards are identical and keep their v3 labels. 53 are new or changed, and they are left unlabelled. Only the D7 default-tier figures of this run are complete. Any all-shown or suggestion-tier figure in `views/d7/metrics.md` counts those 53 as WRONG, so it is not comparable with dev-v3.

21 dev-v3 uids are no longer shown at `fcec231` (`stage.json` `previous_not_shown`).

## Commands

```sh
S=<scratch>; D=<scratch of the shared dev clones>
# release build of main fcec231 in a private CARGO_TARGET_DIR (deleted afterwards):
#   cargo build --release --locked -p drift-cli  ->  $S/bins/drift-main-fcec231
# the shared dev clones are read-only: prepare.mjs ran on hard-linked copies of them ($S/relabel/cache/repos, deleted
# afterwards), which drift init writes into and cleans; every shared clone was clean at its pin before and after
export DRIFT_CACHE_DIR=$S/relabel/driftcache
node eval/study/prepare.mjs --drift $S/bins/drift-main-fcec231 --manifest eval/repos.json \
  --run eval/study/runs/dev-v3-relabel-2026-11-06/ts --cache $S/relabel/cache --drift-src .
node eval/study/runs/dev-v3-relabel-2026-11-06/stage.mjs stage --checkouts $D/eval-cache/repos --cache $S/lbx5
R=eval/study/runs/dev-v3-relabel-2026-11-06/ts; X=$R/relabel
node eval/study/prompt.mjs label --run $X --labeller A --rubric v3
#   one fresh agent per A prompt; then:
node eval/study/collect.mjs --run $X --stage label
node eval/study/prompt.mjs label --run $X --labeller B --rubric v3
#   one fresh agent per B prompt; then collect again
node eval/study/agree.mjs --run $X --json $X/agreement.json > $X/agreement.md
node eval/study/adjudicate.mjs --run $X && node eval/study/prompt.mjs adjudicate --run $X
#   one fresh agent per C prompt (dub only); then:
node eval/study/collect.mjs --run $X --stage adjudicate && node eval/study/adjudicate.mjs --run $X --merge
cat $X/final.jsonl $R/carried.jsonl > $R/final.jsonl
node eval/study/metrics.mjs --run $R/views/d7 --labels $R/final.jsonl --json $R/views/d7/metrics.json > $R/views/d7/metrics.md
node eval/study/runs/dev-v3-relabel-2026-11-06/family-d7.mjs     # -> views/d7/families.json
node eval/study/runs/dev-v3-relabel-2026-11-06/stage.mjs batches
```

Settings:

- **Binary:** sha256 `24ed92b6a8e7…`, `drift 0.1.0-dev`, built from main at `fcec231` with a clean tree (`run.json` records `dirty: false`).
- **Census:** `--max 15 --all-outliers`, with pool `--max 200`, as in every dev run. All 16 repos are `ok`, with 158 proposals shown.
- **Tier:** the product's census `tier:` line at `fcec231` equals `lib.mjs` `tierOf` under `tier-d7.json` for all 158 (`stage.mjs` stops otherwise). `views/d7/` applies D7 as a derived view, not pre-registered for this dev manifest, with the member count read back from `proposals/<repo>.yaml` as `view-d7.mjs` does.
- **Rubric:** v3, the approved text (sha256 `79316bdc08a6…`), recorded per prompt in `relabel/prompts/index.json`. dev-v3's prompts used the same text.
- **Checkouts:** the labellers opened the shared clones (`relabel/run.json`). Each was at its pinned sha and clean (`git status --porcelain --ignored` empty) when staged, and again after labelling.
- **Outboxes:** `$S/lbx5/outbox/<uuid>/out.jsonl`. The path says nothing about the stage, the labeller, the repo or the run.

## What is in it

| Path | What it is |
| --- | --- |
| `ts/run.json`, `queue.json`, `proposals/`, `pool/` | `prepare.mjs` output: every shown proposal at `fcec231` |
| `ts/carried.jsonl` | dev-v3 v3 final labels carried over (96: 86 identical cards, 10 summary-only), in `final.jsonl`'s row format with `source: "carried"`, `carried_source`, `carried_from` and `carried_card` |
| `ts/relabel/` | the harness run of the 9 uids: prompts (A, B, C), labels, `agreement.{md,json}`, `adjudication/queue.json`, `final.jsonl` |
| `ts/final.jsonl` | `relabel/final.jsonl` followed by `carried.jsonl` (105 records) |
| `ts/views/d7/` | the part under D7's tier: `run.json`, `queue.json`, `metrics.{md,json}`, `families.json` |
| `stage.mjs` | the script that wrote `carried.jsonl`, `relabel/{run,queue}.json`, `views/d7/{run,queue}.json`, `stage.json` and `batches.json`; it stops unless the relabel set is exactly the 9 uids above |
| `family-d7.mjs` | the D7 default tier per rule family, with the cluster intervals metrics.mjs gives pooled rates (`lib.mjs` `wilson`, `clusterBootstrap`, `clusterT`) |
| `stage.json`, `batches.json` | per tier: shown, carried, to label, unlabelled; per proposal: card status and action. The labeller batches |

## Labellers

- **One batch is one (labeller, repo) prompt, launched as one fresh agent:** 7 A prompts, 7 B prompts and 1 C prompt (dub). A and B of one repo never ran at the same time; `prompt.mjs` renders B only after A's output is collected.
- **Models.** Labeller A ran on the session's default model. Labeller B ran on a different, smaller model, chosen for independence, as in dev-v3. A and B were different sessions, and C was a fresh agent.
- **Blinding.** Each labeller saw only its prompt (the rubric and that repo's cards, without rank or tier line) and the checkout at its pin. None saw the previous label, the PR that changed the rule, or another labeller's verdict. None of the A prompts contains a tier line, a rank, "relabel", "carried", "calibration", "round" or "dev-v3", and each lists only its own repo's uids.
- **Isolation** is weaker than a sandbox: the agents run as the coordinator's user, so the outbox root is listable. The remaining controls are the sequencing, `collect.mjs` moving each output out, and the instructions.

## Protocol deviations

- **The census `--json` cross-check was not run.** A `drift census --json` pass over the shared read-only clones was blocked by a safety classifier. It was neither retried nor routed around. The cards come from `prepare.mjs`'s text census, as in every earlier run, and its `tier:` lines were checked against `tierOf` under D7 (0 mismatches).
- **B reran for cal.com and infisical.** Their first B outputs failed `collect.mjs` validation: `checked` listed fewer than 2 other members. They were discarded uncollected, and fresh B agents reran the same prompts. The records collected are the reruns'.
- **Agreement was computed from the unchanged A and B files** after C's output was collected. `agree.mjs` reads only `labels/A` and `labels/B`, so the figure is the one it gives before adjudication. `adjudicate.mjs --merge` checks the A and B label hashes recorded in `adjudication/queue.json`.

## Results (dev figures, in-sample, rubric v3, D7 tier)

**These are dev-set figures, measured in-sample, and not held-out.** No figure here gives a verdict on a target, since targets are judged on a primary held-out run only. Rates are over all shown default-tier proposals, with unlabelled proposals counted as WRONG (none are unlabelled in the default tier). Each cell gives the point estimate (k/n), then Wilson 95%, then the repo-cluster 95% intervals: percentile bootstrap / cluster-t, with the number of repos. Quote the wider cluster interval.

| D7 default tier, TypeScript | Accept |
| --- | --- |
| **All** (29) | **93.1%** (27/29); Wilson 78.0–98.1%; cluster 75.0–100.0% / 79.4–100.0% (8 repos) |
| Call wrappers (19) | 89.5% (17/19); Wilson 68.6–97.1%; cluster 62.5–100.0% / 69.0–100.0% (8 repos) |
| Layering (10) | 100.0% (10/10); Wilson 72.2–100.0%; cluster degenerate, 100.0–100.0% (4 repos, every one 100%) |

- **The 9 relabelled:** 7 ACCEPT, 2 WRONG.
  - ACCEPT: cal.com `D-c54406`, documenso `D-32c861` and `D-a0eee5`, dub `D-345913` (adjudicated), infisical `D-c4efb8` and `D-f674a5`, midday `D-50255f`.
  - WRONG: ai `D-fc5ef7` (`mixed_group`: the one counted outlier is a shared `lib/` factory helper like the exempt ones) and supabase `D-c2e88c` (`legit_outliers`: `app/**` holds other page files whose metadata is legitimately built otherwise). Both stay WRONG after their cards changed.
- **A/B agreement on the 9, before adjudication:** 8/9 exact (88.9%), Cohen's κ 0.73. The bootstrap interval over 7 repos is 0.00–1.00, so it is uninformative at n = 9. The one disagreement, dub `D-345913` (A ACCEPT, B WRONG), was adjudicated ACCEPT; C sided with A.
- **Sensitivity:**
  - Without the 10 wording-only cards: 17/19 (89.5%).
  - The 9 new labels alone: 7/9.
- **Against dev-v3:** its D7 default-tier figure was 24/32 (75.0%) at `debc33a`. It covered a different set of proposals, so the change is not a like-for-like comparison.
- **Sources:**
  - `ts/views/d7/metrics.md` (and `.json`) for the "All" row and the per-family Wilson intervals;
  - `ts/views/d7/families.json` for the per-family cluster intervals; its "all" row reproduces metrics.mjs;
  - `ts/relabel/agreement.md` for agreement.
- **Verification.**
  - `adjudicate.mjs --merge`, rerun, wrote a byte-identical `relabel/final.jsonl`.
  - `metrics.mjs`, rerun, reproduces `views/d7/metrics.md` byte for byte.
  - `ts/final.jsonl` holds every carried or relabelled uid once, all rubric v3.
  - `node --test` passes on every `eval/study/*.test.mjs`, and `select-holdout.mjs verify` passes.
