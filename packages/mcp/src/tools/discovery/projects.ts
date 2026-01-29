/**
 * MCP Tool: drift_projects
 *
 * List and manage registered drift projects.
 * Enables AI agents to work across multiple codebases.
 */

import {
  getProjectRegistry,
  type RegisteredProject,
  type ProjectRegistrationOptions,
} from 'driftdetect-core';

export interface ProjectsArgs {
  /** Action to perform */
  action?: 'list' | 'info' | 'switch' | 'recent' | 'register';
  /** Project name or ID (for info/switch) */
  project?: string;
  /** Project path (for register) */
  path?: string;
  /** Filter by language */
  language?: string;
  /** Filter by framework */
  framework?: string;
  /** Limit results */
  limit?: number;
  /** Project description (for register) */
  description?: string;
  /** Tags (for register) */
  tags?: string[];
}

interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  language: string;
  framework: string;
  health?: string | undefined;
  healthScore?: number | undefined;
  lastAccessed: string;
  isActive: boolean;
  isValid: boolean;
}

function summarizeProject(
  project: RegisteredProject,
  activeId?: string
): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    language: project.language,
    framework: project.framework,
    health: project.health,
    healthScore: project.healthScore,
    lastAccessed: project.lastAccessedAt,
    isActive: project.id === activeId,
    isValid: project.isValid !== false,
  };
}

export async function handleProjects(
  args: ProjectsArgs
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const action = args.action ?? 'list';

  try {
    const registry = await getProjectRegistry();

    switch (action) {
      case 'list': {
        let projects = registry.getValid();

        // Apply filters
        if (args.language) {
          projects = projects.filter(
            p => p.language.toLowerCase() === args.language!.toLowerCase()
          );
        }
        if (args.framework) {
          projects = projects.filter(
            p => p.framework.toLowerCase() === args.framework!.toLowerCase()
          );
        }

        // Sort by last accessed
        projects.sort(
          (a, b) =>
            new Date(b.lastAccessedAt).getTime() -
            new Date(a.lastAccessedAt).getTime()
        );

        // Apply limit
        if (args.limit) {
          projects = projects.slice(0, args.limit);
        }

        const activeId = registry.getActive()?.id;
        const summaries = projects.map(p => summarizeProject(p, activeId));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  totalProjects: registry.count,
                  filteredCount: summaries.length,
                  activeProject: activeId ? registry.get(activeId)?.name : null,
                  projects: summaries,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'info': {
        let project: RegisteredProject | undefined;

        if (args.project) {
          // Find by name or ID
          project =
            registry.findByName(args.project) ??
            registry.get(args.project) ??
            registry.findByPath(args.project);
        } else {
          // Use active project
          project = registry.getActive();
        }

        if (!project) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Project not found',
                  hint: args.project
                    ? `No project matching "${args.project}"`
                    : 'No active project. Use action="switch" to set one.',
                }),
              },
            ],
            isError: true,
          };
        }

        const activeId = registry.getActive()?.id;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ...project,
                  isActive: project.id === activeId,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'switch': {
        if (!args.project) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Project name or ID required',
                  hint: 'Provide project="<name>" to switch',
                }),
              },
            ],
            isError: true,
          };
        }

        // Find project
        const project =
          registry.findByName(args.project) ??
          registry.get(args.project) ??
          registry.findByPath(args.project);

        if (!project) {
          // Try partial match
          const matches = registry.search(args.project);
          if (matches.length > 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: 'Ambiguous project name',
                    matches: matches.map(m => ({ name: m.name, path: m.path })),
                    hint: 'Be more specific or use the project ID',
                  }),
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Project not found: ${args.project}`,
                  hint: 'Use action="list" to see available projects',
                }),
              },
            ],
            isError: true,
          };
        }

        await registry.setActive(project.id);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Switched to ${project.name}`,
                project: summarizeProject(project, project.id),
              }),
            },
          ],
        };
      }

      case 'recent': {
        const limit = args.limit ?? 5;
        const recent = registry.getRecent(limit);
        const activeId = registry.getActive()?.id;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  recentProjects: recent.map(p => summarizeProject(p, activeId)),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'register': {
        if (!args.path) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Project path required',
                  hint: 'Provide path="<project-path>" to register',
                }),
              },
            ],
            isError: true,
          };
        }

        // Check if already registered
        const existing = registry.findByPath(args.path);
        if (existing) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: `Project already registered: ${existing.name}`,
                  project: summarizeProject(existing, registry.getActive()?.id),
                }),
              },
            ],
          };
        }

        // Register new project
        const options: ProjectRegistrationOptions = {};
        if (args.project) {options.name = args.project;}
        if (args.description) {options.description = args.description;}
        if (args.tags) {options.tags = args.tags;}

        const project = await registry.register(args.path, options);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Registered ${project.name}`,
                project: summarizeProject(project, registry.getActive()?.id),
                hint: 'Use action="switch" to make this the active project',
              }),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `Unknown action: ${action}`,
                validActions: ['list', 'info', 'switch', 'recent', 'register'],
              }),
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Failed to access project registry',
            message: (error as Error).message,
          }),
        },
      ],
      isError: true,
    };
  }
}
