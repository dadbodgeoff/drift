/**
 * Project Registry - Central index of all drift-initialized projects
 *
 * Maintains a global registry at ~/.drift/registry.json that tracks
 * all projects where drift has been initialized. Enables multi-project
 * workflows, project switching, and cross-project analysis.
 *
 * @requirements
 * - Store project metadata in user home directory
 * - Auto-register projects on drift init
 * - Support project listing, switching, and removal
 * - Track last accessed timestamps for MRU ordering
 */

import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// ============================================================================
// Types
// ============================================================================

/**
 * Detected project framework/language
 */
export type ProjectFramework =
  | 'react'
  | 'vue'
  | 'angular'
  | 'nextjs'
  | 'express'
  | 'fastapi'
  | 'django'
  | 'flask'
  | 'spring'
  | 'aspnet'
  | 'laravel'
  | 'rails'
  | 'unknown';

/**
 * Primary language of the project
 */
export type ProjectLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'java'
  | 'csharp'
  | 'php'
  | 'ruby'
  | 'go'
  | 'rust'
  | 'mixed'
  | 'unknown';

/**
 * Project health status
 */
export type ProjectHealth = 'healthy' | 'warning' | 'critical' | 'unknown';

/**
 * Registered project entry
 */
export interface RegisteredProject {
  /** Unique project identifier (UUID) */
  id: string;
  /** User-friendly project name */
  name: string;
  /** Absolute path to project root */
  path: string;
  /** Primary language */
  language: ProjectLanguage;
  /** Detected framework */
  framework: ProjectFramework;
  /** When project was first registered */
  registeredAt: string;
  /** When project was last accessed via drift */
  lastAccessedAt: string;
  /** Last scan timestamp */
  lastScanAt?: string | undefined;
  /** Pattern counts by status */
  patternCounts?: {
    discovered: number;
    approved: number;
    ignored: number;
  } | undefined;
  /** Overall health score (0-100) */
  healthScore?: number | undefined;
  /** Health status */
  health?: ProjectHealth | undefined;
  /** Custom tags for organization */
  tags?: string[] | undefined;
  /** Project description */
  description?: string | undefined;
  /** Git remote URL if available */
  gitRemote?: string | undefined;
  /** Whether project path still exists */
  isValid?: boolean | undefined;
}

/**
 * Registry file structure
 */
export interface ProjectRegistryFile {
  version: string;
  lastUpdated: string;
  activeProjectId?: string | undefined;
  projects: RegisteredProject[];
}

/**
 * Registry configuration
 */
export interface ProjectRegistryConfig {
  /** Custom registry path (default: ~/.drift/registry.json) */
  registryPath?: string;
  /** Auto-validate project paths on load */
  validateOnLoad?: boolean;
  /** Remove invalid projects automatically */
  autoCleanup?: boolean;
}

/**
 * Project registration options
 */
export interface ProjectRegistrationOptions {
  /** Custom project name (default: directory name) */
  name?: string | undefined;
  /** Project description */
  description?: string | undefined;
  /** Custom tags */
  tags?: string[] | undefined;
  /** Override detected language */
  language?: ProjectLanguage | undefined;
  /** Override detected framework */
  framework?: ProjectFramework | undefined;
}

/**
 * Registry event types
 */
export type RegistryEventType =
  | 'project:registered'
  | 'project:updated'
  | 'project:removed'
  | 'project:activated'
  | 'registry:loaded'
  | 'registry:saved';

export interface RegistryEvent {
  type: RegistryEventType;
  timestamp: string;
  projectId?: string | undefined;
  projectName?: string | undefined;
}

// ============================================================================
// Constants
// ============================================================================

const REGISTRY_VERSION = '1.0.0';
const DRIFT_HOME_DIR = '.drift';
const REGISTRY_FILE = 'registry.json';

const DEFAULT_CONFIG: Required<ProjectRegistryConfig> = {
  registryPath: path.join(os.homedir(), DRIFT_HOME_DIR, REGISTRY_FILE),
  validateOnLoad: true,
  autoCleanup: false,
};

// ============================================================================
// Detection Helpers
// ============================================================================

/**
 * Detect project language from files
 */
async function detectLanguage(projectPath: string): Promise<ProjectLanguage> {
  const indicators: Array<{ file: string; language: ProjectLanguage }> = [
    { file: 'tsconfig.json', language: 'typescript' },
    { file: 'package.json', language: 'javascript' }, // Will be overridden by tsconfig
    { file: 'requirements.txt', language: 'python' },
    { file: 'pyproject.toml', language: 'python' },
    { file: 'pom.xml', language: 'java' },
    { file: 'build.gradle', language: 'java' },
    { file: '*.csproj', language: 'csharp' },
    { file: '*.sln', language: 'csharp' },
    { file: 'composer.json', language: 'php' },
    { file: 'Gemfile', language: 'ruby' },
    { file: 'go.mod', language: 'go' },
    { file: 'Cargo.toml', language: 'rust' },
  ];

  const detected: ProjectLanguage[] = [];

  for (const { file, language } of indicators) {
    try {
      if (file.includes('*')) {
        // Glob pattern - check directory
        const files = await fs.readdir(projectPath);
        const ext = file.replace('*', '');
        if (files.some(f => f.endsWith(ext))) {
          detected.push(language);
        }
      } else {
        await fs.access(path.join(projectPath, file));
        detected.push(language);
      }
    } catch {
      // File doesn't exist
    }
  }

  // TypeScript takes precedence over JavaScript
  if (detected.includes('typescript')) {
    return 'typescript';
  }

  if (detected.length === 0) {
    return 'unknown';
  }

  if (detected.length === 1) {
    return detected[0]!;
  }

  return 'mixed';
}

/**
 * Detect project framework from files and dependencies
 */
async function detectFramework(projectPath: string): Promise<ProjectFramework> {
  // Check package.json for JS frameworks
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['next']) {return 'nextjs';}
    if (deps['react']) {return 'react';}
    if (deps['vue']) {return 'vue';}
    if (deps['@angular/core']) {return 'angular';}
    if (deps['express']) {return 'express';}
  } catch {
    // No package.json
  }

  // Check Python frameworks
  try {
    const reqPath = path.join(projectPath, 'requirements.txt');
    const content = await fs.readFile(reqPath, 'utf-8');
    if (content.includes('fastapi')) {return 'fastapi';}
    if (content.includes('django')) {return 'django';}
    if (content.includes('flask')) {return 'flask';}
  } catch {
    // No requirements.txt
  }

  // Check for Spring (Java)
  try {
    const pomPath = path.join(projectPath, 'pom.xml');
    const content = await fs.readFile(pomPath, 'utf-8');
    if (content.includes('spring-boot')) {return 'spring';}
  } catch {
    // No pom.xml
  }

  // Check for ASP.NET
  try {
    const files = await fs.readdir(projectPath);
    for (const file of files) {
      if (file.endsWith('.csproj')) {
        const content = await fs.readFile(path.join(projectPath, file), 'utf-8');
        if (content.includes('Microsoft.AspNetCore')) {return 'aspnet';}
      }
    }
  } catch {
    // No csproj
  }

  // Check for Laravel
  try {
    await fs.access(path.join(projectPath, 'artisan'));
    return 'laravel';
  } catch {
    // No artisan
  }

  // Check for Rails
  try {
    await fs.access(path.join(projectPath, 'config', 'routes.rb'));
    return 'rails';
  } catch {
    // No routes.rb
  }

  return 'unknown';
}

/**
 * Get git remote URL if available
 */
async function getGitRemote(projectPath: string): Promise<string | undefined> {
  try {
    const configPath = path.join(projectPath, '.git', 'config');
    const content = await fs.readFile(configPath, 'utf-8');
    const match = content.match(/url\s*=\s*(.+)/);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

// ============================================================================
// Project Registry Class
// ============================================================================

/**
 * Project Registry - Manages multi-project drift installations
 */
export class ProjectRegistry extends EventEmitter {
  private readonly config: Required<ProjectRegistryConfig>;
  private projects: Map<string, RegisteredProject> = new Map();
  private activeProjectId?: string | undefined;

  constructor(config: ProjectRegistryConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the registry (load from disk)
   */
  async initialize(): Promise<void> {
    await this.ensureRegistryDir();
    await this.load();
  }

  /**
   * Ensure ~/.drift directory exists
   */
  private async ensureRegistryDir(): Promise<void> {
    const dir = path.dirname(this.config.registryPath);
    await fs.mkdir(dir, { recursive: true });
  }

  // ==========================================================================
  // Loading & Saving
  // ==========================================================================

  /**
   * Load registry from disk
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.config.registryPath, 'utf-8');
      const data = JSON.parse(content) as ProjectRegistryFile;

      this.projects.clear();
      for (const project of data.projects) {
        // Validate path if enabled
        if (this.config.validateOnLoad) {
          project.isValid = await this.validateProjectPath(project.path);
        }
        this.projects.set(project.id, project);
      }

      this.activeProjectId = data.activeProjectId;

      // Auto-cleanup invalid projects
      if (this.config.autoCleanup) {
        const invalid = Array.from(this.projects.values()).filter(p => !p.isValid);
        for (const project of invalid) {
          this.projects.delete(project.id);
        }
        if (invalid.length > 0) {
          await this.save();
        }
      }

      this.emitEvent('registry:loaded');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Registry doesn't exist yet - that's fine
        return;
      }
      throw error;
    }
  }

  /**
   * Save registry to disk
   */
  async save(): Promise<void> {
    const data: ProjectRegistryFile = {
      version: REGISTRY_VERSION,
      lastUpdated: new Date().toISOString(),
      projects: Array.from(this.projects.values()),
    };
    
    // Only include activeProjectId if it's set
    if (this.activeProjectId) {
      data.activeProjectId = this.activeProjectId;
    }

    await fs.writeFile(
      this.config.registryPath,
      JSON.stringify(data, null, 2)
    );

    this.emitEvent('registry:saved');
  }

  /**
   * Validate that a project path exists and has .drift folder
   */
  private async validateProjectPath(projectPath: string): Promise<boolean> {
    try {
      await fs.access(path.join(projectPath, '.drift'));
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Project Registration
  // ==========================================================================

  /**
   * Register a new project
   */
  async register(
    projectPath: string,
    options: ProjectRegistrationOptions = {}
  ): Promise<RegisteredProject> {
    const absolutePath = path.resolve(projectPath);

    // Check if already registered
    const existing = this.findByPath(absolutePath);
    if (existing) {
      // Update last accessed and return
      return this.updateLastAccessed(existing.id);
    }

    // Detect project info
    const [detectedLanguage, detectedFramework, gitRemote] = await Promise.all([
      detectLanguage(absolutePath),
      detectFramework(absolutePath),
      getGitRemote(absolutePath),
    ]);

    const language = options.language ?? detectedLanguage;
    const framework = options.framework ?? detectedFramework;

    const now = new Date().toISOString();
    const project: RegisteredProject = {
      id: crypto.randomUUID(),
      name: options.name ?? path.basename(absolutePath),
      path: absolutePath,
      language,
      framework,
      registeredAt: now,
      lastAccessedAt: now,
      tags: options.tags,
      description: options.description,
      gitRemote,
      isValid: true,
    };

    this.projects.set(project.id, project);
    await this.save();

    this.emitEvent('project:registered', project.id, project.name);
    return project;
  }

  /**
   * Update project metadata
   */
  async update(
    projectId: string,
    updates: Partial<Omit<RegisteredProject, 'id' | 'registeredAt'>>
  ): Promise<RegisteredProject> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const updated: RegisteredProject = {
      ...project,
      ...updates,
      id: project.id,
      registeredAt: project.registeredAt,
    };

    this.projects.set(projectId, updated);
    await this.save();

    this.emitEvent('project:updated', projectId, updated.name);
    return updated;
  }

  /**
   * Update last accessed timestamp
   */
  async updateLastAccessed(projectId: string): Promise<RegisteredProject> {
    return this.update(projectId, {
      lastAccessedAt: new Date().toISOString(),
    });
  }

  /**
   * Update pattern counts for a project
   */
  async updatePatternCounts(
    projectId: string,
    counts: { discovered: number; approved: number; ignored: number }
  ): Promise<RegisteredProject> {
    return this.update(projectId, { patternCounts: counts });
  }

  /**
   * Update health score for a project
   */
  async updateHealth(
    projectId: string,
    healthScore: number
  ): Promise<RegisteredProject> {
    let health: ProjectHealth = 'unknown';
    if (healthScore >= 80) {health = 'healthy';}
    else if (healthScore >= 50) {health = 'warning';}
    else if (healthScore >= 0) {health = 'critical';}

    return this.update(projectId, { healthScore, health });
  }

  /**
   * Remove a project from registry
   */
  async remove(projectId: string): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project) {
      return false;
    }

    this.projects.delete(projectId);

    // Clear active if it was this project
    if (this.activeProjectId === projectId) {
      this.activeProjectId = undefined;
    }

    await this.save();
    this.emitEvent('project:removed', projectId, project.name);
    return true;
  }

  // ==========================================================================
  // Project Activation
  // ==========================================================================

  /**
   * Set the active project
   */
  async setActive(projectId: string): Promise<RegisteredProject> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    this.activeProjectId = projectId;
    await this.updateLastAccessed(projectId);

    this.emitEvent('project:activated', projectId, project.name);
    return project;
  }

  /**
   * Get the active project
   */
  getActive(): RegisteredProject | undefined {
    if (!this.activeProjectId) {return undefined;}
    return this.projects.get(this.activeProjectId);
  }

  /**
   * Clear active project
   */
  async clearActive(): Promise<void> {
    this.activeProjectId = undefined;
    await this.save();
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  /**
   * Get a project by ID
   */
  get(projectId: string): RegisteredProject | undefined {
    return this.projects.get(projectId);
  }

  /**
   * Find project by path
   */
  findByPath(projectPath: string): RegisteredProject | undefined {
    const absolutePath = path.resolve(projectPath);
    return Array.from(this.projects.values()).find(
      p => p.path === absolutePath
    );
  }

  /**
   * Find project by name
   */
  findByName(name: string): RegisteredProject | undefined {
    const nameLower = name.toLowerCase();
    return Array.from(this.projects.values()).find(
      p => p.name.toLowerCase() === nameLower
    );
  }

  /**
   * Get all projects
   */
  getAll(): RegisteredProject[] {
    return Array.from(this.projects.values());
  }

  /**
   * Get projects sorted by last accessed (MRU)
   */
  getRecent(limit?: number): RegisteredProject[] {
    const sorted = Array.from(this.projects.values()).sort(
      (a, b) =>
        new Date(b.lastAccessedAt).getTime() -
        new Date(a.lastAccessedAt).getTime()
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Get projects by language
   */
  getByLanguage(language: ProjectLanguage): RegisteredProject[] {
    return Array.from(this.projects.values()).filter(
      p => p.language === language
    );
  }

  /**
   * Get projects by framework
   */
  getByFramework(framework: ProjectFramework): RegisteredProject[] {
    return Array.from(this.projects.values()).filter(
      p => p.framework === framework
    );
  }

  /**
   * Get projects by tag
   */
  getByTag(tag: string): RegisteredProject[] {
    return Array.from(this.projects.values()).filter(
      p => p.tags?.includes(tag)
    );
  }

  /**
   * Get valid projects only
   */
  getValid(): RegisteredProject[] {
    return Array.from(this.projects.values()).filter(p => p.isValid !== false);
  }

  /**
   * Search projects by name or path
   */
  search(query: string): RegisteredProject[] {
    const queryLower = query.toLowerCase();
    return Array.from(this.projects.values()).filter(
      p =>
        p.name.toLowerCase().includes(queryLower) ||
        p.path.toLowerCase().includes(queryLower) ||
        p.description?.toLowerCase().includes(queryLower)
    );
  }

  /**
   * Get project count
   */
  get count(): number {
    return this.projects.size;
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate all project paths
   */
  async validateAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [id, project] of this.projects) {
      const isValid = await this.validateProjectPath(project.path);
      results.set(id, isValid);
      project.isValid = isValid;
    }

    await this.save();
    return results;
  }

  /**
   * Remove all invalid projects
   */
  async cleanup(): Promise<string[]> {
    await this.validateAll();

    const removed: string[] = [];
    for (const [id, project] of this.projects) {
      if (!project.isValid) {
        this.projects.delete(id);
        removed.push(project.name);
      }
    }

    if (removed.length > 0) {
      await this.save();
    }

    return removed;
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  private emitEvent(
    type: RegistryEventType,
    projectId?: string,
    projectName?: string
  ): void {
    const event: RegistryEvent = {
      type,
      timestamp: new Date().toISOString(),
    };
    
    if (projectId !== undefined) {
      event.projectId = projectId;
    }
    if (projectName !== undefined) {
      event.projectName = projectName;
    }
    
    this.emit(type, event);
    this.emit('*', event);
  }
}

// ============================================================================
// Factory & Singleton
// ============================================================================

let globalRegistry: ProjectRegistry | null = null;

/**
 * Get the global project registry instance
 */
export async function getProjectRegistry(
  config?: ProjectRegistryConfig
): Promise<ProjectRegistry> {
  if (!globalRegistry) {
    globalRegistry = new ProjectRegistry(config);
    await globalRegistry.initialize();
  }
  return globalRegistry;
}

/**
 * Create a new project registry instance
 */
export function createProjectRegistry(
  config?: ProjectRegistryConfig
): ProjectRegistry {
  return new ProjectRegistry(config);
}
