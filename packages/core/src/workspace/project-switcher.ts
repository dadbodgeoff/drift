/**
 * Project Switcher
 * 
 * Enterprise-grade multi-project management with clear indicators
 * and agent-friendly context switching.
 * 
 * Features:
 * - Clear active project indicator in all output
 * - Fast project switching with context preloading
 * - Agent-friendly project context for MCP tools
 * - Auto-detection from current working directory
 * 
 * @module workspace/project-switcher
 */

import * as path from 'node:path';

import type {
  ActiveProjectIndicator,
  ProjectSwitchRequest,
  ProjectSwitchResult,
  WorkspaceManagerConfig,
} from './types.js';
import { DEFAULT_WORKSPACE_CONFIG } from './types.js';
import { ContextLoader } from './context-loader.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Project registry interface (to avoid circular dependency)
 */
export interface ProjectRegistryLike {
  getActive(): { id: string; name: string; path: string; health?: string | undefined; lastAccessedAt: string } | undefined;
  setActive(projectId: string): Promise<{ id: string; name: string; path: string; health?: string | undefined; lastAccessedAt: string }>;
  findByPath(projectPath: string): { id: string; name: string; path: string; health?: string | undefined; lastAccessedAt: string } | undefined;
  findByName(name: string): { id: string; name: string; path: string; health?: string | undefined; lastAccessedAt: string } | undefined;
  get(projectId: string): { id: string; name: string; path: string; health?: string | undefined; lastAccessedAt: string } | undefined;
  search(query: string): Array<{ id: string; name: string; path: string; health?: string | undefined; lastAccessedAt: string }>;
  updateLastAccessed(projectId: string): Promise<{ id: string; name: string; path: string; health?: string | undefined; lastAccessedAt: string }>;
}

/**
 * Agent-friendly project context for MCP tools
 */
export interface AgentProjectContext {
  /** Current project indicator */
  activeProject: ActiveProjectIndicator;
  /** Quick summary for agent consumption */
  summary: string;
  /** Available commands hint */
  availableCommands: string[];
  /** Whether context is fully loaded */
  contextReady: boolean;
  /** Warnings or issues */
  warnings: string[];
}

// ============================================================================
// Project Switcher Class
// ============================================================================

export class ProjectSwitcher {
  private readonly config: WorkspaceManagerConfig;
  private registry: ProjectRegistryLike | null = null;
  private contextLoaders: Map<string, ContextLoader> = new Map();
  private currentIndicator: ActiveProjectIndicator | null = null;

  constructor(config: Partial<WorkspaceManagerConfig> = {}) {
    this.config = { ...DEFAULT_WORKSPACE_CONFIG, ...config };
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Set the project registry (dependency injection)
   */
  setRegistry(registry: ProjectRegistryLike): void {
    this.registry = registry;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get the active project indicator
   */
  async getActiveIndicator(): Promise<ActiveProjectIndicator | null> {
    if (!this.registry) {
      return this.detectFromCwd();
    }

    // Check cached indicator
    if (this.currentIndicator) {
      return this.currentIndicator;
    }

    // Get from registry
    const active = this.registry.getActive();
    if (active) {
      this.currentIndicator = this.createIndicator(active, 'explicit');
      return this.currentIndicator;
    }

    // Auto-detect from cwd if enabled
    if (this.config.autoDetectProject) {
      return this.detectFromCwd();
    }

    return null;
  }

  /**
   * Switch to a different project
   */
  async switchProject(request: ProjectSwitchRequest): Promise<ProjectSwitchResult> {
    if (!this.registry) {
      return {
        success: false,
        currentProject: this.createEmptyIndicator(),
        contextLoaded: false,
        error: 'Project registry not initialized',
      };
    }

    const previousIndicator = this.currentIndicator;

    // Find target project
    let targetProject = this.registry.findByName(request.target) 
      ?? this.registry.findByPath(request.target)
      ?? this.registry.get(request.target);

    // Try partial match
    if (!targetProject) {
      const matches = this.registry.search(request.target);
      if (matches.length === 1) {
        targetProject = matches[0];
      } else if (matches.length > 1) {
        return {
          success: false,
          previousProject: previousIndicator ?? undefined,
          currentProject: this.createEmptyIndicator(),
          contextLoaded: false,
          error: `Ambiguous project reference: ${matches.length} matches found`,
        };
      }
    }

    if (!targetProject) {
      return {
        success: false,
        previousProject: previousIndicator ?? undefined,
        currentProject: this.createEmptyIndicator(),
        contextLoaded: false,
        error: `Project not found: ${request.target}`,
      };
    }

    // Validate project exists if requested
    if (request.validate !== false) {
      const isValid = await this.validateProjectPath(targetProject.path);
      if (!isValid) {
        return {
          success: false,
          previousProject: previousIndicator ?? undefined,
          currentProject: this.createEmptyIndicator(),
          contextLoaded: false,
          error: `Project path no longer exists: ${targetProject.path}`,
        };
      }
    }

    // Set as active
    await this.registry.setActive(targetProject.id);
    this.currentIndicator = this.createIndicator(targetProject, 'explicit');

    // Load context if requested
    let contextLoaded = false;
    if (request.loadContext !== false) {
      try {
        await this.getContextLoader(targetProject.path).loadContext(true);
        contextLoaded = true;
      } catch {
        // Context loading failure is non-critical
      }
    }

    return {
      success: true,
      previousProject: previousIndicator ?? undefined,
      currentProject: this.currentIndicator,
      contextLoaded,
    };
  }

  /**
   * Get agent-friendly project context
   */
  async getAgentContext(): Promise<AgentProjectContext> {
    const indicator = await this.getActiveIndicator();
    
    if (!indicator) {
      return {
        activeProject: this.createEmptyIndicator(),
        summary: 'No active project. Run `drift init` or `drift projects switch` to set one.',
        availableCommands: ['drift init', 'drift projects list', 'drift projects switch'],
        contextReady: false,
        warnings: ['No active project detected'],
      };
    }

    const warnings: string[] = [];
    let contextReady = false;

    // Try to load context
    try {
      const loader = this.getContextLoader(indicator.fullPath);
      const context = await loader.loadContext();
      contextReady = context.lake.available;

      if (!context.analysis.callGraphBuilt) {
        warnings.push('Call graph not built. Run `drift callgraph build` for full analysis.');
      }
      if (!context.lake.available) {
        warnings.push('No patterns scanned. Run `drift scan` first.');
      }
    } catch {
      warnings.push('Failed to load project context');
    }

    const summary = this.buildAgentSummary(indicator, contextReady, warnings);

    return {
      activeProject: indicator,
      summary,
      availableCommands: this.getAvailableCommands(contextReady),
      contextReady,
      warnings,
    };
  }

  /**
   * Format project indicator for CLI output
   */
  formatIndicator(indicator: ActiveProjectIndicator): string {
    const healthIcon = this.getHealthIcon(indicator.health);
    const sourceIcon = indicator.source === 'cwd' ? '📍' : indicator.source === 'auto_detected' ? '🔍' : '📁';
    
    return `${sourceIcon} ${healthIcon} ${indicator.name} (${indicator.shortPath})`;
  }

  /**
   * Format project indicator for CLI header
   */
  formatHeader(indicator: ActiveProjectIndicator): string {
    const healthIcon = this.getHealthIcon(indicator.health);
    return `[${healthIcon} ${indicator.name}]`;
  }

  /**
   * Clear cached indicator (call after project changes)
   */
  clearCache(): void {
    this.currentIndicator = null;
    this.contextLoaders.clear();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async detectFromCwd(): Promise<ActiveProjectIndicator | null> {
    const cwd = process.cwd();
    
    // Check if .drift exists in cwd
    const isValid = await this.validateProjectPath(cwd);
    if (!isValid) {
      return null;
    }

    // Try to find in registry
    if (this.registry) {
      const registered = this.registry.findByPath(cwd);
      if (registered) {
        await this.registry.updateLastAccessed(registered.id);
        this.currentIndicator = this.createIndicator(registered, 'cwd');
        return this.currentIndicator;
      }
    }

    // Create indicator from cwd
    this.currentIndicator = {
      name: path.basename(cwd),
      shortPath: this.getShortPath(cwd),
      fullPath: cwd,
      health: 'unknown',
      lastAccessed: new Date().toISOString(),
      source: 'cwd',
    };

    return this.currentIndicator;
  }

  private async validateProjectPath(projectPath: string): Promise<boolean> {
    try {
      const { access } = await import('node:fs/promises');
      await access(path.join(projectPath, '.drift'));
      return true;
    } catch {
      return false;
    }
  }

  private createIndicator(
    project: { name: string; path: string; health?: string | undefined; lastAccessedAt: string },
    source: 'explicit' | 'auto_detected' | 'cwd'
  ): ActiveProjectIndicator {
    return {
      name: project.name,
      shortPath: this.getShortPath(project.path),
      fullPath: project.path,
      health: (project.health as 'healthy' | 'warning' | 'critical' | 'unknown') ?? 'unknown',
      lastAccessed: project.lastAccessedAt,
      source,
    };
  }

  private createEmptyIndicator(): ActiveProjectIndicator {
    return {
      name: 'none',
      shortPath: '',
      fullPath: '',
      health: 'unknown',
      lastAccessed: new Date().toISOString(),
      source: 'cwd',
    };
  }

  private getShortPath(fullPath: string): string {
    const parts = fullPath.split(path.sep);
    if (parts.length <= 2) {
      return fullPath;
    }
    return parts.slice(-2).join(path.sep);
  }

  private getHealthIcon(health: 'healthy' | 'warning' | 'critical' | 'unknown'): string {
    switch (health) {
      case 'healthy': return '🟢';
      case 'warning': return '🟡';
      case 'critical': return '🔴';
      default: return '⚪';
    }
  }

  private getContextLoader(projectPath: string): ContextLoader {
    if (!this.contextLoaders.has(projectPath)) {
      this.contextLoaders.set(projectPath, new ContextLoader(projectPath, this.config));
    }
    return this.contextLoaders.get(projectPath)!;
  }

  private buildAgentSummary(
    indicator: ActiveProjectIndicator,
    contextReady: boolean,
    warnings: string[]
  ): string {
    const lines: string[] = [
      `Active Project: ${indicator.name}`,
      `Path: ${indicator.fullPath}`,
      `Health: ${indicator.health}`,
      `Context Ready: ${contextReady ? 'Yes' : 'No'}`,
    ];

    if (warnings.length > 0) {
      lines.push(`Warnings: ${warnings.join('; ')}`);
    }

    return lines.join('\n');
  }

  private getAvailableCommands(contextReady: boolean): string[] {
    const commands = [
      'drift status',
      'drift projects list',
      'drift projects switch <name>',
    ];

    if (contextReady) {
      commands.push(
        'drift patterns list',
        'drift callgraph build',
        'drift test-topology build',
        'drift coupling analyze'
      );
    } else {
      commands.push('drift scan', 'drift setup');
    }

    return commands;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a project switcher instance
 */
export function createProjectSwitcher(
  config?: Partial<WorkspaceManagerConfig>
): ProjectSwitcher {
  return new ProjectSwitcher(config);
}
