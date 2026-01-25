/**
 * Rust Language Support Module
 *
 * Exports all Rust-related functionality for use by CLI and MCP tools.
 */

// Main analyzer
export {
  RustAnalyzer,
  createRustAnalyzer,
  type RustAnalyzerOptions,
  type RustRoute,
  type RustErrorPattern,
  type RustCustomError,
  type RustTrait,
  type RustTraitImpl,
  type RustDataAccessPoint,
  type RustAsyncFunction,
  type RustCrate,
  type RustIssue,
} from './rust-analyzer.js';
