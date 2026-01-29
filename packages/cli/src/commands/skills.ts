/**
 * Skills Command - drift skills
 *
 * Manage Agent Skills for AI-assisted development.
 * Skills are folders of instructions, scripts, and resources that AI agents
 * can load to perform specialized tasks.
 *
 * Commands:
 * - drift skills list      - List available skills
 * - drift skills install   - Install a skill to your project
 * - drift skills info      - Show skill details
 * - drift skills search    - Search skills by keyword
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import chalk from 'chalk';
import { Command } from 'commander';

import { confirmPrompt, selectPrompt } from '../ui/prompts.js';
import { createSpinner, status } from '../ui/spinner.js';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Types
// ============================================================================

interface SkillMetadata {
  name: string;
  description: string;
  license?: string | undefined;
  compatibility?: string | undefined;
  metadata?: {
    category?: string;
    time?: string;
    source?: string;
  } | undefined;
}

interface Skill extends SkillMetadata {
  path: string;
  files: string[];
}

// ============================================================================
// Skill Discovery
// ============================================================================

function getSkillsDirectory(): string {
  // Skills are bundled with the drift package
  // Look in multiple locations for development vs installed
  const possiblePaths = [
    path.join(__dirname, '../../../../skills'),           // Development
    path.join(__dirname, '../../../skills'),              // Built
    path.join(process.cwd(), 'node_modules/driftdetect-cli/skills'),
    path.join(process.cwd(), 'skills'),                   // Local skills
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback to drift repo skills
  return path.join(__dirname, '../../../../skills');
}

function parseSkillMd(content: string): SkillMetadata | null {
  // Parse YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch?.[1]) {return null;}

  const frontmatter = frontmatterMatch[1];
  const metadata: Record<string, unknown> = {};

  // Simple YAML parsing for frontmatter
  const lines = frontmatter.split('\n');
  let inMetadata = false;
  const metadataObj: Record<string, string> = {};

  for (const line of lines) {
    if (line.startsWith('metadata:')) {
      inMetadata = true;
      continue;
    }

    if (inMetadata && line.startsWith('  ')) {
      const match = line.match(/^\s+(\w+):\s*(.+)/);
      if (match?.[1]) {
        metadataObj[match[1]] = match[2]?.trim() ?? '';
      }
    } else if (line.includes(':')) {
      inMetadata = false;
      const colonIndex = line.indexOf(':');
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      if (key) {
        metadata[key] = value;
      }
    }
  }

  if (Object.keys(metadataObj).length > 0) {
    metadata['metadata'] = metadataObj;
  }

  return {
    name: (metadata['name'] as string) || '',
    description: (metadata['description'] as string) || '',
    license: metadata['license'] as string | undefined,
    compatibility: metadata['compatibility'] as string | undefined,
    metadata: metadata['metadata'] as SkillMetadata['metadata'],
  };
}

function discoverSkills(skillsDir: string): Skill[] {
  const skills: Skill[] = [];

  if (!fs.existsSync(skillsDir)) {
    return skills;
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {continue;}
    if (entry.name.startsWith('_')) {continue;} // Skip templates

    const skillPath = path.join(skillsDir, entry.name);
    const skillMdPath = path.join(skillPath, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) {continue;}

    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const metadata = parseSkillMd(content);

    if (!metadata) {continue;}

    // Get all files in skill directory
    const files = fs.readdirSync(skillPath);

    skills.push({
      ...metadata,
      path: skillPath,
      files,
    });
  }

  return skills;
}

// ============================================================================
// Formatters
// ============================================================================

function formatCategory(category?: string): string {
  const colors: Record<string, (s: string) => string> = {
    resilience: chalk.yellow,
    api: chalk.blue,
    auth: chalk.green,
    integrations: chalk.magenta,
    workers: chalk.cyan,
    database: chalk.red,
    frontend: chalk.rgb(255, 165, 0),
  };
  if (!category) {return chalk.gray('general');}
  return (colors[category] ?? chalk.gray)(category);
}

function formatTime(time?: string): string {
  if (!time) {return chalk.gray('-');}
  return chalk.white(time);
}

// ============================================================================
// List Command
// ============================================================================

interface ListOptions {
  json?: boolean;
  category?: string;
}

async function listAction(options: ListOptions): Promise<void> {
  const skillsDir = getSkillsDirectory();
  let skills = discoverSkills(skillsDir);

  if (options.category) {
    skills = skills.filter(
      s => s.metadata?.category?.toLowerCase() === options.category!.toLowerCase()
    );
  }

  // Sort by category then name
  skills.sort((a, b) => {
    const catA = a.metadata?.category || 'zzz';
    const catB = b.metadata?.category || 'zzz';
    if (catA !== catB) {return catA.localeCompare(catB);}
    return a.name.localeCompare(b.name);
  });

  if (options.json) {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  if (skills.length === 0) {
    console.log();
    console.log(chalk.yellow('No skills found.'));
    console.log(chalk.gray('Skills directory: ' + skillsDir));
    console.log();
    return;
  }

  console.log();
  console.log(chalk.bold(`🎯 Available Skills (${skills.length})`));
  console.log();

  // Table header
  console.log(
    chalk.gray(
      '  ' +
        'Name'.padEnd(22) +
        'Category'.padEnd(14) +
        'Time'.padEnd(8) +
        'Description'
    )
  );
  console.log(chalk.gray('  ' + '─'.repeat(90)));

  for (const skill of skills) {
    const name = chalk.cyan(skill.name.padEnd(22));
    const category = formatCategory(skill.metadata?.category).padEnd(14);
    const time = formatTime(skill.metadata?.time).padEnd(8);
    const desc = skill.description.slice(0, 45) + (skill.description.length > 45 ? '...' : '');

    console.log(`  ${name}${category}${time}${chalk.gray(desc)}`);
  }

  console.log();
  console.log(chalk.gray('Install a skill: drift skills install <name>'));
  console.log(chalk.gray('View details:    drift skills info <name>'));
  console.log();
}

// ============================================================================
// Install Command
// ============================================================================

interface InstallOptions {
  force?: boolean;
  all?: boolean;
}

async function installAction(skillNames: string[], options: InstallOptions): Promise<void> {
  const skillsDir = getSkillsDirectory();
  const skills = discoverSkills(skillsDir);
  const targetDir = path.join(process.cwd(), '.github', 'skills');

  // If --all, install all skills
  if (options.all) {
    skillNames = skills.map(s => s.name);
  }

  if (skillNames.length === 0) {
    // Interactive selection
    const choices = skills.map(s => ({
      name: `${s.name} - ${s.description.slice(0, 50)}...`,
      value: s.name,
    }));

    const selected = await selectPrompt('Select skill to install:', choices);
    skillNames = [selected];
  }

  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let installed = 0;
  let skipped = 0;

  for (const skillName of skillNames) {
    const skill = skills.find(s => s.name === skillName);

    if (!skill) {
      status.error(`Skill not found: ${skillName}`);
      continue;
    }

    const destPath = path.join(targetDir, skill.name);

    // Check if already installed
    if (fs.existsSync(destPath) && !options.force) {
      status.info(`Skill already installed: ${skill.name} (use --force to overwrite)`);
      skipped++;
      continue;
    }

    const spinner = createSpinner(`Installing ${skill.name}...`);
    spinner.start();

    try {
      // Copy skill directory
      copyDirectory(skill.path, destPath);
      spinner.succeed(`Installed ${chalk.cyan(skill.name)}`);
      installed++;
    } catch (error) {
      spinner.fail(`Failed to install ${skill.name}`);
      console.error(chalk.red((error as Error).message));
    }
  }

  console.log();
  if (installed > 0) {
    status.success(`Installed ${installed} skill(s) to ${chalk.gray('.github/skills/')}`);
  }
  if (skipped > 0) {
    console.log(chalk.gray(`Skipped ${skipped} already installed skill(s)`));
  }
  console.log();
}

function copyDirectory(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ============================================================================
// Info Command
// ============================================================================

async function infoAction(skillName?: string): Promise<void> {
  const skillsDir = getSkillsDirectory();
  const skills = discoverSkills(skillsDir);

  let skill: Skill | undefined;

  if (skillName) {
    skill = skills.find(s => s.name === skillName);
  } else {
    // Interactive selection
    const choices = skills.map(s => ({
      name: `${s.name} - ${s.description.slice(0, 40)}...`,
      value: s.name,
    }));

    const selected = await selectPrompt('Select skill:', choices);
    skill = skills.find(s => s.name === selected);
  }

  if (!skill) {
    status.error(`Skill not found: ${skillName}`);
    return;
  }

  console.log();
  console.log(chalk.bold(`🎯 ${skill.name}`));
  console.log();
  console.log(chalk.gray('  Description:   ') + skill.description);
  console.log(chalk.gray('  Category:      ') + formatCategory(skill.metadata?.category));
  console.log(chalk.gray('  Time:          ') + formatTime(skill.metadata?.time));
  console.log(chalk.gray('  Compatibility: ') + (skill.compatibility || 'Any'));
  console.log(chalk.gray('  License:       ') + (skill.license || 'MIT'));
  console.log();
  console.log(chalk.gray('  Files:'));
  for (const file of skill.files) {
    console.log(chalk.gray('    - ') + file);
  }
  console.log();
  console.log(chalk.gray('  Path: ') + skill.path);
  console.log();

  // Show preview of SKILL.md
  const skillMdPath = path.join(skill.path, 'SKILL.md');
  const content = fs.readFileSync(skillMdPath, 'utf-8');

  // Extract first section after frontmatter
  const bodyMatch = content.match(/^---[\s\S]*?---\n\n([\s\S]*?)(?=\n## |$)/);
  if (bodyMatch?.[1]) {
    console.log(chalk.bold('  Preview:'));
    console.log();
    const preview = bodyMatch[1].split('\n').slice(0, 10).map(l => '    ' + l).join('\n');
    console.log(chalk.gray(preview));
    console.log(chalk.gray('    ...'));
  }

  console.log();
  console.log(chalk.gray(`Install: drift skills install ${skill.name}`));
  console.log();
}

// ============================================================================
// Search Command
// ============================================================================

async function searchAction(query: string): Promise<void> {
  const skillsDir = getSkillsDirectory();
  const skills = discoverSkills(skillsDir);

  const queryLower = query.toLowerCase();
  const matches = skills.filter(
    s =>
      s.name.toLowerCase().includes(queryLower) ||
      s.description.toLowerCase().includes(queryLower) ||
      s.metadata?.category?.toLowerCase().includes(queryLower)
  );

  if (matches.length === 0) {
    console.log();
    console.log(chalk.yellow(`No skills found matching "${query}"`));
    console.log();
    return;
  }

  console.log();
  console.log(chalk.bold(`🔍 Search Results for "${query}" (${matches.length})`));
  console.log();

  for (const skill of matches) {
    console.log(
      `  ${chalk.cyan(skill.name.padEnd(20))} ${formatCategory(skill.metadata?.category).padEnd(12)} ${chalk.gray(skill.description.slice(0, 50))}...`
    );
  }

  console.log();
}

// ============================================================================
// Uninstall Command
// ============================================================================

async function uninstallAction(skillName?: string): Promise<void> {
  const targetDir = path.join(process.cwd(), '.github', 'skills');

  if (!fs.existsSync(targetDir)) {
    status.error('No skills installed');
    return;
  }

  const installed = fs.readdirSync(targetDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name);

  if (installed.length === 0) {
    status.error('No skills installed');
    return;
  }

  let toRemove: string;

  if (skillName) {
    if (!installed.includes(skillName)) {
      status.error(`Skill not installed: ${skillName}`);
      return;
    }
    toRemove = skillName;
  } else {
    // Interactive selection
    const choices = installed.map(name => ({ name, value: name }));
    toRemove = await selectPrompt('Select skill to uninstall:', choices);
  }

  const confirmed = await confirmPrompt(`Uninstall ${toRemove}?`, false);
  if (!confirmed) {
    status.info('Cancelled');
    return;
  }

  const skillPath = path.join(targetDir, toRemove);
  fs.rmSync(skillPath, { recursive: true });
  status.success(`Uninstalled ${toRemove}`);
}

// ============================================================================
// Command Registration
// ============================================================================

export const skillsCommand = new Command('skills')
  .description('Manage Agent Skills for AI-assisted development')
  .addCommand(
    new Command('list')
      .alias('ls')
      .description('List available skills')
      .option('--json', 'Output as JSON')
      .option('-c, --category <category>', 'Filter by category')
      .action(listAction)
  )
  .addCommand(
    new Command('install')
      .alias('i')
      .description('Install skill(s) to your project')
      .argument('[skills...]', 'Skill name(s) to install')
      .option('-f, --force', 'Overwrite existing skills')
      .option('-a, --all', 'Install all available skills')
      .action(installAction)
  )
  .addCommand(
    new Command('info')
      .description('Show skill details')
      .argument('[name]', 'Skill name')
      .action(infoAction)
  )
  .addCommand(
    new Command('search')
      .description('Search skills by keyword')
      .argument('<query>', 'Search query')
      .action(searchAction)
  )
  .addCommand(
    new Command('uninstall')
      .alias('rm')
      .description('Uninstall a skill from your project')
      .argument('[name]', 'Skill name')
      .action(uninstallAction)
  );

// Default action (list)
skillsCommand.action(listAction);
