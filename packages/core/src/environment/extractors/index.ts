/**
 * Environment Variable Extractors
 *
 * Language-specific extractors for detecting environment variable access patterns.
 */

export { BaseEnvExtractor } from './base-env-extractor.js';
export { TypeScriptEnvExtractor, createTypeScriptEnvExtractor } from './typescript-env-extractor.js';
export { PythonEnvExtractor, createPythonEnvExtractor } from './python-env-extractor.js';
export { JavaEnvExtractor, createJavaEnvExtractor } from './java-env-extractor.js';
export { CSharpEnvExtractor, createCSharpEnvExtractor } from './csharp-env-extractor.js';
export { PhpEnvExtractor, createPhpEnvExtractor } from './php-env-extractor.js';
export { GoEnvExtractor, createGoEnvExtractor } from './go-env-extractor.js';
export { RustEnvExtractor, createRustEnvExtractor } from './rust-env-extractor.js';
export { CppEnvExtractor, createCppEnvExtractor } from './cpp-env-extractor.js';
