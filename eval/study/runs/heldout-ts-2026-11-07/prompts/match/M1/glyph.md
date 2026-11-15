You are checking whether a tool's proposed conventions for the repository **glyph** (https://github.com/pmndrs/glyph at `4e25a96a57462fef5ad0d19065a822695b480f60`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/glyph

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/fc2251b1-cea8-4425-8a14-5d84ef6750df/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **glyph#R01** (testing, must; AGENTS.md:14): In all tests, code must not use sleeps, timer cushions, retries, or regenerated goldens as correctness mechanisms; tests must be deterministic.  
  scope: **/*.test.* and test lanes (all tests)
- **glyph#R02** (error_handling, must; AGENTS.md:33): In package source, code must validate public caller input, third-party callback results and external data once at the entry boundary, and must not re-validate package-owned output on internal paths.  
  scope: packages/**/src/** runtime validation
- **glyph#R03** (testing, must; AGENTS.md:34): In tests, code must not forge values no production caller can supply in order to justify a runtime guard.  
  scope: packages/**/tests/** negative tests
- **glyph#R05** (typing, should; .agents/docs/engineering/code-style.md:38): In all code, a closed set of alternatives should be modeled with an enum or discriminated union rather than combinations of flags.  
  scope: all TypeScript and Rust source
- **glyph#R07** (avoid, must; .agents/docs/engineering/code-style.md:40): In all code, state must not be recovered by parsing labels, error messages, class names or other display strings; typed semantic state is retained until the presentation edge.  
  scope: all source
- **glyph#R08** (other, should; .agents/docs/engineering/code-style.md:41): In all code, classes should be used only for identity, lifecycle, cleanup, encapsulated mutation or stateful caches; otherwise plain data and functions are preferred.  
  scope: all TypeScript source
- **glyph#R09** (base_class, must; .agents/docs/engineering/code-style.md:41): In all code, class inheritance must not be introduced to model variants.  
  scope: all TypeScript source
- **glyph#R10** (testing, should; .agents/docs/engineering/code-style.md:42): In tests for optimizations, behavior should be preserved with independent invariants and oracles rather than snapshots derived from the implementation being changed.  
  scope: tests
- **glyph#R12** (other, must; .agents/docs/engineering/code-style.md:49): In all code, consumers of generated contracts must reference the single owning artifact instead of copying its bytes or offsets.  
  scope: generated contracts and their consumers
- **glyph#R13** (other, must; .agents/docs/engineering/code-style.md:53): In portable Wasm Rust crates, code must stay no_std + alloc where possible, and host-only tooling must be behind explicit cargo features or binaries.  
  scope: packages/glyph/rust/** portable Wasm crates
- **glyph#R15** (calls, should; .agents/docs/engineering/code-style.md:64): In Rust and TypeScript, code should use maintained font, shaping, raster, Unicode and container libraries rather than project-owned parsers.  
  scope: packages/glyph/** parsing code
- **glyph#R16** (error_handling, must; .agents/docs/engineering/code-style.md:65): In Rust code, operational failure and closed state must use error enums with exhaustive matches, converting enums/newtypes to C or Serde primitives only at the boundary.  
  scope: packages/glyph/rust/**
- **glyph#R17** (typing, should; .agents/docs/engineering/code-style.md:66): In Rust code, primitives from distinct units, identities, generations, ownership domains or coordinate spaces that could be mixed should be wrapped in #[repr(transparent)] newtypes.  
  scope: packages/glyph/rust/**
- **glyph#R18** (avoid, must; .agents/docs/engineering/code-style.md:67): In reusable production Rust paths, code must not use unwrap, expect, panic!, unchecked indexing or truncating casts as error control flow (tests and build scripts excepted).  
  scope: packages/glyph/rust/** production code
- **glyph#R19** (calls, must; .agents/docs/engineering/code-style.md:69): In Rust code, caller-derived growth must use checked arithmetic and try_reserve/try_reserve_exact, and state must be published only after all fallible work succeeds.  
  scope: packages/glyph/rust/**
- **glyph#R20** (other, must; .agents/docs/engineering/code-style.md:70): In Rust code, every unsafe block must be small and have an adjacent SAFETY comment covering ownership, range, lifetime, reentrancy and concurrency.  
  scope: packages/glyph/rust/** unsafe blocks
- **glyph#R21** (other, must; .agents/docs/engineering/code-style.md:71): In Rust/Wasm memory code, allocations must be owned by the module that releases them, with exact pointer/length or handle validation.  
  scope: packages/glyph/rust/** Wasm memory boundary
- **glyph#R22** (file_layout, must; .agents/docs/engineering/code-style.md:75): In the repository, packages must not add package-local formatter configurations; the single root .oxfmtrc.json applies.  
  scope: packages/**, apps/**, benches/** formatter config
- **glyph#R23** (typing, should; .agents/docs/engineering/code-style.md:76): In TypeScript, protocol, lifecycle, result and exclusive option states should be discriminated unions with exhaustive checks.  
  scope: all TypeScript source
- **glyph#R24** (typing, should; .agents/docs/engineering/code-style.md:77): In TypeScript, opaque handles and hashes should use branded primitive types.  
  scope: all TypeScript source
- **glyph#R25** (typing, must; .agents/docs/engineering/code-style.md:78): In TypeScript, untyped boundary data must be typed unknown, and casts such as as Partial<T> or property-presence checks must not be used as validation.  
  scope: all TypeScript source at trust boundaries
- **glyph#R26** (typing, must; .agents/docs/engineering/code-style.md:79): In TypeScript, types must not be erased to unknown/any at package, config, registry or callback boundaries when a runtime witness such as GlyphConfig already ties them; associated types are preserved via generic inference.  
  scope: all TypeScript source
- **glyph#R27** (typing, must; .agents/docs/engineering/code-style.md:83): In TypeScript registries and their consumers, code must not reconstruct type relationships with Any* types, unknown, explicit generic arguments or corrective casts; registration packages every needed operation while the concrete type is known.  
  scope: heterogeneous registries in packages/glyph/src/**
- **glyph#R28** (typing, must; .agents/docs/engineering/code-style.md:90): In TypeScript, a type predicate returning value is T must prove every promised part of T; a classifier that proves nothing useful returns boolean.  
  scope: type guards in all TypeScript source
- **glyph#R29** (typing, should; .agents/docs/engineering/code-style.md:91): In TypeScript, throwing validators should be typed asserts value is T, and validators that copy/default/canonicalize should return a normalized T.  
  scope: validation functions in TypeScript source
- **glyph#R30** (typing, must; .agents/docs/engineering/code-style.md:93): In TypeScript validation of unknown objects, code must first prove non-null non-array object, then each property; use 'in' for presence and Object.hasOwn when inherited properties must not count.  
  scope: validation of unknown values
- **glyph#R31** (naming, must; .agents/docs/engineering/code-style.md:94): In TypeScript, structural predicates must be named for what they prove (isNonArrayObject; isPlainObject only when prototypes are restricted); a generic isRecord helper must not be introduced.  
  scope: type predicates in all TypeScript source
- **glyph#R32** (typing, must; .agents/docs/engineering/code-style.md:95): In TypeScript, a predicate must not promise a richer public or domain type than it validates; define a narrower wire type instead.  
  scope: wire validation in TypeScript
- **glyph#R33** (error_handling, must; .agents/docs/engineering/code-style.md:96): In package code, package-produced Worker/Wasm messages must be trusted without semantic re-validation, while pointer, range, capacity and allocation checks for memory safety must be kept.  
  scope: packages/glyph/src/** Worker and Wasm boundaries
- **glyph#R34** (error_handling, must; .agents/docs/engineering/code-style.md:100): In JSON-facing public APIs, code must bound depth and size and reject cycles and invalid values for programmatic input, documenting whether JSON.stringify coercions apply.  
  scope: JSON-facing public APIs
- **glyph#R35** (avoid, must; .agents/docs/engineering/code-style.md:101): In internal shaping, layout, rendering, serialization and projection paths, code must not add schema walks, canonicality scans, duplicate-ID searches, relationship validation, deep equality or type-recovery branches over package-owned values.  
  scope: packages/glyph/src/** internal paths
- **glyph#R36** (testing, must; .agents/docs/engineering/code-style.md:118): In tests, negative tests must target states a production caller can reach; an internal source file imported only by a test is not a caller boundary.  
  scope: packages/**/tests/**
- **glyph#R38** (layering, must; .agents/docs/engineering/code-style.md:123): In renderer integrations (three, typegpu), code must implement the public GlyphConfig contract and must not get a second private core API.  
  scope: packages/glyph/src/three/**, src/typegpu/** integrations
- **glyph#R39** (avoid, must; .agents/docs/engineering/code-style.md:123): In companion entries such as React, the construction/identity bridge must stay package-private and forwarding modules must not be added merely to satisfy directory-layer lint rules.  
  scope: packages/glyph/src/react/**, companion entries
- **glyph#R40** (error_handling, must; .agents/docs/engineering/code-style.md:124): In resource-acquiring code, cleanup scope must begin before the first acquisition and each allocation, listener, Worker, handle or publication must be released after any later failure.  
  scope: initialization code acquiring resources
- **glyph#R41** (render, should; .agents/docs/engineering/code-style.md:128): In React components, code should use React 19 async primitives and rely on the React Compiler instead of manual memoization.  
  scope: React components (packages/glyph/src/react/**, benches/src/**, apps/r3f-hello-world/**)
- **glyph#R42** (render, must; .agents/docs/engineering/code-style.md:129): In React components, pure values must be derived during render and effects must not mirror props/state, repair event flow or implement derivation.  
  scope: React components
- **glyph#R43** (calls, must; .agents/docs/engineering/code-style.md:130): In React components, non-reactive effect callbacks must use useEffectEvent, and render-time refs must not be used to work around effect dependencies.  
  scope: React components
- **glyph#R44** (render, should; .agents/docs/engineering/code-style.md:131): In React components, semantic values should pass as typed props and labels/visual tone should be derived at the final render site, not passed as preformatted strings.  
  scope: React components
- **glyph#R45** (layering, must; .agents/docs/engineering/code-style.md:132): In the React adapter, core lifecycle and capability state must live in the framework-neutral package, not a parallel component-only model.  
  scope: packages/glyph/src/react/**
- **glyph#R46** (testing, should; .agents/docs/engineering/code-style.md:141): In tests, assertions should come from conformance suites, independent implementations or external invariants rather than implementation-shaped expectations.  
  scope: tests
- **glyph#R47** (testing, must; .agents/docs/engineering/code-style.md:144): In tests, a test must fail on a realistic production behavior change; tests that fail only when their own mock, expectation or copied implementation changes must be deleted.  
  scope: tests
- **glyph#R49** (testing, must; .agents/docs/engineering/code-style.md:149): In tests and live browser/GPU probes, code must not use sleeps, timer cushions, retries or frame counts as correctness; it must wait on causal completion signals and include negative controls.  
  scope: tests and benches/vitexec probes
- **glyph#R50** (other, must; .agents/docs/engineering/code-style.md:155): In generated source (src/generated/**), code must not be hand-edited or hand-styled; changes go through the generator.  
  scope: packages/**/src/**/generated/**
- **glyph#R52** (other, must; .agents/docs/engineering/code-style.md:157): In TypeScript, every public (exported) declaration must have concise TSDoc stating its contract and any non-obvious cost or lifetime behavior.  
  scope: public exports of packages/*/src/**
- **glyph#R55** (other, must; benches/.oxlintrc.json:5): In benches/**, oxlint correctness rules are errors and perf and suspicious rules are warnings (warnings denied in CI via --deny-warnings).  
  scope: benches/**
- **glyph#R57** (render, must; benches/.oxlintrc.json:10): In benches/**, React components must satisfy React Compiler analysis.  
  scope: benches/** React components
- **glyph#R58** (render, must; benches/.oxlintrc.json:11): In benches/**, React hooks must follow the Rules of Hooks.  
  scope: benches/** React components and hooks
- **glyph#R60** (import_restriction, must; benches/.oxlintrc.json:16): In benches/**, code must not import the bare 'three' specifier (use three/webgpu or three/tsl).  
  scope: benches/**
- **glyph#R61** (import_restriction, must; benches/.oxlintrc.json:16): In benches/**, code must not import the bare '@react-three/fiber' entry (use its /webgpu entry).  
  scope: benches/**
- **glyph#R62** (import_restriction, must; benches/.oxlintrc.json:17): In benches/**, code must not deep-import three/src/*.  
  scope: benches/**
- **glyph#R63** (import_restriction, must; benches/.oxlintrc.json:17): In benches/**, code must not import three/addons/*.  
  scope: benches/**
- **glyph#R64** (import_restriction, must; benches/.oxlintrc.json:17): In benches/**, code must not import three/examples/*.  
  scope: benches/**
- **glyph#R65** (render, must; benches/.oxlintrc.json:20): In benches/**, React effects must not be used to compute derived state.  
  scope: benches/** React components
- **glyph#R66** (render, must; benches/.oxlintrc.json:21): In benches/**, React effects must not chain state updates.  
  scope: benches/** React components
- **glyph#R67** (render, must; benches/.oxlintrc.json:22): In benches/**, React effects must not be used as event handlers.  
  scope: benches/** React components
- **glyph#R68** (render, must; benches/.oxlintrc.json:23): In benches/**, React effects must not adjust state when a prop changes.  
  scope: benches/** React components
- **glyph#R69** (render, must; benches/.oxlintrc.json:24): In benches/**, React effects must not reset all state on prop change (use a key instead).  
  scope: benches/** React components
- **glyph#R70** (render, must; benches/.oxlintrc.json:25): In benches/**, React effects must not pass live state up to a parent.  
  scope: benches/** React components
- **glyph#R71** (render, must; benches/.oxlintrc.json:26): In benches/**, React effects must not pass fetched data up to a parent.  
  scope: benches/** React components
- **glyph#R72** (render, must; benches/.oxlintrc.json:27): In benches/**, React effects must not subscribe to external stores (use useSyncExternalStore).  
  scope: benches/** React components
- **glyph#R73** (render, must; benches/.oxlintrc.json:28): In benches/**, React effects must not initialize state.  
  scope: benches/** React components
- **glyph#R74** (other, must; packages/glyph/.oxlintrc.json:5): In packages/glyph/**, oxlint correctness rules are errors and perf and suspicious rules are warnings (denied via --deny-warnings).  
  scope: packages/glyph/**
- **glyph#R76** (render, must; packages/glyph/.oxlintrc.json:22): In packages/glyph/**, React code must satisfy React Compiler analysis.  
  scope: packages/glyph/src/react/**
- **glyph#R77** (render, must; packages/glyph/.oxlintrc.json:23): In packages/glyph/**, React hooks must follow the Rules of Hooks.  
  scope: packages/glyph/** React hooks
- **glyph#R80** (import_restriction, must; packages/glyph/.oxlintrc.json:29): In packages/glyph/**, code must not import the bare 'three' specifier; use three/webgpu or three/tsl.  
  scope: packages/glyph/**
- **glyph#R81** (import_restriction, must; packages/glyph/.oxlintrc.json:29): In packages/glyph/** (outside src/react.ts overrides), code must not import '@react-three/fiber'.  
  scope: packages/glyph/**
- **glyph#R82** (import_restriction, must; packages/glyph/.oxlintrc.json:30): In packages/glyph/**, code must not deep-import typegpu/* subpaths.  
  scope: packages/glyph/**
- **glyph#R83** (import_restriction, must; packages/glyph/.oxlintrc.json:30): In packages/glyph/**, code must not deep-import three/src/*.  
  scope: packages/glyph/**
- **glyph#R84** (import_restriction, must; packages/glyph/.oxlintrc.json:30): In packages/glyph/**, code must not import three/addons/*.  
  scope: packages/glyph/**
- **glyph#R85** (import_restriction, must; packages/glyph/.oxlintrc.json:30): In packages/glyph/**, code must not import three/examples/*.  
  scope: packages/glyph/**
- **glyph#R86** (render, must; packages/glyph/.oxlintrc.json:33): In packages/glyph/**, React effects must not compute derived state.  
  scope: packages/glyph/** React code
- **glyph#R87** (render, must; packages/glyph/.oxlintrc.json:34): In packages/glyph/**, React effects must not chain state updates.  
  scope: packages/glyph/** React code
- **glyph#R88** (render, must; packages/glyph/.oxlintrc.json:35): In packages/glyph/**, React effects must not act as event handlers.  
  scope: packages/glyph/** React code
- **glyph#R89** (render, must; packages/glyph/.oxlintrc.json:36): In packages/glyph/**, React effects must not adjust state on prop change.  
  scope: packages/glyph/** React code
- **glyph#R90** (render, must; packages/glyph/.oxlintrc.json:37): In packages/glyph/**, React effects must not reset all state on prop change.  
  scope: packages/glyph/** React code
- **glyph#R91** (render, must; packages/glyph/.oxlintrc.json:38): In packages/glyph/**, React effects must not pass live state to a parent.  
  scope: packages/glyph/** React code
- **glyph#R92** (render, must; packages/glyph/.oxlintrc.json:39): In packages/glyph/**, React effects must not pass data to a parent.  
  scope: packages/glyph/** React code
- **glyph#R93** (render, must; packages/glyph/.oxlintrc.json:40): In packages/glyph/**, React effects must not subscribe to external stores.  
  scope: packages/glyph/** React code
- **glyph#R94** (render, must; packages/glyph/.oxlintrc.json:41): In packages/glyph/**, React effects must not initialize state.  
  scope: packages/glyph/** React code
- **glyph#R95** (layering, must; packages/glyph/.oxlintrc.json:57): In packages/glyph/src/three/**, code must not import from ../internal/**.  
  scope: packages/glyph/src/three/**
- **glyph#R96** (layering, must; packages/glyph/.oxlintrc.json:58): In packages/glyph/src/three/**, code must not import from ../../internal/**.  
  scope: packages/glyph/src/three/**
- **glyph#R97** (layering, must; packages/glyph/.oxlintrc.json:59): In packages/glyph/src/three/**, code must not import generated modules (**/generated/**).  
  scope: packages/glyph/src/three/**
- **glyph#R98** (layering, must; packages/glyph/.oxlintrc.json:60): In packages/glyph/src/three/**, code must not import from **/core/** modules.  
  scope: packages/glyph/src/three/**
- **glyph#R99** (layering, must; packages/glyph/.oxlintrc.json:78): In packages/glyph/src/three.ts, code must not import generated modules.  
  scope: packages/glyph/src/three.ts
- **glyph#R100** (layering, must; packages/glyph/.oxlintrc.json:79): In packages/glyph/src/three.ts, code must not import from **/core/** modules.  
  scope: packages/glyph/src/three.ts
- **glyph#R101** (import_restriction, must; packages/glyph/.oxlintrc.json:91): In packages/glyph/src/react.ts and tests/types/r3f-renderer-setup.test.tsx, code must not import the bare 'three' specifier (importing @react-three/fiber is permitted there).  
  scope: packages/glyph/src/react.ts, tests/types/r3f-renderer-setup.test.tsx
- **glyph#R102** (layering, must; packages/glyph/.oxlintrc.json:97): In packages/glyph/src/react.ts, code must not import generated modules.  
  scope: packages/glyph/src/react.ts
- **glyph#R103** (layering, must; packages/glyph/.oxlintrc.json:98): In packages/glyph/src/react.ts, code must not import from **/core/** modules.  
  scope: packages/glyph/src/react.ts
- **glyph#R104** (layering, must; packages/glyph/.oxlintrc.json:99): In packages/glyph/src/react.ts, code must not import TSL modules (**/tsl/**).  
  scope: packages/glyph/src/react.ts
- **glyph#R107** (import_restriction, must; packages/glyph/.oxlintrc.json:113): In the Vue adapter files, code must not import 'react'.  
  scope: packages/glyph/src/vue.ts, src/vue/**, vue tests
- **glyph#R108** (import_restriction, must; packages/glyph/.oxlintrc.json:113): In the Vue adapter files, code must not import '@react-three/fiber' or '@react-three/fiber/webgpu'.  
  scope: packages/glyph/src/vue.ts, src/vue/**, vue tests
- **glyph#R109** (layering, must; packages/glyph/.oxlintrc.json:119): In the Vue adapter files, code must not import generated modules.  
  scope: packages/glyph/src/vue.ts, src/vue/**
- **glyph#R110** (layering, must; packages/glyph/.oxlintrc.json:120): In the Vue adapter files, code must not import from **/core/** modules.  
  scope: packages/glyph/src/vue.ts, src/vue/**
- **glyph#R111** (layering, must; packages/glyph/.oxlintrc.json:121): In the Vue adapter files, code must not import TSL modules (**/tsl/**).  
  scope: packages/glyph/src/vue.ts, src/vue/**
- **glyph#R112** (layering, must; packages/glyph/.oxlintrc.json:139): In packages/glyph/src/shaders/tsl/** and src/three/typegpu/internal/**, code must not import from ../internal/**.  
  scope: packages/glyph/src/shaders/tsl/**, src/three/typegpu/internal/**
- **glyph#R113** (layering, must; packages/glyph/.oxlintrc.json:140): In packages/glyph/src/shaders/tsl/** and src/three/typegpu/internal/**, code must not import from ../../internal/**.  
  scope: packages/glyph/src/shaders/tsl/**, src/three/typegpu/internal/**
- **glyph#R114** (layering, must; packages/glyph/.oxlintrc.json:141): In packages/glyph/src/shaders/tsl/** and src/three/typegpu/internal/**, code must not import from ../../../internal/**.  
  scope: packages/glyph/src/shaders/tsl/**, src/three/typegpu/internal/**
- **glyph#R115** (layering, must; packages/glyph/.oxlintrc.json:142): In packages/glyph/src/shaders/tsl/** and src/three/typegpu/internal/**, code must not import from ../../../../internal/**.  
  scope: packages/glyph/src/shaders/tsl/**, src/three/typegpu/internal/**
- **glyph#R116** (layering, must; packages/glyph/.oxlintrc.json:143): In packages/glyph/src/shaders/tsl/** and src/three/typegpu/internal/**, code must not import generated modules.  
  scope: packages/glyph/src/shaders/tsl/**, src/three/typegpu/internal/**
- **glyph#R117** (layering, must; packages/glyph/.oxlintrc.json:161): In packages/glyph/src/shaders/typegpu/**, code must not import any **/internal/** module.  
  scope: packages/glyph/src/shaders/typegpu/**
- **glyph#R118** (layering, must; packages/glyph/.oxlintrc.json:162): In packages/glyph/src/shaders/typegpu/**, code must not import generated modules.  
  scope: packages/glyph/src/shaders/typegpu/**
- **glyph#R119** (import_restriction, must; packages/glyph/.oxlintrc.json:163): In packages/glyph/src/shaders/typegpu/**, code must not import three/tsl.  
  scope: packages/glyph/src/shaders/typegpu/**
- **glyph#R120** (import_restriction, must; packages/glyph/.oxlintrc.json:164): In packages/glyph/src/shaders/typegpu/**, code must not import three/webgpu.  
  scope: packages/glyph/src/shaders/typegpu/**
- **glyph#R121** (layering, must; packages/glyph/.oxlintrc.json:182): In packages/glyph/src/typegpu/** and src/typegpu.ts, code must not import generated modules.  
  scope: packages/glyph/src/typegpu/**, src/typegpu.ts
- **glyph#R122** (import_restriction, must; packages/glyph/.oxlintrc.json:183): In packages/glyph/src/typegpu/** and src/typegpu.ts, code must not import three/tsl.  
  scope: packages/glyph/src/typegpu/**, src/typegpu.ts
- **glyph#R123** (import_restriction, must; packages/glyph/.oxlintrc.json:184): In packages/glyph/src/typegpu/** and src/typegpu.ts, code must not import three/webgpu.  
  scope: packages/glyph/src/typegpu/**, src/typegpu.ts
- **glyph#R124** (layering, must; packages/glyph/.oxlintrc.json:185): In packages/glyph/src/typegpu/** and src/typegpu.ts, code must not import from ../internal/**.  
  scope: packages/glyph/src/typegpu/**, src/typegpu.ts
- **glyph#R125** (layering, must; packages/glyph/.oxlintrc.json:186): In packages/glyph/src/typegpu/** and src/typegpu.ts, code must not import from ../../internal/**.  
  scope: packages/glyph/src/typegpu/**, src/typegpu.ts
- **glyph#R126** (other, must; apps/tres-playground/.oxlintrc.json:3): In apps/tres-playground/**, oxlint correctness rules are errors and perf and suspicious rules are warnings (denied via --deny-warnings).  
  scope: apps/tres-playground/**
- **glyph#R128** (import_restriction, must; apps/tres-playground/.oxlintrc.json:17): In apps/tres-playground/**, code must not import the bare 'three' specifier.  
  scope: apps/tres-playground/**
- **glyph#R129** (import_restriction, must; apps/tres-playground/.oxlintrc.json:18): In apps/tres-playground/**, code must not deep-import three/src/*.  
  scope: apps/tres-playground/**
- **glyph#R130** (import_restriction, must; apps/tres-playground/.oxlintrc.json:18): In apps/tres-playground/**, code must not import three/addons/*.  
  scope: apps/tres-playground/**
- **glyph#R131** (import_restriction, must; apps/tres-playground/.oxlintrc.json:18): In apps/tres-playground/**, code must not import three/examples/*.  
  scope: apps/tres-playground/**
- **glyph#R133** (other, must; apps/r3f-hello-world/.oxlintrc.json:4): In apps/r3f-hello-world/**, oxlint correctness rules are errors and perf and suspicious rules are warnings (denied via --deny-warnings).  
  scope: apps/r3f-hello-world/**
- **glyph#R135** (render, must; apps/r3f-hello-world/.oxlintrc.json:9): In apps/r3f-hello-world/**, React components must satisfy React Compiler analysis.  
  scope: apps/r3f-hello-world/** React components
- **glyph#R136** (render, must; apps/r3f-hello-world/.oxlintrc.json:10): In apps/r3f-hello-world/**, React hooks must follow the Rules of Hooks.  
  scope: apps/r3f-hello-world/** React hooks
- **glyph#R138** (import_restriction, must; apps/r3f-hello-world/.oxlintrc.json:15): In apps/r3f-hello-world/**, code must not import the bare 'three' specifier.  
  scope: apps/r3f-hello-world/**
- **glyph#R139** (import_restriction, must; apps/r3f-hello-world/.oxlintrc.json:15): In apps/r3f-hello-world/**, code must not import the bare '@react-three/fiber' entry.  
  scope: apps/r3f-hello-world/**
- **glyph#R140** (import_restriction, must; apps/r3f-hello-world/.oxlintrc.json:16): In apps/r3f-hello-world/**, code must not deep-import three/src/*.  
  scope: apps/r3f-hello-world/**
- **glyph#R141** (import_restriction, must; apps/r3f-hello-world/.oxlintrc.json:16): In apps/r3f-hello-world/**, code must not import three/addons/*.  
  scope: apps/r3f-hello-world/**
- **glyph#R142** (import_restriction, must; apps/r3f-hello-world/.oxlintrc.json:16): In apps/r3f-hello-world/**, code must not import three/examples/*.  
  scope: apps/r3f-hello-world/**
- **glyph#R145** (error_handling, must; .agents/skills/engine-call-contract/SKILL.md:16): In engine calls, code must return the answer directly and must not return { ok } result unions, nullable results or out-of-band error state.  
  scope: packages/glyph/src/** engine call surface
- **glyph#R146** (error_handling, must; .agents/skills/engine-call-contract/SKILL.md:18): In engine calls, well-typed but meaningless input (e.g. NaN size) must throw synchronously from the call with a message naming the axis, span or offset, not be clamped or silently accepted.  
  scope: packages/glyph/src/** public engine calls
- **glyph#R147** (avoid, must; .agents/skills/engine-call-contract/SKILL.md:22): In engine code, code must not return result values for or proactively scan for package defects a caller cannot cause.  
  scope: packages/glyph/src/**
- **glyph#R148** (error_handling, must; .agents/skills/engine-call-contract/SKILL.md:26): In the engine, a rejected frame must not leave persistent broken state, frame-rate recompilation or a latch a caller must clear.  
  scope: packages/glyph/src/** frame publication
- **glyph#R149** (typing, should; .agents/skills/engine-call-contract/SKILL.md:36): In public API design, shapes that cannot express mistakes (structural txt/span authoring) should be preferred over offset ranges plus runtime checks.  
  scope: packages/glyph public API
- **glyph#R150** (file_layout, must; .agents/skills/engine-call-contract/SKILL.md:49): In @pmndrs/glyph exports, application-encountered values and types must be exported from the root entry, and integrator-only renderer-neutral helpers (e.g. defineGlyphConfig) from /core.  
  scope: packages/glyph/src/index.ts and src/core entry
- **glyph#R151** (file_layout, must; .agents/skills/engine-call-contract/SKILL.md:57): In packages/glyph/package.json exports, internal engine, planner, wire, projection and binding machinery must not be given a public subpath.  
  scope: packages/glyph/package.json exports
- **glyph#R152** (file_layout, must; .agents/skills/engine-call-contract/SKILL.md:69): In the /core entry, code must be static ESM re-exports of focused modules, and /core helpers must not be re-exported from the root entry.  
  scope: packages/glyph/src/core.ts and root index
- **glyph#R153** (file_layout, must; .agents/skills/engine-call-contract/SKILL.md:73): In integration entries (/three, /react, /typegpu), a root name may be re-exported only when that integration's own signatures use it.  
  scope: packages/glyph/src/three.ts, react.ts, typegpu.ts
- **glyph#R154** (layering, must; .agents/skills/engine-call-contract/SKILL.md:77): In renderer-neutral text types, renderer types such as THREE.Material or GPU handles must not appear; renderer-specific types stay behind GlyphConfig schema/resolve/renderer.  
  scope: packages/glyph/src/** renderer-neutral text vocabulary
- **glyph#R155** (other, must; .agents/skills/maintainability-review/references/complexity-and-type-integrity.md:9): In maintained production functions, cyclomatic complexity must be < 22, cognitive complexity < 22 and Halstead difficulty < 80.  
  scope: maintained production functions (excluding generated, vendored, fixtures)
- **glyph#R156** (typing, must; .agents/skills/maintainability-review/references/complexity-and-type-integrity.md:74): In TypeScript, a discriminated union must not be introduced merely to wrap one boolean, and the same state must not be copied into a second controller.  
  scope: all TypeScript source
- **glyph#R157** (other, should; .agents/skills/maintainability-review/references/complexity-and-type-integrity.md:86): In all code, multi-step decisions should return a small discriminated outcome instead of stacked ternaries, and branches must not be moved into anonymous callbacks or some/filter/map chains to lower metrics.  
  scope: all TypeScript source
- **glyph#R158** (avoid, should; .agents/skills/maintainability-review/references/complexity-and-type-integrity.md:101): In the built-in decoder, Rust-plan mapper, buffer patcher and transform synchronizer, code should keep direct indexed loops and borrowed views and must not validate typed data returned by the Rust engine.  
  scope: packages/glyph/src/** hot paths
- **glyph#R159** (typing, must; .agents/skills/maintainability-review/references/complexity-and-type-integrity.md:120): In TypeScript, AnyGlyphConfig or other existentials must not be exposed as the consumer inference surface, and concrete types must not be rebuilt with as unknown as, caller-chosen generics, explicit GlyphConfig<...> tuples or consumer casts.  
  scope: packages/glyph/src/** config typing and consumers
- **glyph#R160** (avoid, must; .agents/skills/maintainability-review/references/complexity-and-type-integrity.md:138): In all code, thin wrappers, one-line adapters or forwarding classes must not be added to lower a complexity score.  
  scope: all source
- **glyph#R161** (avoid, must; .agents/skills/maintainability-review/references/complexity-and-type-integrity.md:140): In TypeScript, code must not copy an optimized Rust table or materialize a second command hierarchy.  
  scope: packages/glyph/src/**
- **glyph#R162** (avoid, must; .agents/skills/maintainability-review/references/complexity-and-type-integrity.md:143): In hot paths, direct loops must not be replaced with generators, iterator allocation or array combinators without measurement.  
  scope: hot-path TypeScript
- **glyph#R163** (avoid, must; .agents/skills/maintainability-review/references/complexity-and-type-integrity.md:144): In maintained code, complexity metrics must not be suppressed without explicit approval and a documented invariant.  
  scope: maintained production functions
- **glyph#R164** (typing, must; .agents/skills/maintainability-review/references/complexity-and-type-integrity.md:146): In TypeScript, type erasure must not be used to make a helper compile; fix the producer signature instead.  
  scope: all TypeScript source
- **glyph#R165** (testing, must; .agents/skills/maintainability-review/references/test-portfolio.md:46): In type-inference test fixtures, the public factory call must infer the value with no explicit return annotation, Any* alias, generic argument or corrective cast, then assert the result.  
  scope: packages/glyph/tests/types/**
- **glyph#R166** (testing, should; .agents/skills/maintainability-review/references/test-portfolio.md:52): In React/R3F tests, assertions should target Glyph behavior and must not test React render counts, effect ordering, hook internals or StrictMode replay for their own sake.  
  scope: packages/glyph/tests/** React tests
- **glyph#R167** (testing, must; .agents/skills/maintainability-review/references/test-portfolio.md:69): In tests, production parsers, mappers, range builders or policy tables must not be copied into test helpers to compute expectations.  
  scope: tests
- **glyph#R168** (testing, should; .agents/skills/maintainability-review/references/test-portfolio.md:77): In tests, closed variants sharing a lifecycle should be covered by one table-driven test with per-variant expectations rather than repeated files.  
  scope: tests
- **glyph#R169** (testing, must; .agents/skills/maintainability-review/references/test-portfolio.md:82): In tests, a test title's claim must be backed by an assertion that fails if that exact contract regresses.  
  scope: tests
- **glyph#R170** (avoid, should; .agents/skills/maintainability-review/references/test-portfolio.md:89): In changed code, debug or entry/exit logging, vague TODOs, syntax-narrating comments and catch blocks that only log and continue should be removed.  
  scope: changed source lines
- **glyph#R172** (typing, must; .agents/skills/maintainability-review/references/test-portfolio.md:119): In canonical integrations (three, example renderer), code must compile without Any* types, unknown, explicit generic repair or corrective casts.  
  scope: packages/glyph/src/three/**, packages/glyph-example-renderer/src/**
- **glyph#R174** (import_restriction, must; .agents/skills/tsl/SKILL.md:60): In TSL code, node graphs must be built from three/tsl and WebGPU renderer/classes imported from three/webgpu.  
  scope: TSL shader code (packages/glyph/src/shaders/tsl/**, three integration)
- **glyph#R175** (calls, must; .agents/skills/tsl/SKILL.md:61): In TSL code, an Fn must be invoked when a node value is required: Fn(() => expression)().  
  scope: TSL shader code
- **glyph#R176** (calls, must; .agents/skills/tsl/SKILL.md:62): In TSL node graphs, arithmetic must use TSL operations (add, mul, method chains) rather than JavaScript operators.  
  scope: TSL shader code
- **glyph#R177** (calls, must; .agents/skills/tsl/SKILL.md:63): In TSL code, nodes must be converted with .toVar() before mutation and mutated with .assign() or compound assignment methods.  
  scope: TSL shader code
- **glyph#R178** (calls, must; .agents/skills/tsl/SKILL.md:64): In TSL code, runtime uniforms must be updated through .value rather than rebuilding the graph.  
  scope: TSL shader code
- **glyph#R179** (calls, must; .agents/skills/tsl/SKILL.md:65): In TSL code, runtime GPU control flow must use If, Loop and other TSL control nodes; JavaScript branches only select graph structure at build time.  
  scope: TSL shader code
- **glyph#R180** (calls, must; .agents/skills/tsl/SKILL.md:66): In WebGPU code, renderer.init() must be awaited before the first render or compute dispatch.  
  scope: WebGPU renderer setup code
- **glyph#R181** (typing, must; .agents/skills/tsl/SKILL.md:74): In TSL code, node values must not be cast to broad Node or unknown merely to silence the compiler.  
  scope: TSL shader code
- **glyph#R182** (other, must; .agents/skills/tsl/SKILL.md:76): In Three/TSL code, render targets, textures, buffers, passes and materials must be disposed by their owner, and renderer state restored around custom passes.  
  scope: Three.js/TSL rendering code
- **glyph#R183** (import_restriction, must; .agents/skills/tsl/typescript.md:32): In project code, Three.js must be imported only from the public three/webgpu and three/tsl barrels, without customConditions or three/src source-path imports.  
  scope: all TypeScript importing three
- **glyph#R184** (import_restriction, must; .agents/skills/tsl/typescript.md:34): In TypeScript, type-only imports must use import type.  
  scope: all TypeScript source
- **glyph#R185** (typing, should; .agents/skills/tsl/typescript.md:46): In TSL TypeScript, bare Node types, any and double casts should be avoided; use typed Node<'float'> etc.  
  scope: TSL shader code
- **glyph#R186** (calls, should; .agents/skills/tsl/typescript.md:56): In TSL code, add/mul should be called directly rather than assigned to narrower custom function types.  
  scope: TSL shader code
- **glyph#R187** (avoid, must; .agents/skills/tsl/typescript.md:77): In TSL graph code, @ts-expect-error must not be scattered; any unavoidable one must carry a local reason.  
  scope: TSL shader code
- **glyph#R188** (calls, should; .agents/skills/tsl/nodes.md:65): In TSL code, select, mix, step or smoothstep should be preferred over If when they express the behavior clearly.  
  scope: TSL shader code
- **glyph#R189** (avoid, must; .agents/skills/tsl/postprocessing.md:39): In TSL post-processing code, a texture node's .value must not be accessed to guess a render-time attachment.  
  scope: TSL post-processing code
- **glyph#R190** (avoid, must; .agents/skills/tsl/compute.md:46): In TSL compute code, parallel CPU and GPU buffers must not be created without an explicit synchronization reason.  
  scope: TSL compute code
- **glyph#R191** (other, must; .agents/skills/typegpu/SKILL.md:442): In TypeGPU 'use gpu' shader functions, variables must always be initialised (e.g. let x = d.f32(0)).  
  scope: TypeGPU shader functions (src/shaders/typegpu/**)
- **glyph#R192** (other, must; .agents/skills/typegpu/SKILL.md:443): In TypeGPU shader functions, runtime ternaries must have side-effect-free scalar/vector branches; use if/else for structs, arrays or matrices.  
  scope: TypeGPU shader functions
- **glyph#R193** (typing, must; .agents/skills/typegpu/SKILL.md:444): In TypeGPU fragment functions, the output must be a 4-component vector (d.vec4f / vec4i / vec4u) regardless of target format.  
  scope: TypeGPU fragment shaders
- **glyph#R194** (calls, must; .agents/skills/codemod/SKILL.md:8): In codemod recipes, TypeScript/TSX transforms must use the pinned ts-morph.  
  scope: .agents/skills/codemod/codemods/**
- **glyph#R195** (calls, must; .agents/skills/codemod/SKILL.md:74): In codemod recipes, symbol renames must use the runner's renameSymbol() helper and must not rename string literals.  
  scope: .agents/skills/codemod/codemods/** transforms
- **glyph#R196** (naming, must; .agents/skills/codemod/SKILL.md:69): In API renames, protocol values, persisted data, fixture identities, generated ABI names and artifact paths must not be renamed because they resemble the API symbol.  
  scope: rename migrations across the repository
- **glyph#R197** (avoid, must; .agents/skills/codemod/SKILL.md:71): In codemod recipes, generated JavaScript, declarations, digests and ABI files must not be edited by the codemod.  
  scope: .agents/skills/codemod/codemods/**
- **glyph#R198** (file_layout, must; .agents/skills/codemod/SKILL.md:80): In the codemod archive, recipes must live under .agents/skills/codemod/codemods/YYYY-MM-DD-slug/ and shared recipes must not be rewritten (add a later corrective recipe).  
  scope: .agents/skills/codemod/codemods/**
- **glyph#R200** (argument, must; .agents/docs/guides/react.md:146): In the React adapter, Text and TextGroup components must not accept handle or root props; both come from the immutable Glyph React context.  
  scope: packages/glyph/src/react/** Text and TextGroup props
- **glyph#R201** (file_layout, must; .agents/docs/guides/react.md:165): In the React and root entries, loadFont, createFontLibrary and FontLibrary must not be exported, and no public font-library subpath may exist.  
  scope: packages/glyph/src/index.ts, src/react.ts, package.json exports
- **glyph#R202** (avoid, must; .agents/docs/guides/react.md:158): In React and Vue adapters, code must not create another byte, decoded-font, shaping or renderer-resource cache beside the FontFace graph.  
  scope: packages/glyph/src/react/**, src/vue/**
- **glyph#R203** (calls, must; .agents/docs/guides/vue.md:96): In Vue consumers, useFont and the format composables must be called inside a TresCanvas subtree; only preloadFont/clearFont may be called at module scope.  
  scope: Vue components using @pmndrs/glyph/vue
- **glyph#R204** (render, should; .agents/docs/guides/vue.md:123): In Vue applications, code should use the Text/TextGroup wrapper components rather than the private Tres catalogue tags.  
  scope: apps/tres-playground/**, Vue consumers
- **glyph#R205** (other, must; .agents/docs/guides/renderer-integration.md:171): In GlyphRenderer.decode implementations, the CommandBufferView, its sequences and patch payloads must not be stored beyond the call; copy scalars instead.  
  scope: renderer integrations implementing GlyphRenderer.decode
- **glyph#R206** (avoid, must; .agents/docs/guides/renderer-integration.md:362): In renderer integrations, resources must not be cached by display names or filenames; use Glyph's resolved resource identities and generations.  
  scope: renderer integrations resolve/cache code
- **glyph#R207** (avoid, should; .agents/docs/guides/renderer-integration.md:283): In schema batch/instance callbacks, code should not rediscover hierarchy; use DisplayList.children order.  
  scope: renderer integration schema callbacks
- **glyph#R208** (layering, must; .agents/docs/guides/technique-implementation-report.md:85): In Glyph core (renderer-neutral) code, shader code must never be imported.  
  scope: packages/glyph/src/** renderer-neutral core
- **glyph#R209** (layering, must; .agents/docs/guides/technique-implementation-report.md:86): In Glyph core code, GPU objects (materials, pipelines) must never be owned; the renderer integration creates and caches them.  
  scope: packages/glyph/src/** renderer-neutral core
- **glyph#R210** (file_layout, must; .agents/docs/guides/technique-implementation-report.md:234): In raster-format packages, TypeGPU, TSL, WGSL or GLSL shader code must live behind explicit shader subpaths, not the main format entry.  
  scope: raster-format packages (e.g. packages/glyph-example-raster/src/**)
- **glyph#R211** (avoid, must; .agents/docs/guides/technique-implementation-report.md:221): In portable raster Codec bodies, code must not choose buffer IDs, interleaving, attributes, storage or bind groups.  
  scope: raster technique codecBody definitions
- **glyph#R212** (layering, must; .agents/docs/planning/example-renderer.md:36): In packages/glyph-example-renderer/src/**, code must import only @pmndrs/glyph, the example raster package and its /typegpu subpath, never Glyph internals, generated readers or Three.  
  scope: packages/glyph-example-renderer/src/**
- **glyph#R213** (import_restriction, must; .agents/docs/planning/example-renderer.md:122): In packages/glyph-example-renderer, integration contracts must be imported from @pmndrs/glyph, never a private file.  
  scope: packages/glyph-example-renderer/src/**
- **glyph#R214** (import_restriction, must; .agents/docs/planning/example-renderer.md:123): In packages/glyph-example-renderer, shader implementations must be imported only from an explicit raster-format shader subpath.  
  scope: packages/glyph-example-renderer/src/**
- **glyph#R215** (import_restriction, must; .agents/docs/planning/example-renderer.md:124): In packages/glyph-example-renderer, code must not import three or @react-three/fiber.  
  scope: packages/glyph-example-renderer/**
- **glyph#R216** (error_handling, must; .agents/docs/planning/example-renderer.md:127): In the example renderer's decode, code must stage changes transactionally and preserve the previous accepted state on failure.  
  scope: packages/glyph-example-renderer/src/** decode
- **glyph#R217** (avoid, must; .agents/docs/planning/example-renderer.md:129): In the example renderer, a missing public capability must fail visibly rather than be worked around with a private import or corrective cast.  
  scope: packages/glyph-example-renderer/src/**
- **glyph#R218** (layering, must; .agents/docs/planning/example-renderer.md:128): In renderer integrations, physical device, canvas, context, render-pass and submission ownership must stay in the host integration, not Glyph.  
  scope: packages/glyph-example-renderer/src/**
- **glyph#R219** (layering, must; .agents/docs/packages/glyph-example-raster.md:58): In packages/glyph-example-raster/src/**, code must import only published @pmndrs/glyph entry points, never core internals or the first-party Three raster/baker subpaths.  
  scope: packages/glyph-example-raster/src/**
- **glyph#R220** (file_layout, must; .agents/docs/packages/glyph-example-raster.md:78): In raster-format packages, registerRasterCodec must run only in a dedicated registration module listed as side-effectful in package.json; the portable definition and shader subpaths must have no registration side effects.  
  scope: packages/glyph-example-raster/src/**, package.json sideEffects
- **glyph#R221** (layering, must; .agents/docs/packages/glyph-example-raster.md:82): In raster shader subpaths (/typegpu, /tsl), code must not register a renderer or own resource/material caches.  
  scope: packages/glyph-example-raster/src/{typegpu,tsl}/**
- **glyph#R222** (layering, must; .agents/docs/packages/glyph.md:269): In packages/glyph/src/shaders/typegpu/slug/core/**, code must not import any renderer.  
  scope: packages/glyph/src/shaders/typegpu/slug/core/**
- **glyph#R223** (layering, must; .agents/docs/packages/glyph.md:260): In the @pmndrs/glyph root entry graph, code must not statically import the baker, Ajv, glTF Validator or baker Wasm; only /bake and /runtime-bake may load them.  
  scope: packages/glyph/src root entry module graph
- **glyph#R224** (layering, must; .agents/docs/packages/glyph.md:266): In the @pmndrs/glyph root entry graph, code must not statically import typegpu.  
  scope: packages/glyph/src root entry module graph
- **glyph#R225** (layering, must; .agents/docs/packages/glyph.md:181): In TypeScript sources, code must not independently shape, lay out or pack paragraphs; that belongs to the Rust/Wasm engine.  
  scope: packages/glyph/src/**
- **glyph#R226** (import_restriction, must; .agents/docs/packages/benchmarks.md:466): In benches/**, only the benchmark font asset module may call Glyph's private loader; other benchmark call sites must use loadBenchmarkFont.  
  scope: benches/src/**
- **glyph#R227** (import_restriction, must; .agents/docs/packages/benchmarks.md:543): In @pmndrs/glyph and raster packages, code must not import koota; Koota is used only at the benchmark application boundary.  
  scope: packages/**
- **glyph#R228** (file_layout, must; .agents/docs/packages/benchmarks.md:543): In benches/**, the Koota world instance must be created in a dedicated module, not in a component module.  
  scope: benches/src/**
- **glyph#R229** (avoid, must; .agents/docs/planning/architecture.md:77): In all packages, code must be ESM-only: no CommonJS build, require() or module.exports, and no require export condition.  
  scope: packages/**
- **glyph#R230** (import_restriction, must; .agents/docs/planning/architecture.md:77): In packages/glyph, the runtime baker, generators, optional raster engines and transcoders must be lazy-loaded only via dynamic import().  
  scope: packages/glyph/src/**
- **glyph#R231** (layering, must; .agents/docs/planning/architecture.md:77): In packages/glyph, Node-only imports (node:*) must be reachable only from the bake host and CLI subpath, never from the browser core graph.  
  scope: packages/glyph/src/**
- **glyph#R232** (layering, must; .agents/docs/planning/architecture.md:270): In packages/glyph, the main module graph must not statically reach the runtime baker library or generator modules.  
  scope: packages/glyph/src/** loading path
- **glyph#R233** (layering, must; .agents/docs/planning/raster-technique-contract.md:87): In packages/glyph, each subpath must consume other subpaths only through their public entries, not their internals.  
  scope: packages/glyph/src/** subpath modules
- **glyph#R234** (layering, must; .agents/docs/planning/raster-technique-contract.md:93): In the @pmndrs/glyph/core subpath, code must not import any renderer or shader language.  
  scope: packages/glyph/src/core/**
- **glyph#R235** (layering, must; .agents/docs/planning/raster-technique-contract.md:94): In raster technique declaration modules, code must not import Three or TSL node graphs.  
  scope: packages/glyph/src/raster/**
- **glyph#R236** (layering, must; .agents/docs/planning/raster-technique-contract.md:97): In baker modules, code must not import rendering code.  
  scope: packages/glyph/src/bakers/**
- **glyph#R237** (layering, must; .agents/docs/planning/raster-technique-contract.md:92): In the @pmndrs/glyph root entry, code must not depend on GPU, shader or plan modules.  
  scope: packages/glyph/src/index.ts root graph
- **glyph#R238** (file_layout, must; .agents/docs/planning/raster-technique-contract.md:162): In packages/glyph, shader realizations and technique schemas must live in separate files.  
  scope: packages/glyph/src/shaders/**, raster technique schemas
- **glyph#R239** (layering, must; .agents/docs/planning/decision-register.md:352): In packages/glyph three, tsl and react surfaces, code must not import from internal/ or generated/ modules.  
  scope: packages/glyph/src/three/**, src/shaders/tsl/**, src/react*
- **glyph#R240** (render, must; .agents/docs/planning/decision-register.md:373): In React components, effects must be used only for external-system synchronization, and effect-only events must use useEffectEvent rather than render-time ref reads.  
  scope: React components (benches, packages/glyph/src/react, apps)
- **glyph#R241** (avoid, must; .agents/docs/planning/core-api.md:109): In applications and renderer integrations, code must not author or consume the engine's numeric IDs.  
  scope: renderer integrations and applications
- **glyph#R242** (avoid, must; .agents/docs/planning/core-api.md:347): In examples, package exports and third-party adapters, the superseded engine construction, binding owner, planning and target types must not appear.  
  scope: packages/glyph exports, apps/**, example packages
- **glyph#R243** (other, must; .agents/docs/planning/three-api.md:401): In Three material factories (create()), code must return synchronously and must not query or update text.  
  scope: Three text material factories
- **glyph#R244** (avoid, must; .agents/docs/planning/three-api.md:374): In code using Text-local glyph measurements, anchorOffset must not be added again; multiply originalMatrix by matrixWorld.  
  scope: consumers of Text.measureGlyphs / Glyphs matrices
- **glyph#R245** (import_restriction, must; .agents/docs/planning/project-brief.md:134): In Glyph core, code must not import uikit, Yoga or Preact Signals.  
  scope: packages/glyph/src/** core
- **glyph#R246** (testing, must; .agents/docs/planning/tooling-fixtures.md:306): In core type tests, code must not import or mention TSL, TypeGPU, shader-node, WebGPU-pipeline or WebGL-material types.  
  scope: packages/glyph/tests/types/** core type tests
- **glyph#R247** (import_restriction, must; .agents/docs/planning/gpucat-integration.md:80): In the @pmndrs/glyph-gpucat fitness package, code must not import @pmndrs/glyph/src/*, workspace-relative source or engine-specific core subpaths.  
  scope: @pmndrs/glyph-gpucat fixture
- **glyph#R248** (naming, must; .agents/docs/planning/decisions/read-glyphs.md:16): In package and consumer code, the synchronous borrowed glyph read must be named readGlyphs; withGlyphs must not be used or aliased.  
  scope: packages/glyph/src/** and consumers
- **glyph#R249** (naming, must; .agents/docs/planning/decisions/text-split.md:19): In package and consumer code, detached text copies must use Text.split(); breakApart must not be used or aliased.  
  scope: packages/glyph/src/** and consumers
- **glyph#R250** (other, must; .agents/docs/planning/decisions/trusted-cluster-aligned-span-handoffs.md:32): In text compilers and framework adapters, package-owned span arrays and records must be frozen before provenance is attached and trusted.  
  scope: packages/glyph/src/internal/graphemes.ts and adapters
- **glyph#R251** (layering, must; .agents/docs/planning/decisions/0001-package-runtime-boundaries.md:34): In @pmndrs/glyph, optional React, baker, runtime-bake and raster capabilities must live behind explicit subpaths or dynamic imports, not the root graph.  
  scope: packages/glyph/src/** and package.json exports
- **glyph#R252** (typing, must; .agents/docs/log/2026-08-06-raster-technique-type-preservation.md:9): In raster technique registries, associated values must be exposed as unknown and narrowed before technique-specific use; public helpers must not degrade failed inference to any (no RasterTechnique<any, ...>).  
  scope: packages/glyph/src/** raster technique types
- **glyph#R253** (naming, must; .agents/docs/log/2026-08-08-distance-field-subpaths-renamed-and-the-line-that-made-it-sa.md:9): In API renames, identifiers are renamed but string literals (artifact kinds, schema enums, fixture filenames, URL vocabulary) must not be changed.  
  scope: rename migrations across the repository

## Proposals shown to the user

```text
[D-4cec41] packages/glyph: functions in src/** do not throw a bare Error
    evidence: 478/497 (lower bound 0.94, lift 5.2)
    example:  packages/glyph/src/bake.ts#defineRasterBaker
    outlier:  packages/glyph/src/font-face.ts:185 createFontFace
    outlier:  packages/glyph/src/internal/node-file-publication.ts:47 publishFilesWithRollback
    outlier:  packages/glyph/src/internal/raster-codec-registry.ts:28 installRasterCodecFontCompiler
    outlier:  packages/glyph/src/internal/raster-codec-registry.ts:35 registerRasterCodecInternal
    outlier:  packages/glyph/src/internal/raster-ktx.ts:47 validateNativeKtx2
    outlier:  packages/glyph/src/internal/text-shaper-module.ts:96 compileDefaultWasm
    outlier:  packages/glyph/src/loaded-font.ts:224 releaseImmutableFontVariant
    outlier:  packages/glyph/src/react.ts:251 GlyphProvider
    outlier:  packages/glyph/src/three/decorations.ts:31 createDecorations
    outlier:  packages/glyph/src/three/decorations.ts:42 decorationDraws
    outlier:  packages/glyph/src/three/glyph-measurement.ts:64 createSuppliedGlyphGeometrySource
    outlier:  packages/glyph/src/three/glyphs.ts:56 createGlyphs
    outlier:  packages/glyph/src/three/glyphs.ts:64 setGlyphDrawOrder
    outlier:  packages/glyph/src/three/internal/draw-realizer.ts:53 prepareDrawReplacement
    outlier:  packages/glyph/src/three/internal/geometry.ts:20 resolveDrawGeometry
    outlier:  packages/glyph/src/three/internal/raster-program-registry.ts:46 commitThreeRasterProgram
    outlier:  packages/glyph/src/typegpu/config.ts:76 defineTypeGpuConfig
    outlier:  packages/glyph/src/typegpu/internal/resources.ts:161 createResource
    outlier:  packages/glyph/src/typegpu/text.ts:78 createText
```

```text
[D-63bbfd] files in packages/glyph/** do not import from benches/scripts/** (declared dependencies, and lazy loads of peer or optional dependencies, excepted)
    evidence: 277/278 (lower bound 0.98, lift 3.0)
    example:  packages/glyph/bin/glyph.js#(file)
    outlier:  packages/glyph/scripts/support/react-browser-check.mts:1 (file)
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "glyph#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
