# monorepo11: workspace-aware Drift (F12 candidate, ws/monorepo11)

**Problem.** A private pilot ran one `drift init` at the root of a multi-package app (a
Next app in `frontend/`, FastAPI services and shared packages in `backend/`, with no root
manifest), and it proposed 0 conventions. The cause, traced on the pilot's synthetic
fixtures (ws/gc-pilot, G1): mining dropped every import inside one workspace package as
`same_package`, and counted layering areas from the repository root. With `--root
frontend` the same edges were layering. The hooks found a policy only above the session's
`cwd`, and the GitHub/SARIF paths of a `--root` run were relative to the sub-root.

## Design

1. **Packages.** A package is a directory with its own manifest: `package.json`, or
   `pyproject.toml`/`setup.cfg`/`setup.py`/`requirements*.txt`. Each file is in the
   package of its nearest manifest of its own language (the scan already assigned this),
   else in the root package `""`, so no file is left without one. Declared membership is
   read only for the report: root `workspaces`, `pnpm-workspace.yaml`, `lerna.json`,
   `nx.json`/`turbo.json`, and `[tool.uv.workspace]`. The walk honours `.gitignore`.
   Packages are listed by path in code-point order, root first. `packages: {roots, include,
   exclude}` in `.drift/config.yaml` overrides this (globs), and every scan applies it.
   Module: `drift_mine::workspace`.
2. **Mining.** Roles were already per package (`RoleSelector.package`).
   - (a) An import inside one package is now a layer edge, with areas counted from that
     package's root (`edge_areas`), so the root census proposes what `--root <pkg>` does
     (test: root census = union of the package censuses).
   - Between packages, and in single-package repositories, nothing changes.
   - **Pooling.** One place (the same folder, file kind and kinds) in sibling packages
     (`backend/services/*`) forms one pooled role. Its parts are the packages' own roles
     (`also`), so `check` judges each member in its own package. A pooled card supersedes
     its parts' cards. [STRICT] A pooled card never reaches the default tier, so it cannot
     block, and it has no naming, layering or `extends` rules.
   - What only a workspace adds (intra-package layering, pooled cards) is ranked after
     everything else at each cap. It fills only the places that are left over.
   - Lift baselines stay repo-wide. Counting them per package was tried first: together
     with uncapped workspace cards, it dropped 23 build-set cards labelled ACCEPT, because
     a rule that most of one package follows has a lift of about 1.
3. **One scoped policy.** One root `.drift/`. A convention's scope is its role's
   `package` (each part's, for a pooled card). `conventions.yaml` version 2 adds
   `packages: [..]`, which `drift init` writes only for a repository of two or more
   packages. A single-package policy stays version 1, byte for byte. A version-1 file
   needs no migration: it reads as before, and the next `init` in a workspace upgrades it.
4. **Nearest scope.**
   - `check`, `review`, `example` and `export` run from a subdirectory without `--root`
     use the nearest policy above it, with file arguments made absolute.
   - The hooks use the policy nearest the edited file (relative paths from `cwd`), else
     the one above `cwd`.
   - MCP walks up from its start directory and accepts paths relative to it.
   - In a workspace, the hooks and MCP rules list only conventions of the file's package,
     and the agent text names it.
   - GitHub and SARIF paths are from the git top level.
5. **Python resolution (pilot coverage).**
   - (d) A dotted name that one distribution's regular package hides is resolved across
     every workspace distribution with that top-level directory, as site-packages merges
     them.
   - (e) A directory without `__init__.py` named like a declared dependency yields to the
     installed package.
   - (f) A `coverage/` directory that is a regular package is analysed by Python.
   - (g) FastAPI routes nested in an app factory are entry points. Python
     `LOWERING_VERSION` is now 17.
6. **Census.** `workspace` {`tools`, `packages[]`: path, languages, files, manifests,
   declared_by, roles, cards by tier, python_withheld, skipped by reason, silent reason}.
   It appears only in a repository of two or more packages.

## Not done (outside review, judged not cheap)

- (f′) Exclusions by name only when the directory is untracked. On the build set this
  would turn tracked `build/`, `vendor/` and `dist/` trees into source, which breaks the
  single-package guard.
- (j) Roles at namespace scope across distributions. Pooling covers one place in sibling
  packages. Distributions of one namespace hold different places (`acme/alpha`,
  `acme/beta`), so they would need another role key.

## Census (F11 binary vs this branch, `census --json --max 15`, 54 build repos)

- **Single-package** (at most one package with production files): 10 repos (4 named, 6
  dev3). All are byte-identical apart from `commit`.
- **Monorepos**: 44 repos.
  - No card is lost.
  - There are 8 new cards: InvenTree +2, formbricks +3, immich +1, lotus +1, and one dev3
    repo +1. All are default-tier layering inside one package, and all are unlabelled, so
    they need labels before F12.
  - Every other difference is the new `workspace` key; the `roles` count, which now
    includes pooled roles; rank shifts after the new default-tier cards; and one dev3
    Python repo with 24 more units (resolution and factory routes) and no card change.
- **Rejected first variant**: lift baselines per package, with workspace cards competing
  freely at the caps. It lost 23 cards labelled ACCEPT and 2 labelled WRONG, in ai,
  documenso, cal.com, formbricks, midday and novu. Most came from the baselines (a
  package-wide rule has a lift of about 1), and the rest were cross-package layering cards
  pushed out of the avoidance cap.

## Labels and the fold rule (intra-package layering)

**Labels.** The 8 new cards were labelled under rubric v3 by A (default model) and B
(sonnet), with C on disagreements only. Agreement was 7 of 8 (po 0.875, κ 0.742). C decided
the one split (InvenTree `D-45832d`, A WRONG / B ACCEPT) as WRONG `legit_outliers`.

| Repo (fold) | Card | Final | Why |
| --- | --- | --- | --- |
| InvenTree (1) | `D-1cda24` | WRONG | legit_outliers (A, B) |
| InvenTree (1) | `D-45832d` | WRONG | legit_outliers (C, sided with A) |
| immich (1) | `D-7220c1` | WRONG | misdescribes (A, B) |
| lotus (2) | `D-735bdf` | ACCEPT | A, B |
| formbricks (3) | `D-32d8c9` | WRONG | incidental (A, B) |
| formbricks (3) | `D-437c80` | WRONG | incidental (A, B) |
| formbricks (3) | `D-bf729d` | WRONG | A incidental, B legit_outliers |
| one dev3 repo (5) | 1 card | TRIVIAL | lint (A, B) |

Totals: 1 ACCEPT, 6 WRONG, 1 TRIVIAL.

**Fold rule** (PLAN-R10 §3.2). The mechanism was designed from the private pilot and synthetic
fixtures, so it has no design fold and every fold counts as "other".
- *Helps cards in ≥ 3 repos across ≥ 2 folds*: **no**. Only lotus (fold 2) gains an
  ACCEPT.
- *Costs no ACCEPT outside its design fold*: **yes**. No card is lost.
- *Other-fold effect positive*: **no**. It adds 1 ACCEPT against 6 WRONG and 1 TRIVIAL.

**Verdict: not admitted.** The intra-package layering drafts move behind
`experimental: [intra_package_layering]` (off by default; `DRIFT_EXPERIMENTAL` also works).
The rest of the workspace work stays on, because none of it adds cards on the build set:
discovery, the scoped policy, nearest-policy resolution, git-top paths, the census
`workspace` block, pooling, and the Python resolution and entry-point fixes.

With the flag off, the pilot's G1 shape is again 0 cards from the root, as at F11.
- The recurring WRONG kinds: `legit_outliers` (feature components that need shared form hooks) and `incidental` (the dominant direction inside one app is not a layer boundary).
- A layering signal inside one package needs evidence beyond import direction before it is shown, for example a declared boundary (lint `no-restricted-imports`, a package `exports` map) or a narrower area model.

## Decision and opting in

- **Decision.** `intra_package_layering` stays off by default [STRICT], because public precision is about 1/8.
- **Opting in.** A team opts in with `experimental: [intra_package_layering]` in `.drift/config.yaml` (or `DRIFT_EXPERIMENTAL`). This is the route for the private pilot. Its root then shows the 3 cards F11 `--root frontend` gave, labelled 2 ACCEPT and 1 WRONG.
- **Investigation of the 8 public cards.**
  - Each one equals F11's own `--root <package>` card: the same rule, holders, outliers and example. The mechanism matches per-package mining, and these packages mine poor layering cards on their own.
  - Two bugs were fixed. First, file kinds were learned repo-wide, so 5 formbricks files left their role at the root. Kinds are now learned per package, but only with the opt-in: with the defaults, per-package kinds reshaped roles in documenso and novu, and the new drafts took cap places from 2 cards labelled ACCEPT. So the default stays F11's repo-wide vocabulary [STRICT]. Second, intra-package targets rendered repo-relative next to a package-relative role; they now render from the package root.
  - immich's "misdescribes" is the layering rule's older silence on type-only imports. It is not specific to workspaces.
