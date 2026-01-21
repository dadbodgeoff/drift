import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { StylingDNAProfile, DNASummary, Gene, GeneId, StylingFramework, DNAThresholds } from './types.js';
import { DNA_VERSION, DEFAULT_DNA_STORE_CONFIG, DEFAULT_DNA_THRESHOLDS } from './types.js';
import { createAllGeneExtractors, type BaseGeneExtractor } from './gene-extractors/index.js';
import { HealthCalculator } from './health-calculator.js';
import { MutationDetector } from './mutation-detector.js';

export interface DNAAnalyzerConfig {
  rootDir: string;
  componentPaths?: string[];
  excludePaths?: string[];
  thresholds?: Partial<DNAThresholds>;
  verbose?: boolean;
}

export interface AnalysisResult {
  profile: StylingDNAProfile;
  stats: { totalFiles: number; componentFiles: number; filesAnalyzed: number; duration: number; genesAnalyzed: number };
  errors: string[];
}

export class DNAAnalyzer {
  private readonly config: DNAAnalyzerConfig;
  private readonly thresholds: DNAThresholds;
  private extractors: Map<GeneId, BaseGeneExtractor> = new Map();
  private healthCalculator: HealthCalculator;
  private mutationDetector: MutationDetector;
  private initialized = false;

  constructor(config: DNAAnalyzerConfig) {
    this.config = { componentPaths: DEFAULT_DNA_STORE_CONFIG.componentPaths, excludePaths: DEFAULT_DNA_STORE_CONFIG.excludePaths, ...config };
    this.thresholds = { ...DEFAULT_DNA_THRESHOLDS, ...config.thresholds };
    this.healthCalculator = new HealthCalculator(this.thresholds);
    this.mutationDetector = new MutationDetector(this.thresholds);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.extractors = createAllGeneExtractors();
    this.initialized = true;
  }

  async analyze(files?: Map<string, string>): Promise<AnalysisResult> {
    if (!this.initialized) await this.initialize();
    const startTime = Date.now();
    const errors: string[] = [];
    const fileMap = files ?? await this.discoverFiles();
    const genes: Record<GeneId, Gene> = {} as Record<GeneId, Gene>;

    for (const [geneId, extractor] of this.extractors) {
      try { genes[geneId] = await extractor.analyze(fileMap); }
      catch (e) { errors.push(`Error analyzing ${geneId}: ${e instanceof Error ? e.message : String(e)}`); genes[geneId] = { id: geneId, name: extractor.geneName, description: extractor.geneDescription, dominant: null, alleles: [], confidence: 0, consistency: 0, exemplars: [] }; }
    }

    const mutations = this.mutationDetector.detectMutations(genes, fileMap);
    const healthScore = this.healthCalculator.calculateHealthScore(genes, mutations);
    const geneticDiversity = this.healthCalculator.calculateGeneticDiversity(genes);
    const dominantFramework = this.detectFramework(genes, fileMap);
    let componentCount = 0;
    const firstGene = Object.values(genes)[0];
    if (firstGene) componentCount = firstGene.alleles.reduce((s, a) => s + a.fileCount, 0);

    const summary: DNASummary = { totalComponentsAnalyzed: componentCount, totalFilesAnalyzed: fileMap.size, healthScore, geneticDiversity, dominantFramework, lastUpdated: new Date().toISOString() };
    const profile: StylingDNAProfile = { version: DNA_VERSION, generatedAt: new Date().toISOString(), projectRoot: this.config.rootDir, summary, genes, mutations, evolution: [] };

    return { profile, stats: { totalFiles: fileMap.size, componentFiles: componentCount, filesAnalyzed: fileMap.size, duration: Date.now() - startTime, genesAnalyzed: this.extractors.size }, errors };
  }

  private async discoverFiles(): Promise<Map<string, string>> {
    const fileMap = new Map<string, string>();
    const exts = ['.tsx', '.jsx', '.vue', '.svelte'];
    for (const cp of this.config.componentPaths ?? []) {
      const fp = path.join(this.config.rootDir, cp);
      try { await this.walk(fp, async (f) => { if (exts.some(e => f.endsWith(e))) { const rel = path.relative(this.config.rootDir, f); try { fileMap.set(rel, await fs.readFile(f, 'utf-8')); } catch {} } }); } catch {}
    }
    return fileMap;
  }

  private async walk(dir: string, cb: (f: string) => Promise<void>): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) await this.walk(fp, cb);
      else if (e.isFile()) await cb(fp);
    }
  }

  private detectFramework(genes: Record<GeneId, Gene>, files: Map<string, string>): StylingFramework {
    const scores: Record<StylingFramework, number> = { tailwind: 0, 'css-modules': 0, 'styled-components': 0, emotion: 0, 'vanilla-css': 0, scss: 0, mixed: 0 };
    for (const g of Object.values(genes)) for (const a of g.alleles) { if (a.id.startsWith('tailwind')) scores.tailwind += a.frequency * a.fileCount; if (a.id.includes('styled')) scores['styled-components'] += a.frequency * a.fileCount; }
    for (const c of files.values()) { if (/className\s*=\s*["'`][^"'`]*\b(flex|p-|m-|bg-)/.test(c)) scores.tailwind++; if (/styled-components/.test(c)) scores['styled-components'] += 2; if (/@emotion/.test(c)) scores.emotion += 2; if (/\.module\.css/.test(c)) scores['css-modules'] += 2; }
    let max = 0, dom: StylingFramework = 'vanilla-css';
    for (const [f, s] of Object.entries(scores)) if (s > max) { max = s; dom = f as StylingFramework; }
    return Object.values(scores).filter(s => s > max * 0.3).length > 1 ? 'mixed' : dom;
  }
}
