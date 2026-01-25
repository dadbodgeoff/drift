/**
 * PHP Constant Regex Extractor Tests
 */

import { describe, it, expect } from 'vitest';
import { PhpConstantRegexExtractor } from '../extractors/regex/php-regex.js';

describe('PhpConstantRegexExtractor', () => {
  const extractor = new PhpConstantRegexExtractor();

  describe('Class Constants', () => {
    it('should extract public class constants', () => {
      const source = `<?php
class Config
{
    public const MAX_RETRIES = 3;
    public const API_URL = 'https://api.example.com';
    public const TIMEOUT = 30.5;
}
`;
      const result = extractor.extract(source, 'Config.php');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].name).toBe('MAX_RETRIES');
      expect(result.constants[0].value).toBe(3);
      expect(result.constants[0].modifiers).toContain('const');
      expect(result.constants[0].modifiers).toContain('public');
    });

    it('should extract private class constants', () => {
      const source = `<?php
class Config
{
    private const SECRET_KEY = 'secret123';
    private const INTERNAL_LIMIT = 100;
}
`;
      const result = extractor.extract(source, 'Config.php');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].isExported).toBe(false);
    });

    it('should extract protected class constants', () => {
      const source = `<?php
class BaseConfig
{
    protected const BASE_URL = 'https://base.example.com';
}
`;
      const result = extractor.extract(source, 'BaseConfig.php');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].isExported).toBe(false);
    });

    it('should handle constants without visibility (default public)', () => {
      const source = `<?php
class Config
{
    const VERSION = '1.0.0';
}
`;
      const result = extractor.extract(source, 'Config.php');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].isExported).toBe(true);
    });
  });

  describe('define() Constants', () => {
    it('should extract define() with single quotes', () => {
      const source = `<?php
define('APP_VERSION', '1.0.0');
define('MAX_SIZE', 1000);
define('DEBUG_MODE', true);
`;
      const result = extractor.extract(source, 'constants.php');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].name).toBe('APP_VERSION');
      expect(result.constants[0].value).toBe('1.0.0');
      expect(result.constants[1].name).toBe('MAX_SIZE');
      expect(result.constants[1].value).toBe(1000);
    });

    it('should extract define() with double quotes', () => {
      const source = `<?php
define("API_KEY", "secret123");
define("BASE_URL", "https://api.example.com");
`;
      const result = extractor.extract(source, 'constants.php');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].name).toBe('API_KEY');
      expect(result.constants[0].value).toBe('secret123');
    });

    it('should handle boolean values in define()', () => {
      const source = `<?php
define('DEBUG', true);
define('PRODUCTION', false);
`;
      const result = extractor.extract(source, 'constants.php');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe(true);
      expect(result.constants[1].value).toBe(false);
    });

    it('should handle null values in define()', () => {
      const source = `<?php
define('DEFAULT_VALUE', null);
`;
      const result = extractor.extract(source, 'constants.php');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].value).toBe(null);
    });
  });

  describe('PHP 8.1 Enums', () => {
    it('should extract basic enum', () => {
      const source = `<?php
enum Status
{
    case Pending;
    case Active;
    case Completed;
}
`;
      const result = extractor.extract(source, 'Status.php');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe('Status');
      expect(result.enums[0].members).toHaveLength(3);
      expect(result.enums[0].members[0].name).toBe('Pending');
    });

    it('should extract backed enum with int', () => {
      const source = `<?php
enum Priority: int
{
    case Low = 1;
    case Medium = 2;
    case High = 3;
}
`;
      const result = extractor.extract(source, 'Priority.php');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].backingType).toBe('int');
      expect(result.enums[0].isStringEnum).toBe(false);
      expect(result.enums[0].members[0].value).toBe(1);
      expect(result.enums[0].members[1].value).toBe(2);
    });

    it('should extract backed enum with string', () => {
      const source = `<?php
enum Color: string
{
    case Red = 'red';
    case Green = 'green';
    case Blue = 'blue';
}
`;
      const result = extractor.extract(source, 'Color.php');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].backingType).toBe('string');
      expect(result.enums[0].isStringEnum).toBe(true);
      expect(result.enums[0].members[0].value).toBe('red');
    });

    it('should handle enum with methods', () => {
      const source = `<?php
enum Status: string
{
    case Pending = 'pending';
    case Active = 'active';
    
    public function label(): string
    {
        return match($this) {
            self::Pending => 'Pending',
            self::Active => 'Active',
        };
    }
}
`;
      const result = extractor.extract(source, 'Status.php');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].members).toHaveLength(2);
    });
  });

  describe('Qualified Names', () => {
    it('should generate correct qualified names for class constants', () => {
      const source = `<?php
class Config
{
    public const MAX_SIZE = 100;
}
`;
      const result = extractor.extract(source, 'Config.php');
      
      expect(result.constants[0].qualifiedName).toBe('Config::MAX_SIZE');
    });

    it('should handle constants outside classes', () => {
      const source = `<?php
define('GLOBAL_CONST', 'value');
`;
      const result = extractor.extract(source, 'constants.php');
      
      expect(result.constants[0].qualifiedName).toBe('GLOBAL_CONST');
    });
  });

  describe('String Literals', () => {
    it('should handle single-quoted strings', () => {
      const source = `<?php
class Strings
{
    public const SINGLE = 'single quoted';
}
`;
      const result = extractor.extract(source, 'Strings.php');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].value).toBe('single quoted');
    });

    it('should handle double-quoted strings', () => {
      const source = `<?php
class Strings
{
    public const DOUBLE = "double quoted";
}
`;
      const result = extractor.extract(source, 'Strings.php');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].value).toBe('double quoted');
    });
  });

  describe('Numeric Types', () => {
    it('should handle integers', () => {
      const source = `<?php
class Numbers
{
    public const INT_VALUE = 42;
    public const NEGATIVE = -10;
}
`;
      const result = extractor.extract(source, 'Numbers.php');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe(42);
      expect(result.constants[1].value).toBe(-10);
    });

    it('should handle floats', () => {
      const source = `<?php
class Numbers
{
    public const PI = 3.14159;
    public const RATE = 0.05;
}
`;
      const result = extractor.extract(source, 'Numbers.php');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBeCloseTo(3.14159);
      expect(result.constants[1].value).toBeCloseTo(0.05);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty source', () => {
      const result = extractor.extract('', 'Empty.php');
      expect(result.constants).toHaveLength(0);
      expect(result.enums).toHaveLength(0);
    });

    it('should handle class extending another', () => {
      const source = `<?php
class ChildConfig extends BaseConfig
{
    public const CHILD_VALUE = 'child';
}
`;
      const result = extractor.extract(source, 'ChildConfig.php');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].parentName).toBe('ChildConfig');
    });

    it('should handle class implementing interface', () => {
      const source = `<?php
class Config implements ConfigInterface
{
    public const VERSION = '1.0.0';
}
`;
      const result = extractor.extract(source, 'Config.php');
      
      expect(result.constants).toHaveLength(1);
    });

    it('should handle namespaced classes', () => {
      const source = `<?php
namespace App\\Config;

class Settings
{
    public const DEBUG = true;
}
`;
      const result = extractor.extract(source, 'Settings.php');
      
      expect(result.constants).toHaveLength(1);
    });
  });

  describe('Quality Metrics', () => {
    it('should report correct quality metrics', () => {
      const source = `<?php
class Config
{
    public const MAX_RETRIES = 3;
}
`;
      const result = extractor.extract(source, 'Config.php');
      
      expect(result.quality.method).toBe('regex');
      expect(result.quality.confidence).toBeGreaterThan(0);
      expect(result.quality.itemsExtracted).toBe(1);
    });
  });
});
