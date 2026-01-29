/**
 * Git Hooks - Pre-commit and pre-push hook setup
 *
 * Provides functionality to install and manage Git hooks for Drift integration.
 * Supports both Husky-based and direct Git hooks installation.
 *
 * @requirements 37.1, 37.3
 */

import { exec } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Hook types supported by Drift
 */
export type HookType = 'pre-commit' | 'pre-push';

/**
 * Result of a hook installation operation
 */
export interface HookInstallResult {
  success: boolean;
  hookType: HookType;
  method: 'husky' | 'git';
  message: string;
  path?: string;
}

/**
 * Options for hook installation
 */
export interface HookInstallOptions {
  /** Force overwrite existing hooks */
  force?: boolean;
  /** Use Husky if available */
  preferHusky?: boolean;
}

/**
 * Pre-commit hook script content
 * Runs drift check on staged files only
 */
const PRE_COMMIT_HOOK = `#!/bin/sh
# Drift pre-commit hook
# Checks staged files for architectural drift

# Exit on error
set -e

# Run drift check on staged files
npx drift check --staged

# Exit with drift's exit code
exit $?
`;

/**
 * Pre-push hook script content
 * Runs full drift check before push
 */
const PRE_PUSH_HOOK = `#!/bin/sh
# Drift pre-push hook
# Runs full drift check before pushing

# Exit on error
set -e

# Run full drift check
npx drift check

# Exit with drift's exit code
exit $?
`;

/**
 * Get the hook script content for a given hook type
 */
function getHookScript(hookType: HookType): string {
  switch (hookType) {
    case 'pre-commit':
      return PRE_COMMIT_HOOK;
    case 'pre-push':
      return PRE_PUSH_HOOK;
    default:
      throw new Error(`Unknown hook type: ${hookType}`);
  }
}

/**
 * Check if Husky is installed and configured in the project
 *
 * @param rootDir - Root directory of the repository
 * @returns True if Husky is available
 */
export async function isHuskyInstalled(rootDir: string): Promise<boolean> {
  try {
    // Check for .husky directory
    const huskyDir = path.join(rootDir, '.husky');
    const stats = await fs.stat(huskyDir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get the Git hooks directory path
 *
 * @param rootDir - Root directory of the repository
 * @returns Path to the Git hooks directory
 */
export async function getGitHooksDir(rootDir: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse --git-path hooks', {
      cwd: rootDir,
      encoding: 'utf-8',
    });
    const hooksPath = stdout.trim();
    // If relative path, resolve against rootDir
    if (!path.isAbsolute(hooksPath)) {
      return path.join(rootDir, hooksPath);
    }
    return hooksPath;
  } catch (error) {
    const err = error as Error;
    throw new Error(`Failed to get Git hooks directory: ${err.message}`);
  }
}

/**
 * Check if a hook already exists
 *
 * @param hookPath - Path to the hook file
 * @returns True if hook exists
 */
async function hookExists(hookPath: string): Promise<boolean> {
  try {
    await fs.access(hookPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an existing hook contains Drift commands
 *
 * @param hookPath - Path to the hook file
 * @returns True if hook contains Drift commands
 */
async function hookContainsDrift(hookPath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(hookPath, 'utf-8');
    return content.includes('drift check') || content.includes('drift ');
  } catch {
    return false;
  }
}

/**
 * Install a Git hook using Husky
 *
 * @param rootDir - Root directory of the repository
 * @param hookType - Type of hook to install
 * @param options - Installation options
 * @returns Installation result
 */
async function installHuskyHook(
  rootDir: string,
  hookType: HookType,
  options: HookInstallOptions = {}
): Promise<HookInstallResult> {
  const huskyDir = path.join(rootDir, '.husky');
  const hookPath = path.join(huskyDir, hookType);

  // Check if hook already exists
  if (await hookExists(hookPath)) {
    if (!options.force) {
      // Check if it already has Drift
      if (await hookContainsDrift(hookPath)) {
        return {
          success: true,
          hookType,
          method: 'husky',
          message: `Drift ${hookType} hook already configured in Husky`,
          path: hookPath,
        };
      }
      return {
        success: false,
        hookType,
        method: 'husky',
        message: `${hookType} hook already exists. Use --force to overwrite or manually add Drift commands.`,
        path: hookPath,
      };
    }
  }

  try {
    // Write the hook file
    await fs.writeFile(hookPath, getHookScript(hookType), { mode: 0o755 });

    return {
      success: true,
      hookType,
      method: 'husky',
      message: `Successfully installed ${hookType} hook via Husky`,
      path: hookPath,
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      hookType,
      method: 'husky',
      message: `Failed to install ${hookType} hook via Husky: ${err.message}`,
    };
  }
}

/**
 * Install a Git hook directly in .git/hooks
 *
 * @param rootDir - Root directory of the repository
 * @param hookType - Type of hook to install
 * @param options - Installation options
 * @returns Installation result
 */
async function installGitHook(
  rootDir: string,
  hookType: HookType,
  options: HookInstallOptions = {}
): Promise<HookInstallResult> {
  const hooksDir = await getGitHooksDir(rootDir);
  const hookPath = path.join(hooksDir, hookType);

  // Check if hook already exists
  if (await hookExists(hookPath)) {
    if (!options.force) {
      // Check if it already has Drift
      if (await hookContainsDrift(hookPath)) {
        return {
          success: true,
          hookType,
          method: 'git',
          message: `Drift ${hookType} hook already configured`,
          path: hookPath,
        };
      }
      return {
        success: false,
        hookType,
        method: 'git',
        message: `${hookType} hook already exists. Use --force to overwrite or manually add Drift commands.`,
        path: hookPath,
      };
    }
  }

  try {
    // Ensure hooks directory exists
    await fs.mkdir(hooksDir, { recursive: true });

    // Write the hook file
    await fs.writeFile(hookPath, getHookScript(hookType), { mode: 0o755 });

    return {
      success: true,
      hookType,
      method: 'git',
      message: `Successfully installed ${hookType} hook`,
      path: hookPath,
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      hookType,
      method: 'git',
      message: `Failed to install ${hookType} hook: ${err.message}`,
    };
  }
}

/**
 * Install a pre-commit hook for Drift
 *
 * The pre-commit hook runs `drift check --staged` to check only staged files
 * before allowing a commit.
 *
 * @param rootDir - Root directory of the repository
 * @param options - Installation options
 * @returns Installation result
 *
 * @requirements 37.1
 */
export async function installPreCommitHook(
  rootDir: string,
  options: HookInstallOptions = {}
): Promise<HookInstallResult> {
  const preferHusky = options.preferHusky ?? true;

  if (preferHusky && (await isHuskyInstalled(rootDir))) {
    return installHuskyHook(rootDir, 'pre-commit', options);
  }

  return installGitHook(rootDir, 'pre-commit', options);
}

/**
 * Install a pre-push hook for Drift
 *
 * The pre-push hook runs `drift check` to perform a full check
 * before allowing a push.
 *
 * @param rootDir - Root directory of the repository
 * @param options - Installation options
 * @returns Installation result
 *
 * @requirements 37.3
 */
export async function installPrePushHook(
  rootDir: string,
  options: HookInstallOptions = {}
): Promise<HookInstallResult> {
  const preferHusky = options.preferHusky ?? true;

  if (preferHusky && (await isHuskyInstalled(rootDir))) {
    return installHuskyHook(rootDir, 'pre-push', options);
  }

  return installGitHook(rootDir, 'pre-push', options);
}

/**
 * Install all Drift Git hooks (pre-commit and pre-push)
 *
 * @param rootDir - Root directory of the repository
 * @param options - Installation options
 * @returns Array of installation results
 *
 * @requirements 37.1, 37.3
 */
export async function installAllHooks(
  rootDir: string,
  options: HookInstallOptions = {}
): Promise<HookInstallResult[]> {
  const results: HookInstallResult[] = [];

  results.push(await installPreCommitHook(rootDir, options));
  results.push(await installPrePushHook(rootDir, options));

  return results;
}

/**
 * Uninstall a Git hook
 *
 * @param rootDir - Root directory of the repository
 * @param hookType - Type of hook to uninstall
 * @returns True if hook was removed
 */
export async function uninstallHook(rootDir: string, hookType: HookType): Promise<boolean> {
  // Try Husky first
  if (await isHuskyInstalled(rootDir)) {
    const huskyHookPath = path.join(rootDir, '.husky', hookType);
    try {
      const content = await fs.readFile(huskyHookPath, 'utf-8');
      // Only remove if it's a Drift hook
      if (content.includes('drift check') || content.includes('Drift')) {
        await fs.unlink(huskyHookPath);
        return true;
      }
    } catch {
      // Hook doesn't exist in Husky
    }
  }

  // Try Git hooks directory
  try {
    const hooksDir = await getGitHooksDir(rootDir);
    const hookPath = path.join(hooksDir, hookType);
    const content = await fs.readFile(hookPath, 'utf-8');
    // Only remove if it's a Drift hook
    if (content.includes('drift check') || content.includes('Drift')) {
      await fs.unlink(hookPath);
      return true;
    }
  } catch {
    // Hook doesn't exist
  }

  return false;
}

/**
 * Uninstall all Drift Git hooks
 *
 * @param rootDir - Root directory of the repository
 * @returns Object with results for each hook type
 */
export async function uninstallAllHooks(
  rootDir: string
): Promise<Record<HookType, boolean>> {
  return {
    'pre-commit': await uninstallHook(rootDir, 'pre-commit'),
    'pre-push': await uninstallHook(rootDir, 'pre-push'),
  };
}

/**
 * Get the status of installed hooks
 *
 * @param rootDir - Root directory of the repository
 * @returns Object with status for each hook type
 */
export async function getHooksStatus(
  rootDir: string
): Promise<Record<HookType, { installed: boolean; method?: 'husky' | 'git'; path?: string }>> {
  const status: Record<HookType, { installed: boolean; method?: 'husky' | 'git'; path?: string }> = {
    'pre-commit': { installed: false },
    'pre-push': { installed: false },
  };

  const hookTypes: HookType[] = ['pre-commit', 'pre-push'];

  for (const hookType of hookTypes) {
    // Check Husky first
    if (await isHuskyInstalled(rootDir)) {
      const huskyHookPath = path.join(rootDir, '.husky', hookType);
      if (await hookContainsDrift(huskyHookPath)) {
        status[hookType] = {
          installed: true,
          method: 'husky',
          path: huskyHookPath,
        };
        continue;
      }
    }

    // Check Git hooks directory
    try {
      const hooksDir = await getGitHooksDir(rootDir);
      const hookPath = path.join(hooksDir, hookType);
      if (await hookContainsDrift(hookPath)) {
        status[hookType] = {
          installed: true,
          method: 'git',
          path: hookPath,
        };
      }
    } catch {
      // Git hooks directory not accessible
    }
  }

  return status;
}
