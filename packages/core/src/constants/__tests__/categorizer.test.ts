/**
 * Constant Categorizer Tests
 */

import { describe, it, expect } from 'vitest';
import {
  inferCategory,
  getCategoryDisplayName,
  isSecuritySensitive,
  suggestConstantName,
} from '../analysis/categorizer.js';
import type { ConstantExtraction } from '../types.js';

describe('inferCategory', () => {
  const createConstant = (
    name: string,
    value?: string | number,
    parentName?: string
  ): ConstantExtraction => ({
    id: `test:${name}:1`,
    name,
    qualifiedName: parentName ? `${parentName}.${name}` : name,
    file: 'test.ts',
    line: 1,
    column: 1,
    endLine: 1,
    language: 'typescript',
    kind: 'primitive',
    category: 'uncategorized',
    value,
    isExported: true,
    decorators: [],
    modifiers: [],
    confidence: 0.9,
    parentName,
  });

  describe('config category', () => {
    it('should categorize config-related names', () => {
      expect(inferCategory(createConstant('CONFIG'))).toBe('config');
      expect(inferCategory(createConstant('APP_CONFIG'))).toBe('config');
      expect(inferCategory(createConstant('DEFAULT_SETTINGS'))).toBe('config');
      expect(inferCategory(createConstant('OPTIONS'))).toBe('config');
    });
  });

  describe('api category', () => {
    it('should categorize API-related names', () => {
      expect(inferCategory(createConstant('API_URL'))).toBe('api');
      expect(inferCategory(createConstant('BASE_URL'))).toBe('api');
      expect(inferCategory(createConstant('ENDPOINT'))).toBe('api');
      expect(inferCategory(createConstant('API_HOST'))).toBe('api');
    });

    it('should categorize by URL value', () => {
      expect(inferCategory(createConstant('SERVER', 'https://api.example.com'))).toBe('api');
      expect(inferCategory(createConstant('PATH', '/api/users'))).toBe('api');
    });

    it('should categorize content types', () => {
      expect(inferCategory(createConstant('TYPE', 'application/json'))).toBe('api');
    });
  });

  describe('status category', () => {
    it('should categorize status-related names', () => {
      expect(inferCategory(createConstant('STATUS_PENDING'))).toBe('status');
      expect(inferCategory(createConstant('STATE_ACTIVE'))).toBe('status');
      expect(inferCategory(createConstant('PHASE_INIT'))).toBe('status');
    });

    it('should categorize by status value', () => {
      expect(inferCategory(createConstant('VALUE', 'pending'))).toBe('status');
      expect(inferCategory(createConstant('VALUE', 'completed'))).toBe('status');
    });
  });

  describe('error category', () => {
    it('should categorize error-related names', () => {
      expect(inferCategory(createConstant('ERROR_CODE'))).toBe('error');
      expect(inferCategory(createConstant('ERR_NOT_FOUND'))).toBe('error');
      expect(inferCategory(createConstant('E_INVALID'))).toBe('error');
    });
  });

  describe('feature_flag category', () => {
    it('should categorize feature flag names', () => {
      expect(inferCategory(createConstant('FEATURE_NEW_UI'))).toBe('feature_flag');
      expect(inferCategory(createConstant('FF_DARK_MODE'))).toBe('feature_flag');
      expect(inferCategory(createConstant('ENABLE_CACHE'))).toBe('feature_flag');
      expect(inferCategory(createConstant('IS_ENABLED'))).toBe('feature_flag');
    });
  });

  describe('limit category', () => {
    it('should categorize limit-related names', () => {
      expect(inferCategory(createConstant('MAX_RETRIES'))).toBe('limit');
      expect(inferCategory(createConstant('MIN_LENGTH'))).toBe('limit');
      expect(inferCategory(createConstant('TIMEOUT'))).toBe('limit');
      expect(inferCategory(createConstant('RATE_LIMIT'))).toBe('limit');
      expect(inferCategory(createConstant('PAGE_SIZE'))).toBe('limit');
    });
  });

  describe('regex category', () => {
    it('should categorize regex-related names', () => {
      expect(inferCategory(createConstant('EMAIL_REGEX'))).toBe('regex');
      expect(inferCategory(createConstant('URL_PATTERN'))).toBe('regex');
    });

    it('should categorize by regex value', () => {
      expect(inferCategory(createConstant('VALIDATOR', '/^[a-z]+$/'))).toBe('regex');
    });
  });

  describe('path category', () => {
    it('should categorize path-related names', () => {
      expect(inferCategory(createConstant('FILE_PATH'))).toBe('path');
      expect(inferCategory(createConstant('UPLOAD_DIR'))).toBe('path');
      expect(inferCategory(createConstant('ROUTE_HOME'))).toBe('path');
    });

    it('should categorize by path value', () => {
      expect(inferCategory(createConstant('LOCATION', '/home/user'))).toBe('path');
      expect(inferCategory(createConstant('LOCATION', './config'))).toBe('path');
    });
  });

  describe('security category', () => {
    it('should categorize security-related names', () => {
      expect(inferCategory(createConstant('SECRET_KEY'))).toBe('security');
      expect(inferCategory(createConstant('API_KEY'))).toBe('security');
      expect(inferCategory(createConstant('PASSWORD'))).toBe('security');
      expect(inferCategory(createConstant('AUTH_TOKEN'))).toBe('security');
      expect(inferCategory(createConstant('PRIVATE_KEY'))).toBe('security');
    });

    it('should categorize by secret value patterns', () => {
      expect(inferCategory(createConstant('KEY', 'sk_test_FAKE_abc123'))).toBe('security');
      expect(inferCategory(createConstant('CERT', '-----BEGIN PRIVATE KEY-----'))).toBe('security');
    });
  });

  describe('uncategorized', () => {
    it('should return uncategorized for unknown patterns', () => {
      expect(inferCategory(createConstant('RANDOM_NAME'))).toBe('uncategorized');
      expect(inferCategory(createConstant('FOO_BAR'))).toBe('uncategorized');
    });
  });
});

describe('getCategoryDisplayName', () => {
  it('should return display names', () => {
    expect(getCategoryDisplayName('config')).toBe('Configuration');
    expect(getCategoryDisplayName('api')).toBe('API');
    expect(getCategoryDisplayName('feature_flag')).toBe('Feature Flag');
  });
});

describe('isSecuritySensitive', () => {
  it('should identify security category as sensitive', () => {
    expect(isSecuritySensitive('security')).toBe(true);
    expect(isSecuritySensitive('config')).toBe(false);
    expect(isSecuritySensitive('api')).toBe(false);
  });
});

describe('suggestConstantName', () => {
  it('should suggest names for common values', () => {
    expect(suggestConstantName('3600', 'limit')).toBe('ONE_HOUR_SECONDS');
    expect(suggestConstantName('86400', 'limit')).toBe('ONE_DAY_SECONDS');
    expect(suggestConstantName('application/json', 'api')).toBe('CONTENT_TYPE_JSON');
  });

  it('should generate names with category prefix', () => {
    expect(suggestConstantName('custom-value', 'config')).toBe('CONFIG_CUSTOM_VALUE');
    expect(suggestConstantName('my-endpoint', 'api')).toBe('API_MY_ENDPOINT');
  });
});
