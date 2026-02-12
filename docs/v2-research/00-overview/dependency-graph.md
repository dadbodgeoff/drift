# Package Dependency Graph

## Runtime Dependencies

```
cli ──────┬──> core ──> detectors
          ├──> cortex
          ├──> dashboard
          └──> detectors

mcp ──────┬──> core ──> detectors
          ├──> cortex
          └──> detectors

lsp ──────┬──> core
          └──> detectors

vscode ───┬──> lsp (client)
          └──> (bundles extension)

ci ───────┬──> core
          └──> detectors

core ─────┬──> detectors
          └──> drift-napi (optional native dep)

cortex ───┬──> better-sqlite3
          ├──> sqlite-vec (vector search)
          └──> @xenova/transformers (embeddings)
```

## Key External Dependencies

| Dependency | Used By | Purpose |
|-----------|---------|---------|
| `tree-sitter` (Rust) | drift-core | Native AST parsing (11 languages) |
| `tree-sitter` (Node) | packages/core | TS-side AST parsing (fallback) |
| `better-sqlite3` | core, cortex | SQLite storage |
| `sqlite-vec` | cortex | Vector similarity search |
| `@xenova/transformers` | cortex | Local embedding generation |
| `rayon` | drift-core | Parallel processing |
| `rusqlite` | drift-core | Rust-side SQLite |
| `@modelcontextprotocol/sdk` | mcp | MCP protocol implementation |
| `commander` | cli | CLI framework |
| `vscode-languageclient` | vscode | LSP client |
| `vscode-languageserver` | lsp | LSP server |
| `piscina` | core, cli | Worker thread pool |
| `simple-git` | core | Git operations |

## Version Info

- Root: `drift-v2` v0.9.47
- Core: `driftdetect-core` v0.9.47
- CLI: `driftdetect` v0.9.48
- MCP: `driftdetect-mcp` v0.9.48
- Cortex: `driftdetect-cortex` v0.9.47
- Rust crates: v0.1.0
- Node: >=18, pnpm >=8
- Rust edition: 2021
