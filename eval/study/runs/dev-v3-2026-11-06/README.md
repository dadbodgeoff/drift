# Dev relabel under rubric v3 (decision D6), 2026-11-06: staged

**Dev sets, not held-out.** This run relabels, blind and under [`RUBRIC-v3.md`](../../RUBRIC-v3.md), every proposal Drift shows at main `debc33a` on three dev manifests. Drift was tuned on the first two, so every figure it gives is a dev-set figure: optimistic, never a headline or held-out result.

| Part | Manifest | Repos | What it is |
| --- | --- | --- | --- |
| `ts/` | `eval/repos.json` | 16 | the TypeScript/JavaScript dev set |
| `py/` | `eval/repos-py.json` | 8 | the Python dev set |
| `py2/` | `eval/repos-py-2.json` | 12 | the second Python dev set: first labelling (never labelled before) |

The calibration ([`runs/calib-v3-2026-11-06`](../calib-v3-2026-11-06/README.md)) showed that v3 moves labels towards WRONG (D5 drawn default tier 12/12 → 8/12), so the dev figures published under v1/v2 overstate precision. This run restates them under v3.

**Status: complete.** Every shown proposal has a v3 final label except CTFd's 2 (excluded, see "Protocol deviations"). The census, queues, carried labels and labeller A's prompts were committed before any label (`94a0bea`); the labels, prompts, agreement, adjudication, finals and metrics are committed together.

## Commands

```sh
S=<scratch>; D=<scratch of the shared dev clones>
# release build of main debc33a in a private CARGO_TARGET_DIR (deleted afterwards):
#   cargo build --release --locked -p drift-cli  ->  $S/bins/drift-main-debc33a
# the shared dev clones are read-only: prepare.mjs ran on hard-linked copies of them ($S/dev-v3/cache/repos, deleted
# afterwards), which drift init writes into and cleans; every shared clone was clean at its pin before and after
export DRIFT_CACHE_DIR=$S/dev-v3/driftcache
for x in "ts eval/repos.json" "py eval/repos-py.json" "py2 eval/repos-py-2.json"; do set -- $x
  node eval/study/prepare.mjs --drift $S/bins/drift-main-debc33a --manifest $2 --run eval/study/runs/dev-v3-2026-11-06/$1 \
    --cache $S/dev-v3/cache --drift-src .
done
node eval/study/runs/dev-v3-2026-11-06/stage.mjs stage --checkouts-ts $D/eval-cache/repos --checkouts-py $D/eval-py/repos \
  --checkouts-py2 $D/eval-py-2/repos --cache $S/lbx3
for P in ts py py2; do node eval/study/prompt.mjs label --run eval/study/runs/dev-v3-2026-11-06/$P/relabel --labeller A --rubric v3; done
node eval/study/runs/dev-v3-2026-11-06/stage.mjs batches
```

Settings:

- **Binary:** sha256 `b2b23599f83a…`, `drift 0.1.0-dev`, built from main at `debc33a` (clean tree; `run.json` records `dirty: false`).
- **Census:** `--max 15 --all-outliers`, pool `--max 200`, as every dev run. All 36 repos `ok`.
- **Checkouts.** `run.json` of each part records the hard-linked copies prepare.mjs ran on (deleted). The labellers open the shared clones at the same pins, which `relabel/run.json` records: `<D>/eval-cache/repos`, `<D>/eval-py/repos`, `<D>/eval-py-2/repos`. Each was at its pinned sha and clean (`git status --porcelain --ignored` empty) when staged. Check them again after each labeller.
- **Outboxes:** `$S/lbx3/outbox/<uuid>/out.jsonl`. The path says nothing about the stage, the labeller, the repo or the run.
- **Rubric:** v3, the approved text (sha256 `79316bdc08a6…`, `lib.mjs` `APPROVED_RUBRIC`), recorded per prompt in `prompts/index.json`; the calibration's prompts used the same text.

## What is in it

| Path | What it is |
| --- | --- |
| `<part>/run.json`, `queue.json`, `proposals/`, `pool/` | `prepare.mjs` output: every shown proposal at main |
| `<part>/carried.jsonl` | v3 labels carried from the calibration (below), in `final.jsonl`'s row format, `source: "carried"`, `carried_source` (agreed or adjudicated), `carried_from` |
| `<part>/relabel/` | a harness run restricted to the uids that are not carried, built like the r2 `relabel/` sub-runs: the part's `run.json` with `run` renamed, `relabel_of` added and `checkout` set to the shared clones; its `queue.json` filtered to those uids |
| `<part>/relabel/prompts/label/A/*.md` | labeller A's prompts, one per repo, rubric v3 |
| `<part>/views/d5/` | the part under decision D5's tier (`eval/study/tier-d5.json`), a derived view, not pre-registered for these dev manifests |
| `<part>/views/d7/` | the part under decision D7's tier (`eval/study/tier-d7.json`), a derived view added after labelling (no label changed); `compare.json` lists what D7 moves out of D5's default tier |
| `stage.mjs` | the script that wrote `carried.jsonl`, `relabel/`, `views/d5/`, `stage.json` and `batches.json` |
| `view-d7.mjs` | the script that wrote `views/d7/` (run, queue, compare) from each part's `run.json` and `queue.json` |
| `stage.json` | per part and tier: shown, carried, to label; the calibration uids not carried and why; the census `tier:` line check |
| `batches.json` | the labeller batches: one per (labeller, repo) prompt, with its prompt and outbox |

## What is shown, carried and to label

The default tier below is **D5's** (`tier-d5.json`, the tier the product ships and every held-out manifest holds). The product's census `tier:` line equals `lib.mjs` `tierOf` under D5 for all 277 shown proposals (`stage.json` `census_tier_vs_d5_mismatches`, empty in every part).

| Part | Shown | D5 default | D5 suggestion | Carried (default) | To label (default / suggestion) | Prompts |
| --- | --- | --- | --- | --- | --- | --- |
| ts | 162 | 52 | 110 | 37 (10) | 125 (42 / 83) | 13 repos |
| py | 39 | 10 | 29 | 19 (5) | 20 (5 / 15) | 5 repos |
| py2 | 76 | 14 | 62 | 0 | 76 (14 / 62) | 12 repos |
| **all** | **277** | **76** | **201** | **56 (15)** | **221 (61 / 160)** | **30** |

Repos with no shown proposals: create-t3-app, trpc, node-express-boilerplate (ts); flask (py). Repos fully carried: full-stack-fastapi-template, langchain (py).

**The tier each part records.** `eval/repos.json` and `eval/repos-py.json` have no `tier`, so their `run.json` records `min_members 15` (all shown are "default"), not pre-registered. `eval/repos-py-2.json` **pre-registers rule 5's rule-kind tier** (before D5), so `py2/run.json` holds rule 5 (27 default, 49 suggestion) with `tier_pre_registered: true`. `views/d5/` gives D5's tier for all three; quote D5 from there. Whether to amend `repos-py-2.json`'s tier to D5 before its labels are scored is the lead's decision (labelling is blind to the tier either way).

## Labels carried from the calibration (rule 4)

Labels carry over only for a proposal whose uid and text are identical. `stage.mjs` carries a calibration v3 final label when the uid is shown at main, the repo's pinned commit is the same, and the card a labeller sees (the census block without rank and `tier:` line) is byte-identical to the one the calibration labelled.

- **TypeScript: all 37** calibration uids carried.
- **Python: 19 of 24** labelled calibration uids carried. Not carried: polar `D-e5f85b`, `D-2ef961`; netbox `D-310ec7`, `D-4c4e2d` (census text differs at main); netbox `D-e5e365` (not shown at main). CTFd's two calibration uids have no v3 label (its labeller was stopped) and are labelled here.
- The calibration sample was stratified and enriched with hard cases; carrying its labels is not a sampling choice here, since every shown proposal gets a v3 label either way. Report the carried labels as such, and the figures with and without them if asked.

## Protocol amendment: the "other members" rule (2026-11-06, during labelling)

**The problem.** `collect.mjs` required every label's `checked` to list at least 2 files besides the example's and the outliers' ("other members"). A role whose members all sit in fewer files than that cannot meet it: in infisical `D-dfa77a` every member is a function of `frontend/src/hooks/api/identities/mutations.tsx`, which is also the example's and every outlier's file. Labellers padded `checked` with non-member files to pass, which is worse than the rule.

**The change** (`lib.mjs` `checkLabel`, `memberFileBound`, `modelFileCandidates`, `otherMemberBounds`; used by `collect.mjs` and `adjudicate.mjs`; test `eval/study/validate.test.mjs`). The model-role bound was added the same day, before lotus B was collected:

- The number of other-member files required is **min(2, the files the role can have members in, excluding the example's and the outliers' files)**.
- The census lists only the example and the outliers, so the member files are bounded from the role's selector over the checkout's tracked files (`roleFileCandidates`): files under `<package>/<dir>` (dynamic segments as `[*]`, `.` the package itself, `**` package-wide) whose name matches the file kind (`*` any; `*.service` a `.service.` infix; a literal stem; a Python `parent/stem` layer). This **over-approximates** Drift's role membership: it is never below the true count, so a role with further member files still needs 2. Every example and outlier file of the 277 shown proposals is among its candidates.
- **Model roles** (`kind: model`, the model source in `dir`) are bounded by file contents (`modelFileCandidates`), because Drift finds a model wherever it is declared, so `models.py` and `models/` alone could undercount. For `django`, a `.py` file is a candidate unless it is certain to declare no Django model: drift-py makes a class a model when its body assigns a call whose callee resolves, through that file's own imports, to `django.db.models.*Field` / `*ForeignKey`, so a file counts when it has such an assignment at bracket depth 0 whose callee's first name is imported from django (or a call of a django Field imported under an alias). Keyword arguments inside calls (a migration's `field=models.CharField(...)`), strings and comments do not count; a file the scanner cannot follow, or cannot read, is a candidate. The test is looser than Drift's, never stricter. For `prisma` every `.prisma` file is a candidate. Other model sources (sqlalchemy, sqlmodel, drizzle, sql) get no bound. In lotus, `D-2ab768`'s only candidate is `backend/metering_billing/models.py`, its example's and outlier's file, so its bound is 0.
- Package roles, proposals without a role, other model sources and repos whose checkout is missing keep needing 2. Everything else is unchanged and strict: at least 2 files in `checked` in all, the example's file, min(3, outlier files) outlier files, repo-relative paths, and every other schema rule.
- It relaxes the rule for 10 of the 277 shown proposals: bound 0 for infisical `D-dfa77a`, novu `D-52c44b`, midday `D-7da2b9`, `D-b98efb`, `D-f90103`, `D-afc38b`, lotus `D-2ab768`; bound 1 for formbricks `D-5adbb0`, `D-43e309`, novu `D-36a604`.
- **Labels already collected are unaffected:** they met the stricter rule, and the change never adds a requirement. The labeller-facing rubric is unchanged (its text is pinned by sha256, decision D6): `RUBRIC-v3.md` still asks for two other members "in two files other than the example's and the outliers'", which a single-file role cannot give.

## Protocol deviations

Stated plainly; each affects how far the labels below can be trusted, not how they are scored.

- **Models.** Labeller A ran on the session's default model. Labeller B ran on a different, smaller model, chosen for independence. A and B were different sessions.
- **Fix-up passes with unverified `checked`.** Several B outputs failed validation first. Their fix-up passes added `checked` entries with very few tool calls, so for those lines the requirement that each listed file was opened is **unverified**. Repos: twenty, documenso, novu, immich, midday, formbricks, cal.com, infisical (ts); polar, netbox (py).
- **Padding.** Some labellers padded `checked` with related non-member files in single-file roles, to meet the "other members" rule before it was amended (above).
- **infisical B** at first listed files it had only grepped, then opened them.
- **cal.com B:** a grep from the wrong directory listed file names outside the checkout, including label files. No contents were read.
- **InvenTree B** wrote a helper script to `/tmp/gen_lbl.py` (outside the checkout and its outbox), and left one outlier unopened on `D-6f225b`.
- **Misago B** only skimmed or grepped some of the files it listed for `D-b4e5ff` and `D-e72fc8`.
- **CTFd is excluded.** Its labeller in the calibration was stopped by a safety system (a false positive on capture-the-flag content). Its A prompt here (2 proposals) was rendered and is not collected; no B prompt was rendered. It is excluded from adjudication and merge with `adjudicate.mjs --exclude-repos CTFd --exclude-reason ...`, recorded in `py/relabel/adjudication/queue.json` (`excluded`), so its 2 proposals stay unlabelled and count as WRONG. Report the Python figures with and without it (`metrics.mjs --exclude-repos CTFd`).

## Results (dev figures, rubric v3, D5 tier)

**Dev-set figures, not held-out:** Drift was tuned on `ts` and `py`, so they are optimistic; `py2` was never used for tuning but is still a dev set. No verdicts: the targets are judged on a primary held-out run only. Rates are over **all shown** proposals with unlabelled counted as WRONG (the target definition), under D5's tier as a derived view (`views/d5/`, not pre-registered for these manifests). Each cell: point estimate (k/n), Wilson 95%, then the repo-cluster 95% intervals, percentile bootstrap / cluster-t, with the number of repos; quote the wider cluster interval.

| Part | D5 default-tier accept | Not-wrong, all shown (both tiers) | A/B κ (3 labels), before adjudication |
| --- | --- | --- | --- |
| ts (16 repos) | **67.3%** (35/52); Wilson 53.8–78.5%; cluster 47.7–83.3% / 46.2–88.4% (12 repos) | **43.2%** (70/162); Wilson 35.8–50.9%; cluster 33.8–52.3% / 32.6–53.9% (13 repos) | **0.84**, 92.0% exact (125 relabelled; bootstrap 0.70–0.95, 13 repos) |
| py (8 repos), CTFd as WRONG | **30.0%** (3/10); Wilson 10.8–60.3%; cluster 0.0–75.0% / 0.0–100.0% (3 repos) | **38.5%** (15/39); Wilson 24.9–54.1%; cluster 20.0–51.5% / 20.4–56.5% (7 repos) | **0.64**, 83.3% exact (18 relabelled; bootstrap 0.00–1.00, 4 repos) |
| py without CTFd | 37.5% (3/8); Wilson 13.7–69.4%; cluster 0.0–75.0% / 0.0–100.0% (2 repos) | 40.5% (15/37); Wilson 26.3–56.5%; cluster 25.0–54.2% / 21.4–59.7% (6 repos) | (as above) |
| py2 (12 repos) | **42.9%** (6/14); Wilson 21.4–67.4%; cluster 16.7–75.0% / 7.0–78.7% (9 repos) | **31.6%** (24/76); Wilson 22.2–42.7%; cluster 22.4–42.5% / 20.2–43.0% (12 repos) | **0.79**, 90.8% exact (76; bootstrap 0.66–0.91, 12 repos) |

- **Sources.** `<part>/views/d5/metrics.md` (and `.json`), from `metrics.mjs --run <part>/views/d5 --labels <part>/final.jsonl`; the py row without CTFd is the "Excluding exposed" row of `py/views/d5/metrics-without-CTFd.md` (`--exclude-repos CTFd`; metrics.mjs calls the excluded repo "exposed", here it only means excluded). κ is from `<part>/relabel/agreement.md`, computed before adjudication, over the relabelled proposals only (the carried labels' agreement is the calibration's).
- **Labels.** ts 162 (125 relabelled: 115 agreed, 10 adjudicated; 37 carried), py 37 of 39 (18 relabelled: 15 agreed, 3 adjudicated; 19 carried; CTFd's 2 unlabelled), py2 76 (69 agreed, 7 adjudicated). Final mix: ts 69 ACCEPT / 1 TRIVIAL / 92 WRONG; py 15 / 0 / 22; py2 23 / 1 / 52. C sided with A 10/0 (ts), 2/1 (py), 5/2 (py2), never "neither".
- **The "Per language" rows of ts and py read "unknown":** `eval/repos.json` and `eval/repos-py.json` record no `language`. Each part is one language (polar's TypeScript-side proposals sit in `py`, as in earlier runs).
- **py2's pre-registered tier** is rule 5's (`py2/run.json`); its metrics here are D5's view. Rule 5's figures were not computed.
- **Carried labels** (56) have no `rubric_sha256` field: the calibration's records predate the stamp in `final.jsonl`. Their prompts used the same approved v3 text (`stage.mjs` checks it).
- **Verification.** `adjudicate.mjs --merge` was rerun on each part and wrote byte-identical `relabel/final.jsonl`; each `<part>/final.jsonl` is exactly `relabel/final.jsonl` followed by `carried.jsonl`, covers every shown uid once (CTFd's 2 excepted) and nothing else, and every record is rubric v3; `metrics.mjs` rerun reproduces `views/d5/metrics.{md,json}` byte for byte.

## Results under D7

**Decision D7** (approved by the founder 2026-11-06, before any held-out census; `eval/study/README.md` decision log) narrows D5's default tier to TypeScript/JavaScript call wrappers and layering and makes every Python proposal a suggestion. `views/d7/` applies it to the same shown proposals and the same final labels; nothing was relabelled. Same conventions as above: dev figures, rubric v3, over all shown with unlabelled counted as WRONG, no verdicts.

```sh
node eval/study/runs/dev-v3-2026-11-06/view-d7.mjs
R=eval/study/runs/dev-v3-2026-11-06
for P in ts py py2; do
  node eval/study/metrics.mjs --run $R/$P/views/d7 --labels $R/$P/final.jsonl --json $R/$P/views/d7/metrics.json > $R/$P/views/d7/metrics.md
done
node eval/study/metrics.mjs --run $R/py/views/d7 --labels $R/py/final.jsonl --exclude-repos CTFd --json $R/py/views/d7/metrics-without-CTFd.json > $R/py/views/d7/metrics-without-CTFd.md
```

| Part | D5 default-tier accept | **D7 default-tier accept** | D7 suggestion-tier accept | Not-wrong, all shown (unchanged) |
| --- | --- | --- | --- | --- |
| ts (16 repos) | 67.3% (35/52) | **75.0%** (24/32); Wilson 57.9–86.7%; cluster 45.7–93.0% / 46.8–100.0% (9 repos) | 34.6% (45/130) | 43.2% (70/162) |
| py (8 repos), CTFd as WRONG | 30.0% (3/10) | **no default tier** (0 shown) | 38.5% (15/39) | 38.5% (15/39) |
| py without CTFd | 37.5% (3/8) | no default tier | 40.5% (15/37) | 40.5% (15/37) |
| py2 (12 repos) | 42.9% (6/14) | **no default tier** (0 shown) | 30.3% (23/76) | 31.6% (24/76) |

- **TypeScript by kind:** call wrappers 14/19, layering 10/13. D7 moves 20 proposals out of D5's default tier (base classes 12, decorators 6, JSX wrappers 2), 11 of them ACCEPT; it adds none (`ts/views/d7/compare.json`).
- **Member counts and languages.** `view-d7.mjs` counts each role's size from `<part>/proposals/<repo>.yaml` (`role_members`, else `total`), as the product's tier does; it changes no tier here (7 proposals have a role larger than `total`, none crosses 15). `python_members` did not exist at `debc33a`, so the language falls back to each example. `metrics.mjs` now reports rows by the convention's language: `py`'s polar frontend proposals are its TypeScript row (6 shown, no default tier), not Python's.
- **Python:** D7 moves all of D5's default tier to suggestion: `py` 10 (base classes 5, decorators 3, call wrappers 2), `py2` 14 (call wrappers 6, base classes 6, decorators 1, layering 1). polar's TypeScript-side proposals in `py` are TypeScript by their example paths, and none of them is an in-repo call wrapper or layering rule in a role of 15 or more, so `py` has no default tier either.
- **Before the round-5 fixes.** The ≈ 96% projected for TypeScript call wrappers and layering assumes the open precision PRs, the mixed-auth-set change and F10 have landed; these figures are at main `debc33a`.
- **Sources:** `<part>/views/d7/metrics.md` (and `.json`); the py row without CTFd is the "Excluding exposed" row of `py/views/d7/metrics-without-CTFd.md`.

## Labellers: commands that were run

One **batch = one (labeller, repo) prompt, launched as one fresh agent** (README "Launching"; `REVIEWER-PROMPT.md` "Isolation": each prompt allows opening only its own checkout). No prompt has more than 15 proposals, so each fits one session; prompts of several repos are never merged into one agent.

```sh
R=eval/study/runs/dev-v3-2026-11-06
# 1. launch ONE FRESH agent per A prompt in $R/{ts,py,py2}/relabel/prompts/label/A/ (batches.json lists them); then:
for P in ts py py2; do node eval/study/collect.mjs --run $R/$P/relabel --stage label; done
# 2. B, only for repos whose A output is collected (prompt.mjs enforces it); preferably another model than A:
for P in ts py py2; do node eval/study/prompt.mjs label --run $R/$P/relabel --labeller B; done
node eval/study/runs/dev-v3-2026-11-06/stage.mjs batches          # refreshes batches.json with B's outboxes
#    launch ONE FRESH agent per B prompt; then collect again
# 3. agreement (before adjudication), C on the disagreements, merge:
for P in ts py py2; do S=$R/$P/relabel
  node eval/study/agree.mjs --run $S --json $S/agreement.json > $S/agreement.md
  node eval/study/adjudicate.mjs --run $S && node eval/study/prompt.mjs adjudicate --run $S
  # one fresh agent per C prompt; then:
  node eval/study/collect.mjs --run $S --stage adjudicate && node eval/study/adjudicate.mjs --run $S --merge
  cat $S/final.jsonl $R/$P/carried.jsonl > $R/$P/final.jsonl
  node eval/study/metrics.mjs --run $R/$P/views/d5 --labels $R/$P/final.jsonl --json $R/$P/views/d5/metrics.json > $R/$P/views/d5/metrics.md
done
```

For `py`, `adjudicate.mjs` ran with `--exclude-repos CTFd --exclude-reason "..."` (see "Protocol deviations"); its `--merge` uses the recorded exclusion. Isolation is weaker than a sandbox: the agents run as the coordinator's user, so the outbox root is listable; the controls are the sequencing, `collect.mjs` moving each output out, and the instructions.

**Blinding check of the A prompts.** None contains a tier line, a rank, a previous label, "calibration", "carried", "relabel" or a round (the only hits for those words are a file name in twenty's outliers), and each lists only its own repo's uids.
