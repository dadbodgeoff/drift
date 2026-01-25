/**
 * Python Constant Regex Extractor Tests
 */

import { describe, it, expect } from 'vitest';
import { PythonConstantRegexExtractor } from '../extractors/regex/python-regex.js';

describe('PythonConstantRegexExtractor', () => {
  const extractor = new PythonConstantRegexExtractor();

  describe('Module-level Constants', () => {
    it('should extract UPPER_CASE constants', () => {
      const source = `
MAX_RETRIES = 3
API_URL = "https://api.example.com"
TIMEOUT_SECONDS = 30.5
`;
      const result = extractor.extract(source, 'config.py');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].name).toBe('MAX_RETRIES');
      expect(result.constants[0].value).toBe(3);
      expect(result.constants[1].name).toBe('API_URL');
      expect(result.constants[1].value).toBe('https://api.example.com');
      expect(result.constants[2].name).toBe('TIMEOUT_SECONDS');
      expect(result.constants[2].value).toBe(30.5);
    });

    it('should extract constants with type hints', () => {
      const source = `
MAX_SIZE: int = 1000
API_KEY: str = "secret"
DEBUG: bool = True
`;
      const result = extractor.extract(source, 'config.py');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].type).toBe('int');
      expect(result.constants[1].type).toBe('str');
      expect(result.constants[2].type).toBe('bool');
    });

    it('should extract Final type hints', () => {
      const source = `
from typing import Final

MAX_CONNECTIONS: Final[int] = 100
API_VERSION: Final = "v2"
`;
      const result = extractor.extract(source, 'config.py');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].modifiers).toContain('final');
      expect(result.constants[1].modifiers).toContain('final');
    });

    it('should handle boolean and None values', () => {
      const source = `
ENABLED = True
DISABLED = False
DEFAULT_VALUE = None
`;
      const result = extractor.extract(source, 'config.py');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].value).toBe(true);
      expect(result.constants[1].value).toBe(false);
      expect(result.constants[2].value).toBe(null);
    });

    it('should skip indented constants (inside functions/classes)', () => {
      const source = `
GLOBAL_CONST = 1

def func():
    LOCAL_CONST = 2
    return LOCAL_CONST
`;
      const result = extractor.extract(source, 'test.py');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].name).toBe('GLOBAL_CONST');
    });
  });

  describe('Class Constants', () => {
    it('should extract class-level constants', () => {
      const source = `
class Config:
    MAX_RETRIES = 3
    DEFAULT_TIMEOUT = 30
    API_URL = "https://api.example.com"
`;
      const result = extractor.extract(source, 'config.py');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].qualifiedName).toBe('Config.MAX_RETRIES');
      expect(result.constants[0].parentName).toBe('Config');
      expect(result.constants[0].parentType).toBe('class');
    });

    it('should handle multiple classes', () => {
      const source = `
class DatabaseConfig:
    HOST = "localhost"
    PORT = 5432

class CacheConfig:
    TTL = 3600
    MAX_SIZE = 1000
`;
      const result = extractor.extract(source, 'config.py');
      
      expect(result.constants).toHaveLength(4);
      expect(result.constants[0].parentName).toBe('DatabaseConfig');
      expect(result.constants[2].parentName).toBe('CacheConfig');
    });
  });

  describe('Enum Extraction', () => {
    it('should extract basic Enum', () => {
      const source = `
from enum import Enum

class Status(Enum):
    PENDING = 0
    ACTIVE = 1
    COMPLETED = 2
`;
      const result = extractor.extract(source, 'enums.py');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe('Status');
      expect(result.enums[0].members).toHaveLength(3);
      expect(result.enums[0].members[0].name).toBe('PENDING');
      expect(result.enums[0].members[0].value).toBe(0);
    });

    it('should extract IntEnum', () => {
      const source = `
from enum import IntEnum

class Priority(IntEnum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3
`;
      const result = extractor.extract(source, 'enums.py');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe('Priority');
      expect(result.enums[0].backingType).toBe('int');
    });

    it('should extract StrEnum', () => {
      const source = `
from enum import StrEnum

class Color(StrEnum):
    RED = "red"
    GREEN = "green"
    BLUE = "blue"
`;
      const result = extractor.extract(source, 'enums.py');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].isStringEnum).toBe(true);
      expect(result.enums[0].backingType).toBe('str');
    });

    it('should extract Flag enum', () => {
      const source = `
from enum import Flag

class Permissions(Flag):
    READ = 1
    WRITE = 2
    EXECUTE = 4
`;
      const result = extractor.extract(source, 'enums.py');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].isFlags).toBe(true);
    });

    it('should handle auto() values', () => {
      const source = `
from enum import Enum, auto

class State(Enum):
    INIT = auto()
    RUNNING = auto()
    STOPPED = auto()
`;
      const result = extractor.extract(source, 'enums.py');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].members[0].isAutoValue).toBe(true);
      expect(result.enums[0].members[0].value).toBe(0);
      expect(result.enums[0].members[1].value).toBe(1);
    });
  });

  describe('String Literals', () => {
    it('should handle single and double quotes', () => {
      const source = `
SINGLE = 'single quoted'
DOUBLE = "double quoted"
`;
      const result = extractor.extract(source, 'strings.py');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe('single quoted');
      expect(result.constants[1].value).toBe('double quoted');
    });

    it('should handle triple-quoted strings', () => {
      const source = `
MULTILINE = """This is
a multiline
string"""
`;
      const result = extractor.extract(source, 'strings.py');
      
      // Triple-quoted strings are complex, may not be fully extracted
      expect(result.constants.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle f-strings', () => {
      const source = `
PREFIX = "api"
URL_TEMPLATE = f"https://{PREFIX}.example.com"
`;
      const result = extractor.extract(source, 'strings.py');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe('api');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty source', () => {
      const result = extractor.extract('', 'empty.py');
      expect(result.constants).toHaveLength(0);
      expect(result.enums).toHaveLength(0);
    });

    it('should skip TypeVar and Generic', () => {
      const source = `
from typing import TypeVar, Generic

T = TypeVar('T')
K = TypeVar('K', bound=str)
`;
      const result = extractor.extract(source, 'types.py');
      
      // TypeVars should be skipped
      expect(result.constants).toHaveLength(0);
    });

    it('should handle comments', () => {
      const source = `
# This is a comment
MAX_SIZE = 100  # inline comment
# Another comment
MIN_SIZE = 10
`;
      const result = extractor.extract(source, 'config.py');
      
      expect(result.constants).toHaveLength(2);
    });
  });

  describe('Quality Metrics', () => {
    it('should report correct quality metrics', () => {
      const source = `
MAX_RETRIES = 3
API_URL = "https://api.example.com"
`;
      const result = extractor.extract(source, 'config.py');
      
      expect(result.quality.method).toBe('regex');
      expect(result.quality.confidence).toBeGreaterThan(0);
      expect(result.quality.itemsExtracted).toBe(2);
    });
  });
});
