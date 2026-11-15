You are checking whether a tool's proposed conventions for the repository **codex-autorunner** (https://github.com/Git-on-my-level/codex-autorunner at `7a2f78db84e1ca9b96a1f02f16b07cf3ce57314c`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-py-2026-11-07-4354fab9/repos/codex-autorunner

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/922ac565-56ad-4af7-9266-38bf0ec09e4a/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **codex-autorunner#R01** (layering, must; AGENTS.md:16): In src/codex_autorunner/**, modules must preserve the engine / adapters / surfaces layering (no reverse imports from engine/core into adapters or surfaces).  
  scope: src/codex_autorunner/** all modules
- **codex-autorunner#R05** (file_layout, must; AGENTS.md:39): In the web UI, frontend source changes must be made in src/codex_autorunner/web_frontend/src/, not by hand-editing the built src/codex_autorunner/web_static/ output.  
  scope: src/codex_autorunner/web_frontend/src/** and web_static/**
- **codex-autorunner#R08** (testing, must; CONTRIBUTING.md:35): In tests/**, tests must use the pytest tmp_path fixture for temp directories and must not write to shared absolute /tmp paths.  
  scope: tests/** test files
- **codex-autorunner#R13** (error_handling, must; docs/car_constitution/30_ENGINEERING_STANDARDS.md:30): In src/codex_autorunner/**, code must not silently fall back on failure; fallbacks must be observable (logged/reported).  
  scope: src/codex_autorunner/** all modules
- **codex-autorunner#R16** (layering, must; src/codex_autorunner/adapters/chat/AGENTS.md:4): In Discord/Telegram surface adapters, code must not implement transcript ordering, queued-turn state, progress semantics, final-delivery policy or delivery retry state; that belongs in adapters/chat/ or core/orchestration/.  
  scope: src/codex_autorunner/adapters/{discord,telegram}/** and surfaces
- **codex-autorunner#R17** (file_layout, must; src/codex_autorunner/adapters/chat/AGENTS.md:5): In chat adapters, command identity and workspace semantics must live in adapters/chat/command_contract.py and command_kernel.py, not in Discord or Telegram transport modules.  
  scope: src/codex_autorunner/adapters/{chat,discord,telegram}/**
- **codex-autorunner#R18** (file_layout, must; src/codex_autorunner/adapters/chat/AGENTS.md:6): In chat adapters, managed-thread coordinator setup, durable final-delivery hooks and queue-progress wiring must live in shared adapters/chat/ modules, not per-surface.  
  scope: src/codex_autorunner/adapters/{chat,discord,telegram}/**
- **codex-autorunner#R19** (layering, should; src/codex_autorunner/adapters/chat/AGENTS.md:7): In adapters/discord/ and adapters/telegram/, modules should contain only transport concerns: ingress payload parsing, platform IDs, message formatting and API delivery calls.  
  scope: src/codex_autorunner/adapters/{discord,telegram}/**
- **codex-autorunner#R20** (other, should; src/codex_autorunner/adapters/chat/AGENTS.md:8): In adapters/chat/, shared helpers should not contain platform-specific (Discord vs Telegram) conditionals.  
  scope: src/codex_autorunner/adapters/chat/**
- **codex-autorunner#R21** (avoid, must; src/codex_autorunner/agents/acp/AGENTS.md:19): In agents/acp/client.py, code must not reintroduce legacy notification-based turn-terminal heuristics.  
  scope: src/codex_autorunner/agents/acp/client.py
- **codex-autorunner#R22** (other, must; src/codex_autorunner/agents/acp/AGENTS.md:26): In agents/acp/, turn completion must not be inferred from progress notifications or assistant text alone; it requires explicit terminal notifications or the session/prompt RPC response.  
  scope: src/codex_autorunner/agents/acp/**
- **codex-autorunner#R23** (other, must; src/codex_autorunner/agents/acp/AGENTS.md:29): In agents/acp/, `session/update` notifications must be treated as progress and must not close a turn.  
  scope: src/codex_autorunner/agents/acp/client.py, events.py
- **codex-autorunner#R24** (error_handling, should; src/codex_autorunner/agents/acp/AGENTS.md:45): In agents/acp/, a null `session/load` response must be treated as a missing-session failure.  
  scope: src/codex_autorunner/agents/acp/client.py, protocol.py
- **codex-autorunner#R25** (other, should; src/codex_autorunner/agents/acp/AGENTS.md:46): In agents/acp/, `session/load` object responses lacking a session identifier should be accepted when the caller already knows the session_id.  
  scope: src/codex_autorunner/agents/acp/client.py, protocol.py
- **codex-autorunner#R26** (other, must; src/codex_autorunner/agents/acp/AGENTS.md:49): In agents/acp/, parsing of official `session/load` success payloads must not require a `sessionId` field.  
  scope: src/codex_autorunner/agents/acp/protocol.py, client.py
- **codex-autorunner#R27** (other, must; src/codex_autorunner/agents/acp/AGENTS.md:57): In agents/acp/, session/update, session/request_permission and terminal lifecycle events lacking `turnId` must be rebound to the active local turn.  
  scope: src/codex_autorunner/agents/acp/client.py, events.py
- **codex-autorunner#R28** (other, must; src/codex_autorunner/agents/acp/AGENTS.md:60): In agents/acp/, busy `session.status` notifications must not be treated as turn-terminal.  
  scope: src/codex_autorunner/agents/acp/client.py, events.py
- **codex-autorunner#R29** (other, must; src/codex_autorunner/agents/acp/AGENTS.md:62): In agents/acp/, the set of events rebound to the active turn when `turnId` is missing must not be broadened without protocol need and tests.  
  scope: src/codex_autorunner/agents/acp/client.py
- **codex-autorunner#R30** (file_layout, should; src/codex_autorunner/agents/acp/AGENTS.md:67): In agents/acp/, transport and request tracking belong in client.py, notification normalization in events.py, payload coercion/parsing in protocol.py, client lifecycle in supervisor.py and ACP errors in errors.py.  
  scope: src/codex_autorunner/agents/acp/*.py
- **codex-autorunner#R33** (file_layout, should; src/codex_autorunner/surfaces/web/AGENTS.md:12): In surfaces/web/, FastAPI route handlers must live under surfaces/web/routes/ and should extend an existing route package rather than being added to app.py.  
  scope: src/codex_autorunner/surfaces/web/** route handlers
- **codex-autorunner#R34** (file_layout, should; src/codex_autorunner/surfaces/web/AGENTS.md:13): In surfaces/web/, shared web-specific logic must live in services/, static_assets.py, static_refresh.py or nearby helpers, not in route modules.  
  scope: src/codex_autorunner/surfaces/web/**
- **codex-autorunner#R36** (layering, must; src/codex_autorunner/surfaces/web/AGENTS.md:17): In surfaces/web/, PMA chat routes must expose the backend transcript projection from adapters/chat/ and core/orchestration/ and must not add web-local transcript composition or delivery state machines.  
  scope: src/codex_autorunner/surfaces/web/routes/** PMA chat routes
- **codex-autorunner#R37** (file_layout, should; src/codex_autorunner/surfaces/web/AGENTS.md:18): In the web surface, read-model contracts must live in surfaces/web/read_model_contracts.py, route assembly under surfaces/web/routes/, and projection/rebuild logic in core/ near the canonical data source.  
  scope: src/codex_autorunner/surfaces/web/** read-model routes; src/codex_autorunner/core/**
- **codex-autorunner#R38** (avoid, must; src/codex_autorunner/surfaces/web/AGENTS.md:22): In surfaces/web/routes/, new broad list or polling endpoints must not be added as primary UI data sources; use scoped read models.  
  scope: src/codex_autorunner/surfaces/web/routes/**
- **codex-autorunner#R39** (other, must; src/codex_autorunner/surfaces/web/AGENTS.md:25): In surfaces/web/ streaming routes, every stream event must be typed, ordered within its source, idempotent and repairable from a snapshot route, and cursor gaps must be emitted explicitly.  
  scope: src/codex_autorunner/surfaces/web/** stream/SSE routes
- **codex-autorunner#R41** (other, must; src/codex_autorunner/surfaces/web/AGENTS.md:52): In surfaces/web/app.py, SPA shell routes must be registered from the generated web_static/spa_routes.json manifest, not a hand-maintained route list (only _NEST_TOLERANT_SPA_SEGMENTS and worktrees handlers stay hand-maintained).  
  scope: src/codex_autorunner/surfaces/web/app.py
- **codex-autorunner#R42** (error_handling, must; src/codex_autorunner/surfaces/web/AGENTS.md:64): In surfaces/web/app.py, a missing or unreadable SPA route manifest must not crash app construction; it must log a warning and fall back to broad shell coverage.  
  scope: src/codex_autorunner/surfaces/web/app.py
- **codex-autorunner#R45** (avoid, must; src/codex_autorunner/web_frontend/AGENTS.md:18): In the web frontend PMA chat, code must render the backend transcript projection (/hub/pma/threads/{id}/transcript, /transcript/events) and must not compose /turns, /tail or /timeline into a parallel transcript or own final-delivery state.  
  scope: src/codex_autorunner/web_frontend/src/** PMA chat code
- **codex-autorunner#R46** (calls, should; src/codex_autorunner/web_frontend/AGENTS.md:19): In web frontend screens for chats, repo/worktree, tickets, runs and artifacts, data should be loaded via src/lib/data/readModelClients.ts, readModelStream.ts, readModelStore.ts and readModelViewModels.ts selectors.  
  scope: src/codex_autorunner/web_frontend/src/** screens
- **codex-autorunner#R47** (file_layout, should; src/codex_autorunner/web_frontend/AGENTS.md:23): In the web frontend, testable route-loader helpers must live in src/lib/routes/ (or another non-+page.ts module), not in +page.ts.  
  scope: src/codex_autorunner/web_frontend/src/routes/**/+page.ts
- **codex-autorunner#R48** (other, must; src/codex_autorunner/web_frontend/AGENTS.md:24): In SvelteKit +page.ts / +page.server.ts files, value exports must be limited to load, prerender, csr, ssr, trailingSlash, config, entries or _-prefixed symbols (type-only exports allowed).  
  scope: src/codex_autorunner/web_frontend/src/routes/**/+page.ts, +page.server.ts
- **codex-autorunner#R49** (testing, should; src/codex_autorunner/web_frontend/AGENTS.md:28): In web frontend route load tests, helpers should be imported via src/lib/test/importRouteLoader.ts instead of re-implementing the browser environment mock.  
  scope: src/codex_autorunner/web_frontend/src/**/*.test.ts route load tests
- **codex-autorunner#R50** (avoid, must; src/codex_autorunner/web_frontend/AGENTS.md:31): In web frontend migrated screens, code must not add recurring setInterval / quiet-refresh polling loops; updates come through cursor streams and repair snapshots.  
  scope: src/codex_autorunner/web_frontend/src/** screens
- **codex-autorunner#R51** (calls, must; src/codex_autorunner/web_frontend/AGENTS.md:33): In read-model-backed SvelteKit routes, +page.ts must call an ensureXLoaded({ blocking: false }) loader, store snapshots in readModelEntityStore, and the +page.svelte must select from the store.  
  scope: src/codex_autorunner/web_frontend/src/routes/**/+page.ts and +page.svelte
- **codex-autorunner#R52** (avoid, must; src/codex_autorunner/web_frontend/AGENTS.md:35): In SvelteKit +page.svelte files, code must not fetch read-model snapshots directly (e.g. readModels.*(), /hub/read-models/ URLs, getServicesReadModel()).  
  scope: src/codex_autorunner/web_frontend/src/routes/**/+page.svelte
- **codex-autorunner#R53** (render, must; src/codex_autorunner/web_frontend/AGENTS.md:39): In Svelte components, unbounded chat, timeline, repo/worktree, ticket, artifact or dispatch lists must be windowed/virtualized and must not be rendered with raw {#each} loops.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte list rendering
- **codex-autorunner#R54** (avoid, must; src/codex_autorunner/web_frontend/AGENTS.md:42): In the web frontend, screens must not use legacy broad client methods; a new screen shape must have a backend projection, typed event/contract, selector and scale test.  
  scope: src/codex_autorunner/web_frontend/src/** screens
- **codex-autorunner#R55** (file_layout, should; tests/AGENTS.md:7): In the web frontend, Svelte Web Hub unit tests should be colocated as src/codex_autorunner/web_frontend/src/**/*.test.ts; FastAPI web route tests go in tests/surfaces/web/.  
  scope: frontend and web tests
- **codex-autorunner#R56** (layering, must; docs/ARCHITECTURE_BOUNDARIES.md:85): In Engine modules (codex_autorunner.core.flows*, codex_autorunner.core.ports*), code must import only stdlib and external packages, not Control Plane, Adapters or Surfaces modules.  
  scope: src/codex_autorunner/core/flows/**, src/codex_autorunner/core/ports/**
- **codex-autorunner#R57** (layering, must; docs/ARCHITECTURE_BOUNDARIES.md:86): In Control Plane modules (codex_autorunner.core* excluding flows/ports, codex_autorunner.contextspace*, codex_autorunner.tickets*), code must not import codex_autorunner.adapters*, agents*, flows* or surfaces*.  
  scope: src/codex_autorunner/core/**, contextspace/**, tickets/**
- **codex-autorunner#R58** (layering, must; docs/ARCHITECTURE_BOUNDARIES.md:87): In Adapter modules (codex_autorunner.adapters*, codex_autorunner.agents*, codex_autorunner.flows*), code must not import codex_autorunner.surfaces*.  
  scope: src/codex_autorunner/adapters/**, agents/**, flows/**
- **codex-autorunner#R61** (calls, must; docs/ARCHITECTURE_BOUNDARIES.md:97): In surfaces/**, code must not call rotate_corrupt_flow_db; it must use flows.controller_provider.recover_flow_store instead.  
  scope: src/codex_autorunner/surfaces/**
- **codex-autorunner#R62** (calls, must; docs/ARCHITECTURE_BOUNDARIES.md:101): In surfaces/web/**, code must not construct FlowController directly; it must resolve one via flows.controller_provider.FlowControllerProvider.  
  scope: src/codex_autorunner/surfaces/web/**
- **codex-autorunner#R66** (file_layout, must; docs/ARCHITECTURE_BOUNDARIES.md:182): In src/codex_autorunner/**, utilities shared across layers must be placed in the lowest layer that needs them (e.g. core/ports/ if Engine needs it).  
  scope: src/codex_autorunner/** shared utilities
- **codex-autorunner#R67** (naming, must; docs/ARCHITECTURE_BOUNDARIES.md:191): In src/codex_autorunner/**, any unavoidable reverse-layer import must live in a *_shim.py module or *_shim/ package whose header contains an `ARCHITECTURE_SHIM:` explanation.  
  scope: src/codex_autorunner/** shim modules
- **codex-autorunner#R71** (calls, must; docs/car_constitution/20_ARCHITECTURE_MAP.md:19): In adapters and surfaces, publish notice classification and duplicate/noop suppression must delegate to core/pma_domain/ (e.g. pma_domain/publish_policy.py) rather than implementing ad hoc checks.  
  scope: src/codex_autorunner/adapters/**, surfaces/**
- **codex-autorunner#R72** (layering, must; docs/car_constitution/20_ARCHITECTURE_MAP.md:22): In core/scm_automation_service.py, code must not import SCM provider adapter modules; provider adapters inject publish executors.  
  scope: src/codex_autorunner/core/scm_automation_service.py
- **codex-autorunner#R74** (other, must; docs/car_constitution/20_ARCHITECTURE_MAP.md:80): In core/flows/worker_reaper.py, code must not transition run state or claim user intent; it only signals stale processes and writes exit evidence (exit_origin: stale_reaper).  
  scope: src/codex_autorunner/core/flows/worker_reaper.py
- **codex-autorunner#R76** (avoid, must; docs/car_constitution/20_ARCHITECTURE_MAP.md:95): In surfaces and chat adapters, recovery notification dedupe keys must not be derived from restart_attempts, last_recovery_action or channel_bindings.last_recovery_fingerprint; they come from the core flow notification ledger.  
  scope: src/codex_autorunner/surfaces/**, adapters/{discord,telegram}/**
- **codex-autorunner#R77** (layering, should; docs/car_constitution/20_ARCHITECTURE_MAP.md:148): In web frontend page components, data should be obtained from src/lib/data/ selectors and components should own only interaction/viewport state.  
  scope: src/codex_autorunner/web_frontend/src/** page components
- **codex-autorunner#R78** (render, must; docs/car_constitution/20_ARCHITECTURE_MAP.md:153): In high-cardinality web screens, routes must return server-side windows and the frontend must virtualize lists.  
  scope: src/codex_autorunner/surfaces/web/routes/**, web_frontend/src/**
- **codex-autorunner#R79** (avoid, must; docs/car_constitution/40_SECURITY_PRIVACY.md:13): In src/codex_autorunner/**, code must not write secrets to logs or durable artifacts.  
  scope: src/codex_autorunner/** logging and artifact code
- **codex-autorunner#R83** (error_handling, must; docs/car_constitution/50_OBSERVABILITY_OPERATIONS.md:27): In src/codex_autorunner/**, code must not swallow exceptions (e.g. bare `except: pass`) or silently fall back without logging.  
  scope: src/codex_autorunner/** all modules
- **codex-autorunner#R84** (avoid, must; docs/car_constitution/50_OBSERVABILITY_OPERATIONS.md:88): In Discord/Telegram adapters, the legacy flows.db status fallback must emit legacy_flows_db_status_fallback log events and must not be used as a new chat visibility source.  
  scope: src/codex_autorunner/adapters/{discord,telegram}/** status watchers
- **codex-autorunner#R85** (layering, must; DESIGN.md:15): In the engine (core/), code must not contain transport/vendor-specific logic (Codex subprocesses, app-server/OpenCode runtime, Telegram); it consumes a protocol-neutral backend interface.  
  scope: src/codex_autorunner/core/**
- **codex-autorunner#R87** (other, must; .commandcode/taste/taste.md:22): In repo views and projections, code must not include or mutate worktree state.  
  scope: src/codex_autorunner/** repo views (backend and frontend)
- **codex-autorunner#R88** (avoid, should; .commandcode/taste/taste.md:23): In src/codex_autorunner/**, abstractions not used by production code should be deleted rather than kept as skeletons.  
  scope: src/codex_autorunner/**
- **codex-autorunner#R89** (avoid, must; .commandcode/taste/taste.md:24): In src/codex_autorunner/**, code must not add backwards-compat shims or legacy fallback paths; old shapes must raise an error or warn.  
  scope: src/codex_autorunner/**
- **codex-autorunner#R92** (calls, must; docs/runtime-services-ownership.md:6): In surfaces and adapters, subprocess-owning resources (OpenCodeSupervisor, WorkspaceAppServerSupervisor/CodexAppServerClient, AgentPool) must be acquired from a shared RuntimeServices instance.  
  scope: src/codex_autorunner/surfaces/**, adapters/**
- **codex-autorunner#R93** (avoid, must; docs/runtime-services-ownership.md:7): In request handlers, code must not construct long-lived subprocess supervisors ad hoc.  
  scope: src/codex_autorunner/surfaces/** request handlers
- **codex-autorunner#R94** (other, must; docs/runtime-services-ownership.md:8): In process-management code, process ownership must not be keyed by surface routing keys (Discord channels, Telegram chats, web tabs, PMA threads, Codex threads, OpenCode sessions, ticket ids).  
  scope: src/codex_autorunner/** process registry/supervisors
- **codex-autorunner#R95** (calls, must; docs/runtime-services-ownership.md:19): In surface startup code, any path that creates RuntimeServices must call `await runtime_services.close()` on shutdown.  
  scope: src/codex_autorunner/surfaces/** startup/shutdown
- **codex-autorunner#R96** (avoid, must; docs/web/security.md:80): In the web surface, code must not expose the raw server.auth_token_env token value to browser JavaScript.  
  scope: src/codex_autorunner/surfaces/web/**
- **codex-autorunner#R97** (avoid, must; docs/web/security.md:133): In the web surface, raw /preview/p/<token>/ capability paths must not be logged or included in structured events.  
  scope: src/codex_autorunner/surfaces/web/** preview handling
- **codex-autorunner#R99** (avoid, must; docs/voice/architecture.md:57): In voice code, raw audio must not be persisted to the filesystem.  
  scope: src/codex_autorunner/** voice code
- **codex-autorunner#R100** (avoid, must; docs/voice/architecture.md:58): In voice code, logs must not contain audio data or request headers; only timings, chunk counts and provider choice.  
  scope: src/codex_autorunner/** voice code
- **codex-autorunner#R101** (avoid, must; docs/architecture/discord-interaction-runtime-v2.md:102): In adapters/discord/service.py, interaction_dispatch.py, car_command_dispatch.py and car_handlers/**, code must not call create_interaction_response(), create_followup_message() or edit_original_interaction_response() directly; only rest.py and the runtime responder may.  
  scope: src/codex_autorunner/adapters/discord/**
- **codex-autorunner#R102** (calls, must; docs/architecture/discord-interaction-runtime-v2.md:115): In Discord business handlers and command modules, defer-state checks and defer/followup transitions must go through adapters/discord/interaction_runtime.py, not low-level _defer_*, _send_followup_* or _interaction_has_initial_response() helpers.  
  scope: src/codex_autorunner/adapters/discord/car_handlers/** and command modules
- **codex-autorunner#R103** (avoid, must; docs/architecture/discord-interaction-runtime-v2.md:128): In adapters/discord/ingress.py, code must only parse payloads, evaluate authz and extract route keys, and must never call the Discord API.  
  scope: src/codex_autorunner/adapters/discord/ingress.py
- **codex-autorunner#R104** (avoid, must; docs/architecture/web-ui-read-model-contracts.md:9): In web UI screen routes, legacy broad-fetch endpoints must not be used as primary data sources.  
  scope: src/codex_autorunner/web_frontend/src/routes/**
- **codex-autorunner#R105** (layering, must; docs/architecture/web-ui-read-model-contracts.md:73): In web read-model routes, screen-shaped payload composition must be done server-side; Svelte page components must not perform graph reconstruction.  
  scope: src/codex_autorunner/surfaces/web/routes/**, web_frontend/src/routes/**
- **codex-autorunner#R106** (other, must; docs/architecture/web-ui-read-model-contracts.md:124): In web frontend read-model clients, cursors must be treated as opaque strings and must not be compared across sources.  
  scope: src/codex_autorunner/web_frontend/src/lib/data/**
- **codex-autorunner#R107** (avoid, must; docs/architecture/web-ui-read-model-contracts.md:229): In web frontend read-model clients, list ordering must not be derived from timestamps; it comes from snapshot windows and reorder/reset events.  
  scope: src/codex_autorunner/web_frontend/src/lib/data/**
- **codex-autorunner#R108** (other, must; docs/architecture/web-ui-read-model-contracts.md:333): In web read-model code, temporary compatibility behavior must carry a code comment (or doc) stating its purpose and removal condition.  
  scope: src/codex_autorunner/surfaces/web/**, web_frontend/src/**
- **codex-autorunner#R109** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:35): In web frontend CSS, transitions/animations must not animate layout-shifting properties (e.g. width, height, margin).  
  scope: src/codex_autorunner/web_frontend/src/**/*.{svelte,css}
- **codex-autorunner#R110** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:67): In web frontend component styles, colors, radii, shadows and spacing must use design tokens from src/app.css (var(--...)) and must not be hardcoded.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte <style>, *.css
- **codex-autorunner#R111** (other, must; src/codex_autorunner/web_frontend/DESIGN.md:74): In web frontend styles, every var(--token) must reference a token declared in :root of src/app.css; new tokens must be added to :root and theme blocks rather than using a fallback.  
  scope: src/codex_autorunner/web_frontend/src/**/*.{svelte,css}
- **codex-autorunner#R112** (other, must; src/codex_autorunner/web_frontend/DESIGN.md:113): In web frontend styles, border-radius must not exceed 16px, and 16px is only for the composer and modals.  
  scope: src/codex_autorunner/web_frontend/src/**/*.{svelte,css}
- **codex-autorunner#R113** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:118): In web frontend styles, card hover shadows must use the --shadow-card-hover token; new shadow values must not be invented.  
  scope: src/codex_autorunner/web_frontend/src/**/*.{svelte,css}
- **codex-autorunner#R114** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:136): In Svelte components, code must not set font-family directly or re-declare a monospace stack; mono text opts in via the class list in app.css using --font-mono.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte <style>
- **codex-autorunner#R115** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:804): In web frontend styles, prose (nav labels, button labels, page titles, message bodies, help text) must not be set in --font-mono; mono is only for ids, paths, branches, code.  
  scope: src/codex_autorunner/web_frontend/src/**/*.{svelte,css}
- **codex-autorunner#R116** (other, must; src/codex_autorunner/web_frontend/DESIGN.md:150): In web frontend styles, font-weight must never exceed 700.  
  scope: src/codex_autorunner/web_frontend/src/**/*.{svelte,css}
- **codex-autorunner#R117** (other, must; src/codex_autorunner/web_frontend/DESIGN.md:153): In web frontend styles, counts, KPIs and timestamps must use font-variant-numeric: tabular-nums.  
  scope: src/codex_autorunner/web_frontend/src/**/*.{svelte,css}
- **codex-autorunner#R118** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:161): In web frontend styles, transition easing must use var(--ease-out) and must not use custom cubic-bezier() values.  
  scope: src/codex_autorunner/web_frontend/src/**/*.{svelte,css}
- **codex-autorunner#R119** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:183): In page styles, the .page-stack max-width cap (--measure-page) must not be removed or overridden (chat .master-detail/.pma-layout excepted).  
  scope: src/codex_autorunner/web_frontend/src/** page components
- **codex-autorunner#R120** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:194): In full-page routes, the page header must use the shared PageHero component, not a hand-rolled .section-heading or <p class="eyebrow">.  
  scope: src/codex_autorunner/web_frontend/src/** page components
- **codex-autorunner#R121** (other, must; src/codex_autorunner/web_frontend/DESIGN.md:204): In page hero headers, styles must not add a background fill or border to the hero.  
  scope: src/codex_autorunner/web_frontend/src/** hero headers
- **codex-autorunner#R122** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:242): In hero KPI stats, zero values must not be tinted with a semantic color.  
  scope: src/codex_autorunner/web_frontend/src/** .hero-stats
- **codex-autorunner#R123** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:260): In card components, the whole card must be the <a> link and must not contain nested anchors or action buttons inside the link.  
  scope: src/codex_autorunner/web_frontend/src/** card components
- **codex-autorunner#R124** (calls, must; src/codex_autorunner/web_frontend/DESIGN.md:281): In avatar rendering, initials and accent colors must come from repoInitials() and repoAccent() in src/lib/viewModels/repoIdentity.ts, not new per-entity colors.  
  scope: src/codex_autorunner/web_frontend/src/** avatars
- **codex-autorunner#R125** (render, should; src/codex_autorunner/web_frontend/DESIGN.md:318): In Svelte components, .count-chip should not be rendered when the count is zero.  
  scope: src/codex_autorunner/web_frontend/src/** count chips
- **codex-autorunner#R126** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:319): In count chips and labels, the noun must be pluralized based on the count (never "1 runs").  
  scope: src/codex_autorunner/web_frontend/src/** count labels
- **codex-autorunner#R127** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:346): In list rows for chats, runs, tickets, drafts and scratch repos, each row must render a short id chip (.chat-id-tag/.id-tag, 6 mono chars of the stable id) in the meta row, not the title.  
  scope: src/codex_autorunner/web_frontend/src/** list rows
- **codex-autorunner#R128** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:379): In UI components, state indicators must not rely on color alone; they must be paired with a text label or icon.  
  scope: src/codex_autorunner/web_frontend/src/** status indicators
- **codex-autorunner#R129** (naming, must; src/codex_autorunner/web_frontend/DESIGN.md:388): In view-model status fields and CSS status modifiers, statuses must use the literal tokens running/waiting/blocked/failed/done/idle, and `active` must not be used as a synonym for `running`.  
  scope: src/codex_autorunner/web_frontend/src/lib/viewModels/**, status CSS
- **codex-autorunner#R130** (other, must; src/codex_autorunner/web_frontend/DESIGN.md:413): In status dot styles, dots must use the 6px .status-dot.status-<status> scale and must not use other sizes.  
  scope: src/codex_autorunner/web_frontend/src/** status dots
- **codex-autorunner#R131** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:424): In progress indicators (.progress-track), the fill must not use --color-accent; it comes from a status-<status> modifier.  
  scope: src/codex_autorunner/web_frontend/src/** progress bars
- **codex-autorunner#R132** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:761): In web frontend styles, --color-accent must not be used for non-action affordances (progress bars, status indicators, live badges).  
  scope: src/codex_autorunner/web_frontend/src/**/*.{svelte,css}
- **codex-autorunner#R133** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:427): In progress indicators, a progress bar must be accompanied by a textual percent or step label.  
  scope: src/codex_autorunner/web_frontend/src/** progress bars
- **codex-autorunner#R134** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:470): In Svelte components, icon buttons (.icon-button, .icon-action) must have an aria-label, and buttons must not have emoji-only content.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte buttons
- **codex-autorunner#R135** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:476): In Svelte components, badges (.status-pill, .count-chip, .id-tag, .kind-chip) must not be clickable; clickable elements must be ghost buttons.  
  scope: src/codex_autorunner/web_frontend/src/** badges
- **codex-autorunner#R136** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:495): In web frontend styles, status pills must not have borders and non-navigating count chips must not have cursor: pointer.  
  scope: src/codex_autorunner/web_frontend/src/** badge styles
- **codex-autorunner#R137** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:497): In Svelte components, distinct actions in a row must have distinct labels, and destructive actions must use the .ghost-button.danger variant.  
  scope: src/codex_autorunner/web_frontend/src/** action buttons
- **codex-autorunner#R138** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:504): In section headers, actions must be rendered as <a class="ghost-button"> inside header.section-header, not as bare `Browse all →` text links.  
  scope: src/codex_autorunner/web_frontend/src/** section headers
- **codex-autorunner#R139** (render, should; src/codex_autorunner/web_frontend/DESIGN.md:538): In settings/preferences forms, the save button should be a disabled .ghost-button at rest that gains a .dirty modifier when the form differs from the saved snapshot, not a permanent primary CTA.  
  scope: src/codex_autorunner/web_frontend/src/** settings forms
- **codex-autorunner#R140** (other, must; src/codex_autorunner/web_frontend/DESIGN.md:562): In the chat transcript styles, the `:not(.can-scroll)` justify-content: flex-end rule must not be removed.  
  scope: src/codex_autorunner/web_frontend/src/** chat transcript
- **codex-autorunner#R141** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:585): In Svelte components, empty, loading and error states must render via .state-panel (with compact-empty/empty-state, loading-state, or error modifiers).  
  scope: src/codex_autorunner/web_frontend/src/** empty/loading/error states
- **codex-autorunner#R142** (error_handling, should; src/codex_autorunner/web_frontend/DESIGN.md:591): In page components, partial failures should be rendered per section via the degradedIssues snippet rather than failing the whole page.  
  scope: src/codex_autorunner/web_frontend/src/** page components
- **codex-autorunner#R143** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:628): In Svelte components, locked values must render as read-only text, not as a disabled <select>.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte
- **codex-autorunner#R144** (other, must; src/codex_autorunner/web_frontend/DESIGN.md:643): In SvelteKit routes, selectable detail views must be addressed by path segments (e.g. /chats/[[chatId]]) rather than query-string parameters.  
  scope: src/codex_autorunner/web_frontend/src/routes/**
- **codex-autorunner#R145** (file_layout, should; src/codex_autorunner/web_frontend/DESIGN.md:650): In SvelteKit routes, master-detail pages should use one +page.svelte with an optional param ([[id]]) reading page.params, and row selection should navigate via goto.  
  scope: src/codex_autorunner/web_frontend/src/routes/** master-detail pages
- **codex-autorunner#R146** (other, must; src/codex_autorunner/web_frontend/DESIGN.md:657): In the web frontend, every new path-based detail view must have a structured route in breadcrumbs.ts, ordered most-specific first.  
  scope: src/codex_autorunner/web_frontend/src/** breadcrumbs.ts
- **codex-autorunner#R147** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:659): In detail views, code must not render a separate "back to list" button when the breadcrumb provides navigation.  
  scope: src/codex_autorunner/web_frontend/src/** detail views
- **codex-autorunner#R148** (argument, should; src/codex_autorunner/web_frontend/DESIGN.md:672): In path-addressable master-detail pages, MasterDetail must be used with showSwitch={false}.  
  scope: src/codex_autorunner/web_frontend/src/** MasterDetail usages
- **codex-autorunner#R149** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:683): In Svelte components, modals must use the .modal-backdrop + .approval-modal shell.  
  scope: src/codex_autorunner/web_frontend/src/** modals
- **codex-autorunner#R150** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:692): In Svelte components, every icon-only button, <nav> and list region must have an aria-label.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte
- **codex-autorunner#R151** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:696): In Svelte components, positive tabindex values must not be used to reorder focus.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte
- **codex-autorunner#R152** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:697): In page components, each page must emit exactly one <h1> (via PageHero or a visible <h1>), section titles as <h2> and subheads as <h3>, without skipped levels or visually-hidden headings.  
  scope: src/codex_autorunner/web_frontend/src/** pages
- **codex-autorunner#R153** (other, must; src/codex_autorunner/web_frontend/DESIGN.md:720): In app.css, use of CSS features newer than the evergreen baseline must carry a comment describing the polyfill or fallback.  
  scope: src/codex_autorunner/web_frontend/src/app.css
- **codex-autorunner#R154** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:726): In Svelte components, new code must use Svelte 5 runes ($state, $derived, $props, $effect) and must not use legacy stores (svelte/store writable/readable).  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte, *.ts
- **codex-autorunner#R155** (typing, must; src/codex_autorunner/web_frontend/DESIGN.md:728): In Svelte components, scripts must be <script lang="ts"> and props must be destructured from $props() with an inline type literal, defaulting optional props with = null / = [].  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte
- **codex-autorunner#R156** (file_layout, should; src/codex_autorunner/web_frontend/DESIGN.md:731): In Svelte components, new visual rules should go in the component's scoped <style> block and only be promoted to app.css when shared by 3 or more components.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte, app.css
- **codex-autorunner#R157** (other, must; src/codex_autorunner/web_frontend/DESIGN.md:733): In Svelte components, parent layout adjustments to child component styles must use :global() in the parent rather than editing the child component.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte
- **codex-autorunner#R158** (naming, must; src/codex_autorunner/web_frontend/DESIGN.md:736): In Svelte components, CSS class names must be kebab-case BEM-ish (e.g. .repo-card-body) and Tailwind/utility classes must not be used.  
  scope: src/codex_autorunner/web_frontend/src/**/*.{svelte,css}
- **codex-autorunner#R159** (layering, must; src/codex_autorunner/web_frontend/DESIGN.md:738): In Svelte components, data must come from view models under src/lib/viewModels/; components must not consume raw API payloads directly.  
  scope: src/codex_autorunner/web_frontend/src/lib/components/**, routes/**
- **codex-autorunner#R160** (other, should; src/codex_autorunner/web_frontend/DESIGN.md:743): In component <style> blocks, media query breakpoints should be 1020px, 760px or 460px only.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte <style>
- **codex-autorunner#R161** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:757): In UI layout, borders must not be stacked three deep (panel + card + inner row); long config pages use the flat .settings-section pattern.  
  scope: src/codex_autorunner/web_frontend/src/** layouts
- **codex-autorunner#R162** (avoid, must; src/codex_autorunner/web_frontend/DESIGN.md:780): In Svelte components, layout CSS must not be copied from app.css or a shared component into a component <style> block; reuse the shared class/component.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte
- **codex-autorunner#R163** (render, must; src/codex_autorunner/web_frontend/DESIGN.md:815): In wrapping meta lines, separators must be drawn with a `> * + *::before` CSS rule rather than standalone `·` elements.  
  scope: src/codex_autorunner/web_frontend/src/** meta rows
- **codex-autorunner#R164** (calls, must; src/codex_autorunner/web_frontend/DESIGN.md:818): In previews and summaries, markdown excerpts must be passed through markdownPreview() from $lib/viewModels/plainText rather than shown raw.  
  scope: src/codex_autorunner/web_frontend/src/** previews
- **codex-autorunner#R165** (other, must; pyproject.toml:116): In all Python files, pycodestyle error rules (ruff E) must pass.  
  scope: src/**, tests/** Python files
- **codex-autorunner#R166** (other, must; pyproject.toml:116): In all Python files, Pyflakes rules (ruff F: unused imports/variables, undefined names) must pass.  
  scope: src/**, tests/** Python files
- **codex-autorunner#R167** (other, must; pyproject.toml:116): In all Python files, pycodestyle warning rules (ruff W) must pass.  
  scope: src/**, tests/** Python files
- **codex-autorunner#R168** (other, must; pyproject.toml:116): In all Python files, imports must be sorted per isort rules (ruff I) with src = ["src"] as first-party.  
  scope: src/**, tests/** Python files
- **codex-autorunner#R169** (avoid, must; pyproject.toml:116): In all Python files, flake8-bugbear rules (ruff B, e.g. mutable defaults, function calls in defaults) must pass.  
  scope: src/**, tests/** Python files
- **codex-autorunner#R174** (typing, must; pyproject.toml:149): In src/codex_autorunner/**, functions must not return Any from functions declared to return a specific type.  
  scope: src/codex_autorunner/** (mypy files)
- **codex-autorunner#R175** (typing, must; pyproject.toml:150): In src/codex_autorunner/**, parameters defaulting to None must be explicitly typed Optional[...] / `X | None`.  
  scope: src/codex_autorunner/** (mypy files)
- **codex-autorunner#R177** (typing, must; pyproject.toml:152): In src/codex_autorunner/**, `# type: ignore` comments must not be unused.  
  scope: src/codex_autorunner/** (mypy files)
- **codex-autorunner#R178** (typing, must; pyproject.toml:153): In src/codex_autorunner/**, bodies of unannotated functions are type-checked and must pass mypy.  
  scope: src/codex_autorunner/** (mypy files)
- **codex-autorunner#R179** (typing, must; pyproject.toml:158): In codex_autorunner.core.* and codex_autorunner.adapters.app_server.*, mypy errors must not be ignored.  
  scope: src/codex_autorunner/core/**, src/codex_autorunner/adapters/app_server/**
- **codex-autorunner#R182** (typing, must; src/codex_autorunner/web_frontend/tsconfig.json:12): In web frontend TypeScript, code must type-check under TypeScript strict mode (no implicit any, strict null checks).  
  scope: src/codex_autorunner/web_frontend/src/**/*.{ts,svelte}
- **codex-autorunner#R183** (typing, must; src/codex_autorunner/web_frontend/tsconfig.json:13): In web frontend TypeScript, type-only imports must use `import type` (verbatimModuleSyntax).  
  scope: src/codex_autorunner/web_frontend/src/**/*.{ts,svelte}
- **codex-autorunner#R184** (file_layout, must; src/codex_autorunner/web_frontend/tsconfig.json:4): In the web frontend, source modules must be TypeScript; JavaScript files are not compiled.  
  scope: src/codex_autorunner/web_frontend/src/**
- **codex-autorunner#R185** (import_restriction, must; src/codex_autorunner/web_frontend/tsconfig.json:7): In web frontend TypeScript, import paths must match file name casing exactly.  
  scope: src/codex_autorunner/web_frontend/src/**
- **codex-autorunner#R186** (layering, must; scripts/check_import_boundaries.py:23): In src/codex_autorunner/core/**, code must not import (statically or via literal importlib.import_module/__import__) codex_autorunner.adapters, codex_autorunner.surfaces, codex_autorunner.cli or codex_autorunner.server.  
  scope: src/codex_autorunner/core/**
- **codex-autorunner#R187** (layering, must; scripts/check_import_boundaries.py:31): In src/codex_autorunner/adapters/**, code must not import (statically or via literal dynamic import) codex_autorunner.surfaces, codex_autorunner.cli or codex_autorunner.server.  
  scope: src/codex_autorunner/adapters/**
- **codex-autorunner#R188** (import_restriction, must; scripts/check_core_imports.py:135): In src/codex_autorunner/core/**, runtime imports from codex_autorunner.adapters.agents must be limited to the agent_backend and run_event modules or interface symbols (AgentBackend, AgentEvent, AgentEventType, RunEvent, Started, OutputDelta, ToolCall, ApprovalRequested, Completed, Failed, get_registered_agents); TYPE_CHECKING imports are exempt.  
  scope: src/codex_autorunner/core/**
- **codex-autorunner#R189** (import_restriction, must; scripts/check_core_imports.py:184): In src/codex_autorunner/core/**, code must not import codex_autorunner.adapters.app_server at runtime (outside TYPE_CHECKING).  
  scope: src/codex_autorunner/core/**
- **codex-autorunner#R190** (import_restriction, must; scripts/check_core_imports.py:188): In src/codex_autorunner/core/**, code must not import codex_autorunner.agents implementations at runtime (outside TYPE_CHECKING).  
  scope: src/codex_autorunner/core/**
- **codex-autorunner#R191** (calls, must; scripts/check_flow_lifecycle_ownership.py:46): In src/codex_autorunner/surfaces/**, code must not call rotate_corrupt_flow_db(); use flows.controller_provider.recover_flow_store(db_path, exc).  
  scope: src/codex_autorunner/surfaces/**
- **codex-autorunner#R192** (calls, must; scripts/check_flow_lifecycle_ownership.py:47): In src/codex_autorunner/surfaces/web/**, code must not call FlowController(...); resolve via flows.controller_provider.FlowControllerProvider (flow_routes.definitions.controller_provider_for(state)).  
  scope: src/codex_autorunner/surfaces/web/**
- **codex-autorunner#R193** (testing, must; scripts/check_test_tmp_usage.py:1): In tests/**, code must not perform write operations (mkdir, write_text, touch, unlink, rename, tempfile dir=) against absolute /tmp paths or pass /tmp to root keyword args (workspace_root, repo_root, run_dir, etc.).  
  scope: tests/**
- **codex-autorunner#R194** (avoid, must; scripts/check_theme_tokens.py:1): In web frontend *.css and *.svelte <style> blocks (outside :root/[data-theme] token blocks and theme-presets.css), color literals (#hex, rgb(), rgba(), hsl(), hsla()) must not be used unless the line is tagged /* theme-allow */.  
  scope: src/codex_autorunner/web_frontend/src/**/*.{css,svelte}
- **codex-autorunner#R195** (argument, should; scripts/check_keyword_contracts.py:30): In src/codex_autorunner/**, calls to codex_autorunner.core.utils.is_within must pass arguments by keyword, not positionally.  
  scope: src/codex_autorunner/**
- **codex-autorunner#R196** (argument, should; scripts/check_keyword_contracts.py:34): In src/codex_autorunner/**, calls to codex_autorunner.core.archive._is_within must pass arguments by keyword, not positionally.  
  scope: src/codex_autorunner/**
- **codex-autorunner#R197** (argument, should; scripts/check_keyword_contracts.py:38): In src/codex_autorunner/**, calls to codex_autorunner.adapters.discord.service._path_within must pass arguments by keyword, not positionally.  
  scope: src/codex_autorunner/**
- **codex-autorunner#R198** (calls, must; scripts/check_injected_context.py:10): In src/codex_autorunner/**, PROMPT_CONTEXT_HINT, WHISPER_TRANSCRIPT_DISCLAIMER and FILES_HINT_TEMPLATE must only be referenced inside calls to capsule/transport renderers (build_*_capsule, render_legacy_injected_context_transport), in their definition, or in `in` comparisons.  
  scope: src/codex_autorunner/**
- **codex-autorunner#R199** (avoid, must; scripts/check_command_resolution.py:14): In src/codex_autorunner/** (except core/utils.py and core/update.py), code must not call shutil.which directly; use codex_autorunner.core.utils.resolve_executable.  
  scope: src/codex_autorunner/**
- **codex-autorunner#R200** (other, must; scripts/check_svelte_warning_baseline.py:2): In web frontend Svelte files, code must not introduce new svelte-check warnings beyond scripts/svelte_warning_baseline.json.  
  scope: src/codex_autorunner/web_frontend/src/**/*.svelte
- **codex-autorunner#R201** (avoid, must; scripts/deadcode.py:1): In src/**, new module-level functions/classes must not be unreferenced (dead code) beyond the .deadcode-baseline.json baseline.  
  scope: src/** Python module-level definitions

## Proposals shown to the user

```text
[D-5a3a51] enums in src/codex_autorunner/core/** extend str
    evidence: 58/61 (lower bound 0.86, lift 21.2)
    example:  src/codex_autorunner/core/apps/hooks.py#AppHookPoint
    outlier:  src/codex_autorunner/core/diagnostics/process_snapshot.py:15 ProcessCategory
    outlier:  src/codex_autorunner/core/diagnostics/process_snapshot.py:22 ProcessOwnership
    outlier:  src/codex_autorunner/core/pma_lifecycle.py:48 LifecycleCommand
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "codex-autorunner#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
