# Plan, round 11: the default tier out of sample (2026-11-08)

This follows [`PLAN-PAR.md`](PLAN-PAR.md) (decisions D1–D11) and [`PLAN-R10.md`](PLAN-R10.md) (D12). Round 10 ended with the dev3-check failing all three conditions, so no held-out draw followed. The sharpest failure is the TS default tier, the part of Drift agents see first: it is 30/30 in sample and 7/15 out of sample. Round 11 is about that gap, about whether Python should show anything, and about a blind pool big enough to answer the D1 question.

**Data.** Every figure is from **build-set data**: the v3 label snapshots (dev-v3 to relabel5), the round 4–9 PR mentions, and dev3, which joined the build set after its report (#132). Figures are in-sample unless marked. The analysis is [`research/2026-11-08/r11-default.mjs`](research/2026-11-08/r11-default.mjs); its output is `r11-default.out.txt`, and "§n" points into it. The only held-out facts used are the lead's aggregate counts below. No held-out manifest, run directory or scratch was opened, and neither was the dev3 operator's scratch.

| Out-of-sample aggregates (lead) | TS default-tier accept | Notes |
|---|---|---|
| heldout1 (#111) | 5/7 | |
| heldout2 (#123) | 1/3 | both WRONGs were flag errors |
| dev3 at F10 (#132) | 1/5 | default-tier flag precision 31.3% (5/16) |
| **Pooled** | **7/15 = 46.7%**, Wilson [24.8, 69.9] | in sample on dev: 30/30 |

TS suggestions after the show policy (#129) were 6/7 accepted on dev3. Before it, on heldout2, they were 39/97. Python on dev3 showed 2 cards across 8 repos.

## 0. Round 10's D12 decision (recorded)

**D12, round 10: no held-out draw.** The dev3-check ([`runs/dev3-ts-2026-11-08/dev3-check.md`](runs/dev3-ts-2026-11-08/dev3-check.md), #132, main `50b3c5b`) was judged on point estimates as pre-registered in [`PREREG-F10-dev3-check.md`](PREREG-F10-dev3-check.md). It failed every condition of PLAN-R10 §3.4(2):

| Condition | dev3 | Verdict |
|---|---|---|
| (a) TS default-tier accept ≥ 90% with ≥ 8 cards | 20.0% (1/5), 5 cards | NOT MET |
| (b) not-wrong ≥ 70%, TS | 66.7% (8/12) | NOT MET |
| (b) not-wrong ≥ 70%, Python | 50.0% (1/2) | NOT MET |
| (c) within 10 points of in-sample, TS | 58.3% against 93.5%: −35.1 points | NOT MET |
| (c) within 10 points of in-sample, Python | 50.0% against 100%: −50.0 points | NOT MET |

As §3.4 says for this case, dev3 has joined the build set, and round 11 draws dev4 (§4.1). The D12 rule itself stays in force for the next held-out draw, with the revisions in §4.2.

## 1. Why the default tier is perfect in sample and about half out of sample

### 1.1 The numbers (§1)

| TS default tier | Accept | Repos with a default card | Wrappers | Layering | Not accepted |
|---|---|---|---|---|---|
| dev-v3 (round 3) | 75.0% (24/32) | 9 | 14/19 | 10/13 | legit_outliers 3, false_outliers 3, mixed_group 2 |
| relabel2 (round 4) | 93.1% (27/29) | 8 | 17/19 | 10/10 | mixed_group 1, legit_outliers 1 |
| relabel3–relabel5 (rounds 5–9) | 100% (29/29 → 30/30) | 8 | 20/20 | 10/10 | none |
| **dev3 (blind)** | **20.0% (1/5)** | 4 of 12 | 0/1 | 1/4 | mixed_group 2, legit_outliers 1, TRIVIAL (lint) 1 |
| **Pooled out of sample** | **46.7% (7/15)** | | | | |

The in-sample figure, the undo-named reading and the pooled out-of-sample figure fall in a straight line: **100% → 75% → 47%**. For the default tier, the undo-named reading equals the dev-v3 reading, 24/32 (generalise.mjs).

### 1.2 Is the convention false? No.

- **No out-of-sample default WRONG is `misdescribes`.** On dev3, the labellers confirm in every reason that the holders follow the rule:
  - 1720/1721 files avoid the import;
  - every HTTP handler export of the other route files is a `withOperation(...)` call.
- **Both heldout2 WRONGs** were flag errors (lead).
- **No dev-v3 default WRONG was `misdescribes` either.**

What the cards say about the members that follow them is true.

### 1.3 Is it the flags? Yes, but the flags show a scope error, and hiding them would not fix it.

- **Flag precision collapses out of sample (§2).** Default-tier flag precision was:
  - 75.8% (150/198) at dev-v3;
  - 88.8% (261/294) at relabel5;
  - **31.3% (5/16) on dev3.**
- **Card accept follows the flags.** A default card whose counted flags are all not real was:
  - 0/5 accepted at dev-v3;
  - 0/3 on dev3.

  With at least half of its flags real, it was 23/25 at dev-v3 and 1/2 on dev3.
- **Every readable out-of-sample default WRONG** (dev3's 3, heldout2's 2) is a card none of whose counted flags is a real violation.

**But the flags are mostly a symptom of the role, not a display problem.** Two of dev3's three WRONGs are `mixed_group`: the outliers are a recurring different kind of member inside the rule's scope.
- `electron-builder.config.cjs` is a packaging config inside an app's layering role.
- Exported, unit-tested pure helpers sit in route files under "functions in route files are wrapped in `withOperation()`".
- Scripts in `scripts/**` boot the CMS in-process (`legit_outliers`).

Rubric v3 asks about *new* members like the outliers (Q3, R1, R2). An agent who adds another exported helper to a route file is warned either way, whether or not today's outliers are listed. So **"show the convention but not its flags" changes no label**: `check` would still fire on the same new code. Flags are the evidence of the scope error, and the scope error is what is wrong.

### 1.4 Is it selection? Yes, at three levels.

1. **Tuning by id (§3).**
   - All 30 relabel5 default cards carry an id that a round 4–9 PR names:
     - 20 were dev-v3 default ACCEPTs under the same id;
     - 9 are new ids;
     - 1 was a dev-v3 WRONG (ai D-fc5ef7, fixed by the factory exemption).
   - All 8 dev-v3 default non-ACCEPTs were fixed by changes their PRs name: 7 are no longer shown, 1 flipped. Examples:
     - nest's 3 layering WRONGs went with the lazy-load exemption;
     - supabase D-c2e88c gave way to a card narrowed to `generateMetadata`;
     - the three formbricks and cal.com wrapper WRONGs are no longer shown.
   - **The 25 points from 75% to 100% are exactly the cards the fixes were measured on.**
2. **Tier choice.** D7 picked call wrappers and layering from these same dev labels: TS per-violation precision of 89.5% for layering and 81.8% for wrappers, against 36.7% for decorators and 26.9% for base classes (README, D7). So even the dev-v3 figure of 75% is in sample for the choice of tier. It is an upper bracket, not a forecast.
3. **Composition (§4).** The in-sample default tier is mostly security-named call wrappers on entry roles. These are `withSession`, `withWorkspace`, `authenticatedProcedure`, `verifyAuth`, `protectedProcedure` and the like. The classification is by wrapper name, a heuristic printed per card for audit.

   | | Security wrappers | Other call wrappers | Layering |
   |---|---|---|---|
   | dev-v3 | **14/17 (82%)** | **0/2** | 10/13 (77%) |
   | relabel5 | 17/17 | 3/3 (both dev-v3 ones fixed by id) | 10/10 |
   | dev3 | **none** | **0/1** | **1/4** |

   - **Why security wrappers do well.** Rubric R3 counts a reachable endpoint that skips an auth wrapper as `look` even when it is legitimately public. That is why auth wrapper cards stay ACCEPT with many legitimate exceptions, for example infisical's 123 outliers.
   - **Out of sample they are rare.** dev3 had none. Its default tier was layering and a non-auth wrapper, the two classes that were 10/15 at dev-v3 before tuning.
   - **Reweighting.** dev-v3's class rates reweighted to dev3's mix give 61.5%. Composition explains about 14 of the 55 points between dev-v3 and dev3. The rest is layering at 1/4 (Wilson [4.6, 69.9]) and a sample of 5.
4. **Concentration.** The 30 in-sample cards come from 8 of 16 repos, and 24 of them from 4 repos (documenso 9, cal.com 6, dub 5, infisical 4). Its effective sample is about 8 repos, not 30 cards.

### 1.5 The folds agree (§5)

The default tier varies more between folds than any in-sample interval suggests. dev3, as a fifth fold, falls below every build fold:

| TS default tier | Fold 1 | Fold 2 | Fold 3 | Fold 4 | Fold 5 (dev3) |
|---|---|---|---|---|---|
| dev-v3 | 50.0% (3/6) | 88.9% (8/9) | 40.0% (2/5) | 91.7% (11/12) | – |
| relabel5 | 100% (4/4) | 100% (10/10) | 100% (3/3) | 100% (13/13) | **20.0% (1/5)** |
| dev-v3, other three folds → this fold | 80.8 → 50.0 | 69.6 → 88.9 | 81.5 → 40.0 | 65.0 → 91.7 | – |

At dev-v3, leave-one-fold-out predictions miss by 19 to 41 points. Each fold's default tier rests on 1–3 repos. **No build-set reading forecasts the default tier to better than about ±40 points**, and only blind data at a larger n can tell 47% from 75%.

### 1.6 Diagnosis

- **The convention is right about its holders.**
- **The flags are where it fails.** Out of sample, flag precision is about 31% against 89% in sample.
- **The flags fail because the role is wider than the rule.** The scope includes a recurring kind of member the rule should not cover, so the error is in the card's scope, not its display.
- **The in-sample 30/30 is selection.** It is 25 points of id-named tuning on top of a tier chosen from the same labels. It is dominated by auth wrappers, which the rubric's security exception protects, and it comes from about 8 repos.
- **Bracket.** Pooled out of sample is 47%, Wilson [24.8, 69.9]. The interval's top is below the 90% bar, so this is not a thin-evidence call: the default tier as shipped does not meet D1 out of sample.

## 2. The default tier: product options

The default tier is what agents see first, unvetted: the hooks' priming and advice, MCP, `check` text and the AGENTS.md export (`admission.rs`: "always shown to agents"). `check` may block on it only after a person accepts it in block mode ("may block once accepted"). So the risk today is advice, not blocks: about 0.4 unvetted default cards per repo out of sample, half or more of them wrong.

Effects of each option (§6). Suggestions follow the committed show table. D4 is not-wrong over everything shown [STRICT]. Yield is accepted cards per repo over all repos of the set.

| Option | Build set, relabel5: default / D4 / yield | Build set, dev-v3: default / D4 / yield | dev3: default / D4 / yield | Unvetted cards agents see, dev3 |
|---|---|---|---|---|
| **(a) keep as is** | 30/30 / 93.5% / 2.69 | 24/32 / 69.2% / 1.69 | 1/5 / 66.7% / 0.58 | 0.42 per repo, 20% right (pooled 47%) |
| **(b) demote to suggestion; the committed show table hides them** (TS layering has no suggestion entry, TS wrappers are 0/1) | n = 0 / 81.3% / 0.81 | n = 0 / 42.9% / 0.19 | n = 0 / 85.7% / 0.50 | 0 |
| (b′) demote, still shown to people | n = 0 / 93.5% / 2.69 | n = 0 / 69.2% / 1.69 | n = 0 / 66.7% / 0.58 | 0 |
| (c-0) default only with 0 outliers | 1/1 / 82.4% / 0.88 | n = 0 / 42.9% / 0.19 | n = 0 / 85.7% / 0.50 | 0 |
| (c-≤1) default only with ≤ 1 outlier | 8/8 / 87.5% / 1.31 | **8/13 (61.5%)** / 55.0% / 0.69 | **0/2** / 77.8% / 0.50 | 0.17 per repo, 0% right |
| (c-flags) show the rule, hide its flags | not measurable by labels; rubric Q3 judges the warning on new members, so no label would change (§1.3) | | | unchanged from (a) |
| (c-F2) flags only with entry-point evidence (round-10 F2) | 6/6 kept of 30 | 6/9 (66.7%) | not run | – (failed the fold rule, flags10.md) |
| (c-sec) default only for security-named wrappers (post hoc) | 17/17 / 90.9% / 1.88 | 14/17 (82.4%) / 70.8% / 1.06 | n = 0 / 85.7% / 0.50 | 0 |
| **(d) candidate tier** (below) | 30/30 / 93.5% / 2.69 | 24/32 / 69.2% / 1.69 | 1/5 / 66.7% / 0.58 | **0** |

What the options show:
- **An outlier cap is not a separator.**
  - (c-≤1) is *worse* than (a) on the least-tuned labels (61.5% against 75%) and 0/2 on dev3.
  - One legitimate outlier makes a card WRONG (R1), and the auth wrappers that do well have many outliers.
- **Hiding the flags or evidence-gating them fails.**
  - (c-flags) changes nothing a label measures.
  - (c-F2) was built and failed in round 10.
- **(c-sec) is a hypothesis, not a policy.**
  - It is post hoc, read off these same labels.
  - It is 82% before tuning, under the 90% bar.
  - It has no out-of-sample card at all (dev3 had none).
  - It is worth testing on dev4 (WS-C), not shipping.
- **(b) raises dev3's D4 by hiding cards from everyone.**
  - It removes the wrong ones and, on the build set, two-thirds of TS's accepted yield (2.69 → 0.81 per repo).
  - Hidden from people too, a correct layering or auth boundary has no way back except a hand-written rule.

**Recommendation: (d), a candidate tier [STRICT].** It is (b) for agents and (a) for people.
- **What changes.**
  - The D7 cards stay exactly as defined (`tier-d7.json`), shown to people first in `census`, `init`, `review` and the Studio, marked **"block candidate: reaches agents once you accept it"**.
  - A candidate reaches the hooks, MCP, `check` text and the AGENTS.md export only after a person accepts it (`drift review`, Studio) or sets `agents: show`. Blocking is unchanged: it already needed an accept in block mode.
  - Suggestions are unchanged: they reach agents only through an admission source, which admits none today.
- **What it does to D1 and D4.**
  - D1 is still measured on the same population, the D7 tier: ACCEPT / shown, held out. Its bar keeps its meaning. It is now the gate for the tier ever reaching agents unvetted again, not a description of what they get today.
  - D4's population stays "everything `census --all` shows" [STRICT], so candidates count, and (d) does not move D4: dev3 66.7%, relabel5 93.5%.
  - **The agent-shown share that is unvetted goes to 0 on every set.**
- **What it costs.**
  - In a repo nobody has reviewed, an agent gets no convention at all.
  - R3 found agents mostly need the default tier. Out of sample about half of it is wrong, and the wrong half is the mixed-scope kind, which tells an agent to wrap a test helper or move a config file.
  - A person's accept is one review action per card, on 0.4 cards per repo out of sample.
- **Why not (a).** Its out-of-sample interval tops out at 69.9%, below 90%.
- **Why not (b).** On n = 15 out-of-sample cards it would remove the tier from people as well. We cannot yet tell whether the tier is at 47% or 75%, so we keep the people's view and remove only the unvetted agent exposure. That is the stricter option on what agents see, and it keeps the measurement strict: the WRONG candidates stay in D4.

**What would bring an unvetted default tier back:** a D12 held-out pass of D1 (≥ 95%, D1/D6). It would only be drawn after a dev4-check pass of ≥ 90% with ≥ 8 cards (§4.2).

## 3. Python

| Python, show policy applied (§7) | Accept | Shown per repo | Accepted per repo |
|---|---|---|---|
| Build set, relabel5 (in sample) | 100% (12/12) | 0.67 | 0.67 |
| Build set, leave-one-repo-out (show10) | 81.8% (9/11) | | |
| Build set, undo-named / dev-v3 (#129) | 88.9% (8/9) / 85.7% (6/7) | 0.39 (dev-v3) | 0.33 |
| **dev3 (blind)** | **50.0% (1/2)**: 1 naming ACCEPT, 1 naming WRONG `mixed_group` | **0.25** | **0.13** |
| heldout2, before the show policy (lead) | not-wrong 57% (20/35) | | |

- **Python has no default tier (D7).** No Python family is admitted to agents (`family-admission.json` admits none). So Python cards reach only people: `census`, `init`, `review` and the Studio.
- **Out of sample, the value is about 0.1 accepted cards per repo**, a card every eight repos, and half of what is shown is wrong.
- **The in-sample 12/12 rests on 12 cards in 8 repos,** under a show table built from those labels.
- **Two blind cards cannot say whether Python is at 50% or 90%.**

**Recommendation [STRICT]: Python ships no mined cards by default in round 11.**
- **What stays.** Python facts, `check` on conventions a person wrote or accepted, and the rest of the Python pipeline stay.
- **What goes.** Mined Python proposals are off unless a person opts in (`proposals.python: on` in `.drift/config`, and a census flag for the study).
- **What brings them back:** a blind pool, measured on the opt-in view at a frozen product, with:
  - **≥ 10 shown Python cards**, and
  - not-wrong ≥ 70%, and
  - within 10 points of the build-set in-sample figure.

  These are D12's Python bars (b) and (c), plus a minimum n. Without the minimum, 2 lucky cards would pass. A pass turns proposals back on; a held-out pass is then needed before any Python claim.
- **The cost.** On the build set Python shows 0.67 cards per repo, all accepted. Turning that off loses at most about 0.1–0.7 correct cards per repo, against shipping a surface whose only blind estimate is 1/2. The stricter option is taken because the evidence is two cards.
- **The less strict alternative, for the lead.** Keep Python cards on, shown to people only, as now. The case for it: nothing reaches agents, and the build-set leave-one-repo-out reading is 81.8%.

## 4. Validation and the next blind draw

### 4.1 dev4 (PLAN-R10 §3.1 rule)
- **Draw.** `select-holdout.mjs --selection dev4`, with the held-out procedure and its exclusions: every repo of the dev sets, dev3 (repos, reserves, replaced), and the held-out sets.
  - It uses a new seed: a main commit plus 128 random bits, committed and pushed before the draw.
  - It has the held-out buckets with **twice the held-out quotas**:
    - **36 TS/JS** (nestjs 6, nextjs 8, express_fastify_hono 8, react_spa 8, other_node 6);
    - **24 Python** (django 7, fastapi 7, flask 5, other_python 5; 2.4× by largest remainder).
  - Role `dev`, with reserves fixed before the draw.
- **Why 36 TS.** At 12 TS repos, dev3 gave 5 default cards. The per-repo rate is 0.42 on dev3 and 0.39 on heldout1 (7 cards over the 18-repo quota). The chance of the ≥ 8 cards condition (a) needs (§8):

  | TS repos | P(≥ 8 default cards), dev3 resampled | Poisson, dev3 rate | Poisson, heldout1 rate |
  |---|---|---|---|
  | 12 (dev3) | 13% | 13% | 10% |
  | 24 | 80% | 78% | 71% |
  | 30 | 95% | 93% | 89% |
  | **36** | **99%** | **98%** | **97%** |

  36 makes the D1 question answerable with near certainty, at about 15 default cards expected. With 12–15 cards, a point estimate ≥ 90% allows at most one non-accept. At about 1 shown card per TS repo (dev3), labelling costs about 36 TS cards.
- **Why 24 Python.** P(≥ 10 shown) is 96% at the build-set rate of 0.67 per repo, but only 6% at dev3's 0.25. A Python failure on n alone is a failure [STRICT]. More Python repos (40 for 63% at dev3's rate) cost more than the question is worth while Python ships off.
- **What it measures.** dev4 is censused at the round-11 freeze `F11` on the frozen binary, then labelled blind A/B/C under rubric v3, as dev3 was:
  - TS: the default (candidate) tier;
  - Python: the opt-in view (§3).
- **Isolation.** dev3's, unchanged: nobody building product opens dev4 repos, cards or labels before `F11`, and after its report it joins the build set.
- **Unchanged policy.** The show table is **not** regenerated in round 11 [STRICT]. dev4 then measures the same suggestion policy dev3 did, a second blind estimate of an unchanged policy, which is what predicts held-out.

### 4.2 The D12 gate, revised (no bar lowered)

The next held-out draw is still D12, and §3.4 of PLAN-R10 still governs it, with these changes:

1. **Freeze.** `F11` replaces `F10`, with every round-11 mining, check or exposure workstream merged before it.
2. **dev4-check** replaces the dev3-check. Point estimates, unlabelled counted as WRONG:
   - **(a)** TS default-tier (D7 candidate tier) accept ≥ 90% with ≥ 8 cards. *Unchanged*: the tier definition is the same under option (d), so the bar measures the same thing.
   - **(b)** Not-wrong ≥ 70% per language:
     - TS over all shown;
     - Python over the opt-in view (§3), and **with ≥ 10 shown Python cards** (new).
   - **(c)** For each language, the build-set in-sample figure within 10 points of dev4's. The build set now includes dev3, with dev3's cards re-censused at `F11` and labelled under the carry rule.
3. **Prediction.** The written D1, D4 and per-card-accept prediction, with intervals, is made from **dev3 and dev4 pooled**, the two blind pools. Build-set readings are reported beside it, not used for it. It is committed before the selection seed.
4. **Spacing.** Unchanged. At most one held-out draw per freeze, none before dev4 is reported, and D10.3 is gated separately.

**Why these changes.**
- **(a)** could not be met at dev3's size: 5 expected cards against ≥ 8 needed. §4.1 sizes dev4 for it instead of relaxing it.
- **(b)** had no minimum n for Python. dev3's 2 cards gave a 50% "estimate", and 2/2 would have "passed". The minimum makes the bar harder, not easier.
- **(3)** removes the one input that has overstated every blind or held-out figure so far: the in-sample forecast.

**Not changed:** every threshold (90%, ≥ 8, 70%, 10 points), point-estimate judging, joint passing of all conditions [STRICT], and D1's ≥ 95% and D4's bars on held-out.

If the dev4-check fails, there is no D12 again. dev4 joins the build set, and round 12 draws dev5.

**The less strict alternative, for the lead (not recommended).** Python ships off by default (§3), so Python's conditions could gate turning Python on, rather than the TS held-out draw. It lowers no threshold, but it lets D12 proceed with one language failing, so this plan keeps the conditions joint.

## 5. Workstreams (round 11)

There are six. Every mechanism PR reports the **fold rule** (PLAN-R10 §3.2) over **five folds**: the four build folds of `folds-r10.json` plus **fold 5 = dev3** (12 TS, 8 Python), re-censused at the PR's binary.
- **Admission.** A mechanism is admitted only if:
  1. it helps cards in ≥ 3 repos across ≥ 2 folds;
  2. it loses no ACCEPT outside its design folds, fold 5 included;
  3. its other-fold effect is positive;
  4. its fold-5 effect, reported separately, is not negative.
- **[STRICT] Fold 5 is a design fold** for every default-tier or candidate-tier mechanism, because this plan read and quotes every dev3 default card. It is also a design fold for any mechanism whose author has read dev3 card reasons; the author declares this in the PR before computing any fold figure.
- **The only unseen test** of a default-tier mechanism in round 11 is dev4.

| | Workstream (owner-to-be) | What | Acceptance | Must measure |
|---|---|---|---|---|
| A | **dev3 into the build set; fold 5; default-tier readings** (study harness agent) | Keyed dev3 checkouts as build clones, at their pinned shas. `folds-r11.json` adds fold 5. `generalise.mjs` accepts the dev3 runs as fold 5 (it still refuses held-out paths) and gains default-tier readings: accept and flag precision per fold. `r11-default.mjs` folds into it as a tested reading. | `node --test` with a mutation per new admission branch. `generalise.mjs` reproduces #132's dev3 figures (1/5, 7/12, 31.3%) and #129's build figures. | Fold sizes; dev3 re-census at main equals F10's |
| B | **Exposure: candidate tier and Python off** (product agent) | Option (d): D7 cards reach agents only once accepted or `agents: show`; the census JSON gains `agents.reason: "candidate"`; text "block candidate". Python mined proposals off by default, with an opt-in in config and a census study flag. Studio pair: a candidate badge, plus a Python opt-in state, each with a `SYNC.md` row. | The TS census card set is unchanged on the 16 TS build clones and the 12 dev3 TS clones. Agent-visible unvetted cards go to 0. The Python default census shows 0 proposals, and the opt-in reproduces F10 byte for byte. Hook, MCP and AGENTS.md golden tests. A mutation check per new branch. Studio gates. | Cards per surface before and after, per set; D4 unchanged [STRICT] |
| C | **Candidate scope** (mining agent) | Test the two §1.4 hypotheses as mechanisms, measured, not assumed. **K1:** a call-wrapper candidate needs an entry role (http, rpc, server_action, …). On dev-v3, non-entry wrapper cards were 0/2, and dev3's was 0/1; relabel5's two (ai, supabase) are id-tuned. **K2:** a layering candidate does not count config or tooling files (`*.config.*`, `scripts/**` roles) as members. Anything else that fails moves to the suggestion tier. | Fold rule over five folds (fold 5 a design fold). Folds 1–4 must lose no ACCEPT; K1 as stated would lose ai D-fc5ef7 and supabase D-e93eb6 and so fail. On dev-v3 candidates: ≥ 2 of 8 non-ACCEPTs removed, 0 ACCEPTs. | Candidate accept per fold; flag precision; demotions; dev-v3 reading |
| D | **dev4 draw and pre-registration** (study harness agent, "dev4") | §4.1 selection, with exclusions and techcheck. Pre-register the dev4-check (§4.2) and the measures of `PREREG-F10-dev3-check.md` §4, plus default-tier flag precision and the Python opt-in view. | `verify` shows no overlap with any set. The record is committed before the seed. Nobody else opens dev4. | Repos per bucket after techcheck; reserves used |
| E | **dev4 census and blind labelling at F11; build-set relabel** (relabel agent) | As dev3's runbook, on the frozen binary: TS shown cards; the Python opt-in view. Relabel the build set's changed cards, dev3's included (carry rule). | Pre-registration committed before any census. Every shown card labelled; C on disagreements only. | Everything of §4.2; yield per repo; WRONG causes; agreement |
| F | **D12 decision and prediction** (lead + study agent) | Apply §4.2. If met, write the prediction from dev3 + dev4 and pre-register D12 (selection only). If not, record why in the README log and schedule dev5. | Decision recorded before any draw | Predicted against dev4; dev3 + dev4 pooled |

**Order.**
1. A and D first.
2. Then B and C, in parallel.
3. Merge before `F11`.
4. Then E, then F.

Agent text, the verifier and the show table get no new work this round [STRICT on the show table, §4.1].

**Round-11 targets.** These are on the dev4-check, not held-out claims:

| What | Target |
|---|---|
| TS candidate-tier accept | ≥ 90%, with ≥ 8 cards |
| Not-wrong, TS all shown; Python opt-in view | ≥ 70%, with ≥ 10 Python cards |
| Build set in-sample against dev4, per language | within 10 points |
| Unvetted cards shown to agents | 0, on every set |

## 6. Decisions asked of the lead

**Adopted by the lead, 2026-11-08 (decision D13):** all five below, as written, with the strict options throughout. Round 11 runs the workstreams of §5 in the order given there.

- **D13-default:** adopt option (d), the candidate tier (§2) [STRICT]. D1 is measured on the candidate tier as defined by D7, and D4's population is unchanged.
- **D13-py:** Python mined proposals are off by default until the §3 bar is met [STRICT]. The less strict alternative is in §3.
- **dev4:** 36 TS/JS + 24 Python, twice the held-out quotas (§4.1).
- **D12-rule, revised:** §4.2, with the conditions joint [STRICT].
- **Show table:** frozen for round 11 [STRICT].

## Files
| Path | What |
|---|---|
| `research/2026-11-08/r11-default.mjs` | The analysis: `node eval/study/research/2026-11-08/r11-default.mjs [--json out]`. It reads the build-set label snapshots, the PR mentions, the committed show table and the dev3 runs; the held-out figures are the lead's aggregates, typed in. |
| `research/2026-11-08/r11-default.out.txt`, `r11-default.json` | Its output at main `50b3c5b` |
