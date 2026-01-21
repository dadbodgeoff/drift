# Drift MCP Server

MCP (Model Context Protocol) server that exposes drift functionality to AI agents like Claude, Kiro, and other MCP-compatible tools.

## Installation

```bash
npm install -g driftdetect-mcp
# or
pnpm add -g driftdetect-mcp
```

## Configuration

Add to your MCP config (`.kiro/settings/mcp.json` for Kiro, or `~/.config/claude/mcp.json` for Claude Desktop):

```json
{
  "mcpServers": {
    "drift": {
      "command": "npx",
      "args": ["driftdetect-mcp", "/path/to/your/project"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "drift": {
      "command": "drift-mcp",
      "args": ["/path/to/your/project"]
    }
  }
}
```

## Available Tools

### `drift_status`
Get overall codebase pattern health and statistics.

### `drift_patterns`
Query patterns by category with optional confidence filtering.

**Parameters:**
- `categories` (optional): Array of categories to query
- `minConfidence` (optional): Minimum confidence score (0.0-1.0)

### `drift_files`
Get patterns found in a specific file or glob pattern.

**Parameters:**
- `path` (required): File path or glob pattern
- `category` (optional): Filter by category

### `drift_where`
Find where a pattern is used across the codebase.

**Parameters:**
- `pattern` (required): Pattern name or ID to search
- `category` (optional): Filter by category

### `drift_export`
Export patterns in AI-optimized format for code generation context.

**Parameters:**
- `categories` (optional): Categories to export
- `format` (optional): `ai-context`, `json`, or `summary`
- `compact` (optional): Reduce output verbosity

### `drift_contracts`
Get frontend/backend API contract status and mismatches.

**Parameters:**
- `status` (optional): `all`, `verified`, `mismatch`, or `discovered`

### `drift_trends`
Get pattern trend analysis and regression alerts. Shows how patterns have changed over time.

**Parameters:**
- `period` (optional): Time period - `7d`, `30d`, or `90d` (default: `7d`)
- `category` (optional): Filter trends by category
- `severity` (optional): `all`, `critical`, or `warning`
- `type` (optional): `all`, `regressions`, or `improvements`

### `drift_examples`
Get actual code examples for patterns. Returns real code snippets from the codebase.

**Parameters:**
- `categories` (optional): Categories to get examples for
- `pattern` (optional): Specific pattern name or ID
- `maxExamples` (optional): Maximum examples per pattern (default: 3)
- `contextLines` (optional): Lines of context around each match (default: 10)
- `includeDeprecated` (optional): Include deprecated code examples (default: false)

### `drift_pack`
Get pre-defined pattern packs for common development tasks.

**Parameters:**
- `action` (optional): `get`, `list`, `suggest`, `create`, `delete`, or `infer`
- `name` (optional): Pack name for get/create/delete actions
- `refresh` (optional): Force regenerate the pack

### `drift_feedback`
Provide feedback on pattern examples to improve future suggestions.

**Parameters:**
- `action` (optional): `rate`, `stats`, or `clear`
- `file` (required for rate): File path of the example
- `rating` (required for rate): `good`, `bad`, or `irrelevant`
- `reason` (optional): Reason for the rating

## Categories
- `api` - API route patterns, response formats
- `auth` - Authentication and authorization
- `security` - Security patterns and practices
- `errors` - Error handling patterns
- `logging` - Logging conventions
- `testing` - Test structure and mocking
- `data-access` - Database and data layer patterns
- `config` - Configuration management
- `types` - TypeScript type patterns
- `structural` - File/folder organization
- `components` - UI component patterns
- `styling` - CSS/styling conventions
- `accessibility` - A11y patterns
- `documentation` - Doc patterns
- `performance` - Performance optimizations

## Example Usage

Once configured, AI agents can query your codebase patterns:

```
Agent: "How does this codebase handle authentication?"
→ Uses drift_patterns with categories: ["auth", "security"]

Agent: "Show me the API patterns before I add a new endpoint"
→ Uses drift_export with categories: ["api"] and format: "ai-context"

Agent: "Are there any API contract mismatches?"
→ Uses drift_contracts with status: "mismatch"

Agent: "Has code quality regressed recently?"
→ Uses drift_trends with period: "7d" and severity: "critical"

Agent: "Show me how error handling is done in this codebase"
→ Uses drift_examples with categories: ["errors"]
```

## Prerequisites

Run `drift scan` in your project first to build the pattern database:

```bash
cd /path/to/your/project
npx driftdetect scan
```
