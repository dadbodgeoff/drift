import * as crypto from 'node:crypto';

import { DEFAULT_DNA_THRESHOLDS } from './types.js';

import type { Gene, GeneId, Mutation, MutationImpact, DNAThresholds } from './types.js';

export class MutationDetector {
  private readonly thresholds: DNAThresholds;
  constructor(thresholds: Partial<DNAThresholds> = {}) { this.thresholds = { ...DEFAULT_DNA_THRESHOLDS, ...thresholds }; }

  detectMutations(genes: Record<GeneId, Gene>, _files: Map<string, string>): Mutation[] {
    const mutations: Mutation[] = [];
    for (const [geneId, gene] of Object.entries(genes) as [GeneId, Gene][]) {
      if (!gene.dominant) {continue;}
      const domId = gene.dominant.id;
      const domFreq = gene.dominant.frequency;
      for (const allele of gene.alleles) {
        if (allele.id === domId) {continue;}
        for (const ex of allele.examples) {
          mutations.push({
            id: crypto.createHash('sha256').update(`${ex.file}-${geneId}-${allele.id}`).digest('hex').slice(0, 16),
            file: ex.file, line: ex.line, gene: geneId, expected: domId, actual: allele.id,
            impact: this.calcImpact(allele.frequency, domFreq),
            code: ex.code, suggestion: `Refactor to use ${domId} instead of ${allele.id}`,
            detectedAt: new Date().toISOString(), resolved: false,
          });
        }
      }
    }
    return mutations.sort((a, b) => { const o: Record<MutationImpact, number> = { high: 0, medium: 1, low: 2 }; return o[a.impact] - o[b.impact] || a.file.localeCompare(b.file); });
  }

  private calcImpact(freq: number, domFreq: number): MutationImpact {
    if (freq < this.thresholds.mutationImpactHigh && domFreq > 0.8) {return 'high';}
    if (freq < this.thresholds.mutationImpactMedium) {return 'medium';}
    return 'low';
  }

  filterByGene(m: Mutation[], g: GeneId): Mutation[] { return m.filter(x => x.gene === g); }
  filterByImpact(m: Mutation[], i: MutationImpact): Mutation[] { return m.filter(x => x.impact === i); }
}
