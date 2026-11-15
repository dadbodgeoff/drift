You are building a reference list of the **coding conventions that the repository computer-science-fundamentals documents itself** (https://github.com/AlexGalhardo/computer-science-fundamentals at commit `1fa8d8fecb8a6f90466f466f409199506086dbfd`). A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/computer-science-fundamentals

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/f7220379-95ce-4b28-acd1-b6dbc8f3d1e7/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- `.claude/agents.md` (doc)
- `.claude/rules/code-style.md` (agent_rules)
- `.claude/rules/external-skills.md` (agent_rules)
- `.claude/rules/git-workflow.md` (agent_rules)
- `.claude/rules/load-tests.md` (agent_rules)
- `.claude/rules/mini-project.md` (agent_rules)
- `.claude/rules/quiz.md` (agent_rules)
- `.claude/rules/security-labs.md` (agent_rules)
- `.claude/skills/api-and-interface-design/SKILL.md` (agent_skill)
- `.claude/skills/brainstorming/SKILL.md` (agent_skill)
- `.claude/skills/browser-testing-with-devtools/SKILL.md` (agent_skill)
- `.claude/skills/ci-cd-and-automation/SKILL.md` (agent_skill)
- `.claude/skills/code-review-and-quality/SKILL.md` (agent_skill)
- `.claude/skills/code-simplification/SKILL.md` (agent_skill)
- `.claude/skills/constraint-driven-development/SKILL.md` (agent_skill)
- `.claude/skills/context-engineering/SKILL.md` (agent_skill)
- `.claude/skills/debugging-and-error-recovery/SKILL.md` (agent_skill)
- `.claude/skills/deprecation-and-migration/SKILL.md` (agent_skill)
- `.claude/skills/diagnosing-superpowers/SKILL.md` (agent_skill)
- `.claude/skills/dispatching-parallel-agents/SKILL.md` (agent_skill)
- `.claude/skills/documentation-and-adrs/SKILL.md` (agent_skill)
- `.claude/skills/doubt-driven-development/SKILL.md` (agent_skill)
- `.claude/skills/executing-plans/SKILL.md` (agent_skill)
- `.claude/skills/finishing-a-development-branch/SKILL.md` (agent_skill)
- `.claude/skills/frontend-ui-engineering/SKILL.md` (agent_skill)
- `.claude/skills/git-workflow-and-versioning/SKILL.md` (agent_skill)
- `.claude/skills/idea-refine/SKILL.md` (agent_skill)
- `.claude/skills/incremental-implementation/SKILL.md` (agent_skill)
- `.claude/skills/interview-me/SKILL.md` (agent_skill)
- `.claude/skills/karpathy-guidelines/SKILL.md` (agent_skill)
- `.claude/skills/observability-and-instrumentation/SKILL.md` (agent_skill)
- `.claude/skills/performance-optimization/SKILL.md` (agent_skill)
- `.claude/skills/planning-and-task-breakdown/SKILL.md` (agent_skill)
- `.claude/skills/ponytail-audit/SKILL.md` (agent_skill)
- `.claude/skills/ponytail-debt/SKILL.md` (agent_skill)
- `.claude/skills/ponytail-gain/SKILL.md` (agent_skill)
- `.claude/skills/ponytail-help/SKILL.md` (agent_skill)
- `.claude/skills/ponytail-review/SKILL.md` (agent_skill)
- `.claude/skills/ponytail/SKILL.md` (agent_skill)
- `.claude/skills/receiving-code-review/SKILL.md` (agent_skill)
- `.claude/skills/requesting-code-review/SKILL.md` (agent_skill)
- `.claude/skills/security-and-hardening/SKILL.md` (agent_skill)
- `.claude/skills/shipping-and-launch/SKILL.md` (agent_skill)
- `.claude/skills/source-driven-development/SKILL.md` (agent_skill)
- `.claude/skills/spec-driven-development/SKILL.md` (agent_skill)
- `.claude/skills/subagent-driven-development/SKILL.md` (agent_skill)
- `.claude/skills/superpowers-test-driven-development/SKILL.md` (agent_skill)
- `.claude/skills/systematic-debugging/SKILL.md` (agent_skill)
- `.claude/skills/test-driven-development/SKILL.md` (agent_skill)
- `.claude/skills/using-agent-skills/SKILL.md` (agent_skill)
- `.claude/skills/using-git-worktrees/SKILL.md` (agent_skill)
- `.claude/skills/using-superpowers/SKILL.md` (agent_skill)
- `.claude/skills/verification-before-completion/SKILL.md` (agent_skill)
- `.claude/skills/writing-plans/SKILL.md` (agent_skill)
- `.claude/skills/writing-skills/SKILL.md` (agent_skill)
- `AGENTS.md` (doc)
- `CLAUDE.md` (doc)
- `CONTRIBUTING.md` (doc)
- `biome.json` (lint)
- `ruff.toml` (lint)
- `18 more ruff.toml files, e.g. projects/algorithms/dynamic-programming/python/ruff.toml, projects/algorithms/sorting-race/python/ruff.toml, projects/artificial-intelligence/bpe-tokenizer/python/ruff.toml` (lint (collapsed: read one or two))

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

One JSON object per item, one per line. Number the refs `computer-science-fundamentals#R01`, `computer-science-fundamentals#R02`, and so on, in the order you found them.

```json
{"ref": "computer-science-fundamentals#R01", "repo": "computer-science-fundamentals",
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
