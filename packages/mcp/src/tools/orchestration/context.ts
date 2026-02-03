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
 * 
 * Enhanced with Language Intelligence for cross-language semantic analysis.
 * Phase 3: Uses async factory for automatic SQLite support.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import {
  PatternStore,
  ManifestStore,
  BoundaryStore,
  CallGraphStore,
  DNAStore,
  createLanguageIntelligence,
  createConstraintStore,
  shouldIgnoreDirectory,
  type Pattern,
  type PatternCategory,
  type NormalizedExtractionResult,
  type Constraint,
  type ConstraintCategory,
} from 'driftdetect-core';
import { createPatternStore } from 'driftdetect-core/storage';

import { createResponseBuilder, resolveProject, formatProjectContext } from '../../infrastructure/index.js';

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

export interface SemanticInsights {
  /** Detected frameworks in the focus area */
  frameworks: string[];
  /** Entry points (API endpoints, event handlers) in the focus area */
  entryPoints: Array<{
    name: string;
    file: string;
    type: string;
    path?: string;
    methods?: string[];
  }>;
  /** Data accessors in the focus area */
  dataAccessors: Array<{
    name: string;
    file: string;
    tables: string[];
  }>;
  /** Injectable services in the focus area */
  services: Array<{
    name: string;
    file: string;
    dependencies: string[];
  }>;
  /** Summary statistics */
  summary: {
    totalFunctions: number;
    entryPointCount: number;
    dataAccessorCount: number;
    serviceCount: number;
  };
}

/** Relevant constraint for the task */
export interface RelevantConstraint {
  id: string;
  name: string;
  category: ConstraintCategory;
  type: string;
  condition: string;
  enforcement: 'error' | 'warning' | 'info';
  confidence: number;
  guidance: string;
  why: string;
}

export interface ContextPackage {
  summary: string;
  relevantPatterns: RelevantPattern[];
  suggestedFiles: SuggestedFile[];
  guidance: Guidance;
  warnings: Warning[];
  confidence: Confidence;
  deeperDive: DeeperDive[];
  /** Semantic insights from Language Intelligence */
  semanticInsights?: SemanticInsights;
  /** Architectural constraints that apply to this task */
  constraints?: RelevantConstraint[];
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
      const focusWords = focusLower.split(/\s+/);
      
      // Score patterns by relevance to focus
      const scored = patterns.map(p => {
        let score = 0;
        const nameLower = p.name.toLowerCase();
        const descLower = p.description.toLowerCase();
        const categoryLower = p.category.toLowerCase();
        
        // Exact focus match in name/description (highest priority)
        if (nameLower.includes(focusLower) || descLower.includes(focusLower)) {
          score += 100;
        }
        
        // Category match (e.g., "api endpoint" matches "api" category)
        if (focusWords.some(word => categoryLower.includes(word) || word.includes(categoryLower))) {
          score += 50;
        }
        
        // Individual word matches
        for (const word of focusWords) {
          if (word.length < 3) continue; // Skip short words
          if (nameLower.includes(word)) score += 20;
          if (descLower.includes(word)) score += 10;
          if (p.locations.some(l => l.file.toLowerCase().includes(word))) score += 5;
        }
        
        // Boost by confidence
        score += p.confidence.score * 10;
        
        return { pattern: p, score };
      });
      
      // Sort by score, then by confidence
      return scored
        .sort((a, b) => b.score - a.score || b.pattern.confidence.score - a.pattern.confidence.score)
        .map(s => s.pattern);
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
      const focusWords = focusLower.split(/\s+/);
      
      // Score patterns - prioritize errors category for bug fixes
      const scored = patterns.map(p => {
        let score = 0;
        const nameLower = p.name.toLowerCase();
        const descLower = p.description.toLowerCase();
        const categoryLower = p.category.toLowerCase();
        
        // Error patterns get highest priority for bug fixes
        if (p.category === 'errors') {
          score += 100;
        }
        
        // Exact focus match
        if (nameLower.includes(focusLower) || descLower.includes(focusLower)) {
          score += 80;
        }
        
        // Category match
        if (focusWords.some(word => categoryLower.includes(word) || word.includes(categoryLower))) {
          score += 40;
        }
        
        // Word matches
        for (const word of focusWords) {
          if (word.length < 3) continue;
          if (nameLower.includes(word)) score += 15;
          if (descLower.includes(word)) score += 8;
          if (p.locations.some(l => l.file.toLowerCase().includes(word))) score += 5;
        }
        
        score += p.confidence.score * 10;
        return { pattern: p, score };
      });
      
      return scored
        .sort((a, b) => b.score - a.score)
        .map(s => s.pattern);
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
      const focusWords = focusLower.split(/\s+/);
      
      // Score patterns - prioritize by usage count for refactoring
      const scored = patterns.map(p => {
        let score = 0;
        const nameLower = p.name.toLowerCase();
        const descLower = p.description.toLowerCase();
        const categoryLower = p.category.toLowerCase();
        
        // Exact focus match
        if (nameLower.includes(focusLower) || descLower.includes(focusLower)) {
          score += 80;
        }
        
        // Category match
        if (focusWords.some(word => categoryLower.includes(word) || word.includes(categoryLower))) {
          score += 40;
        }
        
        // Word matches
        for (const word of focusWords) {
          if (word.length < 3) continue;
          if (nameLower.includes(word)) score += 15;
          if (descLower.includes(word)) score += 8;
          if (p.locations.some(l => l.file.toLowerCase().includes(word))) score += 10;
        }
        
        // Boost by location count (most used patterns are more important for refactoring)
        score += Math.min(p.locations.length * 5, 50);
        score += p.confidence.score * 10;
        
        return { pattern: p, score };
      });
      
      return scored
        .sort((a, b) => b.score - a.score)
        .map(s => s.pattern);
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
    prioritizePatterns: (patterns, focus) => {
      const focusLower = focus.toLowerCase();
      const focusWords = focusLower.split(/\s+/);
      
      // Score patterns - prioritize security-related categories
      const securityOrder = ['security', 'auth', 'data-access', 'api'];
      const scored = patterns.map(p => {
        let score = 0;
        const nameLower = p.name.toLowerCase();
        const descLower = p.description.toLowerCase();
        const categoryLower = p.category.toLowerCase();
        
        // Security categories get priority
        const categoryIndex = securityOrder.indexOf(p.category);
        if (categoryIndex !== -1) {
          score += (4 - categoryIndex) * 30; // security=120, auth=90, data-access=60, api=30
        }
        
        // Security-related keywords
        if (nameLower.includes('auth') || nameLower.includes('permission') || nameLower.includes('access')) {
          score += 50;
        }
        
        // Focus match
        if (nameLower.includes(focusLower) || descLower.includes(focusLower)) {
          score += 40;
        }
        
        // Category match
        if (focusWords.some(word => categoryLower.includes(word) || word.includes(categoryLower))) {
          score += 30;
        }
        
        // Word matches
        for (const word of focusWords) {
          if (word.length < 3) continue;
          if (nameLower.includes(word)) score += 10;
          if (descLower.includes(word)) score += 5;
        }
        
        score += p.confidence.score * 10;
        return { pattern: p, score };
      });
      
      return scored
        .sort((a, b) => b.score - a.score)
        .map(s => s.pattern);
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
      const focusWords = focusLower.split(/\s+/);
      
      // Score patterns - prioritize by relevance and usage
      const scored = patterns.map(p => {
        let score = 0;
        const nameLower = p.name.toLowerCase();
        const descLower = p.description.toLowerCase();
        const categoryLower = p.category.toLowerCase();
        
        // Exact focus match
        if (nameLower.includes(focusLower) || descLower.includes(focusLower)) {
          score += 80;
        }
        
        // Category match
        if (focusWords.some(word => categoryLower.includes(word) || word.includes(categoryLower))) {
          score += 40;
        }
        
        // Word matches
        for (const word of focusWords) {
          if (word.length < 3) continue;
          if (nameLower.includes(word)) score += 15;
          if (descLower.includes(word)) score += 8;
          if (p.locations.some(l => l.file.toLowerCase().includes(word))) score += 10;
        }
        
        // Boost by location count (more occurrences = more important to understand)
        score += Math.min(p.locations.length * 3, 30);
        score += p.confidence.score * 10;
        
        return { pattern: p, score };
      });
      
      return scored
        .sort((a, b) => b.score - a.score)
        .map(s => s.pattern);
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
      const focusWords = focusLower.split(/\s+/);
      
      // Score patterns - prioritize testing patterns
      const scored = patterns.map(p => {
        let score = 0;
        const nameLower = p.name.toLowerCase();
        const descLower = p.description.toLowerCase();
        const categoryLower = p.category.toLowerCase();
        
        // Testing patterns get highest priority
        if (p.category === 'testing') {
          score += 100;
        }
        
        // Exact focus match
        if (nameLower.includes(focusLower) || descLower.includes(focusLower)) {
          score += 60;
        }
        
        // Category match
        if (focusWords.some(word => categoryLower.includes(word) || word.includes(categoryLower))) {
          score += 30;
        }
        
        // Word matches
        for (const word of focusWords) {
          if (word.length < 3) continue;
          if (nameLower.includes(word)) score += 15;
          if (descLower.includes(word)) score += 8;
          if (p.locations.some(l => l.file.toLowerCase().includes(word))) score += 5;
        }
        
        score += p.confidence.score * 10;
        return { pattern: p, score };
      });
      
      return scored
        .sort((a, b) => b.score - a.score)
        .map(s => s.pattern);
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
  // Phase 3: Use async factory for automatic SQLite support
  let effectiveStores: typeof stores;
  if (resolution.fromRegistry) {
    const dynamicPatternStore = await createPatternStore({ rootDir: effectiveRoot });
    effectiveStores = {
      pattern: dynamicPatternStore as PatternStore, // Cast for compatibility
      manifest: new ManifestStore(effectiveRoot),
      boundary: new BoundaryStore({ rootDir: effectiveRoot }),
      callGraph: new CallGraphStore({ rootDir: effectiveRoot }),
      dna: new DNAStore({ rootDir: effectiveRoot }),
    };
    // Pattern store already initialized by factory
    await effectiveStores.manifest.load();
  } else {
    effectiveStores = stores;
    // Initialize stores
    await effectiveStores.pattern.initialize();
    await effectiveStores.manifest.load();
  }
  
  // Get all patterns
  const allPatterns = effectiveStores.pattern.getAll();
  
  // Filter to relevant categories and prioritize
  const categoryPatterns = allPatterns.filter(p => 
    strategy.categories.includes(p.category)
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
  
  // Generate semantic insights from Language Intelligence
  const semanticInsights = await generateSemanticInsights(
    effectiveRoot,
    suggestedFiles,
    focus
  );
  
  // Get relevant constraints for this task
  const constraints = await getRelevantConstraints(
    effectiveRoot,
    intent,
    focus,
    suggestedFiles
  );
  
  // Build summary
  let summary = buildSummary(intent, focus, relevantPatterns, suggestedFiles, warnings, semanticInsights, constraints);
  
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
    ...(semanticInsights && { semanticInsights }),
    ...(constraints.length > 0 && { constraints }),
  };
  
  // Add constraint-related guidance
  if (constraints.length > 0) {
    const errorConstraints = constraints.filter(c => c.enforcement === 'error');
    if (errorConstraints.length > 0) {
      guidance.keyInsights.unshift(
        `⚠️ ${errorConstraints.length} mandatory constraint(s) apply - violations will cause errors`
      );
    }
    guidance.decisionPoints.push(
      'Review constraints below before implementing - they define what code MUST do'
    );
  }
  
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
      
      // Skip internal .drift files - these are not source code
      if (file.includes('.drift/') || file.includes('/.drift/')) {
        continue;
      }
      
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
  warnings: Warning[],
  semanticInsights?: SemanticInsights,
  constraints?: RelevantConstraint[]
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
    summary += `Primary pattern: "${patterns[0].name}" (${Math.round(patterns[0].confidence * 100)}% confidence). `;
  }
  
  // Add semantic insights to summary
  if (semanticInsights && semanticInsights.summary.totalFunctions > 0) {
    const { summary: stats, frameworks } = semanticInsights;
    
    if (frameworks.length > 0) {
      summary += `Frameworks: ${frameworks.join(', ')}. `;
    }
    
    const semanticParts: string[] = [];
    if (stats.entryPointCount > 0) {
      semanticParts.push(`${stats.entryPointCount} entry point(s)`);
    }
    if (stats.dataAccessorCount > 0) {
      semanticParts.push(`${stats.dataAccessorCount} data accessor(s)`);
    }
    if (stats.serviceCount > 0) {
      semanticParts.push(`${stats.serviceCount} service(s)`);
    }
    
    if (semanticParts.length > 0) {
      summary += `Semantic analysis: ${semanticParts.join(', ')}. `;
    }
  }
  
  // Add constraint info to summary
  if (constraints && constraints.length > 0) {
    const errorCount = constraints.filter(c => c.enforcement === 'error').length;
    const warningCount = constraints.filter(c => c.enforcement === 'warning').length;
    
    if (errorCount > 0) {
      summary += `🔒 ${errorCount} mandatory constraint(s). `;
    } else if (warningCount > 0) {
      summary += `${constraints.length} constraint(s) apply. `;
    } else {
      summary += `${constraints.length} constraint(s) for reference. `;
    }
  }
  
  return summary;
}

// =============================================================================
// Semantic Insights Generation
// =============================================================================

/**
 * Generate semantic insights using the Language Intelligence Layer
 * 
 * Analyzes files to extract cross-language semantic information
 * about entry points, data accessors, services, and frameworks.
 * 
 * Works in two modes:
 * 1. If suggestedFiles are provided, analyzes those
 * 2. Otherwise, searches for files matching the focus term
 */
async function generateSemanticInsights(
  projectRoot: string,
  suggestedFiles: SuggestedFile[],
  focus: string
): Promise<SemanticInsights | undefined> {
  try {
    // Create Language Intelligence instance
    const intelligence = createLanguageIntelligence({ rootDir: projectRoot });
    
    // Collect files to analyze
    const filesToAnalyze: string[] = [];
    
    // Add suggested files
    for (const sf of suggestedFiles) {
      filesToAnalyze.push(sf.file);
    }
    
    // If no suggested files, search for files matching the focus term
    if (filesToAnalyze.length === 0 && focus) {
      const focusFiles = await findFilesMatchingFocus(projectRoot, focus);
      filesToAnalyze.push(...focusFiles);
    }
    
    // Don't process if no files
    if (filesToAnalyze.length === 0) {
      return undefined;
    }
    
    // Normalize each file
    const normalizedFiles: NormalizedExtractionResult[] = [];
    
    for (const relativeFile of filesToAnalyze.slice(0, 10)) { // Limit to 10 files
      const filePath = path.join(projectRoot, relativeFile);
      
      try {
        const source = await fs.readFile(filePath, 'utf-8');
        const normalized = intelligence.normalizeFile(source, relativeFile);
        
        if (normalized) {
          normalizedFiles.push(normalized);
        }
      } catch {
        // File read error - skip this file
        continue;
      }
    }
    
    // If no files could be normalized, return undefined
    if (normalizedFiles.length === 0) {
      return undefined;
    }
    
    // Extract semantic information
    const entryPoints = intelligence.findEntryPoints(normalizedFiles);
    const dataAccessors = intelligence.findDataAccessors(normalizedFiles);
    const injectables = intelligence.findInjectables(normalizedFiles);
    
    // Collect detected frameworks
    const frameworksSet = new Set<string>();
    for (const file of normalizedFiles) {
      for (const fw of file.detectedFrameworks) {
        frameworksSet.add(fw);
      }
    }
    
    // Build entry points list
    const entryPointsList = entryPoints.slice(0, 10).map(fn => {
      const entry: {
        name: string;
        file: string;
        type: string;
        path?: string;
        methods?: string[];
      } = {
        name: fn.name,
        file: normalizedFiles.find(f => f.functions.includes(fn))?.file ?? 'unknown',
        type: fn.semantics.entryPoint?.type ?? 'unknown',
      };
      
      if (fn.semantics.entryPoint?.path) {
        entry.path = fn.semantics.entryPoint.path;
      }
      if (fn.semantics.entryPoint?.methods && fn.semantics.entryPoint.methods.length > 0) {
        entry.methods = fn.semantics.entryPoint.methods;
      }
      
      return entry;
    });
    
    // Build data accessors list
    const dataAccessorsList = dataAccessors.slice(0, 10).map(fn => ({
      name: fn.name,
      file: normalizedFiles.find(f => f.functions.includes(fn))?.file ?? 'unknown',
      tables: fn.semantics.dataAccess.map(da => da.table),
    }));
    
    // Build services list
    const servicesList = injectables.slice(0, 10).map(fn => ({
      name: fn.name,
      file: normalizedFiles.find(f => f.functions.includes(fn))?.file ?? 'unknown',
      dependencies: fn.semantics.dependencies,
    }));
    
    // Get summary stats
    const stats = intelligence.getSummary(normalizedFiles);
    
    return {
      frameworks: Array.from(frameworksSet),
      entryPoints: entryPointsList,
      dataAccessors: dataAccessorsList,
      services: servicesList,
      summary: {
        totalFunctions: stats.totalFunctions,
        entryPointCount: stats.entryPoints,
        dataAccessorCount: stats.dataAccessors,
        serviceCount: stats.injectables,
      },
    };
  } catch {
    // Language Intelligence not available or error - return undefined
    return undefined;
  }
}

// =============================================================================
// Constraint Integration
// =============================================================================

/**
 * Get constraints relevant to the current task
 * 
 * Maps task intent to constraint categories and filters constraints
 * that apply to the suggested files.
 */
async function getRelevantConstraints(
  projectRoot: string,
  intent: TaskIntent,
  focus: string,
  suggestedFiles: SuggestedFile[]
): Promise<RelevantConstraint[]> {
  try {
    // Initialize constraint store
    const constraintStore = createConstraintStore({ rootDir: projectRoot });
    await constraintStore.initialize();
    
    // Map intent to relevant constraint categories
    const intentToCategories: Record<TaskIntent, ConstraintCategory[]> = {
      add_feature: ['api', 'auth', 'data', 'error', 'validation', 'logging', 'structural'],
      fix_bug: ['error', 'data', 'validation', 'logging'],
      refactor: ['structural', 'api', 'data', 'performance'],
      security_audit: ['security', 'auth', 'data', 'validation'],
      understand_code: ['api', 'data', 'structural', 'auth'],
      add_test: ['test', 'error', 'data', 'api'],
    };
    
    const relevantCategories = intentToCategories[intent] ?? [];
    
    // Get active constraints (approved + high-confidence discovered)
    const activeConstraints = constraintStore.getActive(0.85);
    
    // Filter to relevant categories
    let filtered = activeConstraints.filter(c => 
      relevantCategories.includes(c.category)
    );
    
    // Further filter to constraints that apply to suggested files
    if (suggestedFiles.length > 0) {
      filtered = filtered.filter(c => {
        // If constraint has no file scope, it applies globally
        if (!c.scope.files || c.scope.files.length === 0) {
          return true;
        }
        // Check if any suggested file matches the constraint scope
        return suggestedFiles.some(sf => 
          constraintAppliesToFile(c, sf.file)
        );
      });
    }
    
    // Also include constraints that match the focus term
    const focusLower = focus.toLowerCase();
    const focusMatches = activeConstraints.filter(c =>
      !filtered.includes(c) && (
        c.name.toLowerCase().includes(focusLower) ||
        c.description.toLowerCase().includes(focusLower)
      )
    );
    
    filtered = [...filtered, ...focusMatches];
    
    // Sort by enforcement level (errors first) then confidence
    filtered.sort((a, b) => {
      const levelOrder = { error: 0, warning: 1, info: 2 };
      const levelDiff = levelOrder[a.enforcement.level] - levelOrder[b.enforcement.level];
      if (levelDiff !== 0) {return levelDiff;}
      return b.confidence.score - a.confidence.score;
    });
    
    // Limit to top 10 most relevant
    const top = filtered.slice(0, 10);
    
    // Convert to RelevantConstraint format
    return top.map(c => ({
      id: c.id,
      name: c.name,
      category: c.category,
      type: c.invariant.type,
      condition: c.invariant.condition,
      enforcement: c.enforcement.level,
      confidence: Math.round(c.confidence.score * 100) / 100,
      guidance: c.enforcement.guidance,
      why: generateConstraintWhy(c, intent, focus),
    }));
  } catch {
    // Constraint store not available or error - return empty
    return [];
  }
}

/**
 * Check if a constraint applies to a specific file
 */
function constraintAppliesToFile(constraint: Constraint, filePath: string): boolean {
  const scope = constraint.scope;
  
  // Check exclusions first
  if (scope.exclude?.files?.length) {
    for (const pattern of scope.exclude.files) {
      if (matchGlob(filePath, pattern)) {
        return false;
      }
    }
  }
  
  if (scope.exclude?.directories?.length) {
    for (const dir of scope.exclude.directories) {
      if (filePath.includes(dir)) {
        return false;
      }
    }
  }
  
  // Check inclusions
  if (scope.files?.length) {
    return scope.files.some(pattern => matchGlob(filePath, pattern));
  }
  
  // Check language match
  if (constraint.language !== 'all') {
    const ext = path.extname(filePath).toLowerCase();
    const langExtensions: Record<string, string[]> = {
      typescript: ['.ts', '.tsx'],
      javascript: ['.js', '.jsx', '.mjs', '.cjs'],
      python: ['.py'],
      java: ['.java'],
      csharp: ['.cs'],
      php: ['.php'],
    };
    
    const exts = langExtensions[constraint.language];
    if (exts && !exts.includes(ext)) {
      return false;
    }
  }
  
  // If no specific file scope, constraint applies to all matching language files
  return true;
}

/**
 * Simple glob matching (supports * and **)
 */
function matchGlob(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*')
    .replace(/\//g, '\\/');
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

/**
 * Generate explanation for why a constraint is relevant
 */
function generateConstraintWhy(
  constraint: Constraint,
  intent: TaskIntent,
  focus: string
): string {
  const focusLower = focus.toLowerCase();
  
  // Check if constraint name/description matches focus
  if (constraint.name.toLowerCase().includes(focusLower) ||
      constraint.description.toLowerCase().includes(focusLower)) {
    return `Directly related to "${focus}" - this constraint must be satisfied`;
  }
  
  // Intent-specific explanations
  const intentExplanations: Record<TaskIntent, Record<ConstraintCategory, string>> = {
    add_feature: {
      api: 'API constraints ensure new endpoints follow established patterns',
      auth: 'Authentication constraints protect new features',
      data: 'Data access constraints ensure proper data handling',
      error: 'Error handling constraints ensure robust error management',
      validation: 'Validation constraints ensure input safety',
      logging: 'Logging constraints ensure observability',
      structural: 'Structural constraints maintain code organization',
      security: 'Security constraints protect against vulnerabilities',
      test: 'Test constraints ensure adequate coverage',
      performance: 'Performance constraints prevent regressions',
    },
    fix_bug: {
      error: 'Error handling constraints may reveal the bug pattern',
      data: 'Data constraints ensure fix doesn\'t break data integrity',
      validation: 'Validation constraints may be the root cause',
      logging: 'Logging constraints help debug the issue',
      api: 'API constraints ensure fix maintains compatibility',
      auth: 'Auth constraints ensure fix doesn\'t create security holes',
      security: 'Security constraints must be maintained during fix',
      structural: 'Structural constraints guide where fix should go',
      test: 'Test constraints ensure fix is properly tested',
      performance: 'Performance constraints ensure fix doesn\'t regress',
    },
    refactor: {
      structural: 'Structural constraints guide refactoring direction',
      api: 'API constraints ensure refactor maintains compatibility',
      data: 'Data constraints ensure refactor preserves data handling',
      performance: 'Performance constraints ensure refactor improves efficiency',
      error: 'Error handling must be preserved during refactor',
      auth: 'Auth patterns must be maintained',
      security: 'Security patterns must be preserved',
      validation: 'Validation must be maintained',
      logging: 'Logging must be preserved',
      test: 'Tests must continue to pass',
    },
    security_audit: {
      security: 'Security constraints define required protections',
      auth: 'Auth constraints ensure proper authentication',
      data: 'Data constraints protect sensitive information',
      validation: 'Validation constraints prevent injection attacks',
      api: 'API constraints ensure secure endpoints',
      error: 'Error handling must not leak sensitive info',
      logging: 'Logging must not expose sensitive data',
      structural: 'Structure affects security boundaries',
      test: 'Security tests must exist',
      performance: 'Performance affects DoS resistance',
    },
    understand_code: {
      api: 'API constraints explain endpoint requirements',
      data: 'Data constraints explain data flow rules',
      structural: 'Structural constraints explain code organization',
      auth: 'Auth constraints explain security model',
      error: 'Error constraints explain error handling approach',
      security: 'Security constraints explain protection model',
      validation: 'Validation constraints explain input requirements',
      logging: 'Logging constraints explain observability approach',
      test: 'Test constraints explain testing strategy',
      performance: 'Performance constraints explain optimization rules',
    },
    add_test: {
      test: 'Test constraints define testing requirements',
      error: 'Error constraints show what error cases to test',
      data: 'Data constraints show what data scenarios to test',
      api: 'API constraints show what endpoints need testing',
      auth: 'Auth constraints show security scenarios to test',
      security: 'Security constraints show attack vectors to test',
      validation: 'Validation constraints show input cases to test',
      logging: 'Logging constraints show what to verify in logs',
      structural: 'Structure affects test organization',
      performance: 'Performance constraints show what to benchmark',
    },
  };
  
  const explanation = intentExplanations[intent]?.[constraint.category];
  if (explanation) {
    return explanation;
  }
  
  // Default explanation
  return `${constraint.category} constraint with ${Math.round(constraint.confidence.score * 100)}% confidence`;
}

/**
 * Find source files matching the focus term
 */
async function findFilesMatchingFocus(projectRoot: string, focus: string): Promise<string[]> {
  const focusLower = focus.toLowerCase();
  const results: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cs', '.php'];
  
  async function searchDir(dir: string, depth: number = 0): Promise<void> {
    if (depth > 5) {return;} // Limit depth
    if (results.length >= 10) {return;} // Limit results
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (results.length >= 10) {break;}
        
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(projectRoot, fullPath);
        
        // Skip directories using enterprise-grade ignore list
        if (entry.isDirectory()) {
          if (shouldIgnoreDirectory(entry.name)) {
            continue;
          }
          await searchDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            // Check if file path or name matches focus
            if (relativePath.toLowerCase().includes(focusLower) || 
                entry.name.toLowerCase().includes(focusLower)) {
              results.push(relativePath);
            }
          }
        }
      }
    } catch {
      // Directory read error - skip
    }
  }
  
  await searchDir(projectRoot);
  return results;
}
