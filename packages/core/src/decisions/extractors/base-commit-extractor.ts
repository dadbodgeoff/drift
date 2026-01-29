/**
 * Base Commit Extractor
 *
 * Abstract base class for language-specific commit semantic extraction.
 * Each language extractor analyzes code changes to detect architectural signals.
 */

import {
  CommitParser,
  analyzeDependencyChangesSync,
} from '../git/index.js';

import type {
  GitCommit,
  CommitSemanticExtraction,
  PatternDelta,
  FunctionDelta,
  DependencyDelta,
  MessageSignal,
  ArchitecturalSignal,
  DecisionLanguage,
} from '../types.js';

// ============================================================================
// Base Extractor
// ============================================================================

/**
 * Options for commit extraction
 */
export interface CommitExtractorOptions {
  /** Root directory of the repository */
  rootDir: string;
  /** Include detailed function analysis */
  includeFunctions?: boolean;
  /** Include pattern analysis (requires pattern store) */
  includePatterns?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Context passed to extraction methods
 */
export interface ExtractionContext {
  /** The commit being analyzed */
  commit: GitCommit;
  /** Files relevant to this extractor's language */
  relevantFiles: GitCommit['files'];
  /** Options */
  options: CommitExtractorOptions;
}

/**
 * Base class for language-specific commit extractors
 */
export abstract class BaseCommitExtractor {
  protected options: CommitExtractorOptions;
  protected commitParser: CommitParser;

  /** Language this extractor handles */
  abstract readonly language: DecisionLanguage;

  /** File extensions this extractor handles */
  abstract readonly extensions: string[];

  constructor(options: CommitExtractorOptions) {
    this.options = {
      includeFunctions: true,
      includePatterns: false,
      verbose: false,
      ...options,
    };
    this.commitParser = new CommitParser();
  }

  /**
   * Check if this extractor can handle a file
   */
  canHandle(filePath: string): boolean {
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    return this.extensions.includes(ext.toLowerCase());
  }

  /**
   * Extract semantic information from a commit
   */
  async extract(commit: GitCommit): Promise<CommitSemanticExtraction> {
    // Filter to relevant files
    const relevantFiles = commit.files.filter(f => this.canHandle(f.path));

    if (relevantFiles.length === 0) {
      return this.createEmptyExtraction(commit);
    }

    const context: ExtractionContext = {
      commit,
      relevantFiles,
      options: this.options,
    };

    // Extract message signals
    const messageSignals = this.commitParser.extractSignals(
      commit.subject,
      commit.body
    );

    // Extract architectural signals from code changes
    const architecturalSignals = await this.extractArchitecturalSignals(context);

    // Extract function changes
    const functionsChanged = this.options.includeFunctions
      ? await this.extractFunctionChanges(context)
      : [];

    // Extract pattern changes (if enabled)
    const patternsAffected = this.options.includePatterns
      ? await this.extractPatternChanges(context)
      : [];

    // Extract dependency changes
    const dependencyChanges = this.extractDependencyChanges(context);

    // Calculate significance
    const significance = this.calculateSignificance(
      messageSignals,
      architecturalSignals,
      functionsChanged,
      patternsAffected,
      dependencyChanges
    );

    // Determine languages affected
    const languagesAffected = this.getLanguagesAffected(commit);

    return {
      commit,
      primaryLanguage: this.language,
      languagesAffected,
      patternsAffected,
      functionsChanged,
      dependencyChanges,
      messageSignals,
      architecturalSignals,
      significance,
      extractedAt: new Date(),
    };
  }

  /**
   * Extract architectural signals from code changes
   * Override in subclasses for language-specific detection
   */
  protected async extractArchitecturalSignals(
    context: ExtractionContext
  ): Promise<ArchitecturalSignal[]> {
    const signals: ArchitecturalSignal[] = [];

    for (const file of context.relevantFiles) {
      // Detect new abstractions (interfaces, abstract classes)
      if (file.status === 'added') {
        const abstractionSignal = this.detectNewAbstraction(file);
        if (abstractionSignal) {
          signals.push(abstractionSignal);
        }
      }

      // Detect API surface changes
      const apiSignal = this.detectApiSurfaceChange(file);
      if (apiSignal) {
        signals.push(apiSignal);
      }

      // Detect data model changes
      const modelSignal = this.detectDataModelChange(file);
      if (modelSignal) {
        signals.push(modelSignal);
      }
    }

    return this.deduplicateSignals(signals);
  }

  /**
   * Extract function changes
   * Override in subclasses for language-specific parsing
   */
  protected async extractFunctionChanges(
    context: ExtractionContext
  ): Promise<FunctionDelta[]> {
    const deltas: FunctionDelta[] = [];

    for (const file of context.relevantFiles) {
      // Basic heuristic: file added = functions added, file deleted = functions removed
      if (file.status === 'added') {
        deltas.push({
          functionId: `${file.path}:new`,
          name: '[new file]',
          qualifiedName: file.path,
          file: file.path,
          changeType: 'added',
          isEntryPoint: this.isLikelyEntryPoint(file.path),
          signatureChanged: false,
        });
      } else if (file.status === 'deleted') {
        deltas.push({
          functionId: `${file.path}:deleted`,
          name: '[deleted file]',
          qualifiedName: file.path,
          file: file.path,
          changeType: 'removed',
          isEntryPoint: false,
          signatureChanged: false,
        });
      } else if (file.status === 'modified' && file.additions + file.deletions > 10) {
        // Significant modification
        deltas.push({
          functionId: `${file.path}:modified`,
          name: '[modified]',
          qualifiedName: file.path,
          file: file.path,
          changeType: 'modified',
          isEntryPoint: this.isLikelyEntryPoint(file.path),
          signatureChanged: file.additions > 5 && file.deletions > 5,
        });
      }
    }

    return deltas;
  }

  /**
   * Extract pattern changes
   * Override in subclasses or use pattern store integration
   */
  protected async extractPatternChanges(
    _context: ExtractionContext
  ): Promise<PatternDelta[]> {
    // Default: no pattern analysis without pattern store
    return [];
  }

  /**
   * Extract dependency changes
   */
  protected extractDependencyChanges(context: ExtractionContext): DependencyDelta[] {
    return analyzeDependencyChangesSync(context.commit);
  }

  /**
   * Detect if a new file introduces an abstraction
   */
  protected detectNewAbstraction(file: GitCommit['files'][0]): ArchitecturalSignal | null {
    // Check file naming conventions
    const fileName = file.path.toLowerCase();
    
    if (
      fileName.includes('interface') ||
      fileName.includes('abstract') ||
      fileName.includes('base') ||
      fileName.includes('contract')
    ) {
      return {
        type: 'new-abstraction',
        description: `New abstraction file: ${file.path}`,
        files: [file.path],
        confidence: 0.7,
      };
    }

    return null;
  }

  /**
   * Detect API surface changes
   */
  protected detectApiSurfaceChange(file: GitCommit['files'][0]): ArchitecturalSignal | null {
    const fileName = file.path.toLowerCase();
    
    if (
      fileName.includes('controller') ||
      fileName.includes('route') ||
      fileName.includes('endpoint') ||
      fileName.includes('api') ||
      fileName.includes('handler')
    ) {
      return {
        type: 'api-surface-change',
        description: `API file ${file.status}: ${file.path}`,
        files: [file.path],
        confidence: 0.6,
      };
    }

    return null;
  }

  /**
   * Detect data model changes
   */
  protected detectDataModelChange(file: GitCommit['files'][0]): ArchitecturalSignal | null {
    const fileName = file.path.toLowerCase();
    
    if (
      fileName.includes('model') ||
      fileName.includes('entity') ||
      fileName.includes('schema') ||
      fileName.includes('migration')
    ) {
      return {
        type: 'data-model-change',
        description: `Data model file ${file.status}: ${file.path}`,
        files: [file.path],
        confidence: 0.6,
      };
    }

    return null;
  }

  /**
   * Check if a file path is likely an entry point
   */
  protected isLikelyEntryPoint(filePath: string): boolean {
    const fileName = filePath.toLowerCase();
    return (
      fileName.includes('controller') ||
      fileName.includes('handler') ||
      fileName.includes('route') ||
      fileName.includes('endpoint') ||
      fileName.includes('main') ||
      fileName.includes('index') ||
      fileName.includes('app')
    );
  }

  /**
   * Calculate overall significance score
   */
  protected calculateSignificance(
    messageSignals: MessageSignal[],
    architecturalSignals: ArchitecturalSignal[],
    functionsChanged: FunctionDelta[],
    patternsAffected: PatternDelta[],
    dependencyChanges: DependencyDelta[]
  ): number {
    let score = 0.1; // Base score

    // Message signals
    const maxMessageSignal = Math.max(0, ...messageSignals.map(s => s.confidence));
    score += maxMessageSignal * 0.3;

    // Architectural signals
    const maxArchSignal = Math.max(0, ...architecturalSignals.map(s => s.confidence));
    score += maxArchSignal * 0.3;

    // Function changes
    if (functionsChanged.length > 0) {
      const entryPointChanges = functionsChanged.filter(f => f.isEntryPoint).length;
      score += Math.min(0.2, entryPointChanges * 0.05);
    }

    // Pattern changes
    if (patternsAffected.length > 0) {
      score += Math.min(0.2, patternsAffected.length * 0.05);
    }

    // Dependency changes
    if (dependencyChanges.length > 0) {
      score += Math.min(0.15, dependencyChanges.length * 0.05);
    }

    return Math.min(1, score);
  }

  /**
   * Get all languages affected by a commit
   */
  protected getLanguagesAffected(commit: GitCommit): DecisionLanguage[] {
    const languages = new Set<DecisionLanguage>();

    for (const file of commit.files) {
      const lang = file.language;
      if (lang !== 'other' && lang !== 'config' && lang !== 'docs') {
        languages.add(lang);
      }
    }

    return Array.from(languages);
  }

  /**
   * Create an empty extraction result
   */
  protected createEmptyExtraction(commit: GitCommit): CommitSemanticExtraction {
    return {
      commit,
      primaryLanguage: 'mixed',
      languagesAffected: [],
      patternsAffected: [],
      functionsChanged: [],
      dependencyChanges: [],
      messageSignals: this.commitParser.extractSignals(commit.subject, commit.body),
      architecturalSignals: [],
      significance: 0.1,
      extractedAt: new Date(),
    };
  }

  /**
   * Deduplicate signals by type and description
   */
  protected deduplicateSignals(signals: ArchitecturalSignal[]): ArchitecturalSignal[] {
    const map = new Map<string, ArchitecturalSignal>();

    for (const signal of signals) {
      const key = `${signal.type}:${signal.description}`;
      
      if (map.has(key)) {
        const existing = map.get(key)!;
        existing.files = [...new Set([...existing.files, ...signal.files])];
        existing.confidence = Math.max(existing.confidence, signal.confidence);
      } else {
        map.set(key, { ...signal });
      }
    }

    return Array.from(map.values());
  }
}
