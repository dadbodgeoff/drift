/**
 * Normalization Module Exports
 */

export { BaseNormalizer } from './base-normalizer.js';
export { TypeScriptNormalizer } from './typescript-normalizer.js';
export { PythonNormalizer } from './python-normalizer.js';
export { JavaNormalizer } from './java-normalizer.js';
export { PhpNormalizer } from './php-normalizer.js';
export { CSharpNormalizer } from './csharp-normalizer.js';
export { GoNormalizer } from './go-normalizer.js';
export { RustNormalizer } from './rust-normalizer.js';
export { CppNormalizer } from './cpp-normalizer.js';

import { CppNormalizer } from './cpp-normalizer.js';
import { CSharpNormalizer } from './csharp-normalizer.js';
import { GoNormalizer } from './go-normalizer.js';
import { JavaNormalizer } from './java-normalizer.js';
import { PhpNormalizer } from './php-normalizer.js';
import { PythonNormalizer } from './python-normalizer.js';
import { RustNormalizer } from './rust-normalizer.js';
import { TypeScriptNormalizer } from './typescript-normalizer.js';

import type { UnifiedLanguage, CallChainNormalizer } from '../types.js';

/**
 * Normalizer registry
 */
const normalizers: Map<UnifiedLanguage, CallChainNormalizer> = new Map();

/**
 * Get a normalizer for a language
 */
export function getNormalizer(language: UnifiedLanguage): CallChainNormalizer | null {
  if (normalizers.has(language)) {
    return normalizers.get(language)!;
  }

  let normalizer: CallChainNormalizer | null = null;

  switch (language) {
    case 'typescript':
    case 'javascript':
      normalizer = new TypeScriptNormalizer();
      break;
    case 'python':
      normalizer = new PythonNormalizer();
      break;
    case 'java':
      normalizer = new JavaNormalizer();
      break;
    case 'php':
      normalizer = new PhpNormalizer();
      break;
    case 'csharp':
      normalizer = new CSharpNormalizer();
      break;
    case 'go':
      normalizer = new GoNormalizer();
      break;
    case 'rust':
      normalizer = new RustNormalizer();
      break;
    case 'cpp':
      normalizer = new CppNormalizer();
      break;
  }

  if (normalizer) {
    normalizers.set(language, normalizer);
  }

  return normalizer;
}

/**
 * Get all available normalizers
 */
export function getAvailableNormalizers(): UnifiedLanguage[] {
  return ['typescript', 'javascript', 'python', 'java', 'php', 'csharp', 'go', 'rust', 'cpp'];
}

/**
 * Reset normalizer cache (for testing)
 */
export function resetNormalizers(): void {
  normalizers.clear();
}
