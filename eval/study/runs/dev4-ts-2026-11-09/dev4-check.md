# dev4 report: the pre-registered measures and the dev4-check

Rates are over all shown cards, unlabelled counted as WRONG (eval/study/PREREG-F11-dev4-check.md). Python: the opt-in view. Repos by key only.

## typescript/javascript (35 repos)

- D1 / default-tier accept: 60.0% (6/10); Wilson [31.3%, 83.2%]; cluster boot [10.0%, 100.0%], t [0.0%, 100.0%] over 4 repos
- Suggestion-tier accept: 83.3% (5/6); Wilson [43.6%, 97.0%]; cluster boot [40.0%, 100.0%], t [34.6%, 100.0%] over 5 repos
- Per-card accept, all shown: 68.8% (11/16); Wilson [44.4%, 85.8%]; cluster boot [35.3%, 96.4%], t [27.7%, 100.0%] over 9 repos
- D4 / not-wrong, all shown: 68.8% (11/16); Wilson [44.4%, 85.8%]; cluster boot [35.3%, 96.4%], t [27.7%, 100.0%] over 9 repos
- Default-tier not-wrong: 60.0% (6/10); Wilson [31.3%, 83.2%]; cluster boot [10.0%, 100.0%], t [0.0%, 100.0%] over 4 repos; suggestion-tier not-wrong: 83.3% (5/6); Wilson [43.6%, 97.0%]; cluster boot [40.0%, 100.0%], t [34.6%, 100.0%] over 5 repos
- Yield: 11 accepted over 36 repos (1 failed census, counted as zero), mean 0.31, median 0, 29 repos with none; shown 16 (0.44 per repo)
- WRONG causes: {"mixed_group":2,"incidental":3}

## python (24 repos)

- D1 / default-tier accept: n = 0
- Suggestion-tier accept: 66.7% (2/3); Wilson [20.8%, 93.9%]; cluster boot [0.0%, 100.0%], t [0.0%, 100.0%] over 3 repos
- Per-card accept, all shown: 66.7% (2/3); Wilson [20.8%, 93.9%]; cluster boot [0.0%, 100.0%], t [0.0%, 100.0%] over 3 repos
- D4 / not-wrong, all shown: 66.7% (2/3); Wilson [20.8%, 93.9%]; cluster boot [0.0%, 100.0%], t [0.0%, 100.0%] over 3 repos
- Default-tier not-wrong: n = 0; suggestion-tier not-wrong: 66.7% (2/3); Wilson [20.8%, 93.9%]; cluster boot [0.0%, 100.0%], t [0.0%, 100.0%] over 3 repos
- Yield: 2 accepted over 24 repos (0 failed census, counted as zero), mean 0.08, median 0, 22 repos with none; shown 3 (0.13 per repo)
- WRONG causes: {"mixed_group":1}

## Flag precision ((mistake + look) / all per-outlier verdicts, A and B)

- python all: 33.3% (2/6); Wilson [9.7%, 70.0%]; 2 repos, range 0.0%–100.0%
- python suggestion: 33.3% (2/6); Wilson [9.7%, 70.0%]; 2 repos, range 0.0%–100.0%
- typescript/javascript all: 63.6% (35/55); Wilson [50.4%, 75.1%]; 9 repos, range 0.0%–100.0%
- typescript/javascript default: 68.4% (26/38); Wilson [52.5%, 80.9%]; 4 repos, range 0.0%–100.0%
- typescript/javascript suggestion: 52.9% (9/17); Wilson [31.0%, 73.8%]; 5 repos, range 0.0%–100.0%

## Python default view and agent exposure

- Python default census (proposals off): 0 shown cards over 24 repos.
- Agent exposure, ts: 0 of 16 shown cards reach agents without a person's accept.
- Agent exposure, py: 0 of 3 shown cards reach agents without a person's accept.
- Default-tier flag precision beside it (no verdict): dev3 at F10 31.3% (5/16).

## The dev4-check (PLAN-R11 section 4.2 (2))

- (a) TS default-tier accept >= 90% with >= 8 default-tier cards: 60.0% with 10 cards: **NOT MET**
- (b) not-wrong, typescript/javascript: 68.8% (n = 16): **NOT MET**
- (b) not-wrong, python: 66.7% (n = 3, needs >= 10): not evaluable (n below the minimum): **NOT MET**
- (c) typescript/javascript: dev4 68.8% (n = 16) vs in-sample 86.2% (50/58): -17.5 points: **NOT MET**
- (c) python: dev4 66.7% (n = 3) vs in-sample 92.9% (13/14): -26.2 points: **NOT MET**
- Beside them, no verdict: the undo-named and dev-v3 readings were not recomputed at F11 for this report.

**dev4-check: FAILS** (all three conditions must hold, for both languages).

Unlabelled cards: 0.
