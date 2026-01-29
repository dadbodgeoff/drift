/**
 * TypeScript Language Normalizer
 *
 * Wraps the existing TypeScriptCallGraphExtractor and adds semantic normalization.
 * Supports NestJS, Express, and other TypeScript frameworks.
 */

import { TypeScriptCallGraphExtractor } from '../../call-graph/extractors/typescript-extractor.js';
import { BaseLanguageNormalizer } from '../base-normalizer.js';

import type { CallGraphLanguage, FileExtractionResult, FunctionExtraction } from '../../call-graph/types.js';
import type { NormalizedDecorator, DecoratorArguments } from '../types.js';

/**
 * TypeScript language normalizer
 */
export class TypeScriptNormalizer extends BaseLanguageNormalizer {
  readonly language: CallGraphLanguage = 'typescript';
  readonly extensions: string[] = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

  private extractor = new TypeScriptCallGraphExtractor();

  /**
   * Extract raw data using the existing TypeScript extractor
   */
  protected extractRaw(source: string, filePath: string): FileExtractionResult {
    return this.extractor.extract(source, filePath);
  }

  /**
   * Extract decorator name from TypeScript decorator
   * TypeScript decorators: @Decorator or @Decorator(...)
   */
  protected override extractDecoratorName(raw: string): string {
    // Remove @ prefix and any arguments
    return raw
      .replace(/^@/, '')
      .replace(/\(.*$/, '')
      .trim();
  }

  /**
   * Extract generic arguments from TypeScript decorator
   */
  protected override extractGenericArguments(raw: string): DecoratorArguments {
    const args: DecoratorArguments = {};

    // Extract path from route decorators: @Get("/path") or @Controller("/api")
    const pathMatch = raw.match(/\(\s*["']([^"']+)["']/);
    if (pathMatch?.[1] !== undefined) {
      args.path = pathMatch[1];
    }

    return args;
  }

  /**
   * Extract dependencies from constructor parameters (NestJS DI pattern)
   */
  protected override extractDependencies(
    fn: FunctionExtraction,
    decorators: NormalizedDecorator[]
  ): string[] {
    const deps: string[] = [];

    // In NestJS, constructor injection is the primary DI pattern
    if (fn.isConstructor && fn.parameters.length > 0) {
      for (const param of fn.parameters) {
        if (param.type && !this.isPrimitiveOrCommon(param.type)) {
          // Extract the type name (handle generics)
          const typeName = param.type.replace(/<.*>/, '').trim();
          deps.push(typeName);
        }
      }
    }

    // Check for @Inject decorator
    const hasInject = decorators.some(d => d.name === 'Inject');
    if (hasInject && fn.parameters.length > 0) {
      for (const param of fn.parameters) {
        if (param.type && !this.isPrimitiveOrCommon(param.type)) {
          deps.push(param.type.replace(/<.*>/, '').trim());
        }
      }
    }

    return [...new Set(deps)]; // Deduplicate
  }

  /**
   * Check if a type is primitive or common TypeScript type
   */
  private isPrimitiveOrCommon(type: string): boolean {
    const primitives = [
      'string', 'number', 'boolean', 'void', 'null', 'undefined', 'any', 'unknown', 'never',
      'String', 'Number', 'Boolean', 'Object', 'Array', 'Function',
      'Promise', 'Observable', 'Map', 'Set', 'Date', 'RegExp', 'Error',
      'Request', 'Response', 'NextFunction',
    ];
    return primitives.includes(type);
  }
}
