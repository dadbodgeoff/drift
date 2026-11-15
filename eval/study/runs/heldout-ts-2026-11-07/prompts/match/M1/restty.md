You are checking whether a tool's proposed conventions for the repository **restty** (https://github.com/wiedymi/restty at `3db45b0e10dbe53c52a77131d366f519546e4f04`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/restty

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/d85998ea-887c-46f2-92d6-cda2fd67f155/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **restty#R01** (file_layout, must; AGENTS.md:52): In all source files, file names must use kebab-case (e.g. pane-app-manager.ts).  
  scope: src/**, tests/**, scripts/** all files
- **restty#R02** (naming, must; AGENTS.md:53): In all TypeScript files, exported types and classes must be named in PascalCase.  
  scope: src/**/*.ts exported types and classes
- **restty#R03** (naming, must; AGENTS.md:53): In all TypeScript files, functions and variables must be named in camelCase.  
  scope: src/**/*.ts functions and variables
- **restty#R08** (testing, must; AGENTS.md:60): In tests, test code must use the bun:test framework (import from "bun:test").  
  scope: tests/**/*.test.ts test files
- **restty#R09** (file_layout, must; AGENTS.md:61): Test files must live in tests/ and be named <feature>.test.ts.  
  scope: tests/** test files
- **restty#R10** (testing, should; AGENTS.md:62): In tests, test names should be behavior-driven, naming the unit and the behavior (e.g. "mapKeyForPty normalizes ...").  
  scope: tests/**/*.test.ts test cases
- **restty#R12** (other, must; .oxlintrc.json:8): In all linted files (src, playground, scripts, tests), all oxlint correctness-category rules (including unicorn and typescript plugins) are errors.  
  scope: src/**, playground/**, scripts/**, tests/** all files
- **restty#R13** (other, must; .oxlintrc.json:9): In all linted files (src, playground, scripts, tests), all oxlint suspicious-category rules (including unicorn and typescript plugins) are errors.  
  scope: src/**, playground/**, scripts/**, tests/** all files
- **restty#R19** (layering, must; docs/development/runtime-surface-refactor-spec.md:80): In src/renderer, src/fonts, src/pty, src/theme, src/wasm, src/selection, src/ime, src/grid, src/unicode and src/utils, code must not import from src/runtime or src/surface.  
  scope: src/{renderer,fonts,pty,theme,wasm,selection,ime,grid,unicode,utils}/** modules
- **restty#R20** (layering, must; docs/development/runtime-surface-refactor-spec.md:827): In src/runtime/**, code must not import any module under src/surface/.  
  scope: src/runtime/** modules
- **restty#R21** (layering, must; docs/development/runtime-surface-refactor-spec.md:84): In src/runtime/**, modules must not re-export anything from src/surface.  
  scope: src/runtime/** modules
- **restty#R22** (layering, must; docs/development/runtime-surface-refactor-spec.md:362): In src/surface/**, code must depend on the ResttyRuntime contract and createResttyRuntime() factory, not import concrete runtime implementation files (e.g. src/runtime/create-runtime/*).  
  scope: src/surface/** modules
- **restty#R23** (typing, must; docs/development/runtime-surface-refactor-spec.md:109): In src/**, renamed high-level option/type names (ResttyOptions, ResttyAppOptions, ResttyPaneAppOptionsInput) must be removed, not kept as type aliases of ResttyConfig, ResttyRuntimeConfig, ResttyTerminalConfig.  
  scope: src/** public types
- **restty#R24** (avoid, should; docs/development/runtime-surface-refactor-spec.md:111): In src/**, internal code should not include compatibility adapters mapping old renamed public config fields to new ones.  
  scope: src/** internal modules
- **restty#R25** (typing, should; docs/development/runtime-surface-refactor-spec.md:224): In src/surface/** and public config types, the public/internal config bridge should not be derived via Omit<ResttyAppOptions, ...> (omission-based config derivation).  
  scope: src/surface/** config types
- **restty#R27** (other, should; docs/development/runtime-surface-refactor-spec.md:384): In the Restty public class, legacy accessors getPanes(), getPaneById(), getActivePane(), getFocusedPane() should be marked deprecated; panes(), pane(id), activePane(), focusedPane() are the preferred accessors.  
  scope: src/surface/restty.ts public pane accessors
- **restty#R28** (other, should; docs/development/runtime-surface-refactor-spec.md:391): In the public Restty/pane API, getRawPane() should be explicitly marked unstable and not presented as stable API.  
  scope: src/surface/** public pane API
- **restty#R29** (typing, should; docs/development/runtime-surface-refactor-spec.md:442): In src/surface, Restty's active-pane convenience methods should implement the ResttyPaneTerminalApi type.  
  scope: src/surface/restty.ts Restty class
- **restty#R30** (typing, should; docs/development/runtime-surface-refactor-spec.md:443): In src/surface, the ResttyPaneHandle type should extend ResttyPaneTerminalApi, adding id, resize, focus and blur.  
  scope: src/surface/** pane handle types
- **restty#R32** (import_restriction, must; docs/development/runtime-surface-refactor-spec.md:457): In src/internal.ts and src/internal/*, the barrel must not wholesale re-export the implementation graph, surface internals used only by the playground, or runtime-only helper modules.  
  scope: src/internal.ts, src/internal/** unstable entrypoints
- **restty#R33** (file_layout, should; docs/development/runtime-surface-refactor-spec.md:623): src/runtime/create-runtime.ts should only compose subsystems and expose the runtime API; implementation helpers should live in subfolders of src/runtime/.  
  scope: src/runtime/create-runtime.ts composition root
- **restty#R34** (typing, should; docs/development/runtime-surface-refactor-spec.md:720): ResttyTerminalConfig should contain only terminal behavior settings; ptyTransport, callbacks, status DOM, session, canvas and IME must belong to services/mount config, not terminal config.  
  scope: src/** ResttyTerminalConfig type
- **restty#R35** (file_layout, should; docs/development/runtime-surface-refactor-spec.md:736): The ResttyRuntime interface should be defined in src/runtime/core and createResttyRuntime() should be the single runtime factory entrypoint.  
  scope: src/runtime/core/** runtime contract
- **restty#R36** (layering, should; docs/development/runtime-surface-refactor-spec.md:773): In src/runtime core, code should not own status panels, shell overlays or other optional DOM; mount is limited to canvas and IME input.  
  scope: src/runtime/** core
- **restty#R37** (file_layout, should; docs/development/runtime-surface-refactor-spec.md:782): Plugin runtime, types, dispatcher and host files must live under src/surface/plugins/.  
  scope: src/surface/plugins/** plugin subsystem
- **restty#R38** (import_restriction, must; docs/development/runtime-surface-refactor-spec.md:862): In playground/**, code must not import src/internal.ts.  
  scope: playground/** source (excluding public/, dist/)
- **restty#R39** (layering, must; docs/development/runtime-surface-refactor-spec.md:794): In playground/**, code must import restty only through public exports (src/index.ts / "restty"), not from src/surface/** or src/runtime/** modules.  
  scope: playground/** source
- **restty#R40** (avoid, must; docs/development/runtime-surface-refactor-spec.md:793): In playground/**, code must not use raw managed pane internals (e.g. getRawPane / ResttyManagedPane).  
  scope: playground/** source
- **restty#R41** (file_layout, must; docs/development/runtime-surface-refactor-spec.md:863): Generated playground build output must live in playground/dist/ and not be committed; playground/public/ holds only authored static assets.  
  scope: playground/public/**, playground/dist/**
- **restty#R42** (file_layout, must; docs/development/runtime-surface-refactor-spec.md:864): Playground source code must live in playground/app/, MDX docs in playground/content/docs/, and static assets in playground/public/.  
  scope: playground/** files
- **restty#R44** (avoid, must; docs/font-resource-and-pane-lifetime-design.md:132): In merged pane runtime config wrappers, long-lived closures must not capture the whole pane context object; only primitives like paneId.  
  scope: src/surface/** pane runtime config wrappers
- **restty#R45** (wrapper, must; docs/font-resource-and-pane-lifetime-design.md:136): beforeInput and beforeRenderOutput wrapper closures (and the desktop notification wrapper) must reference only paneId from the pane context.  
  scope: src/surface/** pane callback wrappers
- **restty#R46** (avoid, must; docs/font-resource-and-pane-lifetime-design.md:138): Internal pane wrappers must never retain a reference to sourcePane.  
  scope: src/surface/** pane wrappers
- **restty#R47** (other, should; docs/font-resource-and-pane-lifetime-design.md:142): Runtime destroy() should release the font lease and clear font state arrays/maps, configured source arrays and transient promises.  
  scope: src/runtime/** destroy()
- **restty#R48** (avoid, must; docs/development/search.md:264): Search highlighting must use searchColor / searchSelectedColor and must not reuse selectionColor.  
  scope: src/renderer/**, src/runtime/**, src/theme/** search highlight code
- **restty#R49** (avoid, must; docs/development/search.md:318): Search code must never scan the full scrollback history in a single JS task; it must step incrementally.  
  scope: src/runtime/** search stepping
- **restty#R50** (argument, must; docs/development/search.md:319): The restty_search_step WASM export must take a bounded work budget argument and return whether more work remains.  
  scope: wasm/** search ABI, src/wasm/**
- **restty#R51** (other, must; docs/development/search.md:179): Search results exposed from WASM must be a flat row/start_col/end_col/selected format and must not expose internal Ghostty page/search structures.  
  scope: wasm/** search ABI
- **restty#R54** (render, must; docs/internals/decisions.md:6): In src/renderer and src/fonts, glyph rendering must use raster atlases only; no SDF/MSDF rendering path.  
  scope: src/renderer/**, src/fonts/** glyph rendering
- **restty#R55** (render, must; docs/internals/decisions.md:11): In src/renderer, cursor and selection must be drawn as overlays on top of shaped glyphs rather than splitting ligature runs.  
  scope: src/renderer/** cursor/selection drawing
- **restty#R57** (render, should; docs/internals/fonts.md:39): In src/fonts and src/runtime atlas code, each font should have its own glyph atlas.  
  scope: src/fonts/**, src/runtime/** atlas builders
- **restty#R58** (render, should; docs/goals.md:9): In src/renderer, backend selection should try WebGPU first and fall back to WebGL2.  
  scope: src/renderer/** backend selection

## Proposals shown to the user

(none)

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "restty#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
