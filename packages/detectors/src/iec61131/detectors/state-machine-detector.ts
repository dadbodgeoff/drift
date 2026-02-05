/**
 * State Machine Detector
 * 
 * Single responsibility: Detect and analyze CASE-based state machines
 */

import { RegexDetector } from '../../base/regex-detector.js';

import type { DetectionContext, DetectionResult } from '../../base/base-detector.js';
import type { PatternCategory, Language, Violation, QuickFix, PatternMatch } from 'driftdetect-core';
import type { StateMachineAnalysis } from '../types.js';

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

export class StateMachineDetector extends RegexDetector {
  readonly id = 'iec61131/state-machines';
  readonly name = 'IEC 61131-3 State Machine Detector';
  readonly description = 'Detects and analyzes CASE-based state machines';
  readonly category: PatternCategory = 'structural';
  readonly subcategory = 'state-machines';
  readonly supportedLanguages: Language[] = ['structured-text' as Language];

  async detect(context: DetectionContext): Promise<DetectionResult> {
    if (!this.supportsLanguage(context.language)) {
      return this.createEmptyResult();
    }

    const stateMachines = this.extractStateMachines(context.content);
    const patterns: PatternMatch[] = [];
    const violations: Violation[] = [];

    for (const sm of stateMachines) {
      const hasIssues = sm.hasGaps || sm.states.filter(s => !s.hasComment).length > sm.stateCount / 2;
      
      patterns.push({
        patternId: `${this.id}/${sm.variable}`,
        location: {
          file: context.file,
          line: sm.line,
          column: 1,
        },
        confidence: 0.9,
        isOutlier: hasIssues,
      });

      // Check for gaps in state numbering
      if (sm.hasGaps && sm.gapValues.length > 0) {
        violations.push(this.convertViolationInfo({
          type: 'state-gaps',
          file: context.file,
          line: sm.line,
          column: 1,
          issue: `State machine '${sm.variable}' has gaps in numbering: ${sm.gapValues.join(', ')}`,
          severity: 'info',
        }));
      }

      // Check for undocumented states
      const undocumented = sm.states.filter(s => !s.hasComment);
      if (undocumented.length > sm.stateCount / 2) {
        violations.push(this.convertViolationInfo({
          type: 'undocumented-states',
          file: context.file,
          line: sm.line,
          column: 1,
          issue: `State machine '${sm.variable}' has ${undocumented.length} undocumented states`,
          severity: 'warning',
        }));
      }
    }

    return this.createResult(patterns, violations, 0.9, {
      custom: {
        stateMachineCount: stateMachines.length,
        totalStates: stateMachines.reduce((sum, sm) => sum + sm.stateCount, 0),
        stateMachines,
      },
    });
  }

  generateQuickFix(_violation: Violation): QuickFix | null {
    return null;
  }

  private extractStateMachines(content: string): StateMachineAnalysis[] {
    const machines: StateMachineAnalysis[] = [];
    
    const casePattern = /CASE\s+(\w+)\s+OF/gi;
    let match;

    while ((match = casePattern.exec(content)) !== null) {
      const variable = match[1]!;
      
      // Only process if it looks like a state variable
      if (!this.isStateVariable(variable)) continue;

      const line = content.slice(0, match.index).split('\n').length;
      const states = this.extractStates(content, match.index);
      const numericStates = states
        .map(s => s.value)
        .filter((v): v is number => typeof v === 'number')
        .sort((a, b) => a - b);

      const { hasGaps, gapValues } = this.analyzeGaps(numericStates);

      machines.push({
        variable,
        stateCount: states.length,
        states,
        hasGaps,
        gapValues,
        line,
      });
    }

    return machines;
  }

  private isStateVariable(name: string): boolean {
    return STATE_VAR_PATTERNS.some(p => p.test(name));
  }

  private extractStates(content: string, caseStart: number): Array<{ value: number | string; line: number; hasComment: boolean }> {
    const states: Array<{ value: number | string; line: number; hasComment: boolean }> = [];
    const afterCase = content.slice(caseStart);
    const endMatch = afterCase.match(/END_CASE/i);
    const caseBody = endMatch ? afterCase.slice(0, endMatch.index) : afterCase.slice(0, 2000);
    
    const caseLines = caseBody.split('\n');
    const baseLineNum = content.slice(0, caseStart).split('\n').length;

    const statePattern = /^\s*(\d+|[\w_]+)\s*:/;

    for (let i = 0; i < caseLines.length; i++) {
      const caseLine = caseLines[i]!;
      const stateMatch = caseLine.match(statePattern);
      
      if (stateMatch) {
        const rawValue = stateMatch[1]!;
        const value = /^\d+$/.test(rawValue) ? parseInt(rawValue, 10) : rawValue;
        const hasComment = caseLine.includes('(*') || caseLine.includes('//');
        
        states.push({
          value,
          line: baseLineNum + i,
          hasComment,
        });
      }
    }

    return states;
  }

  private analyzeGaps(numericStates: number[]): { hasGaps: boolean; gapValues: number[] } {
    if (numericStates.length < 2) {
      return { hasGaps: false, gapValues: [] };
    }

    const gapValues: number[] = [];
    const min = numericStates[0]!;
    const max = numericStates[numericStates.length - 1]!;
    const stateSet = new Set(numericStates);

    // Only check for gaps if states are reasonably sequential
    // (not if they're like 0, 10, 20, 30 which is intentional)
    const avgGap = (max - min) / (numericStates.length - 1);
    
    if (avgGap <= 2) {
      for (let i = min; i <= max; i++) {
        if (!stateSet.has(i)) {
          gapValues.push(i);
        }
      }
    }

    return {
      hasGaps: gapValues.length > 0,
      gapValues,
    };
  }
}
