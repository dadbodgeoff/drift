/**
 * ST Block Extractor
 * 
 * Single responsibility: Extract PROGRAM, FUNCTION_BLOCK, FUNCTION definitions
 */

import type { STBlock, STBlockType } from '../types.js';

export interface BlockExtractorResult {
  blocks: STBlock[];
  errors: string[];
}

const BLOCK_PATTERNS: Record<STBlockType, RegExp> = {
  PROGRAM: /^(PROGRAM)\s+(\w+)/i,
  FUNCTION_BLOCK: /^(FUNCTION_BLOCK)\s+(\w+)/i,
  FUNCTION: /^(FUNCTION)\s+(\w+)\s*:\s*(\w+)/i,
};

const END_PATTERNS: Record<STBlockType, RegExp> = {
  PROGRAM: /^END_PROGRAM\b/i,
  FUNCTION_BLOCK: /^END_FUNCTION_BLOCK\b/i,
  FUNCTION: /^END_FUNCTION\b/i,
};

export function extractBlocks(source: string): BlockExtractorResult {
  const blocks: STBlock[] = [];
  const errors: string[] = [];
  const lines = source.split('\n');

  const openBlocks: Array<{ type: STBlockType; name: string; startLine: number; startColumn: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const lineNum = i + 1;

    // Check for block starts
    for (const [type, pattern] of Object.entries(BLOCK_PATTERNS) as [STBlockType, RegExp][]) {
      const match = trimmed.match(pattern);
      if (match) {
        openBlocks.push({
          type,
          name: match[2]!,
          startLine: lineNum,
          startColumn: line.indexOf(match[0]) + 1,
        });
        break;
      }
    }

    // Check for block ends
    for (const [type, pattern] of Object.entries(END_PATTERNS) as [STBlockType, RegExp][]) {
      if (pattern.test(trimmed)) {
        // Find last matching open block (compatible with older ES targets)
        let openIdx = -1;
        for (let i = openBlocks.length - 1; i >= 0; i--) {
          if (openBlocks[i]!.type === type) {
            openIdx = i;
            break;
          }
        }
        if (openIdx >= 0) {
          const open = openBlocks[openIdx]!;
          blocks.push({
            name: open.name,
            type: open.type,
            startLine: open.startLine,
            endLine: lineNum,
            startColumn: open.startColumn,
            endColumn: line.length,
          });
          openBlocks.splice(openIdx, 1);
        } else {
          errors.push(`Unmatched END_${type} at line ${lineNum}`);
        }
        break;
      }
    }
  }

  // Report unclosed blocks
  for (const open of openBlocks) {
    errors.push(`Unclosed ${open.type} '${open.name}' starting at line ${open.startLine}`);
  }

  return { blocks, errors };
}
