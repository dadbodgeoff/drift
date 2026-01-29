/**
 * Pydantic Config Extractor
 *
 * Extracts model configuration from Pydantic classes.
 * Handles both v1 (Config class) and v2 (model_config dict).
 *
 * @module pydantic/config-extractor
 */

import type { TreeSitterNode , PydanticConfigInfo } from '../types.js';
import type { ExtractionContext, RawConfigData, ConfigValue } from './types.js';

// ============================================
// Config Extractor Class
// ============================================

/**
 * Extracts Pydantic model configuration.
 *
 * Handles:
 * - v1: class Config: ...
 * - v2: model_config = ConfigDict(...)
 * - v2: model_config = {...}
 */
export class ConfigExtractor {
  /**
   * Extract config from a class body.
   *
   * @param bodyNode - The class body (block) node
   * @param context - Extraction context
   * @returns Config info or null if no config found
   */
  extractConfig(
    bodyNode: TreeSitterNode,
    context: ExtractionContext
  ): PydanticConfigInfo | null {
    // Try v2 style first (model_config)
    const v2Config = this.extractV2Config(bodyNode, context);
    if (v2Config) {
      return v2Config;
    }

    // Try v1 style (Config class)
    const v1Config = this.extractV1Config(bodyNode, context);
    if (v1Config) {
      return v1Config;
    }

    return null;
  }

  // ============================================
  // V2 Config Extraction
  // ============================================

  /**
   * Extract v2 style model_config.
   */
  private extractV2Config(
    bodyNode: TreeSitterNode,
    _context: ExtractionContext
  ): PydanticConfigInfo | null {
    for (const child of bodyNode.namedChildren) {
      if (child.type !== 'expression_statement') {continue;}

      const inner = child.namedChildren[0];
      if (inner?.type !== 'assignment') {continue;}

      const left = inner.childForFieldName('left');
      if (left?.text !== 'model_config') {continue;}

      const right = inner.childForFieldName('right');
      if (!right) {continue;}

      const rawData = this.parseV2ConfigValue(right, inner);
      return this.processRawConfig(rawData);
    }

    return null;
  }

  /**
   * Parse v2 config value (dict or ConfigDict call).
   */
  private parseV2ConfigValue(
    valueNode: TreeSitterNode,
    assignmentNode: TreeSitterNode
  ): RawConfigData {
    const values = new Map<string, ConfigValue>();

    if (valueNode.type === 'dictionary') {
      // model_config = {...}
      this.parseDictConfig(valueNode, values);
    } else if (valueNode.type === 'call') {
      // model_config = ConfigDict(...)
      this.parseConfigDictCall(valueNode, values);
    }

    return {
      version: 2,
      values,
      node: assignmentNode,
    };
  }

  /**
   * Parse a dictionary literal config.
   */
  private parseDictConfig(
    dictNode: TreeSitterNode,
    values: Map<string, ConfigValue>
  ): void {
    for (const child of dictNode.namedChildren) {
      if (child.type === 'pair') {
        const keyNode = child.childForFieldName('key');
        const valueNode = child.childForFieldName('value');

        if (keyNode && valueNode) {
          const key = this.unquote(keyNode.text);
          values.set(key, this.parseConfigValue(valueNode.text));
        }
      }
    }
  }

  /**
   * Parse a ConfigDict() call.
   */
  private parseConfigDictCall(
    callNode: TreeSitterNode,
    values: Map<string, ConfigValue>
  ): void {
    const argsNode = callNode.childForFieldName('arguments');
    if (!argsNode) {return;}

    for (const child of argsNode.namedChildren) {
      if (child.type === 'keyword_argument') {
        const nameNode = child.childForFieldName('name');
        const valueNode = child.childForFieldName('value');

        if (nameNode && valueNode) {
          values.set(nameNode.text, this.parseConfigValue(valueNode.text));
        }
      }
    }
  }

  // ============================================
  // V1 Config Extraction
  // ============================================

  /**
   * Extract v1 style Config class.
   */
  private extractV1Config(
    bodyNode: TreeSitterNode,
    _context: ExtractionContext
  ): PydanticConfigInfo | null {
    for (const child of bodyNode.namedChildren) {
      if (child.type !== 'class_definition') {continue;}

      const nameNode = child.childForFieldName('name');
      if (nameNode?.text !== 'Config') {continue;}

      const configBody = child.childForFieldName('body');
      if (!configBody) {continue;}

      const rawData = this.parseV1ConfigClass(configBody, child);
      return this.processRawConfig(rawData);
    }

    return null;
  }

  /**
   * Parse v1 Config class body.
   */
  private parseV1ConfigClass(
    bodyNode: TreeSitterNode,
    classNode: TreeSitterNode
  ): RawConfigData {
    const values = new Map<string, ConfigValue>();

    for (const child of bodyNode.namedChildren) {
      if (child.type !== 'expression_statement') {continue;}

      const inner = child.namedChildren[0];
      if (inner?.type !== 'assignment') {continue;}

      const left = inner.childForFieldName('left');
      const right = inner.childForFieldName('right');

      if (left && right && left.type === 'identifier') {
        values.set(left.text, this.parseConfigValue(right.text));
      }
    }

    return {
      version: 1,
      values,
      node: classNode,
    };
  }

  // ============================================
  // Value Parsing
  // ============================================

  /**
   * Parse a config value string.
   */
  private parseConfigValue(valueStr: string): ConfigValue {
    const trimmed = valueStr.trim();

    // Boolean
    if (trimmed === 'True') {
      return { raw: trimmed, parsed: true, isComplex: false };
    }
    if (trimmed === 'False') {
      return { raw: trimmed, parsed: false, isComplex: false };
    }
    if (trimmed === 'None') {
      return { raw: trimmed, parsed: null, isComplex: false };
    }

    // Number
    const num = parseFloat(trimmed);
    if (!isNaN(num) && /^-?\d+\.?\d*$/.test(trimmed)) {
      return { raw: trimmed, parsed: num, isComplex: false };
    }

    // String
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return { raw: trimmed, parsed: trimmed.slice(1, -1), isComplex: false };
    }

    // Complex expression
    return { raw: trimmed, parsed: null, isComplex: true };
  }

  /**
   * Remove quotes from a string.
   */
  private unquote(value: string): string {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  // ============================================
  // Processing
  // ============================================

  /**
   * Process raw config data into PydanticConfigInfo.
   */
  private processRawConfig(raw: RawConfigData): PydanticConfigInfo {
    const rawValues: Record<string, unknown> = {};
    for (const [key, value] of raw.values) {
      rawValues[key] = value.isComplex ? value.raw : value.parsed;
    }

    return {
      extra: this.extractExtraConfig(raw.values),
      frozen: this.extractBooleanConfig(raw.values, ['frozen', 'allow_mutation']),
      validateAssignment: this.extractBooleanConfig(raw.values, ['validate_assignment']),
      useEnumValues: this.extractBooleanConfig(raw.values, ['use_enum_values']),
      validateDefault: this.extractBooleanConfig(raw.values, ['validate_default']),
      populateByName: this.extractBooleanConfig(raw.values, ['populate_by_name', 'allow_population_by_field_name']),
      arbitraryTypesAllowed: this.extractBooleanConfig(raw.values, ['arbitrary_types_allowed']),
      jsonSchemaExtra: this.extractJsonSchemaExtra(raw.values),
      raw: rawValues,
    };
  }

  /**
   * Extract extra config value.
   */
  private extractExtraConfig(
    values: Map<string, ConfigValue>
  ): 'allow' | 'forbid' | 'ignore' | null {
    const value = values.get('extra');
    if (!value) {return null;}

    const parsed = value.parsed;
    if (typeof parsed === 'string') {
      if (parsed === 'allow' || parsed === 'forbid' || parsed === 'ignore') {
        return parsed;
      }
    }

    // Handle v1 style: Extra.allow, Extra.forbid, Extra.ignore
    const raw = value.raw;
    if (raw.includes('allow')) {return 'allow';}
    if (raw.includes('forbid')) {return 'forbid';}
    if (raw.includes('ignore')) {return 'ignore';}

    return null;
  }

  /**
   * Extract a boolean config value.
   */
  private extractBooleanConfig(
    values: Map<string, ConfigValue>,
    keys: string[]
  ): boolean | null {
    for (const key of keys) {
      const value = values.get(key);
      if (value && typeof value.parsed === 'boolean') {
        // Handle inverted keys (allow_mutation -> frozen)
        if (key === 'allow_mutation') {
          return !value.parsed;
        }
        return value.parsed;
      }
    }
    return null;
  }

  /**
   * Extract json_schema_extra config.
   */
  private extractJsonSchemaExtra(
    values: Map<string, ConfigValue>
  ): Record<string, unknown> | null {
    const value = values.get('json_schema_extra') || values.get('schema_extra');
    if (!value) {return null;}

    // If it's a simple dict, try to parse it
    if (!value.isComplex && typeof value.parsed === 'object' && value.parsed !== null) {
      return value.parsed as Record<string, unknown>;
    }

    return null;
  }
}
