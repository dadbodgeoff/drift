# WS-G semantic check: pre-registration of the offline evaluation (2026-11-08)

Written and committed **before any sample of the semantic prompt was run** and before any label was joined with a
payload. Nothing below changes once a sample is collected; a change after that is listed under Deviations in
`sem11-findings.md` with its reason.

## What is frozen
- **Prompt** `crates/drift-mine/data/semantic-prompt-v1.txt`, version `sem-v1`, sha256
  `95ec1162366afdd669cf56739418f7cd34c0bb2130093c938e40ee0c62991752` (`semantic::PROMPT_SHA256`, checked by a test).
  Written from rubric v3 (Q1–Q3, R1, R2, R3, R6, R8) and general principles only. No card was read while writing it,
  and it quotes none.
- **Model**: the verifier's small model (R6's, given to the CLI by the same alias as relabel5's verifier run). The
  product records it only by the sha256 of its identifier (`semantic::MODEL_SHA256`
  `26f6cf65acbd60862113d9e31ae957c4adf5fb966ae79f33a6fa8ac45e228e41`); no identifier is written in the repository.
- **Temperature**: the payload asks for 0 (`semantic::TEMPERATURE`). The headless CLI used offline has no temperature
  option, so the offline samples run at its default: the flip rates below are an upper bound on what temperature 0
  gives.
- **Decision** (`semantic::decide`): 3 samples; per member the 2-of-3 majority. A flagged member is **set apart** when
  it is not `protected` and a majority calls it `other` (S1) or gives its flag `legit`, `not_violation` or `one_off`
  (S2). No majority: the flag is kept. `protected` (structural, outside the model, [STRICT]): an entry point, an entry
  class, a file unit of a file with entry points, or any member of such a file under a rule on a guard.
- **Payload** (`semantic::payloads`): the card as the tool prints it, then M1 = the example, two more holders (as the
  verifier picks them), then the first 12 legacy outliers in (path, line, symbol) order, each excerpted (lines −3..+15).

## Population
Every labelled card of the build set that the labelled run's conventions file holds:
- **folds 1–4**: the 224 cards of relabel5 (`dev-v3-relabel5-2026-11-07/{ts,py,py2}`, labels `final.jsonl`);
- **fold 5**: the 14 cards of dev3 (`dev3-{ts,py}-2026-11-08`, labels `final.jsonl`).

Payloads are built by the sem11 binary (`build-verified.sh` CGU 78) in a hard-linked scratch copy of each dev clone:
the labelled run's own `proposals/<repo>.yaml`, kept to the labelled ids and each marked `accepted` (so the show
policy keeps hidden suggestions, as it keeps what a person accepted), `agents.semantic: on`, then `drift init --max 15
--all` (it baselines the lock), then the MCP tool `drift_semantic_card` with only `id`. Outliers are what the binary's
`check` finds now. A card whose payload cannot be built is reported and left out.

## Design folds [STRICT]
- **Fold 5 (dev3)**: a design fold (PLAN-R11 §5; the author read PLAN-R11, which quotes every dev3 default card).
- **Fold 4**: also a design fold. While testing the payload harness, before the payload code was final, the author
  printed one fold-4 payload (a dub card). The prompt was already frozen, but the payload format was not, so fold 4 is
  declared a design fold.
- **Folds 1–3** are the other folds. The author read no card of them. PLAN-R11 and R6 name a few of their ids in prose;
  their cards were not opened. Sensitivity: every verdict is also reported with those named ids left out.

## Member-level scoring (lead constraint 1)
- **Matching.** A labeller's per-outlier verdict (A and B records behind each final label, followed through carried
  rows, as `generalise.mjs verdictsOf`; for dev3 its `labels/`) names a symbol. It is matched to a judged payload
  member of the same card with that symbol when the symbol is unique among the card's judged members **and** among its
  legacy outliers; otherwise it is unmatched and left out. A labeller verdict on an outlier the payload did not judge is
  unmatched.
- **S2 agreement**: the majority verdict against each labeller verdict (pooled A and B), 5 classes; Cohen's κ; and the
  binary reading real (`mistake`/`look`) against not real. Members without a majority are reported apart.
- **S1**: `other` against the labeller's not-real verdicts; κ of the binary set-apart decision against labeller not-real.
- **A vs B** on the same matched members: κ, as the ceiling.
- **Flip rate**: the share of judged members whose 3 samples are not unanimous (kind, and flag for outliers).

## Decisions and their fold rules (PLAN-R10 §3.2 / PLAN-R11 §5, per decision)
Lead constraint 2 makes the check narrowing only: it never shows a card to agents, never hides one and is never the
sole gate. So:

**(b) which flags are shown: the one decision the product applies** (`drift review --narrow`, a person confirms).
- A member is **real** when every matched labeller verdict on it is `mistake` or `look`, **not real** when every one is
  `legit`, `not_violation` or `one_off`, **split** otherwise.
- A card is **helped** when it sets apart at least one not-real matched member and no real one.
- A **loss** is a real matched member set apart, on any card [STRICT: stricter than "an ACCEPT card"].
- Admitted only if: (1) helped cards in ≥ 3 repos across ≥ 2 folds; (2) no loss outside the design folds;
  (3) flag precision over the other folds rises: (mistake + look) / all matched labeller verdicts, over the kept
  matched flags against all matched flags; (4) fold 5: no loss, and its flag precision does not fall.

**(a) candidate tier: a reading, not a gate.** Over the TS default-tier (D7 candidate) cards: accept among cards whose
card-level reading passes (`Outcome::card_pass`) and among those it fails, per fold. Under constraint 2 a candidate
still needs a person's accept; the reading says only how far the semantic verdict would agree with that accept. For
reference, the would-be gate is scored with the fold rule (helped: a non-ACCEPT candidate fails; lost: an ACCEPT
candidate fails), and it is **not admitted by construction**.

**(c) suggestion admission alongside the verifier: a reading, not wired.** Over suggestion-tier cards with a relabel5
verifier outcome (`verifier/outcomes.jsonl`): agents shown = verifier pass, against verifier pass and `card_pass`.
Fold rule as `generalise.mjs` (helped: a non-ACCEPT no longer shown; lost: an ACCEPT no longer shown). Fold 5 has no
verifier outcome, so there is no fold-5 reading and **no admission** [STRICT]. Not wired in the product
(constraint 2: it would be an effect other than narrowing).

**D4** is unchanged by construction: the census does not read the setting; checked by `census --json` with the
setting on and off on two repos.

**Yield** per repo: flags set apart, kept; candidate cards passing the reading, and accepted among them.

**Mutation check**: each admission condition of the scorer is one line, and `sem11-score.test.mjs` mutates each.

**Cost**: model calls per repo (3 per card, plus retries) and tokens, from the CLI's usage records.
