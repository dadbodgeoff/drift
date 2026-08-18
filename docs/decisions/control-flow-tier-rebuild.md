# Rebuilding the control-flow tier — design spike

**Status:** spike, no decision made
**Date:** 2026-08-18
**Applies to:** `crates/drift-engine/src/security_control_flow.rs`,
`crates/drift-engine/src/security_proof.rs` (secret taint), the `--experimental-security` gate

This document exists because the standing instruction for this tier —
`docs/internal/architecture/security-heuristic-audit.md`'s *"lift when the layer is rebuilt on AST
analysis"* — names an outcome and no design. A TDD plan cannot be written against it: red tests
written today would encode the current shape. This frames the decision so one can be made.

---

## 1. What is actually true today

Verified against `origin/main @ 5e86e89a`.

### 1.1 Guard dominance is a line-number comparison — **confirmed**

`security_control_flow.rs:42-61`:

```rust
let first_guard_line = facts.iter()
    .filter(|fact| fact.kind == FactKind::AuthGuardCalled)
    .map(|fact| fact.start_line).min()?;

protected_sinks(facts).into_iter()
    .filter(|sink| first_guard_line < sink.start_line)
```

The minimum guard line versus the sink line, numerically. Anything textually above a sink
"dominates" it: a guard inside `if (false)`, a guard in a different exported function, a guard in a
callback that never runs on the success path, a guard in dead code after an early `return`.

### 1.2 The file is 48 `.contains()` calls, and it is growing

26 at the time of the heuristic audit, **48** now. Growth is not the problem by itself — the problem
is that each new call is a new textual assumption with no shared substrate.

### 1.3 It is **not** uniformly naive

`safe_parse_success_guard_dominates:462-478` calls `strip_strings_and_line_comment(line)` before
matching. So some paths already handle strings and comments correctly and some do not. **There is no
file-wide policy** — that inconsistency is a more actionable finding than the raw count.

### 1.4 One claim in `beta-claims.json` is stale — correct it before quoting it

`docs/internal/architecture/beta-claims.json:115` states that `unsupported_dynamic_control_flow()`
*"matches only Drift fixture strings, so it opens for test inputs and never for real dynamic
dispatch."*

**That is no longer true.** `security_control_flow.rs:175-197`:

```rust
if line.contains("](") || line.contains(")(") { return true; }
if line.contains("compose(") || line.contains("applyMiddleware")
    || ((line.contains("middleware") || line.contains("guard"))
        && (line.contains(".forEach") || line.contains(".reduce") || line.contains(".map("))) { … }
```

It matches structural shapes of real dynamic dispatch, and it filters `//`- and `*`-leading lines at
`:179`. The valve works in the conservative direction. **Any plan that quotes the audit's claim as
justification is arguing from a fact that has been fixed.** The audit's other two claims in that
sentence (line-number dominance, `line.contains("if")` branch detection) still hold.

### 1.5 The blast radius is contained, and that is why this is not urgent

The tier is gated: security heuristics are behind `--experimental-security`
(`packages/cli/src/commands/conventions.ts:76`, `:122-126`; `commands/start.ts:102`) and are never
auto-accepted. The mitigation is a product gate and it is in place. **A rebuild is a capability
project, not an incident response.**

### 1.6 The same design gap owns the secret-exposure taint problem (R5)

`security_proof.rs:1630-1686` runs a whole-file textual fixpoint with no scope and no order.
Reproduced **[CONFIRMED]**:

```ts
function loadConfig() {
  const key = process.env.STRIPE_API_KEY;   // `key` here
  return key.length;
}
export function logRequest(key: string) {   // a DIFFERENT `key`
  console.error(key);                        // → exposed=1, status=MissingProof
}
```

and order-blindness — a sink textually above the assignment that taints it is still reported.

**These are one design problem, not two.** Both need the same missing thing: a statement-level
notion of *where you are in the program* — scope, and reachability along the success path. Deciding
the fact substrate twice is how the codebase ends up with two.

---

## 2. What the current architecture permits

Three constraints, all established and not worth re-deriving:

1. **Crate boundary.** `security_control_flow.rs` and `security_proof.rs` are lib-crate modules and
   cannot see `protocol.rs`'s graph types (compile-proven: `error[E0433]`). Whatever they consume
   must arrive as `Fact`s or as plain data.
2. **The vocabulary generator is the house mechanism for new fact kinds.** A member added to
   `vocabulary/vocabulary.json` becomes a Rust variant with an exhaustive `as_wire`/`from_wire` and
   a TypeScript schema, and `scripts/vocabulary-parity.mjs` then requires it to have a producer and
   a consumer. Any option below that adds facts gets that enforcement for free.
3. **`facts.rs` already owns the tree-sitter walk.** It is the only place that has the syntax tree,
   and therefore the only place that can answer "is this token inside a comment / a string / this
   function / this branch."

---

## 3. Options

### Option A — leave it quarantined, delete nothing

**Cost:** zero. **Value:** zero. The tier keeps growing textual assumptions (26 → 48), and the
inconsistency in §1.3 keeps widening. Legitimate only as an explicit "not now," with a date.

### Option B — statement-position facts, then migrate consumers one at a time

Emit from `facts.rs`, at the tree-sitter layer, a small set of structural facts that the current text
scans are approximating:

| fact | answers | replaces |
|---|---|---|
| enclosing function id per fact | "are these two references the same scope?" | R5's cross-scope false positive |
| statement index within its function | "does this run before that?" | line-number dominance (§1.1) |
| branch id + branch polarity | "are these on the same path?" | `line.contains("if")` |
| reachability-on-success | "does this run when the handler returns normally?" | guard-in-a-catch-block |
| token classification (code / comment / string) | "is this real?" | the §1.3 inconsistency |

Then migrate consumers **one predicate at a time**, each independently shippable against the
existing fixture corpus.

**Why this is the incremental path and not a rewrite:** each fact is additive, each migration is one
function, and the fixtures that pin today's behavior stay green or change with a named reason. It is
the same shape as the security plan's S6, one layer deeper.

**Cost:** the fact-emission work is real tree-sitter surgery in `facts.rs`. Migration is then cheap
and parallelizable. **Risk:** the fact set is a guess until at least two consumers use it — mitigate
by migrating R5's taint pass and guard dominance first, since they stress scope and order
respectively.

**Open question that gates the estimate:** does the current `Fact` shape have room for these, or does
it need a structured payload? `Fact` today is flat (`kind`, `name`, `value`, `imported_name`,
`start_line`, `end_line`, `start_column`, `end_column`), and several security facts already smuggle
JSON through `value` (`security_facts.rs:102-121`). That smuggling is a decision that should be made
deliberately here rather than extended by default.

### Option C — a real CFG and dataflow pass

Build a control-flow graph per handler and do proper reaching-definitions.

**Value:** answers every question in the table correctly, permanently, and would let the tier come
off `--experimental-security`. **Cost:** a different kind of project — this is the largest single
piece of engineering proposed anywhere in the current plans. **Recommendation:** do not start here.
Option B's facts are a strict subset of what a CFG would produce, so B is not wasted work if C
happens later; C-first risks a long branch with nothing shippable in it.

### Option D — delete the tier

Remove guard dominance, branch bypass, and callback boundary analysis; keep only the presence tier
(`check_command.rs:2169`), which is already documented, pinned, and honest about what it does not
claim.

**Value:** removes 807 lines of quarantined heuristics and the maintenance drag. **Cost:** gives up
the only mechanism that could ever catch "guard called after the sink," which is the failure the
presence tier explicitly does not catch (`check_command.rs:1810-1824`) and which
`beta-claims.json:108` documents as a known non-catch. **This is a product decision about whether
Drift intends to make control-flow claims at all** — not an engineering call, and it should be made
before B or C is scheduled, because B and C are only worth doing if the answer is yes.

---

## 4. What I recommend deciding, and in what order

1. **First, answer D's question:** does Drift intend to make control-flow claims? If no, D is cheap
   and everything below is moot. If yes, continue.
2. **Then B, scoped to two consumers** — R5's taint pass and guard dominance. Two consumers is the
   minimum that tests whether the fact set generalizes; one consumer would design the facts around
   itself.
3. **Sequence B after the security plan's S6.** S6 already moves secret reads and response/log sinks
   onto AST-emitted facts. B extends that substrate rather than opening a second front in
   `facts.rs`.
4. **Leave C unscheduled** until B has landed and its limits are measured rather than predicted.

## 5. What this spike deliberately does not do

- **It does not pick an option.** D's question is a product call.
- **It does not estimate.** The `Fact`-shape question in Option B moves the estimate by more than
  any guess would be worth.
- **It does not propose lifting `--experimental-security`.** That gate is the reason none of this is
  urgent, and it should be the last thing to change, not the first.
- **It does not re-litigate the presence tier.** `check_command.rs:2169` is a documented, pinned,
  deliberate trade and is out of scope here.

## 6. Corrections this spike carries

`beta-claims.json:115`'s claim about `unsupported_dynamic_control_flow()` is stale (§1.4). It should
be corrected in place whichever option is chosen, because it currently understates the tier and
would distort any cost/benefit argument built on it.
