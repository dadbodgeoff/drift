# Cortex Memory Types

## Location
`packages/cortex/src/types/` — 30+ type definition files

## Type System Overview
Cortex has 23 memory types organized into 3 categories. All extend `BaseMemory` which provides identity, bitemporal tracking, confidence, access tracking, linking, and archival support.

## BaseMemory (all types inherit this)

```typescript
interface BaseMemory {
  id: string;                        // Unique identifier
  type: MemoryType;                  // Discriminator
  transactionTime: TransactionTime;  // When we learned this
  validTime: ValidTime;              // When this was/is true
  confidence: number;                // 0.0 - 1.0
  importance: Importance;            // low | normal | high | critical
  lastAccessed?: string;             // ISO timestamp
  accessCount: number;               // Usage tracking
  summary: string;                   // ~20 token summary
  linkedPatterns?: string[];         // Pattern IDs
  linkedConstraints?: string[];      // Constraint IDs
  linkedFiles?: string[];            // File paths
  linkedFunctions?: string[];        // Call graph function IDs
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  tags?: string[];
  archived?: boolean;
  archiveReason?: string;
  supersededBy?: string;
  supersedes?: string;
}
```

## Category 1: Domain-Agnostic (9 types)

### `core` — Project/workspace metadata
- File: `core-memory.ts`
- Half-life: ∞ (never decays)
- Use: Project name, tech stack, team info

### `tribal` — Institutional knowledge
- File: `tribal-memory.ts`
- Half-life: 365 days
- Fields: `topic`, `knowledge`, `severity` (info/warning/critical), `source`, `warnings[]`, `consequences[]`
- Example: "Never call the payment API without idempotency keys"

### `procedural` — How-to procedures
- File: `procedural-memory.ts`
- Half-life: 180 days
- Fields: `name`, `steps[]` (ordered with examples), `checklist[]`, `triggerPhrases[]`, `corrections[]`
- Example: "Deploy to production" with pre-flight checks

### `semantic` — Consolidated knowledge
- File: `semantic-memory.ts`
- Half-life: 90 days
- Created by consolidation engine from episodic memories

### `episodic` — Interaction records
- File: `episodic-memory.ts`
- Half-life: 7 days
- Fields: `interaction` (userQuery, agentResponse, outcome), `context`, `extractedFacts[]`, `consolidationStatus`
- Raw material for consolidation into semantic memory

### `decision` — Standalone decisions
- File: `decision-memory.ts`
- Half-life: 180 days
- Fields: `title`, `outcome`, `decisionSummary`, `alternatives[]`, `stakeholders[]`

### `insight` — Learned observations
- File: `insight-memory.ts`
- Half-life: 90 days
- Fields: `insight`, `source`, `domain`

### `reference` — External references/citations
- File: `reference-memory.ts`
- Half-life: 60 days
- Fields: `title`, `url`, `keyPoints[]`

### `preference` — User/team preferences
- File: `preference-memory.ts`
- Half-life: 120 days
- Fields: `preference`, `category`, `scope`, `strength`

## Category 2: Code-Specific (4 types)

### `pattern_rationale` — Why patterns exist
- File: `pattern-rationale.ts`
- Half-life: 180 days
- Fields: `patternId`, `rationale`, `businessContext`, `alternatives[]`

### `constraint_override` — Approved exceptions
- File: `constraint-override.ts`
- Half-life: 90 days
- Fields: `constraintId`, `scope`, `reason`, `alternative`, `approvedBy`

### `decision_context` — Code decision context
- File: `decision-context.ts`
- Half-life: 180 days
- Linked to ADRs (Architecture Decision Records)

### `code_smell` — Anti-patterns
- File: `code-smell.ts`
- Half-life: 90 days
- Fields: `name`, `reason`, `suggestion`, `badExample`, `goodExample`

## Category 3: Universal Memory Types — V2 (10 types)

### `agent_spawn` — Reusable agent configurations
- File: `agent-spawn-memory.ts`
- Half-life: 365 days
- Fields: `name`, `slug`, `systemPrompt`, `tools[]`, `triggerPatterns[]`, `autoSpawn`, `inheritMemoryTypes[]`, `pinnedMemories[]`, `stats`
- Example: "Code Reviewer" agent with specific review criteria

### `entity` — Projects, products, teams, systems
- File: `entity-memory.ts`
- Half-life: 180 days
- Fields: `entityType` (project/product/team/client/vendor/system/service), `name`, `aliases[]`, `attributes`, `relationships[]`, `status`

### `goal` — Objectives with progress tracking
- File: `goal-memory.ts`
- Half-life: 90 days
- Fields: `title`, `description`, `status` (active/achieved/abandoned/blocked/at_risk), `progress` (0-100), `successCriteria[]`, `blockers[]`, `parentGoalId`, `childGoalIds[]`

### `feedback` — Corrections and learning signals
- File: `feedback-memory.ts`
- Half-life: 120 days
- Fields: `originalOutput`, `correction`, `feedbackType` (10 types), `extractedRule`, `validated`

### `workflow` — Step-by-step processes
- File: `workflow-memory.ts`
- Half-life: 180 days
- Fields: `name`, `slug`, `steps[]` (with tools, duration, verification), `triggerPhrases[]`, `variations[]`, `stats`

### `conversation` — Summarized past discussions
- File: `conversation-memory.ts`
- Half-life: 30 days

### `incident` — Postmortems and lessons learned
- File: `incident-memory.ts`
- Half-life: 365 days
- Fields: `title`, `severity`, `incidentType`, `detectedAt`, `resolvedAt`, `impact`, `affectedSystems[]`, `rootCause`, `contributingFactors[]`, `resolution`, `preventionMeasures[]`, `actionItems[]`

### `meeting` — Meeting notes and action items
- File: `meeting-memory.ts`
- Half-life: 60 days

### `skill` — Knowledge domains and proficiency
- File: `skill-memory.ts`
- Half-life: 180 days

### `environment` — System/environment configurations
- File: `environment-memory.ts`
- Half-life: 90 days

## Bitemporal Tracking
File: `bitemporal.ts`

Every memory tracks two time dimensions:
- **Transaction Time** (`recordedAt`): When we learned this fact
- **Valid Time** (`validFrom`, `validUntil`): When this fact was/is true

This enables queries like "What did we know about X as of last Tuesday?" and "What was true about X during the v2.0 release?"

## Half-Life Summary Table

| Type | Half-Life | Min Confidence |
|------|-----------|----------------|
| core | ∞ | 0.0 |
| tribal | 365 days | 0.2 |
| incident | 365 days | 0.2 |
| agent_spawn | 365 days | 0.3 |
| procedural | 180 days | 0.3 |
| pattern_rationale | 180 days | 0.3 |
| decision | 180 days | 0.2 |
| decision_context | 180 days | 0.3 |
| entity | 180 days | 0.2 |
| workflow | 180 days | 0.3 |
| skill | 180 days | 0.2 |
| preference | 120 days | 0.2 |
| feedback | 120 days | 0.2 |
| semantic | 90 days | 0.3 |
| constraint_override | 90 days | 0.2 |
| code_smell | 90 days | 0.2 |
| insight | 90 days | 0.3 |
| goal | 90 days | 0.2 |
| environment | 90 days | 0.2 |
| reference | 60 days | 0.2 |
| meeting | 60 days | 0.1 |
| conversation | 30 days | 0.1 |
| episodic | 7 days | 0.1 |
