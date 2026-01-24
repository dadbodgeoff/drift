/**
 * Module Coupling Module
 *
 * Provides dependency graph analysis, cycle detection, and coupling metrics.
 * Based on Robert C. Martin's coupling metrics (Ca, Ce, Instability, Abstractness, Distance).
 */

// Types
export type {
  ModuleRole,
  CycleSeverity,
  BreakEffort,
  CouplingMetrics,
  ExportedSymbol,
  ModuleNode,
  ImportEdge,
  CycleBreakSuggestion,
  DependencyCycle,
  AggregateCouplingMetrics,
  ModuleCouplingGraph,
  ModuleCouplingAnalysis,
  RefactorImpact,
  UnusedExportAnalysis,
  ModuleCouplingOptions,
  CycleDetectionOptions,
  HotspotOptions,
} from './types.js';

// Analyzer
export {
  ModuleCouplingAnalyzer,
  createModuleCouplingAnalyzer,
} from './coupling-analyzer.js';
