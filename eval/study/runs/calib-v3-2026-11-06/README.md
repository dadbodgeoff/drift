# Calibration relabel for rubric v3 (decision D6), 2026-11-06

**Dev set, not held-out.** This run relabels, blind and under [`RUBRIC-v3.md`](../../RUBRIC-v3.md), 63 dev proposals that already have final labels. It measures what decision D6 changes before the held-out run uses v3:

- **the v2→v3 label shift:** each uid's previous final label against its v3 final label;
- **A/B agreement under v3:** Cohen's κ, which should rise above the r2 rounds' κ 0.67 (TypeScript) and 0.64 (Python).

**Status: complete.** 61 of 63 uids are labelled (A, B and C where they disagreed); CTFd's 2 are excluded (see Results). The founder approved D6 on 2026-11-06 with these results in hand.

## What is in it

| Path | What it is |
| --- | --- |
| `stage.mjs` | the script that drew the sample and wrote everything below (deterministic: a fixed seed and sorted pools) |
| `tier-rows.mjs` | the default-tier rows of the Results, per tier definition (rule 5; D5 of PR #28) |
| `sample.json` | the seed, the tier definition, the forced uids and why, and the drawn uids per language and tier |
| `prior.jsonl` | each sampled uid's previous final label, with its round and the rubric it was labelled under (the comparison baseline; never shown to labellers) |
| `ts/`, `py/` | harness runs restricted to the sample, built like the r2 `relabel/` sub-runs: the source run's `run.json` with `run` renamed, `relabel_of` and `calibration` (the shift and agreement files; `metrics.json` then says `"kind": "calibration"`) added, the rule-kind tier, and `checkout` paths set; its `queue.json` filtered to the sample |
| `ts/prompts/label/A/*.md`, `py/prompts/label/A/*.md` | the rendered labeller-A prompts, rubric v3 (`prompts/index.json` records `rubric: "v3"` and the rubric's sha256 per prompt) |

The sources:

- **TypeScript:** `runs/dev-ts-r2-2026-11-05` on main (PR #25, merged as `1a7bcd1`). It was first staged from the PR branch at `19f7c70`; main's copy of the run is byte-identical, and restaging from it reproduces `ts/run.json`, `ts/queue.json`, `prior.jsonl` and `sample.json` exactly. Its 162 shown proposals, all labelled: 31 in round r2 under v2, 131 carried from earlier rounds.
- **Python:** `runs/dev-py-r2-2026-11-05` on main. Its 43 shown proposals, all labelled: 22 in round r2 under v2, 21 carried.

```sh
S=<scratch>; D=<scratch of the shared dev clones>
node eval/study/runs/calib-v3-2026-11-06/stage.mjs --ts-run eval/study/runs/dev-ts-r2-2026-11-05 --py-run eval/study/runs/dev-py-r2-2026-11-05 \
  --checkouts-ts $D/eval-cache/repos --checkouts-py $D/eval-py/repos --cache $S/lbx
node eval/study/prompt.mjs label --run eval/study/runs/calib-v3-2026-11-06/ts --labeller A --rubric v3
node eval/study/prompt.mjs label --run eval/study/runs/calib-v3-2026-11-06/py --labeller A --rubric v3
```

## The sample (63 uids: 37 TypeScript in 11 repos, 26 Python in 6 repos)

**Forced in (23).**

- **Every contradicted case named in D6 (14):**
  - restated decorator: twenty `D-6429a5`, `D-7e503c`; immich `D-4fc758`;
  - a key the callee's type requires: infisical `D-d9b44e`, `D-1b2542`; twenty `D-47b768`, `D-006db2`;
  - library primitives: dub `D-e25af3` (`<Footer>`), `D-a23ff8` (`<Preview>`), `D-3fad9a` (`<Text>`), `D-024a81` (`<Tailwind>`), `D-418256` (`<Container>`);
  - a few outliers of another kind: CTFd `D-560792`, `D-f6c1fb`.
- **Every A/B disagreement of the two r2 rounds (9):** ai `D-fc5ef7`, supabase `D-d8dcea`, novu `D-4512a2`, midday `D-efc6d4`, `D-98e729`; polar `D-fb4011`, netbox `D-310ec7`, saleor `D-e36ea5`, langchain `D-468530`.

**Drawn (40).** 10 per language and tier, at random (`lib.mjs` `shuffle`, seed `drift-rubric-v3-calibration-2026-11-06`). Each cell takes 5 from the uids whose current label comes from the v2-labelled r2 round and 5 from earlier rounds.

- **The tier** is rule 5's rule-kind tier, as in `eval/holdout-primary.json`, applied as a derived view. It is not pre-registered for these dev manifests.
- **polar is a mixed repo.** Its TypeScript-side proposals are in the Python run, where its run puts them.

| Language | Tier | Forced | Drawn (of them from r2) | In sample | Previous labels A/T/W |
| --- | --- | --- | --- | --- | --- |
| TypeScript | default | 13 | 10 (5) | 23 | 16/4/3 |
| TypeScript | suggestion | 4 | 10 (5) | 14 | 7/0/7 |
| Python | default | 3 | 10 (5) | 13 | 8/0/5 |
| Python | suggestion | 3 | 10 (5) | 13 | 7/0/6 |

**What "previous rubric" means.** `prior.jsonl` marks a label `v2` when it comes from the r2 rounds, which were labelled under v2 with the harness. Every other label is "pre-r2": the v1 study, or the #4 and #13 double-label rounds. Report the shift for the two groups separately: a pre-r2 → v3 change includes the v1→v2 change.

## Results

All figures are from the files in this directory: `shift*.md` (previous final label as "A", v3 final label as "B"), `ts/` and `py/` `agreement.md` and `agreement-drawn.md`, and `v3-final.jsonl`.

**A/B agreement under v3.**

| | v3, drawn 40 | v3, all labelled | v2 (r2 rounds) |
| --- | --- | --- | --- |
| TypeScript | κ **0.89**, 95.0% exact (20; [`ts/agreement-drawn.md`](ts/agreement-drawn.md)) | κ 0.93, 97.3% (37; [`ts/agreement.md`](ts/agreement.md)) | κ 0.67, 83.9% (31) |
| Python | κ **0.89**, 95.0% exact (20; [`py/agreement-drawn.md`](py/agreement-drawn.md)) | κ 0.90, 95.8% (24; [`py/agreement.md`](py/agreement.md)) | κ 0.64, 81.8% (22) |

Each language had one disagreement, adjudicated by C.

**The v2 → v3 shift** (61 uids; [`shift.md`](shift.md)). Rows are the previous final label, columns the v3 final label:

| previous \ v3 | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 19 | 0 | 18 |
| TRIVIAL | 0 | 0 | 4 |
| WRONG | 0 | 0 | 20 |

| Subset | Agreement with the previous label | Moved | File |
| --- | --- | --- | --- |
| drawn 40 | 72.5% (κ 0.49) | 11 of 27 ACCEPT → WRONG | [`shift-drawn.md`](shift-drawn.md) |
| forced 21 | 47.6% (κ 0.19) | 7 of 10 ACCEPT and 4 of 4 TRIVIAL → WRONG | [`shift-forced.md`](shift-forced.md) |
| previously labelled under v2 (29) | 82.8% (κ 0.66) | 5 of 16 ACCEPT → WRONG | [`shift-prior-v2.md`](shift-prior-v2.md) |
| previously labelled before r2 (32) | 46.9% (κ 0.21) | 13 of 21 ACCEPT and 4 of 4 TRIVIAL → WRONG | [`shift-prior-pre-r2.md`](shift-prior-pre-r2.md) |

- **Default-tier proposals,** ACCEPT before → under v3, under two tier definitions (each row says which):

  | Tier | Drawn | Forced |
  | --- | --- | --- |
  | **rule 5**: the rule-kind tier as pre-registered for the primary sets before D5 (`params.tier` of `runs/*/views/rule5/run.json`; here a derived view, not pre-registered) | 16/20 → 11/20 (TypeScript 9 → 6 of 10, Python 7 → 5 of 10) | 7/14 → 2/14 |
  | **D5**: `eval/study/tier-d5.json` with `lib.mjs` `tierOf` (#28) | 12/12 → 8/12 | 3/3 → 2/3 |

  - **The D5 rows:**
    - drawn: cal.com `D-441d0e`, `D-f26528`; documenso `D-55ae12`, `D-2a51e9`, `D-c3b713`; nest `D-f68b2a`; immich `D-c10e8e`; polar `D-31bf00`, `D-093712`, `D-f53bba`; netbox `D-cc1341`, `D-bc0c7d`;
    - forced: twenty `D-6429a5`, `D-7e503c`; ai `D-fc5ef7`.
  - **Reproducing.** [`tier-rows.mjs`](tier-rows.mjs) prints both rows and their uids.
    - Since #28 is merged, `node eval/study/runs/calib-v3-2026-11-06/tier-rows.mjs` prints both rows with no arguments.
    - The held-out manifests now hold D5's tier, so the script reads rule 5 from `runs/dev-ts-r2-2026-11-05/views/rule5/run.json`.
- **Nothing moved towards ACCEPT.** The rules whose direction notes allowed it (R4, R7, R8, R9) moved no label that way.
- **Rules.** Labeller A's `rules` on the 22 shifted uids: R2 21, R1 14, R5 5, R8 5, R7 4, R6 3, R9 1. Their v3 reasons: `mixed_group` 10, `legit_outliers` 8, `incidental` 3, `false_outliers` 1.
- **The named cases.**
  - Restated decorator: twenty `D-6429a5` and `D-7e503c` stayed ACCEPT; immich `D-4fc758` stayed WRONG, now `legit_outliers`.
  - Required key: infisical `D-d9b44e` and `D-1b2542` went ACCEPT → WRONG `mixed_group`, not to TRIVIAL as D6 expected. twenty `D-47b768` went TRIVIAL → WRONG `mixed_group` and `D-006db2` TRIVIAL → WRONG `false_outliers`.
  - react-email: all five are WRONG under v3.
  - ai `D-fc5ef7`, polar `D-fb4011` and langchain `D-468530` went ACCEPT → WRONG.
  - supabase `D-d8dcea` stayed ACCEPT.

**Caveats.**

- **In-sample.** The forced 21 uids, and the 53 r2 labels that the drawn sample partly reuses, were read while v3 was written. The held-out run is the out-of-sample test.
- **Labeller noise.** For the 29 uids last labelled under v2, previous-vs-v3 agreement (82.8%) is about the v2 A/B agreement. Their shift alone is therefore not clearly beyond what two v2 labellers would differ by. But all 5 of their changes go one way, ACCEPT → WRONG, which noise would not do.
- **Pre-r2 labels.** Their shift also includes the v1 → v2 change.
- **CTFd excluded.** Its labeller was stopped by a safety system, a false positive on capture-the-flag content. `CTFd/D-560792` (previously ACCEPT) and `CTFd/D-f6c1fb` (previously WRONG) have no v3 labels and are in none of the figures. Python therefore has 24 labelled uids, not 26.
- **Not a precision figure.** The sample is enriched with hard cases. `ts/metrics.md` and `py/metrics.md` are tables of this sample only, under a tier that is not pre-registered for it.

## Checkouts and blinding

- **Checkouts.** The labellers read the shared dev clones: TypeScript `<scratch>/eval-cache/repos/<name>`, Python `<scratch>/eval-py/repos/<name>`. Each was checked at its pinned sha and clean (`git status --porcelain --ignored` empty) when staged. Check them again after each labeller.
- **Outboxes.** `<scratch>/lbx/outbox/<uuid>/out.jsonl`. The path says nothing about the stage, the labeller, the repo, or that this is a calibration.
- **Blinding check of the A prompts.** No prompt contains:
  - a tier line, a rank or a previous label;
  - "calibration", "prior" or a round;
  - another repo's uids.

  Each prompt shows rubric v3 from "## The setting" on, without its study-history header.
- **The rubric's worked examples are made up** (`acme-*`). None of the dev cases above appears in `RUBRIC-v3.md`.

## Commands that were run (the operator launched the labellers)

```sh
C=eval/study/runs/calib-v3-2026-11-06
for L in ts py; do
  # launch ONE FRESH agent per prompt in $C/$L/prompts/label/A/; then:
  node eval/study/collect.mjs --run $C/$L --stage label
  node eval/study/prompt.mjs label --run $C/$L --labeller B          # rubric v3, kept from A's prompts
  # launch ONE FRESH agent per B prompt (preferably another model than A); then:
  node eval/study/collect.mjs --run $C/$L --stage label
  node eval/study/agree.mjs --run $C/$L --json $C/$L/agreement.json > $C/$L/agreement.md
  node eval/study/adjudicate.mjs --run $C/$L && node eval/study/prompt.mjs adjudicate --run $C/$L
  # launch one fresh agent per C prompt; then:
  node eval/study/collect.mjs --run $C/$L --stage adjudicate
  node eval/study/adjudicate.mjs --run $C/$L --merge                 # -> $C/$L/final.jsonl
done
```

## Analysis commands

```sh
C=eval/study/runs/calib-v3-2026-11-06
cat $C/ts/final.jsonl $C/py/final.jsonl > $C/v3-final.jsonl
# v2 -> v3 shift: previous final label vs v3 final label (confusion matrix and kappa between the two)
node eval/study/agree.mjs --a $C/prior.jsonl --b $C/v3-final.jsonl --json $C/shift.json > $C/shift.md
# the same for the subsets: forced / drawn, and previous rubric v2 / pre-r2
node -e 'const fs=require("fs"),P=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);
  for (const [n,f] of [["forced",p=>p.forced],["drawn",p=>!p.forced],["prior-v2",p=>p.prior_rubric==="v2"],["prior-pre-r2",p=>p.prior_rubric!=="v2"]])
    fs.writeFileSync(process.argv[2]+"/prior-"+n+".jsonl", P.filter(f).map(p=>JSON.stringify(p)).join("\n")+"\n")' $C/prior.jsonl $C
for n in forced drawn prior-v2 prior-pre-r2; do node eval/study/agree.mjs --a $C/prior-$n.jsonl --b $C/v3-final.jsonl > $C/shift-$n.md; done
# A/B kappa under v3 on the drawn 40 only (the forced 23 were chosen because they are hard)
for L in ts py; do for X in A B; do node -e 'const fs=require("fs"),d=new Set(fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).filter(p=>!p.forced).map(p=>p.uid));
  const dir=process.argv[2]; console.log(fs.readdirSync(dir).flatMap(f=>fs.readFileSync(dir+"/"+f,"utf8").trim().split("\n")).filter(l=>d.has(JSON.parse(l).uid)).join("\n"))' $C/prior.jsonl $C/$L/labels/$X > $C/$L/drawn-$X.jsonl; done
  node eval/study/agree.mjs --a $C/$L/drawn-A.jsonl --b $C/$L/drawn-B.jsonl > $C/$L/agreement-drawn.md; done
# tier tables under v3, for the sample only (not a dev precision figure: the sample is not random)
for L in ts py; do node eval/study/metrics.mjs --run $C/$L --json $C/$L/metrics.json > $C/$L/metrics.md; done
```

**Report:**

- the shift matrix (previous label × v3 label), overall and for the four subsets;
- per rule, the shifted uids that cite it in `rules`;
- A/B κ under v3: on all 63, and on the drawn 40 against the r2 κ;
- the default-tier accept rate of the drawn default-tier proposals, before and after.

**Caveats.**

- **In-sample.** The 53 r2 labels and the contradicted cases were read while v3 was written. The held-out run is the out-of-sample test.
- **Labeller noise.** A previous label against a fresh v3 label also differs by labeller variance alone. At the r2 κ, about one label in six differs between two v2 labellers. Only a shift beyond that, concentrated in the uids the rules name, is evidence of what v3 does.
- **This is not a precision figure.** The sample is enriched with hard cases, so its rates are not dev precision figures. To restate the dev figures under v3, relabel the full dev runs.
