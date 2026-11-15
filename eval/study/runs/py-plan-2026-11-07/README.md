# Python default tier: what it would take (2026-11-07), analysis only

**Dev sets, not held-out. No labels were made here and no product code changed.** This run takes a census of the Python dev clones at main `feefad6` and joins it with the rubric v3 labels of [`runs/dev-v3-2026-11-06`](../dev-v3-2026-11-06/README.md) (labelled at main `debc33a`). It asks what a Python default tier, which decision D7 removed, would need to reach the release gate: **≥ 95% default-tier accept under rubric v3 on a primary held-out run**. `py` was used for tuning and `py2` is a dev set too, so every figure here is optimistic.

## Top line

- **Python today: 22.8%** accept over all 79 Python proposals shown (18 ACCEPT, 0 TRIVIAL, 45 WRONG, 16 unlabelled counted as WRONG; Wilson 14.9–33.2%). All 79 are suggestion tier (`tier_reason: language_advise`), as D7 requires.
- **The smallest D7-style subset is Python auth-guard call wrappers plus layering** (in-repo targets, roles of ≥ 15). It has no WRONG card. But the dev sets hold only **4** such cards, from 3 repos: **2/4 = 50.0%** (Wilson 15.0–85.0%) with the two unlabelled cards counted as WRONG, 2/2 labelled, and **4/4 at best** (Wilson 51.0–100%).
- **Headroom cannot be shown on this sample.** With zero WRONG, a Wilson lower bound of 95% needs **73** clean dev cards. The Python dev sets give 4.
- **Wider subsets stay far below the gate.** All call wrappers plus layering: 3/7 (42.9%), at best 5/7 projected. All of D5's Python kinds: 3/18 (16.7%), 6/18 projected. Landing every fix class found here gives at most 14/15 (93.3%, Wilson 70.2–98.8%), and that figure depends on five fixes that were each tuned to a single dev repo.
- **Recommendation: Python stays advise-only.** No D8 now. "D8 candidate, for later" below sets out what a future D8 should pre-register.

## Commands

```sh
S=<scratch>; D=<scratch>/dev-clones
# release build of main feefad6 (clean tree), DRIFT_BUILD_COMMIT=feefad6-pyplan so census --json records it:
#   cargo build --release --locked -p drift-cli  ->  $S/bin/drift-feefad6  (sha256 c4d9cbe92196…)
export DRIFT_CACHE_DIR=$S/driftcache
for part in py py2; do for dir in $D/$part/*/; do n=$(basename $dir)   # polar and CTFd are not in the clones
  drift --root $dir --no-cache census --json --max 15            > $S/census/$part/$n.json
  drift --root $dir --no-cache census --all-outliers --max 15    > $S/census/$part/$n.txt
done; done
node eval/study/runs/py-plan-2026-11-07/join.mjs --census $S/census
```

- **Two outputs.** `census --json --max 15` is the census of record: it gives the rule kind, tier, tier reason, language and every outlier. The text census with `--all-outliers` is the format the labelled run showed its labellers (`prepare.mjs`, `proposals/<repo>.txt`). `join.mjs` uses it only to decide card identity, and it checks that both outputs list the same proposals in the same order.
- **The clones.** All 18 clones were at their pinned sha before and after. `git status --porcelain --ignored` did not change during any census. Misago already had an ignored `misago/collections/__pycache__/` before this run; it was not created here and was left alone.
- **What was not scanned.** polar and CTFd are excluded by the brief. Their labels in `py/final.jsonl` are not used.

## Files

| File | What it is |
| --- | --- |
| `join.mjs` | the join: census × v3 labels, kind groups, tallies, subsets |
| `py/join.json`, `py2/join.json` | every shown proposal with its rule kind, kind group, tier and tier reason, language, member count, D5 conditions, `status`, and its v3 label only when `status` is `identical`. Changed cards carry `old_label` (the old card's label, never counted as this card's) and a line diff. Also `gone`: labelled uids no longer shown. |
| `summary.json` | per-kind and per-rule-kind tallies with Wilson intervals, the WRONG cards by reason with the labellers' reasons, the candidate subsets, and the TypeScript-side proposals |
| `fixes.json` | the analyst's reading of the 9 unlabelled cards in the candidate pool (**projections, not labels**) and the fix classes, ranked, with overfit flags |

## The join (rule 4: labels carry only to identical cards)

A label carries only when the card is byte-identical to the one that was labelled: the same uid, the same repo pin, and the same census block without the rank and `tier:` line (`stage.mjs` rule 4).

| Part | Shown at feefad6 | Identical (labelled) | Changed | New | Gone since debc33a |
| --- | --- | --- | --- | --- | --- |
| py (6 repos) | 23 | 15 | 7 | 1 | 0 |
| py2 (12 repos) | 75 | 66 | 7 | 2 | 3 |

Of these 98 proposals, 79 are Python. The other 19 are the TypeScript side of these repos' frontends (see "TypeScript side" below).

**Changed (14).** Every change but one is an exemption. Members that were outliers now appear as `exempt:` lines with a reason ("another kind of class", "in the module that defines X", "shared part used by N members", "documented exception"). The evidence and outlier list shrink with them. The exception is simplelogin `D-2a4960`, where only the summary wording changed.

| uid | kind | old card's label |
| --- | --- | --- |
| netbox `D-76eb6b` | passes_key | WRONG legit_outliers |
| netbox `D-bc0c7d` | decorator | WRONG mixed_group |
| netbox `D-e2c3e4` | base | WRONG mixed_group |
| netbox `D-58913a` | calls | ACCEPT |
| netbox `D-937c0c` | named | WRONG mixed_group |
| netbox `D-310ec7` | passes_key | ACCEPT |
| fastapi `D-499c0e` | control | ACCEPT |
| InvenTree `D-47d790` | base | TRIVIAL |
| ralph `D-4529f9` | base | WRONG mixed_group |
| ralph `D-5b6f70` | base | WRONG legit_outliers |
| ralph `D-43f01e` | named | WRONG mixed_group |
| Misago `D-b4e5ff` | named | WRONG mixed_group |
| paperless-ngx `D-de2489` (TS) | named | WRONG mixed_group |
| simplelogin `D-2a4960` | layering | ACCEPT (wording only) |

**New (3).**
- langchain `D-0e154c` (imports_from).
- open-wearables `D-dadcea`: call wrapper, `_get_db_dependency()`.
- tasking-manager `D-c7acd1`: call wrapper, `admin_only() or login_required()`.

The last two come from #60 (mixed auth sets keep only guards). They replace the **gone** mixed-set cards:
- open-wearables `D-3b39dc` (was ACCEPT);
- tasking-manager `D-c373f7` (was WRONG legit_outliers);
- tasking-manager `D-86bd7f` (was ACCEPT).

All 17 changed or new cards are unlabelled, and they count as WRONG in every target-definition figure.

## By rule kind: Python, current product

All Python proposals are suggestion tier under D7. The "accept" columns use the target definition: ACCEPT over all shown, with unlabelled counted as WRONG. "D5 cond." restricts each kind to what a Python default tier would admit under D5's conditions: every symbol the rule names is in the repo, and the role has ≥ 15 members.

Call wrappers are split by what the wrapped callable is, judged from its name (`join.mjs` `callKind`):
- **auth:** a guard such as a login, admin, permission, org-context or API-key check. These arrive as FastAPI `Depends`/`Security` parameters (tasking-manager) or as DRF `permission_classes` (Django-CRM).
- **resource:** a database session.

| Kind | Shown | ACCEPT | TRIVIAL | WRONG | Unlabelled | Accept, all shown | D5 cond.: shown, accept | WRONG by reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| call wrappers, auth | 5 | 4 | 0 | 0 | 1 | 80.0% (4/5); Wilson 37.6–96.4% | 3: 2/3 (66.7%) | none |
| call wrappers, resource | 3 | 1 | 0 | 1 | 1 | 33.3% (1/3) | 3: 1/3 | incidental 1 |
| decorators | 6 | 1 | 0 | 4 | 1 | 16.7% (1/6); Wilson 3.0–56.4% | 4: 0/4 | legit_outliers 3, mixed_group 1 |
| bases (extends) | 9 | 1 | 0 | 4 | 4 | 11.1% (1/9); Wilson 2.0–43.5% | 6: 0/6 | legit_outliers 2, mixed_group 2 |
| passes_key | 4 | 1 | 0 | 1 | 2 | 25.0% (1/4) | 1: 0/1 | false_outliers 1 |
| layering (avoids:import) | 1 | 0 | 0 | 0 | 1 | 0.0% (0/1) | 1: 0/1 | none |
| others | 51 | 10 | 0 | 35 | 6 | 19.6% (10/51); Wilson 11.0–32.5% | 35: 10/35 | mixed_group 14, incidental 9, legit_outliers 6, false_outliers 5, misdescribes 1 |
| **all Python** | **79** | **18** | **0** | **45** | **16** | **22.8% (18/79); Wilson 14.9–33.2%** | 53: 13/53 (24.5%) | mixed_group 17, legit_outliers 11, incidental 10, false_outliers 6, misdescribes 1 |

- **Other kinds by rule kind** (accept over all shown): calls 2/19, named 4/15, control 3/4, avoids:other 0/4, before 0/3, has_test 1/3, dependency_version 0/1, model_has 0/1, imports_from 0/1. Per part, `summary.json` `python.by_group` gives `py` and `py2` separately.
- **No call-wrapper or layering card comes from `py`.** fastapi, full-stack-fastapi-template, flask, langchain, netbox and saleor show none. Every Python call wrapper and the one layering rule are in `py2`, from Django-CRM, tasking-manager, open-wearables and simplelogin.

### WRONG cards by reason (Python, identical cards; `summary.json` `python.wrong`)

| Reason | n | Examples (labeller's reason, abridged) |
| --- | --- | --- |
| `mixed_group` | 17 | netbox `D-281ae8` "decorated with register_type()": the only outlier is an abstract base type kept for plugins. tasking-manager `D-2dfb9d` "dtos extend BaseModel": the outlier is a `str` subclass field type. simplelogin `D-e29828` "dashboard classes extend FlaskForm": a view-model data holder. Naming rules over serializer files that also hold fields and helpers (InvenTree `D-43f01e`, wger `D-db04dc`, lotus `D-1cbdac`, ralph `D-b1df5c`). |
| `legit_outliers` | 11 | Misago `D-c9ae1e`/`D-e72fc8` "hooks extend FilterHook": the outliers deliberately extend the sibling `ActionHook`. netbox `D-cc1341` "filtersets decorated with register_filterset()": the secondary filtersets would overwrite the primary registration. changedetection.io `D-2619c7`: `Spec.get` serves the spec itself. wger `D-82d21d`: a standard `list()` override whose schema is inferred. lotus `D-2ab768`: models with no tenant field. |
| `incidental` | 10 | tasking-manager `D-3e220e` "actions wrapped in get_db()": a handler that needs no DB would be flagged. simplelogin's six `flash()`/`redirect()`/`url_for()` call and ordering rules. saleor `D-e36ea5` and changedetection.io `D-7f369e` "do not read os.environ". |
| `false_outliers` | 6 | Django-CRM `D-e62e87`/`D-0bd0ec`/`D-f01192` "call response.Response()": the outliers return it through a helper. tasking-manager `D-4ede9c` (passes_key): `content` is passed positionally. open-wearables `D-ff3192`/`D-6606a8`. |
| `misdescribes` | 1 | simplelogin `D-7fa3b5`. |

### TypeScript side

These are the frontend proposals of the Python repos (paperless-ngx, Misago, tasking-manager, InvenTree, pontoon, open-wearables, Django-CRM, full-stack-fastapi-template). They are TypeScript by `language`, and none is in the default tier at feefad6.
- 19 shown: 7 ACCEPT, 11 WRONG, 1 unlabelled.
- Tier reasons: `rule_kind` 15, `rule_kind_d7` 4.
- They are not part of any Python figure and do not affect D7's TypeScript measurement.

## The smallest subset that could reach 95%

Candidates are Python proposals of a kind, under D5's conditions. The **projected** column is the analyst's reading of each unlabelled card (`fixes.json` `projected`). Projections are not labels; only a blind v3 relabel decides them.

| Subset | Repos | Today: ACCEPT / shown (unlabelled = WRONG) | Labelled only | Ceiling (unlabelled = ACCEPT) | Projected |
| --- | --- | --- | --- | --- | --- |
| **auth call wrappers + layering** | 3 | **2/4, 50.0%; Wilson 15.0–85.0%** | 2/2; 34.2–100% | 4/4; 51.0–100% | **4/4; 51.0–100%** |
| auth call wrappers only | 2 | 2/3, 66.7%; 20.8–93.9% | 2/2 | 3/3; 43.9–100% | 3/3 |
| layering only | 1 | 0/1; 0.0–79.3% | — | 1/1 | 1/1 |
| call wrappers (all) + layering | 4 | 3/7, 42.9%; 15.8–75.0% | 3/4; 30.1–95.4% | 6/7; 48.7–97.4% | 5/7, 71.4%; 35.9–91.8% |
| call wrappers + layering + decorators | 6 | 3/11, 27.3%; 9.7–56.6% | 3/7 | 7/11 | — |
| D5's Python kinds (call, decorator, base, passes_key, layering) | 9 | 3/18, 16.7%; 5.8–39.2% | 3/9; 12.1–64.6% | 12/18; 43.7–83.7% | 6/18, 33.3%; 16.3–56.3% |

**The auth subset, card by card.**
- Django-CRM `D-4a6ea2` and `D-f135a4`, "HTTP handlers in leads/** (cases/**) are wrapped in HasOrgContext()", **ACCEPT**. These are DRF `permission_classes`. Their outliers are public endpoints, which are worth confirming under R3.
- tasking-manager `D-c7acd1`, "actions wrapped in admin_only() or login_required()", **new and unlabelled**. These are FastAPI `Depends`/`Security` guards. The one outlier is the public registration endpoint, the same outlier as in the ACCEPT predecessor `D-86bd7f`.
- simplelogin `D-2a4960`, "app/** does not import from events/**", **changed, wording only, unlabelled**. The old card was ACCEPT.

**Why this subset is the smallest plausible one.** It has no WRONG card, labelled or projected. It is also the Python analogue of what D7 kept for TypeScript: guards and layering. Two exclusions follow from the data:
- **Resource dependencies** (`get_db`) split 1 ACCEPT / 1 WRONG incidental / 1 projected incidental, so they are not admitted.
- **Decorators and bases** are 0/10 under D5's conditions today. That matches the round-5 plan's "Python class rules stall at about 55–64% at best".

Still, the subset is 4 cards from 3 repos, and the call-wrapper evidence comes from 2 repos. No FastAPI repo in `py` contributes a guard card: fastapi, full-stack-fastapi-template and the rest show none.

**What the gate needs.**
- **Clean cards on dev.** With zero WRONG, the Wilson 95% lower bound first reaches 95% at **n = 73** (`summary.json` `zero_wrong_n_for_lower_95`). 30 clean cards give 88.6%, and 60 cards with 3 WRONG give 95.0%, Wilson 86.3–98.3%.
- **The gate is a point estimate (D1), so a small tier passes it by luck.** At a true accept rate of 90%, a 4-card held-out tier scores ≥ 95% two times in three (P = 0.66, binomial). At 8 cards, P = 0.43. A Python default tier as small as this dev sample suggests would make the held-out verdict close to a coin flip, whatever the true precision. [STRICT] So any D8 needs a minimum n as well as the 95% point estimate (below).

## Fix classes, ranked by WRONG cards removed

The pool is D5's Python kinds under D5's conditions: 18 cards.
- Today: 6 labelled WRONG + 5 projected WRONG = 11 WRONG, 6 ACCEPT (3 labelled, 3 projected), 1 TRIVIAL (projected).
- The auth + layering subset has no WRONG card, so it needs **no fix**. What it needs is relabelling and sample.

| Rank | Fix class | WRONG removed | Repos | Overfit risk |
| --- | --- | --- | --- | --- |
| 1 | **Sibling bases.** A member that extends a sibling base defined beside the target, with the same parent, is the same kind on purpose: name both in `any_of`, or drop the single-base rule. Cases: Misago `FilterHook`/`ActionHook`, ralph `RalphAPISerializer`/`RalphAPISaveSerializer`. | 4: Misago `D-c9ae1e`, `D-e72fc8`; ralph `D-5b6f70`, `D-4529f9` (projected; `D-4529f9` also needs rank 7) | 2 | **medium.** Misago's two cards share one root cause. A guard-shaped base must stay strict. |
| 2 | **Resource dependencies are not conventions.** Keep Python call-wrapper rules whose wrapper is a guard; drop those that only provide a DB session. | 2: tasking-manager `D-3e220e`, open-wearables `D-dadcea` (projected). **Cost:** drops tasking-manager `D-cfe608`, which is ACCEPT. | 2 | low: a kind-level cut, the Python analogue of D7 |
| 3 | **Decorator rules, F3/F4.** A form in `forms/search.py` among search indexes, and a base type in the module that defines the decorator, are not about the rule. | 2: netbox `D-bc0c7d` (projected), `D-281ae8` | 1 | **HIGH: both cases are netbox** |
| 4 | **F7 does not fire at main.** The "registry key already taken" exemption still leaves netbox's connection filtersets as outliers. Every one of netbox's 138 registered filtersets has its own `Meta.model` and none is held twice, so `keyed()` should hold. | 1: netbox `D-cc1341` | 1 | **HIGH: F7 was written for this case** (its doc comment names it) |
| 5 | **Input-less handlers.** A request-validation decorator is not about a handler that reads no input. | 1: changedetection.io `D-2619c7` | 1 | **HIGH for Python** (one case), though the category is generic (RUBRIC-v3's read-only-endpoint example) |
| 6 | **passes_key.** Utility graphql types for a package model are not model types. | 1: netbox `D-76eb6b` (projected) | 1 | **HIGH** |
| 7 | **Another kind among serializers.** A permission class in a serializers `api.py`. | 0 alone (clears ralph `D-4529f9` together with rank 1) | 1 | **HIGH** |

**With every fix.** Rank 2 drops its 3 cards. Then, reading each cleared card as ACCEPT (the most optimistic reading; an exemption can also leave a card TRIVIAL or drop it), the pool is **14/15, 93.3%, Wilson 70.2–98.8%**. That is still under 95%, on a pool where ranks 3–7 were tuned to single dev cases. Without the HIGH-risk fixes it is **8/15, 53.3%** (Wilson 30.1–75.2%). So D5's Python kinds are not a route to 95%, and decorators and bases add risk without adding headroom.

## Recommendation: Python stays advise-only (no D8 now)

On the Python dev sets, the only subset with no WRONG card is auth-guard call wrappers plus layering. It holds 4 cards from 3 repos, 2 of them labelled, so its interval (Wilson 15.0–85.0% as labelled now, 51.0–100% even if both unlabelled cards come back ACCEPT) cannot separate a 95% tier from a 70% one. Showing ≥ 95% with any confidence would take on the order of 73 clean cards. Every wider subset is far below the gate: 42.9% for all call wrappers plus layering, 16.7% for D5's Python kinds. Even after every fix class found here, D5's Python kinds reach at most 93.3%, and five of those fixes were tuned to a single dev repo, so their gains would not be expected to carry to held-out repos. A D8 admitting Python on this evidence would also be measured on very few held-out cards, and with a point-estimate gate a small tier passes by luck about two times in three at a true 90%. Python therefore stays advise-only.

### D8 candidate, for later (not proposed for adoption)

If Python is revisited, pre-register this before any census of the data used to judge it:

1. **Tier.** Python `wrapped_by:call` whose every `any_of` target is a guard (the product's `guard_shaped` / auth-set notion, not a name regex), plus `avoids:import`. D5's conditions apply (in-repo targets, ≥ 15 members). Resource dependencies, decorators, bases and `passes_key` are excluded.
2. **Evidence before any held-out run.** A fresh Python dev manifest, never used for tuning, chosen for guard-heavy frameworks (FastAPI, DRF, Flask-Login). It needs ≥ 40 tier cards from ≥ 10 repos, labelled blind under v3, with point accept ≥ 97.5% and no WRONG reason recurring in two repos.
3. **Gate.** The 95% point estimate (D1) **and** a minimum of 30 default-tier cards on the primary held-out run [STRICT]. Below 30, Python stays advise-only whatever the point estimate.
4. **First, relabel** the 2 unlabelled subset cards (tasking-manager `D-c7acd1`, simplelogin `D-2a4960`), and the 7 other unlabelled cards of the D5 pool if decorator or base fixes are pursued.

## Caveats

- **Card identity is strict.** simplelogin `D-2a4960` lost its label over a wording change alone. That is rule 4, applied as written [STRICT].
- **The kind split is name-based.** `callKind` in `join.mjs` splits call wrappers by the wrapped callable's name, and it was checked by hand on all 8 Python call-wrapper cards. A product tier would use the guard notion instead.
- **The projections are one analyst's reading of the cards.** No outliers were reopened in the checkouts for them.
- **Cluster intervals were not computed.** With 2–4 repos per subset, they would be wider still.
