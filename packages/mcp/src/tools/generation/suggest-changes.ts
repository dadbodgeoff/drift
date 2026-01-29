/**
 * drift_suggest_changes - AI-Guided Refactoring Suggestions
 * 
 * Analyzes code issues using LEARNED DATA from Drift's semantic analysis
 * and provides specific, actionable suggestions for fixing pattern violations,
 * security issues, or quality problems.
 * 
 * Uses:
 * - PatternStore: Patterns learned through semantic clustering
 * - BoundaryStore: Data access points learned from scanning
 * - ErrorHandlingAnalyzer: Error handling gaps
 * - CallGraphAnalyzer: Security and reachability analysis
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import {
  PatternStore,
  BoundaryStore,
  createCallGraphAnalyzer,
  createErrorHandlingAnalyzer,
  type Pattern,
  type ErrorHandlingGap,
  type DataAccessPoint,
} from 'driftdetect-core';

import { createResponseBuilder } from '../../infrastructure/index.js';

// =============================================================================
// Types
// =============================================================================

export type IssueType = 
  | 'outlier'
  | 'security'
  | 'coupling'
  | 'error-handling'
  | 'test-coverage'
  | 'pattern-violation';

export interface SuggestChangesArgs {
  target: string;
  issue?: IssueType;
  patternId?: string;
  maxSuggestions?: number;
}

export interface CodeSuggestion {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: IssueType;
  location: {
    file: string;
    startLine: number;
    endLine: number;
  };
  before: string;
  after: string;
  rationale: string;
  relatedPattern?: {
    id: string;
    name: string;
    confidence: number;
  };
  effort: 'trivial' | 'small' | 'medium' | 'large';
  impact: string;
}

export interface SuggestChangesData {
  summary: string;
  target: string;
  issueType: IssueType | 'all';
  suggestions: CodeSuggestion[];
  stats: {
    totalIssues: number;
    bySeverity: Record<string, number>;
    estimatedEffort: string;
  };
}

// =============================================================================
// Handler
// =============================================================================

export async function handleSuggestChanges(
  stores: {
    pattern: PatternStore;
    boundary: BoundaryStore;
  },
  projectRoot: string,
  args: SuggestChangesArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<SuggestChangesData>();
  
  const { target, issue, patternId, maxSuggestions = 5 } = args;
  
  // Initialize stores
  await stores.pattern.initialize();
  
  // Resolve target file
  const targetPath = path.isAbsolute(target) 
    ? target 
    : path.join(projectRoot, target);
  
  let fileContent: string;
  try {
    fileContent = await fs.readFile(targetPath, 'utf-8');
  } catch {
    return builder
      .withSummary(`File not found: ${target}`)
      .withData({
        summary: `File not found: ${target}`,
        target,
        issueType: issue || 'all',
        suggestions: [],
        stats: { totalIssues: 0, bySeverity: {}, estimatedEffort: 'none' },
      })
      .withHints({
        nextActions: ['Check the file path and try again'],
        warnings: [`Could not read file: ${target}`],
      })
      .buildContent();
  }
  
  const suggestions: CodeSuggestion[] = [];
  const relativePath = path.relative(projectRoot, targetPath);
  
  // Get all patterns to find outliers in this file
  const allPatterns = stores.pattern.getAll();
  const filePatterns = allPatterns.filter(p => 
    p.locations.some(l => l.file === relativePath) ||
    p.outliers.some(o => o.file === relativePath)
  );
  
  // ==========================================================================
  // Use LEARNED data from BoundaryStore instead of re-extracting
  // ==========================================================================
  await stores.boundary.initialize();
  const fileAccessInfo = stores.boundary.getFileAccess(relativePath);
  let dataAccessPoints: DataAccessPoint[] = [];
  
  // Get data access points that Drift has already learned for this file
  if (fileAccessInfo.length > 0 && fileAccessInfo[0]) {
    dataAccessPoints = fileAccessInfo[0].accessPoints;
  }
  
  // Analyze based on issue type
  if (!issue || issue === 'outlier' || issue === 'pattern-violation') {
    const outlierSuggestions = analyzeOutliers(
      filePatterns,
      relativePath,
      fileContent,
      patternId
    );
    suggestions.push(...outlierSuggestions);
  }
  
  if (!issue || issue === 'security') {
    const securitySuggestions = await analyzeSecurityIssues(
      stores.boundary,
      relativePath,
      fileContent,
      dataAccessPoints,
      projectRoot
    );
    suggestions.push(...securitySuggestions);
  }
  
  if (!issue || issue === 'error-handling') {
    const errorSuggestions = await analyzeErrorHandlingGaps(
      relativePath,
      projectRoot
    );
    suggestions.push(...errorSuggestions);
  }
  
  // Sort by priority and limit
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  const limitedSuggestions = suggestions.slice(0, maxSuggestions);
  
  // Calculate stats
  const bySeverity: Record<string, number> = {};
  for (const s of suggestions) {
    bySeverity[s.priority] = (bySeverity[s.priority] || 0) + 1;
  }
  
  const effortMap = { trivial: 1, small: 2, medium: 4, large: 8 };
  const totalEffort = limitedSuggestions.reduce((sum, s) => sum + effortMap[s.effort], 0);
  const estimatedEffort = totalEffort <= 2 ? 'minimal' : totalEffort <= 6 ? 'moderate' : 'significant';
  
  const summary = suggestions.length === 0
    ? `No issues found in ${relativePath}`
    : `Found ${suggestions.length} issue(s) in ${relativePath}. ${limitedSuggestions.length} suggestion(s) provided.`;
  
  return builder
    .withSummary(summary)
    .withData({
      summary,
      target: relativePath,
      issueType: issue || 'all',
      suggestions: limitedSuggestions,
      stats: {
        totalIssues: suggestions.length,
        bySeverity,
        estimatedEffort,
      },
    })
    .withHints({
      nextActions: limitedSuggestions.length > 0
        ? [
            'Review suggestions and apply changes',
            'Use drift_validate_change to verify fixes',
          ]
        : ['File looks good! Consider running drift_test_topology to check test coverage'],
      relatedTools: ['drift_validate_change', 'drift_code_examples', 'drift_impact_analysis'],
    })
    .buildContent();
}

// =============================================================================
// Analysis Functions - Using SEMANTIC Analysis
// =============================================================================

function analyzeOutliers(
  patterns: Pattern[],
  file: string,
  content: string,
  specificPatternId?: string
): CodeSuggestion[] {
  const suggestions: CodeSuggestion[] = [];
  const lines = content.split('\n');
  
  for (const pattern of patterns) {
    // Skip if looking for specific pattern and this isn't it
    if (specificPatternId && pattern.id !== specificPatternId) {continue;}
    
    // Find outliers in this file
    const fileOutliers = pattern.outliers.filter(o => o.file === file);
    
    for (const outlier of fileOutliers) {
      // Get the outlier code context
      const startLine = Math.max(0, outlier.line - 1);
      const endLine = Math.min(lines.length, outlier.line + 5);
      const outlierCode = lines.slice(startLine, endLine).join('\n');
      
      // Find a good example from the pattern
      const goodExample = pattern.locations[0];
      let exampleCode = '// Follow the established pattern';
      
      if (goodExample) {
        exampleCode = `// See ${goodExample.file}:${goodExample.line} for the correct pattern`;
      }
      
      suggestions.push({
        id: `outlier-${pattern.id}-${outlier.line}`,
        title: `Pattern violation: ${pattern.name}`,
        description: `This code deviates from the established "${pattern.name}" pattern used ${pattern.locations.length} times in the codebase.`,
        priority: pattern.confidence.score > 0.8 ? 'high' : 'medium',
        category: 'outlier',
        location: {
          file,
          startLine: outlier.line,
          endLine: outlier.line + 5,
        },
        before: outlierCode,
        after: exampleCode,
        rationale: `The "${pattern.name}" pattern has ${pattern.locations.length} consistent implementations with ${Math.round(pattern.confidence.score * 100)}% confidence. This outlier should be refactored to match.`,
        relatedPattern: {
          id: pattern.id,
          name: pattern.name,
          confidence: pattern.confidence.score,
        },
        effort: 'small',
        impact: `Improves consistency and maintainability`,
      });
    }
  }
  
  return suggestions;
}

/**
 * Analyze security issues using LEARNED data access from BoundaryStore
 */
async function analyzeSecurityIssues(
  _boundaryStore: BoundaryStore,
  file: string,
  content: string,
  dataAccessPoints: DataAccessPoint[],
  projectRoot: string
): Promise<CodeSuggestion[]> {
  const suggestions: CodeSuggestion[] = [];
  const lines = content.split('\n');
  
  // Use LEARNED data access points from BoundaryStore
  if (dataAccessPoints.length > 0) {
    for (const access of dataAccessPoints) {
      // Check for sensitive data access patterns
      const sensitivePatterns = ['password', 'secret', 'token', 'api_key', 'apikey', 'ssn', 'credit_card'];
      const sensitiveFields = access.fields.filter(f => 
        sensitivePatterns.some(p => f.toLowerCase().includes(p))
      );
      
      if (sensitiveFields.length > 0) {
        suggestions.push({
          id: `security-sensitive-data-${access.line}`,
          title: `Sensitive data access: ${sensitiveFields.join(', ')}`,
          description: `This code accesses sensitive fields (${sensitiveFields.join(', ')}) from table "${access.table}". Ensure proper authorization and audit logging.`,
          priority: 'high',
          category: 'security',
          location: {
            file,
            startLine: access.line,
            endLine: access.line,
          },
          before: access.context,
          after: `// Ensure authorization check before accessing: ${sensitiveFields.join(', ')}\n// Add audit logging for sensitive data access`,
          rationale: 'Sensitive data access should be protected by authorization checks and logged for audit purposes.',
          effort: 'medium',
          impact: 'Prevents unauthorized access to sensitive data',
        });
      }
      
      // Check for raw SQL (potential injection)
      if (access.isRawSql) {
        suggestions.push({
          id: `security-raw-sql-${access.line}`,
          title: 'Raw SQL detected - potential injection risk',
          description: `Raw SQL query detected at line ${access.line}. Consider using parameterized queries or ORM methods.`,
          priority: 'critical',
          category: 'security',
          location: {
            file,
            startLine: access.line,
            endLine: access.line,
          },
          before: access.context,
          after: `// Use parameterized queries:\n// db.query('SELECT * FROM ${access.table} WHERE id = ?', [id])`,
          rationale: 'Raw SQL queries are vulnerable to SQL injection attacks. Use parameterized queries or ORM methods.',
          effort: 'small',
          impact: 'Prevents SQL injection vulnerabilities',
        });
      }
    }
  }
  
  // Use call graph for reachability-based security analysis
  try {
    const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir: projectRoot });
    await callGraphAnalyzer.initialize();
    const graph = callGraphAnalyzer.getGraph();
    
    if (graph) {
      // Find functions in this file that can reach sensitive data
      const fileFunctions = callGraphAnalyzer.getFunctionsInFile(file);
      
      for (const func of fileFunctions) {
        // Skip module-level pseudo-functions
        if (func.name === '__module__') {continue;}
        
        const reachable = callGraphAnalyzer.getReachableDataFromFunction(
          `${file}:${func.name}`,
          { sensitiveOnly: true, maxDepth: 5 }
        );
        
        if (reachable.sensitiveFields.length > 0) {
          const sensitiveFieldNames = reachable.sensitiveFields
            .map(sf => `${sf.field.table}.${sf.field.field}`)
            .slice(0, 3);
          
          // Check if function has proper authorization
          const hasAuthCheck = func.calls.some(c => {
            const calleeId = c.calleeId || '';
            return calleeId.toLowerCase().includes('auth') ||
              calleeId.toLowerCase().includes('permission') ||
              calleeId.toLowerCase().includes('authorize');
          });
          
          if (!hasAuthCheck && reachable.sensitiveFields.length > 0) {
            suggestions.push({
              id: `security-unprotected-sensitive-${func.startLine}`,
              title: `Function "${func.name}" accesses sensitive data without auth check`,
              description: `This function can reach sensitive fields (${sensitiveFieldNames.join(', ')}) but has no visible authorization check.`,
              priority: 'high',
              category: 'security',
              location: {
                file,
                startLine: func.startLine,
                endLine: func.endLine,
              },
              before: lines.slice(func.startLine - 1, func.startLine + 2).join('\n'),
              after: `// Add authorization check:\n// if (!await authorize(user, 'read:sensitive')) throw new UnauthorizedError();`,
              rationale: 'Functions that access sensitive data should verify authorization before proceeding.',
              effort: 'medium',
              impact: 'Ensures proper access control for sensitive data',
            });
          }
        }
      }
    }
  } catch {
    // Call graph not available - skip reachability analysis
  }
  
  return suggestions;
}

/**
 * Analyze error handling gaps using ErrorHandlingAnalyzer
 */
async function analyzeErrorHandlingGaps(
  file: string,
  projectRoot: string
): Promise<CodeSuggestion[]> {
  const suggestions: CodeSuggestion[] = [];
  
  try {
    // Initialize call graph (required for error handling analysis)
    const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir: projectRoot });
    await callGraphAnalyzer.initialize();
    const callGraph = callGraphAnalyzer.getGraph();
    
    if (!callGraph) {
      return suggestions; // No call graph available
    }
    
    // Create error handling analyzer
    const errorAnalyzer = createErrorHandlingAnalyzer({ rootDir: projectRoot });
    errorAnalyzer.setCallGraph(callGraph);
    errorAnalyzer.build();
    
    // Get gaps for this specific file
    const gaps = errorAnalyzer.getGaps({
      files: [file],
      minSeverity: 'medium',
      limit: 10,
      includeSuggestions: true,
    });
    
    for (const gap of gaps) {
      suggestions.push(convertGapToSuggestion(gap, file));
    }
  } catch {
    // Error handling analysis not available
  }
  
  return suggestions;
}

/**
 * Convert an ErrorHandlingGap to a CodeSuggestion
 */
function convertGapToSuggestion(gap: ErrorHandlingGap, file: string): CodeSuggestion {
  const priorityMap: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
  };
  
  const effortMap: Record<string, 'trivial' | 'small' | 'medium' | 'large'> = {
    'no-try-catch': 'small',
    'swallowed-error': 'trivial',
    'unhandled-async': 'small',
    'bare-catch': 'trivial',
  };
  
  const afterCodeMap: Record<string, string> = {
    'no-try-catch': `try {\n  // existing code\n} catch (error) {\n  logger.error('Operation failed', { error });\n  throw error;\n}`,
    'swallowed-error': `catch (error) {\n  logger.error('Error occurred', { error });\n  // Handle or rethrow\n  throw error;\n}`,
    'unhandled-async': `try {\n  await asyncOperation();\n} catch (error) {\n  logger.error('Async operation failed', { error });\n  throw error;\n}`,
    'bare-catch': `catch (error) {\n  if (error instanceof ValidationError) {\n    // Handle validation error\n  } else {\n    throw error;\n  }\n}`,
  };
  
  return {
    id: `error-${gap.gapType}-${gap.line}`,
    title: `Error handling gap: ${gap.gapType.replace(/-/g, ' ')}`,
    description: gap.description,
    priority: priorityMap[gap.severity] || 'medium',
    category: 'error-handling',
    location: {
      file,
      startLine: gap.line,
      endLine: gap.line + 3,
    },
    before: `// ${gap.name} at line ${gap.line}`,
    after: afterCodeMap[gap.gapType] || gap.suggestion,
    rationale: gap.suggestion || 'Proper error handling improves reliability and debuggability.',
    effort: effortMap[gap.gapType] || 'small',
    impact: 'Improves error visibility and application reliability',
  };
}
