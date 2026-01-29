/**
 * Projects Command - drift projects
 *
 * Manage multiple drift-initialized projects from a central registry.
 * Supports listing, switching, and organizing projects.
 *
 * Commands:
 * - drift projects list     - List all registered projects
 * - drift projects switch   - Switch active project
 * - drift projects add      - Register a project
 * - drift projects remove   - Unregister a project
 * - drift projects info     - Show project details
 * - drift projects cleanup  - Remove invalid projects
 */

import chalk from 'chalk';
import { Command } from 'commander';
import {
  getProjectRegistry,
  type RegisteredProject,
  type ProjectHealth,
} from 'driftdetect-core';

import { confirmPrompt, selectPrompt, inputPrompt } from '../ui/prompts.js';
import { createSpinner, status } from '../ui/spinner.js';

// ============================================================================
// Formatters
// ============================================================================

function formatHealth(health?: ProjectHealth): string {
  switch (health) {
    case 'healthy':
      return chalk.green('●');
    case 'warning':
      return chalk.yellow('●');
    case 'critical':
      return chalk.red('●');
    default:
      return chalk.gray('○');
  }
}

function formatLanguage(lang: string): string {
  const colors: Record<string, (s: string) => string> = {
    typescript: chalk.blue,
    javascript: chalk.yellow,
    python: chalk.green,
    java: chalk.red,
    csharp: chalk.magenta,
    php: chalk.cyan,
    ruby: chalk.red,
    go: chalk.cyan,
    rust: chalk.rgb(222, 165, 132),
  };
  return (colors[lang] ?? chalk.gray)(lang);
}

function formatFramework(framework: string): string {
  if (framework === 'unknown') {return chalk.gray('-');}
  return chalk.white(framework);
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {return 'today';}
  if (diffDays === 1) {return 'yesterday';}
  if (diffDays < 7) {return `${diffDays} days ago`;}
  if (diffDays < 30) {return `${Math.floor(diffDays / 7)} weeks ago`;}
  if (diffDays < 365) {return `${Math.floor(diffDays / 30)} months ago`;}
  return `${Math.floor(diffDays / 365)} years ago`;
}

function truncatePath(p: string, maxLen: number): string {
  if (p.length <= maxLen) {return p;}
  return '...' + p.slice(-(maxLen - 3));
}

// ============================================================================
// List Command
// ============================================================================

interface ListOptions {
  all?: boolean;
  json?: boolean;
  language?: string;
  framework?: string;
  tag?: string;
}

async function listAction(options: ListOptions): Promise<void> {
  const registry = await getProjectRegistry();
  let projects = options.all ? registry.getAll() : registry.getValid();

  // Apply filters
  if (options.language) {
    projects = projects.filter(
      p => p.language.toLowerCase() === options.language!.toLowerCase()
    );
  }
  if (options.framework) {
    projects = projects.filter(
      p => p.framework.toLowerCase() === options.framework!.toLowerCase()
    );
  }
  if (options.tag) {
    projects = projects.filter(p => p.tags?.includes(options.tag!));
  }

  // Sort by last accessed
  projects.sort(
    (a, b) =>
      new Date(b.lastAccessedAt).getTime() -
      new Date(a.lastAccessedAt).getTime()
  );

  if (options.json) {
    console.log(JSON.stringify(projects, null, 2));
    return;
  }

  if (projects.length === 0) {
    console.log();
    console.log(chalk.yellow('No projects registered.'));
    console.log(chalk.gray('Run `drift init` in a project to register it.'));
    console.log();
    return;
  }

  const activeId = registry.getActive()?.id;

  console.log();
  console.log(chalk.bold(`📁 Registered Projects (${projects.length})`));
  console.log();

  // Table header
  console.log(
    chalk.gray(
      '  ' +
        'Status'.padEnd(8) +
        'Name'.padEnd(20) +
        'Language'.padEnd(12) +
        'Framework'.padEnd(12) +
        'Last Used'.padEnd(14) +
        'Path'
    )
  );
  console.log(chalk.gray('  ' + '─'.repeat(90)));

  for (const project of projects) {
    const isActive = project.id === activeId;
    const marker = isActive ? chalk.cyan('▶') : ' ';
    const healthIcon = formatHealth(project.health);
    const validIcon = project.isValid === false ? chalk.red('✗') : '';

    const name = isActive
      ? chalk.cyan.bold(project.name.padEnd(20))
      : project.name.padEnd(20);

    console.log(
      `${marker} ${healthIcon} ${validIcon}`.padEnd(10) +
        name +
        formatLanguage(project.language).padEnd(12) +
        formatFramework(project.framework).padEnd(12) +
        chalk.gray(formatDate(project.lastAccessedAt).padEnd(14)) +
        chalk.gray(truncatePath(project.path, 40))
    );
  }

  console.log();

  if (activeId) {
    const active = registry.get(activeId);
    console.log(chalk.gray(`Active: ${active?.name} (${active?.path})`));
  } else {
    console.log(chalk.gray('No active project. Use `drift projects switch` to set one.'));
  }
  console.log();
}

// ============================================================================
// Switch Command
// ============================================================================

interface SwitchOptions {
  name?: string;
}

async function switchAction(nameOrPath?: string, _options?: SwitchOptions): Promise<void> {
  void _options; // Suppress unused parameter warning
  const registry = await getProjectRegistry();
  const projects = registry.getValid();

  if (projects.length === 0) {
    status.error('No projects registered');
    return;
  }

  let project: RegisteredProject | undefined;

  if (nameOrPath) {
    // Try to find by name or path
    project = registry.findByName(nameOrPath) ?? registry.findByPath(nameOrPath);
    if (!project) {
      // Try partial match
      const matches = registry.search(nameOrPath);
      if (matches.length === 1) {
        project = matches[0];
      } else if (matches.length > 1) {
        console.log(chalk.yellow(`Multiple matches for "${nameOrPath}":`));
        for (const m of matches) {
          console.log(`  - ${m.name} (${m.path})`);
        }
        return;
      } else {
        status.error(`Project not found: ${nameOrPath}`);
        return;
      }
    }
  } else {
    // Interactive selection
    const choices = projects.map(p => ({
      name: `${p.name} (${truncatePath(p.path, 40)})`,
      value: p.id,
    }));

    const selectedId = await selectPrompt('Select project:', choices);
    project = registry.get(selectedId);
  }

  if (!project) {
    status.error('Project not found');
    return;
  }

  await registry.setActive(project.id);
  status.success(`Switched to ${chalk.cyan(project.name)}`);
  console.log(chalk.gray(`  Path: ${project.path}`));
}

// ============================================================================
// Add Command
// ============================================================================

interface AddOptions {
  name?: string;
  description?: string;
  tags?: string;
}

async function addAction(projectPath?: string, options?: AddOptions): Promise<void> {
  const targetPath = projectPath ?? process.cwd();
  const registry = await getProjectRegistry();

  // Check if already registered
  const existing = registry.findByPath(targetPath);
  if (existing) {
    status.info(`Project already registered: ${existing.name}`);
    return;
  }

  // Check if drift is initialized
  const spinner = createSpinner('Registering project...');
  spinner.start();

  try {
    const project = await registry.register(targetPath, {
      name: options?.name,
      description: options?.description,
      tags: options?.tags?.split(',').map(t => t.trim()),
    } as import('driftdetect-core').ProjectRegistrationOptions);

    spinner.succeed(`Registered ${chalk.cyan(project.name)}`);
    console.log();
    console.log(chalk.gray(`  ID: ${project.id}`));
    console.log(chalk.gray(`  Path: ${project.path}`));
    console.log(chalk.gray(`  Language: ${project.language}`));
    console.log(chalk.gray(`  Framework: ${project.framework}`));
    console.log();
  } catch (error) {
    spinner.fail('Failed to register project');
    console.error(chalk.red((error as Error).message));
  }
}

// ============================================================================
// Remove Command
// ============================================================================

async function removeAction(nameOrPath?: string): Promise<void> {
  const registry = await getProjectRegistry();

  let project: RegisteredProject | undefined;

  if (nameOrPath) {
    project = registry.findByName(nameOrPath) ?? registry.findByPath(nameOrPath);
  } else {
    // Interactive selection
    const projects = registry.getAll();
    if (projects.length === 0) {
      status.error('No projects registered');
      return;
    }

    const choices = projects.map(p => ({
      name: `${p.name} (${truncatePath(p.path, 40)})`,
      value: p.id,
    }));

    const selectedId = await selectPrompt('Select project to remove:', choices);
    project = registry.get(selectedId);
  }

  if (!project) {
    status.error(`Project not found: ${nameOrPath}`);
    return;
  }

  const confirmed = await confirmPrompt(
    `Remove ${project.name} from registry? (This does not delete the .drift folder)`,
    false
  );

  if (!confirmed) {
    status.info('Cancelled');
    return;
  }

  await registry.remove(project.id);
  status.success(`Removed ${project.name} from registry`);
}

// ============================================================================
// Info Command
// ============================================================================

async function infoAction(nameOrPath?: string): Promise<void> {
  const registry = await getProjectRegistry();

  let project: RegisteredProject | undefined;

  if (nameOrPath) {
    project = registry.findByName(nameOrPath) ?? registry.findByPath(nameOrPath);
  } else {
    // Use active project or current directory
    project = registry.getActive() ?? registry.findByPath(process.cwd());
  }

  if (!project) {
    status.error('Project not found. Specify a name or run from a project directory.');
    return;
  }

  const isActive = registry.getActive()?.id === project.id;

  console.log();
  console.log(chalk.bold(`📁 ${project.name}`) + (isActive ? chalk.cyan(' (active)') : ''));
  console.log();
  console.log(chalk.gray('  ID:          ') + project.id);
  console.log(chalk.gray('  Path:        ') + project.path);
  console.log(chalk.gray('  Language:    ') + formatLanguage(project.language));
  console.log(chalk.gray('  Framework:   ') + formatFramework(project.framework));
  console.log(chalk.gray('  Registered:  ') + formatDate(project.registeredAt));
  console.log(chalk.gray('  Last Used:   ') + formatDate(project.lastAccessedAt));

  if (project.description) {
    console.log(chalk.gray('  Description: ') + project.description);
  }

  if (project.tags?.length) {
    console.log(chalk.gray('  Tags:        ') + project.tags.join(', '));
  }

  if (project.gitRemote) {
    console.log(chalk.gray('  Git Remote:  ') + project.gitRemote);
  }

  if (project.patternCounts) {
    console.log();
    console.log(chalk.gray('  Patterns:'));
    console.log(chalk.gray('    Discovered: ') + project.patternCounts.discovered);
    console.log(chalk.gray('    Approved:   ') + chalk.green(project.patternCounts.approved));
    console.log(chalk.gray('    Ignored:    ') + chalk.gray(project.patternCounts.ignored));
  }

  if (project.healthScore !== undefined) {
    const healthColor =
      project.health === 'healthy'
        ? chalk.green
        : project.health === 'warning'
        ? chalk.yellow
        : chalk.red;
    console.log();
    console.log(chalk.gray('  Health:      ') + healthColor(`${project.healthScore}%`));
  }

  console.log();
  console.log(chalk.gray('  Valid:       ') + (project.isValid !== false ? chalk.green('Yes') : chalk.red('No')));
  console.log();
}

// ============================================================================
// Cleanup Command
// ============================================================================

async function cleanupAction(): Promise<void> {
  const registry = await getProjectRegistry();

  const spinner = createSpinner('Validating projects...');
  spinner.start();

  const validation = await registry.validateAll();
  const invalid = Array.from(validation.entries()).filter(([, valid]) => !valid);

  if (invalid.length === 0) {
    spinner.succeed('All projects are valid');
    return;
  }

  spinner.info(`Found ${invalid.length} invalid project(s)`);

  for (const [id] of invalid) {
    const project = registry.get(id);
    console.log(chalk.red(`  ✗ ${project?.name} - ${project?.path}`));
  }

  console.log();
  const confirmed = await confirmPrompt(
    `Remove ${invalid.length} invalid project(s) from registry?`,
    false
  );

  if (!confirmed) {
    status.info('Cancelled');
    return;
  }

  const removed = await registry.cleanup();
  status.success(`Removed ${removed.length} project(s)`);
}

// ============================================================================
// Rename Command
// ============================================================================

async function renameAction(newName?: string): Promise<void> {
  const registry = await getProjectRegistry();
  const project = registry.getActive() ?? registry.findByPath(process.cwd());

  if (!project) {
    status.error('No active project. Switch to a project first.');
    return;
  }

  const name = newName ?? (await inputPrompt('New project name:', project.name));

  if (!name || name === project.name) {
    status.info('No change');
    return;
  }

  await registry.update(project.id, { name });
  status.success(`Renamed to ${chalk.cyan(name)}`);
}

// ============================================================================
// Command Registration
// ============================================================================

export const projectsCommand = new Command('projects')
  .description('Manage multiple drift projects')
  .addCommand(
    new Command('list')
      .alias('ls')
      .description('List all registered projects')
      .option('-a, --all', 'Include invalid projects')
      .option('--json', 'Output as JSON')
      .option('-l, --language <lang>', 'Filter by language')
      .option('-f, --framework <framework>', 'Filter by framework')
      .option('-t, --tag <tag>', 'Filter by tag')
      .action(listAction)
  )
  .addCommand(
    new Command('switch')
      .alias('sw')
      .description('Switch active project')
      .argument('[name-or-path]', 'Project name or path')
      .action(switchAction)
  )
  .addCommand(
    new Command('add')
      .description('Register a project')
      .argument('[path]', 'Project path (default: current directory)')
      .option('-n, --name <name>', 'Project name')
      .option('-d, --description <desc>', 'Project description')
      .option('-t, --tags <tags>', 'Comma-separated tags')
      .action(addAction)
  )
  .addCommand(
    new Command('remove')
      .alias('rm')
      .description('Remove a project from registry')
      .argument('[name-or-path]', 'Project name or path')
      .action(removeAction)
  )
  .addCommand(
    new Command('info')
      .description('Show project details')
      .argument('[name-or-path]', 'Project name or path')
      .action(infoAction)
  )
  .addCommand(
    new Command('cleanup')
      .description('Remove invalid projects from registry')
      .action(cleanupAction)
  )
  .addCommand(
    new Command('rename')
      .description('Rename the active project')
      .argument('[name]', 'New project name')
      .action(renameAction)
  );

// Default action (list)
projectsCommand.action(listAction);
