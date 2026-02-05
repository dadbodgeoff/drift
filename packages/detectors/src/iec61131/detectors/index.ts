/**
 * IEC 61131-3 Detectors Index
 * 
 * Single responsibility: Export all detectors
 */

export { STDocstringDetector as DocstringDetector } from './docstring-detector.js';
export { TribalKnowledgeDetector } from './tribal-knowledge-detector.js';
export { SafetyInterlockDetector as SafetyDetector } from './safety-detector.js';
export { StateMachineDetector } from './state-machine-detector.js';
