# MCP Testing

## Location
`packages/mcp/src/__tests__/`

## Test Files
- `enterprise-server-setup.test.ts` — Server initialization and setup
- `setup-handler-integration.test.ts` — Setup handler integration tests
- `setup-path-resolution.test.ts` — Path resolution security tests (path traversal prevention)
- `curation-handler.test.ts` — Curation workflow tests (verify, approve, reject)
- `telemetry-handler.test.ts` — Telemetry enable/disable/status

## Test Framework
- `vitest` — Test runner

## Key Test Areas

### Path Resolution Security
Tests that `drift_setup` properly prevents path traversal attacks:
- Relative paths resolved correctly within project root
- Absolute paths outside project root are rejected
- `../` traversal attempts are blocked

### Curation Verification
Tests the anti-hallucination verification pipeline:
- Evidence verification against actual files
- Approval requirements enforcement
- Bulk approval workflows

### Server Setup
Tests the full server initialization sequence:
- Store creation and warmup
- Tool registration
- Language detection and filtering

## Rust Rebuild Considerations
- Tests stay in TypeScript — they test the TS orchestration layer
- Path traversal tests are critical security tests — must be preserved
- Curation tests validate the anti-hallucination system — must be preserved
