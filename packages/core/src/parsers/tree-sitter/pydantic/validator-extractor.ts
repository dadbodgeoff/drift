/**
 * Pydantic Validator Extractor
 *
 * Extracts validator definitions from Pydantic model classes.
 * Handles both v1 (@validator, @root_validator) and v2 (@field_validator, @model_validator).
 *
 * @module pydantic/validator-extractor
 */

import { extractPositionRange } from './types.js';

import type { TreeSitterNode , PydanticValidatorInfo } from '../types.js';
import type { ExtractionContext, RawValidatorData, ValidatorDecoratorType, ValidatorMode } from './types.js';

// ============================================
// Validator Extractor Class
// ============================================

/**
 * Extracts Pydantic validator definitions.
 *
 * Handles:
 * - v1: @validator('field1', 'field2', pre=True)
 * - v1: @root_validator(pre=True)
 * - v2: @field_validator('field1', 'field2', mode='before')
 * - v2: @model_validator(mode='before')
 * - v2: @computed_field
 */
export class ValidatorExtractor {
  /**
   * Extract all validators from a class body.
   *
   * @param bodyNode - The class body (block) node
   * @param context - Extraction context
   * @returns Array of validator information
   */
  extractValidators(
    bodyNode: TreeSitterNode,
    context: ExtractionContext
  ): PydanticValidatorInfo[] {
    const validators: PydanticValidatorInfo[] = [];

    for (const child of bodyNode.namedChildren) {
      // Look for decorated function definitions
      if (child.type === 'decorated_definition') {
        const validator = this.extractValidator(child, context);
        if (validator) {
          validators.push(validator);
        }
      }
    }

    return validators;
  }

  /**
   * Extract a single validator from a decorated definition.
   */
  private extractValidator(
    node: TreeSitterNode,
    context: ExtractionContext
  ): PydanticValidatorInfo | null {
    // Find the decorator
    const decorators = this.findDecorators(node);
    const validatorDecorator = this.findValidatorDecorator(decorators);

    if (!validatorDecorator) {
      return null;
    }

    // Find the function definition
    const funcDef = this.findFunctionDefinition(node);
    if (!funcDef) {
      return null;
    }

    // Extract raw data
    const rawData = this.extractRawValidatorData(
      funcDef,
      validatorDecorator.decorator,
      validatorDecorator.type
    );

    if (!rawData) {
      return null;
    }

    return this.processRawValidator(rawData, context);
  }

  // ============================================
  // Decorator Detection
  // ============================================

  /**
   * Find all decorators in a decorated definition.
   */
  private findDecorators(node: TreeSitterNode): TreeSitterNode[] {
    const decorators: TreeSitterNode[] = [];

    for (const child of node.namedChildren) {
      if (child.type === 'decorator') {
        decorators.push(child);
      }
    }

    return decorators;
  }

  /**
   * Find a validator decorator among decorators.
   */
  private findValidatorDecorator(
    decorators: TreeSitterNode[]
  ): { decorator: TreeSitterNode; type: ValidatorDecoratorType } | null {
    for (const decorator of decorators) {
      const type = this.getValidatorDecoratorType(decorator);
      if (type) {
        return { decorator, type };
      }
    }
    return null;
  }

  /**
   * Determine the validator decorator type.
   */
  private getValidatorDecoratorType(
    decorator: TreeSitterNode
  ): ValidatorDecoratorType | null {
    // Get the decorator content (call or identifier)
    const content = decorator.namedChildren[0];
    if (!content) {return null;}

    let name: string;

    if (content.type === 'call') {
      const func = content.childForFieldName('function');
      name = func?.text ?? '';
    } else if (content.type === 'identifier' || content.type === 'attribute') {
      name = content.text;
    } else {
      return null;
    }

    // Check for validator types
    if (name === 'validator' || name.endsWith('.validator')) {
      return 'validator';
    }
    if (name === 'root_validator' || name.endsWith('.root_validator')) {
      return 'root_validator';
    }
    if (name === 'field_validator' || name.endsWith('.field_validator')) {
      return 'field_validator';
    }
    if (name === 'model_validator' || name.endsWith('.model_validator')) {
      return 'model_validator';
    }
    if (name === 'computed_field' || name.endsWith('.computed_field')) {
      return 'computed_field';
    }

    return null;
  }

  /**
   * Find the function definition in a decorated definition.
   */
  private findFunctionDefinition(node: TreeSitterNode): TreeSitterNode | null {
    for (const child of node.namedChildren) {
      if (child.type === 'function_definition' || 
          child.type === 'async_function_definition') {
        return child;
      }
    }
    return null;
  }

  // ============================================
  // Raw Data Extraction
  // ============================================

  /**
   * Extract raw validator data from AST nodes.
   */
  private extractRawValidatorData(
    funcDef: TreeSitterNode,
    decorator: TreeSitterNode,
    decoratorType: ValidatorDecoratorType
  ): RawValidatorData | null {
    // Get function name
    const nameNode = funcDef.childForFieldName('name');
    if (!nameNode) {return null;}
    const name = nameNode.text;

    // Get decorator arguments
    const decoratorContent = decorator.namedChildren[0];
    const args = this.extractDecoratorArgs(decoratorContent);

    // Extract fields (for field validators)
    const fields = this.extractValidatorFields(args, decoratorType);

    // Extract mode
    const mode = this.extractValidatorMode(args, decoratorType);

    // Extract v1 flags
    const isPre = this.extractBooleanArg(args, 'pre');
    const isAlways = this.extractBooleanArg(args, 'always');
    const skipOnFailure = this.extractBooleanArg(args, 'check_fields') === false;

    return {
      name,
      decoratorType,
      fields,
      mode,
      isPre,
      isAlways,
      skipOnFailure,
      node: funcDef,
    };
  }

  /**
   * Extract arguments from decorator call.
   */
  private extractDecoratorArgs(
    content: TreeSitterNode | undefined
  ): Map<string | null, string> {
    const args = new Map<string | null, string>();

    if (content?.type !== 'call') {
      return args;
    }

    const argsNode = content.childForFieldName('arguments');
    if (!argsNode) {return args;}

    let positionalIndex = 0;
    for (const child of argsNode.namedChildren) {
      if (child.type === 'keyword_argument') {
        const nameNode = child.childForFieldName('name');
        const valueNode = child.childForFieldName('value');
        if (nameNode && valueNode) {
          args.set(nameNode.text, valueNode.text);
        }
      } else {
        // Positional argument - use index as key
        args.set(`__pos_${positionalIndex}`, child.text);
        positionalIndex++;
      }
    }

    return args;
  }

  /**
   * Extract field names from validator decorator.
   */
  private extractValidatorFields(
    args: Map<string | null, string>,
    decoratorType: ValidatorDecoratorType
  ): string[] {
    // Root/model validators don't have fields
    if (decoratorType === 'root_validator' || 
        decoratorType === 'model_validator' ||
        decoratorType === 'computed_field') {
      return [];
    }

    const fields: string[] = [];

    // Positional arguments are field names
    for (const [key, value] of args) {
      if (key?.startsWith('__pos_')) {
        // Remove quotes from string
        const field = this.unquote(value);
        if (field && field !== '*') {
          fields.push(field);
        }
      }
    }

    return fields;
  }

  /**
   * Extract validator mode.
   */
  private extractValidatorMode(
    args: Map<string | null, string>,
    decoratorType: ValidatorDecoratorType
  ): ValidatorMode | null {
    // v2 style: mode='before'
    const modeArg = args.get('mode');
    if (modeArg) {
      const mode = this.unquote(modeArg);
      if (this.isValidMode(mode)) {
        return mode;
      }
    }

    // v1 style: pre=True means 'before'
    if (decoratorType === 'validator' || decoratorType === 'root_validator') {
      const preArg = args.get('pre');
      if (preArg === 'True') {
        return 'before';
      }
      return 'after'; // Default for v1
    }

    return null;
  }

  /**
   * Extract a boolean argument.
   */
  private extractBooleanArg(
    args: Map<string | null, string>,
    name: string
  ): boolean {
    const value = args.get(name);
    return value === 'True';
  }

  /**
   * Remove quotes from a string value.
   */
  private unquote(value: string): string {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  /**
   * Check if a string is a valid validator mode.
   */
  private isValidMode(mode: string): mode is ValidatorMode {
    return ['before', 'after', 'wrap', 'plain'].includes(mode);
  }

  // ============================================
  // Processing
  // ============================================

  /**
   * Process raw validator data into PydanticValidatorInfo.
   */
  private processRawValidator(
    raw: RawValidatorData,
    context: ExtractionContext
  ): PydanticValidatorInfo {
    // Determine validator type
    const type = this.determineValidatorType(raw.decoratorType);

    // Determine mode
    const mode = raw.mode ?? (raw.isPre ? 'before' : 'after');

    // Build position info
    const positions = context.includePositions
      ? extractPositionRange(raw.node)
      : { startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 } };

    return {
      name: raw.name,
      fields: raw.fields,
      mode,
      type,
      isClassmethod: true, // Validators are always classmethods
      ...positions,
    };
  }

  /**
   * Determine the validator type category.
   */
  private determineValidatorType(
    decoratorType: ValidatorDecoratorType
  ): 'field' | 'model' | 'root' {
    switch (decoratorType) {
      case 'validator':
      case 'field_validator':
      case 'computed_field':
        return 'field';
      case 'root_validator':
        return 'root';
      case 'model_validator':
        return 'model';
      default:
        return 'field';
    }
  }
}
