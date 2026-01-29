/**
 * Language Intelligence
 *
 * Main entry point for the Language Intelligence Layer.
 * Provides cross-language semantic queries and normalization.
 */

import { registerAllFrameworks } from './frameworks/index.js';
import { createAllNormalizers, getNormalizerForFile } from './normalizers/index.js';

import type {
  LanguageIntelligenceConfig,
  NormalizedExtractionResult,
  NormalizedFunction,
  NormalizedDecorator,
  QueryOptions,
  QueryResult,
  SemanticCategory,
  LanguageNormalizer,
} from './types.js';
import type { CallGraphLanguage } from '../call-graph/types.js';

/**
 * Language Intelligence
 *
 * Unified interface for cross-language semantic analysis.
 */
export class LanguageIntelligence {
  private readonly config: LanguageIntelligenceConfig;
  private readonly normalizers: Map<CallGraphLanguage, LanguageNormalizer>;
  private initialized = false;

  constructor(config: LanguageIntelligenceConfig) {
    this.config = config;
    this.normalizers = new Map();
  }

  /**
   * Get the configuration
   */
  getConfig(): LanguageIntelligenceConfig {
    return this.config;
  }

  /**
   * Initialize the Language Intelligence system
   * Registers all framework patterns and creates normalizers
   */
  initialize(): void {
    if (this.initialized) {return;}

    // Register all built-in framework patterns
    registerAllFrameworks();

    // Create normalizers for all supported languages
    for (const normalizer of createAllNormalizers()) {
      this.normalizers.set(normalizer.language, normalizer);
    }

    this.initialized = true;
  }

  /**
   * Normalize a single file
   */
  normalizeFile(source: string, filePath: string): NormalizedExtractionResult | null {
    this.ensureInitialized();

    const normalizer = getNormalizerForFile(filePath);
    if (!normalizer) {
      return null;
    }

    return normalizer.normalize(source, filePath);
  }

  /**
   * Find all entry points across files
   *
   * Entry points are functions marked as HTTP endpoints, event handlers,
   * scheduled tasks, CLI commands, etc.
   */
  findEntryPoints(files: NormalizedExtractionResult[]): NormalizedFunction[] {
    return files.flatMap(f =>
      f.functions.filter(fn => fn.semantics.isEntryPoint)
    );
  }

  /**
   * Find all data accessors across files
   *
   * Data accessors are functions that read from or write to databases.
   * Optionally filter by table name.
   */
  findDataAccessors(
    files: NormalizedExtractionResult[],
    table?: string
  ): NormalizedFunction[] {
    return files.flatMap(f =>
      f.functions.filter(fn => {
        if (!fn.semantics.isDataAccessor) {return false;}
        if (table) {
          return fn.semantics.dataAccess.some(da => da.table === table);
        }
        return true;
      })
    );
  }

  /**
   * Find all injectable services across files
   */
  findInjectables(files: NormalizedExtractionResult[]): NormalizedFunction[] {
    return files.flatMap(f =>
      f.functions.filter(fn => fn.semantics.isInjectable)
    );
  }

  /**
   * Find all auth handlers across files
   */
  findAuthHandlers(files: NormalizedExtractionResult[]): NormalizedFunction[] {
    return files.flatMap(f =>
      f.functions.filter(fn => fn.semantics.isAuthHandler)
    );
  }

  /**
   * Find all test cases across files
   */
  findTestCases(files: NormalizedExtractionResult[]): NormalizedFunction[] {
    return files.flatMap(f =>
      f.functions.filter(fn => fn.semantics.isTestCase)
    );
  }

  /**
   * Find functions by decorator category
   */
  findByCategory(
    files: NormalizedExtractionResult[],
    category: SemanticCategory
  ): NormalizedFunction[] {
    return files.flatMap(f =>
      f.functions.filter(fn =>
        fn.normalizedDecorators.some(d => d.semantic.category === category)
      )
    );
  }

  /**
   * Find functions by framework
   */
  findByFramework(
    files: NormalizedExtractionResult[],
    framework: string
  ): NormalizedFunction[] {
    return files.flatMap(f =>
      f.functions.filter(fn =>
        fn.normalizedDecorators.some(d => d.framework === framework)
      )
    );
  }

  /**
   * General query across files
   */
  query(files: NormalizedExtractionResult[], options: QueryOptions): QueryResult {
    let functions = files.flatMap(f => f.functions);

    // Apply filters
    if (options.category) {
      functions = functions.filter(fn =>
        fn.normalizedDecorators.some(d => d.semantic.category === options.category)
      );
    }

    if (options.framework) {
      functions = functions.filter(fn =>
        fn.normalizedDecorators.some(d => d.framework === options.framework)
      );
    }

    if (options.language) {
      functions = functions.filter(fn =>
        fn.normalizedDecorators.some(d => d.language === options.language)
      );
    }

    if (options.entryPointsOnly) {
      functions = functions.filter(fn => fn.semantics.isEntryPoint);
    }

    if (options.dataAccessorsOnly) {
      functions = functions.filter(fn => fn.semantics.isDataAccessor);
    }

    if (options.authRequiredOnly) {
      functions = functions.filter(fn =>
        fn.normalizedDecorators.some(d => d.semantic.requiresAuth)
      );
    }

    if (options.table) {
      functions = functions.filter(fn =>
        fn.semantics.dataAccess.some(da => da.table === options.table)
      );
    }

    // Collect metadata
    const filesSet = new Set<string>();
    const frameworksSet = new Set<string>();
    const languagesSet = new Set<CallGraphLanguage>();

    for (const fn of functions) {
      for (const d of fn.normalizedDecorators) {
        if (d.framework) {frameworksSet.add(d.framework);}
        languagesSet.add(d.language);
      }
    }

    // Get file paths from the original files
    for (const file of files) {
      if (file.functions.some(fn => functions.includes(fn))) {
        filesSet.add(file.file);
      }
    }

    return {
      functions,
      files: Array.from(filesSet),
      frameworks: Array.from(frameworksSet),
      languages: Array.from(languagesSet),
      count: functions.length,
    };
  }

  /**
   * Explain what a decorator means
   *
   * Returns semantic information about a decorator string.
   */
  explainDecorator(
    decorator: string,
    language: CallGraphLanguage
  ): NormalizedDecorator['semantic'] | null {
    this.ensureInitialized();

    const normalizer = this.normalizers.get(language);
    if (!normalizer) {return null;}

    const frameworks = normalizer.detectFrameworks(''); // Empty source, just use all registered
    const normalized = normalizer.normalizeDecorator(decorator, frameworks);

    return normalized.semantic.category !== 'unknown' ? normalized.semantic : null;
  }

  /**
   * Get summary statistics for normalized files
   */
  getSummary(files: NormalizedExtractionResult[]): {
    totalFunctions: number;
    entryPoints: number;
    dataAccessors: number;
    injectables: number;
    authHandlers: number;
    testCases: number;
    byFramework: Record<string, number>;
    byLanguage: Record<string, number>;
    byCategory: Record<string, number>;
  } {
    const byFramework: Record<string, number> = {};
    const byLanguage: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    let totalFunctions = 0;
    let entryPoints = 0;
    let dataAccessors = 0;
    let injectables = 0;
    let authHandlers = 0;
    let testCases = 0;

    for (const file of files) {
      for (const fn of file.functions) {
        totalFunctions++;

        if (fn.semantics.isEntryPoint) {entryPoints++;}
        if (fn.semantics.isDataAccessor) {dataAccessors++;}
        if (fn.semantics.isInjectable) {injectables++;}
        if (fn.semantics.isAuthHandler) {authHandlers++;}
        if (fn.semantics.isTestCase) {testCases++;}

        for (const d of fn.normalizedDecorators) {
          if (d.framework) {
            byFramework[d.framework] = (byFramework[d.framework] ?? 0) + 1;
          }
          byLanguage[d.language] = (byLanguage[d.language] ?? 0) + 1;
          byCategory[d.semantic.category] = (byCategory[d.semantic.category] ?? 0) + 1;
        }
      }
    }

    return {
      totalFunctions,
      entryPoints,
      dataAccessors,
      injectables,
      authHandlers,
      testCases,
      byFramework,
      byLanguage,
      byCategory,
    };
  }

  /**
   * Ensure the system is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }
}

/**
 * Create a new LanguageIntelligence instance
 */
export function createLanguageIntelligence(
  config: LanguageIntelligenceConfig
): LanguageIntelligence {
  const intelligence = new LanguageIntelligence(config);
  intelligence.initialize();
  return intelligence;
}
