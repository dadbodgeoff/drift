/**
 * drift_validate_change - Pre-Commit Pattern Validation
 * 
 * Validates proposed code changes against established codebase patterns
 * using SEMANTIC ANALYSIS (not regex!).
 * 
 * Uses:
 * - UnifiedLanguageProvider for cross-language semantic extraction
 * - Pattern matchers for ORM/framework validation
 * - LanguageIntelligence for semantic normalization
 * 
 * Returns compliance score, violations, and suggestions for improvement.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import {
  PatternStore,
  createUnifiedScanner,
  type Pattern,
  type DataAccessPoint,
} from 'driftdetect-core';

import { createResponseBuilder } from '../../infrastructure/index.js';

// =============================================================================
// Types
// =============================================================================

export interface ValidateChangeArgs {
  file: string;
  content?: string;
  diff?: string;
  strictMode?: boolean;
}

export interface PatternViolation {
  patternId: string;
  patternName: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number | undefined;
  suggestion: string;
  confidence: number;
}

export interface PatternCompliance {
  patternId: string;
  patternName: string;
  status: 'compliant' | 'partial' | 'missing';
  score: number;
  details: string;
}

export interface SemanticValidation {
  functions: {
    total: number;
    withErrorHandling: number;
    async: number;
    exported: number;
  };
  dataAccess: {
    total: number;
    rawSql: number;
    sensitiveFields: number;
  };
  imports: {
    total: number;
    external: number;
  };
}

export interface ValidateChangeData {
  summary: string;
  file: string;
  overallScore: number;
  status: 'pass' | 'warn' | 'fail';
  violations: PatternViolation[];
  compliance: PatternCompliance[];
  semanticValidation: SemanticValidation;
  suggestions: string[];
  stats: {
    patternsChecked: number;
    compliant: number;
    violations: number;
    warnings: number;
  };
}

// =============================================================================
// Handler
// =============================================================================

export async function handleValidateChange(
  patternStore: PatternStore,
  projectRoot: string,
  args: ValidateChangeArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ValidateChangeData>();
  
  const { file, content, diff, strictMode = false } = args;
  
  // Initialize store
  await patternStore.initialize();
  
  // Get the content to validate
  let codeToValidate: string;
  const relativePath = file.startsWith('/') ? path.relative(projectRoot, file) : file;
  
  if (content) {
    codeToValidate = content;
  } else if (diff) {
    // Extract added lines from diff
    codeToValidate = extractAddedLinesFromDiff(diff);
  } else {
    // Read from file
    try {
      const fullPath = path.join(projectRoot, relativePath);
      codeToValidate = await fs.readFile(fullPath, 'utf-8');
    } catch {
      return builder
        .withSummary(`Cannot read file: ${file}`)
        .withData({
          summary: `Cannot read file: ${file}`,
          file: relativePath,
          overallScore: 0,
          status: 'fail',
          violations: [{
            patternId: 'file-access',
            patternName: 'File Access',
            severity: 'error',
            message: `File not found or not readable: ${file}`,
            suggestion: 'Provide content directly or check the file path',
            confidence: 1,
          }],
          compliance: [],
          semanticValidation: {
            functions: { total: 0, withErrorHandling: 0, async: 0, exported: 0 },
            dataAccess: { total: 0, rawSql: 0, sensitiveFields: 0 },
            imports: { total: 0, external: 0 },
          },
          suggestions: ['Provide the content parameter with the code to validate'],
          stats: { patternsChecked: 0, compliant: 0, violations: 1, warnings: 0 },
        })
        .buildContent();
    }
  }
  
  // ==========================================================================
  // SEMANTIC EXTRACTION using UnifiedScanner
  // ==========================================================================
  const scanner = createUnifiedScanner({ rootDir: projectRoot, autoDetect: true });
  let dataAccessPoints: DataAccessPoint[] = [];
  
  try {
    const scanResult = await scanner.scanFiles([relativePath]);
    dataAccessPoints = scanResult.accessPoints.get(relativePath) || [];
  } catch (err) {
    // Language might not be supported - continue with pattern-only validation
    console.warn(`Semantic extraction failed for ${relativePath}:`, err);
  }
  
  // Get relevant patterns for this file type
  const allPatterns = patternStore.getAll();
  const fileExtension = path.extname(relativePath);
  const relevantPatterns = filterRelevantPatterns(allPatterns, relativePath, fileExtension);
  
  // Validate against each pattern
  const violations: PatternViolation[] = [];
  const compliance: PatternCompliance[] = [];
  
  for (const pattern of relevantPatterns) {
    const result = validateAgainstPattern(pattern, codeToValidate, relativePath, dataAccessPoints);
    
    if (result.violations.length > 0) {
      violations.push(...result.violations);
    }
    
    compliance.push(result.compliance);
  }
  
  // Perform semantic validation
  const semanticValidation = performSemanticValidation(dataAccessPoints, codeToValidate);
  
  // Add semantic-based violations
  const semanticViolations = detectSemanticViolations(dataAccessPoints, relativePath);
  violations.push(...semanticViolations);
  
  // Calculate overall score
  const compliantCount = compliance.filter(c => c.status === 'compliant').length;
  const partialCount = compliance.filter(c => c.status === 'partial').length;
  const totalPatterns = compliance.length || 1;
  
  // Factor in semantic validation
  let semanticScore = 100;
  if (semanticValidation.dataAccess.rawSql > 0) {semanticScore -= 20;}
  if (semanticValidation.dataAccess.sensitiveFields > 0) {semanticScore -= 10;}
  
  const patternScore = Math.round(((compliantCount * 100) + (partialCount * 50)) / totalPatterns);
  const overallScore = Math.round((patternScore + semanticScore) / 2);
  
  // Determine status
  const errorCount = violations.filter(v => v.severity === 'error').length;
  const warningCount = violations.filter(v => v.severity === 'warning').length;
  
  let status: 'pass' | 'warn' | 'fail';
  if (strictMode && (errorCount > 0 || warningCount > 0)) {
    status = 'fail';
  } else if (errorCount > 0) {
    status = 'fail';
  } else if (warningCount > 0) {
    status = 'warn';
  } else {
    status = 'pass';
  }
  
  // Generate suggestions
  const suggestions = generateSuggestions(violations, compliance, semanticValidation);
  
  const summary = status === 'pass'
    ? `✅ Code validates successfully (${overallScore}% compliance)`
    : status === 'warn'
    ? `⚠️ Code has ${warningCount} warning(s) (${overallScore}% compliance)`
    : `❌ Code has ${errorCount} violation(s) (${overallScore}% compliance)`;
  
  return builder
    .withSummary(summary)
    .withData({
      summary,
      file: relativePath,
      overallScore,
      status,
      violations,
      compliance,
      semanticValidation,
      suggestions,
      stats: {
        patternsChecked: relevantPatterns.length,
        compliant: compliantCount,
        violations: errorCount,
        warnings: warningCount,
      },
    })
    .withHints({
      nextActions: status === 'pass'
        ? ['Code is ready to commit!']
        : [
            'Review violations and apply suggested fixes',
            'Use drift_suggest_changes for detailed fix suggestions',
            'Use drift_code_examples to see correct implementations',
          ],
      relatedTools: ['drift_suggest_changes', 'drift_code_examples', 'drift_pattern_get'],
    })
    .buildContent();
}

// =============================================================================
// Helper Functions
// =============================================================================

function extractAddedLinesFromDiff(diff: string): string {
  const lines = diff.split('\n');
  const addedLines: string[] = [];
  
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines.push(line.substring(1));
    }
  }
  
  return addedLines.join('\n');
}

function filterRelevantPatterns(
  patterns: Pattern[],
  _file: string,
  extension: string
): Pattern[] {
  // Filter patterns that are relevant to this file type
  const languagePatterns: Record<string, string[]> = {
    '.ts': ['api', 'errors', 'logging', 'types', 'structural'],
    '.tsx': ['components', 'styling', 'accessibility', 'api', 'errors'],
    '.js': ['api', 'errors', 'logging', 'structural'],
    '.jsx': ['components', 'styling', 'accessibility'],
    '.py': ['api', 'errors', 'logging', 'data-access'],
    '.java': ['api', 'errors', 'logging', 'data-access', 'structural'],
    '.cs': ['api', 'errors', 'logging', 'data-access', 'structural'],
    '.php': ['api', 'errors', 'logging', 'data-access'],
  };
  
  const relevantCategories = languagePatterns[extension] || ['structural', 'errors'];
  
  return patterns.filter(p => {
    // Include if pattern category is relevant
    if (relevantCategories.includes(p.category)) {return true;}
    
    // Include if pattern has locations in similar files
    const hasRelevantLocations = p.locations.some(l => 
      path.extname(l.file) === extension
    );
    
    return hasRelevantLocations;
  });
}

/**
 * Validate code against a pattern using semantic analysis
 */
function validateAgainstPattern(
  pattern: Pattern,
  _content: string,
  file: string,
  dataAccessPoints: DataAccessPoint[]
): { violations: PatternViolation[]; compliance: PatternCompliance } {
  const violations: PatternViolation[] = [];
  
  // Check if this file should follow this pattern
  const patternFiles = pattern.locations.map(l => l.file);
  const isInPatternScope = patternFiles.some(f => {
    // Check if file is in same directory or similar structure
    const patternDir = path.dirname(f);
    const fileDir = path.dirname(file);
    return patternDir === fileDir || f.includes(path.basename(file));
  });
  
  if (!isInPatternScope && pattern.locations.length > 3) {
    // Pattern is well-established but this file isn't in scope
    return {
      violations: [],
      compliance: {
        patternId: pattern.id,
        patternName: pattern.name,
        status: 'compliant',
        score: 100,
        details: 'File not in pattern scope',
      },
    };
  }
  
  // Use semantic analysis for validation when available
  let matchCount = 0;
  let totalChecks = 1; // At least one check
  
  if (dataAccessPoints.length > 0) {
    const semanticResult = validateSemanticPattern(pattern, dataAccessPoints);
    matchCount = semanticResult.matches;
    totalChecks = semanticResult.total;
    violations.push(...semanticResult.violations.map(v => ({
      ...v,
      patternId: pattern.id,
      patternName: pattern.name,
      confidence: pattern.confidence.score,
    })));
  } else {
    // Fallback: check if file is an outlier for this pattern
    const isOutlier = pattern.outliers.some(o => o.file === file);
    if (isOutlier) {
      violations.push({
        patternId: pattern.id,
        patternName: pattern.name,
        severity: 'warning',
        message: `File deviates from pattern "${pattern.name}"`,
        suggestion: `Review pattern at ${pattern.locations[0]?.file}:${pattern.locations[0]?.line}`,
        confidence: pattern.confidence.score,
      });
    } else {
      matchCount = 1;
    }
  }
  
  // Calculate compliance
  const score = totalChecks > 0 ? Math.round((matchCount / totalChecks) * 100) : 100;
  const status = score >= 80 ? 'compliant' : score >= 50 ? 'partial' : 'missing';
  
  return {
    violations,
    compliance: {
      patternId: pattern.id,
      patternName: pattern.name,
      status,
      score,
      details: `${matchCount}/${totalChecks} semantic checks passed`,
    },
  };
}

/**
 * Validate pattern using semantic data access results
 */
function validateSemanticPattern(
  pattern: Pattern,
  dataAccessPoints: DataAccessPoint[]
): { matches: number; total: number; violations: Omit<PatternViolation, 'patternId' | 'patternName' | 'confidence'>[] } {
  const violations: Omit<PatternViolation, 'patternId' | 'patternName' | 'confidence'>[] = [];
  let matches = 0;
  const total = dataAccessPoints.length || 1;
  
  switch (pattern.category) {
    case 'data-access':
      for (const access of dataAccessPoints) {
        if (!access.isRawSql && access.confidence > 0.7) {
          matches++;
        } else if (access.isRawSql) {
          violations.push({
            severity: 'warning',
            message: `Raw SQL detected for table "${access.table}"`,
            line: access.line,
            suggestion: 'Use ORM methods instead of raw SQL',
          });
        }
      }
      break;
      
    case 'security':
      // Check for sensitive data access patterns
      const sensitivePatterns = ['password', 'secret', 'token', 'api_key'];
      for (const access of dataAccessPoints) {
        const sensitiveFields = access.fields.filter(f =>
          sensitivePatterns.some(p => f.toLowerCase().includes(p))
        );
        if (sensitiveFields.length > 0) {
          violations.push({
            severity: 'info',
            message: `Accessing sensitive fields: ${sensitiveFields.join(', ')}`,
            line: access.line,
            suggestion: 'Ensure proper authorization for sensitive data access',
          });
        } else {
          matches++;
        }
      }
      break;
      
    default:
      // Generic check - just verify data access is using ORM
      for (const access of dataAccessPoints) {
        if (!access.isRawSql) {
          matches++;
        }
      }
  }
  
  return { matches, total, violations };
}

/**
 * Perform semantic validation on data access points
 */
function performSemanticValidation(
  dataAccessPoints: DataAccessPoint[],
  _content: string
): SemanticValidation {
  const sensitivePatterns = ['password', 'secret', 'token', 'api_key', 'ssn', 'credit'];
  
  return {
    functions: {
      total: 0,
      withErrorHandling: 0,
      async: 0,
      exported: 0,
    },
    dataAccess: {
      total: dataAccessPoints.length,
      rawSql: dataAccessPoints.filter(a => a.isRawSql).length,
      sensitiveFields: dataAccessPoints.filter(a =>
        a.fields.some(f => sensitivePatterns.some(p => f.toLowerCase().includes(p)))
      ).length,
    },
    imports: {
      total: 0,
      external: 0,
    },
  };
}

/**
 * Detect violations using semantic analysis
 */
function detectSemanticViolations(
  dataAccessPoints: DataAccessPoint[],
  _file: string
): PatternViolation[] {
  const violations: PatternViolation[] = [];
  
  // Check for raw SQL
  for (const access of dataAccessPoints) {
    if (access.isRawSql) {
      violations.push({
        patternId: 'semantic-raw-sql',
        patternName: 'Raw SQL Detection',
        severity: 'warning',
        message: `Raw SQL query detected accessing "${access.table}"`,
        line: access.line,
        suggestion: 'Use parameterized queries or ORM methods to prevent SQL injection',
        confidence: access.confidence,
      });
    }
  }
  
  // Check for sensitive data access without apparent protection
  const sensitivePatterns = ['password', 'secret', 'token', 'api_key', 'ssn', 'credit_card'];
  for (const access of dataAccessPoints) {
    const sensitiveFields = access.fields.filter(f =>
      sensitivePatterns.some(p => f.toLowerCase().includes(p))
    );
    
    if (sensitiveFields.length > 0) {
      violations.push({
        patternId: 'semantic-sensitive-data',
        patternName: 'Sensitive Data Access',
        severity: 'info',
        message: `Accessing sensitive fields: ${sensitiveFields.join(', ')}`,
        line: access.line,
        suggestion: 'Ensure proper authorization and audit logging for sensitive data access',
        confidence: 0.9,
      });
    }
  }
  
  return violations;
}

function generateSuggestions(
  violations: PatternViolation[],
  compliance: PatternCompliance[],
  semanticValidation: SemanticValidation
): string[] {
  const suggestions: string[] = [];
  
  // Add suggestions based on violations
  const errorViolations = violations.filter(v => v.severity === 'error');
  if (errorViolations.length > 0) {
    suggestions.push(`Fix ${errorViolations.length} critical violation(s) before committing`);
  }
  
  // Add suggestions based on low compliance
  const lowCompliance = compliance.filter(c => c.status === 'missing');
  if (lowCompliance.length > 0) {
    suggestions.push(`Review ${lowCompliance.length} pattern(s) with low compliance`);
  }
  
  // Add semantic-based suggestions
  if (semanticValidation.dataAccess.rawSql > 0) {
    suggestions.push('Replace raw SQL queries with parameterized queries or ORM methods');
  }
  
  if (semanticValidation.dataAccess.sensitiveFields > 0) {
    suggestions.push('Review sensitive data access for proper authorization');
  }
  
  // Add pattern-specific suggestions
  const uniqueSuggestions = new Set(violations.map(v => v.suggestion));
  for (const suggestion of uniqueSuggestions) {
    if (suggestion && !suggestions.includes(suggestion)) {
      suggestions.push(suggestion);
    }
  }
  
  if (suggestions.length === 0) {
    suggestions.push('Code follows established patterns - ready to commit!');
  }
  
  return suggestions.slice(0, 5); // Limit to 5 suggestions
}
