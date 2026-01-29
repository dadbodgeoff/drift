/**
 * Extractor Compatibility Aliases
 *
 * Provides the old per-language extractor names that delegate to UnifiedDataAccessAdapter.
 * These exist purely for backward compatibility with existing code.
 */

import {
  UnifiedDataAccessAdapter,
  createUnifiedDataAccessAdapter,
} from '../integration/unified-data-access-adapter.js';

import type { DataAccessPoint } from '../../boundaries/types.js';
import type { CallGraphLanguage } from '../../call-graph/types.js';

/**
 * Result type for data access extraction
 */
export interface DataAccessExtractionResult {
  accessPoints: DataAccessPoint[];
  language: string;
  errors: string[];
}

/**
 * Base class for extractor aliases
 */
abstract class ExtractorAlias {
  abstract readonly language: CallGraphLanguage;
  abstract readonly extensions: string[];

  private adapter: UnifiedDataAccessAdapter | null = null;

  protected getAdapter(): UnifiedDataAccessAdapter {
    if (!this.adapter) {
      this.adapter = createUnifiedDataAccessAdapter();
    }
    return this.adapter;
  }

  canHandle(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase();
    return ext ? this.extensions.some(e => e.slice(1) === ext) : false;
  }

  extract(_source: string, _filePath: string): DataAccessExtractionResult {
    throw new Error(
      `${this.constructor.name}.extract() is no longer synchronous. ` +
      'Use extractAsync() or UnifiedDataAccessAdapter.extract().'
    );
  }

  async extractAsync(source: string, filePath: string): Promise<DataAccessExtractionResult> {
    const result = await this.getAdapter().extract(source, filePath);
    return {
      accessPoints: result.accessPoints,
      language: result.language,
      errors: result.errors,
    };
  }
}

export class TypeScriptDataAccessExtractor extends ExtractorAlias {
  readonly language: CallGraphLanguage = 'typescript';
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
}

export class PythonDataAccessExtractor extends ExtractorAlias {
  readonly language: CallGraphLanguage = 'python';
  readonly extensions = ['.py', '.pyw'];
}

export class CSharpDataAccessExtractor extends ExtractorAlias {
  readonly language: CallGraphLanguage = 'csharp';
  readonly extensions = ['.cs'];
}

export class JavaDataAccessExtractor extends ExtractorAlias {
  readonly language: CallGraphLanguage = 'java';
  readonly extensions = ['.java'];
}

export class PhpDataAccessExtractor extends ExtractorAlias {
  readonly language: CallGraphLanguage = 'php';
  readonly extensions = ['.php', '.phtml'];
}

export function createTypeScriptDataAccessExtractor(): TypeScriptDataAccessExtractor {
  return new TypeScriptDataAccessExtractor();
}

export function createPythonDataAccessExtractor(): PythonDataAccessExtractor {
  return new PythonDataAccessExtractor();
}

export function createCSharpDataAccessExtractor(): CSharpDataAccessExtractor {
  return new CSharpDataAccessExtractor();
}

export function createJavaDataAccessExtractor(): JavaDataAccessExtractor {
  return new JavaDataAccessExtractor();
}

export function createPhpDataAccessExtractor(): PhpDataAccessExtractor {
  return new PhpDataAccessExtractor();
}

export function createDataAccessExtractors() {
  return {
    typescript: createTypeScriptDataAccessExtractor(),
    python: createPythonDataAccessExtractor(),
    csharp: createCSharpDataAccessExtractor(),
    java: createJavaDataAccessExtractor(),
    php: createPhpDataAccessExtractor(),
  };
}
