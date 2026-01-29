/**
 * Tree-sitter Java Parser
 *
 * Full Java parser using tree-sitter-java for semantic extraction.
 * Extracts packages, imports, classes, interfaces, enums, records,
 * methods, fields, and annotations from Java source files.
 *
 * Annotations are FIRST-CLASS CITIZENS - they're the primary signal
 * for Spring pattern detection.
 *
 * @requirements Java/Spring Boot Language Support
 */

import {
  extractClasses,
  extractInterfaces,
  extractEnums,
  extractRecords,
  extractAnnotationDefinitions,
} from './java/class-extractor.js';
import {
  isJavaTreeSitterAvailable,
  createJavaParser,
  getJavaLoadingError,
} from './java-loader.js';

import type { Position, ASTNode, AST } from '../types.js';
import type {
  JavaParseResult,
  PackageInfo,
  JavaImportInfo,
} from './java/types.js';
import type { TreeSitterNode, TreeSitterParser } from './types.js';

// ============================================
// Parser Class
// ============================================

/**
 * Java parser using tree-sitter-java.
 *
 * Provides full semantic extraction for Java source files including:
 * - Package declarations
 * - Import statements
 * - Class, interface, enum, and record declarations
 * - Method and field declarations with annotations
 * - Annotation definitions (@interface)
 */
export class TreeSitterJavaParser {
  private parser: TreeSitterParser | null = null;
  private initError: string | null = null;

  /**
   * Check if the parser is available.
   */
  isAvailable(): boolean {
    return isJavaTreeSitterAvailable();
  }

  /**
   * Get the initialization error if parser is not available.
   */
  getError(): string | null {
    return this.initError ?? getJavaLoadingError();
  }

  /**
   * Initialize the parser.
   * Call this before parsing or check isAvailable() first.
   */
  initialize(): boolean {
    if (this.parser) {
      return true;
    }

    if (!isJavaTreeSitterAvailable()) {
      this.initError = getJavaLoadingError() ?? 'tree-sitter-java not available';
      return false;
    }

    try {
      this.parser = createJavaParser();
      return true;
    } catch (error) {
      this.initError = error instanceof Error ? error.message : 'Failed to create Java parser';
      return false;
    }
  }

  /**
   * Parse Java source code and extract semantic information.
   *
   * @param source - Java source code
   * @param filePath - Optional file path for error reporting
   * @returns JavaParseResult with full semantic information
   */
  parse(source: string, filePath?: string): JavaParseResult {
    // Ensure parser is initialized
    if (!this.parser && !this.initialize()) {
      return this.createErrorResult(
        this.initError ?? 'Parser not initialized',
        filePath
      );
    }

    if (!this.parser) {
      return this.createErrorResult('Parser not available', filePath);
    }

    try {
      // Parse the source
      const tree = this.parser.parse(source);
      const rootNode = tree.rootNode;

      // Extract semantic information
      const packageInfo = this.extractPackage(rootNode);
      const imports = this.extractImports(rootNode);
      const packageName = packageInfo?.name ?? null;

      // Extract type declarations
      const classes = extractClasses(rootNode, packageName, imports);
      const interfaces = extractInterfaces(rootNode, packageName, imports);
      const enums = extractEnums(rootNode, packageName, imports);
      const records = extractRecords(rootNode, packageName, imports);
      const annotationDefinitions = extractAnnotationDefinitions(rootNode, packageName, imports);

      // Convert to AST for base result
      const ast = this.convertToAST(rootNode, source);

      return {
        success: true,
        language: 'java',
        ast,
        errors: [],
        package: packageInfo,
        imports,
        classes,
        interfaces,
        enums,
        records,
        annotationDefinitions,
      };
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Parse error',
        filePath
      );
    }
  }

  /**
   * Extract package declaration from the AST.
   */
  private extractPackage(root: TreeSitterNode): PackageInfo | null {
    const packageNode = this.findChildByType(root, 'package_declaration');
    if (!packageNode) {
      return null;
    }

    // Find the scoped identifier (package name)
    let name = '';
    for (const child of packageNode.children) {
      if (child.type === 'scoped_identifier' || child.type === 'identifier') {
        name = child.text;
        break;
      }
    }

    if (!name) {
      return null;
    }

    return {
      name,
      startPosition: this.toPosition(packageNode.startPosition),
      endPosition: this.toPosition(packageNode.endPosition),
    };
  }

  /**
   * Extract import statements from the AST.
   */
  private extractImports(root: TreeSitterNode): JavaImportInfo[] {
    const imports: JavaImportInfo[] = [];

    this.findNodesOfType(root, 'import_declaration', (node) => {
      const importInfo = this.parseImport(node);
      if (importInfo) {
        imports.push(importInfo);
      }
    });

    return imports;
  }

  /**
   * Parse a single import declaration.
   */
  private parseImport(node: TreeSitterNode): JavaImportInfo | null {
    let path = '';
    let isStatic = false;
    let isWildcard = false;

    for (const child of node.children) {
      if (child.type === 'static') {
        isStatic = true;
      } else if (child.type === 'scoped_identifier' || child.type === 'identifier') {
        path = child.text;
      } else if (child.type === 'asterisk') {
        isWildcard = true;
        // Append .* to path if not already there
        if (!path.endsWith('.*')) {
          path = path ? `${path}.*` : '*';
        }
      }
    }

    if (!path) {
      return null;
    }

    return {
      path,
      isStatic,
      isWildcard,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
    };
  }

  /**
   * Convert tree-sitter AST to drift AST format.
   */
  private convertToAST(node: TreeSitterNode, source: string): AST {
    const rootNode = this.convertNode(node, source);
    return {
      rootNode,
      text: source,
    };
  }

  /**
   * Convert a single tree-sitter node to drift ASTNode.
   */
  private convertNode(node: TreeSitterNode, source: string): ASTNode {
    const children: ASTNode[] = [];

    for (const child of node.children) {
      children.push(this.convertNode(child, source));
    }

    return {
      type: this.mapNodeType(node.type),
      text: node.text,
      children,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
    };
  }

  /**
   * Map tree-sitter node types to drift node types.
   */
  private mapNodeType(type: string): string {
    const typeMap: Record<string, string> = {
      program: 'Program',
      package_declaration: 'PackageDeclaration',
      import_declaration: 'ImportDeclaration',
      class_declaration: 'ClassDeclaration',
      interface_declaration: 'InterfaceDeclaration',
      enum_declaration: 'EnumDeclaration',
      record_declaration: 'RecordDeclaration',
      annotation_type_declaration: 'AnnotationTypeDeclaration',
      method_declaration: 'MethodDeclaration',
      constructor_declaration: 'ConstructorDeclaration',
      field_declaration: 'FieldDeclaration',
      annotation: 'Annotation',
      marker_annotation: 'Annotation',
      identifier: 'Identifier',
      type_identifier: 'TypeIdentifier',
      scoped_identifier: 'ScopedIdentifier',
      formal_parameter: 'Parameter',
      block: 'Block',
      expression_statement: 'ExpressionStatement',
      return_statement: 'ReturnStatement',
      if_statement: 'IfStatement',
      for_statement: 'ForStatement',
      while_statement: 'WhileStatement',
      try_statement: 'TryStatement',
      throw_statement: 'ThrowStatement',
    };

    return typeMap[type] ?? type;
  }

  /**
   * Convert tree-sitter position to drift Position.
   */
  private toPosition(point: { row: number; column: number }): Position {
    return {
      row: point.row,
      column: point.column,
    };
  }

  /**
   * Find a child node by type.
   */
  private findChildByType(node: TreeSitterNode, type: string): TreeSitterNode | null {
    for (const child of node.children) {
      if (child.type === type) {
        return child;
      }
    }
    return null;
  }

  /**
   * Find all nodes of a specific type in the tree.
   */
  private findNodesOfType(
    node: TreeSitterNode,
    type: string,
    callback: (node: TreeSitterNode) => void
  ): void {
    if (node.type === type) {
      callback(node);
    }
    for (const child of node.children) {
      this.findNodesOfType(child, type, callback);
    }
  }

  /**
   * Create an error result.
   */
  private createErrorResult(message: string, _filePath?: string): JavaParseResult {
    return {
      success: false,
      language: 'java',
      ast: null,
      errors: [
        {
          message,
          position: { row: 0, column: 0 },
        },
      ],
      package: null,
      imports: [],
      classes: [],
      interfaces: [],
      enums: [],
      records: [],
      annotationDefinitions: [],
    };
  }
}

// ============================================
// Export Types
// ============================================

export type { JavaParseResult };
