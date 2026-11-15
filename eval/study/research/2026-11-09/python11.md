# python11: Python WRONG causes and framework lineage for the FastAPI stack (2026-11-09)

**Research, build set only. Not merged: main is frozen at F11 (1a44d7ef) until the dev4-check. Any mechanism that passes is a candidate for F12.**

## 0. Pre-registration (written and committed before any mechanism figure was computed)

- **Data read for diagnosis.** The v3 labels of Python cards in folds 1–4 (`dev-v3-2026-11-06`, `dev-v3-relabel3/4/5`, newest label per uid; polar and CTFd never read), the F11 census of the 18 Python build repos, and fact dumps (`scan --json`) of 12 of them. **No dev3 card, label reason or fact was read** (only the aggregate in PLAN-R11 §3). Nothing of dev4 or held-out was opened.
- **Mechanisms (at most 2).**
  - **M1, pydantic schemas.** Classes whose bases reach `pydantic.BaseModel` (or `RootModel`, v1 `BaseModel`) through the repo's own classes get the lineage kind `schema` (`RoleSelector::member_kind`), as DRF serializers and Django models already do.
  - **M2, SQLAlchemy declarative models.** Classes whose bases reach `sqlalchemy.orm.DeclarativeBase` / `DeclarativeBaseNoMeta`, or a module-level `Base = declarative_base()` of the repo, get the existing lineage kind `model`.
  - SQLModel is left plain [STRICT]: a SQLModel class is a table only with `table=True`, which the facts do not record, so no kind is guessed.
- **Design folds: 2, 3 and 4** [STRICT]. The mechanisms were designed from fact dumps of repos in folds 2 (langchain, simplelogin, lotus, Misago, netbox), 3 (fastapi, full-stack-fastapi-template, flask, saleor) and 4 (tasking-manager, open-wearables, changedetection.io). **Other folds: 1 and 5** (fold 5 = dev3 Python, never read card-level by this workstream).
- **Fold rule** (PLAN-R10 §3.2, PLAN-R11 §5). Each mechanism is admitted only if it (1) helps cards in ≥ 3 repos across ≥ 2 folds; (2) loses no ACCEPT outside folds 2–4; (3) has a positive other-fold effect; (4) fold 5's effect is not negative. "Helps" = a WRONG card removed or turned into a card labelled ACCEPT, or a new card labelled ACCEPT. "Effect" per fold = (ACCEPTs gained − ACCEPTs lost) − (WRONGs gained − WRONGs lost), unlabelled counted as WRONG [STRICT].
- **Populations.** (a) the **opt-in view** (`census --python-proposals`, show table applied, frozen: it is not regenerated [STRICT]); (b) the **mined pool**, every Python card before the show table (a research-only build that skips the show policy; never shipped). The fold rule is judged on (a) and (b) separately; a mechanism passes only if it passes on both [STRICT].
- **Labels.** New or changed cards are labelled blind under rubric v3 by a separate labelling agent, through rows files keyed by opaque keys; this workstream does not label its own cards.

### 0.1 Amendment after the lead's re-scope (written before any M2′ figure; M2 never evaluated)

- **Re-scope.** The lead asked for application-style Python first, with the FastAPI router/auth argument family as priority one, and passed on two pilot hypotheses (a private repo this workstream cannot see; hypotheses only): FastAPI's transitive `Depends` closure gives incidental "wrapped in get_db()" cards, and "every handler passes `response_model`" breaks on DELETE/204 endpoints. The lead's concrete proposal: **count a transitive provider as a wrapper only when it is guard-shaped.**
- **M2 (SQLAlchemy) is withdrawn, unevaluated.** Its binary build was stopped before it finished; no M2 census was ever produced or read. Its commit is reverted on the branch (the code stays in history for a later round).
- **M2′, transitive providers.** In the FastAPI dependency closure that Drift turns into a handler's call wrappers, a dependency the handler (its route, router or mount) declares itself still counts, as today; a dependency reached only through another dependency counts **only when it is guard-shaped**: a FastAPI/Starlette security scheme (`fastapi.security.*`), an in-repo dependency whose body turns its caller away (`rejects_caller`), or one that itself depends, at any depth, on such a guard. A resource provider reached transitively (`get_db` under `get_current_user`) is no longer a wrapper of the handler.
- **Design folds for M2′: 2, 3 and 4** [STRICT], as for M1: the FastAPI repos of folds 3 and 4 were read (fact dumps) while designing it. Other folds: 1 and 5. Fold rule, populations and labelling as in §0.
- **Not a mechanism here: `response_model` on DELETE/204.** No build-set census at F11 has a `response_model` card (fastapi, full-stack-fastapi-template, open-wearables and tasking-manager pass it on 15–138 handlers but none forms a card), so the hypothesis cannot be validated on the build set; it is recorded, not built.

## 1. Diagnosis: what Python WRONGs are made of (folds 1–4)

Two populations, both from the v3 labels (newest label per uid; a label counts only on a byte-identical card):
- **History:** every labelled Python card of folds 1–4 since dev-v3 (104 cards: 53 ACCEPT, 1 TRIVIAL, **50 WRONG**).
- **F11:** the cards the frozen F11 binary mines with Python proposals on (`--python-proposals`), before the show table: 58 cards, every one byte-identical to a labelled card: 40 ACCEPT, **18 WRONG** (69.0%).

WRONG by labelled reason, and per fold:

| | mixed_group | incidental | legit_outliers | false_outliers | misdescribes | WRONG / cards |
|---|---|---|---|---|---|---|
| History, all | 19 | 12 | 11 | 6 | 2 | 50 / 104 |
| fold 1 | 6 | 1 | 3 | 1 | 0 | 11 / 25 |
| fold 2 | 8 | 6 | 5 | 0 | 2 | 21 / 40 |
| fold 3 | 2 | 1 | 1 | 0 | 0 | 4 / 9 |
| fold 4 | 3 | 4 | 2 | 5 | 0 | 14 / 30 |
| F11, all | 6 | 2 | 6 | 2 | 2 | 18 / 58 |

WRONG / cards by rule family (history; F11 in brackets): calls 16/24 (4/11), naming 9/25 (1/12), base class 5/12 (3/8), decorator 3/7 (3/7), call wrapper 3/13 (1/6), avoids 4/5 (1/2), has_test 3/4 (1/1), call order 3/3 (–), argument key 2/4 (2/4), package and model facts 2/2 (2/2), control 0/4 (0/4), import source 0/1 (0/1).

**The three structural causes** (each WRONG read against its labeller's reason and assigned to one cause):

| Cause | History | F11 | What it is |
|---|---|---|---|
| **S1. A role that mixes kinds of class** | 21 (42%) | 7 | A file- or folder-keyed class role holds several framework kinds or value types: serializer fields beside serializers, permission classes in `api.py`, admin inlines beside model admins, `str`/`int` value types among DTOs or repositories, plain forms beside model forms, a router beside URL pattern lists. Round 9's member kinds (Django/DRF/WTForms lineage) removed most of them; what is left is in roles whose framework Drift has no lineage for (pydantic, plugin infrastructure) or within one lineage (DRF `APIView` beside `ViewSet`). |
| **S2. A need-driven rule** | 16 (32%) | 4 | The members do X because they need it (a DB session, a flash message, a redirect, a schema decorator a standard action does not need, an env read); the outliers simply lack the need: static, read-only, probe or download endpoints. Python call and call-order rules over Flask handlers, `Depends(get_db)` wrappers, "do not read os.environ". |
| **S3. Compliance Drift does not see** | 6 (12%) | 2 | The outlier complies another way: it returns `Response` through a local helper, registers with `admin.site.register()` instead of the decorator, passes the key positionally. |
| Other | 7 | 5 | Single categories (settings modules, the tenant model itself, a pytest plugin's own dependency) and two misdescribed rules. |

**Two findings about what reaches people.**
- **The opt-in view is naming only.** The frozen show table admits one Python family, naming, with at most one outlier. At F11 the opt-in view of folds 1–4 is **9 cards, 9 ACCEPT, 0.5 per repo**, every one from a Django/DRF repo; the 8 FastAPI, Flask, pydantic and SQLAlchemy repos of the build set show 0 or 1. Fold 5 (dev3) shows 2 cards (1 ACCEPT), the figure in PLAN-R11 §3.
- **Why application-style non-Django repos show nothing:** W3 proposes no naming rule over plain Python classes, and only Django, DRF and WTForms classes have a lineage. pydantic `BaseModel` is the largest unclassed base on the build set (fact dumps: fastapi 378 classes, open-wearables 320, tasking-manager 146, langchain 133). M1 tests whether giving it a lineage adds cards.

## 2. Results

Binaries (all release, `build-verified.sh`): base = F11 `1a44d7ef` (CGU 185, sha256 `50034bf5…`), M1 = `962a13ce` (CGU 85, `24e367a8…`), M1 + M2′ = `3e55040d` (CGU 85, `9f123c45…`). Each carries a **research-only** switch (`PY11_RESEARCH_UNSHOWN`, never committed) that skips the show policy, to read the mined pool; without it, the base binary's census equals the frozen F11 binary's byte for byte (checked on netbox and InvenTree, text and JSON). The branch head as pushed (M2′ only, M1 reverted; main merged in, with no crate change since F11), CGU 85, census tag `cgu85-ebf5ae0f-…`, gives exactly M2′'s row of §2.1 against the base: one card gone, opt-in view unchanged. Behaviour probes: M1's binary mines saleor's new `schemas` card; M2′'s drops open-wearables' `_get_db_dependency()` card. Census: `census --python-proposals --json --max 15` and `--all-outliers --all --max 15`, one repo at a time, `--no-cache`, private `DRIFT_CACHE_DIR`, on the 18 Python build clones and the 8 dev3 Python clones (fold 5); every clone was clean before and after.

### 2.1 Census diff (every changed card)

| Mechanism | Fold | Repo | Card | Change | v3 label |
|---|---|---|---|---|---|
| M1 | 4 (design) | tasking-manager | `D-2dfb9d` "classes in backend/models/dtos/** extend BaseModel" | gone (its role is now schemas; the base restates the kind) | WRONG mixed_group (identical card, labelled before) |
| M1 | 3 (design) | saleor | `D-98f82e` "schemas in saleor/** are named `*Schema`" (34/38) | new | **ACCEPT** (A ACCEPT, B WRONG legit_outliers, C ACCEPT) |
| M1 | 5 (other) | one dev3 repo | a base-class card on pydantic schemas | gone | **WRONG** false_outliers on its base version (A WRONG, B ACCEPT, C WRONG): its one outlier is a `RootModel`, which M1 now reads as a schema |
| M2′ | 4 (design) | open-wearables | `D-dadcea` "HTTP handlers in app/** are wrapped in _get_db_dependency()" | gone (the session reached through `get_current_developer` no longer counts) | WRONG incidental (identical card) |

All four are suggestion tier (`language_advise`). **The opt-in view did not change on any of the 26 repos** for either mechanism: saleor's new card has 4 outliers and the show table hides it. TypeScript cards of these repos did not change either.

### 2.2 Fold rule

Effect per fold = ACCEPT gained − ACCEPT lost − WRONG gained + WRONG lost (unlabelled counts as WRONG).

| | Population | Repos helped (folds) | ACCEPT lost outside folds 2–4 | Other-fold effect (folds 1, 5) | Fold-5 effect | Verdict |
|---|---|---|---|---|---|---|
| **M1** | opt-in view | 0 | 0 | 0 | 0 | **fails** (1, 3) |
| | mined pool | 3 (folds 3, 4, 5) | 0 | **+1** (fold 5; fold 1: 0) | +1 | passes |
| **M2′** | opt-in view | 0 | 0 | 0 | 0 | **fails** (1, 3) |
| | mined pool | 1 (fold 4) | 0 | 0 | 0 | **fails** (1, 3) |

- **M1 fails as pre-registered** [STRICT: it had to pass on both populations]. On the mined pool it passes, but on the thinnest possible margin: its whole other-fold effect is one fold-5 card.
- **M1's yield hypothesis is refuted on the build set.** Giving hundreds of pydantic classes a kind added one card. FastAPI schemas carry several suffixes by role (`*Create`, `*Update`, `*Read`, `*Response`), so no single naming rule holds; the classes the kind removes from plain roles were mostly the outliers of WRONG base-class cards.
- **M2′ fails.** The one build-set card it removes is WRONG (open-wearables). The other get-db card on the build set (tasking-manager `D-ee4d58`, ACCEPT) is unchanged, because those handlers declare `get_db` themselves. So M2′ separates the two cases the way their labels do, but on one repo.
- In-sample, the mined pool of folds 1–4 goes from 40/58 ACCEPT (69.0%) to 41/57 (71.9%) with both mechanisms. The opt-in view stays 9/9.

### 2.3 The router/auth argument family (lead's priority one): not buildable on the build set
- **What F11 already does.** It propagates FastAPI dependencies from `APIRouter(dependencies=[…])`, `include_router(…, dependencies=[…])` and route decorators into each handler's call wrappers, with their closure.
  - A synthetic probe (20 routers, 19 of them with `dependencies=[Depends(require_member)]`) mines "HTTP handlers in svc/** are wrapped in require_member()".
  - Its outliers are the 2 routes of the one unguarded router.
- **Two structural reasons a person never sees such a card in Python today**, both outside this round's scope:
  1. **The frozen show table hides the Python `wrapper` and `argument_key` families.**
     - `wrapper` is 5/6 in-sample but fails the leave-one-repo-out minimum of 5 cards.
     - `argument_key` is 2/4.
  2. **`max_outliers = 1` counts outliers per handler.** One unauthenticated router with k routes gives k outliers. The pilot's card, whose only outlier was one dev-only router, would be hidden even at handler level.
- **Build-set evidence is absent.**
  - Router-level `dependencies=` appears on 1 of 37 routers in open-wearables and on none in tasking-manager (43) or full-stack-fastapi-template (6).
  - No build-set or fold-5 census, before or after, has a card whose rule names `APIRouter`, `dependencies` or `response_model`.
  - So a router-granularity mechanism (one outlier per router, not per route) has nothing to be measured on here. It is recorded as a hypothesis for a pool with guarded FastAPI routers, not built.
- **`response_model` on DELETE/204.** It cannot be validated: the four FastAPI build repos pass `response_model` on 12–138 handlers, but no card forms.

### 2.4 M1 breaks a fail-closed probe, so it is kept as a patch, not on the branch
- **The probe.** The full test suite on M1 fails `hooks::python_hooks_and_check_fail_closed_on_bases_the_facts_do_not_show` (review probe #27).
  - The team's base is built on `BaseModel` in a way the facts cannot show: a starred base, or two conditional definitions.
  - Its subclasses therefore stay plain classes.
  - A new class written directly on `BaseModel` now gets the `schema` kind, so it lands in another role. The plain role's convention no longer checks it.
- **Why it matters.** That is a fail-open in exactly the case the product promises to fail closed. The same gap exists today for Django models on an unresolvable team base. pydantic was the base the probe used precisely because it had no kind.
- **What happens to M1.**
  - It is removed from the branch (reverted).
  - It is kept as `python11-m1.patch` beside this record, with its tests, for a later round.
  - A later round needs a rule for it first: a class of a kind next to members whose ancestry is unknown is still checked against the plain role.
- **Its figures in §2.1–2.2 stand as measured.**
- **M2′ changes one suite expectation, in the strict direction.** In `hooks::python_dependency_chains_hold_in_census_check_and_hooks`, a route that reaches the session only through a context dependency that guards nothing becomes an outlier: 3 outliers instead of 2. A transitive provider no longer counts as a wrapper, so M2′ can add outliers but cannot hide one.

### 2.5 Candidate structural families for Python roles (lead's list): what Drift already extracts
Both mechanism slots were used, so nothing more was built here. This is what exists already.

Columns:
- **Facts**: whether the Python facts record it.
- **Rule kind**: what mining makes of it.
- **F11 cards**: the cards it gives in the mined pool of folds 1–4, before the show table (58 cards), with their v3 labels.
- **Show table**: whether the frozen show table shows it for Python, and why not.

| Family | Facts | Rule kind | F11 cards (ACCEPT/all) | Show table, Python |
|---|---|---|---|---|
| Naming patterns | symbol names | `named` | 11/12 | **shown** (the only admitted family); W3 limits it to lineage kinds, special kinds and entry points |
| Base class | `wraps` extends, with in-repo lineage | `wrapped_by:extends` | 5/8 | hidden (base_class, LORO 0.50) |
| Decorator usage | `wraps` decorator | `wrapped_by:decorator` | 4/7 | hidden (decorator, LORO 0.25) |
| `Depends` injection | FastAPI dependencies, closure into handler `wraps` call (M2′ here) | `wrapped_by:call` | 5/6 | hidden (wrapper: 5/6, but under 5 cards with one repo left out) |
| Return annotations | `controls: typed_return` | `control` | 4/4 | hidden (control: 4/4, under 5 cards with one repo left out) |
| Logging call shape | `calls` (`get_logger()`, `logger.*`), call keywords in `args` | `calls`, `passes_key` | calls 7/11, argument key 2/4 | hidden (calls LORO 0.56; argument_key 0.33) |
| Error-handling idiom | `controls` (`try`, `throw`, `rejects_caller`), `throws` | `control: throw`, `throws` | 0 cards | `throws` maps to no family (never shown); `control: throw` forms no Python card |
| Config-class pattern | none (`BaseSettings` has no kind; plain base only) | `wrapped_by:extends` at best | 0 cards | – |
| `__all__` presence | lowered (static names, used to resolve re-exports) | no rule kind | – | – |
| Import source (for comparison) | imports | `imports_from` | 1/1 (langchain) | hidden (import_source, 1 card) |

**Reading.**
- **Most of the families on the list are already extracted and mined.** Six of the nine have a rule kind and cards on the build set, at 50–100% ACCEPT in-sample. The exceptions are config classes, `__all__` presence and the error-handling idiom.
- **What keeps them from people is the frozen show table, not extraction.**
  - Every Python family but naming has fewer than 5 labelled cards with some repo left out, so leave-one-repo-out cannot admit it.
  - The single-outlier cap then applies on top.
- **So the cheapest Python yield gain is more labelled Python cards** (dev3 and dev4 in the build set) and a regenerated show table, not new families. That is a round-12 decision, since round 11 does not regenerate the table [STRICT].
- **Import starvation** (PLAN monorepo11) affects only `imports_from` and layering. On the build set that is 1 and 1 Python cards.

## 3. What this means for Python (D13)
- **Python's blind problem is mostly S1, then S2.**
  - On the build set's history, mixed kinds and need-driven rules are three quarters of the WRONGs.
  - Member kinds fixed most of S1 in Django/DRF repos. That is why the in-sample opt-in view is 9/9, and why it is all Django.
- **The yield gap is real and structural:** 0 cards in every FastAPI/Flask build repo.
  - Lineage alone does not close it (M1).
  - The families that would serve those repos, auth call wrappers and router dependencies, are hidden by the frozen show table.
  - Their outliers are counted per route.
- **Candidates for F12, neither admitted.**
  - **M1 (pydantic `schema` kind; patch only):** fails on the opt-in view, passes on the mined pool by one fold-5 card, and fails probe #27 (§2.4). Worth carrying only with a fix for that probe and a regenerated show table, re-measured on dev4 once it joins the build set.
  - **M2′ (transitive providers count only when guard-shaped):** fails (one repo). It matches the labels on the two build-set get-db cards, and it removes the pilot's "wrapped in get_db()" pattern by construction. It needs a pool with more FastAPI apps.
- **Next, for round 12, not done here:**
  - regenerate the show table with dev3 and dev4 in the build set, and see whether Python `wrapper` clears the LORO bar;
  - count a router-level wrapper's outliers per router.

## 4. Protocol notes and deviations
- **Labelling.**
  - Two cards needed labels: saleor's new card and the fold-5 card's base version.
  - They were labelled blind under rubric v3 through rows keyed by opaque keys (`K-…`). The key map stayed in this workstream's scratch.
  - Prompts were rendered from `REVIEWER-PROMPT.md` and `ADJUDICATOR-PROMPT.md` with the full v3 rubric. The `agents:` line was dropped.
  - Labeller A ran on the default model and B on a different, smaller model, each a separate headless agent session started in a fresh empty directory with read access to the checkout and write access to its outbox only. C (default model) adjudicated both, since A and B disagreed on both. Every working directory was empty afterwards.
  - This workstream labelled nothing itself.
- **Fold 5.**
  - No dev3 card, label reason or fact was read before both mechanisms were committed.
  - Afterwards the evaluation output showed card titles of dev3 repos, and the fold-5 card's labels came back from the labellers. No mechanism changed after that.
  - Per the hard rules, no dev3 card id, reason or file is quoted here.
- **Re-scope.** M2 (SQLAlchemy declarative models) was withdrawn before any census of it existed (§0.1). Its revert commit carries git's default message without the session trailers.
- **TypeScript.** Both mechanisms are in Python-only code paths (`drift-py`'s lineage and link passes). The TS cards of the 26 Python repos did not change, and the 16 TS build clones were not re-censused.
