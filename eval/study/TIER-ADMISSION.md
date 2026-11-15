# Default-tier admission: decision memo (D5)

**Status:** proposed by the lead on 2026-11-06 and approved by the founder the same day (over C6 and over keeping rule 5), before any held-out census. Recorded as [decision D5](README.md#decisions-before-any-held-out-census-2026-11-05).
**Data:** dev labels only. No held-out manifest, repo or result was opened, and no label was added or changed.
**Reproduce:** `node eval/study/tier-admission.mjs` prints every table below, from `runs/dev-ts-r2-2026-11-05` and `runs/dev-py-r2-2026-11-05` (both on main).

## Recommendation

Admit a proposal to the default tier (the tier that may block agents) only when all three hold:

1. its rule kind is a **call wrapper, decorator, base class, layering rule (`avoids:import`) or JSX layout wrapper**. Required argument keys (`passes_key`) and rendered components (`renders`) move to the suggestion tier.
2. **every symbol the rule names is addressed through the repository's own code**: no `pkg:` (package), `global#` (built-in or ambient, such as `Error` or Python's `Exception`) or `unresolved:` wrapper, decorator, base class or callee, and no `import:` avoidance of one (`names_package` / `namesPackage`; the same prefixes `security.rs` treats as not internal). A package object reached through a binding the repository defines (`ma = Marshmallow()`, then `ma.ModelSchema`) has an in-repo id, so it counts as in-repo (§5).
3. the role has **at least 15 members**, as now.

This is one rule for both languages. It has no fitted threshold: both changes are categorical, and each has a mechanism that is not specific to a repo (below).

| Dev set | Rule 5 now | D5 | Accepted proposals moved to suggestion (the cost) |
| --- | --- | --- | --- |
| TypeScript/JavaScript (16 repos) | 77/92 **83.7%** [75–90] | 50/52 **96.2%** [87–99] | 27 of 77 |
| Python (8 repos) | 11/16 **68.8%** [44–86] | 9/10 **90.0%** [60–98] | 2 of 11 |

Repo-cluster intervals for D5 (bootstrap / cluster-t, `lib.mjs`): TS [89–100] / [88–100] over 12 repos with a default tier; Python [50–100] / [38–100] over 3 repos.

These are ACCEPT / shown, with unlabelled counted as WRONG and Wilson intervals. D5 itself has no free parameter, so its leave-one-repo-out figure equals its in-sample figure. **But D5 was chosen by looking at these labels.** The honest out-of-sample estimate is the cross-validated selection procedures below: **TS 91.2–100%** (91.2–95.7% for the procedures that keep 46 or more proposals; 100% only for the pooled one that also drops `extends`, on 40), **Python 75–100%**, on 5–10 proposals.

**Can admission alone reach 95%?**

- **TypeScript/JavaScript: plausibly, and only just.** The dev point estimate is above 95%, but the cross-validated estimate straddles it. The held-out TS set has 18 repos; at 3.3 per repo its default tier holds about 59 proposals. Two non-accepts would pass (96.6%), and three would fail (94.9%).
- **Python: no, not on this evidence.** D5 scores 9/10 on 10 proposals, and 5 of the 8 repos get no default-tier proposal at all. The stricter variant C9 scores 5/5, but only by leaving 6 of 8 repos empty. Python needs the mining fixes, not more admission.

**Default-tier size.**

| | Default tier now | Under D5 |
| --- | --- | --- |
| TypeScript/JavaScript | 5.8 per repo, 0.94 not accepted | 3.3 per repo, 0.13 not accepted |
| Python | 2.0 per repo | 1.3 per repo |

**The trade, per TS repo.** A team gives up about 1.7 correct blocking candidates; each is still shown, as a suggestion. In exchange it avoids about 0.8 wrong blocking candidates. We recommend paying that, for three reasons:

- a wrong block stops an agent;
- every block still needs a person's acceptance;
- the moved conventions remain visible.

If the founder weighs blocking yield higher, C6 below keeps 3.8 per repo at 95.0% in-sample. That is exactly at the line, with no margin.

## Data and method

| Language | Queue | Labels | Shown | Rule-5 default tier |
| --- | --- | --- | --- | --- |
| TS/JS | `runs/dev-ts-r2-2026-11-05/views/rule5/queue.json` (PR #25 branch) | that run's `final.jsonl` (162 records) | 162 | 92 |
| Python | `runs/dev-py-r2-2026-11-05/views/rule5-py/queue.json` | that run's `final.jsonl` | 36 Python-side | 16 |

**Features** come from each queue item:

- rule kind (`lib.mjs` `ruleKind`);
- `members` = `evidence.total`;
- support = holders/total;
- outliers = total − holders, as a count and as a fraction;
- `lift` and `lower_bound` (the Wilson lower bound of support);
- the role (symbol kind, Python class variety, file kind or dir-wide, entry-point kind);
- the number of `any_of` alternatives;
- the number of shown proposals sharing a role;
- whether any rule target is a `pkg:` symbol.

**Cross-validation is leave one repo out.** A rule is fitted on the other repos and scored on the held-out repo. The folds are summed to one cross-validated precision. Training uses either the same language only or both languages pooled.

**Threshold rule.** When a threshold is fitted, the rule picks the least strict grid value whose training accept rate is ≥ 95%. If no value reaches 95%, it picks the most precise value, and ties go to the least strict. That is the target the founder set, applied to training data.

## 1. Precision by rule kind (all shown)

| Rule kind | TS n | TS accept | Py n | Py accept |
| --- | --- | --- | --- | --- |
| wrapped_by:call | 20 | 95.0% [76–99] | 2 | 2/2 |
| wrapped_by:decorator | 16 | 87.5% [64–97] | 3 | 3/3 |
| wrapped_by:extends | 13 | 84.6% [58–96] | 7 | 57.1% [25–84] |
| avoids:import | 13 | 100% [77–100] | 0 | – |
| wrapped_by:jsx | 2 | 2/2 | 0 | – |
| **passes_key** | 17 | **70.6%** [47–87] | 4 | **2/4** |
| **renders** | 11 | **54.5%** [28–79] (3 TRIVIAL) | 0 | – |
| named | 29 | 65.5% [47–80] | 6 | 4/6 |
| calls | 14 | 57.1% [33–79] | 7 | 3/7 |
| control | 9 | 55.6% [27–81] | 1 | 1/1 |
| prefers_library | 5 | 5/5 | 0 | – |
| other (avoids:other, before, has_test, package rules) | 13 | 8/13 | 6 | 3/6 |

**Required argument keys and rendered components are the weak default kinds in both languages.** Pooled, `passes_key` is 14/21 (67%), and its upper Wilson bound is below 95% in each language. `renders` fails as TRIVIAL: an email renders `<Text>`, a dialog renders `<Button>`. `passes_key` fails because the compiler already requires the key (TRIVIAL), or because the omissions are legitimate: tables without an `id`, endpoints without input.

## 2. Precision by feature, within the rule-5 default tier

Accept rates, with n in brackets.

| Feature | Bucket | TS | Py |
| --- | --- | --- | --- |
| **rule target** | defined in the repo | **88.6%** (70) | **84.6%** (13) |
| | outside the repo (package, built-in, unresolved) | **68.2%** (22) | **0/3** |
| role is an entry point (HTTP, RPC, server action, GraphQL, job, page) | yes | 94.3% (35) | 3/3 |
| | no | 77.2% (57) | 61.5% (13) |
| role size | 15–29 / 30–59 / 60–119 / 120–299 / 300+ | 100 (10) / 81 (32) / 76 (21) / 94 (17) / 75 (12) | 0/2 / 3/4 / 3/3 / 4/6 / 1/1 |
| support | 0.85–0.90 / 0.90–0.95 / 0.95–0.98 / ≥0.98 | 100 (6) / 85 (26) / 75 (36) / 91 (23) | – / 2/5 / 5/7 / 4/4 |
| outlier count | 1 / 2–3 / 4–9 / 10+ | 93 (30) / 79 (28) / 81 (21) / 77 (13) | 2/4 / 5/7 / 4/5 / – |
| outlier fraction | <2% / 2–5% / 5–10% / ≥10% | 91 (23) / 74 (35) / 85 (27) / 100 (7) | 3/3 / 6/8 / 2/5 / – |
| lift | <5 / 5–10 / 10–20 / 20–50 / 50+ | 94 (16) / 88 (17) / 78 (18) / 86 (21) / 75 (20) | 1/1 / 3/4 / 1/4 / 6/7 / – |
| Wilson lower bound | <0.80 / 0.80–0.90 / 0.90–0.95 / ≥0.95 | 93 (14) / 83 (42) / 67 (18) / 94 (18) | 2/5 / 1/1 / 5/7 / 3/3 |
| role symbol kind | function / class / component / module / const | 89 (44) / 82 (17) / 62 (13) / 100 (13) / 3/5 | 3/3 / 8/11 / – / – / – |
| Python class variety (enum, TypedDict) | variety / none | – | 0/2 / 11/14 |
| role scope | file kind / dir-wide (`*`) | 85 (48) / 82 (44) | 9/10 / 2/6 |
| wrapper alternatives | 1 / 2+ | 82 (85) / 7/7 | 9/14 / 2/2 |
| shown proposals in the role | 1 / 2 / 3+ | 86 (51) / 90 (20) / 71 (21) | 7/11 / 3/3 / 1/2 |

**What separates ACCEPT from WRONG/TRIVIAL.**

- **Where the rule's target is defined.** This is the only feature that separates in both languages independently.
  - A decorator, base class or wrapper that the repository itself defines is a team decision.
  - A framework's own symbol usually follows from what the role is:
    - `@ObjectType()` on GraphQL DTOs;
    - `ApiTags` on Nest handlers;
    - enums that extend `StrEnum`;
    - TypedDicts that extend `TypedDict`;
    - `atom()` around jotai state;
    - `<Container>` in an email.
  - Its exceptions are then legitimately different, rather than violations.
- **Entry-point roles.** These are strong where they exist, and that holds in both languages. They cover none of the layering or base-class rules, so they work as an exemption, not as a filter (C4–C6).
- **Support, outliers, lift, Wilson bound and role size.** None of these is monotone in TS, and "more support is safer" does not hold inside this tier.
  - Most WRONG labels at high support are "legitimate outliers": the few non-holders are a different kind of thing.
  - Most TRIVIAL labels are near-universal facts.
  - Only the extremes are clean: Wilson bound ≥ 0.95, or outlier fraction < 2%. Section 3 shows they cost too much.
- **Dir-wide roles and Python class varieties.** These look bad in Python (2/6 and 0/2), but neutral in TS. They are not used.
  - Under D5, the two variety failures (`StrEnum`, `TypedDict`) drop out anyway, because their targets are package symbols.

## 3. Candidate admission rules

### Fixed rules: no fitted parameter, so in-sample equals cross-validated. All but R0 were found on these labels.

| Rule | TS default n | TS accept | TS moved | TS per repo (mean / repos empty) | Py default n | Py accept | Py moved | Py per repo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R0 rule 5 | 92 | 83.7% [75–90] | 0 | 5.8 / 4 of 16 | 16 | 68.8% [44–86] | 0 | 2.0 / 4 of 8 |
| C1 R0 without passes_key, renders | 64 | 92.2% [83–97] | 18 | 4.0 / 4 | 12 | 75.0% [47–91] | 2 | 1.5 / 4 |
| C2 R0 + target in repo | 70 | 88.6% [79–94] | 15 | 4.4 / 4 | 13 | 84.6% [58–96] | 0 | 1.6 / 5 |
| **C3 C1 + target in repo = D5** | **52** | **96.2% [87–99]** | **27** | **3.3 / 4** | **10** | **90.0% [60–98]** | **2** | **1.3 / 5** |
| C4 R0 + entry-point role | 35 | 94.3% [81–98] | 44 | 2.2 / 6 | 3 | 3/3 | 8 | 0.4 / 7 |
| C5 R0 + (target in repo or entry point) | 79 | 88.6% [80–94] | 7 | 4.9 / 4 | 13 | 84.6% [58–96] | 0 | 1.6 / 5 |
| C6 C1 + (target in repo or entry point) | 60 | 95.0% [86–98] | 20 | 3.8 / 4 | 10 | 90.0% [60–98] | 2 | 1.3 / 5 |
| C9 C3 without wrapped_by:extends | 40 | 100% [91–100] | 37 | 2.5 / 5 | 5 | 5/5 | 6 | 0.6 / 6 |

Not-wrong within the tier equals accept for every rule from C1 down, because no TRIVIAL survives in it. The exceptions are C2 (TS 92.9%) and C5 (TS 92.4%).

**The not-wrong target (D4) is over all shown proposals, both tiers, so admission cannot change it.** On the TS dev set it stays at 82.7%.

### Threshold rules: the threshold is fitted, so the cross-validated figure is the result.

Each row is cross-validated precision, with the number of accepted proposals moved to suggestion.

| Rule | TS, same-language | TS, pooled | Py, same-language | Py, pooled |
| --- | --- | --- | --- | --- |
| R0 + support ≥ s | 88.2% (17), moved 62 | 88.9% (18), 61 | 5/6, 6 | 1/1, 10 |
| R0 + Wilson bound ≥ b | 94.4% (18), 60 | 94.4% (18), 60 | 3/3, 8 | 3/3, 8 |
| R0 + members ≥ m | 80.6% (31), 52 | 87.5% (24), 56 | 5/6, 6 | 2/2, 9 |
| R0 + lift ≥ L | 83.3% (90), 2 | 80.3% (61), 28 | 5/6, 6 | 66.7% (15), 1 |
| R0 + outliers ≤ k | 93.3% (30), 49 | 93.3% (30), 49 | 66.7% (15), 1 | 2/4, 9 |
| R0 + outlier fraction ≤ f | 91.3% (23), 56 | 91.3% (23), 56 | 4/4, 7 | 4/4, 7 |
| D5 + support ≥ s | 96.2% (52), 27 (picks none) | 95.1% (41), 38 | 87.5% (8), 4 | 87.5% (8), 4 |
| D5 + Wilson bound ≥ b | 96.2% (52), 27 (none) | 95.3% (43), 36 | 87.5% (8), 4 | 87.5% (8), 4 |
| D5 + members ≥ m | 96.2% (52), 27 (none) | 94.9% (39), 40 | 90.0% (10), 2 | 90.0% (10), 2 |
| D5 + lift ≥ L | 96.2% (52), 27 (none) | 91.3% (23), 56 | 85.7% (7), 5 | 85.7% (7), 5 |
| D5 + outliers ≤ k | 96.2% (52), 27 (none) | 95.5% (44), 35 | 2/3, 9 | 88.9% (9), 3 |

**What the threshold rules show.**

- **On rule 5,** every threshold that reaches the mid-90s does so by cutting the tier to about 1 proposal per repo. The support and member thresholds do not even reach 90% cross-validated.
- **On D5,** no threshold raises cross-validated precision.
  - Inside the TS folds, D5 already meets 95%, so the procedure picks no threshold.
  - In Python, fitted thresholds lower it, because they overfit 2–3 repos.
- **D5 therefore stays threshold-free,** except for the existing 15-member statistical floor.

### Selection procedures, cross-validated

The selection itself is the part fitted to the data, so these figures are the honest estimate for "a rule chosen this way".

| Procedure, fitted on the training repos | TS, same-language | TS, pooled | Py, same-language | Py, pooled |
| --- | --- | --- | --- | --- |
| Drop each rule-5 kind whose training Wilson upper bound is < 95% | 91.2% (57) | 94.1% (51) | 75.0% (8) | 5/5 |
| The same, then keep only in-repo targets if that raises training precision | 95.7% (46) | 100% (40) | 75.0% (8) | 5/5 |
| Pick the least strict fixed rule R0–C6 with training accept ≥ 95% | 92.9% (56) | 94.5% (55) | 83.3% (6) | 90.0% (10) |

Fitted on all TS repos, the second procedure selects exactly D5. Scored on Python, which is out of language, D5 gives 90.0%.

What the procedures choose depends on the training data:

- trained on TS, they settle on D5 (C3) in 10–11 of 13 folds;
- trained on both languages pooled, they also drop `wrapped_by:extends`. That is C9: pooled, `extends` is 15/20, and 14/17 with in-repo targets.

## 4. What fails under D5, and what fixes it

| Language | Proposal | Label | Cause | Fix |
| --- | --- | --- | --- | --- |
| TS | twenty: `*.command` classes in `src/database/**` extend `ProvisionedWorkspaceCommandRunner` | WRONG | The role is scoped too wide: 7 of 8 top-level commands legitimately use other runners | mining: role scope / legitimate-outlier detection |
| TS | twenty: services in `workspace-migration-runner/**` extend `WorkspaceMigrationRunnerActionHandler` | WRONG | The outliers are a different kind of class (registries, the runner itself) | mining: role scope |
| Py | CTFd: classes in `CTFd/schemas/**` extend `ma.ModelSchema` | WRONG | The helper classes next to the schemas (a Validator, a Field) are legitimate outliers | mining: dir-wide class roles |

All three are base-class rules in dir-scoped roles whose outliers are a different kind of class. That is why the pooled procedures drop `extends`.

We do not recommend dropping it now:

- it is 10/12 in TS and 4/5 in Python with in-repo targets;
- C9 leaves 5 of 16 TS repos and 6 of 8 Python repos with no default tier;
- the fix belongs in role scoping.

**What the TS round-4 work does to this.** It adds facts for class-member decorators and handler input reads.

- **It does not touch these residual errors.**
- **It fixes a parser error D5 already excludes.** The immich `ApiTags` misattribution is a class decorator read as a handler decorator.
- **Most of what it adds is suggestion tier under D5.** That covers:
  - new framework member decorators (`@Column`, `@Field`, `@ApiProperty`), because their targets are package symbols;
  - input reads, which become `passes_key` or validation facts.
- **What it can add to the default tier, unmeasured:** in-repo member decorators.

**Re-measure the dev set after round 4, before the census.**

## 5. Honest limits

- **D5 was found on these labels.** The kind restriction follows from the table in section 1. The target condition was found by reading the WRONG reasons.
  - Mitigations:
    - it is categorical;
    - it replicates in both languages, each on its own;
    - it has a mechanism (framework-inherent conventions);
    - the selection procedures that produce it hold up under leave-one-repo-out.
  - **None of this is a held-out test.** Expect the held-out TS figure in the low-to-mid 90s, not 96%.
- **Python evidence is thin.** There are 16 default-tier proposals in 4 repos, and 10 under D5 in 3 repos. Any Python figure moves about 10 points per proposal.
- **Concentration.** twenty contributes both remaining TS errors, and 7 of 52 default proposals. Without twenty, D5 is 45/45.
- **Built-ins and unresolved targets are outside the repo.** `global#Error`, `global#Exception` and other built-in or ambient targets, and `unresolved:` ids, make a rule a suggestion. Review of #28 found this case: "classes extend Error" had entered the default tier through `global#Error`. No dev proposal has either prefix, so the dev figures are unchanged.
- **Unresolved path aliases.** A path alias the resolver cannot map becomes one of two ids:
  - `pkg:`, when it looks like a scoped package (`@app/…`, as infisical's `pkg:@app/components#Detail`);
  - `unresolved:`, for any other form (`~/…`, `#…`, relative specifiers).

  Both now count as outside the repo. This errs toward the suggestion tier (cost, not precision).
- **Package objects bound in the repo count as in-repo.** `CTFd/models/__init__.py#ma.ModelSchema` (marshmallow, through `ma = Marshmallow()`) is the one Python D5 miss. infisical's `sso-router.ts#passport.authenticate` is another example, and it is accepted. The linker gives both an in-repo id, and telling them apart needs the binding's type, which the facts do not carry. The README and `tier-d5.json` say "addressed through the repository's own code" for this reason.
- **Unmeasured forms are conservative.**
  - A wrapper with both in-repo and package alternatives is a suggestion.
  - So is `import:` layering against a package, for example "do not import `@prisma/client`". Neither occurs in the dev labels.
- **Conventions already set to block keep blocking.** A convention a person set to block under rule 5 with a plain `b` keeps blocking until a person changes it: `effective_mode` is unchanged, and such a convention is not labelled a suggestion. This covers argument keys, rendered components, and package or built-in decorators and base classes. The README tells users to re-check them.
- **Labelled cost.** The 27 TS accepted proposals moved out are:
  - 12 `passes_key`;
  - 6 `renders`;
  - 8 framework decorators, among them NestJS `UseGuards` and `UseFilters`;
  - 1 `createZodDto()` base class.

  They stay visible as suggestions, and a person can still force any of them to block (`drift review --block <id> --force`).

## 6. Adoption

The founder approved D5 on 2026-11-06, over C6 and over keeping rule 5, before any held-out census. #28 implements it in three places.

**In the product,** `crates/drift-mine/src/tier.rs`:

- `tier_of`, `names_package` and `outside_repo`;
- `tier_reason`, which returns `None` in the default tier and otherwise one of `rule_kind`, `names_package` or `small_role`. `tier_of` and `describe` are derived from it.

`drift census --json` gives each proposal's `tier_reason` and `names_package`, and its `params.tier.target`.

**In the study,** `eval/study/lib.mjs`:

- `tierOf`, `namesPackage` and `outsideRepo`;
- `checkTier`, which accepts `default.target: "in_repo"`.

**In the manifests:**

- All four held-out manifests hold `tier-d5.json`'s `tier` verbatim. Nothing else in them changed. The secondary sets were amended to D5 by the lead the same day (decision D5a, 2026-11-06), so that they still run and measure the product's tier; they stay exploratory.
- `eval/study/holdout-manifests.json` holds their new core sha256, and records the change under `amendments`.
- `prepare.mjs` accepts the earlier frozen versions only through those entries (`amendmentAllows`).
- `select-holdout.mjs verify` checks the entries, and checks that every registered manifest holds D5. The selection record keeps rule 5 as the tier at the draw.
- Both run the same history check (`lib.mjs` `heldOutHistoryProblems`). It refuses:
  - a frozen version that is neither the current core nor allowed by an amendment;
  - a deleted or changed amendment (they are append-only);
  - a duplicate entry;
  - an entry whose superseded core or core is not that of a frozen version;
  - an amendment that is not in the history of every held-out run record. This is ordered by commit ancestry across all refs, not by dates, and walks history without simplification (`--full-history -m`, raw `-z` paths), so merges and quoted names cannot hide a record: a held-out run must use `--run eval/study/runs/<name>` and commits a start record before its census, so even a run that dies leaves a marker.
- There is no chaining. An entry allows a version only when it produced the current core, so a second amendment adds an entry from every earlier frozen core to the new one.
- These checks read the local clone. They prevent accidents and honest-operator mistakes; they do not defend against someone who rewrites local history. The pushed history and the PR record are the audit trail.

**The guards fail closed on a mismatch.** They read the local clone, so they are not a defence against someone who rewrites it.

- **Rust.** `definition_is_d5_in_the_product_and_every_held_out_manifest` requires every registered held-out manifest's tier to equal `tier-d5.json`, and `tier-d5.json` to equal the product's constants.
- **Node.** `tier.test.mjs` runs the shared fixture under `tier-d5.json` and under every registered held-out manifest, and requires each to be identical to it.
- **The fixture.** `tier-cases.json` has 121 cases. Each carries:
  - its D5 `tier`;
  - its `reason` (`tier_reason`);
  - its `rule5_tier`.

  The cases cover `pkg:`, `global#` and `unresolved:` targets in both languages.
- **Before the census.** A held-out `prepare.mjs` refuses a manifest whose tier is not `tier-d5.json`'s.
- **At census time.** A held-out `prepare.mjs` stops on any proposal whose census `tier:` line differs from `tierOf` under the manifest's tier, or is missing. Dev runs do the same with `--strict-tier`. The pipeline tests cover both.

`HELDOUT-RUNBOOK.md` step 0 lists the checks to run before the freeze, as commands.

**The memo's author did not open any held-out repo.** The manifests' tier blocks and registry hashes were rewritten by a script. It checked that every byte outside the tier block was unchanged, and that the change was exactly the tier block.
