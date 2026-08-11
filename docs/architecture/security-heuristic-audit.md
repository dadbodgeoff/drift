# Security-heuristic audit (T07)

Verifies the audit's claims about the security layer **before** committing 1.5 weeks to gating
it. B2's premise turned out false, so premises are checked first as policy.

Method: code inspection plus, where a bare scan can exercise it, a fixture. Three claims need a
hand-written contract to exercise empirically (auth-guard facts are only emitted once a
convention names the helper), so those are marked inspection-only and carry a follow-up.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Guard "dominance" is line ordering, not control flow | **CONFIRMED** | `security_control_flow.rs:42` |
| 2 | Branch detection is `line.contains("if")` | **CONFIRMED** | `security_control_flow.rs:83,116`, `security_proof.rs:1295`, `security_facts.rs:1100` |
| 3 | `computed_handler` is a fixture string used as a production signal | **CONFIRMED — fail-open** | `security_control_flow.rs:162` |
| 4 | `parseRequestBody(` / `driftSensitive` are fixture-specific identifiers | **CONFIRMED** | `security_facts.rs:935,995,1010,1144` |
| 5 | Tenant binding is a textual `.user.<key>` match | **CONFIRMED (mitigated)** | `security_facts.rs:1318,1325,1462` |
| 6 | *(new)* An inference heuristic hardcodes an eval-repo's helper name | **CONFIRMED** | `candidate_command.rs:1035` |

---

## 1. Dominance is line ordering

```rust
pub fn guard_dominates_straight_line_sinks(facts: &[Fact]) -> Vec<DominatedSink> {
    let Some(first_guard_line) = /* min start_line of AuthGuardCalled */ else { return vec![] };
    protected_sinks(facts).into_iter()
        .filter(|sink| first_guard_line < sink.start_line)
```

A sink is "dominated" — treated as auth-protected — if *any* auth guard appears on an earlier
line **anywhere in the file**. Consequences: a guard inside a branch that does not execute
protects everything below it; a guard in an unrelated function in the same file counts; an
early-return guard placed after the sink does not count even though it may be correct.

This is the direction that matters: it claims protection that may not exist.

`test/fixtures/security-auth-branch-bypass/` exists for exactly this case —

```ts
if (request.headers.get("x-auth") === "yes") {
  await requireUser();            // line 6
} else {
  const projects = await db.project.findMany();   // line 8 - reached with no auth
}
```

— and **no test in the repo references that fixture.** Line 6 < line 8, so naive dominance marks
the line-8 sink protected. Whether other logic rescues it is untested either way.

## 2. Branch detection is textual

`if !line.contains("if") || !line.contains('{')`. Misses `else if` chains formatted across
lines, ternaries, `switch`, early returns, guard clauses without braces, and `&&` short-circuits.
Fires on the string `if` inside identifiers and comments.

## 3. `computed_handler` — a fail-open, not just brittleness

```rust
pub fn unsupported_dynamic_control_flow(source: &str) -> bool {
    source.contains("guards[") || source.contains("await guard(") || source.contains("computed_handler")
}
```

This is the function that decides *"control flow is too dynamic to prove anything, degrade the
proof."* All three needles are shapes from Drift's own fixtures. Real dynamic dispatch —
`handlers[method]()`, `compose(mw)`, `guardFor(role)()`, `middleware.forEach` — matches none of
them, so the gap is **not** detected and the line-ordering dominance proof proceeds as if the
flow were straight-line.

The safety valve only opens for test inputs. This is the most consequential item in the audit.

## 4. Fixture-specific identifiers as production signals

`line.contains("parseRequestBody(")` gates request-validation detection; `line.contains("driftSensitive")`
gates sensitive-field classification. Real code uses `req.json()`, `schema.parse()`, `safeParse`,
`superjson`, or any local helper. Outside Drift's fixtures these signals are silent.

## 5. Tenant binding is textual (mitigated)

`line.contains(&format!("{session_var}.user.{key}"))` is a string match, not data flow, so it
misses destructuring (`const { id } = session.user`), intermediate variables, and helper
extraction. Mitigated relative to 3 and 4 because it is parameterised by the detected session
variable rather than a fixed literal.

## 6. New: an inference heuristic hardcodes an evaluation repo's helper name

```rust
|| matches!(lower.as_str(),
    "requireuser" | "getuser" | "getcurrentuser" | "currentuser" | "withworkspace")
```

`withWorkspace` is **dub's** auth wrapper. None of the surrounding broad conditions would match
it: it does not start with `get`, and contains none of `session`, `login`, `authenticate`, or
`authguard`. The literal is therefore load-bearing.

This matters beyond tidiness. The falsification report singled out *"`withWorkspace`, 253
supporting occurrences — dub's actual auth wrapper, a genuinely useful observation"* as the most
valuable output across six repos. That result exists because dub's helper name is compiled into
the engine. It is not evidence that inference generalises, and removing the literal (T26) will
correctly cost that candidate.

---

## Scope for T25 / T26

All six claims are confirmed, so both tasks proceed as planned.

- **T25 (gate the security layer):** justified. Claim 3 in particular means the layer cannot
  honestly be described as producing "proofs" — the mechanism that should detect its own
  blind spots only detects fixtures. Gate behind `--experimental-security` and strip
  proof/dominance vocabulary from user-facing output.
- **T26 (remove test-tailored literals):** justified, and it will *reduce* apparent capability.
  Expect dub to lose its `withWorkspace` auth-helper candidate and the validation/sensitive
  detection to go quiet outside fixtures. That is the honest baseline.

## Follow-up: T07b

Claims 1, 2 and 5 are inspection-only here. Exercising them end-to-end needs a hand-written
contract that names the auth helper, because `AuthGuardCalled` facts are only emitted for helpers
an accepted convention declares. Write that contract plus fixtures for: guard-in-dead-branch,
guard-in-unrelated-function, `else if` chain, ternary guard, and destructured tenant id. Then
attach a test to `security-auth-branch-bypass`, which currently has none.

---

## UN-QUARANTINE PRECONDITION UQ-1 — `path_glob_matches` silently no-ops on the default Next.js layout

**Found independently by two sessions, 2026-08-04 and 2026-08-05.** Ticketed here rather than fixed,
per Geoffrey: not a beta blocker, because the tier this breaks is quarantined. But **no future
promotion decision for any phase5/phase6 kind may be made while this is open**, because the evidence
such a decision would rest on cannot be gathered while the matcher is blind.

### The defect

`crates/drift-engine/src/check_command.rs`, `path_glob_matches`:

```rust
if let Some(prefix) = pattern.strip_suffix("/**/route.ts") {
    return file_path.starts_with(prefix) && file_path.ends_with("/route.ts");
}
```

For the default scope glob `**/app/api/**/route.ts` the stripped prefix is the literal `**/app/api`,
and `starts_with` on that matches no real path. So a **root-level `app/api/x/route.ts` — the layout
`create-next-app` generates — matches nothing**, and `phase5_file_scope_matches` returns false for
every route in such a repo.

### What it silently disables

Everything routed through `phase5_file_scope_matches`, which is every quarantined proof path:

- `api_route_requires_auth_helper` (guard dominance, `security_auth_findings_and_proofs`)
- `api_route_requires_request_validation` (input-to-sink dataflow)
- the phase6 guard kinds (rate limit, CSRF, SSRF, raw SQL, CORS)
- `api_route_forbids_sensitive_response_fields`, `api_route_forbids_secret_exposure`

On a root-level-`app/api` repo these produce **zero findings and zero proofs**, and report success
while doing so. An accepted auth convention on such a repo is inert and nothing says so.

### How it was found, twice

Both sessions found it the same way, which is worth recording because it is the only way it shows up:
the first end-to-end run of a new enforcement path returned **zero findings on a fixture repo where
every route was a violation**. Inspection of the matcher alone did not reveal it; a passing test suite
did not reveal it; only running against a repo with the default layout did.

This is F3's exact class — two glob implementations disagreeing about `**/app/api/**`, one of which
silently disables enforcement while reporting `can_block: true` — in a matcher F3's fix never reached.
`@drift/core`'s `matchesGlob` was fixed; this second engine-side implementation was not.

### Why it is not fixed here

CV-3 removed globbing from the presence path entirely rather than fixing this function: the CLI already
applies `conventionScopeFiles` and passes only in-scope facts, so the engine re-deciding scope was both
redundant and wrong. That is the right shape for the presence tier and it needs no glob matcher.

The phase5/phase6 paths are a different question. They are quarantined, they are slated for the
AST/flow rebuild, and changing what they match now would change quarantined-tier behaviour outside any
item's scope — including possibly turning a silent no-op into a flood of findings on repos whose
authors have never seen output from these kinds.

### The precondition, stated so it cannot be skipped

Before any phase5 or phase6 kind is proposed for promotion:

1. **Fix or delete `path_glob_matches`.** The preferred fix is the CV-3 shape: stop deciding scope in
   the engine and trust the caller's `conventionScopeFiles` output, which is already the single scope
   predicate in the product. If a glob matcher must survive, it has to be the shared one.
2. **Re-measure the kind on a root-level-`app/api` repo before and after.** A promotion argument built
   on numbers gathered while the matcher was blind is an argument about nothing. `taxonomy` is the
   eval repo with that layout.
3. **Add the differential.** Whatever replaces it gets a committed table of the tricky path shapes,
   paired against `@drift/core` the way `route_flavor_differential_cv2.rs` pairs the flavour rule -
   including a test that fails if the two implementations stop being compared.

Until all three are done, the honest statement about these kinds is not "quarantined because the
dominance valve only matches fixtures" — it is that, **plus** "and on the most common Next.js layout
they do not run at all."
