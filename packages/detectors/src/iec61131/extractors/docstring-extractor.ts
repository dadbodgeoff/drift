/**
 * ST Docstring Extractor
 * 
 * Single responsibility: Extract and parse docstrings from ST comments
 * 
 * Handles both standard (* ... *) and decorated (****...****) comment styles
 * common in legacy IEC 61131-3 codebases.
 */

import type { STDocstring, STDocParam, STHistoryEntry } from '../types.js';

// ============================================================================
// Patterns
// ============================================================================

// Match both (* ... *) and (****...*****) style comments
const BLOCK_COMMENT = /\(\*+\s*\n?([\s\S]*?)\*+\)/g;
const PARAM_TAG = /@param\s+(\w+)\s*[-:]?\s*(.*)/i;
const RETURN_TAG = /@returns?\s+(.*)/i;
const AUTHOR_TAG = /@author\s*[:-]?\s*(.*)/gi;
const DATE_TAG = /@date\s*[:-]?\s*(.*)/gi;
const HISTORY_DATE = /^\d{4}-\d{2}-\d{2}/;
const WARNING_KEYWORDS = /\b(WARNING|DANGER|CAUTION)\b/i;

// ============================================================================
// Extractor
// ============================================================================

export function extractDocstrings(source: string): STDocstring[] {
  const docstrings: STDocstring[] = [];
  
  // Reset regex state
  const pattern = new RegExp(BLOCK_COMMENT.source, BLOCK_COMMENT.flags);
  let match;
  
  while ((match = pattern.exec(source)) !== null) {
    const content = match[1]!;
    const line = getLineNumber(source, match.index);
    const endLine = getLineNumber(source, match.index + match[0].length);
    
    // Skip single-line inline comments (short, no newlines)
    if (!content.includes('\n') && content.length < 100) {
      continue;
    }

    const docstring = parseDocstring(content, match[0], line, endLine);
    
    // Find associated block after the comment
    const afterComment = source.slice(match.index + match[0].length);
    const blockMatch = afterComment.match(/^\s*(FUNCTION_BLOCK|PROGRAM|FUNCTION)\s+(\w+)/i);
    if (blockMatch) {
      docstring.associatedBlock = blockMatch[2]!;
    }

    docstrings.push(docstring);
  }

  return docstrings;
}

function parseDocstring(content: string, raw: string, line: number, endLine: number): STDocstring {
  // Clean content: remove leading asterisks from each line
  const lines = content.split('\n').map(l => l.replace(/^\s*\*?\s?/, ''));
  
  let summary = '';
  const params: STDocParam[] = [];
  const history: STHistoryEntry[] = [];
  const warnings: string[] = [];
  let returns: string | null = null;
  let author: string | null = null;
  let date: string | null = null;
  const descLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    
    // @param tag
    if (trimmed.startsWith('@param')) {
      const paramMatch = trimmed.match(PARAM_TAG);
      if (paramMatch) {
        params.push({
          name: paramMatch[1]!,
          type: null,
          description: paramMatch[2]?.trim() || '',
        });
      }
      continue;
    }
    
    // @returns tag
    if (trimmed.startsWith('@returns') || trimmed.startsWith('@return')) {
      const returnMatch = trimmed.match(RETURN_TAG);
      if (returnMatch) {
        returns = returnMatch[1]?.trim() || null;
      }
      continue;
    }
    
    // @author tag
    if (trimmed.startsWith('@author')) {
      const authorMatch = trimmed.match(AUTHOR_TAG);
      if (authorMatch) {
        author = authorMatch[1]?.trim() || null;
      }
      continue;
    }
    
    // @date tag
    if (trimmed.startsWith('@date')) {
      const dateMatch = trimmed.match(DATE_TAG);
      if (dateMatch) {
        date = dateMatch[1]?.trim() || null;
      }
      continue;
    }
    
    // History entries (YYYY-MM-DD format)
    if (HISTORY_DATE.test(trimmed)) {
      history.push({
        year: trimmed.slice(0, 4),
        author: null,
        description: trimmed,
      });
      continue;
    }
    
    // Warning/caution lines
    if (WARNING_KEYWORDS.test(trimmed)) {
      warnings.push(trimmed);
      continue;
    }
    
    // Summary: first non-empty, non-tag, non-separator line
    if (!summary && trimmed && !trimmed.startsWith('@') && !trimmed.match(/^[=\-*]+$/) && !trimmed.startsWith('HISTORY')) {
      summary = trimmed;
      continue;
    }
    
    // Description: subsequent content lines
    if (summary && trimmed && !trimmed.startsWith('@') && !trimmed.match(/^[=\-*]+$/)) {
      descLines.push(trimmed);
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
    raw,
    line,
    endLine,
    associatedBlock: null,
  };
}

// ============================================================================
// Utilities
// ============================================================================

function getLineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}
