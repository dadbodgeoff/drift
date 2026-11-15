You are checking whether a tool's proposed conventions for the repository **e2e** (https://github.com/tester-army/e2e at `f185ca8ba2d8a0b1eb68776df832f44b645277ea`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/e2e

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/0855e865-b03f-4bd1-a8a4-d21563399235/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **e2e#R01** (testing, must; AGENTS.md:12-14): In packages/e2e/tests/types/sdk-types.ts, public API type guarantees must be pinned as compile-time `@ts-expect-error` assertions run by the package typecheck, not as vitest tests.  
  scope: packages/e2e/tests/types/sdk-types.ts type tests
- **e2e#R02** (file_layout, must; AGENTS.md:15-20): In packages/e2e/schema/, every *.schema.json must have a valid and an invalid fixture, and a change to a wire producer must update the schema and both fixtures in the same change.  
  scope: packages/e2e/schema/*.schema.json and their producers
- **e2e#R03** (error_handling, must; AGENTS.md:25-28): In packages/*/src, every error code raised must be documented in docs/reference/errors.mdx or docs/reference/engine.mdx, and no documented code may be raised nowhere.  
  scope: packages/*/src/** error codes
- **e2e#R04** (layering, must; AGENTS.md:38-41): In packages/e2e/src/**, code must not import (statically or dynamically) any `@e2e-dev/*` engine package; only the init presets may name them, as text.  
  scope: packages/e2e/src/** all files
- **e2e#R05** (import_restriction, must; AGENTS.md:44-49): In packages/e2e/src/cli/init/engines.ts, presets must name engine packages only as string text and must not import engine implementations.  
  scope: packages/e2e/src/cli/init/engines.ts
- **e2e#R06** (import_restriction, must; AGENTS.md:65-68): In packages/e2e/src, `@ai-sdk/*` optional peers must be imported only from their e2e/oauth/* constructor module, and the Copilot constructor must load `@ai-sdk/openai` via a lazy dynamic import; the CLI must not import them eagerly.  
  scope: packages/e2e/src/oauth/** and packages/e2e/src/cli/**
- **e2e#R07** (other, must; AGENTS.md:68-71): In packages/e2e/src/oauth/**, only the model constructors (e2e/oauth/* entries) and CLI commands may be public; sign-in flows, token stores and fetch helpers must not be exported from package entry points.  
  scope: packages/e2e/src/oauth/** modules
- **e2e#R08** (testing, must; AGENTS.md:71-72): In packages/e2e, tests under tests/live/ must not be included in the vitest projects run by `pnpm test`.  
  scope: packages/e2e/tests/live/** and vitest config
- **e2e#R09** (import_restriction, must; AGENTS.md:77-80): In packages/web/src/**, imports of the runner must come from `e2e/engine` only (no other `e2e` subpath, no `e2e/internal`, no runner source paths).  
  scope: packages/web/src/** engine implementation
- **e2e#R10** (layering, must; AGENTS.md:75-76): packages/web/package.json must declare `e2e` as a peer dependency, and packages/e2e must not depend on `@e2e-dev/web` at runtime.  
  scope: packages/web/package.json, packages/e2e/package.json
- **e2e#R11** (import_restriction, must; AGENTS.md:83-85): In packages/mobile/src/**, the engine implementation must import from the runner only via `e2e/engine`, and `e2e` must be a peer dependency.  
  scope: packages/mobile/src/** engine implementation
- **e2e#R12** (import_restriction, must; AGENTS.md:86-88): In packages/mobile, the main entry (src/index.ts and what it imports) must not import the AI SDK (`ai`, `@ai-sdk/*`); agent-side tools live in the `@e2e-dev/mobile/tools` subpath.  
  scope: packages/mobile/src main entry
- **e2e#R13** (typing, must; AGENTS.md:96-99): In packages/e2e/src, the harness must hold engines only as protocol clients: `ResolvedTarget.engine` is typed `EngineClientHandle`, and `defineEngine` handles are served over `loopbackTransport` rather than called directly.  
  scope: packages/e2e/src/** harness/runner code
- **e2e#R14** (naming, must; AGENTS.md:101-103): Under packages/, each hosted-service integration must be its own package named `@e2e-dev/<service>`, declaring the vendor SDK and the engine it plugs into as peer dependencies.  
  scope: packages/* integration packages (package.json)
- **e2e#R15** (import_restriction, must; AGENTS.md:104-106): In integration packages (packages/kernel, eas, smol, testmu, browserstack, lightpanda, limrun), code must implement `BrowserProvider`/`DeviceProvider` and import only types (`import type`) from the engine package.  
  scope: packages/{kernel,lightpanda,eas,smol,limrun,testmu,browserstack}/src/**
- **e2e#R16** (layering, must; AGENTS.md:105-106): In packages/web/src and packages/mobile/src, engine code must not import any integration package (e.g. `@e2e-dev/kernel`, `@e2e-dev/testmu`, `@e2e-dev/eas`).  
  scope: packages/web/src/**, packages/mobile/src/**
- **e2e#R17** (layering, must; AGENTS.md:106-109): In a two-engine integration package (e.g. packages/testmu), each provider entry must not import the other engine: the mobile entry must not import `@e2e-dev/web` and the `/web` entry must not import `@e2e-dev/mobile`.  
  scope: packages/testmu/src/** entries
- **e2e#R18** (calls, must; AGENTS.md:160-162): In packages/github/src, the reporter must render the comment with `renderMarkdownReport` imported from `e2e` rather than its own renderer.  
  scope: packages/github/src/** reporter
- **e2e#R19** (avoid, must; AGENTS.md:160-162): In packages/github/src, the reporter factory must not read the GitHub token, event or repository (env vars/files) at construction/config load; it reads them only when the run finishes.  
  scope: packages/github/src/** reporter
- **e2e#R20** (file_layout, must; AGENTS.md:176-178): In apps/testbed, tests must be deterministic runner-feature tests; hard UI surface scenarios must go in apps/web-benchmark or apps/mobile-benchmark instead.  
  scope: apps/testbed/tests*/** and app pages
- **e2e#R22** (testing, must; AGENTS.md:186-189): In apps/web-benchmark/tests-agent/control-inventory.e2e.ts, there must be one agentic test per agent verb exercised by the Control Inventory scenario.  
  scope: apps/web-benchmark/tests-agent/control-inventory.e2e.ts
- **e2e#R23** (testing, must; AGENTS.md:194-195): In apps/mobile-benchmark, tests/ suites must use locators only (no agent.* steps), and tests-agent/ suites must use one `agent.act` per scenario.  
  scope: apps/mobile-benchmark/tests/**, apps/mobile-benchmark/tests-agent/**
- **e2e#R24** (naming, must; AGENTS.md:200-202): In apps/mobile-benchmark scenario files, code and text must not name any company a scenario was distilled from, and diffs against the source must stay minimal.  
  scope: apps/mobile-benchmark scenario files
- **e2e#R25** (file_layout, must; AGENTS.md:206-208): In examples/*, projects must not commit a lockfile and must depend on the published npm packages, outside the pnpm workspace.  
  scope: examples/*/ project roots
- **e2e#R26** (file_layout, must; AGENTS.md:214-218): Every example folder under examples/ must have an official entry in examples/examples.json and a matching preset in packages/e2e/src/cli/init/examples.ts.  
  scope: examples/*, packages/e2e/src/cli/init/examples.ts
- **e2e#R27** (file_layout, must; AGENTS.md:219-221): In native, Flutter and .NET MAUI examples, e2e tests and config must live in an `e2e/` folder beside the native project.  
  scope: examples/with-{swiftui,compose,kotlin-multiplatform,flutter,maui}/
- **e2e#R28** (other, must; AGENTS.md:347-348): In all TypeScript files, relative import specifiers must end in `.ts`, never `.js` or extensionless.  
  scope: **/*.ts all files
- **e2e#R29** (typing, must; AGENTS.md:349-351): In all TypeScript files, optional properties must be set with the conditional-spread idiom (`...(x === undefined ? {} : { x })`) instead of assigning `undefined`.  
  scope: **/*.ts all files
- **e2e#R30** (other, must; AGENTS.md:355-358): Across the workspace, there must be no unused files, unused exports, unused dependencies, or duplicate export names.  
  scope: packages/**, apps/**, scripts/** (fallow scope)
- **e2e#R31** (other, must; AGENTS.md:358-359): In packages/*/src, a symbol must not be exported if its only consumer is a test; keep it module-private or move it into the test.  
  scope: packages/*/src/** exports
- **e2e#R32** (other, must; AGENTS.md:360): In all source files, new functions must carry a JSDoc comment.  
  scope: **/*.ts functions
- **e2e#R33** (avoid, should; AGENTS.md:360): In all source files, inline comments should be avoided unless they explain why, not what, the code does.  
  scope: **/*.ts all files
- **e2e#R34** (testing, must; AGENTS.md:364-366): In the vitest config, the `integration` project must keep `maxWorkers: 3` (pool 'forks') and must not raise it.  
  scope: packages/e2e/vitest.config.* integration project
- **e2e#R35** (testing, must; AGENTS.md:367-370): In packages/e2e/tests/integration, tests must write fixture projects under tests/tmp-projects/ and import the runner from dist/ through a non-literal (computed) specifier.  
  scope: packages/e2e/tests/integration/**
- **e2e#R36** (testing, must; AGENTS.md:383-384): In agentic test suites, assertions on model output must check meaning with `toContain` rather than an exact model-produced string.  
  scope: apps/*/tests-agent/**, apps/testbed agent tests
- **e2e#R37** (testing, must; AGENTS.md:383-384): In agentic test suites, every agent.* step must be followed by a deterministic locator check (`expect(screen.getBy...)`).  
  scope: apps/*/tests-agent/**, agentic *.e2e.ts tests
- **e2e#R39** (testing, must; AGENTS.md:447-448): In packages/web/tests/crosscheck/expected.txt, every crosscheck disagreement must be listed with a reason (no `TODO` reasons).  
  scope: packages/web/tests/crosscheck/expected.txt
- **e2e#R40** (testing, must; AGENTS.md:452-454): In packages/web/tests/crosscheck, deliberate vocabulary choices must be expressed as policies at the top of crosscheck.ts with a reason, not as lines in expected.txt.  
  scope: packages/web/tests/crosscheck/crosscheck.ts
- **e2e#R41** (testing, should; AGENTS.md:455-456): A fix to packages/web/src/in-page/read-semantics.ts should come with a fixture page in packages/web/tests/crosscheck/fixtures.ts that reproduces the bug.  
  scope: packages/web/src/in-page/read-semantics.ts, packages/web/tests/crosscheck/fixtures.ts
- **e2e#R42** (testing, must; AGENTS.md:457-459): In packages/web/tests/crosscheck/fixtures.ts, fixture pages must build their content synchronously, not with timers.  
  scope: packages/web/tests/crosscheck/fixtures.ts
- **e2e#R43** (testing, must; AGENTS.md:463-465): In packages/web/tests/conformance/expected.txt, disagreements must be grouped by reason, and a fix to a `Bug:` entry must delete that line.  
  scope: packages/web/tests/conformance/expected.txt
- **e2e#R44** (error_handling, must; AGENTS.md:561): In packages/*/src, when a security invariant cannot be enforced the code must fail closed (refuse/throw) rather than proceed.  
  scope: packages/*/src/** security-relevant paths
- **e2e#R45** (avoid, must; AGENTS.md:562-563): In packages/*/src, secret values must never be written as text into model input, digests, logs, reports, or artifacts; they are redacted first.  
  scope: packages/*/src/** runner, agent, reporters
- **e2e#R46** (avoid, must; AGENTS.md:571-572): In packages/e2e/src, the harness must never include an executor's `attempt.memory` in reports.  
  scope: packages/e2e/src/** reporting
- **e2e#R47** (calls, must; AGENTS.md:573-578): In packages/e2e/src, an agent's secret fill must go through `typeSecret` with a handle declared in the step params, resolve its target via `feed.resolve`/`requireLatest`, and be authorized by `authorizeSecretFill`.  
  scope: packages/e2e/src/agent/** action dispatch
- **e2e#R48** (error_handling, must; AGENTS.md:582-586): In packages/e2e/src/agent, every model tool call must be parsed with a closed (strict) schema and authorized immediately before dispatch; unknown tools or fields return a `tool-error` result and nothing runs.  
  scope: packages/e2e/src/agent/** tool dispatch
- **e2e#R49** (error_handling, must; AGENTS.md:587-590): In packages/*/src, a node id missing from the current screen must raise `LOCATOR_NOT_FOUND`, and `POLICY_DENIED` must be used only for denied destinations, forbidden fills and withheld pixels.  
  scope: packages/*/src/** error raising
- **e2e#R50** (avoid, must; AGENTS.md:590-591): In packages/*/src, model output text must never be passed to eval/Function, used as a selector, run as shell, or parsed as config.  
  scope: packages/*/src/** agent and engine code
- **e2e#R51** (calls, must; AGENTS.md:592-597): In packages/*/src, every navigation (`app.open`, `browser.goto`, the `navigate` verb) must go through `resolveNavigationUrl`, which allows only http:, https: and exact about:blank and raises `POLICY_DENIED` otherwise.  
  scope: packages/e2e/src/**, packages/web/src/** navigation
- **e2e#R52** (calls, must; AGENTS.md:597-599): In packages/mobile/src, `device.openLink` must reject the schemes file:, data:, javascript:, view-source:, blob: and filesystem: via packages/mobile/src/links.ts.  
  scope: packages/mobile/src/links.ts and openLink callers
- **e2e#R53** (other, must; AGENTS.md:602-603): In packages/e2e/src, saved sessions must be AES-256-GCM encrypted with a key held only in memory, bound to a target, deleted at cleanup, and session payloads must never be logged or included in diagnostics.  
  scope: packages/e2e/src/run/** sessions
- **e2e#R54** (other, must; AGENTS.md:604-605): In reporters, output must be escaped for its context and stripped of terminal control sequences, artifact names must be generated, and test/step labels must never be used as path components.  
  scope: packages/*/src/** reporters and artifact writers
- **e2e#R60** (import_restriction, must; AGENTS.md:706-710): In the repository, code and manifests must not reference the retired package names `@e2edev/*`, `@e2edev/e2e`, `@e2edev/oauth` or `@e2e-dev/integrations`.  
  scope: all files
- **e2e#R61** (other, must; .oxlintrc.json:4): In all linted files, oxlint `correctness` category rules are errors.  
  scope: all linted files (excluding ignorePatterns)
- **e2e#R62** (other, must; .oxlintrc.json:5): In all linted files, oxlint `suspicious` category rules are errors.  
  scope: all linted files (excluding ignorePatterns)
- **e2e#R63** (other, must; .oxlintrc.json:6): In all linted files, oxlint `perf` category rules are errors.  
  scope: all linted files (excluding ignorePatterns)
- **e2e#R69** (typing, must; .oxlintrc.json:41-43; scripts/oxlint-plugin/no-chained-type-assertions.ts:65-81): In packages/*/src/**, code must not nest two or more type assertions (`x as unknown as T`, `<T><U>x`, including through parentheses); chains made only of `as const` are allowed.  
  scope: packages/*/src/** all files
- **e2e#R70** (typing, must; .oxlintrc.json:41-44; scripts/oxlint-plugin/no-unchecked-json.ts:158-195): In packages/*/src/**, the result of `JSON.parse(...)` or a no-argument `.json()` call (also through await, `!`, `satisfies`, `.catch(...)`, `.then(r => r.json())`) must be typed `unknown` (or `Promise<unknown>`) wherever it lands: `as` targets, annotated variables, assignments to declared variables, and annotated function returns; it must then be parsed with a schema or narrowed.  
  scope: packages/*/src/** all files
- **e2e#R72** (other, should; .fallowrc.json:57): Across the workspace, unused class members should not exist (fallow unused-class-member at warn).  
  scope: packages/**, apps/**, scripts/** classes
- **e2e#R73** (import_restriction, should; .fallowrc.json:58): Production source should not import packages declared only as devDependencies (fallow dev-dependencies-in-production at warn).  
  scope: packages/*/src/** imports
- **e2e#R74** (other, must; CONTRIBUTING.md:309-311): In published packages, a deprecated public API/config key/CLI flag must keep working and print a one-line runtime warning naming its replacement (the first time it is used in a run) before it is removed.  
  scope: packages/*/src/** public surface
- **e2e#R77** (testing, must; docs/coding-agents.mdx:154-158): In e2e test files, each `agent.act` call must cover one atomic goal and be followed by an `expect`.  
  scope: **/*.e2e.ts test files
- **e2e#R78** (avoid, must; docs/coding-agents.mdx:159-160): In e2e test files, tests must not contain sleeps or fixed delays.  
  scope: **/*.e2e.ts test files
- **e2e#R79** (calls, must; docs/coding-agents.mdx:161-162): In e2e test files, credentials must be obtained via `credentials.user(name)` (declared in the config) and never written as literals in the test.  
  scope: **/*.e2e.ts test files
- **e2e#R80** (argument, should; docs/agents.mdx:77): In e2e tests, `agentContext` on test/describe should hold only facts (vocabulary, seeded data), not instructions to the agent.  
  scope: **/*.e2e.ts describe/test options
- **e2e#R82** (import_restriction, must; skills/e2e/SKILL.md:221-224): In e2e test files (repo suites follow this skill per .dev/skills/verify), `test`, `describe`, hooks, `expect`, `credentials` and `secrets` must be imported from `e2e`, except tests using the `browser` fixture, which import `test`, `describe` and hooks from `@e2e-dev/web`.  
  scope: apps/*/tests*/**/*.e2e.ts, examples/**/*.e2e.ts
- **e2e#R83** (typing, must; skills/e2e/SKILL.md:217-219): In e2e config files, the config must be `export default { ... } satisfies E2EConfig` with `import type { E2EConfig } from 'e2e'`, declare `targets`, and each UI target must name its engine (`engine: web()`/`mobile()`).  
  scope: apps/*/e2e*.config.ts, examples/**/e2e.config.ts
- **e2e#R84** (avoid, must; skills/e2e/SKILL.md:146-149): In e2e test files, code must not use `setTimeout` or `waitForTimeout` delays; it waits for a state with `agent.waitFor(...)` or a matcher instead.  
  scope: **/*.e2e.ts test files
- **e2e#R85** (calls, must; skills/e2e/SKILL.md:233-237): In e2e test files, sensitive values must be resolved via `credentials.user(name)` or `secrets.get(name)` and the opaque `Secret` passed only to `fill()` or `agent.act` params.  
  scope: **/*.e2e.ts test files
- **e2e#R86** (testing, should; .dev/skills/verify/SKILL.md:54-58): A runner feature that must stay proven should get a testbed page plus a deterministic test in apps/testbed; a hard UI surface gets a benchmark scenario; these tests follow skills/e2e.  
  scope: apps/testbed/**, apps/*-benchmark/**
- **e2e#R87** (avoid, should; .dev/skills/ship-pr/references/review-prompt.md:25): In all source files, comments must not narrate what the code does.  
  scope: **/*.ts all files
- **e2e#R88** (error_handling, should; .dev/skills/ship-pr/references/review-prompt.md:26): In all source files, code should not add defensive checks or try/catch blocks the call site does not need.  
  scope: **/*.ts all files
- **e2e#R89** (typing, should; .dev/skills/ship-pr/references/review-prompt.md:26-27): In all source files, code must not use `as` casts or `any` to silence type errors.  
  scope: **/*.ts all files
- **e2e#R90** (avoid, should; .dev/skills/ship-pr/references/review-prompt.md:27): In all source files, changes must not leave dead code behind.  
  scope: **/*.ts all files
- **e2e#R92** (avoid, should; .dev/skills/ship-pr/references/review-prompt.md:28): In all source files, code must not hand-roll retry loops or sleeps.  
  scope: **/*.ts all files
- **e2e#R94** (avoid, should; .dev/skills/babysit/references/review-triage.md:70-71): In in-page code (run inside the app's page), code must not rely on page-overridable globals such as `JSON.stringify`, `Function.prototype.toString` or prototypes, nor on `instanceof` across frames.  
  scope: packages/web/src/in-page/** and page.evaluate callbacks
- **e2e#R95** (naming, should; .dev/skills/babysit/references/review-triage.md:86-87): In packages/e2e/src (core), identifiers must not use engine nouns (`Web`, `browser`, `page`, `route`, `playwright`) outside the `init` presets.  
  scope: packages/e2e/src/** excluding src/cli/init/**
- **e2e#R96** (avoid, should; .dev/skills/babysit/references/review-triage.md:82-83): In platform-specific code paths, code should not invoke macOS-only tools on Android paths or assume POSIX paths or symlinks on Windows.  
  scope: packages/*/src/** platform-specific paths

## Proposals shown to the user

```text
[D-6c629b] apps/mobile-benchmark: components in src/Examples/** render <View>
    evidence: 23/25 (lower bound 0.75, lift 3.0)
    example:  apps/mobile-benchmark/src/Examples/ApplePay.tsx#ApplePay
    outlier:  apps/mobile-benchmark/src/Examples/BottomTabs.tsx:49 BottomTabs
    outlier:  apps/mobile-benchmark/src/Examples/TextInputs.tsx:14 TextInputs
```

```text
[D-d07023] packages/mobile: functions in src/** do not throw a bare Error
    evidence: 51/52 (lower bound 0.90, lift 7.3)
    example:  packages/mobile/src/actions.ts#pointerInteraction
    outlier:  packages/mobile/src/lease/index.ts:65 agentDeviceLeases
```

```text
[D-ebee38] apps/mobile-benchmark: components in src/** render <Text>
    evidence: 24/26 (lower bound 0.76, lift 2.9)
    example:  apps/mobile-benchmark/src/Examples/ApplePay.tsx#ApplePay
    outlier:  apps/mobile-benchmark/src/App.tsx:45 App
    outlier:  apps/mobile-benchmark/src/Examples/BottomTabs.tsx:49 BottomTabs
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "e2e#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
