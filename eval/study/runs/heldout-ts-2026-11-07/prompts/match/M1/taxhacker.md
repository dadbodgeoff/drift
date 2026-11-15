You are checking whether a tool's proposed conventions for the repository **taxhacker** (https://github.com/vas3k/TaxHacker at `636b6b9c98ed8df82f1c252a4cf3819202d8f111`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/taxhacker

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/769f1f9c-a1f4-46fc-8665-e07ea023be0f/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **taxhacker#R02** (naming, must; eslint.config.mjs:14): In all TypeScript files, code must not declare unused variables, function arguments or caught errors unless their names start with an underscore (_).  
  scope: **/*.{ts,tsx} all files
- **taxhacker#R03** (typing, should; eslint.config.mjs:22): In all TypeScript files, code should not use the explicit `any` type.  
  scope: **/*.{ts,tsx} all files
- **taxhacker#R04** (render, should; eslint.config.mjs:23): In React components and hooks in TypeScript files, render code should be pure and should not call impure functions (e.g. Date.now(), Math.random()) during render; the repository lowers this rule to a warning.  
  scope: **/*.{ts,tsx} React components and hooks
- **taxhacker#R05** (render, should; eslint.config.mjs:24): In React components and hooks in TypeScript files, code should not call setState synchronously inside a useEffect body; the repository lowers this rule to a warning.  
  scope: **/*.{ts,tsx} React components and hooks
- **taxhacker#R06** (render, should; eslint.config.mjs:25): In React components and hooks in TypeScript files, code should not mutate props, state, or values captured by hooks/render (treat them as immutable); the repository lowers this rule to a warning.  
  scope: **/*.{ts,tsx} React components and hooks

## Proposals shown to the user

```text
[D-53127d] server actions in app/** (actions files) are named `*Action`
    evidence: 41/42 (lower bound 0.88, lift 4.7)
    example:  app/(app)/apps/email/actions.ts#addEmailServerAction
    outlier:  app/(app)/apps/invoices/actions.ts:31 generateInvoicePDF
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "taxhacker#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
