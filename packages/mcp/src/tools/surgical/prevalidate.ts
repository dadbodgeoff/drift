/**
 * drift_prevalidate - Validate Code Before Writing
 * 
 * Layer: Surgical
 * Token Budget: 400 target, 1000 max
 * Cache TTL: 1 minute (short - code changes frequently)
 * Invalidation Keys: patterns, category:{cat}
 * 
 * Validates proposed code BEFORE writing it to disk.
 * Solves: AI writes code, saves it, THEN finds out it violates patterns.
 */

import { createResponseBuilder, Errors, metrics } from '../../infrastructure/index.js';

import type { PatternStore, IPatternService } from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export interface PrevalidateArgs {
  /** The code to validate */
  code: string;
  /** Where it will be written */
  targetFile: string;
  /** What kind of code is this? */
  kind?: 'function' | 'class' | 'component' | 'test' | 'full-file';
}

export interface Violation {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
  line?: number;
}

export interface PrevalidateData {
  valid: boolean;
  score: number;
  violations: Violation[];
  expectedPatterns: string[];
  suggestions: string[];
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePrevalidate(
  store: PatternStore,
  args: PrevalidateArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<PrevalidateData>();
  
  // Validate input
  if (!args.code || args.code.trim() === '') {
    throw Errors.missingParameter('code');
  }
  if (!args.targetFile) {
    throw Errors.missingParameter('targetFile');
  }
  
  const code = args.code;
  const targetFile = args.targetFile;
  const kind = args.kind ?? 'function';
  
  // Initialize pattern store
  await store.initialize();
  
  // Get patterns for the target directory
  const targetDir = targetFile.substring(0, targetFile.lastIndexOf('/'));
  const relevantPatterns = findRelevantPatterns(store, targetDir, kind);
  
  // Analyze the proposed code
  const violations: Violation[] = [];
  const suggestions: string[] = [];
  
  // Check for common issues based on patterns
  analyzeCode(code, relevantPatterns, violations, suggestions);
  
  // Calculate score (100 - penalties)
  let score = 100;
  for (const v of violations) {
    if (v.severity === 'error') {score -= 20;}
    else if (v.severity === 'warning') {score -= 10;}
    else {score -= 5;}
  }
  score = Math.max(0, score);
  
  const data: PrevalidateData = {
    valid: violations.filter(v => v.severity === 'error').length === 0,
    score,
    violations,
    expectedPatterns: relevantPatterns.map(p => p.name),
    suggestions,
  };
  
  // Build summary
  let summary: string;
  if (violations.length === 0) {
    summary = `Code looks good! Score: ${score}/100. Matches expected patterns.`;
  } else {
    const errorCount = violations.filter(v => v.severity === 'error').length;
    const warningCount = violations.filter(v => v.severity === 'warning').length;
    summary = `Score: ${score}/100. Found ${errorCount} error${errorCount !== 1 ? 's' : ''}, ${warningCount} warning${warningCount !== 1 ? 's' : ''}.`;
  }
  
  // Build hints
  const hints: { nextActions: string[]; relatedTools: string[]; warnings?: string[] } = {
    nextActions: violations.length > 0
      ? ['Fix violations before writing code', 'Use drift_code_examples to see correct patterns']
      : ['Code is ready to write', 'Use drift_imports to add correct imports'],
    relatedTools: ['drift_code_examples', 'drift_imports', 'drift_similar'],
  };
  
  if (violations.some(v => v.severity === 'error')) {
    hints.warnings = ['Code has errors that should be fixed before writing'];
  }
  
  // Record metrics
  metrics.recordRequest('drift_prevalidate', Date.now() - startTime, true, false);
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}

/**
 * Handler using IPatternService (preferred)
 */
export async function handlePrevalidateWithService(
  service: IPatternService,
  args: PrevalidateArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<PrevalidateData>();
  
  // Validate input
  if (!args.code || args.code.trim() === '') {
    throw Errors.missingParameter('code');
  }
  if (!args.targetFile) {
    throw Errors.missingParameter('targetFile');
  }
  
  const code = args.code;
  const targetFile = args.targetFile;
  // kind reserved for future use
  // const kind = args.kind ?? 'function';
  
  // Get patterns - for prevalidation we use all patterns since PatternSummary
  // doesn't include location data. The validation logic checks code content.
  const patternsResult = await service.listPatterns();
  const allPatterns = patternsResult.items ?? [];
  
  // Map to pattern-like objects for analysis
  const relevantPatterns = allPatterns.map(p => ({
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
  }));
  
  // Analyze the proposed code
  const violations: Violation[] = [];
  const suggestions: string[] = [];
  
  // Check for common issues
  analyzeCodeWithPatterns(code, relevantPatterns, violations, suggestions);
  
  // Calculate score
  let score = 100;
  for (const v of violations) {
    if (v.severity === 'error') {score -= 20;}
    else if (v.severity === 'warning') {score -= 10;}
    else {score -= 5;}
  }
  score = Math.max(0, score);
  
  // Filter to patterns that might be relevant based on target file path
  const targetDir = targetFile.substring(0, targetFile.lastIndexOf('/'));
  const expectedPatterns = relevantPatterns
    .filter(p => {
      // Include patterns that match common directory conventions
      if (targetDir.includes('api') && p.category === 'api') {return true;}
      if (targetDir.includes('auth') && p.category === 'auth') {return true;}
      if (targetDir.includes('test') && p.category === 'testing') {return true;}
      if (targetDir.includes('component') && p.category === 'components') {return true;}
      return false;
    })
    .map(p => p.name);
  
  const data: PrevalidateData = {
    valid: violations.filter(v => v.severity === 'error').length === 0,
    score,
    violations,
    expectedPatterns: expectedPatterns.length > 0 ? expectedPatterns : relevantPatterns.slice(0, 5).map(p => p.name),
    suggestions,
  };
  
  // Build summary
  let summary: string;
  if (violations.length === 0) {
    summary = `Code looks good! Score: ${score}/100. Matches expected patterns.`;
  } else {
    const errorCount = violations.filter(v => v.severity === 'error').length;
    const warningCount = violations.filter(v => v.severity === 'warning').length;
    summary = `Score: ${score}/100. Found ${errorCount} error${errorCount !== 1 ? 's' : ''}, ${warningCount} warning${warningCount !== 1 ? 's' : ''}.`;
  }
  
  const hints: { nextActions: string[]; relatedTools: string[]; warnings?: string[] } = {
    nextActions: violations.length > 0
      ? ['Fix violations before writing code', 'Use drift_code_examples to see correct patterns']
      : ['Code is ready to write', 'Use drift_imports to add correct imports'],
    relatedTools: ['drift_code_examples', 'drift_imports', 'drift_similar'],
  };
  
  if (violations.some(v => v.severity === 'error')) {
    hints.warnings = ['Code has errors that should be fixed before writing'];
  }
  
  metrics.recordRequest('drift_prevalidate', Date.now() - startTime, true, false);
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}

// ============================================================================
// Helpers
// ============================================================================

interface PatternLike {
  name: string;
  category: string;
  subcategory: string;
}

/**
 * Find patterns relevant to a directory
 */
function findRelevantPatterns(
  store: PatternStore,
  targetDir: string,
  kind: string
): PatternLike[] {
  const patterns: PatternLike[] = [];
  
  // Get all patterns
  const allPatterns = store.getAll();
  
  for (const pattern of allPatterns) {
    // Check if pattern has locations in target directory
    const hasLocation = pattern.locations.some(loc => 
      loc.file.startsWith(targetDir) || loc.file.includes(targetDir)
    );
    
    if (hasLocation) {
      patterns.push({
        name: pattern.name,
        category: pattern.category,
        subcategory: pattern.subcategory,
      });
    }
  }
  
  // Also add patterns based on kind
  if (kind === 'test') {
    patterns.push({ name: 'testing-pattern', category: 'testing', subcategory: 'unit' });
  } else if (kind === 'component') {
    patterns.push({ name: 'component-pattern', category: 'components', subcategory: 'react' });
  }
  
  return patterns;
}

/**
 * Analyze code for common issues
 */
function analyzeCode(
  code: string,
  patterns: PatternLike[],
  violations: Violation[],
  suggestions: string[]
): void {
  // Check for error handling patterns
  const hasErrorPattern = patterns.some(p => 
    p.category === 'errors' || p.name.includes('error') || p.name.includes('result')
  );
  
  if (hasErrorPattern) {
    // Check if code has try/catch or Result pattern
    if (!code.includes('try') && !code.includes('catch') && 
        !code.includes('Result') && !code.includes('.ok(') && !code.includes('.err(')) {
      if (code.includes('async') || code.includes('await') || code.includes('Promise')) {
        violations.push({
          rule: 'error-handling',
          severity: 'warning',
          message: 'Async code without error handling - this codebase uses structured error handling',
          suggestion: 'Add try/catch or use Result<T> pattern',
        });
        suggestions.push('Wrap async operations in try/catch');
      }
    }
  }
  
  // Check for raw SQL (if data-access patterns exist)
  const hasDataPattern = patterns.some(p => 
    p.category === 'data-access' || p.name.includes('prisma') || p.name.includes('orm')
  );
  
  if (hasDataPattern) {
    if (code.includes('SELECT') || code.includes('INSERT') || 
        code.includes('UPDATE') || code.includes('DELETE')) {
      violations.push({
        rule: 'data-access',
        severity: 'warning',
        message: 'Raw SQL detected - this codebase uses an ORM',
        suggestion: 'Use the ORM methods instead of raw SQL',
      });
      suggestions.push('Replace raw SQL with ORM calls');
    }
  }
  
  // Check for console.log in non-test code
  if (code.includes('console.log') && !patterns.some(p => p.category === 'testing')) {
    violations.push({
      rule: 'logging',
      severity: 'info',
      message: 'console.log detected - consider using structured logging',
      suggestion: 'Use logger.info() or similar',
    });
  }
  
  // Check for any type
  if (code.includes(': any') || code.includes('<any>')) {
    violations.push({
      rule: 'typing',
      severity: 'warning',
      message: 'Using "any" type reduces type safety',
      suggestion: 'Use a specific type or "unknown"',
    });
    suggestions.push('Replace "any" with specific types');
  }
  
  // Check for hardcoded strings that look like config
  const configPatterns = /['"](?:http|https):\/\/|['"](?:localhost|127\.0\.0\.1)|['"](?:api|secret|key|token)/i;
  if (configPatterns.test(code)) {
    violations.push({
      rule: 'config',
      severity: 'warning',
      message: 'Hardcoded configuration detected',
      suggestion: 'Use environment variables or config files',
    });
    suggestions.push('Move hardcoded values to configuration');
  }
}

/**
 * Analyze code with IPatternService patterns
 */
function analyzeCodeWithPatterns(
  code: string,
  patterns: Array<{ name: string; category: string; subcategory: string }>,
  violations: Violation[],
  suggestions: string[]
): void {
  // Reuse the same analysis logic
  analyzeCode(code, patterns, violations, suggestions);
}

/**
 * Tool definition for MCP registration
 */
export const prevalidateToolDefinition = {
  name: 'drift_prevalidate',
  description: 'Validate proposed code BEFORE writing it. Returns violations, score, and suggestions. Use to catch pattern violations before they happen.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      code: {
        type: 'string',
        description: 'The code to validate',
      },
      targetFile: {
        type: 'string',
        description: 'Where the code will be written (relative path)',
      },
      kind: {
        type: 'string',
        enum: ['function', 'class', 'component', 'test', 'full-file'],
        description: 'What kind of code is this (default: function)',
      },
    },
    required: ['code', 'targetFile'],
  },
};
