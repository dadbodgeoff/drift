/**
 * Memory Setup Command - drift memory setup
 *
 * Interactive wizard to initialize Cortex memory with user preferences,
 * tribal knowledge, workflows, agent spawns, and more.
 *
 * All sections are optional - users can skip any section with 'n'.
 * The wizard guides users through setting up the most valuable memory types
 * that will help AI agents understand their project and preferences.
 *
 * @module commands/memory-setup
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import { confirm, input, select, checkbox } from '@inquirer/prompts';

import { createSpinner } from '../ui/spinner.js';

const DRIFT_DIR = '.drift';
const MEMORY_DIR = 'memory';
const MEMORY_DB = 'cortex.db';

// ============================================================================
// Types
// ============================================================================

interface SetupState {
  projectName: string;
  projectDescription: string;
  techStack: string[];
  primaryLanguage: string;
  frameworks: string[];
  preferences: {
    verbosity: 'minimal' | 'normal' | 'detailed';
    codeStyle: Record<string, string>;
    focusAreas: string[];
    avoidTopics: string[];
  };
  tribalKnowledge: Array<{
    topic: string;
    knowledge: string;
    severity: 'info' | 'warning' | 'critical';
  }>;
  workflows: Array<{
    name: string;
    slug: string;
    description: string;
    steps: Array<{ order: number; name: string; description: string }>;
    triggerPhrases: string[];
  }>;
  agentSpawns: Array<{
    name: string;
    slug: string;
    description: string;
    systemPrompt: string;
    tools: string[];
    triggerPatterns: string[];
  }>;
  entities: Array<{
    entityType: string;
    name: string;
    keyFacts: string[];
    status: string;
  }>;
  skills: Array<{
    name: string;
    domain: string;
    proficiencyLevel: string;
    keyPrinciples: string[];
  }>;
  environments: Array<{
    name: string;
    environmentType: string;
    warnings: string[];
    endpoints: Record<string, string>;
  }>;
}

interface SetupOptions {
  verbose?: boolean;
  yes?: boolean;
  skip?: string[];
}

// ============================================================================
// Helpers
// ============================================================================

async function getCortex(rootDir: string): Promise<any> {
  const { getCortex: getGlobalCortex } = await import('driftdetect-cortex');
  const memoryDir = path.join(rootDir, DRIFT_DIR, MEMORY_DIR);
  await fs.mkdir(memoryDir, { recursive: true });
  const dbPath = path.join(memoryDir, MEMORY_DB);
  return await getGlobalCortex({
    storage: { type: 'sqlite', sqlitePath: dbPath },
    autoInitialize: true,
  });
}

async function detectProjectInfo(rootDir: string): Promise<Partial<SetupState>> {
  const detected: Partial<SetupState> = {
    techStack: [],
    frameworks: [],
    primaryLanguage: 'unknown',
  };

  // Check package.json
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    detected.projectName = pkg.name;
    detected.projectDescription = pkg.description;

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Detect frameworks
    if (deps['react']) detected.frameworks!.push('React');
    if (deps['vue']) detected.frameworks!.push('Vue');
    if (deps['angular']) detected.frameworks!.push('Angular');
    if (deps['next']) detected.frameworks!.push('Next.js');
    if (deps['express']) detected.frameworks!.push('Express');
    if (deps['fastify']) detected.frameworks!.push('Fastify');
    if (deps['nestjs'] || deps['@nestjs/core']) detected.frameworks!.push('NestJS');

    // Detect tech stack
    if (deps['typescript']) detected.techStack!.push('TypeScript');
    if (deps['prisma'] || deps['@prisma/client']) detected.techStack!.push('Prisma');
    if (deps['drizzle-orm']) detected.techStack!.push('Drizzle');
    if (deps['pg'] || deps['postgres']) detected.techStack!.push('PostgreSQL');
    if (deps['mysql2']) detected.techStack!.push('MySQL');
    if (deps['redis'] || deps['ioredis']) detected.techStack!.push('Redis');

    detected.primaryLanguage = deps['typescript'] ? 'TypeScript' : 'JavaScript';
  } catch {
    // No package.json
  }

  // Check for Python
  try {
    await fs.access(path.join(rootDir, 'requirements.txt'));
    detected.primaryLanguage = 'Python';
    detected.techStack!.push('Python');
  } catch {
    // No requirements.txt
  }

  // Check for Go
  try {
    await fs.access(path.join(rootDir, 'go.mod'));
    detected.primaryLanguage = 'Go';
    detected.techStack!.push('Go');
  } catch {
    // No go.mod
  }

  // Check for Rust
  try {
    await fs.access(path.join(rootDir, 'Cargo.toml'));
    detected.primaryLanguage = 'Rust';
    detected.techStack!.push('Rust');
  } catch {
    // No Cargo.toml
  }

  return detected;
}

function printHeader(title: string, subtitle?: string): void {
  console.log();
  console.log(chalk.bold.cyan(`━━━ ${title} ━━━`));
  if (subtitle) {
    console.log(chalk.gray(subtitle));
  }
  console.log();
}

function printSuccess(message: string): void {
  console.log(chalk.green(`  ✓ ${message}`));
}

function printSkip(message: string): void {
  console.log(chalk.gray(`  ○ ${message}`));
}

// ============================================================================
// Section: Core Identity
// ============================================================================

async function setupCoreIdentity(
  rootDir: string,
  detected: Partial<SetupState>,
  autoYes: boolean
): Promise<SetupState['preferences'] & { projectName: string; projectDescription: string; techStack: string[]; primaryLanguage: string; frameworks: string[] } | null> {
  printHeader('🏠 Core Identity', 'Define your project identity and preferences');

  console.log(chalk.gray('  This creates the permanent "core" memory that never decays.'));
  console.log(chalk.gray('  AI agents will always have access to this context.'));
  console.log();

  const proceed = autoYes || await confirm({
    message: 'Set up core identity?',
    default: true,
  });

  if (!proceed) {
    printSkip('Skipped core identity setup');
    return null;
  }

  // Project name
  const projectName = await input({
    message: 'Project name:',
    default: detected.projectName || path.basename(rootDir),
  });

  // Project description
  const projectDescription = await input({
    message: 'Project description (one sentence):',
    default: detected.projectDescription || '',
  });

  // Tech stack confirmation
  const detectedStack = detected.techStack?.join(', ') || 'None detected';
  console.log(chalk.gray(`  Detected tech stack: ${detectedStack}`));
  const techStackInput = await input({
    message: 'Tech stack (comma-separated, or press Enter to accept):',
    default: detected.techStack?.join(', ') || '',
  });
  const techStack = techStackInput.split(',').map(s => s.trim()).filter(Boolean);

  // Primary language
  const primaryLanguage = await input({
    message: 'Primary language:',
    default: detected.primaryLanguage || 'TypeScript',
  });

  // Frameworks
  const frameworksInput = await input({
    message: 'Frameworks (comma-separated):',
    default: detected.frameworks?.join(', ') || '',
  });
  const frameworks = frameworksInput.split(',').map(s => s.trim()).filter(Boolean);

  // Preferences
  console.log();
  console.log(chalk.gray('  Now let\'s set your preferences for AI interactions:'));
  console.log();

  const verbosity = await select({
    message: 'Response verbosity:',
    choices: [
      { value: 'minimal', name: 'Minimal - Just the essentials' },
      { value: 'normal', name: 'Normal - Balanced explanations (recommended)' },
      { value: 'detailed', name: 'Detailed - Full explanations and context' },
    ],
    default: 'normal',
  }) as 'minimal' | 'normal' | 'detailed';

  // Code style preferences
  const codeStyle: Record<string, string> = {};
  const setupCodeStyle = await confirm({
    message: 'Set up code style preferences?',
    default: false,
  });

  if (setupCodeStyle) {
    const namingConvention = await select({
      message: 'Variable naming convention:',
      choices: [
        { value: 'camelCase', name: 'camelCase' },
        { value: 'snake_case', name: 'snake_case' },
        { value: 'PascalCase', name: 'PascalCase' },
      ],
      default: 'camelCase',
    });
    codeStyle['variables'] = namingConvention;

    const componentNaming = await select({
      message: 'Component naming convention:',
      choices: [
        { value: 'PascalCase', name: 'PascalCase (React style)' },
        { value: 'kebab-case', name: 'kebab-case (Vue style)' },
      ],
      default: 'PascalCase',
    });
    codeStyle['components'] = componentNaming;
  }

  // Focus areas
  const focusAreasInput = await input({
    message: 'Focus areas (comma-separated, e.g., "security, performance, testing"):',
    default: '',
  });
  const focusAreas = focusAreasInput.split(',').map(s => s.trim()).filter(Boolean);

  // Topics to avoid
  const avoidTopicsInput = await input({
    message: 'Topics to avoid (comma-separated, e.g., "legacy code, deprecated APIs"):',
    default: '',
  });
  const avoidTopics = avoidTopicsInput.split(',').map(s => s.trim()).filter(Boolean);

  return {
    projectName,
    projectDescription,
    techStack,
    primaryLanguage,
    frameworks,
    verbosity,
    codeStyle,
    focusAreas,
    avoidTopics,
  };
}

// ============================================================================
// Section: Tribal Knowledge
// ============================================================================

async function setupTribalKnowledge(autoYes: boolean): Promise<SetupState['tribalKnowledge']> {
  printHeader('⚠️ Tribal Knowledge', 'Capture institutional knowledge and gotchas');

  console.log(chalk.gray('  Tribal knowledge is the stuff that\'s not written down anywhere.'));
  console.log(chalk.gray('  The gotchas, warnings, and hard-won lessons only experienced'));
  console.log(chalk.gray('  team members know. AI agents will surface these as warnings.'));
  console.log();

  const proceed = autoYes || await confirm({
    message: 'Add tribal knowledge?',
    default: true,
  });

  if (!proceed) {
    printSkip('Skipped tribal knowledge setup');
    return [];
  }

  const tribalKnowledge: SetupState['tribalKnowledge'] = [];

  console.log();
  console.log(chalk.gray('  Examples:'));
  console.log(chalk.gray('    • "Never call the payment API without idempotency keys"'));
  console.log(chalk.gray('    • "The legacy auth system has a 5-second timeout"'));
  console.log(chalk.gray('    • "Always check user.isActive before user.permissions"'));
  console.log();

  let addMore = true;
  while (addMore) {
    const topic = await input({
      message: 'Topic (e.g., "authentication", "payments", "database"):',
    });

    if (!topic) break;

    const knowledge = await input({
      message: 'Knowledge (the actual gotcha or warning):',
    });

    if (!knowledge) break;

    const severity = await select({
      message: 'Severity:',
      choices: [
        { value: 'info', name: 'Info - Good to know' },
        { value: 'warning', name: 'Warning - Important to remember' },
        { value: 'critical', name: 'Critical - Must not ignore' },
      ],
      default: 'warning',
    }) as 'info' | 'warning' | 'critical';

    tribalKnowledge.push({ topic, knowledge, severity });
    printSuccess(`Added: ${topic}`);

    addMore = await confirm({
      message: 'Add another piece of tribal knowledge?',
      default: true,
    });
  }

  return tribalKnowledge;
}

// ============================================================================
// Section: Workflows
// ============================================================================

async function setupWorkflows(autoYes: boolean): Promise<SetupState['workflows']> {
  printHeader('📋 Workflows', 'Define step-by-step processes');

  console.log(chalk.gray('  Workflows are step-by-step processes that AI can guide you through.'));
  console.log(chalk.gray('  When you say "how do I deploy?", the AI will walk you through'));
  console.log(chalk.gray('  your specific deployment process.'));
  console.log();

  const proceed = await confirm({
    message: 'Set up workflows?',
    default: !autoYes, // Default no in auto mode
  });

  if (!proceed) {
    printSkip('Skipped workflow setup');
    return [];
  }

  const workflows: SetupState['workflows'] = [];

  // Offer common workflow templates
  const templates = await checkbox({
    message: 'Start with common workflow templates?',
    choices: [
      { value: 'deploy', name: 'Deploy to Production' },
      { value: 'review', name: 'Code Review Process' },
      { value: 'release', name: 'Release New Version' },
      { value: 'onboard', name: 'Onboard New Team Member' },
      { value: 'incident', name: 'Incident Response' },
      { value: 'custom', name: 'Create Custom Workflow' },
    ],
  });

  for (const template of templates) {
    let workflow: SetupState['workflows'][0];

    switch (template) {
      case 'deploy':
        workflow = {
          name: 'Deploy to Production',
          slug: 'deploy-production',
          description: 'Steps to deploy code to production',
          steps: [],
          triggerPhrases: ['deploy', 'deploy to production', 'push to prod', 'release to production'],
        };
        console.log();
        console.log(chalk.gray('  Define your deployment steps:'));
        break;

      case 'review':
        workflow = {
          name: 'Code Review Process',
          slug: 'code-review',
          description: 'How to conduct a code review',
          steps: [],
          triggerPhrases: ['code review', 'review code', 'PR review', 'review this PR'],
        };
        console.log();
        console.log(chalk.gray('  Define your code review steps:'));
        break;

      case 'release':
        workflow = {
          name: 'Release New Version',
          slug: 'release-version',
          description: 'Steps to release a new version',
          steps: [],
          triggerPhrases: ['release', 'new version', 'cut a release', 'version bump'],
        };
        console.log();
        console.log(chalk.gray('  Define your release steps:'));
        break;

      case 'onboard':
        workflow = {
          name: 'Onboard New Team Member',
          slug: 'onboard-member',
          description: 'Checklist for onboarding new team members',
          steps: [],
          triggerPhrases: ['onboard', 'new team member', 'onboarding checklist'],
        };
        console.log();
        console.log(chalk.gray('  Define your onboarding steps:'));
        break;

      case 'incident':
        workflow = {
          name: 'Incident Response',
          slug: 'incident-response',
          description: 'Steps to handle production incidents',
          steps: [],
          triggerPhrases: ['incident', 'production issue', 'outage', 'emergency'],
        };
        console.log();
        console.log(chalk.gray('  Define your incident response steps:'));
        break;

      case 'custom':
      default:
        const name = await input({ message: 'Workflow name:' });
        if (!name) continue;
        const slug = name.toLowerCase().replace(/\s+/g, '-');
        const description = await input({ message: 'Description:' });
        const triggersInput = await input({ message: 'Trigger phrases (comma-separated):' });
        workflow = {
          name,
          slug,
          description,
          steps: [],
          triggerPhrases: triggersInput.split(',').map(s => s.trim()).filter(Boolean),
        };
        break;
    }

    // Add steps
    let stepOrder = 1;
    let addMoreSteps = true;
    while (addMoreSteps) {
      const stepName = await input({
        message: `Step ${stepOrder} name (or press Enter to finish):`,
      });

      if (!stepName) break;

      const stepDescription = await input({
        message: `Step ${stepOrder} description:`,
      });

      workflow.steps.push({
        order: stepOrder,
        name: stepName,
        description: stepDescription,
      });

      stepOrder++;
      addMoreSteps = stepOrder <= 10; // Max 10 steps
    }

    if (workflow.steps.length > 0) {
      workflows.push(workflow);
      printSuccess(`Added workflow: ${workflow.name} (${workflow.steps.length} steps)`);
    }
  }

  return workflows;
}

// ============================================================================
// Section: Agent Spawns
// ============================================================================

async function setupAgentSpawns(autoYes: boolean): Promise<SetupState['agentSpawns']> {
  printHeader('🤖 Agent Spawns', 'Create reusable agent configurations');

  console.log(chalk.gray('  Agent spawns are reusable AI agent configurations.'));
  console.log(chalk.gray('  Say "spawn my code reviewer" and get a specialized agent'));
  console.log(chalk.gray('  with specific tools, constraints, and personality.'));
  console.log();

  const proceed = await confirm({
    message: 'Set up agent spawns?',
    default: !autoYes,
  });

  if (!proceed) {
    printSkip('Skipped agent spawn setup');
    return [];
  }

  const agentSpawns: SetupState['agentSpawns'] = [];

  // Offer common agent templates
  const templates = await checkbox({
    message: 'Start with common agent templates?',
    choices: [
      { value: 'reviewer', name: 'Code Reviewer - Reviews code for quality and best practices' },
      { value: 'security', name: 'Security Auditor - Checks for security vulnerabilities' },
      { value: 'docs', name: 'Documentation Writer - Writes and improves documentation' },
      { value: 'refactor', name: 'Refactoring Assistant - Suggests code improvements' },
      { value: 'test', name: 'Test Writer - Generates test cases' },
      { value: 'custom', name: 'Create Custom Agent' },
    ],
  });

  for (const template of templates) {
    let agent: SetupState['agentSpawns'][0];

    switch (template) {
      case 'reviewer':
        agent = {
          name: 'Code Reviewer',
          slug: 'code-reviewer',
          description: 'Reviews code for quality, best practices, and potential issues',
          systemPrompt: 'You are a thorough code reviewer. Focus on code quality, readability, maintainability, and adherence to best practices. Be constructive and specific in your feedback.',
          tools: ['readFile', 'grepSearch', 'getDiagnostics'],
          triggerPatterns: ['review this', 'code review', 'check this code', 'spawn code reviewer'],
        };
        break;

      case 'security':
        agent = {
          name: 'Security Auditor',
          slug: 'security-auditor',
          description: 'Checks code for security vulnerabilities and best practices',
          systemPrompt: 'You are a security expert. Look for vulnerabilities like SQL injection, XSS, authentication issues, and insecure configurations. Reference OWASP guidelines.',
          tools: ['readFile', 'grepSearch', 'drift_security_summary'],
          triggerPatterns: ['security audit', 'check security', 'spawn security auditor', 'find vulnerabilities'],
        };
        break;

      case 'docs':
        agent = {
          name: 'Documentation Writer',
          slug: 'docs-writer',
          description: 'Writes and improves documentation',
          systemPrompt: 'You are a technical writer. Write clear, concise documentation. Include examples, explain edge cases, and maintain consistent style.',
          tools: ['readFile', 'fsWrite', 'drift_signature'],
          triggerPatterns: ['write docs', 'document this', 'spawn docs writer', 'add documentation'],
        };
        break;

      case 'refactor':
        agent = {
          name: 'Refactoring Assistant',
          slug: 'refactor-assistant',
          description: 'Suggests code improvements and refactoring opportunities',
          systemPrompt: 'You are a refactoring expert. Identify code smells, suggest improvements, and help simplify complex code while maintaining functionality.',
          tools: ['readFile', 'drift_coupling', 'drift_similar'],
          triggerPatterns: ['refactor this', 'improve this code', 'spawn refactor assistant', 'simplify this'],
        };
        break;

      case 'test':
        agent = {
          name: 'Test Writer',
          slug: 'test-writer',
          description: 'Generates test cases for code',
          systemPrompt: 'You are a testing expert. Write comprehensive tests covering happy paths, edge cases, and error conditions. Follow the project\'s testing conventions.',
          tools: ['readFile', 'fsWrite', 'drift_test_template'],
          triggerPatterns: ['write tests', 'add tests', 'spawn test writer', 'test this'],
        };
        break;

      case 'custom':
      default:
        const name = await input({ message: 'Agent name:' });
        if (!name) continue;
        const slug = name.toLowerCase().replace(/\s+/g, '-');
        const description = await input({ message: 'Description:' });
        const systemPrompt = await input({ message: 'System prompt (personality/instructions):' });
        const toolsInput = await input({ message: 'Tools (comma-separated):' });
        const triggersInput = await input({ message: 'Trigger patterns (comma-separated):' });
        agent = {
          name,
          slug,
          description,
          systemPrompt,
          tools: toolsInput.split(',').map(s => s.trim()).filter(Boolean),
          triggerPatterns: triggersInput.split(',').map(s => s.trim()).filter(Boolean),
        };
        break;
    }

    agentSpawns.push(agent);
    printSuccess(`Added agent: ${agent.name}`);
  }

  return agentSpawns;
}


// ============================================================================
// Section: Entities
// ============================================================================

async function setupEntities(autoYes: boolean): Promise<SetupState['entities']> {
  printHeader('📦 Entities', 'Track projects, teams, and systems');

  console.log(chalk.gray('  Entities are the key things in your world - projects, teams,'));
  console.log(chalk.gray('  services, clients. AI agents will understand relationships'));
  console.log(chalk.gray('  and provide context-aware assistance.'));
  console.log();

  const proceed = await confirm({
    message: 'Set up entities?',
    default: !autoYes,
  });

  if (!proceed) {
    printSkip('Skipped entity setup');
    return [];
  }

  const entities: SetupState['entities'] = [];

  let addMore = true;
  while (addMore) {
    const entityType = await select({
      message: 'Entity type:',
      choices: [
        { value: 'project', name: 'Project' },
        { value: 'product', name: 'Product' },
        { value: 'team', name: 'Team' },
        { value: 'service', name: 'Service' },
        { value: 'system', name: 'System' },
        { value: 'client', name: 'Client' },
        { value: 'vendor', name: 'Vendor' },
      ],
    });

    const name = await input({ message: 'Name:' });
    if (!name) break;

    const status = await select({
      message: 'Status:',
      choices: [
        { value: 'active', name: 'Active' },
        { value: 'planned', name: 'Planned' },
        { value: 'maintenance', name: 'Maintenance' },
        { value: 'deprecated', name: 'Deprecated' },
        { value: 'archived', name: 'Archived' },
      ],
      default: 'active',
    });

    console.log(chalk.gray('  Add key facts about this entity (press Enter when done):'));
    const keyFacts: string[] = [];
    let addFacts = true;
    while (addFacts && keyFacts.length < 5) {
      const fact = await input({ message: `Fact ${keyFacts.length + 1}:` });
      if (!fact) break;
      keyFacts.push(fact);
    }

    entities.push({ entityType, name, keyFacts, status });
    printSuccess(`Added entity: ${name} (${entityType})`);

    addMore = await confirm({
      message: 'Add another entity?',
      default: true,
    });
  }

  return entities;
}

// ============================================================================
// Section: Skills
// ============================================================================

async function setupSkills(autoYes: boolean): Promise<SetupState['skills']> {
  printHeader('🧠 Skills', 'Track knowledge domains and proficiency');

  console.log(chalk.gray('  Skills help AI understand your team\'s expertise levels.'));
  console.log(chalk.gray('  AI will tailor explanations and suggest learning resources'));
  console.log(chalk.gray('  based on proficiency.'));
  console.log();

  const proceed = await confirm({
    message: 'Set up skills?',
    default: !autoYes,
  });

  if (!proceed) {
    printSkip('Skipped skill setup');
    return [];
  }

  const skills: SetupState['skills'] = [];

  let addMore = true;
  while (addMore) {
    const name = await input({ message: 'Skill name (e.g., "React Testing", "AWS Lambda"):' });
    if (!name) break;

    const domain = await input({
      message: 'Domain (e.g., "frontend", "backend", "devops"):',
    });

    const proficiencyLevel = await select({
      message: 'Proficiency level:',
      choices: [
        { value: 'learning', name: 'Learning - Just getting started' },
        { value: 'beginner', name: 'Beginner - Basic understanding' },
        { value: 'competent', name: 'Competent - Can work independently' },
        { value: 'proficient', name: 'Proficient - Deep knowledge' },
        { value: 'expert', name: 'Expert - Can teach others' },
      ],
      default: 'competent',
    });

    console.log(chalk.gray('  Add key principles for this skill (press Enter when done):'));
    const keyPrinciples: string[] = [];
    while (keyPrinciples.length < 5) {
      const principle = await input({ message: `Principle ${keyPrinciples.length + 1}:` });
      if (!principle) break;
      keyPrinciples.push(principle);
    }

    skills.push({ name, domain, proficiencyLevel, keyPrinciples });
    printSuccess(`Added skill: ${name} (${proficiencyLevel})`);

    addMore = await confirm({
      message: 'Add another skill?',
      default: true,
    });
  }

  return skills;
}

// ============================================================================
// Section: Environments
// ============================================================================

async function setupEnvironments(autoYes: boolean): Promise<SetupState['environments']> {
  printHeader('🌍 Environments', 'Configure environment information');

  console.log(chalk.gray('  Environment configs help AI understand your infrastructure.'));
  console.log(chalk.gray('  AI will warn you about production risks and suggest'));
  console.log(chalk.gray('  appropriate environments for testing.'));
  console.log();

  const proceed = await confirm({
    message: 'Set up environments?',
    default: !autoYes,
  });

  if (!proceed) {
    printSkip('Skipped environment setup');
    return [];
  }

  const environments: SetupState['environments'] = [];

  // Offer common environment templates
  const templates = await checkbox({
    message: 'Which environments do you have?',
    choices: [
      { value: 'production', name: 'Production' },
      { value: 'staging', name: 'Staging' },
      { value: 'development', name: 'Development' },
      { value: 'testing', name: 'Testing' },
      { value: 'sandbox', name: 'Sandbox' },
    ],
  });

  for (const template of templates) {
    const env: SetupState['environments'][0] = {
      name: template.charAt(0).toUpperCase() + template.slice(1),
      environmentType: template as any,
      warnings: [],
      endpoints: {},
    };

    console.log();
    console.log(chalk.gray(`  Configure ${env.name}:`));

    // Add warnings
    if (template === 'production') {
      env.warnings.push('⚠️ This is PRODUCTION - be careful!');
      const addWarnings = await confirm({
        message: 'Add production-specific warnings?',
        default: true,
      });
      if (addWarnings) {
        while (env.warnings.length < 5) {
          const warning = await input({ message: 'Warning (or press Enter to finish):' });
          if (!warning) break;
          env.warnings.push(warning);
        }
      }
    }

    // Add endpoints
    const addEndpoints = await confirm({
      message: 'Add endpoint URLs?',
      default: false,
    });
    if (addEndpoints) {
      const apiUrl = await input({ message: 'API URL:' });
      if (apiUrl) env.endpoints['api'] = apiUrl;
      const webUrl = await input({ message: 'Web URL:' });
      if (webUrl) env.endpoints['web'] = webUrl;
    }

    environments.push(env);
    printSuccess(`Added environment: ${env.name}`);
  }

  return environments;
}

// ============================================================================
// Save to Cortex
// ============================================================================

async function saveToMemory(rootDir: string, state: SetupState, _verbose: boolean): Promise<void> {
  const spinner = createSpinner('Saving to Cortex memory...');
  spinner.start();

  try {
    const cortex = await getCortex(rootDir);
    let savedCount = 0;

    // Save core memory
    if (state.projectName) {
      spinner.text('Saving core identity...');
      await cortex.add({
        type: 'core',
        project: {
          name: state.projectName,
          description: state.projectDescription,
          techStack: state.techStack,
          primaryLanguage: state.primaryLanguage,
          frameworks: state.frameworks,
        },
        conventions: {},
        criticalConstraints: [],
        preferences: state.preferences,
        summary: `🏠 ${state.projectName}`,
        confidence: 1.0,
        importance: 'critical',
      });
      savedCount++;
    }

    // Save tribal knowledge
    for (const tribal of state.tribalKnowledge) {
      spinner.text(`Saving tribal knowledge: ${tribal.topic}...`);
      await cortex.add({
        type: 'tribal',
        topic: tribal.topic,
        knowledge: tribal.knowledge,
        severity: tribal.severity,
        source: { type: 'manual' },
        summary: `⚠️ ${tribal.topic}: ${tribal.knowledge.slice(0, 50)}...`,
        confidence: 1.0,
        importance: tribal.severity === 'critical' ? 'critical' : 'high',
      });
      savedCount++;
    }

    // Save workflows
    for (const workflow of state.workflows) {
      spinner.text(`Saving workflow: ${workflow.name}...`);
      await cortex.add({
        type: 'workflow',
        name: workflow.name,
        slug: workflow.slug,
        description: workflow.description,
        steps: workflow.steps.map(s => ({ ...s, required: true })),
        triggerPhrases: workflow.triggerPhrases,
        stats: { executionCount: 0, successRate: 1.0 },
        summary: `📋 ${workflow.name}: ${workflow.steps.length} steps`,
        confidence: 1.0,
        importance: 'normal',
      });
      savedCount++;
    }

    // Save agent spawns
    for (const agent of state.agentSpawns) {
      spinner.text(`Saving agent: ${agent.name}...`);
      await cortex.add({
        type: 'agent_spawn',
        name: agent.name,
        slug: agent.slug,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        tools: agent.tools,
        triggerPatterns: agent.triggerPatterns,
        autoSpawn: false,
        version: '1.0.0',
        stats: { invocationCount: 0, successRate: 1.0, avgDurationMs: 0 },
        summary: `🤖 ${agent.name}: ${agent.tools.length} tools`,
        confidence: 1.0,
        importance: 'high',
      });
      savedCount++;
    }

    // Save entities
    for (const entity of state.entities) {
      spinner.text(`Saving entity: ${entity.name}...`);
      await cortex.add({
        type: 'entity',
        entityType: entity.entityType,
        name: entity.name,
        keyFacts: entity.keyFacts,
        status: entity.status,
        attributes: {},
        relationships: [],
        summary: `📦 ${entity.entityType}: ${entity.name}`,
        confidence: 1.0,
        importance: 'normal',
      });
      savedCount++;
    }

    // Save skills
    for (const skill of state.skills) {
      spinner.text(`Saving skill: ${skill.name}...`);
      await cortex.add({
        type: 'skill',
        name: skill.name,
        domain: skill.domain,
        proficiencyLevel: skill.proficiencyLevel,
        keyPrinciples: skill.keyPrinciples,
        scope: 'team',
        summary: `🧠 ${skill.name}: ${skill.proficiencyLevel}`,
        confidence: 1.0,
        importance: 'normal',
      });
      savedCount++;
    }

    // Save environments
    for (const env of state.environments) {
      spinner.text(`Saving environment: ${env.name}...`);
      await cortex.add({
        type: 'environment',
        name: env.name,
        environmentType: env.environmentType,
        config: {},
        warnings: env.warnings,
        endpoints: env.endpoints,
        summary: `🌍 ${env.environmentType}: ${env.name}`,
        confidence: 1.0,
        importance: env.environmentType === 'production' ? 'critical' : 'normal',
      });
      savedCount++;
    }

    await cortex.storage.close();
    spinner.succeed(`Saved ${savedCount} memories to Cortex`);

  } catch (error) {
    spinner.fail(`Failed to save: ${error}`);
    throw error;
  }
}

// ============================================================================
// Print Summary
// ============================================================================

function printSummary(state: SetupState): void {
  console.log();
  console.log(chalk.bold.green('═══════════════════════════════════════════════════════════════'));
  console.log(chalk.bold.green('                   CORTEX MEMORY SETUP COMPLETE'));
  console.log(chalk.bold.green('═══════════════════════════════════════════════════════════════'));
  console.log();

  if (state.projectName) {
    console.log(`  ${chalk.bold('Project:')}     ${state.projectName}`);
    if (state.techStack.length > 0) {
      console.log(`  ${chalk.bold('Tech Stack:')}  ${state.techStack.join(', ')}`);
    }
  }

  console.log();
  console.log(chalk.bold('  Memories Created:'));

  if (state.projectName) {
    console.log(`    🏠 Core Identity: 1`);
  }
  if (state.tribalKnowledge.length > 0) {
    console.log(`    ⚠️  Tribal Knowledge: ${state.tribalKnowledge.length}`);
  }
  if (state.workflows.length > 0) {
    console.log(`    📋 Workflows: ${state.workflows.length}`);
  }
  if (state.agentSpawns.length > 0) {
    console.log(`    🤖 Agent Spawns: ${state.agentSpawns.length}`);
  }
  if (state.entities.length > 0) {
    console.log(`    📦 Entities: ${state.entities.length}`);
  }
  if (state.skills.length > 0) {
    console.log(`    🧠 Skills: ${state.skills.length}`);
  }
  if (state.environments.length > 0) {
    console.log(`    🌍 Environments: ${state.environments.length}`);
  }

  console.log();
  console.log(chalk.gray('  Your AI agents now have context about:'));
  if (state.projectName) {
    console.log(chalk.white('    • Your project identity and preferences'));
  }
  if (state.tribalKnowledge.length > 0) {
    console.log(chalk.white('    • Critical gotchas and warnings'));
  }
  if (state.workflows.length > 0) {
    console.log(chalk.white('    • Step-by-step processes'));
  }
  if (state.agentSpawns.length > 0) {
    console.log(chalk.white('    • Specialized agent configurations'));
  }

  console.log();
  console.log(chalk.gray('  Next steps:'));
  console.log(chalk.cyan('    drift memory status        ') + chalk.gray('View memory statistics'));
  console.log(chalk.cyan('    drift memory search <q>    ') + chalk.gray('Search memories'));
  console.log(chalk.cyan('    drift memory add tribal    ') + chalk.gray('Add more tribal knowledge'));
  console.log();
  console.log(chalk.bold.green('═══════════════════════════════════════════════════════════════'));
  console.log();
}

// ============================================================================
// Main Action
// ============================================================================

async function memorySetupAction(options: SetupOptions): Promise<void> {
  const rootDir = process.cwd();
  const verbose = options.verbose ?? false;
  const autoYes = options.yes ?? false;
  const skipSections = new Set(options.skip ?? []);

  console.log();
  console.log(chalk.bold.cyan('╔═══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║                                                               ║'));
  console.log(chalk.bold.cyan('║   🧠 CORTEX MEMORY SETUP WIZARD                               ║'));
  console.log(chalk.bold.cyan('║                                                               ║'));
  console.log(chalk.bold.cyan('║   Set up your AI\'s long-term memory with your project\'s      ║'));
  console.log(chalk.bold.cyan('║   identity, preferences, tribal knowledge, and workflows.    ║'));
  console.log(chalk.bold.cyan('║                                                               ║'));
  console.log(chalk.bold.cyan('║   All sections are optional - skip any with \'n\'              ║'));
  console.log(chalk.bold.cyan('║                                                               ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════╝'));
  console.log();

  // Detect project info
  const spinner = createSpinner('Detecting project information...');
  spinner.start();
  const detected = await detectProjectInfo(rootDir);
  spinner.succeed('Project detected');

  // Initialize state
  const state: SetupState = {
    projectName: '',
    projectDescription: '',
    techStack: [],
    primaryLanguage: '',
    frameworks: [],
    preferences: {
      verbosity: 'normal',
      codeStyle: {},
      focusAreas: [],
      avoidTopics: [],
    },
    tribalKnowledge: [],
    workflows: [],
    agentSpawns: [],
    entities: [],
    skills: [],
    environments: [],
  };

  // Run sections
  if (!skipSections.has('core')) {
    const coreResult = await setupCoreIdentity(rootDir, detected, autoYes);
    if (coreResult) {
      state.projectName = coreResult.projectName;
      state.projectDescription = coreResult.projectDescription;
      state.techStack = coreResult.techStack;
      state.primaryLanguage = coreResult.primaryLanguage;
      state.frameworks = coreResult.frameworks;
      state.preferences = {
        verbosity: coreResult.verbosity,
        codeStyle: coreResult.codeStyle,
        focusAreas: coreResult.focusAreas,
        avoidTopics: coreResult.avoidTopics,
      };
    }
  }

  if (!skipSections.has('tribal')) {
    state.tribalKnowledge = await setupTribalKnowledge(autoYes);
  }

  if (!skipSections.has('workflows')) {
    state.workflows = await setupWorkflows(autoYes);
  }

  if (!skipSections.has('agents')) {
    state.agentSpawns = await setupAgentSpawns(autoYes);
  }

  if (!skipSections.has('entities')) {
    state.entities = await setupEntities(autoYes);
  }

  if (!skipSections.has('skills')) {
    state.skills = await setupSkills(autoYes);
  }

  if (!skipSections.has('environments')) {
    state.environments = await setupEnvironments(autoYes);
  }

  // Check if anything was configured
  const hasContent = state.projectName ||
    state.tribalKnowledge.length > 0 ||
    state.workflows.length > 0 ||
    state.agentSpawns.length > 0 ||
    state.entities.length > 0 ||
    state.skills.length > 0 ||
    state.environments.length > 0;

  if (!hasContent) {
    console.log();
    console.log(chalk.yellow('  No memories configured. Run again when ready!'));
    console.log();
    return;
  }

  // Save to memory
  await saveToMemory(rootDir, state, verbose);

  // Print summary
  printSummary(state);
}

// ============================================================================
// Command Export
// ============================================================================

export const memorySetupCommand = new Command('setup')
  .description('Interactive wizard to set up Cortex memory with preferences, tribal knowledge, workflows, and more')
  .option('-y, --yes', 'Accept defaults for required sections')
  .option('--verbose', 'Enable verbose output')
  .option('--skip <sections>', 'Skip sections (comma-separated: core,tribal,workflows,agents,entities,skills,environments)')
  .action(async (options) => {
    const skipArray = options.skip ? options.skip.split(',').map((s: string) => s.trim()) : [];
    await memorySetupAction({ ...options, skip: skipArray });
  });

export default memorySetupCommand;
