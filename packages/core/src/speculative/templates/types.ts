/**
 * Template System Types
 *
 * Types for the approach template system that provides
 * language-specific implementation strategies.
 *
 * @module speculative/templates/types
 */

import type {
  SupportedLanguage,
  SupportedFramework,
  TaskType,
  ApproachStrategy,
  ApproachTemplate,
} from '../types.js';

// ============================================================================
// Template Builder Types
// ============================================================================

/**
 * Builder for creating approach templates
 */
export interface TemplateBuilder {
  /** Set the template ID */
  id(id: string): TemplateBuilder;
  /** Set the template name */
  name(name: string): TemplateBuilder;
  /** Set the description */
  description(desc: string): TemplateBuilder;
  /** Set the strategy */
  strategy(strategy: ApproachStrategy): TemplateBuilder;
  /** Set the language */
  language(lang: SupportedLanguage): TemplateBuilder;
  /** Add compatible frameworks */
  frameworks(...frameworks: SupportedFramework[]): TemplateBuilder;
  /** Add applicable task types */
  taskTypes(...types: TaskType[]): TemplateBuilder;
  /** Add prerequisites */
  prerequisites(...prereqs: string[]): TemplateBuilder;
  /** Set implementation hint */
  hint(hint: string): TemplateBuilder;
  /** Add file patterns */
  filePatterns(...patterns: string[]): TemplateBuilder;
  /** Set LOC range */
  locRange(min: number, max: number): TemplateBuilder;
  /** Add keywords */
  keywords(...keywords: string[]): TemplateBuilder;
  /** Set priority */
  priority(priority: number): TemplateBuilder;
  /** Build the template */
  build(): ApproachTemplate;
}

/**
 * Create a new template builder
 */
export function createTemplateBuilder(): TemplateBuilder {
  const template: Partial<ApproachTemplate> = {
    frameworks: [],
    taskTypes: [],
    prerequisites: [],
    filePatterns: [],
    keywords: [],
    locRange: [10, 50],
    priority: 50,
  };

  const builder: TemplateBuilder = {
    id(id) {
      template.id = id;
      return builder;
    },
    name(name) {
      template.name = name;
      return builder;
    },
    description(desc) {
      template.description = desc;
      return builder;
    },
    strategy(strategy) {
      template.strategy = strategy;
      return builder;
    },
    language(lang) {
      template.language = lang;
      return builder;
    },
    frameworks(...frameworks) {
      template.frameworks = frameworks;
      return builder;
    },
    taskTypes(...types) {
      template.taskTypes = types;
      return builder;
    },
    prerequisites(...prereqs) {
      template.prerequisites = prereqs;
      return builder;
    },
    hint(hint) {
      template.hint = hint;
      return builder;
    },
    filePatterns(...patterns) {
      template.filePatterns = patterns;
      return builder;
    },
    locRange(min, max) {
      template.locRange = [min, max];
      return builder;
    },
    keywords(...keywords) {
      template.keywords = keywords;
      return builder;
    },
    priority(priority) {
      template.priority = priority;
      return builder;
    },
    build() {
      if (!template.id || !template.name || !template.language || !template.strategy) {
        throw new Error('Template missing required fields: id, name, language, strategy');
      }
      return template as ApproachTemplate;
    },
  };

  return builder;
}

// ============================================================================
// Template Collection Types
// ============================================================================

/**
 * A collection of templates for a specific language
 */
export interface LanguageTemplateCollection {
  /** Language this collection is for */
  language: SupportedLanguage;
  /** All templates in this collection */
  templates: ApproachTemplate[];
  /** Get templates by task type */
  getByTaskType(taskType: TaskType): ApproachTemplate[];
  /** Get templates by framework */
  getByFramework(framework: SupportedFramework): ApproachTemplate[];
  /** Get templates by strategy */
  getByStrategy(strategy: ApproachStrategy): ApproachTemplate[];
}

/**
 * Create a language template collection
 */
export function createLanguageCollection(
  language: SupportedLanguage,
  templates: ApproachTemplate[]
): LanguageTemplateCollection {
  return {
    language,
    templates,
    getByTaskType(taskType) {
      return templates.filter(t => t.taskTypes.includes(taskType));
    },
    getByFramework(framework) {
      return templates.filter(
        t => t.frameworks.length === 0 || t.frameworks.includes(framework)
      );
    },
    getByStrategy(strategy) {
      return templates.filter(t => t.strategy === strategy);
    },
  };
}

// ============================================================================
// Template Matching Types
// ============================================================================

/**
 * Score for how well a template matches a task
 */
export interface TemplateMatchScore {
  /** The template */
  template: ApproachTemplate;
  /** Overall match score (0-1) */
  score: number;
  /** Breakdown of score components */
  breakdown: {
    /** Task type match (0-1) */
    taskType: number;
    /** Framework match (0-1) */
    framework: number;
    /** Keyword match (0-1) */
    keywords: number;
    /** Priority bonus (0-1) */
    priority: number;
  };
  /** Reasons for the score */
  reasons: string[];
}

/**
 * Options for template matching
 */
export interface TemplateMatchOptions {
  /** Minimum score to include (0-1) */
  minScore?: number;
  /** Maximum results */
  maxResults?: number;
  /** Boost templates matching these keywords */
  boostKeywords?: string[];
  /** Prefer templates with these strategies */
  preferStrategies?: ApproachStrategy[];
}

// ============================================================================
// Framework Detection Types
// ============================================================================

/**
 * Framework detection result
 */
export interface FrameworkDetection {
  /** Detected framework */
  framework: SupportedFramework;
  /** Confidence (0-1) */
  confidence: number;
  /** Evidence for detection */
  evidence: string[];
}

/**
 * Framework detection patterns
 */
export interface FrameworkPattern {
  /** Framework this pattern detects */
  framework: SupportedFramework;
  /** Language this framework belongs to */
  language: SupportedLanguage;
  /** File patterns that indicate this framework */
  filePatterns: string[];
  /** Import patterns that indicate this framework */
  importPatterns: string[];
  /** Config file patterns */
  configPatterns: string[];
  /** Package/dependency names */
  dependencies: string[];
}

/**
 * Framework detection patterns for all supported frameworks
 */
export const FRAMEWORK_PATTERNS: FrameworkPattern[] = [
  // TypeScript/JavaScript
  {
    framework: 'express',
    language: 'typescript',
    filePatterns: ['**/routes/**', '**/middleware/**'],
    importPatterns: ['express', '@types/express'],
    configPatterns: [],
    dependencies: ['express'],
  },
  {
    framework: 'nestjs',
    language: 'typescript',
    filePatterns: ['**/*.controller.ts', '**/*.module.ts', '**/*.service.ts'],
    importPatterns: ['@nestjs/common', '@nestjs/core'],
    configPatterns: ['nest-cli.json'],
    dependencies: ['@nestjs/core'],
  },
  {
    framework: 'nextjs',
    language: 'typescript',
    filePatterns: ['**/pages/**', '**/app/**', '**/api/**'],
    importPatterns: ['next', 'next/server'],
    configPatterns: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    dependencies: ['next'],
  },
  {
    framework: 'fastify',
    language: 'typescript',
    filePatterns: ['**/routes/**', '**/plugins/**'],
    importPatterns: ['fastify', '@fastify/*'],
    configPatterns: [],
    dependencies: ['fastify'],
  },
  // Python
  {
    framework: 'django',
    language: 'python',
    filePatterns: ['**/views.py', '**/models.py', '**/urls.py', '**/admin.py'],
    importPatterns: ['django', 'rest_framework'],
    configPatterns: ['manage.py', 'settings.py'],
    dependencies: ['django', 'djangorestframework'],
  },
  {
    framework: 'fastapi',
    language: 'python',
    filePatterns: ['**/routers/**', '**/routes/**'],
    importPatterns: ['fastapi', 'pydantic'],
    configPatterns: [],
    dependencies: ['fastapi', 'uvicorn'],
  },
  {
    framework: 'flask',
    language: 'python',
    filePatterns: ['**/routes/**', '**/blueprints/**'],
    importPatterns: ['flask', 'flask_*'],
    configPatterns: [],
    dependencies: ['flask'],
  },
  // Java
  {
    framework: 'spring-boot',
    language: 'java',
    filePatterns: ['**/*Controller.java', '**/*Service.java', '**/*Repository.java'],
    importPatterns: ['org.springframework', 'spring-boot'],
    configPatterns: ['application.properties', 'application.yml', 'pom.xml', 'build.gradle'],
    dependencies: ['spring-boot-starter'],
  },
  // C#
  {
    framework: 'aspnet-core',
    language: 'csharp',
    filePatterns: ['**/*Controller.cs', '**/Program.cs', '**/Startup.cs'],
    importPatterns: ['Microsoft.AspNetCore', 'Microsoft.Extensions'],
    configPatterns: ['appsettings.json', '*.csproj'],
    dependencies: ['Microsoft.AspNetCore'],
  },
  {
    framework: 'minimal-api',
    language: 'csharp',
    filePatterns: ['**/Program.cs', '**/Endpoints/**'],
    importPatterns: ['Microsoft.AspNetCore.Builder'],
    configPatterns: [],
    dependencies: ['Microsoft.AspNetCore'],
  },
  // PHP
  {
    framework: 'laravel',
    language: 'php',
    filePatterns: ['**/Controllers/**', '**/Models/**', '**/routes/**'],
    importPatterns: ['Illuminate\\', 'App\\'],
    configPatterns: ['artisan', 'composer.json'],
    dependencies: ['laravel/framework'],
  },
  {
    framework: 'symfony',
    language: 'php',
    filePatterns: ['**/Controller/**', '**/Entity/**'],
    importPatterns: ['Symfony\\', 'Doctrine\\'],
    configPatterns: ['symfony.lock', 'config/bundles.php'],
    dependencies: ['symfony/framework-bundle'],
  },
];
