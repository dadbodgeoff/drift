/**
 * Project Resolver - Resolves project names to paths for MCP tools
 * 
 * Enables AI agents to work across multiple registered projects
 * by resolving project names/IDs to their actual paths.
 */

import { getProjectRegistry, type RegisteredProject } from 'driftdetect-core';

export interface ProjectResolution {
  /** Resolved project root path */
  projectRoot: string;
  /** Project metadata if resolved from registry */
  project?: RegisteredProject;
  /** Whether this was resolved from registry or used default */
  fromRegistry: boolean;
}

/**
 * Resolve a project name/ID to its path
 * 
 * @param projectNameOrId - Project name, ID, or undefined for default
 * @param defaultRoot - Default project root to use if no project specified
 * @returns Resolved project path and metadata
 */
export async function resolveProject(
  projectNameOrId: string | undefined,
  defaultRoot: string
): Promise<ProjectResolution> {
  // No project specified - use default
  if (!projectNameOrId) {
    return {
      projectRoot: defaultRoot,
      fromRegistry: false,
    };
  }

  try {
    const registry = await getProjectRegistry();
    
    // Try to find by name first, then by ID, then by path
    const project = 
      registry.findByName(projectNameOrId) ??
      registry.get(projectNameOrId) ??
      registry.findByPath(projectNameOrId);

    if (!project) {
      // Try partial match
      const matches = registry.search(projectNameOrId);
      if (matches.length === 1 && matches[0]) {
        await registry.updateLastAccessed(matches[0].id);
        return {
          projectRoot: matches[0].path,
          project: matches[0],
          fromRegistry: true,
        };
      }
      
      // No match found - throw with helpful error
      throw new ProjectNotFoundError(projectNameOrId, matches);
    }

    // Validate project path still exists
    if (project.isValid === false) {
      throw new ProjectInvalidError(project);
    }

    // Update last accessed
    await registry.updateLastAccessed(project.id);

    return {
      projectRoot: project.path,
      project,
      fromRegistry: true,
    };
  } catch (error) {
    if (error instanceof ProjectNotFoundError || error instanceof ProjectInvalidError) {
      throw error;
    }
    // Registry not available - fall back to default
    return {
      projectRoot: defaultRoot,
      fromRegistry: false,
    };
  }
}

/**
 * Error thrown when a project is not found in the registry
 */
export class ProjectNotFoundError extends Error {
  constructor(
    public readonly searchTerm: string,
    public readonly partialMatches: RegisteredProject[] = []
  ) {
    const message = partialMatches.length > 0
      ? `Project "${searchTerm}" not found. Did you mean: ${partialMatches.map(p => p.name).join(', ')}?`
      : `Project "${searchTerm}" not found. Use drift_projects action="list" to see available projects.`;
    super(message);
    this.name = 'ProjectNotFoundError';
  }
}

/**
 * Error thrown when a project path no longer exists
 */
export class ProjectInvalidError extends Error {
  constructor(public readonly project: RegisteredProject) {
    super(`Project "${project.name}" path no longer exists: ${project.path}`);
    this.name = 'ProjectInvalidError';
  }
}

/**
 * Format project resolution result for MCP response
 */
export function formatProjectContext(resolution: ProjectResolution): Record<string, unknown> {
  if (!resolution.fromRegistry || !resolution.project) {
    return { projectRoot: resolution.projectRoot };
  }

  return {
    projectRoot: resolution.projectRoot,
    projectName: resolution.project.name,
    projectId: resolution.project.id,
    language: resolution.project.language,
    framework: resolution.project.framework,
  };
}

/**
 * Get the active project root from the registry
 * 
 * This is the key function for dynamic project resolution.
 * It checks the registry for the active project and returns its path,
 * falling back to the default if no active project is set.
 * 
 * @param defaultRoot - Default project root to use if no active project
 * @returns The active project root path
 */
export async function getActiveProjectRoot(defaultRoot: string): Promise<string> {
  try {
    const registry = await getProjectRegistry();
    const active = registry.getActive();
    
    if (active && active.isValid !== false) {
      return active.path;
    }
    
    return defaultRoot;
  } catch {
    // Registry not available - fall back to default
    return defaultRoot;
  }
}
