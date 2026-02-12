# Pattern Repository — Adapters

> `packages/core/src/patterns/adapters/` — 3 files
> Bridges legacy `PatternStore` to the new `IPatternRepository`/`IPatternService` interfaces.

## Purpose

The adapter layer enables incremental migration from the legacy `PatternStore` (in `packages/core/src/store/`) to the new pattern system. Consumers can switch to `IPatternService` without changing their underlying storage.

## PatternStoreAdapter

> `adapters/pattern-store-adapter.ts` — ~590 lines

Wraps a legacy `PatternStore` instance and exposes it as an `IPatternRepository`.

### Type Conversion

The adapter converts between two pattern formats:

**Legacy → Unified (`legacyToUnified`):**
- Maps legacy fields to the unified `Pattern` type
- Computes `confidenceLevel` from `confidence.score`
- Converts legacy location format to `PatternLocation[]`
- Sets defaults for fields not present in legacy format

**Unified → Legacy (`unifiedToLegacy`):**
- Reverse mapping for write operations
- Preserves all fields that exist in both formats

### Event Forwarding

The adapter forwards events from the legacy `PatternStore` to the `IPatternRepository` event system:

```
PatternStore events → PatternStoreAdapter → IPatternRepository events
```

### Key Behaviors

- `initialize()` calls the underlying store's `initialize()` and loads all patterns
- All query operations convert legacy patterns to unified format on-the-fly
- Write operations convert unified patterns back to legacy format before storing
- `getLegacyStore()` provides escape hatch access to the underlying `PatternStore`
- Full filter/sort/pagination support implemented in the adapter layer

### Factory Function

```typescript
function createPatternStoreAdapter(store: PatternStore): PatternStoreAdapter
```

## ServiceFactory

> `adapters/service-factory.ts` — ~140 lines

Creates an `IPatternService` from a legacy `PatternStore` in one step.

### AutoInitPatternService

Internal wrapper class that auto-initializes the repository on first use:

```typescript
class AutoInitPatternService implements IPatternService {
  private initPromise: Promise<void> | null = null;

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.repository.initialize();
    }
    await this.initPromise;
  }

  // Every method calls ensureInitialized() first
  async getStatus() {
    await this.ensureInitialized();
    return this.inner.getStatus();
  }
  // ... all other IPatternService methods
}
```

This provides a seamless experience — consumers don't need to manually call `initialize()`.

### Factory Function

```typescript
function createPatternServiceFromStore(
  store: PatternStore,
  rootDir: string,
  config?: Partial<PatternServiceConfig>
): IPatternService
```

**Pipeline:**
```
PatternStore → PatternStoreAdapter → PatternService → AutoInitPatternService
                (IPatternRepository)   (IPatternService)   (auto-init wrapper)
```

### Usage Example

```typescript
// Before (direct PatternStore usage)
const store = new PatternStore({ rootDir });
await store.initialize();
const patterns = store.getAll();

// After (using PatternService via adapter)
const store = new PatternStore({ rootDir });
const service = createPatternServiceFromStore(store, rootDir);
const result = await service.listPatterns(); // Auto-initializes
```

This is the exact pattern used by the MCP server's `enterprise-server.ts`:

```typescript
const patternService = createPatternServiceFromStore(
  stores.pattern as PatternStore,
  config.projectRoot,
  { enableCache: config.enableCache !== false }
);
```

## Migration Path

The adapters enable a three-phase migration:

1. **Phase 1 (current):** MCP server creates `IPatternService` from legacy `PatternStore` via adapter. Dual-path tool implementations use service when available.

2. **Phase 2 (planned):** Replace `PatternStore` with `UnifiedFilePatternRepository` (or SQLite repository). The `IPatternService` interface stays the same — consumers don't change.

3. **Phase 3 (v2):** Remove legacy `PatternStore` and adapters entirely. All consumers use `IPatternService` backed by the v2 storage engine.
