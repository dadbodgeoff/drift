# Capability-assertion audit (T11)

Both of the worst findings in the falsification report share one bug class: **asserting coverage
without computing it.**

- **F3** — `filesForConvention` silently dropped every file on repo-root layouts while
  `capability_completeness` reported `complete: true, can_block: true`.
- **A4** — `repo_completeness()` took no arguments and hardcoded `complete: true`, so a scan that
  skipped files claimed it had seen everything.

Neither was a crash. Both returned a confident, wrong answer. This audit enumerates every site
that asserts a capability rather than deriving it.

| Site | Field | Verdict |
|---|---|---|
| `crates/.../protocol.rs:641` | `can_block: true` in `repo_completeness` | **Justified.** Now computed for `complete`/`missing_capabilities` (A4). `can_block` stays true deliberately: findings that *were* produced remain trustworthy, so a partial scan may still block — it must only not claim completeness. |
| `crates/.../candidate_command.rs:276` | `complete: true` for `candidate_inference` | **Was an overclaim — fixed in this task.** See below. |
| `crates/.../security_capabilities.rs` ×12 | `can_block: true` | **Overclaim. Deferred to T25.** |
| `packages/factgraph/src/index.ts:447,504` | `complete: true`, `can_block: true` | **Fail-open default. Filed as T11b.** |
| `packages/core/src/semantic-capabilities.ts` ×6 | `can_block: true` | **Declarations, not measurements.** Filed as T11c. |
| `packages/adapters/src/index.ts:391` | `can_block: true` | Adapter self-description; acceptable. |

---

## Fixed here: inference asserted its own completeness

```rust
completeness: vec![EngineCompleteness {
    complete: true,                       // unconditional
    required_capabilities: vec!["candidate_inference"],
    missing_capabilities: Vec::new(),
```

Inference decides what a data layer is with a five-substring test over the import specifier. On
midday — a real Supabase monorepo — it finds no data-access convention at all, and still reported
`complete: true` with no missing capabilities. That is F3's shape applied to inference: a
confident claim of full coverage over a heuristic that cannot see the repo's data layer.

Now derived:

```rust
let inference_complete = data_access_candidate_found || scope_file_count == 0;
```

When API routes exist but no data-access candidate was produced, inference is incomplete *by
definition* — either the repo has no data layer, or the heuristic could not see it, and the engine
cannot distinguish those. It now reports `complete: false`,
`missing_capabilities: ["data_access_inference"]`, and a reason naming the route count and
pointing at `--data-modules`. `capability_stats` carries the same missing capability.

`can_block` was already `false` here, so no enforcement authority was ever claimed on this path.

## Deferred, with reasons

**T25 — `security_capabilities.rs` (12 sites).** Every security capability declares
`can_block: true` unconditionally. Read alongside T07 this is the sharpest overclaim in the
codebase: the layer asserts blocking authority on 12 capabilities while its dominance proof is
`first_guard_line < sink.start_line` and its own "control flow is too dynamic to prove anything"
valve only fires on Drift's fixture strings. Fixing these individually would be wasted work if
T25 gates the layer behind `--experimental-security`, so it is folded into that task.

**T11b — factgraph completeness default.** These are `??` fallbacks used when a caller omits
`completeness`, not unconditional assertions. But the *default is the optimistic one*: forget the
argument and the graph claims complete and blockable. A fail-open default in a guardrail should be
inverted — default to incomplete with a reason naming the omission, so a missing argument is
visible rather than flattering.

**T11c — `semantic-capabilities.ts` (6 sites).** These are static declarations of what a
capability *is*, closer to a manifest than a measurement, so they are less dangerous. Worth
reconciling against T31 (claims ↔ behaviour), where each should be backed by a passing test.

## Standing rule

Any new `complete`, `can_block`, `verified`, `proven` or `covered` field must be computed from
evidence, or carry a comment stating why a constant is correct. `repo_completeness`'s `can_block`
is the model: constant, with the reasoning recorded inline.
