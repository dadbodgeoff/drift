/**
 * Docstring Extractor
 * 
 * Extracts documentation from IEC 61131-3 Structured Text files.
 * This is the PRIMARY feature requested - comprehensive docstring extraction.
 * 
 * Handles:
 * - Block comments (* ... *)
 * - Header comments (***...***) 
 * - @param, @returns, @author, @date annotations
 * - History entries (YYYY-MM-DD format)
 * - Warnings, notes, cautions
 * - Associated block detection
 */

import type {
  STDocstring,
  STDocParam,
  STHistoryEntry,
  POUType,
} from '../types.js';
import { generateId } from '../utils/id-generator.js';

// ============================================================================
// EXTRACTION RESULT
// ============================================================================

export interface DocstringExtractionResult {
  docstrings: ExtractedDocstring[];
  summary: DocstringSummary;
}

export interface ExtractedDocstring extends STDocstring {
  file: string;
  quality: DocstringQuality;
}

export interface DocstringQuality {
  score: number;
  hasSummary: boolean;
  hasParams: boolean;
  hasHistory: boolean;
  hasWarnings: boolean;
  completeness: 'complete' | 'partial' | 'minimal';
}

export interface DocstringSummary {
  total: number;
  byBlock: Record<string, number>;
  withParams: number;
  withHistory: number;
  withWarnings: number;
  averageQuality: number;
}

export interface DocstringExtractionOptions {
  includeRaw?: boolean;
  minLength?: number;
  includeOrphaned?: boolean;
}

// ============================================================================
// PATTERNS
// ============================================================================

// Block comment pattern - matches (* ... *)
const BLOCK_COMMENT_PATTERN = /\(\*+\s*([\s\S]*?)\s*\*+\)/g;

// POU patterns for association
const POU_PATTERNS: Array<{ pattern: RegExp; type: POUType }> = [
  { pattern: /^\s*FUNCTION_BLOCK\s+(\w+)/im, type: 'FUNCTION_BLOCK' },
  { pattern: /^\s*PROGRAM\s+(\w+)/im, type: 'PROGRAM' },
  { pattern: /^\s*FUNCTION\s+(\w+)/im, type: 'FUNCTION' },
  { pattern: /^\s*CLASS\s+(\w+)/im, type: 'CLASS' },
  { pattern: /^\s*INTERFACE\s+(\w+)/im, type: 'INTERFACE' },
];

// ============================================================================
// EXTRACTOR
// ============================================================================

export function extractDocstrings(
  source: string,
  filePath: string,
  options: DocstringExtractionOptions = {}
): DocstringExtractionResult {
  const {
    includeRaw = false,
    minLength = 20,
    includeOrphaned = true,
  } = options;

  const docstrings: ExtractedDocstring[] = [];
  let match: RegExpExecArray | null;

  // Reset regex
  BLOCK_COMMENT_PATTERN.lastIndex = 0;

  while ((match = BLOCK_COMMENT_PATTERN.exec(source)) !== null) {
    const fullMatch = match[0];
    const content = match[1] ?? '';
    
    // Skip short comments (likely inline)
    if (content.length < minLength && !content.includes('\n')) {
      continue;
    }

    const startOffset = match.index;
    const endOffset = startOffset + fullMatch.length;
    const line = getLineNumber(source, startOffset);
    const endLine = getLineNumber(source, endOffset);

    // Check if this looks like a docstring
    if (!isDocstringComment(content)) {
      continue;
    }

    // Parse the docstring content
    const parsed = parseDocstringContent(content);

    // Find associated block
    const afterComment = source.slice(endOffset);
    const { blockName, blockType } = findAssociatedBlock(afterComment);

    // Skip orphaned if not requested
    if (!includeOrphaned && !blockName) {
      continue;
    }

    // Calculate quality
    const quality = calculateQuality(parsed);

    const docstring: ExtractedDocstring = {
      id: generateId(),
      file: filePath,
      summary: parsed.summary,
      description: parsed.description,
      params: parsed.params,
      returns: parsed.returns,
      author: parsed.author,
      date: parsed.date,
      history: parsed.history,
      warnings: parsed.warnings,
      notes: parsed.notes,
      raw: includeRaw ? fullMatch : '',
      location: {
        file: filePath,
        line,
        column: 1,
        endLine,
        endColumn: fullMatch.length - fullMatch.lastIndexOf('\n'),
      },
      associatedBlock: blockName,
      associatedBlockType: blockType,
      quality,
    };

    docstrings.push(docstring);
  }

  // Calculate summary
  const summary = calculateSummary(docstrings);

  return { docstrings, summary };
}

// ============================================================================
// PARSING HELPERS
// ============================================================================

interface ParsedContent {
  summary: string;
  description: string;
  params: STDocParam[];
  returns: string | null;
  author: string | null;
  date: string | null;
  history: STHistoryEntry[];
  warnings: string[];
  notes: string[];
}

function parseDocstringContent(content: string): ParsedContent {
  const lines = content.split('\n').map(l => 
    l.replace(/^\s*\*?\s?/, '').trim()
  );

  let summary = '';
  const descLines: string[] = [];
  const params: STDocParam[] = [];
  const history: STHistoryEntry[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  let returns: string | null = null;
  let author: string | null = null;
  let date: string | null = null;
  let inDescription = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    
    // Skip separator lines
    if (/^[=\-*_]+$/.test(line)) continue;
    if (!line) {
      if (summary) inDescription = true;
      continue;
    }

    // @param - multiple formats
    const paramMatch = line.match(
      /@param\s+(\w+)\s*(?::\s*(\w+))?\s*[-:]?\s*(.*)/i
    ) || line.match(
      /^\s*(\w+)\s*:\s*(\w+)\s*[-:]\s*(.*)/  // name : TYPE - description
    );
    if (paramMatch && line.toLowerCase().includes('param')) {
      params.push({
        name: paramMatch[1]!,
        type: paramMatch[2] || null,
        description: paramMatch[3]?.trim() || '',
        direction: inferDirection(paramMatch[1]!),
      });
      continue;
    }

    // @returns / @return
    const returnMatch = line.match(/@returns?\s+(.*)/i);
    if (returnMatch) {
      returns = returnMatch[1]?.trim() || null;
      continue;
    }

    // @author or Auth:
    const authorMatch = line.match(/@author\s+(.*)/i) || line.match(/^Auth(?:or)?:\s*(.*)/i);
    if (authorMatch) {
      author = authorMatch[1]?.trim() || null;
      continue;
    }

    // @date or Date:
    const dateMatch = line.match(/@date\s+(.*)/i) || line.match(/^Date:\s*(.*)/i);
    if (dateMatch) {
      date = dateMatch[1]?.trim() || null;
      continue;
    }

    // History entries - YYYY-MM-DD or YYYY/MM/DD
    const historyMatch = line.match(/^(\d{4}[-/]\d{2}[-/]\d{2})\s*(?:[-:]?\s*)?(\w+)?\s*[-:]?\s*(.*)/);
    if (historyMatch) {
      history.push({
        date: historyMatch[1]!.replace(/\//g, '-'),
        author: historyMatch[2] || null,
        description: historyMatch[3]?.trim() || '',
      });
      continue;
    }

    // Year-only history (common in legacy code)
    const yearMatch = line.match(/^(\d{4})\s*[-:]?\s*(\w+)?\s*[-:]?\s*(.*)/);
    if (yearMatch && parseInt(yearMatch[1]!) >= 1990 && parseInt(yearMatch[1]!) <= 2030) {
      history.push({
        date: yearMatch[1]!,
        author: yearMatch[2] || null,
        description: yearMatch[3]?.trim() || '',
      });
      continue;
    }

    // Warnings, dangers, cautions
    if (/^(WARNING|DANGER|CAUTION)\s*[:\-!]?\s*/i.test(line)) {
      warnings.push(line);
      continue;
    }

    // Notes
    if (/^NOTE\s*[:\-!]?\s*/i.test(line)) {
      notes.push(line.replace(/^NOTE\s*[:\-!]?\s*/i, ''));
      continue;
    }

    // TODO, FIXME (add to notes)
    if (/^(TODO|FIXME)\s*[:\-!]?\s*/i.test(line)) {
      notes.push(line);
      continue;
    }

    // Skip section headers
    if (/^(HISTORY|PARAMETERS|INPUTS|OUTPUTS|DESCRIPTION|CONTENTS)\s*:?\s*$/i.test(line)) {
      continue;
    }

    // First meaningful line is summary
    if (!summary && !line.startsWith('@') && line.length > 5) {
      summary = line;
      continue;
    }

    // Rest is description
    if (summary && !line.startsWith('@') && (inDescription || descLines.length > 0)) {
      descLines.push(line);
    }
  }

  return {
    summary,
    description: descLines.join(' ').trim(),
    params,
    returns,
    author,
    date,
    history,
    warnings,
    notes,
  };
}

function isDocstringComment(content: string): boolean {
  // Multi-line is likely docstring
  if (content.includes('\n')) return true;
  
  // Has annotations
  if (/@(param|returns?|author|date|history)/i.test(content)) return true;
  
  // Has special markers
  if (/(WARNING|DANGER|CAUTION|NOTE|TODO|FIXME)/i.test(content)) return true;
  
  // Header style
  if (/^[=\-*]{3,}/.test(content)) return true;
  
  // Long single line
  if (content.length > 100) return true;
  
  return false;
}

function findAssociatedBlock(afterComment: string): { blockName: string | null; blockType: POUType | null } {
  // Look in the first 500 chars after comment
  const searchArea = afterComment.slice(0, 500);
  
  for (const { pattern, type } of POU_PATTERNS) {
    const match = searchArea.match(pattern);
    if (match) {
      return { blockName: match[1]!, blockType: type };
    }
  }
  
  return { blockName: null, blockType: null };
}

function inferDirection(paramName: string): 'in' | 'out' | 'inout' | null {
  const lower = paramName.toLowerCase();
  if (lower.startsWith('b') || lower.startsWith('r') || lower.startsWith('n') || lower.startsWith('i')) {
    // Common input prefixes
    return 'in';
  }
  if (lower.includes('out') || lower.includes('result')) {
    return 'out';
  }
  return null;
}

function calculateQuality(parsed: ParsedContent): DocstringQuality {
  let score = 0;
  
  const hasSummary = parsed.summary.length > 10;
  const hasParams = parsed.params.length > 0;
  const hasHistory = parsed.history.length > 0;
  const hasWarnings = parsed.warnings.length > 0;
  
  if (hasSummary) score += 30;
  if (parsed.description.length > 20) score += 20;
  if (hasParams) score += 20;
  if (hasHistory) score += 15;
  if (hasWarnings) score += 10;
  if (parsed.author) score += 5;
  
  let completeness: 'complete' | 'partial' | 'minimal';
  if (score >= 70) completeness = 'complete';
  else if (score >= 40) completeness = 'partial';
  else completeness = 'minimal';
  
  return {
    score,
    hasSummary,
    hasParams,
    hasHistory,
    hasWarnings,
    completeness,
  };
}

function calculateSummary(docstrings: ExtractedDocstring[]): DocstringSummary {
  const byBlock: Record<string, number> = {};
  let withParams = 0;
  let withHistory = 0;
  let withWarnings = 0;
  let totalQuality = 0;

  for (const doc of docstrings) {
    const key = doc.associatedBlock || 'standalone';
    byBlock[key] = (byBlock[key] || 0) + 1;
    
    if (doc.params.length > 0) withParams++;
    if (doc.history.length > 0) withHistory++;
    if (doc.warnings.length > 0) withWarnings++;
    totalQuality += doc.quality.score;
  }

  return {
    total: docstrings.length,
    byBlock,
    withParams,
    withHistory,
    withWarnings,
    averageQuality: docstrings.length > 0 ? totalQuality / docstrings.length : 0,
  };
}

function getLineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Extract docstrings from multiple files
 */
export function extractDocstringsFromFiles(
  files: Array<{ path: string; content: string }>,
  options?: DocstringExtractionOptions
): DocstringExtractionResult {
  const allDocstrings: ExtractedDocstring[] = [];

  for (const file of files) {
    const result = extractDocstrings(file.content, file.path, options);
    allDocstrings.push(...result.docstrings);
  }

  const summary = calculateSummary(allDocstrings);
  return { docstrings: allDocstrings, summary };
}
