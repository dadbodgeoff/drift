/**
 * C++ Analyzer
 *
 * Main analyzer for C++ projects. Uses a unified architecture with:
 * - Primary: Tree-sitter AST parsing via CppHybridExtractor
 * - Fallback: Regex patterns when tree-sitter unavailable
 *
 * Provides comprehensive analysis of:
 * - Classes, structs, and inheritance hierarchies
 * - Virtual functions and polymorphism
 * - Templates and specializations
 * - Memory management patterns (smart pointers, RAII)
 * - Framework detection (Qt, Boost, Unreal Engine)
 *
 * @license Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';

import { extractCppDataAccess } from '../call-graph/extractors/cpp-data-access-extractor.js';
import { createCppHybridExtractor, type CppHybridExtractor } from '../call-graph/extractors/cpp-hybrid-extractor.js';
import { CppTreeSitterParser } from '../parsers/tree-sitter/tree-sitter-cpp-parser.js';

import type { DataAccessPoint } from '../boundaries/types.js';
import type { FunctionExtraction, ClassExtraction, CallExtraction } from '../call-graph/types.js';

// ============================================================================
// Types
// ============================================================================

export interface CppAnalyzerOptions {
  rootDir: string;
  verbose?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
}

export interface CppAnalysisResult {
  projectName: string | null;
  cppStandard: string | null;
  detectedFrameworks: string[];
  modules: CppModule[];
  stats: CppAnalysisStats;
  functions: FunctionExtraction[];
  classes: ClassExtraction[];
  calls: CallExtraction[];
}

export interface CppModule {
  name: string;
  path: string;
  files: string[];
  functions: FunctionExtraction[];
  classes: ClassExtraction[];
}

export interface CppAnalysisStats {
  fileCount: number;
  headerCount: number;
  sourceCount: number;
  functionCount: number;
  classCount: number;
  structCount: number;
  templateCount: number;
  virtualMethodCount: number;
  linesOfCode: number;
  testFileCount: number;
  analysisTimeMs: number;
}

export interface CppClass {
  name: string;
  kind: 'class' | 'struct';
  file: string;
  line: number;
  baseClasses: string[];
  virtualMethods: string[];
  isTemplate: boolean;
  accessSpecifier: 'public' | 'protected' | 'private' | 'none';
}

export interface CppClassesResult {
  classes: CppClass[];
  byKind: Record<string, number>;
  inheritanceDepth: Record<string, number>;
}

export interface CppMemoryPattern {
  type: 'unique_ptr' | 'shared_ptr' | 'weak_ptr' | 'raw_pointer' | 'new' | 'delete' | 'malloc' | 'free' | 'raii';
  file: string;
  line: number;
  context: string;
  isIssue: boolean;
  suggestion?: string;
}

export interface CppMemoryResult {
  stats: {
    uniquePtrs: number;
    sharedPtrs: number;
    weakPtrs: number;
    rawPointers: number;
    newCalls: number;
    deleteCalls: number;
    mallocCalls: number;
    freeCalls: number;
  };
  patterns: CppMemoryPattern[];
  issues: CppMemoryIssue[];
  raiiClasses: string[];
}

export interface CppMemoryIssue {
  type: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}

export interface CppTemplate {
  name: string;
  kind: 'class' | 'function';
  file: string;
  line: number;
  parameters: string[];
  specializations: string[];
}

export interface CppTemplatesResult {
  templates: CppTemplate[];
  byKind: Record<string, number>;
  mostSpecialized: string[];
}

export interface CppVirtualMethod {
  name: string;
  className: string;
  file: string;
  line: number;
  isPureVirtual: boolean;
  overrides: string[];
}

export interface CppVirtualResult {
  virtualMethods: CppVirtualMethod[];
  abstractClasses: string[];
  polymorphicHierarchies: CppPolymorphicHierarchy[];
}

export interface CppPolymorphicHierarchy {
  baseClass: string;
  derivedClasses: string[];
  depth: number;
}

export interface CppDataAccessResult {
  accessPoints: DataAccessPoint[];
  tables: string[];
  frameworks: string[];
  byOperation: Record<string, number>;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Partial<CppAnalyzerOptions> = {
  verbose: false,
  includePatterns: ['**/*.cpp', '**/*.cc', '**/*.cxx', '**/*.hpp', '**/*.hh', '**/*.h'],
  excludePatterns: ['**/build/**', '**/cmake-build-*/**', '**/node_modules/**', '**/.git/**', '**/third_party/**', '**/vendor/**'],
};

// ============================================================================
// C++ Analyzer Implementation
// ============================================================================

export class CppAnalyzer {
  private config: CppAnalyzerOptions;
  private extractor: CppHybridExtractor;
  private astParser: CppTreeSitterParser;

  constructor(options: CppAnalyzerOptions) {
    this.config = { ...DEFAULT_CONFIG, ...options } as CppAnalyzerOptions;
    this.extractor = createCppHybridExtractor();
    this.astParser = new CppTreeSitterParser();
  }

  /**
   * Full project analysis
   */
  async analyze(): Promise<CppAnalysisResult> {
    const startTime = Date.now();

    const cppFiles = await this.findCppFiles();
    const projectInfo = await this.detectProjectInfo();

    const modules = new Map<string, CppModule>();
    const allFunctions: FunctionExtraction[] = [];
    const allClasses: ClassExtraction[] = [];
    const allCalls: CallExtraction[] = [];
    const detectedFrameworks = new Set<string>();

    let linesOfCode = 0;
    let headerCount = 0;
    let sourceCount = 0;
    let testFileCount = 0;
    let templateCount = 0;
    let virtualMethodCount = 0;

    for (const file of cppFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const relPath = path.relative(this.config.rootDir, file);
      linesOfCode += source.split('\n').length;

      // Count file types
      if (this.isHeaderFile(file)) {
        headerCount++;
      } else {
        sourceCount++;
      }

      const isTestFile = file.includes('/test') || file.includes('_test.') || file.includes('Test.');
      if (isTestFile) {testFileCount++;}

      // Extract code structure using hybrid extractor (AST + regex fallback)
      const result = this.extractor.extract(source, relPath);

      // Detect frameworks from includes
      for (const imp of result.imports) {
        const framework = this.detectFramework(imp.source);
        if (framework) {detectedFrameworks.add(framework);}
      }

      // Count templates and virtual methods
      const astResult = this.astParser.parse(source);
      templateCount += astResult.classes.filter(c => c.isTemplate).length;
      templateCount += astResult.functions.filter(f => f.templateParams.length > 0).length;
      virtualMethodCount += astResult.functions.filter(f => f.isVirtual).length;

      // Organize by module (directory)
      const moduleName = this.getModuleName(relPath);
      const modulePath = path.dirname(file);

      if (!modules.has(modulePath)) {
        modules.set(modulePath, {
          name: moduleName,
          path: modulePath,
          files: [],
          functions: [],
          classes: [],
        });
      }

      const module = modules.get(modulePath)!;
      module.files.push(relPath);
      module.functions.push(...result.functions);
      module.classes.push(...result.classes);

      allFunctions.push(...result.functions);
      allClasses.push(...result.classes);
      allCalls.push(...result.calls);
    }

    const analysisTimeMs = Date.now() - startTime;

    // Count classes vs structs
    const classCount = allClasses.filter(c => !c.name.startsWith('struct ')).length;
    const structCount = allClasses.length - classCount;

    return {
      projectName: projectInfo.projectName,
      cppStandard: projectInfo.cppStandard,
      detectedFrameworks: Array.from(detectedFrameworks),
      modules: Array.from(modules.values()),
      stats: {
        fileCount: cppFiles.length,
        headerCount,
        sourceCount,
        functionCount: allFunctions.length,
        classCount,
        structCount,
        templateCount,
        virtualMethodCount,
        linesOfCode,
        testFileCount,
        analysisTimeMs,
      },
      functions: allFunctions,
      classes: allClasses,
      calls: allCalls,
    };
  }

  /**
   * Analyze classes and inheritance
   */
  async analyzeClasses(): Promise<CppClassesResult> {
    const cppFiles = await this.findCppFiles();
    const classes: CppClass[] = [];
    const inheritanceDepth: Record<string, number> = {};

    for (const file of cppFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const relPath = path.relative(this.config.rootDir, file);

      const astResult = this.astParser.parse(source);

      for (const cls of astResult.classes) {
        classes.push({
          name: cls.name,
          kind: cls.kind,
          file: relPath,
          line: cls.startLine,
          baseClasses: cls.baseClasses.map(b => b.name),
          virtualMethods: cls.virtualMethods,
          isTemplate: cls.isTemplate,
          accessSpecifier: cls.accessSpecifier,
        });
      }
    }

    // Calculate inheritance depth
    const classMap = new Map(classes.map(c => [c.name, c]));
    for (const cls of classes) {
      inheritanceDepth[cls.name] = this.calculateInheritanceDepth(cls.name, classMap, new Set());
    }

    const byKind: Record<string, number> = {
      class: classes.filter(c => c.kind === 'class').length,
      struct: classes.filter(c => c.kind === 'struct').length,
    };

    return { classes, byKind, inheritanceDepth };
  }

  /**
   * Analyze memory management patterns
   */
  async analyzeMemory(): Promise<CppMemoryResult> {
    const cppFiles = await this.findCppFiles();
    const patterns: CppMemoryPattern[] = [];
    const issues: CppMemoryIssue[] = [];
    const raiiClasses = new Set<string>();

    let uniquePtrs = 0;
    let sharedPtrs = 0;
    let weakPtrs = 0;
    let rawPointers = 0;
    let newCalls = 0;
    let deleteCalls = 0;
    let mallocCalls = 0;
    let freeCalls = 0;

    for (const file of cppFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const relPath = path.relative(this.config.rootDir, file);
      const lines = source.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineNum = i + 1;

        // Smart pointers
        if (/std::unique_ptr|unique_ptr</.test(line)) {
          uniquePtrs++;
          patterns.push({ type: 'unique_ptr', file: relPath, line: lineNum, context: line.trim(), isIssue: false });
        }
        if (/std::shared_ptr|shared_ptr</.test(line)) {
          sharedPtrs++;
          patterns.push({ type: 'shared_ptr', file: relPath, line: lineNum, context: line.trim(), isIssue: false });
        }
        if (/std::weak_ptr|weak_ptr</.test(line)) {
          weakPtrs++;
          patterns.push({ type: 'weak_ptr', file: relPath, line: lineNum, context: line.trim(), isIssue: false });
        }

        // Raw pointers (simplified detection)
        if (/\w+\s*\*\s+\w+\s*[=;]/.test(line) && !/unique_ptr|shared_ptr|weak_ptr/.test(line)) {
          rawPointers++;
        }

        // new/delete
        if (/\bnew\s+\w/.test(line)) {
          newCalls++;
          patterns.push({ type: 'new', file: relPath, line: lineNum, context: line.trim(), isIssue: true, suggestion: 'Consider using std::make_unique or std::make_shared' });
        }
        if (/\bdelete\s/.test(line)) {
          deleteCalls++;
          patterns.push({ type: 'delete', file: relPath, line: lineNum, context: line.trim(), isIssue: true, suggestion: 'Consider using smart pointers for automatic memory management' });
        }

        // malloc/free
        if (/\bmalloc\s*\(/.test(line)) {
          mallocCalls++;
          patterns.push({ type: 'malloc', file: relPath, line: lineNum, context: line.trim(), isIssue: true, suggestion: 'Consider using new or smart pointers instead of malloc' });
          issues.push({
            type: 'c-style-allocation',
            file: relPath,
            line: lineNum,
            message: 'C-style memory allocation detected',
            suggestion: 'Use new/delete or smart pointers for type-safe memory management',
          });
        }
        if (/\bfree\s*\(/.test(line)) {
          freeCalls++;
          patterns.push({ type: 'free', file: relPath, line: lineNum, context: line.trim(), isIssue: true, suggestion: 'Consider using smart pointers instead of manual free' });
        }
      }

      // Detect RAII classes (classes with destructors)
      const astResult = this.astParser.parse(source);
      for (const cls of astResult.classes) {
        const hasDestructor = cls.methods.some(m => m.startsWith('~'));
        if (hasDestructor) {
          raiiClasses.add(cls.name);
        }
      }
    }

    // Check for potential memory leaks (new without corresponding delete in same scope)
    if (newCalls > deleteCalls + uniquePtrs + sharedPtrs) {
      issues.push({
        type: 'potential-leak',
        file: 'project',
        line: 0,
        message: `Potential memory leak: ${newCalls} new calls but only ${deleteCalls + uniquePtrs + sharedPtrs} delete/smart pointer usages`,
        suggestion: 'Ensure all allocations are properly managed with smart pointers or explicit delete',
      });
    }

    return {
      stats: {
        uniquePtrs,
        sharedPtrs,
        weakPtrs,
        rawPointers,
        newCalls,
        deleteCalls,
        mallocCalls,
        freeCalls,
      },
      patterns,
      issues,
      raiiClasses: Array.from(raiiClasses),
    };
  }

  /**
   * Analyze templates
   */
  async analyzeTemplates(): Promise<CppTemplatesResult> {
    const cppFiles = await this.findCppFiles();
    const templates: CppTemplate[] = [];
    const specializationCount: Record<string, number> = {};

    for (const file of cppFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const relPath = path.relative(this.config.rootDir, file);

      const astResult = this.astParser.parse(source);

      // Template classes
      for (const cls of astResult.classes) {
        if (cls.isTemplate) {
          templates.push({
            name: cls.name,
            kind: 'class',
            file: relPath,
            line: cls.startLine,
            parameters: cls.templateParams.map(p => p.name),
            specializations: [],
          });
        }
      }

      // Template functions
      for (const fn of astResult.functions) {
        if (fn.templateParams.length > 0) {
          templates.push({
            name: fn.name,
            kind: 'function',
            file: relPath,
            line: fn.startLine,
            parameters: fn.templateParams.map(p => p.name),
            specializations: [],
          });
        }
      }
    }

    const byKind: Record<string, number> = {
      class: templates.filter(t => t.kind === 'class').length,
      function: templates.filter(t => t.kind === 'function').length,
    };

    // Find most specialized templates
    const mostSpecialized = Object.entries(specializationCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);

    return { templates, byKind, mostSpecialized };
  }

  /**
   * Analyze virtual functions and polymorphism
   */
  async analyzeVirtual(): Promise<CppVirtualResult> {
    const cppFiles = await this.findCppFiles();
    const virtualMethods: CppVirtualMethod[] = [];
    const abstractClasses = new Set<string>();
    const classHierarchy = new Map<string, string[]>();

    for (const file of cppFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const relPath = path.relative(this.config.rootDir, file);

      const astResult = this.astParser.parse(source);

      for (const cls of astResult.classes) {
        // Track inheritance
        if (cls.baseClasses.length > 0) {
          for (const base of cls.baseClasses) {
            const existing = classHierarchy.get(base.name) ?? [];
            existing.push(cls.name);
            classHierarchy.set(base.name, existing);
          }
        }

        // Check for abstract classes (has pure virtual methods)
        const hasPureVirtual = cls.virtualMethods.some(m => m.includes('= 0'));
        if (hasPureVirtual) {
          abstractClasses.add(cls.name);
        }
      }

      for (const fn of astResult.functions) {
        if (fn.isVirtual) {
          virtualMethods.push({
            name: fn.name,
            className: fn.className ?? 'unknown',
            file: relPath,
            line: fn.startLine,
            isPureVirtual: fn.isPureVirtual,
            overrides: [],
          });
        }
      }
    }

    // Build polymorphic hierarchies
    const polymorphicHierarchies: CppPolymorphicHierarchy[] = [];
    for (const [baseClass, derivedClasses] of classHierarchy) {
      if (derivedClasses.length > 0) {
        polymorphicHierarchies.push({
          baseClass,
          derivedClasses,
          depth: this.calculateHierarchyDepth(baseClass, classHierarchy),
        });
      }
    }

    return {
      virtualMethods,
      abstractClasses: Array.from(abstractClasses),
      polymorphicHierarchies,
    };
  }

  /**
   * Analyze database access patterns
   */
  async analyzeDataAccess(): Promise<CppDataAccessResult> {
    const cppFiles = await this.findCppFiles();
    const allAccessPoints: DataAccessPoint[] = [];
    const tables = new Set<string>();
    const frameworks = new Set<string>();
    const byOperation: Record<string, number> = {
      read: 0,
      write: 0,
      delete: 0,
      unknown: 0,
    };

    for (const file of cppFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const relPath = path.relative(this.config.rootDir, file);

      const result = extractCppDataAccess(source, relPath);
      
      allAccessPoints.push(...result.accessPoints);
      result.tables.forEach(t => tables.add(t));
      result.frameworks.forEach(f => frameworks.add(f));

      for (const ap of result.accessPoints) {
        byOperation[ap.operation] = (byOperation[ap.operation] ?? 0) + 1;
      }
    }

    return {
      accessPoints: allAccessPoints,
      tables: Array.from(tables),
      frameworks: Array.from(frameworks),
      byOperation,
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async findCppFiles(): Promise<string[]> {
    const results: string[] = [];
    const excludePatterns = this.config.excludePatterns ?? ['build', 'cmake-build', 'node_modules', '.git'];

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.config.rootDir, fullPath);

        const shouldExclude = excludePatterns.some(pattern => {
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
            return regex.test(relativePath);
          }
          return relativePath.includes(pattern.replace(/\*\*/g, ''));
        });

        if (shouldExclude) {continue;}

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && this.isCppFile(entry.name)) {
          results.push(fullPath);
        }
      }
    };

    await walk(this.config.rootDir);
    return results;
  }

  private isCppFile(filename: string): boolean {
    const extensions = ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.h'];
    return extensions.some(ext => filename.endsWith(ext));
  }

  private isHeaderFile(filename: string): boolean {
    const extensions = ['.hpp', '.hh', '.hxx', '.h++', '.h'];
    return extensions.some(ext => filename.endsWith(ext));
  }

  private async detectProjectInfo(): Promise<{
    projectName: string | null;
    cppStandard: string | null;
  }> {
    // Try CMakeLists.txt
    const cmakePath = path.join(this.config.rootDir, 'CMakeLists.txt');
    try {
      const content = await fs.promises.readFile(cmakePath, 'utf-8');
      const projectMatch = content.match(/project\s*\(\s*(\w+)/i);
      const standardMatch = content.match(/CMAKE_CXX_STANDARD\s+(\d+)/i);

      return {
        projectName: projectMatch?.[1] ?? null,
        cppStandard: standardMatch ? `C++${standardMatch[1]}` : null,
      };
    } catch {
      // Try other build systems
    }

    return { projectName: null, cppStandard: null };
  }

  private getModuleName(filePath: string): string {
    const parts = filePath.split(path.sep);
    return parts[0] === 'src' ? parts[1] ?? 'main' : parts[0] ?? 'main';
  }

  private detectFramework(includePath: string): string | null {
    const frameworks: Record<string, string> = {
      'QApplication': 'Qt',
      'QWidget': 'Qt',
      'QObject': 'Qt',
      'QString': 'Qt',
      'boost/': 'Boost',
      'Engine.h': 'Unreal Engine',
      'CoreMinimal.h': 'Unreal Engine',
      'UObject': 'Unreal Engine',
      'SFML/': 'SFML',
      'SDL': 'SDL',
      'opencv': 'OpenCV',
      'Eigen/': 'Eigen',
      'gtest/': 'Google Test',
      'catch2/': 'Catch2',
    };

    for (const [pattern, name] of Object.entries(frameworks)) {
      if (includePath.includes(pattern)) {return name;}
    }

    return null;
  }

  private calculateInheritanceDepth(
    className: string,
    classMap: Map<string, CppClass>,
    visited: Set<string>
  ): number {
    if (visited.has(className)) {return 0;}
    visited.add(className);

    const cls = classMap.get(className);
    if (!cls || cls.baseClasses.length === 0) {return 0;}

    let maxDepth = 0;
    for (const base of cls.baseClasses) {
      const depth = this.calculateInheritanceDepth(base, classMap, visited);
      maxDepth = Math.max(maxDepth, depth);
    }

    return maxDepth + 1;
  }

  private calculateHierarchyDepth(
    baseClass: string,
    hierarchy: Map<string, string[]>,
    visited: Set<string> = new Set()
  ): number {
    if (visited.has(baseClass)) {return 0;}
    visited.add(baseClass);

    const derived = hierarchy.get(baseClass);
    if (!derived || derived.length === 0) {return 1;}

    let maxDepth = 0;
    for (const d of derived) {
      const depth = this.calculateHierarchyDepth(d, hierarchy, visited);
      maxDepth = Math.max(maxDepth, depth);
    }

    return maxDepth + 1;
  }
}

/**
 * Factory function
 */
export function createCppAnalyzer(options: CppAnalyzerOptions): CppAnalyzer {
  return new CppAnalyzer(options);
}
