/**
 * Config Loader - Configuration loading and merging
 *
 * Loads configuration from .drift/config.json and merges with defaults.
 * Supports environment variable overrides and handles missing config gracefully.
 *
 * @requirements 36.1 - THE Config_System SHALL read from .drift/config.json
 * @requirements 36.2 - THE Config_System SHALL support severity overrides per pattern
 * @requirements 36.3 - THE Config_System SHALL support ignore patterns for files/folders
 * @requirements 36.4 - THE Config_System SHALL support AI provider configuration
 * @requirements 36.5 - THE Config_System SHALL support CI mode settings
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { DEFAULT_CONFIG } from './defaults.js';

import type {
  DriftConfig,
  AIConfig,
  CIConfig,
  LearningConfig,
  PerformanceConfig,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Config file name */
const CONFIG_FILE = 'config.json';

/** Environment variable prefix for config overrides */
const ENV_PREFIX = 'DRIFT_';

/** Environment variable names for specific config options */
const ENV_VARS = {
  // AI configuration
  AI_PROVIDER: `${ENV_PREFIX}AI_PROVIDER`,
  AI_MODEL: `${ENV_PREFIX}AI_MODEL`,
  
  // CI configuration
  CI_FAIL_ON: `${ENV_PREFIX}CI_FAIL_ON`,
  CI_REPORT_FORMAT: `${ENV_PREFIX}CI_REPORT_FORMAT`,
  
  // Performance configuration
  MAX_WORKERS: `${ENV_PREFIX}MAX_WORKERS`,
  CACHE_ENABLED: `${ENV_PREFIX}CACHE_ENABLED`,
  INCREMENTAL_ANALYSIS: `${ENV_PREFIX}INCREMENTAL_ANALYSIS`,
  
  // Learning configuration
  AUTO_APPROVE_THRESHOLD: `${ENV_PREFIX}AUTO_APPROVE_THRESHOLD`,
  MIN_OCCURRENCES: `${ENV_PREFIX}MIN_OCCURRENCES`,
} as const;

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when configuration loading fails
 */
export class ConfigLoadError extends Error {
  public readonly filePath: string;
  public readonly errorCause: Error | undefined;

  constructor(
    message: string,
    filePath: string,
    errorCause?: Error | undefined
  ) {
    super(message);
    this.name = 'ConfigLoadError';
    this.filePath = filePath;
    this.errorCause = errorCause;
  }
}

/**
 * Error thrown when configuration parsing fails
 */
export class ConfigParseError extends Error {
  public readonly filePath: string;
  public readonly errorCause: Error | undefined;

  constructor(
    message: string,
    filePath: string,
    errorCause?: Error | undefined
  ) {
    super(message);
    this.name = 'ConfigParseError';
    this.filePath = filePath;
    this.errorCause = errorCause;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deep merge two objects, with source values overriding target values
 */
function deepMerge<T extends object>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (sourceValue === undefined) {
      continue;
    }

    if (
      isPlainObject(sourceValue) &&
      isPlainObject(targetValue)
    ) {
      (result as Record<string, unknown>)[key as string] = deepMerge(
        targetValue as object,
        sourceValue as object
      );
    } else {
      (result as Record<string, unknown>)[key as string] = sourceValue;
    }
  }

  return result;
}

/**
 * Check if a value is a plain object
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse a boolean from an environment variable string
 */
function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {return undefined;}
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') {return true;}
  if (lower === 'false' || lower === '0' || lower === 'no') {return false;}
  return undefined;
}

/**
 * Parse a number from an environment variable string
 */
function parseEnvNumber(value: string | undefined): number | undefined {
  if (value === undefined) {return undefined;}
  const num = parseFloat(value);
  return isNaN(num) ? undefined : num;
}

/**
 * Parse an integer from an environment variable string
 */
function parseEnvInteger(value: string | undefined): number | undefined {
  if (value === undefined) {return undefined;}
  const num = parseInt(value, 10);
  return isNaN(num) ? undefined : num;
}

// ============================================================================
// Config Loader Class
// ============================================================================

/**
 * Configuration loader options
 */
export interface ConfigLoaderOptions {
  /** Root directory to search for .drift/config.json */
  rootDir?: string | undefined;
  /** Whether to apply environment variable overrides */
  applyEnvOverrides?: boolean | undefined;
  /** Whether to validate the loaded configuration */
  validate?: boolean | undefined;
}

/**
 * Result of loading configuration
 */
export interface ConfigLoadResult {
  /** The loaded and merged configuration */
  config: DriftConfig;
  /** Path to the config file (if found) */
  configPath?: string | undefined;
  /** Whether the config file was found */
  configFileFound: boolean;
  /** Whether environment overrides were applied */
  envOverridesApplied: boolean;
}

/**
 * ConfigLoader - Loads and manages Drift configuration
 *
 * Handles loading configuration from .drift/config.json, merging with defaults,
 * and applying environment variable overrides.
 *
 * @requirements 36.1 - Read from .drift/config.json
 * @requirements 36.2 - Support severity overrides per pattern
 * @requirements 36.3 - Support ignore patterns for files/folders
 * @requirements 36.4 - Support AI provider configuration
 * @requirements 36.5 - Support CI mode settings
 */
export class ConfigLoader {
  private readonly rootDir: string;
  private readonly applyEnvOverrides: boolean;
  private cachedConfig: DriftConfig | null = null;
  private configPath: string;

  constructor(options: ConfigLoaderOptions = {}) {
    this.rootDir = options.rootDir ?? process.cwd();
    this.applyEnvOverrides = options.applyEnvOverrides ?? true;
    this.configPath = path.join(this.rootDir, DRIFT_DIR, CONFIG_FILE);
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  /**
   * Load configuration from file, merge with defaults, and apply env overrides
   *
   * @requirements 36.1 - Read from .drift/config.json
   *
   * @returns The loaded configuration result
   */
  async load(): Promise<ConfigLoadResult> {
    // Start with defaults
    let config = { ...DEFAULT_CONFIG };
    let configFileFound = false;
    let envOverridesApplied = false;

    // Try to load from file
    if (await fileExists(this.configPath)) {
      const fileConfig = await this.loadFromFile(this.configPath);
      config = this.mergeWithDefaults(fileConfig);
      configFileFound = true;
    }

    // Apply environment variable overrides
    if (this.applyEnvOverrides) {
      const envConfig = this.getEnvOverrides();
      if (Object.keys(envConfig).length > 0) {
        config = this.mergeWithDefaults(envConfig, config);
        envOverridesApplied = true;
      }
    }

    // Cache the config
    this.cachedConfig = config;

    return {
      config,
      configPath: configFileFound ? this.configPath : undefined,
      configFileFound,
      envOverridesApplied,
    };
  }

  /**
   * Get the cached configuration, loading if necessary
   *
   * @returns The configuration
   */
  async getConfig(): Promise<DriftConfig> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }
    const result = await this.load();
    return result.config;
  }

  /**
   * Reload configuration from disk
   *
   * @returns The reloaded configuration result
   */
  async reload(): Promise<ConfigLoadResult> {
    this.cachedConfig = null;
    return this.load();
  }

  /**
   * Check if a config file exists
   *
   * @returns True if config file exists
   */
  async configFileExists(): Promise<boolean> {
    return fileExists(this.configPath);
  }

  /**
   * Get the path to the config file
   *
   * @returns The config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Save configuration to file
   *
   * @param config - Configuration to save
   */
  async save(config: DriftConfig): Promise<void> {
    // Ensure .drift directory exists
    const driftDir = path.dirname(this.configPath);
    await fs.mkdir(driftDir, { recursive: true });

    // Write config file
    await fs.writeFile(
      this.configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    // Update cache
    this.cachedConfig = config;
  }

  /**
   * Clear the cached configuration
   */
  clearCache(): void {
    this.cachedConfig = null;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Load configuration from a JSON file
   *
   * @param filePath - Path to the config file
   * @returns The parsed configuration
   */
  private async loadFromFile(filePath: string): Promise<Partial<DriftConfig>> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      try {
        const parsed = JSON.parse(content);
        
        if (!isPlainObject(parsed)) {
          throw new ConfigParseError(
            'Configuration must be a JSON object',
            filePath
          );
        }
        
        return parsed as Partial<DriftConfig>;
      } catch (parseError) {
        if (parseError instanceof ConfigParseError) {
          throw parseError;
        }
        throw new ConfigParseError(
          `Failed to parse configuration file: ${(parseError as Error).message}`,
          filePath,
          parseError as Error
        );
      }
    } catch (error) {
      if (error instanceof ConfigParseError) {
        throw error;
      }
      throw new ConfigLoadError(
        `Failed to read configuration file: ${(error as Error).message}`,
        filePath,
        error as Error
      );
    }
  }

  /**
   * Merge loaded configuration with defaults
   *
   * @param loaded - Loaded configuration
   * @param base - Base configuration (defaults to DEFAULT_CONFIG)
   * @returns Merged configuration
   */
  private mergeWithDefaults(
    loaded: Partial<DriftConfig>,
    base: DriftConfig = DEFAULT_CONFIG
  ): DriftConfig {
    return deepMerge(base, loaded);
  }

  /**
   * Get configuration overrides from environment variables
   *
   * @returns Configuration overrides from environment
   */
  private getEnvOverrides(): Partial<DriftConfig> {
    const overrides: Partial<DriftConfig> = {};

    // AI configuration overrides
    const aiOverrides = this.getAIEnvOverrides();
    if (Object.keys(aiOverrides).length > 0) {
      overrides.ai = aiOverrides as AIConfig;
    }

    // CI configuration overrides
    const ciOverrides = this.getCIEnvOverrides();
    if (Object.keys(ciOverrides).length > 0) {
      overrides.ci = ciOverrides as CIConfig;
    }

    // Performance configuration overrides
    const perfOverrides = this.getPerformanceEnvOverrides();
    if (Object.keys(perfOverrides).length > 0) {
      overrides.performance = perfOverrides as PerformanceConfig;
    }

    // Learning configuration overrides
    const learningOverrides = this.getLearningEnvOverrides();
    if (Object.keys(learningOverrides).length > 0) {
      overrides.learning = learningOverrides as LearningConfig;
    }

    return overrides;
  }

  /**
   * Get AI configuration overrides from environment
   */
  private getAIEnvOverrides(): Partial<AIConfig> {
    const overrides: Partial<AIConfig> = {};

    const provider = process.env[ENV_VARS.AI_PROVIDER];
    if (provider && ['openai', 'anthropic', 'ollama'].includes(provider)) {
      overrides.provider = provider as AIConfig['provider'];
    }

    const model = process.env[ENV_VARS.AI_MODEL];
    if (model) {
      overrides.model = model;
    }

    return overrides;
  }

  /**
   * Get CI configuration overrides from environment
   */
  private getCIEnvOverrides(): Partial<CIConfig> {
    const overrides: Partial<CIConfig> = {};

    const failOn = process.env[ENV_VARS.CI_FAIL_ON];
    if (failOn && ['error', 'warning', 'none'].includes(failOn)) {
      overrides.failOn = failOn as CIConfig['failOn'];
    }

    const reportFormat = process.env[ENV_VARS.CI_REPORT_FORMAT];
    if (reportFormat && ['json', 'text', 'github', 'gitlab'].includes(reportFormat)) {
      overrides.reportFormat = reportFormat as CIConfig['reportFormat'];
    }

    return overrides;
  }

  /**
   * Get performance configuration overrides from environment
   */
  private getPerformanceEnvOverrides(): Partial<PerformanceConfig> {
    const overrides: Partial<PerformanceConfig> = {};

    const maxWorkers = parseEnvInteger(process.env[ENV_VARS.MAX_WORKERS]);
    if (maxWorkers !== undefined && maxWorkers > 0) {
      overrides.maxWorkers = maxWorkers;
    }

    const cacheEnabled = parseEnvBoolean(process.env[ENV_VARS.CACHE_ENABLED]);
    if (cacheEnabled !== undefined) {
      overrides.cacheEnabled = cacheEnabled;
    }

    const incrementalAnalysis = parseEnvBoolean(process.env[ENV_VARS.INCREMENTAL_ANALYSIS]);
    if (incrementalAnalysis !== undefined) {
      overrides.incrementalAnalysis = incrementalAnalysis;
    }

    return overrides;
  }

  /**
   * Get learning configuration overrides from environment
   */
  private getLearningEnvOverrides(): Partial<LearningConfig> {
    const overrides: Partial<LearningConfig> = {};

    const autoApproveThreshold = parseEnvNumber(process.env[ENV_VARS.AUTO_APPROVE_THRESHOLD]);
    if (autoApproveThreshold !== undefined && autoApproveThreshold >= 0 && autoApproveThreshold <= 1) {
      overrides.autoApproveThreshold = autoApproveThreshold;
    }

    const minOccurrences = parseEnvInteger(process.env[ENV_VARS.MIN_OCCURRENCES]);
    if (minOccurrences !== undefined && minOccurrences > 0) {
      overrides.minOccurrences = minOccurrences;
    }

    return overrides;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Load configuration with default options
 *
 * @param rootDir - Root directory to search for config
 * @returns The loaded configuration
 */
export async function loadConfig(rootDir?: string): Promise<DriftConfig> {
  const options: ConfigLoaderOptions = {};
  if (rootDir !== undefined) {
    options.rootDir = rootDir;
  }
  const loader = new ConfigLoader(options);
  const result = await loader.load();
  return result.config;
}

/**
 * Load configuration and return full result
 *
 * @param rootDir - Root directory to search for config
 * @returns The configuration load result
 */
export async function loadConfigWithResult(rootDir?: string): Promise<ConfigLoadResult> {
  const options: ConfigLoaderOptions = {};
  if (rootDir !== undefined) {
    options.rootDir = rootDir;
  }
  const loader = new ConfigLoader(options);
  return loader.load();
}
