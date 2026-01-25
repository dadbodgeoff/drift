/**
 * Constant Categorizer
 *
 * Infers the category of a constant based on its name, value, and context.
 */

import type { ConstantExtraction, ConstantCategory } from '../types.js';

/**
 * Category inference patterns
 */
const CATEGORY_PATTERNS: Record<ConstantCategory, CategoryPattern> = {
  config: {
    namePatterns: [
      /config/i,
      /settings?/i,
      /options?/i,
      /defaults?/i,
      /params?/i,
      /preferences?/i,
    ],
    valuePatterns: [],
    parentPatterns: [/config/i, /settings/i],
  },
  api: {
    namePatterns: [
      /^api/i,
      /url$/i,
      /endpoint/i,
      /base_?url/i,
      /host/i,
      /port$/i,
      /header/i,
      /content.?type/i,
      /accept/i,
      /method/i,
    ],
    valuePatterns: [
      /^https?:\/\//i,
      /^\/api\//i,
      /application\/json/i,
      /text\/html/i,
    ],
    parentPatterns: [/api/i, /http/i, /client/i],
  },
  status: {
    namePatterns: [
      /status/i,
      /state/i,
      /phase/i,
      /stage/i,
      /step/i,
      /mode/i,
    ],
    valuePatterns: [
      /pending/i,
      /active/i,
      /completed/i,
      /failed/i,
      /success/i,
      /error/i,
      /cancelled/i,
      /processing/i,
    ],
    parentPatterns: [/status/i, /state/i],
  },
  error: {
    namePatterns: [
      /^err_/i,      // ERR_ prefix
      /^error_/i,    // ERROR_ prefix
      /^e_/i,        // E_ prefix
      /_error$/i,    // _ERROR suffix
      /_err$/i,      // _ERR suffix
      /exception/i,
      /^fault$/i,    // Only match exact "fault", not "default"
      /failure/i,
    ],
    valuePatterns: [
      /error/i,
      /failed/i,
      /invalid/i,
      /not.?found/i,
      /unauthorized/i,
      /forbidden/i,
    ],
    parentPatterns: [/error/i, /exception/i],
  },
  feature_flag: {
    namePatterns: [
      /feature/i,
      /flag/i,
      /^ff_/i,
      /enable/i,
      /disable/i,
      /toggle/i,
      /experiment/i,
      /^is_/i,
      /^has_/i,
      /^can_/i,
      /^should_/i,
      /^use_/i,
    ],
    valuePatterns: [],
    parentPatterns: [/feature/i, /flag/i],
  },
  limit: {
    namePatterns: [
      /^max_/i,
      /^min_/i,
      /_max$/i,
      /_min$/i,
      /^limit/i,
      /_limit$/i,
      /threshold/i,
      /timeout/i,
      /^size_/i,
      /_size$/i,
      /^count_/i,
      /_count$/i,
      /^length_/i,
      /_length$/i,
      /capacity/i,
      /^rate_/i,
      /_rate$/i,
      /interval/i,
      /delay/i,
      /ttl/i,
      /expire/i,
      /duration/i,
      /^retry_/i,
      /_retry$/i,
      /attempt/i,
    ],
    valuePatterns: [],
    parentPatterns: [/limit/i, /config/i],
  },
  regex: {
    namePatterns: [
      /regex/i,
      /regexp/i,
      /pattern/i,
      /^re_/i,
    ],
    valuePatterns: [
      /^\/.+\/[gimsuvy]*$/,
      /^\^.*\$$/,
      /\[.*\]/,
      /\(.*\)/,
      /\\d|\\w|\\s/,
    ],
    parentPatterns: [/regex/i, /pattern/i, /validator/i],
  },
  path: {
    namePatterns: [
      /path/i,
      /route/i,
      /dir/i,
      /directory/i,
      /folder/i,
      /file/i,
      /location/i,
    ],
    valuePatterns: [
      /^\/[a-z]/i,
      /^\.\//,
      /^\.\.\//, 
      /^[a-z]:\\/i,
    ],
    parentPatterns: [/path/i, /route/i],
  },
  env: {
    namePatterns: [
      /^env/i,
      /environment/i,
      /^node_env/i,
      /^app_env/i,
    ],
    valuePatterns: [
      /development/i,
      /production/i,
      /staging/i,
      /test/i,
      /local/i,
    ],
    parentPatterns: [/env/i, /environment/i],
  },
  security: {
    namePatterns: [
      /secret/i,
      /password/i,
      /passwd/i,
      /credential/i,
      /auth/i,
      /token/i,
      /key$/i,
      /^api.?key/i,
      /^private/i,
      /^public.?key/i,
      /certificate/i,
      /cert$/i,
      /salt/i,
      /hash/i,
      /encrypt/i,
      /decrypt/i,
    ],
    valuePatterns: [
      /^sk_/i,
      /^pk_/i,
      /^-----BEGIN/,
      /^bearer /i,
      /^basic /i,
    ],
    parentPatterns: [/auth/i, /security/i, /credential/i],
  },
  uncategorized: {
    namePatterns: [],
    valuePatterns: [],
    parentPatterns: [],
  },
};

interface CategoryPattern {
  namePatterns: RegExp[];
  valuePatterns: RegExp[];
  parentPatterns: RegExp[];
}

/**
 * Infer the category of a constant
 */
export function inferCategory(constant: ConstantExtraction): ConstantCategory {
  const name = constant.name;
  const value = String(constant.value ?? constant.rawValue ?? '');
  const parentName = constant.parentName ?? '';

  // Check each category in priority order
  const priorityOrder: ConstantCategory[] = [
    'security',      // Security first - most important to flag
    'feature_flag',  // Feature flags are distinctive
    'api',           // API-related
    'status',        // Status values
    'error',         // Error codes
    'limit',         // Limits and thresholds
    'config',        // Configuration (after more specific categories)
    'regex',         // Regex patterns
    'path',          // File paths
    'env',           // Environment
  ];

  for (const category of priorityOrder) {
    const patterns = CATEGORY_PATTERNS[category];
    
    // Check name patterns
    for (const pattern of patterns.namePatterns) {
      if (pattern.test(name)) {
        return category;
      }
    }

    // Check value patterns
    for (const pattern of patterns.valuePatterns) {
      if (pattern.test(value)) {
        return category;
      }
    }

    // Check parent patterns
    for (const pattern of patterns.parentPatterns) {
      if (pattern.test(parentName)) {
        return category;
      }
    }
  }

  return 'uncategorized';
}

/**
 * Get category display name
 */
export function getCategoryDisplayName(category: ConstantCategory): string {
  const displayNames: Record<ConstantCategory, string> = {
    config: 'Configuration',
    api: 'API',
    status: 'Status',
    error: 'Error',
    feature_flag: 'Feature Flag',
    limit: 'Limit',
    regex: 'Regex',
    path: 'Path',
    env: 'Environment',
    security: 'Security',
    uncategorized: 'Uncategorized',
  };
  return displayNames[category];
}

/**
 * Get category description
 */
export function getCategoryDescription(category: ConstantCategory): string {
  const descriptions: Record<ConstantCategory, string> = {
    config: 'Configuration values and settings',
    api: 'API endpoints, URLs, headers, and related values',
    status: 'Status codes, states, and phases',
    error: 'Error codes and error messages',
    feature_flag: 'Feature toggles and experiment flags',
    limit: 'Limits, thresholds, timeouts, and sizes',
    regex: 'Regular expression patterns',
    path: 'File paths, routes, and directories',
    env: 'Environment-related values',
    security: 'Security-sensitive values (potential secrets)',
    uncategorized: 'Constants that don\'t fit other categories',
  };
  return descriptions[category];
}

/**
 * Check if a category is security-sensitive
 */
export function isSecuritySensitive(category: ConstantCategory): boolean {
  return category === 'security';
}

/**
 * Suggest a better name for a constant based on its value
 */
export function suggestConstantName(value: string | number, category: ConstantCategory): string {
  const strValue = String(value);
  
  // Common value-to-name mappings
  const commonMappings: Record<string, string> = {
    '3600': 'ONE_HOUR_SECONDS',
    '86400': 'ONE_DAY_SECONDS',
    '604800': 'ONE_WEEK_SECONDS',
    '1000': 'ONE_SECOND_MS',
    '60000': 'ONE_MINUTE_MS',
    '3600000': 'ONE_HOUR_MS',
    'application/json': 'CONTENT_TYPE_JSON',
    'application/xml': 'CONTENT_TYPE_XML',
    'text/html': 'CONTENT_TYPE_HTML',
    'text/plain': 'CONTENT_TYPE_TEXT',
    'utf-8': 'ENCODING_UTF8',
    'utf8': 'ENCODING_UTF8',
  };

  const lowerValue = strValue.toLowerCase();
  if (commonMappings[lowerValue]) {
    return commonMappings[lowerValue];
  }

  // Generate name based on category and value
  const prefix = getCategoryPrefix(category);
  const sanitized = sanitizeForConstantName(strValue);
  
  return `${prefix}${sanitized}`;
}

/**
 * Get prefix for a category
 */
function getCategoryPrefix(category: ConstantCategory): string {
  const prefixes: Record<ConstantCategory, string> = {
    config: 'CONFIG_',
    api: 'API_',
    status: 'STATUS_',
    error: 'ERROR_',
    feature_flag: 'FF_',
    limit: 'MAX_',
    regex: 'PATTERN_',
    path: 'PATH_',
    env: 'ENV_',
    security: 'SECRET_',
    uncategorized: '',
  };
  return prefixes[category];
}

/**
 * Sanitize a value for use as a constant name
 */
function sanitizeForConstantName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
}
