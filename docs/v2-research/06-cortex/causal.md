# Cortex Causal System

## Location
`packages/cortex/src/causal/`

## Purpose
Automatically discovers causal relationships between memories, traverses the causal graph, and generates human-readable narratives explaining "why" things are the way they are. This is the backbone of the `drift_why` tool.

## Subdirectories
- `inference/` — Automatic causal relationship discovery
- `traversal/` — Graph traversal and path finding
- `narrative/` — Human-readable narrative generation
- `storage/` — Causal graph persistence (SQLite)

## Causal Relation Types (8)
```typescript
type CausalRelation =
  | 'caused'         // Direct causation (A caused B)
  | 'enabled'        // Made possible (A enabled B)
  | 'prevented'      // Blocked (A prevented B)
  | 'contradicts'    // Conflicts (A contradicts B)
  | 'supersedes'     // Replaces (A supersedes B)
  | 'supports'       // Evidence for (A supports B)
  | 'derived_from'   // Extracted from (A derived from B)
  | 'triggered_by';  // Initiated by (A triggered by B)
```

## Causal Edge
```typescript
interface CausalEdge {
  id: string;
  sourceId: string;       // The cause
  targetId: string;       // The effect
  relation: CausalRelation;
  strength: number;       // 0.0 - 1.0
  evidence: CausalEvidence[];
  createdAt: string;
  validatedAt?: string;
  inferred: boolean;      // Auto-inferred vs explicit
  createdBy?: string;
}
```

## Evidence Types
```typescript
interface CausalEvidence {
  type: 'temporal' | 'semantic' | 'entity' | 'explicit' | 'user_confirmed';
  description: string;
  confidence: number;
  reference?: string;     // Commit hash, file path, etc.
  gatheredAt: string;
}
```

---

## Inference Engine (`inference/`)

### Files
- `engine.ts` — `CausalInferenceEngine`: orchestrates strategies
- `temporal.ts` — `TemporalInferenceStrategy`
- `semantic.ts` — `SemanticInferenceStrategy`
- `entity.ts` — `EntityInferenceStrategy`
- `explicit.ts` — `ExplicitInferenceStrategy`

### Inference Strategies

| Strategy | Weight | How It Works |
|----------|--------|-------------|
| `temporal_proximity` | 0.2 | Memories created close in time may be causally related |
| `semantic_similarity` | 0.3 | Semantically similar memories may share causal links |
| `entity_overlap` | 0.25 | Memories referencing same entities (files, patterns) |
| `explicit_reference` | 0.4 | Direct references in memory content |
| `pattern_matching` | 0.15 | Pattern-based causal templates |
| `file_co_occurrence` | 0.1 | Memories linked to same files |

### Configuration
```typescript
interface InferenceEngineConfig {
  minConfidence: number;           // Default: 0.5
  maxEdgesPerMemory: number;       // Default: 10
  strategies: CausalInferenceStrategy[];
  validateBeforeStore: boolean;    // Default: true
  strategyWeights: Record<Strategy, number>;
}
```

### Flow
1. New memory created
2. Gather candidate memories (recent, same type, same files)
3. Run each enabled strategy
4. Combine results with weighted scoring
5. Filter by minimum confidence
6. Validate before storing (optional)
7. Store edges in causal storage

---

## Graph Traversal (`traversal/`)

### Files
- `traverser.ts` — `CausalGraphTraverser`: main traversal engine
- `path-finder.ts` — Path finding between memories
- `subgraph.ts` — Subgraph extraction

### CausalGraphTraverser

#### `traceOrigins(memoryId, options?)` → `CausalChain`
Traverses backward: "What caused this memory?"

#### `traceEffects(memoryId, options?)` → `CausalChain`
Traverses forward: "What did this memory cause?"

#### `traceBidirectional(memoryId, options?)` → `CausalChain`
Both directions from a root memory.

#### `getNeighbors(memoryId, options?)` → `{ incoming, outgoing }`
One-hop neighbors only.

### Traversal Options
```typescript
interface GraphTraversalOptions {
  maxDepth: number;          // Default: 5
  minStrength: number;       // Default: 0.3
  relationTypes: CausalRelation[];  // Filter by type
  includeInferred: boolean;  // Default: true
  maxNodes: number;          // Default: 50
  computeConfidence: boolean; // Default: true
}
```

### Chain Confidence
Computed as weighted combination: 60% minimum edge strength + 40% average edge strength (weakest-link principle).

---

## Narrative Generator (`narrative/`)

### Files
- `generator.ts` — `NarrativeGenerator`: generates human-readable text
- `templates.ts` — Section templates and descriptions

### Output
```typescript
interface Narrative {
  text: string;           // Plain text
  markdown: string;       // Markdown formatted
  sections: NarrativeSection[];
  summary: string;        // One paragraph
  keyPoints: string[];
  confidence: number;
}
```

### Sections
Narratives are organized into sections: Origins, Effects, Support, Conflicts — each containing items with memory references, relation types, and depth.

---

## Causal Storage (`storage/`)

### Files
- `interface.ts` — `ICausalStorage` contract
- `sqlite.ts` — SQLite implementation

### ICausalStorage Interface
Full CRUD + bulk operations + strength management + evidence management + validation tracking + statistics + cleanup.

Key operations:
- `createEdge`, `getEdge`, `updateEdge`, `deleteEdge`
- `getEdgesFrom(sourceId)`, `getEdgesTo(targetId)`, `getEdgesFor(memoryId)`
- `updateStrength`, `incrementStrength`, `decayStrengths`
- `addEvidence`, `removeEvidence`
- `markValidated`, `getUnvalidatedEdges`
- `getStats`, `getMostConnected`
- `deleteWeakEdges`, `deleteOldUnvalidated`

---

## Rust Rebuild Considerations
- Graph traversal is the #1 candidate for Rust — BFS/DFS with cycle detection
- `petgraph` crate provides excellent graph primitives
- Inference strategies involve embedding similarity — benefits from SIMD
- The narrative generator is template-based — straightforward to port
- Causal storage is SQLite — `rusqlite` maps directly
- Consider in-memory graph representation for hot paths (avoid repeated DB queries)
