/**
 * Staged Files - Get list of staged files from Git
 *
 * @requirements 37.2
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Get list of staged files from Git
 *
 * @param rootDir - Root directory of the repository
 * @returns Array of staged file paths (relative to rootDir)
 */
export async function getStagedFiles(rootDir: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: rootDir,
      encoding: 'utf-8',
    });

    const files = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return files;
  } catch (error) {
    const err = error as Error & { code?: string };
    if (err.code === 'ENOENT') {
      throw new Error('Git is not installed or not in PATH');
    }
    throw new Error(`Failed to get staged files: ${err.message}`);
  }
}

/**
 * Get list of all changed files (staged and unstaged)
 *
 * @param rootDir - Root directory of the repository
 * @returns Array of changed file paths (relative to rootDir)
 */
export async function getChangedFiles(rootDir: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git diff --name-only --diff-filter=ACMR HEAD', {
      cwd: rootDir,
      encoding: 'utf-8',
    });

    const files = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return files;
  } catch (error) {
    const err = error as Error & { code?: string };
    throw new Error(`Failed to get changed files: ${err.message}`);
  }
}

/**
 * Get list of untracked files
 *
 * @param rootDir - Root directory of the repository
 * @returns Array of untracked file paths (relative to rootDir)
 */
export async function getUntrackedFiles(rootDir: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git ls-files --others --exclude-standard', {
      cwd: rootDir,
      encoding: 'utf-8',
    });

    const files = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return files;
  } catch (error) {
    const err = error as Error & { code?: string };
    throw new Error(`Failed to get untracked files: ${err.message}`);
  }
}

/**
 * Check if a path is inside a Git repository
 *
 * @param dirPath - Directory path to check
 * @returns True if inside a Git repository
 */
export async function isGitRepository(dirPath: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --git-dir', {
      cwd: dirPath,
      encoding: 'utf-8',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the root directory of the Git repository
 *
 * @param dirPath - Directory path inside the repository
 * @returns Root directory of the Git repository
 */
export async function getGitRoot(dirPath: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', {
      cwd: dirPath,
      encoding: 'utf-8',
    });
    return stdout.trim();
  } catch (error) {
    const err = error as Error;
    throw new Error(`Failed to get Git root: ${err.message}`);
  }
}
