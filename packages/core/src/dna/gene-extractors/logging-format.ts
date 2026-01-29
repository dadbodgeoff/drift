/**
 * Logging Format Gene Extractor
 * 
 * Detects patterns in how logging is done across backend code.
 * Identifies common logging patterns like:
 * - Structured logging (JSON)
 * - Printf-style logging
 * - Logger with levels
 */

import { BaseGeneExtractor, type AlleleDefinition, type FileExtractionResult, type DetectedAllele } from './base-extractor.js';

import type { GeneId } from '../types.js';

export class LoggingFormatExtractor extends BaseGeneExtractor {
  readonly geneId: GeneId = 'logging-format';
  readonly geneName = 'Logging Format';
  readonly geneDescription = 'How logging is structured and formatted';

  private readonly alleleDefinitions: AlleleDefinition[] = [
    {
      id: 'structured-json-logging',
      name: 'Structured JSON Logging',
      description: 'Uses structured logging with JSON format and extra fields',
      patterns: [
        /logger\.\w+\s*\([^)]*extra\s*=/,
        /structlog/,
        /\.info\s*\(\s*\{/,
        /\.error\s*\(\s*\{/,
        /JSON\.stringify.*log/,
        /pino\s*\(/,
        /winston\.format\.json/,
      ],
      priority: 1,
    },
    {
      id: 'logger-with-levels',
      name: 'Logger with Levels',
      description: 'Uses logger instance with level methods (info, error, debug, etc.)',
      patterns: [
        /logger\.(info|error|debug|warn|warning|critical)\s*\(/,
        /log\.(info|error|debug|warn|warning)\s*\(/,
        /console\.(log|info|error|warn|debug)\s*\(/,
        /logging\.(info|error|debug|warning|critical)\s*\(/,
        /Logger\.(Info|Error|Debug|Warn)/,
      ],
      priority: 2,
    },
    {
      id: 'printf-style-logging',
      name: 'Printf-Style Logging',
      description: 'Uses printf-style format strings for logging',
      patterns: [
        /logger\.\w+\s*\(\s*["'].*%[sdf]/,
        /log\.Printf\s*\(/,
        /fmt\.Printf\s*\(/,
        /String\.format\s*\(/,
        /sprintf\s*\(/,
      ],
      priority: 3,
    },
    {
      id: 'f-string-logging',
      name: 'F-String/Template Logging',
      description: 'Uses f-strings or template literals for log messages',
      patterns: [
        /logger\.\w+\s*\(\s*f["']/,
        /log\.\w+\s*\(\s*`/,
        /console\.\w+\s*\(\s*`/,
        /\$\{.*\}.*log/,
      ],
      priority: 4,
    },
    {
      id: 'context-logging',
      name: 'Context/Correlation Logging',
      description: 'Includes request context or correlation IDs in logs',
      patterns: [
        /correlation_id/i,
        /request_id/i,
        /trace_id/i,
        /span_id/i,
        /x-request-id/i,
        /MDC\.(put|get)/,
        /LogContext/,
      ],
      priority: 5,
    },
    {
      id: 'print-debugging',
      name: 'Print Debugging',
      description: 'Uses print statements for logging (anti-pattern)',
      patterns: [
        /^print\s*\(/m,
        /System\.out\.print/,
        /echo\s+/,
        /fmt\.Println\s*\(/,
      ],
      priority: 6,
    },
  ];

  getAlleleDefinitions(): AlleleDefinition[] {
    return this.alleleDefinitions;
  }

  extractFromFile(filePath: string, content: string, _imports: string[]): FileExtractionResult {
    const detectedAlleles: DetectedAllele[] = [];
    const isBackendFile = this.isBackendFile(filePath);

    if (!isBackendFile) {
      return { file: filePath, detectedAlleles, isComponent: false };
    }

    for (const allele of this.alleleDefinitions) {
      for (const pattern of allele.patterns) {
        const matches = content.matchAll(new RegExp(pattern, 'g'));
        for (const match of matches) {
          if (match.index !== undefined) {
            const ctx = this.extractContext(content, match.index);
            detectedAlleles.push({
              alleleId: allele.id,
              line: ctx.line,
              code: ctx.code,
              confidence: 0.8,
              context: ctx.context,
            });
          }
        }
      }
    }

    return { file: filePath, detectedAlleles, isComponent: isBackendFile };
  }

  isBackendFile(filePath: string): boolean {
    const backendExts = ['.py', '.ts', '.js', '.java', '.php', '.go', '.rs', '.cs'];
    return backendExts.some(ext => filePath.endsWith(ext));
  }
}
