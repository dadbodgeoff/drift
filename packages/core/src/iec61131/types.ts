/**
 * IEC 61131-3 Code Factory - Type Definitions
 * 
 * Single source of truth for all IEC 61131-3 analysis types.
 * Following architecture doc Part 3: Data Model
 */

// ============================================================================
// VENDOR & PARSER TYPES
// ============================================================================

export type VendorId =
  | 'siemens-step7'
  | 'siemens-tia'
  | 'rockwell-rslogix'
  | 'rockwell-studio5000'
  | 'beckhoff-twincat'
  | 'codesys'
  | 'schneider-unity'
  | 'omron-sysmac'
  | 'mitsubishi-gxworks'
  | 'generic-st';

export type ParserConfidence =
  | { level: 'definite'; reason: string }
  | { level: 'probable'; score: number; reason: string }
  | { level: 'possible'; score: number; reason: string }
  | { level: 'none' };

export type POUType = 'PROGRAM' | 'FUNCTION_BLOCK' | 'FUNCTION' | 'CLASS' | 'INTERFACE';

export type VariableSection =
  | 'VAR_INPUT'
  | 'VAR_OUTPUT'
  | 'VAR_IN_OUT'
  | 'VAR'
  | 'VAR_GLOBAL'
  | 'VAR_TEMP'
  | 'VAR_CONSTANT'
  | 'VAR_EXTERNAL';

// ============================================================================
// SOURCE LOCATION
// ============================================================================

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

// ============================================================================
// DOCSTRING TYPES
// ============================================================================

export interface STDocstring {
  id: string;
  summary: string;
  description: string;
  params: STDocParam[];
  returns: string | null;
  author: string | null;
  date: string | null;
  history: STHistoryEntry[];
  warnings: string[];
  notes: string[];
  raw: string;
  location: SourceLocation;
  associatedBlock: string | null;
  associatedBlockType: POUType | null;
}

export interface STDocParam {
  name: string;
  type: string | null;
  description: string;
  direction: 'in' | 'out' | 'inout' | null;
}

export interface STHistoryEntry {
  date: string;
  author: string | null;
  description: string;
}

// ============================================================================
// VARIABLE TYPES
// ============================================================================

export interface STVariable {
  id: string;
  name: string;
  dataType: string;
  section: VariableSection;
  initialValue: string | null;
  comment: string | null;
  isArray: boolean;
  arrayBounds: ArrayBounds | null;
  isSafetyCritical: boolean;
  ioAddress: string | null;
  location: SourceLocation;
  pouId: string | null;
}

export interface ArrayBounds {
  dimensions: Array<{ lower: number; upper: number }>;
}

// ============================================================================
// POU (PROGRAM ORGANIZATION UNIT) TYPES
// ============================================================================

export interface STPOU {
  id: string;
  type: POUType;
  name: string;
  qualifiedName: string;
  location: SourceLocation;
  documentation: STDocstring | null;
  variables: STVariable[];
  extends: string | null;
  implements: string[];
  methods: STMethod[];
  bodyStartLine: number;
  bodyEndLine: number;
  vendorAttributes: Record<string, unknown>;
}

export interface STMethod {
  id: string;
  name: string;
  returnType: string | null;
  parameters: STVariable[];
  location: SourceLocation;
  documentation: STDocstring | null;
}

// ============================================================================
// STATE MACHINE TYPES
// ============================================================================

export interface StateMachine {
  id: string;
  name: string;
  pouId: string;
  pouName: string;
  stateVariable: string;
  stateVariableType: string;
  states: StateMachineState[];
  transitions: StateMachineTransition[];
  location: SourceLocation;
  verification: StateMachineVerification;
  visualizations: StateMachineVisualizations;
}

export interface StateMachineState {
  id: string;
  value: number | string;
  name: string | null;
  documentation: string | null;
  isInitial: boolean;
  isFinal: boolean;
  actions: string[];
  location: SourceLocation;
}

export interface StateMachineTransition {
  id: string;
  fromStateId: string;
  toStateId: string;
  guard: string | null;
  actions: string[];
  documentation: string | null;
  location: SourceLocation;
}

export interface StateMachineVerification {
  hasDeadlocks: boolean;
  unreachableStates: string[];
  missingTransitions: string[];
  hasGaps: boolean;
  gapValues: number[];
}

export interface StateMachineVisualizations {
  mermaid: string;
  ascii: string;
  plantUml?: string;
  dot?: string;
}

// ============================================================================
// SAFETY TYPES
// ============================================================================

export type SafetyInterlockType =
  | 'interlock'
  | 'permissive'
  | 'estop'
  | 'safety-relay'
  | 'safety-device'
  | 'bypass';

export type SafetySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface SafetyInterlock {
  id: string;
  name: string;
  type: SafetyInterlockType;
  location: SourceLocation;
  pouId: string | null;
  isBypassed: boolean;
  bypassCondition: string | null;
  confidence: number;
  severity: SafetySeverity;
  relatedInterlocks: string[];
}

export interface SafetyBypass {
  id: string;
  name: string;
  location: SourceLocation;
  pouId: string | null;
  affectedInterlocks: string[];
  condition: string | null;
  severity: SafetySeverity;
}

export interface SafetyAnalysisResult {
  interlocks: SafetyInterlock[];
  bypasses: SafetyBypass[];
  criticalWarnings: SafetyCriticalWarning[];
  summary: SafetySummary;
}

export interface SafetyCriticalWarning {
  type: 'bypass-detected' | 'unprotected-output' | 'missing-estop' | 'interlock-gap';
  message: string;
  severity: SafetySeverity;
  location: SourceLocation;
  remediation: string;
}

export interface SafetySummary {
  totalInterlocks: number;
  byType: Record<SafetyInterlockType, number>;
  bypassCount: number;
  criticalWarningCount: number;
}

// ============================================================================
// TRIBAL KNOWLEDGE TYPES
// ============================================================================

export type TribalKnowledgeType =
  | 'warning'
  | 'caution'
  | 'danger'
  | 'note'
  | 'todo'
  | 'fixme'
  | 'hack'
  | 'workaround'
  | 'do-not-change'
  | 'magic-number'
  | 'history'
  | 'author'
  | 'equipment'
  | 'mystery';

export type TribalKnowledgeImportance = 'critical' | 'high' | 'medium' | 'low';

export interface TribalKnowledgeItem {
  id: string;
  type: TribalKnowledgeType;
  content: string;
  context: string;
  location: SourceLocation;
  pouId: string | null;
  importance: TribalKnowledgeImportance;
  extractedAt: string;
}

// ============================================================================
// I/O MAPPING TYPES
// ============================================================================

export type IOAddressType = 'IX' | 'QX' | 'IW' | 'QW' | 'ID' | 'QD' | 'IB' | 'QB' | 'MW' | 'MD' | 'MB';

export interface IOMapping {
  id: string;
  address: string;
  addressType: IOAddressType;
  variableName: string | null;
  description: string | null;
  location: SourceLocation;
  pouId: string | null;
  isInput: boolean;
  bitSize: number;
}

// ============================================================================
// CALL GRAPH TYPES
// ============================================================================

export type CallType = 'instantiation' | 'method_call' | 'function_call';

export interface STCallGraphNode {
  id: string;
  name: string;
  type: POUType;
  file: string;
  line: number;
  inputs: STVariable[];
  outputs: STVariable[];
}

export interface STCallGraphEdge {
  id: string;
  callerId: string;
  calleeId: string | null;
  calleeName: string;
  callType: CallType;
  location: SourceLocation;
  arguments: string[];
}

export interface STCallGraph {
  nodes: Map<string, STCallGraphNode>;
  edges: STCallGraphEdge[];
}

// ============================================================================
// MIGRATION SCORING TYPES
// ============================================================================

export type MigrationGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface MigrationDimensionScores {
  documentation: number;
  safety: number;
  complexity: number;
  dependencies: number;
  testability: number;
}

export interface POUMigrationScore {
  pouId: string;
  pouName: string;
  pouType: POUType;
  overallScore: number;
  dimensionScores: MigrationDimensionScores;
  grade: MigrationGrade;
  blockers: MigrationBlocker[];
  warnings: string[];
  suggestions: string[];
}

export interface MigrationBlocker {
  type: 'safety-bypass' | 'undocumented-state-machine' | 'circular-dependency' | 'missing-documentation' | 'complex-logic';
  description: string;
  severity: SafetySeverity;
  remediation: string;
}

export interface MigrationReadinessReport {
  overallScore: number;
  overallGrade: MigrationGrade;
  pouScores: POUMigrationScore[];
  migrationOrder: MigrationOrderItem[];
  risks: MigrationRisk[];
  estimatedEffort: MigrationEffortEstimate;
}

export interface MigrationOrderItem {
  order: number;
  pouId: string;
  pouName: string;
  reason: string;
  dependencies: string[];
  estimatedEffort: string;
}

export interface MigrationRisk {
  severity: SafetySeverity;
  category: string;
  description: string;
  affectedPOUs: string[];
  mitigation: string;
}

export interface MigrationEffortEstimate {
  totalHours: number;
  byPOU: Record<string, number>;
  confidence: number;
}

// ============================================================================
// AI CONTEXT TYPES
// ============================================================================

export type TargetLanguage = 'python' | 'rust' | 'typescript' | 'csharp' | 'cpp' | 'go' | 'java';

export interface AIContextPackage {
  version: string;
  generatedAt: string;
  targetLanguage: TargetLanguage;
  project: AIProjectContext;
  conventions: AIConventionContext;
  types: AITypeContext;
  safety: AISafetyContext;
  pous: AIPOUContext[];
  tribalKnowledge: TribalKnowledgeItem[];
  translationGuide: AITranslationGuide;
  verificationRequirements: AIVerificationRequirement[];
}

export interface AIProjectContext {
  name: string;
  vendor: VendorId;
  plcType: string | null;
  totalPOUs: number;
  totalLines: number;
  languages: string[];
}

export interface AIConventionContext {
  namingPatterns: Record<string, string>;
  variablePrefixes: Record<string, string>;
  stateEncodings: string[];
  commentStyles: string[];
}

export interface AITypeContext {
  plcToTarget: Record<string, string>;
  customTypes: string[];
  structDefinitions: Record<string, unknown>;
}

export interface AISafetyContext {
  interlocks: SafetyInterlock[];
  criticalPaths: string[];
  mustPreserve: string[];
}

export interface AIPOUContext {
  pouId: string;
  pouName: string;
  pouType: POUType;
  purpose: string;
  interface: {
    inputs: AIVariableDescription[];
    outputs: AIVariableDescription[];
    inOuts: AIVariableDescription[];
  };
  behavior: {
    summary: string;
    stateMachines: string[];
    algorithms: string[];
  };
  safety: {
    isSafetyCritical: boolean;
    interlocks: string[];
    constraints: string[];
  };
  translationHints: AITranslationHint[];
  suggestedTests: string[];
}

export interface AIVariableDescription {
  name: string;
  type: string;
  description: string;
  constraints: string[];
}

export interface AITranslationHint {
  category: 'timing' | 'pattern' | 'io' | 'safety' | 'type';
  plcConstruct: string;
  targetEquivalent: string;
  notes: string;
  example: string;
}

export interface AITranslationGuide {
  targetLanguage: TargetLanguage;
  typeMapping: Record<string, string>;
  patternMapping: AIPatternMapping[];
  warnings: string[];
}

export interface AIPatternMapping {
  plcPattern: string;
  targetPattern: string;
  example: string;
}

export interface AIVerificationRequirement {
  category: string;
  requirement: string;
  testApproach: string;
}

// ============================================================================
// DIAGRAM TYPES
// ============================================================================

export type DiagramFormat = 'mermaid' | 'plantuml' | 'ascii' | 'dot' | 'd2' | 'svg';

export type DiagramType = 'fbd' | 'state' | 'call-graph' | 'safety' | 'io';

export interface DiagramOptions {
  format: DiagramFormat;
  width?: number;
  height?: number;
  includeComments?: boolean;
  highlightSafety?: boolean;
}

export interface DiagramResult {
  format: DiagramFormat;
  type: DiagramType;
  content: string;
  metadata: {
    nodeCount: number;
    edgeCount: number;
    complexity: 'simple' | 'moderate' | 'complex';
  };
  alternatives?: Partial<Record<DiagramFormat, string>>;
}

// ============================================================================
// ANALYSIS RESULT TYPES
// ============================================================================

export interface STProjectStatus {
  project: {
    path: string;
    name: string;
    vendor: VendorId | null;
    plcType: string | null;
  };
  files: {
    total: number;
    byExtension: Record<string, number>;
    totalLines: number;
  };
  analysis: {
    lastRun: string | null;
    pous: number;
    stateMachines: number;
    safetyInterlocks: number;
    tribalKnowledge: number;
    docstrings: number;
  };
  health: {
    score: number;
    issues: HealthIssue[];
  };
}

export interface HealthIssue {
  type: 'warning' | 'error' | 'info';
  message: string;
  file?: string;
  line?: number;
}

// ============================================================================
// EXPORT TYPES
// ============================================================================

export type ExportFormat =
  | 'json'
  | 'markdown'
  | 'html'
  | 'yaml'
  | 'sqlite'
  | 'ai-context'
  | 'mermaid-bundle'
  | 'csv';

export interface ExportOptions {
  format: ExportFormat;
  outputPath?: string;
  includeRaw?: boolean;
  maxTokens?: number;
  targetLanguage?: TargetLanguage;
}

export interface ExportResult {
  format: ExportFormat;
  content: string;
  metadata: {
    itemCount: number;
    generatedAt: string;
    tokenEstimate?: number;
  };
}

// ============================================================================
// ANALYZER TYPES
// ============================================================================

export type AnalyzerId =
  // Structural
  | 'structure/pou-hierarchy'
  | 'structure/call-graph'
  | 'structure/data-flow'
  | 'structure/control-flow'
  // Documentation
  | 'docs/docstring-extractor'
  | 'docs/tribal-knowledge'
  | 'docs/history-tracker'
  // Safety
  | 'safety/interlock-detector'
  | 'safety/estop-paths'
  | 'safety/bypass-detector'
  // Patterns
  | 'pattern/state-machine'
  | 'pattern/timer-counter'
  | 'pattern/pid-loop'
  // Quality
  | 'quality/complexity-scorer'
  | 'quality/naming-conventions'
  // I/O
  | 'io/address-mapper'
  | 'io/signal-tracer'
  // Migration
  | 'migration/readiness-scorer'
  | 'migration/risk-assessor';

export interface AnalysisContext {
  projectPath: string;
  files: string[];
  options: AnalysisOptions;
  results: Map<AnalyzerId, unknown>;
  getResult<T>(analyzerId: AnalyzerId): T | null;
}

export interface AnalysisOptions {
  includeRaw?: boolean;
  limit?: number;
  verbose?: boolean;
  targetLanguage?: TargetLanguage;
  maxTokens?: number;
}

export interface AnalysisResult<T> {
  success: boolean;
  data: T;
  errors: AnalysisError[];
  metadata: {
    analyzerId: AnalyzerId;
    duration: number;
    itemsProcessed: number;
  };
}

export interface AnalysisError {
  code: string;
  message: string;
  file?: string;
  line?: number;
  recoverable: boolean;
}

// ============================================================================
// FILE EXTENSIONS
// ============================================================================

export const ST_EXTENSIONS = ['.st', '.stx', '.scl', '.pou', '.exp', '.xml'] as const;
export type STExtension = typeof ST_EXTENSIONS[number];
