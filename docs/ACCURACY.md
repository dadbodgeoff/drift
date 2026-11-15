# How accurate is it?

Short answer: **on repositories Drift was not tuned on, about half of its
default-tier cards and most of its shown TypeScript/JavaScript suggestions
were right, on small samples.** That is why, in this beta, an agent is told only about conventions
a person accepted, nothing blocks unless a person sets it to block, and every
Python proposal is a suggestion.

Every figure on this page is an aggregate already committed in a plan or run
README in this repository. The **Sources** column names the file. Each figure is
marked **in-sample** (measured on repositories the fixes were developed on) or
**out-of-sample** (measured blind, on repositories nobody building the product
had opened). No card from a blind or held-out pool is quoted here.

## At a glance

| What | In-sample (dev / build set) | Out-of-sample (blind and held-out) | Sources |
| --- | --- | --- | --- |
| TypeScript/JavaScript **default tier** (call wrappers and layering): accepted | 100% (30/30), Wilson 88.6–100% | **46.7% (7/15)** pooled over three pools, Wilson 24.8–69.9% | relabel5 README; PLAN-R11 §1.1 |
| TypeScript/JavaScript **suggestions** after the round-10 show policy: accepted | not reported separately | **85.7% (6/7)**, Wilson 48.7–97.4% (one blind pool, 4 repos) | dev3-check.md |
| TypeScript/JavaScript, **everything shown** after the show policy: accepted | 93.5% (43/46) | **58.3% (7/12)**, Wilson 32.0–80.7% | PREREG-F10-dev3-check.md (c); dev3-check.md |
| TypeScript/JavaScript, **everything shown**: not wrong (accept or trivial) | 93.5% | **66.7% (8/12)**, Wilson 39.1–86.2% | PLAN-R11 §2; dev3-check.md |
| **Python**, everything shown after the show policy, round 10: accepted | 100% (12/12) | **50.0% (1/2)**, Wilson 9.5–90.5% | PREREG-F10-dev3-check.md (c); dev3-check.md |
| **Python**, everything shown, at the `F12` freeze (the dev5-py-check): accepted | 83.3% (25/30) | **90.9% (10/11)**, Wilson 62.3–98.4% (one blind dev pool, 30 repos; not held-out) | PREREG-F12-dev5-py-check.md §1; dev5-py/dev5-check.md |
| **Yield**, TypeScript/JavaScript: accepted cards per repo | 2.69 | **0.58** (7 over 12 repos; median 0; 8 repos with none) | PLAN-R11 §2; dev3-check.md |
| **Yield**, Python, round 10: accepted cards per repo | 0.67 | **0.13** (1 over 8 repos) | PLAN-R11 §3; dev3-check.md |
| **Yield**, Python, at the `F12` freeze: accepted cards per repo | 0.50 (25 over 50 repos) | **0.33** (10 over 30 repos; median 0; 20 repos with none) | PREREG-F12-dev5-py-check.md §1; dev5-py/dev5-check.md |
| **Unvetted cards shown to agents** | 0 | 0 | PLAN-R11 §2, option (d); merge #136 |

**The release gate is not met.** A language's default tier may block without a
person's choice only once it measures **≥ 95% accepted on a held-out set**
(decision D1). The out-of-sample figure is 46.7%, and even the top of its
interval (69.9%) is below 90%. Nothing in this beta claims 95%.

## What "accepted" means

- **Who labels.** Each card Drift shows is judged blind by two independent
  labelling agents, A and B, under a written rubric (rubric v3,
  [`eval/study/RUBRIC-v3.md`](../eval/study/RUBRIC-v3.md)). A third, C, decides
  only the cards where they disagree. Labellers see the card as a person would,
  without its tier, rank or earlier labels. **These are not real-maintainer
  decisions.** Drift has no measured accept rate from real maintainers yet; the
  opt-in, local review log (`drift review --set-log on`) exists to collect that
  evidence later.
- **The question** the rubric asks of each card: *would a reviewer on this team
  want an agent told this, and warned when it breaks it?* **ACCEPT** is yes.
  **TRIVIAL** means a tool the repository already runs (the compiler, an enabled
  lint rule, the framework) would catch the violation anyway. **WRONG** is
  everything else. A card nobody labelled counts as WRONG.
- **"Not wrong"** is ACCEPT plus TRIVIAL, over everything shown (decision D4).
- **The outliers decide many labels.** A card is ACCEPT only when more than half
  of the outliers it flags (leaving out one-offs such as the wrapper's own
  definition) are real violations or worth confirming (rules R1 and R2). So a
  card whose rule is right for every holder can still be WRONG because of one
  legitimate outlier. Security rules are the exception: a public endpoint that
  skips an auth wrapper is still worth confirming (rule R3).

## Which figures are in-sample and which are not

| Pool | Role | Product measured | Labels | What it is evidence of |
| --- | --- | --- | --- | --- |
| **Build set** (16 TS/JS and 18 Python dev repos; dev3 since round 11) | dev | each round's main | rounds 3–9 (dev-v3 to relabel5) | **In-sample.** Every precision fix since round 3 was developed and checked on these repositories, card by card. |
| **dev3** (12 TS/JS, 8 Python) | blind dev pool | the round-10 freeze `F10` (`5151e5c`) | blind, once, at `F10` | **Out-of-sample when measured.** Nobody building the product opened it before its report. It has since joined the build set, so later rounds can no longer test against it. |
| **dev5** (30 Python) | blind dev pool | the freeze `F12` (`5bafc43`) | blind, once, at `F12` | **Out-of-sample when measured, and not a held-out set.** It decided one thing, whether mined Python proposals are on by default. It joined the build set with its report. |
| **heldout1** (#111) and **heldout2** (#123) | held-out | `29f4cd6` and the round-9 freeze `de57356` | blind | **Out-of-sample.** Only the aggregate counts the lead supplied to PLAN-R10 and PLAN-R11 are used here. |

The beta's TypeScript/JavaScript card set is the one dev3 measured: the D13
changes changed what agents see and turned Python proposals off (they are back
on since the dev5-py-check, [below](#python-on-by-default-as-suggestions)),
and left the TS census card sets unchanged on the build clones and the dev3
clones (PLAN-R11 §5, workstream B's acceptance; merge #136). heldout1 and
heldout2 measured older products, before the show policy.

## The default tier: perfect in-sample, about half out of sample

The default tier is TypeScript/JavaScript call wrappers and layering (import
avoidance) whose target the repository itself defines, in roles of 15 or more
members (decision D7).

| TS/JS default tier, accepted | Cards | Kind | Source |
| --- | --- | --- | --- |
| Build set, relabel5 | 100% (30/30), Wilson 88.6–100% | in-sample | [relabel5 README](../eval/study/runs/dev-v3-relabel5-2026-11-07/README.md) |
| Build set, the least-tuned labels (dev-v3) | 75.0% (24/32) | in-sample | [PLAN-R11 §1.1](../eval/study/PLAN-R11.md) |
| heldout1 | 5/7 | out-of-sample | PLAN-R11 (lead's aggregate) |
| heldout2 | 1/3 | out-of-sample | PLAN-R11 (lead's aggregate) |
| dev3 | 20.0% (1/5), Wilson 3.6–62.4% | out-of-sample | [dev3-check.md](../eval/study/runs/dev3-ts-2026-11-08/dev3-check.md) |
| **Pooled out of sample** | **46.7% (7/15), Wilson 24.8–69.9%** | out-of-sample | PLAN-R11 §1.1 |

Why the in-sample figure is so much higher (PLAN-R11 §1):

- **Selection.** The 25 points from 75% to 100% are the cards the round 4–9
  fixes were measured on, and the tier itself was chosen from the same labels.
  The 30 in-sample cards come from 8 repositories, 24 of them from 4.
- **The rules are right about the code that follows them.** No out-of-sample
  default-tier WRONG says the convention misdescribes its holders.
- **The flagged outliers are where it fails.** Of the outliers a default-tier
  card flags, about 89% were real violations in sample (relabel5) and 31.3%
  (5/16) on dev3. The wrong cards are mostly scope errors: the role also holds a
  recurring, different kind of member (a config file in a layering role, a
  plain helper in a route file) that the rule should not cover.

**No build-set reading forecasts the default tier to better than about ±40
points** (PLAN-R11 §1.5). The honest statement is: about half right out of
sample, on 15 cards.

## Why you review default-tier cards first

The beta treats every default-tier proposal as a **block candidate** (decision
D13): `drift census`, `drift init`, `drift review` and the Studio list it first,
marked `block candidate: reaches agents once you accept it`, and no agent
surface (hooks, MCP, `drift example`, `drift check` text, the AGENTS.md export)
has it until a person accepts it.

- **It is what agents act on.** Once accepted, a default-tier card is shown to
  agents without any further admission test; suggestions need an admitted
  family, and none is admitted today. Your accept is the only check between a
  card and every agent session in the repository.
- **It is the only kind you can set to block** without `--force`.
- **Out of sample, about half were wrong**, and the wrong ones are easy to spot
  in the outliers: if every outlier is a legitimate, different kind of member
  (a test helper, a config file, a script), reject the card or mark those
  members fine (`drift review --exempt <id> --member <path#symbol> --reason
  "..."`).
- **There are few of them:** about 0.4 per TypeScript/JavaScript repository out
  of sample (PLAN-R11 §2), one review action each.

## Suggestions and the round-10 show policy

Since round 10 (merge #129, PLAN-R10 §4) Drift shows a suggestion at all only
when it has **at most one outlier** and its **rule family is admitted for its
language** by a leave-one-repo-out table (60% accepted on the other dev repos,
at least 5 labelled cards; `crates/drift-mine/data/show-policy.json`). Call
order is hidden in both languages; TypeScript rendered components and calls,
and Python package and repository facts, are hidden too. A hidden card is not
proposed at all, and the default tier is not affected.

| Suggestions, TS/JS | Accepted | Kind | Source |
| --- | --- | --- | --- |
| heldout2, **before** the show policy | 39/97 | out-of-sample | PLAN-R11 (lead's aggregate) |
| dev3, **after** the show policy | 85.7% (6/7), Wilson 48.7–97.4% | out-of-sample | dev3-check.md |

Seven cards in four repositories is a small sample: the interval runs from
about 49% to 97%. Suggestions only advise, and they are **not shown to agents**:
the agent admission table (85% accepted of at least 10 labelled cards,
`crates/drift-mine/data/family-admission.json`) admits no family in either
language. You can show one to agents yourself with `drift review
--show-to-agents <id>`.

## Python: on by default, as suggestions

Mined Python proposals are on unless a person turns them off
(`proposals: {python: off}` in `.drift/config.yaml`; decision D13-py). Every one
is a suggestion: Python has no default tier (decision D7), and no Python family
is admitted to agents.

| Python, everything shown | Accepted | Kind | Source |
| --- | --- | --- | --- |
| Build set, relabel5, after the show policy | 100% (12/12) | in-sample | PREREG-F10-dev3-check.md |
| heldout2, before the show policy | not wrong 57% (20/35) | out-of-sample | PLAN-R10 (lead's aggregate) |
| dev3, after the show policy | 50.0% (1/2) | out-of-sample | dev3-check.md |
| Build set (50 repos) at the `F12` freeze | 83.3% (25/30) | in-sample | PREREG-F12-dev5-py-check.md §1 |
| dev5 (30 blind repos) at the `F12` freeze | 90.9% (10/11), Wilson 62.3–98.4%; not wrong 100.0% (11/11), Wilson 74.1–100.0% | out-of-sample when measured; a blind dev pool, not held-out | dev5-py/dev5-check.md |

Round 11 turned Python proposals off because two blind cards cannot tell 50%
from 90%, and fixed in advance what would turn them back on: a blind pool of
**at least 10 shown Python cards**, at least 70% not wrong and within 10 points
of the in-sample figure (PLAN-R11 §3). The pre-registered dev5-py-check met all
three: 11 cards shown on 30 blind repositories (10 accepted, 1 trivial, none
wrong), not wrong 100.0%, and a per-card accept of 90.9% against 83.3% in
sample. By family: control 6 of 6 accepted, naming 2 of 3 (1 trivial), layering
2 of 2; the wrapper family showed no card.

What the check does not show:

- **It is a small sample.** Eleven cards is one above the minimum of 10, and the
  accept rate's Wilson interval runs from 62% to 98%.
- **The wrapper family has no out-of-sample reading.** It showed no card on the
  30 repositories.
- **It is not a held-out result.** A held-out pass is still needed before any
  Python accuracy claim (PLAN-R11 §3). The check decided only whether Python
  proposals are made by default.

## What yield to expect

On a TypeScript/JavaScript repository Drift has not seen:

- **About 1 card shown per repository**, and **about 0.6 accepted** (dev3: 12
  shown and 7 accepted over 12 repositories; 1 accepted card was default tier
  and 6 were suggestions).
- **Most repositories get nothing.** The median was 0 accepted, and 8 of 12
  repositories had no accepted card; 7 showed no card at all (dev3 README).
- The in-sample yield (2.69 accepted per repository on the build set) is not a
  forecast: it is measured on the cards the fixes were built on.

On a Python repository Drift has not seen (dev5: 11 shown and 10 accepted over
30 repositories): about 0.4 cards shown and 0.3 accepted per repository. The
median was 0, and 20 of 30 repositories had no accepted card.

A convention needs a role of roughly 20 or more similar symbols where one
pattern dominates, so small or uniform repositories often get none.

## What is not claimed

- **No ≥ 95% figure, and no held-out pass** of the default tier (D1) or of
  not-wrong (D4).
- **No Python accuracy claim.** The dev5-py-check is eleven cards on a blind dev
  pool. It decided the default; a held-out pass is still needed.
- **No real-maintainer accept rate.** All labels are from labelling agents under
  rubric v3.
- **No precision for the experimental agent verifier** (`agents.verify`, off by
  default). Its frozen prompt scored 84.3% (43/51) passed-card precision on dev
  cards it was not tuned on, below the 90% bar of decision D10.3 (relabel5
  README), so it gates nothing.
- **No recall figure** for this product: recall was not measured on heldout2 or
  dev3.
- **No forecast for the next blind pool.** Round 11 draws dev4 (36 TS/JS and 24
  Python repositories) and labels it blind at the round-11 freeze. Its figures
  will replace dev3's here once its report is committed.

## Sources

| File | What it holds |
| --- | --- |
| [`eval/study/PLAN-R11.md`](../eval/study/PLAN-R11.md) | §1 the default tier in and out of sample (pooled 7/15), §2 the candidate tier (D13) and yield per repo, §3 Python, §4 dev4 |
| [`eval/study/PLAN-R10.md`](../eval/study/PLAN-R10.md) | heldout2 aggregates; §4 the show policy |
| [`eval/study/runs/dev3-ts-2026-11-08/dev3-check.md`](../eval/study/runs/dev3-ts-2026-11-08/dev3-check.md) | dev3 per-language figures, flag precision, yield, the D12 dev3-check (not met) |
| [`eval/study/runs/dev3-ts-2026-11-08/README.md`](../eval/study/runs/dev3-ts-2026-11-08/README.md), [`dev3-py-2026-11-08/README.md`](../eval/study/runs/dev3-py-2026-11-08/README.md) | dev3 protocol, freeze, labelling and agreement |
| [`eval/study/PREREG-F10-dev3-check.md`](../eval/study/PREREG-F10-dev3-check.md) | the in-sample figures of the show policy at `F10` (TS 43/46, Python 12/12) |
| [`eval/study/PREREG-F12-dev5-py-check.md`](../eval/study/PREREG-F12-dev5-py-check.md) | the dev5-py-check as pre-registered: the three bars (§6), what follows a pass (§8), the Python in-sample figure at `F12` (25/30, §1) |
| [`eval/study/runs/dev5-py/dev5-check.md`](../eval/study/runs/dev5-py/dev5-check.md) | dev5 Python figures, yield, agreement and the dev5-py-check (passed) |
| [`eval/study/runs/dev-v3-relabel5-2026-11-07/README.md`](../eval/study/runs/dev-v3-relabel5-2026-11-07/README.md) | in-sample per-card accept, flag precision and the verifier check, at `de57356` |
| [`eval/study/README.md`](../eval/study/README.md) | the protocol, the targets and decisions D1–D11 |
