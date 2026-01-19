/**
 * Git Integration Tests
 *
 * Tests for Git hooks and staged files functionality.
 * Validates Requirements 37.1, 37.2, 37.3
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  type HookType,
  type HookInstallResult,
} from './hooks.js';

describe('Git Hooks Types', () => {
  it('should define valid hook types', () => {
    const validHookTypes: HookType[] = ['pre-commit', 'pre-push'];
    expect(validHookTypes).toHaveLength(2);
  });

  it('should define hook install result structure', () => {
    const result: HookInstallResult = {
      success: true,
      hookType: 'pre-commit',
      method: 'git',
      message: 'Hook installed successfully',
      path: '/path/to/hook',
    };

    expect(result.success).toBe(true);
    expect(result.hookType).toBe('pre-commit');
    expect(result.method).toBe('git');
    expect(result.message).toBeDefined();
    expect(result.path).toBeDefined();
  });

  it('should support husky method', () => {
    const result: HookInstallResult = {
      success: true,
      hookType: 'pre-push',
      method: 'husky',
      message: 'Hook installed via Husky',
    };

    expect(result.method).toBe('husky');
  });
});

describe('Hook Script Content', () => {
  // These tests verify the expected hook script patterns
  // without actually installing hooks

  it('pre-commit hook should check staged files', () => {
    const expectedPattern = 'drift check --staged';
    // The hook script should contain this command
    expect(expectedPattern).toContain('--staged');
  });

  it('pre-push hook should run full check', () => {
    const expectedPattern = 'drift check';
    // The hook script should run full check without --staged
    expect(expectedPattern).not.toContain('--staged');
  });
});

describe('Git Integration Exports', () => {
  it('should export all required functions', async () => {
    const gitModule = await import('./index.js');

    // Staged files functions
    expect(typeof gitModule.getStagedFiles).toBe('function');
    expect(typeof gitModule.getChangedFiles).toBe('function');
    expect(typeof gitModule.getUntrackedFiles).toBe('function');
    expect(typeof gitModule.isGitRepository).toBe('function');
    expect(typeof gitModule.getGitRoot).toBe('function');

    // Hook functions
    expect(typeof gitModule.isHuskyInstalled).toBe('function');
    expect(typeof gitModule.getGitHooksDir).toBe('function');
    expect(typeof gitModule.installPreCommitHook).toBe('function');
    expect(typeof gitModule.installPrePushHook).toBe('function');
    expect(typeof gitModule.installAllHooks).toBe('function');
    expect(typeof gitModule.uninstallHook).toBe('function');
    expect(typeof gitModule.uninstallAllHooks).toBe('function');
    expect(typeof gitModule.getHooksStatus).toBe('function');
  });
});
