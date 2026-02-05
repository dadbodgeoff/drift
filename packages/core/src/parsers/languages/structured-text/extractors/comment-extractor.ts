/**
 * ST Comment Extractor
 * 
 * Single responsibility: Extract comments from ST source
 */

import type { STComment } from '../types.js';

export interface CommentExtractorResult {
  comments: STComment[];
}

// Block comment: (* ... *)
const BLOCK_COMMENT = /\(\*[\s\S]*?\*\)/g;

// Line comment: // ...
const LINE_COMMENT = /\/\/.*$/gm;

export function extractComments(source: string): CommentExtractorResult {
  const comments: STComment[] = [];

  // Extract block comments
  let match;
  while ((match = BLOCK_COMMENT.exec(source)) !== null) {
    const startLine = getLineNumber(source, match.index);
    const endLine = getLineNumber(source, match.index + match[0].length);
    const startColumn = getColumnNumber(source, match.index);

    comments.push({
      content: match[0],
      style: 'block',
      startLine,
      endLine,
      startColumn,
    });
  }

  // Extract line comments
  while ((match = LINE_COMMENT.exec(source)) !== null) {
    const line = getLineNumber(source, match.index);
    const column = getColumnNumber(source, match.index);

    comments.push({
      content: match[0],
      style: 'line',
      startLine: line,
      endLine: line,
      startColumn: column,
    });
  }

  // Sort by position
  comments.sort((a, b) => a.startLine - b.startLine || a.startColumn - b.startColumn);

  return { comments };
}

function getLineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function getColumnNumber(source: string, offset: number): number {
  const lastNewline = source.lastIndexOf('\n', offset - 1);
  return offset - lastNewline;
}
