/**
 * TypeScript Constant Regex Extractor Tests
 */

import { describe, it, expect } from 'vitest';
import { TypeScriptConstantRegexExtractor } from '../extractors/regex/typescript-regex.js';

describe('TypeScriptConstantRegexExtractor', () => {
  const extractor = new TypeScriptConstantRegexExtractor();

  describe('extractConstants', () => {
    it('should extract exported const with UPPER_CASE name', () => {
      const source = `
export const API_URL = 'https://api.example.com';
export const MAX_RETRIES = 3;
`;
      const result = extractor.extract(source, 'config.ts');

      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].name).toBe('API_URL');
      expect(result.constants[0].value).toBe('https://api.example.com');
      expect(result.constants[0].isExported).toBe(true);
      expect(result.constants[0].kind).toBe('primitive');

      expect(result.constants[1].name).toBe('MAX_RETRIES');
      expect(result.constants[1].value).toBe(3);
    });

    it('should extract const with type annotation', () => {
      const source = `
export const TIMEOUT: number = 5000;
export const API_KEY: string = 'secret-key';
`;
      const result = extractor.extract(source, 'config.ts');

      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].name).toBe('TIMEOUT');
      expect(result.constants[0].type).toBe('number');
      expect(result.constants[0].value).toBe(5000);

      expect(result.constants[1].name).toBe('API_KEY');
      expect(result.constants[1].type).toBe('string');
    });

    it('should extract non-exported const', () => {
      const source = `
const INTERNAL_CONFIG = { timeout: 1000 };
`;
      const result = extractor.extract(source, 'config.ts');

      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].name).toBe('INTERNAL_CONFIG');
      expect(result.constants[0].isExported).toBe(false);
      expect(result.constants[0].kind).toBe('object');
    });

    it('should extract boolean constants', () => {
      const source = `
export const ENABLE_FEATURE = true;
export const DISABLE_LOGGING = false;
`;
      const result = extractor.extract(source, 'flags.ts');

      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe(true);
      expect(result.constants[1].value).toBe(false);
    });

    it('should extract Object.freeze constants', () => {
      const source = `
export const ROLES = Object.freeze({
  ADMIN: 'admin',
  USER: 'user',
});
`;
      const result = extractor.extract(source, 'roles.ts');

      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].name).toBe('ROLES');
      expect(result.constants[0].kind).toBe('object');
      expect(result.constants[0].modifiers).toContain('frozen');
    });

    it('should extract as const objects', () => {
      const source = `
export const STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
} as const;
`;
      const result = extractor.extract(source, 'status.ts');

      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].name).toBe('STATUS');
      expect(result.constants[0].kind).toBe('object');
      expect(result.constants[0].modifiers).toContain('as_const');
    });

    it('should skip lowercase const names', () => {
      const source = `
export const apiUrl = 'https://api.example.com';
const config = { timeout: 1000 };
`;
      const result = extractor.extract(source, 'config.ts');

      // Should not extract lowercase names
      expect(result.constants).toHaveLength(0);
    });

    it('should extract doc comments', () => {
      const source = `
/**
 * Base URL for API requests
 */
export const API_URL = 'https://api.example.com';

// Maximum retry attempts
export const MAX_RETRIES = 3;
`;
      const result = extractor.extract(source, 'config.ts');

      expect(result.constants[0].docComment).toBe('Base URL for API requests');
      expect(result.constants[1].docComment).toBe('Maximum retry attempts');
    });
  });

  describe('extractEnums', () => {
    it('should extract basic enum', () => {
      const source = `
export enum Status {
  PENDING,
  ACTIVE,
  COMPLETED,
}
`;
      const result = extractor.extract(source, 'types.ts');

      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe('Status');
      expect(result.enums[0].isExported).toBe(true);
      expect(result.enums[0].members).toHaveLength(3);
      expect(result.enums[0].members[0].name).toBe('PENDING');
      expect(result.enums[0].members[0].value).toBe(0);
      expect(result.enums[0].members[0].isAutoValue).toBe(true);
    });

    it('should extract enum with explicit values', () => {
      const source = `
enum HttpStatus {
  OK = 200,
  NOT_FOUND = 404,
  SERVER_ERROR = 500,
}
`;
      const result = extractor.extract(source, 'http.ts');

      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].members[0].value).toBe(200);
      expect(result.enums[0].members[1].value).toBe(404);
      expect(result.enums[0].members[2].value).toBe(500);
    });

    it('should extract string enum', () => {
      const source = `
export enum Direction {
  UP = "up",
  DOWN = "down",
  LEFT = "left",
  RIGHT = "right",
}
`;
      const result = extractor.extract(source, 'direction.ts');

      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].isStringEnum).toBe(true);
      expect(result.enums[0].backingType).toBe('string');
    });

    it('should extract const enum', () => {
      const source = `
export const enum Color {
  RED,
  GREEN,
  BLUE,
}
`;
      const result = extractor.extract(source, 'color.ts');

      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].modifiers).toContain('const');
    });

    it('should extract non-exported enum', () => {
      const source = `
enum InternalState {
  INIT,
  READY,
}
`;
      const result = extractor.extract(source, 'state.ts');

      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].isExported).toBe(false);
    });
  });

  describe('quality metrics', () => {
    it('should report regex method', () => {
      const source = `export const TEST = 1;`;
      const result = extractor.extract(source, 'test.ts');

      expect(result.quality.method).toBe('regex');
      expect(result.quality.usedFallback).toBe(true);
    });

    it('should count items extracted', () => {
      const source = `
export const A = 1;
export const B = 2;
export enum Status { X, Y }
`;
      const result = extractor.extract(source, 'test.ts');

      expect(result.quality.itemsExtracted).toBe(3); // 2 constants + 1 enum
    });
  });
});
