You are labelling proposed coding conventions for the repository **midday** (https://github.com/midday-ai/midday at commit `51587319f26a0ffaa9dfccab1920373cb65689b7`).

A checkout of the repository at that commit is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/tsr2/cache/repos/midday

## Rules for this task

1. **Work only from the repository checkout.**
   - Read files, and search with grep, find or ripgrep, inside `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/tsr2/cache/repos/midday`.
   - Do not modify anything there.
   - Do not install dependencies, run builds, or access the network.
2. **Do not open anything outside `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/tsr2/cache/repos/midday`,** except for writing your output file. In particular, do not look for:
   - the tool that produced these proposals, or its source code or documentation;
   - other people's labels, or earlier studies;
   - anything on the internet.
3. **Ignore a `.drift/` directory if one exists in the checkout.** It is a cache of the tool, not part of the project.
4. **Label every proposal independently,** following the rubric below exactly.
   - Open the files the rubric requires before deciding: the example, at least three outliers, at least two other members, and the lint or compiler config when TRIVIAL is in question.
   - List every file you opened in `checked`.
5. **Write your labels to `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/tsr2/cache/outbox/0d4ca795-d5a3-43c4-8463-8b893dd51d22/out.jsonl`:**
   - one JSON object per line;
   - exactly one line for each of the 6 proposals;
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

## The proposals (6)

Each proposal starts with its `uid`. Copy it exactly into your output.

### uid: midday/D-d1b6ba

```text
[D-d1b6ba] apps/api: rpc entry points in src/** validate their input with a schema
    evidence: 211/255 (lower bound 0.78, lift 6.4)
    example:  apps/api/src/trpc/routers/accounting.ts#MUTATION disconnect
    outlier:  apps/api/src/trpc/routers/accounting.ts:90 QUERY getConnections
    outlier:  apps/api/src/trpc/routers/api-keys.ts:14 QUERY get
    outlier:  apps/api/src/trpc/routers/apps.ts:19 QUERY get
    outlier:  apps/api/src/trpc/routers/bank-accounts.ts:74 QUERY balances
    outlier:  apps/api/src/trpc/routers/bank-accounts.ts:70 QUERY currencies
    outlier:  apps/api/src/trpc/routers/bank-accounts.ts:62 QUERY getWithPaymentInfo
    outlier:  apps/api/src/trpc/routers/banking.ts:384 QUERY rates
    outlier:  apps/api/src/trpc/routers/billing.ts:240 MUTATION getPortalUrl
    outlier:  apps/api/src/trpc/routers/billing.ts:316 MUTATION reactivateSubscription
    outlier:  apps/api/src/trpc/routers/billing.ts:211 QUERY getActiveSubscription
    outlier:  apps/api/src/trpc/routers/connectors.ts:21 QUERY connections
    outlier:  apps/api/src/trpc/routers/connectors.ts:17 QUERY list
    outlier:  apps/api/src/trpc/routers/document-tags.ts:16 QUERY get
    outlier:  apps/api/src/trpc/routers/inbox-accounts.ts:23 QUERY get
    outlier:  apps/api/src/trpc/routers/invoice-payments.ts:55 MUTATION disconnectStripe
    outlier:  apps/api/src/trpc/routers/invoice-payments.ts:33 QUERY getConnectUrl
    outlier:  apps/api/src/trpc/routers/invoice-payments.ts:15 QUERY stripeStatus
    outlier:  apps/api/src/trpc/routers/invoice-template.ts:79 QUERY count
    outlier:  apps/api/src/trpc/routers/invoice-template.ts:17 QUERY list
    outlier:  apps/api/src/trpc/routers/invoice.ts:788 QUERY averageDaysToPayment
    outlier:  apps/api/src/trpc/routers/invoice.ts:794 QUERY averageInvoiceSize
    outlier:  apps/api/src/trpc/routers/invoice.ts:279 QUERY defaultSettings
    outlier:  apps/api/src/trpc/routers/invoice.ts:782 QUERY inactiveClientsCount
    outlier:  apps/api/src/trpc/routers/invoice.ts:776 QUERY mostActiveClient
    outlier:  apps/api/src/trpc/routers/invoice.ts:806 QUERY newCustomersCount
    outlier:  apps/api/src/trpc/routers/invoice.ts:104 QUERY paymentStatus
    outlier:  apps/api/src/trpc/routers/invoice.ts:800 QUERY topRevenueClient
    outlier:  apps/api/src/trpc/routers/notification-settings.ts:26 QUERY getAll
    outlier:  apps/api/src/trpc/routers/oauth-applications.ts:301 QUERY authorized
    outlier:  apps/api/src/trpc/routers/oauth-applications.ts:38 QUERY list
    outlier:  apps/api/src/trpc/routers/overview.ts:5 QUERY summary
    outlier:  apps/api/src/trpc/routers/tags.ts:10 QUERY get
    outlier:  apps/api/src/trpc/routers/team.ts:400 MUTATION exportAllData
    outlier:  apps/api/src/trpc/routers/team.ts:383 QUERY availablePlans
    outlier:  apps/api/src/trpc/routers/team.ts:425 QUERY connectionStatus
    outlier:  apps/api/src/trpc/routers/team.ts:45 QUERY current
    outlier:  apps/api/src/trpc/routers/team.ts:311 QUERY invitesByEmail
    outlier:  apps/api/src/trpc/routers/team.ts:66 QUERY list
    outlier:  apps/api/src/trpc/routers/team.ts:62 QUERY members
    outlier:  apps/api/src/trpc/routers/team.ts:307 QUERY teamInvites
    outlier:  apps/api/src/trpc/routers/transactions.ts:81 QUERY getReviewCount
    outlier:  apps/api/src/trpc/routers/user.ts:74 MUTATION delete
    outlier:  apps/api/src/trpc/routers/user.ts:89 QUERY invites
    outlier:  apps/api/src/trpc/routers/user.ts:19 QUERY me
```

### uid: midday/D-efc6d4

```text
[D-efc6d4] apps/api: exported values in src/trpc/** call createTRPCRouter()
    evidence: 38/41 (lower bound 0.81, lift 31.6)
    example:  apps/api/src/trpc/routers/_app.ts#appRouter
    outlier:  apps/api/src/trpc/init.ts:87 createCallerFactory
    outlier:  apps/api/src/trpc/init.ts:86 createTRPCRouter
    outlier:  apps/api/src/trpc/init.ts:120 publicProcedure
```

### uid: midday/D-495f56

```text
[D-495f56] apps/api: exported values in src/schemas/** are named `*Schema`
    evidence: 308/309 (lower bound 0.98, lift 2.7)
    example:  apps/api/src/schemas/api-keys.ts#deleteApiKeySchema
    outlier:  apps/api/src/schemas/invoice.ts:337 draftInvoiceSchemaWithOpenApi
```

### uid: midday/D-f6c709

```text
[D-f6c709] apps/api: exported values in src/schemas/** call z.object()
    evidence: 256/309 (lower bound 0.78, lift 4.2)
    example:  apps/api/src/schemas/api-keys.ts#deleteApiKeySchema
    outlier:  apps/api/src/schemas/accounting.ts:6 accountingProviderIdSchema
    outlier:  apps/api/src/schemas/accounting.ts:32 disconnectProviderSchema
    outlier:  apps/api/src/schemas/accounting.ts:16 exportToAccountingSchema
    outlier:  apps/api/src/schemas/accounting.ts:39 getAccountsSchema
    outlier:  apps/api/src/schemas/accounting.ts:24 getSyncStatusSchema
    outlier:  apps/api/src/schemas/banking.ts:10 accountTypeSchema
    outlier:  apps/api/src/schemas/banking.ts:65 connectionByReferenceSchema
    outlier:  apps/api/src/schemas/banking.ts:53 connectionStatusSchema
    outlier:  apps/api/src/schemas/banking.ts:59 deleteConnectionSchema
    outlier:  apps/api/src/schemas/banking.ts:48 enablebankingExchangeSchema
    outlier:  apps/api/src/schemas/banking.ts:42 enablebankingLinkSchema
    outlier:  apps/api/src/schemas/banking.ts:77 getBalanceSchema
    outlier:  apps/api/src/schemas/banking.ts:70 getProviderAccountsSchema
    outlier:  apps/api/src/schemas/banking.ts:85 getProviderTransactionsSchema
    outlier:  apps/api/src/schemas/banking.ts:37 gocardlessAgreementSchema
    outlier:  apps/api/src/schemas/banking.ts:30 gocardlessLinkSchema
    outlier:  apps/api/src/schemas/banking.ts:26 plaidExchangeSchema
    outlier:  apps/api/src/schemas/banking.ts:19 plaidLinkSchema
    outlier:  apps/api/src/schemas/banking.ts:3 providerSchema
    outlier:  apps/api/src/schemas/billing.ts:26 cancelSubscriptionSchema
    outlier:  apps/api/src/schemas/billing.ts:20 checkoutResponseSchema
    outlier:  apps/api/src/schemas/billing.ts:10 createCheckoutSchema
    outlier:  apps/api/src/schemas/billing.ts:3 getBillingOrdersSchema
    outlier:  apps/api/src/schemas/documents.ts:136 signedUrlsSchema
    outlier:  apps/api/src/schemas/inbox.ts:183 deleteInboxManySchema
    outlier:  apps/api/src/schemas/invoice-recurring.ts:29 invoiceRecurringEndTypeSchema
    outlier:  apps/api/src/schemas/invoice-recurring.ts:26 invoiceRecurringFrequencySchema
    outlier:  apps/api/src/schemas/invoice-recurring.ts:32 invoiceRecurringStatusSchema
    outlier:  apps/api/src/schemas/invoice.ts:1366 createInvoiceResponseSchema
    outlier:  apps/api/src/schemas/invoice.ts:1198 draftInvoiceRequestSchema
    outlier:  apps/api/src/schemas/invoice.ts:268 draftInvoiceSchema
    outlier:  apps/api/src/schemas/invoice.ts:337 draftInvoiceSchemaWithOpenApi
    outlier:  apps/api/src/schemas/invoice.ts:162 draftLineItemSchema
    outlier:  apps/api/src/schemas/invoice.ts:69 editorFieldSchema
    outlier:  apps/api/src/schemas/invoice.ts:286 restDraftInvoiceSchema
    outlier:  apps/api/src/schemas/invoice.ts:168 restDraftLineItemSchema
    outlier:  apps/api/src/schemas/invoice.ts:749 restInvoiceTemplateSchema
    outlier:  apps/api/src/schemas/invoice.ts:136 restUpsertInvoiceTemplateSchema
    outlier:  apps/api/src/schemas/invoice.ts:1392 updateInvoiceResponseSchema
    outlier:  apps/api/src/schemas/invoice.ts:129 upsertInvoiceTemplateSchema
    outlier:  apps/api/src/schemas/jobs.ts:7 getJobStatusSchema
    outlier:  apps/api/src/schemas/jobs.ts:14 jobStatusSchema
    outlier:  apps/api/src/schemas/notification-settings.ts:16 bulkUpdateNotificationSettingsSchema
    outlier:  apps/api/src/schemas/notification-settings.ts:5 getNotificationSettingsSchema
    outlier:  apps/api/src/schemas/notification-settings.ts:3 notificationChannelSchema
    outlier:  apps/api/src/schemas/notification-settings.ts:10 updateNotificationSettingSchema
    outlier:  apps/api/src/schemas/oauth-flow.ts:113 oauthTokenEndpointRequestSchema
    outlier:  apps/api/src/schemas/reports.ts:734 reportTypeSchema
    outlier:  apps/api/src/schemas/tracker-entries.ts:415 timerResponseSchema
    outlier:  apps/api/src/schemas/transactions.ts:960 createTransactionsResponseSchema
    outlier:  apps/api/src/schemas/transactions.ts:897 createTransactionsSchema
    outlier:  apps/api/src/schemas/transactions.ts:574 deleteTransactionsResponseSchema
    outlier:  apps/api/src/schemas/transactions.ts:560 deleteTransactionsSchema
```

### uid: midday/D-ef5012

```text
[D-ef5012] apps/api: rpc entry points in src/** are wrapped in internalProcedure() or protectedProcedure() or publicProcedure()
    evidence: 254/255 (lower bound 0.98, lift 7.6)
    split:    protectedProcedure 242, internalProcedure 6, publicProcedure 6
    example:  apps/api/src/trpc/routers/accounting.ts#MUTATION disconnect
    outlier:  apps/api/src/trpc/routers/banking.ts:291 QUERY getProviderAccounts
```

### uid: midday/D-98e729

```text
[D-98e729] apps/api: exported values in src/trpc/** are named `*Router`
    evidence: 39/41 (lower bound 0.84, lift 21.6)
    example:  apps/api/src/trpc/routers/_app.ts#appRouter
    outlier:  apps/api/src/trpc/init.ts:87 createCallerFactory
    outlier:  apps/api/src/trpc/init.ts:120 publicProcedure
```
