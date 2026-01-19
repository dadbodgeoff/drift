/**
 * Config Loader Tests
 *
 * Tests for configuration loading, merging with defaults,
 * and environment variable overrides.
 *
 * @requirements 36.1, 36.2, 36.3, 36.4, 36.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  ConfigLoader,
  ConfigLoadError,
  ConfigParseError,
  loadConfig,
  loadConfigWithResult,
} from './config-loader.js';
import { DEFAULT_CONFIG } from './defaults.js';
import type { DriftConfig } from './types.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
async function createTempDir(): Promise<string> {
  const tempDir = path.join(os.tmpdir(), `drift-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Clean up a temporary directory
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a .drift/config.json file in the given directory
 */
async function createConfigFile(rootDir: string, config: Partial<DriftConfig>): Promise<string> {
  const driftDir = path.join(rootDir, '.drift');
  await fs.mkdir(driftDir, { recursive: true });
  const configPath = path.join(driftDir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

// ============================================================================
// Tests
// ============================================================================

describe('ConfigLoader', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tempDir = await createTempDir();
    // Clear relevant env vars
    delete process.env.DRIFT_AI_PROVIDER;
    delete process.env.DRIFT_AI_MODEL;
    delete process.env.DRIFT_CI_FAIL_ON;
    delete process.env.DRIFT_CI_REPORT_FORMAT;
    delete process.env.DRIFT_MAX_WORKERS;
    delete process.env.DRIFT_CACHE_ENABLED;
    delete process.env.DRIFT_INCREMENTAL_ANALYSIS;
    delete process.env.DRIFT_AUTO_APPROVE_THRESHOLD;
    delete process.env.DRIFT_MIN_OCCURRENCES;
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    // Restore env vars
    process.env = { ...originalEnv };
  });

  describe('constructor', () => {
    it('should use current working directory by default', () => {
      const loader = new ConfigLoader();
      expect(loader.getConfigPath()).toContain('.drift');
      expect(loader.getConfigPath()).toContain('config.json');
    });

    it('should use provided root directory', () => {
      const loader = new ConfigLoader({ rootDir: tempDir });
      expect(loader.getConfigPath()).toBe(path.join(tempDir, '.drift', 'config.json'));
    });
  });

  describe('load()', () => {
    /**
     * @requirements 36.1 - THE Config_System SHALL read from .drift/config.json
     */
    it('should return defaults when no config file exists', async () => {
      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.configFileFound).toBe(false);
      expect(result.configPath).toBeUndefined();
      expect(result.config).toEqual(DEFAULT_CONFIG);
    });

    /**
     * @requirements 36.1 - THE Config_System SHALL read from .drift/config.json
     */
    it('should load config from .drift/config.json', async () => {
      const customConfig: Partial<DriftConfig> = {
        ignore: ['custom-ignore'],
      };
      await createConfigFile(tempDir, customConfig);

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.configFileFound).toBe(true);
      expect(result.configPath).toBe(path.join(tempDir, '.drift', 'config.json'));
      expect(result.config.ignore).toEqual(['custom-ignore']);
    });

    /**
     * @requirements 36.2 - THE Config_System SHALL support severity overrides per pattern
     */
    it('should load severity overrides', async () => {
      const customConfig: Partial<DriftConfig> = {
        severity: {
          'pattern-1': 'error',
          'pattern-2': 'warning',
        },
      };
      await createConfigFile(tempDir, customConfig);

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.severity).toEqual({
        'pattern-1': 'error',
        'pattern-2': 'warning',
      });
    });

    /**
     * @requirements 36.3 - THE Config_System SHALL support ignore patterns for files/folders
     */
    it('should load ignore patterns', async () => {
      const customConfig: Partial<DriftConfig> = {
        ignore: ['node_modules', 'dist', '*.test.ts', 'coverage/**'],
      };
      await createConfigFile(tempDir, customConfig);

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.ignore).toEqual(['node_modules', 'dist', '*.test.ts', 'coverage/**']);
    });

    /**
     * @requirements 36.4 - THE Config_System SHALL support AI provider configuration
     */
    it('should load AI provider configuration', async () => {
      const customConfig: Partial<DriftConfig> = {
        ai: {
          provider: 'anthropic',
          model: 'claude-3-opus',
        },
      };
      await createConfigFile(tempDir, customConfig);

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.ai?.provider).toBe('anthropic');
      expect(result.config.ai?.model).toBe('claude-3-opus');
    });

    /**
     * @requirements 36.5 - THE Config_System SHALL support CI mode settings
     */
    it('should load CI mode settings', async () => {
      const customConfig: Partial<DriftConfig> = {
        ci: {
          failOn: 'warning',
          reportFormat: 'github',
        },
      };
      await createConfigFile(tempDir, customConfig);

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.ci?.failOn).toBe('warning');
      expect(result.config.ci?.reportFormat).toBe('github');
    });

    it('should merge loaded config with defaults', async () => {
      const customConfig: Partial<DriftConfig> = {
        ai: {
          provider: 'ollama',
        },
      };
      await createConfigFile(tempDir, customConfig);

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      // Custom value should be applied
      expect(result.config.ai?.provider).toBe('ollama');
      // Default values should be preserved
      expect(result.config.ci).toEqual(DEFAULT_CONFIG.ci);
      expect(result.config.performance).toEqual(DEFAULT_CONFIG.performance);
      expect(result.config.learning).toEqual(DEFAULT_CONFIG.learning);
    });

    it('should deep merge nested config objects', async () => {
      const customConfig: Partial<DriftConfig> = {
        performance: {
          maxWorkers: 8,
          cacheEnabled: true,
          incrementalAnalysis: true,
        },
      };
      await createConfigFile(tempDir, customConfig);

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.performance?.maxWorkers).toBe(8);
      expect(result.config.performance?.cacheEnabled).toBe(true);
      expect(result.config.performance?.incrementalAnalysis).toBe(true);
    });
  });

  describe('environment variable overrides', () => {
    it('should apply AI provider from environment', async () => {
      process.env.DRIFT_AI_PROVIDER = 'anthropic';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.envOverridesApplied).toBe(true);
      expect(result.config.ai?.provider).toBe('anthropic');
    });

    it('should apply AI model from environment', async () => {
      process.env.DRIFT_AI_MODEL = 'gpt-4-turbo';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.ai?.model).toBe('gpt-4-turbo');
    });

    it('should apply CI failOn from environment', async () => {
      process.env.DRIFT_CI_FAIL_ON = 'warning';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.ci?.failOn).toBe('warning');
    });

    it('should apply CI report format from environment', async () => {
      process.env.DRIFT_CI_REPORT_FORMAT = 'gitlab';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.ci?.reportFormat).toBe('gitlab');
    });

    it('should apply max workers from environment', async () => {
      process.env.DRIFT_MAX_WORKERS = '16';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.performance?.maxWorkers).toBe(16);
    });

    it('should apply cache enabled from environment', async () => {
      process.env.DRIFT_CACHE_ENABLED = 'false';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.performance?.cacheEnabled).toBe(false);
    });

    it('should apply incremental analysis from environment', async () => {
      process.env.DRIFT_INCREMENTAL_ANALYSIS = 'false';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.performance?.incrementalAnalysis).toBe(false);
    });

    it('should apply auto approve threshold from environment', async () => {
      process.env.DRIFT_AUTO_APPROVE_THRESHOLD = '0.8';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.learning?.autoApproveThreshold).toBe(0.8);
    });

    it('should apply min occurrences from environment', async () => {
      process.env.DRIFT_MIN_OCCURRENCES = '5';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.learning?.minOccurrences).toBe(5);
    });

    it('should ignore invalid AI provider values', async () => {
      process.env.DRIFT_AI_PROVIDER = 'invalid-provider';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.ai?.provider).toBe(DEFAULT_CONFIG.ai?.provider);
    });

    it('should ignore invalid CI failOn values', async () => {
      process.env.DRIFT_CI_FAIL_ON = 'invalid';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.ci?.failOn).toBe(DEFAULT_CONFIG.ci?.failOn);
    });

    it('should ignore invalid numeric values', async () => {
      process.env.DRIFT_MAX_WORKERS = 'not-a-number';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.performance?.maxWorkers).toBe(DEFAULT_CONFIG.performance?.maxWorkers);
    });

    it('should ignore negative max workers', async () => {
      process.env.DRIFT_MAX_WORKERS = '-1';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.performance?.maxWorkers).toBe(DEFAULT_CONFIG.performance?.maxWorkers);
    });

    it('should ignore out-of-range threshold values', async () => {
      process.env.DRIFT_AUTO_APPROVE_THRESHOLD = '1.5';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.learning?.autoApproveThreshold).toBe(DEFAULT_CONFIG.learning?.autoApproveThreshold);
    });

    it('should not apply env overrides when disabled', async () => {
      process.env.DRIFT_AI_PROVIDER = 'anthropic';

      const loader = new ConfigLoader({ rootDir: tempDir, applyEnvOverrides: false });
      const result = await loader.load();

      expect(result.envOverridesApplied).toBe(false);
      expect(result.config.ai?.provider).toBe(DEFAULT_CONFIG.ai?.provider);
    });

    it('should override file config with env vars', async () => {
      const customConfig: Partial<DriftConfig> = {
        ai: {
          provider: 'openai',
          model: 'gpt-4',
        },
      };
      await createConfigFile(tempDir, customConfig);
      process.env.DRIFT_AI_PROVIDER = 'anthropic';

      const loader = new ConfigLoader({ rootDir: tempDir });
      const result = await loader.load();

      expect(result.config.ai?.provider).toBe('anthropic');
      expect(result.config.ai?.model).toBe('gpt-4'); // File value preserved
    });

    it('should parse boolean env vars correctly', async () => {
      // Test various true values
      process.env.DRIFT_CACHE_ENABLED = 'true';
      let loader = new ConfigLoader({ rootDir: tempDir });
      let result = await loader.load();
      expect(result.config.performance?.cacheEnabled).toBe(true);

      process.env.DRIFT_CACHE_ENABLED = '1';
      loader = new ConfigLoader({ rootDir: tempDir });
      result = await loader.load();
      expect(result.config.performance?.cacheEnabled).toBe(true);

      process.env.DRIFT_CACHE_ENABLED = 'yes';
      loader = new ConfigLoader({ rootDir: tempDir });
      result = await loader.load();
      expect(result.config.performance?.cacheEnabled).toBe(true);

      // Test various false values
      process.env.DRIFT_CACHE_ENABLED = 'false';
      loader = new ConfigLoader({ rootDir: tempDir });
      result = await loader.load();
      expect(result.config.performance?.cacheEnabled).toBe(false);

      process.env.DRIFT_CACHE_ENABLED = '0';
      loader = new ConfigLoader({ rootDir: tempDir });
      result = await loader.load();
      expect(result.config.performance?.cacheEnabled).toBe(false);

      process.env.DRIFT_CACHE_ENABLED = 'no';
      loader = new ConfigLoader({ rootDir: tempDir });
      result = await loader.load();
      expect(result.config.performance?.cacheEnabled).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw ConfigParseError for invalid JSON', async () => {
      const driftDir = path.join(tempDir, '.drift');
      await fs.mkdir(driftDir, { recursive: true });
      await fs.writeFile(path.join(driftDir, 'config.json'), 'not valid json');

      const loader = new ConfigLoader({ rootDir: tempDir });

      await expect(loader.load()).rejects.toThrow(ConfigParseError);
    });

    it('should throw ConfigParseError for non-object JSON', async () => {
      const driftDir = path.join(tempDir, '.drift');
      await fs.mkdir(driftDir, { recursive: true });
      await fs.writeFile(path.join(driftDir, 'config.json'), '"just a string"');

      const loader = new ConfigLoader({ rootDir: tempDir });

      await expect(loader.load()).rejects.toThrow(ConfigParseError);
    });

    it('should throw ConfigParseError for array JSON', async () => {
      const driftDir = path.join(tempDir, '.drift');
      await fs.mkdir(driftDir, { recursive: true });
      await fs.writeFile(path.join(driftDir, 'config.json'), '[1, 2, 3]');

      const loader = new ConfigLoader({ rootDir: tempDir });

      await expect(loader.load()).rejects.toThrow(ConfigParseError);
    });
  });

  describe('getConfig()', () => {
    it('should return cached config on subsequent calls', async () => {
      const customConfig: Partial<DriftConfig> = {
        ignore: ['cached-test'],
      };
      await createConfigFile(tempDir, customConfig);

      const loader = new ConfigLoader({ rootDir: tempDir });
      
      const config1 = await loader.getConfig();
      const config2 = await loader.getConfig();

      expect(config1).toBe(config2); // Same reference
      expect(config1.ignore).toEqual(['cached-test']);
    });

    it('should load config if not cached', async () => {
      const loader = new ConfigLoader({ rootDir: tempDir });
      const config = await loader.getConfig();

      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('reload()', () => {
    it('should reload config from disk', async () => {
      const loader = new ConfigLoader({ rootDir: tempDir });
      
      // Initial load
      const result1 = await loader.load();
      expect(result1.config.ignore).toEqual(DEFAULT_CONFIG.ignore);

      // Create config file
      await createConfigFile(tempDir, { ignore: ['new-ignore'] });

      // Reload
      const result2 = await loader.reload();
      expect(result2.config.ignore).toEqual(['new-ignore']);
    });
  });

  describe('configFileExists()', () => {
    it('should return false when config file does not exist', async () => {
      const loader = new ConfigLoader({ rootDir: tempDir });
      expect(await loader.configFileExists()).toBe(false);
    });

    it('should return true when config file exists', async () => {
      await createConfigFile(tempDir, {});
      const loader = new ConfigLoader({ rootDir: tempDir });
      expect(await loader.configFileExists()).toBe(true);
    });
  });

  describe('save()', () => {
    it('should save config to file', async () => {
      const loader = new ConfigLoader({ rootDir: tempDir });
      const config: DriftConfig = {
        ...DEFAULT_CONFIG,
        ignore: ['saved-ignore'],
      };

      await loader.save(config);

      // Verify file was created
      const configPath = path.join(tempDir, '.drift', 'config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const saved = JSON.parse(content);

      expect(saved.ignore).toEqual(['saved-ignore']);
    });

    it('should create .drift directory if it does not exist', async () => {
      const loader = new ConfigLoader({ rootDir: tempDir });
      
      await loader.save(DEFAULT_CONFIG);

      const driftDir = path.join(tempDir, '.drift');
      const stat = await fs.stat(driftDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should update cached config after save', async () => {
      const loader = new ConfigLoader({ rootDir: tempDir });
      const config: DriftConfig = {
        ...DEFAULT_CONFIG,
        ignore: ['updated-cache'],
      };

      await loader.save(config);
      const cached = await loader.getConfig();

      expect(cached.ignore).toEqual(['updated-cache']);
    });
  });

  describe('clearCache()', () => {
    it('should clear the cached config', async () => {
      const loader = new ConfigLoader({ rootDir: tempDir });
      
      // Load to populate cache
      await loader.load();
      
      // Clear cache
      loader.clearCache();

      // Create new config file
      await createConfigFile(tempDir, { ignore: ['after-clear'] });

      // getConfig should reload from disk
      const config = await loader.getConfig();
      expect(config.ignore).toEqual(['after-clear']);
    });
  });
});

describe('loadConfig()', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should load config with default options', async () => {
    const config = await loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should load config from file', async () => {
    await createConfigFile(tempDir, { ignore: ['convenience-test'] });
    const config = await loadConfig(tempDir);
    expect(config.ignore).toEqual(['convenience-test']);
  });
});

describe('loadConfigWithResult()', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should return full result object', async () => {
    const result = await loadConfigWithResult(tempDir);
    
    expect(result).toHaveProperty('config');
    expect(result).toHaveProperty('configFileFound');
    expect(result).toHaveProperty('envOverridesApplied');
    expect(result.configFileFound).toBe(false);
  });

  it('should indicate when config file is found', async () => {
    await createConfigFile(tempDir, {});
    const result = await loadConfigWithResult(tempDir);
    
    expect(result.configFileFound).toBe(true);
    expect(result.configPath).toBeDefined();
  });
});
