/**
 * Java Language Normalizer
 *
 * Wraps the existing JavaCallGraphExtractor and adds semantic normalization.
 * Supports Spring Boot framework patterns.
 */

import { JavaCallGraphExtractor } from '../../call-graph/extractors/java-extractor.js';
import { BaseLanguageNormalizer } from '../base-normalizer.js';

import type { CallGraphLanguage, FileExtractionResult, FunctionExtraction } from '../../call-graph/types.js';
import type { NormalizedDecorator, DecoratorArguments } from '../types.js';

/**
 * Java language normalizer
 */
export class JavaNormalizer extends BaseLanguageNormalizer {
  readonly language: CallGraphLanguage = 'java';
  readonly extensions: string[] = ['.java'];

  private extractor = new JavaCallGraphExtractor();

  /**
   * Extract raw data using the existing Java extractor
   */
  protected extractRaw(source: string, filePath: string): FileExtractionResult {
    return this.extractor.extract(source, filePath);
  }

  /**
   * Extract decorator name from Java annotation
   * Java annotations: @Annotation or @Annotation(...)
   */
  protected override extractDecoratorName(raw: string): string {
    // Remove @ prefix and any arguments
    return raw
      .replace(/^@/, '')
      .replace(/\(.*$/, '')
      .trim();
  }

  /**
   * Extract generic arguments from Java annotation
   */
  protected override extractGenericArguments(raw: string): DecoratorArguments {
    const args: DecoratorArguments = {};

    // Extract string value: @Annotation("value") or @Annotation(value = "...")
    const valuePatterns = [
      /\(\s*["']([^"']+)["']\s*\)/,           // Simple: @Ann("value")
      /value\s*=\s*["']([^"']+)["']/,         // Named: @Ann(value = "value")
      /path\s*=\s*["']([^"']+)["']/,          // Path: @Ann(path = "/api")
    ];

    for (const pattern of valuePatterns) {
      const match = raw.match(pattern);
      if (match?.[1] !== undefined) {
        args.path = match[1];
        break;
      }
    }

    return args;
  }

  /**
   * Extract dependencies from constructor parameters (Spring DI pattern)
   */
  protected override extractDependencies(
    fn: FunctionExtraction,
    decorators: NormalizedDecorator[]
  ): string[] {
    const deps: string[] = [];

    // In Spring, constructor injection is the primary DI pattern
    // Dependencies are the constructor parameter types
    if (fn.isConstructor && fn.parameters.length > 0) {
      for (const param of fn.parameters) {
        if (param.type) {
          // Extract the type name (handle generics like List<User>)
          const typeName = param.type.replace(/<.*>/, '').trim();
          // Skip primitive types and common Java types
          if (!this.isPrimitiveOrCommon(typeName)) {
            deps.push(typeName);
          }
        }
      }
    }

    // Also check for @Autowired on fields (though constructor injection is preferred)
    const hasAutowired = decorators.some(d => d.name === 'Autowired');
    if (hasAutowired && fn.parameters.length > 0) {
      for (const param of fn.parameters) {
        if (param.type && !this.isPrimitiveOrCommon(param.type)) {
          deps.push(param.type.replace(/<.*>/, '').trim());
        }
      }
    }

    return [...new Set(deps)]; // Deduplicate
  }

  /**
   * Check if a type is primitive or common Java type
   */
  private isPrimitiveOrCommon(type: string): boolean {
    const primitives = [
      'int', 'long', 'short', 'byte', 'float', 'double', 'boolean', 'char',
      'Integer', 'Long', 'Short', 'Byte', 'Float', 'Double', 'Boolean', 'Character',
      'String', 'Object', 'void', 'Void',
      'List', 'Set', 'Map', 'Collection', 'Optional',
    ];
    return primitives.includes(type);
  }
}
