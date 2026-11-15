You are checking whether a tool's proposed conventions for the repository **thunderhub** (https://github.com/apotdevin/thunderhub at `7c9f7354009040cacf51d544c951db809bcf984a`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/thunderhub

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/71419466-78b7-4d7e-841c-fff6debd4a39/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **thunderhub#R01** (avoid, must; AGENTS.md:67 (identical in CLAUDE.md:67)): In src/server/**, code must not read process.env directly outside src/server/config/configuration.ts; configuration must be obtained through the typed ConfigType via @nestjs/config.  
  scope: src/server/** all files
- **thunderhub#R02** (file_layout, should; AGENTS.md:71 (identical in CLAUDE.md:71)): In src/server/modules/api/<domain>/, each GraphQL subdomain must consist of <domain>.module.ts, <domain>.resolver.ts, <domain>.types.ts and optionally <domain>.helpers.ts.  
  scope: src/server/modules/api/** GraphQL domain modules
- **thunderhub#R03** (layering, must; AGENTS.md:72 (identical in CLAUDE.md:72)): In src/server/modules/api/** resolvers, code must call NodeService (the facade) and must not call LndService or other provider services directly.  
  scope: src/server/modules/api/**/*.resolver.ts resolvers
- **thunderhub#R04** (import_restriction, should; AGENTS.md:72 (identical in CLAUDE.md:72)): In src/server/**, the `lightning` npm package should be imported and called only by LndService (src/server/modules/node/lnd/**), not by resolvers or other modules.  
  scope: src/server/** all files
- **thunderhub#R05** (decorator, should; AGENTS.md:74 (identical in CLAUDE.md:74)): In src/server/** resolvers, unauthenticated endpoints must be marked with @Public(), role restrictions with @Roles(...), and the current user must be obtained via the @CurrentUser() parameter decorator rather than reading the GQL context manually.  
  scope: src/server/modules/api/**/*.resolver.ts resolvers
- **thunderhub#R06** (argument, should; AGENTS.md:84 (identical in CLAUDE.md:84)): In src/server/modules/api/** resolvers, calls to NodeService methods must pass the current user's id (user.id from @CurrentUser()) as the first argument.  
  scope: src/server/modules/api/**/*.resolver.ts resolvers
- **thunderhub#R07** (calls, should; AGENTS.md:76 (identical in CLAUDE.md:76)): In src/server/**, requests to external GraphQL APIs should go through graphqlFetchWithProxy() from the fetch module rather than raw fetch/HTTP clients, so SOCKS/Tor proxy settings apply.  
  scope: src/server/** services calling external APIs
- **thunderhub#R08** (error_handling, should; AGENTS.md:91 (identical in CLAUDE.md:91)): In src/server/modules/node/lnd/**, errors from the `lightning` library must be transformed by the to() helper in lnd.helpers.ts rather than handled as raw arrays.  
  scope: src/server/modules/node/lnd/** services
- **thunderhub#R09** (calls, must; AGENTS.md:131 (identical in CLAUDE.md:131)): In src/server/**, LND calls that may fail must be wrapped with toWithError<T>(promise) from utils/async.ts (destructuring [data, error]), or with to<T>(promise) when the error should be thrown.  
  scope: src/server/** services and resolvers calling LND
- **thunderhub#R10** (calls, must; AGENTS.md:132 (identical in CLAUDE.md:132)): In src/server/**, raw `lightning` library calls on an lnd handle must be wrapped with the to() exported from lnd.helpers.ts, not the generic to() from utils/async.ts.  
  scope: src/server/modules/node/lnd/** raw lnd calls
- **thunderhub#R11** (testing, should; AGENTS.md:133 (identical in CLAUDE.md:133)): In src/server/**, unit tests must be named *.spec.ts and placed in the same directory as the file under test.  
  scope: src/server/** test files
- **thunderhub#R12** (render, must; AGENTS.md:137 (identical in CLAUDE.md:137)): In src/client/src/**, new UI components must be built with shadcn/ui (New York style) primitives.  
  scope: src/client/src/** React components
- **thunderhub#R13** (avoid, must; AGENTS.md:137 (identical in CLAUDE.md:137)): In src/client/src/**, code must not add new styled-components (styled.x`...` definitions); use shadcn/ui and Tailwind instead.  
  scope: src/client/src/** React components
- **thunderhub#R14** (import_restriction, must; AGENTS.md:138 (identical in CLAUDE.md:138; also AGENTS.md:101)): In src/client/src/**, imports of client modules must use the @/ path alias rather than relative paths.  
  scope: src/client/src/** all files
- **thunderhub#R15** (other, must; AGENTS.md:139 (identical in CLAUDE.md:139; also AGENTS.md:103)): In src/client/src/**, new shared state must be implemented as two React contexts (state and dispatch) exposed through useXState() and useXDispatch() custom hooks.  
  scope: src/client/src/context/** shared state providers
- **thunderhub#R16** (import_restriction, must; AGENTS.md:140 (identical in CLAUDE.md:140)): In src/client/src/**, icons must come only from lucide-react; other icon libraries must not be imported.  
  scope: src/client/src/** React components
- **thunderhub#R17** (avoid, should; AGENTS.md:102 (identical in CLAUDE.md:102)): In src/client/src/**, runtime configuration must come from the config fetched from /api/config (Config context), not from build-time env vars such as import.meta.env.  
  scope: src/client/src/** all files
- **thunderhub#R18** (file_layout, should; AGENTS.md:104 (identical in CLAUDE.md:104; also AGENTS.md:111)): In src/client/src/graphql/**, GraphQL operations must be defined as gql template literals in .ts files under graphql/queries/ or graphql/mutations/, and components should use the generated typed Apollo hooks from __generated__/*.generated.tsx.  
  scope: src/client/src/graphql/** GraphQL operations
- **thunderhub#R19** (decorator, must; AGENTS.md:110 (identical in CLAUDE.md:110)): In src/server/**, the GraphQL schema must be defined code-first with NestJS GraphQL decorators (@Resolver, @Query, @Mutation, @ObjectType, @Field) rather than hand-written SDL.  
  scope: src/server/modules/api/** resolvers and types
- **thunderhub#R21** (base_class, must; docs/ADDING_A_PROVIDER.md:49): In src/server/modules/node/<type>/, each Lightning provider service must implement the LightningProvider interface from lightning.types.ts.  
  scope: src/server/modules/node/*/*.service.ts provider services
- **thunderhub#R22** (layering, must; docs/ADDING_A_PROVIDER.md:21): In src/server/modules/api/** resolvers, code must never import or call provider services (LndService, other LightningProvider implementations, ProviderRegistryService) directly; all calls go through NodeService.  
  scope: src/server/modules/api/**/*.resolver.ts resolvers
- **thunderhub#R23** (file_layout, should; docs/ADDING_A_PROVIDER.md:38): In src/server/modules/node/, each provider must live in its own <type>/ directory containing <type>.module.ts, <type>.service.ts and optionally <type>.helpers.ts.  
  scope: src/server/modules/node/*/ provider directories
- **thunderhub#R24** (decorator, should; docs/ADDING_A_PROVIDER.md:65): In src/server/modules/node/<type>/, provider service classes should be decorated with @Injectable() and exported from a NestJS @Module that lists them in providers and exports.  
  scope: src/server/modules/node/*/*.service.ts and *.module.ts
- **thunderhub#R25** (argument, must; docs/ADDING_A_PROVIDER.md:99): In src/server/modules/node/<type>/ provider services, every LightningProvider method must take the connection object returned by connect() as its first parameter.  
  scope: src/server/modules/node/*/*.service.ts provider methods
- **thunderhub#R26** (error_handling, should; docs/ADDING_A_PROVIDER.md:101): In src/server/modules/node/<type>/ provider services, LightningProvider methods that are not supported must throw an Error (e.g. '<method> is not supported by <type>') and the matching capability must be omitted from getCapabilities().  
  scope: src/server/modules/node/*/*.service.ts provider methods
- **thunderhub#R28** (typing, should; docs/ADDING_A_PROVIDER.md:129): In src/server/modules/node/<type>/ provider services, the connection parameter should be typed with the concrete client type rather than any.  
  scope: src/server/modules/node/*/*.service.ts provider methods
- **thunderhub#R30** (other, should; docs/ADDING_A_PROVIDER.md:27): In src/server/modules/node/, every provider type must have a constant in the NodeType object in lightning.types.ts and be referenced via NodeType rather than string literals.  
  scope: src/server/modules/node/lightning.types.ts and provider code
- **thunderhub#R31** (other, must; docs/ADDING_A_PROVIDER.md:153): In src/server/modules/node/provider-registry.service.ts and provider-registry.module.ts, every LightningProvider service must be injected and registered in ProviderRegistryService (this.providers.set(NodeType.X, service)) and its module imported in ProviderRegistryModule.  
  scope: src/server/modules/node/provider-registry.*
- **thunderhub#R32** (typing, should; docs/ADDING_A_PROVIDER.md:213): In src/server/modules/files/files.types.ts, account config fields must be declared on AccountType and UnresolvedAccountType (and ParsedAccount when passed to the service).  
  scope: src/server/modules/files/files.types.ts types
- **thunderhub#R37** (avoid, must; eslint.config.js:51): In all linted TS/TSX files, code must not declare unused variables, parameters or imports.  
  scope: {src,apps,libs,test}/**/*.{ts,tsx} all files

## Proposals shown to the user

(none)

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "thunderhub#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
