# Drift Studio

A desktop app for people to see what Drift knows about a codebase and what
coding agents did in it: review proposed conventions, investigate violations
and agent sessions, and understand the codebase's shape, boundaries and
security surface. Design: [docs/DESIGN.md](docs/DESIGN.md).

![Attention](docs/screenshots/attention.jpg)

| | |
| --- | --- |
| ![Review](docs/screenshots/conventions.jpg) | ![Map](docs/screenshots/map-expanded.jpg) |
| ![Sessions](docs/screenshots/sessions.jpg) | ![Security](docs/screenshots/security.jpg) |
| ![Practices](docs/screenshots/practices.jpg) | ![Practices, one package](docs/screenshots/practices-package.jpg) |

More in [docs/screenshots/](docs/screenshots/) (every view, light and dark,
the code drawer, the command palette and the component gallery).

## Run

From the repository root (an npm workspace with `packages/ui` and `apps/studio`):

```sh
npm ci
npm run start -w drift-studio          # build and open the desktop app
npm run dev -w drift-studio            # the renderer in a browser, on fixtures
```

The desktop app needs the `drift` binary with `census --json` (Drift from this
branch or newer). It is found on `PATH` (and in `~/.cargo/bin`), or chosen in
Settings. The Studio runs it without a shell, so on Windows it runs `drift.exe`:
the `drift.cmd` that npm installs is followed to the `drift.exe` in Drift's
per-platform package, never executed (Node refuses `.cmd` without a shell since
CVE-2024-27980).

## Test

```sh
npm run typecheck --workspaces
npx eslint .
npm test --workspaces                  # vitest: tokens, contrast, CVD, data layer, IPC, main process
npm run e2e -w drift-studio            # Playwright + Chromium on the fixture build, axe on every view
node apps/studio/tests/e2e/run.mjs --screens   # also writes docs/screenshots
```

Fixtures (`fixtures/`) are produced by the real binary:

```sh
node scripts/make-fixtures.mjs --drift <drift> --work <scratch>          # acme: committed (step 1 from scripts/acme-seed)
node scripts/make-round11-fixtures.mjs --drift <drift> --work <scratch>  # beacon, quiet, broken: committed
node scripts/make-study-fixtures.mjs [--drift <drift> --eval-repos <dir> --work <scratch>]
node scripts/make-local-fixtures.mjs --drift <drift> --repos <dir> --work <scratch>  # twenty, dub: git-ignored
node scripts/make-local-fixtures.mjs --drift <drift> --repos <scratch copies> --work <scratch> --policy <names>  # also policy and check
```

`fixtures/acme/practices.json` is the exception for now: hand-written in the shape the engine prints
(`drift practices --json` version 1 with `recipes` and `findings`) from acme's own security inventory and
sources (variant ids are placeholders), until a release build of the engine regenerates it. `acme` is a synthetic monorepo written by `scripts/synth-repo.mjs` (ours,
Apache-2.0) plus Drift's own parser fixtures; its sessions are synthetic
transcripts whose hook messages and session state come from running
`drift hook claude` as the agent works. No third-party code or real
transcripts are committed; large repositories are generated locally for
performance work and the tests skip them when absent.

## Architecture

```
renderer (React, sandboxed)  ──named channels──▶  preload  ──▶  main process  ──execFile──▶  drift
  app → features → entities → shared              (names only)   validates (zod),           (JSON on stdout,
  @drift/ui design system                                          reads files Drift writes    files Drift writes)
```

- **A view over the CLI.** Every fact, convention, violation and security
  finding comes from `drift scan --out`, `drift census --json`,
  `drift check --format json`, `drift security --json`, `drift practices --json`, `.drift/conventions.yaml`,
  `drift.lock` and `.drift/cache/sessions/*.json`. The Studio aggregates and
  draws; it never analyses code.
- **Renderer** (`src/`): feature-sliced. `shared` (IPC contract, API, i18n,
  libs), `entities` (Drift's data and its hooks), `features` (one per view),
  `app` (shell). ESLint enforces the direction and that slices are entered
  through their `index.ts`. TanStack Query caches, refreshes in the background
  and cancels (cancellation kills the drift process).
- **Design system** (`packages/ui`, `@drift/ui`): tokens, themes, components,
  charts, code/diff views and a graph canvas; usable without Electron.
- **Main process** (`electron/`): `handlers.ts` implements each channel and is
  unit-tested without Electron; `main.ts` wires windows, the protocol and IPC.
- **Performance**: cached slim facts paint first and a scan refreshes in the
  background; the map aggregates to at most 40 children per expanded node and
  600 edges, lays out in a web worker (ELK), and renders only visible nodes.

## Security model

- Renderer: `contextIsolation`, `sandbox`, no `nodeIntegration`; served from
  `studio://app` with a strict CSP (`script-src 'self'`, no inline script or
  style, no eval, no remote origins); no navigation away, no new windows, no
  webviews, every permission request denied.
- IPC: the preload exposes only `invoke(<channel name>)` for the names in
  `src/shared/ipc/names.ts`, an IPC version and push events. The main process
  checks the sender's origin and validates every request with the contract's
  zod schemas before doing anything. The renderer validates every response.
- Running drift: `execFile` (no shell), argv built from fixed pieces and
  validated ids, a minimal environment, a timeout and an output cap.
- Reading files: a repository must be one the person opened; source reads are
  limited to files the last scan listed, resolved inside the repository (no
  symlinks out), 2 MB at most; transcripts only from `~/.claude/projects` by a
  listed session id; session state only from `.drift/cache/sessions/`.
- Writing: only `drift review` (with a 5 s undo window, block and block --force confirmed) and
  `drift init` (confirmed) touch a repository. Exports go to a path the person
  chooses.
- Untrusted text: repository and transcript content is rendered as React text
  nodes; code is tokenized into plain tokens (no HTML); Markdown exports put it
  in code spans or fences; secrets in transcripts are redacted by default.
  ESLint forbids `dangerouslySetInnerHTML`, `innerHTML` and friends.
- Nothing is sent anywhere: no telemetry, no network.

## Data contract with the CLI

| Source | Used for | Checked |
| --- | --- | --- |
| `drift --version` | footer, Settings, provenance | shown |
| `drift census --help` | whether `census --json` exists | feature flag |
| `drift --root R scan --out F` | facts (slimmed by `src/shared/contract/slim.ts`) | `schema_version` ∈ {4, 5, 6, 7, 8, 9, 10, 11} |
| `drift --root R census --json` | proposals, outliers, ranks, member counts, tier and rule kind | `schema` ∈ {1} |
| `drift --root R check --format json [--diff-base REF]` | violations (exit 1 means something blocks), per-convention tier and effective mode (`conventions`), what a diff compared (`diff`) | top-level shape |
| `drift --root R security --json [--diff-base REF]` | entry points, shared-guard gaps, exposure, sinks, leaks, env; with a base, what the change introduces (`guard_gaps`, `unguarded_reaching`, `sinks`, `leaks`, `now_public`, `diff`; exit 0) | top-level shape |
| `drift --root R map --json` | each package's production and test dependencies (Map, package panel) | `schema` and `packages` |
| `drift --root R practices --json` | the practice map, read-only: the recipe per package and kind of entry point, findings, every concern's variants by share, where, what sets each apart, unknown with its config line (Practices) | `version` ∈ {1} |
| `drift --root R review --accept/--reject/--block/--advise IDS`, `--block IDS --force` | decisions (a suggestion blocks only with `--force`, after confirming) | exit code; audit trail |
| `drift --root R init` | first policy | exit code |
| `.drift/conventions.yaml`, `drift.lock` | status, mode, baseline | parsed (yaml) |
| `.drift/cache/sessions/<id>.json` | primed, advised, blocks | zod |
| `~/.claude/projects/<cwd>/<id>.jsonl` | agent transcripts; Drift's hook messages recognised by how they open (pinned to Drift's source by a test) | per-record |
| `eval/study/runs/<run>[/views/<view>]/metrics.json` | study runs: tiers, per-language targets (D1–D4), families | defensive parse |

TypeScript mirrors of every shape are in `src/shared/contract/drift.ts`. What the
Studio does with each Drift feature, and what is in flight, is in
[docs/SYNC.md](docs/SYNC.md).

## Platform notes

- Linux containers running as root must pass `--no-sandbox` to Electron
  (Chromium's rule); the renderer is still created with `sandbox: true`.
- Not done yet: packaging, signing, notarisation and auto-update.
