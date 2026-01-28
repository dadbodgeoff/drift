/**
 * DNA Type Definitions
 */

export type StylingFramework = 'tailwind' | 'css-modules' | 'styled-components' | 'emotion' | 'vanilla-css' | 'scss' | 'mixed';
export type BackendFramework = 'fastapi' | 'flask' | 'django' | 'express' | 'nestjs' | 'spring' | 'laravel' | 'gin' | 'actix' | 'unknown';

// Frontend styling genes
export type FrontendGeneId = 'variant-handling' | 'responsive-approach' | 'state-styling' | 'theming' | 'spacing-philosophy' | 'animation-approach';

// Backend pattern genes
export type BackendGeneId = 'api-response-format' | 'error-response-format' | 'logging-format' | 'config-pattern';

// Combined gene ID type
export type GeneId = FrontendGeneId | BackendGeneId;

export type AlleleId = string;
export type MutationImpact = 'low' | 'medium' | 'high';

export interface AlleleExample { file: string; line: number; code: string; context: string; }
export interface Allele { id: AlleleId; name: string; description: string; frequency: number; fileCount: number; pattern: string; examples: AlleleExample[]; isDominant: boolean; }
export interface Gene { id: GeneId; name: string; description: string; dominant: Allele | null; alleles: Allele[]; confidence: number; consistency: number; exemplars: string[]; }
export interface Mutation { id: string; file: string; line: number; gene: GeneId; expected: AlleleId; actual: AlleleId; impact: MutationImpact; code: string; suggestion: string; detectedAt: string; resolved: boolean; resolvedAt?: string; }
export interface EvolutionChange { type: 'gene_shift' | 'mutation_introduced' | 'mutation_resolved' | 'new_allele'; gene?: GeneId; description: string; files?: string[]; }
export interface EvolutionEntry { timestamp: string; commitHash?: string; healthScore: number; geneticDiversity: number; changes: EvolutionChange[]; }
export interface DNASummary { totalComponentsAnalyzed: number; totalFilesAnalyzed: number; healthScore: number; geneticDiversity: number; dominantFramework: StylingFramework; dominantBackendFramework?: BackendFramework; lastUpdated: string; }
export interface StylingDNAProfile { version: '1.0.0'; generatedAt: string; projectRoot: string; summary: DNASummary; genes: Record<GeneId, Gene>; mutations: Mutation[]; evolution: EvolutionEntry[]; }
export interface DNAThresholds { dominantMinFrequency: number; mutationImpactHigh: number; mutationImpactMedium: number; healthScoreWarning: number; healthScoreCritical: number; }
export interface DNAStoreConfig { rootDir: string; componentPaths: string[]; backendPaths?: string[]; excludePaths: string[]; thresholds: DNAThresholds; }

export const DNA_VERSION = '1.0.0' as const;
export const FRONTEND_GENE_IDS: readonly FrontendGeneId[] = ['variant-handling', 'responsive-approach', 'state-styling', 'theming', 'spacing-philosophy', 'animation-approach'] as const;
export const BACKEND_GENE_IDS: readonly BackendGeneId[] = ['api-response-format', 'error-response-format', 'logging-format', 'config-pattern'] as const;
export const GENE_IDS: readonly GeneId[] = [...FRONTEND_GENE_IDS, ...BACKEND_GENE_IDS] as const;
export const DEFAULT_DNA_THRESHOLDS: DNAThresholds = { dominantMinFrequency: 0.6, mutationImpactHigh: 0.1, mutationImpactMedium: 0.3, healthScoreWarning: 70, healthScoreCritical: 50 };
export const DEFAULT_DNA_STORE_CONFIG: DNAStoreConfig = { rootDir: '.', componentPaths: ['src/components', 'src/features'], backendPaths: ['src', 'app', 'api', 'routes', 'handlers', 'controllers', 'services'], excludePaths: ['**/*.test.*', '**/*.stories.*', '**/index.ts'], thresholds: DEFAULT_DNA_THRESHOLDS };
