# Cortex MCP Tools

## Location
`packages/mcp/src/tools/memory/`

## Purpose
33 MCP tools that expose Cortex functionality to AI agents via the Model Context Protocol.

## Tool Inventory

### Core Operations
| Tool | File | Purpose |
|------|------|---------|
| `drift_memory_status` | `status.ts` | Memory system health snapshot |
| `drift_memory_add` | `add.ts` | Add new memory with auto causal inference |
| `drift_memory_get` | `get.ts` | Get memory by ID |
| `drift_memory_update` | `update.ts` | Update existing memory |
| `drift_memory_delete` | `delete.ts` | Soft delete memory |
| `drift_memory_search` | `search.ts` | Semantic search with session deduplication |
| `drift_memory_query` | `query.ts` | Rich graph queries |

### Context & Retrieval
| Tool | File | Purpose |
|------|------|---------|
| `drift_why` | `why.ts` | Complete "why" context with causal narratives |
| `drift_memory_for_context` | `for-context.ts` | Get memories for current context |
| `drift_memory_explain` | `explain.ts` | Explain memory reasoning |

### Learning & Feedback
| Tool | File | Purpose |
|------|------|---------|
| `drift_memory_learn` | `learn.ts` | Learn from corrections |
| `drift_memory_feedback` | `feedback.ts` | Process feedback on memories |

### Validation & Health
| Tool | File | Purpose |
|------|------|---------|
| `drift_memory_validate` | `validate.ts` | Trigger memory validation |
| `drift_memory_consolidate` | `consolidate.ts` | Trigger consolidation |
| `drift_memory_health` | `health.ts` | Comprehensive health report |
| `drift_memory_predict` | `predict.ts` | Predict memory effectiveness |
| `drift_memory_conflicts` | `conflicts.ts` | Find conflicting memories |
| `drift_memory_contradictions` | `contradictions.ts` | Find contradicting memories |
| `drift_memory_warnings` | `warnings.ts` | Get active warnings |
| `drift_memory_suggest` | `suggest.ts` | Get memory suggestions |

### Visualization
| Tool | File | Purpose |
|------|------|---------|
| `drift_memory_graph` | `graph.ts` | Visualize memory graph |

### Import/Export
| Tool | File | Purpose |
|------|------|---------|
| `drift_memory_import` | `import.ts` | Import memories from JSON |
| `drift_memory_export` | `export.ts` | Export memories to JSON |

### Specialized Memory Type Tools
| Tool | File | Purpose |
|------|------|---------|
| `drift_memory_agent_spawn` | `agent-spawn.ts` | Create agent spawn memory |
| `drift_memory_entity` | `entity.ts` | Create entity memory |
| `drift_memory_goal` | `goal.ts` | Create goal memory |
| `drift_memory_workflow` | `workflow.ts` | Create workflow memory |
| `drift_memory_incident` | `incident.ts` | Create incident memory |
| `drift_memory_meeting` | `meeting.ts` | Create meeting memory |
| `drift_memory_skill` | `skill.ts` | Create skill memory |
| `drift_memory_conversation` | `conversation.ts` | Create conversation memory |
| `drift_memory_environment` | `environment.ts` | Create environment memory |

## Key Tool Details

### drift_memory_add
Supports all 23 memory types. Auto-infers causal relationships. Returns:
- Created memory ID
- Linked memories
- Causal links discovered
- Conflicts detected

### drift_memory_search (V2)
Session-aware deduplication:
- `sessionId` — Track what's been sent
- `excludeAlreadySent` — Skip duplicates
- `trackInSession` — Auto-track returned memories

### drift_why (V2)
The "killer feature" — combines:
- Tribal knowledge
- Pattern rationales
- Decision contexts
- Code smells
- Causal narratives
- Warnings

Returns a complete explanation of WHY things are the way they are.

## Rust Rebuild Considerations
- MCP tools are thin wrappers around CortexV2 — keep in TypeScript
- The MCP protocol is JSON-RPC — language-agnostic
- If Cortex moves to Rust, tools call Rust via FFI/NAPI or subprocess
- Tool definitions (schemas) are static — no performance concern
