# dev3 report: the pre-registered measures and the D12 dev3-check

Rates are over all shown cards, unlabelled counted as WRONG (eval/study/PREREG-F10-dev3-check.md). Repos by key only.

## typescript/javascript (12 repos)

- D1 / default-tier accept: 20.0% (1/5); Wilson [3.6%, 62.4%]; cluster boot [0.0%, 75.0%], t [0.0%, 88.9%] over 4 repos
- Suggestion-tier accept: 85.7% (6/7); Wilson [48.7%, 97.4%]; cluster boot [70.0%, 100.0%], t [50.5%, 100.0%] over 4 repos
- Per-card accept, all shown: 58.3% (7/12); Wilson [32.0%, 80.7%]; cluster boot [33.3%, 88.9%], t [15.4%, 100.0%] over 5 repos
- D4 / not-wrong, all shown: 66.7% (8/12); Wilson [39.1%, 86.2%]; cluster boot [45.5%, 100.0%], t [24.4%, 100.0%] over 5 repos
- Default-tier not-wrong: 40.0% (2/5); Wilson [11.8%, 76.9%]; cluster boot [0.0%, 100.0%], t [0.0%, 100.0%] over 4 repos; suggestion-tier not-wrong: 85.7% (6/7); Wilson [48.7%, 97.4%]; cluster boot [70.0%, 100.0%], t [50.5%, 100.0%] over 4 repos
- Yield: 7 accepted over 12 repos, mean 0.58, median 0, 8 repos with none; shown 12 (1.00 per repo)
- WRONG causes: {"mixed_group":3,"legit_outliers":1}

## python (8 repos)

- D1 / default-tier accept: n = 0
- Suggestion-tier accept: 50.0% (1/2); Wilson [9.5%, 90.5%]; cluster boot [0.0%, 100.0%], t [0.0%, 100.0%] over 2 repos
- Per-card accept, all shown: 50.0% (1/2); Wilson [9.5%, 90.5%]; cluster boot [0.0%, 100.0%], t [0.0%, 100.0%] over 2 repos
- D4 / not-wrong, all shown: 50.0% (1/2); Wilson [9.5%, 90.5%]; cluster boot [0.0%, 100.0%], t [0.0%, 100.0%] over 2 repos
- Default-tier not-wrong: n = 0; suggestion-tier not-wrong: 50.0% (1/2); Wilson [9.5%, 90.5%]; cluster boot [0.0%, 100.0%], t [0.0%, 100.0%] over 2 repos
- Yield: 1 accepted over 8 repos, mean 0.13, median 0, 7 repos with none; shown 2 (0.25 per repo)
- WRONG causes: {"mixed_group":1}

## Flag precision ((mistake + look) / all per-outlier verdicts, A and B)

- python all: 50.0% (2/4); Wilson [15.0%, 85.0%]; 2 repos, range 0.0%–100.0%
- python suggestion: 50.0% (2/4); Wilson [15.0%, 85.0%]; 2 repos, range 0.0%–100.0%
- typescript/javascript all: 40.7% (11/27); Wilson [24.5%, 59.3%]; 5 repos, range 0.0%–100.0%
- typescript/javascript default: 31.3% (5/16); Wilson [14.2%, 55.6%]; 4 repos, range 0.0%–100.0%
- typescript/javascript suggestion: 54.5% (6/11); Wilson [28.0%, 78.7%]; 4 repos, range 0.0%–100.0%

## The D12 dev3-check (PLAN-R10 section 3.4, condition 2)

- (a) TS default-tier accept >= 90% with >= 8 default-tier cards: 20.0% with 5 cards: **NOT MET**
- (b) not-wrong, typescript/javascript: 66.7% (n = 12): **NOT MET**
- (b) not-wrong, python: 50.0% (n = 2): **NOT MET**
- (c) typescript/javascript: dev3 58.3% (n = 12) vs in-sample 93.5% (43/46): -35.1 points: **NOT MET**
- (c) python: dev3 50.0% (n = 2) vs in-sample 100% (12/12): -50.0 points: **NOT MET**
- Beside them, no verdict: undo-named TS 63.6%, Python 88.9%; dev-v3 TS 69.2%, Python 85.7% (#129).

**dev3-check: FAILS** (all three conditions must hold).

Unlabelled cards: 0.
