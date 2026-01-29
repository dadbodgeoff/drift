/**
 * PHP Regex Extractor
 *
 * Regex-based fallback extractor for PHP when tree-sitter is unavailable.
 */

import { BaseRegexExtractor } from './base-regex-extractor.js';

import type {
  CallGraphLanguage,
  FunctionExtraction,
  CallExtraction,
  ImportExtraction,
  ExportExtraction,
  ClassExtraction,
} from '../../types.js';
import type { LanguagePatterns } from '../types.js';

/**
 * PHP regex patterns
 */
const PHP_PATTERNS: LanguagePatterns = {
  language: 'php',
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  calls: [],
};

/**
 * PHP regex-based extractor
 */
export class PhpRegexExtractor extends BaseRegexExtractor {
  readonly language: CallGraphLanguage = 'php';
  readonly extensions: string[] = ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'];
  protected readonly patterns = PHP_PATTERNS;

  // ==========================================================================
  // Function Extraction
  // ==========================================================================

  protected extractFunctions(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): FunctionExtraction[] {
    const functions: FunctionExtraction[] = [];
    const seen = new Set<string>();

    // Pattern: function name(...) { ... }
    // With optional visibility, static, return type
    const funcPattern = /(?:public|private|protected|static|\s)*function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*\??\s*(\w+))?\s*\{/g;
    let match;

    while ((match = funcPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const paramsStr = match[2] || '';
      const returnType = match[3];
      const startLine = this.getLineNumber(originalSource, match.index);
      const key = `${name}:${startLine}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      const isStatic = match[0].includes('static');
      const isPublic = match[0].includes('public') || (!match[0].includes('private') && !match[0].includes('protected'));
      const isMethod = match[0].includes('public') || match[0].includes('private') || match[0].includes('protected');

      const params = this.parsePhpParameters(paramsStr);

      const funcOpts: Parameters<typeof this.createFunction>[0] = {
        name,
        startLine,
        endLine,
        parameters: params,
        isMethod,
        isStatic,
        isExported: isPublic,
        isConstructor: name === '__construct',
      };
      if (returnType) {funcOpts.returnType = returnType;}

      functions.push(this.createFunction(funcOpts));
    }

    return functions;
  }

  /**
   * Parse PHP parameters
   */
  private parsePhpParameters(paramsStr: string): FunctionExtraction['parameters'] {
    if (!paramsStr.trim()) {return [];}

    const params: FunctionExtraction['parameters'] = [];
    const parts = paramsStr.split(',');

    for (const part of parts) {
      let trimmed = part.trim();
      if (!trimmed) {continue;}

      let type: string | undefined;
      let hasDefault = false;
      const isRest = trimmed.startsWith('...');

      if (isRest) {
        trimmed = trimmed.slice(3);
      }

      // Handle default values
      if (trimmed.includes('=')) {
        hasDefault = true;
        trimmed = trimmed.split('=')[0]!.trim();
      }

      // Handle type hints
      const typeMatch = trimmed.match(/^(\??\w+(?:\|\w+)*)\s+\$(\w+)/);
      if (typeMatch) {
        type = typeMatch[1];
        trimmed = typeMatch[2]!;
      } else {
        // Just variable name
        trimmed = trimmed.replace(/^\$/, '');
      }

      if (trimmed) {
        params.push({ name: trimmed.replace(/^\$/, ''), type, hasDefault, isRest });
      }
    }

    return params;
  }

  // ==========================================================================
  // Class Extraction
  // ==========================================================================

  protected extractClasses(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): ClassExtraction[] {
    const classes: ClassExtraction[] = [];

    // Pattern: class Name extends Base implements Interface { ... }
    const classPattern = /(?:abstract\s+)?(?:final\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/g;
    let match;

    while ((match = classPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      const baseClasses: string[] = [];
      if (match[2]) {baseClasses.push(match[2]);}
      if (match[3]) {
        const interfaces = match[3].split(',').map(i => i.trim()).filter(i => i);
        baseClasses.push(...interfaces);
      }

      // Extract method names
      const classBody = cleanSource.slice(match.index, endIndex);
      const methods = this.extractMethodNames(classBody);

      classes.push(this.createClass({
        name,
        startLine,
        endLine,
        baseClasses,
        methods,
        isExported: true, // PHP classes are always "exported" within namespace
      }));
    }

    // Also extract interfaces and traits
    const interfacePattern = /interface\s+(\w+)(?:\s+extends\s+([^{]+))?\s*\{/g;
    while ((match = interfacePattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      const baseClasses = match[2] ? match[2].split(',').map(i => i.trim()).filter(i => i) : [];

      classes.push(this.createClass({
        name,
        startLine,
        endLine,
        baseClasses,
        methods: [],
        isExported: true,
      }));
    }

    const traitPattern = /trait\s+(\w+)\s*\{/g;
    while ((match = traitPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      const classBody = cleanSource.slice(match.index, endIndex);
      const methods = this.extractMethodNames(classBody);

      classes.push(this.createClass({
        name,
        startLine,
        endLine,
        baseClasses: [],
        methods,
        isExported: true,
      }));
    }

    return classes;
  }

  /**
   * Extract method names from a class body
   */
  private extractMethodNames(classBody: string): string[] {
    const methods: string[] = [];
    const methodPattern = /(?:public|private|protected|static|\s)*function\s+(\w+)\s*\(/g;
    let match;

    while ((match = methodPattern.exec(classBody)) !== null) {
      methods.push(match[1]!);
    }

    return methods;
  }

  // ==========================================================================
  // Import Extraction
  // ==========================================================================

  protected extractImports(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): ImportExtraction[] {
    const imports: ImportExtraction[] = [];

    // Pattern 1: use Namespace\Class;
    // Pattern 2: use Namespace\Class as Alias;
    const usePattern = /use\s+([^;]+);/g;
    let match;

    while ((match = usePattern.exec(cleanSource)) !== null) {
      const useStr = match[1]!.trim();
      const line = this.getLineNumber(originalSource, match.index);

      // Handle grouped use: use Namespace\{Class1, Class2};
      if (useStr.includes('{')) {
        const groupMatch = useStr.match(/^([^{]+)\{([^}]+)\}/);
        if (groupMatch) {
          const prefix = groupMatch[1]!.trim();
          const names = groupMatch[2]!.split(',').map(n => {
            const parts = n.trim().split(/\s+as\s+/);
            const imported = prefix + parts[0]!.trim();
            const local = (parts[1] || parts[0]!.split('\\').pop())!.trim();
            return { imported, local, isDefault: false, isNamespace: false };
          });
          imports.push(this.createImport({ source: prefix, names, line }));
        }
        continue;
      }

      // Handle single use with optional alias
      const parts = useStr.split(/\s+as\s+/);
      const imported = parts[0]!.trim();
      const local = (parts[1] || imported.split('\\').pop())!.trim();

      imports.push(this.createImport({
        source: imported,
        names: [{ imported, local, isDefault: false, isNamespace: false }],
        line,
      }));
    }

    // Pattern: require/include statements
    const requirePattern = /(?:require|include)(?:_once)?\s*\(?['"]([^'"]+)['"]\)?/g;

    while ((match = requirePattern.exec(cleanSource)) !== null) {
      const source = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);

      imports.push(this.createImport({
        source,
        names: [{ imported: source, local: source, isDefault: false, isNamespace: false }],
        line,
      }));
    }

    return imports;
  }

  // ==========================================================================
  // Export Extraction
  // ==========================================================================

  protected extractExports(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): ExportExtraction[] {
    const exports: ExportExtraction[] = [];

    // PHP doesn't have explicit exports, but we can detect namespace declarations
    const namespacePattern = /namespace\s+([^;{]+)/g;
    let match;

    while ((match = namespacePattern.exec(cleanSource)) !== null) {
      const name = match[1]!.trim();
      const line = this.getLineNumber(originalSource, match.index);

      exports.push(this.createExport({ name, line }));
    }

    return exports;
  }

  // ==========================================================================
  // Call Extraction
  // ==========================================================================

  protected extractCalls(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): CallExtraction[] {
    const calls: CallExtraction[] = [];
    const seen = new Set<string>();

    // Pattern 1: Object method calls - $obj->method(...)
    const methodCallPattern = /(\$\w+)->(\w+)\s*\(/g;
    let match;

    while ((match = methodCallPattern.exec(cleanSource)) !== null) {
      const receiver = match[1]!;
      const calleeName = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${receiver}->${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      calls.push(this.createCall({
        calleeName,
        receiver,
        fullExpression: `${receiver}->${calleeName}`,
        line,
        isMethodCall: true,
      }));
    }

    // Pattern 2: Static method calls - Class::method(...)
    const staticCallPattern = /(\w+)::(\w+)\s*\(/g;

    while ((match = staticCallPattern.exec(cleanSource)) !== null) {
      const receiver = match[1]!;
      const calleeName = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${receiver}::${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      // Skip self:: and parent:: for now
      if (receiver === 'self' || receiver === 'parent' || receiver === 'static') {continue;}

      calls.push(this.createCall({
        calleeName,
        receiver,
        fullExpression: `${receiver}::${calleeName}`,
        line,
        isMethodCall: true,
      }));
    }

    // Pattern 3: Direct function calls - func(...)
    const funcCallPattern = /(?<![->:\w])(\w+)\s*\(/g;

    while ((match = funcCallPattern.exec(cleanSource)) !== null) {
      const calleeName = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      // Skip keywords and language constructs
      if (['if', 'for', 'foreach', 'while', 'switch', 'catch', 'function', 'return', 'throw', 'new', 'array', 'list', 'isset', 'empty', 'unset', 'echo', 'print'].includes(calleeName)) {continue;}

      calls.push(this.createCall({
        calleeName,
        fullExpression: calleeName,
        line,
      }));
    }

    // Pattern 4: Constructor calls - new Class(...)
    const newPattern = /new\s+(\w+)\s*\(/g;

    while ((match = newPattern.exec(cleanSource)) !== null) {
      const calleeName = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `new:${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      calls.push(this.createCall({
        calleeName,
        fullExpression: `new ${calleeName}`,
        line,
        isConstructorCall: true,
      }));
    }

    return calls;
  }
}
