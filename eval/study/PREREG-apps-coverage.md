# apps11: a pool shaped like the beta users, and coverage measures (pre-registration)

This file, the selection specification in [`select-apps.mjs`](select-apps.mjs) (`SPEC`, with the commitment to the draw's secret) and the measure code in [`apps-coverage.mjs`](apps-coverage.mjs) are committed and pushed **before the draw**: before any candidate of the pool is seen. After that commit, only §7 (the record of the draw) is filled in. A deviation is reported in the run READMEs; it is never edited in here.

## 1. Why

Every evaluation pool so far (the dev sets, dev3, dev4 and the held-out draws) is a set of public repos, one framework bucket each, measured at the repo root. The gates measure only the **precision** of shown cards. A pilot on a real beta-user codebase found a private application monorepo (a Next frontend plus several FastAPI services) where Drift showed almost nothing. A precision gate can be passed by showing nothing. So this pool is drawn to look like the beta users, and it adds **coverage** measures: does Drift show anything, how much of it is accepted, and in how many of the repo's packages.

## 2. Population and selection criteria

The repos are public GitHub **applications, not libraries**. Every criterion is decided from search metadata, the file paths of the tree at the pin, the contents of the dependency manifests, and a line count. No source file is read by anyone, and Drift is never run during selection. The exact values are in `SPEC`, and `node eval/study/select-apps.mjs spec` prints them.

- **Search.** Two GitHub repository searches, `language:TypeScript` and `language:Python`, each with `size:1000..1000000 pushed:>=2025-11-09 archived:false fork:false is:public`. Each is enumerated over `stars:200..20000`, split by stars until a slice has at most 1000 results.
- **Metadata filters.**
  - A permissive licence (MIT, Apache-2.0, BSD, ISC, 0BSD, Unlicense, Zlib, BSL-1.0, UPL-1.0, PostgreSQL, NCSA). No copyleft [STRICT: "permissive" read literally].
  - Not archived, not a fork, not a template.
  - Pushed within the last 12 months.
  - No non-application name or topic. These are select-holdout.mjs's lists, plus libraries, SDKs, frameworks, plugins and CLIs.
  - Never polar or CTFd.
- **Exclusions.** Every repo of every existing pool, and every repo the Drift repository mentions, is excluded. That covers the dev sets, the secondary and primary held-out sets, heldout2, dev3, dev4 with their reserves and replaced, burned and exposed lists, any github.com URL in any tracked file on any branch, commit messages, PR and issue text, and the Drift owner's repos. The list comes from **`select-holdout.mjs exclusion-hashes`**: the same code as every held-out draw's exclusions, with apps11's own outputs left out. Its output is **hashes only** (`lib.mjs poolHash` of each slug and name), so the operator never reads a held-out or blind-pool name. A candidate is dropped when its slug, its name or its owner matches.
- **The walk.** The eligible pool is sorted and shuffled with `lib.mjs shuffle`, seeded by `SPEC.seed_public` joined with a 128-bit secret. The secret was drawn once, before the draw, with `openssl rand -hex 16`. Only its sha256 (`SPEC.secret_sha256`) is committed, and the secret itself stays in `scratchpad/apps-blind*/secret.txt`. Candidates are walked in that order. For each one:
  1. Its HEAD sha is pinned (`git ls-remote`).
  2. Its tree at the pin is fetched depth 1 and blobless, and its product manifests are read: `package.json`, `pyproject.toml`, `setup.cfg`, `setup.py`, `Pipfile` and `requirements*.txt`, not under docs, examples, tests, hidden directories or node_modules.
  3. It must pass **C1**, **C2** and **C4**:
     - **C1, languages.** At least one product `package.json` and at least one Python manifest directory (mixed TS + Python), or at least 2 `package.json` directories (multi-package TS), or at least 2 Python manifest directories (multi-service Python).
     - **C2, shape.** A frontend directory and a different backend directory, or at least 2 backend directories.
       - A frontend is a `package.json` with react-dom, next, vue, svelte, @angular/core, solid-js, nuxt or @sveltejs/kit in its dependencies or devDependencies.
       - A backend is a `package.json` with express, @nestjs/core, fastify, hono or koa in its runtime `dependencies`, or a Python manifest that requires fastapi, django, flask or litestar.
       - A `package.json` counts only if it is `"private": true` or lies under an application directory (`apps/`, `services/`, `backend/`, `server/`, `api/`, `frontend/`, `web/`, `client/`, `workers/`). A published library's packages are public.
       - With at least 2 `package.json` directories, the root one is the workspace root and counts as neither frontend nor backend.
     - **C3, workspace.** At least 2 manifest directories (C1 implies it). Workspace files (pnpm-workspace.yaml, lerna.json, nx.json, turbo.json, rush.json) are recorded.
     - **C4, size.** 20,000 to 500,000 non-blank lines in tracked `.ts .tsx .mts .cts .js .jsx .mjs .cjs .py .vue .svelte` files at the pin. Vendored, generated, build-output, migration, minified, `.d.ts` and over-1-MB files are not counted. The count is taken from a depth-1 fetch read by `git cat-file`, with no checkout, and deleted at once.
  4. The walk stops at the 30th repo that passes.
- **The split.** The 30 repos, in walk order, are shuffled with `${seed}:split`. The first 12 are **apps-build** and the other 18 are **apps-blind**.

Tuning disclosure: C2's private-package and application-directory rules were set on build-set repos only, before the draw (twenty, documenso, cal.com, immich, the FastAPI template, netbox, InvenTree, novu, midday, infisical, formbricks, excalidraw, saleor, langchain, nest, trpc and vercel/ai). On those, every library monorepo fails C2 and most app monorepos pass. Infisical fails C2: its backend `package.json` is public and outside an application directory. No candidate was seen.

## 3. Isolation

- **apps-build** (`eval/apps11-build.json`, 12 repos): design agents may read these repos, their census output and their labels. It is a build fold from the start.
- **apps-blind** (18 repos): only the apps11 operator reads them.
  - They are committed **only as hashes**, in `eval/apps11-blind-hashes.json`: for each repo, `poolHash` of its slug, its name and its pin, plus the sha256 of the blind manifest's repos (`core_sha256`) and of the private record.
  - The blind key map (`apps11-blind.json`), the selection record (pool, walk, evidence), the exclusions and the secret live under `scratchpad/apps-blind*` only.
  - No blind repo, card, label or name is quoted anywhere. Reports give aggregates only.
- **Later pools.** `select-holdout.mjs` now reads every `eval/<pool>-hashes.json` as an exclusion source. Every later selection (dev5, the next held-out draw) excludes the blind repos by hash. Its `verify` also checks that no held-out or blind-dev repo matches one.
- **Verification.**
  - `node eval/study/select-apps.mjs verify` is public and offline. It checks:
    - that the build manifest and the hashes are well formed and disjoint;
    - that no repo of either half is in another pool or mentioned by the Drift repository at HEAD and every remote ref.
  - `verify --private scratchpad/apps-blind` is for the operator. It replays the whole draw from the record: the secret against its commitment, the pool against the exclusions, the walk order, each verdict from its recorded evidence and line count, the split, and the committed files.
  - When apps-blind joins the build set, the secret and the record are published, and anyone can replay.

## 4. Coverage measures (pre-registered)

Census means `drift census --json --max 15`, which is `drift init`'s preview: the same proposals, and it writes nothing. A card is **shown** when the census lists it for people (`shown_by_default`). A **package** is a product manifest directory at the pin (`apps-coverage.mjs packagesOf`). The repo root is left out unless it is the only manifest directory. A root-census card belongs to the deepest package directory that contains its example file; a card under no package belongs to none. Each figure is reported for two views:
- **default**: the root census with the product's defaults;
- **Python opt-in**: the root census with `--python-proposals`.

1. **Silent-root rate.** The share of repos where `drift init` at the root shows 0 cards: root census, default view. A repo whose census fails counts as silent.
2. **Shown cards per repo and per package.** Shown cards per repo: mean, median and the number of repos with none. Shown cards per package: mean and median. The number of packages with at least 1 shown card, over all packages.
3. **Accepted conventions per repo** after blind labelling under rubric v3. Two fresh labellers, A then B, and C on disagreements, as in PREREG-F11-dev4-check §3. Only **ACCEPT** counts; TRIVIAL does not. Reported as mean, median and the number of repos with none. The labelled cards are the default view's shown cards plus the Python opt-in view's shown Python cards (dev4's "shown").
4. **Package coverage.** The share of packages with at least 1 ACCEPT card.
5. **Precision of shown cards**, as before (PREREG-F11-dev4-check §4): D1 (TS default-tier accept), D4 (not-wrong, per language), and per-card accept per language and tier.
   - Unlabelled cards count as WRONG.
   - Each rate comes with its Wilson 95% interval and the repo-cluster intervals.

**Also reported, with no target: the per-package census.** Each package is censused alone (`census --root <package>`, defaults; Python packages also with `--python-proposals`), and its shown cards are counted. That is: shown per package, packages with at least 1 shown card, and the total per repo. It shows what Drift finds when it is pointed at a package, the reference that workspace support should reach from the root.

## 4b. Map coverage (added by the lead, 2026-11-09)

**Provenance.** Added on the lead's instruction on 2026-11-09, while the draw was running. That was before any census of any apps11 repo, and before anyone had seen a repo of the pool. The bar the user set is that Drift should map at least 90% of a repo like these. Nothing in §4 is changed by it.

**Population.** The **source files** of a repo are its tracked files at the pin that the C4 line count counts (`select-apps.mjs locCounted`: `.ts .tsx .mts .cts .js .jsx .mjs .cjs .py .vue .svelte`, not vendored, generated, build output, migrations, minified, `.d.ts` or over 1 MB). Test files are included. Every measure is given twice, as a share of these files and as a share of their non-blank lines (LOC), for three groupings:
- per repo, pooled over repos, with the per-repo median and range;
- per package (§4's packages);
- per package, as a distribution.

**Measures.**
1. **Files parsed:** the file is in `drift scan --json`'s fact index with `parse_ok`. Files Drift skips are reported by its own reason (`generated`, `too_large`, `minified`, `declaration`), as are files it never indexes.
2. **Files assigned to a package:** Drift's `package` for the file equals the deepest manifest directory that contains it (§4's packages). Beside it: the share with any non-root Drift package.
3. **Files that are members of at least 1 structural role:** at least one of the file's units (an exported non-test symbol) is in a role of at least `MIN_ROLE_SIZE` (8) members, kept by `spans_files`.
   - These are mine.rs's `roles_considered` roles.
   - Beside it: the share counting the file-level roles too (whole-file units, the package-wide `**` role included).
4. **Internal imports resolved:** an import is internal when it resolves to a repo path, is `unresolved:`, or names a workspace package (`pkg:<name>` with a name from `scan`'s packages). Resolved / internal.
5. **Files under at least 1 mined convention, any tier:** a unit of the file is a member of a role of a proposal of `census --json --max 1000 --all` (the role's `includes`, with merged `also` parts and narrowed subtrees). Given for the default view and the Python opt-in view.
6. **Files under at least 1 shown convention:** the same, over the shown cards of the root census (`--max 15`), for the default and Python opt-in views.
7. **Silent packages:** packages with no file under a shown convention (measure 6), for each view.

**Unmapped files.** Every source file outside measure 3 is put in a **class** and given **Drift's reason**.
- The class is set by path and facts only (`drift-map.mjs fileClass`): component, hook, route/page, util, pydantic/dataclass model, ORM model, router/dep, service, test, script, config, migration, types, index/__init__, or other.
- The reason comes from Drift's own rules, taken in order:
  1. not indexed, or skipped with its skip reason;
  2. parse failed;
  3. a test path (roles.rs `is_test_path`), which forms no role;
  4. demo or integration-suite code (`NonProduction`);
  5. no exported symbol, or only module-level code;
  6. only base, abstract, view or type-variable classes (`class_variety` Excluded);
  7. a Python role within fewer than 3 files;
  8. the largest role is below 8 members (1–3 or 4–7).
- Reported as files and LOC per class and reason, pooled.

**How membership is computed.** The CLI prints no per-file role membership, and this pool is measured on the frozen binary, without a build. So `eval/study/drift-map.mjs` re-derives the units and roles from the fact index with the rules of `roles.rs` and `mine.rs` at F11. It is study code. On every repo it is checked against the product's own figures, and the check is reported with the measures:
- the unit count must equal the census's `units`;
- the role count must equal the census's `roles` (`roles_considered`);
- each mined proposal's member count must equal its `role.members`.

A repo where the check fails is reported, and its measures 3, 5 and 6 are marked as not validated [STRICT].

**Proposed targets (a proposal for the lead, not adopted).**

| Measure | Proposed target |
|---|---|
| (3) source files in at least 1 structural role | ≥ 90%, files and LOC, pooled |
| (4) internal imports resolved | ≥ 98% |
| (6) files under a shown convention | set after the apps-build baseline |

**When.** On apps-build at F11 with the baseline (§6, step 3). On apps-blind, before and after, only once workspace support lands (§6, step 4).

## 5. Proposed targets (a proposal for the lead, not adopted)

These targets would be judged on apps-blind, on point estimates. They gate nothing until the lead adopts them.

| Measure | Proposed target |
|---|---|
| Silent-root rate (default view) | ≤ 20% |
| Accepted conventions per repo | median ≥ 3 ACCEPT |
| Package coverage | ≥ 50% of packages with ≥ 1 ACCEPT |
| Precision | As D12 is revised in PLAN-R11 §4.2: TS default-tier accept ≥ 90% with ≥ 8 cards; not-wrong ≥ 70% per language (Python over the opt-in view, with ≥ 10 shown cards). |

## 6. Order

1. This file, `SPEC` with the secret commitment, and the scripts, committed and pushed.
2. The draw (`select-apps.mjs fetch`), the split (`write`), and `verify --private`. The build manifest and the blind hashes are committed.
3. **Baseline on apps-build only, at F11** (`/home/user/drift-bin/f11/drift`, census tag `cgu83-1a44d7ef-…`): `apps-coverage.mjs run`, then `report`. The census runs at the root with defaults, at the root with `--python-proposals`, and per package. The results go in `runs/apps11-build-baseline-2026-11-09/`. There are no labels at baseline, so measures 3–5 are not measured.
4. **apps-blind waits for the workspace-support branch (monorepo11).** Then the operator runs the census once at F11 (**before**) and once at that branch's head (**after**), on the same 18 repos at their pins. Both are labelled blind (§4.3), and measures 1–5 are reported for both. So before and after are measured on repos nobody designing the change has seen.
5. After that report, apps-blind joins the build set, and the secret and the record are published.

## 7. Record of the draw

Filled in after the draw, with aggregates only.

- **Pre-registration commit:** `b9d572a1` (spec, secret commitment, measures), pushed before the draw. §4b was added in `628de751`, pushed during the draw and before any census.
- **Search:** 31,452 unique results over the two queries.
- **Excluded:**
  - 10,581 without a permissive licence;
  - 1,185 by topic and 973 by name;
  - 334 templates;
  - 328 in another pool or mentioned by the Drift repository (matched by hash);
  - 3 never drawn.
- **Eligible:** 18,048.
- **Walk:** 562 candidates walked, 30 accepted. The rest were skipped:
  - 351 at C1;
  - 170 at C2;
  - 10 at C4 (line count);
  - 1 where `git ls-remote` failed.
- **Split:** 12 apps-build (`eval/apps11-build.json`) and 18 apps-blind (`eval/apps11-blind-hashes.json`).
- **Verification:** `select-apps.mjs verify --private` replays the whole draw from the record (no network).
- **Deviation:** none.
