# Feedback System & Pattern Packs

## Location
- `packages/mcp/src/feedback.ts` — Example quality feedback (reinforcement learning)
- `packages/mcp/src/packs.ts` — Task-oriented pattern bundles with caching

---

## Feedback System (`feedback.ts`)

### Purpose
Tracks user feedback on pattern examples to improve future suggestions. A reinforcement learning loop that boosts good examples and penalizes bad ones.

### How It Works
When AI shows a code example from a pattern, the user can rate it:
- `good` → +0.1 boost to file score
- `bad` → -0.15 penalty to file score
- `irrelevant` → -0.05 penalty to file score

Directory-level propagation: 30% of file-level delta propagates to the directory score.

### File Exclusion
Files are excluded from future examples when:
- `boost < -0.5` AND `confidence > 0.5`
- This means consistently bad examples from a file get it removed

### Score → Multiplier
```
multiplier = 1 + (boost × 0.7)
// Range: 0.3 (heavily penalized) to 1.7 (heavily boosted)
```

### Key Types
```typescript
interface ExampleFeedback {
  patternId: string;
  patternName: string;
  category: string;
  file: string;
  line: number;
  rating: 'good' | 'bad' | 'irrelevant';
  reason?: string;
  timestamp: string;
}

interface LocationScore {
  file: string;
  boost: number;        // Cumulative score (-1.0 to +1.0 range)
  confidence: number;   // Based on feedback count
}

interface FeedbackStats {
  totalFeedback: number;
  goodExamples: number;
  badExamples: number;
  irrelevantExamples: number;
  topGoodPatterns: Array<{ pattern: string; count: number }>;
  topBadPatterns: Array<{ pattern: string; count: number }>;
  topBadFiles: Array<{ file: string; count: number }>;
}
```

### Storage
- `.drift/feedback/examples.json` — All feedback entries (last 5000)
- `.drift/feedback/scores.json` — Computed location scores

---

## Pattern Packs (`packs.ts`)

### Purpose
Pre-defined bundles of patterns for common tasks. Provides cached, task-oriented pattern context for AI agents. Includes intelligent file filtering to exclude noisy files from examples.

### Pack Definition
```typescript
interface PackDefinition {
  name: string;
  description: string;
  categories: string[];          // Pattern categories to include
  patterns?: string[];           // Optional pattern name filters
  maxExamples?: number;
  contextLines?: number;
  minConfidence?: number;        // Default: 0.5
  includeDeprecated?: boolean;   // Default: false
}
```

### File Filtering
Packs automatically exclude noisy files from examples:

Excluded patterns:
- Documentation: README, CHANGELOG, CONTRIBUTING, *.md
- CI/CD: .github/, .gitlab/, *.yml, Dockerfile
- Package manifests: package.json, Cargo.toml, go.mod, requirements.txt
- Environment: .env, .example
- Generated: dist/, build/, node_modules/, *.min.*

Deprecation detection: Files with `@deprecated`, `LEGACY`, `TODO: remove`, etc. in the first 500 chars are filtered out.

### Location Scoring
Each file gets a quality score for example selection:
- Source code files (`.ts`, `.py`, `.java`, etc.): 1.5× boost
- Files in `src/` or `lib/`: 1.2-1.3× boost
- Test files: 0.7× penalty (still useful, prefer production code)
- Config files (`.json`, `.yml`): 0.2-0.3× penalty
- Documentation (`.md`, README): 0.1× penalty

### Caching
Packs are cached with staleness detection:
- Cache key: SHA-256 of pack definition + pattern data hash
- Stale if pattern data has changed since generation
- Stored in `.drift/packs/`

### Pack Suggestion
The pack manager can suggest packs based on:
- Project structure (detected languages/frameworks)
- Co-occurring patterns
- Usage analytics

### Key Types
```typescript
interface PackResult {
  content: string;         // Generated pack content
  fromCache: boolean;
  generatedAt: string;
  staleReason?: string;
}

interface PackUsage {
  categories: string[];
  patterns?: string[];
  timestamp: string;
}

interface SuggestedPack {
  name: string;
  description: string;
  categories: string[];
  reason: string;          // Why this pack is suggested
}
```

---

## Rust Rebuild Considerations
- Both systems stay in TypeScript — they're AI interaction patterns
- Feedback scoring is pure math — trivial to port if needed
- Pack generation involves file reading and pattern filtering — could benefit from Rust for large codebases
- The file exclusion patterns and deprecation detection are regex-based — portable
- Cache management is filesystem I/O — stays in TS
