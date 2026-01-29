import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createAllGeneExtractors, createFrontendGeneExtractors, createBackendGeneExtractors, type BaseGeneExtractor } from './gene-extractors/index.js';
import { HealthCalculator } from './health-calculator.js';
import { MutationDetector } from './mutation-detector.js';
import { DNA_VERSION, DEFAULT_DNA_STORE_CONFIG, DEFAULT_DNA_THRESHOLDS } from './types.js';

import type { StylingDNAProfile, DNASummary, Gene, GeneId, StylingFramework, BackendFramework, DNAThresholds } from './types.js';

export interface DNAAnalyzerConfig {
  rootDir: string;
  componentPaths?: string[];
  backendPaths?: string[];
  excludePaths?: string[];
  thresholds?: Partial<DNAThresholds>;
  verbose?: boolean;
  /** Analyze only frontend, only backend, or both */
  mode?: 'frontend' | 'backend' | 'all';
}

export interface AnalysisResult {
  profile: StylingDNAProfile;
  stats: { totalFiles: number; componentFiles: number; backendFiles: number; filesAnalyzed: number; duration: number; genesAnalyzed: number };
  errors: string[];
}

export class DNAAnalyzer {
  private readonly rootDir: string;
  private readonly componentPaths: string[];
  private readonly backendPaths: string[];
  private readonly mode: 'frontend' | 'backend' | 'all';
  private readonly thresholds: DNAThresholds;
  private extractors: Map<GeneId, BaseGeneExtractor> = new Map();
  private healthCalculator: HealthCalculator;
  private mutationDetector: MutationDetector;
  private initialized = false;

  constructor(config: DNAAnalyzerConfig) {
    this.rootDir = config.rootDir;
    this.componentPaths = config.componentPaths ?? DEFAULT_DNA_STORE_CONFIG.componentPaths;
    this.backendPaths = config.backendPaths ?? DEFAULT_DNA_STORE_CONFIG.backendPaths ?? [];
    this.mode = config.mode ?? 'all';
    this.thresholds = { ...DEFAULT_DNA_THRESHOLDS, ...config.thresholds };
    this.healthCalculator = new HealthCalculator(this.thresholds);
    this.mutationDetector = new MutationDetector(this.thresholds);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {return;}
    
    // Create extractors based on mode
    switch (this.mode) {
      case 'frontend':
        this.extractors = createFrontendGeneExtractors();
        break;
      case 'backend':
        this.extractors = createBackendGeneExtractors();
        break;
      case 'all':
      default:
        this.extractors = createAllGeneExtractors();
        break;
    }
    
    this.initialized = true;
  }

  async analyze(files?: Map<string, string>): Promise<AnalysisResult> {
    if (!this.initialized) {await this.initialize();}
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
    const dominantBackendFramework = this.detectBackendFramework(fileMap);
    
    let componentCount = 0;
    let backendCount = 0;
    
    // Count frontend components
    for (const [fp] of fileMap) {
      if (this.isFrontendFile(fp)) {componentCount++;}
      if (this.isBackendFile(fp)) {backendCount++;}
    }

    const summary: DNASummary = { 
      totalComponentsAnalyzed: componentCount, 
      totalFilesAnalyzed: fileMap.size, 
      healthScore, 
      geneticDiversity, 
      dominantFramework,
      dominantBackendFramework,
      lastUpdated: new Date().toISOString() 
    };
    const profile: StylingDNAProfile = { version: DNA_VERSION, generatedAt: new Date().toISOString(), projectRoot: this.rootDir, summary, genes, mutations, evolution: [] };

    return { 
      profile, 
      stats: { 
        totalFiles: fileMap.size, 
        componentFiles: componentCount, 
        backendFiles: backendCount,
        filesAnalyzed: fileMap.size, 
        duration: Date.now() - startTime, 
        genesAnalyzed: this.extractors.size 
      }, 
      errors 
    };
  }

  private async discoverFiles(): Promise<Map<string, string>> {
    const fileMap = new Map<string, string>();
    
    // Frontend file extensions
    const frontendExts = ['.tsx', '.jsx', '.vue', '.svelte'];
    
    // Backend file extensions
    const backendExts = ['.py', '.ts', '.js', '.java', '.php', '.go', '.rs', '.cs'];
    
    // Discover frontend files
    if (this.mode === 'frontend' || this.mode === 'all') {
      for (const cp of this.componentPaths) {
        const fp = path.join(this.rootDir, cp);
        try { 
          await this.walk(fp, async (f) => { 
            if (frontendExts.some(e => f.endsWith(e))) { 
              const rel = path.relative(this.rootDir, f); 
              try { fileMap.set(rel, await fs.readFile(f, 'utf-8')); } catch {} 
            } 
          }); 
        } catch {
          // Directory doesn't exist, skip silently
        }
      }
    }
    
    // Discover backend files
    if (this.mode === 'backend' || this.mode === 'all') {
      for (const bp of this.backendPaths) {
        const fp = path.join(this.rootDir, bp);
        try { 
          const stat = await fs.stat(fp);
          if (!stat.isDirectory()) {continue;}
          
          await this.walk(fp, async (f) => { 
            // Skip test files and node_modules
            if (f.includes('/test/') || f.includes('/tests/') || f.includes('.test.') || f.includes('.spec.') || f.includes('__pycache__')) {return;}
            if (backendExts.some(e => f.endsWith(e))) { 
              const rel = path.relative(this.rootDir, f);
              // Don't overwrite frontend files
              if (!fileMap.has(rel)) {
                try { fileMap.set(rel, await fs.readFile(f, 'utf-8')); } catch {} 
              }
            } 
          }); 
        } catch {
          // Directory doesn't exist, skip silently
        }
      }
    }
    
    return fileMap;
  }

  private async walk(dir: string, cb: (f: string) => Promise<void>): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.') && e.name !== '__pycache__' && e.name !== 'venv' && e.name !== '.venv') {await this.walk(fp, cb);}
      else if (e.isFile()) {await cb(fp);}
    }
  }

  private isFrontendFile(filePath: string): boolean {
    return ['.tsx', '.jsx', '.vue', '.svelte'].some(e => filePath.endsWith(e));
  }

  private isBackendFile(filePath: string): boolean {
    return ['.py', '.java', '.php', '.go', '.rs', '.cs'].some(e => filePath.endsWith(e)) ||
           (filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) ||
           (filePath.endsWith('.js') && !filePath.endsWith('.jsx'));
  }

  private detectFramework(genes: Record<GeneId, Gene>, files: Map<string, string>): StylingFramework {
    const scores: Record<StylingFramework, number> = { tailwind: 0, 'css-modules': 0, 'styled-components': 0, emotion: 0, 'vanilla-css': 0, scss: 0, mixed: 0 };
    for (const g of Object.values(genes)) {for (const a of g.alleles) { if (a.id.startsWith('tailwind')) {scores.tailwind += a.frequency * a.fileCount;} if (a.id.includes('styled')) {scores['styled-components'] += a.frequency * a.fileCount;} }}
    for (const c of files.values()) { if (/className\s*=\s*["'`][^"'`]*\b(flex|p-|m-|bg-)/.test(c)) {scores.tailwind++;} if (/styled-components/.test(c)) {scores['styled-components'] += 2;} if (/@emotion/.test(c)) {scores.emotion += 2;} if (/\.module\.css/.test(c)) {scores['css-modules'] += 2;} }
    let max = 0, dom: StylingFramework = 'vanilla-css';
    for (const [f, s] of Object.entries(scores)) {if (s > max) { max = s; dom = f as StylingFramework; }}
    return Object.values(scores).filter(s => s > max * 0.3).length > 1 ? 'mixed' : dom;
  }

  private detectBackendFramework(files: Map<string, string>): BackendFramework {
    const scores: Record<BackendFramework, number> = { 
      fastapi: 0, flask: 0, django: 0, express: 0, nestjs: 0, 
      spring: 0, laravel: 0, gin: 0, actix: 0, unknown: 0 
    };
    
    for (const content of files.values()) {
      // Python frameworks
      if (/from\s+fastapi/.test(content)) {scores.fastapi += 2;}
      if (/from\s+flask/.test(content)) {scores.flask += 2;}
      if (/from\s+django/.test(content)) {scores.django += 2;}
      
      // Node.js frameworks
      if (/express\s*\(\s*\)/.test(content) || /require\s*\(\s*["']express["']\s*\)/.test(content)) {scores.express += 2;}
      if (/@Controller|@Injectable|@Module/.test(content)) {scores.nestjs += 2;}
      
      // Java frameworks
      if (/@SpringBootApplication|@RestController|@RequestMapping/.test(content)) {scores.spring += 2;}
      
      // PHP frameworks
      if (/use\s+Illuminate\\/.test(content) || /Route::/.test(content)) {scores.laravel += 2;}
      
      // Go frameworks
      if (/gin\.Default\(\)|gin\.New\(\)/.test(content)) {scores.gin += 2;}
      
      // Rust frameworks
      if (/actix_web|HttpServer::new/.test(content)) {scores.actix += 2;}
    }
    
    let max = 0, dom: BackendFramework = 'unknown';
    for (const [f, s] of Object.entries(scores)) {
      if (s > max) { max = s; dom = f as BackendFramework; }
    }
    
    return max > 0 ? dom : 'unknown';
  }
}
