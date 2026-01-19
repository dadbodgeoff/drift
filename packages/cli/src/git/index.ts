/**
 * Git module exports
 */

export {
  getStagedFiles,
  getChangedFiles,
  getUntrackedFiles,
  isGitRepository,
  getGitRoot,
} from './staged-files.js';

export {
  type HookType,
  type HookInstallResult,
  type HookInstallOptions,
  isHuskyInstalled,
  getGitHooksDir,
  installPreCommitHook,
  installPrePushHook,
  installAllHooks,
  uninstallHook,
  uninstallAllHooks,
  getHooksStatus,
} from './hooks.js';
