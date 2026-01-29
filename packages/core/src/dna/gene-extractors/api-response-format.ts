/**
 * API Response Format Gene Extractor
 * 
 * Detects patterns in how API responses are structured across backend code.
 * Identifies common response envelope patterns like:
 * - { success: true, data: ... }
 * - { status: "ok", result: ... }
 * - { data: ..., meta: ... }
 * - Direct data return (no envelope)
 */

import { BaseGeneExtractor, type AlleleDefinition, type FileExtractionResult, type DetectedAllele } from './base-extractor.js';

import type { GeneId } from '../types.js';

export class ApiResponseFormatExtractor extends BaseGeneExtractor {
  readonly geneId: GeneId = 'api-response-format';
  readonly geneName = 'API Response Format';
  readonly geneDescription = 'How API responses are structured and enveloped';

  private readonly alleleDefinitions: AlleleDefinition[] = [
    {
      id: 'success-data-envelope',
      name: 'Success/Data Envelope',
      description: 'Response with success boolean and data field: { success: true, data: ... }',
      patterns: [
        /\{\s*["']?success["']?\s*:\s*(true|false|True|False)/,
        /return\s*\{\s*["']?success["']?\s*:/,
        /["']success["']\s*:\s*(true|false|True|False)\s*,\s*["']data["']/,
        /JSONResponse\s*\(\s*\{\s*["']success["']/,
        /jsonify\s*\(\s*\{\s*["']success["']/,
      ],
      priority: 1,
    },
    {
      id: 'status-result-envelope',
      name: 'Status/Result Envelope',
      description: 'Response with status string and result field: { status: "ok", result: ... }',
      patterns: [
        /\{\s*["']?status["']?\s*:\s*["'](ok|success|error|fail)/i,
        /return\s*\{\s*["']?status["']?\s*:/,
        /["']status["']\s*:\s*["']\w+["']\s*,\s*["']result["']/,
      ],
      priority: 2,
    },
    {
      id: 'data-meta-envelope',
      name: 'Data/Meta Envelope',
      description: 'Response with data and metadata: { data: ..., meta: { pagination } }',
      patterns: [
        /\{\s*["']?data["']?\s*:.*["']?meta["']?\s*:/s,
        /["']data["']\s*:.*["']pagination["']/s,
        /return\s*\{\s*["']data["'].*["']meta["']/s,
      ],
      priority: 3,
    },
    {
      id: 'error-message-envelope',
      name: 'Error/Message Envelope',
      description: 'Error response with error and message fields: { error: true, message: ... }',
      patterns: [
        /\{\s*["']?error["']?\s*:\s*(true|True|["']\w+["'])/,
        /["']error["']\s*:.*["']message["']\s*:/s,
        /raise\s+HTTPException.*detail\s*=/,
        /throw\s+new\s+\w*Error\s*\(/,
      ],
      priority: 4,
    },
    {
      id: 'direct-return',
      name: 'Direct Data Return',
      description: 'Returns data directly without envelope wrapper',
      patterns: [
        /return\s+\w+\.dict\(\)/,
        /return\s+\w+\.model_dump\(\)/,
        /return\s+\[.*\]/,
        /res\.json\(\s*\w+\s*\)/,
        /return\s+Response\(\s*content=/,
      ],
      priority: 5,
    },
    {
      id: 'code-message-envelope',
      name: 'Code/Message Envelope',
      description: 'Response with numeric code and message: { code: 200, message: ... }',
      patterns: [
        /\{\s*["']?code["']?\s*:\s*\d+/,
        /["']code["']\s*:\s*\d+\s*,\s*["']message["']/,
        /return\s*\{\s*["']code["']\s*:/,
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
    // Check file extension
    const backendExts = ['.py', '.ts', '.js', '.java', '.php', '.go', '.rs', '.cs'];
    if (!backendExts.some(ext => filePath.endsWith(ext))) {return false;}

    // Check for API-related patterns
    const apiPatterns = [
      /from\s+fastapi/,
      /from\s+flask/,
      /from\s+django/,
      /@(Get|Post|Put|Delete|Patch|Controller|RestController)/,
      /app\.(get|post|put|delete|patch)\s*\(/,
      /router\.(get|post|put|delete|patch)\s*\(/,
      /Route::(get|post|put|delete|patch)/,
      /func\s+\w+Handler/,
      /async\s+fn\s+\w+.*->.*Response/,
    ];

    return apiPatterns.some(p => p.test(content));
  }
}
