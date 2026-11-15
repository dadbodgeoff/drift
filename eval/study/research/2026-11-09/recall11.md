# recall11: does Drift catch the deviations maintainers fix? (round 11, build set only)

**Question.** Does Drift catch the deviations maintainers actually fix? Precision has been measured carefully, the usefulness half of par barely. On held-out data, recall at shown against documented conventions was 0.8% (TS) and 0.3% (Python). This note measures recall against behaviour instead. It replays about 200 commits of history on every build repo. It counts the deviations from a rule mined at the start that a later commit brought into conformance, and asks whether `drift check` would have shown each one. Measurement only: no product code or default changed, and main stays at F11.

## Headline

All figures are build set only (54 repos: 28 TS/JS, 26 Python; folds 1–5). There are 8,771 first-parent commits after S, and a review-time arm over the pull requests' own commits.

| | TS/JS | Python (opt-in view) |
|---|---|---|
| Fixed deviations, introduced after S (main line) | 2 of 242 deviations | 2 of 111 |
| Fixed outliers that were already on a card at S | 29 of 2,257 | 14 of 253 |
| Fixed in review (branch commits, before the merge) | 0 of 55 branch deviations (24 repos, 4,504 branch commits) | 3 of 103 (23 repos, 6,644 branch commits) |
| **Recall at `shown`** (product show policy, candidate tier not shown), gate off = gate on | **0/2 new, 0/29 legacy, no review fix** | **0/2 new, 0/14 legacy, 0/3 review** |
| Recall with the candidate tier counted as shown | 0/2, 1/29 (3.4%) | no candidate tier in Python |
| Recall over every card F11 mines, cap aside (`pool`) | 0/2, 7/29 (24.1%) | 0/2, 0/14 |
| Warnings per commit: `shown` / +candidate / every mined rule | 0.0004 / 0.0045 / 0.049 | 0 / 0 / 0.029 |
| Warnings later fixed: `shown` / +candidate / every mined rule | 0/2 / 0/22 / 2/242 (0.8%) | – / – / 2/111 (1.8%) |

With Python at its default (proposals off, D13-py), every Python figure in the `shown`, candidate and pool rows is 0 by construction.

1. **Recall at shown is zero in every population, language, fold and gate setting.**
   - The Wilson upper bound on the legacy population is 11.7% for TS (0/29) and 21.5% for Python (0/14).
   - The `agents` arm is 0 by construction: F11 admits no suggestion family for agents, and candidates need an accept.
   - The neighbour gate changed nothing. It held back no warning in any of the 54 walks, and the gate-off runs matched the gate-on runs at every compared checkpoint (0 discrepancies over 1,407 compared checkpoints).
2. **Maintainers almost never fix a deviation from a mined rule after it merges.**
   - Of the 353 deviations that new code introduced on the main line, 4 were fixed within the window (1.1%) and 1 was removed. The rest still deviated at the pinned head.
   - Of the 2,510 outliers the cards listed at S, 43 were fixed (1.7%) and 144 removed.
   - So "fixed later" is a rare event. The share of warnings later fixed is not a usable precision proxy at this horizon: it is ≤ 2% for every arm, including the families with the best labels.
3. **The fixes Drift does see are in cards it hides.**
   - None of the 47 fixed deviations (new + legacy, both languages) is on a card in `shown`. One is on a candidate.
   - The rest are on cards the cap pushes out (6), or on cards the show policy hides: families below the show bar (29), a card with more than one outlier (1), and families hidden outright (10).
4. **The cap is applied before the show policy.** This is a mechanism finding.
   - `mine.rs` truncates to 15 proposals, and to 4 layering rules (25%), *before* `mine_families` drops what the show policy hides. So a hidden card still takes a slot.
   - On the build set, F11's default listing has 51 TS cards. 79 cards of policy-shown families would fit in the same 15 slots per repo (P1 below). One repo with 14 admitted-family suggestions shows none: every slot went to hidden cards.
   - `drift census --help` says the default tier is "always listed in full". The layering cap breaks that for cal.com: F11 lists 4 of its 13 candidate-tier cards.

### Where the fixed deviations are (new + legacy, both languages; the review-time arm adds 3 more: Python `decorator`, Python `layering`, TS `argument_key`)

| Family (language), why not shown | Fixed | Repos | Folds | Outliers at S on those cards | Legacy fixed / outliers at S | v3 card accept of the family (show table; by fold) |
|---|---|---|---|---|---|---|
| **repo** (TS: `has_test`, `prefers_library`, …), below the show bar | 10 | 3 | 2, 3, 5 | 368 | 2.7% | 7/15 (47%); f2 2/5, f3 3/6, f4 2/2 |
| **decorator** (Python), below the show bar | 13 (10 legacy + 2 new + 1 in review) | 2 | 2, 4 | 20 | 50% | 4/7 (57%); f1 0/2, f2 4/4, f4 0/1 |
| **layering** (TS candidate tier), past the cap | 6 (+1 shown candidate) | 1 (+1) | 4 (+2) | 24 | 25% | D7 tier; capped cards never labelled |
| argument_key (TS), below the show bar | 5 | 3 | 1, 5 | 145 | 3.4% | 6/12 (50%); f1 0/3, f3 3/6, f4 3/3 |
| calls (TS), hidden outright | 4 (3 + 1 new) | 1 | 5 | 58 | 5.2% | 1/3 |
| ordering (TS), hidden outright | 4 | 2 | 1, 4 | 123 | 3.3% | 1/10 (10%) |
| repo (Python), hidden outright | 2 | 1 | 5 | 21 | 9.5% | 0/3 |
| avoids_other (TS), below the show bar | 2 (1 + 1 new) | 2 | 3, 4 | 30 | 3.3% | 1/2 |
| control (TS), more than 1 outlier | 1 | 1 | 4 | 6 | 16.7% | 8/10 |

**The top three by fixed deviations** are TS `repo`, Python `decorator` and TS candidate-tier `layering` past the cap. Only `repo` spreads over ≥ 3 repos and ≥ 2 folds. With its review fix, Python `decorator` spans 2 repos in 2 folds. Capped `layering` is one fold-4 repo.

**Their precision cost.**
- Their labelled card accept is 47–57%, under the show policy's 60% bar.
- Their outliers are fixed 2.7–3.4% of the time, apart from the single-repo `decorator` (50%) and the capped `layering` card (25%).
- Showing TS `repo` cards at any outlier count (P3 below) would add 50 cards in 16 repos, with 368 outliers listed at S, and 0.0065 new warnings per commit, none of them later fixed.

### Review-time arm and P1 built

**The review-time arm is complete.** It covers the 47 repos with cards.
- **Volume.** 5,706 merged branches after S; 3,182 of them walked within the per-repo budget; 11,148 branch commits checked.
- **TS/JS, 24 repos.** 55 branch deviations: deviations a pull request introduced and that violated at neither the merge's first parent nor the branch's base. **0 were fixed before the merge**; 5 were removed and 50 merged.
- **Python, 23 repos (opt-in view).** 103 branch deviations: **3 fixed before the merge**, 10 removed, 90 merged.
  - The 3 fixes are one Python `decorator` card (fold 2), one Python `layering` card and one TS `argument_key` card (both fold 5).
  - All 3 are on cards the show policy hides, so recall at `shown` in review is **0/3**.
- **Per fold** (branch deviations / fixed):
  - TS: f1 0/0, f2 1/0, f3 5/0, f4 10/0, f5 39/0.
  - Python: f1 3/0, f2 1/1, f3 0/0, f4 84/0, f5 15/2.
- **Reading.** Review does not change the picture. Within pull requests too, maintainers rarely fix a deviation from a mined rule (3 of 158), and every fix is in a hidden family.

**P1 is built**, as an F12 candidate on `ws/show-before-cap` (draft PR). It was censused against F11 at the pins of the 54 build repos.
- **New cards.** +21 new cards in 5 repos of folds 1–4, all suggestion tier (19 naming, 2 control). 11 are listed by default and 10 under `--all` only. Fold 5 has none.
- **One merged card.** One card is replaced by a merged card over its sibling folders, the siblings F11 capped out.
- **Nothing else changed.** No other card changed.
- **Simulation vs census.** The figures differ from the simulation above (51 → 79 at S) because the census runs at the pins, about 200 commits later than S.
- **Labels and verdict (#163).** Blind labels: 14 ACCEPT, 8 WRONG of 22, κ 0.804. Under the five-fold rule, with design folds 3, 4, 5, P1 is **admitted as an F12 candidate**: +4 ACCEPT in the other folds, and no ACCEPT lost there, because the merged card is ACCEPT.

## Reading per fold (aggregates; fold 5 = dev3)

| Fold | TS repos | TS commits | TS deviations (new) / fixed | TS legacy fixed | TS warnings/commit: shown, +candidate, all | Py repos | Py commits | Py deviations / fixed | Py legacy fixed | Py warnings/commit (opt-in), all |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 4 | 595 | 8 / 0 | 6 | 0, 0, 0.013 | 5 | 719 | 4 / 0 | 0 | 0.006 |
| 2 | 4 | 799 | 16 / 0 | 2 | 0, 0.013, 0.020 | 5 | 964 | 29 / 0 | 0 | 0.030 |
| 3 | 4 | 800 | 135 / 0 | 2 | 0, 0, 0.169 | 4 | 674 | 0 / 0 | 0 | 0 |
| 4 | 4 | 796 | 22 / 1 | 6 | 0, 0.011, 0.028 | 4 | 524 | 70 / 2 | 12 | 0.134 |
| 5 | 12 | 1,940 | 61 / 1 | 13 | 0.001, 0.002, 0.031 | 8 | 960 | 8 / 0 | 2 | 0.008 |

- Recall at `shown` is 0 in every fold, for both languages, gate off and on.
- Fold 3's 135 TS deviations are mostly two hidden-family cards of one repo: `decorator`, 84 warnings, and `argument_key`, 47.
- Fold 4's Python figures are one repo.
- The full tables are in `recall11-tables.md`: per arm, class, family and fold; legacy; P1/P1b; per-family proposals.

## Proposal (pre-registerable; no product change in this PR)

No show-policy or tier change can be justified from these data as a recall gain [STRICT]:
- The fixes sit in families whose labelled accept is under the show bar.
- Only TS `repo` has the spread the fold rule asks (≥ 3 repos across ≥ 2 folds).
- **Every build fold is a design fold** for anything proposed here, because this note read card-level data of folds 1–4 and aggregates of fold 5. The only unseen test is a blind pool: dev4's history-replay arm, or dev5.

What follows is written so that it can be pre-registered for round 12 as it stands.

**P1, the show policy before the caps** (recommended; a listing fix, not a recall claim). It is now built as an F12 candidate on `ws/show-before-cap`.
- *Change.* Apply the show policy, and the D13-py withholding, *before* the 15-per-repo cap and the 25% layering share. Hidden cards then stop taking slots. Nothing about agents changes.
- *Expected effect (build set, simulated from `census --all`, `lib.mjs shownUnderP1`).*
  - TS default listing: 51 → 79 cards. By fold: f1 5 → 9, f2 16 → 19, f3 7 → 21, f4 13 → 20, f5 10 → 10.
  - Python opt-in listing: 15 → 15.
  - Fixed deviations recovered: 0 at `shown`, +1 legacy at +candidate (fold 4).
  - Warnings per commit: unchanged at `shown` (0.0004), +candidate 0.0045 → 0.0045.
- *Precision cost.* The added cards are of families the show table already admits, naming and control with ≤ 1 outlier, plus candidates. Their labelled accept on the build set is: TS naming 24/37, by fold f1 0/6, f2 12/13, f3 4/4, f4 6/11; control 8/10. They are new cards, never labelled, so D4's population grows by about 1 card per TS repo.
- *Pre-registered measure.* Label the added cards blind under rubric v3, as dev3's runbook does. Admit P1 if their not-wrong rate is ≥ 70% (D4's bar) on the unseen pool, with ≥ 10 added cards.

**P1b, P1 plus the default tier listed in full** (as the CLI help already promises).
- Default-tier cards would be exempt from both caps, for people only. Candidates still reach agents only once accepted.
- *Effect.* TS listing 51 → 84. Fixed legacy deviations at +candidate: 1 → 7 of 29, all of the gain in one fold-4 repo. The headline `shown` recall is unchanged, since candidates count as not shown.
- It fails the fold rule's spread (1 repo, 1 fold), so it can only be pre-registered as a hypothesis for the blind pool. *Measure:* candidate accept of the added layering cards, D1's bar (≥ 90% with ≥ 8 cards) [STRICT].

**P3-repo, show TS `repo` cards with any number of outliers, people-facing, marked "not shown to agents"** (the one recall-bearing family with the spread; not recommended to ship).
- *Effect.* +50 cards in 16 repos. Recall at `shown` on legacy rises to 10/29 (34%), from folds 2, 3 and 5.
- *Precision cost per fold.* Labelled accept: f2 2/5, f3 3/6, f4 2/2, f1 none, f5 unlabelled for this family. New warnings: 0.0065 per commit TS, 0 of 32 later fixed. 368 outliers listed at S.
- At 47% accept it would lower D4. Its pre-registration would need the family to clear the show bar (≥ 60% with ≥ 5 cards, leave-one-repo-out) on the next relabel first, which it does not today.

**Not proposed:**
- `argument_key` (50%, 0/51 warnings fixed, 0.010 warnings per commit), and `decorator` (one repo).
- `ordering` and `calls`: hidden outright with 10% and 33% accept.
- Any change to what reaches agents: the agent-facing set stays the accepted candidate tier [STRICT].

**What would make the recall question answerable.** At about 1 fixed deviation per 2,000 main-line commits, no build-set or dev4 walk can estimate recall at `shown` with a useful interval: 0/29 already bounds it at ≤ 11.7%.
- The review-time arm is the larger source of fixes. It needs pull-request branches, and most of these repos squash them.
- The data that would answer it is the PR review record: the deviations a reviewer asked to fix. That record is the next measurement to pre-register, not a show change.

## Limitations

- **Horizon.** About 200 commits, so a deviation introduced late in the window has little time to be fixed.
- **Stride.** On supabase, cal.com, novu, formbricks, saleor, dub (stride 2) and twenty (stride 3), a deviation introduced and fixed between two checkpoints is invisible.
- **What counts as fixed.** "Fixed" means the convention holds on the member again. A member that left the role or was deleted is "removed" and not counted [STRICT]. So recall is over conformance fixes only.
- **Squash merges.** Most build repos squash pull requests, so a fix made during review is invisible to the main-line walk. The review-time arm reads `refs/pull/N/head` and sees only the commits GitHub kept, the newest 30 per PR, within a 150 s check budget per repo.
- **Legacy recall.** It is a census-time reading (the card at S listed the outlier), not a check at an introducing commit.
- **Short histories.** Seven repos had fewer than 60 first-parent commits after S (merge-heavy histories), and one fold-5 repo has 47 commits in all.


## Method

**Data.** The build set of `eval/study/folds-r11.json` only: folds 1–4 (the 16 TS/JS repos of `eval/repos.json` and the 18 Python repos of `eval/repos-py.json` and `eval/repos-py-2.json`, without polar and CTFd) and fold 5 (dev3, 12 TS + 8 Python, by key). No dev4 or held-out file, repo or run was opened. Fold 5 is cited by aggregates only [STRICT]: its rows are left out of `deviations-f1-4.jsonl`, and no dev3 card, id or path appears here.

**History.** For each repo, one bounded fetch (`git fetch --depth=300`) of the pinned head into a private repo under scratch (the dev clones are depth 1 and were never written). **S** is the first first-parent commit at least 200 commits before the head (`lib.mjs pickSnapshot`; 150–343 in practice, per repo in the Repos table). The walk covers every first-parent commit after S, up to the pinned head.

**Mining at S.** All with the F11 code (`cgu83-1a44d7ef`):
- *What the product shows.* The frozen F11 binary's `census --json`, four ways: the product defaults (cap 15, 5 suggestions, the show policy, Python proposals off by D13-py); the same with `--python-proposals` (the opt-in view); and both with no cap (`--all --max 1000`).
- *Every rule mined, hidden ones included.* The F11 show policy removes a hidden card at mining time, and a release build cannot show one (`show.rs`, [STRICT]). So the walk mines with a **study build of F11** (`eval/study/recall/study.patch`, CGU 84, `cgu84-1a44d7ef-1794189636`). The patch changes nothing unless one of two variables is set:
  - `DRIFT_STUDY_UNSHOWN=1` skips the show policy, so mining proposes the cards it hides; it also turns Python proposals on, as the debug-only test switch does.
  - `DRIFT_STUDY_MEMBERS=1` makes `check --format json` also list `study_holds`: every `id path#symbol` a convention holds on.
- *Verified by behaviour.* On dub at S, the study binary without the variables gives F11's census (6 cards). With `DRIFT_STUDY_UNSHOWN=1` it gives 23. On the same tree, its `check --format json` with `DRIFT_STUDY_MEMBERS=1`, with `study_holds` removed, is byte-for-byte F11's.
- *The frozen policy.* `init --max 1000 --all` with the study binary, then every card accepted (advise mode). drift.lock is the baseline at S.

**The walk.** At each first-parent commit after S, `check --format json` runs with every card accepted:
- **Gate on.** It runs with `DRIFT_NEIGHBOUR_GATE=on`. The gate keeps the warnings it holds back in `violations`, flagged `suppressed_neighbour`.
- **Gate off, as a check.** Every 5th checkpoint and the last also run gate off. This confirms that the gate-off warnings are the gate-on violations without the flag (PREREG-F11 §7 "discrepancies").
- **Every commit.** Every first-parent commit is a checkpoint when 300 checks fit in a 600 s budget. Otherwise every k-th commit plus the head (k = 2 on supabase and cal.com, 3 on twenty; see the Repos table).

**Deviations and fixes** (`lib.mjs track`, keys `id path#symbol`, followed through `git diff -M` renames):
- A **deviation** is a key that violates at a checkpoint and was neither in drift.lock at S nor already open. Its *introducing checkpoint* is the first checkpoint that shows it.
- When a deviation stops violating, its status is one of:
  - **fixed**: the convention holds on the member (`study_holds`). This is the only "fixed".
  - **exempted**: Drift now exempts the member.
  - **removed**: the member left the role or was deleted.
  - Exempted and removed are not fixes [STRICT].
- A deviation still violating at the head is **unfixed**.
- A key whose file is unchecked at a checkpoint is unknown there, not absent.
- **Legacy outliers.** The lock entries at S (the outliers each card listed at S) are tracked the same way. A fixed one is a deviation the census at S showed on its card, if its card was shown. There is no introducing commit to check at.

**Review-time arm** (`branches.mjs`). In most of these repos a pull request is squashed into one first-parent commit, so a deviation that a review fixed before the merge never appears on the main line.
- **The fetch.** For every first-parent commit after S that merged a branch, there is one more bounded fetch: the merge commit's second parent, or for a squash commit whose subject ends in `(#N)`, GitHub's `refs/pull/N/head` (`--depth 30`).
- **The checks.** `check` runs at the merge's first parent P, at the branch's base B, at each branch commit (the newest 30) and at the merged commit C. Pull requests are taken in an even stride over the window, within a 150 s check budget per repo.
- **Branch deviations.** A branch deviation violates at some branch commit and at neither P nor B. At C it is fixed (C holds the member), exempted, removed, or merged (still violating, so the main walk counts it).
- **A second fetch [STRICT, noted].** This arm needed a second bounded fetch per repo, which the brief's "a single bounded fetch per repo" did not foresee. Each fetch was bounded, run one at a time, and deleted with its repo.

**The show ladder** (`lib.mjs armOf`). Each card is placed by what the F11 census at S says of it. The arms are nested:

| Arm | Cards in it | Who sees a warning |
|---|---|---|
| `agents` | shown by the product with no person's accept: suggestions of a family admitted for agents (`family-admission.json`; **F11 admits none**) | agents |
| `shown` (headline) | + the suggestions the census lists by default (cap 15, 5 suggestions, show policy). **The candidate tier is counted as not shown.** | a person, who may accept them |
| `candidate` | + the default (candidate) tier, as if a person accepted every candidate | agents, once accepted |
| `pool` | + every card F11 mines past the cap | nobody unless listed with `--all` |
| `all` | + every card the show policy hides, and, in the default view, every Python card (D13-py) | nobody |

**Recall** of an arm: the fixed deviations whose card is in the arm and which `check` gave as a new warning at the introducing checkpoint (not baselined, not `drift-ignore`d, not unsure, and with the gate on, not held back), over all fixed deviations of every mined card. Python is read in the default view (proposals off: every Python card is in `all`) and in the opt-in view. TS/JS repos are read in the default view; their few Python cards are `python_off`.

**Warning rate** per arm: deviations given as new warnings, over first-parent commits walked. **Fixed share**: of those warnings, how many were later fixed.

## Files

- `eval/study/recall/lib.mjs`: pure helpers (snapshot, checkpoints, renames, tracking, the show ladder, aggregation). `lib.test.mjs` has their node tests (`node --test eval/study/recall/lib.test.mjs`).
- `eval/study/recall/walk.mjs`: one repo's first-parent walk. `branches.mjs` is the review-time arm. `run.mjs` is the driver, one repo at a time (it waits for 4 GB of free memory, stops under 3 GB of disk, and deletes each repo and cache after it).
- `eval/study/recall/score.mjs`: the aggregates (`--json`, `--md`) and the deviation-level rows (`--cards`, folds 1–4 only).
- `eval/study/recall/study.patch`: the study build (applies to `1a44d7ef`; never on main).
- `eval/study/research/2026-11-09/recall11.json`, `recall11-tables.md`, `deviations-f1-4.jsonl`: this run's outputs.
