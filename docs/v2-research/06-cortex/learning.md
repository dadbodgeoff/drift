# Cortex Learning System

## Location
`packages/cortex/src/learning/`

## Purpose
Analyzes corrections to understand WHY something was wrong, extracts generalizable principles, calibrates confidence based on evidence, and identifies memories needing validation. This is how Cortex gets smarter over time.

## Subdirectories
- `analysis/` — Correction analysis pipeline
- `active/` — Active learning loop (asks user for validation)
- `confidence/` — Confidence calibration
- `factory/` — Memory creation from corrections

## Top-Level Files
- `correction-extractor.ts` — `CorrectionExtractor`: extracts corrections from episodes
- `fact-extractor.ts` — `FactExtractor`: extracts facts from conversations
- `preference-learner.ts` — `PreferenceLearner`: learns user preferences
- `outcome-tracker.ts` — `OutcomeTracker`: tracks interaction outcomes

---

## Correction Analysis (`analysis/`)

### Files
- `analyzer.ts` — `CorrectionAnalyzer`: main analysis pipeline
- `categorizer.ts` — `CorrectionCategorizer`: classifies corrections
- `diff-analyzer.ts` — `DiffAnalyzer`: analyzes code diffs
- `principle-extractor.ts` — `PrincipleExtractor`: extracts generalizable rules

### 10 Correction Categories
```typescript
type CorrectionCategory =
  | 'pattern_violation'       // Violated an established pattern
  | 'tribal_miss'             // Missed tribal knowledge
  | 'constraint_violation'    // Violated a constraint
  | 'style_preference'        // User style preference
  | 'naming_convention'       // Naming convention issue
  | 'architecture_mismatch'   // Architectural decision mismatch
  | 'security_issue'          // Security-related correction
  | 'performance_issue'       // Performance-related correction
  | 'api_misuse'              // Incorrect API usage
  | 'other';                  // Uncategorized
```

### AnalyzedCorrection
```typescript
interface AnalyzedCorrection {
  id: string;
  original: string;
  feedback: string;
  correctedCode?: string;
  diff?: CorrectionDiff;
  category: CorrectionCategory;
  categoryConfidence: number;
  principle: ExtractedPrinciple;
  suggestedMemoryType: SuggestedMemoryType;
  relatedMemories: string[];
  analyzedAt: string;
}
```

### Diff Analysis
```typescript
interface CorrectionDiff {
  additions: DiffLine[];
  removals: DiffLine[];
  modifications: DiffModification[];
  summary: string;
  semanticChanges: SemanticChange[];
}
```

---

## Active Learning Loop (`active/`)

### Files
- `loop.ts` — `ActiveLearningLoop`: main loop
- `candidate-selector.ts` — `CandidateSelector`: picks memories to validate
- `prompt-generator.ts` — `PromptGenerator`: generates validation prompts

### How It Works
1. Identifies memories with uncertain confidence (needs validation)
2. Generates validation prompts for the user
3. Processes user feedback (confirm/reject/modify)
4. Updates memory confidence based on response
5. Stores validation feedback for future calibration

### Feedback Processing
- **Confirm** → Boost confidence, mark validated
- **Reject** → Lower confidence, potentially archive
- **Modify** → Update memory content, recalibrate

### Validation Cycle
`runValidationCycle()` — Identifies candidates, generates prompts, returns queue status.

---

## Confidence Calibration (`confidence/`)

### Files
- `calibrator.ts` — `ConfidenceCalibrator`: multi-factor confidence calculation
- `decay-integrator.ts` — `DecayIntegrator`: integrates decay into confidence
- `metrics.ts` — `MetricsCalculator`: confidence metrics

### Calibration Factors
1. **Base Factor** — Initial confidence from creation
2. **Evidence Factor** — Supporting/contradicting evidence count
3. **Usage Factor** — Success/rejection rates from usage
4. **Temporal Factor** — Age-based decay
5. **Validation Factor** — User confirmation/rejection history

### Validation Need Assessment
The calibrator determines if a memory should be validated:
- Low confidence + high importance → validate
- Old + never validated → validate
- Contradicted but not resolved → validate

---

## Memory Factory (`factory/`)

### Files
- `memory-factory.ts` — `LearningMemoryFactory`: creates memories from corrections
- `pattern-creator.ts` — `PatternCreator`: creates pattern memories
- `smell-creator.ts` — `SmellCreator`: creates code smell memories
- `tribal-creator.ts` — `TribalCreator`: creates tribal knowledge memories

### Category → Memory Type Mapping
- `pattern_violation` → `pattern_rationale`
- `tribal_miss` → `tribal`
- `constraint_violation` → `constraint_override`
- `style_preference` → `preference`
- `naming_convention` → `tribal`
- `architecture_mismatch` → `decision_context`
- `security_issue` → `tribal` (critical)
- `performance_issue` → `code_smell`
- `api_misuse` → `tribal`

---

## Correction Extractor
Extracts corrections from episodic memories:
- Filters by outcome (rejected/modified)
- Extracts original content, feedback, corrected code
- Assigns confidence to extraction
- Configurable: `minConfidence`, `rejectedOnly`, `includeModified`, `limit`

## Fact Extractor
Extracts facts from conversations:
- Identifies preferences, knowledge, corrections, warnings
- Each fact has a confidence score and type

## Preference Learner
Learns user preferences from interaction patterns:
- Code style preferences
- Communication preferences
- Tool preferences

---

## Rust Rebuild Considerations
- Diff analysis is string-heavy — Rust's `similar` crate handles this well
- The categorizer uses pattern matching — Rust enums + match are ideal
- Confidence calibration is pure math — trivial to port
- The active learning loop involves user interaction — keep as orchestration layer
- Memory factory is mostly data transformation — straightforward in Rust
- Consider keeping the LLM-dependent parts (principle extraction) as a service boundary
