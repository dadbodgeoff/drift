You are checking whether a tool's proposed conventions for the repository **cursorless** (https://github.com/cursorless-dev/cursorless at `ff86743f2ed8c282219d8228132610f13ae22fbe`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/cursorless

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/4b596c91-e6ce-43b4-a5df-8392056b4224/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **cursorless#R02** (file_layout, must; AGENTS.md:14): In the repository, language-specific tree-sitter parse patterns must be defined in resources/queries/*.scm files, not in TypeScript code.  
  scope: resources/queries/*.scm language query files
- **cursorless#R04** (testing, should; AGENTS.md:43): In resources/fixtures/scopes/**/*.scope, scope test files should follow the style guidelines in packages/app-web-docs/src/docs/contributing/scope-test-format.md.  
  scope: resources/fixtures/scopes/**/*.scope scope test fixtures
- **cursorless#R07** (file_layout, must; packages/app-web-docs/src/docs/contributing/CONTRIBUTING.mdx:162): In the repository, a test file that must run in a VS Code context (e.g. imports "vscode") must be named *.vscode.test.ts.  
  scope: **/*.test.ts test files
- **cursorless#R08** (file_layout, must; packages/app-web-docs/src/docs/contributing/CONTRIBUTING.mdx:162): In the repository, test files that do not need VS Code must be named *.test.ts (not *.vscode.test.ts) and must not import "vscode".  
  scope: **/*.test.ts test files
- **cursorless#R10** (file_layout, should; packages/test-runner/README.md:3): In the repository, tests must be in .test.ts files next to the code they test or in standalone packages/*-e2e packages, not in packages/test-runner.  
  scope: **/*.test.ts test files
- **cursorless#R11** (other, should; packages/app-web-docs/src/docs/contributing/architecture/package-scripts.md:29): In source-only shared code packages (e.g. packages/lib-common, packages/lib-engine), package.json should expose a typecheck script and must not expose build or compile scripts.  
  scope: packages/lib-*/package.json source-only packages
- **cursorless#R12** (file_layout, should; packages/app-web-docs/src/docs/contributing/architecture/package-scripts.md:32): In source-only shared code packages, package.json exports should point to source under src (./src/index.ts), not to an out directory.  
  scope: packages/lib-*/package.json source-only packages
- **cursorless#R13** (naming, should; packages/app-web-docs/src/docs/contributing/architecture/package-scripts.md:40): In internal asset packages (e.g. packages/lib-cheatsheet-local, packages/lib-vscode-tutorial-webview), package.json should expose bundle / bundle:* scripts instead of build scripts.  
  scope: packages/*/package.json internal asset packages
- **cursorless#R14** (naming, should; packages/app-web-docs/src/docs/contributing/architecture/package-scripts.md:54): In top-level application packages (packages/app-*), package.json should expose typecheck, dev and build scripts.  
  scope: packages/app-*/package.json
- **cursorless#R15** (other, should; packages/app-web-docs/src/docs/contributing/architecture/package-scripts.md:94): In top-level application packages, the build script should be self-contained and invoke the bundle scripts of the internal packages it depends on.  
  scope: packages/app-*/package.json build scripts
- **cursorless#R16** (naming, should; packages/app-web-docs/src/docs/contributing/architecture/package-scripts.md:113): In top-level application packages, package.json must not define a build:dev script; development workflows should hang off the dev script.  
  scope: packages/app-*/package.json scripts
- **cursorless#R17** (naming, must; packages/app-web-docs/src/docs/contributing/architecture/package-scripts.md:122): In the root package.json, scripts must not include compile or generic watch:* scripts.  
  scope: package.json (repository root) scripts
- **cursorless#R18** (other, should; packages/app-web-docs/src/docs/contributing/architecture/package-scripts.md:124): In internal source-only packages, the typecheck script/tsconfig should not emit an out directory (noEmit).  
  scope: packages/lib-*/tsconfig.json and package.json
- **cursorless#R19** (other, must; packages/app-web-docs/src/docs/contributing/adding-a-new-package.md:8): In packages/*/package.json, a package that is not a top-level application package must set "private": true.  
  scope: packages/*/package.json
- **cursorless#R20** (naming, should; packages/app-web-docs/src/docs/contributing/adding-a-new-package.md:14): In internal source-only packages, package.json scripts should be limited to typecheck and, if needed, test.  
  scope: packages/lib-*/package.json scripts
- **cursorless#R21** (naming, should; packages/app-web-docs/src/docs/contributing/adding-a-new-package.md:17): In top-level application packages, package.json should define dev and build scripts, using bundle:* names for helper scripts producing internal artifacts.  
  scope: packages/app-*/package.json scripts
- **cursorless#R22** (other, must; packages/app-web-docs/src/docs/contributing/adding-a-new-scope.md:48): In packages/lib-common/src/scopeSupportFacets/<language>.ts, each applicable textFragment.* facet must be marked supported.  
  scope: packages/lib-common/src/scopeSupportFacets/*.ts language scope support tables
- **cursorless#R23** (other, must; packages/app-web-docs/src/docs/contributing/adding-a-new-scope.md:49): In resources/queries/<language>.scm, each applicable text region (strings, comments) must have an @textFragment capture, which should exclude the syntactic delimiters (e.g. via #child-range!) when the parse tree permits.  
  scope: resources/queries/*.scm
- **cursorless#R24** (testing, must; packages/app-web-docs/src/docs/contributing/adding-a-new-scope.md:50): In resources/fixtures/scopes, each textFragment facet marked supported for a language must have a scope test fixture.  
  scope: resources/fixtures/scopes/<language>/** scope fixtures
- **cursorless#R25** (other, should; packages/app-web-docs/src/docs/contributing/adding-a-new-scope.md:82): In language scope support tables, facets that do not apply to the language should be marked notApplicable, and applicable but not yet implemented facets marked unsupported.  
  scope: packages/lib-common/src/scopeSupportFacets/*.ts language scope support tables
- **cursorless#R26** (naming, must; packages/app-web-docs/src/docs/contributing/adding-a-new-scope.md:96): In resources/queries/*.scm, captures must use the scope type identifier (e.g. @namedFunction), not the facet identifier (e.g. @namedFunction.class).  
  scope: resources/queries/*.scm
- **cursorless#R27** (other, must; packages/app-web-docs/src/docs/contributing/adding-a-new-language.md:14): In packages/lib-common/src/extensionDependencies.ts, the VS Code extension id must be listed for every supported language not natively detected by VS Code.  
  scope: packages/lib-common/src/extensionDependencies.ts
- **cursorless#R28** (file_layout, must; packages/app-web-docs/src/docs/contributing/adding-a-new-language.md:18): In packages/lib-common/src/scopeSupportFacets/, each supported language must have its own <language>.ts file exporting a <language>ScopeSupport constant typed LanguageScopeSupportFacetMap.  
  scope: packages/lib-common/src/scopeSupportFacets/*.ts
- **cursorless#R29** (other, must; packages/app-web-docs/src/docs/contributing/adding-a-new-language.md:31): In packages/lib-common/src/scopeSupportFacets/languageScopeSupport.ts, every language scope support table must be registered.  
  scope: packages/lib-common/src/scopeSupportFacets/languageScopeSupport.ts
- **cursorless#R30** (file_layout, must; packages/app-web-docs/src/docs/contributing/adding-a-new-language.md:33): In resources/queries/, each language's parse tree patterns must be in a .scm file named after the language id (e.g. java.scm).  
  scope: resources/queries/*.scm
- **cursorless#R32** (other, should; packages/app-web-docs/src/docs/contributing/tree-sitter-query-syntax.md:11): In resources/queries/*.scm, @<scope>.leading / @<scope>.trailing captures should be used instead of @<scope>.removal when only a leading or trailing delimiter needs to be included in the removal range.  
  scope: resources/queries/*.scm
- **cursorless#R33** (other, should; packages/app-web-docs/src/docs/contributing/tree-sitter-query-syntax.md:13): In resources/queries/*.scm, @<scope>.iteration captures should appear in a separate pattern from the scope's own capture.  
  scope: resources/queries/*.scm
- **cursorless#R34** (other, must; packages/app-web-docs/src/docs/contributing/tree-sitter-query-syntax.md:13): In resources/queries/*.scm, relationship captures (@<scope>.domain, .leading, .trailing, .removal, .interior) must appear in the same pattern as the scope's own capture.  
  scope: resources/queries/*.scm
- **cursorless#R35** (naming, must; packages/app-web-docs/src/docs/contributing/tree-sitter-query-syntax.md:24): In resources/queries/*.scm, @G_ group captures must list at least two underscore-separated scope names, each a valid scope type.  
  scope: resources/queries/*.scm
- **cursorless#R37** (testing, should; packages/app-web-docs/src/docs/contributing/scope-test-format.md:35): In resources/fixtures/scopes/**/*.scope, the source code section should be as short and simple as possible while containing the syntax under test.  
  scope: resources/fixtures/scopes/**/*.scope
- **cursorless#R38** (naming, should; packages/app-web-docs/src/docs/contributing/scope-test-format.md:89): In resources/fixtures/scopes/**/*.scope, class, function and variable names must be foo, bar, baz, bongo (with language-specific casing such as Foo or IFoo).  
  scope: resources/fixtures/scopes/**/*.scope
- **cursorless#R39** (naming, should; packages/app-web-docs/src/docs/contributing/scope-test-format.md:90): In resources/fixtures/scopes/**/*.scope, argument and parameter names must be aaa, bbb, ccc and so on.  
  scope: resources/fixtures/scopes/**/*.scope
- **cursorless#R40** (naming, should; packages/app-web-docs/src/docs/contributing/scope-test-format.md:91): In resources/fixtures/scopes/**/*.scope, data types in examples must be int or number.  
  scope: resources/fixtures/scopes/**/*.scope
- **cursorless#R41** (naming, should; packages/app-web-docs/src/docs/contributing/scope-test-format.md:92): In resources/fixtures/scopes/**/*.scope, literal values in examples must be 0, 1, 2 and so on.  
  scope: resources/fixtures/scopes/**/*.scope
- **cursorless#R42** (testing, should; packages/app-web-docs/src/docs/contributing/scope-test-format.md:104): In resources/fixtures/scopes/**/*.scope, examples must not have more lines than needed and should be single-line with an empty body where possible.  
  scope: resources/fixtures/scopes/**/*.scope
- **cursorless#R43** (testing, should; packages/app-web-docs/src/docs/contributing/scope-test-format.md:118): In resources/fixtures/scopes/**/*.scope, facets tested inside a code block (e.g. a method in a class) should use a multi-line example.  
  scope: resources/fixtures/scopes/**/*.scope
- **cursorless#R44** (testing, should; packages/app-web-docs/src/docs/contributing/scope-test-format.md:126): In resources/fixtures/scopes/**/*.iteration.document*.scope tests, the source code must begin and end with an empty line.  
  scope: resources/fixtures/scopes/**/*.scope iteration.document tests
- **cursorless#R45** (testing, should; packages/app-web-docs/src/docs/contributing/test-case-recorder.md:18): In resources/fixtures/recorded/**/*.yml, the initial document of a recorded test should be as small as possible.  
  scope: resources/fixtures/recorded/**/*.yml recorded tests
- **cursorless#R47** (other, must; packages/app-web-docs/src/docs/contributing/documentation-search.md:15): In the committed Algolia crawler-settings.js config, the apiKey field must be "<REDACTED>" and never a real key.  
  scope: packages/app-web-docs/config/algolia/crawler-settings.js
- **cursorless#R48** (other, should; oxlint.config.mts:123): In all oxlint-linted JS/TS files, all oxlint correctness-category rules are enabled at warn (lint:ts runs with --deny-warnings).  
  scope: **/*.{js,ts,tsx,mts,cts} (excluding ignorePatterns)
- **cursorless#R49** (other, should; oxlint.config.mts:124): In all oxlint-linted JS/TS files, all oxlint suspicious-category rules are enabled at warn.  
  scope: **/*.{js,ts,tsx,mts,cts}
- **cursorless#R50** (other, should; oxlint.config.mts:125): In all oxlint-linted JS/TS files, all oxlint pedantic-category rules are enabled at warn.  
  scope: **/*.{js,ts,tsx,mts,cts}
- **cursorless#R51** (other, should; oxlint.config.mts:126): In all oxlint-linted JS/TS files, all oxlint perf-category rules are enabled at warn.  
  scope: **/*.{js,ts,tsx,mts,cts}
- **cursorless#R52** (other, should; oxlint.config.mts:127): In all oxlint-linted JS/TS files, all oxlint style-category rules are enabled at warn (except those listed in disabledRules).  
  scope: **/*.{js,ts,tsx,mts,cts}
- **cursorless#R53** (other, should; oxlint.config.mts:128): In all oxlint-linted JS/TS files, all oxlint restriction-category rules are enabled at warn (except those listed in disabledRules).  
  scope: **/*.{js,ts,tsx,mts,cts}
- **cursorless#R138** (avoid, should; oxlint.config.mts:135): In all linted files, comparisons must use === / !== except comparisons with null, which must use == null / != null.  
  scope: **/*.{js,ts,tsx}
- **cursorless#R139** (import_restriction, should; oxlint.config.mts:142): In all linted files, a module must not be imported in more than one import statement, except that a separate `import type` from the same module is allowed.  
  scope: **/*.{js,ts,tsx}
- **cursorless#R140** (import_restriction, should; oxlint.config.mts:153): In all linted files, code must not import node:assert; it must import node:assert/strict instead.  
  scope: **/*.{js,ts,tsx}
- **cursorless#R141** (layering, should; oxlint.config.mts:158): In all linted files, code must not import another package's src via relative paths (../*/src, ../../*/src/*); it must import the package by name (e.g. @cursorless/lib-common).  
  scope: packages/**/*.{js,ts,tsx}
- **cursorless#R142** (naming, should; oxlint.config.mts:165): In all linted files, unused variables and arguments are not allowed unless their name starts with _ (rest siblings are ignored).  
  scope: **/*.{js,ts,tsx}
- **cursorless#R143** (import_restriction, should; oxlint.config.mts:173): In all linted files, side-effect-only imports (import "x") must not be used, except for .css files.  
  scope: **/*.{js,ts,tsx}
- **cursorless#R144** (avoid, should; oxlint.config.mts:179): In all linted files, comments must not contain TODO.  
  scope: **/*.{js,ts,tsx}
- **cursorless#R145** (file_layout, should; oxlint.config.mts:185): In the repository, JSX must only appear in files with the .tsx extension.  
  scope: **/*.{js,ts,tsx}
- **cursorless#R146** (typing, should; oxlint.config.mts:195): In TypeScript files, the oxlint typescript plugin rules (type-aware) are enabled across all warn-level categories.  
  scope: **/*.{ts,cts,mts,tsx}
- **cursorless#R150** (import_restriction, should; oxlint.config.mts:223): In packages/app-vscode/src/scripts/**/*.ts, code must not import "vscode".  
  scope: packages/app-vscode/src/scripts/**/*.ts scripts
- **cursorless#R151** (import_restriction, should; oxlint.config.mts:240): In packages/lib-common/**/*.ts and packages/lib-engine/**/*.ts, code must not import Node.js built-in modules (node:fs, node:path, etc.).  
  scope: packages/lib-common/**/*.ts, packages/lib-engine/**/*.ts
- **cursorless#R153** (layering, should; oxlint.config.mts:262): In packages/lib-common/src/types/command/**/*.ts, code must not import @cursorless/* packages or anything from a parent directory (../*).  
  scope: packages/lib-common/src/types/command/**/*.ts API types
- **cursorless#R154** (import_restriction, should; oxlint.config.mts:268): In packages/lib-common/src/types/command/**/*.ts, code must not import any scoped (@*) package.  
  scope: packages/lib-common/src/types/command/**/*.ts API types
- **cursorless#R155** (other, must; pyproject.toml:14): In Python files (cursorless-talon, cursorless-talon-dev, etc.), ruff pycodestyle (E) rules must pass.  
  scope: **/*.py (excluding vendor, resources/playground)
- **cursorless#R156** (other, must; pyproject.toml:15): In Python files, ruff Pyflakes (F) rules must pass (no unused imports/variables, undefined names).  
  scope: **/*.py
- **cursorless#R157** (other, must; pyproject.toml:16): In Python files, ruff pyupgrade (UP) rules must pass (modern Python 3.11 syntax), except the ignored UP007/UP045/UP035.  
  scope: **/*.py
- **cursorless#R158** (other, must; pyproject.toml:17): In Python files, ruff flake8-bugbear (B) rules must pass.  
  scope: **/*.py
- **cursorless#R159** (other, must; pyproject.toml:18): In Python files, ruff flake8-simplify (SIM) rules must pass, except SIM105.  
  scope: **/*.py
- **cursorless#R160** (other, must; pyproject.toml:19): In Python files, imports must be sorted per ruff isort (I) rules.  
  scope: **/*.py
- **cursorless#R161** (other, must; pyproject.toml:20): In Python files, ruff flake8-comprehensions (C4) rules must pass.  
  scope: **/*.py
- **cursorless#R162** (import_restriction, must; pyproject.toml:21): In Python files, modules must be imported with conventional aliases per ruff flake8-import-conventions (ICN).  
  scope: **/*.py
- **cursorless#R163** (other, must; pyproject.toml:22): In Python files, ruff flake8-return (RET) rules must pass.  
  scope: **/*.py
- **cursorless#R164** (other, must; pyproject.toml:23): In Python files, ruff refurb (FURB) rules must pass.  
  scope: **/*.py
- **cursorless#R165** (other, must; pyproject.toml:24): In Python files, static str.join calls must be replaced with f-strings per ruff flynt (FLY).  
  scope: **/*.py
- **cursorless#R171** (other, must; pyproject.toml:9): In Python files, code must target Python 3.11 (the Python version of public Talon 0.4).  
  scope: **/*.py
- **cursorless#R176** (avoid, must; .luacheckrc:6): In Lua files, vim is the only declared extra global; other undeclared globals are flagged by luacheck.  
  scope: **/*.lua
- **cursorless#R177** (other, must; .luacheckrc:1): In Lua files, code must only use the LuaJIT standard library globals.  
  scope: **/*.lua
- **cursorless#R178** (other, should; .luarc.json:4): In Lua files, lua-language-server treats vim, talon, it and describe as known globals and targets Lua 5.1.  
  scope: **/*.lua
- **cursorless#R180** (file_layout, must; .pre-commit-config.yaml:20): In the repository, committed files must not be symlinks.  
  scope: all committed files
- **cursorless#R181** (testing, must; .pre-commit-config.yaml:87): In resources/fixtures/recorded/**/*.yml, initialState.marks must contain exactly the marks targeted by the command plus any listed in marksToCheck (compared after grapheme normalization), as checked by packages/lib-engine/src/scripts/transformRecordedTests/checkMarks.ts.  
  scope: resources/fixtures/recorded/**/*.yml recorded tests

## Proposals shown to the user

```text
[D-cd8fd8] workspace packages enable `forceConsistentCasingInFileNames` in tsconfig
    evidence: 23/24 (lower bound 0.80, lift 1.0)
    example:  packages/app-neovim/package.json#@cursorless/app-neovim
    outlier:  packages/app-neovim/cursorless.nvim/node/command-server/package.json:1 command-server
```

```text
[D-373f39] packages/lib-common: exported values in src/scopeSupportFacets/** are named `*Support`
    evidence: 39/41 (lower bound 0.84, lift 4.9)
    example:  packages/lib-common/src/scopeSupportFacets/c.ts#cCoreScopeSupport
    outlier:  packages/lib-common/src/scopeSupportFacets/PlaintextScopeSupportFacetInfos.ts:6 plaintextScopeSupportFacetInfos
    outlier:  packages/lib-common/src/scopeSupportFacets/scopeSupportFacetInfos.ts:7 scopeSupportFacetInfos
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "cursorless#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
