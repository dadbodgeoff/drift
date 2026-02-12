# Error Handling MCP Tools

## drift_error_handling / drift_errors

### Location
`packages/mcp/src/tools/surgical/errors.ts` (~350 lines)

### Layer
Surgical — low token cost (300 target, 800 max)

### Purpose
Returns custom error classes, error handling gaps, and error boundaries. Solves: AI needs to know existing error types when adding error handling.

### Actions

#### `types` — List custom error classes
Returns error classes found in the codebase (classes extending Error/Exception).

```typescript
interface ErrorTypeInfo {
  name: string;        // "NotFoundError"
  file: string;        // "src/errors/not-found.ts"
  line: number;
  extends?: string;    // "HttpError"
  properties: string[];
  usages: number;      // How many times this error is thrown
}
```

#### `gaps` — Find error handling gaps
Returns functions with missing or inadequate error handling.

```typescript
interface ErrorGapInfo {
  function: string;    // "fetchUser"
  file: string;
  line: number;
  gapType: string;     // "unhandled-async", "swallowed-error", etc.
  severity: string;    // "critical", "high", "medium", "low"
  suggestion: string;  // "Add .catch() or wrap await in try/catch"
}
```

Supports `severity` filter parameter (default: "medium").

#### `boundaries` — List error boundaries
Returns functions that catch errors from their callees.

```typescript
interface ErrorBoundaryInfo {
  function: string;
  file: string;
  line: number;
  handledTypes: string[];
  coverage: number;    // % of callers protected
  isFramework: boolean;
}
```

### Arguments
```typescript
interface ErrorsArgs {
  action?: 'types' | 'gaps' | 'boundaries';  // Default: 'types'
  severity?: 'critical' | 'high' | 'medium' | 'low';
  limit?: number;  // Default: 20
}
```

### Stats Response
All actions include stats:
```typescript
stats: {
  totalTypes?: number;
  totalGaps?: number;
  totalBoundaries?: number;
  criticalGaps?: number;
  avgCoverage?: number;
}
```

### Prerequisites
- Call graph must be built (`drift callgraph build`)
- Throws `CALLGRAPH_NOT_BUILT` error if missing

### Integration
- Uses `createErrorHandlingAnalyzer()` factory
- Sets call graph from `CallGraphStore`
- Builds topology, then queries based on action
