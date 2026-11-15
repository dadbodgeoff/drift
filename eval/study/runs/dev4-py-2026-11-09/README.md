# dev4 blind dev pool, Python part: census at F11 and blind labelling (WS-E)

This is the dev4 run of PLAN-R11 §4.1, pre-registered in [`../../PREREG-F11-dev4-check.md`](../../PREREG-F11-dev4-check.md). The other part is [`../dev4-ts-2026-11-09`](../dev4-ts-2026-11-09). Repos are named only by opaque key ([`manifest.json`](manifest.json)). Only the dev4 operator opens this directory before the report.

## Freeze
- `F11` = `1a44d7effbc6`. The binary is `/home/user/drift-bin/f11/drift`, sha256 `9a8c7cd52483…`, as recorded in the pre-registration §1.
- The tooling is main `e86a3827` (#150, `prepare.mjs --python-proposals`) plus this run's records. `run.json` `harness.commit` records the commit the census ran with.
- [`start.json`](start.json) was committed and pushed before the census.

## Deviations
- **Isolation incident, before the census (2026-11-09).** A release-packaging agent, which does no mining or labelling, ran a recursive grep for one string across the repository.
  - Its output listed file names and match counts only, and no content. `eval/dev4-2026-11-08-selection.json` was among the files.
  - One non-design agent therefore saw file names and match counts only: no repo names and no card content. There is no effect on F11.
  - The dev4 operator checked privately where the string occurs. It is one key of the record's exclusion list, a repo the Drift repository already mentions. It is in no dev4 primary or reserve and in neither dev4 manifest, so the counts reveal nothing about the pool.

## Results
- **Census, opt-in view (`--python-proposals`):** 24 of 24 repos ok; 3 cards from 3 repos, all suggestions. The default census (proposals off) shows 0 cards in every repo ([`default-view.json`](default-view.json)).
- **Agreement:** exact 3/3, κ 1.0; no disagreements, so no C.
- **The dev4-check:** see [`../dev4-ts-2026-11-09/dev4-check.md`](../dev4-ts-2026-11-09/dev4-check.md). Python has 3 shown cards against the ≥ 10 that (b) needs, so (b) cannot be evaluated for Python and fails on n.
