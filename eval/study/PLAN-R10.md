# Plan, round 10: generalisation (2026-11-08)

This follows [`PLAN-PAR.md`](PLAN-PAR.md) (decisions D1–D11). Round 9 met its dev targets, and the second held-out run then showed that dev overstates what Drift does on new repos. Round 10 is about closing that gap: making the dev numbers predict held-out ones, and shipping only what holds up on repos nobody tuned on.

**Data.** Every figure below is from **dev data**: the v3 label runs dev-v3, relabel2, relabel3, relabel4 and relabel5, and the round-4 to round-9 PR bodies on GitHub. It is in-sample unless marked otherwise. The analysis is [`research/2026-11-08/r10-history.mjs`](research/2026-11-08/r10-history.mjs); its output is `r10-history.out.txt`, and section numbers like "§2" point into it. The only held-out facts used are the aggregate counts the lead supplied for this plan (next table). No held-out manifest, run directory or scratch was opened.

| Held-out aggregates, heldout2 at the round-9 freeze `de57356` (lead) | TS/JS | Python |
|---|---|---|
| D1, default-tier accept | 1/3 | none (D7) |
| D4, not-wrong over all shown | 41/100 | 20/35 |
| WRONG causes | mixed_group 26, legit_outliers 19, incidental 15 (7 of them ordering), false_outliers 5 (65) | incidental 8, mixed_group 7, false_outliers 5, legit_outliers 2 (22) |
| Same product on dev (relabel5): per-card accept / not-wrong | 63.9% / 67.3% | 61.0% / 61.0% |

Both default-tier WRONGs were flag errors. The first held-out run, #111, showed the same pattern.

## 1. Why dev is optimistic

### 1.1 What the dev gain is made of

These are TS per-card accept rates over all shown cards, in the D7 tier, at each labelled snapshot (§1):

| Snapshot | Product | After | TS accept | TS not-wrong | TS default tier | Python accept |
|---|---|---|---|---|---|---|
| dev-v3 | `debc33a` | round 3 | 42.6% (69/162) | 43.2% | 75.0% (24/32) | 31.6% (31/98) |
| relabel2 | `feefad6` | round 4 | 50.0% (79/158) | 51.3% | 93.1% (27/29) | – |
| relabel3 | `e9c6058` | round 5 | 55.1% (87/158) | 56.3% | 100% (29/29) | 34.0% (34/100) |
| relabel4 | `2c81ba4` | round 6 | 62.6% (92/147) | 64.6% | 100% (30/30) | 45.8% (38/83) |
| relabel5 | `de57356` | round 9 | 63.9% (94/147) | 67.3% | 100% (30/30) | 61.0% (47/77) |
| **heldout2** | `de57356` | round 9 | – | **41%** | **1/3** | not-wrong **57%** |

**Most of the TS dev gain sits on the cards the fixes were built and checked on (§2).** Every product PR lists its dev census by card id, so the ids each PR's author saw before and after, with their labels, can be traced. Over relabel5's 147 TS cards, against dev-v3:

- 57 accepts were already accepts at dev-v3 under the same id.
- 37 accepts are gains (14 flipped, 23 new ids). Round 4–9 PRs name 34 of them.
- 36 non-ACCEPT dev-v3 cards are no longer shown. PRs name all 36.
- **Undoing every change a round 4–9 PR names by id returns TS to 43.6% (72/165), against 42.6% at dev-v3.** About 20 of the 21 points gained are on ids their PRs were measured on.
- Against relabel2, the end of round 4: rounds 5–9 gained 13.9 points (50.0 → 63.9), and undoing the named changes gives 50.3%.
- Python against dev-v3: 31.6 → 61.0, and undoing the named changes gives 34.3%.

**Held-out TS landed where dev stood before the tuning.** Held-out TS not-wrong is 41%, against 43.2% on dev at dev-v3 and 67.3% at relabel5. The heldout2 TS WRONG mix is mixed_group 40%, legit_outliers 29%, incidental 23% and false_outliers 8%. That is close to dev-v3's TS mix (39 / 34 / 15 / 7%, plus 5% team_disabled), not relabel5's (35 / 50 / 12.5 / 0%; §6). The round 4–9 TS fixes removed the dev WRONGs they were built on, and new repos bring fresh WRONGs of the same kinds.

**Python held up better.** Held-out is 57% against 61% on dev. Python's gains came mostly from:
- W1-Py's framework-lineage split (#113), keyed on framework base classes, not on outlier shapes;
- hiding families that were 0% across repos (#97).

That is a hypothesis to test in round 10, not a finding: Python has 35 held-out cards and no held-out figure at an earlier product.

### 1.2 Leave-one-repo-out does not catch this

The brief asks, for each dev repo, whether the round-5 to round-9 rules would have been written without it.

| Check | TS | Python | What it says |
|---|---|---|---|
| **LORO over rule authorship (§3).** Undo, per repo, every change whose PR names cards in no other repo. | 63.9% → 63.7% (1 card: cal.com, the tRPC builder PRs #88/#102) | 61.0% → 60.5% (1 card: tasking-manager, Flow JS #96) | Almost every fix had evidence in several repos. |
| **LORO over beneficial effect (§8).** A helpful change survives when its PR also helped another repo. | 44 of 46 helpful events survive (r2 baseline) | 58 of 64 survive (5 unnamed) | Same. |
| **LORO over the rate (§4).** The gain with any one repo left out. | +12.6 to +16.5 pts (full +13.9) | +26.3 to +31.7 pts (full +29.4) | The gain is spread over repos, not carried by one. |

By every dev-internal check the round 5–9 rules are general: written from several repos and helpful in several. Yet the TS gain did not show on held-out. **Repo-level resampling of dev cannot detect the optimism, because every mechanism was developed with every dev repo's labels in view.** What generalises is not "was the rule written from more than one repo" but "does the mechanism cover shapes that it was not shown". Only data hidden from development can test that.

There is one natural experiment on dev that shows the effect directly: Python in rounds 4–5.
- The round 4–5 Python fixes (#45, #49, #53) name netbox 29 times, and no other Python repo more than 10.
- From dev-v3 to relabel3, netbox went 3/12 → 6/12.
- The other 16 Python repos went 28/86 → 28/88 (32.6% → 31.8%).
- py2 as a whole, first labelled at dev-v3, went 30% → 29%.

The design repo gained 25 points, and the bystanders lost 1.

Other in-sample gaps measured on dev:
- **Verifier (relabel5).** 93.2% passed-card precision on R6-tuned cards, against 84.3% untuned and 84.2% R6-unseen.
- **Learned scorers and thresholds (R2).** They collapse under LORO: 94→33, 88→55, 100→38.

### 1.3 What is not the cause
- **Label noise or a ratchet.** On relabel5, 28 of 28 cards relabelled only because their lift changed kept their label (§5). Of 51 cards relabelled for a changed statement, 46 kept their label, 4 went WRONG→ACCEPT and 1 went ACCEPT→WRONG.
- **One dominant repo.** See §4 above.
- **Chasing ids, partly.** Six TS cards are still non-ACCEPT after 2–3 round 5–9 PRs named them (§15):
  - cal.com D-8d7d13 (#83, #91, #102), cal.com D-42ab67;
  - midday D-98e729;
  - infisical D-4be5e9, D-156a6f, D-ac787f.

  Four are naming rules on plain-function roles (next section). Fixing named ids one exemption at a time did not converge on them.

## 2. Mechanisms, by cause family

No mechanism below is keyed to a repo, a framework name list or a dev id. The dev effects are in-sample. Each also carries the **dev-v3 reading**, the same policy on the least-tuned labels, which tracked held-out TS best (§1.1). Every effect is to be re-measured under the protocol in §3.

### 2.1 mixed_group (held-out TS 26 of 65, Python 7 of 22)

**M1. Naming rules only on roles with a kind marker: the TS counterpart of Python's W3.**
- **The mechanism.** A naming rule is proposed only on a role whose members share a structural kind marker: a file kind, an entry kind, a framework lineage (base or class decorator), the schema-value trait (#117), or component versus hook.
- **Dev evidence.** TS naming cards on plain-function roles (any file, no entry, kind `function`) were 0/4 at dev-v3 and 0/5 at relabel5, all mixed_group, although round 5–9 PRs named four of them two or three times each (§15, §16).
- **The Python precedent.** W3 plus W1-Py took Python naming from 5/18 (dev-v3) to 13/15 (relabel5), and Python held up on held-out.
- **Expected dev effect.** −5 WRONG and 0 ACCEPT, so TS 94/142 = 66.2% (+2.3 pts). The dev-v3 reading is 43.7% (+1.1).
- **Risk.** The same marker test on `const` roles would hit 4/5 ACCEPT; do not extend it there without a measurement.

**M2. A role-cohesion test before mining.**
- **The test.** Take the role's members' structural signature: symbol kind, export position (default or primary versus a secondary export of the file), base or decorator lineage root, file kind and member kind. If no signature covers ≥ 90% of members, mine per signature or not at all.
- **What it does.** It generalises W1-Py's lineage split to TS. It differs from W1-TS, which was closed as no: W1-TS split by symbol kind only, and R1 found only 3 of 12 TS naming mixed_groups mix symbol kinds.
- **Dev evidence.** R1's classification of TS mixed_group: helpers among routers, base/abstract classes, non-schema consts, secondary components. Secondary exports and abstract bases are in facts today (for example dub D-ec6127: "secondary exports of the same files").
- **Expected dev effect.** 3–6 of relabel5's 17 TS mixed_group WRONGs. W1-TS v2 fixed 3 of 20 and lost 1 ACCEPT, so the ACCEPT-loss risk is real. It must pass the fold rule (§3.2).

**M3. Drop the naming family where its accept is unstable across repos.**
- **TS naming**, on suggestion-tier rates: 64.7% (22/34) over 11 repos at relabel5, leave-one-repo-out 59–73%. At dev-v3 it was 37% (11/30).
- **What the history says.** Most of its gain came from round 5–9 exemptions (companion, shared part, plain value), the kind of gain that did not transfer.
- **Rule.** TS naming stays shown only after M1, and only if a fold estimate (§3.2) keeps it ≥ 60%. Otherwise it is dropped from what the product shows. See §4 for the yield.

### 2.2 Flag errors: legit_outliers + false_outliers (held-out TS 24 of 65, Python 7 of 22; both default-tier WRONGs)

**What drives card accept: the share of flags that are real (§12).** On relabel5 cards with outliers, sorted by the share of A/B outlier verdicts that are real violations:

| Share of verdicts that are real | Cards | Card accept |
|---|---|---|
| < 25% | 94 | 24.5% |
| 25–50% | 7 | 28.6% |
| 50–75% | 26 | 84.6% |
| 75–99% | 14 | 100% |
| all | 66 | 98.5% |

Suggestion-tier flag precision is 38.4% for TS (326/848) and 45.2% for Python (200/442). By family:
- **TS:** renders 3.8%, ordering 6.3%, calls 15.4%, argument keys 16.7%, base classes 32.9%, decorators 33.3%, naming 49.2%, package facts 57.4%, control 63.5%.
- **Python:** ordering 0%, decorators 5.6%, package facts 12.5%, base classes 15.8%, calls 31.7%, argument keys 64.5%, naming 66.7%, control 68.4%, wrapper calls 72.2%.

**F1. An outlier must be comparable to the holders.**
- **The test.** A member is listed as an outlier only if it shares the holders' majority signature (M2's signature, plus entry kind for entry roles). Otherwise it is "not comparable": neither holder nor outlier, and listed apart.
- **When the card goes.** If the not-comparable members exceed the card's outliers, the card is not proposed. Mostly the role is mixed in that case.
- **What it changes.** It replaces the long run of per-shape exemption codes (companion, factory, plain value, `does_not_call`, `defining_module`, …), each of which fixed the dev shapes it was built on, with one structural test.
- **Expected dev effect.** Unknown until built. The ceiling is the 101 cards with < 50% real flags (25% accept).
- **Acceptance (WS-D).** TS suggestion flag precision ≥ 55% on a fold estimate (now 38.4%), and the flag precision of ACCEPT cards does not fall.

**F2. Default tier: every outlier needs entry-point evidence.**
- **The test.** In a default-tier card, an outlier counts only if it is a reachable entry point of the holders' entry kind, takes input or reaches a sink (the `security` facts), and has no guard in its body or its builder chain.
- **What happens otherwise.** A card with any outlier that fails the test is demoted to the suggestion tier. This is a tier rule, so it fails closed.
- **Dev evidence.**
  - 6 of the 8 dev-v3 default-tier WRONGs were flag errors (3 `false_outliers`, 3 `legit_outliers`); the other 2 were mixed groups.
  - Default-tier flag precision on relabel5 is 88.8% (261/294). Most of its real verdicts are `look` ("worth confirming").
  - On held-out, both default-tier WRONGs were flag errors.
- **Acceptance.** On the dev-v3 default cards (32), it demotes ≥ 4 of the 6 flag-error WRONGs and ≤ 2 of the 24 ACCEPTs. On relabel5 it keeps ≥ 28 of 30 ACCEPTs. On dev3-check (§3.1), default-tier accept is ≥ 90%.

**F3. Python: show suggestion cards with at most 1 outlier.**
- **Evidence.** R1 found that rubric R1 makes one legit outlier a WRONG. Python legit_outliers WRONGs on relabel5 have 1 outlier in 5 of 7 cases.
- **Dev effect** (§10, Python):

  | Python, outliers shown | relabel5 | dev-v3 |
  |---|---|---|
  | ≤ 1 | 73.8% (31/42), 1.8 accepts/repo | 38.2% |
  | 0 | 100% (14/14), 0.8 per repo, 6 of 17 repos | 50% (1/2) |

- **Use it with the family rule in §4,** not alone. R2 found Python outlier counts unstable.

### 2.3 Incidental and ordering (held-out TS 15 of 65, 7 of them ordering; Python 8 of 22)

**I1. Hide call order in both languages [STRICT].**
- **Dev evidence.**
  - TS ordering is 1/5 over 4 repos (leave-one-repo-out 0–33%), with flag precision 6.3%. It was 1/3 at dev-v3.
  - Python ordering is 0/5, with flag precision 0%. It was 0/8 at dev-v3.
  - #97 already hid one Python call-order shape; the rest still shows.
- **Expected dev effect.** TS 93/142 = 65.5% (+1.6 pts), Python 47/72 = 65.3% (+4.3 pts). The dev-v3 readings are 42.8% and 34.4%. It removes the kind of WRONG behind the 7 held-out ordering WRONGs.

**I2. Hide the families that are 0–20% in every repo.**
- **Which.** TS renders (4/10 accept, flag precision 3.8%), TS calls (0/2; #99 already hid non-guard calls), Python `repo` package facts (0/5, 12.5%).
- **Evidence.** They are at or below 20% accept at dev-v3 and relabel5 alike (§14): TS renders 2/11 → 4/10, Python repo 1/7 → 0/5.
- **Expected dev effect (§16).**
  - With I1 (TS: ordering, renders and calls hidden; Python: ordering and package facts), TS is 89/130 = 68.5% (+4.6 pts) and Python 47/67 = 70.1% (+9.1). The dev-v3 readings are 47.8% (+5.2) and 36.1% (+4.5).
  - With M1 as well, TS is 89/125 = 71.2%, and its dev-v3 reading 49.2%.
  - The gains are about the same size on the least-tuned labels as on relabel5, the pattern a general mechanism should show.

**I3. A stricter incidental prior: specificity to the role.**
- **The rule.** Calls, renders, argument-key and package rules must hold in this role markedly more than in its sibling roles (lift against siblings ≥ 2), not just against the repo's base rate.
- **Dev evidence.** Repo-base lift does not separate these families (§16: lift ≥ 8 gives 16/30 at relabel5 and 12/46 at dev-v3). A sibling baseline is the natural test for "they all call `f` because they all need data".
- **Expected dev effect.** Unknown until built. Measure it on folds, with I1 and I2 applied first.

## 3. Validation that predicts held-out

### 3.1 A rolling blind dev pool, dev3 (the main proposal)
- **Draw.** `select-holdout.mjs --selection dev3`, with the held-out procedure and exclusions: 12 TS/JS and 8 Python repos, role `dev`, with reserves fixed before the draw.
- **Isolation.**
  - Nobody building product opens dev3 repos, cards or labels before the round-10 freeze.
  - Its census and blind A/B/C labelling (rubric v3) run once, at the freeze, on the frozen binary.
- **After the report** it joins the build set, and round 11 draws dev4. It is cheaper than a held-out draw and carries no D1/D4 verdict. Its job is to predict one.
- **What it reports.**
  - D1, D4 and per-card accept per language and tier;
  - flag precision;
  - yield per repo;
  - and, beside them, the build-set in-sample figure and the two estimates of §3.2–3.3.

### 3.2 Fold rule for mechanisms on the build set
- **Folds.** The 34 build repos go into 4 fixed folds by a seeded shuffle, recorded once.
- **What a mechanism PR reports.**
  - its census effect on its **design fold** (the folds whose cards it was written from, named in the PR);
  - its effect on the **other folds**, separately.
- **Admission.** A mechanism is admitted only if:
  - it helps cards in ≥ 3 repos across ≥ 2 folds;
  - it costs no ACCEPT outside its design fold;
  - its other-fold effect is positive.
- **What to project.** Only the other-fold effect per repo is used for held-out. The design-fold effect is reported, not projected.

### 3.3 The dev-v3 reading
Every dev metric in round 10 is reported three ways:
- in-sample (as now);
- the **undo-named reading** (§2 of the script): every change a PR in the measured rounds names by id, undone;
- where a policy applies, the **dev-v3 reading**: the policy evaluated on the dev-v3 labels.

The undo-named reading and the in-sample figure make a bracket. Held-out TS fell just below its bottom: not-wrong 41%, against an undo-named accept of 43.6% and an in-sample not-wrong of 67.3%. Held-out Python fell near its top: 57%, against [34.3%, 61.0%]. A single dev figure can be off by 25 points in either direction. The bracket is the honest dev statement until dev3 calibrates it.

### 3.4 D12: when the next held-out draw is allowed
The next held-out draw (D12) may be selected only when **all** of the following hold [STRICT]:
1. **Freeze.** A round-10 product freeze `F10` is recorded, with every mining or check workstream merged before it.
2. **dev3-check.** dev3 has been censused at `F10` and labelled blind, and its point estimates meet all of these:
   - TS default-tier accept ≥ 90% with ≥ 8 default-tier cards, so the D1 question can be asked at all;
   - not-wrong ≥ 70% per language;
   - the build-set in-sample figure is within 10 points of dev3's for each language. Beyond that, dev is still not predicting, and another dev round is the cheaper test.
3. **Prediction.** A written prediction of D12's D1, D4 and per-card accept per language, with intervals, from dev3 and the fold estimates. It is committed before the selection seed.
4. **Spacing.** At most one held-out draw per product freeze, and none until dev3 has been reported. The verifier's held-out check stays gated separately by D10.3.

If condition 2 fails, there is no D12. dev3 joins the build set, and round 11 draws dev4.

## 4. A smaller shown set: the yield/precision trade-off

R3 found that agents mostly copy their neighbours and need the default tier. Every WRONG shown to a person costs trust. These are policies on what the product shows at all, so the census `--all` set the study labels shrinks with them [STRICT]: a card moved behind a flag still counts as shown (§10).

| TS/JS (13 dev repos with cards) | relabel5 accept | Cards/repo | Accepts/repo | WRONG | dev-v3 reading |
|---|---|---|---|---|---|
| All shown (today) | 63.9% (94/147) | 11.3 | 7.2 | 48 | 42.6% |
| M1 + I1 + I2 (no plain-function naming; no ordering, renders or calls) | 71.2% (89/125) | 9.6 | 6.8 | 31 | 49.2% |
| W4 rank ≤ 5 (ranked over both tiers) | 82.8% (48/58) | 4.5 | 3.7 | 8 | – (no W4 at dev-v3) |
| W4 rank ≤ 3 | 88.9% (32/36) | 2.8 | 2.5 | 2 | – |
| Default tier + suggestions with ≤ 1 outlier | 82.9% (63/76) | 5.8 | 4.8 | 9 | 68.3% |
| … and no ordering | 84.9% (62/73) | 5.6 | 4.8 | 7 | 67.7% |
| **Default tier + suggestions with ≤ 1 outlier in families ≥ 60% under leave-one-repo-out (n ≥ 5)** | **85.7% (48/56)** | 4.3 | 3.7 | 4 | **77.5%** |
| Default tier only | 100% (30/30) | 2.3 | 2.3 | 0 | 75.0% |

| Python (17 dev repos) | relabel5 accept | Cards/repo | Accepts/repo | WRONG | dev-v3 reading |
|---|---|---|---|---|---|
| All shown (today) | 61.0% (47/77) | 4.5 | 2.8 | 30 | 31.6% |
| I1 + I2 (no ordering or package facts) | 70.1% (47/67) | 3.9 | 2.8 | 20 | 36.1% |
| ≤ 1 outlier | 73.8% (31/42) | 2.5 | 1.8 | 11 | 38.2% |
| Families ≥ 60% under leave-one-repo-out (n ≥ 5) | 71.8% (28/39) | 2.3 | 1.6 | 11 | 88.2% |
| **Families ≥ 60% under leave-one-repo-out + ≤ 1 outlier** | **90.5% (19/21)** | 1.2 | 1.1 | 2 | **83.3% (5/6)** |

"Families ≥ 60% under leave-one-repo-out" means: for each repo, keep the suggestion families whose suggestion-tier accept on the *other* dev repos is ≥ 60% (n ≥ 5).
- **TS.** With ≤ 1 outlier, the suggestions kept are naming (9/12 accepted), base classes (8/11) and argument keys (1/3).
- **Python.** The suggestions kept are naming (10/10), calls (7/8), control (2/2) and base classes (0/1).
- **Caution.** R2 found family filters fragile under leave-one-repo-out at relabel4 (≥ 75%: 80 → 40). Combined with ≤ 1 outlier they hold across snapshots here: TS 77.5% (dev-v3), 88.9% (relabel4), 85.7% (relabel5); Python 83.3%, 83.3%, 90.5%. The Python dev-v3 figure rests on 6 cards.

**Recommendation.** Ship the bold policy as what the product shows (WS-B):
- **What it costs.** It halves TS yield, from 7.2 to 3.7 accepts per repo, and Python from 2.8 to 1.1. It removes 44 of 48 TS WRONGs and 28 of 30 Python WRONGs on dev.
- **Forecast.** The dev-v3 reading predicts held-out TS not-wrong in the high 70s, not the 86% in-sample. That would be a large step from 41%, still short of D4's 95%. **No dev policy forecasts 95% on held-out; round 10 should not claim one.**

## 5. Workstreams (round 10)

All of them are dev-only. None reads dev3 before the freeze, except WS-A's selection tooling, which reads no code.

| | Workstream (owner-to-be) | What | Acceptance | Must measure |
|---|---|---|---|---|
| A | **dev3 pool, folds, readings** (study harness agent, "dev3") | Draw dev3 (§3.1), with exclusions and techcheck. Record the 4-fold assignment of the build set. Turn `r10-history.mjs` into a tested `eval/study/generalise.mjs` that prints the undo-named and dev-v3 readings and the per-fold effects for any census diff. | Selection record and `verify` show no overlap. Tests and a mutation check. dev3 is not opened by anyone else (rule 3). | Repos per part after techcheck; fold sizes |
| B | **Show policy: smaller shown set** (mining agent, "show10") | §4 bold policy per language. The family table gains per-repo rates, and leave-one-repo-out admission uses suggestion-tier rates only. Call order is hidden in both languages (I1). TS renders, TS calls and Python package facts are hidden (I2). | Census before/after on 34 dev clones listing every removed id with tier and label. 0 default-tier change. | In-sample, dev-v3 and fold readings; accepts/repo; repos left with 0 suggestions |
| C | **Role cohesion, TS** (mining agent, "cohesion") | M1 (TS naming needs a kind marker), then M2 (signature-coverage test before mining). | Fold rule (§3.2). ≤ 1 ACCEPT lost on the build set. Determinism tests. | mixed_group WRONGs removed per fold; ACCEPT lost; new ids |
| D | **Comparable outliers and default-tier evidence** (mining/security agent, "flags10") | F1 (not-comparable members listed apart) and F2 (a default-tier outlier needs entry-point evidence, else the card is demoted). | F2 acceptance in §2.2. F1: TS suggestion flag precision ≥ 55% on other folds. A mutation check for each new branch. | Flag precision per tier/family; default-tier count and accept; demotions on dev-v3 cards |
| E | **Incidental prior** (mining agent, "incidental") | I3 (lift against sibling roles for calls, renders, argument-key and package rules), after B. | Fold rule. 0 default-tier change. | incidental WRONGs per fold; ACCEPT lost |
| F | **dev3 census and blind labelling at F10** (relabel agent, "relabel6") | `prepare.mjs` on dev3 at the frozen binary. A/B/C under rubric v3, as relabel5. Also relabel the build set's changed cards (carry rule as relabel5). | Pre-registration committed before any label. Every shown card labelled. | Everything in §3.1, and the §3.4 conditions |
| G | **D12 decision and prediction** (lead + study agent) | Apply §3.4. If met, write the prediction and pre-register D12 (selection only). If not, record why and schedule dev4. | The decision is recorded in the README log before any draw. | Predicted versus dev3 figures; the bracket of §3.3 |

Order: A first (folds and tooling). B, C, D and E run in parallel, then merge before F10. F, then G. Agent text, Studio and the verifier get no new work this round, beyond each feature's Studio pair or "not needed" row.

**Round-10 targets.** These are on dev3-check, the first blind estimate, and are not held-out claims:

| What | Target |
|---|---|
| Build-set in-sample vs dev3, per language | within 10 pts |
| TS default-tier accept | ≥ 90%, with ≥ 8 cards |
| Not-wrong, all shown | ≥ 70% per language |
| Suggestion-tier flag precision | TS ≥ 55%, Python ≥ 55% |

## 6. Decisions asked of the lead

**Adopted by the lead, 2026-11-08 (decision D12):** all four below, as written. Round 10 runs the workstreams of §5 in the order given there.

- **D12-rule:** adopt §3.4 as the rule for the next held-out draw [STRICT].
- **dev3:** draw a rolling blind dev pool per round (§3.1). It carries no verdict.
- **Show policy:** the product shows less (§4). The D4 population stays "everything `census --all` shows" [STRICT], so a hidden card is gone, not deferred.
- **Reporting:** every round-10 dev figure carries the undo-named and dev-v3 readings next to the in-sample one [STRICT].

## Files
| Path | What |
|---|---|
| `research/2026-11-08/r10-history.mjs` | The analysis. `node eval/study/research/2026-11-08/r10-history.mjs [--json out]` reads only dev label runs and the PR table |
| `research/2026-11-08/r10-history.out.txt`, `r10-history.json` | Its output at main `525e4d9` |
| `research/2026-11-08/pr-mentions.json` | Card ids each round 4–9 product PR body cites (GitHub REST, 2026-11-08) |
| `research/2026-11-08/pr-design-repos.json` | Repos named in each round 5–9 PR's What/Why sections (context; it was not needed for the figures) |
