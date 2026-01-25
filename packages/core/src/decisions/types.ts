/**
 * Decision Mining Types
 *
 * Types for mining architectural decisions from git history.
 * Supports all 5 languages: TypeScript/JavaScript, Python, Java, C#, PHP
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Supported languages for semantic commit analysis
 */
export type DecisionLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'java'
  | 'csharp'
  | 'php'
  | 'rust'
  | 'cpp';

/**
 * Decision confidence level
 */
export type DecisionConfidence = 'high' | 'medium' | 'low';

/**
 * Decision status in the lifecycle
 */
export type DecisionStatus = 'draft' | 'confirmed' | 'superseded' | 'rejected';

/**
 * Decision category (what kind of architectural decision)
 */
export type DecisionCategory =
  | 'technology-adoption'      // New framework/library added
  | 'technology-removal'       // Removing dependency
  | 'pattern-introduction'     // New coding pattern introduced
  | 'pattern-migration'        // Changing from one pattern to another
  | 'architecture-change'      // Structural/architectural changes
  | 'api-change'               // API modifications (breaking or non-breaking)
  | 'security-enhancement'     // Security improvements
  | 'performance-optimization' // Performance-related changes
  | 'refactoring'              // Code restructuring without behavior change
  | 'testing-strategy'         // Changes to testing approach
  | 'infrastructure'           // Build, deploy, CI/CD changes
  | 'other';

// ============================================================================
// Git Types
// ============================================================================

/**
 * A git commit with parsed metadata
 */
export interface GitCommit {
  /** Full SHA hash */
  sha: string;
  /** Short SHA (7 chars) */
  shortSha: string;
  /** Commit message (first line) */
  subject: string;
  /** Full commit message body */
  body: string;
  /** Author name */
  authorName: string;
  /** Author email */
  authorEmail: string;
  /** Commit date */
  date: Date;
  /** Files changed in this commit */
  files: GitFileChange[];
  /** Parent commit SHAs */
  parents: string[];
  /** Branch name (if available) */
  branch?: string;
  /** Associated PR info (if available) */
  pullRequest?: PullRequestInfo;
  /** Is this a merge commit? */
  isMerge: boolean;
}

/**
 * A file change within a commit
 */
export interface GitFileChange {
  /** File path (relative to repo root) */
  path: string;
  /** Previous path (for renames) */
  previousPath?: string;
  /** Change status */
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  /** Lines added */
  additions: number;
  /** Lines deleted */
  deletions: number;
  /** Detected language */
  language: DecisionLanguage | 'other' | 'config' | 'docs';
  /** Is this a test file? */
  isTest: boolean;
  /** Is this a config file? */
  isConfig: boolean;
}

/**
 * Pull request information
 */
export interface PullRequestInfo {
  /** PR number */
  number: number;
  /** PR title */
  title: string;
  /** PR description/body */
  body?: string;
  /** Labels on the PR */
  labels: string[];
  /** Base branch */
  baseBranch: string;
  /** Head branch */
  headBranch: string;
}

// ============================================================================
// Extraction Types
// ============================================================================

/**
 * Semantic extraction result from a single commit
 */
export interface CommitSemanticExtraction {
  /** The commit being analyzed */
  commit: GitCommit;
  /** Primary language of changes */
  primaryLanguage: DecisionLanguage | 'mixed' | 'other';
  /** All languages affected */
  languagesAffected: DecisionLanguage[];

  /** Patterns detected/changed in this commit */
  patternsAffected: PatternDelta[];

  /** Functions added/removed/modified */
  functionsChanged: FunctionDelta[];

  /** Dependencies added/removed/changed */
  dependencyChanges: DependencyDelta[];

  /** Semantic signals from commit message */
  messageSignals: MessageSignal[];

  /** Architectural signals detected */
  architecturalSignals: ArchitecturalSignal[];

  /** Confidence this commit is architecturally significant (0-1) */
  significance: number;

  /** Extraction timestamp */
  extractedAt: Date;
}

/**
 * Change to a detected pattern
 */
export interface PatternDelta {
  /** Pattern identifier */
  patternId: string;
  /** Pattern name */
  patternName: string;
  /** Pattern category */
  category: string;
  /** Type of change */
  changeType: 'introduced' | 'removed' | 'modified' | 'expanded' | 'contracted';
  /** Locations before the change */
  locationsBefore: number;
  /** Locations after the change */
  locationsAfter: number;
  /** Files affected */
  filesAffected: string[];
}

/**
 * Change to a function
 */
export interface FunctionDelta {
  /** Function identifier */
  functionId: string;
  /** Function name */
  name: string;
  /** Qualified name (class.method) */
  qualifiedName: string;
  /** File path */
  file: string;
  /** Type of change */
  changeType: 'added' | 'removed' | 'modified' | 'renamed' | 'moved';
  /** Is this an entry point? */
  isEntryPoint: boolean;
  /** Signature changed? */
  signatureChanged: boolean;
}

/**
 * Change to a dependency
 */
export interface DependencyDelta {
  /** Package/module name */
  name: string;
  /** Type of change */
  changeType: 'added' | 'removed' | 'upgraded' | 'downgraded';
  /** Version before (if applicable) */
  versionBefore?: string;
  /** Version after (if applicable) */
  versionAfter?: string;
  /** Is this a dev dependency? */
  isDev: boolean;
  /** Dependency file (package.json, requirements.txt, etc.) */
  sourceFile: string;
}

/**
 * Signal extracted from commit message
 */
export interface MessageSignal {
  /** Type of signal */
  type: 'keyword' | 'pattern' | 'reference' | 'breaking-change' | 'deprecation';
  /** The matched value */
  value: string;
  /** Confidence in this signal (0-1) */
  confidence: number;
  /** Category hint from this signal */
  categoryHint?: DecisionCategory;
}

/**
 * Architectural signal detected in code changes
 */
export interface ArchitecturalSignal {
  /** Type of architectural change */
  type:
    | 'new-abstraction'      // New interface/abstract class
    | 'layer-change'         // Changes to architectural layers
    | 'api-surface-change'   // Public API modifications
    | 'data-model-change'    // Database/model changes
    | 'config-change'        // Configuration changes
    | 'build-change'         // Build system changes
    | 'test-strategy-change' // Testing approach changes
    | 'error-handling-change'// Error handling modifications
    | 'auth-change'          // Authentication/authorization changes
    | 'integration-change';  // External integration changes
  /** Description of the signal */
  description: string;
  /** Files involved */
  files: string[];
  /** Confidence (0-1) */
  confidence: number;
}

// ============================================================================
// Clustering Types
// ============================================================================

/**
 * A cluster of related commits representing a single decision
 */
export interface CommitCluster {
  /** Unique cluster ID */
  id: string;
  /** Commits in this cluster */
  commits: GitCommit[];
  /** Commit SHAs for quick lookup */
  commitShas: Set<string>;

  /** Reasons why these commits are grouped */
  clusterReasons: ClusterReason[];

  /** Overall similarity score (0-1) */
  similarity: number;

  /** Time span of the cluster */
  dateRange: {
    start: Date;
    end: Date;
  };

  /** Duration in human-readable format */
  duration: string;

  /** All files affected across commits */
  filesAffected: string[];

  /** Languages involved */
  languages: DecisionLanguage[];

  /** Primary language */
  primaryLanguage: DecisionLanguage | 'mixed';

  /** Total lines changed */
  totalLinesChanged: number;

  /** Authors involved */
  authors: string[];

  /** Aggregated patterns affected */
  patternsAffected: PatternDelta[];

  /** Aggregated dependency changes */
  dependencyChanges: DependencyDelta[];
}

/**
 * Reason for clustering commits together
 */
export type ClusterReason =
  | { type: 'temporal'; description: string; daysSpan: number }
  | { type: 'file-overlap'; files: string[]; overlapPercent: number }
  | { type: 'pattern-similarity'; patterns: string[]; similarity: number }
  | { type: 'message-similarity'; keywords: string[]; similarity: number }
  | { type: 'branch-grouping'; branch: string }
  | { type: 'pr-grouping'; prNumber: number; prTitle: string }
  | { type: 'author-grouping'; author: string }
  | { type: 'dependency-grouping'; dependency: string };

// ============================================================================
// Decision Types
// ============================================================================

/**
 * A mined architectural decision
 */
export interface MinedDecision {
  /** Unique decision ID (e.g., "DEC-001") */
  id: string;
  /** Human-readable title */
  title: string;
  /** Current status */
  status: DecisionStatus;
  /** Decision category */
  category: DecisionCategory;
  /** Confidence level */
  confidence: DecisionConfidence;
  /** Numeric confidence score (0-1) */
  confidenceScore: number;

  /** Time span of the decision */
  dateRange: {
    start: Date;
    end: Date;
  };
  /** Duration in human-readable format */
  duration: string;

  /** The commit cluster this decision is based on */
  cluster: CommitCluster;

  /** Patterns that changed as part of this decision */
  patternsChanged: PatternDelta[];

  /** Dependencies that changed */
  dependenciesChanged: DependencyDelta[];

  /** Synthesized ADR content */
  adr: SynthesizedADR;

  /** Current code locations where this decision manifests */
  currentCodeLocations: CodeLocation[];

  /** Related decisions (by ID) */
  relatedDecisions: string[];

  /** Tags for categorization */
  tags: string[];

  /** When this decision was mined */
  minedAt: Date;

  /** Last update timestamp */
  lastUpdated: Date;

  /** User who confirmed (if confirmed) */
  confirmedBy?: string;

  /** Notes added by users */
  notes?: string;
}

/**
 * Synthesized ADR (Architecture Decision Record) content
 */
export interface SynthesizedADR {
  /** Context section - why was this decision needed? */
  context: string;

  /** Decision section - what was decided? */
  decision: string;

  /** Consequences section - what are the implications? */
  consequences: string[];

  /** Alternatives considered (if detectable) */
  alternatives?: string[];

  /** References (commits, PRs, issues) */
  references: ADRReference[];

  /** Key evidence supporting this ADR */
  evidence: ADREvidence[];
}

/**
 * Reference in an ADR
 */
export interface ADRReference {
  type: 'commit' | 'pr' | 'issue' | 'external';
  id: string;
  title?: string;
  url?: string;
}

/**
 * Evidence supporting an ADR
 */
export interface ADREvidence {
  type: 'commit-message' | 'code-change' | 'dependency-change' | 'pattern-change';
  description: string;
  source: string;
  confidence: number;
}

/**
 * Location in current code where a decision manifests
 */
export interface CodeLocation {
  /** File path */
  file: string;
  /** Line number (if specific) */
  line?: number;
  /** Function ID (if applicable) */
  functionId?: string;
  /** Function name */
  functionName?: string;
  /** Relevance score (0-1) */
  relevance: number;
  /** How this location relates to the decision */
  relationship: 'introduced-by' | 'modified-by' | 'affected-by';
}

// ============================================================================
// Summary Types
// ============================================================================

/**
 * Summary of decision mining results
 */
export interface DecisionMiningSummary {
  /** Total decisions mined */
  totalDecisions: number;
  /** Decisions by status */
  byStatus: Record<DecisionStatus, number>;
  /** Decisions by category */
  byCategory: Record<DecisionCategory, number>;
  /** Decisions by confidence */
  byConfidence: Record<DecisionConfidence, number>;
  /** Decisions by language */
  byLanguage: Record<DecisionLanguage | 'mixed', number>;
  /** Date range of analyzed history */
  dateRange: {
    earliest: Date;
    latest: Date;
  };
  /** Total commits analyzed */
  totalCommitsAnalyzed: number;
  /** Commits that were architecturally significant */
  significantCommits: number;
  /** Average cluster size */
  avgClusterSize: number;
  /** Top patterns affected */
  topPatterns: Array<{ pattern: string; count: number }>;
  /** Top dependencies changed */
  topDependencies: Array<{ dependency: string; count: number }>;
  /** Mining duration */
  miningDuration: number;
  /** Last mining timestamp */
  lastMined: Date;
}

// ============================================================================
// Options Types
// ============================================================================

/**
 * Options for decision mining
 */
export interface DecisionMiningOptions {
  /** Root directory of the repository */
  rootDir: string;

  /** Start date for analysis */
  since?: Date;

  /** End date for analysis */
  until?: Date;

  /** Maximum commits to analyze */
  maxCommits?: number;

  /** Minimum cluster size to form a decision */
  minClusterSize?: number;

  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;

  /** Include merge commits in analysis */
  includeMergeCommits?: boolean;

  /** Languages to analyze (default: all) */
  languages?: DecisionLanguage[];

  /** Branches to analyze (default: main/master + feature branches) */
  branches?: string[];

  /** Exclude paths matching these patterns */
  excludePaths?: string[];

  /** Use existing pattern data for enrichment */
  usePatternData?: boolean;

  /** Use existing call graph for enrichment */
  useCallGraph?: boolean;

  /** Enable AI-assisted synthesis */
  enableAISynthesis?: boolean;

  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Options for clustering algorithm
 */
export interface ClusteringOptions {
  /** Temporal proximity threshold (days) */
  temporalThresholdDays?: number;

  /** File overlap threshold (0-1) */
  fileOverlapThreshold?: number;

  /** Message similarity threshold (0-1) */
  messageSimilarityThreshold?: number;

  /** Minimum cluster size */
  minClusterSize?: number;

  /** Maximum cluster size */
  maxClusterSize?: number;

  /** Weight for temporal similarity */
  temporalWeight?: number;

  /** Weight for file overlap */
  fileOverlapWeight?: number;

  /** Weight for message similarity */
  messageSimilarityWeight?: number;

  /** Weight for pattern similarity */
  patternSimilarityWeight?: number;
}

/**
 * Options for ADR synthesis
 */
export interface SynthesisOptions {
  /** Use AI for enhanced synthesis */
  useAI?: boolean;

  /** Template style */
  templateStyle?: 'standard' | 'detailed' | 'minimal';

  /** Include code examples in ADR */
  includeCodeExamples?: boolean;

  /** Maximum length for each section */
  maxSectionLength?: number;

  /** Include raw evidence */
  includeEvidence?: boolean;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result of decision mining
 */
export interface DecisionMiningResult {
  /** Mined decisions */
  decisions: MinedDecision[];

  /** Summary statistics */
  summary: DecisionMiningSummary;

  /** Clusters that didn't meet threshold */
  rejectedClusters: CommitCluster[];

  /** Errors encountered during mining */
  errors: MiningError[];

  /** Warnings */
  warnings: string[];
}

/**
 * Error during mining
 */
export interface MiningError {
  /** Error type */
  type: 'git-error' | 'parse-error' | 'extraction-error' | 'synthesis-error';
  /** Error message */
  message: string;
  /** Related commit SHA (if applicable) */
  commitSha?: string;
  /** Related file (if applicable) */
  file?: string;
  /** Stack trace */
  stack?: string;
}

// ============================================================================
// Store Types
// ============================================================================

/**
 * Decision store configuration
 */
export interface DecisionStoreConfig {
  /** Root directory */
  rootDir: string;
  /** Auto-save on changes */
  autoSave?: boolean;
}

/**
 * Decision index for fast lookups
 */
export interface DecisionIndex {
  /** Version of the index format */
  version: string;
  /** All decision IDs */
  decisionIds: string[];
  /** Index by status */
  byStatus: Record<DecisionStatus, string[]>;
  /** Index by category */
  byCategory: Record<DecisionCategory, string[]>;
  /** Index by file (file -> decision IDs) */
  byFile: Record<string, string[]>;
  /** Last updated */
  lastUpdated: Date;
}
