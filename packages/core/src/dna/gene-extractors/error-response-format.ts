/**
 * Error Response Format Gene Extractor
 * 
 * Detects patterns in how errors are formatted and returned in API responses.
 * Identifies common error handling patterns like:
 * - HTTP exceptions with detail
 * - Custom error classes
 * - Error response envelopes
 */

import { BaseGeneExtractor, type AlleleDefinition, type FileExtractionResult, type DetectedAllele } from './base-extractor.js';

import type { GeneId } from '../types.js';

export class ErrorResponseFormatExtractor extends BaseGeneExtractor {
  readonly geneId: GeneId = 'error-response-format';
  readonly geneName = 'Error Response Format';
  readonly geneDescription = 'How errors are formatted and returned in API responses';

  private readonly alleleDefinitions: AlleleDefinition[] = [
    {
      id: 'http-exception-detail',
      name: 'HTTP Exception with Detail',
      description: 'Uses framework HTTP exceptions with detail message',
      patterns: [
        /raise\s+HTTPException\s*\(\s*status_code\s*=.*detail\s*=/,
        /throw\s+new\s+HttpException\s*\(/,
        /throw\s+new\s+BadRequestException\s*\(/,
        /throw\s+new\s+NotFoundException\s*\(/,
        /throw\s+new\s+UnauthorizedException\s*\(/,
        /abort\s*\(\s*\d+\s*,/,
      ],
      priority: 1,
    },
    {
      id: 'custom-error-class',
      name: 'Custom Error Classes',
      description: 'Uses custom error/exception classes for domain errors',
      patterns: [
        /class\s+\w+Error\s*\(\s*Exception\s*\)/,
        /class\s+\w+Exception\s+extends\s+\w*Error/,
        /class\s+\w+Error\s+extends\s+Error/,
        /raise\s+\w+Error\s*\(/,
        /throw\s+new\s+\w+Error\s*\(/,
      ],
      priority: 2,
    },
    {
      id: 'error-envelope-response',
      name: 'Error Envelope Response',
      description: 'Returns error in a structured envelope: { error: ..., message: ... }',
      patterns: [
        /return\s*\{\s*["']error["']\s*:/,
        /JSONResponse\s*\(\s*\{\s*["']error["']/,
        /jsonify\s*\(\s*\{\s*["']error["']/,
        /res\.status\s*\(\s*\d+\s*\)\.json\s*\(\s*\{\s*["']?error["']?/,
      ],
      priority: 3,
    },
    {
      id: 'problem-details-rfc7807',
      name: 'Problem Details (RFC 7807)',
      description: 'Uses RFC 7807 Problem Details format: { type, title, status, detail }',
      patterns: [
        /\{\s*["']type["']\s*:.*["']title["']\s*:.*["']status["']/s,
        /ProblemDetails/,
        /application\/problem\+json/,
      ],
      priority: 4,
    },
    {
      id: 'validation-error-array',
      name: 'Validation Error Array',
      description: 'Returns validation errors as array: { errors: [...] }',
      patterns: [
        /\{\s*["']errors["']\s*:\s*\[/,
        /ValidationError/,
        /RequestValidationError/,
        /\.errors\s*=\s*\[/,
      ],
      priority: 5,
    },
    {
      id: 'try-catch-generic',
      name: 'Generic Try-Catch',
      description: 'Uses generic try-catch with error message return',
      patterns: [
        /catch\s*\(\s*\w+\s*\)\s*\{[^}]*return.*error/s,
        /except\s+Exception\s+as\s+\w+:[^:]*return/s,
        /catch\s*\(\s*Exception/,
      ],
      priority: 6,
    },
  ];

  getAlleleDefinitions(): AlleleDefinition[] {
    return this.alleleDefinitions;
  }

  extractFromFile(filePath: string, content: string, _imports: string[]): FileExtractionResult {
    const detectedAlleles: DetectedAllele[] = [];
    const isBackendFile = this.isBackendFile(filePath, content);

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

  isBackendFile(filePath: string, content: string): boolean {
    const backendExts = ['.py', '.ts', '.js', '.java', '.php', '.go', '.rs', '.cs'];
    if (!backendExts.some(ext => filePath.endsWith(ext))) {return false;}

    // Check for error handling patterns
    const errorPatterns = [
      /try\s*[:{]/,
      /except\s+/,
      /catch\s*\(/,
      /raise\s+/,
      /throw\s+/,
      /Error\s*\(/,
      /Exception/,
    ];

    return errorPatterns.some(p => p.test(content));
  }
}
