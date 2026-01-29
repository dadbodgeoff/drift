/**
 * Java Commit Extractor
 *
 * Extracts semantic information from Java code changes.
 * Detects framework-specific patterns for Spring Boot, JPA, etc.
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
// Java-Specific Patterns
// ============================================================================

const JAVA_ARCHITECTURAL_PATTERNS: Array<{
  filePattern: RegExp;
  signalType: ArchitecturalSignal['type'];
  description: string;
  confidence: number;
}> = [
  // Spring Boot patterns
  {
    filePattern: /Controller\.(java)$/,
    signalType: 'api-surface-change',
    description: 'Spring Controller change',
    confidence: 0.8,
  },
  {
    filePattern: /RestController\.(java)$/,
    signalType: 'api-surface-change',
    description: 'Spring REST Controller change',
    confidence: 0.8,
  },
  {
    filePattern: /Service\.(java)$/,
    signalType: 'layer-change',
    description: 'Spring Service change',
    confidence: 0.6,
  },
  {
    filePattern: /ServiceImpl\.(java)$/,
    signalType: 'layer-change',
    description: 'Spring Service implementation change',
    confidence: 0.6,
  },
  {
    filePattern: /Repository\.(java)$/,
    signalType: 'data-model-change',
    description: 'Spring Repository change',
    confidence: 0.7,
  },
  {
    filePattern: /Configuration\.(java)$/,
    signalType: 'config-change',
    description: 'Spring Configuration change',
    confidence: 0.7,
  },
  {
    filePattern: /Config\.(java)$/,
    signalType: 'config-change',
    description: 'Configuration class change',
    confidence: 0.6,
  },
  {
    filePattern: /SecurityConfig\.(java)$/,
    signalType: 'auth-change',
    description: 'Spring Security configuration',
    confidence: 0.9,
  },
  // JPA/Hibernate patterns
  {
    filePattern: /Entity\.(java)$/,
    signalType: 'data-model-change',
    description: 'JPA Entity change',
    confidence: 0.8,
  },
  {
    filePattern: /\/entities?\/.*\.(java)$/,
    signalType: 'data-model-change',
    description: 'Entity package change',
    confidence: 0.7,
  },
  {
    filePattern: /\/models?\/.*\.(java)$/,
    signalType: 'data-model-change',
    description: 'Model package change',
    confidence: 0.6,
  },
  // DTO patterns
  {
    filePattern: /Dto\.(java)$/,
    signalType: 'api-surface-change',
    description: 'DTO change',
    confidence: 0.5,
  },
  {
    filePattern: /Request\.(java)$/,
    signalType: 'api-surface-change',
    description: 'Request DTO change',
    confidence: 0.5,
  },
  {
    filePattern: /Response\.(java)$/,
    signalType: 'api-surface-change',
    description: 'Response DTO change',
    confidence: 0.5,
  },
  // Exception handling
  {
    filePattern: /Exception\.(java)$/,
    signalType: 'error-handling-change',
    description: 'Custom exception change',
    confidence: 0.7,
  },
  {
    filePattern: /ExceptionHandler\.(java)$/,
    signalType: 'error-handling-change',
    description: 'Exception handler change',
    confidence: 0.8,
  },
  {
    filePattern: /ControllerAdvice\.(java)$/,
    signalType: 'error-handling-change',
    description: 'Controller advice change',
    confidence: 0.8,
  },
  // Middleware/Filters
  {
    filePattern: /Filter\.(java)$/,
    signalType: 'layer-change',
    description: 'Filter change',
    confidence: 0.6,
  },
  {
    filePattern: /Interceptor\.(java)$/,
    signalType: 'layer-change',
    description: 'Interceptor change',
    confidence: 0.6,
  },
  // Migrations
  {
    filePattern: /\/db\/migration\/.*\.(java|sql)$/,
    signalType: 'data-model-change',
    description: 'Flyway migration',
    confidence: 0.9,
  },
  {
    filePattern: /\/liquibase\/.*\.(xml|yaml|sql)$/,
    signalType: 'data-model-change',
    description: 'Liquibase migration',
    confidence: 0.9,
  },
  // Testing
  {
    filePattern: /Test\.(java)$/,
    signalType: 'test-strategy-change',
    description: 'Test class change',
    confidence: 0.4,
  },
  {
    filePattern: /Tests\.(java)$/,
    signalType: 'test-strategy-change',
    description: 'Test class change',
    confidence: 0.4,
  },
  {
    filePattern: /IT\.(java)$/,
    signalType: 'test-strategy-change',
    description: 'Integration test change',
    confidence: 0.5,
  },
];

const JAVA_ENTRY_POINT_PATTERNS = [
  /Controller\.(java)$/,
  /RestController\.(java)$/,
  /Resource\.(java)$/,
  /Endpoint\.(java)$/,
  /Application\.(java)$/,
  /Main\.(java)$/,
];

// ============================================================================
// Java Commit Extractor
// ============================================================================

export class JavaCommitExtractor extends BaseCommitExtractor {
  readonly language: DecisionLanguage = 'java';
  readonly extensions = ['.java'];

  constructor(options: CommitExtractorOptions) {
    super(options);
  }

  protected override async extractArchitecturalSignals(
    context: ExtractionContext
  ): Promise<ArchitecturalSignal[]> {
    const signals: ArchitecturalSignal[] = [];

    for (const file of context.relevantFiles) {
      // Check Java-specific patterns
      for (const pattern of JAVA_ARCHITECTURAL_PATTERNS) {
        if (pattern.filePattern.test(file.path)) {
          signals.push({
            type: pattern.signalType,
            description: `${pattern.description}: ${file.path}`,
            files: [file.path],
            confidence: this.adjustConfidence(pattern.confidence, file),
          });
        }
      }

      // Detect interface additions
      if (file.status === 'added' && file.path.includes('/interfaces/')) {
        signals.push({
          type: 'new-abstraction',
          description: `New interface: ${file.path}`,
          files: [file.path],
          confidence: 0.8,
        });
      }

      // Detect abstract class additions
      if (
        file.status === 'added' &&
        (file.path.includes('Abstract') || file.path.includes('/base/'))
      ) {
        signals.push({
          type: 'new-abstraction',
          description: `New abstract class: ${file.path}`,
          files: [file.path],
          confidence: 0.7,
        });
      }

      // Detect package-info.java changes (package documentation/annotations)
      if (file.path.endsWith('package-info.java')) {
        signals.push({
          type: 'layer-change',
          description: `Package metadata change: ${file.path}`,
          files: [file.path],
          confidence: 0.5,
        });
      }
    }

    const baseSignals = await super.extractArchitecturalSignals(context);
    signals.push(...baseSignals);

    return this.deduplicateSignals(signals);
  }

  protected override isLikelyEntryPoint(filePath: string): boolean {
    return JAVA_ENTRY_POINT_PATTERNS.some(pattern => pattern.test(filePath));
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

export function createJavaCommitExtractor(
  options: CommitExtractorOptions
): JavaCommitExtractor {
  return new JavaCommitExtractor(options);
}
