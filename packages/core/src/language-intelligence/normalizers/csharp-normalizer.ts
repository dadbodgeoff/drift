/**
 * C# Language Normalizer
 *
 * Wraps the existing CSharpCallGraphExtractor and adds semantic normalization.
 * Supports ASP.NET Core framework patterns.
 */

import { CSharpCallGraphExtractor } from '../../call-graph/extractors/csharp-extractor.js';
import { BaseLanguageNormalizer } from '../base-normalizer.js';

import type { CallGraphLanguage, FileExtractionResult, FunctionExtraction } from '../../call-graph/types.js';
import type { NormalizedDecorator, DecoratorArguments } from '../types.js';

/**
 * C# language normalizer
 */
export class CSharpNormalizer extends BaseLanguageNormalizer {
  readonly language: CallGraphLanguage = 'csharp';
  readonly extensions: string[] = ['.cs'];

  private extractor = new CSharpCallGraphExtractor();

  /**
   * Extract raw data using the existing C# extractor
   */
  protected extractRaw(source: string, filePath: string): FileExtractionResult {
    return this.extractor.extract(source, filePath);
  }

  /**
   * Extract decorator name from C# attribute
   * C# attributes: [Attribute] or [Attribute(...)]
   */
  protected override extractDecoratorName(raw: string): string {
    // Remove brackets and any arguments
    return raw
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .replace(/\(.*$/, '')
      .trim();
  }

  /**
   * Extract generic arguments from C# attribute
   */
  protected override extractGenericArguments(raw: string): DecoratorArguments {
    const args: DecoratorArguments = {};

    // Extract string value: [Attribute("value")] or [Route("path")]
    const valueMatch = raw.match(/\(\s*["']([^"']+)["']/);
    if (valueMatch?.[1] !== undefined) {
      args.path = valueMatch[1];
    }

    // Extract named parameters: [Authorize(Roles = "Admin")]
    const rolesMatch = raw.match(/Roles\s*=\s*["']([^"']+)["']/);
    if (rolesMatch?.[1]) {
      args.roles = rolesMatch[1].split(',').map(r => r.trim());
    }

    return args;
  }

  /**
   * Extract dependencies from constructor parameters (ASP.NET Core DI pattern)
   */
  protected override extractDependencies(
    fn: FunctionExtraction,
    _decorators: NormalizedDecorator[]
  ): string[] {
    const deps: string[] = [];

    // In ASP.NET Core, constructor injection is the primary DI pattern
    if (fn.isConstructor && fn.parameters.length > 0) {
      for (const param of fn.parameters) {
        if (param.type && !this.isPrimitiveOrCommon(param.type)) {
          // Extract interface name (IUserService -> UserService)
          const typeName = param.type
            .replace(/<.*>/, '')  // Remove generics
            .replace(/^I(?=[A-Z])/, '')  // Remove I prefix from interfaces
            .trim();
          deps.push(typeName);
        }
      }
    }

    return [...new Set(deps)]; // Deduplicate
  }

  /**
   * Check if a type is primitive or common C# type
   */
  private isPrimitiveOrCommon(type: string): boolean {
    const primitives = [
      'int', 'long', 'short', 'byte', 'float', 'double', 'decimal', 'bool', 'char',
      'Int32', 'Int64', 'Int16', 'Byte', 'Single', 'Double', 'Decimal', 'Boolean', 'Char',
      'string', 'String', 'object', 'Object', 'void', 'Void',
      'List', 'Dictionary', 'HashSet', 'IEnumerable', 'IList', 'IDictionary',
      'Task', 'ValueTask', 'CancellationToken',
      'ILogger', 'IConfiguration', 'IOptions',
    ];
    return primitives.some(p => type.includes(p));
  }
}
