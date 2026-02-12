# LSP Server

## Location
`packages/lsp/`

## Architecture

### Server
- `server.ts` — Main LSP server
- `capabilities.ts` — Server capability declarations
- `bin/server.ts` — Entry point

### Handlers
- `initialize.ts` — Server initialization
- `diagnostics.ts` — Diagnostic publishing (pattern violations)
- `code-actions.ts` — Quick fix suggestions
- `code-lens.ts` — Inline code lens
- `hover.ts` — Hover information
- `document-sync.ts` — Document synchronization
- `commands.ts` — Command execution

### Commands
- `approve-pattern.ts` — Approve a pattern
- `create-variant.ts` — Create pattern variant
- `explain-ai.ts` — AI explanation
- `fix-ai.ts` — AI fix suggestion
- `ignore-once.ts` / `ignore-pattern.ts` — Ignore patterns
- `rescan.ts` — Trigger rescan
- `show-patterns.ts` / `show-violations.ts` — Show results

### Integration
- `core-scanner.ts` — Core scanning integration
- `pattern-store-adapter.ts` — Pattern store adapter

### Utils
- `diagnostic.ts`, `document.ts`, `position.ts`, `workspace.ts`

## v2 Notes
- LSP server stays in TypeScript (protocol requirement).
- Should be thin — delegates all analysis to Rust engine.
- Consider: Could v2 LSP be a Rust binary? (tower-lsp crate)
