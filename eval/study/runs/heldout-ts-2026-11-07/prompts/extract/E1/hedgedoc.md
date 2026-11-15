You are building a reference list of the **coding conventions that the repository hedgedoc documents itself** (https://github.com/hedgedoc/hedgedoc at commit `c937fd26b5d20ca8b2c5fd26e5b467f0a5c03e08`). A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/hedgedoc

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/e8a59589-4ab8-4903-85da-c9590d6a2e7c/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

## What counts

Extract every statement the repository makes about **how its code must be written** that could be checked by reading code. Read:

1. **Agent and contributor docs:**
   - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `CONTRIBUTING.md`;
   - `.cursorrules`, `.cursor/rules/*`, `.windsurfrules`, `.clinerules`;
   - `.github/copilot-instructions.md`, `.github/instructions/*`;
   - architecture, convention or style docs.

   Include nested copies in sub-packages. Each applies to its own directory.
2. **Lint configs:** eslint (`eslint.config.*`, `.eslintrc*`, `eslintConfig` in `package.json`), oxlint, biome; for Python, ruff, flake8, pylint, mypy, import-linter contracts and semgrep rules. Extract:
   - every rule the repository configures **explicitly** in its own config files, including config packages inside the repository (such as `packages/eslint-config`);
   - each `no-restricted-imports`, `no-restricted-syntax` or `no-restricted-globals` entry, ruff `banned-api` / `flake8-tidy-imports` entry, or import-linter contract, as a separate item;
   - each custom or local plugin rule. Read its implementation to state what it enforces.

   Do not list rules that only arrive from a third-party preset (`eslint:recommended`, `next/core-web-vitals`, `plugin:@typescript-eslint/recommended`) unless the repository's config changes their level or options. For ruff, a selected rule family (`select = ["E", "B"]`) is one item per family, not per code.
3. **Rules the repository turns off,** explicitly: record them with `"enabled": false`. They tell us what the team chose not to enforce.

Candidate files found automatically (not necessarily complete; look for others, and say in `source` where each item came from):

- `CONTRIBUTING.md` (doc)
- `frontend/CONTRIBUTING.md` (doc)
- `.oxlintrc.json` (lint)
- `backend/.oxlintrc.json` (lint)
- `commons/.oxlintrc.json` (lint)
- `database/.oxlintrc.json` (lint)
- `frontend/.oxlintrc.json` (lint)
- `html-to-react/.oxlintrc.json` (lint)
- `markdown-it-plugins/.oxlintrc.json` (lint)
- `frontend/oxlint-rules/` (lint_custom (custom rule implementations))

## What does not count

- **Process:**
  - commit messages, PR descriptions, branch names;
  - "run the tests", "run `pnpm lint`";
  - changesets, release steps.
- **Formatting a formatter handles:** quotes, semicolons, indentation, import order handled by prettier, biome format or similar.
- **Generic advice no reviewer could check:** "write clean code", "keep functions small", "be careful with performance".
- **Statements about** documentation, deployment, environment setup or tooling installation.

When in doubt, include the item and set `"code_checkable": false`. The scorer excludes those.

## Output

One JSON object per item, one per line. Number the refs `hedgedoc#R01`, `hedgedoc#R02`, and so on, in the order you found them.

```json
{"ref": "hedgedoc#R01", "repo": "hedgedoc",
 "source": "apps/web/AGENTS.md:42", "source_kind": "agents_md",
 "quote": "All API routes must be wrapped in withWorkspace or withSession.",
 "statement": "HTTP route handlers in apps/web/app/api/** are wrapped in withWorkspace() or withSession().",
 "scope": "apps/web/app/api/** route handlers",
 "category": "wrapper", "strength": "must", "enabled": true,
 "enforced_by": null, "code_checkable": true}
```

| Field | Values |
| --- | --- |
| `source` | file and line, repo-relative |
| `source_kind` | `agents_md`, `claude_md`, `contributing`, `cursor_rules`, `copilot`, `other_doc`, `lint`, `lint_custom` |
| `quote` | the exact text: at most 300 characters, or the rule and its options for lint |
| `statement` | normalized as "In SCOPE, CODE must / must not REQUIREMENT", naming concrete symbols, paths and packages |
| `scope` | where it applies, as a glob plus a kind of code (route handlers, components, services, all files) |
| `category` | one of: <ul><li>`wrapper`</li><li>`decorator`</li><li>`base_class`</li><li>`argument`</li><li>`layering` (one area must not import another)</li><li>`import_restriction` (a package or module must not, or must, be imported)</li><li>`naming`</li><li>`calls` (must use helper X)</li><li>`avoid` (must not use `any`, `console`, a raw API)</li><li>`render`</li><li>`file_layout` (where files go, file naming)</li><li>`typing`</li><li>`error_handling`</li><li>`testing`</li><li>`other`</li></ul> |
| `strength` | `must` (must, never, always, required, lint `error`) or `should` (prefer, should, avoid, lint `warn`) |
| `enabled` | `false` only for lint rules explicitly turned off |
| `enforced_by` | the lint rule that enforces a prose statement, if you found one; for lint items, the rule itself |
| `code_checkable` | `true` if a reviewer could tell from the code whether a file follows it |

When you finish, reply with one line: the number of items, and how many are `code_checkable` and `enabled`.
