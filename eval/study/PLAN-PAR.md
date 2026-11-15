# Plan: suggestions at par (revised after the research round, 2026-11-07)

This replaces the workstream list in `PLAN-ROUND8.md`, which stays as the record of the plan the research tested. Everything below is from **dev data, in-sample** (relabel4 labels, the 34 dev clones), unless marked otherwise. No held-out data was used. The research notes are in `research/2026-11-07/`.

## What the research found

Six research tracks ran before any round-8 code merged: a data audit (R1), an offline ablation with leave-one-repo-out (LORO) scoring (R2), coding agents run with and without Drift (R3), a maintainer-style dogfood (R4), prior art (R5) and an LLM verifier prototype (R6). The four round-8 builds also reported projections first.

1. **The WRONG labels are real.** A/B κ is 0.82 under rubric v3. WRONGs are near-unanimous (TS 52/52, Python 29/31), and an independent audit of 60 cards would flip 1 each way. The uncertainty sits on the ACCEPT side.
2. **Mostly the rules are right; the flags are wrong.** The maintainer dogfood accepted 79% of rules (counting "yes with edits") against 48% under the labels, and agreed with every clear yes and no. All 8 disagreements were "right rule, every flagged member a legitimate exception". Under rubric R1, one legitimate outlier makes a card WRONG however few: cards with ≤1 outlier and ≥95% holders are 19 of 31 Python WRONGs and 7 of 52 TS WRONGs.
3. **Structure alone cannot reach 90%.** No structural policy reached 90% under LORO while showing ≥5 cards. The best was "TS cards with 0 outliers" at 84% (16/19), about 1 card per repo, and fragile. Python has no structural feature that separates ACCEPT from WRONG. Learned scorers and tuned thresholds collapse under LORO (94%→33%, 88%→55%, 100%→38%).
4. **The plan's mechanisms are small.** W1-TS changes 1 card, because TS roles already key on symbol kind (closed). W2's shared markers change 2 cards (mechanism dropped). Only W1-Py moves a rate: 49.2%→56.9% among labelled Python cards, 15 cards still to label.
5. **An LLM verifier is the one lever that reaches 90%** (R6). A short, non-rubric prompt, run 3 times on a small model with a 2-of-3 majority, reached **91% (32/35, Wilson 78–97)** of passed suggestions on a frozen test half, keeping 41% of cards. Cost is about $0.003 and 11 s per card. Limits:
   - Its lower bound is 78%.
   - It is an LLM grading LLM labels.
   - Its 5 false passes were cards both labellers rejected.
   - It hides 19 of 30 accepted default-tier security rules, so it must never touch the default tier.
6. **For agents, suggestions are mostly redundant** (R3, 168 sessions).
   - Of 126 suggestion instances, 85% didn't change the code (agents copy their neighbours), 2 helped and 1 misled.
   - 5 led to a `// drift-ignore` comment, because the message offers no other way out.
   - Overhead is +2–7% cost and +0.7–2.1 turns per run, rising to +33% on one noisy task.
   - **The default tier is what agents need. A shown suggestion has to earn its place.**
7. **The agent-facing text causes some of the harm.**
   - "Fix only these" reads as an order.
   - `drift-ignore` is the only way out a message offers.
   - `drift_explain` gives no reason and no exceptions.
   - "any file" rules attach to unrelated files.
   - Primes and `drift_rules_for` repeat the same rules.
   - Exemption chatter follows "No new violations".
8. **Family admission must use suggestion-tier-only rates.** `family-precision.json` pools tiers. On suggestion-tier rates alone, no family reaches 85% of ≥10 today.

## Decisions (D10, lead, 2026-11-07)

- **D10.1, what agents see.** Agents see the default tier and, from the suggestion tier, only conventions an *admission source* lets through. At first the only source is the family table (W0, suggestion-tier rates, 85% of ≥10). It admits nothing today, so agents see the default tier only until a verifier source is validated. Humans still see everything, ranked and capped (W4). R3 found that hiding suggestions from agents costs about 2 helps per 126 instances and removes the churn and suppressions.
- **D10.2, metrics for relabel5 (pre-registered here, before relabel5 runs).**
  - **Primary, unchanged:** per-card accept under rubric v3, per language and tier.
  - **Secondary metric A, flag precision:** of the outliers a card flags, the share the labellers' per-outlier verdicts call real violations.
  - **Secondary metric B, agent-shown precision:** per-card accept over the cards the admission sources would show agents.
  - The rubric does not change, so no recalibration is needed. W2 now writes exemptions into the rule statement, so labellers read them there.
- **D10.3, the verifier.** It ships only as an admission source for suggestions, run by the host agent over MCP, with verdicts cached by convention id and content hash. It never applies to the default tier [STRICT]. It gates what agents see only after:
  1. the frozen prompt reaches ≥90% passed-card precision on relabel5 dev cards it was not tuned on;
  2. then ≥90% on a fresh held-out set with the prompt, model and rule fixed in advance.
  
  Until then it is off by default (`agents.verify: off`). We make no external claim of 90% until the held-out check passes **and** real-maintainer accept/reject decisions on ≥100 passed cards across ≥10 repos agree.
- **D10.4, what is dropped.** W1-TS (closed as no; the zod `.refine()` fact fix is kept separately), W2 shared markers, W5 (too few dev cards to pre-register), and learned scorers.

## Workstreams (round 9)

| | Workstream | What | Gate |
|---|---|---|---|
| A | **Merge the round-8 drafts** | #112 W2 (sibling exemptions + rules state their exemptions), #113 W1-Py (lineage split), #109 W4 (rank by evidence, cap 5 for humans), #110 W0 (admission, suggestion-tier rates). Merge in that order; the later branch resolves conflicts. Assign `selector_version` 3 and Python LOWERING 16 at merge. | Local gates, plus a census check that each changes only what its PR says |
| B | **Agent text** (R3) | Advice says "no action needed if it doesn't fit". Drop "fix only these" from advice. Give the reason and known exceptions in every message and in `drift_explain`. Don't attach "any file" rules to files outside their role. One prime per session, no duplicate in `drift_rules_for`. No exemption chatter after "No new violations". `drift example` and MCP return rule text. | Hook/MCP golden tests; rerun R3's 12 tasks on haiku+sonnet: 0 `drift-ignore` written for an advice-tier message, overhead ≤ control +5% |
| C | **Flag only members that could comply** (R4) | `*Schema` naming only on schema-library values. No `has_test` demand on type-only modules. No "pass filters" when no filter class exists. Case- and plural-insensitive name tokens, `experimental_` stripped. Fix zod `.refine()` lowering as a schema value (TS LOWERING 37). | Census before/after with relabel4 labels per changed card; 0 default-tier harm |
| D | **Role stability** (R4) | Prefer a role already in the policy when one new file would swap an accepted rule for a different one (hysteresis); merge sibling cards that state the same rule. | Determinism tests; census shows no accepted card replaced by a new id on a one-file change |
| E | **Verifier admission source** (R6) | `drift_verify_card` MCP payload (rule, 3 holders, ≤5 outliers, excerpts), frozen prompt v3, 3 samples, 2-of-3 majority, cache in `.drift/`, plugged into W0's `Admission` trait, off by default. | Unit + MCP tests; never consulted for the default tier (test); validation as in D10.3 |
| F | **Human review surface** (R4) | CLI `review` shows outliers. Studio shows outliers above the fold, untruncated. Per-outlier "fine because…" saved to the policy. No red "Block anyway" on families under 50%. Fix Studio's overlapping badges and contradictory counts. | Studio e2e + screenshots; SYNC.md row |
| G | **Real-maintainer evidence** | Opt-in local log of accept/reject/override decisions in `drift review` and Studio, exportable as a study file. Recruit design partners at beta. | Needed for the D10.3 external claim |

Then **relabel5** on dev: every card the merged product shows, A/B/C under rubric v3, reporting the D10.2 metrics. In parallel, run the frozen verifier on the relabel5 cards for the first D10.3 check.

**Round-9 targets, on dev:**

| What | Target |
|---|---|
| Agent-shown precision | ≥95% (default tier plus admitted suggestions) |
| Human-facing per-card accept, TS | ≥60% |
| Human-facing per-card accept, Python | ≥60% |
| Flag precision | Reported; no target until the first measurement |

## What "par" means now

- **For agents:** at least 90% of what an agent is shown is right, measured on held-out data.
  - The default tier gets there today, pending the held-out run.
  - Suggestions reach agents only through an admission source validated to that bar.
- **For humans:** suggestions are ranked, capped and labelled with their track record.
  - The per-card accept target rises as workstreams C and D remove wrong flags under right rules.

## Held-out discipline

Unchanged. The primary held-out run on frozen `29f4cd6` is in labelling. Nothing in this plan is tuned on it. The verifier's held-out check (D10.3) needs a **new** held-out draw, because the current one will have been reported.

That draw is decision D11 (2026-11-07, README decision log): `select-holdout.mjs --selection heldout2`, manifests `eval/holdout-2-2026-11-07.json` and `eval/holdout-2-2026-11-07-py.json`, selection only. Its census runs at the round-9 freeze, for the D1/D4 re-measure and the D10.3 verifier check. The rule above applies to it: nothing is tuned on it, and nobody working on the product opens it.
