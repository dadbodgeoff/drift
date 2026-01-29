/**
 * Base Gene Extractor
 */
import type { Gene, GeneId, Allele, AlleleId, AlleleExample } from '../types.js';

export interface AlleleDefinition {
  id: AlleleId;
  name: string;
  description: string;
  patterns: RegExp[];
  keywords?: string[];
  importPatterns?: RegExp[];
  priority?: number;
}

export interface DetectedAllele {
  alleleId: AlleleId;
  line: number;
  code: string;
  confidence: number;
  context?: string;
}

export interface FileExtractionResult {
  file: string;
  detectedAlleles: DetectedAllele[];
  isComponent: boolean;
  errors?: string[];
}

export interface AggregatedExtractionResult {
  geneId: GeneId;
  totalFiles: number;
  componentFiles: number;
  alleleCounts: Map<AlleleId, number>;
  alleleFiles: Map<AlleleId, Set<string>>;
  alleleExamples: Map<AlleleId, AlleleExample[]>;
  errors: string[];
}

export abstract class BaseGeneExtractor {
  abstract readonly geneId: GeneId;
  abstract readonly geneName: string;
  abstract readonly geneDescription: string;
  abstract getAlleleDefinitions(): AlleleDefinition[];
  abstract extractFromFile(fp: string, c: string, i: string[]): FileExtractionResult;

  async analyze(files: Map<string, string>): Promise<Gene> {
    return this.buildGene(this.aggregateResults(files));
  }

  isComponentFile(fp: string, c: string): boolean {
    if (!['.tsx', '.jsx', '.vue', '.svelte'].some(e => fp.endsWith(e))) {return false;}
    return [/export\s+(default\s+)?function\s+\w+/, /<template>/].some(p => p.test(c));
  }

  extractImports(c: string): string[] {
    return c.match(/^import\s+.+$/gm) ?? [];
  }

  protected aggregateResults(files: Map<string, string>): AggregatedExtractionResult {
    const r: AggregatedExtractionResult = {
      geneId: this.geneId, totalFiles: 0, componentFiles: 0,
      alleleCounts: new Map(), alleleFiles: new Map(), alleleExamples: new Map(), errors: []
    };
    for (const d of this.getAlleleDefinitions()) {
      r.alleleCounts.set(d.id, 0);
      r.alleleFiles.set(d.id, new Set());
      r.alleleExamples.set(d.id, []);
    }
    for (const [fp, c] of files) {
      r.totalFiles++;
      const imp = this.extractImports(c);
      const ex = this.extractFromFile(fp, c, imp);
      if (ex.isComponent) {r.componentFiles++;}
      for (const det of ex.detectedAlleles) {
        r.alleleCounts.set(det.alleleId, (r.alleleCounts.get(det.alleleId) ?? 0) + 1);
        r.alleleFiles.get(det.alleleId)?.add(fp);
        const exs = r.alleleExamples.get(det.alleleId);
        if (exs && exs.length < 5) {exs.push({ file: fp, line: det.line, code: det.code, context: det.context ?? '' });}
      }
    }
    return r;
  }

  protected buildGene(a: AggregatedExtractionResult): Gene {
    const alleles: Allele[] = [];
    let tot = 0;
    for (const c of a.alleleCounts.values()) {tot += c;}
    for (const d of this.getAlleleDefinitions()) {
      const cnt = a.alleleCounts.get(d.id) ?? 0;
      const fs = a.alleleFiles.get(d.id) ?? new Set();
      if (cnt > 0) {alleles.push({ id: d.id, name: d.name, description: d.description, frequency: tot > 0 ? cnt / tot : 0, fileCount: fs.size, pattern: d.patterns.map(p => p.source).join('|'), examples: a.alleleExamples.get(d.id) ?? [], isDominant: false });}
    }
    alleles.sort((x, y) => y.frequency - x.frequency);
    let dom: Allele | null = null;
    const f = alleles[0];
    if (f && f.frequency >= 0.3) { dom = f; f.isDominant = true; }
    const conf = f ? Math.round(f.frequency * 100) / 100 : 0;
    const s = alleles[1];
    const cons = alleles.length <= 1 ? 1 : Math.round(Math.min(1, 0.5 + ((f?.frequency ?? 0) - (s?.frequency ?? 0)) * 0.5) * 100) / 100;
    return { id: this.geneId, name: this.geneName, description: this.geneDescription, dominant: dom, alleles, confidence: conf, consistency: cons, exemplars: dom ? Array.from(a.alleleFiles.get(dom.id) ?? []).slice(0, 5) : [] };
  }

  protected extractContext(c: string, mi: number): { line: number; code: string; context: string } {
    const ls = c.split('\n');
    let idx = 0, ln = 1;
    for (let i = 0; i < ls.length; i++) { const l = ls[i]; if (l && idx + l.length >= mi) { ln = i + 1; break; } idx += (l?.length ?? 0) + 1; }
    return { line: ln, code: ls[ln - 1] ?? '', context: ls.slice(Math.max(0, ln - 3), Math.min(ls.length, ln + 2)).join('\n') };
  }
}
