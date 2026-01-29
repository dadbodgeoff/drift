/**
 * JSON Parser - JSON/YAML/JSONC parsing for AST extraction
 *
 * Extracts schema information, keys, types, nested structures,
 * arrays, and objects from JSON-like files using native parsing.
 *
 * @requirements 3.2
 */

import { BaseParser } from './base-parser.js';

import type { AST, ASTNode, Language, ParseResult, Position } from './types.js';

/**
 * JSON value types
 */
export type JSONValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

/**
 * Information about a JSON key-value pair
 */
export interface JSONKeyInfo {
  /** The key name */
  key: string;
  /** Full path to this key (e.g., "root.nested.key") */
  path: string;
  /** Type of the value */
  valueType: JSONValueType;
  /** The actual value (for primitives) */
  value: unknown;
  /** Depth in the structure (0 = root level) */
  depth: number;
  /** Parent key path */
  parentPath: string | null;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a JSON object
 */
export interface JSONObjectInfo {
  /** Full path to this object */
  path: string;
  /** Keys in this object */
  keys: string[];
  /** Depth in the structure */
  depth: number;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a JSON array
 */
export interface JSONArrayInfo {
  /** Full path to this array */
  path: string;
  /** Number of elements */
  length: number;
  /** Types of elements in the array */
  elementTypes: JSONValueType[];
  /** Whether all elements are the same type */
  isHomogeneous: boolean;
  /** Depth in the structure */
  depth: number;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Schema information extracted from JSON
 */
export interface JSONSchemaInfo {
  /** Root type of the JSON */
  rootType: JSONValueType;
  /** All key paths found */
  keyPaths: string[];
  /** All unique keys */
  uniqueKeys: string[];
  /** Maximum nesting depth */
  maxDepth: number;
  /** Total number of keys */
  totalKeys: number;
  /** Total number of arrays */
  totalArrays: number;
  /** Total number of objects */
  totalObjects: number;
}

/**
 * Extended parse result with JSON-specific information
 */
export interface JSONParseResult extends ParseResult {
  /** Extracted keys */
  keys: JSONKeyInfo[];
  /** Extracted objects */
  objects: JSONObjectInfo[];
  /** Extracted arrays */
  arrays: JSONArrayInfo[];
  /** Schema information */
  schema: JSONSchemaInfo;
  /** The parsed JSON value */
  parsedValue: unknown;
}

/**
 * JSON/YAML/JSONC parser using native parsing.
 *
 * Provides AST parsing and extraction of schema information,
 * keys, types, and nested structures from JSON-like source files.
 *
 * @requirements 3.2 - Support JSON/YAML parsing
 * @requirements 3.3 - Graceful degradation on parse errors
 */
export class JSONParser extends BaseParser {
  readonly language: Language = 'json';
  readonly extensions: string[] = ['.json', '.jsonc', '.yaml', '.yml'];

  /**
   * Parse JSON/YAML source code into an AST.
   *
   * @param source - The source code to parse
   * @param filePath - Optional file path for error reporting
   * @returns JSONParseResult containing the AST and extracted information
   *
   * @requirements 3.2, 3.3
   */
  parse(source: string, filePath?: string): JSONParseResult {
    try {
      const lines = source.split('\n');
      const isYaml = filePath ? this.isYamlFile(filePath) : false;
      const isJsonc = filePath ? this.isJsoncFile(filePath) : false;

      // Preprocess source if needed
      let processedSource = source;
      if (isJsonc) {
        processedSource = this.stripJsonComments(source);
      } else if (isYaml) {
        processedSource = this.convertYamlToJson(source);
      }

      // Parse the JSON
      let parsedValue: unknown;
      try {
        parsedValue = JSON.parse(processedSource);
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : 'Invalid JSON';
        const errorPosition = this.extractErrorPosition(errorMessage, lines);
        return {
          ...this.createFailureResult([this.createError(errorMessage, errorPosition)]),
          keys: [],
          objects: [],
          arrays: [],
          schema: this.createEmptySchema(),
          parsedValue: null,
        };
      }

      // Extract semantic information
      const keys: JSONKeyInfo[] = [];
      const objects: JSONObjectInfo[] = [];
      const arrays: JSONArrayInfo[] = [];

      this.extractStructure(parsedValue, '', 0, keys, objects, arrays, source, lines);

      // Build schema information
      const schema = this.buildSchema(parsedValue, keys, objects, arrays);

      // Build AST
      const rootNode = this.buildASTNode(parsedValue, source, lines, 0, '');
      const ast = this.createAST(rootNode, source);

      return {
        ...this.createSuccessResult(ast),
        keys,
        objects,
        arrays,
        schema,
        parsedValue,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';
      return {
        ...this.createFailureResult([this.createError(errorMessage, { row: 0, column: 0 })]),
        keys: [],
        objects: [],
        arrays: [],
        schema: this.createEmptySchema(),
        parsedValue: null,
      };
    }
  }

  /**
   * Query the AST for nodes matching a pattern.
   *
   * Supports querying by node type (e.g., 'Object', 'Array', 'Property', 'String', 'Number').
   * Also supports querying by key path pattern (e.g., '$.config.*', '$.items[*]').
   *
   * @param ast - The AST to query
   * @param pattern - The node type or key path pattern to search for
   * @returns Array of matching AST nodes
   *
   * @requirements 3.5
   */
  query(ast: AST, pattern: string): ASTNode[] {
    // If pattern starts with $, treat it as a JSONPath-like query
    if (pattern.startsWith('$')) {
      return this.queryByPath(ast, pattern);
    }
    // Otherwise, query by node type
    return this.findNodesByType(ast, pattern);
  }

  // ============================================
  // File Type Detection
  // ============================================

  /**
   * Check if a file is a YAML file based on extension.
   */
  private isYamlFile(filePath: string): boolean {
    const ext = filePath.toLowerCase().split('.').pop();
    return ext === 'yaml' || ext === 'yml';
  }

  /**
   * Check if a file is a JSONC file based on extension.
   */
  private isJsoncFile(filePath: string): boolean {
    const ext = filePath.toLowerCase().split('.').pop();
    return ext === 'jsonc';
  }

  // ============================================
  // Source Preprocessing
  // ============================================

  /**
   * Strip comments from JSONC source.
   * Handles both single-line (//) and multi-line (/* *\/) comments.
   */
  private stripJsonComments(source: string): string {
    let result = '';
    let i = 0;
    let inString = false;
    let stringChar = '';

    while (i < source.length) {
      const char = source[i];
      const nextChar = source[i + 1];

      // Handle string boundaries
      if ((char === '"' || char === "'") && (i === 0 || source[i - 1] !== '\\')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
        result += char;
        i++;
        continue;
      }

      // Skip comments only when not in a string
      if (!inString) {
        // Single-line comment
        if (char === '/' && nextChar === '/') {
          // Skip until end of line
          while (i < source.length && source[i] !== '\n') {
            i++;
          }
          continue;
        }

        // Multi-line comment
        if (char === '/' && nextChar === '*') {
          i += 2;
          while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) {
            // Preserve newlines for position tracking
            if (source[i] === '\n') {
              result += '\n';
            }
            i++;
          }
          i += 2; // Skip closing */
          continue;
        }
      }

      result += char;
      i++;
    }

    return result;
  }

  /**
   * Convert simple YAML to JSON.
   * This is a basic implementation that handles common YAML patterns.
   */
  private convertYamlToJson(source: string): string {
    const lines = source.split('\n');
    const stack: Array<{ indent: number; value: Record<string, unknown> | unknown[] }> = [];
    const currentObject: Record<string, unknown> = {};
    let rootValue: unknown = currentObject;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Calculate indentation
      const indent = line.length - line.trimStart().length;

      // Handle list items
      if (trimmed.startsWith('- ')) {
        const value = this.stripYamlInlineComment(trimmed.slice(2).trim());
        
        // Find or create the array at this level
        while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) {
          stack.pop();
        }

        if (stack.length === 0) {
          // Root is an array
          if (!Array.isArray(rootValue)) {
            rootValue = [];
          }
          (rootValue as unknown[]).push(this.parseYamlValue(value));
        } else {
          const parent = stack[stack.length - 1];
          if (parent && Array.isArray(parent.value)) {
            parent.value.push(this.parseYamlValue(value));
          }
        }
        continue;
      }

      // Handle key-value pairs
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim();
        let valueStr = trimmed.slice(colonIndex + 1).trim();
        
        // Strip inline comments from value
        valueStr = this.stripYamlInlineComment(valueStr);

        // Pop stack to find correct parent
        while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) {
          stack.pop();
        }

        const parent = stack.length > 0 ? stack[stack.length - 1]?.value : currentObject;

        if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
          if (valueStr === '' || valueStr === '|' || valueStr === '>') {
            // Nested object or multi-line string
            const newObj: Record<string, unknown> = {};
            (parent)[key] = newObj;
            stack.push({ indent, value: newObj });
          } else if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
            // Inline array
            (parent)[key] = this.parseYamlInlineArray(valueStr);
          } else {
            // Simple value
            (parent)[key] = this.parseYamlValue(valueStr);
          }
        }
      }
    }

    return JSON.stringify(rootValue);
  }

  /**
   * Strip inline comments from a YAML value.
   * Handles comments that appear after values (e.g., "value # comment").
   */
  private stripYamlInlineComment(value: string): string {
    // If the value is quoted, don't strip anything
    if ((value.startsWith('"') && value.includes('"', 1)) ||
        (value.startsWith("'") && value.includes("'", 1))) {
      // Find the closing quote and check for comment after
      const quoteChar = value[0];
      let i = 1;
      while (i < value.length) {
        if (value[i] === '\\' && i + 1 < value.length) {
          i += 2; // Skip escaped character
          continue;
        }
        if (value[i] === quoteChar) {
          // Found closing quote, return the quoted string
          return value.slice(0, i + 1);
        }
        i++;
      }
      return value;
    }

    // For unquoted values, find the comment marker
    const commentIndex = value.indexOf(' #');
    if (commentIndex > 0) {
      return value.slice(0, commentIndex).trim();
    }

    // Also check for comment at the start (after whitespace)
    if (value.includes('#')) {
      const hashIndex = value.indexOf('#');
      // Only strip if there's whitespace before the #
      if (hashIndex > 0 && /\s/.test(value[hashIndex - 1] ?? '')) {
        return value.slice(0, hashIndex).trim();
      }
    }

    return value;
  }

  /**
   * Parse a YAML value to its JavaScript equivalent.
   */
  private parseYamlValue(value: string): unknown {
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }

    // Boolean
    if (value === 'true' || value === 'yes' || value === 'on') {return true;}
    if (value === 'false' || value === 'no' || value === 'off') {return false;}

    // Null
    if (value === 'null' || value === '~' || value === '') {return null;}

    // Number
    const num = Number(value);
    if (!isNaN(num) && value !== '') {return num;}

    // String
    return value;
  }

  /**
   * Parse a YAML inline array like [1, 2, 3].
   */
  private parseYamlInlineArray(value: string): unknown[] {
    const inner = value.slice(1, -1).trim();
    if (!inner) {return [];}

    return inner.split(',').map(item => this.parseYamlValue(item.trim()));
  }

  // ============================================
  // Structure Extraction
  // ============================================

  /**
   * Extract structure information from parsed JSON.
   */
  private extractStructure(
    value: unknown,
    path: string,
    depth: number,
    keys: JSONKeyInfo[],
    objects: JSONObjectInfo[],
    arrays: JSONArrayInfo[],
    source: string,
    lines: string[]
  ): void {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      const position = this.findPositionForPath(path, source, lines);
      const elementTypes = value.map(item => this.getValueType(item));
      const uniqueTypes = [...new Set(elementTypes)];

      arrays.push({
        path: path || '$',
        length: value.length,
        elementTypes,
        isHomogeneous: uniqueTypes.length <= 1,
        depth,
        startPosition: position.start,
        endPosition: position.end,
      });

      // Process array elements
      value.forEach((item, index) => {
        const itemPath = path ? `${path}[${index}]` : `$[${index}]`;
        this.extractStructure(item, itemPath, depth + 1, keys, objects, arrays, source, lines);
      });
    } else if (typeof value === 'object') {
      const objKeys = Object.keys(value as Record<string, unknown>);
      const position = this.findPositionForPath(path, source, lines);

      objects.push({
        path: path || '$',
        keys: objKeys,
        depth,
        startPosition: position.start,
        endPosition: position.end,
      });

      // Process object properties
      for (const key of objKeys) {
        const propValue = (value as Record<string, unknown>)[key];
        const propPath = path ? `${path}.${key}` : key;
        const propPosition = this.findPositionForKey(key, source, lines);

        keys.push({
          key,
          path: propPath,
          valueType: this.getValueType(propValue),
          value: this.isPrimitive(propValue) ? propValue : undefined,
          depth,
          parentPath: path || null,
          startPosition: propPosition.start,
          endPosition: propPosition.end,
        });

        this.extractStructure(propValue, propPath, depth + 1, keys, objects, arrays, source, lines);
      }
    }
  }

  /**
   * Get the JSON value type.
   */
  private getValueType(value: unknown): JSONValueType {
    if (value === null) {return 'null';}
    if (Array.isArray(value)) {return 'array';}
    if (typeof value === 'object') {return 'object';}
    if (typeof value === 'string') {return 'string';}
    if (typeof value === 'number') {return 'number';}
    if (typeof value === 'boolean') {return 'boolean';}
    return 'null';
  }

  /**
   * Check if a value is a primitive type.
   */
  private isPrimitive(value: unknown): boolean {
    return value === null || 
           typeof value === 'string' || 
           typeof value === 'number' || 
           typeof value === 'boolean';
  }

  // ============================================
  // Schema Building
  // ============================================

  /**
   * Build schema information from extracted data.
   */
  private buildSchema(
    parsedValue: unknown,
    keys: JSONKeyInfo[],
    objects: JSONObjectInfo[],
    arrays: JSONArrayInfo[]
  ): JSONSchemaInfo {
    const keyPaths = keys.map(k => k.path);
    const uniqueKeys = [...new Set(keys.map(k => k.key))];
    const maxDepth = Math.max(
      0,
      ...keys.map(k => k.depth),
      ...objects.map(o => o.depth),
      ...arrays.map(a => a.depth)
    );

    return {
      rootType: this.getValueType(parsedValue),
      keyPaths,
      uniqueKeys,
      maxDepth,
      totalKeys: keys.length,
      totalArrays: arrays.length,
      totalObjects: objects.length,
    };
  }

  /**
   * Create an empty schema for error cases.
   */
  private createEmptySchema(): JSONSchemaInfo {
    return {
      rootType: 'null',
      keyPaths: [],
      uniqueKeys: [],
      maxDepth: 0,
      totalKeys: 0,
      totalArrays: 0,
      totalObjects: 0,
    };
  }

  // ============================================
  // AST Building
  // ============================================

  /**
   * Build an AST node from a JSON value.
   */
  private buildASTNode(
    value: unknown,
    source: string,
    lines: string[],
    depth: number,
    path: string
  ): ASTNode {
    const position = this.findPositionForPath(path, source, lines);

    if (value === null) {
      return this.createNode('Null', 'null', position.start, position.end, []);
    }

    if (typeof value === 'boolean') {
      return this.createNode('Boolean', String(value), position.start, position.end, []);
    }

    if (typeof value === 'number') {
      return this.createNode('Number', String(value), position.start, position.end, []);
    }

    if (typeof value === 'string') {
      return this.createNode('String', `"${value}"`, position.start, position.end, []);
    }

    if (Array.isArray(value)) {
      const children = value.map((item, index) => {
        const itemPath = path ? `${path}[${index}]` : `$[${index}]`;
        return this.buildASTNode(item, source, lines, depth + 1, itemPath);
      });
      return this.createNode('Array', JSON.stringify(value), position.start, position.end, children);
    }

    if (typeof value === 'object') {
      const children: ASTNode[] = [];
      for (const [key, propValue] of Object.entries(value as Record<string, unknown>)) {
        const propPath = path ? `${path}.${key}` : key;
        const keyPosition = this.findPositionForKey(key, source, lines);
        
        // Create property node with key and value as children
        const keyNode = this.createNode('Key', `"${key}"`, keyPosition.start, keyPosition.end, []);
        const valueNode = this.buildASTNode(propValue, source, lines, depth + 1, propPath);
        
        const propertyNode = this.createNode(
          'Property',
          `"${key}": ${JSON.stringify(propValue)}`,
          keyPosition.start,
          valueNode.endPosition,
          [keyNode, valueNode]
        );
        children.push(propertyNode);
      }
      return this.createNode('Object', JSON.stringify(value), position.start, position.end, children);
    }

    return this.createNode('Unknown', String(value), position.start, position.end, []);
  }

  // ============================================
  // Position Finding
  // ============================================

  /**
   * Find the position of a path in the source.
   */
  private findPositionForPath(
    path: string,
    source: string,
    lines: string[]
  ): { start: Position; end: Position } {
    // For root, return document bounds
    if (!path || path === '$') {
      return {
        start: { row: 0, column: 0 },
        end: { row: lines.length - 1, column: lines[lines.length - 1]?.length ?? 0 },
      };
    }

    // Try to find the key in the source
    const lastKey = path.split('.').pop()?.replace(/\[\d+\]$/, '') ?? '';
    return this.findPositionForKey(lastKey, source, lines);
  }

  /**
   * Find the position of a key in the source.
   */
  private findPositionForKey(
    key: string,
    _source: string,
    lines: string[]
  ): { start: Position; end: Position } {
    // Search for the key in the source
    const keyPattern = new RegExp(`"${this.escapeRegex(key)}"\\s*:`);
    
    for (let row = 0; row < lines.length; row++) {
      const line = lines[row] ?? '';
      const match = keyPattern.exec(line);
      if (match) {
        return {
          start: { row, column: match.index },
          end: { row, column: match.index + match[0].length },
        };
      }
    }

    // Fallback to start of document
    return {
      start: { row: 0, column: 0 },
      end: { row: 0, column: 0 },
    };
  }

  /**
   * Escape special regex characters.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Extract error position from JSON parse error message.
   */
  private extractErrorPosition(errorMessage: string, lines: string[]): Position {
    // Try to extract position from error message
    // Common format: "... at position 123" or "... at line 5 column 10"
    const positionMatch = errorMessage.match(/position\s+(\d+)/i);
    if (positionMatch) {
      const offset = parseInt(positionMatch[1] ?? '0', 10);
      return this.offsetToPosition(offset, lines);
    }

    const lineColMatch = errorMessage.match(/line\s+(\d+).*column\s+(\d+)/i);
    if (lineColMatch) {
      return {
        row: parseInt(lineColMatch[1] ?? '1', 10) - 1,
        column: parseInt(lineColMatch[2] ?? '1', 10) - 1,
      };
    }

    return { row: 0, column: 0 };
  }

  /**
   * Convert a character offset to a position.
   */
  private offsetToPosition(offset: number, lines: string[]): Position {
    let currentOffset = 0;
    for (let row = 0; row < lines.length; row++) {
      const lineLength = (lines[row]?.length ?? 0) + 1; // +1 for newline
      if (currentOffset + lineLength > offset) {
        return { row, column: offset - currentOffset };
      }
      currentOffset += lineLength;
    }
    return { row: lines.length - 1, column: lines[lines.length - 1]?.length ?? 0 };
  }

  // ============================================
  // JSONPath-like Query
  // ============================================

  /**
   * Query the AST using a JSONPath-like pattern.
   */
  private queryByPath(ast: AST, pattern: string): ASTNode[] {
    const results: ASTNode[] = [];
    
    // Normalize pattern
    const normalizedPattern = pattern
      .replace(/^\$\.?/, '') // Remove leading $. or $
      .replace(/\[\*\]/g, '.*') // Convert [*] to .*
      .replace(/\./g, '\\.') // Escape dots
      .replace(/\*/g, '[^.\\[\\]]+'); // Convert * to match any key

    const regex = new RegExp(`^${normalizedPattern}$`);

    // Traverse AST and collect matching nodes
    this.traverse(ast, ({ node }) => {
      // Check if node has a path that matches
      if (node.type === 'Property') {
        const keyNode = node.children.find(c => c.type === 'Key');
        if (keyNode) {
          const key = keyNode.text.replace(/^"|"$/g, '');
          if (regex.test(key)) {
            results.push(node);
          }
        }
      }
    });

    return results;
  }
}
