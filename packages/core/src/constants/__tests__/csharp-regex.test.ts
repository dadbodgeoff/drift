/**
 * C# Constant Regex Extractor Tests
 */

import { describe, it, expect } from 'vitest';
import { CSharpConstantRegexExtractor } from '../extractors/regex/csharp-regex.js';

describe('CSharpConstantRegexExtractor', () => {
  const extractor = new CSharpConstantRegexExtractor();

  describe('Const Fields', () => {
    it('should extract public const fields', () => {
      const source = `
public class Config
{
    public const int MaxRetries = 3;
    public const string ApiUrl = "https://api.example.com";
    public const double Timeout = 30.5;
}
`;
      const result = extractor.extract(source, 'Config.cs');
      
      expect(result.constants).toHaveLength(3);
      expect(result.constants[0].name).toBe('MaxRetries');
      expect(result.constants[0].value).toBe(3);
      expect(result.constants[0].type).toBe('int');
      expect(result.constants[0].modifiers).toContain('const');
    });

    it('should extract private const fields', () => {
      const source = `
public class Config
{
    private const string SecretKey = "secret123";
    private const int InternalLimit = 100;
}
`;
      const result = extractor.extract(source, 'Config.cs');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].isExported).toBe(false);
    });

    it('should handle internal const fields', () => {
      const source = `
internal class InternalConfig
{
    internal const int BufferSize = 4096;
}
`;
      const result = extractor.extract(source, 'InternalConfig.cs');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].isExported).toBe(false);
    });
  });

  describe('Static Readonly Fields', () => {
    it('should extract static readonly fields', () => {
      const source = `
public class Config
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);
}
`;
      const result = extractor.extract(source, 'Config.cs');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].modifiers).toContain('static');
      expect(result.constants[0].modifiers).toContain('readonly');
    });

    it('should handle private static readonly', () => {
      const source = `
public class Config
{
    private static readonly object Lock = new object();
}
`;
      const result = extractor.extract(source, 'Config.cs');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].isExported).toBe(false);
    });
  });

  describe('Enum Extraction', () => {
    it('should extract basic enum', () => {
      const source = `
public enum Status
{
    Pending,
    Active,
    Completed
}
`;
      const result = extractor.extract(source, 'Status.cs');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe('Status');
      expect(result.enums[0].members).toHaveLength(3);
      expect(result.enums[0].members[0].name).toBe('Pending');
      expect(result.enums[0].members[0].value).toBe(0);
    });

    it('should extract enum with explicit values', () => {
      const source = `
public enum Priority
{
    Low = 1,
    Medium = 5,
    High = 10
}
`;
      const result = extractor.extract(source, 'Priority.cs');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].members[0].value).toBe(1);
      expect(result.enums[0].members[1].value).toBe(5);
      expect(result.enums[0].members[2].value).toBe(10);
    });

    it('should extract [Flags] enum', () => {
      const source = `
[Flags]
public enum Permissions
{
    None = 0,
    Read = 1,
    Write = 2,
    Execute = 4,
    All = Read | Write | Execute
}
`;
      const result = extractor.extract(source, 'Permissions.cs');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].isFlags).toBe(true);
      expect(result.enums[0].decorators).toContain('Flags');
    });

    it('should extract enum with backing type', () => {
      const source = `
public enum SmallEnum : byte
{
    A,
    B,
    C
}
`;
      const result = extractor.extract(source, 'SmallEnum.cs');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].backingType).toBe('byte');
    });

    it('should extract enum with hex values', () => {
      const source = `
public enum Flags
{
    None = 0x0,
    Flag1 = 0x1,
    Flag2 = 0x2,
    Flag3 = 0x4
}
`;
      const result = extractor.extract(source, 'Flags.cs');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].members[0].value).toBe(0);
      expect(result.enums[0].members[1].value).toBe(1);
      expect(result.enums[0].members[2].value).toBe(2);
    });

    it('should handle private enum', () => {
      const source = `
private enum InternalState
{
    Init,
    Running,
    Stopped
}
`;
      const result = extractor.extract(source, 'Internal.cs');
      
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].isExported).toBe(false);
    });
  });

  describe('String Literals', () => {
    it('should handle regular strings', () => {
      const source = `
public class Strings
{
    public const string Regular = "regular string";
}
`;
      const result = extractor.extract(source, 'Strings.cs');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].value).toBe('regular string');
    });

    it('should handle verbatim strings', () => {
      const source = `
public class Strings
{
    public const string Path = @"C:\\Users\\Test";
}
`;
      const result = extractor.extract(source, 'Strings.cs');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].value).toBe('C:\\Users\\Test');
    });

    it('should handle interpolated strings', () => {
      const source = `
public class Strings
{
    public const string Template = $"Hello {name}";
}
`;
      const result = extractor.extract(source, 'Strings.cs');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].value).toBe('Hello {name}');
    });
  });

  describe('Numeric Types', () => {
    it('should handle decimal literals', () => {
      const source = `
public class Numbers
{
    public const decimal Price = 19.99m;
    public const decimal Tax = 0.08M;
}
`;
      const result = extractor.extract(source, 'Numbers.cs');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBeCloseTo(19.99);
    });

    it('should handle long literals', () => {
      const source = `
public class Numbers
{
    public const long BigNumber = 9999999999L;
    public const ulong UnsignedBig = 18446744073709551615UL;
}
`;
      const result = extractor.extract(source, 'Numbers.cs');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe(9999999999);
    });

    it('should handle float and double', () => {
      const source = `
public class Numbers
{
    public const float Pi = 3.14f;
    public const double PrecisePi = 3.14159265359d;
}
`;
      const result = extractor.extract(source, 'Numbers.cs');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBeCloseTo(3.14);
    });
  });

  describe('Struct and Record', () => {
    it('should extract constants from struct', () => {
      const source = `
public struct Point
{
    public const int Dimensions = 2;
}
`;
      const result = extractor.extract(source, 'Point.cs');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].parentName).toBe('Point');
    });

    it('should extract constants from record', () => {
      const source = `
public record Config
{
    public const string Version = "1.0.0";
}
`;
      const result = extractor.extract(source, 'Config.cs');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].parentName).toBe('Config');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty source', () => {
      const result = extractor.extract('', 'Empty.cs');
      expect(result.constants).toHaveLength(0);
      expect(result.enums).toHaveLength(0);
    });

    it('should handle boolean constants', () => {
      const source = `
public class Flags
{
    public const bool Debug = true;
    public const bool Production = false;
}
`;
      const result = extractor.extract(source, 'Flags.cs');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe(true);
      expect(result.constants[1].value).toBe(false);
    });

    it('should handle null constants', () => {
      const source = `
public class Defaults
{
    public const string DefaultValue = null;
}
`;
      const result = extractor.extract(source, 'Defaults.cs');
      
      expect(result.constants).toHaveLength(1);
      expect(result.constants[0].value).toBe(null);
    });

    it('should handle character literals', () => {
      const source = `
public class Chars
{
    public const char Separator = ',';
    public const char Newline = '\\n';
}
`;
      const result = extractor.extract(source, 'Chars.cs');
      
      expect(result.constants).toHaveLength(2);
      expect(result.constants[0].value).toBe(',');
    });
  });

  describe('Quality Metrics', () => {
    it('should report correct quality metrics', () => {
      const source = `
public class Config
{
    public const int MaxRetries = 3;
}
`;
      const result = extractor.extract(source, 'Config.cs');
      
      expect(result.quality.method).toBe('regex');
      expect(result.quality.confidence).toBeGreaterThan(0);
      expect(result.quality.itemsExtracted).toBe(1);
    });
  });
});
