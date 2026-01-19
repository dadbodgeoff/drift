/**
 * Scanner type definitions
 *
 * Provides types for file system scanning, including options, results,
 * file/directory information, statistics, and error handling.
 *
 * @requirements 2.1 - Scanner SHALL traverse directory structures respecting .gitignore and .driftignore patterns
 */

import type { Language } from '../parsers/types.js';

/**
 * Options for configuring a file system scan
 */
export interface ScanOptions {
  /** Root directory to scan (absolute or relative path) */
  rootDir: string;

  /**
   * Additional patterns to ignore (in addition to .gitignore and .driftignore)
   * Uses glob pattern syntax (e.g., '*.log', 'node_modules/**')
   */
  ignorePatterns?: string[];

  /**
   * Patterns to include (if specified, only matching files are scanned)
   * Uses glob pattern syntax (e.g., '*.ts', 'src/**')
   */
  includePatterns?: string[];

  /**
   * Maximum depth to traverse (undefined = unlimited)
   * 0 = only root directory, 1 = root + immediate children, etc.
   */
  maxDepth?: number;

  /**
   * Number of worker threads for parallel processing
   * Defaults to number of CPU cores
   * @requirements 2.6
   */
  workerCount?: number;

  /**
   * Whether to respect .gitignore patterns
   * @default true
   * @requirements 2.1
   */
  respectGitignore?: boolean;

  /**
   * Whether to respect .driftignore patterns
   * @default true
   * @requirements 2.1
   */
  respectDriftignore?: boolean;

  /**
   * Whether to follow symbolic links
   * @default false
   */
  followSymlinks?: boolean;

  /**
   * Whether to compute file content hashes
   * Useful for change detection but adds overhead
   * @default false
   */
  computeHashes?: boolean;

  /**
   * File extensions to include (e.g., ['.ts', '.js', '.py'])
   * If not specified, all files are included
   */
  extensions?: string[];

  /**
   * Maximum file size in bytes to include
   * Files larger than this are skipped
   */
  maxFileSize?: number;
}

/**
 * Result of a file system scan
 */
export interface ScanResult {
  /** List of scanned files with their information */
  files: FileInfo[];

  /** List of directories traversed */
  directories: DirectoryInfo[];

  /** Statistics about the scan */
  stats: ScanStats;

  /** Errors encountered during scanning */
  errors: ScanError[];

  /** Root directory that was scanned */
  rootDir: string;

  /** Options used for the scan */
  options: ScanOptions;

  /** Whether the scan completed successfully (may have partial results with errors) */
  success: boolean;
}

/**
 * Information about a scanned file
 */
export interface FileInfo {
  /** Absolute path to the file */
  path: string;

  /** Path relative to the scan root directory */
  relativePath: string;

  /** File name without directory */
  name: string;

  /** File extension including the dot (e.g., '.ts') */
  extension: string;

  /** File size in bytes */
  size: number;

  /** Last modification time */
  mtime: Date;

  /** Creation time (if available) */
  ctime?: Date;

  /**
   * Content hash for change detection (SHA-256)
   * Only populated if computeHashes option is true
   * @requirements 2.2
   */
  hash?: string;

  /**
   * Detected programming language
   * Determined from file extension
   */
  language?: Language;

  /** Whether the file is a symlink */
  isSymlink: boolean;
}

/**
 * Information about a scanned directory
 */
export interface DirectoryInfo {
  /** Absolute path to the directory */
  path: string;

  /** Path relative to the scan root directory */
  relativePath: string;

  /** Directory name */
  name: string;

  /** Number of files directly in this directory (not recursive) */
  fileCount: number;

  /** Number of subdirectories directly in this directory */
  subdirectoryCount: number;

  /** Depth from the root directory (0 = root) */
  depth: number;

  /** Whether the directory is a symlink */
  isSymlink: boolean;
}

/**
 * Statistics about a completed scan
 */
export interface ScanStats {
  /** Total number of files found */
  totalFiles: number;

  /** Total number of directories traversed */
  totalDirectories: number;

  /** Total size of all files in bytes */
  totalSize: number;

  /** Scan duration in milliseconds */
  duration: number;

  /** Number of files skipped due to ignore patterns */
  skippedByIgnore: number;

  /** Number of files skipped due to size limits */
  skippedBySize: number;

  /** Number of files that caused errors */
  errorCount: number;

  /** Breakdown of files by extension */
  filesByExtension: Record<string, number>;

  /** Breakdown of files by language */
  filesByLanguage: Record<string, number>;

  /** Maximum directory depth reached */
  maxDepthReached: number;

  /** Timestamp when scan started */
  startTime: Date;

  /** Timestamp when scan completed */
  endTime: Date;
}

/**
 * Error information for files that couldn't be scanned
 */
export interface ScanError {
  /** Path to the file or directory that caused the error */
  path: string;

  /** Error message */
  message: string;

  /** Error code (e.g., 'ENOENT', 'EACCES', 'ELOOP') */
  code?: string;

  /** Type of error */
  type: ScanErrorType;

  /** Stack trace (if available) */
  stack?: string;
}

/**
 * Types of scan errors
 */
export type ScanErrorType =
  | 'permission_denied'    // Cannot read file/directory
  | 'not_found'           // File/directory doesn't exist
  | 'symlink_loop'        // Circular symlink detected
  | 'read_error'          // Error reading file contents
  | 'hash_error'          // Error computing file hash
  | 'unknown';            // Unknown error

/**
 * Progress callback for long-running scans
 */
export type ScanProgressCallback = (progress: ScanProgress) => void;

/**
 * Progress information during a scan
 */
export interface ScanProgress {
  /** Current phase of the scan */
  phase: 'discovering' | 'scanning' | 'hashing' | 'complete';

  /** Number of files processed so far */
  filesProcessed: number;

  /** Total files discovered (may increase during discovery phase) */
  totalFiles: number;

  /** Current file being processed */
  currentFile?: string;

  /** Estimated percentage complete (0-100) */
  percentComplete: number;

  /** Elapsed time in milliseconds */
  elapsedMs: number;
}

/**
 * Filter function for custom file filtering
 */
export type FileFilter = (file: FileInfo) => boolean;

/**
 * Filter function for custom directory filtering
 */
export type DirectoryFilter = (dir: DirectoryInfo) => boolean;
