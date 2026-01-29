/**
 * Native Scanner - Rust-powered file scanning
 * 
 * This module provides a TypeScript interface to the Rust scanner.
 * Falls back to the TypeScript implementation if the native addon is unavailable.
 */

// Types matching the Rust scanner output
export interface NativeScanResult {
  root: string;
  files: NativeFileInfo[];
  stats: NativeScanStats;
  errors: string[];
}

export interface NativeFileInfo {
  path: string;
  size: number;
  hash: string | null;
  language: string | null;
}

export interface NativeScanStats {
  totalFiles: number;
  totalBytes: number;
  dirsSkipped: number;
  filesSkipped: number;
  durationMs: number;
}

export interface NativeScanConfig {
  root: string;
  patterns: string[];
  extraIgnores?: string[];
  computeHashes?: boolean;
  maxFileSize?: number;
  threads?: number;
}

// Native addon interface
interface NativeAddon {
  scan(config: NativeScanConfig): NativeScanResult;
  version(): string;
}

// Try to load the native addon
let nativeAddon: NativeAddon | null = null;
let loadError: Error | null = null;

try {
  // The native addon will be at @drift/native when published
  // For development, it's built in crates/drift-napi
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nativeAddon = require('@drift/native') as NativeAddon;
} catch (e) {
  loadError = e instanceof Error ? e : new Error(String(e));
}

/**
 * Check if the native scanner is available
 */
export function isNativeScannerAvailable(): boolean {
  return nativeAddon !== null;
}

/**
 * Get the native scanner load error (if any)
 */
export function getNativeScannerError(): Error | null {
  return loadError;
}

/**
 * Get the native scanner version
 */
export function getNativeScannerVersion(): string | null {
  return nativeAddon?.version() ?? null;
}

/**
 * Scan using the native Rust scanner
 * 
 * @throws Error if native scanner is not available
 */
export function nativeScan(config: NativeScanConfig): NativeScanResult {
  if (!nativeAddon) {
    throw new Error(
      `Native scanner not available: ${loadError?.message ?? 'Unknown error'}`
    );
  }
  
  return nativeAddon.scan(config);
}

/**
 * Scan with automatic fallback to TypeScript implementation
 * 
 * Uses native scanner if available, otherwise falls back to TypeScript.
 * This is the recommended way to use the scanner for maximum compatibility.
 */
export async function scanWithFallback(
  config: NativeScanConfig,
  fallback: () => Promise<NativeScanResult>
): Promise<NativeScanResult> {
  if (nativeAddon) {
    try {
      return nativeAddon.scan(config);
    } catch (e) {
      // If native fails, fall back to TypeScript
      console.warn(
        `Native scanner failed, falling back to TypeScript: ${e instanceof Error ? e.message : e}`
      );
    }
  }
  
  return fallback();
}
