/**
 * JSON Parser Tests
 *
 * Tests for the JSON/YAML/JSONC parser implementation.
 *
 * @requirements 3.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSONParser } from './json-parser.js';
import type { JSONParseResult } from './json-parser.js';

describe('JSONParser', () => {
  let parser: JSONParser;

  beforeEach(() => {
    parser = new JSONParser();
  });

  describe('basic properties', () => {
    it('should have correct language', () => {
      expect(parser.language).toBe('json');
    });

    it('should have correct extensions', () => {
      expect(parser.extensions).toContain('.json');
      expect(parser.extensions).toContain('.jsonc');
      expect(parser.extensions).toContain('.yaml');
      expect(parser.extensions).toContain('.yml');
    });

    it('should handle JSON file extensions', () => {
      expect(parser.canHandle('.json')).toBe(true);
      expect(parser.canHandle('.jsonc')).toBe(true);
      expect(parser.canHandle('.yaml')).toBe(true);
      expect(parser.canHandle('.yml')).toBe(true);
      expect(parser.canHandle('.ts')).toBe(false);
      expect(parser.canHandle('.js')).toBe(false);
    });
  });

  describe('parse() - basic JSON', () => {
    it('should parse empty object', () => {
      const result = parser.parse('{}');
      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
      expect(result.parsedValue).toEqual({});
      expect(result.schema.rootType).toBe('object');
    });

    it('should parse empty array', () => {
      const result = parser.parse('[]');
      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
      expect(result.parsedValue).toEqual([]);
      expect(result.schema.rootType).toBe('array');
    });

    it('should parse simple object', () => {
      const source = '{"name": "test", "value": 42}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.parsedValue).toEqual({ name: 'test', value: 42 });
      expect(result.keys).toHaveLength(2);
      expect(result.keys.map(k => k.key)).toContain('name');
      expect(result.keys.map(k => k.key)).toContain('value');
    });

    it('should parse simple array', () => {
      const source = '[1, 2, 3, 4, 5]';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.parsedValue).toEqual([1, 2, 3, 4, 5]);
      expect(result.arrays).toHaveLength(1);
      expect(result.arrays[0]?.length).toBe(5);
      expect(result.arrays[0]?.isHomogeneous).toBe(true);
    });

    it('should parse null value', () => {
      const source = 'null';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.parsedValue).toBeNull();
      expect(result.schema.rootType).toBe('null');
    });

    it('should parse boolean values', () => {
      const source = '{"active": true, "disabled": false}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.parsedValue).toEqual({ active: true, disabled: false });
      
      const activeKey = result.keys.find(k => k.key === 'active');
      expect(activeKey?.valueType).toBe('boolean');
      expect(activeKey?.value).toBe(true);
    });

    it('should parse string values', () => {
      const source = '{"message": "Hello, World!"}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      const messageKey = result.keys.find(k => k.key === 'message');
      expect(messageKey?.valueType).toBe('string');
      expect(messageKey?.value).toBe('Hello, World!');
    });

    it('should parse number values', () => {
      const source = '{"integer": 42, "float": 3.14, "negative": -10, "scientific": 1e10}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.parsedValue).toEqual({
        integer: 42,
        float: 3.14,
        negative: -10,
        scientific: 1e10,
      });
    });
  });

  describe('parse() - nested structures', () => {
    it('should parse nested objects', () => {
      const source = `{
        "user": {
          "name": "John",
          "address": {
            "city": "NYC",
            "zip": "10001"
          }
        }
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.objects).toHaveLength(3); // root, user, address
      expect(result.schema.maxDepth).toBeGreaterThanOrEqual(2);
      
      // Check key paths
      expect(result.keys.map(k => k.path)).toContain('user');
      expect(result.keys.map(k => k.path)).toContain('user.name');
      expect(result.keys.map(k => k.path)).toContain('user.address');
      expect(result.keys.map(k => k.path)).toContain('user.address.city');
    });

    it('should parse nested arrays', () => {
      const source = '{"matrix": [[1, 2], [3, 4], [5, 6]]}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.arrays.length).toBeGreaterThanOrEqual(1);
      
      const matrixKey = result.keys.find(k => k.key === 'matrix');
      expect(matrixKey?.valueType).toBe('array');
    });

    it('should parse array of objects', () => {
      const source = `{
        "users": [
          {"id": 1, "name": "Alice"},
          {"id": 2, "name": "Bob"}
        ]
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.arrays.length).toBeGreaterThanOrEqual(1);
      
      const usersArray = result.arrays.find(a => a.path === 'users');
      expect(usersArray?.length).toBe(2);
      expect(usersArray?.elementTypes).toContain('object');
    });

    it('should parse mixed nested structures', () => {
      const source = `{
        "config": {
          "features": ["auth", "logging"],
          "settings": {
            "timeout": 30,
            "retries": 3
          }
        }
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.objects.length).toBeGreaterThanOrEqual(2);
      expect(result.arrays.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('parse() - schema extraction', () => {
    it('should extract all key paths', () => {
      const source = `{
        "a": 1,
        "b": {
          "c": 2,
          "d": {
            "e": 3
          }
        }
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.schema.keyPaths).toContain('a');
      expect(result.schema.keyPaths).toContain('b');
      expect(result.schema.keyPaths).toContain('b.c');
      expect(result.schema.keyPaths).toContain('b.d');
      expect(result.schema.keyPaths).toContain('b.d.e');
    });

    it('should extract unique keys', () => {
      const source = `{
        "items": [
          {"name": "A", "value": 1},
          {"name": "B", "value": 2}
        ]
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.schema.uniqueKeys).toContain('items');
      expect(result.schema.uniqueKeys).toContain('name');
      expect(result.schema.uniqueKeys).toContain('value');
    });

    it('should calculate max depth correctly', () => {
      const source = '{"a": {"b": {"c": {"d": 1}}}}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.schema.maxDepth).toBeGreaterThanOrEqual(3);
    });

    it('should count totals correctly', () => {
      const source = `{
        "obj1": {},
        "obj2": {"nested": {}},
        "arr1": [],
        "arr2": [1, 2]
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.schema.totalKeys).toBeGreaterThanOrEqual(4);
      expect(result.schema.totalObjects).toBeGreaterThanOrEqual(3);
      expect(result.schema.totalArrays).toBeGreaterThanOrEqual(2);
    });
  });

  describe('parse() - array analysis', () => {
    it('should detect homogeneous arrays', () => {
      const source = '{"numbers": [1, 2, 3, 4, 5]}';
      const result = parser.parse(source) as JSONParseResult;

      const numbersArray = result.arrays.find(a => a.path === 'numbers');
      expect(numbersArray?.isHomogeneous).toBe(true);
      expect(numbersArray?.elementTypes.every(t => t === 'number')).toBe(true);
    });

    it('should detect heterogeneous arrays', () => {
      const source = '{"mixed": [1, "two", true, null]}';
      const result = parser.parse(source) as JSONParseResult;

      const mixedArray = result.arrays.find(a => a.path === 'mixed');
      expect(mixedArray?.isHomogeneous).toBe(false);
      expect(mixedArray?.elementTypes).toContain('number');
      expect(mixedArray?.elementTypes).toContain('string');
      expect(mixedArray?.elementTypes).toContain('boolean');
      expect(mixedArray?.elementTypes).toContain('null');
    });

    it('should track array lengths', () => {
      const source = '{"short": [1], "long": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}';
      const result = parser.parse(source) as JSONParseResult;

      const shortArray = result.arrays.find(a => a.path === 'short');
      const longArray = result.arrays.find(a => a.path === 'long');
      
      expect(shortArray?.length).toBe(1);
      expect(longArray?.length).toBe(10);
    });
  });

  describe('parse() - JSONC (JSON with comments)', () => {
    it('should strip single-line comments', () => {
      const source = `{
        // This is a comment
        "name": "test" // inline comment
      }`;
      const result = parser.parse(source, 'config.jsonc') as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.parsedValue).toEqual({ name: 'test' });
    });

    it('should strip multi-line comments', () => {
      const source = `{
        /* This is a
           multi-line comment */
        "value": 42
      }`;
      const result = parser.parse(source, 'config.jsonc') as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.parsedValue).toEqual({ value: 42 });
    });

    it('should handle comments in various positions', () => {
      const source = `{
        // Comment before key
        "a": 1, // Comment after value
        /* Block comment */ "b": 2,
        "c": /* inline */ 3
      }`;
      const result = parser.parse(source, 'config.jsonc') as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.parsedValue).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('should not strip comments inside strings', () => {
      const source = `{
        "url": "http://example.com/path",
        "comment": "This has // slashes"
      }`;
      const result = parser.parse(source, 'config.jsonc') as JSONParseResult;

      expect(result.success).toBe(true);
      expect((result.parsedValue as Record<string, string>).url).toBe('http://example.com/path');
      expect((result.parsedValue as Record<string, string>).comment).toBe('This has // slashes');
    });
  });

  describe('parse() - YAML', () => {
    it('should parse simple YAML', () => {
      const source = `name: test
value: 42`;
      const result = parser.parse(source, 'config.yaml') as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.parsedValue).toEqual({ name: 'test', value: 42 });
    });

    it('should parse nested YAML', () => {
      const source = `user:
  name: John
  age: 30`;
      const result = parser.parse(source, 'config.yaml') as JSONParseResult;

      expect(result.success).toBe(true);
      expect((result.parsedValue as Record<string, unknown>).user).toBeDefined();
    });

    it('should parse YAML booleans', () => {
      const source = `enabled: true
disabled: false
yes_val: yes
no_val: no`;
      const result = parser.parse(source, 'config.yaml') as JSONParseResult;

      expect(result.success).toBe(true);
      const parsed = result.parsedValue as Record<string, boolean>;
      expect(parsed.enabled).toBe(true);
      expect(parsed.disabled).toBe(false);
      expect(parsed.yes_val).toBe(true);
      expect(parsed.no_val).toBe(false);
    });

    it('should parse YAML null values', () => {
      const source = `empty: null
tilde: ~`;
      const result = parser.parse(source, 'config.yaml') as JSONParseResult;

      expect(result.success).toBe(true);
      const parsed = result.parsedValue as Record<string, null>;
      expect(parsed.empty).toBeNull();
      expect(parsed.tilde).toBeNull();
    });

    it('should skip YAML comments', () => {
      const source = `# This is a comment
name: test # inline comment
# Another comment
value: 42`;
      const result = parser.parse(source, 'config.yaml') as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.parsedValue).toEqual({ name: 'test', value: 42 });
    });

    it('should parse YAML inline arrays', () => {
      const source = `tags: [a, b, c]`;
      const result = parser.parse(source, 'config.yaml') as JSONParseResult;

      expect(result.success).toBe(true);
      expect((result.parsedValue as Record<string, string[]>).tags).toEqual(['a', 'b', 'c']);
    });
  });

  describe('query()', () => {
    it('should find nodes by type - Object', () => {
      const source = '{"a": {"b": 1}, "c": {"d": 2}}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      if (result.ast) {
        const objects = parser.query(result.ast, 'Object');
        expect(objects.length).toBeGreaterThan(0);
      }
    });

    it('should find nodes by type - Array', () => {
      const source = '{"items": [1, 2, 3], "more": [4, 5]}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      if (result.ast) {
        const arrays = parser.query(result.ast, 'Array');
        expect(arrays.length).toBe(2);
      }
    });

    it('should find nodes by type - Property', () => {
      const source = '{"name": "test", "value": 42}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      if (result.ast) {
        const properties = parser.query(result.ast, 'Property');
        expect(properties.length).toBe(2);
      }
    });

    it('should find nodes by type - String', () => {
      const source = '{"a": "hello", "b": "world"}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      if (result.ast) {
        const strings = parser.query(result.ast, 'String');
        expect(strings.length).toBe(2);
      }
    });

    it('should find nodes by type - Number', () => {
      const source = '{"a": 1, "b": 2, "c": 3}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      if (result.ast) {
        const numbers = parser.query(result.ast, 'Number');
        expect(numbers.length).toBe(3);
      }
    });

    it('should find nodes by type - Boolean', () => {
      const source = '{"active": true, "disabled": false}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      if (result.ast) {
        const booleans = parser.query(result.ast, 'Boolean');
        expect(booleans.length).toBe(2);
      }
    });

    it('should find nodes by type - Null', () => {
      const source = '{"empty": null, "missing": null}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      if (result.ast) {
        const nulls = parser.query(result.ast, 'Null');
        expect(nulls.length).toBe(2);
      }
    });

    it('should find nodes by type - Key', () => {
      const source = '{"name": "test", "value": 42}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      if (result.ast) {
        const keys = parser.query(result.ast, 'Key');
        expect(keys.length).toBe(2);
      }
    });
  });

  describe('error handling', () => {
    it('should handle invalid JSON gracefully', () => {
      const source = '{"invalid": }';
      const result = parser.parse(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.parsedValue).toBeNull();
    });

    it('should handle unclosed braces', () => {
      const source = '{"unclosed": true';
      const result = parser.parse(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle unclosed brackets', () => {
      const source = '[1, 2, 3';
      const result = parser.parse(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle trailing commas', () => {
      const source = '{"a": 1, "b": 2,}';
      const result = parser.parse(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle single quotes (invalid JSON)', () => {
      const source = "{'name': 'test'}";
      const result = parser.parse(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle unquoted keys (invalid JSON)', () => {
      const source = '{name: "test"}';
      const result = parser.parse(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return empty schema on error', () => {
      const source = 'invalid json';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(false);
      expect(result.schema.rootType).toBe('null');
      expect(result.schema.keyPaths).toEqual([]);
      expect(result.schema.totalKeys).toBe(0);
    });
  });

  describe('complex scenarios', () => {
    it('should parse package.json structure', () => {
      const source = `{
        "name": "@drift/core",
        "version": "1.0.0",
        "description": "Core package",
        "main": "dist/index.js",
        "scripts": {
          "build": "tsc",
          "test": "vitest"
        },
        "dependencies": {
          "typescript": "^5.0.0"
        },
        "devDependencies": {
          "vitest": "^1.0.0"
        }
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.schema.uniqueKeys).toContain('name');
      expect(result.schema.uniqueKeys).toContain('scripts');
      expect(result.schema.uniqueKeys).toContain('dependencies');
      expect(result.keys.map(k => k.path)).toContain('scripts.build');
    });

    it('should parse tsconfig.json structure', () => {
      const source = `{
        "compilerOptions": {
          "target": "ES2020",
          "module": "ESNext",
          "strict": true,
          "outDir": "./dist",
          "rootDir": "./src"
        },
        "include": ["src/**/*"],
        "exclude": ["node_modules", "dist"]
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.keys.map(k => k.path)).toContain('compilerOptions');
      expect(result.keys.map(k => k.path)).toContain('compilerOptions.target');
      expect(result.arrays.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse deeply nested configuration', () => {
      const source = `{
        "level1": {
          "level2": {
            "level3": {
              "level4": {
                "level5": {
                  "value": "deep"
                }
              }
            }
          }
        }
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.schema.maxDepth).toBeGreaterThanOrEqual(5);
      expect(result.keys.map(k => k.path)).toContain('level1.level2.level3.level4.level5.value');
    });

    it('should parse large arrays', () => {
      const items = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }));
      const source = JSON.stringify({ items });
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      const itemsArray = result.arrays.find(a => a.path === 'items');
      expect(itemsArray?.length).toBe(100);
    });

    it('should handle special characters in keys', () => {
      const source = `{
        "key-with-dash": 1,
        "key_with_underscore": 2,
        "key.with.dots": 3,
        "key with spaces": 4
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      expect(result.keys.map(k => k.key)).toContain('key-with-dash');
      expect(result.keys.map(k => k.key)).toContain('key_with_underscore');
      expect(result.keys.map(k => k.key)).toContain('key.with.dots');
      expect(result.keys.map(k => k.key)).toContain('key with spaces');
    });

    it('should handle unicode in values', () => {
      const source = `{
        "greeting": "Hello, 世界!",
        "emoji": "🚀",
        "special": "café"
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      const parsed = result.parsedValue as Record<string, string>;
      expect(parsed.greeting).toBe('Hello, 世界!');
      expect(parsed.emoji).toBe('🚀');
      expect(parsed.special).toBe('café');
    });

    it('should handle escaped characters in strings', () => {
      const source = `{
        "path": "C:\\\\Users\\\\test",
        "quote": "He said \\"hello\\"",
        "newline": "line1\\nline2",
        "tab": "col1\\tcol2"
      }`;
      const result = parser.parse(source) as JSONParseResult;

      expect(result.success).toBe(true);
      const parsed = result.parsedValue as Record<string, string>;
      expect(parsed.path).toBe('C:\\Users\\test');
      expect(parsed.quote).toBe('He said "hello"');
      expect(parsed.newline).toBe('line1\nline2');
      expect(parsed.tab).toBe('col1\tcol2');
    });
  });

  describe('AST structure', () => {
    it('should create correct AST for simple object', () => {
      const source = '{"name": "test"}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      expect(result.ast?.rootNode.type).toBe('Object');
      expect(result.ast?.rootNode.children.length).toBe(1);
      expect(result.ast?.rootNode.children[0]?.type).toBe('Property');
    });

    it('should create correct AST for array', () => {
      const source = '[1, 2, 3]';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      expect(result.ast?.rootNode.type).toBe('Array');
      expect(result.ast?.rootNode.children.length).toBe(3);
      expect(result.ast?.rootNode.children.every(c => c.type === 'Number')).toBe(true);
    });

    it('should create Property nodes with Key and Value children', () => {
      const source = '{"key": "value"}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      const property = result.ast?.rootNode.children[0];
      expect(property?.type).toBe('Property');
      expect(property?.children.length).toBe(2);
      expect(property?.children[0]?.type).toBe('Key');
      expect(property?.children[1]?.type).toBe('String');
    });

    it('should preserve source text in AST', () => {
      const source = '{"name": "test"}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.ast).not.toBeNull();
      expect(result.ast?.text).toBe(source);
    });
  });

  describe('position tracking', () => {
    it('should track key positions', () => {
      const source = `{
  "name": "test",
  "value": 42
}`;
      const result = parser.parse(source) as JSONParseResult;

      const nameKey = result.keys.find(k => k.key === 'name');
      expect(nameKey?.startPosition.row).toBe(1);
      
      const valueKey = result.keys.find(k => k.key === 'value');
      expect(valueKey?.startPosition.row).toBe(2);
    });

    it('should track object positions', () => {
      const source = '{"nested": {"inner": 1}}';
      const result = parser.parse(source) as JSONParseResult;

      expect(result.objects.length).toBeGreaterThanOrEqual(1);
      const rootObj = result.objects.find(o => o.path === '$');
      expect(rootObj?.startPosition).toEqual({ row: 0, column: 0 });
    });

    it('should track array positions', () => {
      const source = '{"items": [1, 2, 3]}';
      const result = parser.parse(source) as JSONParseResult;

      const itemsArray = result.arrays.find(a => a.path === 'items');
      expect(itemsArray?.startPosition).toBeDefined();
    });
  });
});
