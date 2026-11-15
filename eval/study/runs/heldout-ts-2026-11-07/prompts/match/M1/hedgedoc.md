You are checking whether a tool's proposed conventions for the repository **hedgedoc** (https://github.com/hedgedoc/hedgedoc at `c937fd26b5d20ca8b2c5fd26e5b467f0a5c03e08`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/hedgedoc

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/44793658-bd6f-4449-8736-fe4456553570/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **hedgedoc#R03** (other, should; frontend/CONTRIBUTING.md:23): In frontend/**, functions should be declared as arrow functions (const x = () => ...) rather than with the `function` keyword.  
  scope: frontend/src/** all files
- **hedgedoc#R06** (other, must; frontend/CONTRIBUTING.md:67): In frontend/**, every function must have an ESDoc (/** ... */) comment.  
  scope: frontend/src/** functions
- **hedgedoc#R09** (other, must; frontend/CONTRIBUTING.md:73): In frontend/**, a function's ESDoc must contain an `@param name explanation` annotation for every parameter.  
  scope: frontend/src/** function doc comments
- **hedgedoc#R10** (other, must; frontend/CONTRIBUTING.md:74): In frontend/**, a function's ESDoc must contain an `@return description` annotation if the return type is not void.  
  scope: frontend/src/** function doc comments
- **hedgedoc#R11** (error_handling, must; frontend/CONTRIBUTING.md:75): In frontend/**, a function's ESDoc must contain `@throws ErrorClass description` annotations if the function throws or does not catch errors from called methods.  
  scope: frontend/src/** function doc comments
- **hedgedoc#R12** (other, must; frontend/CONTRIBUTING.md:76): In frontend/**, ESDoc comments must have a blank line between the description and the annotation block.  
  scope: frontend/src/** function doc comments
- **hedgedoc#R13** (other, must; frontend/CONTRIBUTING.md:78): In frontend/**, ESDoc annotations must appear in the order @param, @return, @throws.  
  scope: frontend/src/** function doc comments
- **hedgedoc#R14** (other, must; frontend/CONTRIBUTING.md:100): In frontend/**, every exported type and interface must have an ESDoc comment.  
  scope: frontend/src/** exported types and interfaces
- **hedgedoc#R15** (base_class, must; frontend/CONTRIBUTING.md:105): In frontend/**, React components must be function components, not class components.  
  scope: frontend/src/** React components
- **hedgedoc#R16** (typing, must; frontend/CONTRIBUTING.md:105): In frontend/**, React components must be typed with `React.FC` (e.g. `const X: React.FC<XProps> = ...`).  
  scope: frontend/src/** React components
- **hedgedoc#R18** (render, should; frontend/CONTRIBUTING.md:107): In frontend/**, React components should wrap handler functions in `useCallback` and must not pass inline functions (e.g. as JSX props).  
  scope: frontend/src/** React components
- **hedgedoc#R20** (file_layout, must; frontend/CONTRIBUTING.md:109): In frontend/**, each React component must live in a file named after the component in kebab-case (e.g. IncrementNumberButton in increment-number-button.tsx); the props interface may live in the same file.  
  scope: frontend/src/** React component files
- **hedgedoc#R21** (naming, should; frontend/CONTRIBUTING.md:110): In frontend/**, React components should be named in PascalCase.  
  scope: frontend/src/** React components
- **hedgedoc#R22** (avoid, must; frontend/CONTRIBUTING.md:115): In frontend/**, code must not log via `console.*`; it must use the `Logger` class from frontend/src/utils/logger.ts.  
  scope: frontend/src/** all files
- **hedgedoc#R23** (calls, must; frontend/CONTRIBUTING.md:116): In frontend/**, each file must create its own single `Logger` instance and must not pass or share Logger instances across files.  
  scope: frontend/src/** files that log
- **hedgedoc#R24** (argument, should; frontend/CONTRIBUTING.md:117): In frontend/**, `new Logger(scope)` must be given a scope that is the name of the logging class or component (or an explanatory name).  
  scope: frontend/src/** Logger instantiations
- **hedgedoc#R25** (argument, must; frontend/CONTRIBUTING.md:118): In frontend/**, Logger scopes with a sub scope must separate main and sub scope with " > " (e.g. new Logger('Main > Sub')).  
  scope: frontend/src/** Logger instantiations
- **hedgedoc#R26** (naming, should; frontend/CONTRIBUTING.md:119): In frontend/**, Logger scope strings should be UpperCamelCase.  
  scope: frontend/src/** Logger instantiations
- **hedgedoc#R27** (argument, must; frontend/CONTRIBUTING.md:120): In frontend/**, log messages passed to Logger methods must not start with a lowercase letter.  
  scope: frontend/src/** logger calls
- **hedgedoc#R28** (argument, must; frontend/CONTRIBUTING.md:121): In frontend/**, log messages passed to Logger methods must not end with a colon or whitespace.  
  scope: frontend/src/** logger calls
- **hedgedoc#R29** (other, must; docs/content/old/dev/dev_notes.md:25): In backend entity classes, constructors must be empty and instances must be built via a separate static `create` method.  
  scope: backend/src/** entity classes
- **hedgedoc#R30** (argument, should; docs/content/old/dev/dev_notes.md:28): In backend entity classes, the `create` method should only take the entity's non-optional properties as parameters (exceptions must be documented in the method doc).  
  scope: backend/src/** entity create methods
- **hedgedoc#R31** (argument, should; docs/content/old/dev/dev_notes.md:29): In backend entity classes, the `create` method should have no optional parameters (exceptions must be documented in the method doc).  
  scope: backend/src/** entity create methods
- **hedgedoc#R32** (argument, should; docs/content/old/dev/dev_notes.md:30): In backend entity classes, the `create` method should not take list parameters that can be empty.  
  scope: backend/src/** entity create methods
- **hedgedoc#R33** (typing, should; docs/content/old/dev/dev_notes.md:31): In backend entity classes, the `create` method should return either a complete entity instance or a Pick/Omit type of the entity.  
  scope: backend/src/** entity create methods
- **hedgedoc#R34** (file_layout, must; docs/content/concepts/config.md:40): In backend/src/config/*.config.ts, each config file must consist of a config interface, a validation schema and a default export that builds and validates the config.  
  scope: backend/src/config/*.config.ts
- **hedgedoc#R35** (file_layout, must; docs/content/concepts/config.md:49): In backend/src/config/**, enums used in config interfaces must be defined in their own files with the `.enum.ts` extension.  
  scope: backend/src/config/** enums
- **hedgedoc#R36** (calls, must; docs/content/concepts/config.md:56): In backend/src/config/*.config.ts, each schema value must end with `.label()` naming the corresponding environment variable.  
  scope: backend/src/config/*.config.ts schemas
- **hedgedoc#R37** (calls, must; docs/content/concepts/config.md:84): In backend/src/config/auth.config.ts, validation error messages must be passed through `replaceAuthErrorsWithEnvironmentVariables`.  
  scope: backend/src/config/auth.config.ts default export
- **hedgedoc#R38** (file_layout, should; docs/content/concepts/config.md:122): In backend/src/config/**, `.mock.ts` config files should contain only a default export returning the mock config object.  
  scope: backend/src/config/**/*.mock.ts
- **hedgedoc#R39** (file_layout, must; docs/content/concepts/events.md:12): In backend, the EventEmitterModule config must live in backend/src/events.ts exported as `eventModuleConfig`, and event-key enums must be defined in that same file.  
  scope: backend/src/events.ts
- **hedgedoc#R40** (other, should; docs/content/concepts/events.md:15): In backend/src/events.ts, each event-key enum member should have a comment describing the value sent with the event.  
  scope: backend/src/events.ts event enums
- **hedgedoc#R41** (base_class, must; docs/content/concepts/media.md:12): In backend media storage backends, each backend must implement the media backend interface with `saveFile(uuid, buffer, fileType)`, `deleteFile(uuid, metadata)` and `getFileUrl(uuid, metadata)`.  
  scope: backend/src/media/backends/** storage backend classes
- **hedgedoc#R43** (avoid, should; .oxlintrc.json:14): In all files covered by the root oxlint config, code should not contain `debugger` statements.  
  scope: repository root oxlint config, all files
- **hedgedoc#R44** (other, should; .oxlintrc.json:15): In all files covered by the root oxlint config, code should not have unused variables; unused arguments are allowed only if named with underscores only (^_+$).  
  scope: repository root oxlint config, all files
- **hedgedoc#R45** (other, should; .oxlintrc.json:16): In TypeScript files covered by the root oxlint config, code should not have unused variables; unused arguments must be named with underscores only (^_+$).  
  scope: repository root oxlint config, TypeScript files
- **hedgedoc#R46** (import_restriction, must; .oxlintrc.json:17): In TypeScript files covered by the root oxlint config, imports used only as types must use `import type`.  
  scope: repository root oxlint config, TypeScript files
- **hedgedoc#R47** (testing, should; .oxlintrc.json:21): In test files covered by the root oxlint config, tests should not be disabled (no xit/xdescribe/test.skip).  
  scope: repository root oxlint config, test files
- **hedgedoc#R48** (testing, must; .oxlintrc.json:22): In test files covered by the root oxlint config, tests must not be focused (no fit/fdescribe/test.only).  
  scope: repository root oxlint config, test files
- **hedgedoc#R49** (testing, must; .oxlintrc.json:23): In test files covered by the root oxlint config, tests and describe blocks must not have identical titles within the same scope.  
  scope: repository root oxlint config, test files
- **hedgedoc#R50** (testing, must; .oxlintrc.json:24): In test files covered by the root oxlint config, `expect()` calls must be valid (one argument, followed by a matcher call, awaited async assertions).  
  scope: repository root oxlint config, test files
- **hedgedoc#R51** (avoid, should; backend/.oxlintrc.json:10): In backend/src and backend/test, code should not contain `debugger` statements.  
  scope: backend/** all files
- **hedgedoc#R52** (argument, must; backend/oxlint-local-rules.js:27): In backend/**, calls of the form `this.<x>.logger.{error,log,warn,debug,verbose}(message, 'context')` with a string-literal second argument must pass the name of the enclosing class method as the context string.  
  scope: backend/** class methods calling the logger
- **hedgedoc#R53** (other, should; backend/.oxlintrc.json:12): In backend/**, code should not have unused variables; unused arguments must be named with underscores only (^_+$).  
  scope: backend/** TypeScript files
- **hedgedoc#R54** (other, must; backend/.oxlintrc.json:13): In backend/**, returned promises must always be awaited (`return await promise`).  
  scope: backend/** async functions
- **hedgedoc#R55** (avoid, must; backend/.oxlintrc.json:14): In backend/**, code must not stringify values whose toString() is the default Object toString (e.g. objects in template literals or String()).  
  scope: backend/** TypeScript files
- **hedgedoc#R64** (testing, should; commons/.oxlintrc.json:9): In commons/**, tests should not be disabled (no xit/xdescribe/test.skip).  
  scope: commons/** test files
- **hedgedoc#R65** (testing, must; commons/.oxlintrc.json:10): In commons/**, tests must not be focused (no fit/fdescribe/test.only).  
  scope: commons/** test files
- **hedgedoc#R66** (testing, must; commons/.oxlintrc.json:11): In commons/**, tests and describe blocks must not have identical titles within the same scope.  
  scope: commons/** test files
- **hedgedoc#R67** (testing, must; commons/.oxlintrc.json:12): In commons/**, `expect()` calls must be valid (one argument, followed by a matcher call, awaited async assertions).  
  scope: commons/** test files
- **hedgedoc#R68** (avoid, should; frontend/.oxlintrc.json:13): In frontend/**, code should not contain `debugger` statements.  
  scope: frontend/** all files
- **hedgedoc#R69** (import_restriction, must; frontend/.oxlintrc.json:14): In frontend/**, imports used only as types must use `import type`.  
  scope: frontend/** TypeScript files
- **hedgedoc#R70** (testing, should; frontend/.oxlintrc.json:18): In frontend/**, tests should not be disabled (no xit/xdescribe/test.skip).  
  scope: frontend/** test files
- **hedgedoc#R71** (testing, must; frontend/.oxlintrc.json:19): In frontend/**, tests must not be focused (no fit/fdescribe/test.only).  
  scope: frontend/** test files
- **hedgedoc#R72** (testing, must; frontend/.oxlintrc.json:20): In frontend/**, tests and describe blocks must not have identical titles within the same scope.  
  scope: frontend/** test files
- **hedgedoc#R73** (testing, must; frontend/.oxlintrc.json:21): In frontend/**, `expect()` calls must be valid (one argument, followed by a matcher call, awaited async assertions).  
  scope: frontend/** test files
- **hedgedoc#R74** (testing, must; frontend/.oxlintrc.json:22): In frontend/**, every test must contain at least one assertion call matching expect*, screen.* or test*.  
  scope: frontend/** test files
- **hedgedoc#R75** (argument, should; frontend/oxlint-rules/translation-keys.mjs:95): In frontend/**, static string keys passed as the first argument to `t()` or `useTranslatedText()`, and the `i18nKey` attribute of `<Trans>`, should exist as dot-notation keys in frontend/locales/en.json.  
  scope: frontend/** translation calls and Trans components
- **hedgedoc#R77** (testing, should; html-to-react/.oxlintrc.json:9): In html-to-react/**, tests should not be disabled (no xit/xdescribe/test.skip).  
  scope: html-to-react/** test files
- **hedgedoc#R78** (testing, must; html-to-react/.oxlintrc.json:10): In html-to-react/**, tests must not be focused (no fit/fdescribe/test.only).  
  scope: html-to-react/** test files
- **hedgedoc#R79** (testing, must; html-to-react/.oxlintrc.json:11): In html-to-react/**, tests and describe blocks must not have identical titles within the same scope.  
  scope: html-to-react/** test files
- **hedgedoc#R80** (testing, must; html-to-react/.oxlintrc.json:12): In html-to-react/**, `expect()` calls must be valid (one argument, followed by a matcher call, awaited async assertions).  
  scope: html-to-react/** test files
- **hedgedoc#R81** (testing, should; markdown-it-plugins/.oxlintrc.json:9): In markdown-it-plugins/**, tests should not be disabled (no xit/xdescribe/test.skip).  
  scope: markdown-it-plugins/** test files
- **hedgedoc#R82** (testing, must; markdown-it-plugins/.oxlintrc.json:10): In markdown-it-plugins/**, tests must not be focused (no fit/fdescribe/test.only).  
  scope: markdown-it-plugins/** test files
- **hedgedoc#R83** (testing, must; markdown-it-plugins/.oxlintrc.json:11): In markdown-it-plugins/**, tests and describe blocks must not have identical titles within the same scope.  
  scope: markdown-it-plugins/** test files
- **hedgedoc#R84** (testing, must; markdown-it-plugins/.oxlintrc.json:12): In markdown-it-plugins/**, `expect()` calls must be valid (one argument, followed by a matcher call, awaited async assertions).  
  scope: markdown-it-plugins/** test files

## Proposals shown to the user

```text
[D-12d3c2] frontend: classes in src/extensions/external-lib-app-extensions/** are named `*Extension`
    evidence: 24/26 (lower bound 0.76, lift 3.9)
    example:  frontend/src/extensions/external-lib-app-extensions/abcjs/abcjs-app-extension.ts#AbcjsAppExtension
    outlier:  frontend/src/extensions/external-lib-app-extensions/katex/katex-replacer.tsx:22 KatexReplacer
    outlier:  frontend/src/extensions/external-lib-app-extensions/plantuml/plantuml-not-configured-component-replacer.tsx:17 PlantumlNotConfiguredComponentReplacer
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "hedgedoc#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
