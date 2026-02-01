/**
 * Setup Utilities - Shared helper functions
 * 
 * @module commands/setup/utils
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { shouldIgnoreDirectory } from 'driftdetect-core';

import {
  DRIFT_DIR,
  DRIFT_SUBDIRS,
  SOURCE_OF_TRUTH_FILE,
  SETUP_STATE_FILE,
  SCHEMA_VERSION,
  type SourceOfTruth,
  type SetupState,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// FILE SYSTEM HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export async function isDriftInitialized(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR));
    return true;
  } catch {
    return false;
  }
}

export async function createDriftDirectory(rootDir: string): Promise<void> {
  const driftDir = path.join(rootDir, DRIFT_DIR);
  await fs.mkdir(driftDir, { recursive: true });

  for (const subdir of DRIFT_SUBDIRS) {
    await fs.mkdir(path.join(driftDir, subdir), { recursive: true });
  }
}

export async function createDefaultConfig(rootDir: string, projectId: string): Promise<void> {
  const configPath = path.join(rootDir, DRIFT_DIR, 'config.json');
  const config = {
    version: SCHEMA_VERSION,
    project: {
      id: projectId,
      name: path.basename(rootDir),
      initializedAt: new Date().toISOString(),
    },
    severity: {},
    ignore: [
      'node_modules/**', 'dist/**', 'build/**', '.git/**', 'coverage/**',
      '*.min.js', '*.bundle.js', 'vendor/**', '__pycache__/**', '.venv/**',
      'target/**', 'bin/**', 'obj/**',
    ],
    ci: { failOn: 'error', reportFormat: 'text' },
    learning: { autoApproveThreshold: 0.85, minOccurrences: 3, semanticLearning: true },
    performance: { maxWorkers: 4, cacheEnabled: true, incrementalAnalysis: true, cacheTTL: 3600 },
    features: { callGraph: true, boundaries: true, dna: true, contracts: true },
  };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

export async function createDriftignore(rootDir: string): Promise<void> {
  const driftignorePath = path.join(rootDir, '.driftignore');
  try {
    await fs.access(driftignorePath);
  } catch {
    await fs.writeFile(driftignorePath, `# Drift ignore patterns
node_modules/
dist/
build/
.git/
coverage/
vendor/
__pycache__/
.venv/
target/
bin/
obj/
`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE OF TRUTH
// ═══════════════════════════════════════════════════════════════════════════

export async function loadSourceOfTruth(rootDir: string): Promise<SourceOfTruth | null> {
  try {
    const sotPath = path.join(rootDir, DRIFT_DIR, SOURCE_OF_TRUTH_FILE);
    const content = await fs.readFile(sotPath, 'utf-8');
    return JSON.parse(content) as SourceOfTruth;
  } catch {
    return null;
  }
}

export async function saveSourceOfTruth(rootDir: string, sot: SourceOfTruth): Promise<void> {
  const sotPath = path.join(rootDir, DRIFT_DIR, SOURCE_OF_TRUTH_FILE);
  sot.updatedAt = new Date().toISOString();
  await fs.writeFile(sotPath, JSON.stringify(sot, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════════
// SETUP STATE (for resume)
// ═══════════════════════════════════════════════════════════════════════════

export async function loadSetupState(rootDir: string): Promise<SetupState | null> {
  try {
    const statePath = path.join(rootDir, DRIFT_DIR, SETUP_STATE_FILE);
    const content = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(content) as SetupState;
  } catch {
    return null;
  }
}

export async function saveSetupState(rootDir: string, state: SetupState): Promise<void> {
  const statePath = path.join(rootDir, DRIFT_DIR, SETUP_STATE_FILE);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

export async function clearSetupState(rootDir: string): Promise<void> {
  try {
    const statePath = path.join(rootDir, DRIFT_DIR, SETUP_STATE_FILE);
    await fs.unlink(statePath);
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.cs', '.java', '.php', '.go', '.rs',
]);

export async function countSourceFiles(rootDir: string): Promise<number> {
  let count = 0;

  async function walk(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !shouldIgnoreDirectory(entry.name)) {
          await walk(path.join(dir, entry.name));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SOURCE_EXTENSIONS.has(ext)) {
            count++;
          }
        }
      }
    } catch { /* skip */ }
  }

  await walk(rootDir);
  return count;
}

export async function findSourceFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory() && !shouldIgnoreDirectory(entry.name)) {
          await walk(fullPath, relPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SOURCE_EXTENSIONS.has(ext)) {
            files.push(relPath);
          }
        }
      }
    } catch { /* skip */ }
  }

  await walk(rootDir);
  return files;
}

// ═══════════════════════════════════════════════════════════════════════════
// MISC HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export function computeChecksum(data: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

export function isScannableFile(filePath: string): boolean {
  const exts = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'cs', 'java', 'php', 'go', 'rs', 'c', 'cpp', 'cc', 'h', 'hpp', 'vue', 'svelte'];
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return exts.includes(ext);
}
