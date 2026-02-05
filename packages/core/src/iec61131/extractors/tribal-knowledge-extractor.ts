/**
 * Tribal Knowledge Extractor
 * 
 * Extracts institutional knowledge embedded in IEC 61131-3 code comments.
 * This captures the "why" behind code decisions that would otherwise be lost.
 * 
 * Detects:
 * - Warnings, dangers, cautions
 * - Workarounds and hacks
 * - Historical context
 * - Equipment-specific notes
 * - Magic numbers and mysteries
 * - TODO/FIXME items
 * - "Do not change" warnings
 */

import type {
  TribalKnowledgeItem,
  TribalKnowledgeType,
  TribalKnowledgeImportance,
} from '../types.js';
import { generateId } from '../utils/id-generator.js';

// ============================================================================
// EXTRACTION RESULT
// ============================================================================

export interface TribalKnowledgeExtractionResult {
  items: ExtractedTribalKnowledge[];
  summary: TribalKnowledgeSummary;
}

export interface ExtractedTribalKnowledge extends TribalKnowledgeItem {
  file: string;
}

export interface TribalKnowledgeSummary {
  total: number;
  byType: Record<TribalKnowledgeType, number>;
  byImportance: Record<TribalKnowledgeImportance, number>;
  criticalCount: number;
}

export interface TribalKnowledgeExtractionOptions {
  includeContext?: boolean;
  contextLines?: number;
}

// ============================================================================
// PATTERNS
// ============================================================================

interface KnowledgePattern {
  pattern: RegExp;
  type: TribalKnowledgeType;
  importance: TribalKnowledgeImportance;
}

const KNOWLEDGE_PATTERNS: KnowledgePattern[] = [
  // Critical warnings
  { 
    pattern: /DANGER\s*[:\-!]?\s*(.*)/gi, 
    type: 'danger' as TribalKnowledgeType, 
    importance: 'critical' 
  },
  { 
    pattern: /WARNING\s*[:\-!]?\s*(.*)/gi, 
    type: 'warning', 
    importance: 'high' 
  },
  { 
    pattern: /CAUTION\s*[:\-!]?\s*(.*)/gi, 
    type: 'caution' as TribalKnowledgeType, 
    importance: 'high' 
  },
  
  // Do not change warnings
  { 
    pattern: /DO\s+NOT\s+(CHANGE|MODIFY|REMOVE|DELETE|TOUCH)[^*\n]*/gi, 
    type: 'do-not-change', 
    importance: 'critical' 
  },
  { 
    pattern: /DON'?T\s+(CHANGE|MODIFY|REMOVE|DELETE|TOUCH)[^*\n]*/gi, 
    type: 'do-not-change', 
    importance: 'critical' 
  },
  { 
    pattern: /NEVER\s+(CHANGE|MODIFY|REMOVE|DELETE)[^*\n]*/gi, 
    type: 'do-not-change', 
    importance: 'critical' 
  },
  
  // Workarounds and hacks
  { 
    pattern: /WORKAROUND\s*[:\-!]?\s*(.*)/gi, 
    type: 'workaround', 
    importance: 'high' 
  },
  { 
    pattern: /HACK\s*[:\-!]?\s*(.*)/gi, 
    type: 'hack', 
    importance: 'high' 
  },
  { 
    pattern: /KLUDGE\s*[:\-!]?\s*(.*)/gi, 
    type: 'hack', 
    importance: 'high' 
  },
  { 
    pattern: /BODGE\s*[:\-!]?\s*(.*)/gi, 
    type: 'hack', 
    importance: 'high' 
  },
  
  // Notes and explanations
  { 
    pattern: /NOTE\s*[:\-!]?\s*(.*)/gi, 
    type: 'note', 
    importance: 'medium' 
  },
  { 
    pattern: /IMPORTANT\s*[:\-!]?\s*(.*)/gi, 
    type: 'note', 
    importance: 'high' 
  },
  
  // TODO/FIXME
  { 
    pattern: /TODO\s*[:\-!]?\s*(.*)/gi, 
    type: 'todo', 
    importance: 'medium' 
  },
  { 
    pattern: /FIXME\s*[:\-!]?\s*(.*)/gi, 
    type: 'fixme', 
    importance: 'high' 
  },
  { 
    pattern: /BUG\s*[:\-!]?\s*(.*)/gi, 
    type: 'fixme', 
    importance: 'high' 
  },
  { 
    pattern: /XXX\s*[:\-!]?\s*(.*)/gi, 
    type: 'fixme', 
    importance: 'high' 
  },
  
  // Equipment-specific
  { 
    pattern: /EQUIPMENT\s*[:\-!]?\s*(.*)/gi, 
    type: 'equipment', 
    importance: 'medium' 
  },
  { 
    pattern: /MACHINE\s*[:\-!]?\s*(.*)/gi, 
    type: 'equipment', 
    importance: 'medium' 
  },
  { 
    pattern: /VENDOR\s*[:\-!]?\s*(.*)/gi, 
    type: 'equipment', 
    importance: 'medium' 
  },
  
  // Magic numbers
  { 
    pattern: /MAGIC\s*(?:NUMBER)?\s*[:\-!]?\s*(.*)/gi, 
    type: 'magic-number', 
    importance: 'medium' 
  },
  { 
    pattern: /WHY\s+(\d+(?:\.\d+)?)\s*\?/gi, 
    type: 'magic-number', 
    importance: 'medium' 
  },
  
  // Mystery/unknown
  { 
    pattern: /MYSTERY\s*[:\-!]?\s*(.*)/gi, 
    type: 'mystery', 
    importance: 'medium' 
  },
  { 
    pattern: /UNKNOWN\s*[:\-!]?\s*(.*)/gi, 
    type: 'mystery', 
    importance: 'medium' 
  },
  { 
    pattern: /NOT\s+SURE\s+WHY[^*\n]*/gi, 
    type: 'mystery', 
    importance: 'medium' 
  },
  { 
    pattern: /DON'?T\s+KNOW\s+WHY[^*\n]*/gi, 
    type: 'mystery', 
    importance: 'medium' 
  },
  
  // History entries
  { 
    pattern: /(\d{4}[-/]\d{2}[-/]\d{2})\s*[-:]?\s*(\w+)?\s*[-:]?\s*(.*)/g, 
    type: 'history', 
    importance: 'low' 
  },
  
  // Author attribution
  { 
    pattern: /(?:Auth(?:or)?|By|Written\s+by)\s*[:\-]?\s*(\w+(?:\s+\w+)?)/gi, 
    type: 'author', 
    importance: 'low' 
  },
];

// ============================================================================
// EXTRACTOR
// ============================================================================

export function extractTribalKnowledge(
  source: string,
  filePath: string,
  options: TribalKnowledgeExtractionOptions = {}
): TribalKnowledgeExtractionResult {
  const { includeContext = true, contextLines = 3 } = options;

  const items: ExtractedTribalKnowledge[] = [];
  const lines = source.split('\n');
  const seen = new Set<string>();

  // Extract from patterns
  for (const { pattern, type, importance } of KNOWLEDGE_PATTERNS) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(source)) !== null) {
      const content = match[0].trim();
      const contentKey = `${type}:${content.toLowerCase().slice(0, 50)}`;
      
      // Skip duplicates
      if (seen.has(contentKey)) continue;
      seen.add(contentKey);

      const line = getLineNumber(source, match.index);
      const context = includeContext 
        ? extractContext(lines, line - 1, contextLines)
        : '';

      items.push({
        id: generateId(),
        file: filePath,
        type,
        content,
        context,
        location: {
          file: filePath,
          line,
          column: match.index - source.lastIndexOf('\n', match.index),
        },
        pouId: null,
        importance,
        extractedAt: new Date().toISOString(),
      });
    }
  }

  // Look for unexplained magic numbers
  const magicNumbers = findMagicNumbers(source, filePath, lines, contextLines);
  for (const mn of magicNumbers) {
    const contentKey = `magic-number:${mn.content.toLowerCase()}`;
    if (!seen.has(contentKey)) {
      seen.add(contentKey);
      items.push(mn);
    }
  }

  // Sort by importance and line number
  items.sort((a, b) => {
    const importanceOrder: Record<TribalKnowledgeImportance, number> = {
      'critical': 0,
      'high': 1,
      'medium': 2,
      'low': 3,
    };
    const impDiff = importanceOrder[a.importance] - importanceOrder[b.importance];
    if (impDiff !== 0) return impDiff;
    return a.location.line - b.location.line;
  });

  const summary = calculateSummary(items);
  return { items, summary };
}

// ============================================================================
// MAGIC NUMBER DETECTION
// ============================================================================

function findMagicNumbers(
  source: string,
  filePath: string,
  lines: string[],
  contextLines: number
): ExtractedTribalKnowledge[] {
  const magicNumbers: ExtractedTribalKnowledge[] = [];
  
  // Look for numeric assignments without comments
  const assignPattern = /(\w+)\s*:=\s*(\d+(?:\.\d+)?)\s*;(?!\s*\(\*)/gm;
  let match: RegExpExecArray | null;
  
  while ((match = assignPattern.exec(source)) !== null) {
    const varName = match[1]!;
    const value = match[2]!;
    const numValue = parseFloat(value);
    
    // Skip common non-magic values
    if (isCommonValue(numValue)) continue;
    
    // Skip if there's a comment on the same line
    const lineNum = getLineNumber(source, match.index);
    const lineContent = lines[lineNum - 1] || '';
    if (lineContent.includes('(*') || lineContent.includes('//')) continue;
    
    // Skip if variable name is self-documenting
    if (isSelfDocumenting(varName, numValue)) continue;
    
    // This looks like a magic number
    const context = extractContext(lines, lineNum - 1, contextLines);
    
    magicNumbers.push({
      id: generateId(),
      file: filePath,
      type: 'magic-number',
      content: `${varName} := ${value} (unexplained constant)`,
      context,
      location: {
        file: filePath,
        line: lineNum,
        column: match.index - source.lastIndexOf('\n', match.index),
      },
      pouId: null,
      importance: 'medium',
      extractedAt: new Date().toISOString(),
    });
  }

  return magicNumbers;
}

function isCommonValue(value: number): boolean {
  // Common non-magic values
  const common = [0, 1, 2, 10, 100, 1000, 0.0, 1.0, 100.0];
  return common.includes(value);
}

function isSelfDocumenting(varName: string, value: number): boolean {
  const lower = varName.toLowerCase();
  
  // Variable name contains the value
  if (lower.includes(String(Math.floor(value)))) return true;
  
  // Common self-documenting patterns
  if (lower.includes('max') || lower.includes('min')) return true;
  if (lower.includes('count') || lower.includes('limit')) return true;
  if (lower.includes('timeout') || lower.includes('delay')) return true;
  if (lower.includes('default') || lower.includes('init')) return true;
  
  return false;
}

// ============================================================================
// HELPERS
// ============================================================================

function extractContext(lines: string[], lineIndex: number, contextLines: number): string {
  const start = Math.max(0, lineIndex - contextLines);
  const end = Math.min(lines.length, lineIndex + contextLines + 1);
  return lines.slice(start, end).join('\n');
}

function getLineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function calculateSummary(items: ExtractedTribalKnowledge[]): TribalKnowledgeSummary {
  const byType: Record<TribalKnowledgeType, number> = {
    'warning': 0,
    'caution': 0,
    'danger': 0,
    'note': 0,
    'todo': 0,
    'fixme': 0,
    'hack': 0,
    'workaround': 0,
    'do-not-change': 0,
    'magic-number': 0,
    'history': 0,
    'author': 0,
    'equipment': 0,
    'mystery': 0,
  };

  const byImportance: Record<TribalKnowledgeImportance, number> = {
    'critical': 0,
    'high': 0,
    'medium': 0,
    'low': 0,
  };

  for (const item of items) {
    byType[item.type] = (byType[item.type] || 0) + 1;
    byImportance[item.importance]++;
  }

  return {
    total: items.length,
    byType,
    byImportance,
    criticalCount: byImportance['critical'],
  };
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export function extractTribalKnowledgeFromFiles(
  files: Array<{ path: string; content: string }>,
  options?: TribalKnowledgeExtractionOptions
): TribalKnowledgeExtractionResult {
  const allItems: ExtractedTribalKnowledge[] = [];

  for (const file of files) {
    const result = extractTribalKnowledge(file.content, file.path, options);
    allItems.push(...result.items);
  }

  const summary = calculateSummary(allItems);
  return { items: allItems, summary };
}
