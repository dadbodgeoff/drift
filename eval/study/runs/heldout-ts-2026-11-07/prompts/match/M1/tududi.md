You are checking whether a tool's proposed conventions for the repository **tududi** (https://github.com/chrisvel/tududi at `71da9d7b34dfd1600657e9c5ddf40420206fd263`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/tududi

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/75cdadc3-b393-48ba-9d61-be95bed037f4/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **tududi#R01** (layering, must; CLAUDE.md:86): In backend/modules/*/routes.js, route handlers must not import or call Sequelize models from backend/models directly; they must call the module's repository.js.  
  scope: backend/modules/*/routes.js route handlers
- **tududi#R02** (file_layout, should; CLAUDE.md:86): In backend, a feature must live in backend/modules/<feature>/ with a thin routes.js Express router, a repository.js for Sequelize data access, and optional operations/ and core/ (serializers.js, builders.js, parsers.js).  
  scope: backend/modules/** feature modules
- **tududi#R03** (wrapper, must; CLAUDE.md:88): In backend route definitions, per-resource authorization must be done with the hasAccess(level, resourceType, getResourceUid) middleware from backend/middleware/authorize.js.  
  scope: backend/modules/*/routes.js resource routes
- **tududi#R04** (calls, must; CLAUDE.md:89): In frontend components and hooks, API calls must go through frontend/utils/<resource>Service.ts wrappers and must not use ad-hoc fetch().  
  scope: frontend/**/*.tsx components and hooks
- **tududi#R05** (other, should; CLAUDE.md:89): In frontend code, global UI/cache state must use the Zustand store in frontend/store/useStore.ts, server data must be fetched with SWR, and component-only state must use useState.  
  scope: frontend/** components
- **tududi#R06** (file_layout, must; docs/code-conventions.md:9): In frontend/, source files must be TypeScript (.ts/.tsx); in backend/, source files must be JavaScript (.js) with optional JSDoc types.  
  scope: frontend/** and backend/** source files
- **tududi#R07** (avoid, must; docs/code-conventions.md:17): In backend code, asynchronous functions must use async/await and must not take callback parameters or use .then()/.catch() callback chains.  
  scope: backend/**/*.js
- **tududi#R08** (layering, must; docs/code-conventions.md:42): In backend/modules/*/routes.js, code must not require('../../models') and call model methods such as Task.findByPk; it must use the module repository (e.g. repository.findTaskById).  
  scope: backend/modules/*/routes.js
- **tududi#R09** (error_handling, must; docs/code-conventions.md:69): In backend route handlers, async handler bodies must be wrapped in try/catch.  
  scope: backend/modules/*/routes.js route handlers
- **tududi#R10** (error_handling, must; docs/code-conventions.md:70): In backend route handlers, caught errors must be passed to next(error) for the global error handler rather than handled ad hoc.  
  scope: backend/modules/*/routes.js route handlers
- **tududi#R11** (other, must; docs/code-conventions.md:71): In backend route handlers, responses must use the proper HTTP status code (e.g. 404 for missing resource, 400 for invalid input).  
  scope: backend/modules/*/routes.js route handlers
- **tududi#R12** (error_handling, must; docs/code-conventions.md:72): In backend code, thrown errors must use the custom error classes from backend/shared/errors/ (e.g. ValidationError, NotFoundError) rather than plain Error.  
  scope: backend/**/*.js
- **tududi#R13** (other, should; docs/code-conventions.md:95): In backend service files, a service class must be exported as a singleton instance (module.exports = new XService()).  
  scope: backend/**/*Service.js service files
- **tududi#R14** (avoid, must; docs/code-conventions.md:123): In frontend React code, components must be functional components with hooks and must not be class components extending React.Component.  
  scope: frontend/components/**/*.tsx components
- **tududi#R15** (render, should; docs/code-conventions.md:155): In frontend components, styling must use Tailwind CSS utility classes in className.  
  scope: frontend/components/**/*.tsx components
- **tududi#R16** (calls, should; docs/code-conventions.md:167): In frontend components, complex conditional className expressions should use clsx or classnames rather than nested template literals.  
  scope: frontend/components/**/*.tsx components
- **tududi#R17** (calls, must; docs/code-conventions.md:181): In frontend code, user-chosen colors must come from PALETTE in frontend/constants/colorPalette.ts via the shared ColorPicker; components must not define local color arrays.  
  scope: frontend/** components
- **tududi#R18** (calls, must; docs/code-conventions.md:181): In frontend code, automatically assigned colors (e.g. comment avatars, template accents) must use hashColor(seed) from frontend/constants/colorPalette.ts.  
  scope: frontend/** components
- **tududi#R19** (calls, should; docs/code-conventions.md:182): In frontend components colored with a user color, the element must set style={accentVars(resolveColor(value))} and use ACCENT.* classes (ACCENT.bg, ACCENT.text, ACCENT.solid, ACCENT.surface).  
  scope: frontend/** components using user colors
- **tududi#R20** (calls, must; docs/code-conventions.md:183): In frontend components, form controls (select, input, textarea, label) must use the shared FORM.select/FORM.input/FORM.textarea/FORM.label classes from frontend/constants/formClasses.ts.  
  scope: frontend/** form components
- **tududi#R21** (naming, must; docs/code-conventions.md:189): In backend, service file names must be camelCase (e.g. recurringTaskService.js) and files in operations/ and queries/ must be kebab-case (e.g. query-builders.js).  
  scope: backend/** file names
- **tududi#R22** (naming, must; docs/code-conventions.md:190): In frontend, React component names and their .tsx file names must be PascalCase.  
  scope: frontend/components/**/*.tsx
- **tududi#R23** (naming, must; docs/code-conventions.md:191): In all source files, function names must be camelCase.  
  scope: backend/**, frontend/** all files
- **tududi#R24** (naming, must; docs/code-conventions.md:192): In all source files, class names must be PascalCase.  
  scope: backend/**, frontend/** all files
- **tududi#R25** (naming, must; docs/code-conventions.md:193): In all source files, constants must be named in UPPER_SNAKE_CASE.  
  scope: backend/**, frontend/** all files
- **tududi#R26** (naming, must; docs/code-conventions.md:194): In all source files, variable names must be camelCase.  
  scope: backend/**, frontend/** all files
- **tududi#R27** (naming, must; docs/code-conventions.md:195): In backend models and migrations, database table names must be lowercase, snake_case and plural (e.g. tasks, user_groups).  
  scope: backend/models/**, backend/migrations/**
- **tududi#R28** (naming, must; docs/code-conventions.md:196): In backend models and migrations, database column names must be snake_case (e.g. user_id, due_date).  
  scope: backend/models/**, backend/migrations/**
- **tududi#R29** (naming, must; docs/code-conventions.md:197): In frontend TypeScript, interface names must be PascalCase.  
  scope: frontend/**/*.ts(x)
- **tududi#R30** (naming, must; docs/code-conventions.md:198): In frontend TypeScript, type alias names must be PascalCase.  
  scope: frontend/**/*.ts(x)
- **tududi#R31** (naming, should; docs/code-conventions.md:205): In backend routers, single-resource routes must use a singular path addressed by :uid (e.g. POST /task, GET/PATCH/DELETE /task/:uid).  
  scope: backend/modules/*/routes.js
- **tududi#R32** (naming, should; docs/code-conventions.md:211): In backend routers, collection routes must use a plural path (e.g. GET /tasks) and filter via query parameters rather than path segments.  
  scope: backend/modules/*/routes.js
- **tududi#R33** (other, must; docs/code-conventions.md:221): In backend routers, resource update endpoints must use router.patch and must not use router.put.  
  scope: backend/modules/*/routes.js
- **tududi#R34** (other, must; docs/code-conventions.md:221): In the backend tasks API, task tags must be set via the tags array in the task request body, not via a separate tags endpoint; a project's tasks must be listed through GET /tasks?project_uid=<uid>.  
  scope: backend/modules/tasks/routes.js
- **tududi#R35** (calls, should; docs/code-conventions.md:223): In backend module routers that accept numeric ids on :uid routes, the backend/middleware/numericIdParam.js helper must be registered with router.param.  
  scope: backend/modules/*/routes.js
- **tududi#R36** (other, should; docs/code-conventions.md:251): In backend route handlers, successful creates (POST) must respond with status 201 and successful deletes must respond with 204 No Content.  
  scope: backend/modules/*/routes.js route handlers
- **tududi#R37** (error_handling, should; docs/code-conventions.md:256): In backend route handlers, error responses must be JSON with an error property ({ error: '...' }).  
  scope: backend/modules/*/routes.js route handlers
- **tududi#R39** (layering, should; docs/code-conventions.md:351): In backend modules, routes.js must stay thin and delegate business logic to operations/, and repository.js must contain only database queries.  
  scope: backend/modules/*/routes.js, repository.js
- **tududi#R40** (file_layout, should; docs/code-conventions.md:355): In backend modules, core/serializers.js must only format output, core/builders.js only construct objects, core/parsers.js only parse input, and utils/validation.js only validate.  
  scope: backend/modules/*/core/*.js, utils/validation.js
- **tududi#R41** (file_layout, should; docs/code-conventions.md:370): In frontend/components/Task/TaskForm/, each form section must be its own component file (e.g. TaskDueDateSection.tsx).  
  scope: frontend/components/Task/TaskForm/**
- **tududi#R42** (testing, should; docs/code-conventions.md:372): In frontend/components/<Feature>/, component tests must live in a __tests__/ subdirectory as <Component>.test.tsx.  
  scope: frontend/components/** tests
- **tududi#R43** (testing, should; docs/code-conventions.md:385): In backend/tests, unit tests must live under backend/tests/unit/<category>/ and integration tests must be flat files in backend/tests/integration/, one <feature>.test.js per feature.  
  scope: backend/tests/**
- **tududi#R44** (testing, should; docs/code-conventions.md:394): In test files, tests must be grouped in describe() blocks with it('should ...') cases structured as Arrange-Act-Assert.  
  scope: backend/tests/**, frontend/**/__tests__/** test files
- **tududi#R45** (error_handling, must; docs/code-conventions.md:426): In backend code handling request input, user input must be validated and invalid input must throw ValidationError.  
  scope: backend/** request-handling code
- **tududi#R46** (avoid, should; docs/code-conventions.md:447): In backend code, raw sequelize.query() SQL should be avoided in favor of Sequelize model queries; when raw SQL is necessary it must use replacements, not string interpolation.  
  scope: backend/**/*.js data access
- **tududi#R47** (calls, must; docs/code-conventions.md:460): In backend code, passwords must be hashed with bcrypt before storage and must never be assigned/stored in plain text.  
  scope: backend/** auth and user code
- **tududi#R48** (render, must; docs/code-conventions.md:474): In frontend components, dangerouslySetInnerHTML must only be used with content sanitized by DOMPurify.sanitize().  
  scope: frontend/**/*.tsx components
- **tududi#R49** (avoid, should; docs/code-conventions.md:486): In backend data access, associations must be eager-loaded with Sequelize include rather than querying per row in a loop (no N+1 queries).  
  scope: backend/** repositories and queries
- **tududi#R51** (naming, should; docs/backend-patterns.md:177): In backend module routers, collection endpoints must use plural paths and single-resource endpoints singular paths.  
  scope: backend/modules/*/routes.js
- **tududi#R52** (error_handling, must; docs/backend-patterns.md:179): In backend module route handlers, handlers must use try/catch and forward errors with next(error).  
  scope: backend/modules/*/routes.js route handlers
- **tududi#R53** (wrapper, must; docs/backend-patterns.md:181): In backend module routers, routes on a specific resource must use the hasAccess() middleware from backend/middleware/authorize.js for authorization.  
  scope: backend/modules/*/routes.js
- **tududi#R54** (calls, should; docs/backend-patterns.md:293): In backend route handlers, database objects must be transformed via the module's core/serializers.js (e.g. serializeItem/serializeItems) before being sent in the response.  
  scope: backend/modules/*/routes.js route handlers
- **tududi#R55** (calls, should; docs/backend-patterns.md:331): In backend route handlers, attributes for create/update must be built from request data using the module's core/builders.js (e.g. buildTaskAttributes).  
  scope: backend/modules/*/routes.js route handlers
- **tududi#R56** (layering, should; docs/backend-patterns.md:402): In backend/modules, two modules must not import each other circularly; shared logic must be extracted to backend/services/ and imported from there.  
  scope: backend/modules/**
- **tududi#R57** (other, should; docs/backend-patterns.md:547): In backend/app.js, each module router must be registered under both /api/v1 and /api.  
  scope: backend/app.js route registration
- **tududi#R58** (other, should; docs/backend-patterns.md:643): In backend, a new module's resource must have a schema added in backend/config/swagger.js.  
  scope: backend/config/swagger.js
- **tududi#R59** (calls, must; docs/architecture.md:207): In backend code, shared access must be read through backend/services/permissionSources.js and must never query the Permission model alone.  
  scope: backend/** access/sharing code
- **tududi#R60** (file_layout, should; docs/architecture.md:321): In frontend, components shared across features must live in frontend/components/Shared/; feature components in their own frontend/components/<Feature>/ directory.  
  scope: frontend/components/**
- **tududi#R61** (avoid, must; docs/architecture.md:336): In frontend, React components must be functional components with hooks; class components must not be used.  
  scope: frontend/components/**/*.tsx
- **tududi#R62** (file_layout, should; docs/architecture.md:337): In frontend, entity TypeScript interfaces must be defined in frontend/entities/<Type>.ts.  
  scope: frontend/entities/**
- **tududi#R63** (file_layout, should; docs/architecture.md:338): In frontend, API client functions must live in frontend/utils/<resource>Service.ts files.  
  scope: frontend/utils/**
- **tududi#R64** (file_layout, should; docs/architecture.md:339): In frontend, custom React hooks must live in frontend/hooks/.  
  scope: frontend/hooks/**
- **tududi#R65** (file_layout, should; docs/architecture.md:340): In frontend, React context providers must live in frontend/contexts/.  
  scope: frontend/contexts/**
- **tududi#R66** (calls, should; docs/architecture.md:351): In frontend login and logout flows, code must call notifySwSession(userId) at login and notifySwClearCache() at logout from frontend/utils/swUtils.ts.  
  scope: frontend/** auth login/logout code
- **tududi#R67** (typing, must; .github/CONTRIBUTING.md:154): In the repository, all new code must be written in TypeScript.  
  scope: all new source files
- **tududi#R68** (other, must; .github/CONTRIBUTING.md:165): In frontend React code, components must be functional components using hooks.  
  scope: frontend/components/**/*.tsx
- **tududi#R69** (typing, must; .github/CONTRIBUTING.md:167): In frontend React components, props must be typed with a TypeScript interface (e.g. interface TaskItemProps).  
  scope: frontend/components/**/*.tsx components
- **tududi#R70** (file_layout, must; .github/CONTRIBUTING.md:168): In frontend, new React components must be placed under frontend/components/.  
  scope: frontend/** components
- **tududi#R71** (avoid, must; .github/CONTRIBUTING.md:173): In backend code, asynchronous code must use async/await and must not use callbacks.  
  scope: backend/**/*.js
- **tududi#R72** (wrapper, must; .github/CONTRIBUTING.md:174): In backend routes, request input must be validated using middleware.  
  scope: backend/** routes
- **tududi#R73** (calls, must; .github/CONTRIBUTING.md:175): In backend code, database access must go through Sequelize models rather than other database clients or raw drivers.  
  scope: backend/** data access
- **tududi#R74** (file_layout, must; .github/CONTRIBUTING.md:177): In backend, route files must be placed in backend/routes/.  
  scope: backend/** route files
- **tududi#R75** (file_layout, must; .github/CONTRIBUTING.md:178): In backend, business logic must be placed in backend/services/.  
  scope: backend/** business logic
- **tududi#R76** (avoid, must; .github/CONTRIBUTING.md:182): In all files, code must never contain hard-coded secrets, API keys or credentials.  
  scope: all files
- **tududi#R77** (avoid, must; .github/CONTRIBUTING.md:184): In backend data access, SQL must be parameterized (via Sequelize query options or replacements), never built by string concatenation of user input.  
  scope: backend/** data access
- **tududi#R79** (testing, must; .github/CONTRIBUTING.md:213): In backend, test files must be placed under backend/tests/.  
  scope: backend test files
- **tududi#R80** (testing, must; .github/CONTRIBUTING.md:214): In frontend, tests must be placed alongside components and named *.test.tsx.  
  scope: frontend test files
- **tududi#R81** (testing, must; .github/CONTRIBUTING.md:216): In test files, test cases must follow the Arrange-Act-Assert pattern.  
  scope: backend/tests/**, frontend tests
- **tududi#R82** (other, must; .github/CONTRIBUTING.md:243): In backend/migrations, every migration must implement a working down() method that reverses up().  
  scope: backend/migrations/*.js
- **tududi#R84** (other, must; .github/CONTRIBUTING.md:246): In backend/migrations, data migrations must run inside a transaction (queryInterface.sequelize.transaction with commit/rollback).  
  scope: backend/migrations/*.js data migrations
- **tududi#R85** (other, must; .github/CONTRIBUTING.md:254): In frontend translations, new translation keys must be added to public/locales/en/translation.json as the source of truth.  
  scope: public/locales/en/translation.json
- **tududi#R86** (naming, should; .github/CONTRIBUTING.md:269): In translation files and t() calls, translation keys must be descriptive dotted names (e.g. task.create.button), not opaque names like btn1.  
  scope: public/locales/**, frontend t() calls
- **tududi#R87** (calls, must; .github/CONTRIBUTING.md:271): In frontend components, user-facing text must not be hard-coded; it must come from translation keys via t().  
  scope: frontend/**/*.tsx components
- **tududi#R89** (testing, should; docs/testing.md:464): In backend tests, external services (e.g. services/emailService) should be mocked with jest.mock.  
  scope: backend/tests/**
- **tududi#R90** (testing, should; docs/testing.md:481): In frontend tests, API calls should be mocked with msw (setupServer from msw/node).  
  scope: frontend/** tests
- **tududi#R92** (testing, should; docs/testing.md:514): In backend unit tests, edge-case tests for auth/authorization code must live in *-edge-cases.test.js files next to the other unit tests.  
  scope: backend/tests/unit/**
- **tududi#R94** (testing, should; docs/MEMORY.md:608): In backend, unit test files must be placed in backend/tests/unit/ in a structure matching the source module structure.  
  scope: backend/tests/unit/**
- **tududi#R95** (calls, must; docs/MEMORY.md:620): In backend/migrations, tables must be created with safeCreateTable from backend/utils/migration-utils.js, not queryInterface.createTable.  
  scope: backend/migrations/*.js
- **tududi#R96** (calls, must; docs/MEMORY.md:621): In backend/migrations, columns must be added with safeAddColumns from backend/utils/migration-utils.js, not queryInterface.addColumn with manual describeTable checks.  
  scope: backend/migrations/*.js
- **tududi#R97** (calls, must; docs/MEMORY.md:622): In backend/migrations, indexes must be added with safeAddIndex from backend/utils/migration-utils.js, not queryInterface.addIndex.  
  scope: backend/migrations/*.js
- **tududi#R98** (calls, must; docs/MEMORY.md:623): In backend/migrations, column removal and changes must use safeRemoveColumn and safeChangeColumn from backend/utils/migration-utils.js.  
  scope: backend/migrations/*.js
- **tududi#R99** (layering, should; docs/MEMORY.md:629): In backend, business logic must be kept in service files rather than in routes or repositories.  
  scope: backend/** business logic
- **tududi#R100** (typing, should; docs/MEMORY.md:632): In frontend, new components must be written in TypeScript (.tsx).  
  scope: frontend/components/** new components
- **tududi#R101** (other, should; docs/MEMORY.md:634): In frontend, global state must use Zustand and server state must use SWR.  
  scope: frontend/** components and stores
- **tududi#R102** (file_layout, must; docs/database.md:9): In backend, Sequelize models must be defined in backend/models/ and their associations configured in backend/models/index.js.  
  scope: backend/models/**
- **tududi#R103** (calls, must; docs/database.md:47): In backend code, shared access must be read through permissionSources and must never query the Permission model alone.  
  scope: backend/** access/sharing code
- **tududi#R104** (file_layout, should; docs/database.md:337): In backend/migrations, migration files must be named YYYYMMDDHHMMSS-<kebab-description>.js.  
  scope: backend/migrations/*.js
- **tududi#R105** (other, must; docs/database.md:384): In backend/migrations, every migration must implement down(); an empty or unimplemented down() is not allowed.  
  scope: backend/migrations/*.js
- **tududi#R107** (other, should; docs/database.md:445): In backend/migrations, data migrations should wrap their operations in a transaction with commit and rollback on error.  
  scope: backend/migrations/*.js data migrations
- **tududi#R108** (file_layout, must; docs/database.md:612): In backend, new migrations must be placed at the top level of backend/migrations/, not in backend/migrations/archive/.  
  scope: backend/migrations/**
- **tududi#R109** (other, must; docs/database.md:616): In backend, each migration must match the corresponding change in backend/models/*.js exactly (column types, defaults, nullability, unique indexes).  
  scope: backend/migrations/*.js and backend/models/*.js
- **tududi#R110** (calls, must; docs/database.md:623): In backend/migrations, schema operations must use the safe* helpers from backend/utils/migration-utils.js so migrations are idempotent.  
  scope: backend/migrations/*.js
- **tududi#R111** (avoid, must; docs/database.md:624): In backend migrations and SQL, booleans must be compared and written as true/false, never 0/1.  
  scope: backend/migrations/*.js, raw SQL
- **tududi#R112** (avoid, must; docs/database.md:625): In backend migrations and queries, values for JSON columns must be bound as objects (or cast ::json), not as pre-stringified JSON text.  
  scope: backend/migrations/*.js, backend data access
- **tududi#R113** (other, must; docs/database.md:626): In backend raw SQL, table aliases and mixed-case identifiers must be double-quoted (e.g. "Task"."id").  
  scope: backend/** raw SQL
- **tududi#R114** (calls, should; docs/database.md:627): In backend/migrations, column changes must be done in place with safeChangeColumn (ALTER TABLE) rather than rebuilding the table.  
  scope: backend/migrations/*.js
- **tududi#R115** (naming, must; docs/common-tasks.md:190): In backend/migrations, migrations must be idempotent, use the safe* helpers, refer to lowercase table names, and use true/false for booleans.  
  scope: backend/migrations/*.js
- **tududi#R116** (other, must; docs/common-tasks.md:202): In backend, an index added in a migration must also be declared in the model's indexes option in backend/models/*.js.  
  scope: backend/models/*.js and backend/migrations/*.js
- **tududi#R117** (other, must; docs/common-tasks.md:322): In public/locales, every new translation key must be added to translation.json of every locale, not only English.  
  scope: public/locales/*/translation.json
- **tududi#R118** (file_layout, should; docs/common-tasks.md:41): In frontend, a new task form field must be added as its own section component in frontend/components/Task/TaskForm/.  
  scope: frontend/components/Task/TaskForm/**
- **tududi#R119** (calls, must; docs/18-user-groups.md:118): In backend code that determines who can see a resource, code must not query the Permission model alone; it must use backend/services/permissionSources.js (findAccepted, countAccepted, findAcceptedAccessLevel, countDistinctUsersByResource) or permissionsService helpers.  
  scope: backend/** access/sharing code
- **tududi#R120** (calls, must; docs/15-pwa.md:150): In frontend code that performs mutating requests, the response must be checked with isQueuedOfflineResponse() or handleAuthResponse() from frontend/utils/authUtils.ts rather than treating a queued 202 body as the real resource.  
  scope: frontend/utils/*Service.ts and mutation callers
- **tududi#R121** (other, should; docs/15-pwa.md:279): In public/sw.js, GET endpoints returning one-time tokens or download URLs must have their path prefix added to the NO_CACHE_PATHS blocklist in handleApiGet.  
  scope: public/sw.js
- **tududi#R123** (calls, should; docs/13-ai-assistant.md:278): In backend/modules/ai-assistant/service.js, AI feature functions must call client.chat.completions.create() with the model from getAIModel() and response_format: { type: 'json_object' }.  
  scope: backend/modules/ai-assistant/service.js
- **tududi#R124** (error_handling, should; docs/13-ai-assistant.md:279): In backend/modules/ai-assistant/controller.js, each controller method must perform an auth check and delegate errors via next(error).  
  scope: backend/modules/ai-assistant/controller.js
- **tududi#R125** (file_layout, should; docs/13-ai-assistant.md:281): In frontend, AI assistant API client functions must be typed and live in frontend/utils/aiAssistantService.ts.  
  scope: frontend/utils/aiAssistantService.ts
- **tududi#R126** (file_layout, should; docs/13-ai-assistant.md:282): In frontend, AI feature React components must live under frontend/components/AI/.  
  scope: frontend/components/AI/**
- **tududi#R127** (calls, must; docs/28-spreadsheets.md:87): In backend/modules/spreadsheets, imported task rows must be built with buildTaskAttributes/buildUpdateAttributes from the tasks module, and task creates/updates must pass skipWebhooks: true.  
  scope: backend/modules/spreadsheets/**
- **tududi#R128** (other, must; backend/emails/README.md:37): In backend/emails/locales/*/emails.json, every key added to English must be added to every other language, with plurals using i18next suffixes (key_one, key_few, key_other).  
  scope: backend/emails/locales/*/emails.json
- **tududi#R129** (calls, must; backend/emails/README.md:40): In backend, each email module must be registered in backend/emails/index.js and emails must be sent by calling renderEmail(name, { language, ...vars }).  
  scope: backend/emails/** and email-sending code

## Proposals shown to the user

```text
[D-744c2d] exported values in backend/** (controller files) use `try`
    evidence: 33/35 (lower bound 0.81, lift 13.9)
    example:  backend/modules/admin-ai-usage/controller.js#controller
    outlier:  backend/modules/habits/controller.js:13 habitsController
    outlier:  backend/modules/webhooks/controller.js:21 controller
```

```text
[D-f7d289] components in frontend/components/** call useTranslation() before useState()
    evidence: 170/203 (lower bound 0.78, lift 1.0)
    example:  frontend/components/AI/DailyAssistant.tsx#DailyAssistant
    outlier:  frontend/components/Auth/AuthPageShell.tsx:11 AuthPageShell
    outlier:  frontend/components/Blog/BlogApp.tsx:23 BlogApp
    outlier:  frontend/components/Calendar/CalendarWeekView.tsx:35 CalendarWeekView
    outlier:  frontend/components/Goal/GoalHero.tsx:38 GoalHero
    outlier:  frontend/components/Insights/AreaDonut.tsx:42 AreaDonut
    outlier:  frontend/components/Insights/BurndownChart.tsx:21 BurndownChart
    outlier:  frontend/components/Insights/LifeBalance.tsx:67 LifeBalance
    outlier:  frontend/components/Login.tsx:12 Login
    outlier:  frontend/components/Note/SlashCommandMenu.tsx:247 SlashCommandMenu
    outlier:  frontend/components/People/PeopleList.tsx:23 PeopleList
    outlier:  frontend/components/People/PersonModal.tsx:44 PersonModal
    outlier:  frontend/components/Project/ProjectAttachmentsWidget.tsx:21 ProjectAttachmentsWidget
    outlier:  frontend/components/Project/ProjectBanner.tsx:33 ProjectBanner
    outlier:  frontend/components/Project/ProjectHero.tsx:52 ProjectHero
    outlier:  frontend/components/Project/ProjectOverviewRail.tsx:141 ProjectOverviewRail
    outlier:  frontend/components/Project/Timeline/ProjectTimeline.tsx:65 ProjectTimeline
    outlier:  frontend/components/Register.tsx:10 Register
    outlier:  frontend/components/Shared/AttachmentPreview.tsx:11 AttachmentPreview
    outlier:  frontend/components/Shared/GoalDropdown.tsx:13 GoalDropdown
    outlier:  frontend/components/Shared/IconSortDropdown.tsx:32 IconSortDropdown
    outlier:  frontend/components/Shared/MermaidDiagram.tsx:72 MermaidDiagram
    outlier:  frontend/components/Shared/NumberSelectDropdown.tsx:15 NumberSelectDropdown
    outlier:  frontend/components/Shared/PersonDropdown.tsx:38 PersonDropdown
    outlier:  frontend/components/Shared/RecurrenceSelectDropdown.tsx:19 RecurrenceSelectDropdown
    outlier:  frontend/components/Shared/SelectMenu.tsx:24 SelectMenu
    outlier:  frontend/components/Shared/SortFilterButton.tsx:17 SortFilterButton
    outlier:  frontend/components/Shared/ToastContext.tsx:22 ToastProvider
    outlier:  frontend/components/Shared/Tooltip.tsx:10 Tooltip
    outlier:  frontend/components/Sidebar.tsx:60 Sidebar
    outlier:  frontend/components/Task/NewTask.tsx:10 NewTask
    outlier:  frontend/components/Task/TaskDetails/TaskAssignedToCard.tsx:13 TaskAssignedToCard
    outlier:  frontend/components/Task/TaskDetails/TaskSubtasksCard.tsx:17 TaskSubtasksCard
    outlier:  frontend/components/Task/TaskRow/TaskRowExpansionContext.tsx:19 TaskRowExpansionProvider
```

```text
[D-9998f9] functions in frontend/** declare their return type
    evidence: 571/615 (lower bound 0.91, lift 3.7)
    example:  frontend/components/Admin/AdminTrends.tsx#percentOf
    outlier:  frontend/components/Blog/BlogPostCard.tsx:6 formatPostDate
    outlier:  frontend/components/Capture/useCaptureFiles.ts:77 useCaptureFiles
    outlier:  frontend/components/Note/editor/highlightStyle.ts:25 neutralEditorTheme
    outlier:  frontend/components/Note/editor/linkClicks.ts:12 linkClickHandlers
    outlier:  frontend/components/Note/editor/textCommands.ts:62 insertLink
    outlier:  frontend/components/Note/editor/textCommands.ts:41 setHeading
    outlier:  frontend/components/Note/editor/textCommands.ts:3 wrapSelection
    outlier:  frontend/components/Project/useCompleteProject.tsx:22 useCompleteProject
    outlier:  frontend/components/Project/useProjectCardActions.tsx:15 useProjectCardActions
    outlier:  frontend/components/Project/useProjectMetrics.ts:18 useProjectMetrics
    outlier:  frontend/components/Shared/ToastContext.tsx:80 useToast
    outlier:  frontend/components/Task/getTitleAndIcon.ts:13 getTitleAndIcon
    outlier:  frontend/components/Task/statusStyles.ts:65 getStatusBorderColorClasses
    outlier:  frontend/contexts/SidebarContext.tsx:11 useSidebar
    outlier:  frontend/contexts/TelegramStatusContext.tsx:136 dispatchTelegramStatusChange
    outlier:  frontend/contexts/TelegramStatusContext.tsx:125 useTelegramStatus
    outlier:  frontend/hooks/useKeyboardShortcuts.ts:29 useKeyboardShortcuts
    outlier:  frontend/hooks/useNotesTreeExpansion.ts:34 useNotesTreeExpansion
    outlier:  frontend/hooks/usePersistedModal.ts:12 usePersistedModal
    outlier:  frontend/store/useStore.ts:210 useStore
    outlier:  frontend/utils/billingPlans.ts:47 formatMoney
    outlier:  frontend/utils/captcha.ts:27 resetCaptchaConfigCache
    outlier:  frontend/utils/featureFlags.ts:51 clearFeatureFlagsCache
    outlier:  frontend/utils/habitsService.ts:114 fetchHabitStats
    outlier:  frontend/utils/keyboardShortcutsService.ts:77 parseKeyboardEvent
    outlier:  frontend/utils/membersService.ts:225 redeemSignInLink
    outlier:  frontend/utils/mfaService.ts:70 disableMfa
    outlier:  frontend/utils/mfaService.ts:67 enableMfa
    outlier:  frontend/utils/mfaService.ts:75 regenerateRecoveryCodes
    outlier:  frontend/utils/mfaService.ts:78 reverify
    outlier:  frontend/utils/mfaService.ts:65 startMfaSetup
    outlier:  frontend/utils/sidebarWidth.ts:19 sidebarPxToPercent
    outlier:  frontend/utils/spreadsheetService.ts:328 commitImport
    outlier:  frontend/utils/spreadsheetService.ts:343 discardImport
    outlier:  frontend/utils/spreadsheetService.ts:346 listImports
    outlier:  frontend/utils/spreadsheetService.ts:308 loadImportColumns
    outlier:  frontend/utils/spreadsheetService.ts:320 previewImport
    outlier:  frontend/utils/webhooksService.ts:105 createWebhook
    outlier:  frontend/utils/webhooksService.ts:116 deleteWebhook
    outlier:  frontend/utils/webhooksService.ts:137 listWebhookDeliveries
    outlier:  frontend/utils/webhooksService.ts:102 listWebhooks
    outlier:  frontend/utils/webhooksService.ts:123 rotateWebhookSecret
    outlier:  frontend/utils/webhooksService.ts:130 testWebhook
    outlier:  frontend/utils/webhooksService.ts:108 updateWebhook
    exempt:   frontend/components/Admin/SortableTable.tsx:27 useSortedRows (shared part used by 5 members)
    exempt:   frontend/components/Auth/useReverify.tsx:19 useReverify (shared part used by 2 members)
    exempt:   frontend/components/DailyPlan/tips.ts:32 lateItems (shared part used by 2 members)
    exempt:   frontend/components/Shared/sortableList.ts:44 resetSortableCursor (shared part used by 6 members)
    exempt:   frontend/components/Shared/sortableList.ts:25 swallowNextClick (shared part used by 6 members)
    exempt:   frontend/components/Shared/sortableList.ts:12 useSortableSensors (shared part used by 7 members)
    exempt:   frontend/components/Task/statusStyles.ts:58 getStatusButtonColorClasses (shared part used by 2 members)
    exempt:   frontend/store/dailyPlanStore.ts:9 useDailyPlanProgress (shared part used by 3 members)
    exempt:   frontend/store/taskPanelStore.ts:18 openTaskPanel (shared part used by 14 members)
    exempt:   frontend/store/taskPanelStore.ts:12 useTaskPanel (shared part used by 2 members)
    exempt:   frontend/utils/avatarTint.ts:11 avatarTint (shared part used by 3 members)
    exempt:   frontend/utils/habitUtils.ts:19 habitAccentStyle (shared part used by 2 members)
    exempt:   frontend/utils/spreadsheetService.ts:283 downloadImportTemplate (shared part used by 2 members)
    exempt:   frontend/utils/spreadsheetService.ts:266 exportTasks (shared part used by 2 members)
    exempt:   frontend/utils/spreadsheetService.ts:336 undoImport (shared part used by 2 members)
```

```text
[D-57d79e] functions in backend/** (validation files) are named `validate*`
    evidence: 43/49 (lower bound 0.76, lift 33.9)
    example:  backend/modules/admin/validation.js#validateCreateUser
    outlier:  backend/modules/inbox/validation.js:44 buildTitleFromContent
    outlier:  backend/modules/projects/validation.js:35 formatDate
    outlier:  backend/modules/search/validation.js:20 parseSearchParams
    outlier:  backend/modules/search/validation.js:93 priorityToInt
    outlier:  backend/modules/tasks/utils/validation.js:256 getRecurringParentEndDate
    outlier:  backend/modules/tasks/utils/validation.js:16 isValidTaskUid
```

```text
[D-6c856c] components in frontend/components/** do not use requests to computed URLs
    evidence: 293/325 (lower bound 0.86, lift 6.1)
    example:  frontend/components/AI/DailyAssistant.tsx#DailyAssistant
    outlier:  frontend/components/About.tsx:12 About
    outlier:  frontend/components/Admin/AdminDashboardPage.tsx:68 AdminDashboardPage
    outlier:  frontend/components/Admin/AdminUserStatusTable.tsx:77 AdminUserStatusTable
    outlier:  frontend/components/Auth/ForgotPassword.tsx:10 ForgotPassword
    outlier:  frontend/components/Auth/MfaCodeForm.tsx:12 MfaCodeForm
    outlier:  frontend/components/Auth/ResetPassword.tsx:9 ResetPassword
    outlier:  frontend/components/Billing/SubscriptionRequired.tsx:26 SubscriptionRequired
    outlier:  frontend/components/Calendar.tsx:91 Calendar
    outlier:  frontend/components/DemoEntry.tsx:8 DemoEntry
    outlier:  frontend/components/Eisenhower/EisenhowerMatrix.tsx:32 EisenhowerMatrix
    outlier:  frontend/components/Insights/BurndownChart.tsx:21 BurndownChart
    outlier:  frontend/components/Insights/ReportsOverview.tsx:141 ReportsOverview
    outlier:  frontend/components/Insights/ReportsPage.tsx:277 ReportsPage
    outlier:  frontend/components/Kanban/KanbanBoard.tsx:130 KanbanBoard
    outlier:  frontend/components/Login.tsx:12 Login
    outlier:  frontend/components/Navbar.tsx:51 Navbar
    outlier:  frontend/components/Note/NoteSidePanel.tsx:39 NoteSidePanel
    outlier:  frontend/components/Notifications/NotificationsDropdown.tsx:54 NotificationsDropdown
    outlier:  frontend/components/Profile/ProfileSettings.tsx:97 ProfileSettings
    outlier:  frontend/components/Profile/tabs/McpTab.tsx:29 McpTab
    outlier:  frontend/components/Project/BannerEditModal.tsx:19 BannerEditModal
    outlier:  frontend/components/Project/ProjectDetails.tsx:71 ProjectDetails
    outlier:  frontend/components/PublicNote/PublicNotePage.tsx:20 PublicNotePage
    outlier:  frontend/components/Register.tsx:10 Register
    outlier:  frontend/components/Shared/AttachmentPreview.tsx:11 AttachmentPreview
    outlier:  frontend/components/Sidebar/SidebarFooter.tsx:54 SidebarFooter
    outlier:  frontend/components/Sidebar/SidebarViews.tsx:103 SidebarViews
    outlier:  frontend/components/Tag/TagDetails.tsx:35 TagDetails
    outlier:  frontend/components/Tasks.tsx:49 Tasks
    outlier:  frontend/components/UniversalSearch/SearchMenu.tsx:107 SearchMenu
    outlier:  frontend/components/ViewDetail.tsx:51 ViewDetail
    outlier:  frontend/components/Views.tsx:12 Views
```

```text
[D-815f43] functions in backend/** do not use requests to computed URLs
    evidence: 1202/1204 (lower bound 0.99, lift 109.0)
    example:  backend/config/authConfig.js#isPasswordAuthEnabled
    outlier:  backend/middleware/captcha.js:32 verifyToken
    outlier:  backend/modules/calendar-feeds/fetcher.js:90 fetchFeed
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "tududi#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
