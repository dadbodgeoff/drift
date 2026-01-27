# Drift MCP Server

MCP (Model Context Protocol) server that gives AI agents deep understanding of your codebase patterns, conventions, and architecture.

[![npm version](https://img.shields.io/npm/v/driftdetect-mcp.svg)](https://www.npmjs.com/package/driftdetect-mcp)

## Installation

**Recommended: Global install with pinned version**
```bash
npm install -g driftdetect-mcp@0.9.23
```

## Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "drift": {
      "command": "driftdetect-mcp"
    }
  }
}
```

### Cursor / Windsurf / Kiro

Add to your MCP config:

```json
{
  "mcpServers": {
    "drift": {
      "command": "driftdetect-mcp"
    }
  }
}
```

### Alternative: npx with pinned version

```json
{
  "mcpServers": {
    "drift": {
      "command": "npx",
      "args": ["-y", "driftdetect-mcp@0.9.23"]
    }
  }
}
```

## Prerequisites

Scan your project first:

```bash
cd /path/to/your/project
npx driftdetect init
npx driftdetect scan
```

## Security & Privacy

- **Reads**: Source files in your project directory
- **Writes**: `.drift/` directory only
- **Network**: No outbound calls (all analysis is local)
- **Telemetry**: Anonymous usage stats, opt-out with `drift telemetry disable`

## Available Tools

45+ MCP tools organized in 7 layers:

| Layer | Key Tools | Purpose |
|-------|-----------|---------|
| **Orchestration** | `drift_context` | Start here - curated context for any task |
| **Discovery** | `drift_status`, `drift_capabilities` | Quick overview |
| **Surgical** | `drift_signature`, `drift_callers`, `drift_type` | Precise queries |
| **Exploration** | `drift_patterns_list`, `drift_security_summary` | Browse patterns |
| **Detail** | `drift_pattern_get`, `drift_code_examples` | Deep dives |
| **Analysis** | `drift_test_topology`, `drift_coupling` | Code health |
| **Generation** | `drift_validate_change`, `drift_suggest_changes` | AI assistance |

## Example Usage

```
You: "Add a user preferences endpoint"

AI calls drift_context({ intent: "add_feature", focus: "user preferences" })

Drift returns:
- Your API patterns (decorators, prefixes, response format)
- Similar endpoints as examples
- Required middleware
- Files to modify
- Security considerations
```

## Documentation

- [Full Documentation](https://github.com/dadbodgeoff/drift/wiki)
- [MCP Tools Reference](https://github.com/dadbodgeoff/drift/wiki/MCP-Tools-Reference)
- [MCP Setup Guide](https://github.com/dadbodgeoff/drift/wiki/MCP-Setup)

## License

Apache 2.0 - See [LICENSE](https://github.com/dadbodgeoff/drift/blob/main/LICENSE)
