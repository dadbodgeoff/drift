/**
 * PHP Language Normalizer
 *
 * Wraps the existing PhpCallGraphExtractor and adds semantic normalization.
 * Supports Laravel framework patterns.
 */

import { PhpCallGraphExtractor } from '../../call-graph/extractors/php-extractor.js';
import { BaseLanguageNormalizer } from '../base-normalizer.js';

import type { CallGraphLanguage, FileExtractionResult, FunctionExtraction } from '../../call-graph/types.js';
import type { NormalizedDecorator, DecoratorArguments } from '../types.js';

/**
 * PHP language normalizer
 */
export class PhpNormalizer extends BaseLanguageNormalizer {
  readonly language: CallGraphLanguage = 'php';
  readonly extensions: string[] = ['.php'];

  private extractor = new PhpCallGraphExtractor();

  /**
   * Extract raw data using the existing PHP extractor
   */
  protected extractRaw(source: string, filePath: string): FileExtractionResult {
    return this.extractor.extract(source, filePath);
  }

  /**
   * Extract decorator name from PHP attribute
   * PHP 8 attributes: #[Attribute] or #[Attribute(...)]
   */
  protected override extractDecoratorName(raw: string): string {
    // Remove #[ prefix and ] suffix, then any arguments
    return raw
      .replace(/^#\[/, '')
      .replace(/\]$/, '')
      .replace(/\(.*$/, '')
      .trim();
  }

  /**
   * Extract generic arguments from PHP attribute
   */
  protected override extractGenericArguments(raw: string): DecoratorArguments {
    const args: DecoratorArguments = {};

    // Extract string value: #[Route("/path")] or #[Middleware("auth")]
    const valueMatch = raw.match(/\(\s*["']([^"']+)["']/);
    if (valueMatch?.[1] !== undefined) {
      args.path = valueMatch[1];
    }

    // Extract methods: #[Route("/path", methods: ["GET", "POST"])]
    const methodsMatch = raw.match(/methods:\s*\[([^\]]+)\]/);
    if (methodsMatch?.[1]) {
      const methods = methodsMatch[1]
        .match(/["'](\w+)["']/g)
        ?.map(m => m.replace(/["']/g, '').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH');
      if (methods && methods.length > 0) {
        args.methods = methods;
      }
    }

    return args;
  }

  /**
   * Extract dependencies from constructor parameters (Laravel DI pattern)
   */
  protected override extractDependencies(
    fn: FunctionExtraction,
    _decorators: NormalizedDecorator[]
  ): string[] {
    const deps: string[] = [];

    // In Laravel, constructor injection is the primary DI pattern
    if (fn.isConstructor && fn.parameters.length > 0) {
      for (const param of fn.parameters) {
        if (param.type && !this.isPrimitiveOrCommon(param.type)) {
          // Extract class name from fully qualified name
          const parts = param.type.split('\\');
          const typeName = parts[parts.length - 1] ?? param.type;
          deps.push(typeName);
        }
      }
    }

    return [...new Set(deps)]; // Deduplicate
  }

  /**
   * Check if a type is primitive or common PHP type
   */
  private isPrimitiveOrCommon(type: string): boolean {
    const primitives = [
      'int', 'float', 'string', 'bool', 'array', 'object', 'mixed', 'void', 'null',
      'callable', 'iterable', 'self', 'static', 'parent',
      'Request', 'Response', 'Collection', 'Carbon',
    ];
    return primitives.includes(type);
  }
}
