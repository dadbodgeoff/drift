/**
 * C# Commit Extractor
 *
 * Extracts semantic information from C# code changes.
 * Detects framework-specific patterns for ASP.NET Core, Entity Framework, etc.
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
// C#-Specific Patterns
// ============================================================================

const CSHARP_ARCHITECTURAL_PATTERNS: Array<{
  filePattern: RegExp;
  signalType: ArchitecturalSignal['type'];
  description: string;
  confidence: number;
}> = [
  // ASP.NET Core patterns
  {
    filePattern: /Controller\.(cs)$/,
    signalType: 'api-surface-change',
    description: 'ASP.NET Controller change',
    confidence: 0.8,
  },
  {
    filePattern: /ApiController\.(cs)$/,
    signalType: 'api-surface-change',
    description: 'ASP.NET API Controller change',
    confidence: 0.8,
  },
  {
    filePattern: /\/Controllers\/.*\.(cs)$/,
    signalType: 'api-surface-change',
    description: 'Controller folder change',
    confidence: 0.7,
  },
  // Service layer
  {
    filePattern: /Service\.(cs)$/,
    signalType: 'layer-change',
    description: 'Service class change',
    confidence: 0.6,
  },
  {
    filePattern: /\/Services\/.*\.(cs)$/,
    signalType: 'layer-change',
    description: 'Service folder change',
    confidence: 0.5,
  },
  // Repository pattern
  {
    filePattern: /Repository\.(cs)$/,
    signalType: 'data-model-change',
    description: 'Repository change',
    confidence: 0.7,
  },
  {
    filePattern: /\/Repositories\/.*\.(cs)$/,
    signalType: 'data-model-change',
    description: 'Repository folder change',
    confidence: 0.6,
  },
  // Entity Framework
  {
    filePattern: /DbContext\.(cs)$/,
    signalType: 'data-model-change',
    description: 'DbContext change',
    confidence: 0.9,
  },
  {
    filePattern: /\/Entities\/.*\.(cs)$/,
    signalType: 'data-model-change',
    description: 'Entity change',
    confidence: 0.7,
  },
  {
    filePattern: /\/Models\/.*\.(cs)$/,
    signalType: 'data-model-change',
    description: 'Model change',
    confidence: 0.6,
  },
  {
    filePattern: /\/Migrations\/.*\.(cs)$/,
    signalType: 'data-model-change',
    description: 'EF Migration',
    confidence: 0.9,
  },
  // DTOs
  {
    filePattern: /Dto\.(cs)$/,
    signalType: 'api-surface-change',
    description: 'DTO change',
    confidence: 0.5,
  },
  {
    filePattern: /ViewModel\.(cs)$/,
    signalType: 'api-surface-change',
    description: 'ViewModel change',
    confidence: 0.5,
  },
  {
    filePattern: /\/Dtos\/.*\.(cs)$/,
    signalType: 'api-surface-change',
    description: 'DTO folder change',
    confidence: 0.5,
  },
  // Configuration
  {
    filePattern: /Startup\.(cs)$/,
    signalType: 'config-change',
    description: 'Startup configuration change',
    confidence: 0.8,
  },
  {
    filePattern: /Program\.(cs)$/,
    signalType: 'config-change',
    description: 'Program configuration change',
    confidence: 0.7,
  },
  {
    filePattern: /appsettings.*\.(json)$/,
    signalType: 'config-change',
    description: 'App settings change',
    confidence: 0.6,
  },
  // Middleware
  {
    filePattern: /Middleware\.(cs)$/,
    signalType: 'layer-change',
    description: 'Middleware change',
    confidence: 0.7,
  },
  {
    filePattern: /\/Middleware\/.*\.(cs)$/,
    signalType: 'layer-change',
    description: 'Middleware folder change',
    confidence: 0.6,
  },
  // Authentication/Authorization
  {
    filePattern: /AuthHandler\.(cs)$/,
    signalType: 'auth-change',
    description: 'Auth handler change',
    confidence: 0.8,
  },
  {
    filePattern: /\/Authorization\/.*\.(cs)$/,
    signalType: 'auth-change',
    description: 'Authorization folder change',
    confidence: 0.7,
  },
  {
    filePattern: /\/Authentication\/.*\.(cs)$/,
    signalType: 'auth-change',
    description: 'Authentication folder change',
    confidence: 0.7,
  },
  // Exception handling
  {
    filePattern: /Exception\.(cs)$/,
    signalType: 'error-handling-change',
    description: 'Custom exception change',
    confidence: 0.7,
  },
  {
    filePattern: /ExceptionHandler\.(cs)$/,
    signalType: 'error-handling-change',
    description: 'Exception handler change',
    confidence: 0.8,
  },
  {
    filePattern: /\/Exceptions\/.*\.(cs)$/,
    signalType: 'error-handling-change',
    description: 'Exceptions folder change',
    confidence: 0.6,
  },
  // Interfaces
  {
    filePattern: /^I[A-Z].*\.(cs)$/,
    signalType: 'new-abstraction',
    description: 'Interface change',
    confidence: 0.6,
  },
  {
    filePattern: /\/Interfaces\/.*\.(cs)$/,
    signalType: 'new-abstraction',
    description: 'Interface folder change',
    confidence: 0.7,
  },
  // Testing
  {
    filePattern: /Tests?\.(cs)$/,
    signalType: 'test-strategy-change',
    description: 'Test class change',
    confidence: 0.4,
  },
  {
    filePattern: /\.Tests\/.*\.(cs)$/,
    signalType: 'test-strategy-change',
    description: 'Test project change',
    confidence: 0.4,
  },
];

const CSHARP_ENTRY_POINT_PATTERNS = [
  /Controller\.(cs)$/,
  /ApiController\.(cs)$/,
  /\/Controllers\/.*\.(cs)$/,
  /Program\.(cs)$/,
  /Startup\.(cs)$/,
];

// ============================================================================
// C# Commit Extractor
// ============================================================================

export class CSharpCommitExtractor extends BaseCommitExtractor {
  readonly language: DecisionLanguage = 'csharp';
  readonly extensions = ['.cs'];

  constructor(options: CommitExtractorOptions) {
    super(options);
  }

  protected override async extractArchitecturalSignals(
    context: ExtractionContext
  ): Promise<ArchitecturalSignal[]> {
    const signals: ArchitecturalSignal[] = [];

    for (const file of context.relevantFiles) {
      // Check C#-specific patterns
      for (const pattern of CSHARP_ARCHITECTURAL_PATTERNS) {
        if (pattern.filePattern.test(file.path)) {
          signals.push({
            type: pattern.signalType,
            description: `${pattern.description}: ${file.path}`,
            files: [file.path],
            confidence: this.adjustConfidence(pattern.confidence, file),
          });
        }
      }

      // Detect .csproj changes (project structure)
      if (file.path.endsWith('.csproj')) {
        signals.push({
          type: 'build-change',
          description: `Project file change: ${file.path}`,
          files: [file.path],
          confidence: 0.7,
        });
      }

      // Detect solution file changes
      if (file.path.endsWith('.sln')) {
        signals.push({
          type: 'build-change',
          description: `Solution file change: ${file.path}`,
          files: [file.path],
          confidence: 0.8,
        });
      }

      // Detect new interface (I prefix convention)
      if (
        file.status === 'added' &&
        /\/I[A-Z][a-zA-Z]+\.(cs)$/.test(file.path)
      ) {
        signals.push({
          type: 'new-abstraction',
          description: `New interface: ${file.path}`,
          files: [file.path],
          confidence: 0.8,
        });
      }
    }

    const baseSignals = await super.extractArchitecturalSignals(context);
    signals.push(...baseSignals);

    return this.deduplicateSignals(signals);
  }

  protected override isLikelyEntryPoint(filePath: string): boolean {
    return CSHARP_ENTRY_POINT_PATTERNS.some(pattern => pattern.test(filePath));
  }

  private adjustConfidence(
    baseConfidence: number,
    file: GitCommit['files'][0]
  ): number {
    let confidence = baseConfidence;

    if (file.status === 'added') {
      confidence += 0.1;
    }

    if (file.additions + file.deletions > 50) {
      confidence += 0.1;
    }

    if (file.isTest) {
      confidence -= 0.2;
    }

    return Math.max(0.1, Math.min(1, confidence));
  }
}

export function createCSharpCommitExtractor(
  options: CommitExtractorOptions
): CSharpCommitExtractor {
  return new CSharpCommitExtractor(options);
}
