# Cortex Session Management

## Location
`packages/cortex/src/session/`

## Purpose
Tracks what has been loaded in the current conversation session to avoid re-sending the same context. Saves 30-50% tokens in typical sessions through deduplication.

## Subdirectories
- `context/` — Session context tracking and deduplication
- `storage/` — Session persistence

---

## Session Context

### SessionContext
```typescript
interface SessionContext {
  id: string;
  startedAt: string;
  endedAt?: string;
  loadedMemories: Set<string>;
  loadedPatterns: Set<string>;
  loadedFiles: Set<string>;
  loadedConstraints: Set<string>;
  tokensSent: number;
  queriesMade: number;
  lastActivity: string;
  metadata?: SessionMetadata;
}
```

### SessionMetadata
```typescript
interface SessionMetadata {
  userId?: string;
  projectId?: string;
  initialFile?: string;
  client?: string;
  tags?: string[];
}
```

---

## Session Context Manager (`context/manager.ts`)

### Lifecycle
- `startSession(request?)` — Creates new session, ends any existing one
- `endSession(sessionId)` — Marks session as ended, persists final state
- `getActiveSession()` — Returns current session or null

### Recording
- `recordMemoryLoaded(sessionId, memoryId, tokenCount?)` — Track memory load
- `recordPatternLoaded(sessionId, patternId, tokenCount?)` — Track pattern load
- `recordFileLoaded(sessionId, filePath, tokenCount?)` — Track file load
- `recordQuery(sessionId, tokenCount)` — Track query

### Statistics
```typescript
interface SessionStats {
  sessionId: string;
  durationMs: number;
  memoriesLoaded: number;
  uniqueMemoriesLoaded: number;
  patternsLoaded: number;
  filesReferenced: number;
  tokensSent: number;
  tokensSaved: number;
  deduplicationEfficiency: number;
  queriesMade: number;
  avgTokensPerQuery: number;
  compressionLevelDistribution: Record<number, number>;
}
```

### Session Validity
Sessions expire based on:
- Inactivity timeout
- Max duration
- Max tokens per session

### Cleanup
`cleanup()` — Deletes sessions older than retention period (default 7 days).

---

## Deduplicator (`context/deduplicator.ts`)
Filters out memories already sent in the current session. Marks duplicates with `alreadySent: true` flag.

## Tracker (`context/tracker.ts`)
`LoadedMemoryTracker` — Tracks loaded items with metadata (token count, compression level, load count).

---

## Session Storage (`storage/`)
- `interface.ts` — `ISessionStorage` contract
- `sqlite.ts` — SQLite implementation

Persists sessions for cross-restart continuity (optional, controlled by config).

---

## Session Configuration
```typescript
interface SessionConfig {
  persistSessions: boolean;
  inactivityTimeout?: number;    // ms
  maxDuration?: number;          // ms
  maxTokensPerSession?: number;
  autoCleanup: boolean;
  retentionDays: number;         // Default: 7
}
```

---

## Rust Rebuild Considerations
- Session tracking is lightweight state management — easy in Rust
- The deduplicator is a Set lookup — O(1) in both languages
- Session persistence is simple SQLite — `rusqlite` maps directly
- Consider using Rust's `DashMap` for concurrent session access
- Token tracking is pure arithmetic — trivial
