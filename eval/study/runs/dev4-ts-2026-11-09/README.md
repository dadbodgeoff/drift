# dev4 blind dev pool, TS/JS part: census at F11 and blind labelling (WS-E)

This is the dev4 run of PLAN-R11 §4.1, pre-registered in [`../../PREREG-F11-dev4-check.md`](../../PREREG-F11-dev4-check.md). The other part is [`../dev4-py-2026-11-09`](../dev4-py-2026-11-09). Repos are named only by opaque key ([`manifest.json`](manifest.json)). Only the dev4 operator opens this directory before the report.

## Freeze
- `F11` = `1a44d7effbc6`. The binary is `/home/user/drift-bin/f11/drift`, sha256 `9a8c7cd52483…`, as recorded in the pre-registration §1.
- The tooling is main `e86a3827` (#150, `prepare.mjs --python-proposals`) plus this run's records. `run.json` `harness.commit` records the commit the census ran with.
- [`start.json`](start.json) was committed and pushed before the census.

## Deviations
- **Isolation incident, before the census (2026-11-09).** A release-packaging agent, which does no mining or labelling, ran a recursive grep for one string across the repository.
  - Its output listed file names and match counts only, and no content. `eval/dev4-2026-11-08-selection.json` was among the files.
  - One non-design agent therefore saw file names and match counts only: no repo names and no card content. There is no effect on F11.
  - The dev4 operator checked privately where the string occurs. It is one key of the record's exclusion list, a repo the Drift repository already mentions. It is in no dev4 primary or reserve and in neither dev4 manifest, so the counts reveal nothing about the pool.
- **History-replay arm: role membership (lead decision, 2026-11-09, before any replay step ran).** The F11 CLI does not list the members of a card's role. Both the selector-file count used to choose P and the silent-miss population use a superset: the TS/JS files under the role's package and `dir` (`**` meaning the whole package). The size of the gap, on one replay card at S: the product reports 178 members, the superset has 277 files, and a reconstruction from facts and file kinds gave 136. Warnings come from `check` itself and do not depend on this choice.
- **History-replay arm: "new member" (lead decision, [STRICT]).** On these file-unit (layering) cards, a new member is a file absent at P.
- **Checkouts for labelling.** The census deleted each checkout after its repo, because disk was short. The checkouts of the repos with shown cards were fetched again at their pins, each verified clean, before any label prompt was rendered. The census outputs were not touched.
- **Labeller working directory.** As in earlier rounds, `prompt.mjs` gives each agent a fresh, empty, neutral directory as its working directory. The checkout at the pin is named in the prompt. It is never the working directory.
- **Census failure (D3).** One TS/JS repo failed census at F11, reproducibly, with a product error. It is reported as a failed repo with no swap, and it counts as a repo with no shown card.
- **B relaunches.** Labeller B's first outputs for 4 of the 9 repos were INVALID. In each, at least one record listed fewer than two other role members in `checked`, which rubric v3 requires. `collect.mjs` rejected them, and each rejection is in `prompts/index.json`. Each output was moved aside unread and unedited, into the operator's scratch, and a fresh B agent was launched with a new prompt, working directory and outbox (`prompt.mjs`).
- **Second B relaunch.** The first relaunch fixed 2 of the 4 repos. For the other 2, the relaunched outputs were INVALID again, on the same `checked` minimum. As the pre-registration says (an INVALID output is relaunched as a fresh agent, and never edited), each was moved aside unread, and a second fresh B agent was launched for each repo.
- **Cap on B attempts (lead decision [STRICT], 2026-11-09, recorded before the second relaunch's outputs were read).** A repo gets at most 3 B attempts. If its third B output is also INVALID:
  - that repo's B is recorded here as missing;
  - its cards go to a blind third labeller, C, with the plain labeller prompt (REVIEWER-PROMPT and rubric v3). C is shown neither A's label nor its reasons, and does not get the adjudicator prompt. The operator renders C as labeller A of a sub-run that holds that repo alone, so `prompt.mjs` and `collect.mjs` run unchanged;
  - each such card's final label is ACCEPT only if A and C both say ACCEPT, and WRONG otherwise;
  - if C's output is also INVALID, the card is WRONG;
  - agreement then runs with `agree.mjs --allow-incomplete`, which records the gap, restricted to those repos.
- **Third B failure: one repo.** Its third B output was INVALID too, on the same `checked` minimum. Under the cap, its B is recorded as missing, and that output was moved aside unread.
  - Its 3 cards go to a blind third labeller in the sub-run [`blindC-T19/`](blindC-T19), rendered with the plain labeller prompt. That prompt has the same content as A's, with the cards in another order, and no A label or reason.
  - TS agreement was computed with `agree.mjs --allow-incomplete`, over the 8 repos with complete A and B (13 cards); the gap is recorded in `agreement.json`.
  - `adjudicate.mjs` excludes that repo (`--exclude-repos`, reason recorded). Its final labels come from the A + blind-C rule, merged separately.

## Results
The full report is [`dev4-check.md`](dev4-check.md), produced by [`dev4-check.mjs`](dev4-check.mjs) (with `dev4-check.json`). Metrics are in [`metrics.md`](metrics.md) and [`../dev4-py-2026-11-09/metrics.md`](../dev4-py-2026-11-09/metrics.md). Final labels are in `final-all.jsonl`: `adjudicate.mjs --merge`'s `final.jsonl` plus `final-blindC-T19.jsonl`.

- **Census:** 35 of 36 repos ok, 1 failed (D3). 16 cards from 9 repos: 10 in the default (candidate) tier and 6 suggestions. 0 of them reach agents unvetted.
- **Agreement**, before adjudication, over the 8 repos with complete A and B: exact 12/13 (92.3%), κ 0.755. The one disagreement went to C. On the blind-C repo, A and blind C agreed on 3 of 3 cards.
- **The dev4-check fails:** (a) NOT MET, (b) NOT MET for both languages (Python not evaluable on n), (c) NOT MET for both languages. The figures are in [`dev4-check.md`](dev4-check.md).
- **Semantic-on arm (PREREG §6; gates nothing):** see [`semantic-on.md`](semantic-on.md), from [`semantic-on.mjs`](semantic-on.mjs) and `semantic-on/<key>/outcomes.jsonl`. Harness v1 ran with prompt sem-v1 (`95ec1162366a…`) and the frozen model, 3 samples a card: 57 samples, 19 cards, every card decided and none in error. The run used `runAll` on the payloads harness v1 built at F11, while each checkout existed at its pin. The payloads and raw replies quote repository code, so they stay out of the repository; their sha256 are in `semantic-on/withheld-sha256.json`. Each figure below is beside the shipped default on the same cards:
  - **TS:**
    - the check admits 10 of 16 cards; the 6 dropped are 2 default-tier ACCEPTs, 3 default-tier WRONGs and 1 suggestion WRONG;
    - candidate accept among the cards that pass: 80.0% (4/5), Wilson [37.6, 96.4], against 60.0% (6/10);
    - D4 over the arm's cards: 90.0% (9/10), against 68.8% (11/16);
    - yield: 0.25 accepted per repo, against 0.31.
  - **TS flag precision on kept flags, as pre-registered:** 48.6% (18/37), default tier 34.5% (10/29), against 43.8% (21/48) for all flags.
    - 23 file-unit flag verdicts match no verdict by repo-relative path and count as not correct [STRICT]. Labellers named these files by a path relative to the package.
    - An exploratory suffix reading, not pre-registered and with no verdict, gives 75.7% (28/37) for kept flags, against 70.8% (34/48) for all flags.
  - **Python:** the check admits 2 of 3 cards and drops 1 WRONG. D4 over the arm's cards is 100% (2/2), against 66.7% (2/3). Kept-flag precision is 2/2, against 2/4.
- **History-replay arm (PREREG §7): not run (deviation).** It is underpowered by construction: 4 TS repos have default cards, against a pre-registered target of ≥ 10 repos. Resources were redirected to coverage work (lead decision, 2026-11-09). No replay step ran and no replay rows were labelled.

## Isolation after the report
With this report, dev4 joins the build set (PLAN-R11 §4.1): `eval/dev4*` and `eval/study/runs/dev4*` may now be read, like dev3's. One rule still holds (PREREG-F11 §9, "After the report: aggregates only"): plans and research documents quote dev4 by aggregate figures only, never by card-level content (ids, reasons, file names). The dev4 operator's private key map stays in the operator's scratch and is not part of the build set.
