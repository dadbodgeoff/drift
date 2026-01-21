import { describe, it, expect } from 'vitest';
import { HealthCalculator } from '../health-calculator.js';
import type { Gene, GeneId, Mutation } from '../types.js';

describe('HealthCalculator', () => {
  const calculator = new HealthCalculator();

  const createGene = (id: GeneId, consistency: number, confidence: number, alleles: { frequency: number; fileCount: number }[] = []): Gene => ({
    id,
    name: id,
    description: '',
    dominant: alleles.length > 0 ? { id: 'test', name: 'Test', description: '', frequency: alleles[0]?.frequency ?? 0, fileCount: alleles[0]?.fileCount ?? 0, pattern: '', examples: [], isDominant: true } : null,
    alleles: alleles.map((a, i) => ({ id: `allele-${i}`, name: `Allele ${i}`, description: '', frequency: a.frequency, fileCount: a.fileCount, pattern: '', examples: [], isDominant: i === 0 })),
    confidence,
    consistency,
    exemplars: [],
  });

  it('should return 0 for empty genes', () => {
    const genes = {} as Record<GeneId, Gene>;
    const score = calculator.calculateHealthScore(genes, []);
    expect(score).toBe(0);
  });

  it('should return high score for consistent codebase', () => {
    const genes: Record<GeneId, Gene> = {
      'variant-handling': createGene('variant-handling', 0.95, 0.9, [{ frequency: 0.9, fileCount: 10 }]),
      'responsive-approach': createGene('responsive-approach', 0.9, 0.85, [{ frequency: 0.85, fileCount: 10 }]),
      'state-styling': createGene('state-styling', 0.95, 0.9, [{ frequency: 0.9, fileCount: 10 }]),
      'theming': createGene('theming', 0.9, 0.85, [{ frequency: 0.85, fileCount: 10 }]),
      'spacing-philosophy': createGene('spacing-philosophy', 0.95, 0.9, [{ frequency: 0.9, fileCount: 10 }]),
      'animation-approach': createGene('animation-approach', 0.9, 0.85, [{ frequency: 0.85, fileCount: 10 }]),
    };
    const score = calculator.calculateHealthScore(genes, []);
    expect(score).toBeGreaterThan(70);
  });

  it('should penalize mutations', () => {
    const genes: Record<GeneId, Gene> = {
      'variant-handling': createGene('variant-handling', 0.9, 0.9, [{ frequency: 0.9, fileCount: 10 }]),
      'responsive-approach': createGene('responsive-approach', 0.9, 0.9, [{ frequency: 0.9, fileCount: 10 }]),
      'state-styling': createGene('state-styling', 0.9, 0.9, [{ frequency: 0.9, fileCount: 10 }]),
      'theming': createGene('theming', 0.9, 0.9, [{ frequency: 0.9, fileCount: 10 }]),
      'spacing-philosophy': createGene('spacing-philosophy', 0.9, 0.9, [{ frequency: 0.9, fileCount: 10 }]),
      'animation-approach': createGene('animation-approach', 0.9, 0.9, [{ frequency: 0.9, fileCount: 10 }]),
    };

    const scoreWithoutMutations = calculator.calculateHealthScore(genes, []);

    const mutations: Mutation[] = [
      { id: '1', file: 'a.tsx', line: 1, gene: 'variant-handling', expected: 'a', actual: 'b', impact: 'high', code: '', suggestion: '', detectedAt: '', resolved: false },
      { id: '2', file: 'b.tsx', line: 1, gene: 'variant-handling', expected: 'a', actual: 'b', impact: 'high', code: '', suggestion: '', detectedAt: '', resolved: false },
    ];
    const scoreWithMutations = calculator.calculateHealthScore(genes, mutations);

    expect(scoreWithMutations).toBeLessThan(scoreWithoutMutations);
  });

  it('should calculate genetic diversity', () => {
    const genesLowDiversity: Record<GeneId, Gene> = {
      'variant-handling': createGene('variant-handling', 0.9, 0.9, [{ frequency: 1, fileCount: 10 }]),
      'responsive-approach': createGene('responsive-approach', 0.9, 0.9, [{ frequency: 1, fileCount: 10 }]),
      'state-styling': createGene('state-styling', 0.9, 0.9, [{ frequency: 1, fileCount: 10 }]),
      'theming': createGene('theming', 0.9, 0.9, [{ frequency: 1, fileCount: 10 }]),
      'spacing-philosophy': createGene('spacing-philosophy', 0.9, 0.9, [{ frequency: 1, fileCount: 10 }]),
      'animation-approach': createGene('animation-approach', 0.9, 0.9, [{ frequency: 1, fileCount: 10 }]),
    };

    const genesHighDiversity: Record<GeneId, Gene> = {
      'variant-handling': createGene('variant-handling', 0.5, 0.5, [{ frequency: 0.5, fileCount: 5 }, { frequency: 0.5, fileCount: 5 }]),
      'responsive-approach': createGene('responsive-approach', 0.5, 0.5, [{ frequency: 0.5, fileCount: 5 }, { frequency: 0.5, fileCount: 5 }]),
      'state-styling': createGene('state-styling', 0.5, 0.5, [{ frequency: 0.5, fileCount: 5 }, { frequency: 0.5, fileCount: 5 }]),
      'theming': createGene('theming', 0.5, 0.5, [{ frequency: 0.5, fileCount: 5 }, { frequency: 0.5, fileCount: 5 }]),
      'spacing-philosophy': createGene('spacing-philosophy', 0.5, 0.5, [{ frequency: 0.5, fileCount: 5 }, { frequency: 0.5, fileCount: 5 }]),
      'animation-approach': createGene('animation-approach', 0.5, 0.5, [{ frequency: 0.5, fileCount: 5 }, { frequency: 0.5, fileCount: 5 }]),
    };

    const lowDiversity = calculator.calculateGeneticDiversity(genesLowDiversity);
    const highDiversity = calculator.calculateGeneticDiversity(genesHighDiversity);

    expect(lowDiversity).toBeLessThan(highDiversity);
  });

  it('should classify health levels correctly', () => {
    expect(calculator.getHealthLevel(95)).toBe('excellent');
    expect(calculator.getHealthLevel(80)).toBe('good');
    expect(calculator.getHealthLevel(60)).toBe('fair');
    expect(calculator.getHealthLevel(30)).toBe('poor');
  });
});
