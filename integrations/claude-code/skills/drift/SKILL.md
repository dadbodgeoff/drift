---
name: drift
description: Ask Drift how things are done in this repository before reading files to find out. Use in any repository where the `drift` command is installed, before reading sibling files to learn how a route, handler, job or component is built, before searching for how the codebase handles auth, validation, errors, routes or data access, before creating or restructuring files, and when Drift reports a convention violation.
allowed-tools: Bash(drift card:*), Bash(drift map:*), Bash(drift example:*), Bash(drift check:*), mcp__drift__drift_card, mcp__drift__drift_map, mcp__drift__drift_example, mcp__drift__drift_explain, mcp__drift__drift_rules_for, mcp__drift__drift_check, mcp__drift__drift_security, mcp__drift__drift_practices, mcp__plugin_drift_drift__drift_card, mcp__plugin_drift_drift__drift_map, mcp__plugin_drift_drift__drift_example, mcp__plugin_drift_drift__drift_explain, mcp__plugin_drift_drift__drift_rules_for, mcp__plugin_drift_drift__drift_check, mcp__plugin_drift_drift__drift_security, mcp__plugin_drift_drift__drift_practices
---

# Working with Drift

Drift reads this repository's code and answers, as facts, how it is built: its
packages, entry points, the guards they carry, and what is not known. Where a
`.drift/conventions.yaml` exists, it also holds conventions learned from the code
and approved by its maintainers.

- **Before reading sibling files to learn how a route, handler, job or component
  is built here, run `drift card <path>` (works for a file that does not exist
  yet). Read other files only for what it lists under Not known.** It is one
  cheap call (MCP `drift_card`): the file's package, its entry points with their
  guards, what its siblings carry with a file to copy, and a last line, "Not
  known: ...". When it says "No answer for this file", read or grep as usual.
  `drift map` gives the packages, layers and entry points of the whole repository.
- **Before searching for how this codebase handles auth, validation, errors,
  routes or data access, or for its structure (packages, entry points, a file's
  role), run `drift card <target file>` (or `drift practices --path <file>` when
  available). Grep only for what it reports as not known. Keep using grep to find
  where a symbol is called or a string is defined.** These lookups are read-only
  and run without a permission prompt.

In a repository with `.drift/conventions.yaml`:

- **Before creating a file**, run `drift example <path>` and copy the structure
  of the file it names: its wrappers, guards and imports. For a path that does
  not exist yet, the examples are grouped by what the file will contain ("if it
  exports HTTP handlers"); follow the group that matches what you are writing.
- **When Drift reports a violation**, read whether it blocks. One marked
  `(blocks)` (or `mode block` in `drift check`) must be fixed to match the
  convention, unless the exception is intentional. Everything else is advice:
  follow it where it fits the code at hand; where it does not fit, no action is
  needed: no change and no comment. Each report shows the rule, why (how many
  members of its role follow it), its known exceptions ("except ...") and an
  example to copy; `drift_explain <id>` says more.
- **If a blocking finding is an intentional exception**, add
  `// drift-ignore <id>: <reason>` (`# drift-ignore <id>: <reason>` in Python)
  directly above the declaration. A comment without a reason does not suppress
  anything. Reviewers see every suppression, so give a real reason. Advice
  never needs one.
- **If Drift says suggestions are hidden until verified** (experimental), you
  may verify one with the MCP tool `drift_verify_card`: run its prompt 3 times
  in fresh contexts and send the replies back. It is optional.
- **Never edit** `.drift/conventions.yaml` or `drift.lock`. People change policy
  with `drift review`; edits by agents are denied.
- **When adding an endpoint, job or client component**, run
  `drift security <files>` to see the guards, risky operations (raw SQL, shell,
  raw HTML, computed redirects) and server-only imports it reaches. These are
  facts for you to judge, not rules; mention anything new in your summary.
- Run `drift check` before finishing to see any remaining new violations.
  Legacy code is baselined, so only new problems are listed. A violation of a
  convention in block mode (marked `(blocks)` in Drift's hook messages and
  `mode block` in `drift check`) fails the check and stops the end of your
  turn; the others, suggestions included, are advice, and need no action where
  they do not fit.
