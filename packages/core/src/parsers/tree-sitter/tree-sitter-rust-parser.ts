/**
 * Tree-Sitter Rust Parser Utilities
 *
 * Provides Rust-specific parsing utilities built on tree-sitter.
 * Handles Rust syntax including:
 * - Functions and methods
 * - Structs, enums, and traits
 * - Impl blocks
 * - Macros
 * - Async/await
 * - Lifetimes and generics
 *
 * @license Apache-2.0
 */

import { isRustTreeSitterAvailable, createRustParser } from './rust-loader.js';

import type { TreeSitterNode, TreeSitterParser } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface RustFunction {
  name: string;
  qualifiedName: string;
  isAsync: boolean;
  isUnsafe: boolean;
  isConst: boolean;
  isPublic: boolean;
  parameters: RustParameter[];
  returnType?: string;
  generics: RustGeneric[];
  lifetimes: string[];
  startLine: number;
  endLine: number;
}

export interface RustParameter {
  name: string;
  type: string;
  isMutable: boolean;
  isReference: boolean;
  lifetime?: string;
}

export interface RustGeneric {
  name: string;
  bounds: string[];
  default?: string;
}

export interface RustStruct {
  name: string;
  isPublic: boolean;
  fields: RustField[];
  generics: RustGeneric[];
  derives: string[];
  startLine: number;
  endLine: number;
}

export interface RustField {
  name: string;
  type: string;
  isPublic: boolean;
}

export interface RustEnum {
  name: string;
  isPublic: boolean;
  variants: RustEnumVariant[];
  generics: RustGeneric[];
  derives: string[];
  startLine: number;
  endLine: number;
}

export interface RustEnumVariant {
  name: string;
  kind: 'unit' | 'tuple' | 'struct';
  fields?: RustField[];
}

export interface RustTrait {
  name: string;
  isPublic: boolean;
  methods: RustTraitMethod[];
  supertraits: string[];
  generics: RustGeneric[];
  startLine: number;
  endLine: number;
}

export interface RustTraitMethod {
  name: string;
  isAsync: boolean;
  hasDefaultImpl: boolean;
  parameters: RustParameter[];
  returnType?: string;
}

export interface RustImpl {
  targetType: string;
  traitName?: string;
  methods: string[];
  generics: RustGeneric[];
  startLine: number;
  endLine: number;
}

export interface RustUse {
  path: string;
  alias?: string;
  isGlob: boolean;
  items: string[];
  isPublic: boolean;
  line: number;
}

export interface RustMacroCall {
  name: string;
  arguments: string;
  line: number;
  column: number;
}

export interface RustParseResult {
  functions: RustFunction[];
  structs: RustStruct[];
  enums: RustEnum[];
  traits: RustTrait[];
  impls: RustImpl[];
  uses: RustUse[];
  macros: RustMacroCall[];
  errors: string[];
}

// ============================================================================
// Parser Class
// ============================================================================

/**
 * Rust-specific tree-sitter parser
 */
export class RustTreeSitterParser {
  private parser: TreeSitterParser | null = null;

  /**
   * Check if tree-sitter-rust is available
   */
  static isAvailable(): boolean {
    return isRustTreeSitterAvailable();
  }

  /**
   * Parse Rust source code
   */
  parse(source: string): RustParseResult {
    const result: RustParseResult = {
      functions: [],
      structs: [],
      enums: [],
      traits: [],
      impls: [],
      uses: [],
      macros: [],
      errors: [],
    };

    if (!isRustTreeSitterAvailable()) {
      result.errors.push('Tree-sitter-rust is not available');
      return result;
    }

    try {
      if (!this.parser) {
        this.parser = createRustParser();
      }

      const tree = this.parser.parse(source);
      this.visitNode(tree.rootNode, result, source);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Visit a node and extract information
   */
  private visitNode(node: TreeSitterNode, result: RustParseResult, source: string): void {
    switch (node.type) {
      case 'function_item':
        this.extractFunction(node, result, source);
        break;

      case 'struct_item':
        this.extractStruct(node, result);
        break;

      case 'enum_item':
        this.extractEnum(node, result);
        break;

      case 'trait_item':
        this.extractTrait(node, result, source);
        break;

      case 'impl_item':
        this.extractImpl(node, result, source);
        break;

      case 'use_declaration':
        this.extractUse(node, result);
        break;

      case 'macro_invocation':
        this.extractMacro(node, result);
        break;

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
  private extractFunction(node: TreeSitterNode, result: RustParseResult, _source: string): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isPublic = this.hasVisibility(node, 'pub');
    const isAsync = this.hasModifier(node, 'async');
    const isUnsafe = this.hasModifier(node, 'unsafe');
    const isConst = this.hasModifier(node, 'const');

    const parametersNode = node.childForFieldName('parameters');
    const returnTypeNode = node.childForFieldName('return_type');
    const genericsNode = node.childForFieldName('type_parameters');

    const fn: RustFunction = {
      name,
      qualifiedName: name,
      isAsync,
      isUnsafe,
      isConst,
      isPublic,
      parameters: parametersNode ? this.extractParameters(parametersNode) : [],
      generics: genericsNode ? this.extractGenerics(genericsNode) : [],
      lifetimes: this.extractLifetimes(node),
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
    if (returnTypeNode) {
      fn.returnType = this.extractType(returnTypeNode);
    }
    result.functions.push(fn);
  }

  /**
   * Extract struct information
   */
  private extractStruct(node: TreeSitterNode, result: RustParseResult): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isPublic = this.hasVisibility(node, 'pub');
    const genericsNode = node.childForFieldName('type_parameters');
    const bodyNode = node.childForFieldName('body');

    result.structs.push({
      name,
      isPublic,
      fields: bodyNode ? this.extractStructFields(bodyNode) : [],
      generics: genericsNode ? this.extractGenerics(genericsNode) : [],
      derives: this.extractDerives(node),
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  }

  /**
   * Extract enum information
   */
  private extractEnum(node: TreeSitterNode, result: RustParseResult): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isPublic = this.hasVisibility(node, 'pub');
    const genericsNode = node.childForFieldName('type_parameters');
    const bodyNode = node.childForFieldName('body');

    result.enums.push({
      name,
      isPublic,
      variants: bodyNode ? this.extractEnumVariants(bodyNode) : [],
      generics: genericsNode ? this.extractGenerics(genericsNode) : [],
      derives: this.extractDerives(node),
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  }

  /**
   * Extract trait information
   */
  private extractTrait(node: TreeSitterNode, result: RustParseResult, source: string): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isPublic = this.hasVisibility(node, 'pub');
    const genericsNode = node.childForFieldName('type_parameters');
    const boundsNode = node.childForFieldName('bounds');
    const bodyNode = node.childForFieldName('body');

    result.traits.push({
      name,
      isPublic,
      methods: bodyNode ? this.extractTraitMethods(bodyNode, source) : [],
      supertraits: boundsNode ? this.extractTraitBounds(boundsNode) : [],
      generics: genericsNode ? this.extractGenerics(genericsNode) : [],
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  }

  /**
   * Extract impl block information
   */
  private extractImpl(node: TreeSitterNode, result: RustParseResult, _source: string): void {
    const typeNode = node.childForFieldName('type');
    const traitNode = node.childForFieldName('trait');
    const genericsNode = node.childForFieldName('type_parameters');
    const bodyNode = node.childForFieldName('body');

    if (!typeNode) {return;}

    const methods: string[] = [];
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'function_item') {
          const methodName = child.childForFieldName('name');
          if (methodName) {
            methods.push(methodName.text);
          }
        }
      }
    }

    const impl: RustImpl = {
      targetType: typeNode.text,
      methods,
      generics: genericsNode ? this.extractGenerics(genericsNode) : [],
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
    if (traitNode) {
      impl.traitName = traitNode.text;
    }
    result.impls.push(impl);
  }

  /**
   * Extract use declaration
   */
  private extractUse(node: TreeSitterNode, result: RustParseResult): void {
    const argumentNode = node.childForFieldName('argument');
    if (!argumentNode) {return;}

    const isPublic = this.hasVisibility(node, 'pub');
    const { path, items, isGlob, alias } = this.parseUsePath(argumentNode);

    const useDecl: RustUse = {
      path,
      isGlob,
      items,
      isPublic,
      line: node.startPosition.row + 1,
    };
    if (alias) {
      useDecl.alias = alias;
    }
    result.uses.push(useDecl);
  }

  /**
   * Extract macro invocation
   */
  private extractMacro(node: TreeSitterNode, result: RustParseResult): void {
    const macroNode = node.childForFieldName('macro');
    if (!macroNode) {return;}

    const argsNode = node.children.find(c => c.type === 'token_tree');

    result.macros.push({
      name: macroNode.text,
      arguments: argsNode?.text ?? '',
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private hasVisibility(node: TreeSitterNode, visibility: string): boolean {
    for (const child of node.children) {
      if (child.type === 'visibility_modifier') {
        return child.text.startsWith(visibility);
      }
    }
    return false;
  }

  private hasModifier(node: TreeSitterNode, modifier: string): boolean {
    for (const child of node.children) {
      if (child.text === modifier) {
        return true;
      }
    }
    return false;
  }

  private extractParameters(node: TreeSitterNode): RustParameter[] {
    const params: RustParameter[] = [];

    for (const child of node.children) {
      if (child.type === 'parameter') {
        const patternNode = child.childForFieldName('pattern');
        const typeNode = child.childForFieldName('type');

        if (patternNode) {
          const name = patternNode.text.replace(/^mut\s+/, '');
          const isMutable = patternNode.text.startsWith('mut ');

          const param: RustParameter = {
            name,
            type: typeNode?.text ?? 'unknown',
            isMutable,
            isReference: typeNode?.text.startsWith('&') ?? false,
          };
          const lifetime = this.extractLifetimeFromType(typeNode?.text ?? '');
          if (lifetime) {
            param.lifetime = lifetime;
          }
          params.push(param);
        }
      } else if (child.type === 'self_parameter') {
        const selfText = child.text;
        params.push({
          name: 'self',
          type: selfText,
          isMutable: selfText.includes('mut'),
          isReference: selfText.includes('&'),
        });
      }
    }

    return params;
  }

  private extractType(node: TreeSitterNode): string {
    // Skip the -> token
    for (const child of node.children) {
      if (child.type !== '->') {
        return child.text;
      }
    }
    return node.text;
  }

  private extractGenerics(node: TreeSitterNode): RustGeneric[] {
    const generics: RustGeneric[] = [];

    for (const child of node.children) {
      if (child.type === 'type_identifier' || child.type === 'constrained_type_parameter') {
        const name = child.childForFieldName('left')?.text ?? child.text;
        const boundsNode = child.childForFieldName('bounds');
        const bounds = boundsNode ? this.extractTraitBounds(boundsNode) : [];

        generics.push({ name, bounds });
      } else if (child.type === 'lifetime') {
        generics.push({ name: child.text, bounds: [] });
      }
    }

    return generics;
  }

  private extractLifetimes(node: TreeSitterNode): string[] {
    const lifetimes: string[] = [];

    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'lifetime') {
        lifetimes.push(n.text);
      }
      for (const child of n.children) {
        visit(child);
      }
    };

    visit(node);
    return [...new Set(lifetimes)];
  }

  private extractLifetimeFromType(type: string): string | undefined {
    const match = type.match(/'(\w+)/);
    return match?.[1];
  }

  private extractStructFields(node: TreeSitterNode): RustField[] {
    const fields: RustField[] = [];

    for (const child of node.children) {
      if (child.type === 'field_declaration') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        const isPublic = this.hasVisibility(child, 'pub');

        if (nameNode && typeNode) {
          fields.push({
            name: nameNode.text,
            type: typeNode.text,
            isPublic,
          });
        }
      }
    }

    return fields;
  }

  private extractEnumVariants(node: TreeSitterNode): RustEnumVariant[] {
    const variants: RustEnumVariant[] = [];

    for (const child of node.children) {
      if (child.type === 'enum_variant') {
        const nameNode = child.childForFieldName('name');
        if (!nameNode) {continue;}

        const name = nameNode.text;
        let kind: 'unit' | 'tuple' | 'struct' = 'unit';
        let fields: RustField[] | undefined;

        // Check for tuple or struct variant
        for (const variantChild of child.children) {
          if (variantChild.type === 'field_declaration_list') {
            kind = 'struct';
            fields = this.extractStructFields(variantChild);
          } else if (variantChild.type === 'ordered_field_declaration_list') {
            kind = 'tuple';
          }
        }

        const variant: RustEnumVariant = { name, kind };
        if (fields && fields.length > 0) {
          variant.fields = fields;
        }
        variants.push(variant);
      }
    }

    return variants;
  }

  private extractTraitMethods(node: TreeSitterNode, _source: string): RustTraitMethod[] {
    const methods: RustTraitMethod[] = [];

    for (const child of node.children) {
      if (child.type === 'function_signature_item' || child.type === 'function_item') {
        const nameNode = child.childForFieldName('name');
        if (!nameNode) {continue;}

        const parametersNode = child.childForFieldName('parameters');
        const returnTypeNode = child.childForFieldName('return_type');
        const hasDefaultImpl = child.type === 'function_item';
        const isAsync = this.hasModifier(child, 'async');

        const method: RustTraitMethod = {
          name: nameNode.text,
          isAsync,
          hasDefaultImpl,
          parameters: parametersNode ? this.extractParameters(parametersNode) : [],
        };
        if (returnTypeNode) {
          method.returnType = this.extractType(returnTypeNode);
        }
        methods.push(method);
      }
    }

    return methods;
  }

  private extractTraitBounds(node: TreeSitterNode): string[] {
    const bounds: string[] = [];

    for (const child of node.children) {
      if (child.type === 'type_identifier' || child.type === 'generic_type') {
        bounds.push(child.text);
      }
    }

    return bounds;
  }

  private extractDerives(node: TreeSitterNode): string[] {
    const derives: string[] = [];

    // Look for attribute nodes before the item
    let sibling = node.previousSibling;
    while (sibling) {
      if (sibling.type === 'attribute_item') {
        const attrText = sibling.text;
        const deriveMatch = attrText.match(/#\[derive\(([^)]+)\)\]/);
        if (deriveMatch) {
          const deriveList = deriveMatch[1]?.split(',').map(d => d.trim()) ?? [];
          derives.push(...deriveList);
        }
      }
      sibling = sibling.previousSibling;
    }

    return derives;
  }

  private parseUsePath(node: TreeSitterNode): {
    path: string;
    items: string[];
    isGlob: boolean;
    alias: string | null;
  } {
    const text = node.text;
    const isGlob = text.includes('*');
    const items: string[] = [];
    let path = text;
    let alias: string | null = null;

    // Handle use list: use foo::{bar, baz}
    const listMatch = text.match(/^(.+)::\{([^}]+)\}$/);
    if (listMatch) {
      path = listMatch[1] ?? '';
      items.push(...(listMatch[2]?.split(',').map(i => i.trim()) ?? []));
    }

    // Handle alias: use foo as bar
    const aliasMatch = text.match(/^(.+)\s+as\s+(\w+)$/);
    if (aliasMatch) {
      path = aliasMatch[1] ?? '';
      alias = aliasMatch[2] ?? null;
    }

    return { path, items, isGlob, alias };
  }
}

/**
 * Create a Rust tree-sitter parser instance
 */
export function createRustTreeSitterParser(): RustTreeSitterParser {
  return new RustTreeSitterParser();
}
