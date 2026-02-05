/**
 * IEC 61131-3 Code Factory
 * 
 * Enterprise-grade analysis for industrial automation code.
 * Extracts docstrings, state machines, safety interlocks, and tribal knowledge.
 * 
 * @module @drift/core/iec61131
 */

// Main analyzer
export { IEC61131Analyzer, createAnalyzer } from './analyzer.js';
export type { AnalyzerOptions } from './analyzer.js';

// Parser
export { STParser, parseSTSource, STTokenizer, tokenize } from './parser/index.js';
export type {
  ParseResult,
  ParseError,
  ParseWarning,
  ParsedComment,
  ParseMetadata,
  ParseOptions,
  Token,
  TokenType,
} from './parser/index.js';

// Extractors
export {
  extractDocstrings,
  extractDocstringsFromFiles,
  extractStateMachines,
  extractStateMachinesFromFiles,
  extractSafetyInterlocks,
  extractSafetyFromFiles,
  extractTribalKnowledge,
  extractTribalKnowledgeFromFiles,
  extractVariables,
  extractVariablesFromFiles,
} from './extractors/index.js';

export type {
  DocstringExtractionResult,
  ExtractedDocstring,
  DocstringQuality,
  DocstringSummary,
  DocstringExtractionOptions,
  StateMachineExtractionResult,
  ExtractedStateMachine,
  StateMachineSummary,
  StateMachineExtractionOptions,
  SafetyExtractionResult,
  SafetyExtractionOptions,
  TribalKnowledgeExtractionResult,
  ExtractedTribalKnowledge,
  TribalKnowledgeSummary,
  TribalKnowledgeExtractionOptions,
  VariableExtractionResult,
  ExtractedVariable,
  VariableSummary,
  VariableExtractionOptions,
} from './extractors/index.js';

// Types - Export all types from types.ts
export type {
  // Vendor & Parser types
  VendorId,
  ParserConfidence,
  POUType,
  VariableSection,
  // Source location
  SourceLocation,
  // Docstring types
  STDocstring,
  STDocParam,
  STHistoryEntry,
  // Variable types
  STVariable,
  ArrayBounds,
  // POU types
  STPOU,
  STMethod,
  // State machine types
  StateMachine,
  StateMachineState,
  StateMachineTransition,
  StateMachineVerification,
  StateMachineVisualizations,
  // Safety types
  SafetyInterlockType,
  SafetySeverity,
  SafetyInterlock,
  SafetyBypass,
  SafetyAnalysisResult,
  SafetyCriticalWarning,
  SafetySummary,
  // Tribal knowledge types
  TribalKnowledgeType,
  TribalKnowledgeImportance,
  TribalKnowledgeItem,
  // I/O mapping types
  IOAddressType,
  IOMapping,
  // Call graph types
  CallType,
  STCallGraphNode,
  STCallGraphEdge,
  STCallGraph,
  // Migration scoring types
  MigrationGrade,
  MigrationDimensionScores,
  POUMigrationScore,
  MigrationBlocker,
  MigrationReadinessReport,
  MigrationOrderItem,
  MigrationRisk,
  MigrationEffortEstimate,
  // AI context types
  TargetLanguage,
  AIContextPackage,
  AIProjectContext,
  AIConventionContext,
  AITypeContext,
  AISafetyContext,
  AIPOUContext,
  AIVariableDescription,
  AITranslationHint,
  AITranslationGuide,
  AIPatternMapping,
  AIVerificationRequirement,
  // Diagram types
  DiagramFormat,
  DiagramType,
  DiagramOptions,
  DiagramResult,
  // Analysis result types
  STProjectStatus,
  HealthIssue,
  // Export types
  ExportFormat,
  ExportOptions,
  ExportResult,
  // Analyzer types
  AnalyzerId,
  AnalysisContext,
  AnalysisOptions,
  AnalysisResult,
  AnalysisError,
  // File extensions
  STExtension,
} from './types.js';

// Export constants
export { ST_EXTENSIONS } from './types.js';

// Utilities
export { generateId, generateContentId } from './utils/index.js';

// Analyzers
export { MigrationScorer, createMigrationScorer } from './analyzers/index.js';
export type { MigrationScorerConfig, ScoringWeights } from './analyzers/index.js';

export { AIContextGenerator, createAIContextGenerator } from './analyzers/index.js';
export type { AIContextGeneratorConfig } from './analyzers/index.js';

// Storage
export { IEC61131Repository, createIEC61131Repository } from './storage/index.js';
export type {
  IEC61131RepositoryConfig,
  StoredSTFile,
  StoredSTPOU,
  StoredSTVariable,
  StoredSTDocstring,
  StoredStateMachine,
  StoredSafetyInterlock,
  StoredSafetyBypass,
  StoredTribalKnowledge,
  StoredIOMapping,
  StoredMigrationScore,
  STAnalysisRun,
} from './storage/index.js';
