/**
 * ST Variable Extractor
 * 
 * Single responsibility: Extract variable declarations from VAR sections
 */

import type { STVariable, STVarSection } from '../types.js';

export interface VariableExtractorResult {
  variables: STVariable[];
  errors: string[];
}

const VAR_SECTION_PATTERNS: Record<STVarSection, RegExp> = {
  VAR_INPUT: /^VAR_INPUT\b/i,
  VAR_OUTPUT: /^VAR_OUTPUT\b/i,
  VAR_IN_OUT: /^VAR_IN_OUT\b/i,
  VAR_GLOBAL: /^VAR_GLOBAL\b/i,
  VAR_TEMP: /^VAR_TEMP\b/i,
  VAR: /^VAR\b/i,
};

const END_VAR = /^END_VAR\b/i;

// Variable declaration: name : TYPE := value; (* comment *)
const VAR_DECL = /^\s*(\w+)\s*:\s*(ARRAY\s*\[([^\]]+)\]\s*OF\s*)?(\w+)(?:\s*:=\s*([^;]+))?;?\s*(?:\(\*([^*]*)\*\))?/i;

export function extractVariables(source: string): VariableExtractorResult {
  const variables: STVariable[] = [];
  const errors: string[] = [];
  const lines = source.split('\n');

  let currentSection: STVarSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const lineNum = i + 1;

    // Check for section start
    if (currentSection === null) {
      for (const [section, pattern] of Object.entries(VAR_SECTION_PATTERNS) as [STVarSection, RegExp][]) {
        if (pattern.test(trimmed)) {
          currentSection = section;
          break;
        }
      }
      continue;
    }

    // Check for section end
    if (END_VAR.test(trimmed)) {
      currentSection = null;
      continue;
    }

    // Skip empty lines and comments in VAR section
    if (!trimmed || trimmed.startsWith('(*') || trimmed.startsWith('//')) {
      continue;
    }

    // Parse variable declaration
    const match = trimmed.match(VAR_DECL);
    if (match) {
      const [, name, arrayPart, arrayBounds, dataType, initialValue, comment] = match;
      
      const variable: STVariable = {
        name: name!,
        dataType: dataType!,
        section: currentSection,
        line: lineNum,
        isArray: !!arrayPart,
      };

      if (initialValue) variable.initialValue = initialValue.trim();
      if (comment) variable.comment = comment.trim();
      
      if (arrayBounds) {
        const bounds = parseArrayBounds(arrayBounds);
        if (bounds) variable.arrayBounds = bounds;
      }

      variables.push(variable);
    }
  }

  return { variables, errors };
}

function parseArrayBounds(bounds: string): { low: number; high: number } | null {
  const match = bounds.match(/(\d+)\s*\.\.\s*(\d+)/);
  if (match) {
    return { low: parseInt(match[1]!, 10), high: parseInt(match[2]!, 10) };
  }
  return null;
}
