/**
 * IEC 61131-3 Extractors
 * 
 * All extraction modules for ST code analysis.
 */

// Docstring extraction (PhD's primary request)
export {
  extractDocstrings,
  extractDocstringsFromFiles,
} from './docstring-extractor.js';
export type {
  DocstringExtractionResult,
  ExtractedDocstring,
  DocstringQuality,
  DocstringSummary,
  DocstringExtractionOptions,
} from './docstring-extractor.js';

// State machine extraction
export {
  extractStateMachines,
  extractStateMachinesFromFiles,
} from './state-machine-extractor.js';
export type {
  StateMachineExtractionResult,
  ExtractedStateMachine,
  StateMachineSummary,
  StateMachineExtractionOptions,
} from './state-machine-extractor.js';

// Safety interlock extraction (CRITICAL)
export {
  extractSafetyInterlocks,
  extractSafetyFromFiles,
} from './safety-extractor.js';
export type {
  SafetyExtractionResult,
  SafetyExtractionOptions,
} from './safety-extractor.js';

// Tribal knowledge extraction
export {
  extractTribalKnowledge,
  extractTribalKnowledgeFromFiles,
} from './tribal-knowledge-extractor.js';
export type {
  TribalKnowledgeExtractionResult,
  ExtractedTribalKnowledge,
  TribalKnowledgeSummary,
  TribalKnowledgeExtractionOptions,
} from './tribal-knowledge-extractor.js';

// Variable extraction
export {
  extractVariables,
  extractVariablesFromFiles,
} from './variable-extractor.js';
export type {
  VariableExtractionResult,
  ExtractedVariable,
  VariableSummary,
  VariableExtractionOptions,
} from './variable-extractor.js';
