/**
 * Tests for xUnit Patterns Detector
 */

import { describe, it, expect } from 'vitest';
import { XUnitPatternsDetector } from '../xunit-patterns-detector.js';

describe('XUnitPatternsDetector', () => {
  const detector = new XUnitPatternsDetector();

  describe('analyzeXUnitPatterns', () => {
    it('should detect [Fact] tests', () => {
      const content = `
public class UserServiceTests
{
    [Fact]
    public void GetUser_ReturnsUser_WhenUserExists()
    {
        // Arrange, Act, Assert
    }

    [Fact]
    public async Task CreateUser_ThrowsException_WhenEmailInvalid()
    {
        // Arrange, Act, Assert
    }
}
`;
      const analysis = detector.analyzeXUnitPatterns(content, 'UserServiceTests.cs');
      
      expect(analysis.factCount).toBe(2);
      expect(analysis.patterns.filter(p => p.type === 'fact')).toHaveLength(2);
    });

    it('should detect [Theory] with [InlineData]', () => {
      const content = `
public class CalculatorTests
{
    [Theory]
    [InlineData(1, 2, 3)]
    [InlineData(5, 5, 10)]
    [InlineData(-1, 1, 0)]
    public void Add_ReturnsCorrectSum(int a, int b, int expected)
    {
        var result = Calculator.Add(a, b);
        Assert.Equal(expected, result);
    }
}
`;
      const analysis = detector.analyzeXUnitPatterns(content, 'CalculatorTests.cs');
      
      expect(analysis.theoryCount).toBe(1);
      expect(analysis.patterns.filter(p => p.type === 'inline-data')).toHaveLength(3);
    });

    it('should detect [MemberData]', () => {
      const content = `
public class ValidationTests
{
    public static IEnumerable<object[]> TestData =>
        new List<object[]>
        {
            new object[] { "valid@email.com", true },
            new object[] { "invalid", false },
        };

    [Theory]
    [MemberData(nameof(TestData))]
    public void ValidateEmail_ReturnsExpectedResult(string email, bool expected)
    {
        var result = Validator.ValidateEmail(email);
        Assert.Equal(expected, result);
    }
}
`;
      const analysis = detector.analyzeXUnitPatterns(content, 'ValidationTests.cs');
      
      expect(analysis.patterns.some(p => p.type === 'member-data')).toBe(true);
      expect(analysis.patterns.find(p => p.type === 'member-data')?.dataSource).toBe('TestData');
    });

    it('should detect [ClassData]', () => {
      const content = `
public class ComplexTests
{
    [Theory]
    [ClassData(typeof(ComplexTestData))]
    public void ProcessData_HandlesComplexScenarios(ComplexInput input, ComplexOutput expected)
    {
        var result = Processor.Process(input);
        Assert.Equal(expected, result);
    }
}
`;
      const analysis = detector.analyzeXUnitPatterns(content, 'ComplexTests.cs');
      
      expect(analysis.patterns.some(p => p.type === 'class-data')).toBe(true);
      expect(analysis.patterns.find(p => p.type === 'class-data')?.dataSource).toBe('ComplexTestData');
    });

    it('should detect IClassFixture', () => {
      const content = `
public class IntegrationTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public IntegrationTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task GetUsers_ReturnsSuccessStatusCode()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/users");
        response.EnsureSuccessStatusCode();
    }
}
`;
      const analysis = detector.analyzeXUnitPatterns(content, 'IntegrationTests.cs');
      
      expect(analysis.usesFixtures).toBe(true);
      expect(analysis.patterns.some(p => p.type === 'class-fixture')).toBe(true);
    });

    it('should detect ITestOutputHelper', () => {
      const content = `
public class DiagnosticTests
{
    private readonly ITestOutputHelper _output;

    public DiagnosticTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public void Test_WithOutput()
    {
        _output.WriteLine("Starting test...");
        // Test logic
        _output.WriteLine("Test completed");
    }
}
`;
      const analysis = detector.analyzeXUnitPatterns(content, 'DiagnosticTests.cs');
      
      expect(analysis.usesTestOutput).toBe(true);
      expect(analysis.patterns.some(p => p.type === 'output')).toBe(true);
    });

    it('should detect test naming patterns', () => {
      const content = `
public class NamingTests
{
    [Fact]
    public void GetUser_Should_ReturnUser_When_UserExists()
    {
    }

    [Fact]
    public void Given_ValidInput_When_Processing_Then_ReturnsSuccess()
    {
    }
}
`;
      const analysis = detector.analyzeXUnitPatterns(content, 'NamingTests.cs');
      
      expect(analysis.namingPatterns).toContain('Should_When');
      expect(analysis.namingPatterns).toContain('Given_When_Then');
    });
  });

  describe('detect', () => {
    it('should return patterns for xUnit test files', async () => {
      const context = {
        content: `
using Xunit;

public class SampleTests
{
    [Fact]
    public void Test1() { }
    
    [Theory]
    [InlineData(1)]
    public void Test2(int value) { }
}
`,
        file: 'SampleTests.cs',
        language: 'csharp' as const,
        isTestFile: true,
        isTypeDefinition: false,
      };

      const result = await detector.detect(context);
      
      expect(result.patterns.length).toBeGreaterThan(0);
    });

    it('should return empty result for non-test files', async () => {
      const context = {
        content: `
public class UserService
{
    public User GetUser(int id) => new User();
}
`,
        file: 'UserService.cs',
        language: 'csharp' as const,
        isTestFile: false,
        isTypeDefinition: false,
      };

      const result = await detector.detect(context);
      
      expect(result.patterns).toHaveLength(0);
    });
  });

  describe('metadata', () => {
    it('should have correct detector metadata', () => {
      expect(detector.id).toBe('testing/xunit-patterns');
      expect(detector.category).toBe('testing');
      expect(detector.supportedLanguages).toContain('csharp');
    });
  });
});
