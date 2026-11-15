You are checking whether a tool's proposed conventions for the repository **genkit** (https://github.com/genkit-ai/genkit at `63fba09ba65b3d29261501e8d91d7c6d845cd9d7`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/genkit

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/a4c10c6a-cfc2-4284-822b-2a17a5fbdf12/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **genkit#R01** (other, must; CONTRIBUTING.md:193): In js/**, every exported member must have a valid JSDoc comment.  
  scope: js/** exported members
- **genkit#R02** (calls, must; go/GEMINI.md:7): In go/**, components that should be discoverable by tools or the Dev UI must be created with genkit.DefineX (DefineFlow, DefineTool, ...) so they are registered in the registry.  
  scope: go/** Genkit component definitions
- **genkit#R03** (argument, must; go/GEMINI.md:8): In go/**, every Genkit function and tool execution must take a context.Context and pass it through to callees.  
  scope: go/** Genkit functions and tools
- **genkit#R04** (avoid, must; go/GEMINI.md:8): In go/**, implementation code must not call context.Background() except at the program entry point.  
  scope: go/** non-entry-point code
- **genkit#R05** (typing, must; go/GEMINI.md:9): In go/**, input and output types of Flows and Tools must be Go structs with json struct tags on their fields.  
  scope: go/** flow and tool input/output types
- **genkit#R08** (calls, should; go/GEMINI.md:28): In go/**, internal, dynamically created or test-only components should be created with NewX (e.g. NewTool) rather than DefineX so they are not registered.  
  scope: go/** component construction
- **genkit#R09** (argument, must; go/GEMINI.md:30): In go/**, optional configuration parameters of constructors and methods must be expressed as functional options (e.g. ai.WithModel, genkit.WithPlugins).  
  scope: go/** constructors and public methods
- **genkit#R10** (calls, must; go/GEMINI.md:35): In go/**, orchestration tasks must be defined with genkit.DefineFlow using typed struct input and output types.  
  scope: go/** flows
- **genkit#R11** (wrapper, should; go/GEMINI.md:49): In go/** flows, discrete steps inside a flow should be wrapped in genkit.Run(ctx, name, fn) to create a trace span.  
  scope: go/** flow implementations
- **genkit#R13** (calls, should; go/GEMINI.md:78): In go/**, structured model output into a Go struct should be obtained with genkit.GenerateData[T] rather than manual JSON parsing of generated text.  
  scope: go/** model generation calls
- **genkit#R14** (typing, must; go/GEMINI.md:99): In go/**, code must not use interface{} or any unless absolutely necessary and documented with a comment.  
  scope: go/** all files
- **genkit#R15** (avoid, should; go/GEMINI.md:100): In go/**, code should not suppress linter warnings (e.g. //nolint) without a documented reason.  
  scope: go/** all files
- **genkit#R23** (error_handling, must; go/GEMINI.md:137): In go/**, errors must be handled with explicit `if err != nil` checks.  
  scope: go/** all files
- **genkit#R24** (naming, should; go/GEMINI.md:138): In go/**, variables in short scopes should use short names (e.g. i for index, ctx for context.Context).  
  scope: go/** local variables
- **genkit#R25** (layering, must; go/GEMINI.md:139): In go/**, interfaces must be declared in the consuming package, not in the package that implements them.  
  scope: go/** interface declarations
- **genkit#R27** (other, must; go/GEMINI.md:142): In go/**, code comments must use proper punctuation (full sentences ending with a period).  
  scope: go/** comments
- **genkit#R28** (naming, must; go/GEMINI.md:143): In go/**, function doc comments must start with the function's name.  
  scope: go/** function doc comments
- **genkit#R29** (other, must; go/GEMINI.md:144): In go/**, TODO comments must use the format `// TODO(issue-id): description.`  
  scope: go/** TODO comments
- **genkit#R30** (other, must; go/GEMINI.md:149): In go/**, exported packages, types and functions must have GoDoc-style doc comments.  
  scope: go/** exported identifiers and packages
- **genkit#R31** (testing, should; go/GEMINI.md:155): In go/**, complex APIs should have Example functions in _test.go files.  
  scope: go/** _test.go files for complex public APIs
- **genkit#R32** (testing, must; go/GEMINI.md:167): In go/** tests, code must use Genkit primitives and helper functions instead of mocking Genkit types.  
  scope: go/** _test.go files
- **genkit#R33** (argument, should; go/GEMINI.md:171): In go/**, flows and actions should declare default input values.  
  scope: go/** flow and action definitions
- **genkit#R34** (other, must; go/GEMINI.md:172): In go/samples/**, each sample's package comment must explain what the sample demonstrates, why and how, and how to test it.  
  scope: go/samples/** package comments
- **genkit#R35** (layering, should; go/GEMINI.md:173): In go/** core framework and plugin code (outside go/samples), code and comments should not reference sample-specific details.  
  scope: go/{ai,core,genkit,plugins,internal}/**
- **genkit#R38** (avoid, must; go/GEMINI.md:178): In go/**, code must not contain dead code or unused imports.  
  scope: go/** all files
- **genkit#R40** (import_restriction, must; go/GEMINI.md:188): In go/** core tests, test code must use the standard testing package and must not import external assertion libraries such as github.com/stretchr/testify.  
  scope: go/** _test.go files (new core code; existing plugins exempt)
- **genkit#R41** (testing, must; go/GEMINI.md:190): In go/** tests, assertions must be plain if blocks comparing got and want, reporting via t.Errorf("f() = %v, want %v", got, want).  
  scope: go/** _test.go files
- **genkit#R42** (testing, must; go/GEMINI.md:199): In go/** tests, comparisons of structs, slices and maps must use cmp.Diff from github.com/google/go-cmp/cmp (with cmpopts as needed) and report "mismatch (-want +got)".  
  scope: go/** _test.go files
- **genkit#R44** (calls, should; go/GEMINI.md:211): In go/**, code should use modern Go idioms such as the slices and maps standard packages instead of hand-written loops.  
  scope: go/** all files
- **genkit#R45** (testing, should; go/GEMINI.md:213): In go/** tests, Genkit flows and tools should be tested by calling flow.Run(ctx, input) or tool.Run(ctx, input) directly.  
  scope: go/** _test.go files
- **genkit#R46** (testing, should; go/GEMINI.md:214): In go/** tests, tests of components created with DefineX should assert the Action's input and output schemas.  
  scope: go/** _test.go files
- **genkit#R47** (testing, must; go/GEMINI.md:215): In go/** tests, flows that call models must be tested against a mock model implementation, not a live model.  
  scope: go/** _test.go files for flows
- **genkit#R49** (calls, must; go/GEMINI.md:220): In go/**, logging must use the core/logger package functions (logger.Debug/Info/Warn/Error with ctx) whenever a context.Context is available; log/slog may be used only where no context exists.  
  scope: go/** logging calls
- **genkit#R50** (other, must; go/GEMINI.md:221): In go/**, log messages must be lowercase stable phrases without trailing punctuation, with structured key/value attributes.  
  scope: go/** logging calls
- **genkit#R51** (avoid, must; go/GEMINI.md:221): In go/**, log calls must not build the message with fmt.Sprintf; variable data goes into attributes.  
  scope: go/** logging calls
- **genkit#R52** (naming, must; go/GEMINI.md:221): In go/**, log calls must use the attribute key "error" (not "err") for error values.  
  scope: go/** logging calls
- **genkit#R53** (other, must; go/GEMINI.md:222): In go/**, log levels must follow: Debug for per-request detail, Info only for one-time lifecycle events, Warn for misconfiguration/fallbacks/skipped work, Error only where the error is not returned to the caller.  
  scope: go/** logging calls
- **genkit#R54** (error_handling, must; go/GEMINI.md:222): In go/**, code must not both log an error and return that same error.  
  scope: go/** error handling
- **genkit#R55** (file_layout, must; go/GEMINI.md:226): In go/**, every source file must begin with the Google LLC Apache 2.0 license header including the SPDX-License-Identifier: Apache-2.0 line.  
  scope: go/** all .go files
- **genkit#R56** (naming, must; skills/developing-genkit-tooling/SKILL.md:14): In genkit-tools/cli/src/commands/**, CLI command names must be kebab-case with colon-separated subcommands in noun:verb form (e.g. flow:run, eval:run).  
  scope: genkit-tools/cli/src/commands/** command definitions
- **genkit#R57** (naming, must; skills/developing-genkit-tooling/SKILL.md:18): In genkit-tools/cli/src/commands/**, command arguments must be camelCase in code and written as <argName> in help text.  
  scope: genkit-tools/cli/src/commands/** command arguments
- **genkit#R58** (naming, must; skills/developing-genkit-tooling/SKILL.md:22): In genkit-tools/cli/src/mcp/**, MCP tool names must be snake_case in verb_noun form (e.g. list_flows, run_flow).  
  scope: genkit-tools/cli/src/mcp/** tool registrations
- **genkit#R59** (file_layout, must; skills/developing-genkit-tooling/SKILL.md:29): In genkit-tools/cli, CLI commands must be implemented in genkit-tools/cli/src/commands/ using the commander package.  
  scope: genkit-tools/cli/src/commands/**
- **genkit#R60** (wrapper, must; skills/developing-genkit-tooling/SKILL.md:33): In genkit-tools/cli/src/commands/**, commands that interact with the project runtime must wrap that work in runWithManager(projectRoot, async (manager) => ...) from utils/manager-utils.  
  scope: genkit-tools/cli/src/commands/** runtime commands
- **genkit#R61** (calls, must; skills/developing-genkit-tooling/SKILL.md:49): In genkit-tools/cli/src/**, logging must use logger imported from @genkit-ai/tools-common/utils (not console).  
  scope: genkit-tools/cli/src/** commands and MCP tools
- **genkit#R62** (other, should; skills/developing-genkit-tooling/SKILL.md:50): In genkit-tools/cli/src/commands/**, commands that produce data should offer an option for JSON output or writing to a file.  
  scope: genkit-tools/cli/src/commands/** data-producing commands
- **genkit#R63** (other, must; skills/developing-genkit-tooling/SKILL.md:51): In genkit-tools/cli/src/commands/**, commands for streaming-capable operations must provide a --stream flag that pipes output to stdout.  
  scope: genkit-tools/cli/src/commands/** streaming commands
- **genkit#R64** (other, must; skills/developing-genkit-tooling/SKILL.md:61): In genkit-tools/cli/src/mcp/**, static MCP tools (no project runtime) must be registered by a defineXTool(server: McpServer) function that depends only on the server instance.  
  scope: genkit-tools/cli/src/mcp/** static tools
- **genkit#R65** (argument, must; skills/developing-genkit-tooling/SKILL.md:69): In genkit-tools/cli/src/mcp/**, runtime MCP tools must be registered by a function taking (server: McpServer, options: McpToolOptions) and access the runtime via options.manager and options.projectRoot.  
  scope: genkit-tools/cli/src/mcp/** runtime tools
- **genkit#R66** (calls, must; skills/developing-genkit-tooling/SKILL.md:71): In genkit-tools/cli/src/mcp/**, runtime MCP tools must build their inputSchema with getCommonSchema(options.explicitProjectRoot, ...).  
  scope: genkit-tools/cli/src/mcp/** runtime tool registrations
- **genkit#R67** (calls, should; skills/developing-genkit-tooling/SKILL.md:83): In genkit-tools/cli/src/mcp/**, runtime MCP tool handlers should call resolveProjectRoot(options.explicitProjectRoot, opts, options.projectRoot) before acting and return the error result if it is not a string.  
  scope: genkit-tools/cli/src/mcp/** runtime tool handlers
- **genkit#R68** (error_handling, should; skills/developing-genkit-tooling/SKILL.md:98): In genkit-tools/cli/src/mcp/**, MCP tool handlers should catch errors and return { isError: true, content: [{ type: 'text', text: `Error: ...` }] } instead of throwing.  
  scope: genkit-tools/cli/src/mcp/** tool handlers
- **genkit#R74** (other, must; py/pyproject.toml:228): In py/**, Python code must pass ruff pycodestyle error rules (E).  
  scope: py/** Python files
- **genkit#R75** (other, must; py/pyproject.toml:229): In py/**, Python code must pass ruff pycodestyle warning rules (W).  
  scope: py/** Python files
- **genkit#R76** (other, must; py/pyproject.toml:230): In py/**, Python code must pass ruff pyflakes rules (F): no undefined names, unused imports/variables, etc.  
  scope: py/** Python files
- **genkit#R78** (typing, must; py/pyproject.toml:232): In py/**, Python code must use modern syntax for the py310 target as enforced by ruff pyupgrade (UP), e.g. X | Y unions and builtin generics.  
  scope: py/** Python files
- **genkit#R79** (avoid, must; py/pyproject.toml:233): In py/**, Python code must pass ruff flake8-bugbear rules (B), e.g. no mutable default arguments.  
  scope: py/** Python files
- **genkit#R80** (naming, must; py/pyproject.toml:234): In py/**, Python names must follow PEP 8 naming conventions (ruff N): snake_case functions/variables, CapWords classes.  
  scope: py/** Python files
- **genkit#R81** (other, must; py/pyproject.toml:235): In py/**, public modules, classes and functions must have docstrings following the Google docstring convention (ruff D, pydocstyle convention = google).  
  scope: py/** Python files
- **genkit#R82** (typing, must; py/pyproject.toml:236): In py/**, function arguments and return values must have type annotations, and Any must not be used for *args/**kwargs (ruff ANN, including ANN401).  
  scope: py/** Python functions
- **genkit#R83** (avoid, must; py/pyproject.toml:237): In py/**, modules must not contain unused imports (ruff F401).  
  scope: py/** Python files
- **genkit#R84** (import_restriction, must; py/pyproject.toml:238): In py/**, code must not use wildcard imports (from x import *) (ruff F403).  
  scope: py/** Python files
- **genkit#R85** (avoid, must; py/pyproject.toml:239): In py/**, code must not assign local variables that are never used (ruff F841).  
  scope: py/** Python files
- **genkit#R86** (avoid, must; py/pyproject.toml:240): In py/**, Python code must pass ruff flake8-bandit security rules (S), except S101, S105, S106 and S311.  
  scope: py/** Python files
- **genkit#R87** (avoid, must; py/pyproject.toml:241): In py/**, async functions must not make blocking calls (blocking I/O, time.sleep, sync HTTP) as enforced by ruff flake8-async (ASYNC).  
  scope: py/** async functions
- **genkit#R88** (avoid, must; py/pyproject.toml:242): In py/**, code must not use print() or pprint() (ruff T20).  
  scope: py/** Python files
- **genkit#R89** (other, must; py/pyproject.toml:243): In py/**, TODO comments must follow flake8-todos format: `# TODO(author): description` with an issue link (ruff TD).  
  scope: py/** TODO comments
- **genkit#R90** (import_restriction, must; py/pyproject.toml:244): In py/**, code must not use APIs listed in [tool.ruff.lint.flake8-tidy-imports.banned-api] (ruff TID251).  
  scope: py/** Python files
- **genkit#R91** (layering, must; py/pyproject.toml:258): In py/packages/* plugins (other than core genkit) and py/samples/**, code must not import genkit._ai; import from public genkit modules (genkit, genkit.model, genkit.plugin_api, ...).  
  scope: py/packages/genkit-*/** and py/samples/**
- **genkit#R92** (layering, must; py/pyproject.toml:259): In py/packages/* plugins (other than core genkit) and py/samples/**, code must not import genkit._core; import from public genkit modules.  
  scope: py/packages/genkit-*/** and py/samples/**
- **genkit#R93** (layering, must; py/pyproject.toml:260): In py/packages/* plugins (other than core genkit) and py/samples/**, code must not import genkit.exp._api; import from genkit.exp.  
  scope: py/packages/genkit-*/** and py/samples/**
- **genkit#R94** (layering, must; py/pyproject.toml:261): In py/packages/* plugins (other than core genkit) and py/samples/**, code must not import genkit.web._sse; import from genkit.web.  
  scope: py/packages/genkit-*/** and py/samples/**
- **genkit#R95** (layering, must; py/pyproject.toml:262): In py/packages/* plugins (other than core genkit) and py/samples/**, code must not import genkit.testing._models; import from genkit.testing.  
  scope: py/packages/genkit-*/** and py/samples/**
- **genkit#R96** (calls, must; py/pyproject.toml:263): In py/**, code must not call structlog.get_logger; use genkit.get_logger so logs reach the Dev UI trace panel.  
  scope: py/packages/** and py/samples/** Python files
- **genkit#R97** (calls, must; py/pyproject.toml:264): In py/**, code must not call logging.getLogger; use genkit.get_logger so logs reach the Dev UI trace panel.  
  scope: py/packages/** and py/samples/** Python files
- **genkit#R98** (other, must; py/pyproject.toml:287): In py/packages/genkit-* plugins, TID251 exceptions must be line-scoped `# noqa: TID251` comments, never file-wide per-file-ignores.  
  scope: py/packages/genkit-*/** and py/pyproject.toml per-file-ignores
- **genkit#R113** (file_layout, must; py/pyproject.toml:114): In py/**, pytest test modules must be named *_test.py.  
  scope: py/{packages,samples,tests,tools}/** test files
- **genkit#R114** (decorator, must; py/pyproject.toml:117): In py/** tests, async test functions and fixtures must be explicitly marked (@pytest.mark.asyncio / pytest_asyncio.fixture) because pytest-asyncio runs in strict mode.  
  scope: py/** async tests
- **genkit#R115** (typing, must; py/pyproject.toml:429): In py/packages/*/tests/typecheck/**, typing contract files must use snake_case kwargs and typed values with no type-checker suppressions except on lines asserting a type error.  
  scope: py/packages/*/tests/typecheck/**
- **genkit#R116** (import_restriction, must; py/pyproject.toml:465): In py/packages/**/src and tests/typecheck, all imports must resolve (pyright reportMissingImports).  
  scope: py/packages/**/src, py/packages/**/tests/typecheck
- **genkit#R118** (typing, must; py/pyproject.toml:467): In py/packages/**/src and tests/typecheck, code must type-check under pyright basic mode.  
  scope: py/packages/**/src, py/packages/**/tests/typecheck
- **genkit#R119** (avoid, must; py/pyproject.toml:520): In pyrefly-checked code (py/packages/genkit/src, genkit-mcp/src, genkit-otel/src, tests/typecheck), code must not use deprecated APIs.  
  scope: py/packages/{genkit,genkit-mcp,genkit-otel}/src/**, py/packages/*/tests/typecheck/**
- **genkit#R120** (typing, must; py/pyproject.toml:521): In pyrefly-checked code, code must not contain redundant typing.cast calls.  
  scope: py/packages/{genkit,genkit-mcp,genkit-otel}/src/**, py/packages/*/tests/typecheck/**
- **genkit#R121** (typing, must; py/pyproject.toml:530): In py/packages/*/tests/typecheck/**, `pyrefly: ignore` comments must not be unused.  
  scope: py/packages/*/tests/typecheck/**
- **genkit#R125** (typing, must; py/pyproject.toml:551): In py/**/tests/typecheck/**, calls must not pass arguments of invalid type (ty invalid-argument-type is an error).  
  scope: py/**/tests/typecheck/**
- **genkit#R126** (typing, must; py/pyproject.toml:552): In py/**/tests/typecheck/**, calls must match a declared overload (ty no-matching-overload is an error).  
  scope: py/**/tests/typecheck/**
- **genkit#R127** (typing, must; py/pyproject.toml:553): In py/**/tests/typecheck/**, `ty: ignore` comments must not be unused.  
  scope: py/**/tests/typecheck/**
- **genkit#R130** (calls, must; py/packages/genkit/ruff.toml:27): In py/packages/genkit/**, code must not call structlog.get_logger; use genkit.get_logger.  
  scope: py/packages/genkit/**
- **genkit#R131** (calls, must; py/packages/genkit/ruff.toml:28): In py/packages/genkit/**, code must not call logging.getLogger; use genkit.get_logger.  
  scope: py/packages/genkit/**

## Proposals shown to the user

```text
[D-f04b97] workspace packages use the genkit version most workspace packages use
    evidence: 47/48 (lower bound 0.89, lift 1.0)
    split:    workspace:* 47, ^1.43.0 1
    example:  js/doc-snippets/package.json#doc-snippets
    outlier:  js/testapps/firebase-functions-sample1/functions/package.json:1 functions
```

```text
[D-7d5872] workspace packages enable `strict` in tsconfig
    evidence: 70/72 (lower bound 0.90, lift 1.2)
    example:  js/ai/package.json#@genkit-ai/ai
    outlier:  genkit-tools/package.json:1 
    outlier:  js/testapps/firebase-functions-sample1/package.json:1 
```

```text
[D-5156e2] js/testapps/agents: functions in src/** are wrapped in ai.defineFlow() or ai.defineTool()
    evidence: 25/26 (lower bound 0.81, lift 72.8)
    split:    ai.defineFlow 20, ai.defineTool 5
    example:  js/testapps/agents/src/auth-context-agent.ts#listMyOrders
    outlier:  js/testapps/agents/src/research-agent.ts:61 researchAgent
```

```text
[D-12213b] workspace packages enable `sourceMap` in tsconfig
    evidence: 64/72 (lower bound 0.80, lift 1.2)
    example:  js/ai/package.json#@genkit-ai/ai
    outlier:  genkit-tools/package.json:1 
    outlier:  js/testapps/a2ui/package.json:1 a2ui-testapp
    outlier:  js/testapps/a2ui/web/package.json:1 a2ui-testapp-web
    outlier:  js/testapps/agents/package.json:1 agents-testapp
    outlier:  js/testapps/agents/web/package.json:1 agents-web-ui
    outlier:  js/testapps/angular/package.json:1 angular-ssr-sample
    outlier:  js/testapps/firebase-functions-sample1/package.json:1 
    outlier:  js/testapps/vercel-ai-elements/package.json:1 vercel-ai-elements
```

```text
[D-a6fa5c] genkit-tools/common: exported values in src/types/** are named `*Schema`
    evidence: 163/166 (lower bound 0.95, lift 3.1)
    example:  genkit-tools/common/src/types/action.ts#ActionMetadataSchema
    outlier:  genkit-tools/common/src/types/eval.ts:147 EvalStatusEnum
    outlier:  genkit-tools/common/src/types/model.ts:204 GenerationCommonConfigDescriptions
    outlier:  genkit-tools/common/src/types/status.ts:19 StatusCodes
    exempt:   genkit-tools/common/src/types/model.ts:448 GenerateActionOutputConfig (a helper of GenerateActionOptionsSchema, which uses it in its file)
```

```text
[D-c0155e] workspace packages enable `noImplicitReturns` in tsconfig
    evidence: 62/72 (lower bound 0.76, lift 1.2)
    example:  js/ai/package.json#@genkit-ai/ai
    outlier:  genkit-tools/cli/package.json:1 genkit-cli
    outlier:  genkit-tools/common/package.json:1 @genkit-ai/tools-common
    outlier:  genkit-tools/package.json:1 
    outlier:  genkit-tools/telemetry-server/package.json:1 @genkit-ai/telemetry-server
    outlier:  js/testapps/a2ui/package.json:1 a2ui-testapp
    outlier:  js/testapps/a2ui/web/package.json:1 a2ui-testapp-web
    outlier:  js/testapps/agents/package.json:1 agents-testapp
    outlier:  js/testapps/agents/web/package.json:1 agents-web-ui
    outlier:  js/testapps/firebase-functions-sample1/package.json:1 
    outlier:  js/testapps/vercel-ai-elements/package.json:1 vercel-ai-elements
```

```text
[D-2307d1] workspace packages use the rimraf version most workspace packages use
    evidence: 49/51 (lower bound 0.87, lift 1.0)
    split:    ^6.0.1 49, ^6.1.3 2
    example:  js/ai/package.json#@genkit-ai/ai
    outlier:  genkit-tools/common/package.json:1 @genkit-ai/tools-common
    outlier:  genkit-tools/telemetry-server/package.json:1 @genkit-ai/telemetry-server
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "genkit#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
