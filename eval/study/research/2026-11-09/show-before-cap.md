# Show policy before the caps (round 11): admitted as an F12 candidate

## Design folds, declared before any label was rendered or read

| Mechanism | Designed from | Design folds |
|---|---|---|
| The caps count shown cards only | recall11's walk (`ws/recall11`): the aggregate "cards F11 lists vs. cards of shown families that fit in 15 slots" per fold, and the uncapped card lists (rank, tier, rule kind; no label) of two repos, one in fold 3 and one in fold 4 | **3, 4, 5** |

- **[STRICT] Fold 5 is a design fold.** PLAN-R11 §5 makes it one for every mechanism that touches the default (candidate) tier, and this one changes the layering share.
- **Folds 3 and 4.** The mechanism was read off card lists of one repo in each.
- **Other folds: 1 and 2.**
- Before this declaration I saw the census diff's new-card summaries in every fold. I saw none of their labels, and none exist yet.
- I read no dev3 card, label or file name for this mechanism, and I opened no dev4 or held-out file.

## What was wrong

`mine.rs` applied two caps before the show policy:
- the layering share, at most 25% of the 15, so 4 `avoids` rules;
- then the 15 proposals per repo.

Only after the caps did `mine_families` drop the cards the show policy hides. A hidden card therefore still took a slot, and the product listed fewer cards than its own policy shows. On one fold-3 build repo, F11 lists **no** card at all, because every one of its 15 slots went to hidden cards. That repo has 13 cards of admitted families.

Found by recall11 (`ws/recall11`, `eval/study/research/2026-11-09/recall11.md`, finding 4).

## The change (`crates/drift-mine/src/mine.rs`)

- **`cap_shown` replaces the two inline caps.**
  - Without a hidden set, it is the old logic exactly. The unsplit pass, `mine_unshown`, `mine_every_family` and the study's mining all take that path.
  - With one, the caps count only drafts that become shown cards.
  - A hidden draft is kept exactly when the old caps keep it, and the show policy drops its card afterwards as before. So what it shares with its role first is unchanged: `share_role_exemptions`, `merge_siblings`.
- **Which drafts are hidden.** When the show policy applies, `mine_families` mines once with no cap (`UNCAPPED`), and runs the show policy on that pass's cards.
  - Each draft carries an `origin`: its id at the caps, before `subtree` or a merge reshapes it.
  - `mine_units_traced` maps every candidate back to the origins of its drafts: one draft, or a merged card's parts.
  - The second pass caps with those origins.
- **Cost.** Mining runs twice when the show policy applies (`census` and `init`, not `check`).
- **Accepted cards.** Hysteresis is unchanged: an accepted card is never hidden and is counted, as before.
- **Not changed.**
  - The per-role cap (5) is still applied before the policy.
  - D13-py's Python withholding still runs after the caps.
  - Neither changes any build-repo card here (Python opt-in diff = default diff). Both are noted as follow-ups.

## Tests

- **`crates/drift-mine/tests/show_before_cap.rs`** builds a synthetic fixture:
  - a default-tier wrapper card;
  - one naming suggestion the policy shows (one outlier);
  - four larger naming suggestions it hides (two outliers each), which rank above it.
  - Under a cap of 3, the unshown mining shows the hidden cards crowding the shown one out. The product now proposes it, identical to its uncapped card, within the cap.
  - A second test checks that a cap of 1 keeps the best shown card.
- **`mine::tests::the_caps_count_shown_drafts_only`**: `cap_shown` with no hidden set is the old pair of caps. With a hidden set, hidden drafts keep their old place and take no slot. A hidden draft past the old caps stays out.
- **Mutation** (`// mutation:cap-shown`: count every draft again). Both new tests fail; restoring the line makes them pass.

## Census diff against F11 (`census-diff.py`, `census-diff.txt`, `census-diff.json`)

`/home/user/drift-bin/f11/drift` against the branch binary `cgu84-9333873e-1794204614`, on the 54 build clones at their pins. `census --json`, default and Python opt-in; the two views give the same diff.

| Fold | Repos changed | New proposals | of which shown by default | Lost | Changed |
|---|---|---|---|---|---|
| 1 | 1 | 4 | 4 | 0 | 0 |
| 2 | 2 | 4 | 2 | 1 (merged, see below) | 0 |
| 3 | 1 | 13 | 5 | 0 | 0 |
| 4 | 1 | 1 | 1 | 0 | 0 |
| 5 | 0 | 0 | 0 | 0 | 0 |
| **All** | **5 of 54** | **22** (21 new + 1 merged) | **12** (11 new + the merged one) | **1** | **0** |

- **Tiers and families.** Every new card is suggestion tier. None is default tier and none reaches agents (no suggestion family is admitted for agents). Naming 20, control 2. The two control cards and 8 naming cards are past the 5-suggestion listing cap, so they are listed with `--all` only. They count in D4's population [STRICT].
- **The lost card.**
  - One fold-2 card (labelled ACCEPT in relabel5) is not dropped. F11 capped out two sibling drafts of the same rule in neighbouring folders. They now get in, and `merge_siblings` merges all three into one card over the three folders: 181/182, against the old card's 97/98.
  - Its id changes, so strictly it is a lost ACCEPT id outside the design folds. The merged card is in the label rows.
- **The other 49 repos are identical card for card.** No evidence, outlier or tier of an existing card changed.

## Labels (run 2, the run of record)

- **Method.** Rubric v3, blind. A2 is the default model and B2 is sonnet, each one prompt per repo; C2 adjudicated the disagreements only. Keys were opaque (`keymap.json`, committed after labelling).
- **Rendering.** `label.py`, through `lib.mjs` `rubricText` and `labellerCard`, with the pre-launch leak check.
- **Validation and collection.** Validated with `lib.mjs checkLabel` (`validate.mjs`) and collected with `collect.py`. Every cwd was empty, every outbox held only its output, every checkout was clean, and no copy of a key was found outside the label folder.
- **Agreement (A2/B2).** 20 of 22 (po 0.909), κ = **0.804** (`agreement-A2-B2.json`). Both disagreements are in the fold-3 repo. C2 decided them:
  - one ACCEPT, siding with A2;
  - one WRONG `legit_outliers`, siding with A2.
- **Final** (`labels-final.jsonl`): **14 ACCEPT, 8 WRONG, 0 TRIVIAL** of 22.
  - **Shown by default:** 9 of 12 ACCEPT.
  - **Listed with `--all` only:** 5 of 10 ACCEPT.
- **Against deviation run 1.** No card that run 1's A and B agreed on has a different final label. Run 1's four splits, all fold 3, now resolve to ACCEPT, WRONG, ACCEPT and ACCEPT. Run 1 has no C, so those four have no run-1 final label.

| Fold | Repo | New cards | ACCEPT | WRONG | Note |
|---|---|---|---|---|---|
| 1 | infisical | 4 | 3 | 1 | all shown by default |
| 2 | documenso | 1 (merged) | 1 | 0 | `D-2c517d` replaces `D-a10f62` (relabel5 ACCEPT) |
| 2 | novu | 3 | 1 | 2 | the 2 WRONG are listed with `--all` only |
| 3 | twenty | 13 | 9 | 4 | design fold |
| 4 | dub | 1 | 0 | 1 | design fold |
| 5 | – | 0 | 0 | 0 | no card changed |
| **All** | 5 repos | **22** | **14** | **8** | |

## Fold rule (PLAN-R10 §3.2 with PLAN-R11 §5; design folds 3, 4, 5 as declared at 4758fef3)

| Condition | Numbers | Met |
|---|---|---|
| (a) helps cards in ≥ 3 repos across ≥ 2 folds | ACCEPT gains in 3 repos over 3 folds: infisical +3 (f1), novu +1 (f2), twenty +9 (f3) | **yes** |
| (b) loses no ACCEPT outside the design folds | Other folds 1–2: the one lost id, `D-a10f62` (ACCEPT), is merged into `D-2c517d`, final ACCEPT (A2 = B2). No other card is lost or changed | **yes** (with the merged card) |
| (c) the other-fold effect is positive | Folds 1–2: +4 ACCEPT (infisical +3, novu +1; documenso 0), against +3 WRONG added (infisical 1, novu 2) | **yes** (+4) |
| (d) the fold-5 effect is not negative | 0: no fold-5 card changed | **yes** (0) |

**Verdict: admitted as an F12 candidate.** It does not ship before the F12 blind check, and main stays frozen.
- **Condition (b) is read at card level,** as declared before any label: the merged card `D-2c517d` decides it. The id-strict reading, under which any lost ACCEPT id fails and the change would not be admitted, is a recorded sensitivity note, not the verdict.
- **Projected for held-out**, PLAN-R10 §3.2, other folds only: +4 ACCEPT and +3 WRONG over 8 repos, so about +0.5 ACCEPT and +0.4 WRONG cards per repo.
- **Precision of what it adds.** 14 of 22 cards are ACCEPT (63.6%), and 9 of the 12 shown by default.
  - D4's population (everything `census --all` lists) gains 22 cards at 63.6% not-wrong. **Open:** the build-set D4 is not recomputed here. It is done once, on the integrated F12 candidate, in round 12.
  - Nothing reaches agents: every new card is a suggestion of a family not admitted for agents.

## Labelling log

### Deviation run 1 (A/B; set aside, not used for any verdict) [STRICT]

1. **Rendering.** The first `label.py` rendered the prompts. They did not render text the way `prompt.mjs` does:
   - the rubric kept its 9 study-only "Moves labels" notes, which `lib.mjs rubricText` strips;
   - each card kept its `agents:` line, which `labellerCard` strips. For a suggestion that line states its family's labelled accept rate, "N% of M".
2. **Records.** A and B were collected and validated with `checkLabel`, rubric v3, example and outlier files: 22 of 22 valid each.
   - **Counts from the files:** A 13 ACCEPT / 9 WRONG; B 13 ACCEPT / 9 WRONG.
   - **The B labellers' own replies add up to 12 / 10.** The difference is the fold-3 repo's prompt. Its file holds 13 records with 13 distinct keys, 8 ACCEPT and 5 WRONG; its reply said 7 / 6.
   - The file is the record (collection reads only the file). The mismatch is logged, not resolved.
3. **Agreement.** 18 of 22 (po 0.818), κ = 0.624. All 4 disagreements are in the fold-3 repo. The merged fold-2 card is ACCEPT/ACCEPT.
4. **C was not launched.** Its prompts were withdrawn unread (`deviation-run-1/index-C.not-launched.json`).
5. **Lead-reported deviations, fold-3 B prompt.**
   - The labeller re-read the harness's saved copy of its prompt. The lead checked it is byte-identical.
   - It did not always `cd` into its working directory. Checked: the directory is empty, the outbox holds only `out.jsonl`, the checkout is clean, and no file written since A's collection carries a label key.
6. **The lead's decision: relabel.**

### Run 2 (A2, B2, C2): the run of record

- `label.py` now renders both the rubric and the cards the way `prompt.mjs` does. The lead checked the A2 prompts: 0 `agents:` lines, 0 "Moves labels", 0 "N% of M" rates, every working directory empty.
- **Keys and launch order.** The keys and rows are the same as run 1. B2 launches after A2 is collected, and C2 runs on the A2/B2 disagreements.
