# WS-G semantic check: findings (2026-11-08)

**Build-set data. Folds 4 and 5 are design folds; folds 1–3 are the other folds. Not held-out; no verdict.**
Pre-registration: [`sem11-prereg.md`](sem11-prereg.md), committed (`aa223aa6`) before any sample ran. Implementation (reverted): `99631796`. Run record and
harness: [`../../runs/sem11-2026-11-08/`](../../runs/sem11-2026-11-08/README.md). Scores: `score.md` / `score.json`
there, from `sem11-score.mjs` (tested by `eval/study/semantic-score.test.mjs`, with a mutation per admission condition).

## Result in one line
**No decision passes the fold rule.** The flag decision (b) raises flag precision in every fold (other folds 48.5% →
66.5%) but sets apart 3 flags that both labellers call real, outside the design folds, so it fails the pre-registered
[STRICT] "no real flag set apart" condition. The card-level readings for (a) and (c) would also fail, and under the
lead's constraint 2 neither is a gate anyway. The dev4 "semantic-on" arm is measured as an **unadmitted,
pre-registered experiment**.

## Product code: reverted (lead decision on #139)
Nothing was admitted, so the product wiring does not ship, not even off by default (the rule applied to F1/F2 in
#127). A revert commit on `ws/sem11` removes `agents.semantic`, MCP `drift_semantic_card`, `drift review --narrow`,
the cache and decision (`crates/drift-mine/src/semantic.rs` and its tests), the Studio type and the SYNC.md row; the
crates and the Studio are main's again. **The implementation is at `99631796d43056530d1103dfb4d8d72b940bbb8c`**: a
later round restores it from there (`git checkout 99631796 -- crates/drift-mine/src/semantic.rs …`, with its
`mcp.rs`, `main.rs`, `policy.rs` and `verify.rs` changes and both test files). The section below describes it as it
was measured.

What stays, under `eval/study`, with no product code:
- the frozen prompt, byte for byte: `eval/study/semantic/semantic-prompt-v1.txt` (sha256 `95ec1162…`);
- the harness `eval/study/semantic/harness.mjs`: payload from a census's JSON and the checkout, 3 samples on the
  headless CLI, the 2-of-3 per-member decision, the structural invariant and the frozen-model check, writing the
  shapes `sem11-score.mjs` reads; tested by `eval/study/semantic-harness.test.mjs` (with a mutation of every
  protection branch and of the model check);
- the scorer and its test, this record, the pre-registration and the run record.

**End to end with no product code** (`runs/sem11-2026-11-08/harness-e2e-T02/`): the main-equivalent binary (no
semantic code; `build-verified.sh` CGU 78, tag `cgu78-dd72865b-1794179426`) ran `scan --out` on the dev3 clone T02;
the harness took `T02/D-c983c0` from the committed dev3 re-census (`runs/dev3-recensus-2026-11-08/census-json/T02.json`),
ran 3 samples (all parsed at the first attempt, all unanimous) and decided: its one outlier, the packaging config,
is `other` and `legit` and is set apart; the card reading fails. (Fold 5 is a design fold; the card was chosen because
PLAN-R11 already quotes it.)

**Harness v1 against the payload measured here.** The census JSON lists neither holders nor exempt members, so the
harness payload has M1 = the example and no two extra holders, and no exempt lines; and its protection is stricter
(every member of a file with entry points, under any rule; every member of an entry role; any file not in the facts).
The figures below are the product payload's at `99631796`. dev4 measures harness v1, which the operator pre-registers
by this file's path and the sha256 of `harness.mjs` at F11.

## What was built (product, at 99631796, now reverted)
- `crates/drift-mine/src/semantic.rs`; prompt `crates/drift-mine/data/semantic-prompt-v1.txt` (now `eval/study/semantic/semantic-prompt-v1.txt`), version `sem-v1`,
  sha256 `95ec1162366afdd669cf56739418f7cd34c0bb2130093c938e40ee0c62991752`. Written from rubric v3 (Q1–Q3, R1, R2, R3,
  R6, R8) and general principles; it quotes no card.
- **S1 (kind)**: one verdict per excerpted member, `same` or `other`. **S2 (flags)**: one verdict per excerpted
  outlier in rubric v3's vocabulary, `mistake` / `look` / `legit` / `not_violation` / `one_off`. One prompt answers
  both; 3 samples; per member the 2-of-3 majority (lead constraint 1).
- **Narrowing only** (lead constraint 2). A flag is set apart when a majority calls it `other`, or gives it `legit`,
  `not_violation` or `one_off`. The verdict alone changes nothing: `drift review --narrow <id>` (hidden flag, a
  person's command) writes the set-apart members as reviewer exceptions (`semantic check sem-v1: …`), which `check`
  applies like any exception (a path list, deterministic; the model never runs at check time). It never changes a
  rule's text, never shows, hides or gates a card, and a candidate still needs a person's accept.
- **Hard invariant [STRICT]** (lead constraint 3), structural, outside the model (`semantic::protected`): a member is
  never set apart when it is an entry point of the facts, an entry class, a file unit of a file with entry points, or,
  under a rule on a guard, any member of a file with entry points. This is stricter than "under an auth or validation
  rule": it holds under every rule. Tests: `crates/drift-mine/tests/semantic_protected.rs` and
  `crates/drift-cli/tests/semantic.rs`, each mutation-checked (disabling `protected`, or its use in `decide`, fails
  them). On the build set, 360 of the 837 judged flags were protected.
- **Determinism** (lead constraint 4). Prompt, version and sha256 frozen (a test checks the sha256 with a SHA-256
  implementation of its own, the workspace having no SHA-2 crate); the model fixed by the sha256 of its identifier
  (`semantic::MODEL_SHA256`; no identifier is written in the repository [STRICT, the brief's rule]); temperature 0
  asked of the host. Replies from any other model are refused, and a cache entry of another prompt or model is
  ignored. Cache `.drift/semantic-cache.json`, keyed by id and a blake3 content hash of prompt, message and the
  members' protection. Fails closed: an unparsable reply records nothing (1 of 237 cards here).
- **Wiring**: `agents.semantic: on|off` (off unless set; never written while off). MCP `drift_semantic_card` (listed
  only while on). `check --format json` `conventions[].semantic` (only while on). Census, init, review and every agent
  surface are unchanged while off; the census does not read the setting, so the census card set and D4 do not change
  (checked on dub and excalidraw: `census --json --all` byte-identical with the setting off and on).
- **Studio**: contract type `SemanticView` only, and a SYNC.md row (both reverted with the product code).

## Offline evaluation
Population: 237 of the 238 labelled cards (relabel5 for folds 1–4, dev3 for fold 5), 236 decided by the product.
Matched labeller verdicts: **941** (A and B pooled, on the first 12 outliers per card that the payload judges; a
verdict matches only a symbol unique on its card).

### Member level (constraint 1)
| | n | exact | κ |
|---|---|---|---|
| S2 majority vs labeller, 5 classes | 933 | 53.9% | 0.37 |
| S2 majority vs labeller, real vs not real | 933 | 80.0% | 0.59 |
| set apart vs labeller not real | 941 | 74.4% | 0.48 |
| A vs B on the same members (ceiling), 5 classes | 425 | 81.6% | 0.71 |
| A vs B, real vs not real | 425 | 92.2% | 0.84 |

- S1 `other` is given to 25.8% of labeller-`legit` flags and 66.7% of `one_off`, against 3.9% of `mistake` and 2.6%
  of `look`.
- The main S2 error is in the safe direction for narrowing: 105 labeller-`legit` flags called `mistake` (kept). Real
  flags called not real: 43 verdicts, of which 3 members both labellers call real were set apart.
- **Flip rate** (3 samples not unanimous, CLI default temperature: an upper bound for temperature 0): members 12.2%
  (186/1529), flags 20.9% (175/837); flags without a 2-of-3 majority 0.6% (5/837).

### (b) which flags are shown: NOT ADMITTED
| Fold | cards | helped | real set apart | flag precision before | after |
|---|---|---|---|---|---|
| 1 | 42 | 17 | 1 | 32.7% (90/275) | 50.3% (86/171) |
| 2 | 30 | 5 | 2 | 59.3% (99/167) | 75.0% (93/124) |
| 3 | 23 | 5 | 0 | 63.9% (106/166) | 79.5% (105/132) |
| 4 (design) | 44 | 13 | 0 | 59.6% (189/317) | 69.0% (185/268) |
| 5 (design) | 7 | 3 | 0 | 50.0% (8/16) | 100% (8/8) |

| By tier and language | cards | real set apart | before | after |
|---|---|---|---|---|
| TS default (candidate) | 12 | 0 | 92.2% (83/90) | 96.5% (83/86) |
| TS suggestion | 75 | 2 | 43.6% (228/523) | 60.3% (217/360) |
| Python suggestion | 59 | 1 | 55.2% (181/328) | 68.9% (177/257) |

Conditions: (1) helps 21 repos over 5 folds: pass; (2) no real flag set apart outside the design folds: **FAIL**
(3: `novu/D-808edd` `EnvironmentWithSubscriber`, `novu/D-6ded6b` `ResourceExecutionFailed`, `paperless-ngx/D-b958b1`
`EmailDocumentDetailSchema`); (3) other-fold flag precision rises, 48.5% (295/608) → 66.5% (284/427): pass; (4) fold 5
not negative: pass. All folds: 97.0% of real verdicts kept (477/492), 74.7% of matched flags kept.

### (a) candidate tier: a reading, not a gate
Accept among TS default-tier cards whose card reading passes: 95.8% (23/24); where it fails: 72.7% (8/11). Folds 1–4
are all ACCEPT (30/30), so the would-be gate can only lose ACCEPTs there: it would withhold 7 and fails the fold rule
(helps FAIL, no ACCEPT lost FAIL, other-fold positive FAIL, fold 5 FAIL: dev3's one passing card is a WRONG). Under
constraint 2 it is not a gate: not admitted by construction.

### (c) suggestion admission beside the verifier: a reading, not wired
On the 95 suggestion cards with a relabel5 verifier outcome that pass it, also requiring the semantic card reading
removes 6 ACCEPTs and no non-ACCEPT (fold 1 16/16 → 15/15, fold 2 29/31 → 26/28, fold 3 20/24 → 18/22, fold 4 19/24 →
19/24). Fails every condition; fold 5 has no verifier outcome [STRICT: no admission]. Not wired (constraint 2).

### D4 and yield
D4 is unchanged by construction (census unchanged, above). Yield: 195 of 837 judged flags set apart over 37 repos
(per repo in `score.json` `yield`); candidate cards whose reading passes: 24 of 35, 23 accepted.

### Cost
712 model calls for 237 cards (3 per card, 1 retry): **19.2 calls per repo** (median 5 cards, at most 15). Per call
about 4,960 input tokens (mostly the cached system prompt and the excerpts) and 670 output tokens; 3.53 M input and
0.48 M output tokens in all, $0.55 at list price, median 6.7 s per call.

## Sensitivity
With the 5 ids that PLAN-R11 and R6 name in prose (folds 2–3) left out, every member-level figure and every (b)
figure is unchanged (none of those cards had a matched verdict); the (a) and (c) readings move by one or two cards and
keep their verdicts.

## Determinism: a precondition for any later admission
The flip rate here is 20.9% of flags (175/837) and 12.2% of members, with no 2-of-3 majority on 0.6% of flags, at the
headless CLI's default temperature: **the CLI used offline has no temperature option, so temperature 0 could not be
set**. Any later admission of a semantic decision needs, as a precondition, before its fold rule is read: a pinned
temperature (0, set and recorded for every sample) and a measured flag flip rate of **at most 5%** across the 3 samples,
on the population it is judged on.

## An observation for the lead (text only; no measure changed)
For decision (a), a candidate card that fails the check is not hidden from anyone: it falls back to a person's
accept, as every candidate does under D13. So "ACCEPT lost" (a passing-fold-rule cost carried over from shown-set
mechanisms) may be the wrong cost for (a): a withheld ACCEPT costs a review action, not a card. The pre-registered
dev4 measure, **candidate accept among the cards the check passes**, is the one that judges (a). On the build set it is
95.8% (23/24), on folds that are in sample for the default tier.

## A measurement gap found after the run (no figure changed)
Labellers name a file-unit outlier (layering cards, `avoids:import`) by its file name (`electron-builder.config.cjs`,
or `(file) electron-builder.config.cjs`), while the payload's member symbol is `(file)`. The pre-registered match is
by symbol, so **file-unit flags were never matched**: the member-level figures above cover symbol outliers only, and
the default-tier layering cards (where dev3's mixed_group WRONGs are) are missing from them. A file-name match would
be a change of measure; it is left for the dev4 operator to pre-register.

## For dev4
The dev4 operator pre-registers a "semantic-on" arm with the frozen sha above; the runbook is in the run record's
README. Measured there: member-level κ against the blind A/B verdicts, flag precision before and after narrowing per
tier and language, real flags set apart, flip rate and cost. It is an unadmitted experiment: a pass there does not ship
anything without a later fold-rule pass.

## Deviations from the pre-registration
- The matched-verdict count is 941, not the "about 1,100" the lead estimated: the payload judges the first 12 outliers
  per card, and a verdict on an unjudged outlier is unmatched, as pre-registered.
- The scorer first read relabel5 tiers from each part's `queue.json`, which predates D7; it was fixed to read
  `views/d7/queue.json` (as `generalise.mjs` does) before any figure here was recorded. Only the (a) and (c) readings
  depend on it.
