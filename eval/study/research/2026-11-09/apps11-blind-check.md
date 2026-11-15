# apps11 blind half: before and after workspace support (2026-11-09)

This is step 4 of [`PREREG-apps-coverage.md`](../../PREREG-apps-coverage.md) §6: the 18 **apps-blind** repos, censused before and after workspace support, labelled blind, and measured with §4 and §4b. Aggregates only. No blind repo, path, file, card or reason appears here. The repos are identified only through [`eval/apps11-blind-hashes.json`](../../../apps11-blind-hashes.json) (`set_id` `apps11-blind-2026-11-09`, `core_sha256` `576b91cc…`). The figures are in [`apps11-blind-check.json`](apps11-blind-check.json).

Status: a record only. Nothing here changes product code. Nothing was tuned on these figures.

## 0. Declaration (written before any measurement)

**Protocol.** PREREG-apps-coverage.md §4 (L55-65), §4b (L73-107) and §6 step 4 (L135), with labelling as in PREREG-F11-dev4-check.md §3 (L37-43) and rates as in §4 (L48-58). There is no PLAN-R12.

**Measures.**
- §4: M1 silent-root rate; M2 shown cards per repo and per package; M3 accepted conventions per repo; M4 package coverage; M5 precision (D1, D4 per language, per-card accept per language and tier).
- §4, with no target: the per-package census.
- §4b: parsed; in a package; in ≥1 structural role; internal imports resolved; under a mined convention; under a shown convention; silent packages; unmapped files by class.

**Bars.** No bar is adopted. Every bar below is a proposal marked "not adopted" in the pre-registration: §4b L109-116 and §5 L119-128. Each is judged on point estimates and marked "proposed, not adopted". The round-11 coverage rows the lead named are secondary rows.

**Arms** (lead decision, 2026-11-09, before any census):

| Arm | Binary sha256 | Census commit | Role |
|---|---|---|---|
| F11 | `9a8c7cd52483…` | `cgu83-1a44d7ef-…` | declared **before** |
| monorepo11 | `77061d1d70f5…` | `cgu89-d5821e62-…` | declared **after** (L135: the workspace-support branch head) |
| F12 | `b98b78632972…` | `cgu194-8348b84c-…` | ship arm (added by the lead) |

## 1. Deviations

- **A ship arm was added.** L135 names only before (F11) and after (the monorepo11 head). The lead added F12, which contains monorepo11 plus later product merges. Every measure is reported for all 3 arms.
- **The labelled set is the union over the 3 arms**, as L61 defines it: shown cards in the root default view, plus shown Python cards in the root opt-in view. In every arm the same 4 cards were shown, and their labeller-facing text was byte-identical. So one label set serves all 3 arms.
- **B ran on the smaller model, as the pre-registration says** (dev4-check L39). The lead's brief first said B would run on the default model. The lead then withdrew that before any labelling.
- **The `apps-coverage.mjs run` guard.** The script refuses any manifest path that matches /apps-blind/: "the blind half waits for the workspace-support branch". That condition holds now, since monorepo11 has merged. The operator passed the private manifest by a relative path. The code is unchanged.
- **Map method by arm.** F11 and monorepo11 have no `census --coverage`. §4b is therefore computed with `drift-map.mjs`, as declared, for all 3 arms. F12's `census --coverage` is reported beside it. `drift-map.mjs` re-derives F11's roles. Its check against the census, as declared in L102-107:
  - F11: passes on **18 of 18** repos;
  - monorepo11 and F12: fails on **12 of 18** repos. The unit counts match everywhere; the role counts do not.
  - So for monorepo11 and F12, the `drift-map.mjs` measures 3, 5 and 6 are **not validated** [STRICT]. They follow F11's role rules.
- **The labelling run.** `prepare.mjs` ran with `--python-proposals --strict-tier` under the D7 tier, once per arm, on the 4 repos that have any shown card. The labelling queue is the F12 run's queue under fresh opaque keys. Each queued card equals the shown set from apps-coverage. The checkouts were at their pins and clean before and after labelling.

## 2. Checks

- The private manifest matches the committed hashes: slug, name and pin for 18 of 18 repos, and `core_sha256`.
- `select-apps.mjs verify --private` replays the draw.
- 3 arms × 18 repos were censused one repo at a time: 0 failed, and 0 checkouts were dirty afterwards.
- Leak check on all 8 prompts (A and B): 0 `agents:` lines, 0 "Moves labels", 0 matches of /[0-9]+% of [0-9]+/, 0 `tier:` lines. The rubric was v3 (`79316bdc…`, the D6 text).
- Labels:
  - A and B each wrote 4 records out of 4, and every one was valid on the first attempt.
  - Agreement: 4/4 exact, κ 1.00, 0 disagreements. C was not needed.
- The 3-attempt cap and the blind-C rule never came into play.

## 3. Results (§4)

204 packages: 113 TS, 86 Python, 5 mixed. Each figure is the same in all 3 arms, so every delta is 0.

| Measure | F11 | monorepo11 | F12 | Δ (after − before) |
|---|---|---|---|---|
| **M1 silent-root, default view** | **15/18 = 83.3%** | 83.3% | 83.3% | 0 |
| M1 silent-root, opt-in view | 14/18 = 77.8% | 77.8% | 77.8% | 0 |
| M2 shown per repo, default (mean, median, repos with none) | 0.17, 0, 15 | same | same | 0 |
| M2 shown per repo, opt-in | 0.22, 0, 14 | same | same | 0 |
| M2 shown per package (mean, median); packages with ≥1 shown | 0.015, 0; 3/204 | same | same | 0 |
| Shown cards (labelled set) | 4: 3 TS, 1 Python; all suggestion tier | same | same | 0 |
| **M3 ACCEPT per repo** (mean, median, repos with none) | **0.17, 0, 15** | same | same | 0 |
| **M4 package coverage** (≥1 ACCEPT) | **3/204 = 1.5%** | same | same | 0 |
| Per-package census (alone): packages with ≥1 shown | 4/204; per repo mean 0.5, median 0, 14 with none | same | same | 0 |

**M5 precision.** Unlabelled cards count as WRONG; there are 0 unlabelled. Final labels: 3 ACCEPT, 1 TRIVIAL (lint), 0 WRONG. They are the same in every arm.

| Rate | k/n | Point | Wilson 95% | Repo-cluster 95% (bootstrap; t) |
|---|---|---|---|---|
| D1, TS default-tier accept | 0/0 | none | none | none |
| D4, TS not-wrong, all shown | 3/3 | 100% | 43.9–100 | 100–100; 100–100 (3 clusters) |
| D4, Python not-wrong, opt-in view | 1/1 | 100% | 20.7–100 | none (1 cluster) |
| Per-card accept, TS suggestion = TS all | 3/3 | 100% | 43.9–100 | 100–100; 100–100 (3) |
| Per-card accept, Python suggestion = Python all | 0/1 | 0% | 0–79.3 | none (1) |
| Per-card accept, default tier (either language) | 0/0 | none | none | none |

## 4. Map coverage (§4b)

**`drift-map.mjs`.** The universe is 13,763 source files. The figures pool all repos; the per-repo median is in brackets. They are validated at F11 only; they were not validated at monorepo11 or F12 (§1).

| Measure | Files | LOC |
|---|---|---|
| (1) Parsed | 97.3% (99.8%) | 96.6% |
| (2) In the right package (Drift's package = the deepest manifest directory) | 66.6% (68.5%) | 59.2% |
| (2) In any non-root Drift package | 70.0% | 60.9% |
| **(3) In ≥1 structural role** (symbol roles of ≥8) | **59.7% (58.9%; range 13.8–85.6)** | **64.9%** |
| (3) Same, counting file-level roles too | 73.1% | 70.9% |
| **(4) Internal imports resolved** | **98.7%** (F11 35,470/35,928; monorepo11 and F12 35,368/35,825) | |
| (5) Under a mined convention: default; opt-in | 0.4%; 0.5% | 0.2%; 0.3% |
| (6) Under a shown convention: default; opt-in | 0.4%; 0.5% | 0.2%; 0.3% |
| (7) Silent packages: default; opt-in | 201/204; 200/204 | |

The same figures come out for monorepo11 and F12, under F11's role rules. The only change is the import count; the rate stays 98.7%.

**Unmapped files, outside measure 3** (5,549 files at F11):
- test 2,375. Tests form no role under F11's rules.
- other 962;
- component 597;
- index/`__init__` 506;
- config 237;
- router/dep 197;
- script 144;
- each remaining class is under 130.
- By reason, the files outside tests are mostly: no exported symbol; a largest role under 8 members; demo or integration-suite code; and, for components and routers, files not in the fact index.

**F12 `census --coverage`** (the product's own definition). It covers 13,642 files and 2.53M LOC. The figures pool all repos; brackets give the per-repo median and the number of repos at ≥90%.

| Measure | Files | LOC |
|---|---|---|
| (1) Parsed | 98.5% (99.5%; 18/18) | 98.6% |
| (2) In a package | 89.7% (98.7%; 14/18) | 86.2% |
| (3) In ≥1 role (production map + test map) | 91.0% (93.5%; 11/18) | 93.2% |
| Production files in a role | 95.0% (97.8%; 15/18) | |
| Production files in a role narrower than their package | 88.5% (91.8%; 10/18) | |
| Test files in a test role | 97.4% | |
| (4) Internal imports resolved | 98.7% (99.9%; 16/18) | |
| (6) Under a mined convention (every tier) | 19.9% | 20.4% |
| (7) Under a shown convention | 0.4% (0%) | 0.2% |

- It reports 65 mined conventions and 3 shown (default view).
- **Layer:** `--coverage` emits no layer measure, so none is reported.

## 5. Bars (all proposed, not adopted)

| Bar (source) | F11 | monorepo11 | F12 |
|---|---|---|---|
| Silent-root ≤ 20%, default view (§5) | 83.3%: **NOT MET** | **NOT MET** | **NOT MET** |
| Median ≥ 3 ACCEPT per repo (§5) | 0: **NOT MET** | **NOT MET** | **NOT MET** |
| ≥ 50% of packages with ≥1 ACCEPT (§5) | 1.5%: **NOT MET** | **NOT MET** | **NOT MET** |
| D1: TS default-tier accept ≥ 90% with ≥ 8 cards (§5) | 0 cards: **NOT MET** | **NOT MET** | **NOT MET** |
| D4: TS not-wrong ≥ 70% (§5) | 100% (3/3): MET | MET | MET |
| D4: Python not-wrong ≥ 70%, opt-in view, ≥ 10 cards (§5) | 1 card: **NOT MET** | **NOT MET** | **NOT MET** |
| (3) ≥1 structural role ≥ 90%, files and LOC, pooled (§4b) | 59.7% / 64.9%: **NOT MET** | not validated: **NOT MET** [STRICT] | see below |
| (4) Imports resolved ≥ 98% (§4b) | 98.7%: MET | MET | MET |
| (6) Files under a shown convention (§4b) | no bar set | | |

**(3) at F12.** By `census --coverage`, F12 has 91.0% of files and 93.2% of LOC in a role. That would meet the bar. But the figure counts the product's test map, and test files form no role in §4b's definition (L81-83). The declared path (`drift-map.mjs`) gives 59.7% / 64.9%, and it is not validated at F12. [STRICT] (3) at F12 is **NOT MET** on the declared definition. The product's figure is a sensitivity row. Production files alone are 95.0% in a role.

**Secondary rows (round-11 coverage rows):**

| Row | F11 | F12 |
|---|---|---|
| Files in a package ≥ 90% | 66.6% (drift-map): NOT MET | 89.7% (`--coverage`): NOT MET |
| Files in a layer | not emitted | not emitted |
| Files in ≥1 role ≥ 90% | NOT MET (above) | see above |
| Imports resolved ≥ 98% | MET | MET |
| Repos with ≥1 card at the root | 3/18 default, 4/18 opt-in | same |
| Files under a shown convention | 0.4% | 0.4% |
| D4 (not-wrong), Wilson | TS 100% [43.9, 100]; Python 100% [20.7, 100], n = 1 | same |

## 6. Reading

- Workspace support changes nothing on this pool. monorepo11 and F12 show exactly the cards F11 shows: 4 cards on 4 of 18 repos, all suggestion tier, none in the default tier. So every §4 delta is 0.
- The precision gate cannot be read here. Shown cards are not wrong (4/4 not-wrong, 3/4 accepted), but n is 4. D1 has no card.
- Coverage is the failure:
  - 83% of repos are silent at the root;
  - 1.5% of packages have an accepted convention;
  - 0.4% of files are under a shown convention.
- The map is not where coverage dies. Production files are 95% in a role at F12, and imports resolve at 98.7%. Between roles and conventions, F12 mines 65 conventions and shows 3. This is the same funnel map11 found on apps-build.

## 7. After this report

As §6 step 5 says, apps-blind joins the build set, and the secret and the private record are published. The private files behind this record are named by sha256 in `apps11-blind-check.json` (`labelling.private_sha256`). They are the final labels, the labelling queue and the key map.
