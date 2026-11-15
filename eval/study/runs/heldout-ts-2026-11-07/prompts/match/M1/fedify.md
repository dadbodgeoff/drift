You are checking whether a tool's proposed conventions for the repository **fedify** (https://github.com/fedify-dev/fedify at `88aa7efd5c46187bb50e4077438aa06f5a532cf2`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/fedify

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/654a29eb-e492-478f-a245-900a405452c5/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **fedify#R01** (import_restriction, must; CONTRIBUTING.md:205): In TypeScript scripts run on Node.js (scripts/**, tooling), relative imports must use explicit .ts file extensions.  
  scope: scripts/**/*.ts and other TypeScript run via node --experimental-strip-types
- **fedify#R02** (typing, must; CONTRIBUTING.md:206): In TypeScript scripts run on Node.js, type-only names must be imported with `import type`.  
  scope: scripts/**/*.ts and other TypeScript run via node --experimental-strip-types
- **fedify#R03** (import_restriction, must; CONTRIBUTING.md:206): In TypeScript scripts run on Node.js, imports must resolve through npm package manifests and must not rely on Deno import maps or tsconfig.json path aliases.  
  scope: scripts/**/*.ts run on Node.js
- **fedify#R04** (avoid, must; CONTRIBUTING.md:207): In TypeScript scripts run with node --experimental-strip-types, code must not use JSX, enums, constructor parameter properties, or namespaces with runtime code.  
  scope: scripts/**/*.ts run via node --experimental-strip-types
- **fedify#R06** (file_layout, must; CONTRIBUTING.md:262): In packages/*, each tsconfig.check.json / tsconfig.check.*.json must extend the runtime preset matching its code (tsconfig.node.json, tsconfig.workers.json or tsconfig.bun.json), not tsconfig.base.json directly.  
  scope: packages/*/tsconfig.check*.json
- **fedify#R07** (avoid, must; CONTRIBUTING.md:266): In Node.js-targeted code, code must not use the `Deno` or `document` globals; in Cloudflare Workers code, code must not use Node.js `process` unless its tsconfig adds Node.js types for nodejs_compat.  
  scope: packages/** runtime-specific source files
- **fedify#R08** (typing, must; CONTRIBUTING.md:270): In runtime-neutral code that detects Deno, the code must declare the subset of the `Deno` global it uses at module scope (declare const Deno ...) instead of loading Deno's type definitions.  
  scope: packages/** runtime-neutral modules
- **fedify#R09** (file_layout, must; CONTRIBUTING.md:278): In packages/ and scripts/, every TypeScript file must belong to a type-checking project (tsconfig.check*.json) or be listed with a reason in scripts/check_types_ownership.ts, and files must be added there only when the Node.js-based check cannot cover them.  
  scope: packages/**/*.ts, scripts/**/*.ts
- **fedify#R11** (typing, must; CONTRIBUTING.md:308): In packages/**, exported public APIs must be strictly typed (no loose or untyped signatures such as any).  
  scope: packages/** exported public APIs
- **fedify#R12** (typing, must; CONTRIBUTING.md:308): In packages/** public APIs, application-supplied types such as federation context data must be expressed as generic type parameters (e.g. TContextData).  
  scope: packages/** public APIs
- **fedify#R14** (avoid, should; CONTRIBUTING.md:310): In packages not explicitly tied to a platform, code should not use platform-specific APIs (e.g. Deno.*, Bun.*, Node-only modules).  
  scope: packages/** source not tied to a single platform
- **fedify#R16** (calls, should; CONTRIBUTING.md:313): In federation code, configuration should be expressed as fluent methods on FederationBuilder with callbacks that map routes to dispatchers.  
  scope: packages/fedify/src/federation/** federation code
- **fedify#R17** (file_layout, must; CONTRIBUTING.md:315): In the monorepo, ActivityPub vocabulary object classes must live in @fedify/vocab (packages/vocab) and must not be added to the main @fedify/fedify package.  
  scope: packages/fedify/src/**, packages/vocab/**
- **fedify#R18** (file_layout, must; CONTRIBUTING.md:326): In packages/fedify/src/, new code must not be added to the moved directories src/codegen/ (now @fedify/vocab-tools), src/runtime/ (now @fedify/vocab-runtime and src/utils/), src/vocab/ (now @fedify/vocab) or src/webfinger/ (now @fedify/webfinger).  
  scope: packages/fedify/src/{codegen,runtime,vocab,webfinger}/**
- **fedify#R20** (calls, must; CONTRIBUTING.md:332): In code verifying signed federation objects, verification must use Object Integrity Proofs.  
  scope: packages/** signature verification code
- **fedify#R23** (other, must; CONTRIBUTING.md:343): In packages/**, every exported public API must have a JSDoc comment.  
  scope: packages/** exported public APIs
- **fedify#R24** (naming, must; CONTRIBUTING.md:349): In all TypeScript code, functions, methods, properties and variables must be named in camelCase and classes and types in PascalCase.  
  scope: all TypeScript files
- **fedify#R25** (naming, must; CONTRIBUTING.md:353): In public API names, acronyms must be cased as ordinary words (UrlError, getHttpSignatures) and must not be all-caps (URLError, getHTTPSignatures).  
  scope: packages/** public API identifiers
- **fedify#R26** (naming, must; CONTRIBUTING.md:357): In public APIs, new Fedify-defined enum-like string literal values and tagged-union discriminator values must be kebab-case (e.g. "missing-actor"), except strings defined by external standards or APIs such as "canQuote".  
  scope: packages/** public API string literal unions and discriminators
- **fedify#R27** (naming, must; CONTRIBUTING.md:362): In public APIs, the prefixes is/does/are must be used only for predicate functions and methods; boolean properties and constants must not carry them (xxx.okay, not xxx.isOkay).  
  scope: packages/** public API members
- **fedify#R28** (naming, should; CONTRIBUTING.md:366): In public APIs, type names should name the modeled concept directly (Actor) rather than add data-holder suffixes such as Info (ActorInfo).  
  scope: packages/** public API types
- **fedify#R30** (naming, must; CONTRIBUTING.md:376): In telemetry code, values mirroring a public API tag must use that tag's spelling, while other OpenTelemetry attributes and structured log fields keep their own naming conventions.  
  scope: packages/** OpenTelemetry and logging code
- **fedify#R32** (testing, should; CONTRIBUTING.md:386): In test files, tests should use in-memory stores (e.g. MemoryKvStore, InProcessMessageQueue) unless the test specifically exercises a database adapter.  
  scope: **/*.test.ts
- **fedify#R34** (testing, should; CONTRIBUTING.md:423): In package test files, tests should be written with node:test (describe/it) and node:assert/strict.  
  scope: packages/**/*.test.ts (except @fedify/fedify and @fedify/vocab)
- **fedify#R35** (testing, must; CONTRIBUTING.md:437): In @fedify/fedify, @fedify/vocab and @fedify/vocab-runtime tests that run in the Cloudflare Workers harness, tests must be registered with test() from @fedify/fixture rather than node:test describe/it.  
  scope: packages/fedify/**/*.test.ts, packages/vocab/**/*.test.ts, packages/vocab-runtime/**/*.test.ts
- **fedify#R36** (import_restriction, must; CONTRIBUTING.md:453): In packages/**, imports from @fedify/fixture (mockDocumentLoader, TestSpanExporter, createTestTracerProvider, test) must appear only in files matching **/*.test.ts.  
  scope: packages/*/src/** non-test source files
- **fedify#R37** (testing, should; CONTRIBUTING.md:461): In tests, code should reuse helpers from @fedify/testing or packages/fedify/src/testing/ instead of creating new test infrastructure.  
  scope: **/*.test.ts
- **fedify#R38** (import_restriction, must; CONTRIBUTING.md:527): In packages that run on Deno and Node.js/Bun, every imported dependency must be mapped in the root deno.json `imports` and declared in the package's package.json dependencies or devDependencies.  
  scope: deno.json, packages/*/package.json
- **fedify#R39** (other, must; CONTRIBUTING.md:537): In package.json files, shared dependency versions must reference the pnpm catalog with "catalog:" rather than copying the version string.  
  scope: **/package.json
- **fedify#R40** (import_restriction, must; CONTRIBUTING.md:541): In deno.json imports, dependencies published on both JSR and npm must use the jsr: specifier (mapped under the npm import name, e.g. "hono": "jsr:@hono/hono@..."), while package.json uses the npm package.  
  scope: deno.json, packages/*/deno.json, packages/*/package.json
- **fedify#R41** (file_layout, must; CONTRIBUTING.md:560): In @fedify/init, third-party dependency versions must be declared in packages/init/src/json/ (deps.json for frameworks and tools, kv.json for key-value stores, mq.json for message queues) rather than hard-coded elsewhere.  
  scope: packages/init/src/**
- **fedify#R42** (calls, must; CONTRIBUTING.md:572): In @fedify/init framework descriptions, dependency versions must be referenced through the `deps` import from deps.json, not as literal version strings.  
  scope: packages/init/src/webframeworks/**
- **fedify#R43** (other, must; CONTRIBUTING.md:586): In published packages, package.json must include a `repository` field.  
  scope: packages/*/package.json (published)
- **fedify#R44** (file_layout, must; CONTRIBUTING.md:588): In every package directory, a tsconfig.check.json must exist and extend the matching runtime preset.  
  scope: packages/*/
- **fedify#R45** (file_layout, must; CONTRIBUTING.md:590): In the repository root, each new package must be listed in pnpm-workspace.yaml `packages` and, when Deno should include it, in the root deno.json `workspace` array.  
  scope: deno.json, pnpm-workspace.yaml
- **fedify#R46** (other, must; CONTRIBUTING.md:601): In JSR packages, deno.json must carry correct `name` and `publish` metadata, and docs/.vitepress/config.mts must not be edited to add package reference entries.  
  scope: packages/*/deno.json, docs/.vitepress/config.mts
- **fedify#R47** (file_layout, must; CONTRIBUTING.md:624): In @fedify/vocab, packages/vocab/src/vocab.ts is generated and must not be hand-edited, and exports for generated vocabulary types must not be added by hand.  
  scope: packages/vocab/src/vocab.ts, packages/vocab/src/mod.ts
- **fedify#R48** (layering, must; CONTRIBUTING.md:632): In the monorepo, database-specific KvStore/MessageQueue implementations must live in their own adapter package, not in @fedify/fedify (which only holds the interfaces in packages/fedify/src/federation/kv.ts and mq.ts).  
  scope: packages/fedify/src/federation/**, adapter packages
- **fedify#R49** (base_class, should; CONTRIBUTING.md:633): In database adapter packages, the package should implement both KvStore and MessageQueue when the backend can support them.  
  scope: database adapter packages (packages/postgres, redis, sqlite, mysql, ...)
- **fedify#R51** (other, must; .agents/skills/create-integration-package/SKILL.md:71): In new integration packages created from the template, the template's instruction comments must be removed once implemented.  
  scope: packages/<framework>/ integration packages
- **fedify#R52** (file_layout, should; .agents/skills/create-integration-package/SKILL.md:75): In web framework integration packages, the package should include both deno.json and package.json and its code should be compatible with Deno and Node.js/Bun.  
  scope: packages/<framework>/ integration packages
- **fedify#R53** (other, should; .agents/skills/create-integration-package/SKILL.md:84): In integration package entry modules (src/mod.ts), exports should be limited to the main integration function and the ContextDataFactory type, plus only what is necessary.  
  scope: packages/<framework>/src/mod.ts
- **fedify#R54** (other, must; .agents/skills/create-integration-package/SKILL.md:239): In integration package entry modules, the module must export the main middleware/handler function and a ContextDataFactory type.  
  scope: packages/<framework>/src/mod.ts
- **fedify#R55** (calls, should; .agents/skills/create-integration-package/SKILL.md:98): In integration middleware, the onNotFound callback passed to federation.fetch() should delegate to the framework's next handler.  
  scope: packages/<framework>/src/** integration middleware
- **fedify#R56** (calls, must; .agents/skills/create-integration-package/SKILL.md:107): In integration middleware, the onNotAcceptable callback must not return 406 immediately; it must first call the framework's next handler and return 406 only if the framework response is 404.  
  scope: packages/<framework>/src/** integration middleware
- **fedify#R57** (other, must; .agents/skills/create-integration-package/SKILL.md:133): In integration middleware, the final 406 response must be new Response("Not acceptable", { status: 406, headers: { "Content-Type": "text/plain", Vary: "Accept" } }).  
  scope: packages/<framework>/src/** integration middleware
- **fedify#R58** (other, must; .agents/skills/create-integration-package/SKILL.md:126): In integration packages for frameworks with a native Request type, the package must include conversion functions between the Web API Request/Response and the framework's types.  
  scope: packages/<framework>/src/**
- **fedify#R59** (naming, should; .agents/skills/create-integration-package/SKILL.md:150): In integration packages, the main function should be named fedifyMiddleware when the framework calls it middleware, or fedifyHandler when it calls it a handler.  
  scope: packages/<framework>/src/mod.ts
- **fedify#R60** (file_layout, must; .agents/skills/create-integration-package/SKILL.md:177): In integration packages supporting Node.js/Bun, a tsdown.config.ts file must exist.  
  scope: packages/<framework>/
- **fedify#R61** (file_layout, must; .agents/skills/create-integration-package/SKILL.md:197): In integration packages, test files must be named *.test.ts (e.g. src/mod.test.ts).  
  scope: packages/<framework>/src/**
- **fedify#R62** (testing, should; .agents/skills/create-integration-package/SKILL.md:202): In integration package tests, tests should use node:test and node:assert/strict.  
  scope: packages/<framework>/**/*.test.ts
- **fedify#R63** (testing, must; .agents/skills/create-integration-package/SKILL.md:211): In integration package tests that use a runner other than node:test (e.g. vitest), the test file must contain a comment explaining why.  
  scope: packages/<framework>/**/*.test.ts
- **fedify#R64** (import_restriction, must; .agents/skills/create-integration-package/SKILL.md:218): In integration packages, published (non-*.test.ts) source files must never import @fedify/fixture.  
  scope: packages/<framework>/src/** non-test files
- **fedify#R65** (testing, must; .agents/skills/create-integration-package/SKILL.md:224): In integration package tests, tests must cover: a federation request returning JSON-LD, onNotFound fallthrough to the framework, a 406 when the client does not accept ActivityPub and no framework route matches, and the framework serving HTML on a shared route.  
  scope: packages/<framework>/**/*.test.ts
- **fedify#R66** (file_layout, must; .agents/skills/add-to-fedify-init/SKILL.md:36): In @fedify/init, each web framework must be described by a WebFrameworkDescription object in its own file packages/init/src/webframeworks/<framework>.ts.  
  scope: packages/init/src/webframeworks/*.ts
- **fedify#R67** (other, must; .agents/skills/add-to-fedify-init/SKILL.md:43): In packages/init/src/const.ts, new framework names must be appended to the end of the WEB_FRAMEWORK array.  
  scope: packages/init/src/const.ts
- **fedify#R68** (other, must; .agents/skills/add-to-fedify-init/SKILL.md:55): In packages/init/src/webframeworks/mod.ts, entries of the webFrameworks object must be kept in alphabetical order.  
  scope: packages/init/src/webframeworks/mod.ts
- **fedify#R69** (file_layout, must; .agents/skills/add-to-fedify-init/SKILL.md:72): In @fedify/init, generated-file templates must live under packages/init/src/templates/<framework>/ and be named <basename>.tpl.  
  scope: packages/init/src/templates/**
- **fedify#R70** (calls, must; .agents/skills/add-to-fedify-init/SKILL.md:75): In @fedify/init web framework descriptions, templates must be loaded with readTemplate() from packages/init/src/lib.ts and returned in WebFrameworkDescription.init().files.  
  scope: packages/init/src/webframeworks/*.ts
- **fedify#R71** (testing, must; .agents/skills/add-to-fedify-init/SKILL.md:117): In the init test harness, untestable option combinations must be recorded with a reason as key-value pairs in BANNED_LOOKUP_REASONS in packages/init/src/test/lookup.ts.  
  scope: packages/init/src/test/lookup.ts
- **fedify#R72** (file_layout, should; .agents/skills/create-example-app-with-integration/SKILL.md:100): In example apps, the example should support both Deno (deno.json) and Node.js (package.json plus tsdown.config.ts) unless the framework prevents it.  
  scope: examples/<framework>/
- **fedify#R73** (import_restriction, should; .agents/skills/create-example-app-with-integration/SKILL.md:108): In example apps for backend-only frameworks without a natural frontend pairing, the example should use Hono.  
  scope: examples/<framework>/
- **fedify#R74** (file_layout, must; .agents/skills/create-example-app-with-integration/SKILL.md:111): In example apps without a framework-prescribed entry point, the entry point must be src/main.ts, and the framework app must be defined and exported in src/app.ts and imported from the entry file.  
  scope: examples/<framework>/src/
- **fedify#R75** (calls, must; .agents/skills/create-example-app-with-integration/SKILL.md:113): In example apps, the entry file must import src/logging.ts, and loggers must be created with getLogger() from @logtape/logtape.  
  scope: examples/<framework>/src/**
- **fedify#R76** (other, must; .agents/skills/create-example-app-with-integration/SKILL.md:118): In example app server configuration, host restrictions must be disabled so all hosts are allowed.  
  scope: examples/<framework>/ server/dev config
- **fedify#R77** (wrapper, must; .agents/skills/create-example-app-with-integration/SKILL.md:129): In example apps, the Fedify middleware must be registered in src/app.ts.  
  scope: examples/<framework>/src/app.ts
- **fedify#R78** (file_layout, must; .agents/skills/create-example-app-with-integration/SKILL.md:139): In example apps, static assets (style.css, theme.js, fedify-logo.svg, demo-profile.png) must be served from the public/ directory.  
  scope: examples/<framework>/public/
- **fedify#R79** (testing, must; .agents/skills/create-example-app-with-integration/SKILL.md:151): In the examples test harness, every new example must be registered in the appropriate registry array in examples/test-examples/mod.ts.  
  scope: examples/test-examples/mod.ts
- **fedify#R80** (wrapper, must; .agents/skills/create-example-app-with-integration/ARCHITECTURE.md:15): In example apps, the Fedify framework middleware must be registered at the top level of the server, before any application routes.  
  scope: examples/<framework>/src/app.ts
- **fedify#R81** (wrapper, should; .agents/skills/create-example-app-with-integration/ARCHITECTURE.md:31): In example apps behind a proxy/tunnel, the request handler should be wrapped with getXForwardedRequest from x-forwarded-fetch at the same level as the Fedify middleware, before routing.  
  scope: examples/<framework>/src/app.ts
- **fedify#R82** (calls, must; .agents/skills/create-example-app-with-integration/ARCHITECTURE.md:48): In example apps, the search UI must debounce input by 300ms and send GET /?q=<handle>, and the server must resolve the handle with Fedify's lookupObject.  
  scope: examples/<framework>/ GET / route and client script
- **fedify#R83** (other, must; .agents/skills/create-example-app-with-integration/ARCHITECTURE.md:58): In example apps, there must be exactly one local actor, @demo, with name "Fedify Demo", profile image /demo-profile.png and summary "This is a Fedify Demo account.".  
  scope: examples/<framework>/src/federation.ts
- **fedify#R84** (error_handling, must; .agents/skills/create-example-app-with-integration/ARCHITECTURE.md:116): In example apps, the POST /post handler must create a Note, store it in postStore, send it to followers wrapped in a Create activity, remove it from the store if sending fails, and redirect to /.  
  scope: examples/<framework>/ POST /post route handler
- **fedify#R85** (calls, must; .agents/skills/create-example-app-with-integration/ARCHITECTURE.md:123): In example apps, POST /follow must send a Follow activity and store the relationship, and POST /unfollow must send Undo(Follow) and remove the relationship.  
  scope: examples/<framework>/ POST /follow and /unfollow route handlers
- **fedify#R86** (calls, must; .agents/skills/create-example-app-with-integration/ARCHITECTURE.md:146): In example apps, every mutation of the follower or following store (in inbox listeners or follow/unfollow handlers) must broadcast an event to all open /events SSE connections.  
  scope: examples/<framework>/src/** inbox listeners and route handlers
- **fedify#R87** (calls, must; .agents/skills/create-example-app-with-integration/ARCHITECTURE.md:158): In example app route handlers, federation access must go through a RequestContext obtained via federation.createContext(request, contextData).  
  scope: examples/<framework>/ route handlers
- **fedify#R88** (layering, should; .agents/skills/create-example-app-with-integration/ARCHITECTURE.md:164): In example app route handlers, code should not access data stores directly when a RequestContext method serves the same purpose.  
  scope: examples/<framework>/ route handlers
- **fedify#R89** (file_layout, must; .agents/skills/create-example-app-with-integration/ARCHITECTURE.md:173): In example apps, federation setup must live in src/federation.ts and storage in src/store.ts using the provided in-memory stores.  
  scope: examples/<framework>/src/
- **fedify#R90** (import_restriction, must; .agents/skills/create-example-app-with-integration/ARCHITECTURE.md:191): In example apps, logging must use @logtape/logtape configured in src/logging.ts.  
  scope: examples/<framework>/src/**
- **fedify#R91** (render, must; .agents/skills/create-example-app-with-integration/DESIGN.md:12): In example app UI, both light and dark themes must be supported via prefers-color-scheme detection, with no manual toggle.  
  scope: examples/<framework>/public/style.css, theme.js
- **fedify#R92** (render, must; .agents/skills/create-example-app-with-integration/DESIGN.md:194): In example app CSS, responsive styles must use a single media-query breakpoint at 768px.  
  scope: examples/<framework>/public/style.css
- **fedify#R93** (render, should; .agents/skills/create-example-app-with-integration/DESIGN.md:215): In example app CSS, theme-dependent values should use the --background and --foreground custom properties.  
  scope: examples/<framework>/public/style.css
- **fedify#R94** (file_layout, should; .agents/skills/create-example-app-with-integration/DESIGN.md:219): In example apps, all layout styles should be kept in a single static CSS file under public/.  
  scope: examples/<framework>/public/
- **fedify#R95** (import_restriction, must; .agents/skills/create-example-app-with-integration/DESIGN.md:232): In example apps, code must not add a CSS framework such as Tailwind or Bootstrap.  
  scope: examples/<framework>/
- **fedify#R96** (avoid, must; .agents/skills/create-example-app-with-integration/DESIGN.md:235): In example apps, code must not introduce custom fonts or font loading.  
  scope: examples/<framework>/ CSS and HTML
- **fedify#R97** (avoid, must; .agents/skills/create-example-app-with-integration/DESIGN.md:236): In example apps, client JavaScript must not be used for layout or styling beyond toggling the light/dark class on <body>.  
  scope: examples/<framework>/public/*.js and client scripts
- **fedify#R98** (file_layout, must; .agents/skills/add-vocab/SKILL.md:50): In @fedify/vocab, each vocabulary type schema must be a YAML file at packages/vocab/src/<typename-lowercase>.yaml.  
  scope: packages/vocab/src/*.yaml
- **fedify#R99** (other, must; .agents/skills/add-vocab/SKILL.md:70): In packages/vocab/src/*.yaml, each file must begin with `$schema: ../../vocab-tools/schema.yaml`.  
  scope: packages/vocab/src/*.yaml
- **fedify#R100** (naming, must; .agents/skills/add-vocab/SKILL.md:80): In vocabulary YAML files, the top-level fields name (PascalCase class name), uri, entity, description and properties must be present.  
  scope: packages/vocab/src/*.yaml
- **fedify#R101** (other, must; .agents/skills/add-vocab/SKILL.md:82): In vocabulary YAML files, the `entity` flag must be consistent with the parent type across the `extends` inheritance chain.  
  scope: packages/vocab/src/*.yaml
- **fedify#R102** (other, must; .agents/skills/add-vocab/SKILL.md:136): In vocabulary YAML files, defaultContext must map every term emitted by toJsonLd(): the type's compactName, its own properties' compactNames, inherited properties (via parent context URL) and properties of inline-embedded types (e.g. data-integrity, security, multikey, DID contexts).  
  scope: packages/vocab/src/*.yaml
- **fedify#R103** (other, must; .agents/skills/add-vocab/SKILL.md:171): In vocabulary YAML files, every compactName under a property's redundantProperties must be defined in defaultContext.  
  scope: packages/vocab/src/*.yaml
- **fedify#R104** (other, must; .agents/skills/add-vocab/SKILL.md:209): In vocabulary YAML files, non-functional properties must define pluralName, singularName, uri, description and range.  
  scope: packages/vocab/src/*.yaml properties
- **fedify#R105** (other, must; .agents/skills/add-vocab/SKILL.md:229): In vocabulary YAML files, functional properties must define singularName, functional: true, uri, description and range.  
  scope: packages/vocab/src/*.yaml properties
- **fedify#R106** (other, must; .agents/skills/add-vocab/SKILL.md:243): In vocabulary YAML defaultContext entries, IRI-valued compact terms must declare "@type": "@id".  
  scope: packages/vocab/src/*.yaml
- **fedify#R107** (other, must; .agents/skills/add-vocab/SKILL.md:276): In vocabulary YAML files, a property with untyped: true must have exactly one type in range.  
  scope: packages/vocab/src/*.yaml properties
- **fedify#R108** (other, must; .agents/skills/add-vocab/SKILL.md:337): In @fedify/vocab-runtime, every context URL referenced by a vocabulary YAML defaultContext must have an entry in preloadedContexts in packages/vocab-runtime/src/contexts.ts.  
  scope: packages/vocab-runtime/src/contexts.ts, packages/vocab/src/*.yaml
- **fedify#R109** (other, must; .agents/skills/add-vocab/SKILL.md:351): In packages/vocab-runtime/src/contexts.ts, preloadedContexts keys must exactly match the URL strings used in YAML defaultContext fields.  
  scope: packages/vocab-runtime/src/contexts.ts
- **fedify#R112** (calls, must; packages/init/src/json/oxlint.json:14): In federation code of projects generated by fedify init, the actor returned by the setActorDispatcher() callback must set `id` to ctx.getActorUri(identifier) (or a value built from ctx.getPortableActorUri).  
  scope: fedify init generated projects (packages/init/src/json/oxlint.json), federation setup files
- **fedify#R113** (other, must; packages/init/src/json/oxlint.json:15): In federation code of projects generated by fedify init, the actor object returned by the setActorDispatcher() callback must include an `id` property.  
  scope: fedify init generated projects, federation setup files
- **fedify#R114** (other, should; packages/init/src/json/oxlint.json:16): In federation code of generated projects, when federation.setFollowingDispatcher() is configured, the actor returned by setActorDispatcher() should set the `following` property.  
  scope: fedify init generated projects, federation setup files
- **fedify#R115** (calls, should; packages/init/src/json/oxlint.json:17): In federation code of generated projects, the actor's `following` property should be ctx.getFollowingUri(identifier).  
  scope: fedify init generated projects, federation setup files
- **fedify#R116** (other, should; packages/init/src/json/oxlint.json:18): In federation code of generated projects, when federation.setFollowersDispatcher() is configured, the actor returned by setActorDispatcher() should set the `followers` property.  
  scope: fedify init generated projects, federation setup files
- **fedify#R117** (calls, should; packages/init/src/json/oxlint.json:19): In federation code of generated projects, the actor's `followers` property should be ctx.getFollowersUri(identifier).  
  scope: fedify init generated projects, federation setup files
- **fedify#R118** (other, should; packages/init/src/json/oxlint.json:20): In federation code of generated projects, when federation.setOutboxDispatcher() is configured, the actor returned by setActorDispatcher() should set the `outbox` property.  
  scope: fedify init generated projects, federation setup files
- **fedify#R119** (calls, should; packages/init/src/json/oxlint.json:21): In federation code of generated projects, the actor's `outbox` property should be ctx.getOutboxUri(identifier).  
  scope: fedify init generated projects, federation setup files
- **fedify#R120** (other, should; packages/init/src/json/oxlint.json:22): In federation code of generated projects, when federation.setLikedDispatcher() is configured, the actor returned by setActorDispatcher() should set the `liked` property.  
  scope: fedify init generated projects, federation setup files
- **fedify#R121** (calls, should; packages/init/src/json/oxlint.json:23): In federation code of generated projects, the actor's `liked` property should be ctx.getLikedUri(identifier).  
  scope: fedify init generated projects, federation setup files
- **fedify#R122** (other, should; packages/init/src/json/oxlint.json:24): In federation code of generated projects, when federation.setFeaturedDispatcher() is configured, the actor returned by setActorDispatcher() should set the `featured` property.  
  scope: fedify init generated projects, federation setup files
- **fedify#R123** (calls, should; packages/init/src/json/oxlint.json:25): In federation code of generated projects, the actor's `featured` property should be ctx.getFeaturedUri(identifier).  
  scope: fedify init generated projects, federation setup files
- **fedify#R124** (other, should; packages/init/src/json/oxlint.json:26): In federation code of generated projects, when federation.setFeaturedTagsDispatcher() is configured, the actor returned by setActorDispatcher() should set the `featuredTags` property.  
  scope: fedify init generated projects, federation setup files
- **fedify#R125** (calls, should; packages/init/src/json/oxlint.json:27): In federation code of generated projects, the actor's `featuredTags` property should be ctx.getFeaturedTagsUri(identifier).  
  scope: fedify init generated projects, federation setup files
- **fedify#R126** (other, should; packages/init/src/json/oxlint.json:28): In federation code of generated projects, when federation.setInboxListeners() is configured, the actor returned by setActorDispatcher() should set the `inbox` property.  
  scope: fedify init generated projects, federation setup files
- **fedify#R127** (calls, should; packages/init/src/json/oxlint.json:29): In federation code of generated projects, the actor's `inbox` property should be ctx.getInboxUri(identifier).  
  scope: fedify init generated projects, federation setup files
- **fedify#R128** (other, should; packages/init/src/json/oxlint.json:30): In federation code of generated projects, when federation.setInboxListeners() is configured, the actor returned by setActorDispatcher() should set endpoints.sharedInbox (via new Endpoints({ sharedInbox })).  
  scope: fedify init generated projects, federation setup files
- **fedify#R129** (calls, should; packages/init/src/json/oxlint.json:31): In federation code of generated projects, the actor's endpoints.sharedInbox should be ctx.getInboxUri() called without an identifier.  
  scope: fedify init generated projects, federation setup files
- **fedify#R130** (calls, should; packages/init/src/json/oxlint.json:32): In federation code of generated projects, when setKeyPairsDispatcher() is configured, the actor returned by setActorDispatcher() should set `publicKey` from ctx.getActorKeyPairs(identifier).  
  scope: fedify init generated projects, federation setup files
- **fedify#R131** (calls, should; packages/init/src/json/oxlint.json:33): In federation code of generated projects, when setKeyPairsDispatcher() is configured, the actor returned by setActorDispatcher() should set `assertionMethod` from ctx.getActorKeyPairs(identifier).  
  scope: fedify init generated projects, federation setup files
- **fedify#R132** (argument, should; packages/init/src/json/oxlint.json:34): In federation code of generated projects, the dispatcher callback passed to federation.setFollowersDispatcher() should accept a fourth `filter` parameter to implement server-side filtering.  
  scope: fedify init generated projects, federation setup files
- **fedify#R133** (calls, should; packages/init/src/json/oxlint.json:35): In federation code of generated projects, listeners registered via federation.setOutboxListeners().on(...) should explicitly deliver posted activities with ctx.sendActivity() or ctx.forwardActivity().  
  scope: fedify init generated projects, federation setup files
- **fedify#R134** (other, should; packages/lint/src/index.ts:146): In Fedify federation files (federation.ts, federation/*), when federation.setMediaUploader() is configured, the actor returned by setActorDispatcher() should set endpoints.uploadMedia.  
  scope: federation.{ts,tsx,js,...} and federation/* files linted with @fedify/lint recommended config
- **fedify#R135** (calls, should; packages/lint/src/index.ts:146): In Fedify federation files, the actor's endpoints.uploadMedia should be ctx.getMediaUploaderUri(identifier).  
  scope: federation.ts and federation/* files linted with @fedify/lint recommended config
- **fedify#R136** (other, should; packages/lint/src/index.ts:146): In Fedify federation files, the actor returned by setActorDispatcher() should set preferredUsername (or preferredUsernames).  
  scope: federation.ts and federation/* files linted with @fedify/lint recommended config
- **fedify#R137** (other, should; packages/lint/src/index.ts:146): In Fedify federation files, the actor returned by setActorDispatcher() should set a non-empty `url` (or `urls`) pointing at the human-readable profile page.  
  scope: federation.ts and federation/* files linted with @fedify/lint recommended config
- **fedify#R138** (wrapper, should; packages/lint/src/index.ts:146): In Fedify federation files, federation.setMediaUploader(...) should be directly chained with .authorize(...) unless a public upload endpoint is intended.  
  scope: federation.ts and federation/* files linted with @fedify/lint recommended config
- **fedify#R139** (calls, should; packages/lint/src/index.ts:146): In Fedify federation files, setMediaUploader() callbacks should return ctx.getObjectUri(...) or an object whose id is ctx.getObjectUri(...).  
  scope: federation.ts and federation/* files linted with @fedify/lint recommended config
- **fedify#R140** (error_handling, should; packages/lint/src/index.ts:146): In Fedify outbox listeners, the promise from ctx.sendActivity()/ctx.forwardActivity() should be awaited, returned, or passed to waitUntil() rather than dropped.  
  scope: federation.ts and federation/* files linted with @fedify/lint recommended config
- **fedify#R141** (avoid, should; packages/lint/src/index.ts:146): In Fedify application code, DenoKvStore from @fedify/denokv should not be used (deprecated); use SqliteKvStore, PostgresKvStore, RedisKvStore, MysqlKvStore or WorkersKvStore instead.  
  scope: federation.ts and federation/* files linted with @fedify/lint recommended config
- **fedify#R142** (avoid, should; packages/lint/src/index.ts:146): In Fedify application code, DenoKvMessageQueue from @fedify/denokv should not be used (deprecated); use SqliteMessageQueue, PostgresMessageQueue, RedisMessageQueue, MysqlMessageQueue, AmqpMessageQueue or WorkersMessageQueue instead.  
  scope: federation.ts and federation/* files linted with @fedify/lint recommended config

## Proposals shown to the user

```text
[D-a44f2b] workspace packages define a `build:self` script
    evidence: 37/38 (lower bound 0.86, lift 1.0)
    example:  packages/adonisjs/package.json#@fedify/adonisjs
    outlier:  docs/package.json:1 
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "fedify#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
