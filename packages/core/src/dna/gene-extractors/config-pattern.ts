/**
 * Config Pattern Gene Extractor
 * 
 * Detects patterns in how configuration is managed across backend code.
 * Identifies common configuration patterns like:
 * - Environment variables
 * - Config files
 * - Settings classes
 */

import { BaseGeneExtractor, type AlleleDefinition, type FileExtractionResult, type DetectedAllele } from './base-extractor.js';

import type { GeneId } from '../types.js';

export class ConfigPatternExtractor extends BaseGeneExtractor {
  readonly geneId: GeneId = 'config-pattern';
  readonly geneName = 'Configuration Pattern';
  readonly geneDescription = 'How configuration is managed and accessed';

  private readonly alleleDefinitions: AlleleDefinition[] = [
    {
      id: 'env-variables-direct',
      name: 'Direct Environment Variables',
      description: 'Accesses environment variables directly via os.environ or process.env',
      patterns: [
        /os\.environ\[/,
        /os\.environ\.get\s*\(/,
        /os\.getenv\s*\(/,
        /process\.env\./,
        /process\.env\[/,
        /Environment\.GetEnvironmentVariable/,
        /System\.getenv\s*\(/,
        /getenv\s*\(/,
      ],
      priority: 1,
    },
    {
      id: 'settings-class',
      name: 'Settings/Config Class',
      description: 'Uses a dedicated settings or config class for configuration',
      patterns: [
        /class\s+\w*Settings\s*[:(]/,
        /class\s+\w*Config\s*[:(]/,
        /BaseSettings/,
        /@Configuration/,
        /@ConfigurationProperties/,
        /settings\.\w+/,
        /config\.\w+/,
      ],
      priority: 2,
    },
    {
      id: 'dotenv-loading',
      name: 'Dotenv Loading',
      description: 'Uses dotenv to load configuration from .env files',
      patterns: [
        /load_dotenv\s*\(/,
        /dotenv\.config\s*\(/,
        /from\s+dotenv\s+import/,
        /require\s*\(\s*["']dotenv["']\s*\)/,
        /import.*dotenv/,
      ],
      priority: 3,
    },
    {
      id: 'config-file-yaml-json',
      name: 'Config File (YAML/JSON)',
      description: 'Loads configuration from YAML or JSON files',
      patterns: [
        /yaml\.safe_load/,
        /yaml\.load/,
        /JSON\.parse.*config/i,
        /\.yaml["']\s*\)/,
        /\.json["']\s*\)/,
        /application\.yml/,
        /application\.yaml/,
      ],
      priority: 4,
    },
    {
      id: 'dependency-injection-config',
      name: 'Dependency Injection Config',
      description: 'Uses DI container for configuration injection',
      patterns: [
        /@Inject\s*\(\s*["']config/i,
        /@Value\s*\(/,
        /ConfigService/,
        /IConfiguration/,
        /IOptions</,
        /Depends\s*\(\s*get_settings/,
      ],
      priority: 5,
    },
    {
      id: 'hardcoded-config',
      name: 'Hardcoded Configuration',
      description: 'Configuration values hardcoded in source (anti-pattern)',
      patterns: [
        /["']localhost:\d+["']/,
        /["']127\.0\.0\.1:\d+["']/,
        /["']http:\/\/localhost/,
        /password\s*=\s*["'][^"']+["']/i,
        /api_key\s*=\s*["'][^"']+["']/i,
        /secret\s*=\s*["'][^"']+["']/i,
      ],
      priority: 6,
    },
  ];

  getAlleleDefinitions(): AlleleDefinition[] {
    return this.alleleDefinitions;
  }

  extractFromFile(filePath: string, content: string, _imports: string[]): FileExtractionResult {
    const detectedAlleles: DetectedAllele[] = [];
    const isBackendFile = this.isBackendFile(filePath);

    if (!isBackendFile) {
      return { file: filePath, detectedAlleles, isComponent: false };
    }

    for (const allele of this.alleleDefinitions) {
      for (const pattern of allele.patterns) {
        const matches = content.matchAll(new RegExp(pattern, 'gi'));
        for (const match of matches) {
          if (match.index !== undefined) {
            const ctx = this.extractContext(content, match.index);
            detectedAlleles.push({
              alleleId: allele.id,
              line: ctx.line,
              code: ctx.code,
              confidence: 0.8,
              context: ctx.context,
            });
          }
        }
      }
    }

    return { file: filePath, detectedAlleles, isComponent: isBackendFile };
  }

  isBackendFile(filePath: string): boolean {
    const backendExts = ['.py', '.ts', '.js', '.java', '.php', '.go', '.rs', '.cs'];
    return backendExts.some(ext => filePath.endsWith(ext));
  }
}
