/**
 * Language Normalizers Index
 *
 * Exports all language-specific normalizers.
 */

export { JavaNormalizer } from './java-normalizer.js';
export { PythonNormalizer } from './python-normalizer.js';
export { TypeScriptNormalizer } from './typescript-normalizer.js';
export { CSharpNormalizer } from './csharp-normalizer.js';
export { PhpNormalizer } from './php-normalizer.js';

import { CSharpNormalizer } from './csharp-normalizer.js';
import { JavaNormalizer } from './java-normalizer.js';
import { PhpNormalizer } from './php-normalizer.js';
import { PythonNormalizer } from './python-normalizer.js';
import { TypeScriptNormalizer } from './typescript-normalizer.js';

import type { CallGraphLanguage } from '../../call-graph/types.js';
import type { LanguageNormalizer } from '../types.js';

/**
 * Create a normalizer for a specific language
 */
export function createNormalizer(language: CallGraphLanguage): LanguageNormalizer | null {
  switch (language) {
    case 'java':
      return new JavaNormalizer();
    case 'python':
      return new PythonNormalizer();
    case 'typescript':
    case 'javascript':
      return new TypeScriptNormalizer();
    case 'csharp':
      return new CSharpNormalizer();
    case 'php':
      return new PhpNormalizer();
    default:
      return null;
  }
}

/**
 * Create all available normalizers
 */
export function createAllNormalizers(): LanguageNormalizer[] {
  return [
    new JavaNormalizer(),
    new PythonNormalizer(),
    new TypeScriptNormalizer(),
    new CSharpNormalizer(),
    new PhpNormalizer(),
  ];
}

/**
 * Get normalizer for a file based on extension
 */
export function getNormalizerForFile(filePath: string): LanguageNormalizer | null {
  const normalizers = createAllNormalizers();
  for (const normalizer of normalizers) {
    if (normalizer.canHandle(filePath)) {
      return normalizer;
    }
  }
  return null;
}
