You are labelling proposed coding conventions for the repository **saleor** (https://github.com/saleor/saleor at commit `89817cdd10423619d6d6be54a61ead11fca90cfa`).

A checkout of the repository at that commit is at:

    /tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/repos/saleor

## Rules for this task

1. **Work only from the repository checkout.**
   - Read files, and search with grep, find or ripgrep, inside `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/repos/saleor`.
   - Do not modify anything there.
   - Do not install dependencies, run builds, or access the network.
2. **Do not open anything outside `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/repos/saleor`,** except for writing your output file. In particular, do not look for:
   - the tool that produced these proposals, or its source code or documentation;
   - other people's labels, or earlier studies;
   - anything on the internet.
3. **Ignore a `.drift/` directory if one exists in the checkout.** It is a cache of the tool, not part of the project.
4. **Label every proposal independently,** following the rubric below exactly.
   - Open the files the rubric requires before deciding: the example, at least three outliers, at least two other members, and the lint or compiler config when TRIVIAL is in question.
   - List every file you opened in `checked`.
5. **Write your labels to `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/outbox/292009e6-9309-4b65-bdf3-d81b1b8e8078/out.jsonl`:**
   - one JSON object per line;
   - exactly one line for each of the 14 proposals;
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

## The proposals (14)

Each proposal starts with its `uid`. Copy it exactly into your output.

### uid: saleor/D-e86c5d

```text
[D-e86c5d] files in saleor/graphql/account/** have a test file
    evidence: 45/51 (lower bound 0.77, lift 1.6)
    example:  saleor/graphql/account/bulk_mutations/customer_bulk_delete.py#(file)
    outlier:  saleor/graphql/account/mixins.py:1 (file)
    outlier:  saleor/graphql/account/mutations/authentication/create_token.py:1 (file)
    outlier:  saleor/graphql/account/mutations/authentication/deactivate_all_user_tokens.py:1 (file)
    outlier:  saleor/graphql/account/mutations/authentication/external_authentication_url.py:1 (file)
    outlier:  saleor/graphql/account/mutations/authentication/refresh_token.py:1 (file)
    outlier:  saleor/graphql/account/mutations/authentication/verify_token.py:1 (file)
```

### uid: saleor/D-e36ea5

```text
[D-e36ea5] exported values in saleor/core/** do not read os.environ directly
    evidence: 74/75 (lower bound 0.93, lift 11.5)
    example:  saleor/core/auth.py#AUTH_HEADER_PREFIXES
    outlier:  saleor/core/development/random_data.py:139 DEFAULT_CURRENCY
```

### uid: saleor/D-71795b

```text
[D-71795b] classes in saleor/** (dataloaders files) are named `*Loader`
    evidence: 131/134 (lower bound 0.94, lift 10.9)
    example:  saleor/graphql/account/dataloaders.py#AddressByIdLoader
    outlier:  saleor/graphql/account/dataloaders.py:181 BaseAccessibleChannels
    outlier:  saleor/graphql/plugins/dataloaders.py:31 PluginManagerByRequestorDataloader
    outlier:  saleor/graphql/tax/dataloaders.py:37 TaxConfigurationByChannelId
```

### uid: saleor/D-049c39

```text
[D-049c39] files in saleor/** do not import from saleor/csv/**
    evidence: 634/635 (lower bound 0.99, lift 3.0)
    example:  saleor/__main__.py#(file)
    outlier:  saleor/graphql/csv/mutations/export_products.py:1 (file)
```

### uid: saleor/D-6488c7

```text
[D-6488c7] files in saleor/** do not import from saleor/site/**
    evidence: 623/635 (lower bound 0.97, lift 3.0)
    example:  saleor/__main__.py#(file)
    outlier:  saleor/core/auth_backend.py:1 (file)
    outlier:  saleor/core/development/random_data.py:1 (file)
    outlier:  saleor/graphql/account/mutations/account/confirm_account.py:1 (file)
    outlier:  saleor/graphql/meta/permissions.py:1 (file)
    outlier:  saleor/graphql/order/mutations/fulfillment_refund_and_return_product_base.py:1 (file)
    outlier:  saleor/graphql/order/mutations/order_lines_create.py:1 (file)
    outlier:  saleor/graphql/shop/mutations/gift_card_settings_update.py:1 (file)
    outlier:  saleor/graphql/shop/mutations/refund_settings_update.py:1 (file)
    outlier:  saleor/graphql/shop/mutations/return_settings_update.py:1 (file)
    outlier:  saleor/graphql/shop/mutations/shop_settings_update.py:1 (file)
    outlier:  saleor/graphql/storefront_traffic.py:1 (file)
    outlier:  saleor/graphql/translations/mutations/shop_settings_translate.py:1 (file)
```

### uid: saleor/D-a6847e

```text
[D-a6847e] classes in saleor/graphql/attribute/dataloaders/** are named `*Loader`
    evidence: 18/19 (lower bound 0.75, lift 10.6)
    example:  saleor/graphql/attribute/dataloaders/assigned_attributes.py#AttributeByPageIdAndAttributeSlugLoader
    outlier:  saleor/graphql/attribute/dataloaders/attributes.py:22 AttributesByAttributeId
```

### uid: saleor/D-1cef87

```text
[D-1cef87] classes in saleor/** (interface files) are decorated with dataclass()
    evidence: 44/48 (lower bound 0.80, lift 19.6)
    example:  saleor/core/pricing/interface.py#LineInfo
    outlier:  saleor/discount/interface.py:71 VariantPromotionRuleInfo
    outlier:  saleor/payment/interface.py:221 PaymentGatewayInitializeTokenizationResult
    outlier:  saleor/payment/interface.py:263 PaymentMethodTokenizationResult
    outlier:  saleor/payment/interface.py:346 StorePaymentMethodEnum
```

### uid: saleor/D-6b1d3c

```text
[D-6b1d3c] classes in saleor/core/editorjs/** (models files) are named `*Model`
    evidence: 19/20 (lower bound 0.76, lift 109.2)
    example:  saleor/core/editorjs/models.py#EditorJSDocumentModel
    outlier:  saleor/core/editorjs/models.py:62 EditorJSBlock
```

### uid: saleor/D-d756c3

```text
[D-d756c3] classes in saleor/** (error_codes files) are named `*Code`
    evidence: 91/92 (lower bound 0.94, lift 26.0)
    example:  saleor/account/error_codes.py#AccountErrorCode
    outlier:  saleor/graphql/notifications/error_codes.py:4 ExternalNotificationErrorCodes
```

### uid: saleor/D-6acdcd

```text
[D-6acdcd] classes in saleor/graphql/translations/** (types files) pass `description` to GlobalID()
    evidence: 29/30 (lower bound 0.83, lift 30.5)
    example:  saleor/graphql/translations/types.py#AttributeTranslatableContent
    outlier:  saleor/graphql/translations/types.py:84 BaseTranslationType
```

### uid: saleor/D-f5882d

```text
[D-f5882d] classes in saleor/** (dataloaders files) extend DataLoader
    evidence: 113/134 (lower bound 0.77, lift 10.7)
    example:  saleor/graphql/account/dataloaders.py#AddressByIdLoader
    outlier:  saleor/graphql/account/dataloaders.py:223 AccessibleChannelsByGroupIdLoader
    outlier:  saleor/graphql/account/dataloaders.py:231 AccessibleChannelsByUserIdLoader
    outlier:  saleor/graphql/account/dataloaders.py:100 CustomerAttributesAllByCustomerTypeIdLoader
    outlier:  saleor/graphql/account/dataloaders.py:108 CustomerAttributesVisibleInStorefrontByCustomerTypeIdLoader
    outlier:  saleor/graphql/core/dataloaders.py:20 DataLoader
    outlier:  saleor/graphql/page/dataloaders.py:87 PageAttributesAllByPageTypeIdLoader
    outlier:  saleor/graphql/page/dataloaders.py:93 PageAttributesVisibleInStorefrontByPageTypeIdLoader
    outlier:  saleor/graphql/translations/dataloaders.py:47 AttributeTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:55 AttributeValueTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:63 CategoryTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:71 CollectionTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:79 MenuItemTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:87 PageTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:103 ProductMediaTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:95 ProductTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:111 ProductVariantTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:151 PromotionRuleTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:143 PromotionTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:119 ShippingMethodTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:127 SiteSettingsTranslationByIdAndLanguageCodeLoader
    outlier:  saleor/graphql/translations/dataloaders.py:135 VoucherTranslationByIdAndLanguageCodeLoader
```

### uid: saleor/D-5a6c4f

```text
[D-5a6c4f] classes in saleor/graphql/product/dataloaders/** are named `*Loader`
    evidence: 40/42 (lower bound 0.84, lift 10.7)
    example:  saleor/graphql/product/dataloaders/attributes.py#BaseProductAttributesByProductTypeIdLoader
    outlier:  saleor/graphql/product/dataloaders/products.py:259 AvailableProductVariantsByProductIdAndChannel
    outlier:  saleor/graphql/product/dataloaders/products.py:212 ProductVariantsByProductIdAndChannel
```

### uid: saleor/D-fb56f8

```text
[D-fb56f8] job entry points in saleor/plugins/** (tasks files) pass `compression` to Celery.task()
    evidence: 20/21 (lower bound 0.77, lift 105.1)
    example:  saleor/plugins/admin_email/tasks.py#send_email_with_link_to_download_file_task
    outlier:  saleor/plugins/avatax/tasks.py:15 api_post_request_task
```

### uid: saleor/D-9cc87c

```text
[D-9cc87c] files in saleor/** do not import from saleor/invoice/**
    evidence: 627/635 (lower bound 0.97, lift 3.0)
    example:  saleor/__main__.py#(file)
    outlier:  saleor/core/management/commands/clearorders.py:1 (file)
    outlier:  saleor/graphql/invoice/mutations/invoice_create.py:1 (file)
    outlier:  saleor/graphql/invoice/mutations/invoice_delete.py:1 (file)
    outlier:  saleor/graphql/invoice/mutations/invoice_request.py:1 (file)
    outlier:  saleor/graphql/invoice/mutations/invoice_request_delete.py:1 (file)
    outlier:  saleor/graphql/invoice/mutations/invoice_send_notification.py:1 (file)
    outlier:  saleor/graphql/invoice/mutations/invoice_update.py:1 (file)
    outlier:  saleor/graphql/order/bulk_mutations/order_bulk_create.py:1 (file)
```
