/**
 * drift_recent - Show Recent Changes
 * 
 * Layer: Surgical
 * Token Budget: 400 target, 800 max
 * Cache TTL: 1 minute (changes frequently)
 * Invalidation Keys: git, decisions
 * 
 * Shows what changed recently in a specific area.
 * Solves: AI writes code using OLD patterns because it read an old file.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { createResponseBuilder, Errors, metrics } from '../../infrastructure/index.js';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface RecentArgs {
  /** Directory or file to check */
  area: string;
  /** How far back to look (default: 7) */
  days?: number;
  /** Filter by change type */
  type?: 'feat' | 'fix' | 'refactor' | 'all';
}

export interface RecentChange {
  file: string;
  type: 'added' | 'modified' | 'deleted';
  commitType: string;
  summary: string;
  date: string;
  author: string;
}

export interface RecentData {
  changes: RecentChange[];
  patternsChanged: string[];
  newConventions: string[];
  preferFiles: string[];
}

// ============================================================================
// Handler
// ============================================================================

export async function handleRecent(
  args: RecentArgs,
  projectRoot: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<RecentData>();
  
  // Validate input
  if (!args.area || args.area.trim() === '') {
    throw Errors.missingParameter('area');
  }
  
  const area = args.area.trim();
  const days = Math.min(args.days ?? 7, 30);
  const typeFilter = args.type ?? 'all';
  
  // Get git log for the area
  const since = `${days}.days.ago`;
  
  try {
    // Get commits affecting the area
    const { stdout: logOutput } = await execAsync(
      `git log --since="${since}" --pretty=format:"%H|%s|%an|%ai" --name-status -- "${area}"`,
      { cwd: projectRoot, maxBuffer: 1024 * 1024 }
    );
    
    if (!logOutput.trim()) {
      const data: RecentData = {
        changes: [],
        patternsChanged: [],
        newConventions: [],
        preferFiles: [],
      };
      
      return builder
        .withSummary(`No changes in "${area}" in the last ${days} days`)
        .withData(data)
        .withHints({
          nextActions: ['Area is stable - existing code is current', 'Use drift_similar to find examples'],
          relatedTools: ['drift_similar', 'drift_code_examples'],
        })
        .buildContent();
    }
    
    // Parse git log output
    const changes: RecentChange[] = [];
    const lines = logOutput.split('\n');
    
    let currentCommit: { hash: string; message: string; author: string; date: string } | null = null;
    
    for (const line of lines) {
      if (line.includes('|')) {
        // Commit line
        const [hash, message, author, date] = line.split('|');
        currentCommit = {
          hash: hash ?? '',
          message: message ?? '',
          author: author ?? '',
          date: date?.split(' ')[0] ?? '',
        };
      } else if (line.trim() && currentCommit) {
        // File change line (A/M/D followed by filename)
        const match = line.match(/^([AMD])\t(.+)$/);
        if (match) {
          const [, status, file] = match;
          
          // Parse conventional commit type
          const commitType = parseCommitType(currentCommit.message);
          
          // Apply type filter
          if (typeFilter !== 'all' && commitType !== typeFilter) {
            continue;
          }
          
          changes.push({
            file: file ?? '',
            type: status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified',
            commitType,
            summary: currentCommit.message.slice(0, 80),
            date: currentCommit.date,
            author: currentCommit.author,
          });
        }
      }
    }
    
    // Deduplicate by file (keep most recent)
    const byFile = new Map<string, RecentChange>();
    for (const change of changes) {
      if (!byFile.has(change.file)) {
        byFile.set(change.file, change);
      }
    }
    const uniqueChanges = Array.from(byFile.values()).slice(0, 15);
    
    // Analyze patterns changed
    const patternsChanged = analyzePatternChanges(uniqueChanges);
    
    // Detect new conventions
    const newConventions = detectNewConventions(uniqueChanges);
    
    // Files to prefer (recently modified = more current)
    const preferFiles = uniqueChanges
      .filter(c => c.type === 'modified' && c.commitType !== 'fix')
      .map(c => c.file)
      .slice(0, 5);
    
    const data: RecentData = {
      changes: uniqueChanges,
      patternsChanged,
      newConventions,
      preferFiles,
    };
    
    // Build summary
    const summary = `${uniqueChanges.length} change${uniqueChanges.length !== 1 ? 's' : ''} in "${area}" over last ${days} days. ${preferFiles.length} files recommended as current examples.`;
    
    // Build hints
    const hints: { nextActions: string[]; relatedTools: string[]; warnings?: string[] } = {
      nextActions: preferFiles.length > 0
        ? [
            `Use "${preferFiles[0]}" as a reference - it's recently updated`,
            'Check patternsChanged for any migration notes',
          ]
        : [
            'No recent modifications - existing patterns are stable',
            'Use drift_similar to find examples',
          ],
      relatedTools: ['drift_similar', 'drift_signature', 'drift_code_examples'],
    };
    
    if (patternsChanged.length > 0) {
      hints.warnings = [`Patterns changed recently: ${patternsChanged.join(', ')}`];
    }
    
    // Record metrics
    metrics.recordRequest('drift_recent', Date.now() - startTime, true, false);
    
    return builder
      .withSummary(summary)
      .withData(data)
      .withHints(hints)
      .buildContent();
      
  } catch (error) {
    // Git command failed - might not be a git repo
    throw Errors.custom(
      'GIT_ERROR',
      'Failed to read git history. Ensure this is a git repository.',
      ['drift_status']
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse conventional commit type from message
 */
function parseCommitType(message: string): string {
  const match = message.match(/^(feat|fix|refactor|chore|docs|test|style|perf|ci|build)(\(.+\))?:/i);
  if (match) {
    return match[1]!.toLowerCase();
  }
  
  // Fallback heuristics
  const lower = message.toLowerCase();
  if (lower.includes('fix') || lower.includes('bug')) {return 'fix';}
  if (lower.includes('add') || lower.includes('new') || lower.includes('implement')) {return 'feat';}
  if (lower.includes('refactor') || lower.includes('clean') || lower.includes('improve')) {return 'refactor';}
  
  return 'other';
}

/**
 * Analyze which patterns might have changed
 */
function analyzePatternChanges(changes: RecentChange[]): string[] {
  const patterns: string[] = [];
  
  for (const change of changes) {
    const msg = change.summary.toLowerCase();
    
    // Look for pattern-related keywords
    if (msg.includes('error') || msg.includes('exception')) {
      patterns.push('error-handling');
    }
    if (msg.includes('auth') || msg.includes('permission')) {
      patterns.push('auth');
    }
    if (msg.includes('api') || msg.includes('endpoint')) {
      patterns.push('api');
    }
    if (msg.includes('test')) {
      patterns.push('testing');
    }
    if (msg.includes('style') || msg.includes('css') || msg.includes('theme')) {
      patterns.push('styling');
    }
    if (msg.includes('migrat') || msg.includes('deprecat')) {
      patterns.push('migration');
    }
  }
  
  // Deduplicate
  return [...new Set(patterns)];
}

/**
 * Detect new conventions from commit messages
 */
function detectNewConventions(changes: RecentChange[]): string[] {
  const conventions: string[] = [];
  
  for (const change of changes) {
    const msg = change.summary.toLowerCase();
    
    // Look for convention-related keywords
    if (msg.includes('migrat') && msg.includes('to')) {
      conventions.push(change.summary);
    }
    if (msg.includes('switch') || msg.includes('replace')) {
      conventions.push(change.summary);
    }
    if (msg.includes('new pattern') || msg.includes('introduce')) {
      conventions.push(change.summary);
    }
  }
  
  return conventions.slice(0, 3);
}

/**
 * Tool definition for MCP registration
 */
export const recentToolDefinition = {
  name: 'drift_recent',
  description: 'Show what changed recently in a specific area. Returns recent commits, pattern changes, and files to prefer as current examples. Use to avoid writing code based on outdated patterns.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      area: {
        type: 'string',
        description: 'Directory or file to check (e.g., "src/api/", "src/services/user.ts")',
      },
      days: {
        type: 'number',
        description: 'How far back to look (default: 7, max: 30)',
      },
      type: {
        type: 'string',
        enum: ['feat', 'fix', 'refactor', 'all'],
        description: 'Filter by commit type (default: all)',
      },
    },
    required: ['area'],
  },
};
