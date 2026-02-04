/**
 * File Walker - Directory traversal with ignore pattern support
 *
 * Implements recursive directory traversal that respects .gitignore
 * and .driftignore patterns.
 *
 * @requirements 2.1, 2.8
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { minimatch } from 'minimatch';

import type {
  ScanOptions,
  ScanResult,
  FileInfo,
  DirectoryInfo,
  ScanStats,
  ScanError,
  ScanErrorType,
  ScanProgress,
  ScanProgressCallback,
} from './types.js';
import type { Language } from '../parsers/types.js';

// Import ignore using require for proper CJS interop
const require = createRequire(import.meta.url);
const ignore = require('ignore') as typeof import('ignore').default;

/**
 * Type for the Ignore instance
 */
type Ignore = ReturnType<typeof ignore>;

/**
 * Extension to language mapping
 */
const EXTENSION_LANGUAGE_MAP: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyw': 'python',
  '.cs': 'csharp',
  '.razor': 'csharp',
  '.cshtml': 'csharp',
  '.java': 'java',
  '.php': 'php',
  '.go': 'go',
  '.rs': 'rust',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c++': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  '.h++': 'cpp',
  '.h': 'cpp',
  '.c': 'cpp',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.markdown': 'markdown',
};

/**
 * Default scan options
 */
const DEFAULT_OPTIONS: Partial<ScanOptions> = {
  respectGitignore: true,
  respectDriftignore: true,
  followSymlinks: false,
  computeHashes: false,
};

/**
 * FileWalker class for recursive directory traversal
 *
 * Traverses directories respecting .gitignore and .driftignore patterns,
 * with support for symlink handling and progress callbacks.
 *
 * @requirements 2.1 - Traverse directory structures respecting .gitignore and .driftignore patterns
 * @requirements 2.8 - Files outside the workspace SHALL be ignored
 */
export class FileWalker {
  private options: ScanOptions;
  private rootDir: string;
  private ignoreInstance: Ignore;
  private visitedPaths: Set<string>;
  private files: FileInfo[];
  private directories: DirectoryInfo[];
  private errors: ScanError[];
  private stats: ScanStats;
  private progressCallback: ScanProgressCallback | undefined;
  private startTime: Date;

  constructor() {
    this.options = {} as ScanOptions;
    this.rootDir = '';
    this.ignoreInstance = ignore();
    this.visitedPaths = new Set();
    this.files = [];
    this.directories = [];
    this.errors = [];
    this.stats = this.createInitialStats();
    this.startTime = new Date();
  }

  /**
   * Main entry point for directory traversal
   *
   * @param options - Scan configuration options
   * @param progressCallback - Optional callback for progress updates
   * @returns Promise resolving to scan results
   */
  async walk(
    options: ScanOptions,
    progressCallback?: ScanProgressCallback
  ): Promise<ScanResult> {
    // Initialize state
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.rootDir = path.resolve(options.rootDir);
    this.ignoreInstance = ignore();
    this.visitedPaths = new Set();
    this.files = [];
    this.directories = [];
    this.errors = [];
    this.startTime = new Date();
    this.stats = this.createInitialStats();
    this.progressCallback = progressCallback;

    // Verify root directory exists and is accessible
    try {
      const rootStat = await fs.stat(this.rootDir);
      if (!rootStat.isDirectory()) {
        throw new Error(`Root path is not a directory: ${this.rootDir}`);
      }
      // Resolve to real path to handle symlinks (e.g., /var -> /private/var on macOS)
      this.rootDir = await fs.realpath(this.rootDir);
    } catch (error) {
      return this.createErrorResult(
        `Cannot access root directory: ${this.rootDir}`,
        error
      );
    }

    // Load ignore patterns from root directory
    await this.loadIgnorePatterns(this.rootDir);

    // Add custom ignore patterns from options
    if (this.options.ignorePatterns && this.options.ignorePatterns.length > 0) {
      this.ignoreInstance.add(this.options.ignorePatterns);
    }

    // Report discovery phase
    this.reportProgress('discovering', 0, 0);

    // Start recursive traversal
    await this.traverseDirectory(this.rootDir, 0);

    // Finalize stats
    this.stats.endTime = new Date();
    this.stats.duration = this.stats.endTime.getTime() - this.startTime.getTime();
    this.stats.totalFiles = this.files.length;
    this.stats.totalDirectories = this.directories.length;
    this.stats.errorCount = this.errors.length;

    // Report completion
    this.reportProgress('complete', this.files.length, this.files.length);

    return {
      files: this.files,
      directories: this.directories,
      stats: this.stats,
      errors: this.errors,
      rootDir: this.rootDir,
      options: this.options,
      success: this.errors.length === 0,
    };
  }

  /**
   * Load .gitignore and .driftignore patterns from a directory
   *
   * For the root directory, patterns are added globally.
   * For nested directories, patterns are prefixed with the relative path
   * so they only apply to files within that directory (proper gitignore semantics).
   *
   * @param dir - Directory to load patterns from
   * @returns Promise resolving to array of patterns
   */
  async loadIgnorePatterns(dir: string): Promise<string[]> {
    const patterns: string[] = [];
    const relativeDirPath = path.relative(this.rootDir, dir);
    const isRootDir = relativeDirPath === '';

    // Load .gitignore if enabled
    if (this.options.respectGitignore) {
      const gitignorePath = path.join(dir, '.gitignore');
      const gitignorePatterns = await this.readIgnoreFile(gitignorePath);
      patterns.push(...gitignorePatterns);
    }

    // Load .driftignore if enabled
    if (this.options.respectDriftignore) {
      const driftignorePath = path.join(dir, '.driftignore');
      const driftignorePatterns = await this.readIgnoreFile(driftignorePath);
      patterns.push(...driftignorePatterns);
    }

    // Add patterns to ignore instance
    if (patterns.length > 0) {
      if (isRootDir) {
        // Root patterns apply globally
        this.ignoreInstance.add(patterns);
      } else {
        // Nested patterns must be scoped to their directory
        // Prefix each pattern with the relative directory path
        const scopedPatterns = patterns.map(pattern => {
          // Handle negation patterns (starting with !)
          if (pattern.startsWith('!')) {
            return `!${relativeDirPath}/${pattern.slice(1)}`;
          }
          // Handle patterns that start with / (anchored to the gitignore's directory)
          if (pattern.startsWith('/')) {
            return `${relativeDirPath}${pattern}`;
          }
          // Regular patterns - scope to the directory
          return `${relativeDirPath}/${pattern}`;
        });
        this.ignoreInstance.add(scopedPatterns);
      }
    }

    return patterns;
  }

  /**
   * Read patterns from an ignore file
   *
   * @param filePath - Path to the ignore file
   * @returns Promise resolving to array of patterns
   */
  private async readIgnoreFile(filePath: string): Promise<string[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    } catch {
      // File doesn't exist or can't be read - that's fine
      return [];
    }
  }

  /**
   * Check if a path should be ignored based on patterns
   *
   * @param relativePath - Path relative to root directory
   * @param isDirectory - Whether the path is a directory
   * @returns True if the path should be ignored
   */
  shouldIgnore(relativePath: string, isDirectory: boolean = false): boolean {
    // Normalize path separators for cross-platform compatibility
    const normalizedPath = relativePath.replace(/\\/g, '/');

    // For directories, append trailing slash for proper matching
    const pathToCheck = isDirectory ? `${normalizedPath}/` : normalizedPath;

    // Check against ignore patterns
    if (this.ignoreInstance.ignores(pathToCheck)) {
      return true;
    }

    // Also check without trailing slash for directories
    if (isDirectory && this.ignoreInstance.ignores(normalizedPath)) {
      return true;
    }

    return false;
  }

  /**
   * Get file information including metadata
   *
   * @param filePath - Absolute path to the file
   * @returns Promise resolving to FileInfo
   */
  async getFileInfo(filePath: string): Promise<FileInfo> {
    const stat = await fs.lstat(filePath);
    const relativePath = path.relative(this.rootDir, filePath);
    const extension = path.extname(filePath);
    const name = path.basename(filePath);
    const language = this.detectLanguage(extension);

    const fileInfo: FileInfo = {
      path: filePath,
      relativePath,
      name,
      extension,
      size: stat.size,
      mtime: stat.mtime,
      ctime: stat.ctime,
      isSymlink: stat.isSymbolicLink(),
    };

    // Only add language if detected
    if (language !== undefined) {
      fileInfo.language = language;
    }

    // Compute hash if requested
    if (this.options.computeHashes) {
      try {
        fileInfo.hash = await this.computeFileHash(filePath);
      } catch (error) {
        this.addError(filePath, 'hash_error', error);
      }
    }

    return fileInfo;
  }

  /**
   * Detect programming language from file extension
   *
   * @param extension - File extension including the dot
   * @returns Detected language or undefined
   */
  detectLanguage(extension: string): Language | undefined {
    return EXTENSION_LANGUAGE_MAP[extension.toLowerCase()];
  }

  /**
   * Recursively traverse a directory
   *
   * @param dirPath - Absolute path to the directory
   * @param depth - Current depth from root
   */
  private async traverseDirectory(dirPath: string, depth: number): Promise<void> {
    // Check max depth
    if (this.options.maxDepth !== undefined && depth > this.options.maxDepth) {
      return;
    }

    // Get real path to handle symlinks and detect loops
    let realPath: string;
    try {
      realPath = await fs.realpath(dirPath);
    } catch (error) {
      this.addError(dirPath, 'read_error', error);
      return;
    }

    // Check for symlink loops
    if (this.visitedPaths.has(realPath)) {
      this.addError(dirPath, 'symlink_loop', new Error('Circular symlink detected'));
      return;
    }
    this.visitedPaths.add(realPath);

    // Check if path is outside workspace (requirement 2.8)
    if (!this.isWithinWorkspace(realPath)) {
      return;
    }

    // Read directory entries
    let entries: string[];
    try {
      entries = await fs.readdir(dirPath);
    } catch (error) {
      this.addError(dirPath, 'permission_denied', error);
      return;
    }

    // Load ignore patterns from this directory (for nested .gitignore/.driftignore)
    await this.loadIgnorePatterns(dirPath);

    // Track directory info
    const relativePath = path.relative(this.rootDir, dirPath);
    let fileCount = 0;
    let subdirectoryCount = 0;

    // Process entries
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry);
      const entryRelativePath = path.relative(this.rootDir, entryPath);

      // Get entry stats
      let entryStat;
      try {
        entryStat = await fs.lstat(entryPath);
      } catch (error) {
        this.addError(entryPath, 'read_error', error);
        continue;
      }

      const isSymlink = entryStat.isSymbolicLink();

      // Handle symlinks
      if (isSymlink) {
        if (!this.options.followSymlinks) {
          // Skip symlinks if not following them
          continue;
        }

        // Get the target stats
        try {
          entryStat = await fs.stat(entryPath);
        } catch (error) {
          this.addError(entryPath, 'read_error', error);
          continue;
        }
      }

      // Check if should be ignored
      if (this.shouldIgnore(entryRelativePath, entryStat.isDirectory())) {
        this.stats.skippedByIgnore++;
        continue;
      }

      if (entryStat.isDirectory()) {
        subdirectoryCount++;
        // Recurse into subdirectory
        await this.traverseDirectory(entryPath, depth + 1);
      } else if (entryStat.isFile()) {
        // Check file filters
        if (!this.shouldIncludeFile(entryPath, entryStat)) {
          continue;
        }

        fileCount++;

        // Get file info
        try {
          const fileInfo = await this.getFileInfo(entryPath);
          this.files.push(fileInfo);

          // Update stats
          this.stats.totalSize += fileInfo.size;
          if (fileInfo.extension) {
            this.stats.filesByExtension[fileInfo.extension] =
              (this.stats.filesByExtension[fileInfo.extension] || 0) + 1;
          }
          if (fileInfo.language) {
            this.stats.filesByLanguage[fileInfo.language] =
              (this.stats.filesByLanguage[fileInfo.language] || 0) + 1;
          }

          // Report progress
          this.reportProgress('scanning', this.files.length, this.files.length);
        } catch (error) {
          this.addError(entryPath, 'read_error', error);
        }
      }
    }

    // Add directory info
    const dirStat = await fs.lstat(dirPath);
    this.directories.push({
      path: dirPath,
      relativePath: relativePath || '.',
      name: path.basename(dirPath),
      fileCount,
      subdirectoryCount,
      depth,
      isSymlink: dirStat.isSymbolicLink(),
    });

    // Update max depth
    if (depth > this.stats.maxDepthReached) {
      this.stats.maxDepthReached = depth;
    }
  }

  /**
   * Check if a file should be included based on filters
   *
   * @param filePath - Absolute path to the file
   * @param stat - File stats
   * @returns True if the file should be included
   */
  private shouldIncludeFile(filePath: string, stat: { size: number }): boolean {
    const extension = path.extname(filePath);
    const relativePath = path.relative(this.rootDir, filePath);

    // Check extension filter
    if (this.options.extensions && this.options.extensions.length > 0) {
      if (!this.options.extensions.includes(extension)) {
        return false;
      }
    }

    // Check size limit
    if (this.options.maxFileSize !== undefined && stat.size > this.options.maxFileSize) {
      this.stats.skippedBySize++;
      return false;
    }

    // Check include patterns
    if (this.options.includePatterns && this.options.includePatterns.length > 0) {
      const matches = this.options.includePatterns.some((pattern) =>
        minimatch(relativePath, pattern, { dot: true })
      );
      if (!matches) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a path is within the workspace root
   *
   * @requirements 2.8 - Files outside the workspace SHALL be ignored
   * @param realPath - Real (resolved) path to check
   * @returns True if the path is within the workspace
   */
  private isWithinWorkspace(realPath: string): boolean {
    const normalizedRoot = path.normalize(this.rootDir);
    const normalizedPath = path.normalize(realPath);

    // Check if the path starts with the root directory
    return normalizedPath.startsWith(normalizedRoot);
  }

  /**
   * Compute SHA-256 hash of a file
   *
   * @param filePath - Path to the file
   * @returns Promise resolving to hex-encoded hash
   */
  private async computeFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Add an error to the error list
   *
   * @param filePath - Path that caused the error
   * @param type - Type of error
   * @param error - The error object
   */
  private addError(filePath: string, type: ScanErrorType, error: unknown): void {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const code = (error as NodeJS.ErrnoException)?.code;

    const scanError: ScanError = {
      path: filePath,
      message: errorObj.message,
      type,
    };

    if (code !== undefined) {
      scanError.code = code;
    }

    if (errorObj.stack !== undefined) {
      scanError.stack = errorObj.stack;
    }

    this.errors.push(scanError);
  }

  /**
   * Create initial stats object
   */
  private createInitialStats(): ScanStats {
    return {
      totalFiles: 0,
      totalDirectories: 0,
      totalSize: 0,
      duration: 0,
      skippedByIgnore: 0,
      skippedBySize: 0,
      errorCount: 0,
      filesByExtension: {},
      filesByLanguage: {},
      maxDepthReached: 0,
      startTime: new Date(),
      endTime: new Date(),
    };
  }

  /**
   * Create an error result for early failures
   */
  private createErrorResult(message: string, error: unknown): ScanResult {
    const errorObj = error instanceof Error ? error : new Error(String(error));

    const scanError: ScanError = {
      path: this.rootDir,
      message,
      type: 'read_error',
    };

    if (errorObj.stack !== undefined) {
      scanError.stack = errorObj.stack;
    }

    return {
      files: [],
      directories: [],
      stats: {
        ...this.createInitialStats(),
        errorCount: 1,
        endTime: new Date(),
        duration: Date.now() - this.startTime.getTime(),
      },
      errors: [scanError],
      rootDir: this.rootDir,
      options: this.options,
      success: false,
    };
  }

  /**
   * Report progress to the callback
   */
  private reportProgress(
    phase: ScanProgress['phase'],
    filesProcessed: number,
    totalFiles: number
  ): void {
    if (!this.progressCallback) {
      return;
    }

    const elapsedMs = Date.now() - this.startTime.getTime();
    const percentComplete =
      totalFiles > 0 ? Math.round((filesProcessed / totalFiles) * 100) : 0;

    const progress: ScanProgress = {
      phase,
      filesProcessed,
      totalFiles,
      percentComplete,
      elapsedMs,
    };

    const currentFile = this.files[this.files.length - 1]?.relativePath;
    if (currentFile !== undefined) {
      progress.currentFile = currentFile;
    }

    this.progressCallback(progress);
  }
}
