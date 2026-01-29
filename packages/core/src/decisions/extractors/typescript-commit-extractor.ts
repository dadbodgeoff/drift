/**
 * TypeScript/JavaScript Commit Extractor
 *
 * Extracts semantic information from TypeScript and JavaScript code changes.
 * Detects framework-specific patterns for React, Express, NestJS, etc.
 */

import {
  BaseCommitExtractor,
  type CommitExtractorOptions,
  type ExtractionContext,
} from './base-commit-extractor.js';

import type {
  GitCommit,
  ArchitecturalSignal,
  DecisionLanguage,
} from '../types.js';

// ============================================================================
// TypeScript-Specific Patterns
// ============================================================================

/**
 * Patterns that indicate architectural changes in TypeScript/JavaScript
 */
const TS_ARCHITECTURAL_PATTERNS: Array<{
  filePattern: RegExp;
  signalType: ArchitecturalSignal['type'];
  description: string;
  confidence: number;
}> = [
  // React patterns
  {
    filePattern: /\/(components|pages|views)\/.*\.(tsx|jsx)$/,
    signalType: 'layer-change',
    description: 'React component layer change',
    confidence: 0.5,
  },
  {
    filePattern: /\/(hooks|use[A-Z]).*\.(ts|tsx)$/,
    signalType: 'new-abstraction',
    description: 'React hook abstraction',
    confidence: 0.6,
  },
  {
    filePattern: /\/(context|providers?)\/.*\.(tsx?)$/,
    signalType: 'new-abstraction',
    description: 'React context/provider pattern',
    confidence: 0.7,
  },
  // Express/Fastify patterns
  {
    filePattern: /\/(routes?|controllers?)\/.*\.(ts|js)$/,
    signalType: 'api-surface-change',
    description: 'Express/Fastify route change',
    confidence: 0.7,
  },
  {
    filePattern: /\/(middleware)\/.*\.(ts|js)$/,
    signalType: 'layer-change',
    description: 'Middleware layer change',
    confidence: 0.6,
  },
  // NestJS patterns
  {
    filePattern: /\.controller\.(ts)$/,
    signalType: 'api-surface-change',
    description: 'NestJS controller change',
    confidence: 0.8,
  },
  {
    filePattern: /\.service\.(ts)$/,
    signalType: 'layer-change',
    description: 'NestJS service layer change',
    confidence: 0.6,
  },
  {
    filePattern: /\.module\.(ts)$/,
    signalType: 'config-change',
    description: 'NestJS module configuration',
    confidence: 0.7,
  },
  {
    filePattern: /\.guard\.(ts)$/,
    signalType: 'auth-change',
    description: 'NestJS guard (auth) change',
    confidence: 0.8,
  },
  // Data layer patterns
  {
    filePattern: /\/(models?|entities|schemas?)\/.*\.(ts|js)$/,
    signalType: 'data-model-change',
    description: 'Data model change',
    confidence: 0.7,
  },
  {
    filePattern: /\/(repositories|daos?)\/.*\.(ts|js)$/,
    signalType: 'data-model-change',
    description: 'Data access layer change',
    confidence: 0.6,
  },
  {
    filePattern: /\/migrations?\/.*\.(ts|js)$/,
    signalType: 'data-model-change',
    description: 'Database migration',
    confidence: 0.9,
  },
  // Error handling
  {
    filePattern: /\/(errors?|exceptions?)\/.*\.(ts|js)$/,
    signalType: 'error-handling-change',
    description: 'Error handling change',
    confidence: 0.7,
  },
  // Configuration
  {
    filePattern: /\/(config|settings)\/.*\.(ts|js)$/,
    signalType: 'config-change',
    description: 'Configuration change',
    confidence: 0.5,
  },
  // Testing
  {
    filePattern: /\/__tests__\/.*\.(ts|tsx|js|jsx)$/,
    signalType: 'test-strategy-change',
    description: 'Test file change',
    confidence: 0.4,
  },
  {
    filePattern: /\.(test|spec)\.(ts|tsx|js|jsx)$/,
    signalType: 'test-strategy-change',
    description: 'Test file change',
    confidence: 0.4,
  },
];

/**
 * File name patterns that suggest entry points
 */
const TS_ENTRY_POINT_PATTERNS = [
  /\.controller\.(ts|js)$/,
  /\.handler\.(ts|js)$/,
  /\/(routes?|api)\/.*\.(ts|js)$/,
  /\/pages\/.*\.(tsx|jsx)$/,
  /\/app\/.*\/page\.(tsx|jsx)$/, // Next.js App Router
  /index\.(ts|tsx|js|jsx)$/,
  /main\.(ts|js)$/,
  /server\.(ts|js)$/,
];

// ============================================================================
// TypeScript Commit Extractor
// ============================================================================

/**
 * TypeScript/JavaScript commit extractor
 */
export class TypeScriptCommitExtractor extends BaseCommitExtractor {
  readonly language: DecisionLanguage = 'typescript';
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

  constructor(options: CommitExtractorOptions) {
    super(options);
  }

  /**
   * Extract architectural signals with TypeScript-specific detection
   */
  protected override async extractArchitecturalSignals(
    context: ExtractionContext
  ): Promise<ArchitecturalSignal[]> {
    const signals: ArchitecturalSignal[] = [];

    for (const file of context.relevantFiles) {
      // Check TypeScript-specific patterns
      for (const pattern of TS_ARCHITECTURAL_PATTERNS) {
        if (pattern.filePattern.test(file.path)) {
          signals.push({
            type: pattern.signalType,
            description: `${pattern.description}: ${file.path}`,
            files: [file.path],
            confidence: this.adjustConfidence(pattern.confidence, file),
          });
        }
      }

      // Detect interface/type additions
      if (file.status === 'added' && this.isTypeDefinitionFile(file.path)) {
        signals.push({
          type: 'new-abstraction',
          description: `New type definitions: ${file.path}`,
          files: [file.path],
          confidence: 0.7,
        });
      }

      // Detect barrel file changes (index.ts exports)
      if (file.path.endsWith('index.ts') || file.path.endsWith('index.js')) {
        if (file.additions > 5 || file.deletions > 5) {
          signals.push({
            type: 'api-surface-change',
            description: `Module exports changed: ${file.path}`,
            files: [file.path],
            confidence: 0.5,
          });
        }
      }
    }

    // Add base class signals
    const baseSignals = await super.extractArchitecturalSignals(context);
    signals.push(...baseSignals);

    return this.deduplicateSignals(signals);
  }

  /**
   * Check if file is likely an entry point
   */
  protected override isLikelyEntryPoint(filePath: string): boolean {
    return TS_ENTRY_POINT_PATTERNS.some(pattern => pattern.test(filePath));
  }

  /**
   * Check if file is a type definition file
   */
  private isTypeDefinitionFile(filePath: string): boolean {
    return (
      filePath.endsWith('.d.ts') ||
      filePath.includes('/types/') ||
      filePath.includes('/interfaces/') ||
      filePath.includes('.types.ts') ||
      filePath.includes('.interface.ts')
    );
  }

  /**
   * Adjust confidence based on file change magnitude
   */
  private adjustConfidence(
    baseConfidence: number,
    file: GitCommit['files'][0]
  ): number {
    let confidence = baseConfidence;

    // Boost for new files
    if (file.status === 'added') {
      confidence += 0.1;
    }

    // Boost for significant changes
    if (file.additions + file.deletions > 50) {
      confidence += 0.1;
    }

    // Reduce for test files
    if (file.isTest) {
      confidence -= 0.2;
    }

    return Math.max(0.1, Math.min(1, confidence));
  }
}

/**
 * Create a TypeScript commit extractor
 */
export function createTypeScriptCommitExtractor(
  options: CommitExtractorOptions
): TypeScriptCommitExtractor {
  return new TypeScriptCommitExtractor(options);
}
