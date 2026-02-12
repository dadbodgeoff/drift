# Cortex Generation Context

## Location
`packages/cortex/src/generation/`

## Purpose
Builds rich context for code generation by gathering relevant patterns, tribal knowledge, constraints, and anti-patterns. Tracks provenance (what influenced the generated code) and processes feedback on generation outcomes.

## Subdirectories
- `context/` — Context gathering (patterns, tribal, constraints, anti-patterns)
- `feedback/` — Outcome processing and feedback loop
- `provenance/` — Tracks what influenced generated code
- `validation/` — Validates generated code against known patterns

---

## GenerationContext
```typescript
interface GenerationContext {
  target: GenerationTarget;          // What we're generating
  intent: GenerationIntent;          // User's intent
  query: string;                     // Original query
  patterns: PatternContext[];        // Relevant patterns
  tribal: TribalContext[];           // Tribal knowledge
  constraints: ConstraintContext[];  // Active constraints
  antiPatterns: AntiPatternContext[]; // Things to avoid
  relatedMemories: RelatedMemoryContext[];
  tokenBudget: TokenBudgetInfo;
  builtAt: string;
  metadata?: GenerationMetadata;
}
```

## Generation Types
`new_file`, `new_function`, `new_class`, `modify_existing`, `add_feature`, `fix_bug`, `refactor`, `add_test`

---

## Context Gathering (`context/`)

### Builder (`builder.ts`)
Orchestrates all gatherers with token budget allocation.

### Pattern Gatherer (`pattern-gatherer.ts`)
- Finds patterns relevant to the target file/language/framework
- Includes example code and key rules
- Scored by relevance

### Tribal Gatherer (`tribal-gatherer.ts`)
- Finds tribal knowledge relevant to the focus area
- Includes warnings and consequences
- Prioritizes critical severity

### Constraint Gatherer (`constraint-gatherer.ts`)
- Finds active constraints for the target
- Includes any approved overrides
- Distinguishes hard vs soft constraints

### Anti-Pattern Gatherer (`antipattern-gatherer.ts`)
- Finds code smells to avoid
- Includes bad examples and alternatives
- Helps prevent known mistakes

---

## Token Budget Allocation
The generation orchestrator allocates the total budget across categories:
```typescript
interface TokenBudgetInfo {
  total: number;
  patternsUsed: number;
  tribalUsed: number;
  constraintsUsed: number;
  antiPatternsUsed: number;
  relatedUsed: number;
  remaining: number;
}
```

---

## Provenance Tracking (`provenance/`)

### Tracker (`tracker.ts`)
Records what influenced the generated code.

### Comment Generator (`comment-generator.ts`)
Generates code comments explaining provenance.

### Explanation Builder (`explanation-builder.ts`)
Builds human-readable explanations of why code was generated a certain way.

### CodeProvenance
```typescript
interface CodeProvenance {
  requestId: string;
  influences: Influence[];
  warnings: string[];
  appliedConstraints: string[];
  avoidedAntiPatterns: string[];
  confidence: number;
  generatedAt: string;
}
```

### Influence Types
`pattern_followed`, `tribal_applied`, `constraint_enforced`, `antipattern_avoided`, `example_used`, `style_matched`

---

## Feedback Loop (`feedback/`)

### Outcome Processor (`outcome-processor.ts`)
Processes generation outcomes (accepted/modified/rejected).

### Feedback Loop (`loop.ts`)
Feeds outcomes back into the learning system to improve future generations.

### GenerationFeedback
```typescript
interface GenerationFeedback {
  requestId: string;
  outcome: 'accepted' | 'modified' | 'rejected';
  feedback?: string;
  modifiedCode?: string;
  providedAt: string;
}
```

---

## Validation (`validation/`)

### Validator (`validator.ts`)
Orchestrates all checkers.

### Pattern Checker (`pattern-checker.ts`)
Validates generated code follows relevant patterns.

### Tribal Checker (`tribal-checker.ts`)
Checks generated code against tribal knowledge warnings.

### Anti-Pattern Checker (`antipattern-checker.ts`)
Ensures generated code doesn't contain known anti-patterns.

---

## Rust Rebuild Considerations
- Context gathering is mostly database queries + scoring — straightforward in Rust
- Provenance tracking is data structure management — easy to port
- The feedback loop involves LLM interaction — keep as service boundary
- Validation checkers could use Rust's regex/AST parsing for better performance
- Token budget allocation is arithmetic — trivial
