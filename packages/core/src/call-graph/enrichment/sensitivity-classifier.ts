/**
 * Sensitivity Classifier
 *
 * Enterprise-grade classification of data sensitivity.
 * Maps fields to sensitivity types and regulatory implications.
 */

import type {
  DataSensitivityProfile,
  DataRegulation,
} from './types.js';
import type { SensitivityType } from '../../boundaries/types.js';

// ============================================================================
// Sensitivity Patterns
// ============================================================================

/**
 * Pattern-based sensitivity detection
 */
interface SensitivityPattern {
  /** Regex patterns to match field names */
  patterns: RegExp[];
  /** Sensitivity type */
  type: SensitivityType;
  /** Applicable regulations */
  regulations: DataRegulation[];
  /** Base impact score */
  baseScore: number;
  /** Rationale for classification */
  rationale: string;
}

/**
 * Comprehensive sensitivity patterns based on industry standards
 */
const SENSITIVITY_PATTERNS: SensitivityPattern[] = [
  // ============================================================================
  // CREDENTIALS - Highest sensitivity (authentication/authorization)
  // ============================================================================
  {
    patterns: [
      /^password$/i,
      /password[_-]?hash$/i,
      /hashed[_-]?password$/i,
      /pwd$/i,
      /passwd$/i,
      /pass[_-]?phrase$/i,
    ],
    type: 'credentials',
    regulations: ['pci-dss', 'gdpr', 'ccpa', 'hipaa'],
    baseScore: 100,
    rationale: 'Password hashes enable account takeover if exposed',
  },
  {
    patterns: [
      /api[_-]?key$/i,
      /api[_-]?secret$/i,
      /secret[_-]?key$/i,
      /access[_-]?key$/i,
      /private[_-]?key$/i,
    ],
    type: 'credentials',
    regulations: ['pci-dss', 'sox'],
    baseScore: 95,
    rationale: 'API keys provide system access and must be protected',
  },
  {
    patterns: [
      /^token$/i,
      /auth[_-]?token$/i,
      /access[_-]?token$/i,
      /refresh[_-]?token$/i,
      /session[_-]?token$/i,
      /jwt$/i,
      /bearer[_-]?token$/i,
    ],
    type: 'credentials',
    regulations: ['pci-dss', 'gdpr'],
    baseScore: 90,
    rationale: 'Authentication tokens enable session hijacking',
  },
  {
    patterns: [
      /^secret$/i,
      /client[_-]?secret$/i,
      /encryption[_-]?key$/i,
      /signing[_-]?key$/i,
      /master[_-]?key$/i,
    ],
    type: 'credentials',
    regulations: ['pci-dss', 'hipaa', 'sox'],
    baseScore: 98,
    rationale: 'Cryptographic secrets compromise entire system security',
  },
  {
    patterns: [
      /mfa[_-]?secret$/i,
      /totp[_-]?secret$/i,
      /two[_-]?factor[_-]?secret$/i,
      /recovery[_-]?code/i,
      /backup[_-]?code/i,
    ],
    type: 'credentials',
    regulations: ['pci-dss', 'gdpr'],
    baseScore: 92,
    rationale: 'MFA secrets bypass two-factor authentication',
  },

  // ============================================================================
  // FINANCIAL - Payment and financial data
  // ============================================================================
  {
    patterns: [
      /credit[_-]?card/i,
      /card[_-]?number/i,
      /cc[_-]?number/i,
      /pan$/i,
      /primary[_-]?account[_-]?number/i,
    ],
    type: 'financial',
    regulations: ['pci-dss', 'gdpr', 'ccpa'],
    baseScore: 100,
    rationale: 'Credit card numbers are PCI-DSS regulated cardholder data',
  },
  {
    patterns: [
      /^cvv$/i,
      /^cvc$/i,
      /^cvv2$/i,
      /security[_-]?code$/i,
      /card[_-]?verification/i,
    ],
    type: 'financial',
    regulations: ['pci-dss'],
    baseScore: 100,
    rationale: 'CVV codes must never be stored per PCI-DSS',
  },
  {
    patterns: [
      /bank[_-]?account/i,
      /account[_-]?number/i,
      /routing[_-]?number/i,
      /iban$/i,
      /swift[_-]?code/i,
      /bic$/i,
    ],
    type: 'financial',
    regulations: ['pci-dss', 'glba', 'gdpr'],
    baseScore: 90,
    rationale: 'Bank account details enable financial fraud',
  },
  {
    patterns: [
      /^salary$/i,
      /^income$/i,
      /^wage$/i,
      /wage[_-]?rate/i,
      /wage[_-]?override/i,
      /wage[_-]?cents/i,
      /hourly[_-]?rate/i,
      /rate[_-]?cents/i,
      /compensation/i,
      /net[_-]?worth/i,
      /tax[_-]?return/i,
      /pay[_-]?rate/i,
      /payroll/i,
    ],
    type: 'financial',
    regulations: ['gdpr', 'ccpa', 'glba'],
    baseScore: 75,
    rationale: 'Wage and compensation data is sensitive financial information',
  },

  // ============================================================================
  // PII - Personally Identifiable Information
  // ============================================================================
  {
    patterns: [
      /^ssn$/i,
      /social[_-]?security/i,
      /national[_-]?id/i,
      /national[_-]?insurance/i,
      /tax[_-]?id/i,
      /tin$/i,
      /ein$/i,
    ],
    type: 'pii',
    regulations: ['gdpr', 'ccpa', 'hipaa', 'glba'],
    baseScore: 100,
    rationale: 'Government IDs enable identity theft',
  },
  {
    patterns: [
      /passport[_-]?number/i,
      /driver[_-]?license/i,
      /license[_-]?number/i,
      /id[_-]?number/i,
    ],
    type: 'pii',
    regulations: ['gdpr', 'ccpa'],
    baseScore: 90,
    rationale: 'Government-issued ID numbers are high-value PII',
  },
  {
    patterns: [
      /date[_-]?of[_-]?birth/i,
      /^dob$/i,
      /birth[_-]?date/i,
      /birthday/i,
    ],
    type: 'pii',
    regulations: ['gdpr', 'ccpa', 'coppa', 'hipaa'],
    baseScore: 70,
    rationale: 'Date of birth is a key identity verification element',
  },
  {
    patterns: [
      /^email$/i,
      /email[_-]?address/i,
      /e[_-]?mail/i,
    ],
    type: 'pii',
    regulations: ['gdpr', 'ccpa', 'coppa'],
    baseScore: 50,
    rationale: 'Email addresses are personal identifiers',
  },
  {
    patterns: [
      /phone[_-]?number/i,
      /mobile[_-]?number/i,
      /cell[_-]?phone/i,
      /telephone/i,
    ],
    type: 'pii',
    regulations: ['gdpr', 'ccpa', 'coppa'],
    baseScore: 55,
    rationale: 'Phone numbers are personal contact information',
  },
  {
    patterns: [
      /^address$/i,
      /street[_-]?address/i,
      /home[_-]?address/i,
      /mailing[_-]?address/i,
      /postal[_-]?address/i,
    ],
    type: 'pii',
    regulations: ['gdpr', 'ccpa'],
    baseScore: 60,
    rationale: 'Physical addresses reveal location and enable stalking',
  },
  {
    patterns: [
      /^ip[_-]?address$/i,
      /client[_-]?ip/i,
      /user[_-]?ip/i,
    ],
    type: 'pii',
    regulations: ['gdpr'],
    baseScore: 40,
    rationale: 'IP addresses are personal data under GDPR',
  },
  {
    patterns: [
      /biometric/i,
      /fingerprint/i,
      /face[_-]?id/i,
      /retina/i,
      /voice[_-]?print/i,
    ],
    type: 'pii',
    regulations: ['gdpr', 'ccpa', 'hipaa'],
    baseScore: 95,
    rationale: 'Biometric data is immutable and highly sensitive',
  },
  {
    patterns: [
      /^race$/i,
      /ethnicity/i,
      /religion/i,
      /political[_-]?affiliation/i,
      /sexual[_-]?orientation/i,
      /gender[_-]?identity/i,
    ],
    type: 'pii',
    regulations: ['gdpr', 'ccpa'],
    baseScore: 85,
    rationale: 'Special category data under GDPR Article 9',
  },

  // ============================================================================
  // HEALTH - Protected Health Information
  // ============================================================================
  {
    patterns: [
      /diagnosis/i,
      /medical[_-]?condition/i,
      /health[_-]?condition/i,
      /disease/i,
      /illness/i,
    ],
    type: 'health',
    regulations: ['hipaa', 'gdpr'],
    baseScore: 95,
    rationale: 'Medical diagnoses are protected health information',
  },
  {
    patterns: [
      /prescription/i,
      /medication/i,
      /drug[_-]?name/i,
      /dosage/i,
    ],
    type: 'health',
    regulations: ['hipaa', 'gdpr'],
    baseScore: 90,
    rationale: 'Prescription data reveals health conditions',
  },
  {
    patterns: [
      /medical[_-]?record/i,
      /health[_-]?record/i,
      /patient[_-]?record/i,
      /ehr$/i,
      /emr$/i,
    ],
    type: 'health',
    regulations: ['hipaa', 'gdpr'],
    baseScore: 100,
    rationale: 'Medical records are core PHI under HIPAA',
  },
  {
    patterns: [
      /insurance[_-]?id/i,
      /insurance[_-]?member[_-]?id/i,
      /policy[_-]?number/i,
      /group[_-]?number/i,
      /health[_-]?plan[_-]?id/i,
      /beneficiary[_-]?id/i,
    ],
    type: 'health',
    regulations: ['hipaa', 'gdpr'],
    baseScore: 75,
    rationale: 'Insurance identifiers are PHI under HIPAA',
  },
  {
    patterns: [
      /lab[_-]?result/i,
      /test[_-]?result/i,
      /blood[_-]?type/i,
      /genetic/i,
      /dna/i,
    ],
    type: 'health',
    regulations: ['hipaa', 'gdpr'],
    baseScore: 95,
    rationale: 'Lab results and genetic data are highly sensitive PHI',
  },
];

// ============================================================================
// Sensitivity Classifier
// ============================================================================

/**
 * Classifies data sensitivity based on field names and context
 */
export class SensitivityClassifier {
  private customPatterns: SensitivityPattern[] = [];
  private fieldOverrides: Map<string, DataSensitivityProfile> = new Map();

  /**
   * Add custom sensitivity patterns
   */
  addPattern(pattern: SensitivityPattern): void {
    this.customPatterns.push(pattern);
  }

  /**
   * Override classification for a specific field
   */
  overrideField(fieldKey: string, profile: DataSensitivityProfile): void {
    this.fieldOverrides.set(fieldKey.toLowerCase(), profile);
  }

  /**
   * Classify a field's sensitivity
   */
  classify(field: string, table?: string): DataSensitivityProfile {
    // Check for explicit override first
    const fieldKey = table ? `${table}.${field}`.toLowerCase() : field.toLowerCase();
    const override = this.fieldOverrides.get(fieldKey);
    if (override) {
      return override;
    }

    // Check custom patterns first (higher priority)
    for (const pattern of this.customPatterns) {
      if (this.matchesPattern(field, pattern.patterns)) {
        return {
          type: pattern.type,
          regulations: pattern.regulations,
          baseScore: pattern.baseScore,
          rationale: pattern.rationale,
        };
      }
    }

    // Check built-in patterns
    for (const pattern of SENSITIVITY_PATTERNS) {
      if (this.matchesPattern(field, pattern.patterns)) {
        return {
          type: pattern.type,
          regulations: pattern.regulations,
          baseScore: pattern.baseScore,
          rationale: pattern.rationale,
        };
      }
    }

    // Default: unknown sensitivity
    return {
      type: 'unknown',
      regulations: [],
      baseScore: 10,
      rationale: 'No sensitive data patterns detected',
    };
  }

  /**
   * Classify multiple fields and return aggregated regulations
   */
  classifyMultiple(fields: Array<{ field: string; table?: string }>): {
    profiles: DataSensitivityProfile[];
    regulations: DataRegulation[];
    maxScore: number;
  } {
    const profiles: DataSensitivityProfile[] = [];
    const regulationsSet = new Set<DataRegulation>();
    let maxScore = 0;

    for (const { field, table } of fields) {
      const profile = this.classify(field, table);
      profiles.push(profile);
      maxScore = Math.max(maxScore, profile.baseScore);
      for (const reg of profile.regulations) {
        regulationsSet.add(reg);
      }
    }

    return {
      profiles,
      regulations: Array.from(regulationsSet),
      maxScore,
    };
  }

  /**
   * Get all regulations that apply to a sensitivity type
   */
  getRegulationsForType(type: SensitivityType): DataRegulation[] {
    const regulations = new Set<DataRegulation>();

    for (const pattern of [...SENSITIVITY_PATTERNS, ...this.customPatterns]) {
      if (pattern.type === type) {
        for (const reg of pattern.regulations) {
          regulations.add(reg);
        }
      }
    }

    return Array.from(regulations);
  }

  /**
   * Check if a field matches any of the patterns
   */
  private matchesPattern(field: string, patterns: RegExp[]): boolean {
    const normalizedField = field.toLowerCase();
    return patterns.some((pattern) => pattern.test(normalizedField));
  }
}

/**
 * Create a new sensitivity classifier
 */
export function createSensitivityClassifier(): SensitivityClassifier {
  return new SensitivityClassifier();
}

/**
 * Default singleton instance
 */
let defaultClassifier: SensitivityClassifier | null = null;

/**
 * Get the default sensitivity classifier
 */
export function getDefaultClassifier(): SensitivityClassifier {
  if (!defaultClassifier) {
    defaultClassifier = createSensitivityClassifier();
  }
  return defaultClassifier;
}
