/**
 * Git Walker
 *
 * Traverses git history and extracts commit information.
 * Uses simple-git for git operations.
 */

import * as path from 'node:path';

import type {
  GitCommit,
  GitFileChange,
  DecisionLanguage,
} from '../types.js';
import type {
  GitWalkerOptions,
  GitWalkResult,
  FileClassification,
} from './types.js';

// ============================================================================
// Language Detection
// ============================================================================

const LANGUAGE_EXTENSIONS: Record<string, DecisionLanguage> = {
  // TypeScript
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  // JavaScript
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  // Python
  '.py': 'python',
  '.pyw': 'python',
  '.pyi': 'python',
  // Java
  '.java': 'java',
  // C#
  '.cs': 'csharp',
  // PHP
  '.php': 'php',
  '.phtml': 'php',
};

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.py$/,
  /test_.*\.py$/,
  /Test\.java$/,
  /Tests\.java$/,
  /Test\.cs$/,
  /Tests\.cs$/,
  /Test\.php$/,
  /Tests\.php$/,
  /__tests__\//,
  /\/tests?\//i,
  /\/spec\//i,
];

const CONFIG_PATTERNS = [
  /\.config\.[jt]s$/,
  /\.config\.json$/,
  /\.json$/,
  /\.ya?ml$/,
  /\.toml$/,
  /\.ini$/,
  /\.env/,
  /Dockerfile/,
  /docker-compose/,
  /\.gitignore$/,
  /\.eslintrc/,
  /\.prettierrc/,
  /tsconfig/,
  /package\.json$/,
  /requirements\.txt$/,
  /pyproject\.toml$/,
  /pom\.xml$/,
  /build\.gradle/,
  /\.csproj$/,
  /composer\.json$/,
];

const DOCS_PATTERNS = [
  /\.md$/,
  /\.mdx$/,
  /\.rst$/,
  /\.txt$/,
  /README/i,
  /CHANGELOG/i,
  /LICENSE/i,
  /CONTRIBUTING/i,
  /\/docs?\//i,
];

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string): DecisionLanguage | 'other' | 'config' | 'docs' {
  const ext = path.extname(filePath).toLowerCase();
  
  // Check for known language extensions
  const lang = LANGUAGE_EXTENSIONS[ext];
  if (lang) {
    return lang;
  }

  // Check for config files
  if (CONFIG_PATTERNS.some(p => p.test(filePath))) {
    return 'config';
  }

  // Check for docs
  if (DOCS_PATTERNS.some(p => p.test(filePath))) {
    return 'docs';
  }

  return 'other';
}

/**
 * Classify a file
 */
export function classifyFile(filePath: string): FileClassification {
  const language = detectLanguage(filePath);
  const isSource = language !== 'other' && language !== 'config' && language !== 'docs';
  const isTest = TEST_PATTERNS.some(p => p.test(filePath));
  const isConfig = CONFIG_PATTERNS.some(p => p.test(filePath));
  const isDocs = DOCS_PATTERNS.some(p => p.test(filePath));
  
  // Check for dependency manifests
  const manifestTypes: Record<string, 'npm' | 'pip' | 'maven' | 'gradle' | 'nuget' | 'composer'> = {
    'package.json': 'npm',
    'requirements.txt': 'pip',
    'pyproject.toml': 'pip',
    'Pipfile': 'pip',
    'pom.xml': 'maven',
    'build.gradle': 'gradle',
    'build.gradle.kts': 'gradle',
    'composer.json': 'composer',
  };

  const fileName = path.basename(filePath);
  const isDependencyManifest = fileName in manifestTypes || filePath.endsWith('.csproj');
  const manifestType = manifestTypes[fileName] || (filePath.endsWith('.csproj') ? 'nuget' : undefined);

  const result: FileClassification = {
    isSource,
    isTest,
    isConfig,
    isDocs,
    isBuild: /\/(build|dist|out|target|bin|obj)\//i.test(filePath),
    isDependencyManifest,
  };
  
  if (manifestType) {
    result.manifestType = manifestType;
  }
  
  return result;
}

// ============================================================================
// Git Walker Class
// ============================================================================

/**
 * Git history walker
 */
export class GitWalker {
  private options: GitWalkerOptions;

  constructor(options: GitWalkerOptions) {
    this.options = {
      maxCommits: 1000,
      includeMergeCommits: false,
      followRenames: true,
      includeDiffs: true,
      ...options,
    };
  }

  /**
   * Walk git history and retrieve commits
   */
  async walk(): Promise<GitWalkResult> {
    const startTime = Date.now();
    
    // Dynamic import of simple-git to avoid issues if not installed
    const { simpleGit } = await import('simple-git');
    const git = simpleGit(this.options.rootDir);

    // Build log options
    const logOptions: string[] = [
      '--format=%H|%h|%s|%b|%an|%ae|%aI|%P',
      '--name-status',
      '--numstat',
    ];

    if (this.options.since) {
      logOptions.push(`--since=${this.options.since.toISOString()}`);
    }

    if (this.options.until) {
      logOptions.push(`--until=${this.options.until.toISOString()}`);
    }

    if (this.options.maxCommits) {
      logOptions.push(`-n ${this.options.maxCommits}`);
    }

    if (!this.options.includeMergeCommits) {
      logOptions.push('--no-merges');
    }

    if (this.options.followRenames) {
      logOptions.push('-M');
    }

    // Get branches
    const branchResult = await git.branch();
    const branches = this.options.branches || [branchResult.current];

    // Get commits
    const commits: GitCommit[] = [];
    
    try {
      // Use raw log for more control
      const rawLog = await git.raw(['log', ...logOptions, ...branches]);
      const parsedCommits = this.parseRawLog(rawLog);
      
      // Filter by paths if specified
      const filteredCommits = this.filterByPaths(parsedCommits);
      
      commits.push(...filteredCommits);
    } catch (error) {
      // Fallback to simpler log if raw fails
      console.warn('Raw log failed, using simple log:', error);
      
      // Build log options for simple-git
      const logOpts: { maxCount?: number } = {};
      if (this.options.maxCommits) {
        logOpts.maxCount = this.options.maxCommits;
      }
      
      const log = await git.log(logOpts);

      for (const entry of log.all) {
        commits.push(this.convertLogEntry(entry as any));
      }
    }

    // Calculate date range
    const dates = commits.map(c => c.date.getTime());
    const dateRange = {
      earliest: new Date(Math.min(...dates)),
      latest: new Date(Math.max(...dates)),
    };

    return {
      commits,
      totalCommits: commits.length,
      hasMore: commits.length >= (this.options.maxCommits || 1000),
      branches,
      dateRange,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Get a single commit by SHA
   */
  async getCommit(sha: string): Promise<GitCommit | null> {
    const { simpleGit } = await import('simple-git');
    const git = simpleGit(this.options.rootDir);

    try {
      const show = await git.show([sha, '--format=%H|%h|%s|%b|%an|%ae|%aI|%P', '--name-status', '--numstat']);
      const commits = this.parseRawLog(show);
      return commits[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Get file content at a specific commit
   */
  async getFileAtCommit(sha: string, filePath: string): Promise<string | null> {
    const { simpleGit } = await import('simple-git');
    const git = simpleGit(this.options.rootDir);

    try {
      return await git.show([`${sha}:${filePath}`]);
    } catch {
      return null;
    }
  }

  /**
   * Get diff between two commits
   */
  async getDiff(fromSha: string, toSha: string): Promise<string> {
    const { simpleGit } = await import('simple-git');
    const git = simpleGit(this.options.rootDir);

    return git.diff([fromSha, toSha]);
  }

  /**
   * Parse raw git log output
   */
  private parseRawLog(rawLog: string): GitCommit[] {
    const commits: GitCommit[] = [];
    const lines = rawLog.split('\n');
    
    let currentCommit: Partial<GitCommit> | null = null;
    let currentFiles: GitFileChange[] = [];
    let inBody = false;
    let bodyLines: string[] = [];

    for (const line of lines) {
      // Check for commit header line (format: SHA|shortSHA|subject|body|author|email|date|parents)
      if (line.includes('|') && line.match(/^[a-f0-9]{40}\|/)) {
        // Save previous commit
        if (currentCommit?.sha) {
          currentCommit.files = currentFiles;
          currentCommit.body = bodyLines.join('\n').trim();
          commits.push(currentCommit as GitCommit);
        }

        // Parse new commit
        const parts = line.split('|');
        const [sha, shortSha, subject, body, authorName, authorEmail, dateStr, parentsStr] = parts;
        
        if (!sha || !shortSha) {
          continue;
        }
        
        currentCommit = {
          sha,
          shortSha,
          subject: subject || '',
          body: body || '',
          authorName: authorName || '',
          authorEmail: authorEmail || '',
          date: new Date(dateStr || Date.now()),
          parents: parentsStr ? parentsStr.split(' ').filter(Boolean) : [],
          isMerge: (parentsStr?.split(' ').filter(Boolean).length || 0) > 1,
          files: [],
        };
        currentFiles = [];
        bodyLines = body ? [body] : [];
        inBody = true;
        continue;
      }

      // Parse file changes (name-status format: M\tfile.ts)
      const statusMatch = line.match(/^([AMDRC])\d*\t(.+?)(?:\t(.+))?$/);
      if (statusMatch && currentCommit) {
        const status = statusMatch[1];
        const filePath = statusMatch[2];
        const newPath = statusMatch[3];
        
        if (!status || !filePath) {continue;}
        
        const effectivePath = newPath || filePath;
        const classification = classifyFile(effectivePath);
        
        const fileChange: GitFileChange = {
          path: effectivePath,
          status: this.mapStatus(status),
          additions: 0,
          deletions: 0,
          language: detectLanguage(effectivePath),
          isTest: classification.isTest,
          isConfig: classification.isConfig,
        };
        
        if (status === 'R' && filePath) {
          fileChange.previousPath = filePath;
        }
        
        currentFiles.push(fileChange);
        continue;
      }

      // Parse numstat (additions\tdeletions\tfile)
      const numstatMatch = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (numstatMatch && currentCommit) {
        const additions = numstatMatch[1];
        const deletions = numstatMatch[2];
        const filePath = numstatMatch[3];
        
        if (!additions || !deletions || !filePath) {continue;}
        
        const file = currentFiles.find(f => f.path === filePath || f.previousPath === filePath);
        if (file) {
          file.additions = additions === '-' ? 0 : parseInt(additions, 10);
          file.deletions = deletions === '-' ? 0 : parseInt(deletions, 10);
        }
        continue;
      }

      // Accumulate body lines
      if (inBody && line && !line.startsWith('diff ')) {
        bodyLines.push(line);
      }
    }

    // Don't forget the last commit
    if (currentCommit?.sha) {
      currentCommit.files = currentFiles;
      currentCommit.body = bodyLines.join('\n').trim();
      commits.push(currentCommit as GitCommit);
    }

    return commits;
  }

  /**
   * Map git status letter to our status type
   */
  private mapStatus(status: string): GitFileChange['status'] {
    switch (status) {
      case 'A': return 'added';
      case 'M': return 'modified';
      case 'D': return 'deleted';
      case 'R': return 'renamed';
      case 'C': return 'copied';
      default: return 'modified';
    }
  }

  /**
   * Convert simple-git log entry to our format
   */
  private convertLogEntry(entry: {
    hash: string;
    message: string;
    body: string;
    author_name: string;
    author_email: string;
    date: string;
    refs: string;
    diff?: { files: Array<{ file: string; changes: number; insertions: number; deletions: number }> };
  }): GitCommit {
    return {
      sha: entry.hash,
      shortSha: entry.hash.substring(0, 7),
      subject: entry.message,
      body: entry.body || '',
      authorName: entry.author_name,
      authorEmail: entry.author_email,
      date: new Date(entry.date),
      parents: [],
      isMerge: false,
      files: (entry.diff?.files || []).map(f => {
        const classification = classifyFile(f.file);
        return {
          path: f.file,
          status: 'modified' as const,
          additions: f.insertions || 0,
          deletions: f.deletions || 0,
          language: detectLanguage(f.file),
          isTest: classification.isTest,
          isConfig: classification.isConfig,
        };
      }),
    };
  }

  /**
   * Filter commits by include/exclude paths
   */
  private filterByPaths(commits: GitCommit[]): GitCommit[] {
    if (!this.options.includePaths?.length && !this.options.excludePaths?.length) {
      return commits;
    }

    return commits.filter(commit => {
      // Check if any file matches include patterns
      if (this.options.includePaths?.length) {
        const hasIncluded = commit.files.some(f =>
          this.options.includePaths!.some(pattern =>
            this.matchGlob(f.path, pattern)
          )
        );
        if (!hasIncluded) {return false;}
      }

      // Check if all files are excluded
      if (this.options.excludePaths?.length) {
        const allExcluded = commit.files.every(f =>
          this.options.excludePaths!.some(pattern =>
            this.matchGlob(f.path, pattern)
          )
        );
        if (allExcluded) {return false;}
      }

      return true;
    });
  }

  /**
   * Simple glob matching
   */
  private matchGlob(filePath: string, pattern: string): boolean {
    // Convert glob to regex
    const regex = new RegExp(
      '^' +
      pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.') +
      '$'
    );
    return regex.test(filePath);
  }
}

/**
 * Create a git walker instance
 */
export function createGitWalker(options: GitWalkerOptions): GitWalker {
  return new GitWalker(options);
}
