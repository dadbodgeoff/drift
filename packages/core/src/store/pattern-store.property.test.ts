/**
 * Property-Based Tests for PatternStore - Pattern Round-Trip
 *
 * Property 1: Pattern Store Round-Trip
 * Serialize then deserialize SHALL produce equivalent Pattern
 * **Validates: Requirements 4.1, 4.5**
 *
 * @requirements 4.1 - THE Pattern_Store SHALL persist patterns as JSON in .drift/patterns/ directory
 * @requirements 4.5 - WHEN patterns are loaded, THE Pattern_Store SHALL validate against a JSON schema
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PatternStore } from './pattern-store.js';
import type {
  Pattern,
  PatternCategory,
  PatternStatus,
  ConfidenceLevel,
  Severity,
  DetectorType,
  ConfidenceInfo,
  PatternLocation,
  OutlierLocation,
  DetectorConfig,
  PatternMetadata,
} from './types.js';
import { PATTERN_CATEGORIES } from './types.js';

// ============================================================================
// Arbitraries for Pattern Generation
// ============================================================================

/**
 * Arbitrary for generating valid pattern IDs
 */
const patternIdArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), { minLength: 4, maxLength: 12 }),
    fc.nat({ max: 9999 })
  )
  .map(([prefix, suffix]) => `${prefix}-${suffix}`);

/**
 * Arbitrary for generating valid pattern categories
 */
const patternCategoryArb: fc.Arbitrary<PatternCategory> = fc.constantFrom(...PATTERN_CATEGORIES);

/**
 * Arbitrary for generating valid pattern statuses
 */
const patternStatusArb: fc.Arbitrary<PatternStatus> = fc.constantFrom('discovered', 'approved', 'ignored');

/**
 * Arbitrary for generating valid severity levels
 */
const severityArb: fc.Arbitrary<Severity> = fc.constantFrom('error', 'warning', 'info', 'hint');

/**
 * Arbitrary for generating valid confidence levels
 */
const confidenceLevelArb: fc.Arbitrary<ConfidenceLevel> = fc.constantFrom('high', 'medium', 'low', 'uncertain');

/**
 * Arbitrary for generating valid detector types
 */
const detectorTypeArb: fc.Arbitrary<DetectorType> = fc.constantFrom('ast', 'regex', 'semantic', 'structural', 'custom');

/**
 * Arbitrary for generating valid file paths
 */
const filePathArb = fc
  .tuple(
    fc.array(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 10 }), { minLength: 1, maxLength: 3 }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 3, maxLength: 15 }),
    fc.constantFrom('.ts', '.js', '.tsx', '.jsx', '.py', '.css', '.json')
  )
  .map(([dirs, filename, ext]) => [...dirs, `${filename}${ext}`].join('/'));

/**
 * Arbitrary for generating valid ISO date strings
 */
const isoDateArb = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map((d) => d.toISOString());

/**
 * Arbitrary for generating valid PatternLocation objects
 */
const patternLocationArb: fc.Arbitrary<PatternLocation> = fc.record({
  file: filePathArb,
  line: fc.integer({ min: 1, max: 10000 }),
  column: fc.integer({ min: 1, max: 500 }),
  endLine: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined }),
  endColumn: fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }),
}).map((loc) => {
  // Ensure endLine >= line if both are present
  if (loc.endLine !== undefined && loc.endLine < loc.line) {
    loc.endLine = loc.line + Math.abs(loc.endLine - loc.line);
  }
  return loc;
});

/**
 * Arbitrary for generating valid OutlierLocation objects
 */
const outlierLocationArb: fc.Arbitrary<OutlierLocation> = fc.record({
  file: filePathArb,
  line: fc.integer({ min: 1, max: 10000 }),
  column: fc.integer({ min: 1, max: 500 }),
  endLine: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined }),
  endColumn: fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }),
  reason: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '), { minLength: 5, maxLength: 100 }),
  deviationScore: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
}).map((loc) => {
  // Ensure endLine >= line if both are present
  if (loc.endLine !== undefined && loc.endLine < loc.line) {
    loc.endLine = loc.line + Math.abs(loc.endLine - loc.line);
  }
  return loc;
});

/**
 * Arbitrary for generating valid ConfidenceInfo objects
 * Ensures the level matches the score according to requirements
 */
const confidenceInfoArb: fc.Arbitrary<ConfidenceInfo> = fc
  .record({
    frequency: fc.double({ min: 0, max: 1, noNaN: true }),
    consistency: fc.double({ min: 0, max: 1, noNaN: true }),
    age: fc.integer({ min: 0, max: 365 }),
    spread: fc.integer({ min: 0, max: 1000 }),
    score: fc.double({ min: 0, max: 1, noNaN: true }),
  })
  .map((info) => {
    // Determine level based on score according to requirements
    let level: ConfidenceLevel;
    if (info.score >= 0.85) {
      level = 'high';
    } else if (info.score >= 0.65) {
      level = 'medium';
    } else if (info.score >= 0.45) {
      level = 'low';
    } else {
      level = 'uncertain';
    }
    return { ...info, level };
  });

/**
 * Arbitrary for generating valid DetectorConfig objects
 */
const detectorConfigArb: fc.Arbitrary<DetectorConfig> = fc
  .record({
    type: detectorTypeArb,
    config: fc.record({
      pattern: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
      flags: fc.option(fc.constantFrom('g', 'i', 'gi', 'm'), { nil: undefined }),
    }),
  })
  .map((detector) => {
    // Add type-specific config based on detector type
    const result: DetectorConfig = {
      type: detector.type,
      config: detector.config,
    };

    if (detector.type === 'regex') {
      result.regex = {
        pattern: '.*\\.test\\.ts$',
        flags: 'i',
      };
    } else if (detector.type === 'ast') {
      result.ast = {
        nodeType: 'FunctionDeclaration',
      };
    } else if (detector.type === 'structural') {
      result.structural = {
        pathPattern: '**/*.ts',
      };
    }

    return result;
  });

/**
 * Arbitrary for generating valid PatternMetadata objects
 */
const patternMetadataArb: fc.Arbitrary<PatternMetadata> = fc
  .record({
    firstSeen: isoDateArb,
    lastSeen: isoDateArb,
    approvedAt: fc.option(isoDateArb, { nil: undefined }),
    approvedBy: fc.option(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 3, maxLength: 20 }), { nil: undefined }),
    version: fc.option(fc.constantFrom('1.0.0', '1.1.0', '2.0.0'), { nil: undefined }),
    tags: fc.option(fc.array(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 10 }), { minLength: 0, maxLength: 5 }), { nil: undefined }),
    relatedPatterns: fc.option(fc.array(patternIdArb, { minLength: 0, maxLength: 3 }), { nil: undefined }),
    source: fc.option(fc.constantFrom('auto-detected', 'imported', 'cheatcode2026', 'manual'), { nil: undefined }),
  })
  .map((metadata) => {
    // Ensure lastSeen >= firstSeen
    const firstSeen = new Date(metadata.firstSeen);
    const lastSeen = new Date(metadata.lastSeen);
    if (lastSeen < firstSeen) {
      metadata.lastSeen = metadata.firstSeen;
    }
    return metadata;
  });

/**
 * Arbitrary for generating valid Pattern objects
 */
const patternArb: fc.Arbitrary<Pattern> = fc.record({
  id: patternIdArb,
  category: patternCategoryArb,
  subcategory: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-'), { minLength: 3, maxLength: 30 }),
  name: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ '), { minLength: 5, maxLength: 50 }),
  description: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,'), { minLength: 10, maxLength: 200 }),
  detector: detectorConfigArb,
  confidence: confidenceInfoArb,
  locations: fc.array(patternLocationArb, { minLength: 1, maxLength: 5 }),
  outliers: fc.array(outlierLocationArb, { minLength: 0, maxLength: 3 }),
  metadata: patternMetadataArb,
  severity: severityArb,
  autoFixable: fc.boolean(),
  status: patternStatusArb,
});

/**
 * Arbitrary for generating unique patterns (unique IDs)
 */
const uniquePatternsArb = (minLength: number, maxLength: number): fc.Arbitrary<Pattern[]> =>
  fc
    .array(patternArb, { minLength: Math.max(minLength, 1), maxLength })
    .map((patterns) => {
      // Ensure unique IDs by always appending index
      return patterns.map((p, i) => {
        // Always generate a unique ID based on index to ensure uniqueness
        const uniqueId = `${p.id}-idx${i}`;
        return { ...p, id: uniqueId };
      });
    });

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Deep equality check for patterns, handling floating point comparison
 */
function patternsAreEquivalent(original: Pattern, loaded: Pattern): boolean {
  // Check simple fields
  if (original.id !== loaded.id) return false;
  if (original.category !== loaded.category) return false;
  if (original.subcategory !== loaded.subcategory) return false;
  if (original.name !== loaded.name) return false;
  if (original.description !== loaded.description) return false;
  if (original.severity !== loaded.severity) return false;
  if (original.autoFixable !== loaded.autoFixable) return false;
  if (original.status !== loaded.status) return false;

  // Check confidence (with floating point tolerance)
  if (!confidenceIsEquivalent(original.confidence, loaded.confidence)) return false;

  // Check detector config
  if (!detectorConfigIsEquivalent(original.detector, loaded.detector)) return false;

  // Check locations
  if (!locationsAreEquivalent(original.locations, loaded.locations)) return false;

  // Check outliers
  if (!outliersAreEquivalent(original.outliers, loaded.outliers)) return false;

  // Check metadata
  if (!metadataIsEquivalent(original.metadata, loaded.metadata)) return false;

  return true;
}

/**
 * Check confidence info equivalence with floating point tolerance
 */
function confidenceIsEquivalent(a: ConfidenceInfo, b: ConfidenceInfo): boolean {
  const tolerance = 1e-10;
  return (
    Math.abs(a.frequency - b.frequency) < tolerance &&
    Math.abs(a.consistency - b.consistency) < tolerance &&
    a.age === b.age &&
    a.spread === b.spread &&
    Math.abs(a.score - b.score) < tolerance &&
    a.level === b.level
  );
}

/**
 * Check detector config equivalence
 */
function detectorConfigIsEquivalent(a: DetectorConfig, b: DetectorConfig): boolean {
  if (a.type !== b.type) return false;
  // Deep compare config objects
  return JSON.stringify(a.config) === JSON.stringify(b.config) &&
    JSON.stringify(a.ast) === JSON.stringify(b.ast) &&
    JSON.stringify(a.regex) === JSON.stringify(b.regex) &&
    JSON.stringify(a.structural) === JSON.stringify(b.structural) &&
    JSON.stringify(a.custom) === JSON.stringify(b.custom);
}

/**
 * Check locations array equivalence
 */
function locationsAreEquivalent(a: PatternLocation[], b: PatternLocation[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].file !== b[i].file ||
      a[i].line !== b[i].line ||
      a[i].column !== b[i].column ||
      a[i].endLine !== b[i].endLine ||
      a[i].endColumn !== b[i].endColumn
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Check outliers array equivalence
 */
function outliersAreEquivalent(a: OutlierLocation[], b: OutlierLocation[]): boolean {
  if (a.length !== b.length) return false;
  const tolerance = 1e-10;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].file !== b[i].file ||
      a[i].line !== b[i].line ||
      a[i].column !== b[i].column ||
      a[i].endLine !== b[i].endLine ||
      a[i].endColumn !== b[i].endColumn ||
      a[i].reason !== b[i].reason
    ) {
      return false;
    }
    // Check deviationScore with tolerance
    if (a[i].deviationScore !== undefined && b[i].deviationScore !== undefined) {
      if (Math.abs(a[i].deviationScore! - b[i].deviationScore!) >= tolerance) {
        return false;
      }
    } else if (a[i].deviationScore !== b[i].deviationScore) {
      return false;
    }
  }
  return true;
}

/**
 * Check metadata equivalence
 */
function metadataIsEquivalent(a: PatternMetadata, b: PatternMetadata): boolean {
  return (
    a.firstSeen === b.firstSeen &&
    a.lastSeen === b.lastSeen &&
    a.approvedAt === b.approvedAt &&
    a.approvedBy === b.approvedBy &&
    a.version === b.version &&
    JSON.stringify(a.tags) === JSON.stringify(b.tags) &&
    JSON.stringify(a.relatedPatterns) === JSON.stringify(b.relatedPatterns) &&
    a.source === b.source &&
    JSON.stringify(a.custom) === JSON.stringify(b.custom)
  );
}

// ============================================================================
// Property Tests
// ============================================================================

describe('PatternStore Property Tests', () => {
  /**
   * Property 1: Pattern Store Round-Trip
   * Serialize then deserialize SHALL produce equivalent Pattern
   * **Validates: Requirements 4.1, 4.5**
   */
  describe('Property 1: Pattern Store Round-Trip', () => {

    it('should preserve a single pattern through save and load cycle', async () => {
      await fc.assert(
        fc.asyncProperty(patternArb, async (pattern) => {
          // Create a fresh test directory for each iteration
          const iterTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-pbt-single-'));
          
          try {
            // Create a fresh store for each test iteration
            const store = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
            await store.initialize();

            try {
              // Add the pattern
              store.add(pattern);

              // Save to disk
              await store.saveAll();

              // Create a new store and load from disk
              const loadedStore = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
              await loadedStore.initialize();

              // PROPERTY: The loaded pattern SHALL exist
              expect(loadedStore.has(pattern.id)).toBe(true);

              // PROPERTY: The loaded pattern SHALL be equivalent to the original
              const loadedPattern = loadedStore.get(pattern.id);
              expect(loadedPattern).toBeDefined();
              expect(patternsAreEquivalent(pattern, loadedPattern!)).toBe(true);

              loadedStore.dispose();
            } finally {
              store.dispose();
            }
          } finally {
            // Clean up the iteration-specific test directory
            await fs.rm(iterTestDir, { recursive: true, force: true });
          }

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should preserve multiple patterns through save and load cycle', async () => {
      await fc.assert(
        fc.asyncProperty(uniquePatternsArb(2, 10), async (patterns) => {
          // Create a fresh test directory for each iteration
          const iterTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-pbt-multi-'));
          
          try {
            // Create a fresh store for each test iteration
            const store = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
            await store.initialize();

            try {
              // Add all patterns
              for (const pattern of patterns) {
                store.add(pattern);
              }

              // Save to disk
              await store.saveAll();

              // Create a new store and load from disk
              const loadedStore = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
              await loadedStore.initialize();

              // PROPERTY: All patterns SHALL be loaded
              expect(loadedStore.size).toBe(patterns.length);

              // PROPERTY: Each loaded pattern SHALL be equivalent to the original
              for (const original of patterns) {
                expect(loadedStore.has(original.id)).toBe(true);
                const loaded = loadedStore.get(original.id);
                expect(loaded).toBeDefined();
                expect(patternsAreEquivalent(original, loaded!)).toBe(true);
              }

              loadedStore.dispose();
            } finally {
              store.dispose();
            }
          } finally {
            // Clean up the iteration-specific test directory
            await fs.rm(iterTestDir, { recursive: true, force: true });
          }

          return true;
        }),
        { numRuns: 30 }
      );
    });

    it('should preserve patterns across different categories', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(patternCategoryArb, { minLength: 2, maxLength: 5 }),
          async (categories) => {
            // Create unique categories
            const uniqueCategories = [...new Set(categories)];
            if (uniqueCategories.length < 2) {
              return true; // Skip if not enough unique categories
            }

            // Create a fresh test directory for each iteration
            const iterTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-pbt-cat-'));
            
            try {
              // Create a fresh store for each test iteration
              const store = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
              await store.initialize();

              try {
                // Generate one pattern per category
                const patterns: Pattern[] = [];
                for (let i = 0; i < uniqueCategories.length; i++) {
                  const pattern = fc.sample(patternArb, 1)[0];
                  pattern.id = `cat-test-${i}-${Date.now()}`;
                  pattern.category = uniqueCategories[i];
                  patterns.push(pattern);
                  store.add(pattern);
                }

                // Save to disk
                await store.saveAll();

                // Create a new store and load from disk
                const loadedStore = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
                await loadedStore.initialize();

                // PROPERTY: Patterns from all categories SHALL be loaded
                for (const original of patterns) {
                  expect(loadedStore.has(original.id)).toBe(true);
                  const loaded = loadedStore.get(original.id);
                  expect(loaded).toBeDefined();
                  expect(loaded!.category).toBe(original.category);
                  expect(patternsAreEquivalent(original, loaded!)).toBe(true);
                }

                loadedStore.dispose();
              } finally {
                store.dispose();
              }
            } finally {
              // Clean up the iteration-specific test directory
              await fs.rm(iterTestDir, { recursive: true, force: true });
            }

            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should preserve patterns across different statuses', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(patternArb, patternArb, patternArb),
          async ([discovered, approved, ignored]) => {
            // Create a fresh test directory for each iteration
            const iterTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-pbt-status-'));
            
            try {
              // Create a fresh store for each test iteration
              const store = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
              await store.initialize();

              try {
                // Set unique IDs and statuses
                discovered.id = `discovered-${Date.now()}-1`;
                discovered.status = 'discovered';
                approved.id = `approved-${Date.now()}-2`;
                approved.status = 'approved';
                ignored.id = `ignored-${Date.now()}-3`;
                ignored.status = 'ignored';

                // Add all patterns
                store.add(discovered);
                store.add(approved);
                store.add(ignored);

                // Save to disk
                await store.saveAll();

                // Create a new store and load from disk
                const loadedStore = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
                await loadedStore.initialize();

                // PROPERTY: All patterns SHALL be loaded with correct statuses
                const loadedDiscovered = loadedStore.get(discovered.id);
                const loadedApproved = loadedStore.get(approved.id);
                const loadedIgnored = loadedStore.get(ignored.id);

                expect(loadedDiscovered).toBeDefined();
                expect(loadedDiscovered!.status).toBe('discovered');
                expect(patternsAreEquivalent(discovered, loadedDiscovered!)).toBe(true);

                expect(loadedApproved).toBeDefined();
                expect(loadedApproved!.status).toBe('approved');
                expect(patternsAreEquivalent(approved, loadedApproved!)).toBe(true);

                expect(loadedIgnored).toBeDefined();
                expect(loadedIgnored!.status).toBe('ignored');
                expect(patternsAreEquivalent(ignored, loadedIgnored!)).toBe(true);

                loadedStore.dispose();
              } finally {
                store.dispose();
              }
            } finally {
              // Clean up the iteration-specific test directory
              await fs.rm(iterTestDir, { recursive: true, force: true });
            }

            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should validate patterns against JSON schema on load', async () => {
      await fc.assert(
        fc.asyncProperty(patternArb, async (pattern) => {
          // Create a fresh test directory for each iteration
          const iterTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-pbt-schema-'));
          
          try {
            // Create a fresh store with schema validation enabled
            const store = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
            await store.initialize();

            try {
              // Add and save the pattern
              store.add(pattern);
              await store.saveAll();

              // Create a new store with schema validation enabled
              const loadedStore = new PatternStore({ rootDir: iterTestDir, validateSchema: true });

              // PROPERTY: Loading SHALL succeed (schema validation passes)
              // If schema validation fails, initialize() would throw
              await loadedStore.initialize();

              // PROPERTY: The loaded pattern SHALL be valid
              const loaded = loadedStore.get(pattern.id);
              expect(loaded).toBeDefined();

              loadedStore.dispose();
            } finally {
              store.dispose();
            }
          } finally {
            // Clean up the iteration-specific test directory
            await fs.rm(iterTestDir, { recursive: true, force: true });
          }

          return true;
        }),
        { numRuns: 30 }
      );
    });

    it('should preserve confidence score precision through round-trip', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          async (frequency, consistency, score) => {
            // Create a fresh test directory for each iteration
            const iterTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-pbt-precision-'));
            
            try {
              // Create a fresh store for each test iteration
              const store = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
              await store.initialize();

              try {
                // Create pattern with specific confidence values
                const pattern = fc.sample(patternArb, 1)[0];
                pattern.id = `precision-test-${Date.now()}`;
                pattern.confidence.frequency = frequency;
                pattern.confidence.consistency = consistency;
                pattern.confidence.score = score;
                // Update level based on score
                if (score >= 0.85) pattern.confidence.level = 'high';
                else if (score >= 0.65) pattern.confidence.level = 'medium';
                else if (score >= 0.45) pattern.confidence.level = 'low';
                else pattern.confidence.level = 'uncertain';

                store.add(pattern);
                await store.saveAll();

                // Load and verify
                const loadedStore = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
                await loadedStore.initialize();

                const loaded = loadedStore.get(pattern.id);
                expect(loaded).toBeDefined();

                // PROPERTY: Confidence values SHALL be preserved with high precision
                const tolerance = 1e-10;
                expect(Math.abs(loaded!.confidence.frequency - frequency)).toBeLessThan(tolerance);
                expect(Math.abs(loaded!.confidence.consistency - consistency)).toBeLessThan(tolerance);
                expect(Math.abs(loaded!.confidence.score - score)).toBeLessThan(tolerance);

                loadedStore.dispose();
              } finally {
                store.dispose();
              }
            } finally {
              // Clean up the iteration-specific test directory
              await fs.rm(iterTestDir, { recursive: true, force: true });
            }

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should preserve patterns with outliers through round-trip', async () => {
      await fc.assert(
        fc.asyncProperty(
          patternArb,
          fc.array(outlierLocationArb, { minLength: 1, maxLength: 5 }),
          async (pattern, outliers) => {
            // Create a fresh test directory for each iteration
            const iterTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-pbt-outliers-'));
            
            try {
              // Create a fresh store for each test iteration
              const store = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
              await store.initialize();

              try {
                // Set outliers on the pattern
                pattern.id = `outlier-test-${Date.now()}`;
                pattern.outliers = outliers;

                store.add(pattern);
                await store.saveAll();

                // Load and verify
                const loadedStore = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
                await loadedStore.initialize();

                const loaded = loadedStore.get(pattern.id);
                expect(loaded).toBeDefined();

                // PROPERTY: Outliers SHALL be preserved
                expect(loaded!.outliers.length).toBe(outliers.length);
                expect(outliersAreEquivalent(pattern.outliers, loaded!.outliers)).toBe(true);

                loadedStore.dispose();
              } finally {
                store.dispose();
              }
            } finally {
              // Clean up the iteration-specific test directory
              await fs.rm(iterTestDir, { recursive: true, force: true });
            }

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should preserve patterns with metadata through round-trip', async () => {
      await fc.assert(
        fc.asyncProperty(patternArb, patternMetadataArb, async (pattern, metadata) => {
          // Create a fresh test directory for each iteration
          const iterTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-pbt-metadata-'));
          
          try {
            // Create a fresh store for each test iteration
            const store = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
            await store.initialize();

            try {
              // Set metadata on the pattern
              pattern.id = `metadata-test-${Date.now()}`;
              pattern.metadata = metadata;

              store.add(pattern);
              await store.saveAll();

              // Load and verify
              const loadedStore = new PatternStore({ rootDir: iterTestDir, validateSchema: true });
              await loadedStore.initialize();

              const loaded = loadedStore.get(pattern.id);
              expect(loaded).toBeDefined();

              // PROPERTY: Metadata SHALL be preserved
              expect(metadataIsEquivalent(pattern.metadata, loaded!.metadata)).toBe(true);

              loadedStore.dispose();
            } finally {
              store.dispose();
            }
          } finally {
            // Clean up the iteration-specific test directory
            await fs.rm(iterTestDir, { recursive: true, force: true });
          }

          return true;
        }),
        { numRuns: 30 }
      );
    });
  });
});
