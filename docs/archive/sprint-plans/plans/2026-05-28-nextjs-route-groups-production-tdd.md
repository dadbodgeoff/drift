# Next.js Route Groups Production TDD

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Drift treat Next.js route groups as first-class API route syntax across scan, graph, security proof, repo map, CLI, MCP, candidates, conventions, and policy context.

**Architecture:** Rust owns deterministic route identity, endpoint shape, security proof routing, parser gaps, and check-time rule selection. TypeScript owns product/control-plane matching, contract scopes, query/read models, CLI/MCP envelopes, and compatibility behavior, but must consume the same route identity contract through shared fixtures and tests instead of hand-written `app/api/` assumptions.

**Tech Stack:** Rust `drift-engine`, TypeScript packages `@drift/core`, `@drift/query`, `@drift/cli`, `@drift/mcp`, `@drift/engine-contract`, SQLite storage, Vitest, Cargo tests, fixture-driven e2e.

---

## Problem Statement

CLI repo-map route groups were partly addressed, but the live tree still contains `app/api/`-shaped assumptions in MCP, CLI, query/convention scope, and Rust security/endpoint code. That misses or mislabels files such as:

```text
apps/web/app/(admin)/api/projects/route.ts
apps/web/src/app/(dashboard)/(tenant)/api/workspaces/[id]/route.ts
app/api/(internal)/users/[userId]/route.ts
```

The failure is product-level, not a single regex bug. Drift must answer the same way across:

- scan file role detection
- endpoint graph nodes and route patterns
- middleware matcher coverage
- security rule `route_paths`
- accepted convention scope matching
- candidate convention scopes
- repo-map route security summaries
- MCP security context
- agent preflight
- capability reporting

## Product Contract

### Supported Next.js API Route Inputs

Drift must recognize these as API routes:

```text
app/api/users/route.ts
app/(admin)/api/users/route.ts
app/(admin)/(v2)/api/users/[id]/route.ts
src/app/(admin)/api/users/route.tsx
apps/web/app/api/(internal)/users/route.js
apps/web/src/app/(admin)/api/users/route.jsx
pages/api/users.ts
src/pages/api/users/[id].ts
apps/web/pages/api/docs/[...slug].tsx
```

Drift must not recognize these as API routes:

```text
app/(marketing)/about/route.ts
app/dashboard/page.tsx
components/api/users/route.ts
server/api/users.ts
```

### Route Identity Contract

Every recognized route gets a `RouteIdentity` with this shape:

```ts
type RouteIdentity = {
  framework: "next_app_route" | "next_pages_api";
  file_path: string;
  route_pattern: string;
  route_path: string;
  dynamic_params: string[];
  route_group_segments: string[];
  ignored_segments: string[];
  file_kind: "api_route";
};
```

Rules:

- `file_path` is repo-relative and uses `/`.
- `route_path` is the URL path before method selection, such as `/api/users/:id`.
- `route_pattern` equals `route_path` for this phase.
- App Router route groups, for example `(admin)`, are removed from URL path.
- App Router route groups before and after `api` are removed.
- App Router parallel route segments, for example `@modal`, are removed from URL path and listed in `ignored_segments`.
- App Router private segments starting with `_` are removed from URL path and listed in `ignored_segments`.
- Dynamic segments map as `[id] -> :id`, `[...slug] -> :slug*`, and `[[...slug]] -> :slug*`.
- `route_group_segments` preserves stripped route groups in file order for diagnostics only.
- Unsupported intercepting route segments such as `(.)login`, `(..)login`, and `(...)login` produce `parser_gap` when they appear in an API route path. They must not silently become deterministic route coverage.

Required examples:

| File | Route path | Route groups | Dynamic params |
| --- | --- | --- | --- |
| `app/api/users/route.ts` | `/api/users` | `[]` | `[]` |
| `app/(admin)/api/users/route.ts` | `/api/users` | `["(admin)"]` | `[]` |
| `apps/web/src/app/(dashboard)/(tenant)/api/workspaces/[id]/route.ts` | `/api/workspaces/:id` | `["(dashboard)", "(tenant)"]` | `["id"]` |
| `app/api/(internal)/users/[userId]/route.ts` | `/api/users/:userId` | `["(internal)"]` | `["userId"]` |
| `src/pages/api/docs/[...slug].tsx` | `/api/docs/:slug*` | `[]` | `["slug"]` |

### Scope Matching Contract

Accepted conventions and required checks must not depend only on legacy `**/app/api/**/route.ts` globs.

Rules:

- New candidate scopes for API route conventions must include `file_roles: ["api_route"]`.
- New candidate scopes must include route-group-aware globs:
  - `**/app/**/api/**/route.ts`
  - `**/app/**/api/**/route.tsx`
  - `**/app/**/api/**/route.js`
  - `**/app/**/api/**/route.jsx`
  - `**/pages/api/**/*.ts`
  - `**/pages/api/**/*.tsx`
  - `**/pages/api/**/*.js`
  - `**/pages/api/**/*.jsx`
- Existing accepted API route conventions with legacy `**/app/api/**/route.ts` globs remain valid.
- Compatibility expansion happens at evaluation time, not by mutating stored accepted convention JSON.
- A convention with `file_roles: ["api_route"]` and legacy app-route globs must apply to grouped API routes.
- `exclude_path_globs` still wins over compatibility expansion.
- Non-API route files must not match just because their path contains `/api/`.

### Security Contract

Security proof and middleware coverage must use normalized route identity:

- `middleware_must_cover_routes` compares matcher patterns such as `/api/:path*` against normalized route path `/api/users`, not file path `/(admin)/api/users`.
- `api_route_requires_auth_helper`, `api_route_requires_request_validation`, `api_route_requires_authorization`, and `api_route_requires_tenant_scope` select grouped API routes through `api_route` role and route identity.
- `SecurityBoundaryProof.route.file_path` remains the physical file.
- `SecurityBoundaryProof.route.route_id` remains `route:<file_path>:<METHOD>` unless a later version explicitly changes route ID semantics.
- `SecurityBoundaryProof.route.route_path` is added as normalized URL path.
- MCP and CLI display `file_path` and `route_path` separately.

### Election And Exception Contract

Election means the human acceptance path from candidate to accepted convention.

Rules:

- Candidate generation may propose route-group-aware scopes.
- Acceptance preserves the proposed scope exactly.
- Existing accepted conventions get runtime compatibility expansion only when:
  - convention kind is an API-route convention, and
  - matcher applies to `api_route` either through `scope.file_roles` or `matcher.applies_to_file_roles`, and
  - legacy globs include `app/api` or `pages/api`.
- Runtime expansion must be visible in diagnostics as `api_route_scope_compatibility_expanded`.
- Exceptions remain path based and exact. A grouped route exception must name the physical file path or an explicit route-group-aware glob.
- Waivers, baselines, suppressions, expired conventions, and accepted drift preserve current behavior after the route is selected.

### Directory And Ownership Contract

New route-path logic must live in focused modules:

- `crates/drift-engine/src/next_routes.rs`: Rust route identity parser and parser-gap classification.
- `crates/drift-engine/tests/next_routes.rs`: Rust route identity unit tests.
- `packages/core/src/next-routes.ts`: TypeScript product/control-plane route identity parser and scope expansion helpers.
- `packages/core/test/next-routes.test.ts`: TypeScript route identity and compatibility-scope tests.
- `test/fixtures/next-route-groups/route-cases.json`: Cross-language route identity fixture.

Existing files must consume these modules:

- `crates/drift-engine/src/facts.rs`: file role detection only.
- `crates/drift-engine/src/main.rs`: endpoint graph route pattern only.
- `crates/drift-engine/src/security_control_flow.rs`: middleware route path matching only.
- `crates/drift-engine/src/security_rules.rs`: security contract `route_paths` matching only.
- `crates/drift-engine/src/check_command.rs`: security proof route metadata only.
- `packages/cli/src/domain/repo-paths.ts`: CLI/control-plane API route detection only.
- `packages/cli/src/check/diff.ts`: convention file selection only.
- `packages/cli/src/domain/convention-candidates.ts`: candidate scope generation only.
- `packages/query/src/index.ts`: repo-map convention and route lookup only.
- `packages/mcp/src/index.ts`: MCP task/preflight matching only.
- `packages/mcp/src/security-context.ts`: security-context read model only.

## Current Failure Inventory

- `packages/mcp/src/index.ts` has local `isApiRoutePath()` logic shaped around `app/api` and broad `route.ts` fallback.
- `packages/mcp/src/index.ts` uses raw `path_globs` in task/preflight matching, so legacy app-route scopes miss grouped routes.
- `packages/mcp/src/security-context.ts` groups raw facts by `route_id` fallback and has no normalized `route_path` display contract.
- `packages/cli/src/domain/repo-paths.ts` only matches `app/api/.../route.ts` and `pages/api`.
- `packages/cli/src/check/diff.ts` selects convention files by `path_globs` only.
- `packages/query/src/index.ts` matches repo-map convention IDs through raw globs only.
- `packages/query/src/task-intent.ts` suggests only `**/app/api/**/route.ts`.
- `packages/cli/src/domain/convention-candidates.ts` emits legacy `**/app/api/**/route.ts` scopes.
- `crates/drift-engine/src/candidate_command.rs` emits legacy `**/app/api/**/route.ts` scopes.
- `crates/drift-engine/src/main.rs` extracts endpoint shape using `strip_before_segment(..., "app/api/")`.
- `crates/drift-engine/src/security_control_flow.rs` converts file path to route path by stripping `app/`, preserving route group segments.
- `crates/drift-engine/src/security_rules.rs` duplicates that route-path conversion.
- No live v3 test covers `app/(group)/api/...`.

## Non-Negotiable Rules

- No production code before a failing test.
- Rust remains deterministic security authority.
- TypeScript may not invent proven security truth from raw facts.
- MCP must not duplicate deterministic route/security rule logic.
- Route group support must not broaden non-API `route.ts` files into API routes.
- Compatibility expansion must not mutate stored contracts or accepted convention fingerprints.
- Parser gaps are blocking for deterministic security contracts when the accepted convention requires proof.
- No CLI/MCP/storage output may include source snippets, request payloads, secret values, cookies, tokens, env values, or raw SQL values.

## Required Branch Hygiene

The active tree was dirty when this plan was written. Before implementation:

```bash
cd "/Users/geoffreyfernald/Downloads/driftv3/drift v3"
git status --short --branch
```

Expected action:

- Keep unrelated dirty files out of this route-group correction.
- Create or use a focused branch, for example `codex/nextjs-route-groups`.
- Stage only files touched for this TDD.
- Do not commit or push unless the user asks.

## Task 1: Lock Cross-Language Route Identity Fixtures

**Files:**

- Create: `test/fixtures/next-route-groups/route-cases.json`
- Create: `crates/drift-engine/tests/next_routes.rs`
- Create: `packages/core/test/next-routes.test.ts`

- [ ] **Step 1: Add the shared route fixture**

Create `test/fixtures/next-route-groups/route-cases.json`:

```json
[
  {
    "name": "plain app api route",
    "file_path": "app/api/users/route.ts",
    "is_api_route": true,
    "framework": "next_app_route",
    "route_path": "/api/users",
    "dynamic_params": [],
    "route_group_segments": [],
    "ignored_segments": []
  },
  {
    "name": "group before api",
    "file_path": "app/(admin)/api/users/route.ts",
    "is_api_route": true,
    "framework": "next_app_route",
    "route_path": "/api/users",
    "dynamic_params": [],
    "route_group_segments": ["(admin)"],
    "ignored_segments": []
  },
  {
    "name": "multiple groups before api with src app",
    "file_path": "apps/web/src/app/(dashboard)/(tenant)/api/workspaces/[id]/route.ts",
    "is_api_route": true,
    "framework": "next_app_route",
    "route_path": "/api/workspaces/:id",
    "dynamic_params": ["id"],
    "route_group_segments": ["(dashboard)", "(tenant)"],
    "ignored_segments": []
  },
  {
    "name": "group after api",
    "file_path": "app/api/(internal)/users/[userId]/route.ts",
    "is_api_route": true,
    "framework": "next_app_route",
    "route_path": "/api/users/:userId",
    "dynamic_params": ["userId"],
    "route_group_segments": ["(internal)"],
    "ignored_segments": []
  },
  {
    "name": "pages catch all",
    "file_path": "src/pages/api/docs/[...slug].tsx",
    "is_api_route": true,
    "framework": "next_pages_api",
    "route_path": "/api/docs/:slug*",
    "dynamic_params": ["slug"],
    "route_group_segments": [],
    "ignored_segments": []
  },
  {
    "name": "app non api route",
    "file_path": "app/(marketing)/about/route.ts",
    "is_api_route": false
  },
  {
    "name": "non next api folder",
    "file_path": "server/api/users/route.ts",
    "is_api_route": false
  }
]
```

- [ ] **Step 2: Write RED Rust fixture test**

Create `crates/drift-engine/tests/next_routes.rs`:

```rust
use std::fs;

use drift_engine::next_routes::next_api_route_identity;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct RouteCase {
    name: String,
    file_path: String,
    is_api_route: bool,
    framework: Option<String>,
    route_path: Option<String>,
    dynamic_params: Option<Vec<String>>,
    route_group_segments: Option<Vec<String>>,
    ignored_segments: Option<Vec<String>>,
}

#[test]
fn next_route_identity_matches_shared_fixture() {
    let fixture = fs::read_to_string("../../test/fixtures/next-route-groups/route-cases.json")
        .expect("read route fixture");
    let cases: Vec<RouteCase> = serde_json::from_str(&fixture).expect("parse route fixture");

    for case in cases {
        let identity = next_api_route_identity(&case.file_path);
        assert_eq!(identity.is_some(), case.is_api_route, "{}", case.name);
        if let Some(identity) = identity {
            assert_eq!(identity.framework, case.framework.unwrap(), "{}", case.name);
            assert_eq!(identity.route_path, case.route_path.unwrap(), "{}", case.name);
            assert_eq!(identity.dynamic_params, case.dynamic_params.unwrap(), "{}", case.name);
            assert_eq!(
                identity.route_group_segments,
                case.route_group_segments.unwrap(),
                "{}",
                case.name
            );
            assert_eq!(identity.ignored_segments, case.ignored_segments.unwrap(), "{}", case.name);
        }
    }
}
```

Run:

```bash
cargo test -p drift-engine next_route_identity_matches_shared_fixture -- --nocapture
```

Expected RED: compile fails because `drift_engine::next_routes::next_api_route_identity` does not exist.

- [ ] **Step 3: Write RED TypeScript fixture test**

Create `packages/core/test/next-routes.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextApiRouteIdentity } from "../src/next-routes.js";

interface RouteCase {
  name: string;
  file_path: string;
  is_api_route: boolean;
  framework?: string;
  route_path?: string;
  dynamic_params?: string[];
  route_group_segments?: string[];
  ignored_segments?: string[];
}

const cases = JSON.parse(
  readFileSync(new URL("../../../test/fixtures/next-route-groups/route-cases.json", import.meta.url), "utf8")
) as RouteCase[];

describe("nextApiRouteIdentity", () => {
  for (const routeCase of cases) {
    it(routeCase.name, () => {
      const identity = nextApiRouteIdentity(routeCase.file_path);
      expect(Boolean(identity)).toBe(routeCase.is_api_route);
      if (identity) {
        expect(identity.framework).toBe(routeCase.framework);
        expect(identity.route_path).toBe(routeCase.route_path);
        expect(identity.dynamic_params).toEqual(routeCase.dynamic_params);
        expect(identity.route_group_segments).toEqual(routeCase.route_group_segments);
        expect(identity.ignored_segments).toEqual(routeCase.ignored_segments);
      }
    });
  }
});
```

Run:

```bash
pnpm --filter @drift/core test -- next-routes
```

Expected RED: compile fails because `packages/core/src/next-routes.ts` does not exist.

## Task 2: Implement Rust Route Identity And File Roles

**Files:**

- Create: `crates/drift-engine/src/next_routes.rs`
- Modify: `crates/drift-engine/src/lib.rs`
- Modify: `crates/drift-engine/src/facts.rs`
- Test: `crates/drift-engine/tests/next_routes.rs`
- Test: `crates/drift-engine/tests/typescript_facts.rs`

- [ ] **Step 1: Implement minimal Rust route identity**

Create `crates/drift-engine/src/next_routes.rs` with:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NextApiRouteIdentity {
    pub framework: String,
    pub file_path: String,
    pub route_path: String,
    pub route_pattern: String,
    pub dynamic_params: Vec<String>,
    pub route_group_segments: Vec<String>,
    pub ignored_segments: Vec<String>,
}

pub fn next_api_route_identity(file_path: &str) -> Option<NextApiRouteIdentity> {
    let normalized = file_path.replace('\\', "/");
    next_app_route_identity(&normalized).or_else(|| next_pages_api_identity(&normalized))
}

fn next_app_route_identity(file_path: &str) -> Option<NextApiRouteIdentity> {
    let route_suffix = ["/route.ts", "/route.tsx", "/route.js", "/route.jsx"]
        .iter()
        .find(|suffix| file_path.ends_with(**suffix))?;
    let without_route = file_path.strip_suffix(route_suffix)?;
    let segments = without_route.split('/').filter(|segment| !segment.is_empty()).collect::<Vec<_>>();
    let app_index = segments.iter().position(|segment| *segment == "app")?;
    let route_segments = &segments[app_index + 1..];
    let api_index = route_segments.iter().position(|segment| *segment == "api")?;
    let mut dynamic_params = Vec::new();
    let mut route_group_segments = Vec::new();
    let mut ignored_segments = Vec::new();
    let mut url_segments = Vec::new();

    for segment in route_segments.iter().skip(api_index) {
        if is_route_group(segment) {
            route_group_segments.push((*segment).to_string());
            continue;
        }
        if segment.starts_with('@') || segment.starts_with('_') {
            ignored_segments.push((*segment).to_string());
            continue;
        }
        url_segments.push(normalize_route_segment(segment, &mut dynamic_params));
    }

    if url_segments.first().map(|segment| segment.as_str()) != Some("api") {
        return None;
    }
    let route_path = format!("/{}", url_segments.join("/"));
    Some(NextApiRouteIdentity {
        framework: "next_app_route".to_string(),
        file_path: file_path.to_string(),
        route_pattern: route_path.clone(),
        route_path,
        dynamic_params,
        route_group_segments,
        ignored_segments,
    })
}

fn next_pages_api_identity(file_path: &str) -> Option<NextApiRouteIdentity> {
    let marker = "pages/api/";
    let index = file_path.find(marker)?;
    let route = &file_path[index + "pages/".len()..];
    let route = route
        .strip_suffix(".ts")
        .or_else(|| route.strip_suffix(".tsx"))
        .or_else(|| route.strip_suffix(".js"))
        .or_else(|| route.strip_suffix(".jsx"))?;
    let mut dynamic_params = Vec::new();
    let url_segments = route
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| normalize_route_segment(segment, &mut dynamic_params))
        .collect::<Vec<_>>();
    let route_path = format!("/{}", url_segments.join("/"));
    Some(NextApiRouteIdentity {
        framework: "next_pages_api".to_string(),
        file_path: file_path.to_string(),
        route_pattern: route_path.clone(),
        route_path,
        dynamic_params,
        route_group_segments: Vec::new(),
        ignored_segments: Vec::new(),
    })
}

fn is_route_group(segment: &str) -> bool {
    segment.starts_with('(')
        && segment.ends_with(')')
        && !segment.starts_with("(.)")
        && !segment.starts_with("(..)")
        && !segment.starts_with("(...)")
}

fn normalize_route_segment(segment: &str, dynamic_params: &mut Vec<String>) -> String {
    if let Some(param) = segment.strip_prefix("[[...").and_then(|value| value.strip_suffix("]]")) {
        dynamic_params.push(param.to_string());
        format!(":{param}*")
    } else if let Some(param) = segment.strip_prefix("[...").and_then(|value| value.strip_suffix(']')) {
        dynamic_params.push(param.to_string());
        format!(":{param}*")
    } else if let Some(param) = segment.strip_prefix('[').and_then(|value| value.strip_suffix(']')) {
        dynamic_params.push(param.to_string());
        format!(":{param}")
    } else {
        segment.to_string()
    }
}
```

Export it from `crates/drift-engine/src/lib.rs`:

```rust
pub mod next_routes;
```

- [ ] **Step 2: Run Rust fixture GREEN**

```bash
cargo test -p drift-engine next_route_identity_matches_shared_fixture -- --nocapture
```

Expected GREEN: all shared fixture cases pass.

- [ ] **Step 3: Write RED file-role test**

Add to `crates/drift-engine/tests/typescript_facts.rs`:

```rust
#[test]
fn grouped_next_api_route_gets_api_route_role() {
    let source = r#"export async function GET() { return Response.json({ ok: true }); }"#;
    let facts = extract_typescript_facts("apps/web/app/(admin)/api/users/route.ts", source)
        .expect("typescript facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::FileRoleDetected && fact.name == "api_route"),
        "missing api_route role: {facts:#?}"
    );
}

#[test]
fn grouped_non_api_app_route_does_not_get_api_route_role() {
    let source = r#"export default function Page() { return null; }"#;
    let facts = extract_typescript_facts("apps/web/app/(marketing)/about/route.ts", source)
        .expect("typescript facts");

    assert!(
        !facts
            .iter()
            .any(|fact| fact.kind == FactKind::FileRoleDetected && fact.name == "api_route"),
        "non-api route was mislabeled: {facts:#?}"
    );
}
```

Run:

```bash
cargo test -p drift-engine grouped_next_api_route_gets_api_route_role grouped_non_api_app_route_does_not_get_api_route_role -- --nocapture
```

Expected RED: grouped API route either misses `api_route`, or non-API app route is mislabeled because current detection accepts any `route.ts`.

- [ ] **Step 4: Wire file roles to Rust route identity**

In `crates/drift-engine/src/facts.rs`, replace local API route detection with `next_api_route_identity(file_path).is_some()` for App/Pages API routes.

- [ ] **Step 5: Run file-role GREEN**

```bash
cargo test -p drift-engine grouped_next_api_route_gets_api_route_role grouped_non_api_app_route_does_not_get_api_route_role -- --nocapture
```

Expected GREEN: grouped API route gets `api_route`; non-API app route does not.

## Task 3: Route Endpoint Graph Uses Normalized Identity

**Files:**

- Modify: `crates/drift-engine/src/main.rs`
- Test: `crates/drift-engine/tests/stream_graph.rs`

- [ ] **Step 1: Write RED endpoint graph test**

Add to `crates/drift-engine/tests/stream_graph.rs`:

```rust
#[test]
fn scan_stream_emits_endpoint_shape_for_grouped_next_api_routes() {
    let dir = tempfile::tempdir().expect("tempdir");
    let route = dir.path().join("apps/web/src/app/(admin)/api/users/[id]");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"export async function GET() {
  return Response.json({ ok: true });
}
"#,
    )
    .expect("write route");

    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            dir.path().to_str().expect("utf8 temp dir"),
            "--format",
            "jsonl",
            "--repo-id",
            "repo_abc",
            "--scan-id",
            "scan_abc",
        ])
        .output()
        .expect("run drift-engine");
    assert!(output.status.success(), "engine failed: {}", String::from_utf8_lossy(&output.stderr));

    let events = String::from_utf8(output.stdout)
        .expect("utf8 stdout")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("json line"))
        .collect::<Vec<_>>();
    let nodes = graph_nodes_from_events(&events);

    assert!(
        nodes.iter().any(|node| {
            node["kind"] == "endpoint"
                && node["metadata"]["file_path"] == "apps/web/src/app/(admin)/api/users/[id]/route.ts"
                && node["metadata"]["route_pattern"] == "/api/users/:id"
                && node["metadata"]["framework_role"] == "next_app_route"
        }),
        "missing grouped route endpoint shape: {nodes:#?}"
    );
}
```

Run:

```bash
cargo test -p drift-engine scan_stream_emits_endpoint_shape_for_grouped_next_api_routes -- --nocapture
```

Expected RED: endpoint node is missing or route pattern includes route-group segments.

- [ ] **Step 2: Replace `strip_before_segment(..., "app/api/")`**

In `crates/drift-engine/src/main.rs`, make `endpoint_shape()` call `next_api_route_identity(file_path)` and map identity fields directly.

- [ ] **Step 3: Run endpoint GREEN**

```bash
cargo test -p drift-engine scan_stream_emits_endpoint_shape_for_grouped_next_api_routes -- --nocapture
```

Expected GREEN: endpoint node has physical file path and normalized route pattern `/api/users/:id`.

## Task 4: Security Middleware And Route-Path Matching Use Normalized Identity

**Files:**

- Modify: `crates/drift-engine/src/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_rules.rs`
- Test: `crates/drift-engine/tests/security_rules.rs`
- Test: `crates/drift-engine/tests/security_check_repo_auth.rs`

- [ ] **Step 1: Write RED middleware coverage test**

Add to `crates/drift-engine/tests/security_rules.rs`:

```rust
#[test]
fn middleware_matcher_covers_grouped_next_api_route() {
    let middleware_facts = extract_security_facts(
        "middleware.ts",
        r#"import { NextResponse } from "next/server";
export function middleware(request) {
  return NextResponse.next();
}
export const config = { matcher: ["/api/:path*"] };
"#,
        &["NextResponse.next"],
    )
    .expect("middleware facts");

    let (matched, mismatches) = static_middleware_coverage(
        &middleware_facts,
        "app/(admin)/api/projects/route.ts",
        "GET",
    );

    assert_eq!(mismatches, Vec::new(), "unexpected mismatches: {mismatches:#?}");
    assert_eq!(matched.len(), 1, "missing middleware coverage: {matched:#?}");
}
```

Run:

```bash
cargo test -p drift-engine middleware_matcher_covers_grouped_next_api_route -- --nocapture
```

Expected RED: current `route_path_from_file()` produces `/(admin)/api/projects`, so `/api/:path*` does not match.

- [ ] **Step 2: Write RED route-path contract filter test**

Add to `crates/drift-engine/tests/security_check_repo_auth.rs`:

```rust
#[test]
fn route_paths_contract_selects_grouped_next_api_route_by_normalized_path() {
    let repo_root = tempfile::tempdir().expect("tempdir");
    let route_path = repo_root.path().join("app/(admin)/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        r#"export async function GET() {
  return Response.json({ ok: true });
}
"#,
    )
    .expect("write route");

    let result = run_security_check_for_repo_with_contract(
        repo_root.path(),
        serde_json::json!({
            "kind": "api_route_requires_auth_helper",
            "matcher": {
                "applies_to_file_roles": ["api_route"],
                "route_paths": ["/api/projects"]
            },
            "enforcement_mode": "block",
            "enforcement_capability": "deterministic_check"
        }),
    );

    assert!(
        result.findings.iter().any(|finding| finding.rule_id == "api_route_requires_auth_helper"),
        "grouped route was not selected by normalized route path: {result:#?}"
    );
}
```

Run:

```bash
cargo test -p drift-engine route_paths_contract_selects_grouped_next_api_route_by_normalized_path -- --nocapture
```

Expected RED: route is skipped because current route-path filter compares the unnormalized grouped path.

- [ ] **Step 3: Implement GREEN security matching**

In `security_control_flow.rs` and `security_rules.rs`, replace local `route_path_from_file()` with `next_api_route_identity(file_path).map(|identity| identity.route_path)`.

- [ ] **Step 4: Run security GREEN**

```bash
cargo test -p drift-engine middleware_matcher_covers_grouped_next_api_route route_paths_contract_selects_grouped_next_api_route_by_normalized_path -- --nocapture
```

Expected GREEN: grouped routes are covered by `/api/:path*` and selected by contract `route_paths`.

## Task 5: TypeScript Route Identity And Scope Compatibility

**Files:**

- Create: `packages/core/src/next-routes.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/next-routes.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Implement TypeScript route identity**

Create `packages/core/src/next-routes.ts`:

```ts
export interface NextApiRouteIdentity {
  framework: "next_app_route" | "next_pages_api";
  file_path: string;
  route_path: string;
  route_pattern: string;
  dynamic_params: string[];
  route_group_segments: string[];
  ignored_segments: string[];
}

export const API_ROUTE_SCOPE_GLOBS = [
  "**/app/**/api/**/route.ts",
  "**/app/**/api/**/route.tsx",
  "**/app/**/api/**/route.js",
  "**/app/**/api/**/route.jsx",
  "**/pages/api/**/*.ts",
  "**/pages/api/**/*.tsx",
  "**/pages/api/**/*.js",
  "**/pages/api/**/*.jsx"
];

export function nextApiRouteIdentity(filePath: string): NextApiRouteIdentity | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  return nextAppRouteIdentity(normalized) ?? nextPagesApiIdentity(normalized);
}

export function isNextApiRoutePath(filePath: string): boolean {
  return Boolean(nextApiRouteIdentity(filePath));
}

export function expandApiRouteScopeGlobs(globs: string[]): string[] {
  const hasLegacyApiRouteGlob = globs.some((glob) =>
    glob.includes("app/api/") || glob.includes("pages/api/")
  );
  return hasLegacyApiRouteGlob
    ? [...new Set([...globs, ...API_ROUTE_SCOPE_GLOBS])].sort()
    : [...globs].sort();
}

function nextAppRouteIdentity(filePath: string): NextApiRouteIdentity | undefined {
  const suffix = ["/route.ts", "/route.tsx", "/route.js", "/route.jsx"].find((value) => filePath.endsWith(value));
  if (!suffix) return undefined;
  const segments = filePath.slice(0, -suffix.length).split("/").filter(Boolean);
  const appIndex = segments.indexOf("app");
  if (appIndex < 0) return undefined;
  const routeSegments = segments.slice(appIndex + 1);
  const apiIndex = routeSegments.indexOf("api");
  if (apiIndex < 0) return undefined;
  const dynamic_params: string[] = [];
  const route_group_segments: string[] = [];
  const ignored_segments: string[] = [];
  const urlSegments: string[] = [];

  for (const segment of routeSegments.slice(apiIndex)) {
    if (isRouteGroup(segment)) {
      route_group_segments.push(segment);
      continue;
    }
    if (segment.startsWith("@") || segment.startsWith("_")) {
      ignored_segments.push(segment);
      continue;
    }
    urlSegments.push(normalizeSegment(segment, dynamic_params));
  }

  if (urlSegments[0] !== "api") return undefined;
  const route_path = `/${urlSegments.join("/")}`;
  return {
    framework: "next_app_route",
    file_path: filePath,
    route_path,
    route_pattern: route_path,
    dynamic_params,
    route_group_segments,
    ignored_segments
  };
}

function nextPagesApiIdentity(filePath: string): NextApiRouteIdentity | undefined {
  const marker = "pages/api/";
  const index = filePath.indexOf(marker);
  if (index < 0) return undefined;
  const route = filePath
    .slice(index + "pages/".length)
    .replace(/\.(ts|tsx|js|jsx)$/, "");
  if (route === filePath.slice(index + "pages/".length)) return undefined;
  const dynamic_params: string[] = [];
  const route_path = `/${route.split("/").filter(Boolean).map((segment) => normalizeSegment(segment, dynamic_params)).join("/")}`;
  return {
    framework: "next_pages_api",
    file_path: filePath,
    route_path,
    route_pattern: route_path,
    dynamic_params,
    route_group_segments: [],
    ignored_segments: []
  };
}

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") &&
    segment.endsWith(")") &&
    !segment.startsWith("(.)") &&
    !segment.startsWith("(..)") &&
    !segment.startsWith("(...)");
}

function normalizeSegment(segment: string, dynamicParams: string[]): string {
  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll?.[1]) {
    dynamicParams.push(optionalCatchAll[1]);
    return `:${optionalCatchAll[1]}*`;
  }
  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll?.[1]) {
    dynamicParams.push(catchAll[1]);
    return `:${catchAll[1]}*`;
  }
  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic?.[1]) {
    dynamicParams.push(dynamic[1]);
    return `:${dynamic[1]}`;
  }
  return segment;
}
```

Export from `packages/core/src/index.ts`:

```ts
export * from "./next-routes.js";
```

- [ ] **Step 2: Run TypeScript route fixture GREEN**

```bash
pnpm --filter @drift/core test -- next-routes
```

Expected GREEN: all shared fixture cases pass.

- [ ] **Step 3: Write RED compatibility-scope tests**

Add tests in `packages/core/test/next-routes.test.ts`:

```ts
import { expandApiRouteScopeGlobs, isNextApiRoutePath } from "../src/next-routes.js";

it("expands legacy app api globs for grouped app api routes", () => {
  const globs = expandApiRouteScopeGlobs(["**/app/api/**/route.ts"]);
  expect(globs).toContain("**/app/**/api/**/route.ts");
});

it("recognizes grouped api route and rejects non api app route", () => {
  expect(isNextApiRoutePath("app/(admin)/api/projects/route.ts")).toBe(true);
  expect(isNextApiRoutePath("app/(marketing)/about/route.ts")).toBe(false);
});
```

Run:

```bash
pnpm --filter @drift/core test -- next-routes
```

Expected GREEN after the implementation above.

## Task 6: CLI Uses Shared Route Scope Semantics

**Files:**

- Modify: `packages/cli/src/domain/repo-paths.ts`
- Modify: `packages/cli/src/check/diff.ts`
- Modify: `packages/cli/src/domain/convention-candidates.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/cli/test/security-check.test.ts`

- [ ] **Step 1: Write RED CLI route detection test**

Add a CLI test that creates `apps/web/app/(admin)/api/projects/route.ts`, scans, and asserts repo-map lists it with role `api_route`.

Run:

```bash
pnpm --filter @drift/cli test -- cli
```

Expected RED: grouped API route is missing or not marked as `api_route` through the CLI path.

- [ ] **Step 2: Wire CLI route detection**

In `packages/cli/src/domain/repo-paths.ts`, import and use `isNextApiRoutePath()` from `@drift/core` for `isApiRoutePath()`.

- [ ] **Step 3: Write RED convention selection test**

Add a security-check test with an accepted convention whose scope is:

```ts
scope: {
  path_globs: ["**/app/api/**/route.ts"],
  file_roles: ["api_route"]
}
```

The changed file is:

```text
apps/web/app/(admin)/api/projects/route.ts
```

Assert `drift check --json` evaluates the route.

Run:

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected RED: `filesForConvention()` filters only by raw globs and skips the grouped route.

- [ ] **Step 4: Implement compatibility scope matching**

In `packages/cli/src/check/diff.ts`, expand API route globs before matching when the convention applies to API route roles. Keep `exclude_path_globs` unexpanded and authoritative.

The matching rule:

```ts
const pathGlobs = convention.scope.file_roles?.includes("api_route")
  ? expandApiRouteScopeGlobs(convention.scope.path_globs)
  : convention.scope.path_globs;
```

- [ ] **Step 5: Update candidate scopes**

In `packages/cli/src/domain/convention-candidates.ts`, replace hard-coded API scope arrays with `API_ROUTE_SCOPE_GLOBS` plus `file_roles: ["api_route"]`.

- [ ] **Step 6: Run CLI GREEN**

```bash
pnpm --filter @drift/cli test -- cli
pnpm --filter @drift/cli test -- security-check
```

Expected GREEN: grouped API routes are discovered, selected, and checked; non-API app routes stay out.

## Task 7: Rust Candidate Scopes And Check Command Use Route Groups

**Files:**

- Modify: `crates/drift-engine/src/candidate_command.rs`
- Modify: `crates/drift-engine/src/check_command.rs`
- Test: `crates/drift-engine/tests/candidate_inference.rs`
- Test: `crates/drift-engine/tests/security_check_repo_request_validation.rs`

- [ ] **Step 1: Write RED Rust candidate-scope test**

Add a candidate inference test asserting generated API-route convention candidates include `**/app/**/api/**/route.ts` and `file_roles: ["api_route"]`.

Run:

```bash
cargo test -p drift-engine candidate_inference -- --nocapture
```

Expected RED: candidate scope contains only legacy `**/app/api/**/route.ts`.

- [ ] **Step 2: Implement candidate scope update**

In `candidate_command.rs`, replace legacy API glob arrays with the route-group-aware set from this TDD.

- [ ] **Step 3: Write RED check-command route metadata test**

Add request-validation or auth check-command coverage for:

```text
app/(admin)/api/projects/route.ts
```

Assert engine check output proof includes:

```json
{
  "route": {
    "file_path": "app/(admin)/api/projects/route.ts",
    "route_path": "/api/projects"
  }
}
```

Run:

```bash
cargo test -p drift-engine security_check_repo_request_validation -- --nocapture
```

Expected RED: proof lacks `route_path` or uses grouped path.

- [ ] **Step 4: Add route path to proof metadata**

In `check_command.rs`, when constructing `SecurityBoundaryProof`, attach normalized `route_path` from `next_api_route_identity(file_path)`.

- [ ] **Step 5: Run Rust GREEN**

```bash
cargo test -p drift-engine candidate_inference security_check_repo_request_validation -- --nocapture
```

Expected GREEN: candidate scopes and proof route metadata are route-group aware.

## Task 8: Query And Repo Map Use Shared Scope Semantics

**Files:**

- Modify: `packages/query/src/index.ts`
- Modify: `packages/query/src/task-intent.ts`
- Test: `packages/query/test/query.test.ts`

- [ ] **Step 1: Write RED repo-map convention test**

Add a query test where:

- file path is `apps/web/app/(admin)/api/projects/route.ts`
- accepted convention scope has legacy `**/app/api/**/route.ts`
- convention has `file_roles: ["api_route"]`

Assert `repoMapConventionIds()` returns the convention ID.

Run:

```bash
pnpm --filter @drift/query test -- query
```

Expected RED: query raw glob matching misses the grouped file.

- [ ] **Step 2: Implement query scope compatibility**

In `packages/query/src/index.ts`, use `expandApiRouteScopeGlobs()` when convention scope or matcher applies to `api_route`.

- [ ] **Step 3: Update task-intent likely files**

In `packages/query/src/task-intent.ts`, replace `**/app/api/**/route.ts` with:

```ts
files.add("**/app/**/api/**/route.ts");
files.add("**/app/**/api/**/route.tsx");
files.add("**/pages/api/**/*.ts");
files.add("**/pages/api/**/*.tsx");
```

- [ ] **Step 4: Run query GREEN**

```bash
pnpm --filter @drift/query test -- query
```

Expected GREEN: repo-map convention matching and likely-file output include grouped API routes.

## Task 9: MCP Removes Local Route Assumptions

**Files:**

- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/security-context.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write RED MCP preflight test**

Add an MCP test where:

- target path is `apps/web/app/(admin)/api/projects/route.ts`
- accepted convention uses legacy `**/app/api/**/route.ts`
- file role is `api_route`

Assert `get_task_preflight` returns:

- the grouped route in relevant files
- `api_route` role
- the accepted convention
- graph route context when graph data exists

Run:

```bash
pnpm --filter @drift/mcp test -- mcp
```

Expected RED: MCP local `isApiRoutePath()` or raw scope matching misses the route.

- [ ] **Step 2: Replace MCP route detection**

In `packages/mcp/src/index.ts`, import `isNextApiRoutePath()` and `expandApiRouteScopeGlobs()` from `@drift/core`. Replace local API-route regex and raw scope matching with shared helpers.

- [ ] **Step 3: Write RED MCP security-context test**

Add an MCP security-context test with stored facts/proofs for `apps/web/app/(admin)/api/projects/route.ts`.

Assert security context emits:

```json
{
  "file_path": "apps/web/app/(admin)/api/projects/route.ts",
  "route_path": "/api/projects"
}
```

Assert it does not emit source snippets or raw payload values.

Run:

```bash
pnpm --filter @drift/mcp test -- mcp
```

Expected RED: security context lacks normalized route path and only groups by raw route ID/file path.

- [ ] **Step 4: Implement MCP security-context route identity**

In `packages/mcp/src/security-context.ts`, derive display route path with `nextApiRouteIdentity(fact.file_path)?.route_path ?? null`. Do not use that route path to fabricate proof status.

- [ ] **Step 5: Run MCP GREEN**

```bash
pnpm --filter @drift/mcp test -- mcp
```

Expected GREEN: MCP preflight and security context include grouped routes and normalized route paths.

## Task 10: End-To-End Product Fixture

**Files:**

- Create: `test/fixtures/next-route-groups/app/(admin)/api/projects/route.ts`
- Create: `test/fixtures/next-route-groups/middleware.ts`
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Add fixture route**

Create `test/fixtures/next-route-groups/app/(admin)/api/projects/route.ts`:

```ts
import { prisma } from "@/lib/prisma";

export async function GET() {
  const projects = await prisma.project.findMany();
  return Response.json({ projects });
}
```

Create `test/fixtures/next-route-groups/middleware.ts`:

```ts
import { NextResponse } from "next/server";

export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"]
};
```

- [ ] **Step 2: Write RED CLI e2e test**

Add an e2e-style CLI test that runs scan, accepts/imports an API route convention, runs check, and asserts:

- grouped route is scanned
- grouped route has `api_route`
- repo map includes route security context for that physical file
- direct data access finding is produced for the grouped route
- middleware coverage compares against `/api/projects`

Run:

```bash
pnpm --filter @drift/cli test -- cli
```

Expected RED before earlier tasks, GREEN after route identity is wired through.

- [ ] **Step 3: Write RED MCP parity test**

Add an MCP test against the same fixture state and assert MCP security context and task preflight agree with CLI/query route identity.

Run:

```bash
pnpm --filter @drift/mcp test -- mcp
```

Expected RED before MCP task, GREEN after MCP uses shared helpers.

## Task 11: Capability And Documentation Updates

**Files:**

- Modify: `docs/architecture/security-boundary-enforcement-100-tdd.md`
- Modify: `docs/architecture/canonical-contracts.md`
- Modify: `docs/architecture/graph-query-api.md`
- Modify only if capability payloads list route limitations: `packages/core/src/capabilities.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Document route identity contract**

Add a short section to `security-boundary-enforcement-100-tdd.md` that says Next.js route groups are supported only through the shared route identity contract and parser gaps must represent unsupported intercepting segments.

- [ ] **Step 2: Update canonical contracts**

Add a canonical-defined entry for `Next.js Route Identity` with:

- physical file path
- normalized route path
- route groups stripped from URL
- cross-language fixture parity
- CLI/MCP/query integration requirement

- [ ] **Step 3: Update graph query API**

Document that graph route queries accept either physical file path or normalized route path and return both.

- [ ] **Step 4: Run docs and CLI capability checks**

```bash
pnpm --filter @drift/cli test -- cli
git diff --check
```

Expected GREEN: docs are clean and capability payloads do not overclaim unsupported route syntax.

## Final Verification Gates

Run these from `/Users/geoffreyfernald/Downloads/driftv3/drift v3`:

```bash
cargo test -p drift-engine next_route_identity_matches_shared_fixture -- --nocapture
cargo test -p drift-engine grouped_next_api_route_gets_api_route_role grouped_non_api_app_route_does_not_get_api_route_role -- --nocapture
cargo test -p drift-engine scan_stream_emits_endpoint_shape_for_grouped_next_api_routes -- --nocapture
cargo test -p drift-engine middleware_matcher_covers_grouped_next_api_route route_paths_contract_selects_grouped_next_api_route_by_normalized_path -- --nocapture
cargo test -p drift-engine candidate_inference security_check_repo_request_validation -- --nocapture
pnpm --filter @drift/core test -- next-routes
pnpm --filter @drift/query test -- query
pnpm --filter @drift/cli test -- cli
pnpm --filter @drift/cli test -- security-check
pnpm --filter @drift/mcp test -- mcp
pnpm verify:ci
git diff --check
```

Required manual review:

- Search for remaining local route assumptions:

```bash
rg -n "app/api/|app\\/api|routePathForFile|route_path_from_file|isApiRoutePath" packages crates docs test
```

Expected result:

- Remaining `app/api` strings are tests, docs, fixtures, help examples, or compatibility globs.
- Production code uses `next_api_route_identity`, `nextApiRouteIdentity`, `isNextApiRoutePath`, or compatibility-scope helpers.

## Acceptance Criteria

- Grouped Next.js API routes are recognized as `api_route`.
- Non-API App Router `route.ts` files are not recognized as `api_route`.
- Endpoint graph nodes include normalized route patterns for grouped API routes.
- Middleware coverage matches normalized route paths.
- Security `route_paths` filters match normalized route paths.
- Existing accepted API-route conventions with legacy scopes still apply through compatibility expansion.
- New candidates emit route-group-aware scopes.
- Repo map, CLI preflight, MCP preflight, and MCP security context agree on file path and route path.
- No deterministic security proof is fabricated in TypeScript.
- No snippets, secrets, payloads, tokens, env values, or raw SQL values leak in CLI/MCP/storage output.
- Final verification gates pass.
