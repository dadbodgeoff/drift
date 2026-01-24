/**
 * Git Integration Types
 *
 * Types specific to git operations for decision mining.
 */

import type { GitCommit } from '../types.js';

// ============================================================================
// Git Walker Types
// ============================================================================

/**
 * Options for walking git history
 */
export interface GitWalkerOptions {
  /** Repository root directory */
  rootDir: string;

  /** Start date (commits after this date) */
  since?: Date;

  /** End date (commits before this date) */
  until?: Date;

  /** Maximum number of commits to retrieve */
  maxCommits?: number;

  /** Branches to include (default: all) */
  branches?: string[];

  /** Include merge commits */
  includeMergeCommits?: boolean;

  /** Paths to include (glob patterns) */
  includePaths?: string[];

  /** Paths to exclude (glob patterns) */
  excludePaths?: string[];

  /** Follow renames */
  followRenames?: boolean;

  /** Include file diffs */
  includeDiffs?: boolean;
}

/**
 * Result of walking git history
 */
export interface GitWalkResult {
  /** Retrieved commits */
  commits: GitCommit[];

  /** Total commits in range (may be more than retrieved) */
  totalCommits: number;

  /** Whether there are more commits */
  hasMore: boolean;

  /** Branches found */
  branches: string[];

  /** Date range of retrieved commits */
  dateRange: {
    earliest: Date;
    latest: Date;
  };

  /** Walk duration in ms */
  duration: number;
}

// ============================================================================
// Diff Parser Types
// ============================================================================

/**
 * Parsed diff for a file
 */
export interface ParsedDiff {
  /** File path */
  file: string;

  /** Previous file path (for renames) */
  previousFile?: string;

  /** Change type */
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';

  /** Hunks in the diff */
  hunks: DiffHunk[];

  /** Total additions */
  additions: number;

  /** Total deletions */
  deletions: number;

  /** Is binary file */
  isBinary: boolean;
}

/**
 * A hunk in a diff
 */
export interface DiffHunk {
  /** Old file start line */
  oldStart: number;

  /** Old file line count */
  oldLines: number;

  /** New file start line */
  newStart: number;

  /** New file line count */
  newLines: number;

  /** Lines in this hunk */
  lines: DiffLine[];

  /** Hunk header (e.g., function context) */
  header?: string;
}

/**
 * A line in a diff
 */
export interface DiffLine {
  /** Line type */
  type: 'context' | 'addition' | 'deletion';

  /** Line content */
  content: string;

  /** Old line number (for context/deletion) */
  oldLineNumber?: number;

  /** New line number (for context/addition) */
  newLineNumber?: number;
}

// ============================================================================
// Commit Parser Types
// ============================================================================

/**
 * Parsed commit message
 */
export interface ParsedCommitMessage {
  /** Subject line (first line) */
  subject: string;

  /** Message body */
  body: string;

  /** Conventional commit type (if applicable) */
  conventionalType?: ConventionalCommitType;

  /** Conventional commit scope */
  scope?: string;

  /** Is breaking change */
  isBreakingChange: boolean;

  /** Footer tokens (e.g., "Fixes #123") */
  footerTokens: FooterToken[];

  /** Detected keywords */
  keywords: string[];

  /** References to issues/PRs */
  references: MessageReference[];
}

/**
 * Conventional commit types
 */
export type ConventionalCommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'build'
  | 'ci'
  | 'chore'
  | 'revert';

/**
 * Footer token in commit message
 */
export interface FooterToken {
  /** Token key (e.g., "Fixes", "Closes", "BREAKING CHANGE") */
  key: string;

  /** Token value */
  value: string;
}

/**
 * Reference in commit message
 */
export interface MessageReference {
  /** Reference type */
  type: 'issue' | 'pr' | 'commit';

  /** Reference ID */
  id: string;

  /** Action (e.g., "fixes", "closes", "relates to") */
  action?: string;
}

// ============================================================================
// Language Detection Types
// ============================================================================

/**
 * Language detection result for a file
 */
export interface LanguageDetection {
  /** Detected language */
  language: string;

  /** Confidence (0-1) */
  confidence: number;

  /** Detection method */
  method: 'extension' | 'shebang' | 'content' | 'filename';
}

/**
 * File classification
 */
export interface FileClassification {
  /** Is source code */
  isSource: boolean;

  /** Is test file */
  isTest: boolean;

  /** Is configuration file */
  isConfig: boolean;

  /** Is documentation */
  isDocs: boolean;

  /** Is build/generated file */
  isBuild: boolean;

  /** Is dependency manifest */
  isDependencyManifest: boolean;

  /** Manifest type (if isDependencyManifest) */
  manifestType?: 'npm' | 'pip' | 'maven' | 'gradle' | 'nuget' | 'composer';
}

// ============================================================================
// Dependency Manifest Types
// ============================================================================

/**
 * Parsed dependency manifest
 */
export interface ParsedManifest {
  /** Manifest type */
  type: 'npm' | 'pip' | 'maven' | 'gradle' | 'nuget' | 'composer';

  /** File path */
  file: string;

  /** Dependencies */
  dependencies: ManifestDependency[];

  /** Dev dependencies */
  devDependencies: ManifestDependency[];

  /** Peer dependencies (npm) */
  peerDependencies?: ManifestDependency[];
}

/**
 * A dependency in a manifest
 */
export interface ManifestDependency {
  /** Package name */
  name: string;

  /** Version constraint */
  version: string;

  /** Resolved version (if available) */
  resolvedVersion?: string;
}

/**
 * Diff between two manifest versions
 */
export interface ManifestDiff {
  /** Added dependencies */
  added: ManifestDependency[];

  /** Removed dependencies */
  removed: ManifestDependency[];

  /** Upgraded dependencies */
  upgraded: Array<{
    name: string;
    from: string;
    to: string;
  }>;

  /** Downgraded dependencies */
  downgraded: Array<{
    name: string;
    from: string;
    to: string;
  }>;
}
