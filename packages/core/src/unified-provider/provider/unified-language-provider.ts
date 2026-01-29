/**
 * Unified Language Provider
 *
 * Main orchestrator for language-agnostic code extraction.
 * Coordinates parsing, normalization, and pattern matching
 * to produce unified extraction results.
 */

import { getMatcherRegistry } from '../matching/matcher-registry.js';
import { getNormalizer } from '../normalization/index.js';
import { getParserRegistry, detectLanguage } from '../parsing/parser-registry.js';

import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type {
  UnifiedLanguage,
  UnifiedExtractionResult,
  UnifiedDataAccess,
  UnifiedProviderOptions,
  ExtractionStats,
  CallChainNormalizer,
} from '../types.js';

/**
 * Default provider options
 */
const DEFAULT_OPTIONS: Required<UnifiedProviderOptions> = {
  projectRoot: '.',
  languages: ['typescript', 'javascript', 'python', 'java', 'csharp', 'php', 'go', 'rust', 'cpp'],
  matchers: [],
  includeRawNodes: false,
  maxChainDepth: 20,
  extractDataAccess: true,
  extractCallGraph: true,
};

/**
 * Unified Language Provider
 *
 * Single entry point for extracting code information from any supported language.
 */
export class UnifiedLanguageProvider {
  private options: Required<UnifiedProviderOptions>;
  private parserRegistry = getParserRegistry();
  private matcherRegistry = getMatcherRegistry();

  constructor(options: UnifiedProviderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Extract all information from a source file
   */
  async extract(source: string, filePath: string): Promise<UnifiedExtractionResult> {
    const startTime = performance.now();
    const stats: ExtractionStats = {
      parseTimeMs: 0,
      normalizeTimeMs: 0,
      matchTimeMs: 0,
      totalTimeMs: 0,
      nodesVisited: 0,
      callChainsExtracted: 0,
      patternsMatched: 0,
    };

    // Detect language
    const language = detectLanguage(filePath);
    if (!language) {
      return this.createEmptyResult(filePath, 'typescript', ['Unknown file type'], stats);
    }

    // Check if language is enabled
    if (!this.options.languages?.includes(language)) {
      return this.createEmptyResult(filePath, language, [`Language ${language} is not enabled`], stats);
    }

    // Get parser
    const parseStart = performance.now();
    const parser = await this.parserRegistry.getParser(language, filePath);
    if (!parser) {
      return this.createEmptyResult(filePath, language, [`Parser not available for ${language}`], stats);
    }

    // Parse source
    let tree: ReturnType<TreeSitterParser['parse']>;
    try {
      tree = parser.parse(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error';
      return this.createEmptyResult(filePath, language, [message], stats);
    }
    stats.parseTimeMs = performance.now() - parseStart;

    // Get normalizer
    const normalizer = getNormalizer(language);
    if (!normalizer) {
      return this.createEmptyResult(filePath, language, [`Normalizer not available for ${language}`], stats);
    }

    // Extract and normalize
    const normalizeStart = performance.now();
    const result = this.extractWithNormalizer(
      tree.rootNode,
      source,
      filePath,
      language,
      normalizer,
      stats
    );
    stats.normalizeTimeMs = performance.now() - normalizeStart;

    // Match patterns for data access
    if (this.options.extractDataAccess) {
      const matchStart = performance.now();
      result.dataAccess = this.matchDataAccess(result, filePath);
      stats.matchTimeMs = performance.now() - matchStart;
      stats.patternsMatched = result.dataAccess.length;
    }

    stats.totalTimeMs = performance.now() - startTime;
    result.stats = stats;

    return result;
  }

  /**
   * Extract using a normalizer
   */
  private extractWithNormalizer(
    rootNode: TreeSitterNode,
    source: string,
    filePath: string,
    language: UnifiedLanguage,
    normalizer: CallChainNormalizer,
    stats: ExtractionStats
  ): UnifiedExtractionResult {
    const result: UnifiedExtractionResult = {
      file: filePath,
      language,
      functions: [],
      callChains: [],
      dataAccess: [],
      classes: [],
      imports: [],
      exports: [],
      errors: [],
      stats,
    };

    try {
      // Extract call chains
      result.callChains = normalizer.normalizeCallChains(rootNode, source, filePath);
      stats.callChainsExtracted = result.callChains.length;

      // Remove raw nodes if not requested
      if (!this.options.includeRawNodes) {
        for (const chain of result.callChains) {
          delete chain.rawNode;
        }
      }

      // Extract functions
      if (this.options.extractCallGraph) {
        result.functions = normalizer.extractFunctions(rootNode, source, filePath);
        result.classes = normalizer.extractClasses(rootNode, source, filePath);
        result.imports = normalizer.extractImports(rootNode, source, filePath);
        result.exports = normalizer.extractExports(rootNode, source, filePath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown extraction error';
      result.errors.push(message);
    }

    return result;
  }

  /**
   * Match call chains against patterns to find data access points
   */
  private matchDataAccess(result: UnifiedExtractionResult, filePath: string): UnifiedDataAccess[] {
    const dataAccess: UnifiedDataAccess[] = [];

    for (const chain of result.callChains) {
      const match = this.matcherRegistry.match(chain);
      if (match) {
        dataAccess.push({
          id: `${filePath}:${chain.line}:${chain.column}:${match.table}`,
          table: match.table,
          fields: match.fields,
          operation: match.operation,
          file: filePath,
          line: chain.line,
          column: chain.column,
          context: chain.fullExpression.slice(0, 200),
          isRawSql: match.isRawSql,
          confidence: match.confidence,
          orm: match.orm,
          language: result.language,
          callChain: chain,
        });
      }
    }

    return dataAccess;
  }

  /**
   * Create an empty result with errors
   */
  private createEmptyResult(
    file: string,
    language: UnifiedLanguage,
    errors: string[],
    stats: ExtractionStats
  ): UnifiedExtractionResult {
    return {
      file,
      language,
      functions: [],
      callChains: [],
      dataAccess: [],
      classes: [],
      imports: [],
      exports: [],
      errors,
      stats,
    };
  }

  /**
   * Check if a language is supported
   */
  async isLanguageSupported(language: UnifiedLanguage): Promise<boolean> {
    return this.parserRegistry.isAvailable(language);
  }

  /**
   * Get all supported languages
   */
  async getSupportedLanguages(): Promise<UnifiedLanguage[]> {
    const availability = await this.parserRegistry.getAllAvailability();
    return availability
      .filter(a => a.available)
      .map(a => a.language);
  }

  /**
   * Get provider options
   */
  getOptions(): Required<UnifiedProviderOptions> {
    return { ...this.options };
  }

  /**
   * Update provider options
   */
  setOptions(options: Partial<UnifiedProviderOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

/**
 * Create a unified language provider
 */
export function createUnifiedProvider(options?: UnifiedProviderOptions): UnifiedLanguageProvider {
  return new UnifiedLanguageProvider(options);
}
