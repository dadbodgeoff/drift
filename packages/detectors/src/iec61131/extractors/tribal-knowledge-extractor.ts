/**
 * Tribal Knowledge Extractor
 * 
 * Single responsibility: Extract institutional knowledge from legacy comments
 */

import type { TribalKnowledgeItem, TribalKnowledgeType } from '../types.js';

// ============================================================================
// Pattern Definitions
// ============================================================================

interface KnowledgePattern {
  type: TribalKnowledgeType;
  pattern: RegExp;
}

const KNOWLEDGE_PATTERNS: KnowledgePattern[] = [
  // Historical references
  { type: 'history', pattern: /(?:since|from|in)\s+\d{4}/gi },
  { type: 'history', pattern: /(?:original|originally)\s+(?:written|coded|done)/gi },
  { type: 'history', pattern: /(?:converted|migrated|ported)\s+(?:from|to)/gi },
  
  // Person references
  { type: 'author', pattern: /\b(Bob|Joe|Jim|Dave|Mike|Tom|Bill|Steve)\s+(?:wrote|did|added|fixed|made)/gi },
  { type: 'author', pattern: /\b[A-Z]{2,4}\s+(?:wrote|did|added|fixed)/gi },
  
  // Equipment notes
  { type: 'equipment', pattern: /(?:Tank|Pump|Valve|Motor|Conveyor|Sensor)\s*[-#]?\s*\d+\s+(?:is|has|was|needs|sticks|fails)/gi },
  { type: 'equipment', pattern: /(?:different|new|old)\s+(?:transmitter|sensor|motor|valve)/gi },
  
  // Workarounds
  { type: 'workaround', pattern: /(?:workaround|hack|kludge|temporary|quick)\s*(?:fix|solution)?/gi },
  { type: 'workaround', pattern: /(?:this|it)\s+(?:works|worked)\s+(?:but|because|somehow)/gi },
  { type: 'workaround', pattern: /(?:should|supposed)\s+to\s+(?:be|work|fix)/gi },
  
  // Warnings
  { type: 'warning', pattern: /(?:WARNING|DANGER|CAUTION|DO NOT|DONT|NEVER)\s+(?:TOUCH|CHANGE|MODIFY|REMOVE|DELETE)/gi },
  { type: 'warning', pattern: /(?:caused|cause)\s+(?:a|an)?\s*(?:outage|crash|failure|problem)/gi },
  
  // Mysteries
  { type: 'mystery', pattern: /(?:nobody|no one)\s+(?:knows|understands|remembers)/gi },
  { type: 'mystery', pattern: /(?:magic|voodoo)\s+(?:number|value|constant)/gi },
  { type: 'mystery', pattern: /(?:dont|don't)\s+(?:ask|know)\s+(?:why|how)/gi },
  
  // TODOs
  { type: 'todo', pattern: /\bTODO\b[:\s]*/gi },
  { type: 'todo', pattern: /\bFIXME\b[:\s]*/gi },
  { type: 'todo', pattern: /(?:needs|need)\s+(?:to be|to)\s+(?:fixed|updated|changed)/gi },
];

// ============================================================================
// Extractor
// ============================================================================

export function extractTribalKnowledge(source: string, filePath: string): TribalKnowledgeItem[] {
  const items: TribalKnowledgeItem[] = [];
  const lines = source.split('\n');
  const seen = new Set<string>();

  // Only look in comments
  const commentRanges = findCommentRanges(source);

  for (const { pattern, type } of KNOWLEDGE_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(source)) !== null) {
      // Check if match is within a comment
      if (!isInComment(match.index, commentRanges)) {
        continue;
      }

      const line = getLineNumber(source, match.index);
      const fullLine = lines[line - 1]?.trim() || '';
      
      // Deduplicate
      const key = `${type}:${line}:${fullLine.slice(0, 50)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Get surrounding context
      const context = getContext(lines, line - 1, 2);

      items.push({
        type,
        content: match[0],
        context,
        line,
        file: filePath,
      });
    }
  }

  return items;
}

// ============================================================================
// Utilities
// ============================================================================

interface CommentRange {
  start: number;
  end: number;
}

function findCommentRanges(source: string): CommentRange[] {
  const ranges: CommentRange[] = [];
  
  // Block comments
  const blockPattern = /\(\*[\s\S]*?\*\)/g;
  let match;
  while ((match = blockPattern.exec(source)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  
  // Line comments
  const linePattern = /\/\/.*$/gm;
  while ((match = linePattern.exec(source)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  
  return ranges;
}

function isInComment(offset: number, ranges: CommentRange[]): boolean {
  return ranges.some(r => offset >= r.start && offset < r.end);
}

function getLineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function getContext(lines: string[], lineIndex: number, radius: number): string {
  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);
  return lines.slice(start, end).join('\n');
}
