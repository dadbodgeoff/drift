# D8 pre-registration: a Python default tier, candidate (2026-11-07)

**Dev sets only. No label was made here, and nothing in this directory is a label.** This run records the evidence behind [decision D8](../../README.md#decisions-before-any-held-out-census-2026-11-05), a **pre-registered, not adopted** candidate for a Python default tier, and stages (does not label) the dev card pool it would be judged on. The decision log entry is the pre-registration of record: the tier, the floor, the dev and held-out thresholds, the stopping rules and what counts as failure. This file adds the evidence and the staged pool. Python stays advise-only: the product ships D7.

## Why a D8 at all

The merged Python plan ([`runs/py-plan-2026-11-07`](../py-plan-2026-11-07/README.md), #67) keeps Python advise-only. On the v3 dev labels, Python suggestions are accepted 22.8% of the time (18 of 79 shown, unlabelled counted as WRONG). The one Python subset with no WRONG card is guard call wrappers plus layering, the analogue of what D7 kept for TypeScript, but the dev sets hold 4 such cards. The plan's "D8 candidate, for later" asks for a tier, a minimum sample and a held-out minimum to be written down before any labelling. This is that record.

## The candidate tier

`eval/study/tier-d8-candidate.json`. TypeScript/JavaScript is D7. Python: `wrapped_by:call` whose every alternative is a guard (`drift_mine::security::authenticates`), and `avoids:import`, with in-repo targets, in roles of ≥ 50 members. The guard notion is the product's, read from definitions: the one mining uses since #60 to keep only guards in auth variant sets. It is not a name list: `get_current_user` is a guard because it raises a 401, `get_db` is not, and `login_required_optional` is never one because its name opens access.

How the product and the study compute it:
- **Product.** `drift census --json --candidate d8` adds `candidate` {`decision`, `tier`, `reason`, `guards`} to each proposal (`drift_mine::tier::d8_candidate_reason`, `security::every_alternative_authenticates`). Without the option the output is byte-identical. The option changes no `tier`, `tier_reason` or `blockable`, and nothing in `check`, the hooks or `review`.
- **Study.** `lib.mjs` `tierOf` under `tier-d8-candidate.json` reads `guards` from the queue item. Anything but `true` is suggestion tier. `stage.mjs --candidate-json DIR` copies `guards` from the product's census and stops unless both give every proposal the same candidate tier. The shared `d8_cases` in `tier-cases.json` run through both.

## The member floor (`floors.mjs`, `floors.md`)

`node eval/study/runs/d8-prereg-2026-11-07/floors.mjs --out <scratch>` builds views of `runs/dev-v3-2026-11-06/{py,py2}` at floors 15, 20, 30, 40 and 50. In each view the default tier is Python call wrappers and layering, in-repo, role ≥ N. There is no guard condition, because the labelled cards' guard facts were never recorded. polar and CTFd are dropped [STRICT]. Each view is scored with `metrics.mjs`, and the script keeps its per-language, tier and rule family rows (#68).

| Floor | Python call wrappers, default tier | Layering, default tier |
| --- | --- | --- |
| 15, 20, 30, 40 | 6 shown: 4 ACCEPT, 2 WRONG (66.7%, Wilson 30.0–90.3%; 3 repos) | 1/1 |
| **50** | **3 shown: 3 ACCEPT (100%, Wilson 43.9–100%; 3 repos)** | 1/1 |

- **No labelled Python card of the D8 kinds has a role under 40.** There are 10 such cards (9 call wrappers, 1 layering rule) with roles of 40–195 members. So the labels say nothing about roles of 15–39 for these kinds. Across all Python families, cards in roles under 40 are accepted less often: 5 of 22, against 19 of 57 at 40 or more.
- **Both labelled call-wrapper WRONGs have 40–43 members:**
  - tasking-manager `D-c373f7`: `get_db` with `login_required` and `login_required_optional`, WRONG `legit_outliers`;
  - tasking-manager `D-3e220e`: `get_db` alone, WRONG `incidental`.

  The guard condition should remove both, but it has never been labelled on Python. So the floor is 50 [STRICT], as a second safeguard against the same failure. Its cost on the labels is one guard ACCEPT: Django-CRM `D-4a6ea2`, `HasOrgContext`, 41 members.
- These are dev, in-sample figures. They are the reason for the floor, not evidence that D8 reaches 95%.

## The staged dev pool (not labelled)

**The pool is 2 cards from 2 repos. The pre-registered minimum is 40 cards from 10 repos.** By stopping rule 3, no D8 label is made. This is a finding, not a failure: the Python dev sets cannot test D8. Python stays advise-only.

| Part | Repos | Shown | D8 Python default tier | Repos with a D8 card |
| --- | --- | --- | --- | --- |
| `py` (6 repos; polar and CTFd are not scanned) | 6 | 23 | **0** | 0 |
| `py2` (12 repos) | 12 | 75 | **2** | 2 |
| **all** | **18** | **98** | **2** | **2** |

Per repo: Django-CRM 1, simplelogin 1, and 0 in each of the other 16 (full-stack-fastapi-template, netbox, saleor, flask, fastapi, langchain, InvenTree, ralph, Misago, paperless-ngx, wger, lotus, pontoon, open-wearables, tasking-manager, changedetection.io).

Every Python call-wrapper or layering card at this commit, with its candidate reason (`census-candidate/<repo>.json`):

| Card | Kind | Role | Guards (product) | D8 candidate |
| --- | --- | --- | --- | --- |
| Django-CRM `D-f135a4` (`HasOrgContext`) | call wrapper | 94 | yes | **default** |
| simplelogin `D-2a4960` (`app/**` does not import `events/**`) | layering | 195 | n/a | **default** |
| Django-CRM `D-4a6ea2` (`HasOrgContext`) | call wrapper | 41 | yes | `small_role` |
| tasking-manager `D-c7acd1` (`admin_only` or `login_required`) | call wrapper | 43 | yes | `small_role` |
| Django-CRM `D-220569`, `D-4b232f` (DRF `IsAuthenticated`) | call wrapper | 94, 98 | yes | `names_package` |
| open-wearables `D-dadcea` (`_get_db_dependency`) | call wrapper | 117 | no | `not_guard` |
| tasking-manager `D-cfe608`, `D-3e220e` (`get_db`) | call wrapper | 98, 43 | no | `not_guard` |

- **The guard notion behaves as intended on these cards.** Every database-session wrapper is `not_guard`. Every permission or login wrapper is a guard.
- **The floor costs 2 of 4 cards.** With D7's floor of 15, the pool would be 4 cards from 3 repos (adding `D-4a6ea2` and `D-c7acd1`). That would still be an order of magnitude short. 15 was not pre-registered and is given here only for scale.
- **Reaching 40 cards from 10 repos needs new Python dev repos**, chosen as the decision log says. At this yield (2 cards in 18 repos) that would be far more than 10 repos, unless guard-heavy frameworks give more. The Python plan saw the same: no FastAPI repo in `py` gives a guard card.

### How it was staged

The product is `5cfbbb4` (this branch, with main `f293f1c` merged), built release with `DRIFT_BUILD_COMMIT=5cfbbb4-d8`. Earlier stagings at `ae63146` (main `cf897fa`), `cb5c5fc` (main `8345b68`) and `19c8854` (main `fe7af62`) gave the same 2 cards. They were redone because main gained #73 (one access-control vocabulary, which the guard notion reads), #75 (Python precision and lowering) and #79 (Python continuation). Before the build, every `.rs` file was touched, and the build used a worktree-specific `--cfg`, so no other worktree's artifacts in the shared target could be reused. The binary was checked to embed its own commit string and the D8 option's text. A second binary of the same commit, built with the shared `build-verified.sh` (codegen-units 23 on the workspace crates, commit tag checked), gave a byte-identical `census --json --candidate d8` on all 18 repos (the `commit` and `root` fields aside), run on the read-only dev clones. Commands, from the root of the checkout, with `S` the scratch folder:

```sh
# private checkouts of the read-only dev clones (git fetch --depth 1 file://<clone> <pin>; the clones were never written)
node eval/study/prepare.mjs --drift $S/bin/drift-d8 --drift-src . --force --manifest eval/repos-py.json \
  --run eval/study/runs/d8-prereg-2026-11-07/py --cache $S/cache \
  --only full-stack-fastapi-template,netbox,saleor,flask,fastapi,langchain
node eval/study/prepare.mjs --drift $S/bin/drift-d8 --drift-src . --force --manifest eval/repos-py-2.json \
  --run eval/study/runs/d8-prereg-2026-11-07/py2 --cache $S/cache
for r in <18 repos>; do drift --root $S/cache/repos/$r --no-cache census --json --max 15 --candidate d8 > eval/study/runs/d8-prereg-2026-11-07/census-candidate/$r.json; done
for P in py py2; do
  node eval/study/stage.mjs stage --run eval/study/runs/d8-prereg-2026-11-07/$P --checkouts $S/cache/repos --cache $S/stagecache \
    --tier eval/study/tier-d8-candidate.json --view d8 --candidate-json eval/study/runs/d8-prereg-2026-11-07/census-candidate --relabel default \
    --allow-tier-mismatch "<the census tier lines are D7's; the view is D8's candidate>" --purpose "<D8 dev pool, NOT labelled>"
done
```

- **What stage.mjs checked.** For each part, the product's candidate tier equals `lib.mjs` `tierOf` under `tier-d8-candidate.json` on every proposal: 23 of 23 in `py`, 75 of 75 in `py2`. The census `tier:` lines are D7's, which is what ships. The only 2 that differ from the view are the 2 D8 cards, recorded in `stage.json`.
- **What was written.** `py2/relabel/` holds the 2 cards as a sub-run, but no prompt was rendered and nothing was labelled. It must not be labelled while the pool is under the threshold. Its `checkouts` were private copies and have been deleted, so any later round re-creates them at the pins.
- **No labels were carried.** `carried.jsonl` is empty: D8 relabels fresh.
- **Clones.** The dev clones' `git status --porcelain --ignored` did not change. polar and CTFd were not scanned. No held-out manifest or repo was opened.

## Files

| File | What it is |
| --- | --- |
| `floors.mjs`, `floors.md` | the floor analysis above (metrics.mjs family rows at each floor; the role sizes of every labelled Python card, by family) |
| `py/`, `py2/` | the prepared dev runs (`run.json`, `queue.json`, `proposals/`, `pool/`), the D8 view (`views/d8/`, each item with the product's `guards`), `stage.json` (every proposal's candidate tier and reason) and, in `py2`, the unlabelled `relabel/` sub-run of the 2 D8 cards |
| `census-candidate/<repo>.json` | `census --json --max 15 --candidate d8` of each of the 18 repos, by the run's binary: what `--candidate-json` read |
