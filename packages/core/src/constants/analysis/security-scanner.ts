/**
 * Security Scanner for Constants
 *
 * Detects potential hardcoded secrets, credentials, and sensitive
 * values in constants.
 */

import type {
  ConstantExtraction,
  PotentialSecret,
  SecretType,
  IssueSeverity,
} from '../types.js';

/**
 * Configuration for security scanning
 */
export interface SecurityScanConfig {
  /** Enable entropy-based detection */
  enableEntropyDetection: boolean;
  /** Minimum entropy threshold (0-8) */
  entropyThreshold: number;
  /** Custom patterns to detect */
  customPatterns: SecretPattern[];
  /** File patterns to allowlist */
  allowlistPatterns: string[];
  /** Value patterns to allowlist */
  allowlistValues: RegExp[];
}

/**
 * A custom secret detection pattern
 */
export interface SecretPattern {
  /** Pattern name */
  name: string;
  /** Regex pattern for name */
  namePattern?: RegExp;
  /** Regex pattern for value */
  valuePattern?: RegExp;
  /** Secret type */
  type: SecretType;
  /** Severity */
  severity: IssueSeverity;
}

/**
 * Default security scan config
 */
export const DEFAULT_SECURITY_SCAN_CONFIG: SecurityScanConfig = {
  enableEntropyDetection: true,
  entropyThreshold: 4.5,
  customPatterns: [],
  allowlistPatterns: [
    '**/test/**',
    '**/*.test.*',
    '**/*.spec.*',
    '**/mock/**',
    '**/fixture/**',
  ],
  allowlistValues: [
    /^test/i,
    /^mock/i,
    /^fake/i,
    /^dummy/i,
    /^example/i,
    /^placeholder/i,
    /^xxx+$/i,
    /^\*+$/,
  ],
};

/**
 * Built-in secret patterns
 */
const BUILTIN_PATTERNS: SecretPattern[] = [
  // API Keys
  {
    name: 'AWS Access Key',
    valuePattern: /^AKIA[0-9A-Z]{16}$/,
    type: 'aws_key',
    severity: 'critical',
  },
  {
    name: 'AWS Secret Key',
    namePattern: /aws.*secret/i,
    type: 'aws_key',
    severity: 'critical',
  },
  {
    name: 'Stripe API Key',
    valuePattern: /^sk_(?:live|test)_[0-9a-zA-Z]{24,}$/,
    type: 'stripe_key',
    severity: 'critical',
  },
  {
    name: 'Stripe Publishable Key',
    valuePattern: /^pk_(?:live|test)_[0-9a-zA-Z]{24,}$/,
    type: 'stripe_key',
    severity: 'medium',
  },
  {
    name: 'GitHub Token',
    valuePattern: /^gh[pousr]_[A-Za-z0-9_]{36,}$/,
    type: 'github_token',
    severity: 'critical',
  },
  {
    name: 'GitHub Personal Access Token',
    valuePattern: /^github_pat_[A-Za-z0-9_]{22,}$/,
    type: 'github_token',
    severity: 'critical',
  },

  // Generic patterns by name
  {
    name: 'API Key',
    namePattern: /(?:api[_-]?key|apikey)/i,
    type: 'api_key',
    severity: 'high',
  },
  {
    name: 'Secret Key',
    namePattern: /(?:secret[_-]?key|secretkey)/i,
    type: 'secret_key',
    severity: 'high',
  },
  {
    name: 'Password',
    namePattern: /(?:password|passwd|pwd)/i,
    type: 'password',
    severity: 'critical',
  },
  {
    name: 'Private Key',
    namePattern: /(?:private[_-]?key|privatekey)/i,
    type: 'private_key',
    severity: 'critical',
  },
  {
    name: 'Access Token',
    namePattern: /(?:access[_-]?token|accesstoken)/i,
    type: 'token',
    severity: 'high',
  },
  {
    name: 'Auth Token',
    namePattern: /(?:auth[_-]?token|authtoken)/i,
    type: 'token',
    severity: 'high',
  },
  {
    name: 'Bearer Token',
    namePattern: /(?:bearer[_-]?token|bearertoken)/i,
    type: 'token',
    severity: 'high',
  },
  {
    name: 'Refresh Token',
    namePattern: /(?:refresh[_-]?token|refreshtoken)/i,
    type: 'token',
    severity: 'high',
  },
  {
    name: 'Connection String',
    namePattern: /(?:connection[_-]?string|connstring|conn[_-]?str)/i,
    type: 'connection_string',
    severity: 'critical',
  },
  {
    name: 'Database URL',
    namePattern: /(?:database[_-]?url|db[_-]?url)/i,
    type: 'connection_string',
    severity: 'critical',
  },

  // Value patterns
  {
    name: 'Private Key Block',
    valuePattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    type: 'private_key',
    severity: 'critical',
  },
  {
    name: 'Certificate',
    valuePattern: /-----BEGIN CERTIFICATE-----/,
    type: 'certificate',
    severity: 'high',
  },
  {
    name: 'Connection String with Password',
    valuePattern: /(?:mongodb|mysql|postgres|redis):\/\/[^:]+:[^@]+@/i,
    type: 'connection_string',
    severity: 'critical',
  },
  {
    name: 'Basic Auth Header',
    valuePattern: /^Basic [A-Za-z0-9+/=]{10,}$/,
    type: 'token',
    severity: 'high',
  },
  {
    name: 'Bearer Auth Header',
    valuePattern: /^Bearer [A-Za-z0-9._-]{10,}$/,
    type: 'token',
    severity: 'high',
  },
];

/**
 * Result of security scanning
 */
export interface SecurityScanResult {
  /** Potential secrets found */
  secrets: PotentialSecret[];
  /** Total constants scanned */
  totalScanned: number;
  /** Scan time in ms */
  scanTimeMs: number;
  /** Breakdown by severity */
  bySeverity: Record<IssueSeverity, number>;
}

/**
 * Security scanner for constants
 */
export class ConstantSecurityScanner {
  private config: SecurityScanConfig;
  private patterns: SecretPattern[];

  constructor(config: Partial<SecurityScanConfig> = {}) {
    this.config = { ...DEFAULT_SECURITY_SCAN_CONFIG, ...config };
    this.patterns = [...BUILTIN_PATTERNS, ...this.config.customPatterns];
  }

  /**
   * Scan constants for potential secrets
   */
  scan(constants: ConstantExtraction[]): SecurityScanResult {
    const startTime = performance.now();
    const secrets: PotentialSecret[] = [];
    const bySeverity: Record<IssueSeverity, number> = {
      info: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const constant of constants) {
      // Skip allowlisted files
      if (this.isAllowlistedFile(constant.file)) {
        continue;
      }

      // Skip if value is allowlisted
      if (this.isAllowlistedValue(constant.value)) {
        continue;
      }

      const secret = this.analyzeConstant(constant);
      if (secret) {
        secrets.push(secret);
        bySeverity[secret.severity]++;
      }
    }

    // Sort by severity (critical first)
    const severityOrder: IssueSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    secrets.sort((a, b) => 
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
    );

    return {
      secrets,
      totalScanned: constants.length,
      scanTimeMs: performance.now() - startTime,
      bySeverity,
    };
  }

  /**
   * Analyze a single constant for secrets
   */
  private analyzeConstant(constant: ConstantExtraction): PotentialSecret | null {
    const value = constant.value;
    const valueStr = typeof value === 'string' ? value : String(value ?? '');

    // Check against patterns
    for (const pattern of this.patterns) {
      // Check name pattern
      if (pattern.namePattern?.test(constant.name)) {
        // Only flag if value looks like a real secret (not empty/placeholder)
        if (this.looksLikeRealSecret(valueStr)) {
          return this.createSecret(constant, pattern.type, pattern.severity, pattern.name);
        }
      }

      // Check value pattern
      if (pattern.valuePattern?.test(valueStr)) {
        return this.createSecret(constant, pattern.type, pattern.severity, pattern.name);
      }
    }

    // Entropy-based detection for string values
    if (this.config.enableEntropyDetection && typeof value === 'string') {
      const entropy = this.calculateEntropy(value);
      if (entropy >= this.config.entropyThreshold && value.length >= 16) {
        // High entropy string - might be a secret
        // Check if name suggests it's a secret
        if (this.nameSuggestsSecret(constant.name)) {
          return this.createSecret(
            constant,
            'generic_secret',
            'medium',
            `High entropy value (${entropy.toFixed(2)})`
          );
        }
      }
    }

    return null;
  }

  /**
   * Create a potential secret object
   */
  private createSecret(
    constant: ConstantExtraction,
    type: SecretType,
    severity: IssueSeverity,
    _detectedBy: string
  ): PotentialSecret {
    const value = constant.value;
    const valueStr = typeof value === 'string' ? value : String(value ?? '');

    return {
      constantId: constant.id,
      name: constant.name,
      file: constant.file,
      line: constant.line,
      maskedValue: this.maskValue(valueStr),
      secretType: type,
      severity,
      recommendation: this.generateRecommendation(type, constant.name),
      confidence: this.calculateConfidence(constant, type),
    };
  }

  /**
   * Mask a value for safe display
   */
  private maskValue(value: string): string {
    if (value.length <= 8) {
      return '*'.repeat(value.length);
    }

    const visibleChars = Math.min(4, Math.floor(value.length / 4));
    const start = value.slice(0, visibleChars);
    const end = value.slice(-visibleChars);
    const masked = '*'.repeat(Math.min(20, value.length - visibleChars * 2));

    return `${start}${masked}${end}`;
  }

  /**
   * Generate recommendation for a secret type
   */
  private generateRecommendation(type: SecretType, name: string): string {
    const recommendations: Record<SecretType, string> = {
      api_key: `Move '${name}' to environment variables or a secrets manager.`,
      secret_key: `Move '${name}' to environment variables or a secrets manager.`,
      password: `Never hardcode passwords. Use environment variables or a secrets manager.`,
      private_key: `Private keys should never be in source code. Use a secrets manager or key vault.`,
      connection_string: `Move '${name}' to environment variables. Consider using a secrets manager.`,
      token: `Move '${name}' to environment variables or implement token refresh.`,
      certificate: `Certificates should be loaded from files or a certificate store, not hardcoded.`,
      aws_key: `Use IAM roles or AWS Secrets Manager instead of hardcoded AWS credentials.`,
      stripe_key: `Move Stripe keys to environment variables. Use restricted keys in production.`,
      github_token: `Use GitHub Apps or environment variables instead of hardcoded tokens.`,
      generic_secret: `This value appears to be a secret. Move it to environment variables.`,
    };

    return recommendations[type] || `Consider moving '${name}' to a secure configuration.`;
  }

  /**
   * Calculate confidence score for a detection
   */
  private calculateConfidence(constant: ConstantExtraction, type: SecretType): number {
    let confidence = 0.5;

    // Higher confidence for specific patterns
    if (['aws_key', 'stripe_key', 'github_token'].includes(type)) {
      confidence = 0.95;
    } else if (['private_key', 'certificate'].includes(type)) {
      confidence = 0.9;
    } else if (['password', 'connection_string'].includes(type)) {
      confidence = 0.85;
    } else if (['api_key', 'secret_key', 'token'].includes(type)) {
      confidence = 0.75;
    }

    // Lower confidence if in test file
    if (this.isTestFile(constant.file)) {
      confidence *= 0.5;
    }

    // Lower confidence if value looks like placeholder
    const value = String(constant.value ?? '');
    if (this.looksLikePlaceholder(value)) {
      confidence *= 0.3;
    }

    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * Check if a value looks like a real secret (not placeholder)
   */
  private looksLikeRealSecret(value: string): boolean {
    if (!value || value.length < 8) {return false;}

    // Check for placeholder patterns
    if (this.looksLikePlaceholder(value)) {return false;}

    // Check for reasonable entropy
    const entropy = this.calculateEntropy(value);
    return entropy >= 2.5;
  }

  /**
   * Check if a value looks like a placeholder
   */
  private looksLikePlaceholder(value: string): boolean {
    const lower = value.toLowerCase();
    return (
      lower.includes('xxx') ||
      lower.includes('placeholder') ||
      lower.includes('example') ||
      lower.includes('your_') ||
      lower.includes('your-') ||
      lower.includes('<your') ||
      lower.includes('[your') ||
      lower.includes('changeme') ||
      lower.includes('todo') ||
      lower.includes('fixme') ||
      /^[a-z]+$/.test(lower) || // Single word
      /^[x*]+$/.test(lower) // All x's or asterisks
    );
  }

  /**
   * Check if name suggests it might be a secret
   */
  private nameSuggestsSecret(name: string): boolean {
    const lower = name.toLowerCase();
    return (
      lower.includes('key') ||
      lower.includes('secret') ||
      lower.includes('token') ||
      lower.includes('password') ||
      lower.includes('credential') ||
      lower.includes('auth')
    );
  }

  /**
   * Calculate Shannon entropy of a string
   */
  private calculateEntropy(str: string): number {
    if (!str || str.length === 0) {return 0;}

    const freq = new Map<string, number>();
    for (const char of str) {
      freq.set(char, (freq.get(char) || 0) + 1);
    }

    let entropy = 0;
    const len = str.length;
    for (const count of freq.values()) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  /**
   * Check if file is allowlisted
   */
  private isAllowlistedFile(filePath: string): boolean {
    for (const pattern of this.config.allowlistPatterns) {
      // Simple glob matching
      const regex = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.');
      if (new RegExp(regex).test(filePath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if value is allowlisted
   */
  private isAllowlistedValue(value: string | number | boolean | null | undefined): boolean {
    if (typeof value !== 'string') {return false;}

    for (const pattern of this.config.allowlistValues) {
      if (pattern.test(value)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(filePath: string): boolean {
    return (
      filePath.includes('.test.') ||
      filePath.includes('.spec.') ||
      filePath.includes('__tests__') ||
      filePath.includes('__mocks__') ||
      filePath.includes('/test/') ||
      filePath.includes('/tests/')
    );
  }
}
