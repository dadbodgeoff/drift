/**
 * Decision Mining Module
 *
 * Mine architectural decisions from git history.
 * Supports TypeScript/JavaScript, Python, Java, C#, and PHP.
 *
 * @example
 * ```typescript
 * import { createDecisionMiningAnalyzer } from '@drift/core/decisions';
 *
 * const analyzer = createDecisionMiningAnalyzer({
 *   rootDir: '/path/to/repo',
 *   since: new Date('2024-01-01'),
 *   minConfidence: 0.5,
 * });
 *
 * const result = await analyzer.mine();
 * console.log(`Found ${result.decisions.length} architectural decisions`);
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Core types
  DecisionLanguage,
  DecisionConfidence,
  DecisionStatus,
  DecisionCategory,

  // Git types
  GitCommit,
  GitFileChange,
  PullRequestInfo,

  // Extraction types
  CommitSemanticExtraction,
  PatternDelta,
  FunctionDelta,
  DependencyDelta,
  MessageSignal,
  ArchitecturalSignal,

  // Clustering types
  CommitCluster,
  ClusterReason,

  // Decision types
  MinedDecision,
  SynthesizedADR,
  ADRReference,
  ADREvidence,
  CodeLocation,

  // Summary types
  DecisionMiningSummary,

  // Options types
  DecisionMiningOptions,
  ClusteringOptions,
  SynthesisOptions,

  // Result types
  DecisionMiningResult,
  MiningError,

  // Store types
  DecisionStoreConfig,
  DecisionIndex,
} from './types.js';

// ============================================================================
// Git Integration
// ============================================================================

export {
  // Git Walker
  GitWalker,
  createGitWalker,
  detectLanguage,
  classifyFile,

  // Commit Parser
  CommitParser,
  createCommitParser,
  parseCommitMessage,
  extractMessageSignals,

  // Diff Analyzer
  parseDiff,
  analyzeArchitecturalSignals,
  analyzeDependencyChanges,
  analyzeDependencyChangesSync,
  compareManifests,
} from './git/index.js';

export type {
  GitWalkerOptions,
  GitWalkResult,
  ParsedDiff,
  DiffHunk,
  DiffLine,
  ParsedCommitMessage,
  ConventionalCommitType,
  FooterToken,
  MessageReference,
  LanguageDetection,
  FileClassification,
  ParsedManifest,
  ManifestDependency,
  ManifestDiff,
} from './git/index.js';

// ============================================================================
// Extractors
// ============================================================================

export {
  // Base extractor
  BaseCommitExtractor,

  // Language-specific extractors
  TypeScriptCommitExtractor,
  createTypeScriptCommitExtractor,
  PythonCommitExtractor,
  createPythonCommitExtractor,
  JavaCommitExtractor,
  createJavaCommitExtractor,
  CSharpCommitExtractor,
  createCSharpCommitExtractor,
  PhpCommitExtractor,
  createPhpCommitExtractor,

  // Factory functions
  createCommitExtractor,
  createAllCommitExtractors,
  getExtractorForFile,
} from './extractors/index.js';

export type {
  CommitExtractorOptions,
  ExtractionContext,
} from './extractors/index.js';

// ============================================================================
// Analyzer
// ============================================================================

export {
  DecisionMiningAnalyzer,
  createDecisionMiningAnalyzer,
} from './analyzer/index.js';
