/**
 * C++ Analysis Module
 *
 * Exports C++ analyzer and related types.
 *
 * @license Apache-2.0
 */

export {
  CppAnalyzer,
  createCppAnalyzer,
  type CppAnalyzerOptions,
  type CppAnalysisResult,
  type CppModule,
  type CppAnalysisStats,
  type CppClass,
  type CppClassesResult,
  type CppMemoryPattern,
  type CppMemoryResult,
  type CppMemoryIssue,
  type CppTemplate,
  type CppTemplatesResult,
  type CppVirtualMethod,
  type CppVirtualResult,
  type CppPolymorphicHierarchy,
  type CppDataAccessResult,
} from './cpp-analyzer.js';
