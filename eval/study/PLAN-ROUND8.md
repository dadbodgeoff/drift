# Round 8 plan: suggestion-tier precision (TypeScript and Python)

> **Superseded (2026-11-07):** the research round tested this plan; the revised plan and decisions D10 are in [`PLAN-PAR.md`](PLAN-PAR.md). This file stays as the record of what was tested.

Status: active, 2026-11-07. Round 8 (and the rounds after it until the goal below is met) is fully focused on suggestion
precision; other product work waits. The held-out run uses its own binary built from the frozen product (`29f4cd6`), so
round-8 branches cannot affect it; no round-8 agent reads held-out data.

## Why

The default (blocking) tier is the narrow part of Drift: TS call wrappers and import layering, in-repo targets, roles of
15 or more members. On the dev set it reads 30/30 accepted (relabel4, in-sample). Everything else Drift shows is the
suggestion tier, and it is about half right:

| Dev set, relabel4 (`eval/study/runs/dev-v3-relabel4-2026-11-07`, main `2c81ba4`) | Shown | Accepted | Not wrong |
|---|---|---|---|
| TypeScript/JavaScript suggestions | 117 | 53.0% (62) | 55.6% |
| Python proposals (py + py2, advise-only) | 63 | 49.2% (31) | 50.8% |

These are dev, in-sample figures. Suggestions only advise, but agents and users read every one, so a coin-flip
suggestion tier costs trust in the whole product.

## Findings: why suggestions are wrong

From the labellers' `wrong_because` on every WRONG card in relabel4 (TS suggestion tier, 52 cards; Python, 31 cards):

| Cause | TS | Python | What it is |
|---|---|---|---|
| `legit_outliers` | 25 (48%) | 10 (32%) | The pattern is real, but the members Drift flags differ on purpose: public endpoints without an auth decorator or permission, helpers living beside handlers, documented exceptions. Drift sees shape, not intent. |
| `mixed_group` | 20 (38%) | 16 (52%) | The role mixes members of different kinds, so "most of them do X" is not a convention. TS: 12 of 20 are naming rules (components, hooks, utils, constants in one directory). Python: `views.py` / `serializers.py` / `api/` mix ViewSets, mixins, helpers and permission classes. |
| `incidental` | 6 | 3 | A real but unintended correlation: call order, rendered components. |
| other (`misdescribes`, `false_outliers`) | 1 | 2 | Small. |

By family (accepted / shown, dev): TS naming 20/34, decorators 7/16, base classes 10/15, argument keys 6/12, rendered
components 4/10, call order 1/5, package facts 7/13. Python naming 6/15, calls 4/9, base classes 3/9, wrapper calls
6/8, decorators 3/6, control 4/4.

The default tier avoids both main causes by construction: for a wrapper call or an import boundary, a member that skips
the convention is nearly always a mistake, and roles of 15+ handlers in one route tree are coherent.

## Workstreams

Each workstream is one PR (or a short series), built and gated as every round-6 PR was: `gates.sh` with a private
verified binary, census before/after on all 34 dev clones with every changed id listed with tier and label, synthetic
fixture tests, a mutation check per new branch, a Studio pair or "not needed" SYNC.md row. No workstream may be tuned
against held-out data (see "Held-out discipline").

### W1. Split roles by member kind before mining (targets `mixed_group`)

- **TS:** a role's members are split by symbol kind before any rule is mined over them: React component (PascalCase,
  returns JSX), hook (`use*`, calls hooks), function, class, constant (non-function value), type-only. Naming rules
  are mined per kind; a naming rule never spans kinds.
- **Python:** classes are split by their framework lineage, resolved through in-repo bases: Django View / DRF
  ViewSet / APIView, Serializer, Model, Form, Admin, Mixin (class name or base ends in `Mixin`), exception, plain
  class. Functions stay their own kind. Base-class, naming and call rules are mined per kind.
- Frozen selectors: the kind becomes part of the role key, so ids change for split roles. Bump `selector_version`;
  existing `drift.lock` files keep v1 membership for `check` and exemptions (as #84 did).
- **Target:** most of the 36 `mixed_group` WRONGs (20 TS, 16 Python).
- **Risk:** smaller roles fall below `min_role_size` and some ACCEPT cards disappear. List every lost ACCEPT in the PR.

### W2. Explain outliers instead of flagging them (targets `legit_outliers`)

- After mining a rule, look for a marker shared by its outliers and absent from the holders: a path segment
  (`public/`, `webhooks/`, `internal/`), a name token (`Public*`, `*Webhook*`, `Health*`), an export or decorator
  (`AllowAny`, `permission_classes = []`, `csrf_exempt`, `@Public()`), or a documented-exception comment. When one
  marker covers all outliers (or all but one) and none of the holders, the outliers become an exempt sub-group with
  a stated reason (new exemption code, Studio pair), not violations.
- This generalises the companion exemption (#83). It never adds outliers and never touches the default tier's
  holders, so it can only reduce what is flagged.
- **Target:** most of the 35 `legit_outliers` WRONGs (25 TS, 10 Python), including the public auth-exempt endpoints.
- **[STRICT] guard:** a marker must be at least as specific as a path segment or a whole name token; a single shared
  letter or a file extension never counts. The default tier's 30 ACCEPT cards must be unchanged or still ACCEPT.

### W3. Demote incidental families (targets `incidental`)

- Hide TS call order (1/5) and rendered components (4/10) by default, behind a flag, as #97 and #99 did for other
  families, unless W1 or W2 moves them. Decide on the post-W1/W2 numbers, not the current ones.
- Hide Python naming rules unless the role is a single kind after W1.

### W4. Show fewer, better suggestions to the human

- Rank the suggestions `drift init`/`review` show by each family's measured track record (`family-precision.json`) and
  cap them per repo (proposal: 5 by default, all in `census`). W0 decides what agents see; W4 orders what humans review.

### W5. Python wrapper calls toward blocking (later)

- Python wrapper calls read 6/8 on dev. Too few to decide. Collect more cards in the next relabel; consider a D9
  admission only with at least 20 labelled cards, pre-registered before measurement.

## Sequencing and parallelism

1. Held-out run completes and is published. Decide the release mode from it (block by default only if the default tier
   meets the 95% gate).
2. W0 first (small, product-facing). W1 (TS kinds), W1 (Python lineage) and W2 in parallel (separate agents; W1 owns
   role keys and `selector_version`, W2 owns post-mining exemptions; W2 merges main before merge). W4 in parallel.
3. Relabel5 on the merged result (all changed cards, blind A/B/C, the #92 protocol). Measure per family.
4. W3 decisions on relabel5 numbers; W5 data collection rides relabel5.
5. Docs, Studio and README numbers updated from relabel5.

## Goal: suggestions at par

"Par" means a suggestion is as safe to act on as a default-tier rule: an agent that follows every suggestion it is shown
should almost never be led to change code that was right. Staged targets (dev, in-sample, then confirmed on a fresh
held-out set):

| Stage | TS suggestions accepted | Python accepted | When |
|---|---|---|---|
| Round 8 | ≥ 65% (from 53.0%) | ≥ 60% (from 49.2%) | after relabel5 |
| Round 9 | ≥ 80% | ≥ 75% | after relabel6 |
| Par | ≥ 90% shown to agents, every shown family ≥ 85% with n ≥ 10 | same | then a fresh held-out set |

The default tier stays unchanged throughout: every current ACCEPT card stays ACCEPT or is listed with a reason.

### W0. Family admission for suggestions (product, ships first)

Until a family is at par, agents should not be told to act on it. Like the default tier's admission (D7, TIER-ADMISSION.md),
a suggestion family is *admitted to agents* only when its measured accept rate on the latest labelled run is ≥ 85% with
n ≥ 10 cards. Non-admitted families stay visible to the human in `drift review`, `census` and Studio, but hooks, MCP
`drift_rules_for` and `check` do not surface them to agents. The admission table is data (a committed JSON with the
run it came from), regenerated after every relabel. This makes the agent-facing product at par immediately, at the
cost of recall, and turns every W1–W3 gain into more admitted families.

## Held-out discipline

- The held-out primaries are used once, for the frozen product. No workstream here reads held-out repos, cards, labels
  or rationales, and no fix is tuned on them.
- A later held-out measurement of round 8 needs a fresh held-out set (select-holdout.mjs, new pre-registration).

## Out of scope

- Default-tier rule kinds and thresholds (D7) are not changed in this round.
- Recall: this round only removes wrong suggestions; it does not try to find more conventions.
