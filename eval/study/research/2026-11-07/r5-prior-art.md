# R5: Prior art on precise convention mining

arxiv and university hosts could not be fetched from this session. The figures below come from search snippets of primary abstracts. Figures from secondary sources are marked as such.

## Key lesson
MUBench evaluated GrouMiner, Jadet, DMMC and other mined-rule misuse detectors and found "extremely low precision" in realistic use (Amann et al., TSE'18, https://arxiv.org/abs/1712.00242). Its lesson: a deviation from the majority is not a bug. A follow-up summarising that study (secondary) reports two causes of false positives that map onto Drift's (https://teamscale.com/hubfs/26978363/Publications/2019-investigating-next-steps-in-static-api-misuse-detection.pdf):
- 34% were uncommon but correct usages, like `legit_outliers`;
- 19% followed an alternative pattern.

Industrial tools reached high precision by changing *what they show*, not by mining better.

## Techniques and how each maps to Drift

**Engler, "Bugs as deviant behavior" (SOSP'01), and z-ranking (Kremenek & Engler, SAS'03; https://bibtex.github.io/SAS-2003-KremenekE.html, https://patents.google.com/patent/US7505952).**
- MAY-beliefs are ranked by z = (e/n − p0)/√(p0(1−p0)/n). Drift's Wilson lower bound already plays this role.
- The part Drift lacks: z-ranking groups reports by population (function, file) and demotes populations where the check often "fails". Many failures in one place mean the rule doesn't apply there.
- *For Drift:* run a Fisher or z-test of the outlier rate inside vs. outside each candidate marker (directory, name token, decorator). Concentrated outliers become an exempt sub-group; outliers spread evenly are deviants. This gives W2's "all but one" rule a statistical basis. **Cheap:** census JSON already lists outlier paths and symbols.

**Alattin (ASE'09; https://sites.google.com/site/asergrp/projects/alattin_ase2009).**
- Mines disjunctive "P1 or P2" patterns. More than 40% of patterns were alternatives, and modelling them cut false positives by about 28%.
- *For Drift:* mine rules over the outliers alone. If they share a regularity, they follow an alternative convention. For example, dub's auth outliers call `getSession`, verify an HMAC, or check `CRON_SECRET`. This targets `legit_outliers`, 48% of TS WRONGs.

**PR-Miner (FSE'05; https://www.cs.purdue.edu/homes/xyzhang/fall07/Papers/PRMiner.pdf).**
- Mines closed itemsets and ranks violations by confidence. Only 23 of the top 60 violations were confirmed bugs.
- *For Drift:* support and confidence alone do not reach 90%.

**DynaMine (FSE'05; https://www.doc.ic.ac.uk/~livshits/papers/pdf/fse05.pdf).**
- Mines patterns that co-change and ranks first those touched by fix-like one-line commits ("corrective ranking"). Only 21 of 56 candidate patterns survived independent dynamic validation.
- *For Drift:* require a second, independent signal before showing a suggestion. Options:
  - commits that converted an outlier into a holder;
  - newer members adopting the rule;
  - a lint or docs mention;
  - the wrapper's name itself (Engler's "latent specification", e.g. `withAuth`).

**MAPO (ECOOP'09; https://bibtex.github.io/ECOOP-2009-ZhongXZPM.html).**
- Clusters usages before it mines them. This supports W1.
- *For Drift, a cheaper complement:* a stratification (Simpson) check that keeps a rule only if its lift holds *within* each kind stratum. If kind explains the rule, it is a `mixed_group` artefact. **Cheap.**

**NATURALIZE (FSE'14; https://www.microsoft.com/en-us/research/publication/learning-natural-coding-conventions/).**
- Reached 94% top-suggestion accuracy for identifier names and had 14 of 18 patches accepted.
- It achieves this by abstaining when not confident. The thesis reports 90% accuracy at the most-confident 20% of locations.
- *For Drift:* a naming rule must beat the role's next-best naming pattern by a margin, not just clear a lower bound.

**Getafix (OOPSLA'19; https://engineering.fb.com/2018/11/06/developer-tools/getafix-how-facebook-tools-learn-to-fix-bugs-automatically/), with Phoenix and SapFix.**
- Builds a general-to-specific pattern hierarchy by anti-unification and applies the most specific match. Every fix is re-checked by Infer before it is shown. 42% of fixes were accepted.
- *For Drift:* attach each rule to the deepest path level where it is coherent. Validate mechanically before showing.

**Tricorder / "Lessons from building static analysis tools at Google" (https://cacm.acm.org/magazines/2018/4/226371-lessons-from-building-static-analysis-tools-at-google/pdf).**
- An "effective false positive" is any report developers don't act on. Code-review checks must keep the "NOT USEFUL" rate below 10%. Analyzers must clear a quality bar to launch and are fixed or removed if they fall below it.
- *For Drift:* this is W0. Add the missing loop: an MCP or hook call where the agent records "followed / overrode + reason", feeding per-repo family admission.

**Infer (CACM'19; https://cacm.acm.org/magazines/2019/8/238344-scaling-static-analyses-at-facebook/pdf).**
- Diff-time fix rate was 70%, batch-mode fix rate 0%.
- *For Drift:* show a rule only when the edit touches its role.

**CodeQL and Semgrep.**
- CodeQL default suites ship only queries tagged `@precision` high or very-high (https://codeql.github.com/docs/codeql-cli/creating-codeql-query-suites).
- Semgrep Assistant uses an LLM for triage. It reports 95–96% user agreement and a 2.8× further noise cut from "memories" built from triage notes (vendor figures; https://semgrep.dev/blog/2025/announcing-ai-noise-filtering-and-triage-memories).
- *For Drift:* `family-precision.json` is the same idea as CodeQL's precision tags. Store exemption reasons as repo memory.

**Feedback-Rank (FSE'04; https://unpaywall.org/10.1145%2F1029894.1029909).**
- One inspection label updates correlated reports, giving 2–8× better ranking than random.
- *For Drift:* one "legit" label demotes the sibling outliers that share its marker.

**Actionable-alert classifiers (Ruthruff et al., ICSE'08, at Google; https://research.google/pubs/predicting-accurate-and-actionable-static-analysis-warnings-an-experimental-approach).**
- Logistic regression on warning features predicted actionability well. Kang, Le & Lo (ICSE'22) later showed that leakage inflated similar results.
- *For Drift:* fit a card-level model on the ~230 labelled dev cards. Features: `lower_bound`, `lift`, `holders`, `outliers_total`, members, rule kind, language, kind entropy, outlier concentration. Validate leave-one-repo-out and threshold for ≥90%. Unlike W0, it admits strong cards from weak families and drops weak cards from strong ones. **Cheap.**

**LLM verification.**
- BitsAI-CR (ByteDance, 2025; https://arxiv.org/abs/2501.15134) runs rule detection followed by an LLM filter, reaches 75% precision, and prunes low-value rules.
- ZeroFalse (https://arxiv.org/abs/2510.02534) adjudicates alerts with context and reaches F1 0.91–0.96.
- Caution from IRIS (ICLR'25; https://proceedings.iclr.cc/paper/2025/hash/582d4e27fa24168f3af1f4582655034b-Abstract-Conference.html): specifications the LLM *invented* had an 85% false-discovery rate. LLMs verify better than they invent.
- AutoCommenter (Google; https://research.google/pubs/ai-assisted-assessment-of-coding-practices-in-industrial-code-review/) is gated by a "useful ratio" from developer feedback.
- *For Drift:* the host agent, via MCP (no Drift API key), receives the rule, 3 holders and all outliers. It answers "intended convention?" and "each outlier: mistake or deliberate?". Drift shows the rule only if it is intended and exempts the deliberate outliers. **Cheap to measure:** the A/B/C labelling pipeline already is this verifier. Use a different model or prompt to limit circularity.

**Agent-guidance studies (2025–26).**
- Gloaguen et al. (ICLR'26; https://arxiv.org/abs/2602.11988): context files gave no gain or reduced success, and raised cost by more than 20%. Unnecessary requirements hurt.
- "Guardrails Beat Guidance" (https://arxiv.org/abs/2604.11088; 25,532 rules): every individually helpful rule was a negative constraint, and random rules primed about as well as curated ones.
- Agent READMEs (https://arxiv.org/abs/2511.12884) and the Cursor-rules study (https://arxiv.org/abs/2512.18925): conventions are hand-written and unvalidated.
- *For Drift:* a wrong suggestion costs real performance; a missing one costs little. Show few rules, scope them to the edit, and prefer "avoid X" phrasing.

## Ranked: expected precision gain per cost
1. **Card-level calibrated gate.** Logistic model on existing evidence plus a family prior, leave-one-repo-out, thresholded at ≥90%. About a day of work on existing data. It generalises W0.
2. **Outlier-concentration test plus alternative-pattern mining** (z-ranking groups, Alattin). Targets `legit_outliers`. Cheap, from the census.
3. **LLM verifier run by the host agent.** Probably the largest gain. Prototype by scoring dev cards with a non-labeller prompt and model.
4. **Kind-stratification check.** Drop a rule whose lift vanishes within kinds. Cheap, and covers `mixed_group` before W1 lands.
5. **Second evidence source plus an online "not useful" loop** (DynaMine, Tricorder, Feedback-Rank). Medium cost. Keeps admitted families precise after release.
