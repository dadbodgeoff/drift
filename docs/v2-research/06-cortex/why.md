# Cortex "Why" System

## Location
`packages/cortex/src/why/`

## Purpose
Synthesizes "why" context by gathering pattern rationales, decision contexts, tribal knowledge, and warnings for a given focus area. Powers the `drift_why` MCP tool — the "killer feature" of Cortex.

## Files
- `synthesizer.ts` — `WhySynthesizer`: main orchestrator
- `pattern-context.ts` — `PatternContextGatherer`: gathers pattern rationales
- `decision-context.ts` — `DecisionContextGatherer`: gathers decision contexts
- `tribal-context.ts` — `TribalContextGatherer`: gathers tribal knowledge
- `warning-aggregator.ts` — `WarningAggregator`: aggregates warnings from all sources

## WhySynthesizer

### `synthesize(focus, patternIds?)` → `WhyContext`
Gathers context from all sources in parallel:
1. Pattern rationales (why patterns exist)
2. Decision contexts (why decisions were made)
3. Tribal knowledge (what the team knows)
4. Aggregated warnings

### WhyContext
```typescript
interface WhyContext {
  patterns: PatternContext[];
  decisions: DecisionContext[];
  tribal: TribalContext[];
  warnings: Warning[];
  summary: string;
}
```

## V2 Enhancement: Causal Narratives
The `drift_why` MCP tool (in `packages/mcp/src/tools/memory/why.ts`) extends the base WhyContext with:
- `narrative` — Human-readable causal narrative
- `causalChain` — Chain of causally connected memories
- `narrativeConfidence` — Confidence in the narrative

This combines the Why system with the Causal system to provide deep "why" explanations.

## Data Types

### PatternContext
```typescript
{ patternId, patternName, rationale?, businessContext? }
```

### DecisionContext
```typescript
{ decisionId, summary, businessContext?, stillValid: boolean }
```

### TribalContext
```typescript
{ topic, knowledge, severity, confidence }
```

### Warning
```typescript
{ type, severity, message, source }
```

## Rust Rebuild Considerations
- The synthesizer is an orchestration layer — parallel queries to storage
- Pattern/decision/tribal gatherers are database queries — straightforward
- Warning aggregation is filtering + sorting — trivial
- The causal narrative integration is the complex part — depends on causal system
