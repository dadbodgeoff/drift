/**
 * Pattern Matcher Tests
 *
 * Tests for pattern matching using AST, regex, and structural methods.
 *
 * @requirements 5.1 - Pattern matching with confidence scoring
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PatternMatcher, type MatchOptions } from './pattern-matcher.js';
import type {
  PatternDefinition,
  MatcherContext,
  MatcherConfig,
} from './types.js';
import type { AST, ASTNode } from '../parsers/types.js';

/**
 * Helper to create an AST node
 */
function createNode(
  type: string,
  text: string,
  children: ASTNode[] = [],
  startRow = 0,
  startCol = 0,
  endRow = 0,
  endCol = 0
): ASTNode {
  return {
    type,
    text,
    children,
    startPosition: { row: startRow, column: startCol },
    endPosition: { row: endRow, column: endCol },
  };
}

/**
 * Helper to create an AST
 */
function createAST(rootNode: ASTNode, text = ''): AST {
  return { rootNode, text };
}

/**
 * Helper to create a matcher context
 */
function createContext(
  file: string,
  content: string,
  ast: AST | null = null,
  language = 'typescript'
): MatcherContext {
  return {
    file,
    content,
    ast,
    language,
    projectRoot: '/project',
  };
}

/**
 * Helper to create a pattern definition
 */
function createPattern(
  id: string,
  matchType: PatternDefinition['matchType'],
  config: Partial<PatternDefinition> = {}
): PatternDefinition {
  return {
    id,
    name: config.name ?? id,
    description: config.description ?? `Pattern ${id}`,
    category: config.category ?? 'test',
    matchType,
    enabled: config.enabled ?? true,
    ...config,
  };
}

describe('PatternMatcher', () => {
  let matcher: PatternMatcher;

  beforeEach(() => {
    matcher = new PatternMatcher();
  });

  describe('constructor', () => {
    it('should create a matcher with default config', () => {
      const m = new PatternMatcher();
      expect(m).toBeInstanceOf(PatternMatcher);
    });

    it('should create a matcher with custom config', () => {
      const config: MatcherConfig = {
        minConfidence: 0.5,
        maxMatchesPerPattern: 10,
        cache: { enabled: true, maxSize: 500, ttl: 30000 },
      };
      const m = new PatternMatcher(config);
      expect(m).toBeInstanceOf(PatternMatcher);
    });
  });

  describe('AST-based matching', () => {
    it('should match nodes by type', () => {
      const func1 = createNode('FunctionDeclaration', 'function foo() {}', [], 0, 0, 0, 20);
      const func2 = createNode('FunctionDeclaration', 'function bar() {}', [], 1, 0, 1, 20);
      const root = createNode('Program', '', [func1, func2]);
      const ast = createAST(root);

      const context = createContext('test.ts', 'function foo() {}\nfunction bar() {}', ast);
      const pattern = createPattern('func-pattern', 'ast', {
        astConfig: { nodeType: 'FunctionDeclaration' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(2);
      expect(results[0]?.patternId).toBe('func-pattern');
      expect(results[0]?.matchType).toBe('ast');
      expect(results[0]?.confidence).toBe(1);
    });

    it('should match nodes with property constraints', () => {
      const node1 = createNode('Identifier', 'foo');
      const node2 = createNode('Identifier', 'bar');
      const root = createNode('Program', '', [node1, node2]);
      const ast = createAST(root);

      const context = createContext('test.ts', 'foo bar', ast);
      const pattern = createPattern('id-pattern', 'ast', {
        astConfig: {
          nodeType: 'Identifier',
          properties: { text: 'foo' },
        },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
      expect(results[0]?.location.line).toBe(1);
    });

    it('should match nodes with child patterns', () => {
      const identifier = createNode('Identifier', 'myFunc');
      const func = createNode('FunctionDeclaration', 'function myFunc() {}', [identifier]);
      const root = createNode('Program', '', [func]);
      const ast = createAST(root);

      const context = createContext('test.ts', 'function myFunc() {}', ast);
      const pattern = createPattern('func-with-name', 'ast', {
        astConfig: {
          nodeType: 'FunctionDeclaration',
          children: [{ nodeType: 'Identifier' }],
        },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });

    it('should respect depth constraints', () => {
      const deep = createNode('DeepNode', 'deep');
      const child = createNode('Child', 'child', [deep]);
      const root = createNode('Program', '', [child]);
      const ast = createAST(root);

      const context = createContext('test.ts', '', ast);
      const pattern = createPattern('shallow-only', 'ast', {
        astConfig: {
          nodeType: 'DeepNode',
          maxDepth: 1,
        },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0); // DeepNode is at depth 2
    });

    it('should return empty array when AST is null', () => {
      const context = createContext('test.ts', 'content', null);
      const pattern = createPattern('ast-pattern', 'ast', {
        astConfig: { nodeType: 'FunctionDeclaration' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0);
    });

    it('should return empty array when astConfig is missing', () => {
      const root = createNode('Program', '');
      const ast = createAST(root);
      const context = createContext('test.ts', '', ast);
      const pattern = createPattern('no-config', 'ast');

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0);
    });
  });

  describe('Regex-based matching', () => {
    it('should match simple patterns', () => {
      const content = 'const foo = 1;\nconst bar = 2;';
      const context = createContext('test.ts', content);
      const pattern = createPattern('const-pattern', 'regex', {
        regexConfig: { pattern: 'const \\w+' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(2);
      expect(results[0]?.matchType).toBe('regex');
    });

    it('should extract capture groups', () => {
      const content = 'function foo() {}\nfunction bar() {}';
      const context = createContext('test.ts', content);
      const pattern = createPattern('func-name', 'regex', {
        regexConfig: {
          pattern: 'function (\\w+)',
          captureGroups: ['name'],
        },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(2);
      expect(results[0]?.captures?.name).toBe('foo');
      expect(results[1]?.captures?.name).toBe('bar');
    });

    it('should support case-insensitive matching', () => {
      const content = 'TODO: fix this\ntodo: also this';
      const context = createContext('test.ts', content);
      const pattern = createPattern('todo-pattern', 'regex', {
        regexConfig: { pattern: 'TODO:', flags: 'gi' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(2);
    });

    it('should support multiline matching', () => {
      const content = 'line1\nline2\nline3';
      const context = createContext('test.ts', content);
      const pattern = createPattern('line-start', 'regex', {
        regexConfig: { pattern: '^line', multiline: true },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(3);
    });

    it('should return correct line numbers', () => {
      const content = 'first\nsecond\nthird';
      const context = createContext('test.ts', content);
      const pattern = createPattern('second-pattern', 'regex', {
        regexConfig: { pattern: 'second' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
      expect(results[0]?.location.line).toBe(2);
    });

    it('should return empty array when regexConfig is missing', () => {
      const context = createContext('test.ts', 'content');
      const pattern = createPattern('no-config', 'regex');

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0);
    });

    it('should handle invalid regex gracefully', () => {
      const context = createContext('test.ts', 'content');
      const pattern = createPattern('invalid-regex', 'regex', {
        regexConfig: { pattern: '[invalid' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0);
    });
  });

  describe('Structural matching', () => {
    it('should match by path pattern', () => {
      const context = createContext('src/components/Button.tsx', '');
      const pattern = createPattern('component-path', 'structural', {
        structuralConfig: { pathPattern: 'src/components/**' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
      expect(results[0]?.matchType).toBe('structural');
    });

    it('should match by directory pattern', () => {
      const context = createContext('src/utils/helpers.ts', '');
      const pattern = createPattern('utils-dir', 'structural', {
        structuralConfig: { directoryPattern: 'src/utils' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });

    it('should match PascalCase naming pattern', () => {
      const context = createContext('src/MyComponent.tsx', '');
      const pattern = createPattern('pascal-case', 'structural', {
        structuralConfig: { namingPattern: 'PascalCase' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });

    it('should match kebab-case naming pattern', () => {
      const context = createContext('src/my-component.tsx', '');
      const pattern = createPattern('kebab-case', 'structural', {
        structuralConfig: { namingPattern: 'kebab-case' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });

    it('should match snake_case naming pattern', () => {
      const context = createContext('src/my_component.tsx', '');
      const pattern = createPattern('snake-case', 'structural', {
        structuralConfig: { namingPattern: 'snake_case' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });

    it('should match by file extension', () => {
      const context = createContext('src/component.tsx', '');
      const pattern = createPattern('tsx-files', 'structural', {
        structuralConfig: { extension: '.tsx' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });

    it('should not match when path pattern fails', () => {
      const context = createContext('lib/utils.ts', '');
      const pattern = createPattern('src-only', 'structural', {
        structuralConfig: { pathPattern: 'src/**' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0);
    });

    it('should return empty array when structuralConfig is missing', () => {
      const context = createContext('test.ts', '');
      const pattern = createPattern('no-config', 'structural');

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0);
    });
  });

  describe('Pattern filtering', () => {
    it('should skip disabled patterns', () => {
      const root = createNode('Program', '');
      const ast = createAST(root);
      const context = createContext('test.ts', '', ast);
      const pattern = createPattern('disabled', 'ast', {
        enabled: false,
        astConfig: { nodeType: 'Program' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0);
    });

    it('should filter by language', () => {
      const root = createNode('Program', '');
      const ast = createAST(root);
      const context = createContext('test.ts', '', ast, 'typescript');
      const pattern = createPattern('python-only', 'ast', {
        languages: ['python'],
        astConfig: { nodeType: 'Program' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0);
    });

    it('should match when language is in list', () => {
      const root = createNode('Program', '');
      const ast = createAST(root);
      const context = createContext('test.ts', '', ast, 'typescript');
      const pattern = createPattern('ts-or-js', 'ast', {
        languages: ['typescript', 'javascript'],
        astConfig: { nodeType: 'Program' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });

    it('should respect include patterns', () => {
      const context = createContext('src/components/Button.tsx', 'content');
      const pattern = createPattern('components-only', 'regex', {
        includePatterns: ['src/components/**'],
        regexConfig: { pattern: 'content' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });

    it('should respect exclude patterns', () => {
      const context = createContext('src/components/Button.test.tsx', 'content');
      const pattern = createPattern('no-tests', 'regex', {
        excludePatterns: ['**/*.test.*'],
        regexConfig: { pattern: 'content' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0);
    });
  });

  describe('matchAll', () => {
    it('should match against multiple patterns', () => {
      const content = 'const foo = 1;\nfunction bar() {}';
      const context = createContext('test.ts', content);
      const patterns = [
        createPattern('const-pattern', 'regex', {
          regexConfig: { pattern: 'const' },
        }),
        createPattern('func-pattern', 'regex', {
          regexConfig: { pattern: 'function' },
        }),
      ];

      const result = matcher.matchAll(context, patterns);

      expect(result.matches).toHaveLength(2);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should report duration', () => {
      const context = createContext('test.ts', 'content');
      const patterns = [
        createPattern('pattern1', 'regex', {
          regexConfig: { pattern: 'content' },
        }),
      ];

      const result = matcher.matchAll(context, patterns);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle errors gracefully', () => {
      const context = createContext('test.ts', 'content');
      // Create a pattern that will cause an error by having invalid config
      const patterns = [
        createPattern('valid', 'regex', {
          regexConfig: { pattern: 'content' },
        }),
      ];

      const result = matcher.matchAll(context, patterns);

      expect(result.success).toBe(true);
    });
  });

  describe('Caching', () => {
    it('should cache results', () => {
      const context = createContext('test.ts', 'const foo = 1;');
      const pattern = createPattern('const-pattern', 'regex', {
        regexConfig: { pattern: 'const' },
      });

      // First call - should cache
      const results1 = matcher.match(context, pattern);
      expect(results1).toHaveLength(1);

      // Second call - should use cache
      const results2 = matcher.match(context, pattern);
      expect(results2).toHaveLength(1);
    });

    it('should invalidate cache on content change', () => {
      const pattern = createPattern('const-pattern', 'regex', {
        regexConfig: { pattern: 'const' },
      });

      // First call with original content
      const context1 = createContext('test.ts', 'const foo = 1;');
      const results1 = matcher.match(context1, pattern);
      expect(results1).toHaveLength(1);

      // Second call with different content
      const context2 = createContext('test.ts', 'let foo = 1;');
      const results2 = matcher.match(context2, pattern);
      expect(results2).toHaveLength(0);
    });

    it('should respect useCache option', () => {
      const context = createContext('test.ts', 'const foo = 1;');
      const pattern = createPattern('const-pattern', 'regex', {
        regexConfig: { pattern: 'const' },
      });

      // First call with caching
      matcher.match(context, pattern, { useCache: true });

      // Second call without caching
      const results = matcher.match(context, pattern, { useCache: false });
      expect(results).toHaveLength(1);
    });

    it('should clear cache', () => {
      const context = createContext('test.ts', 'const foo = 1;');
      const pattern = createPattern('const-pattern', 'regex', {
        regexConfig: { pattern: 'const' },
      });

      matcher.match(context, pattern);
      expect(matcher.getCacheStats().size).toBeGreaterThan(0);

      matcher.clearCache();
      expect(matcher.getCacheStats().size).toBe(0);
    });

    it('should evict old entries when cache is full', () => {
      const config: MatcherConfig = {
        cache: { enabled: true, maxSize: 2 },
      };
      const m = new PatternMatcher(config);

      const pattern = createPattern('pattern', 'regex', {
        regexConfig: { pattern: 'test' },
      });

      // Fill cache
      m.match(createContext('file1.ts', 'test'), pattern);
      m.match(createContext('file2.ts', 'test'), pattern);
      m.match(createContext('file3.ts', 'test'), pattern);

      expect(m.getCacheStats().size).toBeLessThanOrEqual(2);
    });
  });

  describe('Result filtering', () => {
    it('should filter by minimum confidence', () => {
      const func = createNode('FunctionDeclaration', 'function foo() {}');
      const root = createNode('Program', '', [func]);
      const ast = createAST(root);
      const context = createContext('test.ts', '', ast);
      const pattern = createPattern('func-pattern', 'ast', {
        astConfig: { nodeType: 'FunctionDeclaration' },
      });

      const results = matcher.match(context, pattern, { minConfidence: 0.9 });

      expect(results).toHaveLength(1); // Confidence is 1.0
    });

    it('should limit number of results', () => {
      const content = 'a a a a a';
      const context = createContext('test.ts', content);
      const pattern = createPattern('a-pattern', 'regex', {
        regexConfig: { pattern: 'a' },
      });

      const results = matcher.match(context, pattern, { maxMatches: 2 });

      expect(results).toHaveLength(2);
    });
  });

  describe('Error handling', () => {
    it('should handle AST matching errors gracefully', () => {
      // Create a context with a malformed AST that might cause issues
      const root = createNode('Program', '');
      const ast = createAST(root);
      const context = createContext('test.ts', '', ast);
      const pattern = createPattern('error-pattern', 'ast', {
        astConfig: { nodeType: 'NonExistent' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0);
    });

    it('should handle semantic match type (fallback to AST)', () => {
      const root = createNode('Program', '');
      const ast = createAST(root);
      const context = createContext('test.ts', '', ast);
      const pattern = createPattern('semantic-pattern', 'semantic', {
        astConfig: { nodeType: 'Program' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });

    it('should handle custom match type (not implemented)', () => {
      const context = createContext('test.ts', 'content');
      const pattern = createPattern('custom-pattern', 'custom');

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(0);
    });
  });

  describe('Location calculation', () => {
    it('should calculate correct AST node locations', () => {
      const node = createNode('Identifier', 'foo', [], 5, 10, 5, 13);
      const root = createNode('Program', '', [node], 0, 0, 10, 0);
      const ast = createAST(root);
      const context = createContext('test.ts', '', ast);
      const pattern = createPattern('id-pattern', 'ast', {
        astConfig: { nodeType: 'Identifier' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
      expect(results[0]?.location.line).toBe(6); // 1-indexed
      expect(results[0]?.location.column).toBe(11); // 1-indexed
      expect(results[0]?.location.endLine).toBe(6);
      expect(results[0]?.location.endColumn).toBe(14);
    });

    it('should calculate correct regex match locations', () => {
      const content = 'line1\nline2\nfoo';
      const context = createContext('test.ts', content);
      const pattern = createPattern('foo-pattern', 'regex', {
        regexConfig: { pattern: 'foo' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
      expect(results[0]?.location.line).toBe(3);
      expect(results[0]?.location.column).toBe(1);
    });
  });

  describe('Glob pattern matching', () => {
    it('should match single wildcard', () => {
      const context = createContext('src/Button.tsx', '');
      const pattern = createPattern('src-files', 'structural', {
        structuralConfig: { pathPattern: 'src/*.tsx' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });

    it('should match double wildcard (globstar)', () => {
      const context = createContext('src/components/ui/Button.tsx', '');
      const pattern = createPattern('deep-files', 'structural', {
        structuralConfig: { pathPattern: 'src/**/*.tsx' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });

    it('should match question mark wildcard', () => {
      const context = createContext('src/a.ts', '');
      const pattern = createPattern('single-char', 'structural', {
        structuralConfig: { pathPattern: 'src/?.ts' },
      });

      const results = matcher.match(context, pattern);

      expect(results).toHaveLength(1);
    });
  });
});
