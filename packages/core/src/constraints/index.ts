/**
 * Constraint Protocol
 *
 * Learned architectural invariants for AI-assisted code generation.
 *
 * @module constraints
 */

// Types
export * from './types.js';

// Store
export { ConstraintStore, createConstraintStore } from './store/constraint-store.js';
export type { ConstraintStoreConfig } from './store/constraint-store.js';

// Extraction
export {
  InvariantDetector,
  createInvariantDetector,
  ConstraintSynthesizer,
  createConstraintSynthesizer,
} from './extraction/index.js';
export type {
  InvariantDetectorConfig,
  DetectedInvariant,
  InvariantEvidence,
  ConstraintSynthesizerConfig,
  SynthesisOptions,
} from './extraction/index.js';

// Verification
export {
  ConstraintVerifier,
  createConstraintVerifier,
} from './verification/index.js';
export type {
  ConstraintVerifierConfig,
  VerifyOptions,
  FileContext,
} from './verification/index.js';
