You are checking whether a tool's proposed conventions for the repository **dyrectorio** (https://github.com/dyrector-io/dyrectorio at `98fe402eb61b88e5472dd3008cabc59d2ebce60b`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/dyrectorio

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/50359ec9-6a75-473f-820b-ad0ed9ab6e01/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **dyrectorio#R02** (avoid, must; web/crux-ui/eslint.config.js:79): In web/crux-ui, code must not call console.log (or other console methods); only console.error, console.trace, console.info, console.debug and console.warn are allowed.  
  scope: web/crux-ui/** all JS/TS files
- **dyrectorio#R10** (render, must; web/crux-ui/eslint.config.js:92): In web/crux-ui, class components with optional (non-required) props must define defaultProps for them; functional components are exempt.  
  scope: web/crux-ui/** React class components
- **dyrectorio#R16** (avoid, must; web/crux-ui/eslint.config.js:103): In web/crux-ui, code must not contain unused expression statements, except ternary expressions used as statements.  
  scope: web/crux-ui/** TS files
- **dyrectorio#R17** (naming, must; web/crux-ui/eslint.config.js:104): In web/crux-ui, code must not have unused variables or arguments; intentionally unused arguments must be prefixed with an underscore (_).  
  scope: web/crux-ui/** TS files
- **dyrectorio#R20** (error_handling, must; web/crux-ui/eslint.config.js:107): In web/crux-ui, promises must not be left floating; every Promise must be awaited, returned, or handled with .catch/.then rejection handler (or explicitly voided).  
  scope: web/crux-ui/** TS files
- **dyrectorio#R31** (import_restriction, must; web/crux-ui/eslint.config.js:118): In web/crux-ui, code must not import sub-paths of @app/validations (e.g. @app/validations/common); it must import from '@app/validations' (src/validations/index.ts) so yup localizations work.  
  scope: web/crux-ui/** TS/TSX files
- **dyrectorio#R32** (render, must; web/crux-ui/eslint.config.js:129): In web/crux-ui, React components must not be defined inside other components' render bodies, except when passed as props (allowAsProps).  
  scope: web/crux-ui/** React components
- **dyrectorio#R36** (error_handling, must; web/crux/.eslintrc.js:24): In web/crux, promises must not be left floating; every Promise must be awaited, returned, or have its rejection handled (or be explicitly voided).  
  scope: web/crux/** TS files
- **dyrectorio#R42** (naming, must; web/crux/.eslintrc.js:32): In web/crux, identifiers must not have leading or trailing underscores, except `_count` (Prisma's count field).  
  scope: web/crux/** TS files
- **dyrectorio#R52** (import_restriction, must; web/crux/.eslintrc.js:42): In web/crux, all import statements must come before any other statements in a module.  
  scope: web/crux/** TS files
- **dyrectorio#R53** (other, must; web/crux/.eslintrc.js:43): In web/crux, the last import statement must be followed by a blank line.  
  scope: web/crux/** TS files
- **dyrectorio#R54** (import_restriction, must; web/crux/.eslintrc.js:44): In web/crux, a module must not be imported more than once in the same file (merge duplicate imports).  
  scope: web/crux/** TS files
- **dyrectorio#R56** (naming, must; protobuf/README.md:24): In protobuf/**/*.proto, messages used as RPC method arguments must have 'Request' in their name.  
  scope: protobuf/** proto message definitions
- **dyrectorio#R57** (naming, must; protobuf/README.md:25): In protobuf/**/*.proto, messages returned by RPC methods must have 'Response' in their name.  
  scope: protobuf/** proto message definitions
- **dyrectorio#R58** (naming, must; protobuf/README.md:26): In protobuf/**/*.proto, messages used in streams must have 'Message' in their name.  
  scope: protobuf/** proto message definitions
- **dyrectorio#R59** (naming, should; protobuf/README.md:27): In protobuf/**/*.proto, messages used as elements of repeated fields may use the 'Item' name affix.  
  scope: protobuf/** proto message definitions
- **dyrectorio#R60** (naming, should; protobuf/README.md:28): In protobuf/**/*.proto, messages whose main data is a repeated field may use the 'List' name affix.  
  scope: protobuf/** proto message definitions
- **dyrectorio#R61** (other, must; protobuf/README.md:32): In protobuf/**/*.proto messages, regular (non-oneof, non-repeated) fields must use field numbers 100-199.  
  scope: protobuf/** proto message fields
- **dyrectorio#R62** (other, must; protobuf/README.md:33): In protobuf/**/*.proto messages, oneof fields must use field numbers 200-999, usually partitioned in blocks of 100 per oneof.  
  scope: protobuf/** proto message fields
- **dyrectorio#R63** (other, must; protobuf/README.md:34): In protobuf/**/*.proto messages, repeated (list) fields must use field numbers 1000-1999.  
  scope: protobuf/** proto message fields
- **dyrectorio#R64** (other, must; protobuf/README.md:38): In protobuf/**/*.proto request and stream Message messages, field 1 must be `id` (resource identifier) and field 2 must be `accessedBy` (kratos id of the requesting user).  
  scope: protobuf/** request / stream message definitions
- **dyrectorio#R65** (other, must; protobuf/README.md:43): In protobuf/**/*.proto response and stream Message messages, field 1 must be `id` (resource identifier) and field 2 must be `audit` (creation/update timestamps and kratos ids).  
  scope: protobuf/** response / stream message definitions
- **dyrectorio#R66** (file_layout, should; web/crux/README.md:15): In web/crux/src/app, each domain model must have its own folder containing its service, controller and repository services.  
  scope: web/crux/src/app/** NestJS modules
- **dyrectorio#R67** (import_restriction, must; .golangci.yml:46): In Go code, the standard library `log` package must not be imported; logging must use github.com/rs/zerolog.  
  scope: golang/** Go source files
- **dyrectorio#R68** (avoid, must; .golangci.yml:56): In Go code, the builtin print/println functions (identifiers matching ^print.*$) must not be called.  
  scope: golang/** Go source files
- **dyrectorio#R69** (avoid, must; .golangci.yml:57): In Go code (including godoc examples), fmt.Print, fmt.Printf and fmt.Println must not be called.  
  scope: golang/** Go source files
- **dyrectorio#R70** (avoid, must; .golangci.yml:17): In Go code, packages must not define init() functions.  
  scope: golang/** Go source files
- **dyrectorio#R71** (other, must; .golangci.yml:43): In Go code, switch statements marked with //exhaustive:enforce over enum types must cover all enum members, or include a default case.  
  scope: golang/** Go switch statements
- **dyrectorio#R72** (other, must; .golangci.yml:59): In Go code, functions must not exceed 100 lines or 50 statements.  
  scope: golang/** Go functions
- **dyrectorio#R73** (other, must; .golangci.yml:80): In Go code, functions must have cyclomatic complexity below 15.  
  scope: golang/** Go functions
- **dyrectorio#R74** (other, must; .golangci.yml:84): In Go code, lines must not exceed 140 characters.  
  scope: golang/** Go source files
- **dyrectorio#R75** (avoid, must; .golangci.yml:88): In Go code, magic numbers must not be used as function arguments, case values, conditions or return values; use named constants.  
  scope: golang/** Go source files
- **dyrectorio#R77** (other, must; .golangci.yml:94): In Go code, //nolint directives must not be unused (must actually suppress an issue); they need not name a specific linter or include an explanation.  
  scope: golang/** Go source files
- **dyrectorio#R79** (other, must; .golangci.yml:74): In Go code, all gocritic diagnostic, experimental, opinionated, performance and style checks must pass.  
  scope: golang/** Go source files
- **dyrectorio#R80** (other, must; .golangci.yml:52): In Go code, duplicated code blocks of 100+ tokens must not exist.  
  scope: golang/** Go source files
- **dyrectorio#R81** (avoid, must; .golangci.yml:64): In Go code, string literals of length 2+ repeated 2 or more times must be extracted into constants.  
  scope: golang/** Go source files
- **dyrectorio#R84** (naming, must; .golangci.yml:86): In Go code, comments and strings must use US English spelling.  
  scope: golang/** Go source files
- **dyrectorio#R85** (other, must; .golangci.yml:82): In Go code, all go vet analyzers (including fieldalignment and shadow) must pass.  
  scope: golang/** Go source files
- **dyrectorio#R86** (other, must; .golangci.yml:98): In Go code, all staticcheck checks must pass.  
  scope: golang/** Go source files
- **dyrectorio#R87** (error_handling, must; .golangci.yml:12): In Go code, returned errors must not be silently ignored.  
  scope: golang/** Go source files
- **dyrectorio#R88** (naming, must; .golangci.yml:13): In Go code, sentinel error variables must be named ErrXxx and error types must be named XxxError.  
  scope: golang/** Go error declarations
- **dyrectorio#R89** (error_handling, must; .golangci.yml:30): In Go code, a function must not return nil after checking that err != nil (or return an error when err is nil).  
  scope: golang/** Go source files
- **dyrectorio#R90** (calls, must; .golangci.yml:31): In Go code, HTTP requests must be created with a context.Context (e.g. http.NewRequestWithContext), not http.Get/NewRequest without context.  
  scope: golang/** Go source files
- **dyrectorio#R91** (error_handling, must; .golangci.yml:6): In Go code, HTTP response bodies must be closed.  
  scope: golang/** Go source files
- **dyrectorio#R92** (error_handling, must; .golangci.yml:34): In Go code, sql.Rows.Err must be checked after iterating rows.  
  scope: golang/** Go source files
- **dyrectorio#R93** (avoid, must; .golangci.yml:29): In Go code, naked returns must not be used in long functions.  
  scope: golang/** Go functions
- **dyrectorio#R94** (avoid, must; .golangci.yml:9): In Go code, assignments must not use too many blank identifiers (e.g. x, _, _, _ := f()).  
  scope: golang/** Go source files
- **dyrectorio#R95** (avoid, must; .golangci.yml:22): In Go code, gosec security checks (hardcoded credentials, unsafe file perms, weak crypto, SQL injection etc.) must pass.  
  scope: golang/** Go source files
- **dyrectorio#R96** (testing, must; .golangci.yml:36): In Go tests, test helper functions must call t.Helper() first and take *testing.T as the first parameter named t.  
  scope: golang/**/*_test.go test helpers
- **dyrectorio#R97** (testing, must; .golangci.yml:40): In Go tests, testing helpers (t.TempDir, t.Setenv, t.Context) must be used instead of os.MkdirTemp, os.Setenv, context.Background.  
  scope: golang/**/*_test.go
- **dyrectorio#R98** (avoid, must; .golangci.yml:7): In Go code, loop variables must not be redundantly copied (x := x) inside loops.  
  scope: golang/** Go source files
- **dyrectorio#R99** (avoid, must; .golangci.yml:11): In Go code, two time.Duration values must not be multiplied together.  
  scope: golang/** Go source files
- **dyrectorio#R100** (naming, must; .golangci.yml:21): In Go code, printf-like functions must have names ending in 'f'.  
  scope: golang/** Go functions
- **dyrectorio#R101** (naming, must; .golangci.yml:5): In Go code, identifiers must contain only ASCII characters.  
  scope: golang/** Go source files
- **dyrectorio#R102** (import_restriction, must; .golangci.yml:23): In Go code, imports must use the configured consistent aliases (importas linter enabled).  
  scope: golang/** Go source files
- **dyrectorio#R103** (avoid, must; .golangci.yml:24): In Go code, assignments to variables that are never subsequently used must not occur.  
  scope: golang/** Go source files
- **dyrectorio#R104** (naming, must; .golangci.yml:33): In Go code, revive's default style rules (exported docs, naming, receiver names, error strings, etc.) must pass.  
  scope: golang/** Go source files
- **dyrectorio#R105** (avoid, must; .golangci.yml:37): In Go code, unnecessary type conversions must not be used.  
  scope: golang/** Go source files
- **dyrectorio#R106** (avoid, must; .golangci.yml:38): In Go code, functions must not have parameters that are unused or always receive the same value, or results that are always the same.  
  scope: golang/** Go functions
- **dyrectorio#R107** (avoid, must; .golangci.yml:39): In Go code, unused constants, variables, functions and types must not exist.  
  scope: golang/** Go source files

## Proposals shown to the user

```text
[D-d30c46] web/crux: classes in src/** (*.service files) are named `*Service`
    evidence: 32/33 (lower bound 0.85, lift 13.5)
    example:  web/crux/src/app/agent/agent.service.ts#AgentService
    outlier:  web/crux/src/app/container/container-config.http.service.ts:30 ContainerConfigHttpController
```

```text
[D-a7301b] web/crux: HTTP handlers in src/** (*.controller files) are decorated with ApiForbiddenResponse()
    evidence: 122/123 (lower bound 0.95, lift 5.1)
    example:  web/crux/src/app/config.bundle/config.bundle.http.controller.ts#DELETE /
    outlier:  web/crux/src/app/health/health.http.controller.ts:16 GET /
```

```text
[D-d1c643] web/crux: classes in src/** (*.interceptor files) are named `*Interceptor`
    evidence: 25/27 (lower bound 0.77, lift 15.9)
    example:  web/crux/src/app/audit.logger/audit.logger.interceptor.ts#AuditLoggerInterceptor
    outlier:  web/crux/src/app/version/interceptors/version.increase.interceptor.ts:8 VersionIncreaseValidationPipe
    outlier:  web/crux/src/interceptors/helper.interceptor.ts:15 InterceptorGrpcHelperProvider
```

```text
[D-00b847] web/crux: HTTP handlers in src/** (*.controller files) are decorated with HttpCode()
    evidence: 120/123 (lower bound 0.93, lift 5.1)
    example:  web/crux/src/app/config.bundle/config.bundle.http.controller.ts#DELETE /
    outlier:  web/crux/src/app/health/health.http.controller.ts:16 GET /
    outlier:  web/crux/src/app/node/node.http.controller.ts:211 GET / #3
    outlier:  web/crux/src/app/version/version.http.controller.ts:88 GET / #2
```

```text
[D-69c688] web/crux: HTTP handlers in src/** (*.controller files) pass `summary` to ApiOperation()
    evidence: 122/123 (lower bound 0.95, lift 5.1)
    example:  web/crux/src/app/config.bundle/config.bundle.http.controller.ts#DELETE /
    outlier:  web/crux/src/app/quality.assurance/quality-assurance.http.controller.ts:13 GET /
```

```text
[D-8e0acd] web/crux: classes in src/** (*.dto files) are named `*Dto`
    evidence: 192/198 (lower bound 0.94, lift 2.3)
    example:  web/crux/src/app/audit/audit.dto.ts#AuditDto
    outlier:  web/crux/src/app/deploy/deploy.dto.ts:334 DeploymentLogPaginationQuery
    outlier:  web/crux/src/app/image/image.dto.ts:33 ImageValidation
    outlier:  web/crux/src/app/node/node.dto.ts:53 BasicNodeWithStatus
    outlier:  web/crux/src/app/node/node.dto.ts:197 ContainerPort
    outlier:  web/crux/src/app/node/node.dto.ts:275 NodeContainerLogQuery
    outlier:  web/crux/src/app/version/version.dto.ts:97 VersionListQuery
```

```text
[D-6e19cf] web/crux-ui: functions in src/components/** declare their return type
    evidence: 43/49 (lower bound 0.76, lift 1.9)
    example:  web/crux-ui/src/components/composer/use-composer-state.ts#activateBottomSection
    outlier:  web/crux-ui/src/components/composer/use-composer-state.ts:374 selectDefaultEnvironment
    outlier:  web/crux-ui/src/components/composer/use-composer-state.ts:377 selectShowDefaultEnvironment
    outlier:  web/crux-ui/src/components/composer/use-composer-state.ts:381 useComposerState
    outlier:  web/crux-ui/src/components/editor/use-multi-input-state.ts:17 DEFAULT_EDITOR_COMPARATOR
    outlier:  web/crux-ui/src/components/projects/versions/use-version-hint.ts:5 useVersionHint
    outlier:  web/crux-ui/src/components/projects/versions/version-sections.tsx:16 parseVersionSectionState
```

```text
[D-883d32] web/crux: HTTP handlers in src/** (*.controller files) are decorated with UseGuards()
    evidence: 112/123 (lower bound 0.85, lift 5.1)
    example:  web/crux/src/app/config.bundle/config.bundle.http.controller.ts#DELETE /
    outlier:  web/crux/src/app/audit/audit.http.controller.ts:15 GET /
    outlier:  web/crux/src/app/dashboard/dashboard.http.controller.ts:15 GET /
    outlier:  web/crux/src/app/health/health.http.controller.ts:16 GET /
    outlier:  web/crux/src/app/quality.assurance/quality-assurance.http.controller.ts:13 GET /
    outlier:  web/crux/src/app/team/user.http.controller.ts:63 DELETE /
    outlier:  web/crux/src/app/team/user.http.controller.ts:91 DELETE / #2
    outlier:  web/crux/src/app/team/user.http.controller.ts:34 POST /
    outlier:  web/crux/src/app/team/user.http.controller.ts:48 POST / #2
    outlier:  web/crux/src/app/team/user.http.controller.ts:78 PUT /
    outlier:  web/crux/src/app/template/template.http.controller.ts:57 GET /
    outlier:  web/crux/src/app/template/template.http.controller.ts:96 GET / #2
```

```text
[D-e995bd] web/crux-ui: components in src/** do not use requests to computed URLs
    evidence: 189/195 (lower bound 0.94, lift 9.8)
    example:  web/crux-ui/src/components/composer/compose-environment.tsx#ComposeEnvironment
    outlier:  web/crux-ui/src/components/deployments/edit-deployment-card.tsx:33 EditDeploymentCard
    outlier:  web/crux-ui/src/components/nodes/dyo-node-setup.tsx:40 DyoNodeSetup
    outlier:  web/crux-ui/src/components/nodes/edit-node-section.tsx:36 EditNodeSection
    outlier:  web/crux-ui/src/components/nodes/node-audit-list.tsx:38 NodeAuditList
    outlier:  web/crux-ui/src/components/pipelines/pipeline-run-list.tsx:22 PipelineRunList
    outlier:  web/crux-ui/src/components/projects/versions/version-deployments-section.tsx:71 VersionDeploymentsSection
```

```text
[D-e10325] web/crux-ui: pages in src/** are named `*Page`
    evidence: 35/38 (lower bound 0.79, lift 4.6)
    example:  web/crux-ui/src/pages/[teamSlug]/audit-log.tsx#AuditLogPage
    outlier:  web/crux-ui/src/pages/404.tsx:9 Page404
    outlier:  web/crux-ui/src/pages/500.tsx:8 Page500
    outlier:  web/crux-ui/src/pages/[teamSlug]/config-bundles.tsx:27 ConfigBundles
```

```text
[D-7333aa] web/crux: classes in src/** (*.controller files) are decorated with ApiTags()
    evidence: 21/22 (lower bound 0.78, lift 19.4)
    example:  web/crux/src/app/audit/audit.http.controller.ts#AuditController
    outlier:  web/crux/src/app/agent/agent.grpc.controller.ts:33 AgentController
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "dyrectorio#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
