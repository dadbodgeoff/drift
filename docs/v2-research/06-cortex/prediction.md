# Cortex Prediction System

## Location
`packages/cortex/src/prediction/`

## Purpose
Predictive memory preloading that anticipates which memories will be needed based on file context, temporal patterns, user behavior, and git activity. Reduces retrieval latency by pre-scoring and caching predictions.

## Subdirectories
- `predictor/` — Prediction engines (4 strategies)
- `signals/` — Signal gathering from various sources
- `cache/` — Prediction caching and preloading

---

## Prediction Signals

### FileSignals
```typescript
interface FileSignals {
  activeFile: string;
  recentFiles: string[];
  fileType: string;
  filePatterns: string[];
  fileImports: string[];
  fileSymbols: string[];
  directory: string;
}
```

### TemporalSignals
```typescript
interface TemporalSignals {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: string;
  sessionDuration: number;
  timeSinceLastQuery: number;
  isNewSession: boolean;
}
```

### BehavioralSignals
```typescript
interface BehavioralSignals {
  recentQueries: string[];
  recentIntents: Intent[];
  frequentMemories: string[];
  currentTask?: string;
  userPatterns: UserPattern[];
}
```

### GitSignals
```typescript
interface GitSignals {
  currentBranch: string;
  recentlyModifiedFiles: string[];
  recentCommitMessages: string[];
  uncommittedFiles: string[];
  isFeatureBranch: boolean;
  relatedIssue?: string;
}
```

---

## Signal Gatherers (`signals/`)
- `gatherer.ts` — Main signal gatherer (orchestrates all)
- `file-signals.ts` — Gathers file context signals
- `temporal-signals.ts` — Gathers time-based signals
- `behavioral-signals.ts` — Gathers user behavior signals
- `git-signals.ts` — Gathers git activity signals

---

## Prediction Strategies (`predictor/`)

### MemoryPredictor (`engine.ts`)
Orchestrates all strategies, deduplicates, ranks, and returns predictions.

### FileBasedPredictor (`file-predictor.ts`)
- Predicts memories linked to the active file
- Considers file imports and directory context
- Highest signal for code-specific memories

### PatternBasedPredictor (`pattern-predictor.ts`)
- Predicts memories linked to detected patterns
- Uses file pattern detection results

### TemporalPredictor (`temporal-predictor.ts`)
- Learns time-of-day and day-of-week patterns
- Records usage history for temporal learning
- Exportable/importable state for persistence

### BehavioralPredictor (`behavioral-predictor.ts`)
- Predicts based on recent queries and intents
- Uses frequent memory access patterns
- Considers current task context

### Multi-Strategy Deduplication
When a memory appears in multiple strategies:
- Keep the highest confidence prediction
- Merge contributing signals
- Apply +0.05 multi-strategy boost (capped at 1.0)

---

## Prediction Cache (`cache/`)
- `prediction-cache.ts` — `PredictionCache`: caches prediction results
- `preloader.ts` — `PredictionPreloader`: preloads embeddings for predicted memories

### Cache Configuration
- Default TTL: 5 minutes
- Tracks: hits, misses, hit rate, avg prediction time
- Invalidated on file change or new session

---

## PredictionResult
```typescript
interface PredictionResult {
  predictions: PredictedMemory[];
  signals: PredictionSignals;
  strategiesUsed: PredictionStrategy[];
  predictionTimeMs: number;
  cacheStatus: 'hit' | 'miss' | 'partial';
  predictedAt: string;
}
```

## Default Configuration
```typescript
const DEFAULT_PREDICTION_CONFIG = {
  maxPredictions: 20,
  minConfidence: 0.3,
  strategies: ['file_based', 'pattern_based', 'temporal', 'behavioral'],
  preloadEmbeddings: true,
  cacheTtlMs: 300000,  // 5 minutes
  useBehavioralSignals: true,
  useGitSignals: true,
};
```

---

## Rust Rebuild Considerations
- Signal gathering involves filesystem + git operations — Rust excels here
- Temporal pattern learning is lightweight state machine — easy to port
- The prediction cache is a TTL map — Rust's `moka` or `mini-moka` crate
- Embedding preloading benefits from async Rust (tokio)
- Multi-strategy deduplication is a merge operation — straightforward
