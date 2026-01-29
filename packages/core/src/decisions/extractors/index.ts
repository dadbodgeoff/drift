/**
 * Commit Extractors Module
 *
 * Language-specific extractors for semantic commit analysis.
 */

// Base extractor
export {
  BaseCommitExtractor,
  type CommitExtractorOptions,
  type ExtractionContext,
} from './base-commit-extractor.js';

// Language-specific extractors
export {
  TypeScriptCommitExtractor,
  createTypeScriptCommitExtractor,
} from './typescript-commit-extractor.js';

export {
  PythonCommitExtractor,
  createPythonCommitExtractor,
} from './python-commit-extractor.js';

export {
  JavaCommitExtractor,
  createJavaCommitExtractor,
} from './java-commit-extractor.js';

export {
  CSharpCommitExtractor,
  createCSharpCommitExtractor,
} from './csharp-commit-extractor.js';

export {
  PhpCommitExtractor,
  createPhpCommitExtractor,
} from './php-commit-extractor.js';

// ============================================================================
// Factory Functions
// ============================================================================

import { CSharpCommitExtractor } from './csharp-commit-extractor.js';
import { JavaCommitExtractor } from './java-commit-extractor.js';
import { PhpCommitExtractor } from './php-commit-extractor.js';
import { PythonCommitExtractor } from './python-commit-extractor.js';
import { TypeScriptCommitExtractor } from './typescript-commit-extractor.js';

import type { DecisionLanguage } from '../types.js';
import type { CommitExtractorOptions } from './base-commit-extractor.js';

/**
 * Create an extractor for a specific language
 */
export function createCommitExtractor(
  language: DecisionLanguage,
  options: CommitExtractorOptions
): TypeScriptCommitExtractor | PythonCommitExtractor | JavaCommitExtractor | CSharpCommitExtractor | PhpCommitExtractor {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return new TypeScriptCommitExtractor(options);
    case 'python':
      return new PythonCommitExtractor(options);
    case 'java':
      return new JavaCommitExtractor(options);
    case 'csharp':
      return new CSharpCommitExtractor(options);
    case 'php':
      return new PhpCommitExtractor(options);
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

/**
 * Create all extractors
 */
export function createAllCommitExtractors(
  options: CommitExtractorOptions
): Map<DecisionLanguage, TypeScriptCommitExtractor | PythonCommitExtractor | JavaCommitExtractor | CSharpCommitExtractor | PhpCommitExtractor> {
  const extractors = new Map<DecisionLanguage, TypeScriptCommitExtractor | PythonCommitExtractor | JavaCommitExtractor | CSharpCommitExtractor | PhpCommitExtractor>();

  extractors.set('typescript', new TypeScriptCommitExtractor(options));
  extractors.set('javascript', new TypeScriptCommitExtractor(options));
  extractors.set('python', new PythonCommitExtractor(options));
  extractors.set('java', new JavaCommitExtractor(options));
  extractors.set('csharp', new CSharpCommitExtractor(options));
  extractors.set('php', new PhpCommitExtractor(options));

  return extractors;
}

/**
 * Get the appropriate extractor for a file
 */
export function getExtractorForFile(
  filePath: string,
  extractors: Map<DecisionLanguage, TypeScriptCommitExtractor | PythonCommitExtractor | JavaCommitExtractor | CSharpCommitExtractor | PhpCommitExtractor>
): TypeScriptCommitExtractor | PythonCommitExtractor | JavaCommitExtractor | CSharpCommitExtractor | PhpCommitExtractor | null {
  for (const extractor of extractors.values()) {
    if (extractor.canHandle(filePath)) {
      return extractor;
    }
  }
  return null;
}
