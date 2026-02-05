/**
 * IEC 61131-3 Structured Text Types
 * 
 * Single responsibility: Type definitions only
 */

// ============================================================================
// Block Types
// ============================================================================

export type STBlockType = 'PROGRAM' | 'FUNCTION_BLOCK' | 'FUNCTION';

export interface STBlock {
  name: string;
  type: STBlockType;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

// ============================================================================
// Variable Types
// ============================================================================

export type STVarSection = 'VAR_INPUT' | 'VAR_OUTPUT' | 'VAR_IN_OUT' | 'VAR' | 'VAR_GLOBAL' | 'VAR_TEMP';

export interface STVariable {
  name: string;
  dataType: string;
  section: STVarSection;
  initialValue?: string;
  comment?: string;
  isArray: boolean;
  arrayBounds?: { low: number; high: number };
  line: number;
}

// ============================================================================
// Comment Types
// ============================================================================

export interface STComment {
  content: string;
  style: 'block' | 'line';  // (* *) vs //
  startLine: number;
  endLine: number;
  startColumn: number;
}

// ============================================================================
// Function Block Info
// ============================================================================

export interface STFunctionBlockInfo extends STBlock {
  inputs: STVariable[];
  outputs: STVariable[];
  inOuts: STVariable[];
  locals: STVariable[];
  temps: STVariable[];
}

// ============================================================================
// Timer/Counter Types
// ============================================================================

export type STTimerType = 'TON' | 'TOF' | 'TP' | 'TONR';
export type STCounterType = 'CTU' | 'CTD' | 'CTUD';

export interface STTimerInstance {
  name: string;
  type: STTimerType;
  line: number;
}

export interface STCounterInstance {
  name: string;
  type: STCounterType;
  line: number;
}

// ============================================================================
// State Machine Types
// ============================================================================

export interface STStateCase {
  variable: string;
  states: Array<{ value: number | string; line: number }>;
  line: number;
  endLine: number;
}

// ============================================================================
// Parse Result
// ============================================================================

export interface STParseResult {
  blocks: STBlock[];
  variables: STVariable[];
  comments: STComment[];
  timers: STTimerInstance[];
  counters: STCounterInstance[];
  stateCases: STStateCase[];
  errors: string[];
}
