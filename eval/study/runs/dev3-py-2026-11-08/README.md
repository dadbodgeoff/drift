# dev3 blind dev pool, Python part: census at F10 and blind labelling (WS-F)

This is the dev3 run of PLAN-R10 §3.1, set `py-dev3-2026-11-08`, with 8 repos. It uses the same freeze, binary, pre-registration, order and labelling setup as [`../dev3-ts-2026-11-08/README.md`](../dev3-ts-2026-11-08/README.md). The combined report and the D12 dev3-check are in [`../dev3-ts-2026-11-08/dev3-check.md`](../dev3-ts-2026-11-08/dev3-check.md).

## Pool and census

- **Repos.** The 8 current slot occupants of `eval/dev3-2026-11-08-py.json` (its `repos` after its 4 rule-1 swaps), keyed P01 to P12 in [`manifest.json`](manifest.json).
- **Census.** A dev run of `prepare.mjs`, one repo at a time, `--strict-tier`. All 8 repos are `ok`.
- **Cards.** 2 cards from 2 repos (6 repos show none), both in the suggestion tier. Under D7, Python has no default tier.

## Labelling

A, then B, as in the TS/JS part. Exact agreement 2/2, κ 1.0, no disagreements, so no C. 0 unlabelled.

## Results

- **Accept, all shown (suggestion tier):** 50.0% (1/2); Wilson [9.5%, 90.5%].
- **D4 / not-wrong:** 50.0% (1/2).
- **D1:** no figure, because Python has no default tier (D7).
- **Flag precision:** 50.0% (2/4).
- **Yield:** 1 accepted over 8 repos (mean 0.13, 7 with none); 0.25 shown per repo.
- **WRONG causes:** `mixed_group` 1.

## Deviations

- **The census ran three times.** The shared disk filled during the first two attempts:
  - **Attempt 1:** one repo's checkout failed with "No space left on device", and `run.json` was truncated mid-write.
  - **Attempt 2:** the same happened again.
  - **Attempt 3:** after space was freed (the TS checkouts were deleted temporarily), the census ran clean in a fresh run directory.
  - Nobody saw a card or wrote a label before attempt 3. Every card file the earlier attempts wrote (`proposals/` and `pool/` of 6 repos) is byte-identical to attempt 3's.
- **Checkouts.** Those of zero-card repos were deleted after the census.
- **Census manifest and start record.** As in the TS/JS part: a keyed census manifest, and a start record written by hand with `held_out: false`, committed and pushed before the census.
