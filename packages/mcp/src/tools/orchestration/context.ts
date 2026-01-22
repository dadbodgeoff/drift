/**
 * drift_context - Intent-Aware Context Orchestration
 * 
 * The "final boss" tool. Instead of making the AI figure out which tools to call
 * and how to synthesize the results, this tool understands the AI's intent and
 * returns a curated context package with everything needed for the task.
 * 
 * This is the recommended starting point for any code generation task.
 * 
 * Supports multi-project workflows via the optional `project` parameter.
 */

import {
  PatternStore,
  ManifestStore,
  BoundaryStore,
  CallGraphStore,
  DNAStore,
  type Pattern,
  type PatternCategory,
} from 'driftdetect-core';
import { createResponseBuilder, resolveProject, formatProjectContext } from '../../infrastructure/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

export type TaskIntent = 
  | 'add_feature'
  | 'fix_bug' 
  | 'refactor'
  | 'security_audit'
  | 'understand_code'
  | 'add_test';

export interface RelevantPattern {
  id: string;
  name: string;
  category: string;
  why: string;
  example: string;
  confidence: number;
  locationCount: number;
}

export interface SuggestedFile {
  file: string;
  reason: string;
  patterns: string[];
  risk: 'low' | 'medium' | 'high';
}

export interface Guidance {
  keyInsights: string[];
  commonMistakes: string[];
  decisionPoints: string[];
}

export interface Warning {
  type: 'security' | 'breaking_change' | 'deprecated' | 'complexity' | 'data_access';
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface Confidence {
  patternCoverage: number;
  dataFreshness: string;
  limitations: string[];
}

export interface DeeperDive {
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

export interface ContextPackage {
  summary: string;
  relevantPatterns: RelevantPattern[];
  suggestedFiles: SuggestedFile[];
  guidance: Guidance;
  warnings: Warning[];
  confidence: Confidence;
  deeperDive: DeeperDive[];
  /** Project context when targeting a specific project */
  projectContext?: Record<string, unknown>;
}

// =============================================================================
// Intent Strategies
// =============================================================================

interface IntentStrategy {
  categories: PatternCategory[];
  prioritizePatterns: (patterns: Pattern[], focus: string) => Pattern[];
  generateGuidance: (patterns: Pattern[], focus: string) => Guidance;
  getWarningTypes: () => Warning['type'][];
}

const INTENT_STRATEGIES: Record<TaskIntent, IntentStrategy> = {
  add_feature: {
    categories: ['api', 'components', 'structural', 'errors', 'logging', 'types'],
    prioritizePatterns: (patterns, focus) => {
      const focusLower = focus.toLowerCase();
      return patterns
        .filter(p => 
          p.name.toLowerCase().includes(focusLower) ||
          p.description.toLowerCase().includes(focusLower) ||
          p.locations.some(l => l.file.toLowerCase().includes(focusLower))
        )
        .sort((a, b) => b.confidence.score - a.confidence.score);
    },
    generateGuidance: (patterns) => ({
      keyInsights: [
        patterns.some(p => p.category === 'api') 
          ? 'This codebase has established API patterns - follow them for consistency'
          : 'No strong API patterns detected - you have flexibility in approach',
        patterns.some(p => p.category === 'errors')
          ? 'Error handling patterns exist - use the established error types'
          : 'Consider adding error handling following common practices',
      ],
      commonMistakes: [
        'Don\'t create new patterns when existing ones apply',
        'Remember to add appropriate logging',
        'Include error handling from the start',
      ],
      decisionPoints: [
        'Decide if this feature needs its own module or fits in existing structure',
        'Consider if new types/interfaces are needed',
      ],
    }),
    getWarningTypes: () => ['breaking_change', 'complexity'],
  },

  fix_bug: {
    categories: ['errors', 'logging', 'data-access', 'api', 'testing'],
    prioritizePatterns: (patterns, focus) => {
      const focusLower = focus.toLowerCase();
      // For bugs, prioritize error handling and the specific area
      return patterns
        .filter(p => 
          p.category === 'errors' ||
          p.name.toLowerCase().includes(focusLower) ||
          p.locations.some(l => l.file.toLowerCase().includes(focusLower))
        )
        .sort((a, b) => {
          if (a.category === 'errors' && b.category !== 'errors') return -1;
          if (b.category === 'errors' && a.category !== 'errors') return 1;
          return b.confidence.score - a.confidence.score;
        });
    },
    generateGuidance: (patterns) => ({
      keyInsights: [
        'Understand the error handling flow before making changes',
        'Check if similar bugs exist elsewhere (pattern outliers)',
        patterns.some(p => p.category === 'logging')
          ? 'Add logging to help debug if the fix doesn\'t work'
          : 'Consider adding logging for future debugging',
      ],
      commonMistakes: [
        'Don\'t just fix the symptom - understand the root cause',
        'Avoid changing unrelated code in the same commit',
        'Don\'t remove error handling to "fix" the bug',
      ],
      decisionPoints: [
        `Is this a one-off bug or a pattern that might exist elsewhere?`,
        'Should this fix include a regression test?',
      ],
    }),
    getWarningTypes: () => ['breaking_change', 'data_access'],
  },

  refactor: {
    categories: ['structural', 'components', 'types', 'api', 'styling'],
    prioritizePatterns: (patterns, focus) => {
      const focusLower = focus.toLowerCase();
      return patterns
        .filter(p => 
          p.locations.some(l => l.file.toLowerCase().includes(focusLower)) ||
          p.name.toLowerCase().includes(focusLower)
        )
        .sort((a, b) => b.locations.length - a.locations.length); // Most used patterns first
    },
    generateGuidance: (patterns) => ({
      keyInsights: [
        'Identify the dominant patterns before changing anything',
        'Refactoring should move toward patterns, not away from them',
        patterns.filter(p => p.outliers.length > 0).length > 0
          ? 'There are outliers that might be good refactoring targets'
          : 'Patterns are consistent - be careful not to introduce outliers',
      ],
      commonMistakes: [
        'Don\'t refactor and add features in the same change',
        'Avoid changing public APIs without updating all callers',
        'Don\'t "improve" working code without clear benefit',
      ],
      decisionPoints: [
        'Is this refactor worth the risk of introducing bugs?',
        'Should you refactor incrementally or all at once?',
        'Are there tests covering the code you\'re changing?',
      ],
    }),
    getWarningTypes: () => ['breaking_change', 'complexity'],
  },

  security_audit: {
    categories: ['security', 'auth', 'data-access', 'api'],
    prioritizePatterns: (patterns, _focus) => {
      // Security audit prioritizes security-related patterns
      return patterns
        .filter(p => 
          ['security', 'auth', 'data-access'].includes(p.category) ||
          p.name.toLowerCase().includes('auth') ||
          p.name.toLowerCase().includes('permission') ||
          p.name.toLowerCase().includes('access')
        )
        .sort((a, b) => {
          const securityOrder = ['security', 'auth', 'data-access', 'api'];
          return securityOrder.indexOf(a.category) - securityOrder.indexOf(b.category);
        });
    },
    generateGuidance: () => ({
      keyInsights: [
        'Focus on data access patterns - who can access what?',
        'Check authentication flows for consistency',
        'Look for authorization checks at entry points',
      ],
      commonMistakes: [
        'Don\'t assume authentication implies authorization',
        'Don\'t trust client-side validation alone',
        'Don\'t log sensitive data',
      ],
      decisionPoints: [
        'Are there data access paths that bypass authorization?',
        'Is sensitive data properly encrypted at rest and in transit?',
        'Are there any hardcoded credentials or secrets?',
      ],
    }),
    getWarningTypes: () => ['security', 'data_access'],
  },

  understand_code: {
    categories: ['structural', 'api', 'components', 'data-access', 'types'],
    prioritizePatterns: (patterns, focus) => {
      const focusLower = focus.toLowerCase();
      return patterns
        .filter(p => 
          p.locations.some(l => l.file.toLowerCase().includes(focusLower)) ||
          p.name.toLowerCase().includes(focusLower) ||
          p.description.toLowerCase().includes(focusLower)
        )
        .sort((a, b) => b.locations.length - a.locations.length);
    },
    generateGuidance: (patterns) => ({
      keyInsights: [
        `This area uses ${patterns.length} distinct patterns`,
        patterns.length > 0 
          ? `The dominant pattern is "${patterns[0]?.name}" with ${patterns[0]?.locations.length} occurrences`
          : 'No strong patterns detected in this area',
      ],
      commonMistakes: [
        'Don\'t assume you understand the code from names alone',
        'Check for edge cases in pattern outliers',
      ],
      decisionPoints: [
        'Do you need to understand the full call graph?',
        'Are there related patterns in other categories?',
      ],
    }),
    getWarningTypes: () => ['complexity'],
  },

  add_test: {
    categories: ['testing', 'errors', 'api', 'data-access'],
    prioritizePatterns: (patterns, focus) => {
      const focusLower = focus.toLowerCase();
      // Prioritize testing patterns, then the area being tested
      return patterns
        .filter(p => 
          p.category === 'testing' ||
          p.locations.some(l => l.file.toLowerCase().includes(focusLower))
        )
        .sort((a, b) => {
          if (a.category === 'testing' && b.category !== 'testing') return -1;
          if (b.category === 'testing' && a.category !== 'testing') return 1;
          return b.confidence.score - a.confidence.score;
        });
    },
    generateGuidance: (patterns) => ({
      keyInsights: [
        patterns.some(p => p.category === 'testing')
          ? 'Follow the existing test patterns for consistency'
          : 'No strong testing patterns - establish good practices',
        'Focus on behavior, not implementation details',
      ],
      commonMistakes: [
        'Don\'t test implementation details that might change',
        'Don\'t forget edge cases and error paths',
        'Don\'t mock everything - some integration is good',
      ],
      decisionPoints: [
        'Unit test, integration test, or both?',
        'What edge cases need coverage?',
        'Should you test the happy path or error paths first?',
      ],
    }),
    getWarningTypes: () => ['complexity'],
  },
};

// =============================================================================
// Main Handler
// =============================================================================

export async function handleContext(
  stores: {
    pattern: PatternStore;
    manifest: ManifestStore;
    boundary: BoundaryStore;
    callGraph: CallGraphStore;
    dna: DNAStore;
  },
  projectRoot: string,
  args: {
    intent: TaskIntent;
    focus: string;
    question?: string;
    /** Optional: Target a specific registered project by name */
    project?: string;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ContextPackage>();
  
  const { intent, focus, question, project: projectName } = args;
  const strategy = INTENT_STRATEGIES[intent];
  
  // Resolve project - allows targeting different registered projects
  const resolution = await resolveProject(projectName, projectRoot);
  const effectiveRoot = resolution.projectRoot;
  
  // Create stores for the resolved project (may be different from default)
  const effectiveStores = resolution.fromRegistry
    ? {
        pattern: new PatternStore({ rootDir: effectiveRoot }),
        manifest: new ManifestStore(effectiveRoot),
        boundary: new BoundaryStore({ rootDir: effectiveRoot }),
        callGraph: new CallGraphStore({ rootDir: effectiveRoot }),
        dna: new DNAStore({ rootDir: effectiveRoot }),
      }
    : stores;
  
  // Initialize stores
  await effectiveStores.pattern.initialize();
  await effectiveStores.manifest.load();
  
  // Get all patterns
  const allPatterns = effectiveStores.pattern.getAll();
  
  // Filter to relevant categories and prioritize
  const categoryPatterns = allPatterns.filter(p => 
    strategy.categories.includes(p.category as PatternCategory)
  );
  const prioritizedPatterns = strategy.prioritizePatterns(categoryPatterns, focus);
  
  // Get top patterns with examples
  const relevantPatterns = await getRelevantPatterns(
    prioritizedPatterns.slice(0, 5),
    effectiveRoot,
    focus
  );
  
  // Find suggested files
  const suggestedFiles = await getSuggestedFiles(
    effectiveStores.manifest,
    effectiveStores.boundary,
    prioritizedPatterns,
    focus,
    intent
  );
  
  // Generate guidance
  const guidance = strategy.generateGuidance(prioritizedPatterns, focus);
  
  // Add question-specific insight if provided
  if (question) {
    guidance.keyInsights.unshift(`Regarding "${question}": Check the patterns below for established approaches.`);
  }
  
  // Generate warnings
  const warnings = await generateWarnings(
    effectiveStores.boundary,
    effectiveRoot,
    suggestedFiles,
    strategy.getWarningTypes()
  );
  
  // Calculate confidence
  const confidence = calculateConfidence(effectiveStores.pattern, prioritizedPatterns, focus);
  
  // Generate deeper dive suggestions
  const deeperDive = generateDeeperDive(intent, focus, relevantPatterns, suggestedFiles);
  
  // Build summary
  let summary = buildSummary(intent, focus, relevantPatterns, suggestedFiles, warnings);
  
  // Add project context to summary if using a different project
  if (resolution.fromRegistry && resolution.project) {
    summary = `[Project: ${resolution.project.name}] ${summary}`;
  }
  
  const contextPackage: ContextPackage = {
    summary,
    relevantPatterns,
    suggestedFiles,
    guidance,
    warnings,
    confidence,
    deeperDive,
  };
  
  // Add project context to response
  const projectContext = formatProjectContext(resolution);
  
  return builder
    .withSummary(summary)
    .withData({ ...contextPackage, projectContext })
    .withHints({
      nextActions: deeperDive.slice(0, 2).map(d => `${d.tool}: ${d.reason}`),
      relatedTools: ['drift_code_examples', 'drift_impact_analysis', 'drift_reachability'],
    })
    .buildContent();
}

// =============================================================================
// Helper Functions
// =============================================================================

async function getRelevantPatterns(
  patterns: Pattern[],
  projectRoot: string,
  focus: string
): Promise<RelevantPattern[]> {
  const results: RelevantPattern[] = [];
  
  for (const pattern of patterns) {
    // Find best example location (prefer files matching focus)
    const focusLower = focus.toLowerCase();
    const sortedLocations = [...pattern.locations].sort((a, b) => {
      const aMatches = a.file.toLowerCase().includes(focusLower) ? 1 : 0;
      const bMatches = b.file.toLowerCase().includes(focusLower) ? 1 : 0;
      return bMatches - aMatches;
    });
    
    const bestLocation = sortedLocations[0];
    let example = '';
    
    if (bestLocation) {
      try {
        const filePath = path.join(projectRoot, bestLocation.file);
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const start = Math.max(0, bestLocation.line - 3);
        const end = Math.min(lines.length, bestLocation.line + 7);
        example = lines.slice(start, end).join('\n');
      } catch {
        example = `// See ${bestLocation.file}:${bestLocation.line}`;
      }
    }
    
    results.push({
      id: pattern.id,
      name: pattern.name,
      category: pattern.category,
      why: generatePatternWhy(pattern, focus),
      example,
      confidence: Math.round(pattern.confidence.score * 100) / 100,
      locationCount: pattern.locations.length,
    });
  }
  
  return results;
}

function generatePatternWhy(pattern: Pattern, focus: string): string {
  const focusLower = focus.toLowerCase();
  
  if (pattern.name.toLowerCase().includes(focusLower)) {
    return `Directly related to "${focus}" - this is the established pattern`;
  }
  
  if (pattern.locations.some(l => l.file.toLowerCase().includes(focusLower))) {
    return `Used in files matching "${focus}" - follow this for consistency`;
  }
  
  if (pattern.category === 'errors') {
    return 'Error handling pattern - use this for consistent error management';
  }
  
  if (pattern.category === 'auth') {
    return 'Authentication pattern - critical for security consistency';
  }
  
  return `${pattern.category} pattern with ${pattern.locations.length} occurrences - established convention`;
}

async function getSuggestedFiles(
  _manifestStore: ManifestStore,
  _boundaryStore: BoundaryStore,
  patterns: Pattern[],
  focus: string,
  intent: TaskIntent
): Promise<SuggestedFile[]> {
  const focusLower = focus.toLowerCase();
  const fileScores = new Map<string, { score: number; patterns: string[]; reasons: string[] }>();
  
  // Score files based on pattern matches
  for (const pattern of patterns) {
    for (const location of pattern.locations) {
      const file = location.file;
      const existing = fileScores.get(file) || { score: 0, patterns: [], reasons: [] };
      
      // Higher score for focus matches
      const focusMatch = file.toLowerCase().includes(focusLower);
      existing.score += focusMatch ? 10 : 1;
      
      if (!existing.patterns.includes(pattern.name)) {
        existing.patterns.push(pattern.name);
      }
      
      if (focusMatch && !existing.reasons.includes('Matches focus area')) {
        existing.reasons.push('Matches focus area');
      }
      
      fileScores.set(file, existing);
    }
  }
  
  // Sort by score and take top files
  const sortedFiles = Array.from(fileScores.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 5);
  
  // Determine risk based on intent and patterns
  const results: SuggestedFile[] = sortedFiles.map(([file, data]) => {
    let risk: 'low' | 'medium' | 'high' = 'low';
    
    // Higher risk for security-related intents
    if (intent === 'security_audit' && data.patterns.some(p => 
      p.toLowerCase().includes('auth') || p.toLowerCase().includes('security')
    )) {
      risk = 'high';
    }
    
    // Higher risk for files with many patterns (more complex)
    if (data.patterns.length > 3) {
      risk = risk === 'low' ? 'medium' : 'high';
    }
    
    return {
      file,
      reason: data.reasons[0] || `Contains ${data.patterns.length} relevant pattern(s)`,
      patterns: data.patterns.slice(0, 3),
      risk,
    };
  });
  
  return results;
}

async function generateWarnings(
  boundaryStore: BoundaryStore,
  _projectRoot: string,
  suggestedFiles: SuggestedFile[],
  warningTypes: Warning['type'][]
): Promise<Warning[]> {
  const warnings: Warning[] = [];
  
  // Check for security warnings
  if (warningTypes.includes('security') || warningTypes.includes('data_access')) {
    try {
      await boundaryStore.initialize();
      const accessMap = boundaryStore.getAccessMap();
      
      if (accessMap) {
        // Check if suggested files access sensitive data
        for (const file of suggestedFiles) {
          const fileAccess = accessMap.accessPoints[file.file];
          if (fileAccess) {
            const sensitiveFields = accessMap.sensitiveFields.filter(sf =>
              sf.file === file.file
            );
            
            if (sensitiveFields.length > 0) {
              warnings.push({
                type: 'data_access',
                message: `${file.file} accesses sensitive data: ${sensitiveFields.map(sf => `${sf.table}.${sf.field}`).join(', ')}`,
                severity: 'warning',
              });
            }
          }
        }
      }
    } catch {
      // Boundary store not available
    }
  }
  
  // Check for complexity warnings
  if (warningTypes.includes('complexity')) {
    const complexFiles = suggestedFiles.filter(f => f.patterns.length > 3);
    if (complexFiles.length > 0) {
      warnings.push({
        type: 'complexity',
        message: `${complexFiles.length} file(s) have high pattern density - changes may have wide impact`,
        severity: 'info',
      });
    }
  }
  
  // Check for breaking change potential
  if (warningTypes.includes('breaking_change')) {
    const highRiskFiles = suggestedFiles.filter(f => f.risk === 'high');
    if (highRiskFiles.length > 0) {
      warnings.push({
        type: 'breaking_change',
        message: `${highRiskFiles.length} file(s) are high-risk - consider impact analysis before changes`,
        severity: 'warning',
      });
    }
  }
  
  return warnings;
}

function calculateConfidence(
  patternStore: PatternStore,
  relevantPatterns: Pattern[],
  focus: string
): Confidence {
  const stats = patternStore.getStats();
  const focusLower = focus.toLowerCase();
  
  // Calculate how well we understand this area
  const focusPatterns = relevantPatterns.filter(p =>
    p.name.toLowerCase().includes(focusLower) ||
    p.locations.some(l => l.file.toLowerCase().includes(focusLower))
  );
  
  const patternCoverage = focusPatterns.length > 0
    ? Math.min(100, focusPatterns.length * 20) // 5 patterns = 100%
    : relevantPatterns.length > 0 ? 50 : 10;
  
  const limitations: string[] = [];
  
  if (focusPatterns.length === 0) {
    limitations.push(`No patterns directly match "${focus}" - results are inferred from related patterns`);
  }
  
  if (stats.totalPatterns < 10) {
    limitations.push('Limited pattern data - consider running a full scan');
  }
  
  return {
    patternCoverage,
    dataFreshness: 'Current session', // Would be better with actual timestamps
    limitations,
  };
}

function generateDeeperDive(
  intent: TaskIntent,
  _focus: string,
  patterns: RelevantPattern[],
  files: SuggestedFile[]
): DeeperDive[] {
  const suggestions: DeeperDive[] = [];
  
  // Always suggest code examples if we have patterns
  if (patterns.length > 0) {
    suggestions.push({
      tool: 'drift_code_examples',
      args: { pattern: patterns[0]?.id, maxExamples: 3 },
      reason: `See more examples of "${patterns[0]?.name}" pattern`,
    });
  }
  
  // Suggest impact analysis for risky changes
  if (files.some(f => f.risk === 'high')) {
    const highRiskFile = files.find(f => f.risk === 'high');
    suggestions.push({
      tool: 'drift_impact_analysis',
      args: { target: highRiskFile?.file },
      reason: `Understand blast radius before changing ${highRiskFile?.file}`,
    });
  }
  
  // Suggest reachability for security audits
  if (intent === 'security_audit' && files.length > 0) {
    suggestions.push({
      tool: 'drift_reachability',
      args: { direction: 'forward', location: files[0]?.file },
      reason: 'Trace what data this code can access',
    });
  }
  
  // Suggest file patterns for understanding
  if (intent === 'understand_code' && files.length > 0) {
    suggestions.push({
      tool: 'drift_file_patterns',
      args: { file: files[0]?.file },
      reason: `Deep dive into patterns in ${files[0]?.file}`,
    });
  }
  
  return suggestions;
}

function buildSummary(
  intent: TaskIntent,
  focus: string,
  patterns: RelevantPattern[],
  files: SuggestedFile[],
  warnings: Warning[]
): string {
  const intentLabels: Record<TaskIntent, string> = {
    add_feature: 'Adding feature',
    fix_bug: 'Fixing bug',
    refactor: 'Refactoring',
    security_audit: 'Security audit',
    understand_code: 'Understanding code',
    add_test: 'Adding tests',
  };
  
  let summary = `${intentLabels[intent]} in "${focus}". `;
  summary += `Found ${patterns.length} relevant pattern(s) and ${files.length} suggested file(s). `;
  
  if (warnings.length > 0) {
    const criticalCount = warnings.filter(w => w.severity === 'critical').length;
    const warningCount = warnings.filter(w => w.severity === 'warning').length;
    
    if (criticalCount > 0) {
      summary += `⚠️ ${criticalCount} critical warning(s). `;
    } else if (warningCount > 0) {
      summary += `${warningCount} warning(s) to review. `;
    }
  }
  
  if (patterns.length > 0 && patterns[0]) {
    summary += `Primary pattern: "${patterns[0].name}" (${Math.round(patterns[0].confidence * 100)}% confidence).`;
  }
  
  return summary;
}
