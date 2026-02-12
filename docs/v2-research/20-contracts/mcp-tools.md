# Contract MCP Tools

## drift_contracts_list

### Location
`packages/mcp/src/tools/exploration/contracts-list.ts` (~250 lines)

### Layer
Exploration — medium token cost (500-1500)

### Purpose
Lists API contracts between frontend and backend. Shows verified contracts, mismatches, and discovered endpoints.

### Arguments
```typescript
{
  status?: string;    // 'all', 'verified', 'mismatch', 'discovered' (default: 'all')
  limit?: number;     // Default: 20, max: 50
  cursor?: string;    // Pagination cursor
}
```

### Response Shape
```typescript
interface ContractsListData {
  contracts: ContractSummary[];
  stats: {
    verified: number;
    mismatch: number;
    discovered: number;
  };
  _source?: 'sqlite' | 'json';  // Debug: which backend was used
}

interface ContractSummary {
  id: string;
  endpoint: string;
  method: string;
  status: 'verified' | 'mismatch' | 'discovered';
  frontendFile: string | undefined;
  backendFile: string;
  mismatchCount: number;
}
```

### Dual Backend Support
The tool supports both storage backends:

1. **SQLite (preferred)**: `handleContractsListWithSqlite()`
   - Queries `UnifiedStore.contracts` repository
   - Fetches frontends per contract via `getFrontends()`
   - Parses mismatches from JSON column

2. **JSON (legacy)**: `handleContractsListWithJson()`
   - Reads from `ContractStore` (file-based)
   - Maps `Contract` objects to `ContractSummary`

### Pagination
- Uses cursor-based pagination via `cursorManager`
- Cursor encodes offset for next page
- Default limit: 20, max: 50

### Warnings & Next Actions
- Adds warnings for contracts with mismatches
- Suggests next actions: "Review mismatches", "Verify contracts"
- Includes `_source` field for debugging which backend was used

---

## Related Tools

### drift_validate_change
Includes error handling validation for contracts:
- Checks if new API endpoints have corresponding frontend types
- Validates that response field changes don't break existing contracts

### drift_context
When `intent="add_feature"` and focus involves API endpoints, includes relevant contract information in the curated context.

---

## v2 Considerations
- Add `drift_contract_detail` tool for deep-diving into a specific contract
- Add `drift_contract_verify` tool for marking contracts as verified
- Consider batch operations for verifying/ignoring multiple contracts
- Add webhook/notification support for new mismatches
