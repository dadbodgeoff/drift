/**
 * Health Calculator
 *
 * Calculates the health score and genetic diversity metrics for a DNA profile.
 */

import { DEFAULT_DNA_THRESHOLDS } from './types.js';

import type { Gene, GeneId, Mutation, DNAThresholds } from './types.js';

export class HealthCalculator {
  private readonly thresholds: DNAThresholds;

  constructor(thresholds: Partial<DNAThresholds> = {}) {
    this.thresholds = { ...DEFAULT_DNA_THRESHOLDS, ...thresholds };
  }

  calculateHealthScore(genes: Record<GeneId, Gene>, mutations: Mutation[]): number {
    const geneArray = Object.values(genes);
    if (geneArray.length === 0) {return 0;}

    const avgConsistency = this.calculateAverageConsistency(geneArray);
    const consistencyScore = avgConsistency * 40;

    const avgConfidence = this.calculateAverageConfidence(geneArray);
    const confidenceScore = avgConfidence * 30;

    const mutationPenalty = this.calculateMutationPenalty(mutations, geneArray);
    const mutationScore = (1 - mutationPenalty) * 20;

    const dominantCoverage = this.calculateDominantCoverage(geneArray);
    const coverageScore = dominantCoverage * 10;

    const totalScore = consistencyScore + confidenceScore + mutationScore + coverageScore;
    return Math.round(Math.max(0, Math.min(100, totalScore)));
  }

  calculateGeneticDiversity(genes: Record<GeneId, Gene>): number {
    const geneArray = Object.values(genes);
    if (geneArray.length === 0) {return 0;}

    let totalDiversity = 0;
    for (const gene of geneArray) {
      const alleleCount = gene.alleles.length;
      if (alleleCount <= 1) {
        totalDiversity += 0;
      } else {
        const frequencies = gene.alleles.map(a => a.frequency);
        const entropy = this.calculateEntropy(frequencies);
        const maxEntropy = Math.log2(alleleCount);
        totalDiversity += maxEntropy > 0 ? entropy / maxEntropy : 0;
      }
    }
    return Math.round((totalDiversity / geneArray.length) * 100) / 100;
  }

  private calculateAverageConsistency(genes: Gene[]): number {
    if (genes.length === 0) {return 0;}
    return genes.reduce((sum, gene) => sum + gene.consistency, 0) / genes.length;
  }

  private calculateAverageConfidence(genes: Gene[]): number {
    if (genes.length === 0) {return 0;}
    return genes.reduce((sum, gene) => sum + gene.confidence, 0) / genes.length;
  }

  private calculateMutationPenalty(mutations: Mutation[], genes: Gene[]): number {
    if (mutations.length === 0) {return 0;}

    let totalFiles = 0;
    for (const gene of genes) {
      for (const allele of gene.alleles) {
        totalFiles += allele.fileCount;
      }
    }
    if (totalFiles === 0) {return 0;}

    let weightedMutations = 0;
    for (const mutation of mutations) {
      switch (mutation.impact) {
        case 'high': weightedMutations += 3; break;
        case 'medium': weightedMutations += 2; break;
        case 'low': weightedMutations += 1; break;
      }
    }
    return Math.min(1, weightedMutations / (totalFiles * 0.5));
  }

  private calculateDominantCoverage(genes: Gene[]): number {
    if (genes.length === 0) {return 0;}
    const genesWithDominant = genes.filter(
      gene => gene.dominant !== null && gene.dominant.frequency >= this.thresholds.dominantMinFrequency
    );
    return genesWithDominant.length / genes.length;
  }

  private calculateEntropy(frequencies: number[]): number {
    let entropy = 0;
    for (const freq of frequencies) {
      if (freq > 0) {entropy -= freq * Math.log2(freq);}
    }
    return entropy;
  }

  getHealthLevel(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
    if (score >= 90) {return 'excellent';}
    if (score >= 70) {return 'good';}
    if (score >= 50) {return 'fair';}
    return 'poor';
  }

  isWarning(score: number): boolean {
    return score < this.thresholds.healthScoreWarning;
  }

  isCritical(score: number): boolean {
    return score < this.thresholds.healthScoreCritical;
  }
}
