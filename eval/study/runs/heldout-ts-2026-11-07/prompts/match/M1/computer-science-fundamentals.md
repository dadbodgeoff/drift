You are checking whether a tool's proposed conventions for the repository **computer-science-fundamentals** (https://github.com/AlexGalhardo/computer-science-fundamentals at `1fa8d8fecb8a6f90466f466f409199506086dbfd`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/computer-science-fundamentals

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/3f512221-7025-4f78-8f95-366ed3e623b9/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

## Decide, for each documented item

**`match`**: compare against the **shown** proposals only.

- **FULL**: one shown proposal (or several together) states the same requirement on substantially the same scope. It would flag essentially the same violations as the documented rule.
  - Wording does not matter.
  - A proposal that lists alternatives ("wrapped in A() or B()") matches a document that allows the same alternatives.
  - Scope matches when the proposal's group covers most of the documented scope. If the document's scope is a whole package and the proposal covers the part of it where the rule actually applies, that also matches.
- **PARTIAL**: one of these:
  - the same requirement on a clearly narrower scope (one sub-area of several the document names);
  - only part of a compound requirement;
  - the same intent stated more weakly, so it would catch only some of the documented violations.
- **NONE**: anything else. Being about the same topic is not a match. For example, "routes call `getSession()`" does not match "routes must be wrapped in `withAuth()`".

**`pool_match`**: the same question, over shown **and** pool proposals. It is always at least as good as `match`.

**`followed`**: does the code follow the documented item?

1. Open two or three files in the item's scope.
2. Use grep to estimate how widely it is followed.
3. Answer `yes`, `mostly` (a few exceptions), `no`, or `unknown` (the scope has no code, or you cannot tell).

## Documented items

- **computer-science-fundamentals#R01** (naming, must; CLAUDE.md:7): In all source files, identifiers (variables, functions, types, files) must be written in English.  
  scope: ** all source files
- **computer-science-fundamentals#R02** (other, must; .claude/rules/code-style.md:9): In all mini-project and tool source files, explanatory comments must be written as one block per concept with three language sections prefixed `EN:`, `PT:`, `ES:` in that order (English first), not a line-by-line translation.  
  scope: projects/**, benchmarks/**, tools/**, quiz/** source files (comments)
- **computer-science-fundamentals#R03** (other, must; .claude/rules/code-style.md:17): In all source files, every `PT:` comment block must be accompanied by an `ES:` comment block (checked by .claude/scripts/check-es.ts).  
  scope: ** source files with trilingual comments
- **computer-science-fundamentals#R05** (typing, must; .claude/rules/code-style.md:34): In TypeScript files, code must not use the `any` type; use `unknown` and narrow it instead.  
  scope: **/*.ts, **/*.tsx
- **computer-science-fundamentals#R06** (typing, must; .claude/rules/code-style.md:34): In TypeScript files, exported functions must declare an explicit return type.  
  scope: **/*.ts, **/*.tsx exported functions
- **computer-science-fundamentals#R07** (avoid, must; .claude/rules/code-style.md:34): In TypeScript files, code must never use `@ts-ignore` to silence a type error.  
  scope: **/*.ts, **/*.tsx
- **computer-science-fundamentals#R08** (testing, must; .claude/rules/code-style.md:34): In test files, tests must not be disabled (e.g. `test.skip`, `it.skip`, commented-out tests) to silence a failure.  
  scope: **/tests/**, **/*.test.ts test files
- **computer-science-fundamentals#R09** (calls, must; .claude/rules/code-style.md:36): In TypeScript code, every external input (JSON files, HTTP request bodies, environment variables) must be validated at the boundary with a `zod` schema.  
  scope: **/*.ts code reading JSON files, HTTP bodies or env vars
- **computer-science-fundamentals#R10** (typing, must; .claude/rules/code-style.md:36): In TypeScript code, types for validated data must be derived from the Zod schema with `z.infer<typeof schema>` rather than declared separately.  
  scope: **/*.ts code with Zod schemas
- **computer-science-fundamentals#R11** (avoid, must; .claude/rules/code-style.md:36): In TypeScript code, input validation must not be implemented with hand-written validator functions; use Zod schemas.  
  scope: **/*.ts validation code
- **computer-science-fundamentals#R12** (testing, must; AGENTS.md:73): In security mini-projects, every vulnerable example must ship together with a fixed version and an automated test proving the fix.  
  scope: projects/security/** labs
- **computer-science-fundamentals#R13** (other, must; AGENTS.md:73): In security labs, services must run only locally in Docker with no external network access.  
  scope: projects/security/** docker-compose and lab code
- **computer-science-fundamentals#R15** (avoid, must; AGENTS.md:74): In load and performance test scripts (k6 and similar), targets must be `localhost` or docker-compose service names of this repository, never third-party URLs.  
  scope: projects/**/k6 scripts, load/performance test scripts
- **computer-science-fundamentals#R16** (file_layout, must; AGENTS.md:75): In .claude/skills/**, only Markdown files (and LICENSE files) may exist; scripts, hooks, installers or binaries must not be added.  
  scope: .claude/skills/**
- **computer-science-fundamentals#R17** (other, must; CONTRIBUTING.md:15): In package manifests (package.json, Cargo.toml, go.mod, requirements, mix.exs, build.gradle), dependencies must be pinned to exact stable versions; no ranges (`^`, `~`) and no `latest`, `next`, `canary`, `rc`, `beta` or `alpha` versions.  
  scope: **/package.json and other dependency manifests
- **computer-science-fundamentals#R18** (other, must; CONTRIBUTING.md:15): In Dockerfiles and docker-compose files, images must use a fixed version tag, never `latest` or a pre-release tag.  
  scope: **/Dockerfile, **/*.Dockerfile, **/docker-compose*.yml
- **computer-science-fundamentals#R19** (other, must; .claude/rules/mini-project.md:25): In JS/TS mini-projects, the runtime, package manager and test runner must be Bun (bun.lock, `bun test`) unless the mini-project is specifically about Node.js/npm.  
  scope: projects/**/ts JS/TS mini-projects
- **computer-science-fundamentals#R20** (file_layout, must; .claude/rules/mini-project.md:11): In each mini-project folder, setup scripts must be named `setup-unix-<project>.sh` and `setup-windows-<project>.ps1`.  
  scope: projects/<area>/<mini-project>/
- **computer-science-fundamentals#R22** (testing, must; .claude/rules/mini-project.md:12): In each mini-project, automated tests must exist for its implementation(s).  
  scope: projects/<area>/<mini-project>/**
- **computer-science-fundamentals#R23** (file_layout, must; .claude/rules/mini-project.md:3): Mini-projects must live at `projects/<area>/<mini-project>/` with one subfolder per language implementation (`ts/`, `go/`, `rust/`, `python/`, ...).  
  scope: projects/**
- **computer-science-fundamentals#R24** (file_layout, must; .claude/rules/mini-project.md:3): In each mini-project, TypeScript (`ts/`) must be the reference implementation; other language subfolders are added only where the lesson changes.  
  scope: projects/<area>/<mini-project>/
- **computer-science-fundamentals#R25** (render, must; .claude/rules/mini-project.md:10): In mini-project dashboards, the dashboard must be a static HTML page styled with Tailwind CSS v4 that reads the results JSON; Next.js is used only where the concept needs a server.  
  scope: projects/**/dashboard/**
- **computer-science-fundamentals#R26** (other, must; docs/en/decisions.md:26): In mini-project setup scripts, builds and tests must run inside Docker with pinned images; the scripts must require only Docker on the host, not a local language toolchain.  
  scope: projects/**/setup-unix-*.sh, projects/**/setup-windows-*.ps1
- **computer-science-fundamentals#R27** (other, should; .claude/rules/mini-project.md:24): In JS/TS mini-project Dockerfiles, the base image should be an official `oven/bun` image.  
  scope: projects/**/ts/Dockerfile
- **computer-science-fundamentals#R29** (error_handling, must; .claude/rules/mini-project.md:32): In PowerShell setup scripts, `$ErrorActionPreference = "Continue"` must be set and `$LASTEXITCODE` must be checked after each step.  
  scope: **/setup-windows-*.ps1
- **computer-science-fundamentals#R30** (file_layout, must; .claude/rules/mini-project.md:33): In static dashboards, the built `tailwind.css` must be committed next to the page.  
  scope: projects/**/dashboard/, benchmarks dashboard
- **computer-science-fundamentals#R31** (avoid, must; .claude/rules/mini-project.md:33): In static dashboard pages, data must be loaded through `<script src>` files and must not be loaded with `fetch`.  
  scope: projects/**/dashboard/*.html and scripts
- **computer-science-fundamentals#R32** (layering, must; .claude/rules/mini-project.md:35): In projects/<area>/<mini-project>/**, code must never import code from another mini-project's folder.  
  scope: projects/** source files
- **computer-science-fundamentals#R33** (other, must; .claude/rules/mini-project.md:36): In projects using Playwright, the `playwright`/`@playwright/test` package version must equal the version tag of the Playwright Docker image.  
  scope: **/package.json and Dockerfiles using Playwright
- **computer-science-fundamentals#R34** (other, must; .claude/rules/mini-project.md:37): In mini-project docker-compose files, each must declare a unique compose project `name`.  
  scope: projects/**/docker-compose*.yml
- **computer-science-fundamentals#R35** (other, must; .claude/rules/mini-project.md:37): In mini-project docker-compose files, services must not publish fixed host ports unless the demo needs one, and any published port must be bound to `127.0.0.1`.  
  scope: projects/**/docker-compose*.yml
- **computer-science-fundamentals#R36** (other, must; .claude/rules/mini-project.md:37): In mini-project setup/test scripts using docker-compose, the run must end with `docker compose down -v`.  
  scope: projects/**/setup-unix-*.sh, setup-windows-*.ps1
- **computer-science-fundamentals#R37** (other, must; .claude/rules/mini-project.md:39): In docker-compose files, services that write into the mounted project folder must set `user: "${HOST_UID:-1000}:${HOST_GID:-1000}"`, and the Unix setup script must export `HOST_UID="$(id -u)"` and `HOST_GID="$(id -g)"`.  
  scope: projects/**/docker-compose*.yml, projects/**/setup-unix-*.sh
- **computer-science-fundamentals#R38** (other, must; .claude/rules/mini-project.md:40): In docker-compose files, PostgreSQL health checks must use `pg_isready -h 127.0.0.1 -U <user> -d <db>` over TCP.  
  scope: **/docker-compose*.yml PostgreSQL services
- **computer-science-fundamentals#R39** (avoid, must; .claude/rules/mini-project.md:40): In docker-compose files, RabbitMQ health checks must use `nc -z 127.0.0.1 5672` and must not use `rabbitmq-diagnostics`.  
  scope: **/docker-compose*.yml RabbitMQ services
- **computer-science-fundamentals#R41** (other, must; .claude/rules/quiz.md:5): In quiz/, the app must be a statically generated Next.js app with no back end (no API routes or server actions); progress is stored in the browser.  
  scope: quiz/src/**
- **computer-science-fundamentals#R42** (calls, must; .claude/rules/quiz.md:6): In quiz React components, interactive controls (buttons, toggles, selects, meters, popups) must be Base UI components from `@base-ui/react`, never hand-rolled widgets.  
  scope: quiz/src/**/*.tsx components
- **computer-science-fundamentals#R43** (avoid, must; .claude/rules/quiz.md:6): In quiz components, styling must use Tailwind classes built from the theme tokens defined in `quiz/src/app/globals.css` and must never use raw colour values (hex, rgb, or default palette colours).  
  scope: quiz/src/**/*.tsx
- **computer-science-fundamentals#R44** (render, must; .claude/rules/quiz.md:6): In quiz components, navigation links must remain links (`<a>`/Next `Link`) and static markup must not be wrapped in Base UI components.  
  scope: quiz/src/**/*.tsx
- **computer-science-fundamentals#R46** (file_layout, must; .claude/rules/quiz.md:9): Quiz questions must be stored in `quiz/content/<area>/<topic>.json` and conform to the quiz schema.  
  scope: quiz/content/**
- **computer-science-fundamentals#R47** (other, must; .claude/rules/quiz.md:10): In quiz question JSON, every question must have exactly 5 alternatives with one correct `answer` index (0-4), a `difficulty` of `basic`|`intermediate`|`advanced`, a `source`, and a `miniProject` when one exists.  
  scope: quiz/content/<area>/<topic>.json
- **computer-science-fundamentals#R48** (other, must; .claude/rules/quiz.md:11): In quiz question JSON, every question must contain `en`, `pt` and `es` blocks.  
  scope: quiz/content/<area>/<topic>.json
- **computer-science-fundamentals#R52** (file_layout, must; .claude/rules/quiz.md:27): In quiz/, `sitemap.xml`, `robots.txt`, `llms.txt` and `llms-full.txt` must be generated from route files in `quiz/src/app/` using builders in `quiz/src/lib/seo.ts`; no hand-written copies may be added under `quiz/public/`.  
  scope: quiz/public/**, quiz/src/app/**
- **computer-science-fundamentals#R53** (file_layout, must; docs/en/quiz-authoring.md:19): In quiz/content/<area>/, each question file must be named `<topic-slug>.json` and the slug must exist in that area's `coverage.json`.  
  scope: quiz/content/<area>/*.json
- **computer-science-fundamentals#R54** (naming, must; docs/en/quiz-authoring.md:66): In quiz question JSON, each question `id` must follow `<area>-<topic>-<nn>` and be unique across the whole quiz.  
  scope: quiz/content/<area>/<topic>.json
- **computer-science-fundamentals#R55** (other, must; docs/en/quiz-authoring.md:71): In quiz question JSON, each language block must have exactly 5 distinct `alternatives` and exactly 5 `explanations` in the same order.  
  scope: quiz/content/<area>/<topic>.json
- **computer-science-fundamentals#R56** (other, must; docs/en/quiz-authoring.md:74): In quiz question JSON, `snippet` and `example` must be present in all three language blocks (`en`, `pt`, `es`) or in none.  
  scope: quiz/content/<area>/<topic>.json
- **computer-science-fundamentals#R57** (other, must; docs/en/quiz-authoring.md:70): In quiz question JSON, `miniProject` must be a path listed in `quiz/content/mini-projects.json`.  
  scope: quiz/content/<area>/<topic>.json
- **computer-science-fundamentals#R58** (naming, must; docs/en/quiz-authoring.md:113): In quiz theory summaries, there must be at least 3 sections and each section `id` must be a unique English kebab-case slug.  
  scope: quiz/content/<area>/theory/{en,pt,es}.json
- **computer-science-fundamentals#R59** (other, must; docs/en/quiz-authoring.md:114): In quiz theory summaries, `en.json`, `pt.json` and `es.json` must share the same section ids in the same order and the same block types in the same order per section.  
  scope: quiz/content/<area>/theory/*.json
- **computer-science-fundamentals#R60** (other, must; .claude/agents.md:57): In quiz theory summaries, `table` blocks must not have empty headers (and every row has one cell per header), and text must not use `*italic*`; use `**bold**`.  
  scope: quiz/content/<area>/theory/*.json
- **computer-science-fundamentals#R61** (other, must; docs/en/quiz-authoring.md:128): In quiz theory text, only the marks `**bold**`, `` `code` ``, `[text](https://...)` and `[[term|meaning]]` may be used; HTML is not rendered.  
  scope: quiz/content/<area>/theory/*.json
- **computer-science-fundamentals#R62** (render, must; docs/en/quiz-authoring.md:126): In quiz theory summaries, `video` blocks must have an https `url` and are rendered as links, not embedded players.  
  scope: quiz/content/<area>/theory/*.json, quiz theory renderer
- **computer-science-fundamentals#R63** (other, must; .claude/rules/security-labs.md:5): In security lab docker-compose files, services must be on a network with `internal: true` and any published port must be bound to `127.0.0.1`.  
  scope: projects/security/**/docker-compose*.yml
- **computer-science-fundamentals#R64** (testing, must; .claude/rules/security-labs.md:6): In security labs, each vulnerable example must have an automated test that fails against the vulnerable version and passes against the fixed version.  
  scope: projects/security/**/tests
- **computer-science-fundamentals#R65** (naming, must; .claude/rules/security-labs.md:9): In security labs, vulnerable code must be labelled as vulnerable in its file names and comments.  
  scope: projects/security/** vulnerable source files
- **computer-science-fundamentals#R66** (layering, must; .claude/rules/security-labs.md:9): Outside its own lab folder, no mini-project may import vulnerable security-lab code as a library.  
  scope: projects/** source files
- **computer-science-fundamentals#R67** (avoid, must; .claude/rules/security-labs.md:10): In security labs (and examples), code must not contain real credentials, tokens or personal data; only obviously fake values.  
  scope: projects/security/** and examples
- **computer-science-fundamentals#R68** (other, must; .claude/rules/load-tests.md:4): In k6 and load-test scripts, the target must come from a variable defaulting to a local address, and the script must refuse to run when the host is not local.  
  scope: projects/**/k6/*.js, load test scripts
- **computer-science-fundamentals#R69** (other, must; .claude/rules/load-tests.md:5): In cross-language benchmark implementations, each program must read the same input and print JSON with at least `n`, elapsed time and memory.  
  scope: benchmarks/**, projects/** benchmark programs
- **computer-science-fundamentals#R71** (file_layout, must; .claude/rules/git-workflow.md:12): In the repository tree, secrets, `.env` files, Terraform state (`*.tfstate`) and `.claude/settings.local.json` must never be committed.  
  scope: ** committed files
- **computer-science-fundamentals#R73** (file_layout, must; .claude/agents.md:60): When `.github/workflows/ci.yml` gains a named step, `projects/continuous-integration/ci-pipeline` must have a matching `demo/<gate>/` folder and runner case.  
  scope: projects/continuous-integration/ci-pipeline/**, .github/workflows/ci.yml
- **computer-science-fundamentals#R74** (argument, should; .claude/agents.md:62): In Bun servers handling requests that can stay silent longer than 10 seconds, `Bun.serve` must set `idleTimeout`.  
  scope: projects/**/ts Bun servers
- **computer-science-fundamentals#R75** (error_handling, must; .claude/agents.md:62): In code reading Prometheus ratio queries, a `NaN` result must be treated as a missing sample rather than a value.  
  scope: projects/observability/** Prometheus watchers
- **computer-science-fundamentals#R78** (other, must; ruff.toml:7): In Python files, code must pass ruff pycodestyle error rules (E).  
  scope: **/*.py
- **computer-science-fundamentals#R79** (other, must; ruff.toml:7): In Python files, code must pass ruff Pyflakes rules (F): no unused imports/variables, undefined names, etc.  
  scope: **/*.py
- **computer-science-fundamentals#R80** (other, must; ruff.toml:7): In Python files, code must pass ruff pycodestyle warning rules (W).  
  scope: **/*.py
- **computer-science-fundamentals#R81** (other, must; ruff.toml:7): In Python files, imports must be sorted according to ruff isort rules (I).  
  scope: **/*.py
- **computer-science-fundamentals#R82** (avoid, must; ruff.toml:7): In Python files, code must pass ruff flake8-bugbear rules (B), e.g. no mutable default arguments.  
  scope: **/*.py
- **computer-science-fundamentals#R83** (other, must; ruff.toml:7): In Python files, code must use modern syntax for Python 3.14 per ruff pyupgrade rules (UP).  
  scope: **/*.py
- **computer-science-fundamentals#R84** (other, must; ruff.toml:7): In Python files, code must pass ruff flake8-simplify rules (SIM).  
  scope: **/*.py
- **computer-science-fundamentals#R85** (typing, must; ruff.toml:7): In Python files, functions must have type annotations on arguments and return values (ruff ANN).  
  scope: **/*.py functions
- **computer-science-fundamentals#R87** (typing, must; biome.json:19): In JS/TS files, code must not use an explicit `any` type (Biome noExplicitAny at error).  
  scope: **/*.ts, **/*.tsx, **/*.js
- **computer-science-fundamentals#R88** (error_handling, must; .golangci.yml:8): In Go files, error wrapping and comparison must use `errors.Is`/`errors.As` and `%w` rather than `==` or type assertions on errors (errorlint).  
  scope: **/*.go
- **computer-science-fundamentals#R89** (other, must; .golangci.yml:9): In Go files, code must pass gocritic checks.  
  scope: **/*.go
- **computer-science-fundamentals#R90** (naming, must; .golangci.yml:10): In Go files, code must pass revive style checks (exported-symbol comments, naming, etc.).  
  scope: **/*.go
- **computer-science-fundamentals#R93** (typing, must; quiz/tsconfig.json:7 (also projects/**/ts/tsconfig.json)): In TypeScript projects, code must compile under TypeScript `strict` mode.  
  scope: quiz/**, projects/**/ts/** TypeScript
- **computer-science-fundamentals#R94** (typing, must; quiz/tsconfig.json:8 (also projects/**/ts/tsconfig.json)): In TypeScript projects, indexed access results must be treated as possibly `undefined` and checked (noUncheckedIndexedAccess).  
  scope: quiz/**, projects/**/ts/** TypeScript
- **computer-science-fundamentals#R95** (other, must; projects/operating-systems/paging-tlb/rust/Dockerfile:9): In Rust mini-projects, code must produce no clippy warnings (warnings are errors).  
  scope: projects/**/rust/**/*.rs
- **computer-science-fundamentals#R96** (avoid, must; .claude/skills/ponytail/SKILL.md:58): In all code, there must be no interface with only one implementation, no factory for a single product, and no configuration for a value that never changes.  
  scope: ** source files
- **computer-science-fundamentals#R97** (other, should; .claude/skills/ponytail/SKILL.md:64): In all code, deliberate simplifications with a known ceiling must be marked with a `ponytail:` comment naming the ceiling and the upgrade path.  
  scope: ** source files
- **computer-science-fundamentals#R99** (avoid, must; .claude/skills/security-and-hardening/SKILL.md:81): In code that talks to databases or shells, queries must be parameterized and SQL, NoSQL or shell commands must never be built by concatenating input strings.  
  scope: ** database and shell-calling code (outside deliberate vulnerable lab code)
- **computer-science-fundamentals#R100** (avoid, must; .claude/skills/security-and-hardening/SKILL.md:71): In JS/TS code, `eval()` and `innerHTML` must never be used with user-provided data.  
  scope: **/*.ts, **/*.tsx, **/*.js, **/*.html
- **computer-science-fundamentals#R101** (avoid, must; .claude/skills/security-and-hardening/SKILL.md:72): In front-end code, auth tokens and sessions must never be stored in `localStorage` or other client-accessible storage.  
  scope: ** browser code
- **computer-science-fundamentals#R102** (avoid, must; .claude/skills/security-and-hardening/SKILL.md:68): In all code, logging calls must never include passwords, tokens, secrets, full card numbers or full PII.  
  scope: ** logging code
- **computer-science-fundamentals#R103** (error_handling, must; .claude/skills/security-and-hardening/SKILL.md:73): In HTTP handlers, error responses must never expose stack traces or internal error details to users.  
  scope: ** HTTP handlers / error middleware
- **computer-science-fundamentals#R104** (other, must; .claude/skills/security-and-hardening/SKILL.md:97): In HTTP servers, CORS must be restricted to an explicit origin list from configuration and must never use `*` with credentials.  
  scope: ** HTTP server configuration
- **computer-science-fundamentals#R105** (calls, must; .claude/skills/security-and-hardening/SKILL.md:89): In authentication code, passwords must be hashed with bcrypt (>=12 rounds), scrypt or argon2, and session secrets must be read from the environment, never hard-coded.  
  scope: ** auth code
- **computer-science-fundamentals#R106** (argument, must; .claude/skills/security-and-hardening/SKILL.md:52): In server code setting session cookies, cookies must be `httpOnly`, `secure` and `sameSite`.  
  scope: ** session cookie code
- **computer-science-fundamentals#R107** (argument, must; .claude/skills/observability-and-instrumentation/SKILL.md:125): In metrics instrumentation, metric labels must come from small fixed sets and must never be user IDs, raw URLs, error messages or other unbounded values.  
  scope: ** metrics instrumentation code
- **computer-science-fundamentals#R108** (render, should; .claude/skills/frontend-ui-engineering/SKILL.md:114): In React components, props should not be drilled through more than 3 levels of components that do not use them.  
  scope: **/*.tsx React components
- **computer-science-fundamentals#R109** (avoid, should; .claude/skills/frontend-ui-engineering/SKILL.md:172): In UI code, colours should use semantic color tokens, not raw hex values.  
  scope: **/*.tsx, **/*.css UI code
- **computer-science-fundamentals#R110** (naming, should; .claude/skills/code-simplification/SKILL.md:142): In all code, identifiers should use full words rather than abbreviations like `usr`, `cfg`, `btn`, `evt`, except universal ones (`id`, `url`, `api`).  
  scope: ** source files
- **computer-science-fundamentals#R111** (error_handling, should; .claude/skills/api-and-interface-design/SKILL.md:86): In an API or module interface, error signalling must follow one consistent pattern (throw vs. return null vs. return `{ error }`), not a mix.  
  scope: ** API endpoints and module interfaces
- **computer-science-fundamentals#R112** (testing, should; .claude/skills/test-driven-development/SKILL.md:310): In tests, real implementations should be preferred over fakes, stubs and mocks; mocks should be used only at boundaries where real dependencies are slow or non-deterministic.  
  scope: ** test files

## Proposals shown to the user

```text
[D-6e4ada] workspace packages define a `test` script
    evidence: 60/63 (lower bound 0.87, lift 1.0)
    example:  benchmarks/package.json#benchmarks
    outlier:  projects/observability/three-signals/screenshot/package.json:1 three-signals-screenshot
    outlier:  projects/testing/mini-xunit/ts/package.json:1 mini-xunit
    outlier:  projects/testing/test-pyramid/ts/package.json:1 test-pyramid
```

```text
[D-a0d1d2] workspace packages enable `noEmit` in tsconfig
    evidence: 58/63 (lower bound 0.83, lift 1.0)
    example:  benchmarks/package.json#benchmarks
    outlier:  projects/algorithms/dynamic-programming/ts/package.json:1 dynamic-programming
    outlier:  projects/algorithms/sorting-race/ts/package.json:1 sorting-race
    outlier:  projects/algorithms/travelling-salesman/ts/package.json:1 travelling-salesman
    outlier:  projects/concurrency/counter-race/ts/package.json:1 counter-race
    outlier:  projects/concurrency/ten-thousand-connections/ts/package.json:1 ten-thousand-connections
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "computer-science-fundamentals#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
