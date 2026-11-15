You are checking whether a tool's proposed conventions for the repository **zyfun** (https://github.com/Hiram-Wong/zyfun at `ffba0e2c8b72a9d40e7484fb3053dc4922934950`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/zyfun

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/8d48ac2f-03ba-4e8d-a97c-79a60c8f3078/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **zyfun#R04** (calls, must; AGENTS.md:14 (identical in CLAUDE.md:14)): In main-process code (src/main/**), logging must go through loggerService with the correct context (loggerService.withContext(...)); renderer-process code may use console.log.  
  scope: src/main/** main-process code
- **zyfun#R05** (calls, must; AGENTS.md:15 (identical in CLAUDE.md:15)): In main-process code (src/main/**), filesystem paths must be obtained via application.getPath('namespace.key', filename?).  
  scope: src/main/** main-process code
- **zyfun#R06** (avoid, must; AGENTS.md:15 (identical in CLAUDE.md:15)): In main-process code (src/main/**), code must not call Electron app.getPath() or os.homedir(), and must not construct filesystem paths ad-hoc.  
  scope: src/main/** main-process code
- **zyfun#R07** (import_restriction, must; AGENTS.md:15 (identical in CLAUDE.md:15)): In main-process code, the application singleton must be imported via `import { application } from '@application'`.  
  scope: src/main/** main-process code
- **zyfun#R09** (file_layout, should; AGENTS.md:48 (identical in CLAUDE.md:48)): In the app, shared type definitions should live in src/renderer/src/types/ and src/shared/ rather than scattered across feature files.  
  scope: src/** type definitions
- **zyfun#R10** (naming, must; AGENTS.md:52 (identical in CLAUDE.md:52)): In src/renderer/**, Vue component files must be named in PascalCase (e.g. PascalCase.tsx / PascalCase.vue).  
  scope: src/renderer/** Vue components
- **zyfun#R11** (naming, must; AGENTS.md:53 (identical in CLAUDE.md:53)): In src/**, service, hook and utility files must be named in camelCase (camelCase.ts).  
  scope: src/** services, hooks, utilities
- **zyfun#R12** (file_layout, must; AGENTS.md:54 (identical in CLAUDE.md:54)): Test files must be named *.test.ts or *.spec.ts and placed alongside the source file or in a __tests__/ subdirectory.  
  scope: **/*.test.ts, **/*.spec.ts test files
- **zyfun#R13** (calls, must; AGENTS.md:59-60 (identical in CLAUDE.md:59-60)): In modules that log, loggerService must be imported from '@logger' and a module logger created via loggerService.withContext('moduleName').  
  scope: src/** modules that log
- **zyfun#R14** (calls, must; AGENTS.md:61 (identical in CLAUDE.md:61)): In renderer-process code (src/renderer/**), loggerService.initWindowSource('windowName') must be called before using the logger.  
  scope: src/renderer/** window entry code
- **zyfun#R15** (avoid, must; AGENTS.md:69 (identical in CLAUDE.md:69)): In all source files, code must not use console.log; logging must use loggerService. (Not lint-enforced: eslint.config.js turns no-console off.)  
  scope: src/** all files
- **zyfun#R16** (calls, should; AGENTS.md:74-77 (identical in CLAUDE.md:74-77)): In main-process code, user and system data paths should be obtained via getUserPath()/getSystemPath() imported from '@main/utils/path'.  
  scope: src/main/** main-process code
- **zyfun#R17** (import_restriction, should; AGENTS.md:80-82 (identical in CLAUDE.md:80-82)): In renderer UI code (src/renderer/**), UI components should be built with the TDesign component library.  
  scope: src/renderer/** components
- **zyfun#R18** (layering, must; AGENTS.md:86 (identical in CLAUDE.md:86)): In src/preload/** and src/renderer/**, Node.js APIs must not be exposed directly to the renderer; preload scripts must expose functionality via contextBridge.  
  scope: src/preload/** preload scripts, src/renderer/**
- **zyfun#R19** (error_handling, must; AGENTS.md:87 (identical in CLAUDE.md:87)): In main-process IPC handlers (ipcMain.handle/on in src/main/**), all IPC inputs must be validated.  
  scope: src/main/** IPC handlers
- **zyfun#R20** (calls, must; AGENTS.md:88 (identical in CLAUDE.md:88)): In all source files, URL sanitization must use the strict-url-sanitise package.  
  scope: src/** code handling URLs
- **zyfun#R21** (other, should; packages/vlc/AGENTS.md:85): In packages/vlc/src/**, the TypeScript layer should expose Promise-based asynchronous APIs over the native calls.  
  scope: packages/vlc/src/** API
- **zyfun#R22** (other, should; packages/vlc/AGENTS.md:90): In packages/vlc/native/src/**, thread-safe global state should be implemented with once_cell::sync::Lazy.  
  scope: packages/vlc/native/src/**/*.rs
- **zyfun#R23** (calls, should; packages/vlc/AGENTS.md:92): In packages/vlc/native/src/**, event callbacks between Rust and JS should be passed via napi ThreadsafeFunction (fired on background threads, not blocking the main thread).  
  scope: packages/vlc/native/src/**/*.rs
- **zyfun#R24** (calls, must; packages/vlc/AGENTS.md:133): In packages/vlc/native/src/**, access to global player state must go through lock_state().  
  scope: packages/vlc/native/src/**/*.rs
- **zyfun#R25** (other, should; packages/vlc/AGENTS.md:138): In packages/vlc/native/src/**, play_media must release the previous player before creating a new one.  
  scope: packages/vlc/native/src/**/*.rs play_media
- **zyfun#R26** (calls, should; packages/vlc/AGENTS.md:139): In packages/vlc/native/src/**, strings passed to libVLC should be handled with CString to avoid memory leaks.  
  scope: packages/vlc/native/src/**/*.rs FFI code
- **zyfun#R27** (typing, should; packages/vlc/AGENTS.md:144): In packages/vlc/native/src/**, event data should be passed to JS via the VlcEventPayload struct.  
  scope: packages/vlc/native/src/**/*.rs event code
- **zyfun#R28** (calls, should; packages/vlc/AGENTS.md:148-149): In packages/vlc/native/src/**, HTTP streams must be opened with libvlc_media_new_location, and local files with libvlc_media_new_path after path normalization.  
  scope: packages/vlc/native/src/**/*.rs media creation
- **zyfun#R29** (file_layout, should; packages/vlc/AGENTS.md:155): In packages/vlc/native/src/**, platform-specific window/rendering code must live under native/src/platform/ (e.g. platform/macos.rs).  
  scope: packages/vlc/native/src/platform/**
- **zyfun#R30** (layering, must; packages/vlc/AGENTS.md:157): In packages/vlc, main-process code must live under src/control/ (exported as ./control) and renderer code under src/renderer/ (exported as ./renderer); consumers import '@zy/vlc/control' in the main process and '@zy/vlc/renderer' in the renderer.  
  scope: packages/vlc/src/** and its consumers
- **zyfun#R31** (file_layout, should; packages/vlc/AGENTS.md:33-40): In packages/vlc/src/renderer/player/, player feature mixins should be one file per feature named <feature>Mix.ts (e.g. playMix.ts, seekMix.ts).  
  scope: packages/vlc/src/renderer/player/*.ts
- **zyfun#R38** (naming, must; eslint.config.js:68-74): In all linted files, unused variables and arguments are errors unless their name starts with `_`.  
  scope: all linted TS files
- **zyfun#R39** (naming, must; eslint.config.js:75-80): In Vue templates, unused variables (e.g. v-for/slot-scope bindings) are errors unless their name starts with `_`.  
  scope: **/*.vue templates
- **zyfun#R47** (other, must; eslint.config.js:95): In all linted files, import statements must be sorted according to eslint-plugin-simple-import-sort.  
  scope: all linted files
- **zyfun#R48** (other, must; eslint.config.js:96): In all linted files, export-from statements must be sorted according to eslint-plugin-simple-import-sort.  
  scope: all linted files
- **zyfun#R51** (naming, must; eslint.config.js:107): In **/*.vue templates, component names must be written in kebab-case (e.g. <my-component>).  
  scope: **/*.vue templates
- **zyfun#R52** (naming, must; eslint.config.js:108): In **/*.vue files, custom event names passed to emit must be kebab-case.  
  scope: **/*.vue components
- **zyfun#R53** (file_layout, must; eslint.config.js:109-114): In **/*.vue SFCs, top-level blocks must be ordered <template>, <script>, <style>.  
  scope: **/*.vue SFCs
- **zyfun#R54** (typing, must; eslint.config.js:115-122): In **/*.vue SFCs, the <script> block must declare lang="ts" or lang="tsx".  
  scope: **/*.vue SFCs
- **zyfun#R60** (other, must; eslint.config.js:129-134): In **/*.vue SFCs, every <style> block must be scoped (<style scoped>); global or module styles are not allowed.  
  scope: **/*.vue style blocks
- **zyfun#R61** (file_layout, must; eslint.config.js:135): In **/*.vue SFCs, there must be no blank lines between top-level blocks.  
  scope: **/*.vue SFCs
- **zyfun#R63** (calls, must; packages/crypto/example/eslint.config.js:21): In packages/crypto/example/**/*.{ts,tsx}, React hooks must follow the Rules of Hooks (only called at top level of components/hooks).  
  scope: packages/crypto/example/**/*.{ts,tsx} React components
- **zyfun#R64** (argument, should; packages/crypto/example/eslint.config.js:22): In packages/crypto/example/**/*.{ts,tsx}, hook dependency arrays should list all used dependencies.  
  scope: packages/crypto/example/**/*.{ts,tsx} React components
- **zyfun#R67** (other, must; .stylelintrc.yml:11): In stylesheets (css/less/vue style blocks), @import must use string notation (@import 'x.css') rather than url().  
  scope: **/*.{css,less,vue,html} styles
- **zyfun#R68** (other, must; .stylelintrc.yml:16-19): In stylesheets, unknown pseudo-classes are errors, except :deep (Vue scoped deep selector) which is allowed.  
  scope: **/*.{css,less,vue,html} styles

## Proposals shown to the user

```text
[D-a4cd95] exported values in src/main/services/FastifyService/schemas/** are named `*Schema`
    evidence: 115/121 (lower bound 0.90, lift 3.9)
    example:  src/main/services/FastifyService/schemas/base.ts#ResponseErrorSchema
    outlier:  src/main/services/FastifyService/schemas/base.ts:35 PageQuery
    outlier:  src/main/services/FastifyService/schemas/base.ts:19 ResponseCode
    outlier:  src/main/services/FastifyService/schemas/v1/flim/cms.ts:121 getInitchema
    outlier:  src/main/services/FastifyService/schemas/v1/flim/site.ts:25 SiteResponse
    outlier:  src/main/services/FastifyService/schemas/v1/live/iptv.ts:23 IptvResponse
    outlier:  src/main/services/FastifyService/schemas/v1/parse/analyze.ts:23 AnalyzeResponse
```

```text
[D-784831] functions in src/renderer/src/api/** pass `method` to apiRequest.request()
    evidence: 94/94 (lower bound 0.96, lift 6.4)
    example:  src/renderer/src/api/data.ts#dataCloudBackup
    exempt:   src/renderer/src/api/system.ts:35 fetchLoggerStream (does not call apiRequest.request())
```

```text
[D-238824] functions in src/shared/modules/** declare their return type
    evidence: 104/112 (lower bound 0.86, lift 1.7)
    example:  src/shared/modules/camelcase.ts#camelCase
    outlier:  src/shared/modules/function.ts:3 runFunction
    outlier:  src/shared/modules/headers.ts:34 UNSAFE_HEADERS_LOWER
    outlier:  src/shared/modules/headers.ts:35 UNSAFE_HEADERS_UPPER
    outlier:  src/shared/modules/request/axios/AxiosCancel.ts:12 getPendingUrl
    outlier:  src/shared/modules/request/sse/SseCancel.ts:10 getPendingUrl
    outlier:  src/shared/modules/request/ws/WsCancel.ts:10 getPendingUrl
    outlier:  src/shared/modules/validate.ts:350 isContainsAlphaNumeric
    outlier:  src/shared/modules/validate.ts:343 isContainsSpecialChar
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "zyfun#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
