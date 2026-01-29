/**
 * Package Context Generator
 * 
 * @license Apache-2.0
 * 
 * Generates AI-optimized context for specific packages in a monorepo.
 * Scopes patterns, constraints, and examples to minimize token usage.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { PackageDetector } from './package-detector.js';

import type {
  PackageContextOptions,
  PackageContext,
  PackageContextResult,
  ContextPattern,
  ContextConstraint,
  ContextEntryPoint,
  ContextDataAccessor,
  AIContextFormat,
  DetectedPackage,
  ContextEventType,
} from './types.js';


const DEFAULT_MAX_TOKENS = 8000;
const TOKENS_PER_CHAR = 0.25;
const CONTEXT_VERSION = '1.0.0';

export class PackageContextGenerator extends EventEmitter {
  private readonly rootDir: string;
  private readonly packageDetector: PackageDetector;

  constructor(rootDir: string) {
    super();
    this.rootDir = rootDir;
    this.packageDetector = new PackageDetector(rootDir);
  }

  async generate(options: PackageContextOptions): Promise<PackageContextResult> {
    const warnings: string[] = [];
    this.emitEvent('context:generating', options.package);

    try {
      const pkg = await this.packageDetector.getPackage(options.package);
      if (!pkg) {
        return { success: false, error: `Package not found: ${options.package}`, warnings, tokenEstimate: 0 };
      }

      const patterns = await this.loadPackagePatterns(pkg, options);
      const constraints = await this.loadPackageConstraints(pkg, options);
      const entryPoints = await this.extractEntryPoints(pkg);
      const dataAccessors = await this.extractDataAccessors(pkg);
      const keyFiles = await this.findKeyFiles(patterns);
      const guidance = this.generateGuidance(patterns, constraints);

      let dependencies: PackageContext['dependencies'];
      if (options.includeDependencies || options.includeInternalDeps) {
        dependencies = await this.loadDependencyPatterns(pkg, options);
      }

      const context: PackageContext = {
        package: { name: pkg.name, path: pkg.path, language: pkg.language, ...(pkg.description ? { description: pkg.description } : {}) },
        summary: { totalPatterns: patterns.length, totalConstraints: constraints.length, totalFiles: keyFiles.length, totalEntryPoints: entryPoints.length, totalDataAccessors: dataAccessors.length, estimatedTokens: 0 },
        patterns, constraints, entryPoints, dataAccessors, keyFiles, guidance,
        ...(dependencies && dependencies.length > 0 ? { dependencies } : {}),
        metadata: { generatedAt: new Date().toISOString(), driftVersion: '1.0.0', contextVersion: CONTEXT_VERSION },
      };

      const tokenEstimate = this.estimateTokens(context);
      context.summary.estimatedTokens = tokenEstimate;

      const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
      if (tokenEstimate > maxTokens) {
        this.trimContext(context, maxTokens);
        warnings.push(`Context trimmed to fit within ${maxTokens} token limit`);
      }

      this.emitEvent('context:generated', options.package, { patterns: patterns.length, constraints: constraints.length, tokens: context.summary.estimatedTokens });
      return { success: true, context, warnings, tokenEstimate: context.summary.estimatedTokens };
    } catch (error) {
      this.emitEvent('context:error', options.package, { error: (error as Error).message });
      return { success: false, error: `Failed to generate context: ${(error as Error).message}`, warnings, tokenEstimate: 0 };
    }
  }

  async generateAIContext(options: PackageContextOptions): Promise<AIContextFormat> {
    const result = await this.generate(options);
    if (!result.success || !result.context) {
      return { systemPrompt: `Error: ${result.error}`, conventions: '', examples: '', constraints: '', combined: `Error: ${result.error}`, tokens: { systemPrompt: 0, conventions: 0, examples: 0, constraints: 0, total: 0 } };
    }
    return this.formatForAI(result.context);
  }

  formatForAI(context: PackageContext): AIContextFormat {
    const systemPrompt = this.buildSystemPrompt(context);
    const conventions = this.buildConventions(context);
    const examples = this.buildExamples(context);
    const constraintsSection = this.buildConstraints(context);
    const combined = [systemPrompt, conventions, examples, constraintsSection].filter(Boolean).join('\n\n---\n\n');
    return { systemPrompt, conventions, examples, constraints: constraintsSection, combined, tokens: { systemPrompt: this.countTokens(systemPrompt), conventions: this.countTokens(conventions), examples: this.countTokens(examples), constraints: this.countTokens(constraintsSection), total: this.countTokens(combined) } };
  }

  private async loadPackagePatterns(pkg: DetectedPackage, options: PackageContextOptions): Promise<ContextPattern[]> {
    const patterns: ContextPattern[] = [];
    const patternsDir = path.join(this.rootDir, '.drift', 'patterns');
    try {
      for (const status of ['approved', 'discovered']) {
        const statusDir = path.join(patternsDir, status);
        try {
          const files = await fs.readdir(statusDir);
          for (const file of files) {
            if (!file.endsWith('.json')) {continue;}
            try {
              const content = await fs.readFile(path.join(statusDir, file), 'utf-8');
              const data = JSON.parse(content) as Record<string, unknown>;
              
              // Handle both flat pattern format and nested patterns array format
              const patternList = data['patterns'] as Array<Record<string, unknown>> | undefined;
              const category = (data['category'] as string) || 'general';
              
              if (patternList && Array.isArray(patternList)) {
                // Nested format: { category, patterns: [...] }
                for (const pattern of patternList) {
                  const result = await this.processPattern(pattern, category, pkg, options);
                  if (result) {patterns.push(result);}
                }
              } else {
                // Flat format: single pattern object
                const result = await this.processPattern(data, category, pkg, options);
                if (result) {patterns.push(result);}
              }
            } catch { /* skip invalid files */ }
          }
        } catch { /* skip missing directories */ }
      }
    } catch { /* skip if no patterns dir */ }
    return patterns.sort((a, b) => b.occurrences - a.occurrences);
  }

  private async processPattern(
    pattern: Record<string, unknown>,
    category: string,
    pkg: DetectedPackage,
    options: PackageContextOptions
  ): Promise<ContextPattern | null> {
    // Filter by category if specified
    const patternCategory = (pattern['category'] as string) || (pattern['subcategory'] as string) || category;
    if (options.categories?.length && !options.categories.includes(patternCategory)) {return null;}
    
    // Get confidence - handle both nested and flat formats
    let confidence = 0.5;
    const confidenceObj = pattern['confidence'] as Record<string, unknown> | number | undefined;
    if (typeof confidenceObj === 'number') {
      confidence = confidenceObj;
    } else if (confidenceObj && typeof confidenceObj === 'object') {
      confidence = (confidenceObj['score'] as number) ?? 0.5;
    }
    
    if (options.minConfidence && confidence < options.minConfidence) {return null;}
    
    // Get locations
    const locations = (pattern['locations'] as Array<{ file: string; line?: number }>) || [];
    const packageLocations = locations.filter(loc => this.isFileInPackage(loc.file, pkg));
    if (packageLocations.length === 0) {return null;}
    
    const contextPattern: ContextPattern = {
      id: (pattern['id'] as string) || 'unknown',
      name: (pattern['name'] as string) || 'Unknown',
      category: patternCategory,
      confidence,
      occurrences: packageLocations.length,
      files: packageLocations.map(l => l.file).slice(0, 5),
    };
    
    // Add snippet if requested
    if (options.includeSnippets && packageLocations[0]) {
      const example = await this.extractSnippet(packageLocations[0].file, packageLocations[0].line);
      if (example) {contextPattern.example = example;}
    }
    
    return contextPattern;
  }

  private async loadPackageConstraints(pkg: DetectedPackage, _options: PackageContextOptions): Promise<ContextConstraint[]> {
    const constraints: ContextConstraint[] = [];
    const constraintsDir = path.join(this.rootDir, '.drift', 'constraints');
    try {
      for (const status of ['approved', 'discovered']) {
        const statusDir = path.join(constraintsDir, status);
        try {
          const files = await fs.readdir(statusDir);
          for (const file of files) {
            if (!file.endsWith('.json')) {continue;}
            try {
              const content = await fs.readFile(path.join(statusDir, file), 'utf-8');
              const constraint = JSON.parse(content) as Record<string, unknown>;
              const scope = constraint['scope'] as Record<string, unknown> | undefined;
              if (scope) {
                const packages = scope['packages'] as string[] | undefined;
                if (packages && !packages.includes(pkg.name) && !packages.includes('*')) {continue;}
              }
              constraints.push({ id: (constraint['id'] as string) || file.replace('.json', ''), name: (constraint['name'] as string) || 'Unknown', category: (constraint['category'] as string) || 'general', enforcement: (constraint['enforcement'] as 'error' | 'warning' | 'info') || 'warning', condition: (constraint['condition'] as string) || '', guidance: (constraint['guidance'] as string) || '' });
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    return constraints;
  }

  private async extractEntryPoints(pkg: DetectedPackage): Promise<ContextEntryPoint[]> {
    const entryPoints: ContextEntryPoint[] = [];
    const callgraphDir = path.join(this.rootDir, '.drift', 'lake', 'callgraph', 'files');
    try {
      const files = await fs.readdir(callgraphDir);
      for (const file of files) {
        if (!file.endsWith('.json')) {continue;}
        try {
          const content = await fs.readFile(path.join(callgraphDir, file), 'utf-8');
          const data = JSON.parse(content) as Record<string, unknown>;
          const filePath = (data['file'] as string) || '';
          if (!this.isFileInPackage(filePath, pkg)) {continue;}
          const entries = (data['entryPoints'] as Array<Record<string, unknown>>) || [];
          for (const entry of entries) {
            const ep: ContextEntryPoint = { name: (entry['name'] as string) || 'unknown', file: filePath, type: (entry['type'] as string) || 'function' };
            if (entry['method']) {ep.method = entry['method'] as string;}
            if (entry['path']) {ep.path = entry['path'] as string;}
            entryPoints.push(ep);
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    return entryPoints.slice(0, 50);
  }

  private async extractDataAccessors(pkg: DetectedPackage): Promise<ContextDataAccessor[]> {
    const accessors: ContextDataAccessor[] = [];
    const securityDir = path.join(this.rootDir, '.drift', 'lake', 'security', 'tables');
    try {
      const files = await fs.readdir(securityDir);
      for (const file of files) {
        if (!file.endsWith('.json')) {continue;}
        try {
          const content = await fs.readFile(path.join(securityDir, file), 'utf-8');
          const data = JSON.parse(content) as Record<string, unknown>;
          const accesses = (data['accesses'] as Array<Record<string, unknown>>) || [];
          for (const access of accesses) {
            const filePath = (access['file'] as string) || '';
            if (!this.isFileInPackage(filePath, pkg)) {continue;}
            accessors.push({ name: (access['function'] as string) || 'unknown', file: filePath, tables: (access['tables'] as string[]) || [], accessesSensitive: (access['sensitive'] as boolean) || false });
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    return accessors.slice(0, 30);
  }

  private async findKeyFiles(patterns: ContextPattern[]): Promise<Array<{ file: string; reason: string; patterns: string[] }>> {
    const fileScores = new Map<string, { score: number; patterns: string[] }>();
    for (const pattern of patterns) {
      for (const file of pattern.files) {
        const existing = fileScores.get(file) || { score: 0, patterns: [] };
        existing.score += pattern.confidence * pattern.occurrences;
        existing.patterns.push(pattern.name);
        fileScores.set(file, existing);
      }
    }
    return Array.from(fileScores.entries()).sort((a, b) => b[1].score - a[1].score).slice(0, 10).map(([file, data]) => ({ file, reason: `Contains ${data.patterns.length} patterns`, patterns: [...new Set(data.patterns)].slice(0, 5) }));
  }

  private generateGuidance(patterns: ContextPattern[], constraints: ContextConstraint[]): PackageContext['guidance'] {
    const keyInsights: string[] = [];
    const commonPatterns: string[] = [];
    const warnings: string[] = [];
    const categoryGroups = new Map<string, ContextPattern[]>();
    for (const pattern of patterns) {
      const group = categoryGroups.get(pattern.category) || [];
      group.push(pattern);
      categoryGroups.set(pattern.category, group);
    }
    for (const [category, categoryPatterns] of categoryGroups) {
      if (categoryPatterns.length >= 2) {keyInsights.push(`${category}: ${categoryPatterns.length} patterns detected`);}
    }
    for (const pattern of patterns.filter(p => p.confidence >= 0.8).slice(0, 5)) {
      commonPatterns.push(`${pattern.name} (${pattern.occurrences} occurrences)`);
    }
    for (const constraint of constraints.filter(c => c.enforcement === 'error').slice(0, 3)) {
      warnings.push(constraint.guidance || constraint.name);
    }
    return { keyInsights, commonPatterns, warnings };
  }

  private async loadDependencyPatterns(pkg: DetectedPackage, options: PackageContextOptions): Promise<Array<{ name: string; patterns: ContextPattern[] }>> {
    const dependencies: Array<{ name: string; patterns: ContextPattern[] }> = [];
    for (const depName of pkg.internalDependencies) {
      const depPkg = await this.packageDetector.getPackage(depName);
      if (!depPkg) {continue;}
      const depPatterns = await this.loadPackagePatterns(depPkg, { ...options, includeSnippets: false });
      const markedPatterns = depPatterns.map(p => ({ ...p, fromDependency: depName }));
      if (markedPatterns.length > 0) {dependencies.push({ name: depName, patterns: markedPatterns.slice(0, 10) });}
    }
    return dependencies;
  }

  private estimateTokens(context: PackageContext): number { return Math.ceil(JSON.stringify(context).length * TOKENS_PER_CHAR); }
  private countTokens(text: string): number { return Math.ceil(text.length * TOKENS_PER_CHAR); }

  private trimContext(context: PackageContext, maxTokens: number): void {
    let currentTokens = this.estimateTokens(context);
    if (currentTokens > maxTokens && context.dependencies) { context.dependencies = context.dependencies.slice(0, 2); currentTokens = this.estimateTokens(context); }
    if (currentTokens > maxTokens) { for (const pattern of context.patterns) {delete pattern.example;} currentTokens = this.estimateTokens(context); }
    if (currentTokens > maxTokens) { context.patterns = context.patterns.slice(0, 20); currentTokens = this.estimateTokens(context); }
    if (currentTokens > maxTokens) { context.keyFiles = context.keyFiles.slice(0, 5); currentTokens = this.estimateTokens(context); }
    if (currentTokens > maxTokens) { context.entryPoints = context.entryPoints.slice(0, 10); currentTokens = this.estimateTokens(context); }
    if (currentTokens > maxTokens) { context.dataAccessors = context.dataAccessors.slice(0, 10); }
    context.summary.estimatedTokens = this.estimateTokens(context);
  }

  private buildSystemPrompt(context: PackageContext): string {
    const lines = [`# Package: ${context.package.name}`, '', `Language: ${context.package.language}`, `Path: ${context.package.path}`];
    if (context.package.description) {lines.push(`Description: ${context.package.description}`);}
    lines.push('', '## Summary', `- ${context.summary.totalPatterns} patterns detected`, `- ${context.summary.totalConstraints} constraints apply`, `- ${context.summary.totalEntryPoints} entry points`, `- ${context.summary.totalDataAccessors} data accessors`);
    return lines.join('\n');
  }

  private buildConventions(context: PackageContext): string {
    if (context.patterns.length === 0) {return '';}
    const lines = ['## Conventions'];
    for (const pattern of context.patterns.slice(0, 10)) {
      lines.push(`\n### ${pattern.name}`, `Category: ${pattern.category}`, `Confidence: ${(pattern.confidence * 100).toFixed(0)}%`, `Occurrences: ${pattern.occurrences}`);
      if (pattern.example) {lines.push('```', pattern.example, '```');}
    }
    return lines.join('\n');
  }

  private buildExamples(context: PackageContext): string {
    const patternsWithExamples = context.patterns.filter(p => p.example);
    if (patternsWithExamples.length === 0) {return '';}
    const lines = ['## Examples'];
    for (const pattern of patternsWithExamples.slice(0, 5)) {lines.push(`\n### ${pattern.name}`, '```', pattern.example!, '```');}
    return lines.join('\n');
  }

  private buildConstraints(context: PackageContext): string {
    if (context.constraints.length === 0) {return '';}
    const lines = ['## Constraints'];
    for (const constraint of context.constraints) {
      lines.push(`\n### ${constraint.name}`, `Level: ${constraint.enforcement}`);
      if (constraint.condition) {lines.push(`Condition: ${constraint.condition}`);}
      if (constraint.guidance) {lines.push(`Guidance: ${constraint.guidance}`);}
    }
    return lines.join('\n');
  }

  private isFileInPackage(filePath: string, pkg: DetectedPackage): boolean {
    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedPkg = pkg.path.replace(/\\/g, '/');
    if (normalizedPkg === '.') {return !normalizedFile.includes('/packages/') && !normalizedFile.includes('/apps/');}
    return normalizedFile.startsWith(normalizedPkg + '/') || normalizedFile === normalizedPkg;
  }

  private async extractSnippet(filePath: string, line?: number): Promise<string | undefined> {
    try {
      const fullPath = path.join(this.rootDir, filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      if (line !== undefined && line > 0) {
        const start = Math.max(0, line - 3);
        const end = Math.min(lines.length, line + 7);
        return lines.slice(start, end).join('\n');
      }
      return lines.slice(0, 10).join('\n');
    } catch { return undefined; }
  }

  private emitEvent(type: ContextEventType, packageName?: string, details?: Record<string, unknown>): void {
    const event = { type, timestamp: new Date().toISOString(), ...(packageName ? { packageName } : {}), ...(details ? { details } : {}) };
    this.emit(type, event);
    this.emit('*', event);
  }
}

export function createPackageContextGenerator(rootDir: string): PackageContextGenerator {
  return new PackageContextGenerator(rootDir);
}
