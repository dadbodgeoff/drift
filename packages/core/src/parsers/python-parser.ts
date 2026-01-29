/**
 * Python Parser - Python parsing for AST extraction
 *
 * Extracts imports, classes, functions, and decorators from
 * Python files using regex-based parsing.
 *
 * @requirements 3.2
 */

import { BaseParser } from './base-parser.js';

import type { AST, ASTNode, Language, ParseResult, Position } from './types.js';

/**
 * Information about a Python import statement
 */
export interface PythonImportInfo {
  /** Module being imported (e.g., 'os', 'typing') */
  module: string;
  /** Names imported from the module */
  names: ImportedName[];
  /** Whether this is a 'from ... import' statement */
  isFromImport: boolean;
  /** Import level for relative imports (0 = absolute, 1 = ., 2 = .., etc.) */
  level: number;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * A single imported name with optional alias
 */
export interface ImportedName {
  /** Original name */
  name: string;
  /** Alias if using 'as' */
  alias: string | null;
}

/**
 * Information about a Python class
 */
export interface PythonClassInfo {
  /** Class name */
  name: string;
  /** Base classes */
  bases: string[];
  /** Decorators applied to the class */
  decorators: string[];
  /** Method names */
  methods: string[];
  /** Class-level attributes */
  attributes: string[];
  /** Whether the class is a dataclass */
  isDataclass: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a Python function
 */
export interface PythonFunctionInfo {
  /** Function name */
  name: string;
  /** Decorators applied to the function */
  decorators: string[];
  /** Parameter names */
  parameters: string[];
  /** Whether the function is async */
  isAsync: boolean;
  /** Whether the function is a generator (contains yield) */
  isGenerator: boolean;
  /** Return type annotation if present */
  returnType: string | null;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a Python decorator
 */
export interface PythonDecoratorInfo {
  /** Decorator name (without @) */
  name: string;
  /** Arguments if the decorator is called */
  arguments: string | null;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Extended parse result with Python-specific information
 */
export interface PythonParseResult extends ParseResult {
  /** Extracted imports */
  imports: PythonImportInfo[];
  /** Extracted classes */
  classes: PythonClassInfo[];
  /** Extracted functions (module-level) */
  functions: PythonFunctionInfo[];
  /** All decorators found */
  decorators: PythonDecoratorInfo[];
}

/**
 * Python parser using regex-based parsing.
 *
 * Provides AST parsing and extraction of imports, classes,
 * functions, and decorators from Python source files.
 *
 * @requirements 3.2 - Support Python parsing
 * @requirements 3.3 - Graceful degradation on parse errors
 */
export class PythonParser extends BaseParser {
  readonly language: Language = 'python';
  readonly extensions: string[] = ['.py', '.pyw', '.pyi'];

  /**
   * Parse Python source code into an AST.
   *
   * @param source - The source code to parse
   * @param filePath - Optional file path for error reporting
   * @returns PythonParseResult containing the AST and extracted information
   *
   * @requirements 3.2, 3.3
   */
  parse(source: string, _filePath?: string): PythonParseResult {
    try {
      const lines = source.split('\n');
      const rootChildren: ASTNode[] = [];

      // Extract semantic information
      const imports = this.extractImports(source, lines);
      const decorators = this.extractDecorators(source, lines);
      const classes = this.extractClasses(source, lines);
      const functions = this.extractFunctions(source, lines);

      // Build AST nodes for imports
      for (const imp of imports) {
        const importNode = this.createImportNode(imp, source);
        rootChildren.push(importNode);
      }

      // Build AST nodes for classes
      for (const cls of classes) {
        const classNode = this.createClassNode(cls, source);
        rootChildren.push(classNode);
      }

      // Build AST nodes for functions
      for (const func of functions) {
        const funcNode = this.createFunctionNode(func, source);
        rootChildren.push(funcNode);
      }

      // Create root node
      const endPosition = lines.length > 0
        ? { row: lines.length - 1, column: lines[lines.length - 1]?.length ?? 0 }
        : { row: 0, column: 0 };

      const rootNode = this.createNode(
        'Module',
        source,
        { row: 0, column: 0 },
        endPosition,
        rootChildren
      );

      const ast = this.createAST(rootNode, source);

      return {
        ...this.createSuccessResult(ast),
        imports,
        classes,
        functions,
        decorators,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';
      return {
        ...this.createFailureResult([this.createError(errorMessage, { row: 0, column: 0 })]),
        imports: [],
        classes: [],
        functions: [],
        decorators: [],
      };
    }
  }

  /**
   * Query the AST for nodes matching a pattern.
   *
   * Supports querying by node type (e.g., 'ImportStatement', 'ClassDef', 'FunctionDef').
   *
   * @param ast - The AST to query
   * @param pattern - The node type to search for
   * @returns Array of matching AST nodes
   *
   * @requirements 3.5
   */
  query(ast: AST, pattern: string): ASTNode[] {
    return this.findNodesByType(ast, pattern);
  }

  // ============================================
  // Import Extraction
  // ============================================

  /**
   * Extract all import statements from Python source.
   */
  private extractImports(source: string, lines: string[]): PythonImportInfo[] {
    const imports: PythonImportInfo[] = [];

    // Match 'import x' and 'import x as y' statements
    // Use [ \t]* instead of \s* to avoid matching newlines as indentation
    const importRegex = /^([ \t]*)import\s+(.+)$/gm;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(source)) !== null) {
      const lineStart = this.getLineNumber(source, match.index);
      const indent = match[1]?.length ?? 0;
      const importPart = match[2]?.trim() ?? '';

      // Parse the import names
      const names = this.parseImportNames(importPart);

      for (const nameInfo of names) {
        imports.push({
          module: nameInfo.name,
          names: [{ name: nameInfo.name, alias: nameInfo.alias }],
          isFromImport: false,
          level: 0,
          startPosition: { row: lineStart, column: indent },
          endPosition: { row: lineStart, column: indent + (match[0]?.length ?? 0) },
        });
      }
    }

    // Match 'from x import y' statements (including multi-line)
    // Use [ \t]* instead of \s* to avoid matching newlines as indentation
    const fromImportRegex = /^([ \t]*)from\s+(\.*)(\S*)\s+import\s+(.+)$/gm;

    while ((match = fromImportRegex.exec(source)) !== null) {
      const lineStart = this.getLineNumber(source, match.index);
      const indent = match[1]?.length ?? 0;
      const dots = match[2] ?? '';
      const module = match[3] ?? '';
      let importPart = match[4]?.trim() ?? '';

      // Handle parenthesized imports
      if (importPart.startsWith('(')) {
        const endParen = this.findMatchingParen(source, match.index + (match[0]?.indexOf('(') ?? 0));
        if (endParen > 0) {
          importPart = source.slice(match.index + (match[0]?.indexOf('(') ?? 0) + 1, endParen).trim();
        }
      }

      // Parse the imported names
      const names = this.parseImportNames(importPart);
      const endLine = this.getLineNumber(source, match.index + (match[0]?.length ?? 0));

      imports.push({
        module: module,
        names,
        isFromImport: true,
        level: dots.length,
        startPosition: { row: lineStart, column: indent },
        endPosition: { row: endLine, column: (lines[endLine]?.length ?? 0) },
      });
    }

    return imports;
  }

  /**
   * Parse comma-separated import names with optional aliases.
   */
  private parseImportNames(importPart: string): ImportedName[] {
    const names: ImportedName[] = [];

    // Remove parentheses and split by comma
    const cleanPart = importPart.replace(/[()]/g, '').trim();
    const parts = cleanPart.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '\\') {continue;}

      // Check for 'as' alias
      const asMatch = trimmed.match(/^(\S+)\s+as\s+(\S+)$/);
      if (asMatch) {
        names.push({
          name: asMatch[1] ?? '',
          alias: asMatch[2] ?? null,
        });
      } else {
        // Handle line continuation
        const name = trimmed.replace(/\\$/, '').trim();
        if (name) {
          names.push({ name, alias: null });
        }
      }
    }

    return names;
  }

  // ============================================
  // Decorator Extraction
  // ============================================

  /**
   * Extract all decorators from Python source.
   */
  private extractDecorators(source: string, _lines: string[]): PythonDecoratorInfo[] {
    const decorators: PythonDecoratorInfo[] = [];
    // Use [ \t]* instead of \s* to avoid matching newlines as indentation
    const decoratorRegex = /^([ \t]*)@(\w+(?:\.\w+)*)(\([^)]*\))?/gm;
    let match: RegExpExecArray | null;

    while ((match = decoratorRegex.exec(source)) !== null) {
      const lineStart = this.getLineNumber(source, match.index);
      const indent = match[1]?.length ?? 0;
      const name = match[2] ?? '';
      const args = match[3] ? match[3].slice(1, -1) : null;

      decorators.push({
        name,
        arguments: args,
        startPosition: { row: lineStart, column: indent },
        endPosition: { row: lineStart, column: indent + (match[0]?.length ?? 0) },
      });
    }

    return decorators;
  }

  /**
   * Get decorators that appear immediately before a given line.
   */
  private getDecoratorsForLine(
    _source: string,
    lines: string[],
    targetLine: number
  ): string[] {
    const decorators: string[] = [];
    let line = targetLine - 1;

    while (line >= 0) {
      const lineContent = lines[line]?.trim() ?? '';
      if (lineContent.startsWith('@')) {
        // Extract decorator name
        const match = lineContent.match(/^@(\w+(?:\.\w+)*)(?:\(.*\))?$/);
        if (match) {
          decorators.unshift(match[1] ?? '');
        } else {
          decorators.unshift(lineContent.slice(1));
        }
        line--;
      } else if (lineContent === '' || lineContent.startsWith('#')) {
        // Skip empty lines and comments
        line--;
      } else {
        break;
      }
    }

    return decorators;
  }

  // ============================================
  // Class Extraction
  // ============================================

  /**
   * Extract all class definitions from Python source.
   */
  private extractClasses(source: string, lines: string[]): PythonClassInfo[] {
    const classes: PythonClassInfo[] = [];
    // Use [ \t]* instead of \s* to avoid matching newlines as indentation
    const classRegex = /^([ \t]*)class\s+(\w+)(?:\s*\(([^)]*)\))?\s*:/gm;
    let match: RegExpExecArray | null;

    while ((match = classRegex.exec(source)) !== null) {
      const lineStart = this.getLineNumber(source, match.index);
      const indent = match[1]?.length ?? 0;
      const name = match[2] ?? '';
      const basesStr = match[3] ?? '';

      // Parse base classes
      const bases = basesStr
        .split(',')
        .map((b) => b.trim())
        .filter((b) => b.length > 0);

      // Get decorators
      const decorators = this.getDecoratorsForLine(source, lines, lineStart);
      const isDataclass = decorators.some(
        (d) => d === 'dataclass' || d === 'dataclasses.dataclass'
      );

      // Find class body end
      const classEnd = this.findBlockEnd(lines, lineStart, indent);

      // Extract methods and attributes
      const { methods, attributes } = this.extractClassMembers(
        lines,
        lineStart + 1,
        classEnd,
        indent
      );

      classes.push({
        name,
        bases,
        decorators,
        methods,
        attributes,
        isDataclass,
        startPosition: { row: lineStart, column: indent },
        endPosition: { row: classEnd, column: lines[classEnd]?.length ?? 0 },
      });
    }

    return classes;
  }

  /**
   * Extract methods and attributes from a class body.
   */
  private extractClassMembers(
    lines: string[],
    startLine: number,
    endLine: number,
    classIndent: number
  ): { methods: string[]; attributes: string[] } {
    const methods: string[] = [];
    const attributes: string[] = [];
    const methodIndent = classIndent + 4; // Standard Python indentation

    for (let i = startLine; i <= endLine && i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();
      const lineIndent = line.length - line.trimStart().length;

      // Skip if not at method level
      if (lineIndent < methodIndent && trimmed !== '') {continue;}

      // Check for method definition
      const methodMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
      if (methodMatch && lineIndent === methodIndent) {
        methods.push(methodMatch[1] ?? '');
        continue;
      }

      // Check for class attribute (at class level, not in method)
      const attrMatch = trimmed.match(/^(\w+)\s*(?::\s*\S+)?\s*=/);
      if (attrMatch && lineIndent === methodIndent) {
        attributes.push(attrMatch[1] ?? '');
      }
    }

    return { methods, attributes };
  }

  // ============================================
  // Function Extraction
  // ============================================

  /**
   * Extract all module-level function definitions from Python source.
   */
  private extractFunctions(source: string, lines: string[]): PythonFunctionInfo[] {
    const functions: PythonFunctionInfo[] = [];
    // Use [ \t]* instead of \s* to avoid matching newlines as indentation
    const funcRegex = /^([ \t]*)(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?\s*:/gm;

    // Collect all matches first
    const allMatches: RegExpMatchArray[] = [];
    for (const match of source.matchAll(funcRegex)) {
      allMatches.push(match);
    }

    for (const match of allMatches) {
      const lineStart = this.getLineNumber(source, match.index ?? 0);
      const indent = match[1]?.length ?? 0;
      const name = match[3] ?? '';

      // Only extract module-level functions (indent 0)
      // Class methods are extracted separately
      if (indent !== 0) {continue;}

      const isAsync = !!match[2];
      const paramsStr = match[4] ?? '';
      const returnType = match[5]?.trim() ?? null;

      // Parse parameters
      const parameters = this.parseParameters(paramsStr);

      // Get decorators
      const decorators = this.getDecoratorsForLine(source, lines, lineStart);

      // Find function body end
      const funcEnd = this.findBlockEnd(lines, lineStart, indent);

      // Check if function is a generator
      const isGenerator = this.checkIsGenerator(lines, lineStart + 1, funcEnd);

      functions.push({
        name,
        decorators,
        parameters,
        isAsync,
        isGenerator,
        returnType,
        startPosition: { row: lineStart, column: indent },
        endPosition: { row: funcEnd, column: lines[funcEnd]?.length ?? 0 },
      });
    }

    return functions;
  }

  /**
   * Parse function parameters.
   */
  private parseParameters(paramsStr: string): string[] {
    const params: string[] = [];
    const parts = paramsStr.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) {continue;}

      // Extract parameter name (before : or =)
      const nameMatch = trimmed.match(/^(\*{0,2}\w+)/);
      if (nameMatch) {
        params.push(nameMatch[1] ?? '');
      }
    }

    return params;
  }

  /**
   * Check if a function body contains yield statements (is a generator).
   */
  private checkIsGenerator(lines: string[], startLine: number, endLine: number): boolean {
    for (let i = startLine; i <= endLine && i < lines.length; i++) {
      const line = lines[i]?.trim() ?? '';
      if (line.match(/\byield\b/)) {
        return true;
      }
    }
    return false;
  }

  // ============================================
  // AST Node Creation
  // ============================================

  /**
   * Create an AST node for an import statement.
   */
  private createImportNode(imp: PythonImportInfo, source: string): ASTNode {
    const nodeType = imp.isFromImport ? 'ImportFrom' : 'Import';
    const text = this.getTextForRange(source, imp.startPosition, imp.endPosition);

    const children: ASTNode[] = [];

    // Add module node
    if (imp.module) {
      children.push(
        this.createNode(
          'module',
          imp.module,
          imp.startPosition,
          imp.endPosition,
          []
        )
      );
    }

    // Add name nodes
    for (const name of imp.names) {
      const nameText = name.alias ? `${name.name} as ${name.alias}` : name.name;
      children.push(
        this.createNode(
          'alias',
          nameText,
          imp.startPosition,
          imp.endPosition,
          []
        )
      );
    }

    return this.createNode(nodeType, text, imp.startPosition, imp.endPosition, children);
  }

  /**
   * Create an AST node for a class definition.
   */
  private createClassNode(cls: PythonClassInfo, source: string): ASTNode {
    const text = this.getTextForRange(source, cls.startPosition, cls.endPosition);
    const children: ASTNode[] = [];

    // Add name node
    children.push(
      this.createNode(
        'name',
        cls.name,
        cls.startPosition,
        cls.startPosition,
        []
      )
    );

    // Add base class nodes
    for (const base of cls.bases) {
      children.push(
        this.createNode(
          'base',
          base,
          cls.startPosition,
          cls.startPosition,
          []
        )
      );
    }

    // Add decorator nodes
    for (const dec of cls.decorators) {
      children.push(
        this.createNode(
          'decorator',
          dec,
          cls.startPosition,
          cls.startPosition,
          []
        )
      );
    }

    // Add method nodes
    for (const method of cls.methods) {
      children.push(
        this.createNode(
          'FunctionDef',
          method,
          cls.startPosition,
          cls.endPosition,
          []
        )
      );
    }

    return this.createNode('ClassDef', text, cls.startPosition, cls.endPosition, children);
  }

  /**
   * Create an AST node for a function definition.
   */
  private createFunctionNode(func: PythonFunctionInfo, source: string): ASTNode {
    const text = this.getTextForRange(source, func.startPosition, func.endPosition);
    const nodeType = func.isAsync ? 'AsyncFunctionDef' : 'FunctionDef';
    const children: ASTNode[] = [];

    // Add name node
    children.push(
      this.createNode(
        'name',
        func.name,
        func.startPosition,
        func.startPosition,
        []
      )
    );

    // Add parameter nodes
    for (const param of func.parameters) {
      children.push(
        this.createNode(
          'arg',
          param,
          func.startPosition,
          func.startPosition,
          []
        )
      );
    }

    // Add decorator nodes
    for (const dec of func.decorators) {
      children.push(
        this.createNode(
          'decorator',
          dec,
          func.startPosition,
          func.startPosition,
          []
        )
      );
    }

    // Add return type node if present
    if (func.returnType) {
      children.push(
        this.createNode(
          'returns',
          func.returnType,
          func.startPosition,
          func.startPosition,
          []
        )
      );
    }

    return this.createNode(nodeType, text, func.startPosition, func.endPosition, children);
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get the line number for a character offset.
   */
  private getLineNumber(source: string, offset: number): number {
    let line = 0;
    for (let i = 0; i < offset && i < source.length; i++) {
      if (source[i] === '\n') {
        line++;
      }
    }
    return line;
  }

  /**
   * Find the end of an indented block.
   */
  private findBlockEnd(lines: string[], startLine: number, blockIndent: number): number {
    let endLine = startLine;

    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (trimmed === '' || trimmed.startsWith('#')) {
        endLine = i;
        continue;
      }

      // Check indentation
      const lineIndent = line.length - line.trimStart().length;
      if (lineIndent <= blockIndent) {
        break;
      }

      endLine = i;
    }

    return endLine;
  }

  /**
   * Find the matching closing parenthesis.
   */
  private findMatchingParen(source: string, openIndex: number): number {
    let depth = 1;
    for (let i = openIndex + 1; i < source.length; i++) {
      if (source[i] === '(') {depth++;}
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) {return i;}
      }
    }
    return -1;
  }

  /**
   * Get text between two positions.
   */
  private getTextForRange(source: string, start: Position, end: Position): string {
    const lines = source.split('\n');
    const result: string[] = [];

    for (let row = start.row; row <= end.row && row < lines.length; row++) {
      const line = lines[row] ?? '';
      const startCol = row === start.row ? start.column : 0;
      const endCol = row === end.row ? end.column : line.length;
      result.push(line.slice(startCol, endCol));
    }

    return result.join('\n');
  }
}
