/**
 * Python Commit Extractor
 *
 * Extracts semantic information from Python code changes.
 * Detects framework-specific patterns for Django, FastAPI, Flask, etc.
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
// Python-Specific Patterns
// ============================================================================

const PYTHON_ARCHITECTURAL_PATTERNS: Array<{
  filePattern: RegExp;
  signalType: ArchitecturalSignal['type'];
  description: string;
  confidence: number;
}> = [
  // Django patterns
  {
    filePattern: /\/views?\.(py)$/,
    signalType: 'api-surface-change',
    description: 'Django view change',
    confidence: 0.7,
  },
  {
    filePattern: /\/models?\.(py)$/,
    signalType: 'data-model-change',
    description: 'Django model change',
    confidence: 0.8,
  },
  {
    filePattern: /\/urls?\.(py)$/,
    signalType: 'api-surface-change',
    description: 'Django URL routing change',
    confidence: 0.7,
  },
  {
    filePattern: /\/serializers?\.(py)$/,
    signalType: 'api-surface-change',
    description: 'Django REST serializer change',
    confidence: 0.6,
  },
  {
    filePattern: /\/admin\.(py)$/,
    signalType: 'config-change',
    description: 'Django admin configuration',
    confidence: 0.5,
  },
  {
    filePattern: /\/migrations\/.*\.(py)$/,
    signalType: 'data-model-change',
    description: 'Django migration',
    confidence: 0.9,
  },
  {
    filePattern: /\/middleware\.(py)$/,
    signalType: 'layer-change',
    description: 'Django middleware change',
    confidence: 0.7,
  },
  // FastAPI patterns
  {
    filePattern: /\/(routers?|endpoints?)\/.*\.(py)$/,
    signalType: 'api-surface-change',
    description: 'FastAPI router change',
    confidence: 0.7,
  },
  {
    filePattern: /\/schemas?\.(py)$/,
    signalType: 'api-surface-change',
    description: 'Pydantic schema change',
    confidence: 0.6,
  },
  {
    filePattern: /\/dependencies\.(py)$/,
    signalType: 'config-change',
    description: 'FastAPI dependency injection',
    confidence: 0.7,
  },
  // Flask patterns
  {
    filePattern: /\/routes?\.(py)$/,
    signalType: 'api-surface-change',
    description: 'Flask route change',
    confidence: 0.7,
  },
  {
    filePattern: /\/blueprints?\/.*\.(py)$/,
    signalType: 'layer-change',
    description: 'Flask blueprint change',
    confidence: 0.6,
  },
  // SQLAlchemy patterns
  {
    filePattern: /\/models\/.*\.(py)$/,
    signalType: 'data-model-change',
    description: 'SQLAlchemy model change',
    confidence: 0.7,
  },
  {
    filePattern: /\/alembic\/versions\/.*\.(py)$/,
    signalType: 'data-model-change',
    description: 'Alembic migration',
    confidence: 0.9,
  },
  // Celery patterns
  {
    filePattern: /\/tasks?\.(py)$/,
    signalType: 'layer-change',
    description: 'Celery task change',
    confidence: 0.6,
  },
  // General patterns
  {
    filePattern: /\/services?\/.*\.(py)$/,
    signalType: 'layer-change',
    description: 'Service layer change',
    confidence: 0.5,
  },
  {
    filePattern: /\/repositories?\/.*\.(py)$/,
    signalType: 'data-model-change',
    description: 'Repository pattern change',
    confidence: 0.6,
  },
  {
    filePattern: /\/exceptions?\.(py)$/,
    signalType: 'error-handling-change',
    description: 'Exception handling change',
    confidence: 0.7,
  },
  {
    filePattern: /\/config\.(py)$/,
    signalType: 'config-change',
    description: 'Configuration change',
    confidence: 0.5,
  },
  {
    filePattern: /\/settings\.(py)$/,
    signalType: 'config-change',
    description: 'Settings change',
    confidence: 0.5,
  },
  // Testing
  {
    filePattern: /\/tests?\/.*\.(py)$/,
    signalType: 'test-strategy-change',
    description: 'Test file change',
    confidence: 0.4,
  },
  {
    filePattern: /test_.*\.(py)$/,
    signalType: 'test-strategy-change',
    description: 'Test file change',
    confidence: 0.4,
  },
  {
    filePattern: /conftest\.(py)$/,
    signalType: 'test-strategy-change',
    description: 'Pytest configuration change',
    confidence: 0.5,
  },
];

const PYTHON_ENTRY_POINT_PATTERNS = [
  /\/views?\.(py)$/,
  /\/routers?\/.*\.(py)$/,
  /\/endpoints?\/.*\.(py)$/,
  /\/api\/.*\.(py)$/,
  /main\.(py)$/,
  /app\.(py)$/,
  /__main__\.(py)$/,
  /manage\.(py)$/,
  /wsgi\.(py)$/,
  /asgi\.(py)$/,
];

// ============================================================================
// Python Commit Extractor
// ============================================================================

export class PythonCommitExtractor extends BaseCommitExtractor {
  readonly language: DecisionLanguage = 'python';
  readonly extensions = ['.py', '.pyw', '.pyi'];

  constructor(options: CommitExtractorOptions) {
    super(options);
  }

  protected override async extractArchitecturalSignals(
    context: ExtractionContext
  ): Promise<ArchitecturalSignal[]> {
    const signals: ArchitecturalSignal[] = [];

    for (const file of context.relevantFiles) {
      // Check Python-specific patterns
      for (const pattern of PYTHON_ARCHITECTURAL_PATTERNS) {
        if (pattern.filePattern.test(file.path)) {
          signals.push({
            type: pattern.signalType,
            description: `${pattern.description}: ${file.path}`,
            files: [file.path],
            confidence: this.adjustConfidence(pattern.confidence, file),
          });
        }
      }

      // Detect __init__.py changes (module structure)
      if (file.path.endsWith('__init__.py')) {
        if (file.status === 'added') {
          signals.push({
            type: 'layer-change',
            description: `New Python package: ${file.path}`,
            files: [file.path],
            confidence: 0.6,
          });
        } else if (file.additions > 5 || file.deletions > 5) {
          signals.push({
            type: 'api-surface-change',
            description: `Package exports changed: ${file.path}`,
            files: [file.path],
            confidence: 0.5,
          });
        }
      }

      // Detect abstract base class files
      if (
        file.path.includes('/base') ||
        file.path.includes('/abstract') ||
        file.path.includes('/interfaces')
      ) {
        signals.push({
          type: 'new-abstraction',
          description: `Abstraction file ${file.status}: ${file.path}`,
          files: [file.path],
          confidence: 0.6,
        });
      }
    }

    const baseSignals = await super.extractArchitecturalSignals(context);
    signals.push(...baseSignals);

    return this.deduplicateSignals(signals);
  }

  protected override isLikelyEntryPoint(filePath: string): boolean {
    return PYTHON_ENTRY_POINT_PATTERNS.some(pattern => pattern.test(filePath));
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

export function createPythonCommitExtractor(
  options: CommitExtractorOptions
): PythonCommitExtractor {
  return new PythonCommitExtractor(options);
}
