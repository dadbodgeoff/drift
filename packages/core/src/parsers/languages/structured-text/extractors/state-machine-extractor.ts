/**
 * ST State Machine Extractor
 * 
 * Single responsibility: Extract CASE-based state machines
 * 
 * Detects state machines by looking for CASE statements on variables
 * that match common state variable naming patterns (nState, iStep, etc.)
 */

import type { STStateCase } from '../types.js';

export interface StateMachineExtractorResult {
  stateCases: STStateCase[];
}

// Common state variable naming patterns
const STATE_VAR_PATTERNS = [
  /^n?state$/i,
  /^i?step$/i,
  /^n?mode$/i,
  /^n?phase$/i,
  /^seq/i,
  /state$/i,
  /step$/i,
];

// CASE variable OF
const CASE_PATTERN = /CASE\s+(\w+)\s+OF/gi;

export function extractStateMachines(source: string): StateMachineExtractorResult {
  const stateCases: STStateCase[] = [];
  
  // Reset regex state
  const casePattern = new RegExp(CASE_PATTERN.source, CASE_PATTERN.flags);
  let match;

  while ((match = casePattern.exec(source)) !== null) {
    const variable = match[1]!;
    
    // Only process if it looks like a state variable
    if (!STATE_VAR_PATTERNS.some(p => p.test(variable))) {
      continue;
    }

    const line = getLineNumber(source, match.index);
    
    // Extract CASE body until END_CASE
    const afterCase = source.slice(match.index);
    const endMatch = afterCase.match(/END_CASE/i);
    const caseBody = endMatch ? afterCase.slice(0, endMatch.index) : afterCase.slice(0, 2000);
    
    // Extract states - only match numeric labels at start of line
    // Pattern: whitespace, number, colon (not assignments like "nState := 10;")
    const states: Array<{ value: number | string; line: number }> = [];
    const statePattern = /^\s*(\d+)\s*:/gm;
    let stateMatch;
    
    while ((stateMatch = statePattern.exec(caseBody)) !== null) {
      const rawValue = stateMatch[1]!;
      const value = parseInt(rawValue, 10);
      const stateLine = line + caseBody.slice(0, stateMatch.index).split('\n').length - 1;
      
      states.push({ value, line: stateLine });
    }

    // Calculate end line
    const endLine = endMatch 
      ? line + caseBody.split('\n').length
      : line + Math.min(caseBody.split('\n').length, 50);

    stateCases.push({
      variable,
      states,
      line,
      endLine,
    });
  }

  return { stateCases };
}

// ============================================================================
// Utilities
// ============================================================================

function getLineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}
