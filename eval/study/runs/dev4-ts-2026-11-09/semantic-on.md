# dev4 semantic-on arm (PREREG-F11 section 6; gates nothing)

Harness v1, prompt sem-v1 (sha256 `95ec1162366a…`), the frozen model, 3 samples per card. Rates over the arm's cards, unlabelled counted as WRONG; each beside the shipped default on the same cards. Repos by key only.

## typescript/javascript

- Cards: 16; admitted by the check: 10; dropped: 6 ({"default:ACCEPT":2,"default:WRONG":3,"suggestion:WRONG":1}).
- Candidate (default-tier) accept among the cards that pass: 80.0% (4/5) Wilson [37.6, 96.4]; shipped default 60.0% (6/10).
- Flag precision, all tiers: kept flags 48.6% (18/37) Wilson [33.4, 64.1]; dropped flags 27.3% (3/11); shipped (all flags) 43.8% (21/48).
- Flag precision, default tier: kept flags 34.5% (10/29) Wilson [19.9, 52.7]; dropped flags 33.3% (3/9); shipped (all flags) 34.2% (13/38).
- Flag precision, suggestion tier: kept flags 100.0% (8/8) Wilson [67.6, 100.0]; dropped flags 0.0% (0/2); shipped (all flags) 80.0% (8/10).
- Unmatched flag verdicts (counted as not correct): file-unit 23, symbol-unit 0.
- Exploratory, no verdict (suffix reading for file-unit names): kept flags 75.7% (28/37), default tier kept 69.0% (20/29); dropped 54.5% (6/11); shipped 70.8% (34/48); still unmatched: file-unit 1.
- D4 / not-wrong over the arm's cards: 90.0% (9/10) Wilson [59.6, 98.2]; shipped 68.8% (11/16).
- Yield: 9 accepted over 36 repos (0.25 per repo), 10 shown (0.28 per repo); shipped 11 accepted (0.31), 16 shown.

## python

- Cards: 3; admitted by the check: 2; dropped: 1 ({"suggestion:WRONG":1}).
- Candidate (default-tier) accept among the cards that pass: n = 0; shipped default n = 0.
- Flag precision, all tiers: kept flags 100.0% (2/2) Wilson [34.2, 100.0]; dropped flags 0.0% (0/2); shipped (all flags) 50.0% (2/4).
- Flag precision, suggestion tier: kept flags 100.0% (2/2) Wilson [34.2, 100.0]; dropped flags 0.0% (0/2); shipped (all flags) 50.0% (2/4).
- Unmatched flag verdicts (counted as not correct): file-unit 0, symbol-unit 0.
- Exploratory, no verdict (suffix reading for file-unit names): kept flags 100.0% (2/2), default tier kept n = 0; dropped 0.0% (0/2); shipped 50.0% (2/4); still unmatched: file-unit 0.
- D4 / not-wrong over the arm's cards: 100.0% (2/2) Wilson [34.2, 100.0]; shipped 66.7% (2/3).
- Yield: 2 accepted over 24 repos (0.08 per repo), 2 shown (0.08 per repo); shipped 2 accepted (0.08), 3 shown.

Cards without an outcome: 0.
