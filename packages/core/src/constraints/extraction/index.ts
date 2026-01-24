/**
 * Constraint Extraction Module
 *
 * Detects and synthesizes architectural constraints from Drift's analysis data.
 */

// Invariant Detector
export {
  InvariantDetector,
  createInvariantDetector,
} from './invariant-detector.js';
export type {
  InvariantDetectorConfig,
  DetectedInvariant,
  InvariantEvidence,
} from './invariant-detector.js';

// Constraint Synthesizer
export {
  ConstraintSynthesizer,
  createConstraintSynthesizer,
} from './constraint-synthesizer.js';
export type {
  ConstraintSynthesizerConfig,
  SynthesisOptions,
} from './constraint-synthesizer.js';
