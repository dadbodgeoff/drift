You are checking whether a tool's proposed conventions for the repository **backend** (https://github.com/prod-forge/backend at `91218553b2d12006cd1370f4cf7c37861519ccf8`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/backend

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/3e3b549c-10c5-4ed8-8d55-10403291cdf1/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **backend#R01** (typing, must; AGENTS.md:25): In all TypeScript files, code must compile under TypeScript strict mode (tsconfig strict: true, noImplicitAny).  
  scope: **/*.ts all files
- **backend#R02** (avoid, should; AGENTS.md:26): In all TypeScript files, code should not use the `any` type.  
  scope: **/*.ts all files
- **backend#R03** (typing, should; AGENTS.md:27): In all TypeScript files, public functions and methods should declare explicit parameter and return types.  
  scope: **/*.ts public APIs
- **backend#R04** (typing, should; AGENTS.md:28): In all TypeScript files, object shapes should be declared with `type` aliases rather than `interface`.  
  scope: **/*.ts all files
- **backend#R06** (typing, should; AGENTS.md:30): In all TypeScript files, fields and properties that are not reassigned should be marked `readonly`.  
  scope: **/*.ts all files
- **backend#R08** (other, must; AGENTS.md:39): In NestJS code under src/**, services and providers must be obtained through NestJS dependency injection, not instantiated manually with `new`.  
  scope: src/** NestJS providers, controllers, modules
- **backend#R09** (layering, should; AGENTS.md:40): In src/api/**/*.controller.ts, controllers should be thin and only delegate to services.  
  scope: src/api/**/*.controller.ts controllers
- **backend#R10** (layering, must; AGENTS.md:41): In src/**, business logic must live in services (src/features/**/*.service.ts), not in controllers.  
  scope: src/** controllers and services
- **backend#R11** (layering, should; AGENTS.md:42): In src/api/**/*.controller.ts, controllers should not contain business logic.  
  scope: src/api/**/*.controller.ts controllers
- **backend#R12** (base_class, should; AGENTS.md:43): In src/**, classes should compose dependencies rather than extend base classes, except for true inheritance hierarchies.  
  scope: src/** classes
- **backend#R14** (decorator, should; AGENTS.md:45): In src/api/**/dtos/**, DTO classes should declare every field explicitly and carry validation decorators.  
  scope: src/api/**/dtos/** DTO classes
- **backend#R15** (decorator, must; AGENTS.md:46): In request DTOs, validation must use `class-validator` decorators and `class-transformer` transforms rather than hand-written checks.  
  scope: src/api/**/dtos/** request DTOs
- **backend#R16** (other, should; AGENTS.md:47): In NestJS classes under src/**, dependencies should be injected through the constructor rather than property injection.  
  scope: src/** NestJS providers and controllers
- **backend#R17** (layering, should; AGENTS.md:48): In src/**, modules and files should not form circular imports (no `forwardRef` workarounds).  
  scope: src/** modules
- **backend#R19** (typing, should; AGENTS.md:50): In *.service.ts and *.controller.ts, methods should declare explicit return types.  
  scope: src/**/*.service.ts, src/**/*.controller.ts methods
- **backend#R20** (other, must; AGENTS.md:56): In API code, asynchronous code must use async/await rather than `.then()` chains.  
  scope: src/** async code
- **backend#R23** (other, must; AGENTS.md:59): In API code, all external input (body, query, params) must be validated, via validated DTOs.  
  scope: src/api/** controllers and DTOs
- **backend#R24** (error_handling, must; AGENTS.md:60): In API code, internal error details must not be returned to clients.  
  scope: src/** error handling and controllers
- **backend#R25** (layering, should; AGENTS.md:61): In src/**, API logic should live in services, not in controllers.  
  scope: src/** services and controllers
- **backend#R26** (layering, should; AGENTS.md:62): In src/api/**/*.controller.ts, controllers should handle only transport concerns (routing, guards, validation, response mapping).  
  scope: src/api/**/*.controller.ts controllers
- **backend#R28** (layering, should; AGENTS.md:69): In src/**, database access (PrismaService) should only happen inside dedicated repositories or services.  
  scope: src/** database access
- **backend#R29** (layering, should; AGENTS.md:70): In src/api/**/*.controller.ts, controllers should not access PrismaService or the database directly.  
  scope: src/api/**/*.controller.ts controllers
- **backend#R30** (calls, should; AGENTS.md:72): In repositories, multi-step database mutations should be wrapped in a Prisma transaction (`$transaction`).  
  scope: src/features/**/*.repository.ts repositories
- **backend#R31** (avoid, should; AGENTS.md:73): In repositories and services, code should not issue database queries inside loops over results (N+1).  
  scope: src/features/** repositories and services
- **backend#R35** (testing, should; AGENTS.md:84): In unit tests, external dependencies (Prisma, Redis, etc.) should be replaced with mocks.  
  scope: src/**/*.spec.ts unit tests
- **backend#R36** (testing, must; AGENTS.md:89): In test files, negative test cases must come before positive test cases.  
  scope: **/*.spec.ts tests
- **backend#R37** (testing, must; AGENTS.md:91): In test files, negative and positive cases must be in separate `describe('negative cases')` and `describe('positive cases')` blocks.  
  scope: **/*.spec.ts tests
- **backend#R38** (testing, must; AGENTS.md:92): In test files, sibling `describe` blocks must be separated by an empty line.  
  scope: **/*.spec.ts tests
- **backend#R40** (file_layout, must; eslint.config.ts:84): In src/**/*.{ts,tsx}, file names must be kebab-case (middle extensions like .service ignored).  
  scope: src/**/*.{ts,tsx} all files
- **backend#R41** (file_layout, must; eslint.config.ts:93): In src/**, folder names must be kebab-case.  
  scope: src/**/ folders
- **backend#R42** (other, must; eslint.config.ts:100): In TypeScript files, modules must not use default exports; use named exports.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R43** (testing, must; eslint.config.ts:102): In TypeScript files, tests must not use `.only` (describe.only, it.only).  
  scope: **/*.{ts,tsx,mts,cts} tests
- **backend#R44** (other, must; eslint.config.ts:104): In TypeScript files, functions must not exceed a cognitive complexity of 20.  
  scope: **/*.{ts,tsx,mts,cts} functions
- **backend#R45** (other, must; eslint.config.ts:105): In TypeScript files, conditionals must not have all branches identical.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R46** (other, must; eslint.config.ts:106): In TypeScript files, nested `if` statements that can be merged must be collapsed.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R47** (other, must; eslint.config.ts:107): In TypeScript files, collection size/length checks must not be always-true or always-false (e.g. `length >= 0`).  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R48** (other, must; eslint.config.ts:108): In TypeScript files, two branches of a conditional or switch must not have the same implementation.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R49** (other, must; eslint.config.ts:109): In TypeScript files, collection elements must not be overwritten unconditionally before being used.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R50** (other, must; eslint.config.ts:110): In TypeScript files, code must not read from or iterate collections that are always empty.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R51** (other, must; eslint.config.ts:111): In TypeScript files, boolean conditions must not be always true or always false.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R52** (other, must; eslint.config.ts:112): In TypeScript files, if/else-if chains must not repeat the same condition.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R53** (other, must; eslint.config.ts:113): In TypeScript files, binary operators must not have identical operands on both sides.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R54** (other, must; eslint.config.ts:114): In TypeScript files, functions must not have identical implementations (duplicate functions).  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R55** (other, must; eslint.config.ts:115): In TypeScript files, return values of side-effect-free functions must not be ignored.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R56** (other, must; eslint.config.ts:116): In TypeScript files, boolean checks must not be inverted with `!(a === b)`; use the opposite operator.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R57** (other, must; eslint.config.ts:117): In TypeScript files, boolean literals must not be used redundantly in comparisons or conditions.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R58** (other, must; eslint.config.ts:118): In TypeScript files, `switch` statements must have at least three cases; use `if` otherwise.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R59** (error_handling, must; eslint.config.ts:119): In TypeScript files, created error objects must be thrown, not discarded.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R60** (other, must; eslint.config.ts:120): In TypeScript files, collections that are only written to and never read must not exist.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R61** (other, must; eslint.config.ts:121): In TypeScript files, the return value of functions that return nothing must not be used.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R62** (other, must; eslint.config.ts:122): In TypeScript files, code must not use non-existent operators such as `=+`, `=-` or `=!`.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R63** (other, must; eslint.config.ts:123): In TypeScript files, a value must be returned directly instead of being assigned to a local variable that is immediately returned.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R64** (argument, must; eslint.config.ts:124): In TypeScript files, `Array.prototype.reduce` calls must pass an initial value.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R65** (avoid, must; eslint.config.ts:126): In TypeScript files, code must not use `@ts-ignore`, `@ts-nocheck` or undescribed `@ts-expect-error` comments.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R66** (typing, must; eslint.config.ts:127): In TypeScript files, object types must be defined with `type`, not `interface`.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R67** (typing, must; eslint.config.ts:128): In TypeScript files, type-only imports must use `import type`.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R68** (typing, must; eslint.config.ts:129): In TypeScript files, functions and methods must declare an explicit return type.  
  scope: **/*.{ts,tsx,mts,cts} functions
- **backend#R69** (naming, must; eslint.config.ts:130): In TypeScript files, type-like names (types, interfaces, enums, type parameters, classes) must be PascalCase.  
  scope: **/*.{ts,tsx,mts,cts} type declarations
- **backend#R70** (naming, must; eslint.config.ts:136): In TypeScript files, class names must be StrictPascalCase or UPPER_CASE.  
  scope: **/*.{ts,tsx,mts,cts} classes
- **backend#R71** (typing, must; eslint.config.ts:141): In TypeScript files, void-returning expressions must not be used as values, except as arrow-function shorthand bodies.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R73** (naming, must; eslint.config.ts:144): In TypeScript files, variables must not shadow variables from an outer scope.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R74** (other, must; eslint.config.ts:145): In TypeScript files, there must be no unused variables, and no unused arguments after the last used one; rest siblings are not exempt.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R76** (other, must; eslint.config.ts:156): In TypeScript files, `??` must be used instead of `||` for nullish defaults, except for string operands.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R77** (typing, must; eslint.config.ts:157): In TypeScript files, private class members that are never reassigned must be marked `readonly`.  
  scope: **/*.{ts,tsx,mts,cts} classes
- **backend#R78** (typing, must; eslint.config.ts:158): In TypeScript files, template literal expressions must be strings or numbers only.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R80** (typing, must; eslint.config.ts:160): In TypeScript files, `switch` statements over union or enum types must handle every member.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R81** (error_handling, must; eslint.config.ts:162): In TypeScript files, built-in errors must be created with a message argument.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R82** (avoid, must; eslint.config.ts:163): In TypeScript files, `await` must not be used on elements passed to Promise.all/allSettled/any/race.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R83** (avoid, must; eslint.config.ts:164): In TypeScript files, `instanceof` must not be used with built-in types like Array or String; use Array.isArray or typeof.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R84** (avoid, must; eslint.config.ts:165): In TypeScript files, Promise.all/any/race must not be called with a single-element array.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R85** (avoid, must; eslint.config.ts:166): In TypeScript files, objects and classes must not define a `then` property.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R86** (avoid, must; eslint.config.ts:167): In TypeScript files, async functions must not wrap returns in Promise.resolve or Promise.reject.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R87** (avoid, must; eslint.config.ts:168): In TypeScript files, spreads that only copy a literal or iterable unnecessarily must not be used.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R88** (avoid, must; eslint.config.ts:169): In TypeScript files, useless `undefined` (e.g. `return undefined`, `let x = undefined`) must not be written, except as call arguments and arrow bodies.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R89** (calls, must; eslint.config.ts:170): In TypeScript files, arrays must be flattened with `Array#flat()` rather than reduce/concat idioms.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R90** (calls, must; eslint.config.ts:171): In TypeScript files, modern DOM APIs (before/after/replaceWith) must be used instead of insertBefore/replaceChild.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R91** (import_restriction, must; eslint.config.ts:172): In TypeScript files, Node built-in modules must be imported with the `node:` protocol (e.g. `node:fs`).  
  scope: **/*.{ts,tsx,mts,cts} imports
- **backend#R92** (calls, must; eslint.config.ts:173): In TypeScript files, `Number.isNaN`, `Number.parseInt` etc. must be used instead of the global equivalents.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R93** (calls, must; eslint.config.ts:174): In TypeScript files, `startsWith`/`endsWith` must be used instead of regex anchors for prefix/suffix checks.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R94** (calls, must; eslint.config.ts:175): In TypeScript files, deep copies must use `structuredClone` instead of JSON.parse(JSON.stringify(...)).  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R95** (error_handling, must; eslint.config.ts:176): In TypeScript files, type-check failures must throw `TypeError` rather than `Error`.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R96** (error_handling, must; eslint.config.ts:177): In TypeScript files, errors must be thrown with `new` (throw new Error(...)).  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R97** (other, must; eslint.config.ts:179): In TypeScript files, array method callbacks (map, filter, reduce...) must return a value; implicit `return;` is allowed.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R98** (naming, must; eslint.config.ts:185): In TypeScript files, identifiers including object property names must be camelCase.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R100** (avoid, must; eslint.config.ts:188): In TypeScript files, comparisons must use `===`/`!==`, except `== null` which is allowed.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R101** (other, must; eslint.config.ts:189): In TypeScript files, getters must return a value (implicit return allowed).  
  scope: **/*.{ts,tsx,mts,cts} getters
- **backend#R102** (other, must; eslint.config.ts:195): In TypeScript files, a `return` statement must be preceded by an empty line unless it is first in its block.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R103** (avoid, must; eslint.config.ts:196): In TypeScript files, code must not call alert, confirm or prompt.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R105** (avoid, must; eslint.config.ts:198): In TypeScript files, code must not use `console.*`; logging goes through LoggerService.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R106** (avoid, must; eslint.config.ts:199): In TypeScript files, code must not contain `debugger` statements.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R112** (avoid, should; eslint.config.ts:205): In TypeScript files, code should not contain TODO/FIXME/XXX warning comments.  
  scope: **/*.{ts,tsx,mts,cts} all files
- **backend#R124** (testing, must; eslint.config.ts:277): In test files, Jest alias matchers (e.g. toBeCalled) must not be used; use canonical names (toHaveBeenCalled).  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R125** (testing, must; eslint.config.ts:278): In test files, `expect` must not be called conditionally (inside if or catch).  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R126** (testing, must; eslint.config.ts:279): In test files, tests must not be disabled with skip/xit/xdescribe.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R127** (testing, must; eslint.config.ts:280): In test files, tests and hooks must not use the `done` callback; use async/promises.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R128** (testing, must; eslint.config.ts:281): In test files, the file must not export anything.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R129** (testing, must; eslint.config.ts:282): In test files, focused tests (fit, fdescribe, .only) must not be committed.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R130** (testing, must; eslint.config.ts:283): In test files, sibling tests and describe blocks must not share the same title.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R131** (testing, must; eslint.config.ts:284): In test files, inline snapshots must not contain template interpolation.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R132** (testing, must; eslint.config.ts:285): In test files, Jasmine globals (spyOn, fail, pending, jasmine.*) must not be used.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R133** (import_restriction, must; eslint.config.ts:286): In test files, modules must not be imported from `__mocks__` directories directly.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R134** (testing, must; eslint.config.ts:287): In test files, `expect` must only be called inside a test or hook, not at describe level.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R135** (testing, must; eslint.config.ts:288): In test files, `it.only`/`it.skip` must be used instead of the f/x prefixes (fit, xit, xdescribe).  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R136** (testing, must; eslint.config.ts:289): In test files, array length assertions must use `toHaveLength()` instead of `expect(x.length).toBe(n)`.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R137** (testing, must; eslint.config.ts:290): In test files, `describe` callbacks must be synchronous functions without parameters.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R138** (testing, must; eslint.config.ts:291): In test files, `expect()` must be called with one argument and a matcher, and async matchers must be awaited.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R139** (testing, must; eslint.config.ts:292): In test files, promises containing `expect` must be returned or awaited.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R140** (testing, must; eslint.config.ts:293): In test files, describe/test titles must be non-empty strings without leading/trailing spaces or duplicated prefixes.  
  scope: **/*.{spec,test}.*, **/__fixtures__/** tests
- **backend#R142** (other, must; eslint.config.ts:311): In TypeScript files (not .d.ts), classes with only static members or empty bodies are forbidden unless decorated (e.g. NestJS @Module classes).  
  scope: **/*.{ts,tsx,mts,cts} except **/*.d.ts classes
- **backend#R143** (file_layout, must; REVIEW.md:11): In src/, controllers and DTOs must live under src/api/ (transport layer only).  
  scope: src/api/** controllers and DTOs
- **backend#R144** (file_layout, must; REVIEW.md:16): In src/, business-logic services, repositories, entities and mappers must live under src/features/<feature>/.  
  scope: src/features/** business logic
- **backend#R145** (file_layout, must; REVIEW.md:19): In src/, infrastructure modules (Redis, Prisma, Sentry, Metrics, etc.) must live under src/modules/.  
  scope: src/modules/** infrastructure modules
- **backend#R146** (file_layout, must; REVIEW.md:12): In src/, cross-cutting decorators, guards, interceptors and utils must live under src/common/.  
  scope: src/common/** cross-cutting code
- **backend#R147** (file_layout, must; REVIEW.md:23): In src/features/<feature>/, files must follow the anatomy: <feature>.service.ts, <feature>.repository.ts, <feature>.module.ts, constants/, entities/, mappers/, cache-queries/, types/, interfaces/ subfolders.  
  scope: src/features/<feature>/** feature folders
- **backend#R148** (file_layout, must; REVIEW.md:35): In src/api/<feature>/, the controller must be <feature>.controller.ts and DTOs must be split into dtos/requests/, dtos/responses/ and dtos/queries/.  
  scope: src/api/<feature>/** controllers and DTOs
- **backend#R149** (file_layout, must; REVIEW.md:44): In src/**, all file names must be kebab-case.  
  scope: src/** all files
- **backend#R150** (file_layout, must; REVIEW.md:45): In src/**, file names must carry a role suffix (.service.ts, .controller.ts, .repository.ts, .module.ts, .entity.ts, .mapper.ts, .guard.ts, .interceptor.ts, .middleware.ts, .decorator.ts, .dto.ts, .enum.ts).  
  scope: src/** all files
- **backend#R151** (file_layout, must; REVIEW.md:46): In src/**, unit test files must be co-located next to the file they test and named <name>.spec.ts.  
  scope: src/**/*.spec.ts unit tests
- **backend#R152** (file_layout, must; REVIEW.md:47): In src/**, files holding base/abstract classes must be named `_base.<role>.ts` and suppress @check-file/filename-naming-convention with an eslint-disable comment.  
  scope: src/**/_base.*.ts base classes
- **backend#R153** (file_layout, must; REVIEW.md:48): In src/error-handler/errors/, error classes must be grouped into one `<domain>.errors.ts` file per domain.  
  scope: src/error-handler/errors/** error classes
- **backend#R154** (typing, must; REVIEW.md:55): In src/**, shapes must be declared with `type`, not `interface`, except where NestJS imposes an interface.  
  scope: src/** type declarations
- **backend#R155** (typing, must; REVIEW.md:56): In src/**, type-only imports must use `import type`.  
  scope: src/** imports
- **backend#R156** (other, must; REVIEW.md:57): In src/** classes, members must be ordered alphabetically, with properties before methods.  
  scope: src/** classes
- **backend#R157** (typing, must; REVIEW.md:58): In src/** classes, all public methods must declare explicit return types.  
  scope: src/** class methods
- **backend#R158** (typing, must; REVIEW.md:59): In src/** classes, injected services and non-mutated private fields must be `readonly`.  
  scope: src/** classes
- **backend#R159** (other, must; REVIEW.md:60): In src/** classes, truly private state must use ECMAScript `#` private fields (e.g. `#appName`).  
  scope: src/** classes
- **backend#R160** (naming, must; REVIEW.md:61): In src/** enums, keys must be SCREAMING_SNAKE_CASE and string values camelCase or lowercase.  
  scope: src/** enums
- **backend#R161** (avoid, should; REVIEW.md:62): In src/**, code should not use `any`; use generics or `unknown` instead.  
  scope: src/** all files
- **backend#R162** (other, must; REVIEW.md:63): In src/**, optional object keys must be added with conditional spread (`...(cond && { key: value })`) rather than if/else assignments.  
  scope: src/** all files
- **backend#R163** (other, must; REVIEW.md:69): In TypeScript files, imports must be grouped as: package type imports, package/built-in value imports, relative type imports, relative value imports, blank line between groups, natural sort within.  
  scope: **/*.ts imports
- **backend#R164** (decorator, must; REVIEW.md:93): In src/**/*.module.ts, the @Module decorator must declare controllers, imports, providers and exports explicitly.  
  scope: src/**/*.module.ts NestJS modules
- **backend#R165** (decorator, must; REVIEW.md:94): In src/**/*.module.ts, infrastructure modules (PrismaModule, RedisManagerModule, etc.) must not be @Global; consuming modules import them explicitly.  
  scope: src/**/*.module.ts NestJS modules
- **backend#R166** (decorator, must; REVIEW.md:95): In src/**, only ConfigModule and LoggerModule may be global; no other module may use @Global() or isGlobal.  
  scope: src/**/*.module.ts NestJS modules
- **backend#R167** (file_layout, must; REVIEW.md:110): Controllers must be placed in src/api/<feature>/.  
  scope: src/**/*.controller.ts controllers
- **backend#R168** (layering, must; REVIEW.md:111): In src/api/**/*.controller.ts, controllers must contain no business logic, only routing, guards and response mapping.  
  scope: src/api/**/*.controller.ts controllers
- **backend#R169** (decorator, must; REVIEW.md:112): In src/api/**/*.controller.ts, versioned controllers must use `@Controller({ path, version })`.  
  scope: src/api/**/*.controller.ts controllers
- **backend#R170** (calls, must; REVIEW.md:113): In src/api/**/*.controller.ts, responses must be built with `plainToInstance(ResponseDto, result, { excludeExtraneousValues: true })`.  
  scope: src/api/**/*.controller.ts controller methods
- **backend#R171** (decorator, must; REVIEW.md:115): In src/api/**/*.controller.ts, method decorators must be ordered @ApiErrors, then @ApiOk/@ApiPaginated/@ApiEmpty, then the HTTP verb, then @UseGuards last.  
  scope: src/api/**/*.controller.ts controller methods
- **backend#R172** (file_layout, must; REVIEW.md:137): Business services must be placed in src/features/<feature>/.  
  scope: src/features/**/*.service.ts services
- **backend#R173** (layering, must; REVIEW.md:138): In src/features/**/*.service.ts, services must hold all business logic, including cache reads and invalidation.  
  scope: src/features/**/*.service.ts services
- **backend#R174** (other, must; REVIEW.md:139): In src/features/**/*.service.ts, all dependencies must be injected through constructor parameters declared `private readonly`.  
  scope: src/features/**/*.service.ts services
- **backend#R175** (typing, must; REVIEW.md:140): In src/features/**/*.service.ts, all service methods must declare explicit return types.  
  scope: src/features/**/*.service.ts services
- **backend#R176** (error_handling, must; REVIEW.md:141): In src/features/**/*.service.ts, services must throw BaseError subclasses and must never throw strings or generic `Error`.  
  scope: src/features/**/*.service.ts services
- **backend#R177** (layering, must; REVIEW.md:158): In src/**, only repositories (src/features/**/*.repository.ts) may call Prisma/PrismaService directly.  
  scope: src/** database access
- **backend#R178** (calls, must; REVIEW.md:159): In src/features/**/*.repository.ts, multi-step reads and writes must use `this.prisma.$transaction([...])`.  
  scope: src/features/**/*.repository.ts repositories
- **backend#R179** (calls, must; REVIEW.md:160): In src/features/**/*.repository.ts, Prisma rows must be converted to domain entities through the feature's Mapper object (e.g. `TodoMapper.toEntity`).  
  scope: src/features/**/*.repository.ts repositories
- **backend#R180** (error_handling, must; REVIEW.md:161): In src/features/**/*.repository.ts, repositories must not throw domain errors; they return `undefined` for not-found.  
  scope: src/features/**/*.repository.ts repositories
- **backend#R181** (decorator, must; REVIEW.md:174): In src/features/**/entities/*.entity.ts, entities must be plain classes without NestJS or Prisma decorators.  
  scope: src/features/**/entities/*.entity.ts entities
- **backend#R182** (other, must; REVIEW.md:175): In src/features/**/entities/*.entity.ts, the entity constructor must take `Partial<Entity>` and call `Object.assign(this, partial)`.  
  scope: src/features/**/entities/*.entity.ts entities
- **backend#R183** (other, must; REVIEW.md:176): In src/features/**/entities/*.entity.ts, entity properties must be listed alphabetically.  
  scope: src/features/**/entities/*.entity.ts entities
- **backend#R184** (other, must; REVIEW.md:196): In src/features/**/mappers/*.mapper.ts, mappers must be exported `const` objects of plain methods, not classes.  
  scope: src/features/**/mappers/*.mapper.ts mappers
- **backend#R185** (other, must; REVIEW.md:197): In src/features/**/mappers/*.mapper.ts, mappers must only map Prisma models to domain entities.  
  scope: src/features/**/mappers/*.mapper.ts mappers
- **backend#R186** (typing, must; REVIEW.md:198): In src/**, Prisma-generated types must be imported with `import type`.  
  scope: src/** imports of Prisma types
- **backend#R187** (decorator, must; REVIEW.md:214): In src/api/**/dtos/requests/*.dto.ts, every field must be validated with class-validator decorators.  
  scope: src/api/**/dtos/requests/** request DTOs
- **backend#R188** (decorator, must; REVIEW.md:215): In request DTOs, every field must carry `@ApiProperty` or `@ApiPropertyOptional`.  
  scope: src/api/**/dtos/** request DTOs
- **backend#R189** (decorator, must; REVIEW.md:216): In request DTOs, `@ApiProperty*` decorators must come before validation decorators on each field.  
  scope: src/api/**/dtos/** request DTOs
- **backend#R190** (decorator, must; REVIEW.md:217): In query DTOs, boolean fields must use `@Transform(({ value }) => value === 'true' || value === true)`.  
  scope: src/api/**/dtos/queries/** query DTOs
- **backend#R191** (decorator, must; REVIEW.md:218): In query DTOs, numeric fields must use `@Type(() => Number)` together with `@IsInt()`.  
  scope: src/api/**/dtos/queries/** query DTOs
- **backend#R192** (decorator, must; REVIEW.md:222): In src/api/**/dtos/responses/*.dto.ts, every property must carry `@Expose()` from class-transformer.  
  scope: src/api/**/dtos/responses/** response DTOs
- **backend#R193** (decorator, must; REVIEW.md:223): In response DTOs, nested object or array properties must carry `@Type(() => NestedDto)`.  
  scope: src/api/**/dtos/responses/** response DTOs
- **backend#R194** (decorator, must; REVIEW.md:224): In response DTOs, every property must carry `@ApiProperty()`.  
  scope: src/api/**/dtos/responses/** response DTOs
- **backend#R195** (other, must; REVIEW.md:225): In response DTOs, properties must be listed alphabetically.  
  scope: src/api/**/dtos/responses/** response DTOs
- **backend#R196** (decorator, must; REVIEW.md:230): In query DTOs, every field must be marked `@IsOptional()`.  
  scope: src/api/**/dtos/queries/** query DTOs
- **backend#R197** (base_class, must; REVIEW.md:238): In src/error-handler/errors/**, every domain error class must extend `BaseError<TDetails>`.  
  scope: src/error-handler/errors/** error classes
- **backend#R198** (other, must; REVIEW.md:257): In src/error-handler/errors/**, each error class must declare static `code`, `domain`, `message` and `status` properties.  
  scope: src/error-handler/errors/** error classes
- **backend#R199** (other, must; REVIEW.md:258): In src/error-handler/errors/**, error constructors must call `super()` with the class's static message, code, domain and status.  
  scope: src/error-handler/errors/** error classes
- **backend#R200** (naming, must; REVIEW.md:263): In src/error-handler/constants/error.codes.ts, `ErrorCodes` enum values must be SCREAMING_SNAKE_CASE strings.  
  scope: src/error-handler/constants/error.codes.ts
- **backend#R201** (error_handling, must; REVIEW.md:268): In src/**, there must be a single global `@Catch()` exception filter (GlobalExceptionFilter); no other exception filters.  
  scope: src/error-handler/filters/** exception filters
- **backend#R202** (error_handling, must; REVIEW.md:271): In the exception filter, infrastructure and unknown errors must never include internal details in the client response.  
  scope: src/error-handler/** error responses
- **backend#R203** (error_handling, must; REVIEW.md:274): In the exception filter, errors must be sent to Sentry only for 5xx when SENTRY_ENABLED; domain 4xx errors must never be captured.  
  scope: src/error-handler/filters/global-exception.filter.ts
- **backend#R204** (wrapper, must; REVIEW.md:280): In src/config/*.config.ts, each config must be defined with `registerAs('configKey', factory)` from @nestjs/config.  
  scope: src/config/*.config.ts config factories
- **backend#R205** (calls, must; REVIEW.md:281): In src/config/*.config.ts, the factory must validate env with a class-validator validator class via `validateConfig(...)`.  
  scope: src/config/*.config.ts config factories
- **backend#R206** (typing, must; REVIEW.md:282): In src/config/*.config.ts, each factory must return a typed config shape defined in src/config/interfaces/.  
  scope: src/config/** config factories
- **backend#R207** (decorator, must; REVIEW.md:283): In src/**, configs must be injected with `@Inject(config.KEY)` and typed `ConfigType<typeof config>`.  
  scope: src/** providers consuming configs
- **backend#R208** (calls, must; REVIEW.md:299): In src/**, all cache operations must go through `CacheStorage`.  
  scope: src/** cache access
- **backend#R209** (error_handling, must; REVIEW.md:300): In src/modules/redis-manager/storages/cache.storage.ts, every CacheStorage method must catch errors, log a warning and not rethrow.  
  scope: src/modules/redis-manager/storages/cache.storage.ts
- **backend#R210** (other, must; REVIEW.md:301): In src/features/**/cache-queries/*.cache-queries.ts, cache keys must be defined as functions on a `*CacheKeys` const object.  
  scope: src/features/**/cache-queries/** cache keys
- **backend#R211** (naming, must; REVIEW.md:302): In cache-queries files, keys must follow `<CACHE_VERSION>:resource:id` and be prefixed with a CACHE_VERSION constant that is bumped when the cached shape changes.  
  scope: src/features/**/cache-queries/** cache keys
- **backend#R212** (avoid, must; REVIEW.md:303): In src/** Redis code, the Redis `KEYS` command must never be used; pattern deletion uses SCAN and UNLINK.  
  scope: src/** Redis access
- **backend#R213** (calls, must; REVIEW.md:317): In src/features/**/*.service.ts, create/update/delete methods must invalidate related cache keys via `del` or `delByPattern`.  
  scope: src/features/**/*.service.ts services
- **backend#R214** (calls, must; REVIEW.md:318): In src/features/**/*.service.ts, cached reads must follow cache-aside: get from cache, on miss fetch from repository, then `set`.  
  scope: src/features/**/*.service.ts services
- **backend#R215** (calls, must; REVIEW.md:324): In src/**, all logging must go through `LoggerService`, not console or raw pino.  
  scope: src/** all files
- **backend#R216** (argument, must; REVIEW.md:325): In src/**, LoggerService methods must be called with a structured Message object (e.g. `{ ctx, msg, ... }`), not a bare string.  
  scope: src/** logging calls
- **backend#R217** (argument, must; REVIEW.md:332): In src/** logging calls, the `ctx` field must always be the calling class name via `ClassName.name`.  
  scope: src/** logging calls
- **backend#R218** (decorator, must; REVIEW.md:339): In src/**/*.guard.ts and *.interceptor.ts, every guard and interceptor class must be decorated with `@Injectable()`.  
  scope: src/** guards and interceptors
- **backend#R219** (base_class, must; REVIEW.md:340): In src/** guards and interceptors, classes must implement `CanActivate` or `NestInterceptor` respectively.  
  scope: src/** guards and interceptors
- **backend#R221** (testing, must; REVIEW.md:349): In spec files, negative cases must be in a first `describe('negative cases')` block and positive cases in a following `describe('positive cases')` block, separated by a blank line.  
  scope: **/*.spec.ts tests
- **backend#R223** (testing, must; REVIEW.md:366): In unit spec files, the unit under test must be built with `Test.createTestingModule` from @nestjs/testing.  
  scope: src/**/*.spec.ts unit tests
- **backend#R224** (testing, must; REVIEW.md:367): In spec files, `jest.clearAllMocks()` must be called in `beforeEach`.  
  scope: src/**/*.spec.ts unit tests
- **backend#R225** (testing, must; REVIEW.md:368): In unit spec files, external dependencies must be substituted with mocks provided via `useValue` in the testing module.  
  scope: src/**/*.spec.ts unit tests
- **backend#R226** (file_layout, must; REVIEW.md:372): Shared test mocks must live in src/mocks/ and be imported by spec files rather than redefined inline.  
  scope: src/mocks/**, src/**/*.spec.ts
- **backend#R227** (testing, must; REVIEW.md:373): In spec files and src/mocks/, mocks must be plain objects with `jest.fn()` per method; class mocking and `jest.spyOn` must not be used.  
  scope: src/**/*.spec.ts, src/mocks/** mocks
- **backend#R228** (testing, must; REVIEW.md:384): In spec files, typed error assertions must use `await expect(...).rejects.toBeInstanceOf(ErrorClass)`.  
  scope: **/*.spec.ts tests
- **backend#R229** (testing, must; REVIEW.md:385): In spec files, error payload assertions must use `rejects.toMatchObject({ details: ... })`.  
  scope: **/*.spec.ts tests
- **backend#R230** (testing, should; REVIEW.md:386): In spec files, `toBe` should be used for primitive/reference equality and `toEqual` for deep equality.  
  scope: **/*.spec.ts tests
- **backend#R231** (testing, must; REVIEW.md:387): In spec files, side effects must be asserted explicitly with `toHaveBeenCalledWith`.  
  scope: **/*.spec.ts tests
- **backend#R232** (file_layout, must; REVIEW.md:394): In src/**/_base.*.ts files, line 1 must be `// eslint-disable-next-line @check-file/filename-naming-convention`.  
  scope: src/**/_base.*.ts base classes
- **backend#R233** (base_class, should; REVIEW.md:395): In src/**, base classes must be used only for true inheritance hierarchies; otherwise compose.  
  scope: src/** classes
- **backend#R234** (naming, must; REVIEW.md:401): In src/**/*.enum.ts, enum keys must be SCREAMING_SNAKE_CASE and string values camelCase or lowercase.  
  scope: src/**/*.enum.ts enums
- **backend#R235** (file_layout, must; REVIEW.md:403): In src/**, enums must be declared in dedicated `*.enum.ts` files (one per enum or per domain).  
  scope: src/** enums
- **backend#R236** (file_layout, must; REVIEW.md:409): In src/**, constants must be placed in dedicated `*.constants.ts` files grouped by concern.  
  scope: src/** constants
- **backend#R237** (naming, must; REVIEW.md:410): In src/**/*.constants.ts, constants must be named in SCREAMING_SNAKE_CASE.  
  scope: src/**/*.constants.ts constants
- **backend#R238** (other, must; REVIEW.md:431): In src/**/*.module.ts, a module's `exports` must list only providers that consuming modules use.  
  scope: src/**/*.module.ts NestJS modules
- **backend#R239** (other, must; REVIEW.md:480): In src/error-handler/**, new error codes must be added to the `ErrorCodes` enum and categories to `ErrorCategory`, not used as string literals.  
  scope: src/error-handler/** error classes
- **backend#R240** (layering, must; REVIEW.md:485): In src/features/**/*.service.ts, services must use `CacheStorage` and must not access Redis clients directly.  
  scope: src/features/**/*.service.ts services
- **backend#R241** (argument, must; REVIEW.md:492): In src/**, every LoggerService call must include `ctx: ClassName.name` and `msg`.  
  scope: src/** logging calls
- **backend#R242** (avoid, must; REVIEW.md:493): In src/**, log calls must not include auth tokens, passwords or cookies.  
  scope: src/** logging calls
- **backend#R245** (file_layout, must; docs/architecture/patterns.md:11): A feature's domain errors must be placed in src/error-handler/errors/<feature>.errors.ts.  
  scope: src/error-handler/errors/** error files
- **backend#R246** (file_layout, must; docs/architecture/patterns.md:38): Create DTOs must be at src/api/<feature>/dtos/requests/create-<feature>.dto.ts and use class-validator plus @ApiProperty.  
  scope: src/api/<feature>/dtos/requests/** request DTOs
- **backend#R247** (decorator, must; docs/architecture/patterns.md:39): In src/api/<feature>/dtos/requests/update-<feature>.dto.ts, all fields must be optional.  
  scope: src/api/**/dtos/requests/update-*.dto.ts update DTOs
- **backend#R248** (file_layout, must; docs/architecture/patterns.md:40): Response DTOs must be at src/api/<feature>/dtos/responses/<feature>-response.dto.ts and use @Expose() and @ApiProperty.  
  scope: src/api/<feature>/dtos/responses/** response DTOs
- **backend#R249** (other, must; docs/architecture/patterns.md:69): In src/features/<feature>/<feature>.repository.ts, the repository must inject PrismaService, return entities via the mapper, and return void/undefined for not-found.  
  scope: src/features/**/*.repository.ts repositories
- **backend#R250** (other, must; docs/architecture/patterns.md:73): In src/features/<feature>/<feature>.service.ts, the service must inject the repository (and CacheStorage when caching), throw domain errors and coordinate cache invalidation.  
  scope: src/features/**/*.service.ts services
- **backend#R251** (file_layout, must; docs/architecture/patterns.md:77): A feature's cache key functions must be placed in src/features/<feature>/cache-queries/<feature>.cache-queries.ts.  
  scope: src/features/**/cache-queries/** cache keys
- **backend#R252** (naming, must; docs/architecture/patterns.md:80): In cache-queries files, a `CACHE_VERSION` constant must prefix every key and be bumped when the cached value shape changes.  
  scope: src/features/**/cache-queries/** cache keys
- **backend#R253** (other, must; docs/architecture/patterns.md:116): Every new feature module must be imported in src/app.module.ts.  
  scope: src/app.module.ts
- **backend#R254** (testing, must; docs/architecture/patterns.md:120): Each feature's controller, service, repository, mapper and cache-queries file must have a co-located *.spec.ts with negative cases first.  
  scope: src/api/**, src/features/** feature files
- **backend#R255** (file_layout, must; docs/architecture/patterns.md:121): End-to-end tests for a feature must be placed in test/<feature>.e2e-spec.ts.  
  scope: test/*.e2e-spec.ts e2e tests
- **backend#R256** (other, must; docs/architecture/overview.md:112): In src/**/*.module.ts, any module whose providers inject PrismaService must import PrismaModule (which is not global).  
  scope: src/**/*.module.ts NestJS modules
- **backend#R257** (other, must; docs/architecture/overview.md:148): In src/**/*.module.ts, `RequestTrackingService` must only be provided by RequestTrackingModule and never listed in another module's providers.  
  scope: src/**/*.module.ts NestJS modules
- **backend#R258** (decorator, must; docs/architecture/overview.md:163): In src/api/**/*.controller.ts, authenticated routes must apply `@UseGuards(AuthGuard)` per route; public routes are marked `@Public()`.  
  scope: src/api/**/*.controller.ts controller methods
- **backend#R259** (other, must; docs/restrictions/repository.md:88): In all source files, identifiers and comments must be written in English.  
  scope: **/* all files
- **backend#R260** (other, must; docs/hacks/tooling.md:43): In all TypeScript files except test/setup/setup.global.ts and teardown.global.ts, modules must use named exports only.  
  scope: **/*.ts all files
- **backend#R261** (testing, should; guide/testing.md:20): In spec files, tests should exercise only public methods, not private internals.  
  scope: **/*.spec.ts tests
- **backend#R262** (testing, should; guide/testing.md:13): In service spec files, tests should include both positive and negative cases.  
  scope: src/**/*.service.spec.ts service tests
- **backend#R263** (other, should; guide/performance.md:23): In src/api/** controllers, endpoints returning collections should accept pagination parameters and return paginated results.  
  scope: src/api/** controller methods returning collections
- **backend#R264** (avoid, must; guide/performance.md:111): In src/**, Redis code must never call the `KEYS` command; use SCAN with UNLINK.  
  scope: src/** Redis access
- **backend#R265** (other, must; guide/fault-tolerance.md:134): In src/**/*.module.ts, `RequestTrackingService` must not be declared in any module's providers other than RequestTrackingModule.  
  scope: src/**/*.module.ts NestJS modules
- **backend#R266** (error_handling, must; guide/error-handling.md:39): In src/**, raw Prisma/database errors must never be returned to clients; they are mapped (mapPrismaError) first.  
  scope: src/error-handler/** error responses
- **backend#R267** (error_handling, should; guide/error-handling.md:79): In src/**, unhandled errors should be handled by a single global exception filter.  
  scope: src/error-handler/filters/** exception filters
- **backend#R268** (other, should; guide/project-structure.md:77): In request validation, unknown or unsafe fields should be stripped (whitelisting DTOs).  
  scope: src/api/**/dtos/**, src/app.setup.ts ValidationPipe
- **backend#R269** (avoid, must; guide/logging-observability.md:67): In request logging, incoming requests must be logged with method, path and trace ID only, never the request body (except at debug level).  
  scope: src/logger/middlewares/** request logging
- **backend#R270** (argument, must; guide/logging-observability.md:300): In metrics code, the `route` label must be the route template, never the raw URL.  
  scope: src/modules/metrics/**, src/error-handler/filters/** metrics
- **backend#R271** (calls, should; guide/configuration-management.md:219): When reading config from ConfigService, code should use `configService.getOrThrow(...)` rather than `get(...)`.  
  scope: src/** ConfigService reads

## Proposals shown to the user

(none)

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "backend#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
