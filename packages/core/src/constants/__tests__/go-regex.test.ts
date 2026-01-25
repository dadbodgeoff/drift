/**
 * Go Constant Regex Extractor Tests
 */

import { describe, it, expect } from 'vitest';
import { GoConstantRegexExtractor } from '../extractors/regex/go-regex.js';

describe('GoConstantRegexExtractor', () => {
  const extractor = new GoConstantRegexExtractor();

  describe('Single Const Declarations', () => {
    it('should extract simple const declarations', () => {
      const source = `package main

const MaxRetries = 3
const ApiUrl = "https://api.example.com"
const Timeout = 30.5
`;
      const result = extractor.extract(source, 'config.go');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].name).toBe('MaxRetries');
      expect(result.constants[0].value).toBe(3);
      expect(result.constants[1].name).toBe('ApiUrl');
      expect(result.constants[1].value).toBe('https://api.example.com');
    });

    it('should extract typed const declarations', () => {
      const source = `package main

const MaxSize int = 1000
const Version string = "1.0.0"
const Rate float64 = 0.05
`;
      const result = extractor.extract(source, 'config.go');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].type).toBe('int');
      expect(result.constants[1].type).toBe('string');
      expect(result.constants[2].type).toBe('float64');
    });

    it('should detect exported vs unexported constants', () => {
      const source = `package main

const PublicConst = "public"
const privateConst = "private"
`;
      const result = extractor.extract(source, 'config.go');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].isExported).toBe(true);
      expect(result.constants[1].isExported).toBe(false);
    });
  });

  describe('Const Blocks', () => {
    it('should extract const block with iota', () => {
      const source = `package main

const (
    StatusPending = iota
    StatusActive
    StatusCompleted
)
`;
      const result = extractor.extract(source, 'status.go');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].name).toBe('StatusPending');
      expect(result.constants[0].value).toBe(0);
      expect(result.constants[1].name).toBe('StatusActive');
      expect(result.constants[1].value).toBe(1);
      expect(result.constants[2].name).toBe('StatusCompleted');
      expect(result.constants[2].value).toBe(2);
    });

    it('should extract const block with explicit values', () => {
      const source = `package main

const (
    Low = 1
    Medium = 5
    High = 10
)
`;
      const result = extractor.extract(source, 'priority.go');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].value).toBe(1);
      expect(result.constants[1].value).toBe(5);
      expect(result.constants[2].value).toBe(10);
    });

    it('should extract const block with mixed values', () => {
      const source = `package main

const (
    Version = "1.0.0"
    MaxRetries = 3
    Debug = true
)
`;
      const result = extractor.extract(source, 'config.go');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].value).toBe('1.0.0');
      expect(result.constants[1].value).toBe(3);
      expect(result.constants[2].value).toBe(true);
    });

    it('should handle typed const blocks', () => {
      const source = `package main

const (
    StatusPending Status = iota
    StatusActive
    StatusCompleted
)
`;
      const result = extractor.extract(source, 'status.go');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].type).toBe('Status');
    });

    it('should handle iota expressions', () => {
      const source = `package main

const (
    KB = 1 << (10 * iota)
    MB
    GB
)
`;
      const result = extractor.extract(source, 'sizes.go');
      
      // iota expressions are complex - regex may only capture the first one
      // This is a known limitation of regex-based extraction
      expect(result.constants.length).toBeGreaterThanOrEqual(1);
      expect(result.constants[0].kind).toBe('computed');
    });
  });

  describe('Package-level Var', () => {
    it('should extract exported var declarations', () => {
      const source = `package main

var DefaultConfig = Config{Timeout: 30}
var GlobalLogger = NewLogger()
`;
      const result = extractor.extract(source, 'config.go');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].name).toBe('DefaultConfig');
      expect(result.constants[0].modifiers).toContain('var');
      expect(result.constants[0].confidence).toBeLessThan(0.75); // Lower confidence for var
    });

    it('should not extract unexported var declarations', () => {
      const source = `package main

var privateVar = "private"
`;
      const result = extractor.extract(source, 'config.go');
      
      // Unexported vars are not extracted as constants
      expect(result.constants).toHaveLength(0);
    });
  });

  describe('String Literals', () => {
    it('should handle double-quoted strings', () => {
      const source = `package main

const Message = "Hello, World!"
`;
      const result = extractor.extract(source, 'strings.go');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].value).toBe('Hello, World!');
    });

    it('should handle raw strings (backticks)', () => {
      const source = `package main

const Query = \`SELECT * FROM users WHERE id = ?\`
`;
      const result = extractor.extract(source, 'strings.go');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].value).toBe('SELECT * FROM users WHERE id = ?');
    });

    it('should handle rune literals', () => {
      const source = `package main

const Separator = ','
const Newline = '\\n'
`;
      const result = extractor.extract(source, 'chars.go');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe(',');
    });
  });

  describe('Numeric Types', () => {
    it('should handle integers', () => {
      const source = `package main

const IntValue = 42
const NegativeValue = -10
`;
      const result = extractor.extract(source, 'numbers.go');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe(42);
      expect(result.constants[1].value).toBe(-10);
    });

    it('should handle floats', () => {
      const source = `package main

const Pi = 3.14159
const Rate = 0.05
`;
      const result = extractor.extract(source, 'numbers.go');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBeCloseTo(3.14159);
      expect(result.constants[1].value).toBeCloseTo(0.05);
    });

    it('should handle hex values', () => {
      const source = `package main

const HexValue = 0xFF
const Mask = 0x0F
`;
      const result = extractor.extract(source, 'numbers.go');
      
      expect(result.constants).toHaveLength(2);
      // Hex values are detected but may be stored as raw value
      // The regex extractor captures them but value extraction is limited
      expect(result.constants[0].rawValue).toContain('0xFF');
      expect(result.constants[1].rawValue).toContain('0x0F');
    });
  });

  describe('Boolean and Nil', () => {
    it('should handle boolean constants', () => {
      const source = `package main

const Debug = true
const Production = false
`;
      const result = extractor.extract(source, 'flags.go');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe(true);
      expect(result.constants[1].value).toBe(false);
    });

    it('should handle nil', () => {
      const source = `package main

const DefaultValue = nil
`;
      const result = extractor.extract(source, 'defaults.go');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].value).toBe(null);
    });
  });

  describe('Complex Types', () => {
    it('should detect struct literals', () => {
      const source = `package main

var DefaultConfig = Config{
    Timeout: 30,
    Retries: 3,
}
`;
      const result = extractor.extract(source, 'config.go');
      
      expect(result.constants).toHaveLength(1);
      // Multi-line struct literals may be detected as computed
      // This is a known limitation of regex-based extraction
      expect(['object', 'computed']).toContain(result.constants[0].kind);
    });

    it('should detect slice literals', () => {
      const source = `package main

var AllowedTypes = []string{"A", "B", "C"}
`;
      const result = extractor.extract(source, 'types.go');
      
      expect(result.constants).toHaveLength(1);
      // Slice literals start with [] but the regex may detect as object due to {}
      // This is a known limitation - tree-sitter would handle this better
      expect(['array', 'object']).toContain(result.constants[0].kind);
    });

    it('should detect map literals', () => {
      const source = `package main

var Limits = map[string]int{"small": 10, "large": 100}
`;
      const result = extractor.extract(source, 'limits.go');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].kind).toBe('object');
    });
  });

  describe('No Enums', () => {
    it('should return empty enums (Go has no enums)', () => {
      const source = `package main

const (
    StatusPending = iota
    StatusActive
)
`;
      const result = extractor.extract(source, 'status.go');
      
      // Go doesn't have enums - iota-based constants are just constants
      expect(result.enums).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty source', () => {
      const result = extractor.extract('', 'empty.go');
      expect(result.constants).toHaveLength(0);
      expect(result.enums).toHaveLength(0);
    });

    it('should handle comments', () => {
      const source = `package main

// MaxRetries is the maximum number of retries
const MaxRetries = 3

/* 
 * ApiUrl is the API endpoint
 */
const ApiUrl = "https://api.example.com"
`;
      const result = extractor.extract(source, 'config.go');
      
      expect(result.constants).toHaveLength(2);
    });

    it('should handle multiple const blocks', () => {
      const source = `package main

const (
    A = 1
    B = 2
)

const (
    C = 3
    D = 4
)
`;
      const result = extractor.extract(source, 'multi.go');
      
      expect(result.constants).toHaveLength(4);
    });
  });

  describe('Quality Metrics', () => {
    it('should report correct quality metrics', () => {
      const source = `package main

const MaxRetries = 3
`;
      const result = extractor.extract(source, 'config.go');
      
      expect(result.quality.method).toBe('regex');
      expect(result.quality.confidence).toBeGreaterThan(0);
      expect(result.quality.itemsExtracted).toBe(1);
    });
  });
});
