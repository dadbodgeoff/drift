/**
 * Python Language Normalizer
 *
 * Wraps the existing PythonCallGraphExtractor and adds semantic normalization.
 * Supports FastAPI, Flask, and Django framework patterns.
 */

import { PythonCallGraphExtractor } from '../../call-graph/extractors/python-extractor.js';
import { BaseLanguageNormalizer } from '../base-normalizer.js';

import type { CallGraphLanguage, FileExtractionResult, FunctionExtraction } from '../../call-graph/types.js';
import type { NormalizedDecorator, DecoratorArguments } from '../types.js';

/**
 * Python language normalizer
 */
export class PythonNormalizer extends BaseLanguageNormalizer {
  readonly language: CallGraphLanguage = 'python';
  readonly extensions: string[] = ['.py', '.pyw', '.pyi'];

  private extractor = new PythonCallGraphExtractor();

  /**
   * Extract raw data using the existing Python extractor
   */
  protected extractRaw(source: string, filePath: string): FileExtractionResult {
    return this.extractor.extract(source, filePath);
  }

  /**
   * Extract decorator name from Python decorator
   * Python decorators: @decorator or @module.decorator or @decorator(...)
   */
  protected override extractDecoratorName(raw: string): string {
    // Remove @ prefix
    let name = raw.replace(/^@/, '');
    // Remove arguments
    name = name.replace(/\(.*$/, '');
    // Get the last part after dots (e.g., app.route -> route)
    const parts = name.split('.');
    return parts[parts.length - 1] ?? name;
  }

  /**
   * Extract generic arguments from Python decorator
   */
  protected override extractGenericArguments(raw: string): DecoratorArguments {
    const args: DecoratorArguments = {};

    // Extract path from route decorators: @app.route("/path") or @router.get("/path")
    const pathMatch = raw.match(/\(\s*["']([^"']+)["']/);
    if (pathMatch?.[1] !== undefined) {
      args.path = pathMatch[1];
    }

    // Extract methods from Flask route: @app.route("/path", methods=["GET", "POST"])
    const methodsMatch = raw.match(/methods\s*=\s*\[([^\]]+)\]/);
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
   * Extract dependencies from function parameters (FastAPI Depends pattern)
   */
  protected override extractDependencies(
    fn: FunctionExtraction,
    decorators: NormalizedDecorator[]
  ): string[] {
    const deps: string[] = [];

    // Look for Depends() in decorators
    for (const decorator of decorators) {
      if (decorator.name === 'Depends' || decorator.raw.includes('Depends(')) {
        const depMatch = decorator.raw.match(/Depends\s*\(\s*(\w+)/);
        if (depMatch?.[1]) {
          deps.push(depMatch[1]);
        }
      }
    }

    // Also check parameter default values for Depends
    // This is handled by the extractor which creates implicit calls
    // but we can also extract type hints as dependencies
    for (const param of fn.parameters) {
      if (param.type && !this.isPrimitiveOrCommon(param.type)) {
        // Type hints like "user: User" indicate a dependency
        deps.push(param.type);
      }
    }

    return [...new Set(deps)]; // Deduplicate
  }

  /**
   * Check if a type is primitive or common Python type
   */
  private isPrimitiveOrCommon(type: string): boolean {
    const primitives = [
      'int', 'float', 'str', 'bool', 'bytes', 'None', 'Any',
      'List', 'Dict', 'Set', 'Tuple', 'Optional', 'Union',
      'list', 'dict', 'set', 'tuple',
      'Request', 'Response', 'HTTPException',
    ];
    return primitives.includes(type);
  }
}
