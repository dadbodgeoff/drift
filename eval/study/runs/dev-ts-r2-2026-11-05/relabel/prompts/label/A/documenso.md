You are labelling proposed coding conventions for the repository **documenso** (https://github.com/documenso/documenso at commit `fdd0337bdd8f6afac64faf97113c65ed2dd0e2a2`).

A checkout of the repository at that commit is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/tsr2/cache/repos/documenso

## Rules for this task

1. **Work only from the repository checkout.**
   - Read files, and search with grep, find or ripgrep, inside `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/tsr2/cache/repos/documenso`.
   - Do not modify anything there.
   - Do not install dependencies, run builds, or access the network.
2. **Do not open anything outside `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/tsr2/cache/repos/documenso`,** except for writing your output file. In particular, do not look for:
   - the tool that produced these proposals, or its source code or documentation;
   - other people's labels, or earlier studies;
   - anything on the internet.
3. **Ignore a `.drift/` directory if one exists in the checkout.** It is a cache of the tool, not part of the project.
4. **Label every proposal independently,** following the rubric below exactly.
   - Open the files the rubric requires before deciding: the example, at least three outliers, at least two other members, and the lint or compiler config when TRIVIAL is in question.
   - List every file you opened in `checked`.
5. **Write your labels to `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/tsr2/cache/outbox/f16ac98f-f7c8-41e9-a3ea-a4b526908a3e/out.jsonl`:**
   - one JSON object per line;
   - exactly one line for each of the 5 proposals;
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

## The proposals (5)

Each proposal starts with its `uid`. Copy it exactly into your output.

### uid: documenso/D-d51d70

```text
[D-d51d70] packages/trpc: rpc entry points in server/organisation-router/** are wrapped in authenticatedProcedure()
    evidence: 28/30 (lower bound 0.79, lift 7.4)
    example:  packages/trpc/server/organisation-router/create-organisation-group.ts#createOrganisationGroupRoute
    outlier:  packages/trpc/server/organisation-router/accept-organisation-member-invite.ts:9 acceptOrganisationMemberInviteRoute
    outlier:  packages/trpc/server/organisation-router/decline-organisation-member-invite.ts:11 declineOrganisationMemberInviteRoute
```

### uid: documenso/D-c3b713

```text
[D-c3b713] files in packages/lib/** do not import from packages/ui/** (declared dependencies excepted)
    evidence: 633/641 (lower bound 0.98, lift 3.0)
    example:  packages/lib/advanced-fields-validation/validate-dropdown.ts#(file)
    outlier:  packages/lib/advanced-fields-validation/validate-checkbox.ts:1 (file)
    outlier:  packages/lib/advanced-fields-validation/validate-number.ts:1 (file)
    outlier:  packages/lib/client-only/providers/envelope-editor-provider.tsx:1 (file)
    outlier:  packages/lib/client-only/providers/envelope-render-provider.tsx:1 (file)
    outlier:  packages/lib/server-only/document/send-document.ts:1 (file)
    outlier:  packages/lib/universal/field-renderer/field-canvas-style.ts:1 (file)
    outlier:  packages/lib/universal/field-renderer/field-generic-items.ts:1 (file)
    outlier:  packages/lib/utils/envelope-signing.ts:1 (file)
```

### uid: documenso/D-55ae12

```text
[D-55ae12] packages/trpc: rpc entry points in server/envelope-router/** are wrapped in authenticatedProcedure()
    evidence: 42/47 (lower bound 0.77, lift 7.1)
    example:  packages/trpc/server/envelope-router/attachment/create-attachment.ts#createAttachmentRoute
    outlier:  packages/trpc/server/envelope-router/attachment/find-attachments.ts:12 findAttachmentsRoute
    outlier:  packages/trpc/server/envelope-router/envelope-recipients/report-recipient.ts:15 reportRecipientRoute
    outlier:  packages/trpc/server/envelope-router/get-envelope-items-by-token.ts:15 getEnvelopeItemsByTokenRoute
    outlier:  packages/trpc/server/envelope-router/sign-envelope-field.ts:18 signEnvelopeFieldRoute
    outlier:  packages/trpc/server/envelope-router/signing-status-envelope.ts:12 signingStatusEnvelopeRoute
```

### uid: documenso/D-d19fc6

```text
[D-d19fc6] packages/trpc: rpc entry points in server/** validate their input with a schema
    evidence: 212/215 (lower bound 0.96, lift 4.3)
    example:  packages/trpc/server/admin-router/admin-search.ts#adminSearchRoute
    outlier:  packages/trpc/server/auth-router/get-auth-methods.ts:9 getAuthMethodsRoute
    outlier:  packages/trpc/server/enterprise-router/get-plans.ts:7 getPlansRoute
    outlier:  packages/trpc/server/organisation-router/get-organisation-session.ts:12 getOrganisationSessionRoute
```

### uid: documenso/D-aafe01

```text
[D-aafe01] packages/email: components in templates/** are named `*Template`
    evidence: 28/31 (lower bound 0.75, lift 27.3)
    example:  packages/email/templates/access-auth-2fa.tsx#AccessAuth2FAEmailTemplate
    outlier:  packages/email/templates/bulk-send-complete.tsx:17 BulkSendCompleteEmail
    outlier:  packages/email/templates/document-rejected.tsx:17 DocumentRejectedEmail
    outlier:  packages/email/templates/document-rejection-confirmed.tsx:17 DocumentRejectionConfirmedEmail
```
