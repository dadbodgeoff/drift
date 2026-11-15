# Dev relabel 2: the 53 new or changed TS suggestion-tier cards (2026-11-07)

**Dev data, in-sample. This is not a held-out run and carries no verdict.**

## What
This run is a blind relabel, under rubric v3, of the 53 TypeScript suggestion-tier proposals that are new or changed at main feefad6 relative to the dev-v3 labels. The proposals come from the 16 dev repos in `eval/repos.json`. The relabel was needed after the 2026-11-06 merge train (#35–#64).

The remaining cards carry their earlier labels, 105 in all:
- the 29 default-tier cards, carried from `dev-v3-relabel-2026-11-06`;
- 76 identical suggestion cards, carried from dev-v3.

With these labels added, every one of the 158 shown TS proposals is labelled.

## Why
`dev-v3-relabel-2026-11-06` labelled only the default tier. It left 53 suggestion cards unlabelled, so its all-shown figures counted them as WRONG and could not be compared with dev-v3.

## Protocol
- **Cards.** The cards come from `prepare.mjs` at feefad6, with a release binary whose sha256 starts `24ed92b6a8e7…` (byte-identical to the fcec231 binary). Staging was done with this run's `stage.mjs`: every carried card is byte-identical, and the set to label is exactly the 53.
- **Labellers.** Labeller A ran on the session's default model and labeller B on a different, smaller model, as in dev-v3. Each (labeller, repo) prompt went to one fresh agent. B for a repo ran only after A's output for that repo had been collected.
- **Blinding.** Prompts were copied to neutral file names, so the path did not reveal the run. Each prompt holds only its own repo's uids, with no tier, rank, carried or relabel wording.
- **Adjudication.** A separate agent adjudicated each of the 3 A/B disagreements, using the study's `adjudicate.mjs` prompts.

### Deviations
- **Invalid B outputs.** Labeller B's output failed `collect.mjs` validation for 5 of 11 repos: dub, twenty, novu, midday and infisical. In each, one or two records listed fewer than 2 member files in `checked` besides the example and the outliers.
  - All 5 were discarded and rerun with fresh B agents.
  - Three reruns (twenty, novu, midday) still had one invalid record each. Each was sent back to the same B agent to open 2 more member files and reassess. All three kept their label.
  - That agent never saw labeller A's verdicts.
- **Slip in the twenty rerun.** The twenty B rerun ran one `ls` and a grep on the folder above its checkout after a mistyped `cd`. That listed only sibling directory names. It opened no file there, so no labels were visible.
- **Partial agreement step.** Agreement was first computed on partial B data. That output was deleted and recomputed once all 11 repos had valid B labels; the figures below are from the complete run.

## Results (D7 tier, rubric v3; unlabelled would count as WRONG, but none remain)

| Language | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
|---|---|---|---|---|---|---|---|
| TS/JS | Default | 29 | 27 | 0 | 2 | **93.1%** [Wilson 78.0–98.1; cluster 75.0–100, 8 repos] | 93.1% |
| TS/JS | Suggestion | 129 | 52 | 2 | 75 | 40.3% [32.2–48.9] | 41.9% [33.7–50.5] |
| TS/JS | All shown | 158 | 79 | 2 | 77 | 50.0% [42.3–57.7] | **51.3%** [43.5–58.9; cluster 40.5–62.1, 13 repos] |

- **A/B agreement on the 53 before adjudication:** 94.3% exact, Cohen's κ 0.89, with a bootstrap 95% interval of 0.77–1.00 over 11 repos.
- **Adjudications:** all 3 sided with A, ACCEPT: twenty D-70d216, documenso D-4785b8 and novu D-dbba9a. All three were low confidence.
- **Against the targets:** the default tier stays at 93.1%. The second pre-registered target (D4: not-wrong ≥ 95% over all shown, both tiers) is far off at 51.3%. Suggestions only advise, which is why D7 confines blocking to the default tier.

Full tables: `ts/views/d7/metrics.md`. Labels: `ts/final.jsonl`, 158 records.
