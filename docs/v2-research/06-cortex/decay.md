# Cortex Decay System

## Location
`packages/cortex/src/decay/`

## Purpose
Multi-factor confidence decay that models how memories lose relevance over time, with boosters that resist decay for important/frequently-used memories.

## Files
- `calculator.ts` — `DecayCalculator`: main decay computation
- `half-lives.ts` — Type-specific half-life configuration
- `boosters.ts` — Decay resistance factors

## Decay Formula

```
finalConfidence = baseConfidence × temporalDecay × citationDecay × usageBoost × importanceAnchor × patternBoost
```

### Factor 1: Temporal Decay (exponential)
```
temporalDecay = e^(-daysSinceAccess / halfLife)
```
- Uses type-specific half-lives (see memory-types.md)
- Core memories have infinite half-life (never decay)
- Episodic memories decay in ~7 days

### Factor 2: Citation Decay
- Checks if file citations are still valid
- Content hash comparison detects drift
- Stale citations reduce confidence

### Factor 3: Usage Boost
```typescript
usageBoost = min(1.5, 1 + log10(accessCount + 1) × 0.2)
```
- Frequently accessed memories resist decay
- Capped at 1.5× to prevent runaway boosting
- A memory accessed 100 times gets ~1.4× boost

### Factor 4: Importance Anchor
```
critical → 2.0×
high     → 1.5×
normal   → 1.0×
low      → 0.8×
```
- Critical memories decay at half the rate
- Low-importance memories decay 20% faster

### Factor 5: Pattern Boost
```
No linked patterns → 1.0×
Any linked patterns → 1.3×
```
- Memories linked to active patterns resist decay
- TODO in codebase: check if patterns are still active

## DecayFactors Output
```typescript
interface DecayFactors {
  temporalDecay: number;
  citationDecay: number;
  usageBoost: number;
  importanceAnchor: number;
  patternBoost: number;
  finalConfidence: number;
}
```

## Minimum Confidence Thresholds
When confidence drops below the type-specific minimum, the memory is eligible for archival:
- Core: 0.0 (never archived)
- Tribal/Incident: 0.2
- Procedural/Semantic: 0.3
- Episodic/Conversation/Meeting: 0.1

## Rust Rebuild Considerations
- Pure math — trivially portable to Rust
- The decay calculator is called frequently (every retrieval) — Rust's speed helps
- Consider SIMD for batch decay calculation across many memories
- Half-life config is a simple HashMap — no complexity
