/**
 * Test Topology Regex Extractors
 *
 * Regex-based fallback extractors for test information when tree-sitter is unavailable.
 */

export {
  TypeScriptTestRegexExtractor,
  createTypeScriptTestRegexExtractor,
} from './typescript-test-regex.js';

export {
  PythonTestRegexExtractor,
  createPythonTestRegexExtractor,
} from './python-test-regex.js';

export {
  JavaTestRegexExtractor,
  createJavaTestRegexExtractor,
} from './java-test-regex.js';

export {
  CSharpTestRegexExtractor,
  createCSharpTestRegexExtractor,
} from './csharp-test-regex.js';

export {
  PHPTestRegexExtractor,
  createPHPTestRegexExtractor,
} from './php-test-regex.js';

export {
  GoTestRegexExtractor,
  createGoTestRegexExtractor,
} from './go-test-regex.js';

export {
  RustTestRegexExtractor,
  createRustTestRegexExtractor,
} from './rust-test-regex.js';

import { CSharpTestRegexExtractor } from './csharp-test-regex.js';
import { GoTestRegexExtractor } from './go-test-regex.js';
import { JavaTestRegexExtractor } from './java-test-regex.js';
import { PHPTestRegexExtractor } from './php-test-regex.js';
import { PythonTestRegexExtractor } from './python-test-regex.js';
import { RustTestRegexExtractor } from './rust-test-regex.js';
import { TypeScriptTestRegexExtractor } from './typescript-test-regex.js';

import type { TestExtraction } from '../../types.js';

/**
 * Get a regex extractor for a file
 */
export function getTestRegexExtractor(filePath: string): {
  extract: (content: string, filePath: string) => TestExtraction;
} | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'mts':
    case 'cts':
      return new TypeScriptTestRegexExtractor();
    case 'py':
      return new PythonTestRegexExtractor();
    case 'java':
      return new JavaTestRegexExtractor();
    case 'cs':
      return new CSharpTestRegexExtractor();
    case 'php':
      return new PHPTestRegexExtractor();
    case 'go':
      return new GoTestRegexExtractor();
    case 'rs':
      return new RustTestRegexExtractor();
    default:
      return null;
  }
}
