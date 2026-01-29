/**
 * TypeScript/JavaScript Hybrid Extractor
 *
 * Combines TypeScript Compiler API (primary) with regex fallback for
 * enterprise-grade TypeScript/JavaScript code extraction.
 */

import ts from 'typescript';

import { HybridExtractorBase } from './hybrid-extractor-base.js';
import { TypeScriptRegexExtractor } from './regex/typescript-regex.js';

import type {
  CallGraphLanguage,
  FileExtractionResult,
  FunctionExtraction,
  CallExtraction,
  ImportExtraction,
  ExportExtraction,
  ClassExtraction,
  ParameterInfo,
} from '../types.js';
import type { HybridExtractorConfig } from './types.js';

/**
 * TypeScript/JavaScript hybrid extractor with TS Compiler API + regex fallback
 */
export class TypeScriptHybridExtractor extends HybridExtractorBase {
  readonly language: CallGraphLanguage = 'typescript';
  readonly extensions: string[] = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
  protected regexExtractor = new TypeScriptRegexExtractor();

  constructor(config?: HybridExtractorConfig) {
    super(config);
  }

  /**
   * TypeScript compiler is always available (it's a dependency)
   */
  protected isTreeSitterAvailable(): boolean {
    return true;
  }

  /**
   * Extract using TypeScript Compiler API
   */
  protected extractWithTreeSitter(source: string, filePath: string): FileExtractionResult | null {
    const result: FileExtractionResult = {
      file: filePath,
      language: this.getLanguageFromPath(filePath),
      functions: [],
      calls: [],
      imports: [],
      exports: [],
      classes: [],
      errors: [],
    };

    try {
      const scriptKind = this.getScriptKind(filePath);
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKind
      );

      this.visitNode(sourceFile, result, null, null);
      this.extractModuleLevelCalls(sourceFile, result);

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Get language from file path
   */
  private getLanguageFromPath(filePath: string): CallGraphLanguage {
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      return 'javascript';
    }
    return 'typescript';
  }

  /**
   * Get TypeScript script kind from file path
   */
  private getScriptKind(filePath: string): ts.ScriptKind {
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    switch (ext) {
      case '.tsx': return ts.ScriptKind.TSX;
      case '.jsx': return ts.ScriptKind.JSX;
      case '.js':
      case '.mjs':
      case '.cjs':
        return ts.ScriptKind.JS;
      default: return ts.ScriptKind.TS;
    }
  }

  /**
   * Visit a node and extract relevant information
   */
  private visitNode(
    node: ts.Node,
    result: FileExtractionResult,
    currentClass: string | null,
    parentFunction: string | null
  ): void {
    const source = node.getSourceFile().text;

    if (ts.isFunctionDeclaration(node) && node.name) {
      const func = this.extractFunctionDeclaration(node, source, currentClass, parentFunction);
      if (func) {
        result.functions.push(func);
        if (node.body) {
          this.extractCallsFromNode(node.body, result, source);
        }
      }
      return;
    }

    if (ts.isVariableStatement(node)) {
      let hasFunction = false;
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer && ts.isIdentifier(decl.name)) {
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            hasFunction = true;
            const func = this.extractVariableFunction(node, decl, source, parentFunction);
            if (func) {
              result.functions.push(func);
              this.extractCallsFromNode(decl.initializer, result, source);
            }
          }
        }
      }
      if (hasFunction) {return;}
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const classInfo = this.extractClassDeclaration(node, source);
      result.classes.push(classInfo);
      for (const member of node.members) {
        this.visitNode(member, result, node.name.text, parentFunction);
      }
      return;
    }

    if (ts.isMethodDeclaration(node) && node.name && currentClass) {
      const func = this.extractMethodDeclaration(node, source, currentClass);
      if (func) {
        result.functions.push(func);
        if (node.body) {
          this.extractCallsFromNode(node.body, result, source);
        }
      }
      return;
    }

    if (ts.isConstructorDeclaration(node) && currentClass) {
      const func = this.extractConstructor(node, source, currentClass);
      result.functions.push(func);
      if (node.body) {
        this.extractCallsFromNode(node.body, result, source);
      }
      return;
    }

    if (ts.isImportDeclaration(node)) {
      const importInfo = this.extractImportDeclaration(node);
      if (importInfo) {
        result.imports.push(importInfo);
      }
    }

    if (ts.isExportDeclaration(node)) {
      const exports = this.extractExportDeclaration(node, source);
      result.exports.push(...exports);
    }

    if (this.hasExportModifier(node)) {
      const exportInfo = this.extractExportedDeclaration(node, source);
      if (exportInfo) {
        result.exports.push(exportInfo);
      }
    }

    ts.forEachChild(node, (child) => this.visitNode(child, result, currentClass, parentFunction));
  }

  /**
   * Extract module-level calls
   */
  private extractModuleLevelCalls(sourceFile: ts.SourceFile, result: FileExtractionResult): void {
    const source = sourceFile.text;
    const moduleCalls: CallExtraction[] = [];

    for (const statement of sourceFile.statements) {
      if (ts.isExpressionStatement(statement)) {
        this.extractCallsFromNodeToArray(statement, moduleCalls, source);
      } else if (ts.isVariableStatement(statement)) {
        let hasFunction = false;
        for (const decl of statement.declarationList.declarations) {
          if (decl.initializer &&
              (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            hasFunction = true;
          }
        }
        if (!hasFunction) {
          this.extractCallsFromNodeToArray(statement, moduleCalls, source);
        }
      }
    }

    result.calls.push(...moduleCalls);

    if (moduleCalls.length > 0) {
      result.functions.push({
        name: '__module__',
        qualifiedName: '__module__',
        startLine: 1,
        endLine: sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1,
        startColumn: 0,
        endColumn: 0,
        parameters: [],
        isMethod: false,
        isStatic: false,
        isExported: false,
        isConstructor: false,
        isAsync: false,
        decorators: [],
        bodyStartLine: 1,
        bodyEndLine: sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1,
      });
    }
  }

  /**
   * Extract calls from a node
   */
  private extractCallsFromNode(node: ts.Node, result: FileExtractionResult, source: string): void {
    this.extractCallsFromNodeToArray(node, result.calls, source);
  }

  /**
   * Extract calls from a node into an array
   */
  private extractCallsFromNodeToArray(node: ts.Node, calls: CallExtraction[], source: string): void {
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const call = this.extractCallExpression(n, source);
        if (call) {calls.push(call);}
      } else if (ts.isNewExpression(n)) {
        const call = this.extractNewExpression(n, source);
        if (call) {calls.push(call);}
      } else if (ts.isJsxSelfClosingElement(n)) {
        const call = this.extractJsxElement(n.tagName, n, source);
        if (call) {calls.push(call);}
      } else if (ts.isJsxOpeningElement(n)) {
        const call = this.extractJsxElement(n.tagName, n, source);
        if (call) {calls.push(call);}
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  }

  /**
   * Extract a call expression
   */
  private extractCallExpression(node: ts.CallExpression, source: string): CallExtraction | null {
    const pos = this.getPosition(node.getStart(), source);
    let calleeName: string;
    let receiver: string | undefined;
    let fullExpression: string;

    const expr = node.expression;

    if (ts.isPropertyAccessExpression(expr)) {
      calleeName = expr.name.text;
      receiver = expr.expression.getText();
      fullExpression = expr.getText();
    } else if (ts.isElementAccessExpression(expr)) {
      const arg = expr.argumentExpression;
      calleeName = ts.isStringLiteral(arg) ? arg.text : arg.getText();
      receiver = expr.expression.getText();
      fullExpression = expr.getText();
    } else if (ts.isIdentifier(expr)) {
      calleeName = expr.text;
      fullExpression = expr.text;
    } else {
      calleeName = expr.getText();
      fullExpression = expr.getText();
    }

    return {
      calleeName,
      receiver,
      fullExpression,
      line: pos.row + 1,
      column: pos.column,
      argumentCount: node.arguments.length,
      isMethodCall: !!receiver,
      isConstructorCall: false,
    };
  }

  /**
   * Extract a new expression
   */
  private extractNewExpression(node: ts.NewExpression, source: string): CallExtraction | null {
    const pos = this.getPosition(node.getStart(), source);
    let calleeName: string;
    let receiver: string | undefined;

    const expr = node.expression;

    if (ts.isIdentifier(expr)) {
      calleeName = expr.text;
    } else if (ts.isPropertyAccessExpression(expr)) {
      calleeName = expr.name.text;
      receiver = expr.expression.getText();
    } else {
      calleeName = expr.getText();
    }

    return {
      calleeName,
      receiver,
      fullExpression: node.getText(),
      line: pos.row + 1,
      column: pos.column,
      argumentCount: node.arguments?.length ?? 0,
      isMethodCall: false,
      isConstructorCall: true,
    };
  }

  /**
   * Extract a JSX element as a function call
   */
  private extractJsxElement(
    tagName: ts.JsxTagNameExpression,
    node: ts.Node,
    source: string
  ): CallExtraction | null {
    const pos = this.getPosition(node.getStart(), source);
    let calleeName: string;
    let receiver: string | undefined;

    if (ts.isIdentifier(tagName)) {
      calleeName = tagName.text;
      if (!calleeName || calleeName.charAt(0) === calleeName.charAt(0).toLowerCase()) {
        return null;
      }
    } else if (ts.isPropertyAccessExpression(tagName)) {
      calleeName = tagName.name.text;
      receiver = tagName.expression.getText();
    } else {
      calleeName = tagName.getText();
    }

    return {
      calleeName,
      receiver,
      fullExpression: `<${tagName.getText()} />`,
      line: pos.row + 1,
      column: pos.column,
      argumentCount: 1,
      isMethodCall: !!receiver,
      isConstructorCall: false,
    };
  }

  /**
   * Extract a function declaration
   */
  private extractFunctionDeclaration(
    node: ts.FunctionDeclaration,
    source: string,
    currentClass: string | null,
    parentFunction: string | null
  ): FunctionExtraction | null {
    if (!node.name) {return null;}

    const startPos = this.getPosition(node.getStart(), source);
    const endPos = this.getPosition(node.getEnd(), source);
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const name = node.name.text;

    let qualifiedName = name;
    if (parentFunction) {
      qualifiedName = `${parentFunction}.${name}`;
    } else if (currentClass) {
      qualifiedName = `${currentClass}.${name}`;
    }

    const result: FunctionExtraction = {
      name,
      qualifiedName,
      startLine: startPos.row + 1,
      endLine: endPos.row + 1,
      startColumn: startPos.column,
      endColumn: endPos.column,
      parameters: this.extractParameters(node.parameters),
      isMethod: false,
      isStatic: false,
      isExported: parentFunction ? false : this.hasExportModifier(node),
      isConstructor: false,
      isAsync: modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
      decorators: this.extractDecorators(node),
      bodyStartLine: node.body ? this.getPosition(node.body.getStart(), source).row + 1 : startPos.row + 1,
      bodyEndLine: node.body ? this.getPosition(node.body.getEnd(), source).row + 1 : endPos.row + 1,
    };

    if (node.type) {
      result.returnType = node.type.getText();
    }
    if (currentClass) {
      result.className = currentClass;
    }

    return result;
  }

  /**
   * Extract a variable function
   */
  private extractVariableFunction(
    statement: ts.VariableStatement,
    decl: ts.VariableDeclaration,
    source: string,
    parentFunction: string | null
  ): FunctionExtraction | null {
    if (!ts.isIdentifier(decl.name)) {return null;}

    const func = decl.initializer as ts.ArrowFunction | ts.FunctionExpression;
    const startPos = this.getPosition(statement.getStart(), source);
    const endPos = this.getPosition(statement.getEnd(), source);
    const modifiers = ts.canHaveModifiers(func) ? ts.getModifiers(func) : undefined;
    const name = decl.name.text;
    const qualifiedName = parentFunction ? `${parentFunction}.${name}` : name;

    const result: FunctionExtraction = {
      name,
      qualifiedName,
      startLine: startPos.row + 1,
      endLine: endPos.row + 1,
      startColumn: startPos.column,
      endColumn: endPos.column,
      parameters: this.extractParameters(func.parameters),
      isMethod: false,
      isStatic: false,
      isExported: parentFunction ? false : this.hasExportModifier(statement),
      isConstructor: false,
      isAsync: modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
      decorators: [],
      bodyStartLine: this.getPosition(func.body.getStart(), source).row + 1,
      bodyEndLine: this.getPosition(func.body.getEnd(), source).row + 1,
    };

    if (func.type) {
      result.returnType = func.type.getText();
    }

    return result;
  }

  /**
   * Extract a method declaration
   */
  private extractMethodDeclaration(
    node: ts.MethodDeclaration,
    source: string,
    className: string
  ): FunctionExtraction | null {
    const name = ts.isIdentifier(node.name) ? node.name.text : node.name.getText();
    const startPos = this.getPosition(node.getStart(), source);
    const endPos = this.getPosition(node.getEnd(), source);
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;

    const result: FunctionExtraction = {
      name,
      qualifiedName: `${className}.${name}`,
      startLine: startPos.row + 1,
      endLine: endPos.row + 1,
      startColumn: startPos.column,
      endColumn: endPos.column,
      parameters: this.extractParameters(node.parameters),
      isMethod: true,
      isStatic: modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false,
      isExported: false,
      isConstructor: false,
      isAsync: modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
      className,
      decorators: this.extractDecorators(node),
      bodyStartLine: node.body ? this.getPosition(node.body.getStart(), source).row + 1 : startPos.row + 1,
      bodyEndLine: node.body ? this.getPosition(node.body.getEnd(), source).row + 1 : endPos.row + 1,
    };

    if (node.type) {
      result.returnType = node.type.getText();
    }

    return result;
  }

  /**
   * Extract a constructor
   */
  private extractConstructor(
    node: ts.ConstructorDeclaration,
    source: string,
    className: string
  ): FunctionExtraction {
    const startPos = this.getPosition(node.getStart(), source);
    const endPos = this.getPosition(node.getEnd(), source);

    return {
      name: 'constructor',
      qualifiedName: `${className}.constructor`,
      startLine: startPos.row + 1,
      endLine: endPos.row + 1,
      startColumn: startPos.column,
      endColumn: endPos.column,
      parameters: this.extractParameters(node.parameters),
      isMethod: true,
      isStatic: false,
      isExported: false,
      isConstructor: true,
      isAsync: false,
      className,
      decorators: [],
      bodyStartLine: node.body ? this.getPosition(node.body.getStart(), source).row + 1 : startPos.row + 1,
      bodyEndLine: node.body ? this.getPosition(node.body.getEnd(), source).row + 1 : endPos.row + 1,
    };
  }

  /**
   * Extract a class declaration
   */
  private extractClassDeclaration(node: ts.ClassDeclaration, source: string): ClassExtraction {
    const name = node.name?.text ?? 'anonymous';
    const startPos = this.getPosition(node.getStart(), source);
    const endPos = this.getPosition(node.getEnd(), source);

    const baseClasses: string[] = [];
    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          for (const type of clause.types) {
            if (ts.isIdentifier(type.expression)) {
              baseClasses.push(type.expression.text);
            }
          }
        }
      }
    }

    const methods: string[] = [];
    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) && member.name) {
        methods.push(ts.isIdentifier(member.name) ? member.name.text : member.name.getText());
      } else if (ts.isConstructorDeclaration(member)) {
        methods.push('constructor');
      }
    }

    return {
      name,
      startLine: startPos.row + 1,
      endLine: endPos.row + 1,
      baseClasses,
      methods,
      isExported: this.hasExportModifier(node),
    };
  }

  /**
   * Extract an import declaration
   */
  private extractImportDeclaration(node: ts.ImportDeclaration): ImportExtraction | null {
    const moduleSpecifier = node.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) {return null;}

    const source = moduleSpecifier.text;
    const names: ImportExtraction['names'] = [];
    const isTypeOnly = node.importClause?.isTypeOnly ?? false;

    if (node.importClause) {
      if (node.importClause.name) {
        names.push({
          imported: 'default',
          local: node.importClause.name.text,
          isDefault: true,
          isNamespace: false,
        });
      }

      if (node.importClause.namedBindings) {
        if (ts.isNamespaceImport(node.importClause.namedBindings)) {
          names.push({
            imported: '*',
            local: node.importClause.namedBindings.name.text,
            isDefault: false,
            isNamespace: true,
          });
        } else if (ts.isNamedImports(node.importClause.namedBindings)) {
          for (const element of node.importClause.namedBindings.elements) {
            names.push({
              imported: element.propertyName?.text ?? element.name.text,
              local: element.name.text,
              isDefault: false,
              isNamespace: false,
            });
          }
        }
      }
    }

    if (names.length === 0) {return null;}

    return {
      source,
      names,
      line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
      isTypeOnly,
    };
  }

  /**
   * Extract an export declaration
   */
  private extractExportDeclaration(node: ts.ExportDeclaration, _source: string): ExportExtraction[] {
    const exports: ExportExtraction[] = [];
    const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const result: ExportExtraction = {
          name: element.propertyName?.text ?? element.name.text,
          isDefault: false,
          isReExport: !!node.moduleSpecifier,
          line,
        };
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          result.source = node.moduleSpecifier.text;
        }
        exports.push(result);
      }
    }

    return exports;
  }

  /**
   * Extract an exported declaration
   */
  private extractExportedDeclaration(node: ts.Node, _source: string): ExportExtraction | null {
    const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

    if (ts.isFunctionDeclaration(node) && node.name) {
      return { name: node.name.text, isDefault: false, isReExport: false, line };
    }
    if (ts.isClassDeclaration(node) && node.name) {
      return { name: node.name.text, isDefault: false, isReExport: false, line };
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          return { name: decl.name.text, isDefault: false, isReExport: false, line };
        }
      }
    }

    return null;
  }

  /**
   * Check if node has export modifier
   */
  private hasExportModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  /**
   * Extract parameters
   */
  private extractParameters(params: ts.NodeArray<ts.ParameterDeclaration>): ParameterInfo[] {
    return params.map((param) => {
      const name = ts.isIdentifier(param.name) ? param.name.text : param.name.getText();
      return {
        name,
        type: param.type?.getText(),
        hasDefault: !!param.initializer,
        isRest: !!param.dotDotDotToken,
      };
    });
  }

  /**
   * Extract decorators
   */
  private extractDecorators(node: ts.Node): string[] {
    const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
    return decorators?.map((d) => d.getText()) ?? [];
  }

  /**
   * Get position from character index
   */
  private getPosition(index: number, source: string): { row: number; column: number } {
    const lines = source.slice(0, index).split('\n');
    return {
      row: lines.length - 1,
      column: lines[lines.length - 1]?.length ?? 0,
    };
  }
}

/**
 * Factory function
 */
export function createTypeScriptHybridExtractor(config?: HybridExtractorConfig): TypeScriptHybridExtractor {
  return new TypeScriptHybridExtractor(config);
}
