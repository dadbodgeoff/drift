/**
 * PHP Commit Extractor
 *
 * Extracts semantic information from PHP code changes.
 * Detects framework-specific patterns for Laravel, Symfony, etc.
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
// PHP-Specific Patterns
// ============================================================================

const PHP_ARCHITECTURAL_PATTERNS: Array<{
  filePattern: RegExp;
  signalType: ArchitecturalSignal['type'];
  description: string;
  confidence: number;
}> = [
  // Laravel patterns
  {
    filePattern: /\/Controllers\/.*\.(php)$/,
    signalType: 'api-surface-change',
    description: 'Laravel Controller change',
    confidence: 0.8,
  },
  {
    filePattern: /Controller\.(php)$/,
    signalType: 'api-surface-change',
    description: 'Controller change',
    confidence: 0.7,
  },
  {
    filePattern: /\/Models\/.*\.(php)$/,
    signalType: 'data-model-change',
    description: 'Laravel Model change',
    confidence: 0.7,
  },
  {
    filePattern: /\/Eloquent\/.*\.(php)$/,
    signalType: 'data-model-change',
    description: 'Eloquent model change',
    confidence: 0.7,
  },
  {
    filePattern: /\/migrations\/.*\.(php)$/,
    signalType: 'data-model-change',
    description: 'Laravel migration',
    confidence: 0.9,
  },
  {
    filePattern: /\/database\/migrations\/.*\.(php)$/,
    signalType: 'data-model-change',
    description: 'Database migration',
    confidence: 0.9,
  },
  {
    filePattern: /\/Middleware\/.*\.(php)$/,
    signalType: 'layer-change',
    description: 'Laravel Middleware change',
    confidence: 0.7,
  },
  {
    filePattern: /\/Providers\/.*\.(php)$/,
    signalType: 'config-change',
    description: 'Service Provider change',
    confidence: 0.7,
  },
  {
    filePattern: /\/routes\/.*\.(php)$/,
    signalType: 'api-surface-change',
    description: 'Route definition change',
    confidence: 0.8,
  },
  {
    filePattern: /\/Policies\/.*\.(php)$/,
    signalType: 'auth-change',
    description: 'Laravel Policy change',
    confidence: 0.8,
  },
  {
    filePattern: /\/Guards\/.*\.(php)$/,
    signalType: 'auth-change',
    description: 'Auth Guard change',
    confidence: 0.8,
  },
  {
    filePattern: /\/Jobs\/.*\.(php)$/,
    signalType: 'layer-change',
    description: 'Laravel Job change',
    confidence: 0.6,
  },
  {
    filePattern: /\/Events\/.*\.(php)$/,
    signalType: 'layer-change',
    description: 'Laravel Event change',
    confidence: 0.6,
  },
  {
    filePattern: /\/Listeners\/.*\.(php)$/,
    signalType: 'layer-change',
    description: 'Laravel Listener change',
    confidence: 0.6,
  },
  {
    filePattern: /\/Requests\/.*\.(php)$/,
    signalType: 'api-surface-change',
    description: 'Form Request change',
    confidence: 0.5,
  },
  {
    filePattern: /\/Resources\/.*\.(php)$/,
    signalType: 'api-surface-change',
    description: 'API Resource change',
    confidence: 0.5,
  },
  // Symfony patterns
  {
    filePattern: /\/Controller\/.*\.(php)$/,
    signalType: 'api-surface-change',
    description: 'Symfony Controller change',
    confidence: 0.7,
  },
  {
    filePattern: /\/Entity\/.*\.(php)$/,
    signalType: 'data-model-change',
    description: 'Doctrine Entity change',
    confidence: 0.8,
  },
  {
    filePattern: /\/Repository\/.*\.(php)$/,
    signalType: 'data-model-change',
    description: 'Repository change',
    confidence: 0.7,
  },
  {
    filePattern: /\/DoctrineMigrations\/.*\.(php)$/,
    signalType: 'data-model-change',
    description: 'Doctrine migration',
    confidence: 0.9,
  },
  {
    filePattern: /\/Service\/.*\.(php)$/,
    signalType: 'layer-change',
    description: 'Service class change',
    confidence: 0.6,
  },
  {
    filePattern: /\/EventSubscriber\/.*\.(php)$/,
    signalType: 'layer-change',
    description: 'Event Subscriber change',
    confidence: 0.6,
  },
  // General patterns
  {
    filePattern: /\/Exceptions\/.*\.(php)$/,
    signalType: 'error-handling-change',
    description: 'Exception class change',
    confidence: 0.7,
  },
  {
    filePattern: /Exception\.(php)$/,
    signalType: 'error-handling-change',
    description: 'Exception change',
    confidence: 0.6,
  },
  {
    filePattern: /\/Interfaces\/.*\.(php)$/,
    signalType: 'new-abstraction',
    description: 'Interface change',
    confidence: 0.7,
  },
  {
    filePattern: /Interface\.(php)$/,
    signalType: 'new-abstraction',
    description: 'Interface change',
    confidence: 0.6,
  },
  {
    filePattern: /\/Contracts\/.*\.(php)$/,
    signalType: 'new-abstraction',
    description: 'Contract/Interface change',
    confidence: 0.7,
  },
  {
    filePattern: /\/config\/.*\.(php)$/,
    signalType: 'config-change',
    description: 'Configuration change',
    confidence: 0.5,
  },
  // Testing
  {
    filePattern: /\/tests\/.*\.(php)$/,
    signalType: 'test-strategy-change',
    description: 'Test file change',
    confidence: 0.4,
  },
  {
    filePattern: /Test\.(php)$/,
    signalType: 'test-strategy-change',
    description: 'Test class change',
    confidence: 0.4,
  },
];

const PHP_ENTRY_POINT_PATTERNS = [
  /\/Controllers\/.*\.(php)$/,
  /Controller\.(php)$/,
  /\/routes\/.*\.(php)$/,
  /index\.(php)$/,
  /public\/index\.(php)$/,
];

// ============================================================================
// PHP Commit Extractor
// ============================================================================

export class PhpCommitExtractor extends BaseCommitExtractor {
  readonly language: DecisionLanguage = 'php';
  readonly extensions = ['.php', '.phtml'];

  constructor(options: CommitExtractorOptions) {
    super(options);
  }

  protected override async extractArchitecturalSignals(
    context: ExtractionContext
  ): Promise<ArchitecturalSignal[]> {
    const signals: ArchitecturalSignal[] = [];

    for (const file of context.relevantFiles) {
      // Check PHP-specific patterns
      for (const pattern of PHP_ARCHITECTURAL_PATTERNS) {
        if (pattern.filePattern.test(file.path)) {
          signals.push({
            type: pattern.signalType,
            description: `${pattern.description}: ${file.path}`,
            files: [file.path],
            confidence: this.adjustConfidence(pattern.confidence, file),
          });
        }
      }

      // Detect composer.json changes
      if (file.path === 'composer.json' || file.path.endsWith('/composer.json')) {
        signals.push({
          type: 'build-change',
          description: `Composer configuration change: ${file.path}`,
          files: [file.path],
          confidence: 0.7,
        });
      }

      // Detect new trait
      if (file.status === 'added' && file.path.includes('/Traits/')) {
        signals.push({
          type: 'new-abstraction',
          description: `New trait: ${file.path}`,
          files: [file.path],
          confidence: 0.7,
        });
      }

      // Detect new abstract class
      if (
        file.status === 'added' &&
        (file.path.includes('Abstract') || file.path.includes('/Base/'))
      ) {
        signals.push({
          type: 'new-abstraction',
          description: `New abstract class: ${file.path}`,
          files: [file.path],
          confidence: 0.7,
        });
      }
    }

    const baseSignals = await super.extractArchitecturalSignals(context);
    signals.push(...baseSignals);

    return this.deduplicateSignals(signals);
  }

  protected override isLikelyEntryPoint(filePath: string): boolean {
    return PHP_ENTRY_POINT_PATTERNS.some(pattern => pattern.test(filePath));
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

export function createPhpCommitExtractor(
  options: CommitExtractorOptions
): PhpCommitExtractor {
  return new PhpCommitExtractor(options);
}
