# Dev run, Python, round 2 (2026-11-05): main after #13 and #18

**Dev set, not held-out.** This run covers the same 8 Python dev repos as `runs/dev-py-2026-11-05` (`eval/repos-py.json`), measured at main `2709f17`, after #13 and #18. Rule 4 of `eval/study/README.md` puts a new product version in a new run directory. Labels carry over only for proposals whose uid and census text are identical. Every other shown proposal was double-labelled blind in this round.

## Commands

```sh
# release build of main 2709f17 from a clean git archive, in a private CARGO_TARGET_DIR (deleted afterwards)
DRIFT_CACHE_DIR=$SCRATCH/r2/driftcache node eval/study/prepare.mjs --drift $SCRATCH/r2/bin/drift-2709f17 \
  --manifest eval/repos-py.json --run eval/study/runs/dev-py-r2-2026-11-05 --cache $SCRATCH/r2/cache --drift-src .
R=eval/study/runs/dev-py-r2-2026-11-05/relabel
node eval/study/prompt.mjs label --run $R --labeller A    # then collect, B, collect (per repo, A before B)
node eval/study/agree.mjs --run $R --json $R/agreement.json > $R/agreement.md
node eval/study/adjudicate.mjs --run $R                   # prompt.mjs adjudicate, C, collect --stage adjudicate
node eval/study/adjudicate.mjs --run $R --merge           # -> relabel/final.jsonl
node eval/study/metrics.mjs --run eval/study/runs/dev-py-r2-2026-11-05 --json .../metrics.json > .../metrics.md
node eval/study/metrics.mjs --run .../views/rule5    --labels .../final.jsonl --json .../views/rule5/metrics.json
node eval/study/metrics.mjs --run .../views/rule5-py --labels .../final.jsonl --json .../views/rule5-py/metrics.json
```

Settings:

- binary sha256 `41054fadcecf…`, `drift 0.1.0-dev`, built from main at `2709f17` (clean tree);
- census `--max 15 --all-outliers`, pool `--max 200`.
- Checkouts: private `git clone --shared` copies of the shared clones, at the pinned shas and verified clean. The shared clones were never written to.

## What was labelled

The census at main shows 43 proposals:

| Repo | polar | netbox | saleor | CTFd | flask | fastapi | langchain | full-stack-fastapi-template |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Proposals | 15 | 15 | 7 | 2 | 0 | 1 | 2 | 1 |

Each uid was checked against its last label in `runs/dev-py-2026-11-05/final.jsonl` + `relabel-pr13.jsonl`, with later lines winning. A label counts as stale when the proposal's wording, holders/total or outlier lines (the `measure.mjs` comparison) differ from the census it was labelled on:

| Labelled in | Census it was labelled on |
| --- | --- |
| `final.jsonl` | that run's `proposals/` (`859542f`) |
| `relabel-pr13.jsonl`, "PR #13 double-label" rows (commit `321a392`) | drift at `05054b2` |
| "round 2" rows (`6df3068`) | drift at `25fcfb2` |

The two older binaries were rebuilt only for this comparison.

**22 uids were labelled in this round:**

- **Unlabelled (13):**
  - polar `D-2ef961`, `D-f818d9`;
  - netbox `D-cc1341`, `D-e5e365`, `D-310ec7`, `D-cc8d72`, `D-73d13c`, `D-c50348`, `D-89919d`;
  - CTFd `D-560792`, `D-f6c1fb`;
  - langchain `D-ede63a`, `D-468530`.
- **Changed since their last label (9):**
  - saleor `D-e36ea5`;
  - polar `D-093712`, `D-e5f85b`, `D-fb4011`, `D-f53bba`;
  - netbox `D-e2c3e4`, `D-58913a`, `D-afb64d`, `D-937c0c`.

**Five uids that a `25fcfb2` comparison misses:** polar `D-f53bba` and the four netbox ones. They were labelled at `05054b2`, and #13's review fixes in `25fcfb2` changed their members (by 1 for the netbox rules; polar 41/46 → 47/52). They were never relabelled.

**Other notes on the list:**

- polar `D-fb4011` and `D-f818d9` are TypeScript-side proposals of the mixed repo, labelled like any other.
- The other 21 shown proposals keep their earlier labels (`source: "carried"`, with `carried_from`).

`relabel/` is a harness run restricted to the 22 uids:

- `run.json` is this run's, with `run` renamed and `relabel_of` added;
- `queue.json` is this run's queue, filtered to those uids;
- `prompt.mjs`, `collect.mjs`, `agree.mjs` and `adjudicate.mjs` ran on it unchanged.

## Labellers

- **Who labelled.** A, B and C were each a fresh subagent with no shared context, launched by the coordinating session. Each one got only its rendered prompt (`relabel/prompts/`), read access to the checkout and its outbox.
- **Models.** The model of each labeller was not recorded per labeller.
- **Order.** A and B of one repo never ran at the same time.
- **Isolation is weaker than a sandbox.** The agents ran as the same user as the coordinator, so the outbox root was listable. The controls were the sequencing, `collect.mjs` moving each output out, and the instructions.

## Agreement and adjudication (`relabel/agreement.md`, before adjudication)

| | |
| --- | --- |
| Proposals labelled by both | 22 |
| Exact agreement | 81.8% (18/22) |
| Cohen's κ (3 labels) | **0.64** (substantial), repo-cluster bootstrap 95% 0.15–0.81 (5 repos) |
| Label mix | A 11 ACCEPT / 11 WRONG; B 11 ACCEPT / 11 WRONG; no TRIVIAL |
| Disagreements | 4 |

C adjudicated the 4 disagreements. It sided with A twice and with B twice:

| uid | A | B | C (final) |
| --- | --- | --- | --- |
| polar `D-fb4011` | WRONG | ACCEPT | ACCEPT |
| netbox `D-310ec7` | WRONG | ACCEPT | WRONG |
| saleor `D-e36ea5` | ACCEPT | WRONG | WRONG |
| langchain `D-468530` | ACCEPT | WRONG | ACCEPT |

New labels (22): 11 ACCEPT, 11 WRONG. Two proposals that changed since their last label went from ACCEPT to WRONG: polar `D-e5f85b` and saleor `D-e36ea5`.

## Labels

- `relabel/final.jsonl` is the harness merge for the 22 uids.
- `final.jsonl` is every shown uid (43):
  - the 22 new labels, tagged `"round": "2026-11-05 py-r2"`;
  - the 21 carried labels, with `source: "carried"`, `carried_from` and, where they had one, their original `round`.
- No shown proposal is unlabelled.

## Results

`final.jsonl` covers every shown proposal, so the labelled-only rates and the rates over all shown, with unlabelled counted as WRONG, are the same. Wilson 95% intervals; there is no TRIVIAL, so accept = not-wrong throughout.

**Default tier = rule 5's rule-kind tier,** as PYTHON.md reports it.

- **The tier definition.** A proposal is default tier when its rule kind is in {`wrapped_by:call`, `wrapped_by:decorator`, `wrapped_by:extends`, `passes_key`, `avoids:import`, `renders`, `wrapped_by:jsx`} and its role has ≥ 15 members. The definition is copied from `eval/holdout-primary-py.json`.
- **It is not pre-registered for this dev manifest.** `eval/repos-py.json` has no `tier`, so `prepare.mjs` recorded `min_members 15` in `run.json`. The rule-kind tier is applied through the derived views `views/rule5` (all 43) and `views/rule5-py` (the 36 Python-side). Each view is this run's `queue.json` with `params.tier` replaced. Each view's `run.json` (and this run's) carries `params.tier_pre_registered: false`, so `metrics.mjs` reports the tier as not pre-registered (`tier.pre_registered: false` in `metrics.json`). Until 2026-11-06 it printed "pre-registered" for any `run.json` with a tier; the metrics were re-scored then, with unchanged rates.
- **Python-side** excludes the 7 TypeScript-side uids of mixed repos: full-stack-fastapi-template `D-6e757d`, and polar `D-9c16e6`, `D-26e577`, `D-dfae92`, `D-27ad3b`, `D-fb4011` and `D-f818d9`.

| | Shown | ACCEPT | TRIVIAL | WRONG | Accept = not-wrong |
| --- | --- | --- | --- | --- | --- |
| **Python-side, all** | 36 | 22 | 0 | 14 | 61.1% [44.9%–75.2%] |
| Python-side, default tier | 16 | 11 | 0 | 5 | **68.8% [44.4%–85.8%]** |
| Python-side, suggestion tier | 20 | 11 | 0 | 9 | 55.0% [34.2%–74.2%] |
| All shown, all | 43 | 26 | 0 | 17 | 60.5% [45.6%–73.6%] |
| All shown, default tier | 18 | 12 | 0 | 6 | 66.7% [43.7%–83.7%] |
| All shown, suggestion tier | 25 | 14 | 0 | 11 | 56.0% [37.1%–73.3%] |

The repo-cluster intervals are in `views/*/metrics.md`. Python-side, default tier: bootstrap 33.3%–80.0%, cluster-t 41.4%–96.1% (4 repos).

**`metrics.md` at the run root uses the recorded tier, ≥ 15 members.** Under it, all 43 proposals are default tier: 60.5% accept and not-wrong.

The Python-side default tier has 5 WRONG proposals, all labelled this round:

| Rule | uid | `wrong_because` |
| --- | --- | --- |
| base class | polar `D-e5f85b` (enums extend `StrEnum`) | `legit_outliers` |
| base class | CTFd `D-f6c1fb` (`ma.ModelSchema`) | `legit_outliers` |
| base class | langchain `D-ede63a` (`TypedDict`) | `false_outliers` |
| argument key | netbox `D-e5e365` (`FieldSet(name=)`) | `legit_outliers` |
| argument key | netbox `D-310ec7` (`Column(verbose_name=)`) | `false_outliers` |

**Before this round,** the same census scored with the old labels (`views/rule5-py`) gave:

- **counting the 9 stale labels as current:** 10/10 default tier accepted, with 6 unlabelled;
- **without the stale labels:** 6/6, with 10 unlabelled;
- **unlabelled counted as WRONG,** the Python-side default tier was 62.5% and 37.5% respectively.

The round-2 figure, 68.8% with nothing unlabelled, replaces these. The earlier 100% reflected which proposals were labelled, not the tier's precision.
