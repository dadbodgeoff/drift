/**
 * Pydantic Field Extractor
 *
 * Extracts field definitions from Pydantic model class bodies.
 * Handles annotated assignments, Field() calls, and default values.
 *
 * @module pydantic/field-extractor
 */

import { ConstraintParser } from './constraint-parser.js';
import { TypeResolver } from './type-resolver.js';
import { extractPositionRange } from './types.js';

import type { TreeSitterNode , PydanticFieldInfo, FieldConstraints } from '../types.js';
import type { ExtractionContext, RawFieldData, FieldArgument } from './types.js';

// ============================================
// Field Extractor Class
// ============================================

/**
 * Extracts Pydantic field definitions from class bodies.
 *
 * Handles:
 * - Simple annotations: `name: str`
 * - Annotations with defaults: `name: str = "default"`
 * - Field() calls: `name: str = Field(default="value", min_length=1)`
 * - Optional fields: `name: Optional[str] = None`
 */
export class FieldExtractor {
  private readonly typeResolver: TypeResolver;
  private readonly constraintParser: ConstraintParser;

  constructor() {
    this.typeResolver = new TypeResolver();
    this.constraintParser = new ConstraintParser();
  }

  /**
   * Extract all fields from a class body node.
   *
   * @param bodyNode - The class body (block) node
   * @param context - Extraction context
   * @returns Array of extracted field information
   */
  extractFields(
    bodyNode: TreeSitterNode,
    context: ExtractionContext
  ): PydanticFieldInfo[] {
    const fields: PydanticFieldInfo[] = [];

    for (const child of bodyNode.namedChildren) {
      const field = this.extractField(child, context);
      if (field) {
        fields.push(field);
      }
    }

    return fields;
  }

  /**
   * Extract a single field from an AST node.
   *
   * @param node - AST node (expression_statement or typed_assignment)
   * @param context - Extraction context
   * @returns Field info or null if not a field
   */
  extractField(
    node: TreeSitterNode,
    context: ExtractionContext
  ): PydanticFieldInfo | null {
    // Handle expression_statement wrapper
    if (node.type === 'expression_statement') {
      const inner = node.namedChildren[0];
      if (!inner) {return null;}
      return this.extractField(inner, context);
    }

    // Must be an assignment with type annotation
    if (node.type !== 'assignment') {
      return null;
    }

    const rawData = this.extractRawFieldData(node);
    if (!rawData) {
      return null;
    }

    return this.processRawField(rawData, context);
  }

  // ============================================
  // Raw Data Extraction
  // ============================================

  /**
   * Extract raw field data from an assignment node.
   */
  private extractRawFieldData(node: TreeSitterNode): RawFieldData | null {
    // Get the left side (should be identifier with type annotation)
    const left = node.childForFieldName('left');
    if (!left) {return null;}

    // Check for type annotation
    const typeNode = node.childForFieldName('type');
    
    // Get field name
    let name: string;
    if (left.type === 'identifier') {
      name = left.text;
    } else {
      return null; // Not a simple field assignment
    }

    // Skip private/dunder fields
    if (name.startsWith('_')) {
      return null;
    }

    // Get type annotation
    const typeAnnotation = typeNode?.text ?? null;

    // Get right side (default value)
    const right = node.childForFieldName('right');
    const defaultValue = right?.text ?? null;

    // Check if Field() is used
    const { usesField, fieldArguments } = this.parseFieldCall(right);

    return {
      name,
      typeAnnotation,
      defaultValue,
      usesField,
      fieldArguments,
      node,
    };
  }

  /**
   * Parse a Field() call and extract arguments.
   */
  private parseFieldCall(node: TreeSitterNode | null): {
    usesField: boolean;
    fieldArguments: FieldArgument[];
  } {
    if (!node) {
      return { usesField: false, fieldArguments: [] };
    }

    // Check if this is a call to Field
    if (node.type !== 'call') {
      return { usesField: false, fieldArguments: [] };
    }

    const funcNode = node.childForFieldName('function');
    if (!funcNode) {
      return { usesField: false, fieldArguments: [] };
    }

    // Check function name
    const funcName = funcNode.text;
    if (funcName !== 'Field' && !funcName.endsWith('.Field')) {
      return { usesField: false, fieldArguments: [] };
    }

    // Extract arguments
    const argsNode = node.childForFieldName('arguments');
    const fieldArguments = this.extractCallArguments(argsNode);

    return { usesField: true, fieldArguments };
  }

  /**
   * Extract arguments from a call's argument_list.
   */
  private extractCallArguments(argsNode: TreeSitterNode | null): FieldArgument[] {
    if (!argsNode) {return [];}

    const args: FieldArgument[] = [];

    for (const child of argsNode.namedChildren) {
      if (child.type === 'keyword_argument') {
        const nameNode = child.childForFieldName('name');
        const valueNode = child.childForFieldName('value');
        if (nameNode && valueNode) {
          args.push({
            name: nameNode.text,
            value: valueNode.text,
            isKeyword: true,
          });
        }
      } else {
        // Positional argument
        args.push({
          name: null,
          value: child.text,
          isKeyword: false,
        });
      }
    }

    return args;
  }

  // ============================================
  // Field Processing
  // ============================================

  /**
   * Process raw field data into PydanticFieldInfo.
   */
  private processRawField(
    raw: RawFieldData,
    context: ExtractionContext
  ): PydanticFieldInfo {
    // Resolve type
    const typeInfo = raw.typeAnnotation
      ? this.typeResolver.resolve(raw.typeAnnotation, context)
      : this.typeResolver.createUnknownType();

    // Parse constraints from Field() arguments
    const constraints = raw.usesField
      ? this.constraintParser.parseConstraints(raw.fieldArguments)
      : this.createEmptyConstraints();

    // Determine if field is required
    const required = this.isFieldRequired(raw, typeInfo.isOptional);

    // Extract alias and description from constraints
    const alias = this.extractStringConstraint(raw.fieldArguments, 'alias');
    const description = this.extractStringConstraint(raw.fieldArguments, 'description');

    // Get default value (excluding Field() call)
    const defaultValue = this.extractDefaultValue(raw);

    // Build position info
    const positions = context.includePositions
      ? extractPositionRange(raw.node)
      : { startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 } };

    return {
      name: raw.name,
      type: typeInfo,
      defaultValue,
      hasDefault: raw.defaultValue !== null,
      usesField: raw.usesField,
      constraints,
      alias,
      description,
      required,
      ...positions,
    };
  }

  /**
   * Determine if a field is required.
   */
  private isFieldRequired(raw: RawFieldData, isOptional: boolean): boolean {
    // If Optional type, not required
    if (isOptional) {return false;}

    // If has default value, not required
    if (raw.defaultValue !== null) {return false;}

    // If Field() with default or default_factory, not required
    if (raw.usesField) {
      const hasDefault = raw.fieldArguments.some(
        (arg) => arg.name === 'default' || arg.name === 'default_factory'
      );
      if (hasDefault) {return false;}

      // Check for ... (Ellipsis) as first positional arg (required marker)
      const firstPositional = raw.fieldArguments.find((arg) => !arg.isKeyword);
      if (firstPositional?.value === '...') {return true;}
    }

    return true;
  }

  /**
   * Extract the actual default value (not Field() call).
   */
  private extractDefaultValue(raw: RawFieldData): string | null {
    if (!raw.defaultValue) {return null;}

    // If using Field(), extract default from arguments
    if (raw.usesField) {
      const defaultArg = raw.fieldArguments.find((arg) => arg.name === 'default');
      if (defaultArg) {
        return defaultArg.value;
      }
      // Check first positional argument (if not ...)
      const firstPositional = raw.fieldArguments.find((arg) => !arg.isKeyword);
      if (firstPositional && firstPositional.value !== '...') {
        return firstPositional.value;
      }
      return null;
    }

    return raw.defaultValue;
  }

  /**
   * Extract a string constraint value.
   */
  private extractStringConstraint(
    args: FieldArgument[],
    name: string
  ): string | null {
    const arg = args.find((a) => a.name === name);
    if (!arg) {return null;}

    // Remove quotes from string value
    const value = arg.value;
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }

  /**
   * Create empty constraints object.
   */
  private createEmptyConstraints(): FieldConstraints {
    return {
      ge: null,
      le: null,
      gt: null,
      lt: null,
      minLength: null,
      maxLength: null,
      pattern: null,
      multipleOf: null,
      frozen: false,
      validators: [],
      jsonSchemaExtra: null,
    };
  }
}
