/**
 * drift_dna_profile - Styling DNA Profile
 * 
 * Detail tool that returns the complete styling DNA profile for the codebase.
 * Shows how components are styled with confidence scores and exemplar files.
 */

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

import type { DNAStore, GeneId } from 'driftdetect-core';

export interface GeneProfile {
  id: string;
  name: string;
  dominantApproach: string;
  confidence: number;
  alternatives: Array<{
    approach: string;
    frequency: number;
  }>;
  exemplarFiles: string[];
}

export interface DNAProfileData {
  healthScore: number;
  geneticDiversity: number;
  genes: GeneProfile[];
  summary: {
    totalGenes: number;
    highConfidenceGenes: number;
    lowConfidenceGenes: number;
  };
}

const GENE_NAMES: Record<string, string> = {
  'variant-handling': 'Variant Handling',
  'responsive-approach': 'Responsive Approach',
  'state-styling': 'State Styling',
  'theming': 'Theming',
  'spacing-philosophy': 'Spacing Philosophy',
  'animation-approach': 'Animation Approach',
};

export async function handleDNAProfile(
  store: DNAStore,
  args: {
    gene?: string;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<DNAProfileData>();
  
  await store.initialize();
  const profile = store.getProfile();
  
  if (!profile) {
    throw Errors.custom(
      'NO_DNA_PROFILE',
      'No DNA profile found. Run drift dna scan first.',
      ['drift dna scan']
    );
  }
  
  // Filter by specific gene if requested
  let geneIds = Object.keys(profile.genes) as GeneId[];
  if (args.gene) {
    if (!profile.genes[args.gene as GeneId]) {
      throw Errors.notFound('gene', args.gene);
    }
    geneIds = [args.gene as GeneId];
  }
  
  // Map genes to profile format
  const genes: GeneProfile[] = geneIds.map(geneId => {
    const gene = profile.genes[geneId];
    if (!gene) {
      return {
        id: geneId,
        name: GENE_NAMES[geneId] ?? geneId,
        dominantApproach: 'unknown',
        confidence: 0,
        alternatives: [],
        exemplarFiles: [],
      };
    }
    
    // Get dominant allele and alternatives
    const dominant = gene.dominant;
    const alternatives = gene.alleles
      .filter(a => !a.isDominant)
      .slice(0, 3)
      .map(allele => ({
        approach: allele.name,
        frequency: Math.round(allele.frequency * 100) / 100,
      }));
    
    return {
      id: geneId,
      name: GENE_NAMES[geneId] ?? geneId,
      dominantApproach: dominant?.name ?? 'unknown',
      confidence: Math.round(gene.confidence * 100) / 100,
      alternatives,
      exemplarFiles: gene.exemplars.slice(0, 3),
    };
  });
  
  // Calculate summary stats
  const highConfidenceGenes = genes.filter(g => g.confidence >= 0.7).length;
  const lowConfidenceGenes = genes.filter(g => g.confidence < 0.5).length;
  
  const data: DNAProfileData = {
    healthScore: Math.round(profile.summary.healthScore * 100) / 100,
    geneticDiversity: Math.round(profile.summary.geneticDiversity * 100) / 100,
    genes,
    summary: {
      totalGenes: genes.length,
      highConfidenceGenes,
      lowConfidenceGenes,
    },
  };
  
  // Build summary
  const healthEmoji = profile.summary.healthScore >= 0.8 ? '🟢' :
                      profile.summary.healthScore >= 0.6 ? '🟡' : '🔴';
  
  let summary = `${healthEmoji} Health: ${Math.round(profile.summary.healthScore * 100)}%. `;
  summary += `${genes.length} genes analyzed, ${highConfidenceGenes} high confidence.`;
  if (profile.summary.geneticDiversity > 0.5) {
    summary += ` High diversity (${Math.round(profile.summary.geneticDiversity * 100)}%) - consider consolidating approaches.`;
  }
  
  const hints: { nextActions: string[]; warnings?: string[]; relatedTools: string[] } = {
    nextActions: [
      'Use drift_dna_check to validate new code against DNA',
      'Use drift_mutations to find files that deviate from patterns',
    ],
    relatedTools: ['drift_dna_check', 'drift_mutations', 'drift_playbook'],
  };
  
  if (lowConfidenceGenes > 0) {
    hints.warnings = [
      `${lowConfidenceGenes} gene(s) have low confidence - patterns may be inconsistent`,
    ];
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}
