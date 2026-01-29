/**
 * Pydantic Constraint Parser
 *
 * Parses Field() constraints from function call arguments.
 * Handles numeric, string, and custom constraints.
 *
 * @module pydantic/constraint-parser
 */

import type { FieldConstraints } from '../types.js';
import type { FieldArgument } from './types.js';

// ============================================
// Constraint Parser Class
// ============================================

/**
 * Parses Pydantic Field() constraints.
 *
 * Handles:
 * - Numeric: ge, le, gt, lt, multiple_of
 * - String: min_length, max_length, pattern, regex
 * - Other: frozen, alias, title, description
 */
export class ConstraintParser {
  /**
   * Parse constraints from Field() arguments.
   *
   * @param args - Field() call arguments
   * @returns Parsed constraints
   */
  parseConstraints(args: FieldArgument[]): FieldConstraints {
    const constraints: FieldConstraints = {
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

    for (const arg of args) {
      if (!arg.isKeyword || !arg.name) {continue;}

      this.parseConstraintArg(arg.name, arg.value, constraints);
    }

    return constraints;
  }

  /**
   * Parse a single constraint argument.
   */
  private parseConstraintArg(
    name: string,
    value: string,
    constraints: FieldConstraints
  ): void {
    switch (name) {
      // Numeric constraints
      case 'ge':
        constraints.ge = this.parseNumber(value);
        break;
      case 'le':
        constraints.le = this.parseNumber(value);
        break;
      case 'gt':
        constraints.gt = this.parseNumber(value);
        break;
      case 'lt':
        constraints.lt = this.parseNumber(value);
        break;
      case 'multiple_of':
        constraints.multipleOf = this.parseNumber(value);
        break;

      // String constraints
      case 'min_length':
        constraints.minLength = this.parseNumber(value);
        break;
      case 'max_length':
        constraints.maxLength = this.parseNumber(value);
        break;
      case 'pattern':
      case 'regex':
        constraints.pattern = this.parseString(value);
        break;

      // Boolean constraints
      case 'frozen':
        constraints.frozen = this.parseBoolean(value);
        break;

      // JSON schema extra
      case 'json_schema_extra':
        constraints.jsonSchemaExtra = this.parseJsonSchemaExtra(value);
        break;

      // Validators (custom validation functions)
      case 'validator':
      case 'validators':
        const validators = this.parseValidators(value);
        constraints.validators.push(...validators);
        break;
    }
  }

  // ============================================
  // Value Parsers
  // ============================================

  /**
   * Parse a numeric value.
   */
  private parseNumber(value: string): number | null {
    const trimmed = value.trim();

    // Handle negative numbers
    const num = parseFloat(trimmed);
    if (!isNaN(num)) {
      return num;
    }

    return null;
  }

  /**
   * Parse a string value (remove quotes).
   */
  private parseString(value: string): string | null {
    const trimmed = value.trim();

    // Handle raw strings: r'pattern' or r"pattern"
    if (trimmed.startsWith('r"') || trimmed.startsWith("r'")) {
      return trimmed.slice(2, -1);
    }

    // Handle regular strings
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }

    // Handle triple-quoted strings
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      return trimmed.slice(3, -3);
    }

    return trimmed;
  }

  /**
   * Parse a boolean value.
   */
  private parseBoolean(value: string): boolean {
    const trimmed = value.trim().toLowerCase();
    return trimmed === 'true';
  }

  /**
   * Parse json_schema_extra value.
   */
  private parseJsonSchemaExtra(value: string): Record<string, unknown> | null {
    // This is typically a dict literal or function call
    // For now, we'll store the raw value and mark it as complex
    try {
      // Simple dict parsing for common cases
      if (value.startsWith('{') && value.endsWith('}')) {
        return this.parseSimpleDict(value);
      }
    } catch {
      // Fall through to return null
    }
    return null;
  }

  /**
   * Parse a simple Python dict literal.
   */
  private parseSimpleDict(value: string): Record<string, unknown> | null {
    // Remove braces
    const inner = value.slice(1, -1).trim();
    if (!inner) {return {};}

    const result: Record<string, unknown> = {};
    const pairs = this.splitDictPairs(inner);

    for (const pair of pairs) {
      const colonIndex = pair.indexOf(':');
      if (colonIndex === -1) {continue;}

      const key = this.parseString(pair.slice(0, colonIndex).trim());
      const val = pair.slice(colonIndex + 1).trim();

      if (key) {
        result[key] = this.parseValue(val);
      }
    }

    return result;
  }

  /**
   * Split dict pairs respecting nested structures.
   */
  private splitDictPairs(inner: string): string[] {
    const pairs: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < inner.length; i++) {
      const char = inner[i]!;
      const prevChar = inner[i - 1];

      // Handle string boundaries
      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
      }

      if (!inString) {
        if (char === '{' || char === '[' || char === '(') {depth++;}
        else if (char === '}' || char === ']' || char === ')') {depth--;}
        else if (char === ',' && depth === 0) {
          pairs.push(current.trim());
          current = '';
          continue;
        }
      }

      current += char;
    }

    if (current.trim()) {
      pairs.push(current.trim());
    }

    return pairs;
  }

  /**
   * Parse a generic Python value.
   */
  private parseValue(value: string): unknown {
    const trimmed = value.trim();

    // Boolean
    if (trimmed === 'True') {return true;}
    if (trimmed === 'False') {return false;}
    if (trimmed === 'None') {return null;}

    // Number
    const num = parseFloat(trimmed);
    if (!isNaN(num) && /^-?\d+\.?\d*$/.test(trimmed)) {
      return num;
    }

    // String
    const str = this.parseString(trimmed);
    if (str !== trimmed) {
      return str;
    }

    // List
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return this.parseSimpleList(trimmed);
    }

    // Dict
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return this.parseSimpleDict(trimmed);
    }

    // Return as-is for complex expressions
    return trimmed;
  }

  /**
   * Parse a simple Python list literal.
   */
  private parseSimpleList(value: string): unknown[] {
    const inner = value.slice(1, -1).trim();
    if (!inner) {return [];}

    const items = this.splitDictPairs(inner); // Same splitting logic works
    return items.map((item) => this.parseValue(item));
  }

  /**
   * Parse validator references.
   */
  private parseValidators(value: string): string[] {
    // Could be a single validator or list
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      return inner.split(',').map((v) => v.trim()).filter(Boolean);
    }
    return [value.trim()];
  }
}

// ============================================
// Constraint Utilities
// ============================================

/**
 * Check if constraints have any numeric constraints.
 */
export function hasNumericConstraints(constraints: FieldConstraints): boolean {
  return (
    constraints.ge !== null ||
    constraints.le !== null ||
    constraints.gt !== null ||
    constraints.lt !== null ||
    constraints.multipleOf !== null
  );
}

/**
 * Check if constraints have any string constraints.
 */
export function hasStringConstraints(constraints: FieldConstraints): boolean {
  return (
    constraints.minLength !== null ||
    constraints.maxLength !== null ||
    constraints.pattern !== null
  );
}

/**
 * Check if constraints are empty.
 */
export function hasAnyConstraints(constraints: FieldConstraints): boolean {
  return (
    hasNumericConstraints(constraints) ||
    hasStringConstraints(constraints) ||
    constraints.frozen ||
    constraints.validators.length > 0 ||
    constraints.jsonSchemaExtra !== null
  );
}

/**
 * Merge two constraint objects.
 */
export function mergeConstraints(
  base: FieldConstraints,
  override: Partial<FieldConstraints>
): FieldConstraints {
  return {
    ge: override.ge ?? base.ge,
    le: override.le ?? base.le,
    gt: override.gt ?? base.gt,
    lt: override.lt ?? base.lt,
    minLength: override.minLength ?? base.minLength,
    maxLength: override.maxLength ?? base.maxLength,
    pattern: override.pattern ?? base.pattern,
    multipleOf: override.multipleOf ?? base.multipleOf,
    frozen: override.frozen ?? base.frozen,
    validators: [...base.validators, ...(override.validators ?? [])],
    jsonSchemaExtra: override.jsonSchemaExtra ?? base.jsonSchemaExtra,
  };
}
