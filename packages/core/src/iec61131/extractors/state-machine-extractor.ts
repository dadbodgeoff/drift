/**
 * State Machine Extractor
 * 
 * Detects and analyzes CASE-based state machines in IEC 61131-3 code.
 * Generates visualizations (Mermaid, ASCII) and verification data.
 */

import type {
  StateMachine,
  StateMachineState,
  StateMachineTransition,
  StateMachineVerification,
  StateMachineVisualizations,
} from '../types.js';
import { generateId } from '../utils/id-generator.js';

// ============================================================================
// EXTRACTION RESULT
// ============================================================================

export interface StateMachineExtractionResult {
  stateMachines: ExtractedStateMachine[];
  summary: StateMachineSummary;
}

export interface ExtractedStateMachine extends StateMachine {
  file: string;
}

export interface StateMachineSummary {
  total: number;
  totalStates: number;
  byVariable: Record<string, number>;
  withDeadlocks: number;
  withGaps: number;
}

export interface StateMachineExtractionOptions {
  generateDiagrams?: boolean;
  includeTransitions?: boolean;
  minStates?: number;
}

// ============================================================================
// PATTERNS
// ============================================================================

// State variable naming patterns
const STATE_VAR_PATTERNS = [
  /^n?state$/i,
  /^i?step$/i,
  /^n?mode$/i,
  /^n?phase$/i,
  /^seq/i,
  /state$/i,
  /step$/i,
  /^nSeq/i,
  /^iState/i,
];

// CASE statement pattern
const CASE_PATTERN = /CASE\s+(\w+)\s+OF/gi;

// ============================================================================
// EXTRACTOR
// ============================================================================

export function extractStateMachines(
  source: string,
  filePath: string,
  pouName: string = 'UNKNOWN',
  options: StateMachineExtractionOptions = {}
): StateMachineExtractionResult {
  const {
    generateDiagrams = true,
    includeTransitions = true,
    minStates = 2,
  } = options;

  const stateMachines: ExtractedStateMachine[] = [];
  let match: RegExpExecArray | null;

  // Reset regex
  CASE_PATTERN.lastIndex = 0;

  while ((match = CASE_PATTERN.exec(source)) !== null) {
    const variable = match[1]!;
    
    // Only process if it looks like a state variable
    if (!isStateVariable(variable)) continue;

    const caseStart = match.index;
    const line = getLineNumber(source, caseStart);
    
    // Find END_CASE
    const afterCase = source.slice(caseStart);
    const endMatch = afterCase.match(/END_CASE/i);
    const caseBody = endMatch 
      ? afterCase.slice(0, endMatch.index! + 8) 
      : afterCase.slice(0, 3000);
    const endLine = line + caseBody.split('\n').length - 1;

    // Extract states
    const states = extractStates(caseBody, line, filePath);
    
    // Skip if too few states
    if (states.length < minStates) continue;

    // Extract transitions
    const transitions = includeTransitions 
      ? extractTransitions(caseBody, states, variable, line, filePath)
      : [];

    // Verify state machine
    const verification = verifyStateMachine(states, transitions);

    // Generate visualizations
    const visualizations = generateDiagrams
      ? generateVisualizations(variable, states, transitions, pouName)
      : { mermaid: '', ascii: '' };

    const stateMachine: ExtractedStateMachine = {
      id: generateId(),
      file: filePath,
      name: `${pouName}_${variable}`,
      pouId: '',
      pouName,
      stateVariable: variable,
      stateVariableType: 'INT',
      states,
      transitions,
      location: {
        file: filePath,
        line,
        column: 1,
        endLine,
      },
      verification,
      visualizations,
    };

    stateMachines.push(stateMachine);
  }

  const summary = calculateSummary(stateMachines);
  return { stateMachines, summary };
}

// ============================================================================
// STATE EXTRACTION
// ============================================================================

function extractStates(
  caseBody: string,
  baseLine: number,
  filePath: string
): StateMachineState[] {
  const states: StateMachineState[] = [];
  const lines = caseBody.split('\n');
  
  // Pattern for state labels: "10:" or "STATE_IDLE:" or "0: (* comment *)"
  const statePattern = /^\s*(\d+|[\w_]+)\s*:\s*(?:\(\*\s*(.*?)\s*\*\))?/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const stateMatch = line.match(statePattern);
    
    if (stateMatch) {
      const rawValue = stateMatch[1]!;
      const value = /^\d+$/.test(rawValue) ? parseInt(rawValue, 10) : rawValue;
      const inlineComment = stateMatch[2] || null;
      
      // Look for comment on next line if not inline
      let documentation = inlineComment;
      if (!documentation && i + 1 < lines.length) {
        const nextLine = lines[i + 1]!;
        const commentMatch = nextLine.match(/^\s*\(\*\s*(.*?)\s*\*\)/);
        if (commentMatch) {
          documentation = commentMatch[1] || null;
        }
      }

      // Infer state name from value or comment
      const name = inferStateName(value, documentation);

      // Detect if initial (value 0 or named IDLE/INIT)
      const isInitial = value === 0 || 
        (typeof value === 'string' && /^(IDLE|INIT|START|READY)/i.test(value));

      // Detect if final (named DONE/COMPLETE/FINISHED)
      const isFinal = typeof value === 'string' && 
        /^(DONE|COMPLETE|FINISHED|END|STOP)/i.test(value);

      // Extract actions in this state
      const actions = extractStateActions(lines, i);

      states.push({
        id: generateId(),
        value,
        name,
        documentation,
        isInitial,
        isFinal,
        actions,
        location: {
          file: filePath,
          line: baseLine + i,
          column: 1,
        },
      });
    }
  }

  return states;
}

function inferStateName(value: number | string, documentation: string | null): string | null {
  // If value is already a name, use it
  if (typeof value === 'string') {
    return value.replace(/_/g, ' ');
  }

  // Try to extract from documentation
  if (documentation) {
    // "State 10: Filling" -> "Filling"
    const match = documentation.match(/(?:state\s*\d*\s*[-:]?\s*)?(.+)/i);
    if (match) {
      return match[1]!.trim();
    }
  }

  // Common state value conventions
  const commonNames: Record<number, string> = {
    0: 'Idle',
    10: 'Initialize',
    20: 'Ready',
    100: 'Complete',
    999: 'Fault',
    90: 'Stopping',
  };

  return commonNames[value] || null;
}

function extractStateActions(lines: string[], stateLineIndex: number): string[] {
  const actions: string[] = [];
  
  // Look at lines after state label until next state or END_CASE
  for (let i = stateLineIndex + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    
    // Stop at next state or END_CASE
    if (/^\d+\s*:/.test(line) || /^[\w_]+\s*:/.test(line) || /END_CASE/i.test(line)) {
      break;
    }
    
    // Skip empty lines and comments
    if (!line || line.startsWith('(*')) continue;
    
    // Capture assignments and function calls
    if (line.includes(':=') || line.includes('(')) {
      actions.push(line.replace(/;$/, ''));
    }
  }

  return actions.slice(0, 5); // Limit to first 5 actions
}

// ============================================================================
// TRANSITION EXTRACTION
// ============================================================================

function extractTransitions(
  caseBody: string,
  states: StateMachineState[],
  stateVar: string,
  baseLine: number,
  filePath: string
): StateMachineTransition[] {
  const transitions: StateMachineTransition[] = [];
  const lines = caseBody.split('\n');
  
  // Build state value to ID map
  const stateMap = new Map<string, string>();
  for (const state of states) {
    stateMap.set(String(state.value), state.id);
  }

  let currentStateId: string | null = null;
  let currentStateLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    
    // Track current state
    const stateMatch = line.match(/^\s*(\d+|[\w_]+)\s*:/);
    if (stateMatch) {
      currentStateId = stateMap.get(stateMatch[1]!) || null;
      currentStateLine = i;
      continue;
    }

    if (!currentStateId) continue;

    // Look for state assignments
    const assignPattern = new RegExp(`${stateVar}\\s*:=\\s*(\\d+|[\\w_]+)\\s*;`, 'gi');
    let assignMatch: RegExpExecArray | null;
    
    while ((assignMatch = assignPattern.exec(line)) !== null) {
      const targetValue = assignMatch[1]!;
      const targetStateId = stateMap.get(targetValue);
      
      if (targetStateId && targetStateId !== currentStateId) {
        // Extract guard condition (IF before assignment)
        const guard = extractGuard(lines, i, currentStateLine);
        
        transitions.push({
          id: generateId(),
          fromStateId: currentStateId,
          toStateId: targetStateId,
          guard,
          actions: [],
          documentation: null,
          location: {
            file: filePath,
            line: baseLine + i,
            column: 1,
          },
        });
      }
    }
  }

  return transitions;
}

function extractGuard(lines: string[], assignLine: number, stateStartLine: number): string | null {
  // Look backwards for IF condition
  for (let i = assignLine; i >= stateStartLine; i--) {
    const line = lines[i]!.trim();
    
    const ifMatch = line.match(/IF\s+(.+?)\s+THEN/i);
    if (ifMatch) {
      return ifMatch[1]!.trim();
    }
    
    const elsifMatch = line.match(/ELSIF\s+(.+?)\s+THEN/i);
    if (elsifMatch) {
      return elsifMatch[1]!.trim();
    }
  }
  
  return null;
}

// ============================================================================
// VERIFICATION
// ============================================================================

function verifyStateMachine(
  states: StateMachineState[],
  transitions: StateMachineTransition[]
): StateMachineVerification {
  // Check for gaps in numeric states
  const numericValues = states
    .map(s => s.value)
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b);

  const { hasGaps, gapValues } = analyzeGaps(numericValues);

  // Check for unreachable states (no incoming transitions except initial)
  const reachable = new Set<string>();
  const initial = states.find(s => s.isInitial);
  if (initial) reachable.add(initial.id);
  
  for (const trans of transitions) {
    reachable.add(trans.toStateId);
  }
  
  const unreachableStates = states
    .filter(s => !s.isInitial && !reachable.has(s.id))
    .map(s => s.name || String(s.value));

  // Check for deadlocks (states with no outgoing transitions except final)
  const hasOutgoing = new Set<string>();
  for (const trans of transitions) {
    hasOutgoing.add(trans.fromStateId);
  }
  
  const deadlockStates = states
    .filter(s => !s.isFinal && !hasOutgoing.has(s.id))
    .map(s => s.name || String(s.value));

  // Check for missing transitions (states that should connect but don't)
  const missingTransitions: string[] = [];
  // This is a simplified check - could be more sophisticated

  return {
    hasDeadlocks: deadlockStates.length > 0,
    unreachableStates,
    missingTransitions,
    hasGaps,
    gapValues,
  };
}

function analyzeGaps(numericStates: number[]): { hasGaps: boolean; gapValues: number[] } {
  if (numericStates.length < 2) {
    return { hasGaps: false, gapValues: [] };
  }

  const gapValues: number[] = [];
  const min = numericStates[0]!;
  const max = numericStates[numericStates.length - 1]!;
  const stateSet = new Set(numericStates);

  // Only check for gaps if states are reasonably sequential
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

// ============================================================================
// VISUALIZATION
// ============================================================================

function generateVisualizations(
  variable: string,
  states: StateMachineState[],
  transitions: StateMachineTransition[],
  pouName: string
): StateMachineVisualizations {
  return {
    mermaid: generateMermaidDiagram(variable, states, transitions, pouName),
    ascii: generateAsciiDiagram(variable, states, transitions),
  };
}

function generateMermaidDiagram(
  variable: string,
  states: StateMachineState[],
  transitions: StateMachineTransition[],
  pouName: string
): string {
  const lines: string[] = [
    'stateDiagram-v2',
    `    %% State Machine: ${pouName}.${variable}`,
  ];

  // Build state ID map
  const stateIdMap = new Map<string, string>();
  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    const mermaidId = `s${i}`;
    stateIdMap.set(state.id, mermaidId);
    
    const label = state.name || `State_${state.value}`;
    lines.push(`    ${mermaidId}: ${label}`);
    
    if (state.documentation) {
      lines.push(`    note right of ${mermaidId}: ${state.documentation.slice(0, 50)}`);
    }
  }

  // Initial state
  const initial = states.find(s => s.isInitial);
  if (initial) {
    lines.push(`    [*] --> ${stateIdMap.get(initial.id)}`);
  }

  // Transitions
  for (const trans of transitions) {
    const from = stateIdMap.get(trans.fromStateId);
    const to = stateIdMap.get(trans.toStateId);
    if (from && to) {
      const guard = trans.guard ? ` : ${trans.guard.slice(0, 30)}` : '';
      lines.push(`    ${from} --> ${to}${guard}`);
    }
  }

  // Final states
  for (const state of states.filter(s => s.isFinal)) {
    const mermaidId = stateIdMap.get(state.id);
    if (mermaidId) {
      lines.push(`    ${mermaidId} --> [*]`);
    }
  }

  return lines.join('\n');
}

function generateAsciiDiagram(
  variable: string,
  states: StateMachineState[],
  transitions: StateMachineTransition[]
): string {
  const lines: string[] = [
    `State Machine: ${variable}`,
    '=' .repeat(40),
    '',
  ];

  // List states
  lines.push('States:');
  for (const state of states) {
    const markers: string[] = [];
    if (state.isInitial) markers.push('INITIAL');
    if (state.isFinal) markers.push('FINAL');
    const markerStr = markers.length > 0 ? ` [${markers.join(', ')}]` : '';
    
    const name = state.name || `State_${state.value}`;
    lines.push(`  ${state.value}: ${name}${markerStr}`);
    
    if (state.documentation) {
      lines.push(`      "${state.documentation.slice(0, 50)}"`);
    }
  }

  lines.push('');
  lines.push('Transitions:');
  
  // Build state value map
  const stateValueMap = new Map<string, string | number>();
  for (const state of states) {
    stateValueMap.set(state.id, state.value);
  }

  for (const trans of transitions) {
    const from = stateValueMap.get(trans.fromStateId);
    const to = stateValueMap.get(trans.toStateId);
    const guard = trans.guard ? ` [${trans.guard.slice(0, 30)}]` : '';
    lines.push(`  ${from} --> ${to}${guard}`);
  }

  return lines.join('\n');
}

// ============================================================================
// HELPERS
// ============================================================================

function isStateVariable(name: string): boolean {
  return STATE_VAR_PATTERNS.some(p => p.test(name));
}

function getLineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function calculateSummary(stateMachines: ExtractedStateMachine[]): StateMachineSummary {
  const byVariable: Record<string, number> = {};
  let totalStates = 0;
  let withDeadlocks = 0;
  let withGaps = 0;

  for (const sm of stateMachines) {
    byVariable[sm.stateVariable] = (byVariable[sm.stateVariable] || 0) + 1;
    totalStates += sm.states.length;
    if (sm.verification.hasDeadlocks) withDeadlocks++;
    if (sm.verification.hasGaps) withGaps++;
  }

  return {
    total: stateMachines.length,
    totalStates,
    byVariable,
    withDeadlocks,
    withGaps,
  };
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export function extractStateMachinesFromFiles(
  files: Array<{ path: string; content: string; pouName?: string }>,
  options?: StateMachineExtractionOptions
): StateMachineExtractionResult {
  const allMachines: ExtractedStateMachine[] = [];

  for (const file of files) {
    const result = extractStateMachines(
      file.content, 
      file.path, 
      file.pouName || 'UNKNOWN',
      options
    );
    allMachines.push(...result.stateMachines);
  }

  const summary = calculateSummary(allMachines);
  return { stateMachines: allMachines, summary };
}
