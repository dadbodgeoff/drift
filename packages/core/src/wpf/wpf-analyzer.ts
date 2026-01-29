/**
 * WPF Analyzer
 *
 * Main entry point for WPF framework analysis.
 * Coordinates XAML parsing, ViewModel extraction, and linking.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { minimatch } from 'minimatch';

import { ViewModelHybridExtractor, createViewModelHybridExtractor } from './extractors/viewmodel-hybrid-extractor.js';
import { XamlHybridExtractor, createXamlHybridExtractor } from './extractors/xaml-hybrid-extractor.js';
import { DataContextResolver, createDataContextResolver } from './linkers/datacontext-resolver.js';
import { ViewModelLinker, createViewModelLinker } from './linkers/viewmodel-linker.js';

import type {
  XamlExtractionResult,
  ViewModelAnalysis,
  ViewModelLink,
  DataContextResolution,
  WpfProjectInfo,
  MvvmComplianceResult,
  MvvmViolation,
  BindingError,
} from './types.js';

// ============================================================================
// Configuration
// ============================================================================

export interface WpfAnalyzerConfig {
  /** Root directory */
  rootDir: string;
  /** Enable verbose logging */
  verbose?: boolean | undefined;
  /** File patterns to include */
  includePatterns?: string[] | undefined;
  /** File patterns to exclude */
  excludePatterns?: string[] | undefined;
}

const DEFAULT_CONFIG: Partial<WpfAnalyzerConfig> = {
  verbose: false,
  includePatterns: ['**/*.xaml', '**/*.cs'],
  excludePatterns: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/.git/**'],
};

// ============================================================================
// Analysis Results
// ============================================================================

export interface WpfAnalysisResult {
  /** Project info */
  project: WpfProjectInfo | null;
  /** XAML files analyzed */
  xamlFiles: Map<string, XamlExtractionResult>;
  /** ViewModels found */
  viewModels: Map<string, ViewModelAnalysis>;
  /** Binding links */
  links: ViewModelLink[];
  /** DataContext resolutions */
  dataContexts: DataContextResolution[];
  /** Binding errors */
  bindingErrors: BindingError[];
  /** Statistics */
  stats: WpfAnalysisStats;
}

export interface WpfAnalysisStats {
  /** Total XAML files */
  xamlFileCount: number;
  /** Total ViewModels */
  viewModelCount: number;
  /** Total bindings */
  totalBindings: number;
  /** Resolved bindings */
  resolvedBindings: number;
  /** Unresolved bindings */
  unresolvedBindings: number;
  /** Total commands */
  totalCommands: number;
  /** Analysis time in ms */
  analysisTimeMs: number;
}

// ============================================================================
// WPF Analyzer
// ============================================================================

export class WpfAnalyzer {
  private config: WpfAnalyzerConfig;
  private xamlExtractor: XamlHybridExtractor;
  private viewModelExtractor: ViewModelHybridExtractor;
  private dataContextResolver: DataContextResolver;
  private viewModelLinker: ViewModelLinker;

  constructor(config: WpfAnalyzerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as WpfAnalyzerConfig;
    this.xamlExtractor = createXamlHybridExtractor();
    this.viewModelExtractor = createViewModelHybridExtractor();
    this.dataContextResolver = createDataContextResolver();
    this.viewModelLinker = createViewModelLinker(this.dataContextResolver);
  }

  /**
   * Analyze a WPF project
   */
  async analyze(): Promise<WpfAnalysisResult> {
    const startTime = performance.now();

    // Detect WPF project
    const project = await this.detectWpfProject();

    // Find and analyze XAML files
    const xamlFiles = await this.analyzeXamlFiles();

    // Find and analyze ViewModels
    const viewModels = await this.analyzeViewModels();

    // Register ViewModels with resolver
    for (const vm of viewModels.values()) {
      this.dataContextResolver.registerViewModel(vm);
    }

    // Register XAML files with resolver
    for (const [filePath, result] of xamlFiles) {
      this.dataContextResolver.registerXaml(filePath, result);
    }

    // Resolve DataContexts
    const dataContexts = this.dataContextResolver.resolveAll();

    // Link bindings to ViewModels
    const { links, bindingErrors } = await this.linkAllBindings(xamlFiles, viewModels, dataContexts);

    // Calculate statistics
    const stats = this.calculateStats(xamlFiles, viewModels, links, bindingErrors, startTime);

    return {
      project,
      xamlFiles,
      viewModels,
      links,
      dataContexts,
      bindingErrors,
      stats,
    };
  }

  /**
   * Find files matching a pattern
   */
  private async findFiles(pattern: string): Promise<string[]> {
    const results: string[] = [];
    const excludePatterns = this.config.excludePatterns ?? [];

    const walk = async (dir: string, relativePath: string = ''): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // Skip inaccessible directories
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        // Check exclusions
        const isExcluded = excludePatterns.some((p: string) => minimatch(relPath, p));
        if (isExcluded) {continue;}

        if (entry.isDirectory()) {
          await walk(fullPath, relPath);
        } else if (entry.isFile()) {
          if (minimatch(relPath, pattern)) {
            results.push(relPath);
          }
        }
      }
    };

    await walk(this.config.rootDir);
    return results;
  }

  /**
   * Detect if this is a WPF project
   */
  async detectWpfProject(): Promise<WpfProjectInfo | null> {
    const csprojFiles = await this.findFiles('**/*.csproj');

    for (const csprojPath of csprojFiles) {
      const fullPath = path.join(this.config.rootDir, csprojPath);
      const content = await fs.readFile(fullPath, 'utf-8');

      if (this.isWpfProject(content)) {
        const xamlFiles = await this.findFiles('**/*.xaml');
        const viewModels = await this.findFiles('**/*ViewModel*.cs');
        const converters = await this.findFiles('**/*Converter*.cs');

        const resourceDictionaries = xamlFiles.filter((f: string) => 
          f.includes('Resources') || f.includes('Dictionary') || f.includes('Styles')
        );

        const appXaml = xamlFiles.find((f: string) => 
          f.toLowerCase().endsWith('app.xaml')
        ) ?? null;

        return {
          isWpfProject: true,
          projectFile: fullPath,
          targetFramework: this.extractTargetFramework(content),
          xamlFiles,
          viewModels,
          converters,
          resourceDictionaries,
          appXaml,
        };
      }
    }

    return null;
  }

  /**
   * Check if csproj content indicates WPF project
   */
  private isWpfProject(content: string): boolean {
    const indicators = [
      /<UseWPF>true<\/UseWPF>/i,
      /Microsoft\.NET\.Sdk\.WindowsDesktop/,
      /<ProjectTypeGuids>.*60dc8134-eba5-43b8-bcc9-bb4bc16c2548/i,
      /<Reference Include="PresentationCore"/,
      /<Reference Include="PresentationFramework"/,
    ];

    return indicators.some(pattern => pattern.test(content));
  }

  /**
   * Extract target framework from csproj
   */
  private extractTargetFramework(content: string): string {
    const match = content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
    return match?.[1] ?? 'unknown';
  }

  /**
   * Analyze all XAML files
   */
  private async analyzeXamlFiles(): Promise<Map<string, XamlExtractionResult>> {
    const results = new Map<string, XamlExtractionResult>();
    const xamlFiles = await this.findFiles('**/*.xaml');

    for (const xamlPath of xamlFiles) {
      const fullPath = path.join(this.config.rootDir, xamlPath);
      
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const result = await this.xamlExtractor.extract(fullPath, content);
        results.set(xamlPath, result);

        if (this.config.verbose) {
          console.log(`  Analyzed XAML: ${xamlPath} (${result.bindings.length} bindings, ${result.commands.length} commands)`);
        }
      } catch (error) {
        if (this.config.verbose) {
          console.error(`  Error analyzing ${xamlPath}: ${error}`);
        }
      }
    }

    return results;
  }

  /**
   * Analyze all ViewModel files
   */
  private async analyzeViewModels(): Promise<Map<string, ViewModelAnalysis>> {
    const results = new Map<string, ViewModelAnalysis>();
    const csFiles = await this.findFiles('**/*.cs');

    for (const csPath of csFiles) {
      const fullPath = path.join(this.config.rootDir, csPath);

      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const result = await this.viewModelExtractor.extract(fullPath, content);

        if (result) {
          results.set(result.className, result);

          if (this.config.verbose) {
            console.log(`  Found ViewModel: ${result.className} (${result.properties.length} properties, ${result.commands.length} commands)`);
          }
        }
      } catch (error) {
        if (this.config.verbose) {
          console.error(`  Error analyzing ${csPath}: ${error}`);
        }
      }
    }

    return results;
  }

  /**
   * Link all bindings to ViewModels
   */
  private async linkAllBindings(
    xamlFiles: Map<string, XamlExtractionResult>,
    viewModels: Map<string, ViewModelAnalysis>,
    dataContexts: DataContextResolution[]
  ): Promise<{ links: ViewModelLink[]; bindingErrors: BindingError[] }> {
    const allLinks: ViewModelLink[] = [];
    const allErrors: BindingError[] = [];

    // Create a map of XAML file to resolved ViewModel
    const xamlToViewModel = new Map<string, ViewModelAnalysis | null>();
    for (const dc of dataContexts) {
      const vm = dc.resolvedType ? viewModels.get(dc.resolvedType) ?? null : null;
      xamlToViewModel.set(dc.xamlFile, vm);
    }

    // Link each XAML file
    for (const [xamlPath, xamlResult] of xamlFiles) {
      const viewModel = xamlToViewModel.get(xamlPath) ?? null;
      const linkingResult = this.viewModelLinker.linkBindings(xamlPath, xamlResult, viewModel);

      allLinks.push(...linkingResult.links);

      // Convert unresolved bindings to binding errors
      for (const unresolved of linkingResult.unresolved) {
        allErrors.push({
          type: viewModel ? 'missing-property' : 'missing-datacontext',
          xamlFile: unresolved.xamlFile,
          line: unresolved.location.line,
          bindingPath: unresolved.bindingPath,
          message: unresolved.reason,
          suggestion: unresolved.suggestion,
        });
      }
    }

    return { links: allLinks, bindingErrors: allErrors };
  }

  /**
   * Calculate analysis statistics
   */
  private calculateStats(
    xamlFiles: Map<string, XamlExtractionResult>,
    viewModels: Map<string, ViewModelAnalysis>,
    links: ViewModelLink[],
    bindingErrors: BindingError[],
    startTime: number
  ): WpfAnalysisStats {
    let totalBindings = 0;
    let totalCommands = 0;

    for (const result of xamlFiles.values()) {
      totalBindings += result.bindings.length;
      totalCommands += result.commands.length;
    }

    return {
      xamlFileCount: xamlFiles.size,
      viewModelCount: viewModels.size,
      totalBindings,
      resolvedBindings: links.length,
      unresolvedBindings: bindingErrors.length,
      totalCommands,
      analysisTimeMs: performance.now() - startTime,
    };
  }


  /**
   * Check MVVM compliance
   */
  async checkMvvmCompliance(): Promise<MvvmComplianceResult> {
    const violations: MvvmViolation[] = [];
    const analysisResult = await this.analyze();

    // Check ViewModels for INPC
    for (const vm of analysisResult.viewModels.values()) {
      if (!vm.implementsINPC) {
        violations.push({
          type: 'missing-inpc',
          severity: 'warning',
          file: vm.filePath,
          line: vm.startLine,
          message: `ViewModel ${vm.className} does not implement INotifyPropertyChanged`,
          suggestion: 'Implement INotifyPropertyChanged or inherit from a base class that does',
        });
      }

      // Check properties for PropertyChanged notification
      for (const prop of vm.properties) {
        if (prop.hasSetter && !prop.raisesPropertyChanged && !prop.isSourceGenerated) {
          violations.push({
            type: 'property-without-notification',
            severity: 'warning',
            file: vm.filePath,
            line: prop.location.line,
            message: `Property '${prop.name}' has a setter but does not raise PropertyChanged`,
            suggestion: 'Add OnPropertyChanged call in setter or use [ObservableProperty] attribute',
          });
        }
      }
    }

    // Calculate score
    const maxScore = 100;
    const deductions = violations.reduce((sum, v) => {
      switch (v.severity) {
        case 'error': return sum + 15;
        case 'warning': return sum + 5;
        case 'info': return sum + 1;
        default: return sum;
      }
    }, 0);

    const score = Math.max(0, maxScore - deductions);

    // Generate recommendations
    const recommendations: string[] = [];
    if (violations.some(v => v.type === 'missing-inpc')) {
      recommendations.push('Consider using a base ViewModel class that implements INotifyPropertyChanged');
    }
    if (violations.some(v => v.type === 'property-without-notification')) {
      recommendations.push('Use MVVM Toolkit [ObservableProperty] attribute for automatic property notification');
    }

    return {
      score,
      violations,
      recommendations,
    };
  }

  /**
   * Get all bindings with their resolution status
   */
  async getBindingsReport(): Promise<{
    resolved: ViewModelLink[];
    unresolved: BindingError[];
    stats: { total: number; resolved: number; unresolved: number };
  }> {
    const result = await this.analyze();

    return {
      resolved: result.links,
      unresolved: result.bindingErrors,
      stats: {
        total: result.stats.totalBindings,
        resolved: result.stats.resolvedBindings,
        unresolved: result.stats.unresolvedBindings,
      },
    };
  }
}

/**
 * Factory function
 */
export function createWpfAnalyzer(config: WpfAnalyzerConfig): WpfAnalyzer {
  return new WpfAnalyzer(config);
}
