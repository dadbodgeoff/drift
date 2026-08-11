# Enforcement bypasses (T93)

Adversarial self-review: construct a repository where `drift check` reports **pass** while a real
direct-data-access violation sits in a changed hunk, under a block-mode convention. Every success
is a finding.

Six attempts against a block-mode repo (8 clean routes, 1 baselined violation → minority
violating → block mode).

| # | Attempt | Result |
|---|---|---|
| A1 | Plain new violating route | **blocked** ✓ |
| A2 | Aliased import — `import { prisma as db }` | **blocked** ✓ |
| A3 | Namespace import — `import * as P` | **blocked** ✓ |
| A4 | **Relative path instead of alias** | **PASS — bypass** |
| A5 | Dynamic `await import()` | **blocked** ✓ |
| A6 | **Barrel re-export** | **PASS — bypass** |

Four of six held, including the three I expected to be weakest. Two did not.

## A4 — relative import of the same module

```ts
import { prisma } from "../../../lib/prisma";   // passes
import { prisma } from "@/lib/prisma";          // blocks
```

From `src/app/api/sneaky/route.ts`, `../../../lib/prisma` resolves to `src/lib/prisma` — **the
exact file** `@/lib/prisma` names. Same module, same runtime dependency, same violation. Invisible.

This is the more serious of the two: it needs no extra file and no intent. Any developer or agent
that writes relative imports bypasses enforcement completely, without knowing enforcement exists.

## A6 — barrel re-export

```ts
// src/lib/barrel.ts
export { prisma } from "@/lib/prisma";

// route
import { prisma } from "@/lib/barrel";          // passes
```

The route holds a real runtime dependency on the client; the specifier it names is the barrel.
There is a `barrel-reexport-db` fixture in the tree, so this was anticipated for *fact extraction* —
but it is not enforced.

## Root cause

Both are the same bug. `is_forbidden_import` compares **import specifier strings**:

```rust
import_source == forbidden || import_source.strip_prefix(forbidden.as_str())…
```

A convention's `forbidden_imports` holds specifiers like `@/lib/prisma`, so any other spelling of
the same module misses. There *is* a resolved-path comparison at `check_command.rs:3148`, but it
tests `resolved_path == forbidden` — a resolved file path against a specifier, which cannot match
unless the forbidden entry is itself a path.

## Fix direction — not implemented

Resolve the forbidden specifier to a file path once, then compare resolved-to-resolved, falling
back to the string comparison for bare package names (`@calcom/prisma`) that have no local file.
The resolver already produces this data; it is not being used on both sides of the comparison.

Barrels need one step more: follow re-export edges so a module that re-exports the client counts
as the client. The fact graph has those edges.

Filed as blocking rather than fixed here — it changes the core matcher, and doing that at the end
of a long run without room to verify it across all seven evaluation repos would be reckless.

## Why this deserves a standing task

This is the F3 class — the failure that produced the worst bug in the original falsification
report. F3 was a glob that could never match, reporting `complete: true` while checking nothing.
A4 and A6 are the same shape: a confident `pass` over a violation that is genuinely there.

The other four attempts holding is the useful context. Enforcement is not broadly weak; it has two
specific holes, both in how a module is *named* rather than in how violations are detected.
