/**
 * Approach Generator
 *
 * Generates implementation approaches for a given task by:
 * 1. Detecting the task category from the description
 * 2. Detecting the project language and framework
 * 3. Using language-specific strategies to generate approaches
 * 4. Enriching approaches with target files from the codebase
 *
 * @module simulation/approach-generator
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  getStrategyProvider,
  detectTaskCategory,
  detectFramework,
  type StrategyTemplate,
} from './language-strategies/index.js';

import type {
  SimulationTask,
  SimulationApproach,
  TaskCategory,
} from './types.js';
import type { CallGraphLanguage, CallGraph } from '../call-graph/types.js';
import type { IPatternService } from '../patterns/service.js';

// ============================================================================
// Types
// ============================================================================

export interface ApproachGeneratorConfig {
  projectRoot: string;
  patternService?: IPatternService | undefined;
  callGraph?: CallGraph | undefined;
}

export interface GeneratedApproaches {
  approaches: SimulationApproach[];
  detectedLanguage: CallGraphLanguage;
  detectedFramework: string | null;
  detectedCategory: TaskCategory;
}

// ============================================================================
// Language Detection Helpers
// ============================================================================

const LANGUAGE_EXTENSIONS: Record<string, CallGraphLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.cs': 'csharp',
  '.php': 'php',
};

const FRAMEWORK_INDICATORS: Record<string, { language: CallGraphLanguage; framework: string }> = {
  'package.json': { language: 'typescript', framework: 'node' },
  'tsconfig.json': { language: 'typescript', framework: 'node' },
  'requirements.txt': { language: 'python', framework: 'python' },
  'pyproject.toml': { language: 'python', framework: 'python' },
  'pom.xml': { language: 'java', framework: 'maven' },
  'build.gradle': { language: 'java', framework: 'gradle' },
  'composer.json': { language: 'php', framework: 'composer' },
  '*.csproj': { language: 'csharp', framework: 'dotnet' },
};

// ============================================================================
// Approach Generator
// ============================================================================

/**
 * Generates implementation approaches for a task
 */
export class ApproachGenerator {
  private readonly config: ApproachGeneratorConfig;

  constructor(config: ApproachGeneratorConfig) {
    this.config = config;
  }

  /**
   * Generate approaches for a task
   */
  async generate(
    task: SimulationTask,
    maxApproaches: number = 5
  ): Promise<GeneratedApproaches> {
    // Step 1: Detect category if not provided
    const category = task.category || detectTaskCategory(task.description);

    // Step 2: Detect language and framework from codebase
    const { language, framework } = await this.detectLanguageAndFramework();

    // Step 3: Get strategy provider for the language
    const provider = getStrategyProvider(language);
    if (!provider) {
      return {
        approaches: [this.createFallbackApproach(task, category, language)],
        detectedLanguage: language,
        detectedFramework: framework,
        detectedCategory: category,
      };
    }

    // Step 4: Get applicable strategies
    const strategies = provider.getStrategies(category, framework ?? undefined);

    // Step 5: Find relevant files from call graph
    const relevantFiles = this.findRelevantFiles(task, category, language);

    // Step 6: Find relevant patterns
    const relevantPatterns = await this.findRelevantPatterns(category);

    // Step 7: Generate approaches from strategies
    const approaches: SimulationApproach[] = [];

    for (const strategy of strategies.slice(0, maxApproaches)) {
      const approach = this.createApproach(
        strategy,
        task,
        category,
        language,
        framework,
        relevantFiles,
        relevantPatterns
      );
      approaches.push(approach);
    }

    // Step 8: Add a custom approach if we have room
    if (approaches.length < maxApproaches && approaches.length > 0) {
      approaches.push(this.createCustomApproach(task, category, language, relevantFiles));
    }

    return {
      approaches,
      detectedLanguage: language,
      detectedFramework: framework,
      detectedCategory: category,
    };
  }

  // ==========================================================================
  // Language & Framework Detection
  // ==========================================================================

  /**
   * Detect the primary language and framework from the codebase
   */
  private async detectLanguageAndFramework(): Promise<{
    language: CallGraphLanguage;
    framework: string | null;
  }> {
    // If we have a call graph, use its language distribution
    if (this.config.callGraph) {
      const langCounts = new Map<CallGraphLanguage, number>();
      
      for (const [, func] of this.config.callGraph.functions) {
        const ext = path.extname(func.file);
        const lang = LANGUAGE_EXTENSIONS[ext];
        if (lang) {
          langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
        }
      }

      // Find dominant language
      let maxCount = 0;
      let dominantLang: CallGraphLanguage = 'typescript';
      for (const [lang, count] of langCounts) {
        if (count > maxCount) {
          maxCount = count;
          dominantLang = lang;
        }
      }

      // Try to detect framework from files
      const framework = await this.detectFrameworkFromFiles(dominantLang);
      return { language: dominantLang, framework };
    }

    // Fallback: scan project root for indicators
    try {
      const files = await fs.readdir(this.config.projectRoot);
      
      for (const file of files) {
        const indicator = FRAMEWORK_INDICATORS[file];
        if (indicator) {
          const framework = await this.detectFrameworkFromFiles(indicator.language);
          return { language: indicator.language, framework };
        }
      }
    } catch {
      // Ignore errors
    }

    return { language: 'typescript', framework: null };
  }

  /**
   * Detect specific framework from file contents
   */
  private async detectFrameworkFromFiles(language: CallGraphLanguage): Promise<string | null> {
    const { projectRoot } = this.config;

    try {
      switch (language) {
        case 'typescript':
        case 'javascript': {
          const pkgPath = path.join(projectRoot, 'package.json');
          const content = await fs.readFile(pkgPath, 'utf-8');
          return detectFramework(content, pkgPath, language);
        }
        case 'python': {
          // Check for Django, FastAPI, Flask
          const reqPath = path.join(projectRoot, 'requirements.txt');
          try {
            const content = await fs.readFile(reqPath, 'utf-8');
            return detectFramework(content, reqPath, language);
          } catch {
            // Try pyproject.toml
            const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
            const content = await fs.readFile(pyprojectPath, 'utf-8');
            return detectFramework(content, pyprojectPath, language);
          }
        }
        case 'java': {
          // Check for Spring Boot
          const pomPath = path.join(projectRoot, 'pom.xml');
          try {
            const content = await fs.readFile(pomPath, 'utf-8');
            return detectFramework(content, pomPath, language);
          } catch {
            const gradlePath = path.join(projectRoot, 'build.gradle');
            const content = await fs.readFile(gradlePath, 'utf-8');
            return detectFramework(content, gradlePath, language);
          }
        }
        case 'csharp': {
          // Check for ASP.NET Core
          const files = await fs.readdir(projectRoot);
          const csproj = files.find(f => f.endsWith('.csproj'));
          if (csproj) {
            const content = await fs.readFile(path.join(projectRoot, csproj), 'utf-8');
            return detectFramework(content, csproj, language);
          }
          break;
        }
        case 'php': {
          // Check for Laravel
          const composerPath = path.join(projectRoot, 'composer.json');
          const content = await fs.readFile(composerPath, 'utf-8');
          return detectFramework(content, composerPath, language);
        }
      }
    } catch {
      // Ignore errors
    }

    return null;
  }

  // ==========================================================================
  // File Discovery
  // ==========================================================================

  /**
   * Find relevant files for the task from the call graph
   */
  private findRelevantFiles(
    task: SimulationTask,
    category: TaskCategory,
    _language: CallGraphLanguage
  ): string[] {
    const files: string[] = [];

    if (!this.config.callGraph) {
      return files;
    }

    // If task has a specific target, find files related to it
    if (task.target) {
      for (const [, func] of this.config.callGraph.functions) {
        if (
          func.file.includes(task.target) ||
          func.name.toLowerCase().includes(task.target.toLowerCase()) ||
          func.qualifiedName.toLowerCase().includes(task.target.toLowerCase())
        ) {
          if (!files.includes(func.file)) {
            files.push(func.file);
          }
        }
      }
    }

    // Find files by category keywords
    const categoryKeywords = this.getCategoryKeywords(category);
    for (const [, func] of this.config.callGraph.functions) {
      const funcText = `${func.file} ${func.name} ${func.qualifiedName}`.toLowerCase();
      for (const keyword of categoryKeywords) {
        if (funcText.includes(keyword) && !files.includes(func.file)) {
          files.push(func.file);
          break;
        }
      }
    }

    // Limit to reasonable number
    return files.slice(0, 20);
  }

  /**
   * Get keywords for a category
   */
  private getCategoryKeywords(category: TaskCategory): string[] {
    const keywords: Record<TaskCategory, string[]> = {
      'rate-limiting': ['rate', 'limit', 'throttle', 'quota'],
      'authentication': ['auth', 'login', 'session', 'token', 'jwt'],
      'authorization': ['permission', 'role', 'access', 'policy', 'guard'],
      'api-endpoint': ['route', 'endpoint', 'controller', 'handler', 'api'],
      'data-access': ['repository', 'dao', 'model', 'entity', 'query'],
      'error-handling': ['error', 'exception', 'catch', 'handler'],
      'caching': ['cache', 'redis', 'memcache', 'store'],
      'logging': ['log', 'logger', 'trace', 'debug'],
      'testing': ['test', 'spec', 'mock', 'stub'],
      'validation': ['valid', 'schema', 'sanitize', 'check'],
      'middleware': ['middleware', 'interceptor', 'filter', 'pipe'],
      'refactoring': [],
      'generic': [],
    };
    return keywords[category] ?? [];
  }

  // ==========================================================================
  // Pattern Discovery
  // ==========================================================================

  /**
   * Find relevant patterns for the category
   */
  private async findRelevantPatterns(category: TaskCategory): Promise<string[]> {
    if (!this.config.patternService) {
      return [];
    }

    try {
      const result = await this.config.patternService.listByCategory(category as any, {
        limit: 10,
      });
      return result.items.map(p => p.id);
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // Approach Creation
  // ==========================================================================

  /**
   * Create an approach from a strategy template
   */
  private createApproach(
    strategy: StrategyTemplate,
    _task: SimulationTask,
    _category: TaskCategory,
    language: CallGraphLanguage,
    framework: string | null,
    relevantFiles: string[],
    relevantPatterns: string[]
  ): SimulationApproach {
    const id = `${strategy.strategy}-${language}-${Date.now()}`;

    // Estimate lines based on strategy complexity
    const complexityMultiplier: Record<string, number> = {
      middleware: 1.2,
      decorator: 0.8,
      wrapper: 1.0,
      'per-route': 1.5,
      'per-function': 1.8,
      centralized: 0.7,
      distributed: 1.5,
      aspect: 0.9,
      filter: 1.0,
      interceptor: 1.1,
      guard: 0.9,
      policy: 1.0,
      dependency: 0.8,
      mixin: 0.7,
      custom: 1.3,
    };

    const baseLines = 50;
    const multiplier = complexityMultiplier[strategy.strategy] ?? 1.0;
    const estimatedLines = Math.round(baseLines * multiplier);

    const approach: SimulationApproach = {
      id,
      name: strategy.name,
      description: strategy.description,
      strategy: strategy.strategy,
      language,
      targetFiles: relevantFiles.slice(0, 5),
      followsPatterns: relevantPatterns.slice(0, 3),
      estimatedLinesAdded: estimatedLines,
      estimatedLinesModified: Math.round(relevantFiles.length * 5),
    };

    if (framework) {
      approach.framework = framework;
    }
    if (strategy.newFiles) {
      approach.newFiles = strategy.newFiles;
    }
    if (strategy.template) {
      approach.template = strategy.template;
    }
    if (strategy.frameworkNotes) {
      approach.frameworkNotes = strategy.frameworkNotes;
    }

    return approach;
  }

  /**
   * Create a custom/hybrid approach
   */
  private createCustomApproach(
    task: SimulationTask,
    _category: TaskCategory,
    language: CallGraphLanguage,
    relevantFiles: string[]
  ): SimulationApproach {
    return {
      id: `custom-${language}-${Date.now()}`,
      name: 'Custom Implementation',
      description: `A custom implementation tailored to the specific requirements of: ${task.description}`,
      strategy: 'custom',
      language,
      targetFiles: relevantFiles.slice(0, 3),
      estimatedLinesAdded: 80,
      estimatedLinesModified: Math.round(relevantFiles.length * 8),
    };
  }

  /**
   * Create a fallback approach when no strategies are available
   */
  private createFallbackApproach(
    _task: SimulationTask,
    category: TaskCategory,
    language: CallGraphLanguage
  ): SimulationApproach {
    return {
      id: `fallback-${language}-${Date.now()}`,
      name: 'Generic Implementation',
      description: `A generic implementation for ${category} in ${language}. No specific framework strategies available.`,
      strategy: 'custom',
      language,
      targetFiles: [],
      estimatedLinesAdded: 100,
      estimatedLinesModified: 20,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an approach generator
 */
export function createApproachGenerator(config: ApproachGeneratorConfig): ApproachGenerator {
  return new ApproachGenerator(config);
}