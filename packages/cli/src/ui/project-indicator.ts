/**
 * Project Indicator UI Component
 * 
 * Shows the active project indicator in CLI output.
 * Provides consistent project context across all commands.
 * 
 * @module ui/project-indicator
 */

import chalk from 'chalk';
import {
  createWorkspaceManager,
  getProjectRegistry,
  type ActiveProjectIndicator,
} from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export interface ProjectIndicatorOptions {
  /** Show full path instead of short path */
  fullPath?: boolean;
  /** Show health indicator */
  showHealth?: boolean;
  /** Compact mode (single line) */
  compact?: boolean;
}

// ============================================================================
// Formatters
// ============================================================================

function getHealthIcon(health: 'healthy' | 'warning' | 'critical' | 'unknown'): string {
  switch (health) {
    case 'healthy': return chalk.green('●');
    case 'warning': return chalk.yellow('●');
    case 'critical': return chalk.red('●');
    default: return chalk.gray('○');
  }
}

function getSourceIcon(source: 'explicit' | 'auto_detected' | 'cwd'): string {
  switch (source) {
    case 'explicit': return '📁';
    case 'auto_detected': return '🔍';
    case 'cwd': return '📍';
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the active project indicator
 */
export async function getActiveProjectIndicator(): Promise<ActiveProjectIndicator | null> {
  try {
    const cwd = process.cwd();
    const manager = createWorkspaceManager(cwd);
    
    // Try to get registry for multi-project support
    try {
      const registry = await getProjectRegistry();
      manager.getProjectSwitcher().setRegistry(registry);
    } catch {
      // Registry not available, will use cwd detection
    }

    return manager.getActiveProject();
  } catch {
    return null;
  }
}

/**
 * Format project indicator for display
 */
export function formatProjectIndicator(
  indicator: ActiveProjectIndicator,
  options: ProjectIndicatorOptions = {}
): string {
  const { fullPath = false, showHealth = true, compact = false } = options;

  const sourceIcon = getSourceIcon(indicator.source);
  const healthIcon = showHealth ? getHealthIcon(indicator.health) : '';
  const pathDisplay = fullPath ? indicator.fullPath : indicator.shortPath;

  if (compact) {
    return `${sourceIcon} ${healthIcon} ${chalk.cyan(indicator.name)}`;
  }

  return `${sourceIcon} ${healthIcon} ${chalk.cyan(indicator.name)} ${chalk.gray(`(${pathDisplay})`)}`;
}

/**
 * Format project header for CLI output
 */
export function formatProjectHeader(indicator: ActiveProjectIndicator): string {
  const healthIcon = getHealthIcon(indicator.health);
  return chalk.dim(`[${healthIcon} ${indicator.name}]`);
}

/**
 * Print project indicator to console
 */
export async function printProjectIndicator(options: ProjectIndicatorOptions = {}): Promise<void> {
  const indicator = await getActiveProjectIndicator();
  
  if (!indicator) {
    return;
  }

  console.log(formatProjectIndicator(indicator, options));
}

/**
 * Print project header to console (compact version for command output)
 */
export async function printProjectHeader(): Promise<void> {
  const indicator = await getActiveProjectIndicator();
  
  if (!indicator) {
    return;
  }

  console.log(formatProjectHeader(indicator));
}

/**
 * Get project context summary for agent consumption
 */
export async function getProjectContextSummary(): Promise<string> {
  try {
    const cwd = process.cwd();
    const manager = createWorkspaceManager(cwd);
    
    try {
      const registry = await getProjectRegistry();
      manager.getProjectSwitcher().setRegistry(registry);
    } catch {
      // Registry not available
    }

    const agentContext = await manager.getAgentContext();
    return agentContext.summary;
  } catch {
    return 'No active project';
  }
}
