You are checking whether a tool's proposed conventions for the repository **taos** (https://github.com/jaylfc/taOS at `0c5225f0a07b31fc2f949cad1b8a16b484d8e4c4`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-py-2026-11-07-4354fab9/repos/taos

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/20702951-125e-4d1b-b65d-f1a1ad337309/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **taos#R01** (layering, should; CONTRIBUTING.md:175): In tinyagentos/routes/*.py, route modules should not import from other route modules.  
  scope: tinyagentos/routes/*.py route modules
- **taos#R02** (other, must; CONTRIBUTING.md:176): In tinyagentos/routes/*.py, FastAPI route handlers must be declared with `async def`.  
  scope: tinyagentos/routes/*.py route handlers
- **taos#R03** (avoid, must; CONTRIBUTING.md:176): In tinyagentos/ async route handlers, all I/O must be awaited (no blocking synchronous I/O calls inside async handlers).  
  scope: tinyagentos/** async route handlers
- **taos#R04** (calls, must; CONTRIBUTING.md:177): In tinyagentos/**, code persisting state files must call tinyagentos.atomic_io.atomic_write_text / atomic_write_bytes and must not hand-roll a write-temp-then-rename (tmp.write_text + tmp.replace).  
  scope: tinyagentos/** all files writing state
- **taos#R05** (calls, must; CONTRIBUTING.md:182): In tinyagentos/**, code creating one-time key material must use tinyagentos.atomic_io.atomic_create_bytes, not atomic_write_bytes.  
  scope: tinyagentos/** key-material creation
- **taos#R06** (calls, must; CONTRIBUTING.md:185): In tinyagentos/** async functions, durable atomic_io writes must be run via `await asyncio.to_thread(atomic_write_text, ...)`, not called directly.  
  scope: tinyagentos/** async functions
- **taos#R07** (avoid, must; CONTRIBUTING.md:192): New UI features must be built in the React SPA under desktop/src/ and must not add new server-rendered (Jinja) templates under tinyagentos/templates/.  
  scope: desktop/src/**, tinyagentos/templates/**
- **taos#R08** (render, must; CONTRIBUTING.md:193): In desktop/src/** React components, interactive elements without visible text labels must carry an ARIA label (aria-label/aria-labelledby).  
  scope: desktop/src/** components
- **taos#R09** (file_layout, should; CONTRIBUTING.md:194): In desktop/src/**, API calls should live in dedicated hooks or service files rather than inline in components.  
  scope: desktop/src/** components
- **taos#R10** (testing, must; CONTRIBUTING.md:198): In tests/**, tests must be written with pytest and use the shared fixtures from tests/conftest.py rather than re-creating them.  
  scope: tests/** test files
- **taos#R11** (file_layout, must; CONTRIBUTING.md:199): Test files must mirror the module structure: tests for tinyagentos/<pkg>/<mod>.py live in tests/test_<pkg>_<mod>.py (e.g. tests/test_routes_agents.py).  
  scope: tests/test_*.py
- **taos#R12** (render, must; CONTRIBUTING.md:221): In desktop/src/** surfaces, new or changed UI must auto-refresh its data and animate state changes; static fetch-once screens are not allowed.  
  scope: desktop/src/** UI surfaces
- **taos#R14** (testing, should; CONTRIBUTING.md:259): In tests/**, guard tests should be decorated with @pytest.mark.guards("module:function", replace=[(correct, defective)]) and must not monkeypatch the function they guard.  
  scope: tests/** guard tests
- **taos#R15** (layering, must; CONTRIBUTING.md:373): In tinyagentos/routes/*.py, route modules must access stores via request.app.state and must not import store modules/classes directly.  
  scope: tinyagentos/routes/*.py route modules
- **taos#R16** (other, must; CONTRIBUTING.md:150): In app-catalog/**/manifest.yaml, every field (id, name, type, version, description, homepage, license, requires, install, hardware_tiers) except config_schema must be present.  
  scope: app-catalog/**/manifest.yaml
- **taos#R17** (file_layout, must; CONTRIBUTING.md:109): Catalog apps must live at app-catalog/<category>/<id>/manifest.yaml where the directory name equals the manifest's id.  
  scope: app-catalog/**
- **taos#R18** (other, must; CONTRIBUTING.md:154): Every app manifest under app-catalog/ must have a matching entry (id, type, version, name, description) in app-catalog/catalog.yaml.  
  scope: app-catalog/catalog.yaml
- **taos#R19** (import_restriction, must; pyproject.toml:68): In pyproject.toml and tinyagentos/**, python-slugify must not be installed with the "unidecode" extra and the GPL Unidecode package must not be depended on or imported.  
  scope: pyproject.toml dependencies, tinyagentos/** imports
- **taos#R20** (other, must; docs/contributor-pitfalls.md:9): In tinyagentos/routes/*.py, every new endpoint must have an explicit auth guard (admin session + CSRF, or an entry in the agent-token allowlist in tinyagentos/auth_middleware.py).  
  scope: tinyagentos/routes/*.py route handlers
- **taos#R21** (testing, must; docs/contributor-pitfalls.md:11): In tests/**, every new endpoint must have a negative test asserting an unauthenticated or cross-principal caller receives 401/403.  
  scope: tests/** route tests
- **taos#R22** (error_handling, must; docs/contributor-pitfalls.md:15): In tinyagentos/routes/** project-scoped routes, ownership checks must use `if not user.is_admin and user.user_id != p["user_id"]` and respond with a masked 404, not a bare 403.  
  scope: tinyagentos/routes/** project-scoped route handlers
- **taos#R23** (other, must; docs/contributor-pitfalls.md:20): In tinyagentos/** authenticated-channel message handlers, code must check both that the envelope `from` equals the authenticated peer and that `to` equals the local identity.  
  scope: tinyagentos/** authenticated channel/envelope handlers
- **taos#R25** (calls, must; docs/contributor-pitfalls.md:37): In tinyagentos/**, sensitive values (private keys, tokens) must be stored through SecretsStore and must not be written to config files such as config.yaml.  
  scope: tinyagentos/** all files handling secrets
- **taos#R26** (other, must; docs/contributor-pitfalls.md:40): In tinyagentos/**, tokens that are only verified must be stored hashed; only tokens presented outbound may be stored recoverably.  
  scope: tinyagentos/** token storage
- **taos#R28** (avoid, must; docs/contributor-pitfalls.md:56): In tinyagentos/** and desktop/src/**, code must not index `[0]` into a lookup result that can hold multiple elements (installations, grants, devices); it must select the correct element or handle all.  
  scope: tinyagentos/**, desktop/src/** all files
- **taos#R30** (avoid, must; docs/contributor-pitfalls.md:69): In tinyagentos/**, persisted timestamps must be UTC (e.g. datetime.now(timezone.utc)), not server-local time (naive datetime.now()).  
  scope: tinyagentos/** stores and persistence code
- **taos#R31** (other, should; docs/contributor-pitfalls.md:71): In tinyagentos/**, ISO timestamp input should be normalized (trailing Z to +00:00) before datetime.fromisoformat(), and examples should use +00:00.  
  scope: tinyagentos/** timestamp parsing
- **taos#R32** (error_handling, must; docs/contributor-pitfalls.md:75): In desktop/src/** and tinyagentos/**, catch/except blocks must not be empty or silently swallow fetch/IO failures; errors must be surfaced (toast, inline state, or log).  
  scope: desktop/src/**, tinyagentos/** all files
- **taos#R34** (avoid, must; docs/contributor-pitfalls.md:86): In desktop/src/** and tinyagentos/**, call sites must not pass hardcoded placeholder arguments (e.g. `permissions: []`) in place of the real value.  
  scope: desktop/src/**, tinyagentos/** call sites
- **taos#R35** (calls, must; docs/contributor-pitfalls.md:91): In tinyagentos/**, state files must be written with atomic_write_text / atomic_write_bytes from tinyagentos.atomic_io; any hand-rolled tmp.write_text + tmp.replace must carry a same-line `# atomic-io-exempt: <reason>` comment.  
  scope: tinyagentos/** all files writing state
- **taos#R36** (calls, must; docs/contributor-pitfalls.md:108): In tinyagentos/**, one-time key material files (e.g. .secrets_key, hub/identity.json) must be created with atomic_create_bytes, not atomic_write_bytes.  
  scope: tinyagentos/** key-material creation
- **taos#R37** (calls, must; docs/contributor-pitfalls.md:115): In tinyagentos/** async functions, atomic_io durable writes must be wrapped in `await asyncio.to_thread(...)`.  
  scope: tinyagentos/** async functions
- **taos#R38** (other, must; docs/contributor-pitfalls.md:120): In desktop/src/**, a new view added to a desktop tab registry (e.g. TABS) must also be added to the mobile registry (e.g. mobileTabOrder) and every other registry its siblings appear in.  
  scope: desktop/src/** view registries
- **taos#R39** (other, must; docs/contributor-pitfalls.md:128): In tinyagentos/** BaseStore subclasses, new columns and their indexes must be added via MIGRATIONS and SCHEMA must never index a migration-added column.  
  scope: tinyagentos/**/*_store.py BaseStore subclasses
- **taos#R40** (other, must; docs/contributor-pitfalls.md:134): In tinyagentos/** store migrations, data migrations must be idempotent (existence checks, INSERT OR IGNORE, migrated-from markers).  
  scope: tinyagentos/** store migrations
- **taos#R41** (testing, must; docs/contributor-pitfalls.md:135): In tests/**, each data migration must have a test that runs it twice and asserts the second run changes nothing.  
  scope: tests/** migration tests
- **taos#R42** (other, must; docs/contributor-pitfalls.md:139): In tinyagentos/** stores, adding a column to an already-shipped table must use a guarded `_post_init` (PRAGMA table_info, ALTER TABLE only when the column is absent), not only a MIGRATIONS entry.  
  scope: tinyagentos/**/*_store.py BaseStore subclasses
- **taos#R43** (testing, must; docs/contributor-pitfalls.md:147): In tests/**, a schema/column change to a store must include an upgrade test that first builds the pre-change schema, not only a fresh-DB test.  
  scope: tests/** store tests
- **taos#R44** (other, must; docs/contributor-pitfalls.md:151): In tinyagentos/** stores, a new column must not be added to the CREATE TABLE body in SCHEMA of an existing table; it must be retrofitted in a `_post_init` method defined on the store class (not a module-level function).  
  scope: tinyagentos/**/*_store.py BaseStore subclasses
- **taos#R45** (other, should; docs/contributor-pitfalls.md:163): In tinyagentos/** stores, SCHEMA should be a static string literal defined in the store's own file, not an f-string with runtime values or a constant imported from another module.  
  scope: tinyagentos/**/*_store.py BaseStore subclasses
- **taos#R46** (testing, must; docs/contributor-pitfalls.md:208): In tests/**, invariants (e.g. counts that must not change) must be asserted with equality plus the resulting status, not with tolerance assertions like `abs(a - b) <= n`; tolerances are only for approximate quantities such as timings.  
  scope: tests/** assertions
- **taos#R47** (other, must; docs/contributor-pitfalls.md:218): In desktop/src/** TypeScript/JavaScript, bash or PowerShell snippets stored in template literals must escape shell `${...}` as `\${`, or use plain strings/separate asset files.  
  scope: desktop/src/**/*.{ts,tsx,js}
- **taos#R49** (testing, should; docs/contributor-pitfalls.md:268): In tests/**, each external service contract should have at least one real integration test that feature-detects the service and skips when unreachable.  
  scope: tests/** external-contract tests
- **taos#R50** (testing, must; docs/contributor-pitfalls.md:272): In tests/**, a mock of an external service contract without a real integration test must be marked provisional in a code comment naming the contract source and the date it was verified.  
  scope: tests/** mocks of external services
- **taos#R51** (argument, must; .claude/skills/taos-development-skill/SKILL.md:40): Each tinyagentos/routes/*.py module must expose an APIRouter that is registered in tinyagentos/routes/__init__.py register_all_routers() with dependencies=_csrf.  
  scope: tinyagentos/routes/*.py, tinyagentos/routes/__init__.py
- **taos#R52** (typing, should; .claude/skills/taos-development-skill/SKILL.md:42): In tinyagentos/routes/*.py, route handlers should use Pydantic models for request bodies and responses.  
  scope: tinyagentos/routes/*.py route handlers
- **taos#R53** (layering, must; .claude/skills/taos-development-skill/SKILL.md:44): In tinyagentos/routes/*.py, route modules must not import other route modules.  
  scope: tinyagentos/routes/*.py route modules
- **taos#R54** (layering, must; .claude/skills/taos-development-skill/SKILL.md:43): In tinyagentos/routes/*.py, routes must obtain stores from request.app.state and must not import store modules directly.  
  scope: tinyagentos/routes/*.py route modules
- **taos#R55** (base_class, must; .claude/skills/taos-development-skill/SKILL.md:45): In tinyagentos/**, data stores must subclass BaseStore from tinyagentos/base_store.py, use aiosqlite, and define SCHEMA and MIGRATIONS.  
  scope: tinyagentos/**/*_store.py stores
- **taos#R56** (other, must; .claude/skills/taos-development-skill/SKILL.md:47): In tinyagentos/** BaseStore subclasses, SCHEMA must never reference a column added by MIGRATIONS.  
  scope: tinyagentos/**/*_store.py BaseStore subclasses
- **taos#R57** (calls, must; .claude/skills/taos-development-skill/SKILL.md:48): In tinyagentos/**, AppConfig saves from async code must go through save_config_locked() (async-locked), not an unlocked save.  
  scope: tinyagentos/** config writers
- **taos#R58** (render, should; .claude/skills/taos-development-skill/SKILL.md:50): Edits to tinyagentos/templates/agent_debugger.html should use the existing Pico CSS + htmx style.  
  scope: tinyagentos/templates/agent_debugger.html
- **taos#R59** (avoid, must; .claude/skills/taos-development-skill/SKILL.md:139): In tinyagentos/llm_usage/**, LLM prices must be read from the vendored data/model_prices.json and must never be fetched over the network at runtime.  
  scope: tinyagentos/llm_usage/**
- **taos#R61** (other, must; .claude/skills/taos-development-skill/SKILL.md:144): In tinyagentos/llm_usage/**, an unknown model price must be represented as usd=None, never 0.0.  
  scope: tinyagentos/llm_usage/** price lookup
- **taos#R62** (testing, must; .claude/skills/taos-development-skill/SKILL.md:181): In tests/**, a hand-built httpx AsyncClient carrying a taos_session cookie must pass event_hooks=csrf_event_hooks() from tests/taos_test_csrf.py instead of disabling CSRF.  
  scope: tests/** custom AsyncClient construction
- **taos#R63** (import_restriction, must; .claude/skills/taos-development-skill/SKILL.md:196): In tests/**, test modules must not import helpers via `from conftest import ...`; shared helpers go in their own module (e.g. tests/taos_test_csrf.py).  
  scope: tests/**/*.py
- **taos#R64** (testing, must; .claude/skills/taos-development-skill/SKILL.md:202): In tests/**, tests must not use the @pytest.mark.csrf_bypass marker.  
  scope: tests/**/*.py
- **taos#R65** (testing, must; .claude/skills/taos-development-skill/SKILL.md:212): Pytest markers must be declared only in pyproject.toml [tool.pytest.ini_options] markers; tests/conftest.py must not register markers via an additional pytest_configure hook.  
  scope: tests/conftest.py, pyproject.toml
- **taos#R66** (testing, should; .claude/skills/taos-development-skill/SKILL.md:239): In tests/**, @pytest.mark.skip_if_no_embed_backend should not be applied, and never to tests that do not actually reach an embedding backend (mocked clients, patched setup).  
  scope: tests/**/*.py
- **taos#R67** (testing, should; .claude/skills/taos-development-skill/SKILL.md:251): In tests/**, any stub of verify_csrf must be applied before create_app() is called, not by patching the module attribute afterwards.  
  scope: tests/** CSRF stubs
- **taos#R68** (other, must; .claude/skills/taos-development-skill/SKILL.md:526): New routers must be defined as `router = APIRouter()` in tinyagentos/routes/<feature>.py and included only in register_all_routers() (honoring its ordering comments); tinyagentos/app.py must not call include_router inline.  
  scope: tinyagentos/app.py, tinyagentos/routes/**
- **taos#R69** (testing, should; .claude/skills/taos-development-skill/SKILL.md:529): Tests for a new route module tinyagentos/routes/<feature>.py should live in tests/test_<feature>.py and use the shared async `client` fixture.  
  scope: tests/test_*.py route tests
- **taos#R70** (other, must; .claude/skills/taos-development-skill/SKILL.md:638): Every new BaseStore subclass that declares SCHEMA must be wired into tinyagentos/app.py (attached as app.state.<name> in the lifespan).  
  scope: tinyagentos/** BaseStore subclasses, tinyagentos/app.py
- **taos#R71** (other, must; .claude/skills/taos-development-skill/SKILL.md:534): In tinyagentos/config.py, a new config field must be added to the config dataclass with a default and handled in both to_dict() and from_dict(), with coverage in tests/test_config.py.  
  scope: tinyagentos/config.py
- **taos#R72** (calls, must; .claude/skills/taos-development-skill/SKILL.md:538): In tinyagentos/**, state files must be written via tinyagentos.atomic_io.atomic_write_text/atomic_write_bytes, never tmp.write_text + tmp.replace (exemptions need `# atomic-io-exempt: <reason>`).  
  scope: tinyagentos/** all files writing state
- **taos#R73** (calls, must; .claude/skills/taos-development-skill/SKILL.md:547): In tinyagentos/**, one-time key material must be created with atomic_create_bytes rather than atomic_write_bytes.  
  scope: tinyagentos/** key-material creation
- **taos#R74** (calls, must; .claude/skills/taos-development-skill/SKILL.md:556): In desktop/src/**, mutating requests (POST/PUT/PATCH/DELETE) to /api must use taosFetch from desktop/src/lib/taos-fetch.ts or wrap init with withCsrf() from desktop/src/lib/csrf.ts; raw fetch with a mutating method is forbidden.  
  scope: desktop/src/** API calls
- **taos#R75** (error_handling, must; .claude/skills/taos-development-skill/SKILL.md:569): In tinyagentos/routes/** agent-facing routes, access must be derived from an active (agent, project) grant lookup, not from JWT claims, and a missing grant must return a 404.  
  scope: tinyagentos/routes/** agent-facing route handlers
- **taos#R76** (other, must; .claude/skills/taos-development-skill/SKILL.md:840): Every agent-facing route (especially mutating ones) must have its (method, path) pair added to the agent-token allowlist in tinyagentos/auth_middleware.py.  
  scope: tinyagentos/auth_middleware.py, tinyagentos/routes/** agent-facing routes
- **taos#R77** (other, must; .claude/skills/taos-development-skill/SKILL.md:578): In tinyagentos/adapters/__init__.py, every adapter must declare verification_status as one of tested|beta|experimental|broken, and adapters marked broken must also set tracking_issue.  
  scope: tinyagentos/adapters/__init__.py adapter registry
- **taos#R78** (other, should; .claude/skills/taos-development-skill/SKILL.md:581): In tinyagentos/adapters/**, a new framework adapter should default to verification_status experimental until it passes round-trip verification.  
  scope: tinyagentos/adapters/** new adapters
- **taos#R79** (typing, should; .claude/skills/taos-development-skill/SKILL.md:687): In tinyagentos/**/*.py, modules should start with `from __future__ import annotations` and code must not rely on syntax newer than Python 3.11.  
  scope: tinyagentos/**/*.py
- **taos#R80** (other, must; .claude/skills/taos-development-skill/SKILL.md:807): All Python under tinyagentos/ must byte-compile without syntax errors (python -m compileall tinyagentos/).  
  scope: tinyagentos/**/*.py
- **taos#R81** (avoid, must; .claude/skills/taos-development-skill/SKILL.md:813): In tinyagentos/**, credentials must be stored via the secrets store (tinyagentos/secrets.py, app.state.secrets) and never hardcoded in code or written to config.  
  scope: tinyagentos/** all files
- **taos#R82** (typing, must; .claude/skills/taos-development-skill/SKILL.md:822): Router-wide dependencies such as verify_csrf must type their connection parameter as starlette HTTPConnection, not Request or Request | None, so they work on websocket routes.  
  scope: tinyagentos/** router-wide dependencies (verify_csrf)
- **taos#R83** (other, must; .claude/skills/taos-development-skill/SKILL.md:827): In tinyagentos/routes/**, @router.websocket handlers must perform session authentication inside the handler body (as chat_ws in routes/chat.py does).  
  scope: tinyagentos/routes/** websocket handlers
- **taos#R84** (other, must; .claude/skills/taos-development-skill/SKILL.md:844): _ALLOWED_SCOPES in tinyagentos/routes/agent_registry.py and VALID_SCOPES in tinyagentos/routes/agent_auth_requests.py must contain the same scopes.  
  scope: tinyagentos/routes/agent_registry.py, tinyagentos/routes/agent_auth_requests.py
- **taos#R85** (layering, should; .claude/skills/taos-development-skill/SKILL.md:847): In tinyagentos/** stores, each store owns its own SQLite file and SQL must not query across stores' tables; migrations are defined per store.  
  scope: tinyagentos/**/*_store.py stores
- **taos#R86** (layering, must; .claude/skills/taos-development-skill/soul.md:54): In tinyagentos/routes/*.py, route modules must not import other route modules.  
  scope: tinyagentos/routes/*.py route modules
- **taos#R87** (layering, must; .claude/skills/taos-development-skill/soul.md:55): In tinyagentos/routes/*.py, routes must access stores via request.app.state, not by importing stores.  
  scope: tinyagentos/routes/*.py route modules
- **taos#R88** (avoid, must; .claude/skills/taos-development-skill/soul.md:57): UI work must be implemented in the desktop/ React SPA; no new Jinja templates beyond tinyagentos/templates/agent_debugger.html.  
  scope: desktop/**, tinyagentos/templates/**
- **taos#R89** (render, must; .claude/skills/taos-development-skill/soul.md:59): In desktop/src/** components, markup must use semantic HTML elements and interactive elements without visible text must have ARIA labels.  
  scope: desktop/src/** components
- **taos#R90** (other, must; .claude/skills/taos-development-skill/soul.md:60): In tinyagentos/routes/*.py, route handlers must be `async def` and all I/O must be awaited.  
  scope: tinyagentos/routes/*.py route handlers
- **taos#R91** (typing, must; .claude/skills/taos-development-skill/soul.md:61): In tinyagentos/routes/*.py, request and response bodies must be modelled with Pydantic models.  
  scope: tinyagentos/routes/*.py route handlers
- **taos#R92** (argument, must; .claude/skills/taos-development-skill/soul.md:95): Routers must be included only in tinyagentos/routes/__init__.py register_all_routers() with dependencies=_csrf; tinyagentos/app.py must not call include_router inline.  
  scope: tinyagentos/app.py, tinyagentos/routes/__init__.py
- **taos#R93** (base_class, must; .claude/skills/taos-development-skill/soul.md:98): In tinyagentos/**, stores must subclass BaseStore with SCHEMA and MIGRATIONS, never reference migration-added columns in SCHEMA, and retrofit columns via a guarded _post_init.  
  scope: tinyagentos/**/*_store.py stores
- **taos#R94** (calls, must; .claude/skills/taos-development-skill/soul.md:101): In tinyagentos/**, config must be represented by the AppConfig dataclass and saved via save_config_locked().  
  scope: tinyagentos/** config access
- **taos#R95** (render, must; docs/design/live-surface-law.md:12): In desktop/src/** surfaces, data must be refetched on window focus and visibilitychange (via the S1 hook once landed); fetch-on-mount-once is forbidden.  
  scope: desktop/src/** app surfaces
- **taos#R96** (render, must; docs/design/live-surface-law.md:19): In desktop/src/** surfaces, push updates must come from a subscription to the OS SSE event stream (S2 hook once landed); polling may only be a fallback when the stream is unavailable.  
  scope: desktop/src/** app surfaces
- **taos#R97** (render, should; docs/design/live-surface-law.md:27): In desktop/src/** surfaces, list insert/remove, card moves and status transitions should animate, and all animations must respect prefers-reduced-motion.  
  scope: desktop/src/** components with state transitions
- **taos#R99** (layering, must; docs/design/abstraction-layers.md:37): Agent framework adapters (tinyagentos/adapters/**) must not call messaging platform APIs (Telegram, Discord, etc.) directly; all external messaging goes through tinyagentos/channel_hub.  
  scope: tinyagentos/adapters/**

## Proposals shown to the user

```text
[D-fdff1c] desktop: functions in src/lib/** declare their return type
    evidence: 241/245 (lower bound 0.96, lift 1.8)
    example:  desktop/src/lib/a2a-receipts-api.ts#getReceipts
    outlier:  desktop/src/lib/account-client.ts:169 login
    outlier:  desktop/src/lib/account-client.ts:172 register
    outlier:  desktop/src/lib/use-thread-panel.ts:3 useThreadPanel
    outlier:  desktop/src/lib/utils.ts:4 cn
```

```text
[D-e4696a] desktop: files in src/hooks/** have a test file
    evidence: 26/28 (lower bound 0.77, lift 1.5)
    example:  desktop/src/hooks/use-agent-shortcuts.ts#(file)
    outlier:  desktop/src/hooks/use-is-square-viewport.ts:1 (file)
    outlier:  desktop/src/hooks/use-update-available.ts:1 (file)
```

```text
[D-c74a2e] desktop: components in src/apps/** call useState() before useEffect()
    evidence: 133/146 (lower bound 0.85, lift 1.0)
    example:  desktop/src/apps/AgentBrowsersApp.tsx#AgentBrowsersApp
    outlier:  desktop/src/apps/BrowserApp/AddressSuggest.tsx:22 AddressSuggest
    outlier:  desktop/src/apps/BrowserApp/MoveTabMenu.tsx:24 MoveTabMenu
    outlier:  desktop/src/apps/BrowserApp/TabRenderer.tsx:57 TabRenderer
    outlier:  desktop/src/apps/BrowserApp/WindowChooser.tsx:24 WindowChooser
    outlier:  desktop/src/apps/ProjectsApp/canvas/CanvasBoard.tsx:37 CanvasBoard
    outlier:  desktop/src/apps/ProjectsApp/mobile/MobileTaskModal.tsx:55 MobileTaskModal
    outlier:  desktop/src/apps/ProvidersApp.tsx:1140 ProvidersApp
    outlier:  desktop/src/apps/SandboxedAppWindow.tsx:124 SandboxedAppWindow
    outlier:  desktop/src/apps/TerminalApp.tsx:94 TerminalApp
    outlier:  desktop/src/apps/agents/DeployWizard.tsx:78 MemoryWizardStep
    outlier:  desktop/src/apps/chat/AgentContextMenu.tsx:17 AgentContextMenu
    outlier:  desktop/src/apps/chat/MessageOverflowMenu.tsx:16 MessageOverflowMenu
    outlier:  desktop/src/apps/videostudio/CreateView.tsx:56 CreateView
```

```text
[D-9441cc] classes in tinyagentos/routes/** extend BaseModel
    evidence: 257/272 (lower bound 0.91, lift 2.5)
    example:  tinyagentos/routes/a2a_bus.py#BusSendBody
    outlier:  tinyagentos/routes/agent_versions.py:66 InvalidContainerTargetError
    outlier:  tinyagentos/routes/agents.py:54 IdempotencyCache
    outlier:  tinyagentos/routes/desktop_browser/agent_pin.py:16 AgentNotFoundError
    outlier:  tinyagentos/routes/desktop_browser/agent_pin.py:12 TooManyPinsError
    outlier:  tinyagentos/routes/desktop_browser/cookie_store.py:7 BrowserCookieStore
    outlier:  tinyagentos/routes/desktop_browser/copilot_ws.py:144 CopilotHub
    outlier:  tinyagentos/routes/desktop_browser/copilot_ws.py:37 CopilotTicketStore
    outlier:  tinyagentos/routes/desktop_browser/profile.py:187 LastProfileError
    outlier:  tinyagentos/routes/desktop_browser/profile.py:33 ProfileNotFoundError
    outlier:  tinyagentos/routes/desktop_browser/ssrf.py:59 SsrfBlockedError
    outlier:  tinyagentos/routes/desktop_browser/ssrf.py:266 SsrfGuardedAsyncTransport
    outlier:  tinyagentos/routes/images_edit.py:277 FluxFillClient
    outlier:  tinyagentos/routes/images_edit.py:181 IOPaintClient
    outlier:  tinyagentos/routes/lora_studio.py:166 CivitaiIngestError
    outlier:  tinyagentos/routes/lora_studio.py:73 CivitaiUrlError
```

```text
[D-7acce3] functions in tinyagentos/** (__init__ files) declare their return type
    evidence: 31/32 (lower bound 0.84, lift 1.8)
    example:  tinyagentos/adapters/__init__.py#list_frameworks
    outlier:  tinyagentos/routes/__init__.py:1 register_all_routers
```

```text
[D-6d209c] desktop: functions in src/apps/** declare their return type
    evidence: 183/193 (lower bound 0.91, lift 1.7)
    example:  desktop/src/apps/BrowserApp/agent-ws-bridge.ts#openParentWs
    outlier:  desktop/src/apps/BrowserApp/keyboard.ts:48 useBrowserKeyboardShortcuts
    outlier:  desktop/src/apps/MessagesApp/index.tsx:322 renderContent
    outlier:  desktop/src/apps/MessagesApp/index.tsx:348 renderInline
    outlier:  desktop/src/apps/ProjectsApp/board/useBoardData.ts:7 useBoardData
    outlier:  desktop/src/apps/ProjectsApp/board/useBoardLive.ts:6 useBoardLive
    outlier:  desktop/src/apps/ProjectsApp/canvas/canvas-store.ts:12 createCanvasStore
    outlier:  desktop/src/apps/chat/A2aBusPanel.tsx:60 useBusChannels
    outlier:  desktop/src/apps/chat/useChatNotifications.ts:8 useChatNotifications
    outlier:  desktop/src/apps/designstudio/useElementHistory.ts:25 useElementHistory
    outlier:  desktop/src/apps/musicstudio/use-studio-engine.ts:20 useStudioEngine
```

```text
[D-499c0e] functions in scripts/** declare their return type
    evidence: 126/129 (lower bound 0.93, lift 1.8)
    example:  scripts/_gitutil.py#diff_name_status_z
    outlier:  scripts/check_non_discriminating.py:305 pytest_configure
    outlier:  scripts/check_non_discriminating.py:451 pytest_runtest_protocol
    outlier:  scripts/mobile-screenshots.py:12 main
```

```text
[D-ccce4a] functions in tinyagentos/** declare their return type
    evidence: 749/778 (lower bound 0.95, lift 1.8)
    example:  tinyagentos/__main__.py#main
    outlier:  tinyagentos/agent_controller_listener.py:26 create_agent_controller_app
    outlier:  tinyagentos/agent_image.py:85 register_prefetch_endpoint
    outlier:  tinyagentos/agent_tools/coding_model.py:137 make_litellm_model_step
    outlier:  tinyagentos/app.py:1999 gui
    outlier:  tinyagentos/app.py:1971 main
    outlier:  tinyagentos/auto_update.py:145 poll_frameworks
    outlier:  tinyagentos/clients/retry.py:134 with_retry
    outlier:  tinyagentos/cluster/ble/proto.py:80 advert_mfr_data
    outlier:  tinyagentos/cluster/ble/proto.py:150 fragment
    outlier:  tinyagentos/cluster/ble/proto.py:389 info_frame
    outlier:  tinyagentos/cluster/ble/proto.py:135 key_from_raw
    outlier:  tinyagentos/cluster/ble/proto.py:84 parse_advert_mfr
    outlier:  tinyagentos/cluster/ble/proto.py:144 random_board_id
    outlier:  tinyagentos/cluster/ble/proto.py:140 raw_from_key
    outlier:  tinyagentos/cluster/ble/proto.py:281 seal
    outlier:  tinyagentos/cluster/ble/proto.py:330 validate_provision
    outlier:  tinyagentos/llm_gateway/listener.py:120 create_agent_listener_app
    outlier:  tinyagentos/projects/tx.py:205 read
    outlier:  tinyagentos/projects/tx.py:135 tx
    outlier:  tinyagentos/routes/agent_archive.py:501 purge_archived
    outlier:  tinyagentos/routes/agent_archive.py:319 restore_archived
    outlier:  tinyagentos/routes/agent_deploy.py:208 configure_remote_deploy
    outlier:  tinyagentos/services/sdcpp_server.py:162 main
    outlier:  tinyagentos/taos_agent_runtime.py:620 ensure_taos_picoclaw_harness
    outlier:  tinyagentos/taos_agent_runtime.py:614 provision_picoclaw
    outlier:  tinyagentos/userspace/broker.py:22 handle_capability
    outlier:  tinyagentos/worker/__main__.py:33 main
    outlier:  tinyagentos/worker/tray.py:11 create_icon_image
    outlier:  tinyagentos/worker/tray.py:21 run_tray
    exempt:   tinyagentos/cluster/ble/proto.py:105 b64 (shared part used by 3 members)
    exempt:   tinyagentos/cluster/ble/proto.py:234 commitment (shared part used by 2 members)
    exempt:   tinyagentos/cluster/ble/proto.py:246 derive_code (shared part used by 2 members)
    exempt:   tinyagentos/cluster/ble/proto.py:272 derive_session_key (shared part used by 2 members)
    exempt:   tinyagentos/cluster/ble/proto.py:131 pub_bytes (shared part used by 2 members)
    exempt:   tinyagentos/cluster/ble/proto.py:225 transcript (shared part used by 2 members)
    exempt:   tinyagentos/cluster/ble/proto.py:110 unb64 (shared part used by 2 members)
    exempt:   tinyagentos/cluster/ble/proto.py:285 unseal (shared part used by 2 members)
    exempt:   tinyagentos/cluster/ble/proto.py:126 x25519_keypair (shared part used by 2 members)
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "taos#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
