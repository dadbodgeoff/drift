import { describe, it, expect } from 'vitest';
import { DNA_VERSION, GENE_IDS, FRONTEND_GENE_IDS, BACKEND_GENE_IDS, DEFAULT_DNA_THRESHOLDS, DEFAULT_DNA_STORE_CONFIG, type GeneId, type StylingFramework, type MutationImpact, type StylingDNAProfile, type Gene, type Allele, type Mutation } from '../types.js';

describe('DNA Types', () => {
  describe('Constants', () => {
    it('should have correct DNA version', () => {
      expect(DNA_VERSION).toBe('1.0.0');
    });

    it('should have all 10 gene IDs (6 frontend + 4 backend)', () => {
      expect(GENE_IDS).toHaveLength(10);
      // Frontend genes
      expect(GENE_IDS).toContain('variant-handling');
      expect(GENE_IDS).toContain('responsive-approach');
      expect(GENE_IDS).toContain('state-styling');
      expect(GENE_IDS).toContain('theming');
      expect(GENE_IDS).toContain('spacing-philosophy');
      expect(GENE_IDS).toContain('animation-approach');
      // Backend genes
      expect(GENE_IDS).toContain('api-response-format');
      expect(GENE_IDS).toContain('error-response-format');
      expect(GENE_IDS).toContain('logging-format');
      expect(GENE_IDS).toContain('config-pattern');
    });

    it('should have 6 frontend gene IDs', () => {
      expect(FRONTEND_GENE_IDS).toHaveLength(6);
    });

    it('should have 4 backend gene IDs', () => {
      expect(BACKEND_GENE_IDS).toHaveLength(4);
    });

    it('should have valid default thresholds', () => {
      expect(DEFAULT_DNA_THRESHOLDS.dominantMinFrequency).toBeGreaterThan(0);
      expect(DEFAULT_DNA_THRESHOLDS.dominantMinFrequency).toBeLessThanOrEqual(1);
      expect(DEFAULT_DNA_THRESHOLDS.healthScoreWarning).toBeGreaterThan(DEFAULT_DNA_THRESHOLDS.healthScoreCritical);
    });

    it('should have valid default store config', () => {
      expect(DEFAULT_DNA_STORE_CONFIG.rootDir).toBe('.');
      expect(DEFAULT_DNA_STORE_CONFIG.componentPaths.length).toBeGreaterThan(0);
      expect(DEFAULT_DNA_STORE_CONFIG.backendPaths?.length).toBeGreaterThan(0);
      expect(DEFAULT_DNA_STORE_CONFIG.thresholds).toEqual(DEFAULT_DNA_THRESHOLDS);
    });
  });

  describe('Type Validation', () => {
    it('should validate GeneId type', () => {
      const validGeneIds: GeneId[] = ['variant-handling', 'responsive-approach', 'state-styling', 'theming', 'spacing-philosophy', 'animation-approach'];
      for (const id of validGeneIds) expect(GENE_IDS).toContain(id);
    });

    it('should validate StylingFramework type', () => {
      const validFrameworks: StylingFramework[] = ['tailwind', 'css-modules', 'styled-components', 'emotion', 'vanilla-css', 'scss', 'mixed'];
      expect(validFrameworks).toHaveLength(7);
    });

    it('should validate MutationImpact type', () => {
      const validImpacts: MutationImpact[] = ['low', 'medium', 'high'];
      expect(validImpacts).toHaveLength(3);
    });
  });

  describe('Schema Validation', () => {
    it('should validate StylingDNAProfile schema', () => {
      const profile: StylingDNAProfile = {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        projectRoot: '/test',
        summary: { totalComponentsAnalyzed: 10, totalFilesAnalyzed: 20, healthScore: 85, geneticDiversity: 0.2, dominantFramework: 'tailwind', lastUpdated: new Date().toISOString() },
        genes: {} as Record<GeneId, Gene>,
        mutations: [],
        evolution: [],
      };
      expect(profile.version).toBe('1.0.0');
      expect(profile.summary.healthScore).toBeGreaterThanOrEqual(0);
      expect(profile.summary.healthScore).toBeLessThanOrEqual(100);
    });

    it('should validate Gene schema', () => {
      const gene: Gene = { id: 'variant-handling', name: 'Variant Handling', description: 'How variants are handled', dominant: null, alleles: [], confidence: 0.9, consistency: 0.85, exemplars: [] };
      expect(gene.id).toBe('variant-handling');
      expect(gene.confidence).toBeGreaterThanOrEqual(0);
      expect(gene.confidence).toBeLessThanOrEqual(1);
    });

    it('should validate Allele schema', () => {
      const allele: Allele = { id: 'classname-composition', name: 'className Composition', description: 'Using variant objects', frequency: 0.8, fileCount: 10, pattern: '/variants/', examples: [], isDominant: true };
      expect(allele.frequency).toBeGreaterThanOrEqual(0);
      expect(allele.frequency).toBeLessThanOrEqual(1);
    });

    it('should validate Mutation schema', () => {
      const mutation: Mutation = { id: 'mut-123', file: 'src/Button.tsx', line: 10, gene: 'variant-handling', expected: 'classname-composition', actual: 'inline-styles', impact: 'high', code: 'const style = {}', suggestion: 'Use className composition', detectedAt: new Date().toISOString(), resolved: false };
      expect(mutation.gene).toBe('variant-handling');
      expect(['low', 'medium', 'high']).toContain(mutation.impact);
    });
  });
});
