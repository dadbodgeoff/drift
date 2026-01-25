/**
 * Java Constant Regex Extractor Tests
 */

import { describe, it, expect } from 'vitest';
import { JavaConstantRegexExtractor } from '../extractors/regex/java-regex.js';

describe('JavaConstantRegexExtractor', () => {
  const extractor = new JavaConstantRegexExtractor();

  describe('Static Final Fields', () => {
    it('should extract public static final constants', () => {
      const source = `
public class Config {
    public static final int MAX_RETRIES = 3;
    public static final String API_URL = "https://api.example.com";
    public static final double TIMEOUT = 30.5;
}
`;
      const result = extractor.extract(source, 'Config.java');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].name).toBe('MAX_RETRIES');
      expect(result.constants[0].value).toBe(3);
      expect(result.constants[0].type).toBe('int');
      expect(result.constants[0].modifiers).toContain('static');
      expect(result.constants[0].modifiers).toContain('final');
    });

    it('should extract private static final constants', () => {
      const source = `
public class Config {
    private static final String SECRET_KEY = "secret123";
    private static final int INTERNAL_LIMIT = 100;
}
`;
      const result = extractor.extract(source, 'Config.java');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].isExported).toBe(false);
      expect(result.constants[1].isExported).toBe(false);
    });

    it('should handle different numeric types', () => {
      const source = `
public class Numbers {
    public static final long BIG_NUMBER = 9999999999L;
    public static final float PI_APPROX = 3.14f;
    public static final double PRECISE_PI = 3.14159265359;
}
`;
      const result = extractor.extract(source, 'Numbers.java');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].value).toBe(9999999999);
      expect(result.constants[1].value).toBeCloseTo(3.14);
    });

    it('should handle boolean constants', () => {
      const source = `
public class Flags {
    public static final boolean DEBUG = true;
    public static final boolean PRODUCTION = false;
}
`;
      const result = extractor.extract(source, 'Flags.java');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe(true);
      expect(result.constants[1].value).toBe(false);
    });
  });

  describe('Interface Constants', () => {
    it('should extract interface constants', () => {
      const source = `
public interface Constants {
    String VERSION = "1.0.0";
    int MAX_SIZE = 1000;
    double RATE = 0.05;
}
`;
      const result = extractor.extract(source, 'Constants.java');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].kind).toBe('interface_constant');
      expect(result.constants[0].parentName).toBe('Constants');
      expect(result.constants[0].parentType).toBe('interface');
      expect(result.constants[0].modifiers).toContain('public');
      expect(result.constants[0].modifiers).toContain('static');
      expect(result.constants[0].modifiers).toContain('final');
    });

    it('should handle interface extending other interfaces', () => {
      const source = `
public interface ExtendedConstants extends BaseConstants {
    String EXTENDED_VALUE = "extended";
}
`;
      const result = extractor.extract(source, 'ExtendedConstants.java');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].parentName).toBe('ExtendedConstants');
    });
  });

  describe('Enum Extraction', () => {
    it('should extract basic enum', () => {
      const source = `
public enum Status {
    PENDING,
    ACTIVE,
    COMPLETED
}
`;
      const result = extractor.extract(source, 'Status.java');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe('Status');
      expect(result.enums[0].members).toHaveLength(3);
      expect(result.enums[0].members[0].name).toBe('PENDING');
      expect(result.enums[0].members[0].value).toBe(0);
      expect(result.enums[0].members[1].value).toBe(1);
    });

    it('should extract enum with constructor', () => {
      const source = `
public enum Priority {
    LOW(1),
    MEDIUM(2),
    HIGH(3);
    
    private final int value;
    
    Priority(int value) {
        this.value = value;
    }
}
`;
      const result = extractor.extract(source, 'Priority.java');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].members).toHaveLength(3);
    });

    it('should extract private enum', () => {
      const source = `
private enum InternalState {
    INIT,
    RUNNING,
    STOPPED
}
`;
      const result = extractor.extract(source, 'Internal.java');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].isExported).toBe(false);
    });

    it('should handle enum implementing interface', () => {
      const source = `
public enum Operation implements Executable {
    ADD,
    SUBTRACT,
    MULTIPLY
}
`;
      const result = extractor.extract(source, 'Operation.java');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe('Operation');
    });
  });

  describe('Generic Types', () => {
    it('should handle generic type constants', () => {
      const source = `
public class Container {
    public static final List<String> ALLOWED_TYPES = Arrays.asList("A", "B");
    public static final Map<String, Integer> LIMITS = new HashMap<>();
}
`;
      const result = extractor.extract(source, 'Container.java');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].type).toBe('List<String>');
      expect(result.constants[1].type).toBe('Map<String, Integer>');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty source', () => {
      const result = extractor.extract('', 'Empty.java');
      expect(result.constants).toHaveLength(0);
      expect(result.enums).toHaveLength(0);
    });

    it('should handle class without constants', () => {
      const source = `
public class NoConstants {
    private int value;
    
    public int getValue() {
        return value;
    }
}
`;
      const result = extractor.extract(source, 'NoConstants.java');
      expect(result.constants).toHaveLength(0);
    });

    it('should handle null values', () => {
      const source = `
public class Defaults {
    public static final String DEFAULT_VALUE = null;
}
`;
      const result = extractor.extract(source, 'Defaults.java');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].value).toBe(null);
    });

    it('should handle character literals', () => {
      const source = `
public class Chars {
    public static final char SEPARATOR = ',';
    public static final char NEWLINE = '\\n';
}
`;
      const result = extractor.extract(source, 'Chars.java');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe(',');
    });
  });

  describe('Qualified Names', () => {
    it('should generate correct qualified names', () => {
      const source = `
public class Config {
    public static final int MAX_SIZE = 100;
}
`;
      const result = extractor.extract(source, 'Config.java');
      
      expect(result.constants[0].qualifiedName).toBe('Config.MAX_SIZE');
    });
  });

  describe('Quality Metrics', () => {
    it('should report correct quality metrics', () => {
      const source = `
public class Config {
    public static final int MAX_RETRIES = 3;
}
`;
      const result = extractor.extract(source, 'Config.java');
      
      expect(result.quality.method).toBe('regex');
      expect(result.quality.confidence).toBeGreaterThan(0);
      expect(result.quality.itemsExtracted).toBe(1);
    });
  });
});
