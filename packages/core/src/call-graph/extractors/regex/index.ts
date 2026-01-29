/**
 * Regex Extractors Index
 *
 * Exports all regex-based fallback extractors for use when tree-sitter
 * or language-specific parsers are unavailable.
 */

export { BaseRegexExtractor } from './base-regex-extractor.js';
export { TypeScriptRegexExtractor } from './typescript-regex.js';
export { PythonRegexExtractor } from './python-regex.js';
export { PhpRegexExtractor } from './php-regex.js';
export { JavaRegexExtractor } from './java-regex.js';
export { CSharpRegexExtractor } from './csharp-regex.js';
export { GoRegexExtractor, createGoRegexExtractor } from './go-regex.js';
export { RustRegexExtractor, createRustRegexExtractor } from './rust-regex.js';
export { CppRegexExtractor, createCppRegexExtractor } from './cpp-regex.js';

// Re-export types
export type {
  ExtractionQuality,
  ExtractionMethod,
  RegexPattern,
  LanguagePatterns,
  HybridExtractorConfig,
} from '../types.js';

export {
  EXTRACTION_CONFIDENCE,
  DEFAULT_HYBRID_CONFIG,
  createDefaultQuality,
  mergeQualities,
} from '../types.js';

import { CppRegexExtractor } from './cpp-regex.js';
import { CSharpRegexExtractor } from './csharp-regex.js';
import { GoRegexExtractor } from './go-regex.js';
import { JavaRegexExtractor } from './java-regex.js';
import { PhpRegexExtractor } from './php-regex.js';
import { PythonRegexExtractor } from './python-regex.js';
import { RustRegexExtractor } from './rust-regex.js';
import { TypeScriptRegexExtractor } from './typescript-regex.js';

import type { BaseRegexExtractor } from './base-regex-extractor.js';
import type { CallGraphLanguage } from '../../types.js';

/**
 * Get the appropriate regex extractor for a language
 */
export function getRegexExtractor(language: CallGraphLanguage): BaseRegexExtractor | null {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return new TypeScriptRegexExtractor();
    case 'python':
      return new PythonRegexExtractor();
    case 'php':
      return new PhpRegexExtractor();
    case 'java':
      return new JavaRegexExtractor();
    case 'csharp':
      return new CSharpRegexExtractor();
    case 'go':
      return new GoRegexExtractor();
    case 'rust':
      return new RustRegexExtractor();
    case 'cpp':
      return new CppRegexExtractor();
    default:
      return null;
  }
}

/**
 * Get the appropriate regex extractor for a file path
 */
export function getRegexExtractorForFile(filePath: string): BaseRegexExtractor | null {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  
  // TypeScript/JavaScript
  if (['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].includes(ext)) {
    return new TypeScriptRegexExtractor();
  }
  
  // Python
  if (['.py', '.pyw', '.pyi'].includes(ext)) {
    return new PythonRegexExtractor();
  }
  
  // PHP
  if (['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'].includes(ext)) {
    return new PhpRegexExtractor();
  }
  
  // Java
  if (ext === '.java') {
    return new JavaRegexExtractor();
  }
  
  // C#
  if (ext === '.cs') {
    return new CSharpRegexExtractor();
  }
  
  // Go
  if (ext === '.go') {
    return new GoRegexExtractor();
  }
  
  // Rust
  if (ext === '.rs') {
    return new RustRegexExtractor();
  }
  
  // C++
  if (['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.h'].includes(ext)) {
    return new CppRegexExtractor();
  }
  
  return null;
}
