# Detector Registry & Loader

## Location
`packages/detectors/src/registry/`

## Files
- `detector-registry.ts` — `DetectorRegistry`: central registry
- `loader.ts` — `DetectorLoader`: lazy loading system
- `types.ts` — Registry type definitions

---

## DetectorRegistry

Central registry for all detectors. Supports registration, querying, enable/disable, and event notifications.

### Registration
```typescript
register(detector: BaseDetector, options?: DetectorRegistrationOptions): void
registerFactory(id: string, factory: () => Promise<BaseDetector>, info: DetectorInfo, options?): void
unregister(id: string): boolean
```

### Registration Options
```typescript
interface DetectorRegistrationOptions {
  override?: boolean;   // Override existing detector with same ID
  priority?: number;    // Higher = runs first (default: 0)
  enabled?: boolean;    // Enabled by default (default: true)
}
```

### Retrieval
```typescript
get(id: string): Promise<BaseDetector | undefined>     // Async (supports lazy loading)
getSync(id: string): BaseDetector | undefined           // Sync (only if already loaded)
getInfo(id: string): RegisteredDetector | undefined
has(id: string): boolean
getIds(): string[]
getAll(): RegisteredDetector[]
size: number
```

### Querying
```typescript
query(query?: DetectorQuery): DetectorQueryResult

interface DetectorQuery {
  category?: PatternCategory;
  subcategory?: string;
  language?: Language;
  detectionMethod?: DetectionMethod;
  enabled?: boolean;
  idPattern?: string | RegExp;
}
```

### Enable/Disable
```typescript
enable(id: string): boolean
disable(id: string): boolean
isEnabled(id: string): boolean
```

### Events
```typescript
addEventListener(listener: RegistryEventListener): void
removeEventListener(listener: RegistryEventListener): void

// Event types: 'registered', 'unregistered', 'enabled', 'disabled'
interface RegistryEvent {
  type: 'registered' | 'unregistered' | 'enabled' | 'disabled';
  detectorId: string;
  timestamp: Date;
}
```

### File Change Notification
```typescript
notifyFileChange(file: string): void  // Notifies all registered detectors
```

---

## DetectorLoader

Lazy loading system for detectors. Manages modules, loads on demand, tracks load state.

### Module Registration
```typescript
registerModule(module: DetectorModule): void
registerModules(modules: DetectorModule[]): void
unregisterModule(id: string): boolean

interface DetectorModule {
  id: string;
  path: string;                    // Module path for dynamic import
  info: DetectorInfo;
  factory?: () => Promise<BaseDetector>;  // Optional factory
  dependencies?: string[];         // Other module IDs
}
```

### Loading
```typescript
load(id: string): Promise<BaseDetector>                    // Load single
loadAll(): Promise<LoadResult>                              // Load all
loadFiltered(filter: (module) => boolean): Promise<LoadResult>  // Load matching
loadByCategory(category: string): Promise<LoadResult>       // Load by category
loadByLanguage(language: string): Promise<LoadResult>       // Load by language
```

### LoadResult
```typescript
interface LoadResult {
  loaded: string[];     // Successfully loaded IDs
  failed: string[];     // Failed IDs
  skipped: string[];    // Skipped IDs
  errors: Map<string, Error>;
  duration: number;     // ms
}
```

### State Tracking
```typescript
getStatus(id: string): LoadStatus | undefined  // 'pending' | 'loading' | 'loaded' | 'failed'
getStats(): { pending: number; loading: number; loaded: number; failed: number }
hasModule(id: string): boolean
getModuleIds(): string[]
size: number
```

---

## DetectorInfo (metadata)
```typescript
interface DetectorInfo {
  id: string;                          // e.g. 'structural/file-naming'
  category: PatternCategory;
  subcategory: string;
  name: string;                        // Human-readable
  description: string;
  supportedLanguages: Language[];
  detectionMethod: DetectionMethod;    // 'ast' | 'regex' | 'semantic' | 'structural' | 'custom'
}
```

---

## Factory Functions (index.ts)

The main `index.ts` exports factory functions for creating detectors by category:

### Base Detectors
- `createAllApiDetectors()`, `createAllStructuralDetectors()`, `createAllComponentDetectors()`, `createAllStylingDetectors()`
- `createAllDetectors()` — Creates all base detectors
- `createAllDetectorsArray()` — Async version returning flat array

### Learning Detectors (by category)
- `createAllAuthLearningDetectors()`
- `createAllSecurityLearningDetectors()`
- `createAllErrorLearningDetectors()`
- `createAllStructuralLearningDetectors()`
- `createAllComponentLearningDetectors()`
- `createAllStylingLearningDetectors()`
- `createAllLoggingLearningDetectors()`
- `createAllTestingLearningDetectors()`
- `createAllDataAccessLearningDetectors()`
- `createAllConfigLearningDetectors()`
- `createAllTypesLearningDetectors()`
- `createAllAccessibilityLearningDetectors()`
- `createAllDocumentationLearningDetectors()`
- `createAllPerformanceLearningDetectors()`

### Semantic Detectors (by category)
- `createAllAuthSemanticDetectors()`
- `createAllSecuritySemanticDetectors()`
- `createAllErrorSemanticDetectors()`
- `createAllStructuralSemanticDetectors()`
- `createAllComponentSemanticDetectors()`
- `createAllStylingSemanticDetectors()`
- `createAllLoggingSemanticDetectors()`
- `createAllTestingSemanticDetectors()`
- `createAllDataAccessSemanticDetectors()`
- `createAllDataBoundarySemanticDetectors()`
- `createAllConfigSemanticDetectors()`
- `createAllTypesSemanticDetectors()`
- `createAllAccessibilitySemanticDetectors()`
- `createAllDocumentationSemanticDetectors()`
- `createAllPerformanceSemanticDetectors()`

### Utility
- `getDetectorCounts()` — Returns count breakdown by category and variant
