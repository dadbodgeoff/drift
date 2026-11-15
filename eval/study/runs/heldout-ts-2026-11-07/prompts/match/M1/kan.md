You are checking whether a tool's proposed conventions for the repository **kan** (https://github.com/kanbn/kan at `18f42912c1399a745ec81bc793a27e2ce249717a`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/kan

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/79fab562-1090-4bdf-b890-aee12ea2d2b1/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **kan#R01** (avoid, should; AGENTS.md:40): In all TypeScript files, code should not use the `any` type.  
  scope: **/*.{ts,tsx} all files
- **kan#R05** (file_layout, must; AGENTS.md:47): In the whole repository, source file names must be kebab-case (e.g. `card-repo.ts`).  
  scope: **/* source file names
- **kan#R06** (naming, must; AGENTS.md:48): In all .tsx files, React components must be named in PascalCase.  
  scope: **/*.tsx React components
- **kan#R07** (naming, must; AGENTS.md:49): In all TypeScript files, functions must be named in camelCase.  
  scope: **/*.{ts,tsx} functions
- **kan#R08** (naming, must; AGENTS.md:50): In all TypeScript files, constants must be named in UPPER_SNAKE_CASE.  
  scope: **/*.{ts,tsx} constants
- **kan#R09** (naming, must; AGENTS.md:51): In all TypeScript files, types and interfaces must be named in PascalCase.  
  scope: **/*.{ts,tsx} type aliases and interfaces
- **kan#R10** (file_layout, must; AGENTS.md:55): In packages/db, database table schemas must be defined with Drizzle ORM in files under packages/db/src/schema/.  
  scope: packages/db/src/schema/*.ts database schema
- **kan#R11** (layering, must; AGENTS.md:57): In packages/db, database queries must live in repository files under packages/db/src/repository/ (named *.repo.ts), not elsewhere.  
  scope: packages/db/src/repository/*.repo.ts database queries
- **kan#R12** (avoid, must; AGENTS.md:58): In packages/db repositories, deleting an entity must set its `deletedAt` timestamp (soft delete) rather than issuing a hard DELETE.  
  scope: packages/db/src/repository/*.repo.ts delete functions
- **kan#R13** (other, must; AGENTS.md:59): In packages/db and packages/api, code that creates, moves or deletes cards must keep card `index` values sequential within each list.  
  scope: packages/db/src/repository/card*.repo.ts, packages/api/src/routers/card*.ts card mutations
- **kan#R14** (calls, must; AGENTS.md:60): In packages/db and packages/api, every card change must be recorded in the `card_activity` table.  
  scope: packages/db/src/repository/**, packages/api/src/routers/** card mutations
- **kan#R15** (file_layout, must; AGENTS.md:64): In packages/api, tRPC routers must be created in files under packages/api/src/routers/.  
  scope: packages/api/src/routers/*.ts tRPC routers
- **kan#R16** (wrapper, must; AGENTS.md:65): In packages/api routers, authenticated endpoints must be built from `protectedProcedure` and public endpoints from `publicProcedure`.  
  scope: packages/api/src/routers/*.ts tRPC procedures
- **kan#R17** (argument, must; AGENTS.md:146): In packages/api routers, every tRPC procedure must validate its input with a Zod schema (`.input(z...)`).  
  scope: packages/api/src/routers/*.ts tRPC procedures
- **kan#R18** (error_handling, must; AGENTS.md:187): In packages/api, errors must be thrown as `TRPCError` with an appropriate code (UNAUTHORIZED, NOT_FOUND, etc.), not plain `Error`.  
  scope: packages/api/src/** tRPC procedures and utils
- **kan#R19** (decorator, must; AGENTS.md:68): In packages/api routers, every tRPC procedure must declare OpenAPI metadata (`.meta({ openapi: ... })`).  
  scope: packages/api/src/routers/*.ts tRPC procedures
- **kan#R20** (calls, must; AGENTS.md:69): In packages/api routers, procedures operating on workspace data must check workspace membership by calling `assertUserInWorkspace`.  
  scope: packages/api/src/routers/*.ts tRPC procedures
- **kan#R21** (calls, must; AGENTS.md:179): In packages/api routers, each procedure must check that the user is authenticated, has access to the workspace, and has permission for the specific operation before performing it.  
  scope: packages/api/src/routers/*.ts tRPC procedures
- **kan#R22** (file_layout, must; AGENTS.md:73): In apps/web, shared React components must be placed under apps/web/src/components/.  
  scope: apps/web/src/components/** React components
- **kan#R23** (file_layout, must; AGENTS.md:74): In apps/web, page-level view components must be placed under apps/web/src/views/.  
  scope: apps/web/src/views/** page-level components
- **kan#R24** (file_layout, must; AGENTS.md:75): In apps/web, custom React hooks must be placed under apps/web/src/hooks/.  
  scope: apps/web/src/hooks/** custom hooks
- **kan#R25** (render, must; AGENTS.md:293): In apps/web, every user-facing string must be wrapped in the Lingui `t` template literal rather than hard-coded.  
  scope: apps/web/src/**/*.tsx components, views and pages
- **kan#R26** (render, must; AGENTS.md:77): In apps/web, components must be styled with Tailwind CSS classes rather than inline styles or separate CSS.  
  scope: apps/web/src/**/*.tsx components
- **kan#R27** (calls, must; AGENTS.md:78): In apps/web, server state and data fetching must use the tRPC React Query hooks (`api.*.useQuery` / `useMutation`) rather than raw fetch or other state libraries.  
  scope: apps/web/src/**/*.tsx components and hooks
- **kan#R28** (calls, must; AGENTS.md:79): In apps/web, modals must be opened and closed through the `useModal` hook.  
  scope: apps/web/src/**/*.tsx components
- **kan#R29** (calls, must; AGENTS.md:80): In apps/web, toast notifications must be shown through the `usePopup` hook.  
  scope: apps/web/src/**/*.tsx components
- **kan#R30** (calls, must; AGENTS.md:136): In packages/db repositories, queries on soft-deletable tables must always filter with `isNull(table.deletedAt)` to exclude deleted rows.  
  scope: packages/db/src/repository/*.repo.ts queries
- **kan#R31** (other, must; AGENTS.md:137): In packages/db schema, every user-facing entity must have a 12-character `publicId` column.  
  scope: packages/db/src/schema/*.ts user-facing tables
- **kan#R32** (avoid, must; AGENTS.md:138): In packages/api and apps/web, code must never expose internal database IDs (`id`, `cardId`, `listId`, etc.) in API inputs/responses, URLs or frontend code; only `publicId` may be used externally.  
  scope: packages/api/src/routers/**, apps/web/src/** API responses, URLs and frontend code
- **kan#R33** (calls, must; AGENTS.md:139): In packages/db and packages/api, multi-step database operations must run inside a database transaction (`db.transaction(...)`).  
  scope: packages/db/src/repository/**, packages/api/src/routers/** multi-step writes
- **kan#R34** (calls, must; AGENTS.md:161): In packages/db and packages/api, updates to card `index` values must always run inside a database transaction.  
  scope: packages/db/src/repository/card*.repo.ts, packages/api/src/routers/card*.ts index updates
- **kan#R35** (other, must; AGENTS.md:158): In card creation code, a new card must be appended at max index + 1 or inserted at a position with following indices shifted.  
  scope: packages/db/src/repository/card*.repo.ts, packages/api/src/routers/card*.ts card creation
- **kan#R36** (other, must; AGENTS.md:160): In card deletion code, the indices of cards after the deleted card in the same list must be decremented.  
  scope: packages/db/src/repository/card*.repo.ts, packages/api/src/routers/card*.ts card deletion
- **kan#R37** (calls, must; AGENTS.md:165): In packages/api and packages/db, card creation, card updates, label/member additions and removals, comments, checklists and items, attachments and due-date changes must each create a card activity record.  
  scope: packages/api/src/routers/**, packages/db/src/repository/** card-related mutations
- **kan#R38** (other, must; AGENTS.md:142): In packages/db/migrations, a migration must be backwards-compatible with the previous release: it must not drop or rename columns/tables still used by running code; add first, drop or rename in a later release.  
  scope: packages/db/migrations/** SQL migrations
- **kan#R39** (file_layout, must; AGENTS.md:243): In packages/db/migrations, schema changes must be made by adding a new migration; existing migration files must never be modified.  
  scope: packages/db/migrations/** migration files
- **kan#R41** (calls, should; AGENTS.md:148): In apps/web, optimistic UI updates must be implemented in the tRPC mutation's `onMutate` callback.  
  scope: apps/web/src/**/*.tsx tRPC mutations
- **kan#R42** (calls, must; AGENTS.md:149): In apps/web, tRPC mutations must invalidate the affected queries (e.g. `utils.*.invalidate()`) after they complete.  
  scope: apps/web/src/**/*.tsx tRPC mutations
- **kan#R43** (calls, must; AGENTS.md:189): In all packages, errors must be logged through the `@kan/logger` package.  
  scope: **/*.{ts,tsx} error handling
- **kan#R44** (error_handling, should; AGENTS.md:190): In apps/web, user-facing errors (e.g. mutation `onError`) should be shown to the user as popup notifications via `usePopup`.  
  scope: apps/web/src/**/*.tsx error handling
- **kan#R45** (import_restriction, must; AGENTS.md:194): In all packages, loggers must be obtained by importing `createLogger` from `@kan/logger`.  
  scope: **/*.{ts,tsx} modules that log
- **kan#R46** (calls, must; AGENTS.md:195): In all packages, a module that logs must create one module-scoped logger with `const logger = createLogger("module-name")`.  
  scope: **/*.{ts,tsx} modules that log
- **kan#R47** (avoid, must; AGENTS.md:198): In all packages, code must never call `console.log`; it must log through the `@kan/logger` logger instead.  
  scope: **/*.{ts,tsx} all files
- **kan#R48** (calls, should; AGENTS.md:219): In packages/db repositories, card queries should load related data (labels, members, checklists) via Drizzle relations (`with: {...}`) rather than separate queries.  
  scope: packages/db/src/repository/*.repo.ts card queries
- **kan#R49** (calls, must; AGENTS.md:220): In packages/db repositories, queries returning cards must order them by `index`.  
  scope: packages/db/src/repository/*.repo.ts card queries
- **kan#R51** (layering, must; AGENTS.md:253): In packages/api and apps/web, new API endpoints must be implemented as tRPC procedures, not hand-written REST handlers.  
  scope: packages/api/src/routers/**, apps/web/src/pages/api/** API endpoints
- **kan#R52** (render, should; AGENTS.md:265): In apps/web, components that fetch data should render loading and error states.  
  scope: apps/web/src/**/*.tsx data-fetching components
- **kan#R54** (testing, should; AGENTS.md:269): In tests, database operations should be tested inside transactions that are rolled back.  
  scope: **/*.test.ts database tests
- **kan#R59** (import_restriction, must; AGENTS.md:300): In every package.json, dependencies on internal @kan/* packages must use the `workspace:*` protocol.  
  scope: **/package.json internal dependencies
- **kan#R60** (other, must; AGENTS.md:302): In every package.json, dependencies shared across packages must use the pnpm `catalog:` version instead of a pinned version.  
  scope: **/package.json shared dependencies
- **kan#R61** (file_layout, must; AGENTS.md:308): In packages/db, new card fields must be added to the cards schema in packages/db/src/schema/cards.ts.  
  scope: packages/db/src/schema/cards.ts card schema
- **kan#R62** (file_layout, must; AGENTS.md:317): In packages/db, new card activity types must be added to the `activityTypes` array in the schema (with a migration updating the enum).  
  scope: packages/db/src/schema/** activity types
- **kan#R65** (avoid, must; tooling/eslint/base.js:18): In apps/web (restrictEnvAccess, all files except **/env.ts), code must not read `process.env`; it must use `import { env } from '~/env'`.  
  scope: apps/web/**/*.{js,ts,tsx} except **/env.ts
- **kan#R66** (import_restriction, must; tooling/eslint/base.js:27): In apps/web (restrictEnvAccess, all files except **/env.ts), code must not import `env` from the `process` module; it must use `import { env } from '~/env'`.  
  scope: apps/web/**/*.{js,ts,tsx} except **/env.ts
- **kan#R67** (avoid, must; tooling/eslint/base.js:58): In all linted packages, code must not have unused variables or arguments, except those whose names start with `_`.  
  scope: apps/web, packages/*, tooling/tailwind **/*.{js,ts,tsx} (excluding **/*.config.*)
- **kan#R68** (typing, should; tooling/eslint/base.js:62): In all linted packages, imports used only as types should use `import type` as separate type-only import statements.  
  scope: apps/web, packages/*, tooling/tailwind **/*.{js,ts,tsx} (excluding **/*.config.*)
- **kan#R69** (avoid, must; tooling/eslint/base.js:66): In all linted packages, promises must not be used where they are not handled (conditions, void-returning callbacks), except that promise-returning functions are allowed as JSX attribute values.  
  scope: apps/web, packages/*, tooling/tailwind **/*.{js,ts,tsx} (excluding **/*.config.*)
- **kan#R70** (typing, must; tooling/eslint/base.js:70): In all linted packages, code must not contain conditions the types prove are always truthy/falsy or unnecessary optional chains, except constant loop conditions such as `while (true)`.  
  scope: apps/web, packages/*, tooling/tailwind **/*.{js,ts,tsx} (excluding **/*.config.*)
- **kan#R71** (avoid, must; tooling/eslint/base.js:76): In all linted packages, code must not use the non-null assertion operator `!`.  
  scope: apps/web, packages/*, tooling/tailwind **/*.{js,ts,tsx} (excluding **/*.config.*)
- **kan#R72** (typing, must; tooling/eslint/base.js:77): In all linted packages, type-only imports must use top-level `import type { X }` rather than inline `import { type X }` specifiers.  
  scope: apps/web, packages/*, tooling/tailwind **/*.{js,ts,tsx} (excluding **/*.config.*)
- **kan#R73** (avoid, should; tooling/eslint/base.js:81): In all linted packages, code must not contain `eslint-disable` directives that do not suppress any reported problem.  
  scope: apps/web, packages/*, tooling/tailwind **/*.{js,ts,tsx}
- **kan#R78** (other, must; packages/email/.react-email/.eslintrc.json:8): In packages/email/.react-email, import statements must be sorted (side-effect, packages, absolute, relative) in a single group with no blank lines between them.  
  scope: packages/email/.react-email/** all files
- **kan#R79** (other, must; packages/email/.react-email/.eslintrc.json:15): In packages/email/.react-email, export statements (`export ... from`) must be sorted.  
  scope: packages/email/.react-email/** all files

## Proposals shown to the user

```text
[D-f314d1] packages/api: exported values in src/schemas/** pass `publicId` to z.object()
    evidence: 28/30 (lower bound 0.79, lift 5.7)
    example:  packages/api/src/schemas/attachment.ts#attachmentConfirmResponseSchema
    outlier:  packages/api/src/schemas/common.ts:27 userSchema
    outlier:  packages/api/src/schemas/workspace.ts:94 workspaceDeleteResponseSchema
    exempt:   packages/api/src/schemas/boardMember.ts:5 boardMemberRoleSchema (does not call z.object())
```

```text
[D-798f44] drizzle models have a `createdAt` field
    evidence: 29/32 (lower bound 0.76, lift 1.0)
    example:  packages/db/src/schema/auth.ts#account
    outlier:  packages/db/src/schema/cards.ts:219 _card_labels
    outlier:  packages/db/src/schema/cards.ts:245 _card_workspace_members
    outlier:  packages/db/src/schema/workspaces.ts:145 workspace_slugs
```

```text
[D-cc5ca5] packages/api: rpc entry points in src/** are wrapped in protectedProcedure()
    evidence: 78/88 (lower bound 0.80, lift 5.1)
    example:  packages/api/src/routers/attachment.ts#MUTATION confirm
    outlier:  packages/api/src/routers/board.ts:247 QUERY bySlug
    outlier:  packages/api/src/routers/board.ts:805 QUERY checkSlugAvailability
    outlier:  packages/api/src/routers/card.ts:746 QUERY byId
    outlier:  packages/api/src/routers/card.ts:856 QUERY getActivities
    outlier:  packages/api/src/routers/health.ts:65 QUERY health
    outlier:  packages/api/src/routers/health.ts:110 QUERY stats
    outlier:  packages/api/src/routers/member.ts:604 MUTATION acceptInviteLink
    outlier:  packages/api/src/routers/member.ts:559 QUERY getInviteByCode
    outlier:  packages/api/src/routers/workspace.ts:226 QUERY bySlug
    outlier:  packages/api/src/routers/workspace.ts:51 QUERY checkSlugAvailability
```

```text
[D-eda068] packages/api: rpc entry points in src/** throw TRPCError
    evidence: 87/88 (lower bound 0.94, lift 4.6)
    example:  packages/api/src/routers/attachment.ts#MUTATION confirm
    outlier:  packages/api/src/routers/health.ts:65 QUERY health
```

```text
[D-11877a] sql models have a `createdAt` field
    evidence: 29/32 (lower bound 0.76, lift 1.0)
    example:  packages/db/migrations/20250508083758_SetupTables.sql#account
    outlier:  packages/db/migrations/20250508083758_SetupTables.sql:142 _card_labels
    outlier:  packages/db/migrations/20250508083758_SetupTables.sql:118 _card_workspace_members
    outlier:  packages/db/migrations/20250508083758_SetupTables.sql:228 workspace_slugs
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "kan#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
