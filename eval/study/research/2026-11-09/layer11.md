# layer11: layering target depth and target-module exceptions (round 11, F12 candidate)

**Verdict: neither mechanism is admitted** under the five-fold rule (PLAN-R11 §5). Both are
kept as [`layer11/layer11-m1-m2.patch`](layer11/layer11-m1-m2.patch) (applies to main
`226389b6`). The branch ships only the layering advice text (pilot G4), which has no mining
effect. F12 candidate.

Section 0 was committed and pushed (076736e8, amended once in 49b90082, both before any
figure) before any build-set figure was computed.

## 0. Declaration (before any figure)

**Inputs used to design the mechanisms.**
- The three hypotheses of a private pilot on an app monorepo, as the lead relayed them (no repo
  content), and the de-identified fixture note on `ws/gc-pilot` (25d67d9c, G3 and G4).
- The product code at F11 (`crates/drift-mine/src/mine.rs` `area`, `signals`, `avoid_drafts`).
- PLAN-R11 §2, §4, §5 and PLAN-R10 §3.2.
- Synthetic fixtures with invented names, written for this record.
- Fold 5 (dev3): its committed F10 census JSON, opened to learn the JSON shape; I read one
  layering card there in full. **[STRICT] Fold 5 is a design fold** (PLAN-R11 §5, and I read
  a dev3 card).
- No card, label or census file of folds 1-4 was opened before this declaration. The
  prevalence script below prints aggregates per fold only.

**Design folds: 5.** Other folds: 1, 2, 3, 4.

**Mechanisms (at most two), fixed now, with every parameter:**

- **M1, target depth by stability (TS/JS only).** A TS/JS file's value import of a module in
  area `p/x` (two segments, as `area` makes them) also carries the signal `import:p`, meaning
  "imports from `p/**`", unless the file itself is in `p/**`. So `import:p` means the whole
  subtree for TS/JS files (as its summary already says), not only files directly in `p/`.
  Drafts for `import:p` go through every existing test (role scope, upward edge, Wilson bound
  >= 0.9, contrast, cap). The upward test for a one-segment target compares files in `p/**`
  importing the role's area against the role's area's files importing `p/**`. When a role has
  a passing draft for `import:p`, its drafts for `import:p/<x>` are dropped: the rule is
  widened to the shallowest area where it still holds by the Wilson bound. Python is
  unchanged.
- **M2, a single target-module exception (TS/JS only).** After a layering draft passes every
  existing test, take the exact modules its outliers import that carry the signal. If one
  module M is imported by at least 3 outliers and by at least 75% of them (a strict maximum:
  on a tie, no exception), the rule becomes "do not import from `T/**` except M". An outlier
  whose only signal-carrying imports are of M then holds the rule, and the evidence is
  recomputed. `check` applies the exception: an import of exactly M is not a violation.
  [STRICT] No rescue: a draft must pass the bound without the exception. [STRICT] If M is
  the only file of `T/**` in the repository, no exception is made (the rule would be empty).
  *(Amended before any figure was computed, in the commit after the declaration: the first
  text said "the only module of `T/**` that the role's members import", which would refuse
  the facade case itself, where the role reaches the area only through M.)*
  The exception is part of the rule, so a card that gains one gets a new id.
- **Parameters**, reused from the code: 0.75 is `MIN_LOWER_BOUND`, 3 is
  `REFINEMENT_MIN_OUTLIERS`; no parameter is tuned after any figure is read [STRICT].

**Also on the branch, with no mining effect.** The layering advice text (pilot G4): name the
offending import and its line, drop "like <holder>" and "copy <holder>" for an avoid rule, and
keep the exception clause out of agent lines (it stays in `drift_explain`).

**Measurement plan.** H1 and H2 prevalence per fold from F11 `census --json` plus
`debug imports` on all 54 build clones (aggregates only). H3 (type-only imports) is recorded,
not a mechanism. Fold rule: `generalise.mjs --design-folds 5` with every new or changed card
labelled blind (rubric v3, A and B, C on disagreement) through opaque-key rows files by a
separate labeller, before the verdict is read.

## 1. Prevalence on the build folds (F11 binary, aggregates)

`census --json --all --max 200` and `debug imports` on the 28 TS/JS build repos (folds 1-4 and
the 12 dev3 TS repos of fold 5); `prevalence.py`, output in `layer11/prevalence.txt`. Shown =
`census --json --max 15`. Python is out of scope (both mechanisms are TS/JS only, and Python
proposals are off by default).

| Fold | TS repos | Layering cards (shown) | H1: target widenable in principle (shown) | H1: widened by M1 | H1: sibling outliers found by widening | H1: one role, >= 2 narrow cards under one parent | H2: one module carries >= 3 and >= 75% of outliers (shown) | H2 loose: > 50%, >= 2 (shown) | H3: cards with type-only importers in scope (files) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 4 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) |
| 2 | 4 | 4 (4) | 0 | 0 | 0 | 1 role, 4 cards | 1 (1) | 1 (1) | 2 (17) |
| 3 | 4 | 1 (1) | 1 (1) | 0 | 0 | 0 | 0 | 0 | 0 |
| 4 | 4 | 8 (5) | 2 (1) | 1 | 0 | 2 roles, 4 cards | 0 | 2 (2) | 2 (3) |
| 5 | 12 | 4 (4) | 2 (2) | 2 | 0 | 0 | 0 | 1 (1) | 0 |
| **all** | 28 | **17 (14)** | **5 (4)** | **3** | **0** | 3 roles, 8 cards | **1 (1)** | 4 (4) | 4 (20) |

- **H1 (target too narrow) is rare and, where it occurs, costs nothing on the build set.**
  - "Widenable in principle" means a two-segment target `p/x` whose parent `p` does not contain the role's own scope. 5 of 17 cards qualify.
  - M1 widened 3 of them (one in fold 4, two in fold 5), with the same holders and outliers each time: **widening found no sibling that breaks the broader rule.**
  - Every "split" (one role with several narrow cards under one parent) is a sibling-package layout (`packages/lib` against `packages/<x>`). There the parent contains the role, so a wider rule would be one that the role's own files break. M1 leaves them alone by design.
  - One further card (fold 5) came from the subtree meaning of a one-segment target. At F11, `import:p` matches only the files directly in `p/`, although its summary says `p/**`.
- **H2 (no exceptions) occurs once in strict form** (fold 2): 3 of a card's 4 outliers import one module of the avoided package. The looser shape (a plurality over half) occurs on 4 cards. Only the fold-5 one of those 4 is labelled WRONG legit_outliers, and its outliers share no single module (two outliers, two modules).
- **H3 (type-only imports).** Layering ignores `type_only` imports (`signals`, `avoid_drafts`). On 4 cards (2 shown, folds 2 and 4), 20 files in the role's scope import the avoided area for types only, and these would be outliers if types counted. This is an approximation: role membership is taken by scope prefix. All 4 cards are ACCEPT as they stand. The rule ignoring types is not a measured error on the build set; it is recorded here, not changed.

## 2. Mechanisms built (patch), and their census effect

Release builds: F11 = `/home/user/drift-bin/f11/drift` (before) and `build-verified.sh` at
CGU 91 on `fc579c26` (tag `cgu91-fc579c26-1794191803`), run with the study switch
`DRIFT_STUDY_LAYER11` = both / `m1` / `m2`. All 54 build clones were run, one at a time, with
`census --json --max 15 --python-proposals`.

- **Behaviour probe.** The pilot's fixture G3 (`ws/gc-pilot` 25d67d9c) gives one new violation
  for the seventh importer of the shared hook at F11, gate on or off. On the patch it gives
  none: the card is "...do not import from `app/**` except from `app/board/board-context.ts`".
- **Switch check.** With `DRIFT_STUDY_LAYER11=none`, the patch binary's census JSON equals F11's on all 54 clones (`commit` aside).
- **Python:** no card changed. **TS:** 9 changed ids (`census-diff-both.txt`). M1 changed 7 of
  them (`census-diff-m1.txt`) and M2 changed 2 (`census-diff-m2.txt`). Tiers are F11's
  (`default` = the candidate tier).

| Id | Fold | Tier | Label (relabel5 / dev3; new ids: this record) | Mechanism | Change |
|---|---|---|---|---|---|
| cal.com D-2f232d -> D-5d6ff0 | 4 | default | ACCEPT -> **ACCEPT** (A, B agree) | M1 | `packages/lib` avoids `apps/web/**` -> `apps/**`, 235/236 both |
| documenso D-7b5140 -> D-ea1182 | 2 | default | ACCEPT -> **ACCEPT** (A, B agree) | M2 | avoids `packages/auth/**`, 637/641 -> "except from `packages/auth/client/index.ts`", 640/641 |
| T02 D-c983c0 -> D-163bf8 | 5 | default | WRONG mixed_group -> **WRONG mixed_group** (agree) | M1 | `packaging/buddy/**` -> `packaging/**`, 1720/1721 both |
| T18 D-41177a -> D-911706 | 5 | default | WRONG legit_outliers -> **WRONG legit_outliers** (agree) | M1 | `apps/admin/**` -> `apps/**`, 124/126 both |
| T18 D-44e866 (new) | 5 | default | **WRONG mixed_group** (A WRONG, B ACCEPT, C WRONG) | M1 | `apps/admin` avoids `scripts/**`: a one-segment target, now a subtree |

**Blind labels.** The 5 new ids were labelled under rubric v3 through opaque-key rows (`K-...`,
`keymap.json`). Prompts were rendered from `REVIEWER-PROMPT.md` and `ADJUDICATOR-PROMPT.md`,
with proposals shuffled per labeller. The labellers were separate agents launched by the lead:
A on the default model, B on another model, then C on the one disagreement. Each had its own
empty working directory and outbox, and B ran only after A's outputs were collected
(`collect.py` checks keys and clean directories). Final rows: `labels-final.jsonl`. Every
relabel agrees with the label of the card it replaces: the mechanisms changed the wording, not
the verdict.

## 3. Fold verdict (`generalise.mjs --design-folds 5 --after-labels labels-final.jsonl`)

[STRICT] Fold 5 is the design fold, and folds 1-4 are other folds (section 0).

| | M1 (widen) | M2 (except module) | Both |
|---|---|---|---|
| a. Helps >= 3 repos across >= 2 folds | 3 repos, 2 folds: yes | 1 repo, 1 fold: **NO** | 4 repos, 3 folds: yes |
| b. No ACCEPT lost outside the design folds | **NO**: cal.com D-2f232d | **NO**: documenso D-7b5140 | **NO**: both |
| c. Other-fold effect positive | 93.5% (43/46) -> 93.5%, +0.0: **NO** | +0.0: **NO** | +0.0: **NO** |
| d. Fold-5 effect not negative | 58.3% (7/12) -> 53.8% (7/13): **NO** | 58.3% -> 58.3%: yes | 58.3% -> 53.8%: **NO** |
| **Admitted** | **no** | **no** | **no** |
| Default tier, folds 1-4 (accept; flag precision) | 30/30 -> 30/30; 88.8% -> 88.4% (1 untraced) | 30/30 -> 30/30; 88.8% -> 88.5% (1 untraced) | 30/30; 88.8% -> 88.4% |
| Default tier, fold 5 | 1/5 -> 1/6; 31.3% -> 50.0% (3 untraced) | 1/5 -> 1/5 | 1/5 -> 1/6 |

- **What decided it.**
  - (b) is lost by construction. A mechanism that rewrites an ACCEPT card's rule gives it a new id, and generalise counts the old id as an ACCEPT lost [STRICT], even when the new id is relabelled ACCEPT, as both were here.
  - (c) cannot move: folds 1-4 are 30/30 on the default tier.
  - (d) fails for M1. Fold 5 gained a WRONG card (T18 D-44e866) from the subtree meaning of `import:scripts`.
- **What M2 did to flags.** On documenso, the three excepted outliers were labelled "worth a second look". The flag precision of fold 2 falls 89.4% -> 88.4% because 8 of the 10 A/B outlier verdicts removed were mistake/look. On the build set's one strict H2 case, the shared module is a package-cycle import that the labellers wanted flagged, not a sanctioned facade. The card stayed ACCEPT either way.
- **Undo-named and dev-v3 readings:** unchanged (40.9% / 75.0% default), as generalise prints. This is a census change, so there is no dev-v3 policy reading.

## 4. What ships on the branch: layering advice (pilot G4)

No mining or census change. It is a wording change in what agents and people read for an
`avoids:import` violation:
- **The offending import is named.** `check` records it (`Violation.import`: `module`, and,
  once the CLI has read the file, `specifier` and `line`). The violation then points at that
  line instead of `:1`.
  - In `check` text and agent text: `at <file>:<line> imports '<specifier>'`. When the file
    cannot be read, the line reads `imports <module>`.
  - `locate_imports` reads the file once per violation file, best effort.
  - The facts have no import lines, so there is no facts or schema change.
- **No model to copy for an avoid rule.** For `avoids:import` the "like <holder>" line, and the
  "; copy <holder>" in the PreToolUse, MCP and project rule lines, are left out.
- **The layering clause** ("(declared dependencies, and lazy loads ... excepted)") is left out
  of agent one-liners (`agent_summary`). It stays in the convention summary, in census and in
  `drift_explain`.
- **Census JSON is unchanged.**
  - The summary strings are identical: `signal_label` uses the same text through
    `LAYERING_CLAUSE`.
  - `signals` is refactored through `layer_signals`, with the same filters in the same order.
  - `check --format json` gains an optional `import` object per layering violation.
  - The unit test `crates/drift-mine/tests/layer11.rs` covers the advice text and the
    specifier lookup.
  - Studio pair: the `Violation.import` contract and a note in the Check detail pane.

## 5. Not done
- **No release census of the G4 build.** Per the lead, the census JSON is unchanged by
  construction (section 4), and the unit test shows the text change.
- **The `allowed_targets` review answer** (a reviewer allows a target module, applied by
  `check`), from the pilot, is not built. The patch's `except` field on `Avoids` is the storage
  such an answer would use, and its `check` path is tested there. It is a per-repo decision a
  person makes, so it needs no fold rule. It would need a review-answer CLI and a Studio
  control.
- **The neighbour gate's signature** still drops the exact avoided module (pilot input 1). With
  an exception or allowed target, the gate is not needed for that case. Unchanged here.
- **No "what holders import instead" hint** (G4's second half): the facts do not tie a holder's
  import to the avoided module's role.
- **The M2 empty-rule guard** (M is the only file of the area) has no test. Under the upward-edge
  test it is reachable only through a declared-area edge. Its five other branches, and M1's
  dedupe and subtree upward test, were each mutation-checked: disabled, a test failed, restored
  (`layer11-m1-m2.patch` tests, 10/10 passing restored).
- **Any re-attempt** has seen the census effects on every fold. [STRICT] Only dev4 is unseen.
