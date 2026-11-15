# apps11 baseline: apps-build at F11 (2026-11-09)

This is the coverage and map-coverage baseline of PREREG-apps-coverage.md, §4 and §4b, on the 12 **apps-build** repos only, at the F11 binary. apps-blind is not run here: it waits for workspace support (§6, step 4). There are no labels yet, so ACCEPT per repo, package coverage and precision are **not measured**.

- **Binary:** `/home/user/drift-bin/f11/drift`, census tag `cgu83-1a44d7ef-1794188563`. `run.json` records its sha256.
- **Commands:** `node eval/study/apps-coverage.mjs run --manifest eval/apps11-build.json --drift <F11> --clones scratchpad/apps-build --out <this dir>`, then `report <this dir>`.
- **Clones:** each repo was checked out at its pin with a depth-1 fetch, one at a time, then deleted.
- **Outputs:**
  - `repos/<name>.json`: the shown cards (id, tier, language, rule kind, package);
  - `repos/<name>.map.json`: the map measures;
  - `metrics.json`: the aggregates.

## Coverage (§4)

| Measure | Default view | Python opt-in view |
|---|---|---|
| **Silent-root rate** (`drift init` at the root shows 0 cards) | **10/12 = 83.3%** | 10/12 = 83.3% |
| Shown cards per repo: mean, median, repos with none | 0.33, 0, 10 | 0.33, 0, 10 |
| Shown cards in all | 4: 1 default tier, 3 suggestions, all TS | 4, all TS |
| Packages with ≥ 1 shown card (root census) | 4/141 | 4/141 |
| Packages censused alone with ≥ 1 shown card (`--root <package>`) | 3/141 | 3/141 (opt-in for Python packages) |

- The 141 packages split into 49 TS and 92 Python, with a median of 4.5 per repo and a range of 1–72.
- Only 2 repos show anything: both TS, with 2 cards each.
- The Python opt-in shows **no** Python card on any repo.
- Censusing each package alone (`--root`) does not help: 4 cards on 3 packages in all, against 4 at the root.
- **Not measured** (they need blind labels): ACCEPT per repo, package coverage and precision.

## Map coverage (§4b)

There are 8,097 source files (1,209,566 non-blank LOC) across the 12 repos. The figures pool all repos; the per-repo median follows in brackets.

| Measure | Files | LOC | Proposed target |
|---|---|---|---|
| (1) Parsed | 97.1% (99.5%) | 93.0% (99.5%) | |
| (2) In the right package (Drift's package = the deepest manifest directory) | 70.1% (64.2%) | 66.0% (63.6%) | |
| (2) In any non-root Drift package | 72.8% | 68.2% | |
| **(3) In ≥ 1 structural role** (symbol roles of ≥ 8 members) | **49.8% (63.8%)** | **53.7% (56.8%)** | ≥ 90% |
| (3) Same, test files left out | 69.3% | 77.8% | |
| (3) Counting the file-level roles too | 62.1% (76.4%) | 58.3% (63.0%) | |
| (3) Counting file-level roles, test files left out | 86.3% | 84.4% | |
| **(4) Internal imports resolved** | **76.8%** (17,051 of 22,189) | | ≥ 98% |
| (5) Under ≥ 1 mined convention, any tier (both views) | 1.3% (0%) | 0.8% (0%) | |
| (6) Under ≥ 1 shown convention (both views) | 1.3% (0%) | 0.8% (0%) | set after this baseline |
| (7) Silent packages (no file under a shown convention) | 137/141 | | |

Every mined proposal is also shown here, so (5) equals (6).

**Per repo** (files): parsed / in the right package / in a role / imports resolved / under a shown convention.

| Repo | Source files | Parsed | Package | Role | Imports | Shown |
|---|---|---|---|---|---|---|
| chunky | 156 | 99% | 53% | 67% | 100% | 0% |
| deepv-ki | 195 | 100% | 57% | 83% | 100% | 0% |
| designsystemet | 774 | 100% | 97% | 57% | 96% | 8% |
| doska | 858 | 100% | 90% | 68% | 100% | 0% |
| hyper-alpha-arena | 339 | 100% | 100% | 88% | 100% | 0% |
| laya | 525 | 78% | 17% | 49% | 100% | 0% |
| metascreener | 596 | 97% | 1% | 50% | 99% | 0% |
| monitorss | 1,642 | 100% | 94% | 60% | 100% | 3% |
| openmanus-rl | 190 | 100% | 0% | 68% | 46% | 0% |
| opentelemetry-python-contrib | 731 | 99% | 94% | 6% | 50% | 0% |
| promptflow | 1,635 | 97% | 71% | 25% | 17% | 0% |
| xiaokeai | 456 | 91% | 27% | 71% | 99% | 0% |

**Unmapped files of (3), by class and Drift's reason** (files, pooled; `metrics.json` `map.unmapped` has LOC and repos):

| Class | Files | LOC | Main reasons |
|---|---|---|---|
| test | 2,270 | 373,935 | test path, which forms no role (2,265) |
| other | 659 | 50,924 | no exported symbol 213; demo or integration-suite code 205; largest role under 8 members 153; generated 43 |
| index/\_\_init\_\_ | 313 | 24,175 | no exported symbol 235; largest role under 8 members 67 |
| service | 187 | 7,615 | no exported symbol 155; largest role under 8 members 31 |
| component | 181 | 33,572 | **not in the fact index 112** (Drift indexes no `.vue` or `.svelte` file: `drift-core` ingest.rs `SOURCE_EXTENSIONS`); largest role under 8 members 48 |
| config | 127 | 15,817 | largest role under 8 members 61; not indexed 31; no exported symbol 28 |
| script | 86 | 6,930 | no exported symbol 51; largest role under 8 members 16; demo 14 |
| pydantic/dataclass model | 73 | 9,612 | demo or integration-suite code 51; largest role under 8 members 12 |
| util | 55 | 6,161 | no exported symbol 18; largest role under 8 members 19; demo 12 |
| router/dep | 43 | 13,997 | no exported symbol 23; not indexed 17 |
| route/page | 35 | 11,898 | largest role under 8 members 14; not indexed 13 |
| hook | 17 | 301 | no exported symbol 15 |
| ORM model | 8 | 4,218 | no exported symbol 5 |
| types | 7 | 689 | no exported symbol 6 |

## Readings (no verdict; for the workspace-support and mining rounds)

- **The pilot's finding reproduces.** 10 of 12 app repos show nothing at the root. No Python card is shown even with the opt-in.
  - Pointing the census at each package does not recover coverage. So the gap is not only workspace discovery: the roles exist, but no convention is mined in them. 49.8% of files sit in a symbol role, and 1.3% are under a convention.
- **Imports.** Python multi-service repos resolve few internal imports: promptflow 17%, otel-contrib 50%, openmanus-rl 46%. The pooled 76.8% is far below the proposed 98%.
- **Package assignment.** Drift's package disagrees with the manifest directory for 30% of files, worst in the mixed TS + Python repos (metascreener 1%, openmanus-rl 0%, laya 17%). That points at Python service roots.
- **Role membership.** The 90% bar is not reachable over all source files while tests form no role by design: tests are 28% of the files. With tests left out, it is 69.3% of files (77.8% LOC), or 86.3% counting file-level roles.
  - Outside tests, the main causes are "no exported symbol": 755 files, many of them Python modules and `__init__.py` files.
  - Then come roles below 8 members, demo or integration-suite code, and `.vue`/`.svelte` files that are not indexed.

## Validation of the role re-derivation

`eval/study/drift-map.mjs` re-derives Drift's units and roles from `scan --json`. It agrees exactly with the product on all 12 repos, in both views:
- unit counts, against the census's `units`;
- role counts, against the census's `roles` (`roles_considered`);
- the member count of every mined proposal (4 of 4).

It also agreed on 4 dev-set repos before the run (documenso, the FastAPI template, netbox, immich). No measure is marked as not validated.

## Caveats

- **A C2 false positive.** opentelemetry-python-contrib passed C2 as "services": its instrumentation packages require Flask, Django and FastAPI. It is a library monorepo, and the frozen draw keeps it; a later spec should not count a framework named by a library package. It is the repo with 6% role coverage.
- **The unmapped classes** are a descriptive path heuristic (`fileClass`), not Drift's own classification. The **reasons** come from Drift's rules.
