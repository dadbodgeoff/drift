/**
 * Property-Based Tests for VariantManager
 *
 * Property 8: Variant Exclusion
 * For any code location covered by an approved Variant, the Enforcement_System
 * SHALL NOT report a violation for that location.
 * **Validates: Requirements 26.4**
 *
 * @requirements 26.4 - WHEN a variant is created, THE Enforcement_System SHALL stop flagging matching code
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  VariantManager,
  type CreateVariantInput,
} from './variant-manager.js';

import type { PatternLocation, VariantScope } from '../store/types.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'variant-manager-property-test-'));
  return tempDir;
}

/**
 * Clean up a temporary directory
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Arbitraries for generating test data
// ============================================================================

/**
 * Arbitrary for generating valid variant scopes
 */
const scopeArb: fc.Arbitrary<VariantScope> = fc.constantFrom('global', 'directory', 'file');

/**
 * Arbitrary for generating valid file paths
 */
const filePathArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { minLength: 1, maxLength: 3 }),
    fc.stringMatching(/^[A-Z][a-zA-Z0-9]*$/),
    fc.constantFrom('.ts', '.tsx', '.js', '.jsx', '.py', '.css')
  )
  .map(([dirs, filename, ext]) => [...dirs, `${filename}${ext}`].join('/'));

/**
 * Arbitrary for generating valid directory paths
 */
const directoryPathArb: fc.Arbitrary<string> = fc
  .array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { minLength: 1, maxLength: 3 })
  .map((dirs) => dirs.join('/'));

/**
 * Arbitrary for generating valid pattern IDs
 */
const patternIdArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('structural', 'component', 'styling', 'api', 'auth', 'error'),
    fc.stringMatching(/^[a-z][a-z0-9-]*$/)
  )
  .map(([category, name]) => `${category}-${name}`);

/**
 * Arbitrary for generating valid pattern locations
 */
const patternLocationArb: fc.Arbitrary<PatternLocation> = fc.record({
  file: filePathArb,
  line: fc.integer({ min: 1, max: 10000 }),
  column: fc.integer({ min: 1, max: 500 }),
});

/**
 * Arbitrary for generating a location within a specific file
 */
const locationInFileArb = (filePath: string): fc.Arbitrary<PatternLocation> =>
  fc.record({
    file: fc.constant(filePath),
    line: fc.integer({ min: 1, max: 10000 }),
    column: fc.integer({ min: 1, max: 500 }),
  });

/**
 * Arbitrary for generating a location within a specific directory
 */
const locationInDirectoryArb = (dirPath: string): fc.Arbitrary<PatternLocation> =>
  fc
    .tuple(
      fc.stringMatching(/^[A-Z][a-zA-Z0-9]*$/),
      fc.constantFrom('.ts', '.tsx', '.js', '.jsx'),
      fc.integer({ min: 1, max: 10000 }),
      fc.integer({ min: 1, max: 500 })
    )
    .map(([filename, ext, line, column]) => ({
      file: `${dirPath}/${filename}${ext}`,
      line,
      column,
    }));

/**
 * Arbitrary for generating valid variant names
 */
const variantNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('Legacy', 'Custom', 'Special', 'Override', 'Exception'),
    fc.stringMatching(/^[A-Z][a-zA-Z0-9]*$/)
  )
  .map(([prefix, suffix]) => `${prefix} ${suffix}`);

/**
 * Arbitrary for generating valid variant reasons
 */
const variantReasonArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(
      'This is intentional because',
      'Legacy code that requires',
      'Special case for',
      'Exception needed for',
      'Override required due to'
    ),
    fc.stringMatching(/^[a-z][a-z0-9 ]*$/)
  )
  .map(([prefix, reason]) => `${prefix} ${reason}`);

/**
 * Arbitrary for generating a complete variant input with global scope
 */
const globalVariantInputArb: fc.Arbitrary<CreateVariantInput> = fc
  .tuple(patternIdArb, variantNameArb, variantReasonArb, patternLocationArb)
  .map(([patternId, name, reason, location]) => ({
    patternId,
    name,
    reason,
    scope: 'global' as VariantScope,
    scopeValue: undefined,
    locations: [location],
  }));

/**
 * Arbitrary for generating a complete variant input with directory scope
 */
const directoryVariantInputArb: fc.Arbitrary<CreateVariantInput> = fc
  .tuple(patternIdArb, variantNameArb, variantReasonArb, directoryPathArb)
  .chain(([patternId, name, reason, dirPath]) =>
    locationInDirectoryArb(dirPath).map((location) => ({
      patternId,
      name,
      reason,
      scope: 'directory' as VariantScope,
      scopeValue: dirPath,
      locations: [location],
    }))
  );

/**
 * Arbitrary for generating a complete variant input with file scope
 */
const fileVariantInputArb: fc.Arbitrary<CreateVariantInput> = fc
  .tuple(patternIdArb, variantNameArb, variantReasonArb, filePathArb)
  .map(([patternId, name, reason, filePath]) => ({
    patternId,
    name,
    reason,
    scope: 'file' as VariantScope,
    scopeValue: filePath,
    locations: [{ file: filePath, line: 1, column: 1 }],
  }));

/**
 * Arbitrary for generating any valid variant input
 */
const variantInputArb: fc.Arbitrary<CreateVariantInput> = fc.oneof(
  globalVariantInputArb,
  directoryVariantInputArb,
  fileVariantInputArb
);

// ============================================================================
// Property Tests
// ============================================================================

describe('VariantManager Property Tests', () => {
  let tempDir: string;
  let manager: VariantManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new VariantManager({ rootDir: tempDir });
    await manager.initialize();
  });

  afterEach(async () => {
    manager.dispose();
    await cleanupTempDir(tempDir);
  });

  /**
   * Property 8: Variant Exclusion
   * For any code location covered by an approved Variant, the Enforcement_System
   * SHALL NOT report a violation for that location.
   * **Validates: Requirements 26.4**
   */
  describe('Property 8: Variant Exclusion', () => {
    it('should cover any location when variant has global scope', async () => {
      await fc.assert(
        fc.asyncProperty(
          globalVariantInputArb,
          patternLocationArb,
          async (variantInput, testLocation) => {
            // Create a global variant
            const variant = manager.create(variantInput);

            // PROPERTY: Any location SHALL be covered by a global variant
            // for the same pattern ID
            const isCovered = manager.isLocationCovered(
              variantInput.patternId,
              testLocation
            );

            expect(isCovered).toBe(true);

            // Cleanup for next iteration
            manager.delete(variant.id);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should cover locations within directory when variant has directory scope', async () => {
      await fc.assert(
        fc.asyncProperty(directoryVariantInputArb, async (variantInput) => {
          // Create a directory-scoped variant
          const variant = manager.create(variantInput);
          const dirPath = variantInput.scopeValue!;

          // Generate a location within the directory
          const locationInDir: PatternLocation = {
            file: `${dirPath}/SomeFile.ts`,
            line: 42,
            column: 10,
          };

          // PROPERTY: Location within directory SHALL be covered
          const isCovered = manager.isLocationCovered(
            variantInput.patternId,
            locationInDir
          );

          expect(isCovered).toBe(true);

          // Cleanup for next iteration
          manager.delete(variant.id);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should NOT cover locations outside directory when variant has directory scope', async () => {
      await fc.assert(
        fc.asyncProperty(directoryVariantInputArb, async (variantInput) => {
          // Create a directory-scoped variant
          const variant = manager.create(variantInput);
          const dirPath = variantInput.scopeValue!;

          // Generate a location outside the directory
          const locationOutsideDir: PatternLocation = {
            file: `other-directory/SomeFile.ts`,
            line: 42,
            column: 10,
          };

          // Ensure the location is actually outside the directory
          if (!locationOutsideDir.file.startsWith(dirPath + '/')) {
            // PROPERTY: Location outside directory SHALL NOT be covered
            const isCovered = manager.isLocationCovered(
              variantInput.patternId,
              locationOutsideDir
            );

            expect(isCovered).toBe(false);
          }

          // Cleanup for next iteration
          manager.delete(variant.id);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should cover locations in the same file when variant has file scope', async () => {
      await fc.assert(
        fc.asyncProperty(
          fileVariantInputArb,
          fc.integer({ min: 1, max: 10000 }),
          fc.integer({ min: 1, max: 500 }),
          async (variantInput, line, column) => {
            // Create a file-scoped variant
            const variant = manager.create(variantInput);
            const filePath = variantInput.scopeValue!;

            // Generate a location in the same file (different line/column)
            const locationInFile: PatternLocation = {
              file: filePath,
              line,
              column,
            };

            // PROPERTY: Any location in the same file SHALL be covered
            const isCovered = manager.isLocationCovered(
              variantInput.patternId,
              locationInFile
            );

            expect(isCovered).toBe(true);

            // Cleanup for next iteration
            manager.delete(variant.id);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT cover locations in different files when variant has file scope', async () => {
      await fc.assert(
        fc.asyncProperty(fileVariantInputArb, filePathArb, async (variantInput, otherFile) => {
          // Create a file-scoped variant
          const variant = manager.create(variantInput);
          const variantFile = variantInput.scopeValue!;

          // Only test if the files are actually different
          if (otherFile !== variantFile) {
            const locationInOtherFile: PatternLocation = {
              file: otherFile,
              line: 42,
              column: 10,
            };

            // PROPERTY: Location in different file SHALL NOT be covered
            const isCovered = manager.isLocationCovered(
              variantInput.patternId,
              locationInOtherFile
            );

            expect(isCovered).toBe(false);
          }

          // Cleanup for next iteration
          manager.delete(variant.id);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should NOT cover locations for different pattern IDs', async () => {
      await fc.assert(
        fc.asyncProperty(
          variantInputArb,
          patternIdArb,
          patternLocationArb,
          async (variantInput, otherPatternId, location) => {
            // Create a variant
            const variant = manager.create(variantInput);

            // Only test if pattern IDs are different
            if (otherPatternId !== variantInput.patternId) {
              // PROPERTY: Location SHALL NOT be covered for different pattern ID
              const isCovered = manager.isLocationCovered(otherPatternId, location);

              expect(isCovered).toBe(false);
            }

            // Cleanup for next iteration
            manager.delete(variant.id);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT cover locations when variant is inactive', async () => {
      await fc.assert(
        fc.asyncProperty(globalVariantInputArb, patternLocationArb, async (variantInput, location) => {
          // Create a variant and then deactivate it
          const variant = manager.create(variantInput);
          manager.deactivate(variant.id);

          // PROPERTY: Inactive variant SHALL NOT cover any location
          const isCovered = manager.isLocationCovered(variantInput.patternId, location);

          expect(isCovered).toBe(false);

          // Cleanup for next iteration
          manager.delete(variant.id);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should resume coverage when variant is reactivated', async () => {
      await fc.assert(
        fc.asyncProperty(globalVariantInputArb, patternLocationArb, async (variantInput, location) => {
          // Create a variant
          const variant = manager.create(variantInput);

          // Verify initially covered
          expect(manager.isLocationCovered(variantInput.patternId, location)).toBe(true);

          // Deactivate
          manager.deactivate(variant.id);
          expect(manager.isLocationCovered(variantInput.patternId, location)).toBe(false);

          // Reactivate
          manager.activate(variant.id);

          // PROPERTY: Reactivated variant SHALL resume coverage
          const isCovered = manager.isLocationCovered(variantInput.patternId, location);

          expect(isCovered).toBe(true);

          // Cleanup for next iteration
          manager.delete(variant.id);

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should return the covering variant when location is covered', async () => {
      await fc.assert(
        fc.asyncProperty(globalVariantInputArb, patternLocationArb, async (variantInput, location) => {
          // Create a variant
          const variant = manager.create(variantInput);

          // PROPERTY: getCoveringVariant SHALL return the variant that covers the location
          const coveringVariant = manager.getCoveringVariant(
            variantInput.patternId,
            location
          );

          expect(coveringVariant).toBeDefined();
          expect(coveringVariant?.id).toBe(variant.id);
          expect(coveringVariant?.patternId).toBe(variantInput.patternId);

          // Cleanup for next iteration
          manager.delete(variant.id);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should return undefined when no variant covers the location', async () => {
      await fc.assert(
        fc.asyncProperty(patternIdArb, patternLocationArb, async (patternId, location) => {
          // No variants created

          // PROPERTY: getCoveringVariant SHALL return undefined when no variant covers
          const coveringVariant = manager.getCoveringVariant(patternId, location);

          expect(coveringVariant).toBeUndefined();

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should handle multiple variants for the same pattern correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fileVariantInputArb, { minLength: 2, maxLength: 5 }),
          async (variantInputs) => {
            // Ensure all variants have the same pattern ID
            const patternId = variantInputs[0].patternId;
            const normalizedInputs = variantInputs.map((input) => ({
              ...input,
              patternId,
            }));

            // Create all variants
            const variants = normalizedInputs.map((input) => manager.create(input));

            // For each variant, check that its file is covered
            for (let i = 0; i < variants.length; i++) {
              const filePath = normalizedInputs[i].scopeValue!;
              const location: PatternLocation = {
                file: filePath,
                line: 1,
                column: 1,
              };

              // PROPERTY: Each variant's file SHALL be covered
              const isCovered = manager.isLocationCovered(patternId, location);
              expect(isCovered).toBe(true);
            }

            // Cleanup
            for (const variant of variants) {
              manager.delete(variant.id);
            }

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should correctly handle specific location coverage with multiple locations', async () => {
      await fc.assert(
        fc.asyncProperty(
          patternIdArb,
          variantNameArb,
          variantReasonArb,
          filePathArb,
          fc.array(
            fc.tuple(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 1, max: 100 })),
            { minLength: 2, maxLength: 5 }
          ),
          async (patternId, name, reason, filePath, lineColumns) => {
            // Create locations from line/column pairs
            const locations: PatternLocation[] = lineColumns.map(([line, column]) => ({
              file: filePath,
              line,
              column,
            }));

            // Create a variant with multiple specific locations
            const variant = manager.create({
              patternId,
              name,
              reason,
              scope: 'file',
              scopeValue: filePath,
              locations,
            });

            // PROPERTY: Each specified location SHALL be covered
            for (const loc of locations) {
              const isCovered = manager.isLocationCovered(patternId, loc);
              expect(isCovered).toBe(true);
            }

            // PROPERTY: A location NOT in the list SHALL NOT be covered
            // (when variant has multiple locations, only those specific locations are covered)
            const uncoveredLocation: PatternLocation = {
              file: filePath,
              line: 99999, // Very unlikely to match
              column: 99999,
            };

            // Only check if this location is not in the list
            const isInList = locations.some(
              (loc) => loc.line === uncoveredLocation.line && loc.column === uncoveredLocation.column
            );

            if (!isInList) {
              const isCovered = manager.isLocationCovered(patternId, uncoveredLocation);
              expect(isCovered).toBe(false);
            }

            // Cleanup
            manager.delete(variant.id);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should maintain coverage after save and reload', async () => {
      await fc.assert(
        fc.asyncProperty(globalVariantInputArb, patternLocationArb, async (variantInput, location) => {
          // Create a variant
          const variant = manager.create(variantInput);

          // Save to disk
          await manager.saveAll();

          // Create a new manager and load
          const newManager = new VariantManager({ rootDir: tempDir });
          await newManager.initialize();

          // PROPERTY: Coverage SHALL persist after save and reload
          const isCovered = newManager.isLocationCovered(variantInput.patternId, location);

          expect(isCovered).toBe(true);

          // Verify the variant was loaded correctly
          const loadedVariant = newManager.get(variant.id);
          expect(loadedVariant).toBeDefined();
          expect(loadedVariant?.patternId).toBe(variantInput.patternId);
          expect(loadedVariant?.active).toBe(true);

          // Cleanup
          newManager.dispose();
          manager.delete(variant.id);

          return true;
        }),
        { numRuns: 20 }
      );
    });
  });
});
