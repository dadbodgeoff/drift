# Dev run, TypeScript, round 2 (2026-11-05): main after #20, #21, #22 and #23

**Dev set, not held-out.** This run covers the 16 TypeScript dev repos of `runs/dev-2026-11-05` (`eval/repos.json`), measured at main `ce38aea`. Drift was tuned on these repos, so every figure below is a dev-set figure: optimistic, and never a headline or held-out result.

Rule 4 of `eval/study/README.md` puts a new product version in a new run directory. Labels carry over only for proposals whose uid and census text are identical. Every other shown proposal was double-labelled blind in this round, the same way as `runs/dev-py-r2-2026-11-05` (#22).

## Commands

```sh
# release build of main ce38aea from a clean git archive, in a private CARGO_TARGET_DIR (deleted afterwards)
DRIFT_CACHE_DIR=$SCRATCH/tsr2/driftcache node eval/study/prepare.mjs --drift $SCRATCH/tsr2/bin/drift-ce38aea \
  --manifest eval/repos.json --run eval/study/runs/dev-ts-r2-2026-11-05 --cache $SCRATCH/tsr2/cache --drift-src .
R=eval/study/runs/dev-ts-r2-2026-11-05/relabel
node eval/study/prompt.mjs label --run $R --labeller A    # then collect, B, collect (per repo, A before B)
node eval/study/agree.mjs --run $R --json $R/agreement.json > $R/agreement.md
node eval/study/adjudicate.mjs --run $R                   # prompt.mjs adjudicate, C, collect --stage adjudicate
node eval/study/adjudicate.mjs --run $R --merge           # -> relabel/final.jsonl
node eval/study/metrics.mjs --run eval/study/runs/dev-ts-r2-2026-11-05 --json .../metrics.json > .../metrics.md
node eval/study/metrics.mjs --run .../views/rule5 --labels .../final.jsonl --json .../views/rule5/metrics.json > .../views/rule5/metrics.md
```

Settings:

- **Binary:** sha256 `151b79ddfc1a…`, `drift 0.1.0-dev`, built from main at `ce38aea` (clean tree).
- **Census:** `--max 15 --all-outliers`, pool `--max 200`. These are the parameters of `runs/dev-2026-11-05`. The manifest `eval/repos.json` (sha256 `4c0d030c…`) has not changed since that run.
- **Checkouts:** private clones of the shared read-only clones, at the pinned shas, verified clean after census and init. The shared clones were never written to. They are shallow, so `git clone --shared` set up no alternates and the objects were copied.
- **Cross-check:** `measure.mjs` at main writes census output byte-identical to `proposals/`. Before this round it gave 162 shown, 116 / 14 / 15 and 17 unlabelled, which are #21's figures.

## What was labelled

The census at main shows 162 proposals:

| Repo | dub | twenty | formbricks | cal.com | documenso | excalidraw | create-t3-app | ai | trpc | nest | supabase | node-express-boilerplate | novu | immich | midday | infisical |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Proposals | 15 | 15 | 15 | 15 | 15 | 2 | 0 | 6 | 0 | 5 | 15 | 0 | 15 | 14 | 15 | 15 |

Each uid's last label in `eval/study/labels.jsonl` (later lines win) was checked against the census it was labelled on. A label counts as stale when the proposal's wording, holders/total or outlier lines differ from that census. This is the comparison `measure.mjs` makes.

| Labelled in | Census it was labelled on |
| --- | --- |
| lines 1–230 (v1 study) | `runs/dev-2026-11-05/proposals/` (`2e83ec2`) |
| lines 231–287 (#4), 54 of them | drift at `eb7e330` (#4's results comment) |
| lines 231–287 (#4): dub `D-a23ff8`, `D-418256`, nest `D-3915b0` | drift at `410af23` (#4's final comment) |
| lines 288–292 (#13) | drift at `05054b2` |

The three older binaries were rebuilt only for this comparison. Their censuses reproduce the record:

- 162 shown at `eb7e330` and 164 at `410af23`, as #4 reports;
- each census contains every id labelled on it.

**31 uids were labelled in this round:**

- **Unlabelled (17).** This is #21's list:
  - twenty `D-868e25`;
  - formbricks `D-3cabc8`;
  - cal.com `D-f26528`, `D-554063`, `D-e5e923`;
  - documenso `D-aafe01`;
  - supabase `D-c59437`;
  - novu `D-4512a2`, `D-dbba9a`, `D-808edd`;
  - immich `D-d7122f`;
  - midday `D-ef5012`, `D-d1b6ba`, `D-efc6d4`, `D-98e729`, `D-495f56`, `D-f6c709`.
- **Members changed since their last label (12).** This is exactly #16's "members changed, relabel" list. It had never been relabelled.
  - formbricks `D-514f45`;
  - documenso `D-55ae12`, `D-d51d70`, `D-d19fc6`;
  - excalidraw `D-553404`;
  - ai `D-fc5ef7`;
  - supabase `D-b10f47`, `D-922bc7`, `D-db9d80`, `D-e97861`, `D-3c4b60`, `D-d8dcea`.
- **Wording changed (2).** cal.com `D-441d0e` and documenso `D-c3b713`, both layering rules:
  - They have v1 labels, but neither was in the top 15 at `2e83ec2`. They were in that run's pool, without the "(declared dependencies excepted)" that #4 added.
  - `measure.mjs --baseline` compares only ids that are present in the baseline census, so it never flagged them.
  - Their members and outliers are unchanged.

The other 131 shown proposals keep their earlier labels (`source: "carried"`).

`relabel/` is a harness run restricted to the 31 uids:

- `run.json` is this run's `run.json`, with `run` renamed and `relabel_of` added;
- `queue.json` is this run's queue, filtered to those uids;
- `prompt.mjs`, `collect.mjs`, `agree.mjs` and `adjudicate.mjs` ran on it unchanged.

## Labellers

- **Who labelled.** A, B and C were each a fresh subagent with no shared context, launched by the coordinating session. Each one got only its rendered prompt (`relabel/prompts/`), read access to the checkout and its outbox.
- **Models.** The model of each labeller was not recorded per labeller.
- **Order.** A and B of one repo never ran at the same time.
- **Midday.** Both A and B had to fix their member checks for midday once before their output was collected.
- **Blinding check.** The A prompts were checked before launch. None contains a tier line, tier or suggestion wording, a rank number, another labeller's label, or text about rounds or carried labels. Each lists only its own repo's uids.
- **Isolation is weaker than a sandbox.** The agents ran as the same user as the coordinator, so the outbox root was listable. The controls were the sequencing, `collect.mjs` moving each output out, and the instructions.

## Agreement and adjudication (`relabel/agreement.md`, before adjudication)

| | |
| --- | --- |
| Proposals labelled by both | 31 |
| Exact agreement | 83.9% (26/31) |
| Cohen's κ (3 labels) | **0.67** (substantial), repo-cluster bootstrap 95% 0.43–0.90 (10 repos) |
| Label mix | A 18 ACCEPT / 13 WRONG; B 19 ACCEPT / 12 WRONG; no TRIVIAL |
| Disagreements | 5 |

C adjudicated the 5 disagreements. It sided with A three times and with B twice:

| uid | A | B | C (final) |
| --- | --- | --- | --- |
| ai `D-fc5ef7` | ACCEPT | WRONG | ACCEPT |
| supabase `D-d8dcea` | WRONG | ACCEPT | ACCEPT |
| novu `D-4512a2` | ACCEPT | WRONG | WRONG |
| midday `D-efc6d4` | WRONG | ACCEPT | WRONG |
| midday `D-98e729` | WRONG | ACCEPT | WRONG |

**New labels (31): 18 ACCEPT, 13 WRONG.**

The 14 changed proposals:

| Old → new | Count | uids |
| --- | --- | --- |
| ACCEPT → ACCEPT | 9 | cal.com `D-441d0e`; documenso `D-55ae12`, `D-d51d70`, `D-c3b713`; excalidraw `D-553404`; ai `D-fc5ef7`; supabase `D-db9d80`, `D-e97861`, `D-3c4b60` |
| ACCEPT → WRONG | 3 | formbricks `D-514f45`, documenso `D-d19fc6`, supabase `D-b10f47` |
| TRIVIAL → WRONG | 1 | supabase `D-922bc7` |
| TRIVIAL → ACCEPT | 1 | supabase `D-d8dcea` |

The 17 previously unlabelled proposals: 8 ACCEPT, 9 WRONG.

## Labels

- `relabel/final.jsonl` is the harness merge for the 31 uids.
- `final.jsonl` is every shown uid (162):
  - the 31 new labels, tagged `"round": "2026-11-05 ts-r2"`;
  - the 131 carried labels, with `source: "carried"`, `carried_from: "eval/study/labels.jsonl"` and, where they had one, their original `round`.
- The 31 labels are also appended to `eval/study/labels.jsonl` in the row format of #13 (`round: "2026-11-05 ts-r2 double-label"`, `a`, `b`, plus `c` and "(adjudicated)" for the 5 adjudicated rows), so that `measure.mjs` scores them. With them, `measure.mjs` at main reports 162 shown, 122 / 12 / 28, 0 unlabelled.
- No shown proposal is unlabelled.

## Results

`final.jsonl` covers every shown proposal. So the rates over labelled proposals only and the rates over all shown, with unlabelled counted as WRONG, are the same.

**Default tier = rule 5's rule-kind tier.** A proposal is default tier when its rule kind is in {`wrapped_by:call`, `wrapped_by:decorator`, `wrapped_by:extends`, `passes_key`, `avoids:import`, `renders`, `wrapped_by:jsx`} and its role has ≥ 15 members.

- **Not pre-registered for this dev manifest.** `eval/repos.json` has no `tier`, so `prepare.mjs` recorded `min_members 15` in `run.json`.
- **Applied through a derived view.** The rule-kind tier is applied in `views/rule5`: this run's `queue.json` with `params.tier` replaced by the definition #22 used. The view's `run.json` (and this run's) carries `params.tier_pre_registered: false`, so `metrics.mjs` reports the tier as not pre-registered (`tier.pre_registered: false` in `metrics.json`). Until 2026-11-06 it printed "pre-registered" for any `run.json` with a tier; the metrics were re-scored then, with unchanged rates.
- **Same tier as #21.** It puts 92 of the 162 in the default tier, the same count #21 reports.

| | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- |
| **Default tier** | 92 | 77 | 5 | 10 | **83.7%** [74.8%–89.9%] | 89.1% [81.1%–94.0%] |
| Suggestion tier | 70 | 45 | 7 | 18 | 64.3% [52.6%–74.5%] | 74.3% [63.0%–83.1%] |
| **All shown** | 162 | 122 | 12 | 28 | **75.3%** [68.1%–81.3%] | 82.7% [76.2%–87.8%] |

Wilson 95% intervals. Proposals within one repo are correlated, so quote the wider repo-cluster interval (`views/rule5/metrics.md`):

| | Accept: bootstrap / cluster-t | Not-wrong: bootstrap / cluster-t | Repos |
| --- | --- | --- | --- |
| Default tier | 74.7%–93.0% / 72.9%–94.5% | 82.3%–95.6% / 81.4%–96.9% | 12 |
| Suggestion tier | 50.8%–76.0% / 50.0%–78.6% | 61.3%–85.9% / 60.0%–88.6% | 13 |
| All shown | 68.2%–82.7% / 67.1%–83.5% | 76.6%–88.6% / 75.9%–89.6% | 13 |

**`metrics.md` at the run root uses the recorded tier, ≥ 15 members.** Under it, all 162 proposals are default tier: 75.3% accept, 82.7% not-wrong.

### Before and after this round

The census is the same; only the labels differ. The "before" rows score this census with `labels.jsonl` as it was at #21. They reproduce #21's figures.

| | Before: labelled only | Before: unlabelled as WRONG | After (nothing unlabelled) |
| --- | --- | --- | --- |
| Default tier, accept | 84.4% (76/90) | 82.6% (76/92) | **83.7%** (77/92) |
| Default tier, not-wrong | 91.1% (82/90) | 89.1% (82/92) | 89.1% (82/92) |
| All shown, accept | 80.0% (116/145) | 71.6% (116/162) | **75.3%** (122/162) |
| All shown, not-wrong | 89.7% (130/145) | 80.2% (130/162) | 82.7% (134/162) |
| Suggestion tier, accept | 72.7% (40/55) | 57.1% (40/70) | 64.3% (45/70) |

The "before" rows count the 14 stale labels as current. Without them, the default tier was 84.1% labelled only (69/82) and 75.0% with unlabelled counted as WRONG.

**Reading:**

- **Default tier.** The labelled-only figure barely moves, 84.4% → 83.7%:
  - two newly labelled default-tier proposals are ACCEPT (cal.com `D-f26528`, midday `D-ef5012`);
  - two changed ones became WRONG: supabase `D-b10f47` (`<DefaultLayout>`, `false_outliers`) and `D-922bc7` (`fill` on `createLucideIcon()`, `mixed_group`).
- **All shown.** The 80.0% before was optimistic. Most of the unlabelled proposals were suggestion-tier naming, calls and control rules, and 9 of the 17 are WRONG. The figure with nothing unlabelled is 75.3%, between #21's two readings.
- **Suggestion tier.** It takes most of the new WRONGs: midday's `src/trpc/**` and `src/schemas/**` value rules, novu `*Service` and `*Command`, twenty `useHeadlessCommandContextApi()`, formbricks `handleApiError()` before `successResponse()`, and immich `any` (`team_disabled`).

The default tier has 10 WRONG proposals:

| Rule | uid | Labelled |
| --- | --- | --- |
| rendered component | dub `D-418256` (`<Container>`) | #4 |
| base class | twenty `D-2456fc`, `D-3c8584` | v1 |
| decorator | twenty `D-0929de` (`ObjectType()` on DTOs) | v1 |
| decorator | immich `D-4fc758` (`ApiTags()`) | v1 |
| argument key | formbricks `D-b70b0a` (`schemas`) | v1 |
| argument key | midday `D-b3dd60` (`id` to `pgTable()`) | #4 |
| argument key | supabase `D-922bc7` (`fill`) | this round |
| call wrapper | formbricks `D-43e309` (`atom()`) | v1 |
| rendered component | supabase `D-b10f47` (`<DefaultLayout>`) | this round |

**Not a held-out figure.** These 16 repos are the dev set the TypeScript filters of #4, #16 and #21 were derived from. The default-tier accept rate of 83.7% (cluster interval about 73%–95%) is an optimistic dev-set number, and it is still short of the 95% target. The held-out number comes only from a run on the primary sets.
