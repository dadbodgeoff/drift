/**
 * Git Integration Module
 *
 * Provides git history traversal, commit parsing, and diff analysis
 * for decision mining.
 */

// Types
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
} from './types.js';

// Git Walker
export {
  GitWalker,
  createGitWalker,
  detectLanguage,
  classifyFile,
} from './git-walker.js';

// Commit Parser
export {
  CommitParser,
  createCommitParser,
  parseCommitMessage,
  extractMessageSignals,
} from './commit-parser.js';

// Diff Analyzer
export {
  parseDiff,
  analyzeArchitecturalSignals,
  analyzeDependencyChanges,
  analyzeDependencyChangesSync,
  compareManifests,
} from './diff-analyzer.js';
