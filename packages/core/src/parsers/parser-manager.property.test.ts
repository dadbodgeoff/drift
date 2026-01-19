/**
 * Property-Based Tests for ParserManager - Incremental Parsing
 *
 * Property 5: Incremental Analysis Consistency
 * Incremental parse result SHALL equal full parse result
 * **Validates: Requirements 2.2, 3.4**
 *
 * @requirements 2.2 - WHEN a file changes, THE Scanner SHALL perform incremental analysis only on affected files
 * @requirements 3.4 - THE Parser SHALL perform incremental parsing for changed file regions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ParserManager, type TextChange } from './parser-manager.js';
import { BaseParser } from './base-parser.js';
import type { AST, ASTNode, Language, ParseResult, Position } from './types.js';

/**
 * Simple mock parser for testing incremental parsing behavior.
 * Creates a deterministic AST based on the source content.
 */
class MockParser extends BaseParser {
  readonly language: Language = 'typescript';
  readonly extensions: string[] = ['.ts', '.tsx'];

  parse(source: string, filePath?: string): ParseResult {
    // Create a deterministic AST based on source content
    const lines = source.split('\n');
    const children: ASTNode[] = [];

    for (let row = 0; row < lines.length; row++) {
      const line = lines[row];
      if (line && line.trim().length > 0) {
        children.push(this.createNode(
          'line',
          line,
          { row, column: 0 },
          { row, column: line.length },
          []
        ));
      }
    }

    const rootNode = this.createNode(
      'program',
      source,
      { row: 0, column: 0 },
      { row: lines.length - 1, column: lines[lines.length - 1]?.length ?? 0 },
      children
    );

    return this.createSuccessResult(this.createAST(rootNode, source));
  }

  query(ast: AST, pattern: string): ASTNode[] {
    // Simple query implementation - find nodes by type
    const results: ASTNode[] = [];
    this.traverse(ast, ({ node }) => {
      if (node.type === pattern) {
        results.push(node);
      }
    });
    return results;
  }
}

/**
 * Arbitrary for generating valid source code lines
 */
const sourceLineArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _=(){}[];:.,+-*/'),
  { minLength: 1, maxLength: 50 }
);

/**
 * Arbitrary for generating multi-line source code
 */
const sourceCodeArb = fc
  .array(sourceLineArb, { minLength: 1, maxLength: 20 })
  .map((lines) => lines.join('\n'));

/**
 * Arbitrary for generating a position within source code bounds
 */
const positionInSourceArb = (source: string) => {
  const lines = source.split('\n');
  const maxRow = Math.max(0, lines.length - 1);
  
  return fc.integer({ min: 0, max: maxRow }).chain((row) => {
    const lineLength = lines[row]?.length ?? 0;
    const maxCol = Math.max(0, lineLength);
    return fc.integer({ min: 0, max: maxCol }).map((column) => ({ row, column }));
  });
};

/**
 * Arbitrary for generating edit operations (insertions, deletions, replacements)
 */
const editOperationArb = fc.oneof(
  // Insertion
  fc.record({
    type: fc.constant('insert' as const),
    text: sourceLineArb,
  }),
  // Deletion
  fc.record({
    type: fc.constant('delete' as const),
    length: fc.integer({ min: 1, max: 20 }),
  }),
  // Replacement
  fc.record({
    type: fc.constant('replace' as const),
    length: fc.integer({ min: 1, max: 20 }),
    text: sourceLineArb,
  })
);

/**
 * Apply an edit operation to source code at a given position
 */
function applyEdit(
  source: string,
  position: Position,
  operation: { type: 'insert' | 'delete' | 'replace'; text?: string; length?: number }
): { newSource: string; change: TextChange } {
  const lines = source.split('\n');
  const lineIndex = Math.min(position.row, lines.length - 1);
  const line = lines[lineIndex] ?? '';
  const colIndex = Math.min(position.column, line.length);

  // Convert position to character offset
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) {
    offset += (lines[i]?.length ?? 0) + 1; // +1 for newline
  }
  offset += colIndex;

  let newSource: string;
  let oldEndPosition: Position;
  let newEndPosition: Position;
  let newText: string;

  switch (operation.type) {
    case 'insert': {
      newText = operation.text ?? '';
      newSource = source.slice(0, offset) + newText + source.slice(offset);
      oldEndPosition = { ...position };
      
      // Calculate new end position after insertion
      const insertedLines = newText.split('\n');
      if (insertedLines.length === 1) {
        newEndPosition = { row: position.row, column: position.column + newText.length };
      } else {
        newEndPosition = {
          row: position.row + insertedLines.length - 1,
          column: insertedLines[insertedLines.length - 1]?.length ?? 0,
        };
      }
      break;
    }
    case 'delete': {
      const deleteLength = Math.min(operation.length ?? 1, source.length - offset);
      const deletedText = source.slice(offset, offset + deleteLength);
      newSource = source.slice(0, offset) + source.slice(offset + deleteLength);
      newText = '';
      
      // Calculate old end position (where deletion ended)
      const deletedLines = deletedText.split('\n');
      if (deletedLines.length === 1) {
        oldEndPosition = { row: position.row, column: position.column + deleteLength };
      } else {
        oldEndPosition = {
          row: position.row + deletedLines.length - 1,
          column: deletedLines[deletedLines.length - 1]?.length ?? 0,
        };
      }
      newEndPosition = { ...position };
      break;
    }
    case 'replace': {
      const replaceLength = Math.min(operation.length ?? 1, source.length - offset);
      const replacedText = source.slice(offset, offset + replaceLength);
      newText = operation.text ?? '';
      newSource = source.slice(0, offset) + newText + source.slice(offset + replaceLength);
      
      // Calculate old end position
      const replacedLines = replacedText.split('\n');
      if (replacedLines.length === 1) {
        oldEndPosition = { row: position.row, column: position.column + replaceLength };
      } else {
        oldEndPosition = {
          row: position.row + replacedLines.length - 1,
          column: replacedLines[replacedLines.length - 1]?.length ?? 0,
        };
      }
      
      // Calculate new end position
      const newTextLines = newText.split('\n');
      if (newTextLines.length === 1) {
        newEndPosition = { row: position.row, column: position.column + newText.length };
      } else {
        newEndPosition = {
          row: position.row + newTextLines.length - 1,
          column: newTextLines[newTextLines.length - 1]?.length ?? 0,
        };
      }
      break;
    }
  }

  return {
    newSource,
    change: {
      startPosition: position,
      oldEndPosition,
      newEndPosition,
      newText,
    },
  };
}

/**
 * Compare two ASTs for structural equality
 */
function astsAreEquivalent(ast1: AST | null, ast2: AST | null): boolean {
  if (ast1 === null && ast2 === null) return true;
  if (ast1 === null || ast2 === null) return false;
  
  // Compare source text
  if (ast1.text !== ast2.text) return false;
  
  // Compare root nodes recursively
  return nodesAreEquivalent(ast1.rootNode, ast2.rootNode);
}

/**
 * Compare two AST nodes for structural equality
 */
function nodesAreEquivalent(node1: ASTNode, node2: ASTNode): boolean {
  if (node1.type !== node2.type) return false;
  if (node1.text !== node2.text) return false;
  if (node1.startPosition.row !== node2.startPosition.row) return false;
  if (node1.startPosition.column !== node2.startPosition.column) return false;
  if (node1.endPosition.row !== node2.endPosition.row) return false;
  if (node1.endPosition.column !== node2.endPosition.column) return false;
  if (node1.children.length !== node2.children.length) return false;
  
  for (let i = 0; i < node1.children.length; i++) {
    const child1 = node1.children[i];
    const child2 = node2.children[i];
    if (!child1 || !child2) return false;
    if (!nodesAreEquivalent(child1, child2)) return false;
  }
  
  return true;
}

/**
 * Compare two ParseResults for equivalence
 */
function parseResultsAreEquivalent(result1: ParseResult, result2: ParseResult): boolean {
  if (result1.success !== result2.success) return false;
  if (result1.language !== result2.language) return false;
  if (result1.errors.length !== result2.errors.length) return false;
  
  // Compare errors
  for (let i = 0; i < result1.errors.length; i++) {
    const err1 = result1.errors[i];
    const err2 = result2.errors[i];
    if (!err1 || !err2) return false;
    if (err1.message !== err2.message) return false;
    if (err1.position.row !== err2.position.row) return false;
    if (err1.position.column !== err2.position.column) return false;
  }
  
  // Compare ASTs
  return astsAreEquivalent(result1.ast, result2.ast);
}

describe('ParserManager Property Tests', () => {
  let manager: ParserManager;
  let mockParser: MockParser;

  beforeEach(() => {
    manager = new ParserManager({
      cacheSize: 100,
      cacheTTL: 0,
      enableStats: true,
      enableIncremental: true,
      incrementalThreshold: 10,
    });
    mockParser = new MockParser();
    manager.registerParser(mockParser);
  });

  /**
   * Property 5: Incremental Analysis Consistency
   * Incremental parse result SHALL equal full parse result
   * **Validates: Requirements 2.2, 3.4**
   */
  describe('Property 5: Incremental Analysis Consistency', () => {
    it('should produce equivalent AST for incremental vs full parse after single edit', async () => {
      await fc.assert(
        fc.asyncProperty(
          sourceCodeArb,
          editOperationArb,
          async (originalSource, operation) => {
            const filePath = '/test/file.ts';
            
            // First, parse the original source to populate the cache
            const originalResult = manager.parse(filePath, originalSource);
            expect(originalResult.success).toBe(true);
            
            // Generate a valid position within the source
            const lines = originalSource.split('\n');
            const row = Math.floor(Math.random() * lines.length);
            const col = Math.floor(Math.random() * ((lines[row]?.length ?? 0) + 1));
            const position: Position = { row, column: col };
            
            // Apply the edit
            const { newSource } = applyEdit(originalSource, position, operation);
            
            // Parse incrementally (uses cached previous result)
            const incrementalResult = manager.parse(filePath, newSource);
            
            // Create a fresh manager and parse the same source from scratch
            const freshManager = new ParserManager({
              cacheSize: 100,
              cacheTTL: 0,
              enableStats: true,
              enableIncremental: false, // Disable incremental for fresh parse
            });
            freshManager.registerParser(new MockParser());
            const fullParseResult = freshManager.parse(filePath, newSource);
            
            // PROPERTY: Incremental parse result SHALL equal full parse result
            expect(parseResultsAreEquivalent(incrementalResult, fullParseResult)).toBe(true);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should produce equivalent AST for incremental vs full parse after multiple edits', async () => {
      await fc.assert(
        fc.asyncProperty(
          sourceCodeArb,
          fc.array(editOperationArb, { minLength: 1, maxLength: 5 }),
          async (originalSource, operations) => {
            const filePath = '/test/file.ts';
            
            // Parse the original source
            manager.parse(filePath, originalSource);
            
            // Apply multiple edits sequentially
            let currentSource = originalSource;
            for (const operation of operations) {
              const lines = currentSource.split('\n');
              if (lines.length === 0) break;
              
              const row = Math.floor(Math.random() * lines.length);
              const col = Math.floor(Math.random() * ((lines[row]?.length ?? 0) + 1));
              const position: Position = { row, column: col };
              
              const { newSource } = applyEdit(currentSource, position, operation);
              currentSource = newSource;
              
              // Parse incrementally after each edit
              manager.parse(filePath, currentSource);
            }
            
            // Get the final incremental result
            const incrementalResult = manager.parse(filePath, currentSource);
            
            // Create a fresh manager and parse the final source from scratch
            const freshManager = new ParserManager({
              cacheSize: 100,
              cacheTTL: 0,
              enableStats: true,
              enableIncremental: false,
            });
            freshManager.registerParser(new MockParser());
            const fullParseResult = freshManager.parse(filePath, currentSource);
            
            // PROPERTY: Incremental parse result SHALL equal full parse result
            expect(parseResultsAreEquivalent(incrementalResult, fullParseResult)).toBe(true);
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should produce equivalent AST when using parseWithChanges', async () => {
      await fc.assert(
        fc.asyncProperty(
          sourceCodeArb,
          editOperationArb,
          async (originalSource, operation) => {
            const filePath = '/test/file.ts';
            
            // Parse the original source
            manager.parse(filePath, originalSource);
            
            // Generate a valid position
            const lines = originalSource.split('\n');
            const row = Math.floor(Math.random() * lines.length);
            const col = Math.floor(Math.random() * ((lines[row]?.length ?? 0) + 1));
            const position: Position = { row, column: col };
            
            // Apply the edit and get the change info
            const { newSource, change } = applyEdit(originalSource, position, operation);
            
            // Parse with explicit change information
            const incrementalResult = manager.parseWithChanges(filePath, newSource, [change]);
            
            // Create a fresh manager and parse from scratch
            const freshManager = new ParserManager({
              cacheSize: 100,
              cacheTTL: 0,
              enableStats: true,
              enableIncremental: false,
            });
            freshManager.registerParser(new MockParser());
            const fullParseResult = freshManager.parse(filePath, newSource);
            
            // PROPERTY: parseWithChanges result SHALL equal full parse result
            expect(parseResultsAreEquivalent(incrementalResult, fullParseResult)).toBe(true);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return cached result for identical source', async () => {
      await fc.assert(
        fc.asyncProperty(sourceCodeArb, async (source) => {
          const filePath = '/test/file.ts';
          
          // Parse the source twice
          const firstResult = manager.parse(filePath, source);
          const secondResult = manager.parse(filePath, source);
          
          // PROPERTY: Parsing identical source SHALL return equivalent results
          expect(parseResultsAreEquivalent(firstResult, secondResult)).toBe(true);
          
          // Verify cache was used (stats should show a hit)
          const stats = manager.getCacheStats();
          expect(stats.hits).toBeGreaterThan(0);
          
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should handle empty source correctly', async () => {
      const filePath = '/test/file.ts';
      
      // Parse empty source
      const emptyResult = manager.parse(filePath, '');
      
      // Create fresh manager for comparison
      const freshManager = new ParserManager({
        cacheSize: 100,
        cacheTTL: 0,
        enableStats: true,
        enableIncremental: false,
      });
      freshManager.registerParser(new MockParser());
      const freshResult = freshManager.parse(filePath, '');
      
      // PROPERTY: Empty source should produce equivalent results
      expect(parseResultsAreEquivalent(emptyResult, freshResult)).toBe(true);
    });

    it('should handle source with only whitespace correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 50 }),
          async (whitespaceSource) => {
            const filePath = '/test/file.ts';
            
            // Parse whitespace-only source
            const result = manager.parse(filePath, whitespaceSource);
            
            // Create fresh manager for comparison
            const freshManager = new ParserManager({
              cacheSize: 100,
              cacheTTL: 0,
              enableStats: true,
              enableIncremental: false,
            });
            freshManager.registerParser(new MockParser());
            const freshResult = freshManager.parse(filePath, whitespaceSource);
            
            // PROPERTY: Whitespace-only source should produce equivalent results
            expect(parseResultsAreEquivalent(result, freshResult)).toBe(true);
            
            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should maintain consistency after cache invalidation', async () => {
      await fc.assert(
        fc.asyncProperty(
          sourceCodeArb,
          sourceCodeArb,
          async (source1, source2) => {
            const filePath = '/test/file.ts';
            
            // Parse first source
            manager.parse(filePath, source1);
            
            // Invalidate cache
            manager.invalidateCache(filePath);
            
            // Parse second source (should be a fresh parse)
            const result = manager.parse(filePath, source2);
            
            // Create fresh manager for comparison
            const freshManager = new ParserManager({
              cacheSize: 100,
              cacheTTL: 0,
              enableStats: true,
              enableIncremental: false,
            });
            freshManager.registerParser(new MockParser());
            const freshResult = freshManager.parse(filePath, source2);
            
            // PROPERTY: After cache invalidation, result SHALL equal fresh parse
            expect(parseResultsAreEquivalent(result, freshResult)).toBe(true);
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle different file paths independently', async () => {
      await fc.assert(
        fc.asyncProperty(
          sourceCodeArb,
          sourceCodeArb,
          async (source1, source2) => {
            const filePath1 = '/test/file1.ts';
            const filePath2 = '/test/file2.ts';
            
            // Parse different sources for different files
            const result1 = manager.parse(filePath1, source1);
            const result2 = manager.parse(filePath2, source2);
            
            // Create fresh managers for comparison
            const freshManager1 = new ParserManager({
              cacheSize: 100,
              cacheTTL: 0,
              enableStats: true,
              enableIncremental: false,
            });
            freshManager1.registerParser(new MockParser());
            
            const freshManager2 = new ParserManager({
              cacheSize: 100,
              cacheTTL: 0,
              enableStats: true,
              enableIncremental: false,
            });
            freshManager2.registerParser(new MockParser());
            
            const freshResult1 = freshManager1.parse(filePath1, source1);
            const freshResult2 = freshManager2.parse(filePath2, source2);
            
            // PROPERTY: Different files should be parsed independently
            expect(parseResultsAreEquivalent(result1, freshResult1)).toBe(true);
            expect(parseResultsAreEquivalent(result2, freshResult2)).toBe(true);
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should produce consistent results regardless of incremental threshold', async () => {
      await fc.assert(
        fc.asyncProperty(
          sourceCodeArb,
          editOperationArb,
          fc.integer({ min: 1, max: 100 }),
          async (originalSource, operation, threshold) => {
            const filePath = '/test/file.ts';
            
            // Create manager with specific threshold
            const managerWithThreshold = new ParserManager({
              cacheSize: 100,
              cacheTTL: 0,
              enableStats: true,
              enableIncremental: true,
              incrementalThreshold: threshold,
            });
            managerWithThreshold.registerParser(new MockParser());
            
            // Parse original
            managerWithThreshold.parse(filePath, originalSource);
            
            // Apply edit
            const lines = originalSource.split('\n');
            const row = Math.floor(Math.random() * Math.max(1, lines.length));
            const col = Math.floor(Math.random() * ((lines[row]?.length ?? 0) + 1));
            const position: Position = { row, column: col };
            
            const { newSource } = applyEdit(originalSource, position, operation);
            
            // Parse with incremental
            const incrementalResult = managerWithThreshold.parse(filePath, newSource);
            
            // Create fresh manager for comparison
            const freshManager = new ParserManager({
              cacheSize: 100,
              cacheTTL: 0,
              enableStats: true,
              enableIncremental: false,
            });
            freshManager.registerParser(new MockParser());
            const fullParseResult = freshManager.parse(filePath, newSource);
            
            // PROPERTY: Result should be consistent regardless of threshold
            expect(parseResultsAreEquivalent(incrementalResult, fullParseResult)).toBe(true);
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle rapid successive edits correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          sourceCodeArb,
          fc.array(editOperationArb, { minLength: 5, maxLength: 10 }),
          async (originalSource, operations) => {
            const filePath = '/test/file.ts';
            
            // Parse original
            manager.parse(filePath, originalSource);
            
            // Apply rapid successive edits
            let currentSource = originalSource;
            for (const operation of operations) {
              const lines = currentSource.split('\n');
              if (lines.length === 0) {
                currentSource = 'x'; // Ensure we have at least one character
                continue;
              }
              
              const row = Math.floor(Math.random() * lines.length);
              const col = Math.floor(Math.random() * ((lines[row]?.length ?? 0) + 1));
              const position: Position = { row, column: col };
              
              const { newSource } = applyEdit(currentSource, position, operation);
              currentSource = newSource;
              
              // Parse after each edit (simulating rapid typing)
              manager.parse(filePath, currentSource);
            }
            
            // Get final result
            const finalResult = manager.parse(filePath, currentSource);
            
            // Create fresh manager for comparison
            const freshManager = new ParserManager({
              cacheSize: 100,
              cacheTTL: 0,
              enableStats: true,
              enableIncremental: false,
            });
            freshManager.registerParser(new MockParser());
            const freshResult = freshManager.parse(filePath, currentSource);
            
            // PROPERTY: Final result should match fresh parse
            expect(parseResultsAreEquivalent(finalResult, freshResult)).toBe(true);
            
            return true;
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
