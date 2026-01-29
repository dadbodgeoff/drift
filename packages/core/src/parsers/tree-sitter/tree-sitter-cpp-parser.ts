/**
 * Tree-Sitter C++ Parser Utilities
 *
 * Provides C++-specific parsing utilities built on tree-sitter.
 * Handles C++ syntax including:
 * - Functions and methods
 * - Classes, structs, and enums
 * - Templates and specializations
 * - Namespaces
 * - Virtual functions and inheritance
 * - Smart pointers and RAII patterns
 * - Operator overloading
 *
 * @license Apache-2.0
 */

import { isCppTreeSitterAvailable, createCppParser } from './cpp-loader.js';

import type { TreeSitterNode, TreeSitterParser } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface CppFunction {
  name: string;
  qualifiedName: string;
  isVirtual: boolean;
  isPureVirtual: boolean;
  isStatic: boolean;
  isConst: boolean;
  isNoexcept: boolean;
  isConstexpr: boolean;
  isInline: boolean;
  isExplicit: boolean;
  accessSpecifier: 'public' | 'protected' | 'private' | 'none';
  parameters: CppParameter[];
  returnType?: string;
  templateParams: CppTemplateParam[];
  startLine: number;
  endLine: number;
  className?: string;
  namespaceName?: string;
}

export interface CppParameter {
  name: string;
  type: string;
  hasDefault: boolean;
  defaultValue?: string | undefined;
  isConst: boolean;
  isReference: boolean;
  isPointer: boolean;
  isRvalueRef: boolean;
}

export interface CppTemplateParam {
  name: string;
  kind: 'type' | 'non-type' | 'template';
  constraint?: string | undefined;
  default?: string | undefined;
}

export interface CppClass {
  name: string;
  kind: 'class' | 'struct';
  isTemplate: boolean;
  templateParams: CppTemplateParam[];
  baseClasses: CppBaseClass[];
  methods: string[];
  virtualMethods: string[];
  fields: CppField[];
  accessSpecifier: 'public' | 'protected' | 'private' | 'none';
  startLine: number;
  endLine: number;
  namespaceName?: string;
}

export interface CppBaseClass {
  name: string;
  accessSpecifier: 'public' | 'protected' | 'private';
  isVirtual: boolean;
}

export interface CppField {
  name: string;
  type: string;
  accessSpecifier: 'public' | 'protected' | 'private';
  isStatic: boolean;
  isConst: boolean;
  isMutable: boolean;
}

export interface CppEnum {
  name: string;
  isScoped: boolean;
  underlyingType?: string;
  values: CppEnumValue[];
  startLine: number;
  endLine: number;
  namespaceName?: string;
}

export interface CppEnumValue {
  name: string;
  value?: string | undefined;
  line: number;
}

export interface CppNamespace {
  name: string;
  isAnonymous: boolean;
  startLine: number;
  endLine: number;
}

export interface CppInclude {
  path: string;
  isSystem: boolean;
  line: number;
}

export interface CppMacro {
  name: string;
  parameters?: string[];
  body?: string;
  line: number;
}

export interface CppParseResult {
  functions: CppFunction[];
  classes: CppClass[];
  enums: CppEnum[];
  namespaces: CppNamespace[];
  includes: CppInclude[];
  macros: CppMacro[];
  errors: string[];
}

// ============================================================================
// Parser Class
// ============================================================================

/**
 * C++-specific tree-sitter parser
 */
export class CppTreeSitterParser {
  private parser: TreeSitterParser | null = null;
  private currentAccessSpecifier: 'public' | 'protected' | 'private' | 'none' = 'none';
  private currentNamespace: string = '';

  /**
   * Check if tree-sitter-cpp is available
   */
  static isAvailable(): boolean {
    return isCppTreeSitterAvailable();
  }

  /**
   * Parse C++ source code
   */
  parse(source: string): CppParseResult {
    const result: CppParseResult = {
      functions: [],
      classes: [],
      enums: [],
      namespaces: [],
      includes: [],
      macros: [],
      errors: [],
    };

    if (!isCppTreeSitterAvailable()) {
      result.errors.push('Tree-sitter-cpp is not available');
      return result;
    }

    try {
      if (!this.parser) {
        this.parser = createCppParser();
      }

      const tree = this.parser.parse(source);
      this.currentNamespace = '';
      this.currentAccessSpecifier = 'none';
      this.visitNode(tree.rootNode, result, source);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Visit a node and extract information
   */
  private visitNode(node: TreeSitterNode, result: CppParseResult, source: string): void {
    switch (node.type) {
      case 'function_definition':
        this.extractFunction(node, result, source);
        break;

      case 'declaration':
        this.extractDeclaration(node, result, source);
        break;

      case 'class_specifier':
      case 'struct_specifier':
        this.extractClass(node, result, source);
        break;

      case 'enum_specifier':
        this.extractEnum(node, result);
        break;

      case 'namespace_definition':
        this.extractNamespace(node, result, source);
        return; // Don't recurse, handled internally

      case 'preproc_include':
        this.extractInclude(node, result);
        break;

      case 'preproc_def':
      case 'preproc_function_def':
        this.extractMacro(node, result);
        break;

      case 'access_specifier':
        this.updateAccessSpecifier(node);
        break;

      case 'template_declaration':
        this.extractTemplateDeclaration(node, result, source);
        return; // Don't recurse, handled internally

      default:
        // Recurse into children
        for (const child of node.children) {
          this.visitNode(child, result, source);
        }
    }
  }

  /**
   * Extract function information
   */
  private extractFunction(node: TreeSitterNode, result: CppParseResult, _source: string): void {
    const declaratorNode = node.childForFieldName('declarator');
    if (!declaratorNode) {return;}

    const { name, className } = this.extractFunctionName(declaratorNode);
    if (!name) {return;}

    const typeNode = node.childForFieldName('type');

    const fn: CppFunction = {
      name,
      qualifiedName: this.buildQualifiedName(name, className),
      isVirtual: this.hasSpecifier(node, 'virtual'),
      isPureVirtual: this.isPureVirtual(node),
      isStatic: this.hasSpecifier(node, 'static'),
      isConst: this.isConstMethod(declaratorNode),
      isNoexcept: this.hasNoexcept(declaratorNode),
      isConstexpr: this.hasSpecifier(node, 'constexpr'),
      isInline: this.hasSpecifier(node, 'inline'),
      isExplicit: this.hasSpecifier(node, 'explicit'),
      accessSpecifier: this.currentAccessSpecifier,
      parameters: this.extractParameters(declaratorNode),
      templateParams: [],
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };

    if (typeNode) {
      fn.returnType = this.extractType(typeNode);
    }

    if (className) {
      fn.className = className;
    }

    if (this.currentNamespace) {
      fn.namespaceName = this.currentNamespace;
    }

    result.functions.push(fn);
  }

  /**
   * Extract declaration (function declarations, variable declarations)
   */
  private extractDeclaration(node: TreeSitterNode, result: CppParseResult, source: string): void {
    // Check if this is a function declaration
    const declaratorNode = node.childForFieldName('declarator');
    if (declaratorNode && this.isFunctionDeclarator(declaratorNode)) {
      this.extractFunctionDeclaration(node, result, source);
    }
  }

  /**
   * Extract function declaration (prototype)
   */
  private extractFunctionDeclaration(node: TreeSitterNode, result: CppParseResult, _source: string): void {
    const declaratorNode = node.childForFieldName('declarator');
    if (!declaratorNode) {return;}

    const { name, className } = this.extractFunctionName(declaratorNode);
    if (!name) {return;}

    const typeNode = node.childForFieldName('type');

    const fn: CppFunction = {
      name,
      qualifiedName: this.buildQualifiedName(name, className),
      isVirtual: this.hasSpecifier(node, 'virtual'),
      isPureVirtual: this.isPureVirtual(node),
      isStatic: this.hasSpecifier(node, 'static'),
      isConst: this.isConstMethod(declaratorNode),
      isNoexcept: this.hasNoexcept(declaratorNode),
      isConstexpr: this.hasSpecifier(node, 'constexpr'),
      isInline: this.hasSpecifier(node, 'inline'),
      isExplicit: this.hasSpecifier(node, 'explicit'),
      accessSpecifier: this.currentAccessSpecifier,
      parameters: this.extractParameters(declaratorNode),
      templateParams: [],
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };

    if (typeNode) {
      fn.returnType = this.extractType(typeNode);
    }

    if (className) {
      fn.className = className;
    }

    if (this.currentNamespace) {
      fn.namespaceName = this.currentNamespace;
    }

    result.functions.push(fn);
  }

  /**
   * Extract class/struct information
   */
  private extractClass(node: TreeSitterNode, result: CppParseResult, source: string): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const kind = node.type === 'class_specifier' ? 'class' : 'struct';
    const bodyNode = node.childForFieldName('body');

    const cls: CppClass = {
      name,
      kind,
      isTemplate: false,
      templateParams: [],
      baseClasses: this.extractBaseClasses(node),
      methods: [],
      virtualMethods: [],
      fields: [],
      accessSpecifier: this.currentAccessSpecifier,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };

    if (this.currentNamespace) {
      cls.namespaceName = this.currentNamespace;
    }

    // Set default access specifier based on class/struct
    const savedAccessSpecifier = this.currentAccessSpecifier;
    this.currentAccessSpecifier = kind === 'class' ? 'private' : 'public';

    // Extract members from body
    if (bodyNode) {
      this.extractClassMembers(bodyNode, cls, result, source);
    }

    this.currentAccessSpecifier = savedAccessSpecifier;
    result.classes.push(cls);
  }

  /**
   * Extract class members
   */
  private extractClassMembers(
    bodyNode: TreeSitterNode,
    cls: CppClass,
    result: CppParseResult,
    source: string
  ): void {
    for (const child of bodyNode.children) {
      switch (child.type) {
        case 'access_specifier':
          this.updateAccessSpecifier(child);
          break;

        case 'function_definition':
          this.extractFunction(child, result, source);
          const fnName = this.extractFunctionNameFromNode(child);
          if (fnName) {
            cls.methods.push(fnName);
            if (this.hasSpecifier(child, 'virtual')) {
              cls.virtualMethods.push(fnName);
            }
          }
          break;

        case 'declaration':
          if (this.isFunctionDeclarator(child.childForFieldName('declarator'))) {
            this.extractFunctionDeclaration(child, result, source);
            const declName = this.extractFunctionNameFromNode(child);
            if (declName) {
              cls.methods.push(declName);
              if (this.hasSpecifier(child, 'virtual')) {
                cls.virtualMethods.push(declName);
              }
            }
          } else {
            // Field declaration
            const field = this.extractField(child);
            if (field) {
              cls.fields.push(field);
            }
          }
          break;

        case 'field_declaration':
          const fieldDecl = this.extractField(child);
          if (fieldDecl) {
            cls.fields.push(fieldDecl);
          }
          break;

        case 'template_declaration':
          this.extractTemplateDeclaration(child, result, source);
          break;
      }
    }
  }

  /**
   * Extract enum information
   */
  private extractEnum(node: TreeSitterNode, result: CppParseResult): void {
    const nameNode = node.childForFieldName('name');
    const bodyNode = node.childForFieldName('body');

    const name = nameNode?.text ?? '';
    const isScoped = this.isScopedEnum(node);

    const enumDef: CppEnum = {
      name,
      isScoped,
      values: [],
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };

    // Extract underlying type
    const baseNode = node.childForFieldName('base');
    if (baseNode) {
      enumDef.underlyingType = baseNode.text;
    }

    if (this.currentNamespace) {
      enumDef.namespaceName = this.currentNamespace;
    }

    // Extract enum values
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'enumerator') {
          const valueName = child.childForFieldName('name')?.text;
          const valueExpr = child.childForFieldName('value')?.text;

          if (valueName) {
            enumDef.values.push({
              name: valueName,
              value: valueExpr,
              line: child.startPosition.row + 1,
            });
          }
        }
      }
    }

    result.enums.push(enumDef);
  }

  /**
   * Extract namespace information
   */
  private extractNamespace(node: TreeSitterNode, result: CppParseResult, source: string): void {
    const nameNode = node.childForFieldName('name');
    const bodyNode = node.childForFieldName('body');

    const name = nameNode?.text ?? '';
    const isAnonymous = !nameNode;

    result.namespaces.push({
      name,
      isAnonymous,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });

    // Save and update namespace context
    const savedNamespace = this.currentNamespace;
    this.currentNamespace = this.currentNamespace
      ? `${this.currentNamespace}::${name}`
      : name;

    // Process namespace body
    if (bodyNode) {
      for (const child of bodyNode.children) {
        this.visitNode(child, result, source);
      }
    }

    this.currentNamespace = savedNamespace;
  }

  /**
   * Extract include directive
   */
  private extractInclude(node: TreeSitterNode, result: CppParseResult): void {
    const pathNode = node.childForFieldName('path');
    if (!pathNode) {return;}

    const pathText = pathNode.text;
    const isSystem = pathText.startsWith('<');
    const path = pathText.replace(/^[<"]|[>"]$/g, '');

    result.includes.push({
      path,
      isSystem,
      line: node.startPosition.row + 1,
    });
  }

  /**
   * Extract macro definition
   */
  private extractMacro(node: TreeSitterNode, result: CppParseResult): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const macro: CppMacro = {
      name: nameNode.text,
      line: node.startPosition.row + 1,
    };

    // Extract parameters for function-like macros
    const paramsNode = node.childForFieldName('parameters');
    if (paramsNode) {
      macro.parameters = [];
      for (const child of paramsNode.children) {
        if (child.type === 'identifier') {
          macro.parameters.push(child.text);
        }
      }
    }

    // Extract body
    const valueNode = node.childForFieldName('value');
    if (valueNode) {
      macro.body = valueNode.text;
    }

    result.macros.push(macro);
  }

  /**
   * Extract template declaration
   */
  private extractTemplateDeclaration(node: TreeSitterNode, result: CppParseResult, source: string): void {
    const paramsNode = node.childForFieldName('parameters');
    const templateParams = paramsNode ? this.extractTemplateParams(paramsNode) : [];

    // Find the templated declaration
    for (const child of node.children) {
      if (child.type === 'function_definition') {
        this.extractFunction(child, result, source);
        // Add template params to the last function
        if (result.functions.length > 0) {
          result.functions[result.functions.length - 1]!.templateParams = templateParams;
        }
      } else if (child.type === 'declaration') {
        this.extractDeclaration(child, result, source);
        if (result.functions.length > 0) {
          result.functions[result.functions.length - 1]!.templateParams = templateParams;
        }
      } else if (child.type === 'class_specifier' || child.type === 'struct_specifier') {
        this.extractClass(child, result, source);
        // Add template params to the last class
        if (result.classes.length > 0) {
          const lastClass = result.classes[result.classes.length - 1]!;
          lastClass.isTemplate = true;
          lastClass.templateParams = templateParams;
        }
      }
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private extractFunctionName(declaratorNode: TreeSitterNode): { name: string | null; className: string | null } {
    let name: string | null = null;
    let className: string | null = null;

    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'identifier') {
        name = n.text;
      } else if (n.type === 'field_identifier') {
        name = n.text;
      } else if (n.type === 'qualified_identifier') {
        const parts = n.text.split('::');
        name = parts[parts.length - 1] ?? null;
        if (parts.length > 1) {
          className = parts.slice(0, -1).join('::');
        }
      } else if (n.type === 'destructor_name') {
        name = n.text;
      } else if (n.type === 'operator_name') {
        name = n.text;
      } else if (n.type === 'function_declarator') {
        const innerDeclarator = n.childForFieldName('declarator');
        if (innerDeclarator) {
          visit(innerDeclarator);
        }
      } else if (n.type === 'pointer_declarator' || n.type === 'reference_declarator') {
        for (const child of n.children) {
          visit(child);
        }
      }
    };

    visit(declaratorNode);
    return { name, className };
  }

  private extractFunctionNameFromNode(node: TreeSitterNode): string | null {
    const declaratorNode = node.childForFieldName('declarator');
    if (!declaratorNode) {return null;}
    const { name } = this.extractFunctionName(declaratorNode);
    return name;
  }

  private buildQualifiedName(name: string, className: string | null): string {
    const parts: string[] = [];
    if (this.currentNamespace) {
      parts.push(this.currentNamespace);
    }
    if (className) {
      parts.push(className);
    }
    parts.push(name);
    return parts.join('::');
  }

  private extractParameters(declaratorNode: TreeSitterNode): CppParameter[] {
    const params: CppParameter[] = [];

    const findParams = (n: TreeSitterNode): TreeSitterNode | null => {
      if (n.type === 'function_declarator') {
        return n.childForFieldName('parameters');
      }
      for (const child of n.children) {
        const result = findParams(child);
        if (result) {return result;}
      }
      return null;
    };

    const paramsNode = findParams(declaratorNode);
    if (!paramsNode) {return params;}

    for (const child of paramsNode.children) {
      if (child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type');
        const declarator = child.childForFieldName('declarator');
        const defaultValue = child.childForFieldName('default_value');

        const typeText = typeNode?.text ?? 'unknown';
        let name = 'unnamed';

        if (declarator) {
          const { name: paramName } = this.extractFunctionName(declarator);
          if (paramName) {name = paramName;}
        }

        params.push({
          name,
          type: typeText,
          hasDefault: !!defaultValue,
          defaultValue: defaultValue?.text,
          isConst: typeText.includes('const'),
          isReference: typeText.includes('&') && !typeText.includes('&&'),
          isPointer: typeText.includes('*'),
          isRvalueRef: typeText.includes('&&'),
        });
      }
    }

    return params;
  }

  private extractTemplateParams(paramsNode: TreeSitterNode): CppTemplateParam[] {
    const params: CppTemplateParam[] = [];

    for (const child of paramsNode.children) {
      if (child.type === 'type_parameter_declaration') {
        const nameNode = child.childForFieldName('name');
        const defaultNode = child.childForFieldName('default_type');

        params.push({
          name: nameNode?.text ?? 'T',
          kind: 'type',
          default: defaultNode?.text,
        });
      } else if (child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type');
        const declarator = child.childForFieldName('declarator');

        params.push({
          name: declarator?.text ?? 'N',
          kind: 'non-type',
          constraint: typeNode?.text,
        });
      } else if (child.type === 'template_template_parameter_declaration') {
        const nameNode = child.childForFieldName('name');

        params.push({
          name: nameNode?.text ?? 'Template',
          kind: 'template',
        });
      }
    }

    return params;
  }

  private extractBaseClasses(node: TreeSitterNode): CppBaseClass[] {
    const bases: CppBaseClass[] = [];

    for (const child of node.children) {
      if (child.type === 'base_class_clause') {
        for (const baseChild of child.children) {
          if (baseChild.type === 'type_identifier' || baseChild.type === 'qualified_identifier') {
            let accessSpecifier: 'public' | 'protected' | 'private' = 'private';
            let isVirtual = false;

            // Check siblings for access specifier and virtual
            let sibling = baseChild.previousSibling;
            while (sibling) {
              if (sibling.text === 'public') {accessSpecifier = 'public';}
              else if (sibling.text === 'protected') {accessSpecifier = 'protected';}
              else if (sibling.text === 'private') {accessSpecifier = 'private';}
              else if (sibling.text === 'virtual') {isVirtual = true;}
              sibling = sibling.previousSibling;
            }

            bases.push({
              name: baseChild.text,
              accessSpecifier,
              isVirtual,
            });
          }
        }
      }
    }

    return bases;
  }

  private extractField(node: TreeSitterNode): CppField | null {
    const typeNode = node.childForFieldName('type');
    const declaratorNode = node.childForFieldName('declarator');

    if (!declaratorNode) {return null;}

    const { name } = this.extractFunctionName(declaratorNode);
    if (!name) {return null;}

    const typeText = typeNode?.text ?? 'unknown';

    return {
      name,
      type: typeText,
      accessSpecifier: this.currentAccessSpecifier === 'none' ? 'private' : this.currentAccessSpecifier,
      isStatic: this.hasSpecifier(node, 'static'),
      isConst: typeText.includes('const'),
      isMutable: this.hasSpecifier(node, 'mutable'),
    };
  }

  private extractType(typeNode: TreeSitterNode): string {
    return typeNode.text;
  }

  private hasSpecifier(node: TreeSitterNode, specifier: string): boolean {
    for (const child of node.children) {
      if (child.type === 'storage_class_specifier' || child.type === 'type_qualifier') {
        if (child.text === specifier) {return true;}
      }
      if (child.text === specifier) {return true;}
    }
    return false;
  }

  private isPureVirtual(node: TreeSitterNode): boolean {
    // Look for = 0 at the end
    const text = node.text;
    return /=\s*0\s*;?\s*$/.test(text);
  }

  private isConstMethod(declaratorNode: TreeSitterNode): boolean {
    // Look for const after the parameter list
    const text = declaratorNode.text;
    return /\)\s*const/.test(text);
  }

  private hasNoexcept(declaratorNode: TreeSitterNode): boolean {
    const text = declaratorNode.text;
    return text.includes('noexcept');
  }

  private isFunctionDeclarator(node: TreeSitterNode | null): boolean {
    if (!node) {return false;}

    const visit = (n: TreeSitterNode): boolean => {
      if (n.type === 'function_declarator') {return true;}
      for (const child of n.children) {
        if (visit(child)) {return true;}
      }
      return false;
    };

    return visit(node);
  }

  private isScopedEnum(node: TreeSitterNode): boolean {
    for (const child of node.children) {
      if (child.text === 'class' || child.text === 'struct') {
        return true;
      }
    }
    return false;
  }

  private updateAccessSpecifier(node: TreeSitterNode): void {
    const text = node.text.replace(':', '').trim();
    if (text === 'public') {this.currentAccessSpecifier = 'public';}
    else if (text === 'protected') {this.currentAccessSpecifier = 'protected';}
    else if (text === 'private') {this.currentAccessSpecifier = 'private';}
  }
}

/**
 * Create a C++ tree-sitter parser instance
 */
export function createCppTreeSitterParser(): CppTreeSitterParser {
  return new CppTreeSitterParser();
}
