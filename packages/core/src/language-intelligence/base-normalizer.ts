/**
 * Base Language Normalizer
 *
 * Abstract base class for language-specific normalizers.
 * Provides common functionality for semantic normalization.
 */

import { getFrameworkRegistry } from './framework-registry.js';

import type {
  LanguageNormalizer,
  NormalizedDecorator,
  NormalizedFunction,
  NormalizedExtractionResult,
  FrameworkPattern,
  FunctionSemantics,
  DecoratorArguments,
} from './types.js';
import type { CallGraphLanguage, FunctionExtraction, FileExtractionResult } from '../call-graph/types.js';

/**
 * Abstract base class for language normalizers
 */
export abstract class BaseLanguageNormalizer implements LanguageNormalizer {
  abstract readonly language: CallGraphLanguage;
  abstract readonly extensions: string[];

  /**
   * Extract raw data from source using the language-specific extractor
   * Subclasses implement this to use their existing extractor
   */
  protected abstract extractRaw(source: string, filePath: string): FileExtractionResult;

  /**
   * Normalize an extraction result
   */
  normalize(source: string, filePath: string): NormalizedExtractionResult {
    // Get raw extraction from existing extractor
    const raw = this.extractRaw(source, filePath);

    // Detect frameworks in use
    const detectedFrameworks = this.detectFrameworks(source);

    // Normalize each function
    const functions = raw.functions.map(fn =>
      this.normalizeFunction(fn, detectedFrameworks)
    );

    // Determine file-level semantics
    const fileSemantics = this.deriveFileSemantics(functions, detectedFrameworks);

    return {
      ...raw,
      functions,
      detectedFrameworks: detectedFrameworks.map(f => f.framework),
      fileSemantics,
    };
  }

  /**
   * Normalize a single function
   */
  protected normalizeFunction(
    fn: FunctionExtraction,
    frameworks: FrameworkPattern[]
  ): NormalizedFunction {
    // Normalize all decorators
    const normalizedDecorators = fn.decorators.map(d =>
      this.normalizeDecorator(d, frameworks)
    );

    // Derive semantics from normalized decorators
    const semantics = this.deriveFunctionSemantics(fn, normalizedDecorators, frameworks);

    return {
      ...fn,
      normalizedDecorators,
      semantics,
    };
  }

  /**
   * Normalize a single decorator string
   */
  normalizeDecorator(raw: string, frameworks: FrameworkPattern[]): NormalizedDecorator {
    const registry = getFrameworkRegistry();

    // Try to find a matching pattern
    const match = registry.findDecoratorMapping(raw, frameworks);

    if (match) {
      const { mapping, framework } = match;
      return {
        raw,
        name: this.extractDecoratorName(raw),
        language: this.language,
        framework: framework.framework,
        semantic: {
          ...mapping.semantic,
          confidence: mapping.confidence ?? 1.0,
        },
        arguments: mapping.extractArgs(raw),
      };
    }

    // No match - return with default/unknown semantics
    return {
      raw,
      name: this.extractDecoratorName(raw),
      language: this.language,
      semantic: registry.getDefaultSemantics(),
      arguments: this.extractGenericArguments(raw),
    };
  }

  /**
   * Detect which frameworks are in use
   */
  detectFrameworks(source: string): FrameworkPattern[] {
    return getFrameworkRegistry().detectFrameworks(source, this.language);
  }

  /**
   * Check if this normalizer can handle a file
   */
  canHandle(filePath: string): boolean {
    const ext = this.getExtension(filePath);
    return this.extensions.includes(ext);
  }

  /**
   * Extract decorator name from raw string
   * Override in subclasses for language-specific syntax
   */
  protected extractDecoratorName(raw: string): string {
    // Default: strip common prefixes (@, #, [, etc.)
    return raw
      .replace(/^[@#\[]/, '')
      .replace(/\]$/, '')
      .replace(/\(.*$/, '')
      .trim();
  }

  /**
   * Extract generic arguments from decorator string
   * Override in subclasses for language-specific parsing
   */
  protected extractGenericArguments(raw: string): DecoratorArguments {
    const args: DecoratorArguments = {};

    // Try to extract path-like argument
    const pathMatch = raw.match(/["']([^"']+)["']/);
    if (pathMatch?.[1] !== undefined) {
      args.path = pathMatch[1];
    }

    return args;
  }

  /**
   * Get file extension
   */
  protected getExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot >= 0 ? filePath.slice(lastDot) : '';
  }

  /**
   * Derive function semantics from normalized decorators
   */
  protected deriveFunctionSemantics(
    fn: FunctionExtraction,
    decorators: NormalizedDecorator[],
    _frameworks: FrameworkPattern[]
  ): FunctionSemantics {
    const isEntryPoint = decorators.some(d => d.semantic.isEntryPoint);
    const isInjectable = decorators.some(d => d.semantic.isInjectable);
    const isAuthHandler = decorators.some(d => d.semantic.category === 'auth');
    const isTestCase = decorators.some(d => d.semantic.category === 'test');
    const isDataAccessor = decorators.some(d => d.semantic.dataAccess !== undefined);
    const requiresAuth = decorators.some(d => d.semantic.requiresAuth);

    // Extract entry point details
    let entryPoint: FunctionSemantics['entryPoint'] = undefined;
    if (isEntryPoint) {
      const routingDecorator = decorators.find(d => d.semantic.category === 'routing');
      if (routingDecorator) {
        const path = routingDecorator.arguments.path;
        const methods = routingDecorator.arguments.methods;
        entryPoint = {
          type: 'http' as const,
          ...(path !== undefined && { path }),
          ...(methods !== undefined && { methods }),
        };
      }
    }

    // Extract dependencies (from constructor params or DI decorators)
    const dependencies = this.extractDependencies(fn, decorators);

    // Extract auth requirements
    let auth: FunctionSemantics['auth'] = undefined;
    if (requiresAuth) {
      const authDecorator = decorators.find(d => d.semantic.requiresAuth);
      const roles = authDecorator?.arguments.roles;
      auth = {
        required: true,
        ...(roles !== undefined && { roles }),
      };
    }

    return {
      isEntryPoint,
      isDataAccessor,
      isAuthHandler,
      isTestCase,
      isInjectable,
      ...(entryPoint !== undefined && { entryPoint }),
      dependencies,
      dataAccess: [], // Populated by data access extractors
      ...(auth !== undefined && { auth }),
    };
  }

  /**
   * Extract dependencies from function
   * Override in subclasses for language-specific DI patterns
   */
  protected extractDependencies(
    _fn: FunctionExtraction,
    _decorators: NormalizedDecorator[]
  ): string[] {
    return [];
  }

  /**
   * Derive file-level semantics
   */
  protected deriveFileSemantics(
    functions: NormalizedFunction[],
    frameworks: FrameworkPattern[]
  ): NormalizedExtractionResult['fileSemantics'] {
    const hasEntryPoints = functions.some(f => f.semantics.isEntryPoint);
    const hasInjectables = functions.some(f => f.semantics.isInjectable);
    const hasDataAccessors = functions.some(f => f.semantics.isDataAccessor);
    const hasTests = functions.some(f => f.semantics.isTestCase);

    // Determine primary framework
    const frameworkCounts = new Map<string, number>();
    for (const fn of functions) {
      for (const d of fn.normalizedDecorators) {
        if (d.framework) {
          frameworkCounts.set(d.framework, (frameworkCounts.get(d.framework) ?? 0) + 1);
        }
      }
    }

    let primaryFramework: string | undefined;
    let maxCount = 0;
    for (const [fw, count] of frameworkCounts) {
      if (count > maxCount) {
        maxCount = count;
        primaryFramework = fw;
      }
    }

    const resolvedPrimaryFramework = primaryFramework ?? frameworks[0]?.framework;

    return {
      isController: hasEntryPoints,
      isService: hasInjectables && !hasEntryPoints,
      isModel: hasDataAccessors && !hasEntryPoints && !hasInjectables,
      isTestFile: hasTests,
      ...(resolvedPrimaryFramework !== undefined && { primaryFramework: resolvedPrimaryFramework }),
    };
  }
}
