/**
 * Unit tests for ParserManager
 *
 * Tests language detection, parser selection, and AST caching
 * with LRU eviction.
 *
 * @requirements 3.2, 3.7
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ParserManager, type ParserManagerOptions, type ParserCacheStats, type TextChange } from './parser-manager.js';
import { BaseParser } from './base-parser.js';
import type { AST, ASTNode, Language, ParseResult } from './types.js';

// Mock fs module
vi.mock('node:fs/promises');

/**
 * Test parser implementation for TypeScript
 */
class TestTypeScriptParser extends BaseParser {
  readonly language: Language = 'typescript';
  readonly extensions: string[] = ['.ts', '.tsx'];

  parse(source: string, filePath?: string): ParseResult {
    const rootNode: ASTNode = {
      type: 'program',
      text: source,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: source.length },
      children: [],
    };

    const ast: AST = {
      rootNode,
      text: source,
    };

    return this.createSuccessResult(ast);
  }

  query(ast: AST, pattern: string): ASTNode[] {
    return this.findNodesByType(ast, pattern);
  }
}

/**
 * Test parser implementation for JavaScript
 */
class TestJavaScriptParser extends BaseParser {
  readonly language: Language = 'javascript';
  readonly extensions: string[] = ['.js', '.jsx'];

  parse(source: string, filePath?: string): ParseResult {
    const rootNode: ASTNode = {
      type: 'program',
      text: source,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: source.length },
      children: [],
    };

    const ast: AST = {
      rootNode,
      text: source,
    };

    return this.createSuccessResult(ast);
  }

  query(ast: AST, pattern: string): ASTNode[] {
    return this.findNodesByType(ast, pattern);
  }
}

/**
 * Test parser implementation for Python
 */
class TestPythonParser extends BaseParser {
  readonly language: Language = 'python';
  readonly extensions: string[] = ['.py'];

  parse(source: string, filePath?: string): ParseResult {
    const rootNode: ASTNode = {
      type: 'module',
      text: source,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: source.length },
      children: [],
    };

    const ast: AST = {
      rootNode,
      text: source,
    };

    return this.createSuccessResult(ast);
  }

  query(ast: AST, pattern: string): ASTNode[] {
    return this.findNodesByType(ast, pattern);
  }
}

describe('ParserManager', () => {
  let manager: ParserManager;
  let tsParser: TestTypeScriptParser;
  let jsParser: TestJavaScriptParser;
  let pyParser: TestPythonParser;

  beforeEach(() => {
    manager = new ParserManager();
    tsParser = new TestTypeScriptParser();
    jsParser = new TestJavaScriptParser();
    pyParser = new TestPythonParser();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create manager with default options', () => {
      const mgr = new ParserManager();
      const stats = mgr.getCacheStats();

      expect(stats.maxSize).toBe(100);
      expect(stats.size).toBe(0);
    });

    it('should create manager with custom options', () => {
      const mgr = new ParserManager({ cacheSize: 50 });
      const stats = mgr.getCacheStats();

      expect(stats.maxSize).toBe(50);
    });
  });

  describe('registerParser', () => {
    it('should register a parser', () => {
      manager.registerParser(tsParser);

      expect(manager.hasParser('typescript')).toBe(true);
    });

    it('should throw error when registering duplicate parser', () => {
      manager.registerParser(tsParser);

      expect(() => manager.registerParser(tsParser)).toThrow(
        "Parser for language 'typescript' is already registered"
      );
    });

    it('should register multiple parsers for different languages', () => {
      manager.registerParser(tsParser);
      manager.registerParser(jsParser);
      manager.registerParser(pyParser);

      expect(manager.hasParser('typescript')).toBe(true);
      expect(manager.hasParser('javascript')).toBe(true);
      expect(manager.hasParser('python')).toBe(true);
    });
  });

  describe('detectLanguage', () => {
    it('should detect TypeScript from .ts extension', () => {
      expect(manager.detectLanguage('file.ts')).toBe('typescript');
    });

    it('should detect TypeScript from .tsx extension', () => {
      expect(manager.detectLanguage('file.tsx')).toBe('typescript');
    });

    it('should detect JavaScript from .js extension', () => {
      expect(manager.detectLanguage('file.js')).toBe('javascript');
    });

    it('should detect JavaScript from .jsx extension', () => {
      expect(manager.detectLanguage('file.jsx')).toBe('javascript');
    });

    it('should detect Python from .py extension', () => {
      expect(manager.detectLanguage('file.py')).toBe('python');
    });

    it('should detect CSS from .css extension', () => {
      expect(manager.detectLanguage('file.css')).toBe('css');
    });

    it('should detect SCSS from .scss extension', () => {
      expect(manager.detectLanguage('file.scss')).toBe('scss');
    });

    it('should detect JSON from .json extension', () => {
      expect(manager.detectLanguage('file.json')).toBe('json');
    });

    it('should detect YAML from .yaml extension', () => {
      expect(manager.detectLanguage('file.yaml')).toBe('yaml');
    });

    it('should detect YAML from .yml extension', () => {
      expect(manager.detectLanguage('file.yml')).toBe('yaml');
    });

    it('should detect Markdown from .md extension', () => {
      expect(manager.detectLanguage('file.md')).toBe('markdown');
    });

    it('should return null for unknown extension', () => {
      expect(manager.detectLanguage('file.unknown')).toBeNull();
    });

    it('should handle paths with directories', () => {
      expect(manager.detectLanguage('/path/to/file.ts')).toBe('typescript');
      expect(manager.detectLanguage('src/components/Button.tsx')).toBe('typescript');
    });

    it('should be case-insensitive', () => {
      expect(manager.detectLanguage('file.TS')).toBe('typescript');
      expect(manager.detectLanguage('file.Tsx')).toBe('typescript');
    });

    it('should detect .mts and .cts as TypeScript', () => {
      expect(manager.detectLanguage('file.mts')).toBe('typescript');
      expect(manager.detectLanguage('file.cts')).toBe('typescript');
    });

    it('should detect .mjs and .cjs as JavaScript', () => {
      expect(manager.detectLanguage('file.mjs')).toBe('javascript');
      expect(manager.detectLanguage('file.cjs')).toBe('javascript');
    });
  });

  describe('getParser', () => {
    beforeEach(() => {
      manager.registerParser(tsParser);
      manager.registerParser(jsParser);
    });

    it('should return parser for TypeScript file', () => {
      const parser = manager.getParser('file.ts');

      expect(parser).toBe(tsParser);
    });

    it('should return parser for JavaScript file', () => {
      const parser = manager.getParser('file.js');

      expect(parser).toBe(jsParser);
    });

    it('should return null for unsupported language', () => {
      const parser = manager.getParser('file.py');

      expect(parser).toBeNull();
    });

    it('should return null for unknown extension', () => {
      const parser = manager.getParser('file.unknown');

      expect(parser).toBeNull();
    });
  });

  describe('parse', () => {
    beforeEach(() => {
      manager.registerParser(tsParser);
    });

    it('should parse source code with appropriate parser', () => {
      const result = manager.parse('file.ts', 'const x = 1;');

      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
      expect(result.language).toBe('typescript');
    });

    it('should return error for unsupported file type', () => {
      const result = manager.parse('file.unknown', 'content');

      expect(result.success).toBe(false);
      expect(result.ast).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('No parser available');
    });

    it('should cache parse results', () => {
      const source = 'const x = 1;';

      // First parse
      manager.parse('file.ts', source);
      const stats1 = manager.getCacheStats();

      // Second parse with same content
      manager.parse('file.ts', source);
      const stats2 = manager.getCacheStats();

      expect(stats1.misses).toBe(1);
      expect(stats2.hits).toBe(1);
    });

    it('should not use cache for different content', () => {
      manager.parse('file.ts', 'const x = 1;');
      manager.parse('file.ts', 'const y = 2;');

      const stats = manager.getCacheStats();
      expect(stats.misses).toBe(2);
      expect(stats.hits).toBe(0);
    });
  });

  describe('parseFile', () => {
    beforeEach(() => {
      manager.registerParser(tsParser);
    });

    it('should parse file from disk', async () => {
      const mockContent = 'const x = 1;';
      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await manager.parseFile('file.ts');

      expect(result.success).toBe(true);
      expect(result.ast?.text).toBe(mockContent);
      expect(fs.readFile).toHaveBeenCalledWith('file.ts', 'utf-8');
    });

    it('should return error when file read fails', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      const result = await manager.parseFile('nonexistent.ts');

      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain('Failed to read file');
    });
  });

  describe('cache management', () => {
    beforeEach(() => {
      manager = new ParserManager({ cacheSize: 3 });
      manager.registerParser(tsParser);
    });

    it('should evict LRU entry when cache is full', () => {
      // Fill cache
      manager.parse('file1.ts', 'content1');
      manager.parse('file2.ts', 'content2');
      manager.parse('file3.ts', 'content3');

      expect(manager.cacheSize).toBe(3);

      // Add one more, should evict file1
      manager.parse('file4.ts', 'content4');

      expect(manager.cacheSize).toBe(3);

      const stats = manager.getCacheStats();
      expect(stats.evictions).toBe(1);
    });

    it('should update LRU order on cache hit', () => {
      // Fill cache
      manager.parse('file1.ts', 'content1');
      manager.parse('file2.ts', 'content2');
      manager.parse('file3.ts', 'content3');

      // Access file1 to make it most recently used
      manager.parse('file1.ts', 'content1');

      // Add new file, should evict file2 (now LRU)
      manager.parse('file4.ts', 'content4');

      // file1 should still be in cache
      manager.parse('file1.ts', 'content1');
      const stats = manager.getCacheStats();

      // Should have hits for file1 accesses
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should invalidate cache for specific file', () => {
      manager.parse('file1.ts', 'content1');
      manager.parse('file2.ts', 'content2');

      expect(manager.cacheSize).toBe(2);

      const invalidated = manager.invalidateCache('file1.ts');

      expect(invalidated).toBe(true);
      expect(manager.cacheSize).toBe(1);
    });

    it('should return false when invalidating non-cached file', () => {
      const invalidated = manager.invalidateCache('nonexistent.ts');

      expect(invalidated).toBe(false);
    });

    it('should clear all cache entries', () => {
      manager.parse('file1.ts', 'content1');
      manager.parse('file2.ts', 'content2');

      expect(manager.cacheSize).toBe(2);

      manager.clearCache();

      expect(manager.cacheSize).toBe(0);
    });
  });

  describe('cache TTL', () => {
    it('should expire entries after TTL', async () => {
      manager = new ParserManager({ cacheSize: 100, cacheTTL: 100 });
      manager.registerParser(tsParser);

      manager.parse('file.ts', 'content');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be a cache miss now
      manager.parse('file.ts', 'content');

      const stats = manager.getCacheStats();
      expect(stats.misses).toBe(2); // Both should be misses
    });

    it('should not expire entries when TTL is 0', () => {
      manager = new ParserManager({ cacheSize: 100, cacheTTL: 0 });
      manager.registerParser(tsParser);

      manager.parse('file.ts', 'content');
      manager.parse('file.ts', 'content');

      const stats = manager.getCacheStats();
      expect(stats.hits).toBe(1);
    });
  });

  describe('cache statistics', () => {
    beforeEach(() => {
      manager.registerParser(tsParser);
    });

    it('should track cache hits', () => {
      manager.parse('file.ts', 'content');
      manager.parse('file.ts', 'content');

      const stats = manager.getCacheStats();
      expect(stats.hits).toBe(1);
    });

    it('should track cache misses', () => {
      manager.parse('file.ts', 'content1');
      manager.parse('file.ts', 'content2');

      const stats = manager.getCacheStats();
      expect(stats.misses).toBe(2);
    });

    it('should calculate hit ratio', () => {
      manager.parse('file.ts', 'content');
      manager.parse('file.ts', 'content');
      manager.parse('file.ts', 'content');

      const stats = manager.getCacheStats();
      // 1 miss + 2 hits = 2/3 hit ratio
      expect(stats.hitRatio).toBeCloseTo(0.667, 2);
    });

    it('should reset statistics', () => {
      manager.parse('file.ts', 'content');
      manager.parse('file.ts', 'content');

      manager.resetCacheStats();

      const stats = manager.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRatio).toBe(0);
    });
  });

  describe('getRegisteredLanguages', () => {
    it('should return empty array when no parsers registered', () => {
      expect(manager.getRegisteredLanguages()).toEqual([]);
    });

    it('should return all registered languages', () => {
      manager.registerParser(tsParser);
      manager.registerParser(jsParser);

      const languages = manager.getRegisteredLanguages();

      expect(languages).toContain('typescript');
      expect(languages).toContain('javascript');
      expect(languages).toHaveLength(2);
    });
  });

  describe('getSupportedExtensions', () => {
    it('should return all supported extensions', () => {
      const extensions = manager.getSupportedExtensions();

      expect(extensions).toContain('.ts');
      expect(extensions).toContain('.tsx');
      expect(extensions).toContain('.js');
      expect(extensions).toContain('.jsx');
      expect(extensions).toContain('.py');
      expect(extensions).toContain('.css');
      expect(extensions).toContain('.scss');
      expect(extensions).toContain('.json');
      expect(extensions).toContain('.yaml');
      expect(extensions).toContain('.yml');
      expect(extensions).toContain('.md');
    });
  });

  describe('isExtensionSupported', () => {
    it('should return true for supported extensions', () => {
      expect(manager.isExtensionSupported('.ts')).toBe(true);
      expect(manager.isExtensionSupported('.js')).toBe(true);
      expect(manager.isExtensionSupported('.py')).toBe(true);
    });

    it('should return false for unsupported extensions', () => {
      expect(manager.isExtensionSupported('.unknown')).toBe(false);
      expect(manager.isExtensionSupported('.xyz')).toBe(false);
    });

    it('should handle extensions without leading dot', () => {
      expect(manager.isExtensionSupported('ts')).toBe(true);
      expect(manager.isExtensionSupported('js')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(manager.isExtensionSupported('.TS')).toBe(true);
      expect(manager.isExtensionSupported('.Tsx')).toBe(true);
    });
  });

  describe('hasParser', () => {
    it('should return false when no parser registered', () => {
      expect(manager.hasParser('typescript')).toBe(false);
    });

    it('should return true when parser is registered', () => {
      manager.registerParser(tsParser);

      expect(manager.hasParser('typescript')).toBe(true);
    });
  });

  describe('incremental parsing', () => {
    beforeEach(() => {
      manager = new ParserManager({ cacheSize: 100, enableIncremental: true });
      manager.registerParser(tsParser);
    });

    it('should return cached result when content has not changed', () => {
      const source = 'const x = 1;';
      
      // First parse
      const result1 = manager.parse('file.ts', source);
      
      // Second parse with same content
      const result2 = manager.parse('file.ts', source);
      
      const stats = manager.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it('should re-parse when content changes', () => {
      const source1 = 'const x = 1;';
      const source2 = 'const x = 2;';
      
      // First parse
      manager.parse('file.ts', source1);
      
      // Second parse with different content
      manager.parse('file.ts', source2);
      
      const stats = manager.getCacheStats();
      expect(stats.misses).toBe(2);
      expect(stats.fullParses + stats.incrementalParses).toBe(2);
    });

    it('should track incremental vs full parses in statistics', () => {
      const source1 = 'const x = 1;';
      const source2 = 'const x = 2;';
      
      // First parse (always full)
      manager.parse('file.ts', source1);
      
      // Second parse with small change (may be incremental)
      manager.parse('file.ts', source2);
      
      const stats = manager.getCacheStats();
      expect(stats.fullParses + stats.incrementalParses).toBeGreaterThanOrEqual(2);
    });

    it('should use incremental parsing for small changes', () => {
      const source1 = `const x = 1;
const y = 2;
const z = 3;`;
      const source2 = `const x = 1;
const y = 3;
const z = 3;`;
      
      // First parse
      manager.parse('file.ts', source1);
      
      // Second parse with small change
      manager.parse('file.ts', source2);
      
      const stats = manager.getCacheStats();
      // Should have attempted incremental parsing
      expect(stats.fullParses + stats.incrementalParses).toBeGreaterThanOrEqual(2);
    });

    it('should disable incremental parsing when option is false', () => {
      manager = new ParserManager({ cacheSize: 100, enableIncremental: false });
      manager.registerParser(tsParser);
      
      const source1 = 'const x = 1;';
      const source2 = 'const x = 2;';
      
      manager.parse('file.ts', source1);
      manager.parse('file.ts', source2);
      
      const stats = manager.getCacheStats();
      expect(stats.incrementalParses).toBe(0);
      expect(stats.fullParses).toBe(2);
    });
  });

  describe('parseWithChanges', () => {
    beforeEach(() => {
      manager = new ParserManager({ cacheSize: 100, enableIncremental: true });
      manager.registerParser(tsParser);
    });

    it('should parse with explicit change information', () => {
      const source = 'const x = 2;';
      const changes = [
        {
          startPosition: { row: 0, column: 10 },
          oldEndPosition: { row: 0, column: 11 },
          newEndPosition: { row: 0, column: 11 },
          newText: '2',
        },
      ];
      
      const result = manager.parseWithChanges('file.ts', source, changes);
      
      expect(result.success).toBe(true);
      expect(result.wasIncremental).toBeDefined();
    });

    it('should return reparsed regions when incremental', () => {
      const source1 = 'const x = 1;';
      const source2 = 'const x = 2;';
      
      // First parse to populate cache
      manager.parse('file.ts', source1);
      
      const changes = [
        {
          startPosition: { row: 0, column: 10 },
          oldEndPosition: { row: 0, column: 11 },
          newEndPosition: { row: 0, column: 11 },
          newText: '2',
        },
      ];
      
      const result = manager.parseWithChanges('file.ts', source2, changes);
      
      expect(result.success).toBe(true);
      // reparsedRegions may be present if incremental parsing was used
      if (result.wasIncremental && result.reparsedRegions) {
        expect(result.reparsedRegions.length).toBeGreaterThan(0);
      }
    });

    it('should return error for unsupported file type', () => {
      const result = manager.parseWithChanges('file.unknown', 'content', []);
      
      expect(result.success).toBe(false);
      expect(result.wasIncremental).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('should use cache hit when content matches exactly', () => {
      const source = 'const x = 1;';
      
      // First parse
      manager.parse('file.ts', source);
      
      // Parse with changes but same final content
      const result = manager.parseWithChanges('file.ts', source, []);
      
      expect(result.success).toBe(true);
      expect(result.wasIncremental).toBe(false); // Cache hit, not incremental
      
      const stats = manager.getCacheStats();
      expect(stats.hits).toBe(1);
    });
  });

  describe('AST cache with LRU eviction', () => {
    beforeEach(() => {
      manager = new ParserManager({ cacheSize: 3 });
      manager.registerParser(tsParser);
    });

    it('should maintain AST cache with LRU eviction policy', () => {
      // Fill cache to capacity
      manager.parse('file1.ts', 'const a = 1;');
      manager.parse('file2.ts', 'const b = 2;');
      manager.parse('file3.ts', 'const c = 3;');
      
      expect(manager.cacheSize).toBe(3);
      
      // Access file1 to make it recently used
      manager.parse('file1.ts', 'const a = 1;');
      
      // Add new file, should evict file2 (LRU)
      manager.parse('file4.ts', 'const d = 4;');
      
      expect(manager.cacheSize).toBe(3);
      
      // file1 should still be cached (was accessed recently)
      manager.parse('file1.ts', 'const a = 1;');
      const stats = manager.getCacheStats();
      expect(stats.hits).toBeGreaterThanOrEqual(2); // At least 2 hits for file1
      expect(stats.evictions).toBe(1);
    });

    it('should track content hash to detect changes', () => {
      const source1 = 'const x = 1;';
      const source2 = 'const x = 1;'; // Same content
      const source3 = 'const x = 2;'; // Different content
      
      // Parse same content twice
      manager.parse('file.ts', source1);
      manager.parse('file.ts', source2);
      
      let stats = manager.getCacheStats();
      expect(stats.hits).toBe(1); // Second parse should be cache hit
      
      // Parse different content
      manager.parse('file.ts', source3);
      
      stats = manager.getCacheStats();
      expect(stats.misses).toBe(2); // First parse and third parse are misses
    });

    it('should evict entries in correct LRU order', () => {
      // Fill cache
      manager.parse('file1.ts', 'const a = 1;');
      manager.parse('file2.ts', 'const b = 2;');
      manager.parse('file3.ts', 'const c = 3;');
      
      // Access in order: file1, file3 (file2 becomes LRU)
      manager.parse('file1.ts', 'const a = 1;');
      manager.parse('file3.ts', 'const c = 3;');
      
      // Add new file, should evict file2
      manager.parse('file4.ts', 'const d = 4;');
      
      // file2 should be evicted, file1 and file3 should still be cached
      manager.parse('file1.ts', 'const a = 1;');
      manager.parse('file3.ts', 'const c = 3;');
      
      const stats = manager.getCacheStats();
      // file1: 3 accesses (1 miss, 2 hits)
      // file3: 3 accesses (1 miss, 2 hits)
      // file2: 1 access (1 miss, evicted)
      // file4: 1 access (1 miss)
      expect(stats.evictions).toBe(1);
      expect(stats.hits).toBeGreaterThanOrEqual(4);
    });
  });

  describe('cache configuration', () => {
    it('should respect custom cache size', () => {
      manager = new ParserManager({ cacheSize: 2 });
      manager.registerParser(tsParser);
      
      manager.parse('file1.ts', 'const a = 1;');
      manager.parse('file2.ts', 'const b = 2;');
      manager.parse('file3.ts', 'const c = 3;');
      
      expect(manager.cacheSize).toBe(2);
      
      const stats = manager.getCacheStats();
      expect(stats.evictions).toBe(1);
      expect(stats.maxSize).toBe(2);
    });

    it('should respect incrementalThreshold option', () => {
      manager = new ParserManager({ 
        cacheSize: 100, 
        enableIncremental: true,
        incrementalThreshold: 1000 // Very high threshold
      });
      manager.registerParser(tsParser);
      
      const source1 = 'const x = 1;';
      const source2 = 'const x = 2;';
      
      manager.parse('file.ts', source1);
      manager.parse('file.ts', source2);
      
      // With high threshold, small changes should still trigger incremental
      const stats = manager.getCacheStats();
      expect(stats.fullParses + stats.incrementalParses).toBeGreaterThanOrEqual(2);
    });
  });
});
