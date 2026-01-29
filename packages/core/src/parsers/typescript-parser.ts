/**
 * TypeScript Parser - TypeScript/JavaScript parsing using TypeScript Compiler API
 *
 * Extracts imports, exports, classes, functions, interfaces, and type aliases
 * from TypeScript and JavaScript files.
 *
 * @requirements 3.2
 */

import ts from 'typescript';

import { BaseParser } from './base-parser.js';

import type { AST, ASTNode, Language, ParseResult, Position } from './types.js';

/**
 * Information about an import statement extracted from parsed source
 */
export interface ParsedImportInfo {
  /** Module specifier (e.g., './utils', 'lodash') */
  moduleSpecifier: string;
  /** Named imports (e.g., { foo, bar }) */
  namedImports: string[];
  /** Default import name */
  defaultImport: string | null;
  /** Namespace import (e.g., * as utils) */
  namespaceImport: string | null;
  /** Whether this is a type-only import */
  isTypeOnly: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about an export statement extracted from parsed source
 */
export interface ParsedExportInfo {
  /** Exported name */
  name: string;
  /** Local name if different from exported name */
  localName: string | null;
  /** Whether this is a default export */
  isDefault: boolean;
  /** Whether this is a type-only export */
  isTypeOnly: boolean;
  /** Whether this is a re-export from another module */
  isReExport: boolean;
  /** Module specifier for re-exports */
  moduleSpecifier: string | null;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a class declaration
 */
export interface ClassInfo {
  /** Class name */
  name: string;
  /** Whether the class is exported */
  isExported: boolean;
  /** Whether this is a default export */
  isDefault: boolean;
  /** Whether the class is abstract */
  isAbstract: boolean;
  /** Extended class name */
  extends: string | null;
  /** Implemented interfaces */
  implements: string[];
  /** Method names */
  methods: string[];
  /** Property names */
  properties: string[];
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a function declaration
 */
export interface FunctionInfo {
  /** Function name */
  name: string;
  /** Whether the function is exported */
  isExported: boolean;
  /** Whether this is a default export */
  isDefault: boolean;
  /** Whether the function is async */
  isAsync: boolean;
  /** Whether the function is a generator */
  isGenerator: boolean;
  /** Parameter names */
  parameters: string[];
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about an interface declaration
 */
export interface InterfaceInfo {
  /** Interface name */
  name: string;
  /** Whether the interface is exported */
  isExported: boolean;
  /** Extended interfaces */
  extends: string[];
  /** Property names */
  properties: string[];
  /** Method names */
  methods: string[];
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a type alias declaration
 */
export interface TypeAliasInfo {
  /** Type alias name */
  name: string;
  /** Whether the type alias is exported */
  isExported: boolean;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Extended parse result with TypeScript-specific information
 */
export interface TypeScriptParseResult extends ParseResult {
  /** Extracted imports */
  imports: ParsedImportInfo[];
  /** Extracted exports */
  exports: ParsedExportInfo[];
  /** Extracted classes */
  classes: ClassInfo[];
  /** Extracted functions */
  functions: FunctionInfo[];
  /** Extracted interfaces */
  interfaces: InterfaceInfo[];
  /** Extracted type aliases */
  typeAliases: TypeAliasInfo[];
}

/**
 * TypeScript/JavaScript parser using the TypeScript Compiler API.
 *
 * Provides AST parsing and extraction of imports, exports, classes,
 * functions, interfaces, and type aliases.
 *
 * @requirements 3.2 - Support TypeScript and JavaScript
 */
export class TypeScriptParser extends BaseParser {
  readonly language: Language = 'typescript';
  readonly extensions: string[] = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

  /**
   * Parse TypeScript/JavaScript source code into an AST.
   *
   * @param source - The source code to parse
   * @param filePath - Optional file path for error reporting
   * @returns ParseResult containing the AST or errors
   *
   * @requirements 3.2, 3.3
   */
  parse(source: string, filePath?: string): TypeScriptParseResult {
    const fileName = filePath || 'anonymous.ts';
    const scriptKind = this.getScriptKind(fileName);

    try {
      // Create a source file using TypeScript compiler API
      const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);

      // Convert TypeScript AST to our unified AST format
      const rootNode = this.convertNode(sourceFile, source);
      const ast = this.createAST(rootNode, source);

      // Extract semantic information
      const imports = this.extractImports(sourceFile, source);
      const exports = this.extractExports(sourceFile, source);
      const classes = this.extractClasses(sourceFile, source);
      const functions = this.extractFunctions(sourceFile, source);
      const interfaces = this.extractInterfaces(sourceFile, source);
      const typeAliases = this.extractTypeAliases(sourceFile, source);

      // Check for syntax errors
      const errors = this.extractErrors(sourceFile);

      if (errors.length > 0) {
        return {
          ...this.createPartialResult(ast, errors),
          imports,
          exports,
          classes,
          functions,
          interfaces,
          typeAliases,
        };
      }

      return {
        ...this.createSuccessResult(ast),
        imports,
        exports,
        classes,
        functions,
        interfaces,
        typeAliases,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';
      return {
        ...this.createFailureResult([this.createError(errorMessage, { row: 0, column: 0 })]),
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        interfaces: [],
        typeAliases: [],
      };
    }
  }

  /**
   * Query the AST for nodes matching a pattern.
   *
   * Supports querying by node type (e.g., 'ImportDeclaration', 'ClassDeclaration').
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

  /**
   * Get the TypeScript ScriptKind based on file extension.
   */
  private getScriptKind(fileName: string): ts.ScriptKind {
    const ext = fileName.toLowerCase().split('.').pop();
    switch (ext) {
      case 'tsx':
        return ts.ScriptKind.TSX;
      case 'jsx':
        return ts.ScriptKind.JSX;
      case 'js':
      case 'mjs':
      case 'cjs':
        return ts.ScriptKind.JS;
      case 'ts':
      case 'mts':
      case 'cts':
      default:
        return ts.ScriptKind.TS;
    }
  }

  /**
   * Convert a TypeScript AST node to our unified AST format.
   */
  private convertNode(node: ts.Node, source: string): ASTNode {
    const startPos = this.getPosition(node.getStart(), source);
    const endPos = this.getPosition(node.getEnd(), source);
    const nodeType = ts.SyntaxKind[node.kind];
    const text = node.getText();

    const children: ASTNode[] = [];
    ts.forEachChild(node, (child) => {
      children.push(this.convertNode(child, source));
    });

    return this.createNode(nodeType, text, startPos, endPos, children);
  }

  /**
   * Convert a character offset to a Position (row, column).
   */
  private getPosition(offset: number, source: string): Position {
    let row = 0;
    let column = 0;

    for (let i = 0; i < offset && i < source.length; i++) {
      if (source[i] === '\n') {
        row++;
        column = 0;
      } else {
        column++;
      }
    }

    return { row, column };
  }

  /**
   * Extract syntax errors from the source file.
   */
  private extractErrors(sourceFile: ts.SourceFile): { message: string; position: Position }[] {
    const errors: { message: string; position: Position }[] = [];

    // Get parse diagnostics (syntax errors)
    const diagnostics = (sourceFile as any).parseDiagnostics || [];

    for (const diagnostic of diagnostics) {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      const position = diagnostic.start !== undefined ? this.getPosition(diagnostic.start, sourceFile.text) : { row: 0, column: 0 };

      errors.push({ message, position });
    }

    return errors;
  }

  /**
   * Extract import information from the source file.
   */
  private extractImports(sourceFile: ts.SourceFile, source: string): ParsedImportInfo[] {
    const imports: ParsedImportInfo[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        const importInfo = this.parseImportDeclaration(node, source);
        if (importInfo) {
          imports.push(importInfo);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return imports;
  }

  /**
   * Parse a single import declaration.
   */
  private parseImportDeclaration(node: ts.ImportDeclaration, source: string): ParsedImportInfo | null {
    const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
    const startPosition = this.getPosition(node.getStart(), source);
    const endPosition = this.getPosition(node.getEnd(), source);

    const importInfo: ParsedImportInfo = {
      moduleSpecifier,
      namedImports: [],
      defaultImport: null,
      namespaceImport: null,
      isTypeOnly: node.importClause?.isTypeOnly ?? false,
      startPosition,
      endPosition,
    };

    const importClause = node.importClause;
    if (importClause) {
      // Default import
      if (importClause.name) {
        importInfo.defaultImport = importClause.name.text;
      }

      // Named or namespace imports
      const namedBindings = importClause.namedBindings;
      if (namedBindings) {
        if (ts.isNamespaceImport(namedBindings)) {
          importInfo.namespaceImport = namedBindings.name.text;
        } else if (ts.isNamedImports(namedBindings)) {
          importInfo.namedImports = namedBindings.elements.map((element) => {
            if (element.propertyName) {
              return `${element.propertyName.text} as ${element.name.text}`;
            }
            return element.name.text;
          });
        }
      }
    }

    return importInfo;
  }

  /**
   * Extract export information from the source file.
   */
  private extractExports(sourceFile: ts.SourceFile, source: string): ParsedExportInfo[] {
    const exports: ParsedExportInfo[] = [];

    const visit = (node: ts.Node): void => {
      // Export declaration (export { foo } or export { foo } from './bar')
      if (ts.isExportDeclaration(node)) {
        const exportInfos = this.parseExportDeclaration(node, source);
        exports.push(...exportInfos);
      }
      // Export assignment (export default foo or export = foo)
      else if (ts.isExportAssignment(node)) {
        const exportInfo = this.parseExportAssignment(node, source);
        if (exportInfo) {
          exports.push(exportInfo);
        }
      }
      // Exported declarations (export function foo, export class Bar, etc.)
      else if (this.hasExportModifier(node)) {
        const exportInfo = this.parseExportedDeclaration(node, source);
        if (exportInfo) {
          exports.push(exportInfo);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return exports;
  }

  /**
   * Check if a node has an export modifier.
   */
  private hasExportModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  /**
   * Check if a node has a default modifier.
   */
  private hasDefaultModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  }

  /**
   * Parse an export declaration.
   */
  private parseExportDeclaration(node: ts.ExportDeclaration, source: string): ParsedExportInfo[] {
    const exports: ParsedExportInfo[] = [];
    const startPosition = this.getPosition(node.getStart(), source);
    const endPosition = this.getPosition(node.getEnd(), source);
    const moduleSpecifier = node.moduleSpecifier ? (node.moduleSpecifier as ts.StringLiteral).text : null;
    const isTypeOnly = node.isTypeOnly;

    // Export all from module (export * from './foo')
    if (!node.exportClause) {
      exports.push({
        name: '*',
        localName: null,
        isDefault: false,
        isTypeOnly,
        isReExport: true,
        moduleSpecifier,
        startPosition,
        endPosition,
      });
    }
    // Named exports
    else if (ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        exports.push({
          name: element.name.text,
          localName: element.propertyName?.text ?? null,
          isDefault: false,
          isTypeOnly: isTypeOnly || element.isTypeOnly,
          isReExport: moduleSpecifier !== null,
          moduleSpecifier,
          startPosition,
          endPosition,
        });
      }
    }
    // Namespace export (export * as ns from './foo')
    else if (ts.isNamespaceExport(node.exportClause)) {
      exports.push({
        name: node.exportClause.name.text,
        localName: '*',
        isDefault: false,
        isTypeOnly,
        isReExport: true,
        moduleSpecifier,
        startPosition,
        endPosition,
      });
    }

    return exports;
  }

  /**
   * Parse an export assignment (export default or export =).
   */
  private parseExportAssignment(node: ts.ExportAssignment, source: string): ParsedExportInfo {
    const startPosition = this.getPosition(node.getStart(), source);
    const endPosition = this.getPosition(node.getEnd(), source);

    let name = 'default';
    if (ts.isIdentifier(node.expression)) {
      name = node.expression.text;
    }

    return {
      name,
      localName: null,
      isDefault: !node.isExportEquals,
      isTypeOnly: false,
      isReExport: false,
      moduleSpecifier: null,
      startPosition,
      endPosition,
    };
  }

  /**
   * Parse an exported declaration.
   */
  private parseExportedDeclaration(node: ts.Node, source: string): ParsedExportInfo | null {
    const startPosition = this.getPosition(node.getStart(), source);
    const endPosition = this.getPosition(node.getEnd(), source);
    const isDefault = this.hasDefaultModifier(node);

    let name: string | null = null;

    if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
    } else if (ts.isClassDeclaration(node) && node.name) {
      name = node.name.text;
    } else if (ts.isVariableStatement(node)) {
      const declarations = node.declarationList.declarations;
      const firstDecl = declarations[0];
      if (declarations.length > 0 && firstDecl && ts.isIdentifier(firstDecl.name)) {
        name = firstDecl.name.text;
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      name = node.name.text;
    } else if (ts.isTypeAliasDeclaration(node)) {
      name = node.name.text;
    } else if (ts.isEnumDeclaration(node)) {
      name = node.name.text;
    }

    if (!name) {
      return null;
    }

    return {
      name,
      localName: null,
      isDefault,
      isTypeOnly: ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node),
      isReExport: false,
      moduleSpecifier: null,
      startPosition,
      endPosition,
    };
  }

  /**
   * Extract class information from the source file.
   */
  private extractClasses(sourceFile: ts.SourceFile, source: string): ClassInfo[] {
    const classes: ClassInfo[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node)) {
        const classInfo = this.parseClassDeclaration(node, source);
        if (classInfo) {
          classes.push(classInfo);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return classes;
  }

  /**
   * Parse a class declaration.
   */
  private parseClassDeclaration(node: ts.ClassDeclaration, source: string): ClassInfo | null {
    const name = node.name?.text;
    if (!name) {
      return null;
    }

    const startPosition = this.getPosition(node.getStart(), source);
    const endPosition = this.getPosition(node.getEnd(), source);
    const isExported = this.hasExportModifier(node);
    const isDefault = this.hasDefaultModifier(node);

    // Check for abstract modifier
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isAbstract = modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;

    // Get extends clause
    let extendsClass: string | null = null;
    const implementsInterfaces: string[] = [];

    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          const type = clause.types[0];
          if (type && ts.isIdentifier(type.expression)) {
            extendsClass = type.expression.text;
          }
        } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
          for (const type of clause.types) {
            if (ts.isIdentifier(type.expression)) {
              implementsInterfaces.push(type.expression.text);
            }
          }
        }
      }
    }

    // Extract methods and properties
    const methods: string[] = [];
    const properties: string[] = [];

    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) && member.name) {
        const memberName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
        methods.push(memberName);
      } else if (ts.isPropertyDeclaration(member) && member.name) {
        const memberName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
        properties.push(memberName);
      } else if (ts.isConstructorDeclaration(member)) {
        methods.push('constructor');
      } else if (ts.isGetAccessorDeclaration(member) && member.name) {
        const memberName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
        properties.push(`get ${memberName}`);
      } else if (ts.isSetAccessorDeclaration(member) && member.name) {
        const memberName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
        properties.push(`set ${memberName}`);
      }
    }

    return {
      name,
      isExported,
      isDefault,
      isAbstract,
      extends: extendsClass,
      implements: implementsInterfaces,
      methods,
      properties,
      startPosition,
      endPosition,
    };
  }

  /**
   * Extract function information from the source file.
   */
  private extractFunctions(sourceFile: ts.SourceFile, source: string): FunctionInfo[] {
    const functions: FunctionInfo[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node)) {
        const funcInfo = this.parseFunctionDeclaration(node, source);
        if (funcInfo) {
          functions.push(funcInfo);
        }
      }
      // Also extract arrow functions assigned to variables at module level
      else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            const funcInfo = this.parseVariableFunction(node, decl, source);
            if (funcInfo) {
              functions.push(funcInfo);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return functions;
  }

  /**
   * Parse a function declaration.
   */
  private parseFunctionDeclaration(node: ts.FunctionDeclaration, source: string): FunctionInfo | null {
    const name = node.name?.text;
    if (!name) {
      return null;
    }

    const startPosition = this.getPosition(node.getStart(), source);
    const endPosition = this.getPosition(node.getEnd(), source);
    const isExported = this.hasExportModifier(node);
    const isDefault = this.hasDefaultModifier(node);

    // Check for async modifier
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isAsync = modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;

    // Check for generator
    const isGenerator = node.asteriskToken !== undefined;

    // Extract parameters
    const parameters = node.parameters.map((param) => {
      if (ts.isIdentifier(param.name)) {
        return param.name.text;
      }
      return param.name.getText();
    });

    return {
      name,
      isExported,
      isDefault,
      isAsync,
      isGenerator,
      parameters,
      startPosition,
      endPosition,
    };
  }

  /**
   * Parse a variable declaration with a function expression or arrow function.
   */
  private parseVariableFunction(
    statement: ts.VariableStatement,
    decl: ts.VariableDeclaration,
    source: string
  ): FunctionInfo | null {
    if (!ts.isIdentifier(decl.name)) {
      return null;
    }

    const name = decl.name.text;
    const startPosition = this.getPosition(statement.getStart(), source);
    const endPosition = this.getPosition(statement.getEnd(), source);
    const isExported = this.hasExportModifier(statement);

    const func = decl.initializer as ts.ArrowFunction | ts.FunctionExpression;

    // Check for async modifier
    const modifiers = ts.canHaveModifiers(func) ? ts.getModifiers(func) : undefined;
    const isAsync = modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;

    // Check for generator (only for function expressions)
    const isGenerator = ts.isFunctionExpression(func) && func.asteriskToken !== undefined;

    // Extract parameters
    const parameters = func.parameters.map((param) => {
      if (ts.isIdentifier(param.name)) {
        return param.name.text;
      }
      return param.name.getText();
    });

    return {
      name,
      isExported,
      isDefault: false,
      isAsync,
      isGenerator,
      parameters,
      startPosition,
      endPosition,
    };
  }

  /**
   * Extract interface information from the source file.
   */
  private extractInterfaces(sourceFile: ts.SourceFile, source: string): InterfaceInfo[] {
    const interfaces: InterfaceInfo[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node)) {
        const interfaceInfo = this.parseInterfaceDeclaration(node, source);
        interfaces.push(interfaceInfo);
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return interfaces;
  }

  /**
   * Parse an interface declaration.
   */
  private parseInterfaceDeclaration(node: ts.InterfaceDeclaration, source: string): InterfaceInfo {
    const name = node.name.text;
    const startPosition = this.getPosition(node.getStart(), source);
    const endPosition = this.getPosition(node.getEnd(), source);
    const isExported = this.hasExportModifier(node);

    // Get extends clause
    const extendsInterfaces: string[] = [];
    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          for (const type of clause.types) {
            if (ts.isIdentifier(type.expression)) {
              extendsInterfaces.push(type.expression.text);
            }
          }
        }
      }
    }

    // Extract properties and methods
    const properties: string[] = [];
    const methods: string[] = [];

    for (const member of node.members) {
      if (ts.isPropertySignature(member) && member.name) {
        const memberName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
        properties.push(memberName);
      } else if (ts.isMethodSignature(member) && member.name) {
        const memberName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
        methods.push(memberName);
      }
    }

    return {
      name,
      isExported,
      extends: extendsInterfaces,
      properties,
      methods,
      startPosition,
      endPosition,
    };
  }

  /**
   * Extract type alias information from the source file.
   */
  private extractTypeAliases(sourceFile: ts.SourceFile, source: string): TypeAliasInfo[] {
    const typeAliases: TypeAliasInfo[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isTypeAliasDeclaration(node)) {
        const typeAliasInfo = this.parseTypeAliasDeclaration(node, source);
        typeAliases.push(typeAliasInfo);
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return typeAliases;
  }

  /**
   * Parse a type alias declaration.
   */
  private parseTypeAliasDeclaration(node: ts.TypeAliasDeclaration, source: string): TypeAliasInfo {
    const name = node.name.text;
    const startPosition = this.getPosition(node.getStart(), source);
    const endPosition = this.getPosition(node.getEnd(), source);
    const isExported = this.hasExportModifier(node);

    return {
      name,
      isExported,
      startPosition,
      endPosition,
    };
  }
}
