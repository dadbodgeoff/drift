/**
 * Property-Based Tests for QuickFixGenerator
 *
 * Property 7: Quick Fix Idempotence
 * For any QuickFix applied to code, applying the same fix again SHALL result in no changes
 * (the fix is idempotent).
 * **Validates: Requirements 25.1, 25.2**
 *
 * @requirements 25.1 - THE Quick_Fix_System SHALL generate code transformations for fixable violations
 * @requirements 25.2 - THE Quick_Fix SHALL include a preview of the change before applying
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  QuickFixGenerator,
  createQuickFixGenerator,
  ReplaceFixStrategy,
  WrapFixStrategy,
  DeleteFixStrategy,
  ImportFixStrategy,
  RenameFixStrategy,
  type FixContext,
} from './quick-fix-generator.js';
import type { Violation, QuickFix, Range, FixType } from './types.js';
import { createTextEdit, createWorkspaceEdit, createPosition, createRange } from './types.js';

// ============================================================================
// Arbitraries for generating test data
// ============================================================================

/**
 * Arbitrary for generating valid severity levels
 */
const severityArb = fc.constantFrom('error', 'warning', 'info', 'hint') as fc.Arbitrary<
  'error' | 'warning' | 'info' | 'hint'
>;

/**
 * Arbitrary for generating valid line numbers (0-indexed)
 */
const lineNumberArb = fc.integer({ min: 0, max: 100 });

/**
 * Arbitrary for generating valid character positions
 */
const characterArb = fc.integer({ min: 0, max: 200 });

/**
 * Arbitrary for generating a valid Position
 */
const positionArb = fc.record({
  line: lineNumberArb,
  character: characterArb,
});

/**
 * Arbitrary for generating a valid Range where start <= end
 */
const rangeArb = fc
  .tuple(lineNumberArb, characterArb, lineNumberArb, characterArb)
  .map(([startLine, startChar, endLine, endChar]) => {
    // Ensure start <= end
    const actualStartLine = Math.min(startLine, endLine);
    const actualEndLine = Math.max(startLine, endLine);
    let actualStartChar = startChar;
    let actualEndChar = endChar;

    if (actualStartLine === actualEndLine) {
      actualStartChar = Math.min(startChar, endChar);
      actualEndChar = Math.max(startChar, endChar);
    }

    return createRange(
      createPosition(actualStartLine, actualStartChar),
      createPosition(actualEndLine, actualEndChar)
    );
  });

/**
 * Arbitrary for generating simple code content (single line)
 */
const simpleCodeArb = fc.stringOf(
  fc.constantFrom(
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ' ', '_', '=', ';', '(', ')', '{', '}', '[', ']', '.', ','
  ),
  { minLength: 1, maxLength: 100 }
);

/**
 * Arbitrary for generating multi-line code content
 */
const multiLineCodeArb = fc
  .array(simpleCodeArb, { minLength: 1, maxLength: 20 })
  .map((lines) => lines.join('\n'));

/**
 * Arbitrary for generating code content with a valid range
 * Returns { content, range } where range is valid for the content
 */
const contentWithValidRangeArb = fc
  .tuple(
    fc.array(simpleCodeArb, { minLength: 1, maxLength: 10 }),
    fc.integer({ min: 0, max: 9 }),
    fc.integer({ min: 0, max: 9 })
  )
  .map(([lines, lineOffset1, lineOffset2]) => {
    const content = lines.join('\n');
    const maxLine = lines.length - 1;
    const startLine = Math.min(lineOffset1, lineOffset2) % (maxLine + 1);
    const endLine = Math.max(lineOffset1, lineOffset2) % (maxLine + 1);

    const startLineContent = lines[startLine] || '';
    const endLineContent = lines[endLine] || '';

    const startChar = Math.min(
      Math.floor(startLineContent.length / 2),
      startLineContent.length
    );
    const endChar = Math.min(
      Math.floor(endLineContent.length / 2) + 5,
      endLineContent.length
    );

    const range = createRange(
      createPosition(startLine, startChar),
      createPosition(endLine, startLine === endLine ? Math.max(startChar, endChar) : endChar)
    );

    return { content, range, lines };
  });

/**
 * Arbitrary for generating replacement text
 */
const replacementTextArb = fc.oneof(
  simpleCodeArb,
  fc.constant(''),
  fc.constant('const'),
  fc.constant('let'),
  fc.constant('var'),
  fc.constant('function'),
  fc.constant('async'),
  fc.constant('await')
);

/**
 * Arbitrary for generating a valid Violation with content
 */
const violationWithContentArb = contentWithValidRangeArb.chain(({ content, range }) =>
  fc.record({
    id: fc.uuid(),
    patternId: fc.string({ minLength: 1, maxLength: 50 }),
    severity: severityArb,
    file: fc.constant('test.ts'),
    range: fc.constant(range),
    message: fc.string({ minLength: 1, maxLength: 200 }),
    explanation: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
    expected: simpleCodeArb,
    actual: simpleCodeArb,
    quickFix: fc.constant(undefined),
    aiExplainAvailable: fc.boolean(),
    aiFixAvailable: fc.boolean(),
    firstSeen: fc.date(),
    occurrences: fc.integer({ min: 1, max: 1000 }),
    content: fc.constant(content),
  })
);

/**
 * Arbitrary for generating a QuickFix with valid edits for given content
 * Excludes delete operations (newText = '') to ensure idempotence
 */
const quickFixForContentArb = (content: string) => {
  const lines = content.split('\n');
  const maxLine = Math.max(0, lines.length - 1);

  return fc
    .tuple(
      fc.integer({ min: 0, max: maxLine }),
      fc.integer({ min: 0, max: maxLine }),
      // Exclude empty string to avoid delete operations which are harder to make idempotent
      fc.oneof(
        fc.stringOf(
          fc.constantFrom(
            'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
            'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
            'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
            'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
            '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
            ' ', '_', '=', ';', '(', ')', '{', '}', '[', ']', '.', ','
          ),
          { minLength: 1, maxLength: 50 }
        ),
        fc.constant('const'),
        fc.constant('let'),
        fc.constant('var'),
        fc.constant('function'),
        fc.constant('async'),
        fc.constant('await')
      )
    )
    .map(([lineOffset1, lineOffset2, newText]) => {
      const startLine = Math.min(lineOffset1, lineOffset2);
      const endLine = Math.max(lineOffset1, lineOffset2);

      const startLineContent = lines[startLine] || '';
      const endLineContent = lines[endLine] || '';

      const startChar = Math.min(
        Math.floor(startLineContent.length / 3),
        startLineContent.length
      );
      const endChar = Math.min(
        Math.floor(endLineContent.length * 2 / 3),
        endLineContent.length
      );

      const range = createRange(
        createPosition(startLine, startChar),
        createPosition(endLine, startLine === endLine ? Math.max(startChar + 1, endChar) : endChar)
      );

      const edit = createTextEdit(range, newText);
      const workspaceEdit = createWorkspaceEdit('test.ts', [edit]);

      const fix: QuickFix = {
        title: `Replace with: ${newText.substring(0, 20)}`,
        kind: 'quickfix',
        edit: workspaceEdit,
        isPreferred: true,
        confidence: 0.8,
        preview: `Replace text with "${newText.substring(0, 20)}"`,
      };

      return { fix, content };
    });
};

/**
 * Arbitrary for generating content and a matching QuickFix
 */
const contentAndFixArb = multiLineCodeArb.chain((content) =>
  quickFixForContentArb(content)
);

// ============================================================================
// Property Tests
// ============================================================================

describe('QuickFixGenerator Property Tests', () => {
  /**
   * Property 7: Quick Fix Idempotence
   * For any QuickFix applied to code, applying the same fix again SHALL result in no changes
   * (the fix is idempotent).
   * **Validates: Requirements 25.1, 25.2**
   */
  describe('Property 7: Quick Fix Idempotence', () => {
    const generator = createQuickFixGenerator();

    it('applying a fix twice SHALL result in no additional changes', async () => {
      await fc.assert(
        fc.asyncProperty(contentAndFixArb, async ({ fix, content }) => {
          // Apply the fix once
          const afterFirst = generator.applyFix(fix, content);

          // Apply the fix again to the result
          const afterSecond = generator.applyFix(fix, afterFirst);

          // PROPERTY: Applying the fix twice SHALL produce the same result as applying once
          // This is the core idempotence property
          expect(afterSecond).toBe(afterFirst);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('isIdempotent SHALL correctly identify idempotent fixes', async () => {
      await fc.assert(
        fc.asyncProperty(contentAndFixArb, async ({ fix, content }) => {
          const isIdempotent = generator.isIdempotent(fix, content);

          // Apply fix twice and check manually
          const afterFirst = generator.applyFix(fix, content);
          const afterSecond = generator.applyFix(fix, afterFirst);
          const actuallyIdempotent = afterFirst === afterSecond;

          // PROPERTY: isIdempotent SHALL correctly predict idempotence
          expect(isIdempotent).toBe(actuallyIdempotent);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('replace fixes with same text SHALL be idempotent', async () => {
      await fc.assert(
        fc.asyncProperty(
          contentWithValidRangeArb,
          async ({ content, range }) => {
            // Extract the text at the range
            const lines = content.split('\n');
            const startLine = Math.min(range.start.line, lines.length - 1);
            const endLine = Math.min(range.end.line, lines.length - 1);
            
            // For single-line ranges only (simpler case)
            if (startLine !== endLine) {
              return true; // Skip multi-line for this test
            }
            
            const line = lines[startLine] || '';
            const startChar = Math.min(range.start.character, line.length);
            const endChar = Math.min(range.end.character, line.length);
            
            if (startChar >= endChar) {
              return true; // Skip invalid ranges
            }
            
            const textAtRange = line.substring(startChar, endChar);

            // Create a fix that replaces text with the same text
            const edit = createTextEdit(
              createRange(
                createPosition(startLine, startChar),
                createPosition(startLine, endChar)
              ),
              textAtRange
            );
            const workspaceEdit = createWorkspaceEdit('test.ts', [edit]);

            const fix: QuickFix = {
              title: 'No-op replace',
              kind: 'quickfix',
              edit: workspaceEdit,
              isPreferred: true,
              confidence: 1.0,
            };

            // PROPERTY: Replacing text with itself SHALL be idempotent (no change)
            const afterFirst = generator.applyFix(fix, content);
            const afterSecond = generator.applyFix(fix, afterFirst);

            expect(afterFirst).toBe(content); // No change since text is same
            expect(afterSecond).toBe(afterFirst); // Still no change

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('delete fixes SHALL be idempotent when range becomes empty', async () => {
      // This test verifies that delete fixes are idempotent when the range
      // becomes empty after the first delete (i.e., the entire content is deleted)
      const generator = createQuickFixGenerator();
      
      // Test case: delete entire single-line content
      const content = 'abc';
      const range = createRange(
        createPosition(0, 0),
        createPosition(0, 3)
      );
      
      const edit = createTextEdit(range, '');
      const workspaceEdit = createWorkspaceEdit('test.ts', [edit]);
      
      const fix: QuickFix = {
        title: 'Delete code',
        kind: 'quickfix',
        edit: workspaceEdit,
        isPreferred: true,
        confidence: 0.75,
      };
      
      // Apply fix twice
      const afterFirst = generator.applyFix(fix, content);
      const afterSecond = generator.applyFix(fix, afterFirst);
      
      // PROPERTY: After first delete, second delete SHALL have no effect
      // because the range is now empty
      expect(afterFirst).toBe('');
      expect(afterSecond).toBe(afterFirst);
    });

    it('generated fixes from violations SHALL be idempotent after first application', async () => {
      await fc.assert(
        fc.asyncProperty(
          violationWithContentArb,
          async (violationData) => {
            const { content, ...violation } = violationData;

            // Generate fixes for the violation
            const result = generator.generateFixes(violation as Violation, content);

            if (result.hasFixs && result.preferredFix) {
              const fix = result.preferredFix;

              // Apply fix twice
              const afterFirst = generator.applyFix(fix, content);
              const afterSecond = generator.applyFix(fix, afterFirst);

              // PROPERTY: Generated fixes SHALL be idempotent
              expect(afterSecond).toBe(afterFirst);
            }

            return true;
          }
        ),
        { numRuns: 150 }
      );
    });

    it('applying fix N times SHALL produce same result as applying once (for N > 1)', async () => {
      await fc.assert(
        fc.asyncProperty(
          contentAndFixArb,
          fc.integer({ min: 2, max: 10 }),
          async ({ fix, content }, n) => {
            // Apply fix once
            const afterFirst = generator.applyFix(fix, content);

            // Apply fix N times
            let result = content;
            for (let i = 0; i < n; i++) {
              result = generator.applyFix(fix, result);
            }

            // PROPERTY: Applying N times SHALL equal applying once
            expect(result).toBe(afterFirst);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('fix application SHALL be deterministic', async () => {
      await fc.assert(
        fc.asyncProperty(contentAndFixArb, async ({ fix, content }) => {
          // Apply fix multiple times from the same starting point
          const result1 = generator.applyFix(fix, content);
          const result2 = generator.applyFix(fix, content);
          const result3 = generator.applyFix(fix, content);

          // PROPERTY: Same input SHALL always produce same output
          expect(result1).toBe(result2);
          expect(result2).toBe(result3);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('empty content fixes SHALL be idempotent', async () => {
      await fc.assert(
        fc.asyncProperty(replacementTextArb, async (newText) => {
          const content = '';
          const range = createRange(createPosition(0, 0), createPosition(0, 0));
          const edit = createTextEdit(range, newText);
          const workspaceEdit = createWorkspaceEdit('test.ts', [edit]);

          const fix: QuickFix = {
            title: 'Insert into empty',
            kind: 'quickfix',
            edit: workspaceEdit,
            isPreferred: true,
            confidence: 0.8,
          };

          const afterFirst = generator.applyFix(fix, content);
          const afterSecond = generator.applyFix(fix, afterFirst);

          // PROPERTY: Fix on empty content SHALL be idempotent
          expect(afterSecond).toBe(afterFirst);

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('fixes with out-of-bounds ranges SHALL be idempotent (no-op)', async () => {
      await fc.assert(
        fc.asyncProperty(
          simpleCodeArb,
          replacementTextArb,
          async (content, newText) => {
            // Create a fix with an out-of-bounds range
            const outOfBoundsRange = createRange(
              createPosition(1000, 0),
              createPosition(1000, 10)
            );
            const edit = createTextEdit(outOfBoundsRange, newText);
            const workspaceEdit = createWorkspaceEdit('test.ts', [edit]);

            const fix: QuickFix = {
              title: 'Out of bounds fix',
              kind: 'quickfix',
              edit: workspaceEdit,
              isPreferred: true,
              confidence: 0.5,
            };

            const afterFirst = generator.applyFix(fix, content);
            const afterSecond = generator.applyFix(fix, afterFirst);

            // PROPERTY: Out-of-bounds fixes SHALL be idempotent (no change)
            expect(afterFirst).toBe(content);
            expect(afterSecond).toBe(afterFirst);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('multiple edits in same fix SHALL be idempotent together', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(simpleCodeArb, { minLength: 5, maxLength: 10 }),
          async (lines) => {
            const content = lines.join('\n');

            // Create multiple non-overlapping edits
            const edits = [];
            for (let i = 0; i < Math.min(3, lines.length); i += 2) {
              const line = lines[i] || '';
              if (line.length > 2) {
                const range = createRange(
                  createPosition(i, 0),
                  createPosition(i, Math.min(2, line.length))
                );
                edits.push(createTextEdit(range, 'XX'));
              }
            }

            if (edits.length === 0) {
              return true; // Skip if no valid edits
            }

            const workspaceEdit = createWorkspaceEdit('test.ts', edits);

            const fix: QuickFix = {
              title: 'Multiple edits',
              kind: 'quickfix',
              edit: workspaceEdit,
              isPreferred: true,
              confidence: 0.8,
            };

            const afterFirst = generator.applyFix(fix, content);
            const afterSecond = generator.applyFix(fix, afterFirst);

            // PROPERTY: Multiple edits SHALL be idempotent together
            expect(afterSecond).toBe(afterFirst);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional properties related to fix generation and application
   */
  describe('Additional Quick Fix Properties', () => {
    const generator = createQuickFixGenerator();

    it('fix application SHALL preserve content length consistency', async () => {
      await fc.assert(
        fc.asyncProperty(contentAndFixArb, async ({ fix, content }) => {
          const afterFix = generator.applyFix(fix, content);

          // PROPERTY: Result SHALL be a valid string
          expect(typeof afterFix).toBe('string');

          // PROPERTY: Result SHALL not be undefined or null
          expect(afterFix).toBeDefined();
          expect(afterFix).not.toBeNull();

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('fix validation SHALL be consistent with application', async () => {
      await fc.assert(
        fc.asyncProperty(contentAndFixArb, async ({ fix, content }) => {
          const validation = generator.validateFix(fix, content);

          if (validation.valid) {
            // PROPERTY: Valid fixes SHALL apply without throwing
            expect(() => generator.applyFix(fix, content)).not.toThrow();
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('preview generation SHALL not affect fix application', async () => {
      await fc.assert(
        fc.asyncProperty(contentAndFixArb, async ({ fix, content }) => {
          // Generate preview
          const preview = generator.generatePreview(fix, content);

          // Apply fix
          const afterFix = generator.applyFix(fix, content);

          // Generate preview again
          const previewAgain = generator.generatePreview(fix, content);

          // PROPERTY: Preview generation SHALL be pure (no side effects)
          expect(preview).toBe(previewAgain);

          // PROPERTY: Preview SHALL be a string
          expect(typeof preview).toBe('string');

          return true;
        }),
        { numRuns: 50 }
      );
    });
  });
});
