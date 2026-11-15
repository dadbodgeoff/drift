# dev3 re-census at main (WS-A, round 11)

PLAN-R11 §5 makes dev3 fold 5 of the build set, re-censused at each mechanism PR's binary. This record checks that main reproduces the F10 census of dev3, and keeps main's `census --json` of it as the fold-5 "before" state for `generalise.mjs --before/--after`.

| Item | Value |
| --- | --- |
| Main | `bb1d45ed` (no Rust change since `F10` = `5151e5cb40b9`) |
| Binary | `build-verified.sh` at CGU 74; `census --json` `commit` tag `cgu74-bb1d45ed-1794166617` (`compare.json`) |
| Clones | `scratchpad/dev-clones/dev3/<key>`: the 20 repos of `eval/study/runs/dev3-{ts,py}-2026-11-08/manifest.json`, shallow (`git fetch --depth 1 <url> <sha>`, as `prepare.mjs` checks out), each verified at its pinned sha and clean, ignored files included, before and after the census |
| Commands | As `prepare.mjs` runs a dev census, one repo at a time, `--no-cache`, a private `DRIFT_CACHE_DIR`: `census --all-outliers --all --max 15`, `census --all --max 200`, `init --max 200` (its `.drift/` removed again and the clone verified clean), and `census --json --max 15` |

## Result

All 60 census outputs (20 repos × `proposals/<key>.txt`, `proposals/<key>.yaml`, `pool/<key>.txt`) are byte-identical to the F10 run record: `compare.json` lists each file's sha256 at F10 and at main (60 identical, 0 differ). The 20 `census-json/<key>.json` files hold the same 14 cards as the two runs' `queue.json` (12 TS/JS, 2 Python; same id, tier and outlier count), which `generalise.test.mjs` checks.

The JSON files name each repo by key only; `root` is the scratch path of the keyed clone.
