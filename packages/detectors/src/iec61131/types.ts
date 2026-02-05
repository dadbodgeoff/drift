/**
 * IEC 61131-3 Detector Types
 * 
 * Single responsibility: Type definitions for ST detectors
 */

// ============================================================================
// Docstring Types
// ============================================================================

export interface STDocstring {
  summary: string;
  description: string;
  params: STDocParam[];
  returns: string | null;
  author: string | null;
  date: string | null;
  history: STHistoryEntry[];
  warnings: string[];
  raw: string;
  line: number;
  endLine: number;
  associatedBlock: string | null;
}

export interface STDocParam {
  name: string;
  type: string | null;
  description: string;
}

export interface STHistoryEntry {
  year: string;
  author: string | null;
  description: string;
}

// ============================================================================
// Tribal Knowledge Types
// ============================================================================

export type TribalKnowledgeType = 
  | 'history'
  | 'author'
  | 'equipment'
  | 'workaround'
  | 'warning'
  | 'mystery'
  | 'todo';

export interface TribalKnowledgeItem {
  type: TribalKnowledgeType;
  content: string;
  context: string;
  line: number;
  file: string;
}

// ============================================================================
// Safety Types
// ============================================================================

export interface SafetyInterlock {
  name: string;
  type: 'interlock' | 'permissive' | 'estop' | 'bypass';
  line: number;
  isBypassed: boolean;
}

// ============================================================================
// Function Block Analysis Types
// ============================================================================

export interface FunctionBlockAnalysis {
  name: string;
  type: 'PROGRAM' | 'FUNCTION_BLOCK' | 'FUNCTION';
  inputCount: number;
  outputCount: number;
  localCount: number;
  hasDocstring: boolean;
  complexity: 'simple' | 'moderate' | 'complex';
  line: number;
}

// ============================================================================
// State Machine Analysis Types
// ============================================================================

export interface StateMachineAnalysis {
  variable: string;
  stateCount: number;
  states: Array<{ value: number | string; line: number; hasComment: boolean }>;
  hasGaps: boolean;
  gapValues: number[];
  line: number;
}
