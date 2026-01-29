/**
 * Project Config - Enhanced project-level configuration
 *
 * Extends the basic .drift/config.json with project identification
 * and metadata that links to the global registry.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ============================================================================
// Types
// ============================================================================

/**
 * CI/CD configuration
 */
export interface CIConfig {
  /** Severity level that causes CI failure */
  failOn: 'error' | 'warning' | 'info' | 'none';
  /** Report format for CI output */
  reportFormat: 'text' | 'json' | 'sarif' | 'github';
  /** Upload results to dashboard */
  uploadResults?: boolean;
}

/**
 * Learning configuration
 */
export interface LearningConfig {
  /** Confidence threshold for auto-approval */
  autoApproveThreshold: number;
  /** Minimum occurrences before pattern is considered */
  minOccurrences: number;
  /** Enable semantic learning */
  semanticLearning?: boolean;
}

/**
 * Performance configuration
 */
export interface PerformanceConfig {
  /** Maximum parallel workers */
  maxWorkers: number;
  /** Enable caching */
  cacheEnabled: boolean;
  /** Enable incremental analysis */
  incrementalAnalysis: boolean;
  /** Cache TTL in seconds */
  cacheTTL?: number;
}

/**
 * Telemetry configuration - privacy-first, opt-in only
 */
export interface TelemetryConfig {
  /** Master switch - telemetry completely disabled if false */
  enabled: boolean;
  /** Share anonymized pattern signatures (hash + category + confidence) */
  sharePatternSignatures: boolean;
  /** Share aggregate statistics (counts, no identifying info) */
  shareAggregateStats: boolean;
  /** Share user actions (approve/ignore decisions, no code) */
  shareUserActions: boolean;
  /** Unique installation ID (generated on opt-in, not tied to identity) */
  installationId?: string;
  /** When telemetry was enabled */
  enabledAt?: string;
}

/**
 * Project metadata
 */
export interface ProjectMetadata {
  /** Unique project ID (matches registry) */
  id: string;
  /** Project display name */
  name: string;
  /** Project description */
  description?: string | undefined;
  /** Project version */
  version?: string | undefined;
  /** Team or owner */
  team?: string | undefined;
  /** Custom tags */
  tags?: string[] | undefined;
  /** When drift was initialized */
  initializedAt: string;
}

/**
 * Full project configuration
 */
export interface ProjectConfig {
  /** Config schema version */
  version: string;
  /** Project metadata */
  project: ProjectMetadata;
  /** Severity overrides by pattern category */
  severity: Record<string, string>;
  /**
   * Glob patterns to include (allowlist).
   * If specified, ONLY these directories/files will be scanned.
   * Takes precedence over ignore patterns.
   */
  include?: string[];
  /** Glob patterns to ignore (denylist) */
  ignore: string[];
  /** CI/CD settings */
  ci: CIConfig;
  /** Learning settings */
  learning: LearningConfig;
  /** Performance settings */
  performance: PerformanceConfig;
  /** Custom detector settings */
  detectors?: Record<string, Record<string, unknown>>;
  /** Feature flags */
  features?: {
    callGraph?: boolean;
    boundaries?: boolean;
    dna?: boolean;
    contracts?: boolean;
  };
  /** Telemetry settings (opt-in, privacy-first) */
  telemetry?: TelemetryConfig;
}

/**
 * Legacy config format (without project metadata)
 */
export interface LegacyConfig {
  version: string;
  severity: Record<string, string>;
  ignore: string[];
  ci: CIConfig;
  learning: LearningConfig;
  performance: PerformanceConfig;
}

// ============================================================================
// Constants
// ============================================================================

const CONFIG_VERSION = '2.0.0';
const DRIFT_DIR = '.drift';
const CONFIG_FILE = 'config.json';

// ============================================================================
// Default Configuration
// ============================================================================

export function createDefaultConfig(
  projectPath: string,
  options?: Partial<ProjectMetadata>
): ProjectConfig {
  const now = new Date().toISOString();

  return {
    version: CONFIG_VERSION,
    project: {
      id: options?.id ?? crypto.randomUUID(),
      name: options?.name ?? path.basename(projectPath),
      description: options?.description,
      tags: options?.tags,
      initializedAt: now,
    },
    severity: {},
    // include is undefined by default - when set, ONLY these paths are scanned
    ignore: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.git/**',
      'coverage/**',
      '*.min.js',
      '*.bundle.js',
      'vendor/**',
      '__pycache__/**',
      '.venv/**',
      'target/**',
      'bin/**',
      'obj/**',
    ],
    ci: {
      failOn: 'error',
      reportFormat: 'text',
    },
    learning: {
      autoApproveThreshold: 0.95,
      minOccurrences: 3,
      semanticLearning: true,
    },
    performance: {
      maxWorkers: 4,
      cacheEnabled: true,
      incrementalAnalysis: true,
      cacheTTL: 3600,
    },
    features: {
      callGraph: true,
      boundaries: true,
      dna: true,
      contracts: true,
    },
  };
}

// ============================================================================
// Config Manager
// ============================================================================

export class ProjectConfigManager {
  private readonly configPath: string;
  private config: ProjectConfig | null = null;

  constructor(projectRoot: string) {
    this.configPath = path.join(projectRoot, DRIFT_DIR, CONFIG_FILE);
  }

  /**
   * Load configuration from disk
   */
  async load(): Promise<ProjectConfig> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const data = JSON.parse(content);

      // Check if legacy format
      if (!data.project) {
        // Migrate legacy config
        this.config = this.migrateLegacyConfig(data);
        await this.save();
      } else {
        this.config = data as ProjectConfig;
      }

      return this.config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Config not found. Run 'drift init' first.`);
      }
      throw error;
    }
  }

  /**
   * Save configuration to disk
   */
  async save(): Promise<void> {
    if (!this.config) {
      throw new Error('No config loaded');
    }

    await fs.writeFile(
      this.configPath,
      JSON.stringify(this.config, null, 2)
    );
  }

  /**
   * Get current configuration
   */
  get(): ProjectConfig {
    if (!this.config) {
      throw new Error('Config not loaded. Call load() first.');
    }
    return this.config;
  }

  /**
   * Get project ID
   */
  getProjectId(): string {
    return this.get().project.id;
  }

  /**
   * Get project name
   */
  getProjectName(): string {
    return this.get().project.name;
  }

  /**
   * Update configuration
   */
  async update(updates: Partial<ProjectConfig>): Promise<ProjectConfig> {
    if (!this.config) {
      throw new Error('Config not loaded. Call load() first.');
    }

    this.config = {
      ...this.config,
      ...updates,
      version: this.config.version,
      project: {
        ...this.config.project,
        ...(updates.project ?? {}),
        id: this.config.project.id, // ID cannot be changed
        initializedAt: this.config.project.initializedAt,
      },
    };

    await this.save();
    return this.config;
  }

  /**
   * Update project metadata
   */
  async updateMetadata(
    updates: Partial<Omit<ProjectMetadata, 'id' | 'initializedAt'>>
  ): Promise<ProjectMetadata> {
    const config = await this.update({
      project: {
        ...this.config!.project,
        ...updates,
      },
    });
    return config.project;
  }

  /**
   * Check if config exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize new configuration
   */
  async initialize(
    projectRoot: string,
    options?: Partial<ProjectMetadata>
  ): Promise<ProjectConfig> {
    this.config = createDefaultConfig(projectRoot, options);
    await this.save();
    return this.config;
  }

  /**
   * Migrate legacy config to new format
   */
  private migrateLegacyConfig(legacy: LegacyConfig): ProjectConfig {
    const projectRoot = path.dirname(path.dirname(this.configPath));

    return {
      version: CONFIG_VERSION,
      project: {
        id: crypto.randomUUID(),
        name: path.basename(projectRoot),
        initializedAt: new Date().toISOString(),
      },
      severity: legacy.severity ?? {},
      ignore: legacy.ignore ?? [],
      ci: legacy.ci ?? { failOn: 'error', reportFormat: 'text' },
      learning: legacy.learning ?? {
        autoApproveThreshold: 0.95,
        minOccurrences: 3,
      },
      performance: legacy.performance ?? {
        maxWorkers: 4,
        cacheEnabled: true,
        incrementalAnalysis: true,
      },
      features: {
        callGraph: true,
        boundaries: true,
        dna: true,
        contracts: true,
      },
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a project config manager
 */
export function createProjectConfigManager(
  projectRoot: string
): ProjectConfigManager {
  return new ProjectConfigManager(projectRoot);
}

/**
 * Load project config (convenience function)
 */
export async function loadProjectConfig(
  projectRoot: string
): Promise<ProjectConfig> {
  const manager = new ProjectConfigManager(projectRoot);
  return manager.load();
}
