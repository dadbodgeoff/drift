# Agent Response Contract

Date: 2026-05-21

## Purpose

Agent-facing Drift outputs should tell agents what to do next. They should not require agents to infer whether context is fresh, policy-approved, complete, or actionable.

This contract applies to:

- CLI JSON for `prepare`, `ask`, `repo map`, `check`, `findings`, `policy check-context`
- MCP tools
- future UI/API surfaces that expose agent context

## Common Envelope

Every agent-facing JSON payload should include:

```ts
type AgentResponseEnvelope = {
  schema_version: string;
  repo_id: string;
  contract_fingerprint?: string;
  scan_fingerprint?: string;
  graph_fingerprint?: string;
  freshness: GraphFreshness;
  policy: PolicyDecision;
  diagnostics: EngineDiagnostic[];
  limits?: EngineLimits;
  truncated: boolean;
  action: AgentNextAction;
  next_commands: string[];
};
```

Payload-specific data can live beside this envelope, but these fields should be consistently named.

## Agent Action Taxonomy

```ts
type AgentNextAction =
  | "safe_to_edit"
  | "run_scan_first"
  | "blocked_by_policy"
  | "blocked_by_stale_graph"
  | "blocked_by_open_findings"
  | "needs_human_governance"
  | "unsupported_repo"
  | "context_truncated"
  | "run_required_checks";
```

Rules:

- stale graph plus `require_fresh=true` returns `blocked_by_stale_graph`
- missing scan returns `run_scan_first`
- denied policy returns `blocked_by_policy`
- incomplete/truncated context returns `context_truncated`
- accepted deterministic conventions with required checks return `run_required_checks`
- governance mutation needs return `needs_human_governance`

## Refusal Shape

When Drift refuses context, return a machine-readable reason and recovery command.

```ts
type AgentRefusal = {
  code:
    | "policy_denied"
    | "stale_graph"
    | "missing_scan"
    | "unsupported_repo"
    | "context_truncated"
    | "human_governance_required";
  message: string;
  recovery_commands: string[];
};
```

## MCP Requirements

MCP tools should:

- remain read-only in V1
- use structured output schemas
- expose the same policy/freshness/action fields as CLI JSON
- keep tool annotations as hints only, not security enforcement
- return bounded diagnostics
- avoid source snippets unless policy explicitly allows them

## Guardrail Language

Prefer product language that keeps the wedge sharp:

- `preflight`
- `allowed context`
- `required checks`
- `finding evidence`
- `route flow`
- `impact`
- `next action`

Avoid framing Drift as generic repo chat.

`ask` may remain as a convenience command, but its implementation and docs should keep saying deterministic, local, no source snippets, policy-gated, and no model calls.

## Acceptance Criteria

- `prepare`, `ask`, `repo map`, and MCP equivalents expose action/freshness/policy consistently.
- Agents can tell whether to edit, scan, stop, request human governance, or run checks without interpreting prose.
- Policy denial and stale graph failures include recovery commands.
- MCP response shapes are documented and tested against CLI parity.
