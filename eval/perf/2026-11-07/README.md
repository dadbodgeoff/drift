# Performance check of 2026-11-06/07 (cd8296b → feefad6)

The ~28 PRs merged between cd8296b (that morning's base) and feefad6 (main when this
started) added entry classes, guard classifiers, followers' marks, wiring, parameter
types, continuation order and more. This report measures what they cost on the 34 dev
clones, finds the hotspots, and fixes the two that were small and obviously safe.

**The machine was shared.** Five to ten other agents were building and testing on the
same 4 CPUs (load average 5 to 19) during every run. Wall times are noisy; every number
below is the **minimum of 5 runs**, with the two binaries **interleaved** on each repo,
and CPU time (user + sys) and peak RSS are given next to wall time because they are less
sensitive to contention.

## How it was measured

- **Binaries.** Release builds of cd8296b and feefad6, each with a profile override
  unique to this agent (so no other worktree's artifacts could be linked in), all five
  workspace crates compiled in the same locked build. Each was then checked **by
  behaviour**: its `census --json` is byte-identical (the `commit` field aside) to a
  build made with `shared/build-verified.sh` (CGU 122 for cd8296b, 22 for feefad6) on
  all 34 clones, while the two commits differ on all 34. The fix was timed against
  f293f1c (main when the fix was finished), both built with `build-verified.sh`
  (CGU 122 for main, 22 for the fix head).
- **Metrics.** No `/usr/bin/time` or `perf` was installed, so `scripts/measure.py` runs
  each command under `os.wait4` (wall time, user + sys CPU, `ru_maxrss`).
  - `census --json --max 15`, **cold**: private, empty `DRIFT_CACHE_DIR`;
  - the same, **warm**: second run on that cache;
  - `check <file>` on one representative file (the rank-1 proposal's example; the
    middle source file when a repo has no proposal), warm cache, every proposal of
    that binary's own `init --max 15` accepted;
  - the **hook path**: `drift hook claude PostToolUse` on that file, unchanged
    ("hook") and after appending a comment line ("hook+edit", so its hash is new).
  `check` and the hook ran on a hardlinked copy of each clone (`cp -al`, fresh `.git`
  with the clone's objects as alternates); edits replaced the file by rename, so the
  clones were never written.
- **Profiles.** `valgrind --tool=callgrind` (instruction counts, line tables on) of warm
  census on py/netbox and ts/documenso, `massif` on ts/ai, and a phase-timing build
  (`scripts/instr.patch`, never committed).

Raw rows: `before-after.jsonl` (1,703 measurements) and `hook-full-scan.jsonl`
(495 hook runs). Scripts: `scripts/` (paths in them point at the session's scratch
folder).

## Before and after (cd8296b → feefad6)

Minimum of 5, `before → after (ratio)`. MB is peak RSS.

| repo | cold s | cold MB | warm s | warm MB | check s | check MB | hook s | hook+edit s |
|---|---|---|---|---|---|---|---|---|
| ts/ai | 2.53 → 3.09 (1.22×) | 157 → 265 (1.69×) | 1.02 → 1.34 (1.31×) | 163 → 243 (1.49×) | 0.69 → 0.97 (1.42×) | 153 → 236 (1.54×) | 0.06 → 0.07 (1.10×) | 0.06 → 0.07 (1.19×) |
| ts/cal.com | 2.20 → 2.85 (1.30×) | 143 → 238 (1.67×) | 0.91 → 1.32 (1.46×) | 145 → 209 (1.44×) | 1.09 → 1.58 (1.45×) | 134 → 197 (1.47×) | 0.12 → 0.13 (1.03×) | 0.11 → 0.11 (1.00×) |
| ts/create-t3-app | 0.06 → 0.10 (1.52×) | 14 → 19 (1.31×) | 0.04 → 0.05 (1.51×) | 14 → 18 (1.27×) | 0.04 → 0.04 (1.04×) | 14 → 18 (1.25×) | 0.00 → 0.01 (1.48×) | 0.00 → 0.00 (0.97×) |
| ts/documenso | 1.64 → 1.91 (1.16×) | 91 → 143 (1.57×) | 0.55 → 0.78 (1.43×) | 91 → 124 (1.35×) | 0.41 → 0.65 (1.57×) | 81 → 112 (1.38×) | 0.04 → 0.04 (1.12×) | 0.03 → 0.04 (1.15×) |
| ts/dub | 2.39 → 2.53 (1.06×) | 116 → 180 (1.56×) | 1.14 → 1.23 (1.08×) | 118 → 163 (1.38×) | 0.83 → 1.27 (1.53×) | 103 → 148 (1.43×) | 0.03 → 0.04 (1.30×) | 0.04 → 0.04 (1.10×) |
| ts/excalidraw | 0.56 → 0.83 (1.48×) | 39 → 81 (2.09×) | 0.15 → 0.23 (1.50×) | 38 → 56 (1.47×) | 0.15 → 0.19 (1.25×) | 36 → 53 (1.49×) | 0.02 → 0.03 (1.72×) | 0.02 → 0.03 (1.14×) |
| ts/formbricks | 1.70 → 2.35 (1.38×) | 192 → 311 (1.62×) | 0.92 → 1.28 (1.39×) | 194 → 281 (1.44×) | 0.82 → 1.15 (1.40×) | 175 → 260 (1.49×) | 0.06 → 0.06 (1.12×) | 0.07 → 0.09 (1.19×) |
| ts/immich | 0.66 → 1.03 (1.56×) | 51 → 90 (1.77×) | 0.23 → 0.36 (1.57×) | 50 → 74 (1.47×) | 0.20 → 0.30 (1.54×) | 47 → 70 (1.49×) | 0.03 → 0.03 (0.90×) | 0.03 → 0.04 (1.31×) |
| ts/infisical | 3.10 → 4.97 (1.60×) | 308 → 472 (1.53×) | 1.78 → 2.54 (1.43×) | 314 → 467 (1.48×) | 0.98 → 1.71 (1.75×) | 271 → 424 (1.56×) | 0.07 → 0.10 (1.36×) | 0.08 → 0.10 (1.35×) |
| ts/midday | 0.87 → 1.06 (1.22×) | 73 → 132 (1.79×) | 0.43 → 0.56 (1.32×) | 74 → 106 (1.44×) | 0.26 → 0.42 (1.61×) | 65 → 96 (1.48×) | 0.03 → 0.04 (1.60×) | 0.04 → 0.05 (1.42×) |
| ts/nest | 0.81 → 0.77 (0.94×) | 51 → 87 (1.71×) | 0.24 → 0.28 (1.16×) | 51 → 70 (1.38×) | 0.21 → 0.30 (1.47×) | 51 → 70 (1.38×) | 0.02 → 0.03 (1.19×) | 0.03 → 0.04 (1.32×) |
| ts/node-express-boilerplate | 0.04 → 0.03 (0.62×) | 12 → 14 (1.19×) | 0.02 → 0.02 (1.24×) | 11 → 13 (1.22×) | - | - | - | - |
| ts/novu | 3.81 → 5.46 (1.43×) | 246 → 388 (1.58×) | 2.08 → 2.93 (1.40×) | 252 → 381 (1.51×) | 1.61 → 2.68 (1.67×) | 221 → 352 (1.59×) | 0.14 → 0.17 (1.23×) | 0.13 → 0.21 (1.58×) |
| ts/supabase | 3.59 → 4.65 (1.30×) | 239 → 349 (1.46×) | 1.93 → 2.48 (1.28×) | 244 → 342 (1.40×) | 1.46 → 2.33 (1.60×) | 217 → 316 (1.46×) | 0.14 → 0.18 (1.25×) | 0.15 → 0.17 (1.13×) |
| ts/trpc | 0.77 → 1.04 (1.35×) | 37 → 60 (1.59×) | 0.15 → 0.21 (1.42×) | 37 → 52 (1.41×) | 0.17 → 0.27 (1.55×) | 36 → 51 (1.40×) | 0.00 → 0.00 (0.89×) | 0.00 → 0.00 (1.43×) |
| ts/twenty | 14.53 → 13.57 (0.93×) | 836 → 1228 (1.47×) | 6.29 → 10.24 (1.63×) | 863 → 1233 (1.43×) | 5.79 → 7.81 (1.35×) | 782 → 1154 (1.48×) | 0.34 → 0.49 (1.43×) | 0.27 → 0.55 (2.00×) |
| py/fastapi | 0.42 → 0.55 (1.31×) | 52 → 62 (1.19×) | 0.21 → 0.27 (1.28×) | 51 → 59 (1.14×) | 0.26 → 0.39 (1.51×) | 50 → 58 (1.15×) | 0.06 → 0.06 (1.16×) | 0.09 → 0.07 (0.87×) |
| py/flask | 0.21 → 0.13 (0.62×) | 15 → 17 (1.17×) | 0.03 → 0.04 (1.47×) | 14 → 16 (1.16×) | 0.03 → 0.06 (1.67×) | 15 → 16 (1.08×) | 0.00 → 0.00 (0.97×) | 0.01 → 0.00 (0.61×) |
| py/full-stack-fastapi-template | 0.14 → 0.18 (1.30×) | 15 → 18 (1.23×) | 0.04 → 0.04 (1.02×) | 14 → 17 (1.20×) | 0.04 → 0.04 (0.85×) | 15 → 16 (1.10×) | 0.01 → 0.01 (0.88×) | 0.02 → 0.02 (1.22×) |
| py/langchain | 2.42 → 2.23 (0.92×) | 116 → 136 (1.18×) | 0.57 → 0.86 (1.51×) | 117 → 134 (1.15×) | 0.57 → 0.78 (1.36×) | 115 → 131 (1.14×) | 0.53 → 0.85 (1.60×) | 0.62 → 0.80 (1.29×) |
| py/netbox | 2.43 → 2.99 (1.23×) | 127 → 163 (1.28×) | 1.20 → 1.70 (1.42×) | 131 → 162 (1.24×) | 0.86 → 1.22 (1.43×) | 125 → 152 (1.22×) | 0.18 → 0.17 (0.96×) | 0.19 → 0.29 (1.54×) |
| py/saleor | 3.40 → 4.07 (1.20×) | 211 → 206 (0.98×) | 1.35 → 1.59 (1.18×) | 216 → 249 (1.15×) | 0.96 → 1.52 (1.60×) | 205 → 205 (1.00×) | 0.20 → 0.28 (1.42×) | 0.24 → 0.21 (0.90×) |
| py2/Django-CRM | 0.98 → 1.94 (1.98×) | 106 → 125 (1.18×) | 0.52 → 0.57 (1.11×) | 106 → 124 (1.17×) | 0.72 → 0.81 (1.12×) | 106 → 118 (1.11×) | 0.17 → 0.20 (1.14×) | 0.16 → 0.16 (1.00×) |
| py2/InvenTree | 0.66 → 0.84 (1.29×) | 67 → 87 (1.31×) | 0.34 → 0.42 (1.23×) | 72 → 77 (1.08×) | 0.36 → 0.40 (1.12×) | 67 → 74 (1.10×) | 0.09 → 0.09 (1.02×) | 0.09 → 0.09 (1.02×) |
| py2/Misago | 1.15 → 1.26 (1.10×) | 109 → 132 (1.21×) | 0.46 → 0.64 (1.40×) | 110 → 130 (1.18×) | 0.40 → 0.49 (1.21×) | 106 → 125 (1.18×) | 0.10 → 0.11 (1.05×) | 0.11 → 0.11 (0.98×) |
| py2/changedetection.io | 0.33 → 0.34 (1.03×) | 35 → 43 (1.22×) | 0.10 → 0.12 (1.27×) | 34 → 40 (1.17×) | 0.10 → 0.11 (1.08×) | 34 → 39 (1.15×) | 0.06 → 0.07 (1.09×) | 0.08 → 0.07 (0.99×) |
| py2/lotus | 0.16 → 0.15 (0.96×) | 30 → 39 (1.31×) | 0.09 → 0.10 (1.12×) | 29 → 34 (1.15×) | 0.06 → 0.08 (1.29×) | 28 → 32 (1.15×) | 0.03 → 0.04 (1.07×) | 0.03 → 0.04 (1.14×) |
| py2/open-wearables | 0.55 → 0.68 (1.24×) | 68 → 81 (1.19×) | 0.22 → 0.27 (1.22×) | 68 → 80 (1.19×) | 0.18 → 0.25 (1.38×) | 66 → 77 (1.17×) | 0.06 → 0.08 (1.27×) | 0.07 → 0.07 (1.07×) |
| py2/paperless-ngx | 0.38 → 0.31 (0.82×) | 45 → 58 (1.30×) | 0.14 → 0.19 (1.32×) | 45 → 53 (1.18×) | 0.12 → 0.16 (1.29×) | 45 → 51 (1.13×) | 0.01 → 0.01 (1.06×) | 0.02 → 0.02 (0.98×) |
| py2/pontoon | 0.38 → 0.36 (0.95×) | 39 → 47 (1.19×) | 0.12 → 0.14 (1.26×) | 40 → 43 (1.08×) | 0.10 → 0.14 (1.36×) | 37 → 41 (1.12×) | 0.01 → 0.02 (1.21×) | 0.02 → 0.02 (1.05×) |
| py2/ralph | 0.38 → 0.43 (1.13×) | 45 → 54 (1.21×) | 0.15 → 0.21 (1.38×) | 45 → 53 (1.18×) | 0.14 → 0.19 (1.37×) | 44 → 51 (1.17×) | 0.05 → 0.06 (1.11×) | 0.05 → 0.06 (1.07×) |
| py2/simplelogin | 0.43 → 0.47 (1.11×) | 41 → 49 (1.19×) | 0.13 → 0.17 (1.29×) | 41 → 47 (1.15×) | 0.10 → 0.13 (1.31×) | 39 → 45 (1.18×) | 0.03 → 0.04 (1.10×) | 0.04 → 0.04 (1.09×) |
| py2/tasking-manager | 0.47 → 0.74 (1.57×) | 40 → 50 (1.26×) | 0.14 → 0.26 (1.77×) | 40 → 44 (1.09×) | 0.12 → 0.26 (2.14×) | 37 → 41 (1.10×) | 0.04 → 0.04 (1.09×) | 0.04 → 0.04 (1.03×) |
| py2/wger | 0.45 → 0.52 (1.16×) | 36 → 42 (1.18×) | 0.16 → 0.19 (1.15×) | 35 → 40 (1.16×) | 0.13 → 0.15 (1.18×) | 35 → 40 (1.14×) | 0.06 → 0.06 (1.01×) | 0.06 → 0.06 (0.99×) |

### Summary

| set | metric | wall (geo-mean, max) | CPU (geo-mean, max) | RSS (geo-mean, max) |
|---|---|---|---|---|
| TS (16) | census cold | 1.22×, 1.60× | 1.29×, 2.11× | 1.59×, 2.09× |
| TS (16) | census warm | 1.38×, 1.63× | 1.30×, 1.50× | 1.41×, 1.51× |
| TS (16) | check FILE | 1.47×, 1.75× | 1.41×, 1.81× | 1.46×, 1.59× |
| TS (16) | hook | 1.23×, 1.72× | 1.15×, 1.54× | 1.26×, 1.55× |
| TS (16) | hook+edit | 1.26×, 2.00× | 1.16×, 1.43× | 1.19×, 1.40× |
| Python (18) | census cold | 1.13×, 1.98× | 1.05×, 1.45× | 1.21×, 1.31× |
| Python (18) | census warm | 1.29×, 1.77× | 1.29×, 1.74× | 1.16×, 1.24× |
| Python (18) | check FILE | 1.32×, 2.14× | 1.28×, 1.69× | 1.13×, 1.22× |
| Python (18) | hook | 1.11×, 1.60× | 1.08×, 1.35× | 1.09×, 1.20× |
| Python (18) | hook+edit | 1.03×, 1.54× | 1.08×, 1.35× | 1.09×, 1.17× |

### Flags

By the bars of the task (1.3× time or memory on any metric; on the hook path 1.2× or
500 ms), **every TypeScript repo is flagged**, on memory in every case: peak RSS is
1.4–2.1× on census and `check`, and twenty peaks at 1.23 GB (was 0.84 GB). CPU is
1.3–1.5× on most TS repos. Python repos are flagged on CPU (warm census and `check`
1.2–1.8×) and at most 1.31× on memory.

On the hook path (`hook`, `hook+edit`):

- **ts/twenty, hook+edit: 0.27 → 0.55 s (2.0×), over 500 ms.** The single-file scan
  itself got slower (larger facts and the type index for the edited file); no full scan.
- **py/langchain: 0.53 → 0.85 s (1.6×), over 500 ms, before and after.** The
  representative file is `libs/core/pyproject.toml` (a dependency-version
  convention's example); a manifest edit always takes a full scan, so this is the
  warm census path, slower as above.
- Over 1.2× but under 500 ms: novu (0.13 → 0.21 s), infisical (0.08 → 0.11 s),
  netbox (0.19 → 0.29 s), saleor (0.20 → 0.28 s), midday, supabase; hook RSS
  1.2–1.55× on ai, cal.com, formbricks, infisical, midday, novu, supabase, twenty
  (all under 105 MB).

Single-file `check` (a full warm scan, not the hook path) is over 500 ms on 12 repos
before and 13 after; it is 1.35–1.75× on the large TS repos.

## #64: how often a hook falls back to a full scan

Since #64 a single-file hook scans the whole repo when the edited file holds a class
that some accepted convention exempts. An instrumented build printed, for every hook,
whether `needs_full_scan` was true, and whether it would have been without #64's two
branches (`PassesKey` among the wrapped rules, and the one-file entry-class branch of
`exemption_undecided`).

- **Sample:** 15 source files per repo, drawn uniformly (seeded) from each clone's
  tracked TS/JS/Python files, each edited (a comment line appended), 495 hooks on 33
  repos (node-express-boilerplate has no proposal, so nothing is accepted and the hook
  exits at once; 45 hooks fell in such repos). Every proposal accepted: the strict
  case. Key rules were accepted in 9 repos, wrapper rules in most.
- **#64 caused 0 of 495 full scans** (95% upper bound ≈ 0.6%, rule of three).
- 10 of 495 hooks (2.0%) did a full scan: 7 because the Python single-file scan
  declined (`scan_file` returned `None`, e.g. when another production file may extend
  one of the edited file's classes; fastapi, langchain ×2, InvenTree, lotus,
  paperless-ngx, wger), and 3 because `needs_full_scan` was true with or without #64's
  branches (cal.com, novu, InvenTree). Neither group was attributed to a PR.
- A one-file hook took 0.065 s (median; max 0.77 s); a full-scan hook 0.48 s (median;
  max 3.5 s on novu).

## Where the time and memory went

Instruction counts (callgrind, warm census, single-threaded profile):

| repo | before | after | |
|---|---|---|---|
| py/netbox | 5.63 G | 7.56 G | +34% |
| ts/documenso | 3.90 G | 4.93 G | +26% |

Hotspots, by what they added (file:line on f293f1c):

1. **TS parameter types, package callees** (#34). `TypeIndex::param_shape`
   (`crates/drift-ts/src/typeres.rs`) resolved the callee's declaration file with the
   module resolver (`types_path` → oxc `resolve`) on every call that passes an object
   to a package function: 347 M instructions, 7% of documenso. **Fixed** (below).
2. **Package containment in mining.** `RepoContext::module_in`
   (`crates/drift-mine/src/context.rs:1150`) formatted `"<path>/"` for every workspace
   package on every import `signals` checked (12,357 calls, 191 M on documenso; it
   scales with packages × imports, so most on the monorepos). **Fixed** (below).
3. **Python registries** (#38 wiring). `Linker::registry`
   (`crates/drift-py/src/link.rs:1873`) resolves every string in every module-level
   list, tuple or dict binding as a module path (`__all__` entries included), through
   `Resolver::resolve` (`crates/drift-py/src/resolve.rs:297`), whose cache is keyed by
   the file's directory: 839 M, **11% of netbox**. Not fixed: cheaper candidates (no
   `__all__`, or names that cannot be modules) change the facts and need the owner's
   call and a lowering bump; caching `basedir` (`resolve.rs:230`, 289 M, uncached
   walk up the tree) is safe and would recover a quarter of it.
4. **`RepoContext::new`** grew from 0.6 G to 2.0 G on netbox and from 0.01 G to 0.6 G
   on documenso: `Parts::new` (`crates/drift-mine/src/parts.rs:171`, 0.2–0.4 G),
   `attributes`, `team_versions`, and `ancestors(repo)`, which is computed twice
   (`context.rs:373` and again inside `attributes`, `context.rs:1369`). Not fixed:
   sharing the ancestor map is safe but small; `Parts::new` needs its owner.
5. **Bigger facts.** Deserialising `RawSymbol` and `RawRef` from the cache alone
   added ~0.6 G on documenso (more fields: param types, loads, registries). Inherent
   in the features.
6. **TS memory (peak heap 137 → 245 MB on ts/ai, massif).** All of it during the TS
   scan's link phase: declaration files outside the scan are lowered afresh on every
   run and kept (`TypeIndex::load_path`, `typeres.rs:582`; 17 MB on ai); each module
   the type index reads deep-copies the file's `RawTypes`
   (`crates/drift-ts/src/lib.rs:136`, `f.raw.types.clone()`; ~9 MB of `PropT`/`TExpr`
   clones on ai); and the larger raw facts are held alongside the linked ones. The
   512 MB `has_headroom` reservation (`crates/drift-core/src/stack.rs:211`) shows in
   massif but is never touched and costs no RSS. Not fixed: holding `RawTypes` behind
   an `Arc` and caching lowered declaration files in the fact cache are the two
   levers; both change data structures that other PRs are editing.
7. On ts/twenty, the TS scan's pre-link phase takes 2.2 s of a 5.6 s warm scan
   (phase build): config, resolver, linker setup and `augmented_names`
   (`typeres.rs:344`, which reads and lowers every skipped declaration file that
   says `declare module` on every run). Not split further before the build was lost to
   the machine's OOM restart.
8. Not a regression, but cheap: `ModuleResolver::workspace_source_target`
   (`crates/drift-ts/src/resolve.rs:438`) reads and parses the package's
   `package.json` on every unresolved workspace import (257 M on documenso); caching
   the parsed `exports` per package directory is safe.

## The fix

- `TypeIndex::package_module` memoises a package callee's declarations per
  `(directory, specifier)`, as the index's other memos do (`types_path` and
  `load_path` are pure for a scan). Test: two installed copies of one package with
  different parameter types, two files each; each directory reads its own copy, at
  1 and 4 threads. Mutation: keying the memo by specifier alone fails it.
- `RepoContext::module_in` tests containment on the segment boundary without
  allocating. Test: `packages/ui` contains `packages/ui/src/x.tsx`, not
  `packages/ui-kit/src/x.tsx`, nor `packages/ui` itself. Mutation: dropping the `/`
  check fails it.

**Effect** (f293f1c vs the fix head, `census --json --max 15`, min of 5, interleaved;
both built with `build-verified.sh`, CGU 122 vs 22, so the two sides share one
codegen-units scheme): the census output is **byte-identical on all 34 clones** (the
`commit` field aside), and again after merging 88d4030 (one cold census per side). Warm census CPU on the TS repos drops 4.3% (geometric mean;
documenso −11%, supabase −10%, cal.com −4%); Python is unchanged (the fixes touch TS
and mining code that Python repos rarely reach); peak RSS is unchanged everywhere.
This recovers a small part of the regression: the memory growth and the Python cost
(hotspots 3–6) are untouched. Wall-time ratios below swing ±20% from run to run on
the shared machine (twenty's warm wall 1.18× next to its CPU 0.99×); read the CPU
column.

<details><summary>Per repo, f293f1c → fix</summary>

| repo | warm s | warm CPU s | warm MB | cold s | cold CPU s |
|---|---|---|---|---|---|
| ts/ai | 0.99 → 0.91 (0.92×) | 1.66 → 1.55 (0.94×) | 246 → 246 (1.00×) | 1.54 → 1.49 (0.97×) | 3.31 → 3.17 (0.96×) |
| ts/cal.com | 1.10 → 1.01 (0.92×) | 1.60 → 1.54 (0.96×) | 212 → 212 (1.00×) | 1.84 → 1.49 (0.81×) | 3.47 → 3.07 (0.88×) |
| ts/create-t3-app | 0.06 → 0.05 (0.92×) | 0.05 → 0.05 (1.02×) | 19 → 19 (1.02×) | 0.10 → 0.09 (0.98×) | 0.10 → 0.11 (1.01×) |
| ts/documenso | 0.65 → 0.54 (0.82×) | 0.83 → 0.73 (0.89×) | 126 → 126 (1.00×) | 1.11 → 1.40 (1.26×) | 2.28 → 2.11 (0.92×) |
| ts/dub | 0.99 → 1.28 (1.29×) | 1.64 → 1.64 (1.00×) | 164 → 165 (1.00×) | 2.02 → 2.03 (1.01×) | 3.65 → 3.13 (0.86×) |
| ts/excalidraw | 0.20 → 0.19 (0.95×) | 0.23 → 0.24 (1.06×) | 58 → 58 (1.00×) | 0.59 → 0.55 (0.94×) | 0.73 → 0.81 (1.11×) |
| ts/formbricks | 1.26 → 1.15 (0.92×) | 1.83 → 1.80 (0.99×) | 284 → 283 (1.00×) | 2.02 → 2.05 (1.01×) | 4.01 → 4.11 (1.02×) |
| ts/immich | 0.25 → 0.24 (0.96×) | 0.38 → 0.36 (0.96×) | 76 → 76 (1.00×) | 0.66 → 0.64 (0.97×) | 1.40 → 1.29 (0.93×) |
| ts/infisical | 2.45 → 2.29 (0.94×) | 3.46 → 3.23 (0.93×) | 470 → 471 (1.00×) | 3.43 → 3.19 (0.93×) | 5.91 → 5.80 (0.98×) |
| ts/midday | 0.48 → 0.44 (0.93×) | 0.67 → 0.62 (0.92×) | 108 → 108 (1.00×) | 0.57 → 0.82 (1.44×) | 1.15 → 1.88 (1.63×) |
| ts/nest | 0.28 → 0.32 (1.12×) | 0.40 → 0.42 (1.04×) | 72 → 72 (1.00×) | 0.70 → 0.66 (0.94×) | 1.44 → 1.43 (0.99×) |
| ts/node-express-boilerplate | 0.02 → 0.02 (0.85×) | 0.02 → 0.02 (0.79×) | 15 → 14 (0.98×) | 0.02 → 0.02 (1.03×) | 0.03 → 0.03 (0.88×) |
| ts/novu | 2.06 → 2.02 (0.98×) | 3.49 → 3.49 (1.00×) | 384 → 384 (1.00×) | 2.90 → 2.44 (0.84×) | 5.34 → 5.31 (0.99×) |
| ts/supabase | 1.69 → 1.65 (0.98×) | 2.96 → 2.67 (0.90×) | 345 → 346 (1.00×) | 2.20 → 2.04 (0.93×) | 4.86 → 4.40 (0.91×) |
| ts/trpc | 0.17 → 0.19 (1.10×) | 0.25 → 0.24 (0.95×) | 53 → 53 (1.00×) | 0.32 → 0.37 (1.17×) | 0.53 → 0.62 (1.17×) |
| ts/twenty | 6.33 → 7.47 (1.18×) | 9.71 → 9.62 (0.99×) | 1239 → 1241 (1.00×) | 9.25 → 10.91 (1.18×) | 17.02 → 16.44 (0.97×) |
| py/fastapi | 0.23 → 0.25 (1.10×) | 0.27 → 0.28 (1.04×) | 60 → 60 (1.00×) | 0.47 → 0.36 (0.76×) | 0.63 → 0.63 (1.00×) |
| py/flask | 0.04 → 0.04 (0.98×) | 0.03 → 0.03 (0.97×) | 16 → 17 (1.03×) | 0.13 → 0.14 (1.07×) | 0.14 → 0.12 (0.92×) |
| py/full-stack-fastapi-template | 0.05 → 0.05 (1.10×) | 0.03 → 0.04 (1.18×) | 17 → 17 (0.99×) | 0.19 → 0.19 (1.01×) | 0.16 → 0.17 (1.03×) |
| py/langchain | 0.72 → 0.70 (0.98×) | 0.81 → 0.86 (1.06×) | 136 → 135 (0.99×) | 1.79 → 1.78 (0.99×) | 2.47 → 2.49 (1.01×) |
| py/netbox | 0.99 → 0.96 (0.96×) | 1.06 → 1.05 (0.99×) | 163 → 163 (1.00×) | 1.70 → 1.79 (1.06×) | 2.18 → 2.27 (1.04×) |
| py/saleor | 1.27 → 1.14 (0.90×) | 1.41 → 1.40 (0.99×) | 251 → 251 (1.00×) | 2.05 → 2.12 (1.03×) | 3.81 → 3.75 (0.98×) |
| py2/Django-CRM | 0.57 → 0.55 (0.97×) | 0.60 → 0.58 (0.97×) | 126 → 125 (1.00×) | 1.60 → 1.48 (0.93×) | 1.99 → 2.06 (1.03×) |
| py2/InvenTree | 0.54 → 0.51 (0.95×) | 0.50 → 0.49 (0.98×) | 78 → 78 (1.00×) | 1.03 → 1.09 (1.06×) | 1.56 → 1.42 (0.91×) |
| py2/Misago | 0.61 → 0.67 (1.11×) | 0.73 → 0.71 (0.97×) | 131 → 131 (1.00×) | 1.42 → 1.81 (1.27×) | 2.17 → 2.09 (0.96×) |
| py2/changedetection.io | 0.16 → 0.16 (0.98×) | 0.15 → 0.16 (1.05×) | 41 → 41 (1.00×) | 0.56 → 0.64 (1.14×) | 0.70 → 0.68 (0.96×) |
| py2/lotus | 0.16 → 0.15 (0.92×) | 0.13 → 0.13 (0.98×) | 35 → 35 (0.99×) | 0.43 → 0.37 (0.86×) | 0.47 → 0.35 (0.74×) |
| py2/open-wearables | 0.44 → 0.45 (1.03×) | 0.40 → 0.38 (0.95×) | 82 → 82 (1.00×) | 1.42 → 1.27 (0.89×) | 1.40 → 1.30 (0.93×) |
| py2/paperless-ngx | 0.25 → 0.26 (1.02×) | 0.29 → 0.29 (0.99×) | 54 → 54 (1.00×) | 0.57 → 0.55 (0.97×) | 0.75 → 0.85 (1.14×) |
| py2/pontoon | 0.17 → 0.18 (1.08×) | 0.21 → 0.21 (1.01×) | 44 → 44 (1.00×) | 0.45 → 0.38 (0.85×) | 0.54 → 0.57 (1.05×) |
| py2/ralph | 0.23 → 0.25 (1.12×) | 0.27 → 0.27 (0.97×) | 54 → 53 (0.99×) | 0.45 → 0.45 (1.01×) | 0.52 → 0.76 (1.46×) |
| py2/simplelogin | 0.17 → 0.21 (1.27×) | 0.20 → 0.20 (0.99×) | 49 → 48 (0.99×) | 0.42 → 0.50 (1.20×) | 0.51 → 0.70 (1.37×) |
| py2/tasking-manager | 0.28 → 0.19 (0.67×) | 0.29 → 0.26 (0.91×) | 44 → 45 (1.02×) | 0.60 → 0.57 (0.96×) | 1.10 → 0.97 (0.88×) |
| py2/wger | 0.14 → 0.22 (1.51×) | 0.18 → 0.18 (1.03×) | 42 → 42 (0.99×) | 0.48 → 0.52 (1.07×) | 0.57 → 0.56 (0.98×) |

</details>

Raw rows: `fix-main-vs-head.jsonl`.

## Not done

- Hotspots 3–8 above: written up, not fixed (owners' features, or data-structure
  changes that collide with open work).
- The hook bar is missed on twenty (0.55 s on an edit) and langchain (0.85 s, a
  manifest edit, so a full scan); neither is caused by #64.
- No `perf` on this machine; profiles are callgrind/massif instruction and heap
  counts, which do not see I/O or contention.

## Follow-up: the large hotspots (ws/perf-fixes-2)

The four large hotspots above, in the order they were assigned: TS memory,
`RepoContext::new`, Python registries, and the twenty hook. Nothing a scan, `check` or a
hook outputs changes.

### How it was measured

- **Binaries.** main e9c6058 (#86 and #88 merged; main later moved to 75933aa, whose
  changes are all under `eval/`) and the branch head, both built with
  `shared/build-verified.sh` (CGU 131 for main, 31 for the head). Each was checked by
  behaviour too: only the head writes the `ts-types-…` cache directory this branch
  adds.
- **Runs.** The same as above: `scripts/measure.py`, min of 5, the two binaries
  interleaved (the order alternates each round), CPU (user + sys) and peak RSS, wall
  time only for reference. Census cold (empty private cache) and warm on all 34
  clones; `check FILE`, the hook, and the hook after an edit on a hardlinked work copy
  of the 13 TS repos that have proposals and of three Python repos, with every proposal
  of main's `init --max 15` accepted (one policy for both binaries). Scripts:
  `followup/scripts/` (`bench2.py`, `summ.py`, `doc_tables.py`, `rssprof.py`,
  `cgdiff.py`; paths in them point at the session's scratch folder).
- **Profiles.** callgrind on warm census (netbox) and on the hook after an edit
  (twenty); massif on warm census (ai, twenty); `rssprof.py`, which samples
  `/proc/<pid>/smaps` every 20 ms and splits the peak by mapping.

### Results (main → branch head)

Minimum of 5, `main → head (ratio)`; CPU is user + sys seconds, MB is peak RSS.

| set | metric | CPU (geo-mean, range) | peak RSS (geo-mean, range) | wall (geo-mean, range) |
|---|---|---|---|---|
| TS (16) | census cold | 0.98×, 0.88–1.15× | 0.79×, 0.71–0.95× | 0.98×, 0.85–1.13× |
| TS (16) | census warm | 0.97×, 0.86–1.04× | 0.78×, 0.72–0.94× | 0.99×, 0.89–1.07× |
| TS (13) | check FILE | 0.98×, 0.93–1.04× | 0.82×, 0.79–0.87× | 1.00×, 0.91–1.06× |
| TS (13) | hook | 0.88×, 0.80–1.02× | 0.89×, 0.83–0.93× | 0.90×, 0.75–1.01× |
| TS (13) | hook+edit | 0.90×, 0.84–1.02× | 0.93×, 0.83–0.98× | 0.93×, 0.81–1.03× |
| Python (18) | census cold | 1.02×, 0.85–2.44× | 0.81×, 0.70–0.97× | 0.99×, 0.86–1.73× |
| Python (18) | census warm | 0.91×, 0.62–1.02× | 0.77×, 0.59–0.92× | 0.95×, 0.73–1.09× |
| Python (3) | check FILE | 0.84×, 0.73–0.93× | 0.74×, 0.64–0.86× | 0.89×, 0.79–0.96× |
| Python (3) | hook | 0.85×, 0.73–0.92× | 1.00×, 0.99–1.01× | 0.91×, 0.84–0.96× |
| Python (3) | hook+edit | 0.87×, 0.85–0.91× | 0.99×, 0.99–1.00× | 0.91×, 0.88–0.95× |

Cold-census CPU is mostly the system time of writing ~7,500 cache files, which varies
2–5× between runs of one binary on this machine; user time alone is 0.99× on TS
(0.80–1.10×) and 0.95× on Python. The 2.44× maximum is fastapi: main's first cold run
took 0.16 s of system time against 1.0 s in its other four, and the minimum picked it.
Warm user time is 0.97× on TS and 0.87× on Python.

twenty and netbox:

| repo | metric | CPU s | peak MB | wall s |
|---|---|---|---|---|
| ts/twenty | census cold | 18.33 → 16.22 (0.88×) | 1248 → 963 (0.77×) | 8.76 → 8.16 (0.93×) |
| ts/twenty | census warm | 11.94 → 11.24 (0.94×) | 1256 → 985 (0.78×) | 6.86 → 6.67 (0.97×) |
| ts/twenty | check FILE | 9.21 → 8.76 (0.95×) | 1177 → 988 (0.84×) | 4.90 → 4.77 (0.97×) |
| ts/twenty | hook | 0.56 → 0.47 (0.84×) | 105 → 94 (0.90×) | 0.26 → 0.23 (0.89×) |
| ts/twenty | hook+edit | 0.55 → 0.46 (0.84×) | 106 → 95 (0.90×) | 0.25 → 0.22 (0.90×) |
| py/netbox | census cold | 2.64 → 2.24 (0.85×) | 165 → 123 (0.74×) | 1.24 → 1.14 (0.92×) |
| py/netbox | census warm | 1.26 → 1.00 (0.79×) | 164 → 97 (0.59×) | 0.80 → 0.76 (0.94×) |
| py/netbox | check FILE | 1.06 → 0.77 (0.73×) | 155 → 100 (0.64×) | 0.59 → 0.47 (0.79×) |
| py/netbox | hook | 0.17 → 0.16 (0.91×) | 26 → 26 (1.01×) | 0.10 → 0.09 (0.92×) |
| py/netbox | hook+edit | 0.18 → 0.15 (0.86×) | 26 → 26 (1.00×) | 0.10 → 0.09 (0.88×) |

The hook on every TS repo with proposals (create-t3-app, node-express-boilerplate and
trpc have none at `--max 15` on main, so their hook exits at once), and three Python
repos:

| repo | hook s | hook+edit s | hook+edit CPU s | hook+edit MB |
|---|---|---|---|---|
| ts/ai | 0.06 → 0.05 (0.97×) | 0.06 → 0.06 (0.97×) | 0.11 → 0.10 (0.92×) | 30 → 27 (0.92×) |
| ts/cal.com | 0.07 → 0.06 (0.88×) | 0.07 → 0.06 (0.88×) | 0.12 → 0.11 (0.91×) | 23 → 22 (0.94×) |
| ts/documenso | 0.03 → 0.02 (0.88×) | 0.03 → 0.03 (0.94×) | 0.05 → 0.04 (0.87×) | 17 → 16 (0.96×) |
| ts/dub | 0.04 → 0.03 (0.89×) | 0.04 → 0.04 (0.94×) | 0.07 → 0.06 (0.89×) | 20 → 19 (0.94×) |
| ts/excalidraw | 0.02 → 0.02 (0.88×) | 0.02 → 0.02 (1.00×) | 0.04 → 0.04 (0.97×) | 18 → 17 (0.93×) |
| ts/formbricks | 0.05 → 0.05 (0.90×) | 0.05 → 0.05 (0.95×) | 0.10 → 0.09 (0.86×) | 24 → 22 (0.92×) |
| ts/immich | 0.02 → 0.02 (0.98×) | 0.03 → 0.02 (0.93×) | 0.05 → 0.04 (0.87×) | 16 → 16 (0.98×) |
| ts/infisical | 0.11 → 0.09 (0.83×) | 0.10 → 0.08 (0.87×) | 0.20 → 0.18 (0.88×) | 39 → 38 (0.96×) |
| ts/midday | 0.04 → 0.04 (0.98×) | 0.04 → 0.04 (0.95×) | 0.07 → 0.07 (0.97×) | 21 → 20 (0.96×) |
| ts/nest | 0.02 → 0.02 (1.01×) | 0.03 → 0.03 (1.03×) | 0.04 → 0.04 (1.02×) | 17 → 16 (0.94×) |
| ts/novu | 0.13 → 0.10 (0.75×) | 0.12 → 0.10 (0.81×) | 0.21 → 0.18 (0.84×) | 39 → 33 (0.83×) |
| ts/supabase | 0.09 → 0.08 (0.89×) | 0.09 → 0.08 (0.92×) | 0.20 → 0.17 (0.85×) | 34 → 32 (0.94×) |
| ts/twenty | 0.26 → 0.23 (0.89×) | 0.25 → 0.22 (0.90×) | 0.55 → 0.46 (0.84×) | 106 → 95 (0.90×) |
| py/netbox | 0.10 → 0.09 (0.92×) | 0.10 → 0.09 (0.88×) | 0.18 → 0.15 (0.86×) | 26 → 26 (1.00×) |
| py/saleor | 0.14 → 0.13 (0.96×) | 0.14 → 0.13 (0.95×) | 0.21 → 0.19 (0.91×) | 32 → 31 (0.99×) |
| py2/InvenTree | 0.07 → 0.06 (0.84×) | 0.07 → 0.06 (0.89×) | 0.12 → 0.11 (0.85×) | 24 → 23 (0.99×) |

Every TS hook stays under 500 ms; the slowest is twenty's, 0.22 s after an edit (0.25 s
on main).

<details><summary>Census per repo, main → head</summary>

| repo | warm CPU s | warm MB | cold CPU s | cold MB |
|---|---|---|---|---|
| ts/ai | 1.85 → 1.81 (0.98×) | 250 → 207 (0.83×) | 3.57 → 3.61 (1.01×) | 277 → 227 (0.82×) |
| ts/cal.com | 1.71 → 1.71 (1.00×) | 217 → 167 (0.77×) | 2.80 → 3.09 (1.10×) | 244 → 190 (0.78×) |
| ts/create-t3-app | 0.05 → 0.05 (0.98×) | 19 → 17 (0.87×) | 0.14 → 0.13 (0.90×) | 20 → 17 (0.85×) |
| ts/documenso | 0.94 → 0.91 (0.96×) | 127 → 96 (0.75×) | 3.08 → 2.91 (0.94×) | 146 → 111 (0.76×) |
| ts/dub | 2.57 → 2.67 (1.04×) | 169 → 123 (0.73×) | 4.95 → 5.06 (1.02×) | 187 → 137 (0.74×) |
| ts/excalidraw | 0.32 → 0.27 (0.86×) | 59 → 44 (0.74×) | 0.93 → 0.93 (1.00×) | 83 → 69 (0.83×) |
| ts/formbricks | 2.01 → 2.04 (1.01×) | 286 → 221 (0.77×) | 5.15 → 4.72 (0.92×) | 313 → 231 (0.74×) |
| ts/immich | 0.42 → 0.40 (0.95×) | 77 → 56 (0.72×) | 1.13 → 1.05 (0.94×) | 98 → 74 (0.76×) |
| ts/infisical | 6.33 → 6.29 (0.99×) | 483 → 348 (0.72×) | 8.77 → 9.11 (1.04×) | 495 → 353 (0.71×) |
| ts/midday | 0.70 → 0.70 (1.01×) | 110 → 79 (0.72×) | 1.42 → 1.25 (0.88×) | 134 → 107 (0.80×) |
| ts/nest | 0.64 → 0.63 (0.99×) | 73 → 62 (0.85×) | 2.15 → 2.12 (0.98×) | 89 → 74 (0.83×) |
| ts/node-express-boilerplate | 0.02 → 0.02 (0.92×) | 14 → 13 (0.94×) | 0.04 → 0.03 (0.89×) | 15 → 14 (0.95×) |
| ts/novu | 4.95 → 5.05 (1.02×) | 395 → 287 (0.73×) | 6.81 → 7.86 (1.15×) | 403 → 287 (0.71×) |
| ts/supabase | 3.55 → 3.42 (0.96×) | 353 → 267 (0.76×) | 5.36 → 5.15 (0.96×) | 361 → 272 (0.76×) |
| ts/trpc | 0.31 → 0.30 (0.96×) | 54 → 42 (0.79×) | 0.51 → 0.58 (1.13×) | 64 → 53 (0.82×) |
| ts/twenty | 11.94 → 11.24 (0.94×) | 1256 → 985 (0.78×) | 18.33 → 16.22 (0.88×) | 1248 → 963 (0.77×) |
| py/fastapi | 0.29 → 0.29 (1.01×) | 60 → 51 (0.84×) | 0.56 → 1.36 (2.44×) | 64 → 53 (0.83×) |
| py/flask | 0.04 → 0.04 (0.97×) | 17 → 15 (0.88×) | 0.17 → 0.17 (0.97×) | 18 → 17 (0.92×) |
| py/full-stack-fastapi-template | 0.05 → 0.05 (1.02×) | 17 → 16 (0.92×) | 0.24 → 0.26 (1.09×) | 19 → 18 (0.94×) |
| py/langchain | 1.42 → 0.88 (0.62×) | 135 → 111 (0.82×) | 3.48 → 3.06 (0.88×) | 138 → 113 (0.82×) |
| py/netbox | 1.26 → 1.00 (0.79×) | 164 → 97 (0.59×) | 2.64 → 2.24 (0.85×) | 165 → 123 (0.74×) |
| py/saleor | 1.54 → 1.44 (0.94×) | 252 → 205 (0.82×) | 4.06 → 4.00 (0.99×) | 209 → 202 (0.97×) |
| py2/changedetection.io | 0.21 → 0.17 (0.84×) | 41 → 33 (0.82×) | 0.95 → 0.88 (0.93×) | 44 → 35 (0.81×) |
| py2/Django-CRM | 0.68 → 0.63 (0.93×) | 126 → 97 (0.77×) | 2.40 → 2.33 (0.97×) | 130 → 99 (0.76×) |
| py2/InvenTree | 0.59 → 0.56 (0.95×) | 79 → 56 (0.71×) | 1.91 → 1.86 (0.97×) | 86 → 76 (0.89×) |
| py2/lotus | 0.15 → 0.14 (0.95×) | 35 → 27 (0.78×) | 0.47 → 0.44 (0.93×) | 40 → 36 (0.89×) |
| py2/Misago | 0.82 → 0.82 (1.00×) | 132 → 102 (0.77×) | 2.86 → 2.77 (0.97×) | 135 → 105 (0.78×) |
| py2/open-wearables | 0.48 → 0.43 (0.90×) | 82 → 62 (0.75×) | 1.81 → 1.71 (0.94×) | 83 → 63 (0.76×) |
| py2/paperless-ngx | 0.33 → 0.33 (1.01×) | 54 → 40 (0.73×) | 1.37 → 1.42 (1.03×) | 60 → 50 (0.83×) |
| py2/pontoon | 0.27 → 0.25 (0.90×) | 45 → 34 (0.76×) | 1.30 → 1.29 (0.99×) | 48 → 37 (0.77×) |
| py2/ralph | 0.32 → 0.28 (0.88×) | 54 → 37 (0.67×) | 0.93 → 0.99 (1.06×) | 55 → 39 (0.70×) |
| py2/simplelogin | 0.23 → 0.21 (0.90×) | 49 → 38 (0.79×) | 0.88 → 0.86 (0.98×) | 52 → 41 (0.78×) |
| py2/tasking-manager | 0.29 → 0.27 (0.95×) | 45 → 34 (0.75×) | 1.71 → 1.64 (0.96×) | 52 → 42 (0.81×) |
| py2/wger | 0.23 → 0.19 (0.85×) | 42 → 30 (0.73×) | 0.85 → 0.78 (0.92×) | 43 → 32 (0.73×) |

</details>

Raw rows: `followup/census.jsonl` (680 runs), `followup/hook.jsonl`,
`followup/checkjson.jsonl`.

### Behaviour

- `census --json --max 15` is **byte-identical on 34 of 34 dev clones** (the `commit`
  field aside), from the binaries timed above, and again in an earlier full run of an
  intermediate head. No id changed, so there is no tier or label diff.
- `check --format json` on an edited file is byte-identical on **36 of 36** files: 8
  files drawn (seeded) from each of twenty, cal.com, netbox and saleor plus each repo's
  representative file, each with a comment line appended. So are the whole repo's
  `check --format json` after each edit (9 to 190 violations, 0 to 11 exemptions) and the
  hook's output on the same edit, both against d20953b and against 2c81ba4.
- Every dev clone copied from was clean (`git status --short`) after the runs.

### 1. TS memory

- **`RawTypes` is shared.** `RawFile::types` is an `Arc<RawTypes>`
  (`crates/drift-ts/src/lower.rs`), so each module the type index loads is a pointer
  copy, not a deep clone of the file's declarations (`lib.rs`, `index.rs`). The JSON
  form is unchanged (serde's `rc` feature serialises an `Arc<T>` as a `T`), so cache
  entries are unchanged and no lowering bump is needed.
- **Declaration files outside the scan are cached.** `typeres::declared_types` lowers a
  file that `TypeIndex::load_path` or `augmented_names` reads (installed packages'
  `.d.ts`, the repo's skipped declaration files) once and keeps its `RawTypes` in the
  fact cache, under `facts-v9/ts-types-l<LOWERING_VERSION>-<version>/`, keyed by the hash
  of the file name and content (lowering reads nothing else). Tests:
  `declared_types_are_cached_by_name_and_content` (a planted entry is what a later call
  reads, for its own name and content only; mutation: keying by content alone fails it)
  and `installed_declarations_are_cached_by_content` (a warm scan reads the entry and
  gives the same facts; an edited `.d.ts` is lowered again; the facts equal an uncached
  scan's).
- **Parse arenas and freed pages go back.** Each worker kept its last parse arena
  (`arena::SPARE`, up to 32 MB written) for the rest of the run; workers now drop it
  after the scan has lowered its files and at its end (`arena::release_spare`). And when
  a scan's worker pool is dropped, `stack::release_free_memory` (glibc `malloc_trim`)
  returns the pages the workers freed: they sat in the workers' allocator arenas, which
  mining, on the main thread, never allocates from. On twenty, sampling
  `/proc/<pid>/smaps` showed the warm census peaking at the end of mining with 830 MB
  in worker arenas and 246 MB in the main heap; with the trim, the peak is the TS scan's
  (985 MB) and mining runs at about 580 MB. Existing tests cover both (scan output at 1
  and 8 threads, the stack and arena tests).
- **What was not the lever.** massif on ai's warm census: peak heap 222 MB on main, 175
  MB on the head; on twenty 919 MB remains at the TS link phase. The rest is the facts
  themselves: raw facts read back from the cache (RawSymbol, RawRef and RawLoaderCall
  vectors grown by push as serde_json reads them, about 220 MB on twenty) alongside the
  linked facts and their `arg_types` strings. Not changed here.

Result: peak RSS 0.78× on TS warm census (twenty 1256 → 985 MB) and 0.77× on Python, which
shares the mining phase and the trim.

### 2. `RepoContext::new`

callgrind, netbox warm census (instructions):

| | cd8296b | main (1265770) | head |
|---|---|---|---|
| whole run | 5.84 G | 8.28 G | 6.63 G |
| `RepoContext::new` | 0.44 G | 1.08 G | 0.86 G |
| `Parts::new` | (none) | 0.29 G | 0.28 G |
| `ancestors` | once, inlined | 0.18 G (twice) | once, inlined |
| `attributes` | 0.19 G | 0.19 G | 0.12 G |

What grew is `Parts::new` (#52: who uses each exported symbol), the ancestor map
built a second time inside `team_versions` (#35), and the new entry-class and reference
indexes. Changes, all exact: `team_versions` takes the one ancestor map; class
attributes and their callee sets are shared (`Arc`) by the classes that inherit them,
not cloned per class; and `Parts::new` works out what an import reaches once per
(module, name) instead of once per importing file. Tests: the existing team-version and
inherited-attribute tests (`context.rs`, `tests/precision.rs`), and
`an_import_of_another_name_from_the_module_does_not_stand_for_it` (`tests/parts.rs`;
mutation: keying the memo by module alone fails it). The 2.0 G of the report above was a
different build; on these builds the growth was 0.44 → 1.08 G, and 0.86 G remains.
`Parts::new` itself is left as it is: it is built once and mining reads it on every
part check.

### 3. Python registries

Lowering already keeps only strings that read as dotted module paths
(`registries.rs`, `is_module_path`), so resolving fewer strings would change the facts.
The cost was in resolution: the memo was keyed by the importing directory (allocating
the key on every lookup), every directory listing was looked up by `Path` hashing (0.91
G on netbox, component by component), and `basedir` walked up the tree uncached. Now
(`crates/drift-py/src/resolve.rs`, all exact):

- memos are keyed by the path's bytes, looked up without allocating;
- an absolute import is memoised per (base directory, import roots), the only parts of
  the importing directory `resolve_uncached` reads, so the packages of one project share
  their answers; root lists get an id, so the key is cheap;
- `basedir` and `submodule` are memoised.

`Linker::registry` 0.83 → 0.37 G, `Resolver::resolve` 1.09 → 0.44 G, path hashing 0.91 →
0.02 G; netbox 8.28 → 6.63 G in all (−20%), warm census CPU 0.79×, `check FILE` 0.73×.
Test: `memoised_answers_are_a_fresh_resolvers` (two projects inside one package tree share
a base directory but not their roots, so `shared` is a different module from each;
answers in both orders equal a fresh resolver's; mutation: keying the absolute memo by
base directory alone fails it).

### 4. The twenty hook

callgrind of the hook after an edit on twenty: cd8296b 2.69 G, main (1265770) 2.79 G
(+3.6%). The hook's work did not double: #86's 0.27 → 0.55 s was wall time on a loaded
machine (min of 5 at load 5–19), and here main's hook+edit takes 0.25 s wall, 0.55 s CPU.
What did grow is system time and RSS: the walk now `stat`s two ignore-file names in each
of twenty's ~10,000 directories before entering it (#77, the planted-file guard), and
RSS rose by about 20 MB.

44% of the hook's instructions were `ingest::rel_posix` (1.23 G), most of them
rebuilding every walked name through NFC normalisation (0.85 G), though nearly every
name is ASCII. A name already in NFC (every ASCII name; `is_nfc` for the rest) is now
kept as it is, which is the same string. The hook after an edit: 2.79 → 1.82 G (−34%),
CPU 0.55 → 0.46 s, wall 0.25 → 0.22 s. Test: `rel_paths_are_posix_and_nfc` now also
checks ASCII, non-ASCII NFC and decomposed names against the old per-name rebuild
(mutation: skipping normalisation for every name fails it). The rest of the hook is the
index (load 0.24 G and save 0.17 G of 36,000 entries) and the walk itself.

### Not done

- TS CPU is unchanged (warm 0.97×): the 1.3× of the report above is in the features
  (bigger raw facts to read, more linking and mining), apart from what the type index
  and walk cost.
- The TS scan's own peak (raw and linked facts together, 919 MB of heap on twenty) is
  untouched; shrinking the deserialised vectors or dropping raw facts as files are
  linked are the levers.
- langchain's representative file is a manifest, so its hook is a full scan; it was not
  re-measured.
- The hook's walk still `stat`s each directory's ignore files (#77); the index is read
  and written whole.


## Follow-up 2: TS CPU (ws/perf-ts-cpu)

#89 left TS census CPU where it was: the round-4 features cost it about 1.3× against
cd8296b, and that cost "sits in the features". This pass profiled the TS warm census and
removed the largest hotspots without changing anything a scan, `check` or a hook outputs.

### How it was measured

- **Binaries.** main d20953b (#89 to #100 merged; TS `LOWERING_VERSION` 34) and the
  branch head after merging it, both built with `shared/build-verified.sh` (CGU 139 for
  main, 39 for the head). An earlier pass of the same runs against main 6569a7c and
  e186488 (the two mains merged before it) gave the same identity results.
- **Runs.** #89's method and scripts (`followup/scripts/bench2.py`, `summ.py`,
  `doc_tables.py`, with the scratch path changed; `tscpu/scripts/runall.sh` chains them):
  min of 5, the two binaries interleaved, CPU (user + sys) and peak RSS, wall only for
  reference. Census cold and warm on all 34 clones; `check FILE`, the hook and the hook
  after an edit on hardlinked work copies of the 13 TS repos that have proposals at
  `--max 15` and of netbox, with every proposal of main's `init --max 15` accepted. The
  machine was loaded (load average 7 to 14) throughout.
- **Profiles.** callgrind on warm census of nest, dub, cal.com and twenty
  (`tscpu/scripts/cgrun.sh`), on a build with line tables for the hotspots and on the
  two timed binaries for the totals.

### Results (main d20953b → head)

| set | metric | CPU | peak RSS | wall |
|---|---|---|---|---|
| TS (16) | census cold | 0.87×, 0.66–1.41× | 1.00×, 0.94–1.06× | 0.86×, 0.57–1.33× |
| TS (16) | census warm | 0.79×, 0.49–1.12× | 1.01×, 0.99–1.04× | 0.78×, 0.45–1.09× |
| TS (13) | check FILE | 0.74×, 0.44–1.03× | 1.01×, 0.98–1.03× | 0.72×, 0.40–0.95× |
| TS (13) | hook | 0.97×, 0.89–1.11× | 1.01×, 0.92–1.06× | 0.96×, 0.81–1.14× |
| TS (13) | hook+edit | 0.99×, 0.91–1.08× | 1.01×, 0.99–1.05× | 1.00×, 0.92–1.16× |
| Python (18) | census cold | 0.95×, 0.88–1.01× | 1.00×, 0.94–1.02× | 1.02×, 0.76–1.31× |
| Python (18) | census warm | 0.99×, 0.91–1.07× | 1.00×, 0.99–1.01× | 0.98×, 0.84–1.15× |
| Python (1) | check FILE | 0.99×, 0.99–0.99× | 1.00×, 1.00–1.00× | 1.01×, 1.01–1.01× |
| Python (1) | hook | 1.05×, 1.05–1.05× | 0.98×, 0.98–0.98× | 1.09×, 1.09–1.09× |
| Python (1) | hook+edit | 1.03×, 1.03–1.03× | 1.00×, 1.00–1.00× | 1.01×, 1.01–1.01× |

The 1.41× and 1.12× maxima are node-express-boilerplate (0.02 to 0.07 s). The hook is
unchanged: it links one file against what it needs, and the hotspots below are in the
whole-repo passes. Every TS hook stays under 500 ms; the slowest is twenty's, 0.24 s wall
after an edit (0.51 s CPU over its threads).

callgrind, warm census (instructions):

| repo | main e7a013b | main d20953b | head | |
|---|---|---|---|---|
| ts/nest | 4.80 G | 4.81 G | 1.68 G | 0.35× |
| ts/dub | 22.04 G | 22.08 G | 6.57 G | 0.30× |
| ts/cal.com | 8.51 G | 8.57 G | 6.33 G | 0.74× |
| ts/twenty | 54.98 G | 55.25 G | 41.55 G | 0.75× |

(e7a013b is the main this started from; its build had line tables, the other two are the
timed binaries.) Instructions fall more than CPU time: system time (reading the cache)
and memory stalls are untouched.

twenty and netbox:

| repo | metric | CPU s | peak MB | wall s |
|---|---|---|---|---|
| ts/twenty | census cold | 17.37 → 16.31 (0.94×) | 978 → 981 (1.00×) | 10.39 → 9.52 (0.92×) |
| ts/twenty | census warm | 10.22 → 9.07 (0.89×) | 1004 → 1007 (1.00×) | 7.33 → 6.90 (0.94×) |
| ts/twenty | check FILE | 8.83 → 9.13 (1.03×) | 1006 → 1009 (1.00×) | 5.32 → 4.93 (0.93×) |
| ts/twenty | hook | 0.54 → 0.55 (1.01×) | 93 → 99 (1.06×) | 0.29 → 0.31 (1.05×) |
| ts/twenty | hook+edit | 0.53 → 0.51 (0.97×) | 99 → 100 (1.01×) | 0.26 → 0.24 (0.95×) |
| py/netbox | census cold | 2.25 → 2.23 (0.99×) | 121 → 114 (0.94×) | 1.08 → 1.18 (1.09×) |
| py/netbox | census warm | 0.97 → 1.00 (1.03×) | 98 → 98 (1.00×) | 0.76 → 0.73 (0.95×) |
| py/netbox | check FILE | 0.78 → 0.77 (0.99×) | 100 → 100 (1.00×) | 0.48 → 0.49 (1.01×) |
| py/netbox | hook | 0.15 → 0.16 (1.05×) | 26 → 26 (0.98×) | 0.09 → 0.09 (1.09×) |
| py/netbox | hook+edit | 0.15 → 0.16 (1.03×) | 26 → 26 (1.00×) | 0.09 → 0.09 (1.01×) |

The hook on every TS repo with proposals, and netbox:

| repo | hook s | hook+edit s | hook+edit CPU s | hook+edit MB |
|---|---|---|---|---|
| ts/ai | 0.07 → 0.07 (1.01×) | 0.07 → 0.07 (0.97×) | 0.09 → 0.09 (0.99×) | 28 → 28 (1.00×) |
| ts/cal.com | 0.08 → 0.08 (0.99×) | 0.07 → 0.08 (1.13×) | 0.09 → 0.10 (1.02×) | 23 → 23 (1.00×) |
| ts/documenso | 0.03 → 0.03 (0.89×) | 0.03 → 0.03 (1.12×) | 0.04 → 0.04 (1.08×) | 17 → 17 (1.00×) |
| ts/dub | 0.03 → 0.03 (0.99×) | 0.04 → 0.03 (0.95×) | 0.06 → 0.05 (0.93×) | 20 → 20 (0.99×) |
| ts/excalidraw | 0.02 → 0.02 (0.99×) | 0.03 → 0.03 (0.97×) | 0.03 → 0.03 (0.91×) | 18 → 18 (1.01×) |
| ts/formbricks | 0.05 → 0.06 (1.14×) | 0.05 → 0.06 (1.16×) | 0.09 → 0.09 (1.03×) | 23 → 24 (1.03×) |
| ts/immich | 0.02 → 0.02 (0.89×) | 0.02 → 0.02 (1.06×) | 0.04 → 0.04 (1.03×) | 16 → 16 (1.03×) |
| ts/infisical | 0.12 → 0.10 (0.83×) | 0.12 → 0.12 (1.01×) | 0.16 → 0.15 (0.98×) | 39 → 38 (0.99×) |
| ts/midday | 0.04 → 0.04 (0.97×) | 0.04 → 0.04 (0.92×) | 0.06 → 0.06 (0.93×) | 21 → 22 (1.05×) |
| ts/nest | 0.03 → 0.03 (1.03×) | 0.03 → 0.03 (0.92×) | 0.04 → 0.04 (1.00×) | 17 → 17 (1.00×) |
| ts/novu | 0.11 → 0.10 (0.90×) | 0.11 → 0.11 (0.94×) | 0.17 → 0.17 (0.98×) | 35 → 35 (1.00×) |
| ts/supabase | 0.10 → 0.08 (0.81×) | 0.09 → 0.09 (0.94×) | 0.15 → 0.16 (1.06×) | 32 → 32 (1.01×) |
| ts/twenty | 0.29 → 0.31 (1.05×) | 0.26 → 0.24 (0.95×) | 0.53 → 0.51 (0.97×) | 99 → 100 (1.01×) |
| py/netbox | 0.09 → 0.09 (1.09×) | 0.09 → 0.09 (1.01×) | 0.15 → 0.16 (1.03×) | 26 → 26 (1.00×) |

<details><summary>Census per repo, main → head</summary>

| repo | warm CPU s | warm MB | cold CPU s | cold MB |
|---|---|---|---|---|
| ts/ai | 1.73 → 1.35 (0.78×) | 211 → 214 (1.01×) | 5.06 → 3.36 (0.66×) | 231 → 232 (1.00×) |
| ts/cal.com | 1.64 → 1.36 (0.83×) | 169 → 167 (0.99×) | 3.92 → 3.53 (0.90×) | 189 → 183 (0.97×) |
| ts/create-t3-app | 0.04 → 0.04 (0.98×) | 17 → 17 (1.04×) | 0.12 → 0.10 (0.84×) | 18 → 17 (0.97×) |
| ts/documenso | 0.77 → 0.70 (0.91×) | 97 → 98 (1.01×) | 2.15 → 2.18 (1.01×) | 114 → 107 (0.94×) |
| ts/dub | 2.31 → 1.14 (0.49×) | 124 → 125 (1.00×) | 4.18 → 2.97 (0.71×) | 138 → 138 (1.01×) |
| ts/excalidraw | 0.27 → 0.22 (0.83×) | 44 → 45 (1.01×) | 0.83 → 0.81 (0.97×) | 68 → 68 (1.01×) |
| ts/formbricks | 1.77 → 1.60 (0.90×) | 226 → 227 (1.00×) | 4.96 → 4.36 (0.88×) | 242 → 241 (1.00×) |
| ts/immich | 0.35 → 0.34 (0.97×) | 56 → 57 (1.01×) | 1.21 → 1.18 (0.98×) | 72 → 72 (1.01×) |
| ts/infisical | 5.93 → 3.06 (0.52×) | 354 → 357 (1.01×) | 9.97 → 6.88 (0.69×) | 359 → 362 (1.01×) |
| ts/midday | 0.61 → 0.58 (0.95×) | 80 → 81 (1.02×) | 1.80 → 1.65 (0.92×) | 106 → 105 (0.99×) |
| ts/nest | 0.56 → 0.32 (0.58×) | 63 → 63 (1.00×) | 1.77 → 1.50 (0.85×) | 78 → 81 (1.03×) |
| ts/node-express-boilerplate | 0.02 → 0.02 (1.12×) | 13 → 13 (1.00×) | 0.05 → 0.07 (1.41×) | 14 → 15 (1.06×) |
| ts/novu | 4.69 → 2.82 (0.60×) | 291 → 301 (1.03×) | 6.94 → 4.65 (0.67×) | 299 → 308 (1.03×) |
| ts/supabase | 3.36 → 2.73 (0.81×) | 272 → 273 (1.00×) | 5.52 → 4.76 (0.86×) | 275 → 274 (1.00×) |
| ts/trpc | 0.27 → 0.23 (0.85×) | 43 → 44 (1.01×) | 1.11 → 1.00 (0.90×) | 55 → 53 (0.96×) |
| ts/twenty | 10.22 → 9.07 (0.89×) | 1004 → 1007 (1.00×) | 17.37 → 16.31 (0.94×) | 978 → 981 (1.00×) |
| py/fastapi | 0.28 → 0.27 (1.00×) | 51 → 51 (1.00×) | 0.54 → 0.52 (0.96×) | 54 → 54 (1.00×) |
| py/flask | 0.03 → 0.03 (0.91×) | 15 → 15 (1.01×) | 0.08 → 0.07 (0.88×) | 16 → 16 (1.00×) |
| py/full-stack-fastapi-template | 0.04 → 0.04 (0.95×) | 16 → 16 (1.01×) | 0.21 → 0.21 (1.00×) | 18 → 18 (1.00×) |
| py/langchain | 0.88 → 0.80 (0.91×) | 112 → 112 (1.00×) | 2.74 → 2.44 (0.89×) | 114 → 114 (1.01×) |
| py/netbox | 0.97 → 1.00 (1.03×) | 98 → 98 (1.00×) | 2.25 → 2.23 (0.99×) | 121 → 114 (0.94×) |
| py/saleor | 1.38 → 1.45 (1.05×) | 206 → 206 (1.00×) | 3.88 → 3.87 (1.00×) | 203 → 203 (1.00×) |
| py2/changedetection.io | 0.15 → 0.15 (1.07×) | 34 → 34 (0.99×) | 0.61 → 0.61 (1.01×) | 36 → 36 (1.01×) |
| py2/Django-CRM | 0.62 → 0.61 (0.99×) | 98 → 98 (1.00×) | 2.16 → 2.15 (0.99×) | 98 → 98 (1.00×) |
| py2/InvenTree | 0.52 → 0.53 (1.02×) | 56 → 57 (1.00×) | 1.78 → 1.70 (0.96×) | 74 → 73 (0.98×) |
| py2/lotus | 0.13 → 0.13 (0.98×) | 28 → 27 (0.99×) | 0.44 → 0.43 (0.98×) | 35 → 35 (1.00×) |
| py2/Misago | 0.74 → 0.70 (0.95×) | 103 → 103 (1.00×) | 2.59 → 2.29 (0.89×) | 105 → 106 (1.00×) |
| py2/open-wearables | 0.37 → 0.39 (1.05×) | 63 → 63 (1.00×) | 1.23 → 1.21 (0.98×) | 64 → 64 (1.01×) |
| py2/paperless-ngx | 0.27 → 0.26 (0.93×) | 40 → 40 (0.99×) | 1.01 → 1.02 (1.00×) | 49 → 50 (1.02×) |
| py2/pontoon | 0.21 → 0.21 (1.03×) | 34 → 35 (1.01×) | 0.97 → 0.88 (0.90×) | 37 → 37 (1.01×) |
| py2/ralph | 0.25 → 0.25 (1.00×) | 37 → 37 (1.01×) | 0.74 → 0.69 (0.93×) | 39 → 39 (1.01×) |
| py2/simplelogin | 0.19 → 0.19 (1.00×) | 38 → 39 (1.01×) | 0.66 → 0.66 (0.99×) | 41 → 41 (0.99×) |
| py2/tasking-manager | 0.25 → 0.24 (0.94×) | 35 → 36 (1.00×) | 1.11 → 1.05 (0.94×) | 44 → 44 (1.00×) |
| py2/wger | 0.18 → 0.18 (1.00×) | 31 → 31 (1.01×) | 0.60 → 0.53 (0.89×) | 32 → 32 (1.01×) |

</details>

Raw rows: `tscpu/census.jsonl` (680 runs), `tscpu/hook.jsonl`, `tscpu/checkjson.jsonl`.

### Behaviour

- `census --json --max 15` is **byte-identical on 34 of 34 dev clones** (the `commit`
  field aside), from the binaries timed above, and again after merging main 2c81ba4 (#99;
  one cold census per side, 2c81ba4 against the merged head) and, earlier, against
  6569a7c. No id changed, so there is no tier or label diff.
- `check --format json` on an edited file is byte-identical on **45 of 45** files: 8
  files drawn (seeded) from each of twenty, cal.com, dub, nest and netbox plus each repo's
  representative file, each with a comment line appended. So are the whole repo's
  `check --format json` after each edit (1 to 190 violations, 0 to 11 exemptions) and the
  hook's output on the same edit, both against d20953b and against 2c81ba4.
- Every dev clone copied from was clean (`git status --short`) after the runs.

### Where the TS time went

callgrind of warm census on main e7a013b (the TS scan is `drift_ts::scan_inner`; inclusive
instructions, share of the run):

| | nest | dub | cal.com | twenty |
|---|---|---|---|---|
| whole run | 4.80 G | 22.04 G | 8.51 G | 54.98 G |
| `repo::client_leaks` | 2.26 G (47%) | 9.73 G (44%) | 0.97 G (11%) | 5.36 G (10%) |
| `Linker::origin` | 0.76 G (16%) | 6.24 G (28%) | 0.32 G (4%) | 1.51 G (3%) |
| `ModuleResolver::resolve` | 0.31 G (7%) | 1.19 G (5%) | 2.01 G (24%) | 11.92 G (22%) |
| `repo::pair_tests` | 0.24 G (5%) | 0.58 G (3%) | 0.64 G (8%) | 5.04 G (9%) |
| `TypeIndex::annotate` | small | small | 0.21 G (2%) | 2.09 G (4%) |
| `package_of` | 0.09 G (2%) | small | 0.21 G (2%) | 1.96 G (4%) |
| `mine_with_kinds` (mining) | 0.29 G (6%) | 2.19 G (10%) | 1.77 G (21%) | 12.72 G (23%) |

The first two are #76's re-export following and the linker's barrel origins; their cost
grows with how many `export *` barrels a repo has (nest, dub, infisical, novu).

1. **Client leaks through barrels** (#76's re-export following). For every file not yet
   known to be server-only, on every pass of the fixed point, `forwarded` walked each
   imported name through the barrel's `export *` sources, and `exports_name` walked each
   source's own `export *` chains to see whether it may export the name, to 16 hops:
   the same (module, name) was answered again from every path to it, exponentially in
   the chains' fan-out. Now (`crates/drift-ts/src/repo.rs`, all exact):
   - `exports_name` remembers its answer per (module, name, depth). It reads only the
     re-export tables, and the depth is part of the question: a chain cut at the hop
     bound from one start is not cut from a nearer one. Modules with no `export *` answer
     at once and are not remembered.
   - `forwarded` answers one name at a time (the sources of several names are each
     name's in turn, in order) and remembers each answer per (module, name, depth). An
     answer reads `origin`, which grows during the fixed point, so the memo records every
     module whose `origin` an answer looked up, and forgets all answers when one of those
     enters `origin`; entries that consulted no such module stay right. A barrel that
     forwards nothing for a name is not remembered.
   - Neither memo allocates names (they borrow the import and re-export names), and
     `server_root` no longer formats a string per root and call.
   Tests: `exports_name_memo_answers_as_the_walk` (two `export *` chains longer than the
   hop bound, one with a cycle and one ending at a package; one memo asked every (module,
   name, depth) in both orders answers as the old walk; mutations: ignoring the depth or
   the name fails it), `a_module_entering_origin_renews_what_barrels_forward` (a file asks
   what a barrel forwards before the module behind it becomes server-only, and again
   after; mutations: not forgetting, not recording what was consulted, or ignoring the
   name fail it) and `what_barrels_forward_is_remembered_per_depth` (a 21-module forwarding
   chain reached within the bound from its middle and beyond it from its start;
   mutation: ignoring the depth fails it).
2. **Re-export origins** (`Linker::origin`, `crates/drift-ts/src/resolve.rs`). Every
   reference through a barrel resolved its origin afresh, following `export *` with a
   cloned `seen` set per source: 86,000 calls on dub, 72,000 instructions each. `origin`
   reads only the linker's export tables, fixed once it is built, so its answers are kept
   per (module, name) in 16 locked shards (files are linked in parallel), and dropped when
   linking is done. Test: `remembered_origins_are_a_fresh_linkers` (barrels forwarding one
   name from one module and another from a second, asked in both orders and from 4
   threads, against a fresh linker per question; mutations: keying by module alone or by
   name alone fails it).
3. **Resolution.** `ModuleResolver::resolve` hashed and compared `(PathBuf, String)` keys
   component by component on every lookup (0.7 G on cal.com before any resolving); its
   memo is now keyed by the directory's bytes, then the specifier, looked up without
   allocating. tsconfig `paths` were re-read and re-parsed for every directory below a
   tsconfig (1,360 loads on cal.com): they are now read once per tsconfig file. A workspace
   package's manifest was read and parsed on every unresolved import of it (hotspot 8
   above): its build-output targets are now remembered per (package directory, subpath).
   Tests: `resolved_specs_are_remembered_per_directory` (one specifier names a different
   module from each directory; mutation: keying by specifier alone fails it),
   `tsconfig_paths_are_read_once_per_file` (four tsconfigs, one extending another, ten
   directories in both orders; mutation: any remembered file's answer fails it),
   `workspace_source_targets_are_remembered_per_package_and_subpath` (two packages with
   `dist/` exports; mutations: keying by subpath or by directory alone fails it).
4. **Test pairing** (`repo::has_test`) formatted 40 candidate paths per file and looked
   each up in a sorted set. It now looks up the two prefixes every candidate starts with
   (`<dir>/<stem>.` and `<dir>/__tests__/<stem>.`) and builds the candidates in one buffer
   only when one exists. Test: `has_test_finds_each_candidate` (each of the 40 candidates
   alone pairs the file; near misses do not; mutations: dropping the `__tests__` prefix
   check or its `/` fails it).
5. **Parameter types** (`TypeIndex::requirement`, `crates/drift-ts/src/typeres.rs`). A
   nested key (`where.tenantId`) walked the parameter's shapes again on every call that
   passed it; the answer is now kept per (callee parameter, key). Test:
   `remembered_requirements_are_per_parameter_and_key` (`tests/param_types.rs`: two
   callees requiring the same keys the opposite way, a second parameter and nested keys,
   called from four files at 1 and 4 threads; mutations: dropping the key, the callee name
   or the index from the memo key fails it).
6. **Packages** (`package_of`): its memo is keyed by directory bytes, not compared path by
   path in a `BTreeMap<PathBuf, _>`. Test: `remembered_packages_are_the_nearest_manifest`
   (nested manifests in both orders; mutations: any remembered answer, or the answer stored
   under the parent directory, fail it).

Peak RSS is unchanged (TS warm 1.01×); novu's is 1.03× (291 → 301 MB), what the barrel
memos hold at the end of the scan. A first version that copied names into the memos and
kept every module's answer reached 1.19× on novu; borrowing the names, keeping only
barrels and dropping the origin memo after linking brought it back.

### Not done

- Mining is now the largest part of a warm TS census (twenty 12.7 G of 41.5 G, cal.com
  1.8 G of 6.3 G) and is spread over many features (`RepoContext::new` 4.5 G on twenty,
  `Parts::new` 2.4 G, `roles::units` 2.4 G, `Rule` ordering 1.6 G, `is_test_path` 1.6 G,
  which lowercases a copy of the path on every call); none was a
  single safe fix.
- Resolution proper (oxc's resolver, once per (directory, specifier)) is 1.1 G on cal.com
  and most of twenty's 9.4 G; sharing answers across directories is exact only where a
  specifier cannot depend on the directory, which needs the resolver's rules spelled out.
- `Linker::module_exports` still clones its `seen` set per `export *` source on an origin
  the memo has not seen (0.4 G on dub); its cycle cut makes it path-dependent, so it was
  left as it is.
- Reading the fact cache back (serde_json, 0.6 to 5 G) is unchanged. The TS scan's heap
  peak and the walk's ignore-file `stat`s are as #89 left them.
