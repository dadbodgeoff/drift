You are labelling proposed coding conventions for the repository **polar** (https://github.com/polarsource/polar at commit `d14892d27cf346f70e44e36ca5601577e6313b6d`).

A checkout of the repository at that commit is at:

    /tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/repos/polar

## Rules for this task

1. **Work only from the repository checkout.**
   - Read files, and search with grep, find or ripgrep, inside `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/repos/polar`.
   - Do not modify anything there.
   - Do not install dependencies, run builds, or access the network.
2. **Do not open anything outside `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/repos/polar`,** except for writing your output file. In particular, do not look for:
   - the tool that produced these proposals, or its source code or documentation;
   - other people's labels, or earlier studies;
   - anything on the internet.
3. **Ignore a `.drift/` directory if one exists in the checkout.** It is a cache of the tool, not part of the project.
4. **Label every proposal independently,** following the rubric below exactly.
   - Open the files the rubric requires before deciding: the example, at least three outliers, at least two other members, and the lint or compiler config when TRIVIAL is in question.
   - List every file you opened in `checked`.
5. **Write your labels to `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/outbox/9bf1abc1-2551-4029-a42a-7e040e133d2d/out.jsonl`:**
   - one JSON object per line;
   - exactly one line for each of the 15 proposals;
   - no other text in the file.
   The directory already exists. If you stop early, the lines you wrote must still be valid.
6. **When you finish, reply with one line:** the number of proposals labelled, and the count of each label. Do not repeat the reasons.

## Rubric

### Labelling rubric v2: proposed codebase conventions

#### The setting

A tool read a repository and proposed **conventions**: rules that most code in one part of the repository follows. Each proposal shows:

- the rule, scoped to a group of code (a *role*), such as "HTTP handlers in `app/api/**`";
- its evidence: how many members of the group follow it, out of how many;
- an example member;
- the outliers: members that do not follow it.

Imagine you are a senior maintainer of this repository. The tool would let you accept a convention, so that **new** code in that part of the repository (often written by AI coding agents) is checked against it. Accepted conventions show warnings, and they can block an edit.

#### What to open before deciding

Judge from the repository, not from the rule text. Before labelling, open:

1. **the example member's file;**
2. **at least three outliers' files** (all of them if there are fewer), at the line shown;
3. **at least two other members** that follow the rule, chosen by you, not the example, in two files other than the example's and the outliers';
4. **the repository's lint and compiler config, when TRIVIAL is in question:**
   - eslint (`eslint.config.*`, `.eslintrc*`, the `eslintConfig` key of `package.json`), oxlint (`.oxlintrc.json`) or biome (`biome.json[c]`), including any config they extend from inside the repository;
   - for Python: ruff, flake8, pylint, mypy or import-linter (`ruff.toml`, `.flake8`, `.pylintrc`, `mypy.ini`, `.importlinter`, or their sections in `pyproject.toml` / `setup.cfg`);
   - `tsconfig*.json`;
   - for frameworks, what the framework requires (Nest modules, Next.js file conventions).

List every file you opened in `checked`, as repository-relative paths.

#### Decide in this order

##### Q1. Is the rule true?

- Does the example follow it?
- Do the members you sampled follow it?
- Does the rule describe the group correctly?
- Do the outliers you opened really break it?

Label **WRONG** if any of these holds:

- the rule is false for the example or for the members (`wrong_because: "misdescribes"`);
- more than half of the outliers you opened actually follow the rule, because the tool misread the code (`"false_outliers"`).

##### Q2. Would a tool already catch a violation?

**Which violation.** Imagine a new member of the group that breaks the rule **the way the outliers you opened break it**. For example, if the outliers are classes that simply don't extend `BaseController`, imagine another such class, not a subclass missing a method. If the proposal has no outliers, imagine the simplest violation: the member without the required wrapper, decorator, base class, argument or name.

Label **TRIVIAL** if one of these would catch that violation, without anyone reviewing the code:

| `trivial_by` | Would be caught by | Example |
| --- | --- | --- |
| `build` | the build or bundler failing | a Next.js `page` file without a default export |
| `types` | the type checker, with the repository's tsconfig (or mypy/pyright config) | a value passed where the declared type requires the missing property |
| `framework` | the framework at startup or on first request: it refuses to run, or the member is never registered | a Nest provider missing `@Injectable()` when it has constructor dependencies; a route file not exporting a handler |
| `lint` | an **enabled** lint rule in the repository's own config, at `error`, or at `warn` when CI or a pre-commit hook fails on warnings (for example `--max-warnings 0`) | `no-restricted-imports` forbidding exactly this import; `@typescript-eslint/no-explicit-any: "error"` |
| `tautology` | the definition of the group itself: breaking it would make the member not belong to the group | "dialogs render `<Dialog>`", when "dialog" is defined by rendering one |

**Evidence.**

- Record what catches it in `trivial_evidence`: the config file and rule, or the error the framework raises.
- For `lint`, also record `lint_severity`:
  - `"error"`;
  - `"warn_enforced"`, citing the CI or hook line that fails on warnings in `trivial_evidence`.

  A `warn` rule that nothing enforces is **not** TRIVIAL. Go on to Q3.
- Each of these needs evidence you saw in the repository. "Probably linted" is not evidence: open the config.

**Check against the outliers.** The outliers are real members that break the rule. If a tool really caught the violation, they could not exist, unless the tool does not see them. So label TRIVIAL by a tool only if every outlier you opened is one of these:

- suppressed: `eslint-disable`, `@ts-expect-error`, `# noqa`, `# type: ignore`;
- outside the tool's scope: lint `overrides`, `ignorePatterns` or `exclude`, or a tsconfig that does not include the file;
- not a real violation (see Q1).

An outlier that the tool would flag, but that exists in the repo unsuppressed, is evidence that the tool does **not** catch the violation in practice. Go on to Q3.

**`use*` naming of hooks is not `framework`.** React runs a hook-calling function named `getFoo` without complaint. Only `eslint-plugin-react-hooks` (`react-hooks/rules-of-hooks`) catches a hook that calls hooks without a `use*` name. So "functions in `hooks/` are named `use*`" can be TRIVIAL only by `lint`, and only when that rule is enabled in the repo's config. Without it, go on to Q3. If the outliers are helpers that call no hooks, consider `mixed_group` there.

**Not TRIVIAL.**

- Something that is "obvious" but no tool catches is **not** TRIVIAL. Go on to Q3.
- If the repository's config turns **off** the lint rule that would enforce this (for example `no-explicit-any: "off"`), the team chose not to enforce it. Label **WRONG** with `wrong_because: "team_disabled"`, unless this part of the code clearly differs from the rest.

##### Q3. Would flagging a new violation be a useful review comment?

Picture an agent adding a new member of this group that breaks the rule, resembling the outliers you saw. The tool warns. Would a maintainer think that warning was worth it most of the time? That is, is the violation a mistake, or at least worth a second look in review?

Label **ACCEPT** if yes. Typical ACCEPTs:

- an auth or permission wrapper;
- a required base class, decorator or argument;
- a layering boundary;
- a shared helper everyone is meant to use;
- a naming scheme the team chose.

For security-relevant rules (authentication, authorization, input validation), legitimate exceptions do not make the rule WRONG. A public webhook that skips the auth wrapper is still worth confirming. Label ACCEPT when the exceptions are the kind a reviewer would want to confirm.

Otherwise label **WRONG** and say why:

| `wrong_because` | Meaning |
| --- | --- |
| `mixed_group` | The group mixes unlike things, so the rule should not apply to a large part of it. Examples: co-located helpers in hook files, re-exports, base or abstract classes next to their subclasses, generated files, examples or fixtures mined as production code. |
| `legit_outliers` | The outliers are legitimately different, as a **recurring category**, and new members of that category would get false alarms. Examples: email routes that must import React, read-only endpoints without a body schema. |
| `incidental` | True, but a coincidence or a consequence of what the code does, not a choice. For example, "components call `useState`": new members that don't need state would be flagged for nothing. |

##### Clear?

Separately, say whether a developer reading only the rule's wording would know what to do: `clear: true/false`.

#### Output

One JSON object per proposal, one per line (JSONL). Field order does not matter. The examples below are made up: the repository `acme-shop` does not exist.

```json
{"uid": "acme-shop/D-0a1b2c", "rubric": "v2",
 "label": "ACCEPT", "trivial_by": null, "trivial_evidence": null, "lint_severity": null, "wrong_because": null,
 "clear": true, "confidence": "high",
 "checked": ["api/orders/list.ts", "api/orders/refund.ts", "api/health.ts", "api/orders/create.ts", "api/carts/get.ts", "lib/auth.ts"],
 "outliers": [{"symbol": "refund", "verdict": "mistake"}, {"symbol": "health", "verdict": "legit"}],
 "reason": "Order handlers call requireShopUser() first (list.ts, create.ts); refund.ts skips it and reads another shop's order, while health.ts is a public probe.",
 "defects": ["api/orders/refund.ts:12 refund handler has no requireShopUser() check"]}
{"uid": "acme-shop/D-3d4e5f", "rubric": "v2",
 "label": "TRIVIAL", "trivial_by": "lint", "trivial_evidence": "eslint.config.js: no-restricted-imports error for 'lodash' (use lodash-es); the one outlier has an eslint-disable-next-line", "lint_severity": "error", "wrong_because": null,
 "clear": true, "confidence": "high",
 "checked": ["eslint.config.js", "web/cart.tsx", "web/legacy/export.ts", "web/search.tsx", "web/checkout.tsx"],
 "reason": "The import ban is already an error in eslint.config.js; the outlier in legacy/export.ts suppresses it explicitly."}
{"uid": "acme-shop/D-6a7b8c", "rubric": "v2",
 "label": "WRONG", "trivial_by": null, "trivial_evidence": null, "lint_severity": null, "wrong_because": "incidental",
 "clear": true, "confidence": "low",
 "checked": ["web/cart.tsx", "web/footer.tsx", "web/badge.tsx", "web/logo.tsx", "web/search.tsx", "web/checkout.tsx"],
 "outliers": [{"symbol": "Footer", "verdict": "legit"}, {"symbol": "Badge", "verdict": "legit"}, {"symbol": "Logo", "verdict": "legit"}],
 "reason": "Components call useState because most of them hold state (cart.tsx); the outliers are stateless (footer.tsx, badge.tsx), so new stateless components would be flagged for nothing. Hesitated with ACCEPT."}
```

Write only the fields below.

| Field | Required | Values |
| --- | --- | --- |
| `uid` | yes | as given in the proposal header |
| `rubric` | yes | `"v2"` |
| `label` | yes | `ACCEPT`, `TRIVIAL` or `WRONG` |
| `trivial_by` | if TRIVIAL | `build`, `types`, `framework`, `lint` or `tautology` |
| `trivial_evidence` | if TRIVIAL by a tool | the config file and rule, or the error; for `warn_enforced`, also the CI or hook line |
| `lint_severity` | if TRIVIAL by `lint` | `error` or `warn_enforced` |
| `wrong_because` | if WRONG | `misdescribes`, `false_outliers`, `mixed_group`, `legit_outliers`, `incidental` or `team_disabled` |
| `clear` | yes | `true` or `false` |
| `confidence` | yes | `high`, or `low` when you hesitated between two labels (name both in `reason`) |
| `checked` | yes | the repo-relative files you opened: <ul><li>the example's file;</li><li>at least 3 outliers' files (all if fewer);</li><li>at least 2 further files with other members;</li><li>configs.</li></ul> `collect.mjs` rejects a list that misses these. |
| `outliers` | recommended | one entry per outlier opened, with `verdict`: <ul><li>`mistake`</li><li>`look` (worth a second look)</li><li>`legit` (legitimately different)</li><li>`not_violation` (it actually follows the rule)</li></ul> |
| `reason` | yes | one or two sentences citing what you saw in specific files |
| `defects` | optional | outliers that look like real bugs in the project, with file:line |

Decide each proposal on its own merits. There is no expected distribution of labels.

## The proposals (15)

Each proposal starts with its `uid`. Copy it exactly into your output.

### uid: polar/D-999ecc

```text
[D-999ecc] server: functions in polar/** (tasks files) pass `priority` to actor()
    evidence: 174/179 (lower bound 0.94, lift 18.3)
    example:  server/polar/auth/tasks.py#auth_delete_expired
    outlier:  server/polar/integrations/stripe/tasks.py:41 stripe_api_connection_error_retry
    outlier:  server/polar/integrations/tinybird/tasks.py:35 ingest
    outlier:  server/polar/support_case/tasks.py:69 notify_organization_of_new_message
    outlier:  server/polar/webhook/tasks.py:40 sign_webhook
    outlier:  server/polar/webhook/tasks.py:66 webhook_event_send
```

### uid: polar/D-27ad3b

```text
[D-27ad3b] clients/apps/web: pages in src/app/(main)/dashboard/[*]/** (page files) call getServerSideAPI()
    evidence: 49/55 (lower bound 0.78, lift 18.9)
    example:  clients/apps/web/src/app/(main)/dashboard/[organization]/(header)/(home)/page.tsx#Page
    outlier:  clients/apps/web/src/app/(main)/dashboard/[organization]/(header)/customers/[customerId]/events/page.tsx:16 Page
    outlier:  clients/apps/web/src/app/(main)/dashboard/[organization]/(header)/customers/[customerId]/members/page.tsx:17 Page
    outlier:  clients/apps/web/src/app/(main)/dashboard/[organization]/(header)/customers/[customerId]/page.tsx:16 Page
    outlier:  clients/apps/web/src/app/(main)/dashboard/[organization]/(header)/customers/[customerId]/usage/page.tsx:16 Page
    outlier:  clients/apps/web/src/app/(main)/dashboard/[organization]/cli/token/page.tsx:8 Page
    outlier:  clients/apps/web/src/app/(main)/dashboard/[organization]/onboarding/integrate/page.tsx:3 Page
```

### uid: polar/D-fba5aa

```text
[D-fba5aa] server: classes in polar/** (schemas files) do not use `any`
    evidence: 898/924 (lower bound 0.96, lift 3.9)
    example:  server/polar/account/schemas.py#Account
    outlier:  server/polar/auth/schemas.py:62 AuthenticationSession
    outlier:  server/polar/benefit/strategies/downloadables/schemas.py:46 BenefitDownloadablesSubscriberProperties
    outlier:  server/polar/checkout/schemas.py:406 CheckoutProductsExternalCreate
    outlier:  server/polar/cli/schemas.py:17 TriggerRequest
    outlier:  server/polar/cli/schemas.py:36 TriggerResponse
    outlier:  server/polar/customer_seat/schemas.py:124 CustomerSeat
    outlier:  server/polar/customer_seat/schemas.py:14 SeatAssign
    outlier:  server/polar/declarative_config/schemas.py:581 ConfigFieldChange
    outlier:  server/polar/declarative_config/schemas.py:489 ConfigIssue
    outlier:  server/polar/feedback/schemas.py:17 Feedback
    outlier:  server/polar/feedback/schemas.py:10 FeedbackCreate
    outlier:  server/polar/file/schemas.py:168 FileDownload
    outlier:  server/polar/integrations/aws/s3/schemas.py:46 S3File
    outlier:  server/polar/integrations/aws/s3/schemas.py:13 S3FileCreatePart
    outlier:  server/polar/integrations/aws/s3/schemas.py:134 S3FileUploadCompleted
    outlier:  server/polar/integrations/discord/schemas.py:9 DiscordGuildRole
    outlier:  server/polar/integrations/plain/schemas.py:32 CustomerCard
    outlier:  server/polar/kit/schemas.py:205 MultipleQueryFilter
    outlier:  server/polar/kit/schemas.py:37 Schema
    outlier:  server/polar/kit/schemas.py:190 SetSchemaReference
    outlier:  server/polar/merchant_migration/schemas.py:464 MerchantMigration
    outlier:  server/polar/organization/schemas.py:404 OrganizationSocialLink
    outlier:  server/polar/organization/schemas.py:623 OrganizationWithRole
    outlier:  server/polar/organization_review/schemas.py:252 ProductData
    outlier:  server/polar/payment/schemas.py:25 PaymentBase
    outlier:  server/polar/tax/schemas.py:12 TaxJurisdiction
```

### uid: polar/D-b63162

```text
[D-b63162] clients/apps/web: functions in src/hooks/** are named `use*`
    evidence: 231/236 (lower bound 0.95, lift 7.3)
    example:  clients/apps/web/src/hooks/clipboard.tsx#useSafeCopy
    outlier:  clients/apps/web/src/hooks/identityVerification.ts:11 isTerminalStatus
    outlier:  clients/apps/web/src/hooks/queries/merchantMigrations.ts:66 invalidateMigrationRecords
    outlier:  clients/apps/web/src/hooks/queries/merchantMigrations.ts:10 isActiveMigrationOperation
    outlier:  clients/apps/web/src/hooks/sse/organizations.ts:4 onOrganizationUpdated
    outlier:  clients/apps/web/src/hooks/useFlaggedProductName.ts:16 getFlaggedNamesToReport
```

### uid: polar/D-26e577

```text
[D-26e577] clients/apps/orbit: pages in src/** (page files) render <PageHeader>
    evidence: 29/30 (lower bound 0.83, lift 53.1)
    example:  clients/apps/orbit/src/app/components/alert/page.tsx#AlertPage
    outlier:  clients/apps/orbit/src/app/page.tsx:113 HomePage
```

### uid: polar/D-39ba94

```text
[D-39ba94] server: functions in polar/** (tasks files) are decorated with actor()
    evidence: 177/179 (lower bound 0.96, lift 18.4)
    example:  server/polar/auth/tasks.py#auth_delete_expired
    outlier:  server/polar/integrations/stripe/tasks.py:41 stripe_api_connection_error_retry
    outlier:  server/polar/webhook/tasks.py:40 sign_webhook
```

### uid: polar/D-fb4011

```text
[D-fb4011] clients/apps/app: functions in hooks/polar/** call usePolarClient()
    evidence: 30/32 (lower bound 0.80, lift 91.6)
    example:  clients/apps/app/hooks/polar/checkout_links.ts#useCheckoutLink
    outlier:  clients/apps/app/hooks/polar/finance.ts:171 usePayout
    outlier:  clients/apps/app/hooks/polar/users.ts:6 useDeleteUser
```

### uid: polar/D-31bf00

```text
[D-31bf00] server: HTTP handlers in polar/** (endpoints files) are wrapped in get_authentication_session() or Authenticator() or _web_user_or_anonymous() or get_login_organization() or AccountPolicyGuard() or OrgPolicyGuard() or PayoutAccountPolicyGuard() or WebUserAuthorizer() or WebUserAuthorizerFresh() or _get_client_dependency() or get_authentication_session() or _get_safe_return_url_dependency() or get_pagination_params() or OrderPolicyGuard() or get_db_read_session() or get_db_session()
    evidence: 364/370 (lower bound 0.96, lift 7.5)
    split:    Authenticator 228, OrgPolicyGuard 49, WebUserAuthorizer 22, get_db_session 19, WebUserAuthorizerFresh 9, get_authentication_session 5, PayoutAccountPolicyGuard 5, get_pagination_params 5, _get_safe_return_url_dependency 4, get_login_organization 3, AccountPolicyGuard 3, _get_client_dependency 3, get_db_read_session 3, _web_user_or_anonymous 2, get_authentication_session 2, OrderPolicyGuard 2
    example:  server/polar/account/endpoints.py#get
    outlier:  server/polar/agent/endpoints.py:150 auth_md
    outlier:  server/polar/auth/endpoints.py:103 start
    outlier:  server/polar/auth/sso/endpoints.py:149 authorize
    outlier:  server/polar/customer_portal/auth/endpoints.py:44 start
    outlier:  server/polar/event/endpoints.py:441 ingest_v2027_01
    outlier:  server/polar/integrations/plain/endpoints.py:17 get_cards
```

### uid: polar/D-b33f83

```text
[D-b33f83] server: classes in polar/** (repository files) are named `*Repository`
    evidence: 91/93 (lower bound 0.93, lift 28.0)
    example:  server/polar/account/repository.py#AccountRepository
    outlier:  server/polar/customer/repository.py:50 CustomerStripeIdentity
    outlier:  server/polar/subscription/repository.py:67 CustomerSubscriptionProductPrice
```

### uid: polar/D-f80e7c

```text
[D-f80e7c] server: classes in polar/** (repository files) extend RepositoryBase
    evidence: 83/93 (lower bound 0.81, lift 28.9)
    example:  server/polar/account/repository.py#AccountRepository
    outlier:  server/polar/authz/repository.py:114 AuthzRepository
    outlier:  server/polar/customer/repository.py:50 CustomerStripeIdentity
    outlier:  server/polar/subscription/repository.py:67 CustomerSubscriptionProductPrice
    outlier:  server/polar/transaction/repository.py:136 BalanceTransactionRepository
    outlier:  server/polar/transaction/repository.py:170 DisputeTransactionRepository
    outlier:  server/polar/transaction/repository.py:114 PaymentTransactionRepository
    outlier:  server/polar/transaction/repository.py:202 PayoutReversalTransactionRepository
    outlier:  server/polar/transaction/repository.py:187 PayoutTransactionRepository
    outlier:  server/polar/transaction/repository.py:155 RefundTransactionRepository
    outlier:  server/polar/user_organization/repository.py:13 UserOrganizationRepository
```

### uid: polar/D-5e2fc5

```text
[D-5e2fc5] clients/apps/web: functions in src/** (customerPortal files) are named `use*`
    evidence: 38/39 (lower bound 0.87, lift 7.2)
    example:  clients/apps/web/src/hooks/queries/customerPortal.ts#useAddCustomerPortalMember
    outlier:  clients/apps/web/src/utils/customerPortal.ts:16 hasBillingPermission
```

### uid: polar/D-093712

```text
[D-093712] server: HTTP handlers in polar/** are wrapped in Authenticator() or _web_user_or_anonymous() or WebUserAuthorizer() or _RoleCheck() or _UnionBillingRoleCheck() or get_authorization_server() or get_token() or get_db_session()
    evidence: 38/42 (lower bound 0.78, lift 7.4)
    split:    Authenticator 12, _web_user_or_anonymous 5, get_db_session 5, _RoleCheck 4, _UnionBillingRoleCheck 4, get_authorization_server 4, WebUserAuthorizer 2, get_token 2
    example:  server/polar/customer_portal/endpoints/benefit_grant.py#get
    outlier:  server/polar/customer_portal/endpoints/customer_email_update.py:76 check_email_update
    outlier:  server/polar/customer_portal/endpoints/oauth_accounts.py:81 authorize
    outlier:  server/polar/oauth2/endpoints/well_known.py:16 well_known_jwks
    outlier:  server/polar/oauth2/endpoints/well_known.py:36 well_known_oauth_protected_resource
```

### uid: polar/D-9c16e6

```text
[D-9c16e6] server/emails: components in src/emails/** render <Text>
    evidence: 44/45 (lower bound 0.88, lift 28.8)
    example:  server/emails/src/emails/chargeback_prevention_refund.tsx#ChargebackPreventionRefund
    outlier:  server/emails/src/emails/subscription_updated.tsx:14 SubscriptionUpdated
```

### uid: polar/D-9c6828

```text
[D-9c6828] server: functions in polar/** (tasks files) call AsyncSessionMaker()
    evidence: 161/179 (lower bound 0.85, lift 18.3)
    example:  server/polar/auth/tasks.py#auth_delete_expired
    outlier:  server/polar/benefit/tasks.py:106 benefit_enqueue_grants
    outlier:  server/polar/eventstream/tasks.py:6 eventstream_publish
    outlier:  server/polar/integrations/polar/tasks.py:78 add_member
    outlier:  server/polar/integrations/polar/tasks.py:42 create_customer
    outlier:  server/polar/integrations/polar/tasks.py:181 delete_customer
    outlier:  server/polar/integrations/polar/tasks.py:161 remove_member
    outlier:  server/polar/integrations/polar/tasks.py:214 track_organization_review_usage
    outlier:  server/polar/integrations/polar/tasks.py:145 update_customer_slug
    outlier:  server/polar/integrations/polar/tasks.py:114 update_member
    outlier:  server/polar/integrations/stripe/tasks.py:41 stripe_api_connection_error_retry
    outlier:  server/polar/integrations/tinybird/tasks.py:35 ingest
    outlier:  server/polar/observability/invariants/tasks.py:42 check_invariant
    outlier:  server/polar/observability/invariants/tasks.py:28 enqueue_invariants
    outlier:  server/polar/observability/slo_report/tasks.py:22 slo_report_send_weekly
    outlier:  server/polar/order/tasks.py:464 order_invoice
    outlier:  server/polar/receipt/tasks.py:59 receipt_render
    outlier:  server/polar/reducer/tasks.py:27 invalidate_cache
    outlier:  server/polar/webhook/tasks.py:40 sign_webhook
```

### uid: polar/D-dfae92

```text
[D-dfae92] clients/packages/ui: components in src/components/ui/** call cn()
    evidence: 72/77 (lower bound 0.86, lift 19.8)
    example:  clients/packages/ui/src/components/ui/accordion.tsx#AccordionContent
    outlier:  clients/packages/ui/src/components/ui/chart.tsx:78 ChartStyle
    outlier:  clients/packages/ui/src/components/ui/command.tsx:65 CommandEmpty
    outlier:  clients/packages/ui/src/components/ui/form.tsx:110 FormControl
    outlier:  clients/packages/ui/src/components/ui/form.tsx:32 FormField
    outlier:  clients/packages/ui/src/components/ui/sidebar.tsx:679 SidebarMenuSubItem
```
