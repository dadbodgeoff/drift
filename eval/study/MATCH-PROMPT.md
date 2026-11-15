# Matching prompt: does Drift find what the repository documents?

For each documented item, a matcher decides whether a Drift proposal states the same convention. Render it with:

```sh
node eval/study/prompt.mjs match --run eval/study/runs/NAME     # needs recall/docs/<repo>.jsonl
```

**Blinding.** The matcher sees:

- the documented items;
- Drift's proposals for the repository, both shown and pool;
- the repository.

It never sees the precision labels. It also judges whether the code actually follows each item (`followed`). A documented rule the code does not follow cannot be learned from the code, so recall is also reported over followed items only.

**Second matcher.** Run a second matcher M2 on a sample, for agreement. `recall.mjs score` reports agreement when `recall/matches-M2/` exists.

## Placeholders

| Placeholder | Filled with |
| --- | --- |
| `{{REPO}}`, `{{REPO_URL}}`, `{{REPO_SHA}}`, `{{REPO_DIR}}` | as for reviewers |
| `{{ITEMS}}` | the documented items (`enabled` and `code_checkable`) |
| `{{SHOWN}}` | the proposals a user is shown (`census --max`) |
| `{{POOL}}` | further proposals from the deeper census (`--pool`), not shown by default |
| `{{OUTPUT_FILE}}` | the matcher's outbox, a fresh `<cache>/outbox/<random uuid>/out.jsonl` |

<!-- BEGIN PROMPT -->
You are checking whether a tool's proposed conventions for the repository **{{REPO}}** ({{REPO_URL}} at `{{REPO_SHA}}`) cover the conventions the repository documents itself. A checkout is at:

    {{REPO_DIR}}

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `{{OUTPUT_FILE}}`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

{{ITEMS}}

## Proposals shown to the user

{{SHOWN}}

## Pool: further proposals, not shown by default

{{POOL}}

## Output

One JSON object per documented item, one per line:

```json
{"ref": "{{REPO}}#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
<!-- END PROMPT -->
