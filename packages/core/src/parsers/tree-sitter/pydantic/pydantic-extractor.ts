/**
 * Pydantic Model Extractor
 *
 * Main orchestrator for extracting Pydantic model information.
 * Coordinates field, validator, config, and inheritance extraction.
 *
 * @module pydantic/pydantic-extractor
 */

import { ConfigExtractor } from './config-extractor.js';
import { FieldExtractor } from './field-extractor.js';
import { InheritanceResolver } from './inheritance-resolver.js';
import { createExtractionContext, PYDANTIC_BASE_CLASSES } from './types.js';
import { ValidatorExtractor } from './validator-extractor.js';

import type { TreeSitterNode, TreeSitterTree , PydanticModelInfo, PydanticFieldInfo } from '../types.js';
import type { ExtractionContext } from './types.js';

// ============================================
// Pydantic Extractor Class
// ============================================

/**
 * Main Pydantic model extractor.
 *
 * Orchestrates extraction of:
 * - Model definitions
 * - Field definitions with types and constraints
 * - Validators (v1 and v2)
 * - Model configuration
 * - Inheritance resolution
 */
export class PydanticExtractor {
  private readonly fieldExtractor: FieldExtractor;
  private readonly validatorExtractor: ValidatorExtractor;
  private readonly configExtractor: ConfigExtractor;
  private readonly inheritanceResolver: InheritanceResolver;

  constructor() {
    this.fieldExtractor = new FieldExtractor();
    this.validatorExtractor = new ValidatorExtractor();
    this.configExtractor = new ConfigExtractor();
    this.inheritanceResolver = new InheritanceResolver();
  }

  /**
   * Extract all Pydantic models from a tree-sitter tree.
   *
   * @param tree - The parsed tree-sitter tree
   * @param source - Original source code
   * @param options - Extraction options
   * @returns Array of extracted model information
   */
  extractModels(
    tree: TreeSitterTree,
    source: string,
    options: Partial<ExtractionContext> = {}
  ): PydanticModelInfo[] {
    // First pass: find all model names
    const modelNames = this.findModelNames(tree.rootNode);

    // Create context with known models
    const context = createExtractionContext(source, {
      ...options,
      knownModels: new Set(modelNames),
    });

    // Extract type aliases
    this.extractTypeAliases(tree.rootNode, context);

    // Second pass: extract full model info
    const models: PydanticModelInfo[] = [];
    const classNodes = this.findClassDefinitions(tree.rootNode);

    for (const classNode of classNodes) {
      const model = this.extractModel(classNode, context);
      if (model) {
        models.push(model);
      }
    }

    return models;
  }

  /**
   * Extract a single model with resolved inheritance.
   *
   * @param modelName - Name of the model to extract
   * @param allModels - Map of all models
   * @returns Model with resolved inherited fields
   */
  resolveModel(
    modelName: string,
    allModels: Map<string, PydanticModelInfo>
  ): PydanticModelInfo | null {
    const model = allModels.get(modelName);
    if (!model) {return null;}

    const resolvedFields = this.inheritanceResolver.resolveFields(
      model,
      allModels
    );

    return {
      ...model,
      fields: resolvedFields,
    };
  }

  /**
   * Get all models as a map for easy lookup.
   */
  modelsToMap(models: PydanticModelInfo[]): Map<string, PydanticModelInfo> {
    const map = new Map<string, PydanticModelInfo>();
    for (const model of models) {
      map.set(model.name, model);
    }
    return map;
  }

  // ============================================
  // Model Extraction
  // ============================================

  /**
   * Extract a single Pydantic model from a class definition.
   */
  private extractModel(
    classNode: TreeSitterNode,
    context: ExtractionContext
  ): PydanticModelInfo | null {
    // Get class name
    const nameNode = classNode.childForFieldName('name');
    if (!nameNode) {return null;}
    const name = nameNode.text;

    // Get base classes
    const bases = this.extractBaseClasses(classNode);

    // Check if this is a Pydantic model
    if (!this.isPydanticModel(bases)) {
      return null;
    }

    // Get class body
    const bodyNode = classNode.childForFieldName('body');
    if (!bodyNode) {return null;}

    // Extract components
    const fields = this.fieldExtractor.extractFields(bodyNode, context);
    const validators = this.validatorExtractor.extractValidators(bodyNode, context);
    const config = this.configExtractor.extractConfig(bodyNode, context);

    // Extract decorators
    const decorators = this.extractDecorators(classNode);

    // Extract docstring
    const docstring = this.extractDocstring(bodyNode);

    // Detect Pydantic version
    const version = this.detectPydanticVersion(bodyNode, bases);

    // Build position info
    const positions = context.includePositions
      ? {
          startPosition: {
            row: classNode.startPosition.row,
            column: classNode.startPosition.column,
          },
          endPosition: {
            row: classNode.endPosition.row,
            column: classNode.endPosition.column,
          },
        }
      : {
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 0, column: 0 },
        };

    return {
      name,
      bases,
      fields,
      validators,
      config,
      decorators,
      docstring,
      version,
      ...positions,
    };
  }

  // ============================================
  // Discovery Methods
  // ============================================

  /**
   * Find all model names in the tree (first pass).
   */
  private findModelNames(rootNode: TreeSitterNode): string[] {
    const names: string[] = [];
    const classNodes = this.findClassDefinitions(rootNode);

    for (const classNode of classNodes) {
      const nameNode = classNode.childForFieldName('name');
      if (!nameNode) {continue;}

      const bases = this.extractBaseClasses(classNode);
      if (this.isPydanticModel(bases)) {
        names.push(nameNode.text);
      }
    }

    return names;
  }

  /**
   * Find all class definitions in the tree.
   */
  private findClassDefinitions(node: TreeSitterNode): TreeSitterNode[] {
    const classes: TreeSitterNode[] = [];
    this.walkTree(node, (n) => {
      if (n.type === 'class_definition') {
        classes.push(n);
      }
      // Also check decorated definitions
      if (n.type === 'decorated_definition') {
        for (const child of n.namedChildren) {
          if (child.type === 'class_definition') {
            classes.push(child);
          }
        }
      }
    });
    return classes;
  }

  /**
   * Extract type aliases from the tree.
   */
  private extractTypeAliases(
    rootNode: TreeSitterNode,
    context: ExtractionContext
  ): void {
    this.walkTree(rootNode, (node) => {
      if (node.type !== 'expression_statement') {return;}

      const inner = node.namedChildren[0];
      if (inner?.type !== 'assignment') {return;}

      const left = inner.childForFieldName('left');
      const right = inner.childForFieldName('right');

      if (!left || !right) {return;}
      if (left.type !== 'identifier') {return;}

      // Check if this looks like a type alias
      const name = left.text;
      const value = right.text;

      // Simple heuristic: uppercase first letter or ends with common type suffixes
      if (/^[A-Z]/.test(name) || name.endsWith('Type') || name.endsWith('T')) {
        context.typeAliases.set(name, value);
      }
    });
  }

  // ============================================
  // Base Class Handling
  // ============================================

  /**
   * Extract base classes from a class definition.
   */
  private extractBaseClasses(classNode: TreeSitterNode): string[] {
    const bases: string[] = [];
    const argumentList = classNode.childForFieldName('superclasses');

    if (!argumentList) {return bases;}

    for (const child of argumentList.namedChildren) {
      // Handle simple identifiers
      if (child.type === 'identifier') {
        bases.push(child.text);
      }
      // Handle attributes (e.g., pydantic.BaseModel)
      else if (child.type === 'attribute') {
        bases.push(child.text);
      }
      // Handle subscripts (e.g., Generic[T])
      else if (child.type === 'subscript') {
        bases.push(child.text);
      }
      // Handle calls (e.g., some_factory())
      else if (child.type === 'call') {
        const func = child.childForFieldName('function');
        if (func) {
          bases.push(func.text);
        }
      }
    }

    return bases;
  }

  /**
   * Check if base classes indicate a Pydantic model.
   */
  private isPydanticModel(bases: string[]): boolean {
    return bases.some((base) => {
      // Direct match
      if (PYDANTIC_BASE_CLASSES.has(base)) {return true;}

      // Check without generic args
      const baseName = base.split('[')[0];
      if (baseName && PYDANTIC_BASE_CLASSES.has(baseName)) {return true;}

      // Check for common patterns
      if (base.includes('BaseModel') || base.includes('BaseSettings')) {
        return true;
      }

      return false;
    });
  }

  // ============================================
  // Decorator & Docstring Extraction
  // ============================================

  /**
   * Extract decorators from a class.
   */
  private extractDecorators(classNode: TreeSitterNode): string[] {
    const decorators: string[] = [];
    const parent = classNode.parent;

    if (parent?.type === 'decorated_definition') {
      for (const child of parent.namedChildren) {
        if (child.type === 'decorator') {
          const content = child.namedChildren[0];
          if (content) {
            decorators.push(content.text);
          }
        }
      }
    }

    return decorators;
  }

  /**
   * Extract docstring from a class body.
   */
  private extractDocstring(bodyNode: TreeSitterNode): string | null {
    if (bodyNode.namedChildCount === 0) {return null;}

    const firstChild = bodyNode.namedChildren[0];
    if (firstChild?.type !== 'expression_statement') {return null;}

    const expr = firstChild.namedChildren[0];
    if (expr?.type !== 'string') {return null;}

    // Remove quotes
    const text = expr.text;
    if (text.startsWith('"""') || text.startsWith("'''")) {
      return text.slice(3, -3).trim();
    }
    if (text.startsWith('"') || text.startsWith("'")) {
      return text.slice(1, -1).trim();
    }

    return null;
  }

  // ============================================
  // Version Detection
  // ============================================

  /**
   * Detect Pydantic version from model structure.
   */
  private detectPydanticVersion(
    bodyNode: TreeSitterNode,
    bases: string[]
  ): 1 | 2 | 'unknown' {
    // Check for v2 indicators
    for (const child of bodyNode.namedChildren) {
      // model_config is v2
      if (child.type === 'expression_statement') {
        const inner = child.namedChildren[0];
        if (inner?.type === 'assignment') {
          const left = inner.childForFieldName('left');
          if (left?.text === 'model_config') {
            return 2;
          }
        }
      }

      // Config class is v1
      if (child.type === 'class_definition') {
        const name = child.childForFieldName('name');
        if (name?.text === 'Config') {
          return 1;
        }
      }

      // Check for v2 validators
      if (child.type === 'decorated_definition') {
        for (const decorator of child.namedChildren) {
          if (decorator.type === 'decorator') {
            const content = decorator.namedChildren[0];
            const text = content?.text ?? '';
            if (text.includes('field_validator') || text.includes('model_validator')) {
              return 2;
            }
            if (text.includes('validator') || text.includes('root_validator')) {
              return 1;
            }
          }
        }
      }
    }

    // Check base classes for hints
    if (bases.some((b) => b.includes('BaseSettings'))) {
      // BaseSettings exists in both, but v2 has different import
      return 'unknown';
    }

    return 'unknown';
  }

  // ============================================
  // Tree Walking
  // ============================================

  /**
   * Walk the tree and call visitor for each node.
   */
  private walkTree(
    node: TreeSitterNode,
    visitor: (n: TreeSitterNode) => void
  ): void {
    visitor(node);
    for (const child of node.children) {
      this.walkTree(child, visitor);
    }
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Convert extracted models to a flat field list for contracts.
 */
export function modelsToContractFields(
  models: PydanticModelInfo[],
  modelName: string
): PydanticFieldInfo[] | null {
  const model = models.find((m) => m.name === modelName);
  return model?.fields ?? null;
}

/**
 * Find a model by name in the extracted models.
 */
export function findModel(
  models: PydanticModelInfo[],
  name: string
): PydanticModelInfo | null {
  return models.find((m) => m.name === name) ?? null;
}

/**
 * Get all model names from extracted models.
 */
export function getModelNames(models: PydanticModelInfo[]): string[] {
  return models.map((m) => m.name);
}
