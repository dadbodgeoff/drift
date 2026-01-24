/**
 * Module Coupling Types
 *
 * Types for analyzing module dependencies, coupling metrics, and cycle detection.
 * Based on Robert C. Martin's coupling metrics.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Role of a module in the dependency graph
 */
export type ModuleRole = 'hub' | 'authority' | 'balanced' | 'isolated';

/**
 * Severity of a dependency cycle
 */
export type CycleSeverity = 'critical' | 'warning' | 'info';

/**
 * Effort level for breaking a cycle
 */
export type BreakEffort = 'low' | 'medium' | 'high';

/**
 * Coupling metrics for a module (Robert C. Martin metrics)
 */
export interface CouplingMetrics {
  /** Afferent coupling: number of modules that depend on this one */
  Ca: number;
  /** Efferent coupling: number of modules this depends on */
  Ce: number;
  /** Instability: Ce / (Ca + Ce). 0 = stable, 1 = unstable */
  instability: number;
  /** Abstractness: ratio of abstract types to total types (0-1) */
  abstractness: number;
  /** Distance from main sequence: |A + I - 1|. 0 = ideal */
  distance: number;
}

/**
 * An exported symbol from a module
 */
export interface ExportedSymbol {
  /** Symbol name */
  name: string;
  /** Type: function, class, interface, type, const, etc. */
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'other';
  /** Is this a type-only export? */
  isTypeOnly: boolean;
  /** Line number */
  line: number;
  /** Is this a re-export from another module? */
  isReExport: boolean;
  /** Original module if re-exported */
  reExportFrom?: string;
}

/**
 * A module node in the coupling graph
 */
export interface ModuleNode {
  /** File path */
  path: string;
  /** Language */
  language: 'typescript' | 'javascript' | 'python' | 'java' | 'csharp' | 'php';
  /** Modules that import this one (afferent coupling) */
  importedBy: string[];
  /** Modules this imports (efferent coupling) */
  imports: string[];
  /** Coupling metrics */
  metrics: CouplingMetrics;
  /** Role in the dependency graph */
  role: ModuleRole;
  /** Exports from this module */
  exports: ExportedSymbol[];
  /** Unused exports (exported but never imported) */
  unusedExports: string[];
  /** Is this an entry point? */
  isEntryPoint: boolean;
  /** Is this a leaf node (no outgoing deps)? */
  isLeaf: boolean;
}

/**
 * An import edge in the coupling graph
 */
export interface ImportEdge {
  /** Source module */
  from: string;
  /** Target module */
  to: string;
  /** Symbols being imported */
  symbols: string[];
  /** Is this a type-only import? */
  isTypeOnly: boolean;
  /** Import weight (more symbols = tighter coupling) */
  weight: number;
  /** Line number of the import */
  line: number;
}

/**
 * A suggestion for breaking a dependency cycle
 */
export interface CycleBreakSuggestion {
  /** Edge to remove */
  edge: { from: string; to: string };
  /** Why this is a good break point */
  rationale: string;
  /** Estimated effort */
  effort: BreakEffort;
  /** Suggested refactoring approach */
  approach: string;
}

/**
 * A detected dependency cycle
 */
export interface DependencyCycle {
  /** Unique ID */
  id: string;
  /** Modules in the cycle (in order) */
  path: string[];
  /** Cycle length */
  length: number;
  /** Severity based on cycle length and module importance */
  severity: CycleSeverity;
  /** Suggested break points */
  breakPoints: CycleBreakSuggestion[];
  /** Total coupling weight of the cycle */
  totalWeight: number;
}

// ============================================================================
// Graph Types
// ============================================================================

/**
 * Aggregate coupling metrics for the entire codebase
 */
export interface AggregateCouplingMetrics {
  /** Total number of modules */
  totalModules: number;
  /** Total number of import edges */
  totalEdges: number;
  /** Average instability across all modules */
  avgInstability: number;
  /** Average distance from main sequence */
  avgDistance: number;
  /** Number of cycles */
  cycleCount: number;
  /** Modules in the "zone of pain" (stable + concrete) */
  zoneOfPain: string[];
  /** Modules in the "zone of uselessness" (unstable + abstract) */
  zoneOfUselessness: string[];
  /** Most coupled modules (highest Ca + Ce) */
  hotspots: Array<{ path: string; coupling: number }>;
  /** Isolated modules (no imports or exports) */
  isolatedModules: string[];
}

/**
 * The complete module coupling graph
 */
export interface ModuleCouplingGraph {
  /** All modules */
  modules: Map<string, ModuleNode>;
  /** All import edges */
  edges: ImportEdge[];
  /** Detected cycles */
  cycles: DependencyCycle[];
  /** Aggregate metrics */
  metrics: AggregateCouplingMetrics;
  /** Generation timestamp */
  generatedAt: string;
  /** Project root */
  projectRoot: string;
}

// ============================================================================
// Analysis Types
// ============================================================================

/**
 * Result of analyzing a single module's coupling
 */
export interface ModuleCouplingAnalysis {
  /** The module being analyzed */
  module: ModuleNode;
  /** Direct dependencies */
  directDependencies: Array<{
    path: string;
    symbols: string[];
    weight: number;
  }>;
  /** Direct dependents */
  directDependents: Array<{
    path: string;
    symbols: string[];
    weight: number;
  }>;
  /** Transitive dependencies (all modules this eventually depends on) */
  transitiveDependencies: string[];
  /** Transitive dependents (all modules that eventually depend on this) */
  transitiveDependents: string[];
  /** Cycles this module participates in */
  cyclesInvolved: DependencyCycle[];
  /** Health assessment */
  health: {
    score: number;
    issues: string[];
    suggestions: string[];
  };
}

/**
 * Result of refactor impact analysis
 */
export interface RefactorImpact {
  /** Target module being refactored */
  target: string;
  /** Modules that would need updates */
  affectedModules: Array<{
    path: string;
    reason: string;
    effort: BreakEffort;
  }>;
  /** Total affected modules */
  totalAffected: number;
  /** Risk level */
  risk: 'low' | 'medium' | 'high' | 'critical';
  /** Suggested approach */
  suggestions: string[];
}

/**
 * Unused export analysis result
 */
export interface UnusedExportAnalysis {
  /** Module with unused exports */
  module: string;
  /** Unused export names */
  unusedExports: Array<{
    name: string;
    kind: ExportedSymbol['kind'];
    line: number;
  }>;
  /** Possible reasons */
  possibleReasons: ('dead-code' | 'public-api' | 'test-only' | 'dynamic-import')[];
}

// ============================================================================
// Options Types
// ============================================================================

/**
 * Options for module coupling analysis
 */
export interface ModuleCouplingOptions {
  /** Root directory */
  rootDir: string;
  /** File patterns to include */
  includePatterns?: string[];
  /** Patterns to exclude */
  excludePatterns?: string[];
  /** Include external dependencies (node_modules, etc.) */
  includeExternal?: boolean;
  /** Granularity: file or directory level */
  granularity?: 'file' | 'directory';
  /** Maximum depth for transitive analysis */
  maxDepth?: number;
}

/**
 * Options for cycle detection
 */
export interface CycleDetectionOptions {
  /** Maximum cycle length to report */
  maxCycleLength?: number;
  /** Minimum severity to report */
  minSeverity?: CycleSeverity;
  /** Include break suggestions */
  includeBreakSuggestions?: boolean;
}

/**
 * Options for hotspot detection
 */
export interface HotspotOptions {
  /** Maximum hotspots to return */
  limit?: number;
  /** Minimum coupling to be considered a hotspot */
  minCoupling?: number;
  /** Include zone analysis */
  includeZones?: boolean;
}
