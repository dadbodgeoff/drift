# Neighbour gate, member level (round 11, WS-J)

A warning `drift check` would give a member that breaks a convention is held back when the member is structurally
nearer the members the convention sets apart (Drift's exemptions, a reviewer's exceptions) than the members that hold
it. It is deterministic, uses no model and learns nothing: a fixed distance and the rule "strictly nearer". The mechanism
comes from an outside review. Code: `crates/drift-mine/src/neighbour.rs` (signature, distance, decision, guard, study
dump) and `crates/drift-mine/src/check.rs` (`neighbour_gate`). The reading is `eval/study/neighbour.mjs` (tested by
`neighbour.test.mjs`).

**Status: NOT ADMITTED. The gate is off by default; `DRIFT_NEIGHBOUR_GATE=on` turns it on for `check`, the hooks,
MCP and PR mode.**

**History of the decision.**
1. **Author.** Not admitted under a stricter extra check: on the cards the product shows now it helps one repo.
2. **Lead.** Admitted under the pre-declared member-level rule: on every labelled card it helps 12 repos across
   5 folds and holds back 0 of 118 MISTAKE and 0 of 433 KEEP outliers.
3. **Lead, after the default-on gate run: admission withdrawn [STRICT].** With the gate on, 4 existing tests failed.
   Each plants a genuine new violation that the gate held back (the failure mode below). The gate stays off until
   dev4 measures it. The dev4 history-replay arm runs `check` twice: off is the product, on is the gate.

## Known failure mode: a new violator next to a member Drift exempts by itself

A new violator that sits next to a member Drift exempts by itself (not a reviewer's exception) is nearer that member
than the holders, so the gate holds a real violation back. The default-on gate run found four cases, each pinned
by a `known_limitation_*` test that runs with the gate on:

| Exemption | Planted violation held back | Test |
|---|---|---|
| base-class exemption (a field named for its base) | a plain class in the same file | `hooks.rs` `known_limitation_gate_holds_back_a_violator_next_to_a_base_class_exemption` |
| documented exception (`"Not a ChoiceSet"`) | two classes in the same file | `registry_docs.rs` `known_limitation_gate_holds_back_a_violator_next_to_a_documented_exception` |
| shared parts (rendered by many templates) | a part rendered by one template only | `hooks.rs` `known_limitation_gate_holds_back_a_violator_next_to_shared_parts` |
| framework root file (the app's root page) | a new nested page without the wrapper | `hooks.rs` `known_limitation_gate_holds_back_a_violator_next_to_a_framework_root_file` |

**The labelled-outlier evaluation below did not cover this case.** Its outliers are the code as mined, and its
leave-one-out sets apart only the other labelled outliers and Drift's exemptions of that code. It never places new
code next to an exempt member. Its 0 of 433 says nothing about this failure mode. **Any future admission must
include that case**, measured, not assumed.

## Design folds (declared before any figure)

**Fold 5 only.** The declaration was committed (`neighbour.mjs`'s default, commit 459f8d97) before the reading first
ran. Fold 5 (dev3) is always a design fold (PLAN-R11 §5). Before the declaration, while reading label file formats, I
saw a few card reasons from fold 4 (dub) and fold 3 (twenty). The mechanism was fixed before that and none of it came
from them. Declaring those folds as design folds would have loosened condition (b), so they stay "other" folds
[STRICT].

## The mechanism

- **Signature** of a member, from facts Drift already computes. The rule's own verdict is never encoded.
  - The resolved modules its file imports, without the modules the rule names (the wrapper's, the callee's, the layer
    it avoids). Otherwise every outlier would look like every other outlier because none imports the wrapper.
  - Its export position: default, named or a whole file, plus its entry kind and its symbol kind.
  - Its consumers: the files importing it by one of its exported names or `*`.
  - Its role selectors, one per depth.
- **Distance**: the mean of the four Jaccard distances. A part both sides leave empty counts 0.
- **Decision**: held back only when the nearest set-apart member is strictly nearer than the nearest holder.
  - A tie warns.
  - So does a convention that sets nobody apart.
- **Never held back** [STRICT, stricter than "an entry point under an auth or validation rule"]:
  - any member that no exemption may leave out (`Rule::exemption_allowed`): an entry point, a handler a route refers to,
    and every member under a guard rule or a call to a guard;
  - any member under an input validation rule.
- **Never dropped** [STRICT].
  - A held-back violation stays in `violations` with `suppressed_neighbour: true`.
  - It is listed in the report's `suppressed_neighbour[]` with its nearest set-apart member (and how that member is
    set apart) and its nearest holder, both with distances.
  - `check` text counts and lists them.
  - It is never new and never fails a check.
- **Where it runs**: only over accepted conventions, so never when `init` builds the lock.
  - A check of some files (hooks, `check <files>`) also reads the holders and exemptions of the rest of the repo, for
    the conventions that have a warning to gate.
  - PR mode keeps the holds of the violations its diff filter keeps.

## The evaluation

- **Population.**
  - Every labelled card of the in-sample snapshot (relabel5, folds 1–4) and of dev3 (fold 5) that the census at this
    binary still mines: 238 cards, all 34 build repos and 20 dev3 repos.
  - This includes the cards the show policy now hides (the study mines before the show policy, `mine_unshown`).
  - Every card is marked `shown` when the product shows it.
- **Labels.**
  - Labellers A's and B's per-outlier verdicts on the v3 records each final label rests on, followed through carried
    rows.
  - Each verdict is placed on a member through the block the labellers read (in order), or by its symbol and path hint
    among the card's outliers.
  - 765 labelled outliers were placed. 208 verdicts could not be placed (group verdicts such as `X.* (6 fields)`, and
    ambiguous symbols), and 66 placed members are no longer outliers of the card now. All of these are left out and
    counted [STRICT].
- **Ground truth** [STRICT]:
  - **KEEP**: either labeller says mistake or look (**MISTAKE**: either says mistake);
  - **LEGIT**: every verdict is legit or not_violation;
  - **OTHER** (one_off): reported, and left out of precision and recall.
- **Leave-one-out.**
  - Each labelled outlier in turn is the hypothetical new member.
  - Set apart: the card's Drift exemptions, plus every other LEGIT outlier as a reviewer's exception (what a reviewer
    who agreed with the labellers would have marked fine).
  - Holders: the role's members that the rule is about and that hold it.
- **Member level.** Precision = LEGIT held back / all held back. Recall = LEGIT held back / all LEGIT.
- **Fold rule** at member level.
  - (a) It helps ≥ 3 repos across ≥ 2 folds. A repo counts as helped when at least one LEGIT outlier is held back
    there and no KEEP outlier is [STRICT].
  - (b) No MISTAKE outlier is held back outside the design folds.
  - [STRICT] It must pass on every labelled card **and** on the cards the product shows now.

## Results (`neighbour.out.md`, `neighbour.json`)

All labelled cards, with reviewers' exceptions:

| Fold | LEGIT held / LEGIT (recall) | KEEP held / KEEP | precision |
|---|---|---|---|
| 1 | 49/120 (40.8%) | 0/73 | 100% |
| 2 | 6/55 (10.9%) | 0/104 | 100% |
| 3 | 9/55 (16.4%) | 0/87 | 100% |
| 4 | 16/85 (18.8%) | 0/162 | 100% |
| 5 (dev3, design) | 4/7 (57.1%) | 0/7 | 100% |
| **all** | **84/322 (26.1%)** | **0/433 (0 of 118 MISTAKE)** | **100%** |

What the readings show:

- **On every labelled card.** 12 repos helped across all 5 folds, and no MISTAKE held back: **met**.
- **On the cards the product shows now (72).** 4 of 13 LEGIT held back, 0 of 148 KEEP held back, 1 repo helped (fold 5):
  - (a) **not met**;
  - (b) met.

  These cards are mostly default-tier auth wrappers on entry points, which the guard never touches (100 of the 161
  outliers there are guarded).
- **Drift's exemptions alone** (no reviewer's exceptions). 16/322 LEGIT held back, 0 KEEP; 3 repos in 2 folds.

Under the stricter extra check the author's verdict was **not admitted**: the help is on cards the product no longer
shows. The lead admitted the gate under the pre-declared rule, then withdrew the admission for the failure mode above.

**How much the separation rests on ties.** Among the 95 KEEP outliers that the gate could hold back and that have a
set-apart member, the margin (nearest set-apart distance minus nearest holder distance) is never negative. It is
exactly 0, a tie, for 11 of them, and a tie warns. The smallest positive margin is 0.009. The "strictly nearer" rule is
what keeps those 11, so a looser rule (≤, or any threshold below 0) would hold back KEEP outliers. Among the 194
comparable LEGIT outliers, 84 have a negative margin (held back), and 39 are exact ties.

**In sample.** The mechanism has no parameter, so nothing in it was tuned on these labels. But its shape (four parts,
equal weights, nearest neighbour) was chosen before any figure and never revised. These are build-set readings. Only
dev4 would be unseen.

## Census

The branch changes no mining and no census output. The census study dump runs only when `DRIFT_STUDY_NEIGHBOUR` names
a file. `census --json --max 15` on the 54 build clones at this branch was compared with main (`census-compare.json`,
when present).

## Reproduce

- **Binary.** `build-verified.sh 81 <worktree> <bin>` (tag `cgu81-9a5e29aa-1794181332`).
- **Census.** Then, one repo at a time with a private `DRIFT_CACHE_DIR`:

  ```
  DRIFT_STUDY_NEIGHBOUR=<dir>/<repo>.json <bin> --root <clone> census --json --max 15 [--python-proposals]
  ```

  `--python-proposals` is for the Python repos. Dev3 repos are named by key, from `scratchpad/dev-clones/dev3/<key>`.
- **Reading.** `node eval/study/neighbour.mjs --study <dir> --json neighbour.json`.
- **Not committed.** The study files themselves (1.3 MB; fold 5's name dev3 members).
- **Redacted.** In `neighbour.json`, fold 5's held rows are reduced to aggregates.
