/**
 * Tests for ASP.NET ILogger Patterns Detector
 */

import { describe, it, expect } from 'vitest';
import { ILoggerPatternsDetector } from '../ilogger-patterns-detector.js';

describe('ILoggerPatternsDetector', () => {
  const detector = new ILoggerPatternsDetector();

  describe('analyzeILoggerPatterns', () => {
    it('should detect ILogger<T> injection', () => {
      const content = `
public class UserService
{
    private readonly ILogger<UserService> _logger;

    public UserService(ILogger<UserService> logger)
    {
        _logger = logger;
    }
}
`;
      const analysis = detector.analyzeILoggerPatterns(content, 'UserService.cs');
      
      expect(analysis.loggerTypes).toContain('UserService');
      expect(analysis.patterns.some(p => p.type === 'logger-injection')).toBe(true);
    });

    it('should detect log level calls', () => {
      const content = `
public void Process()
{
    _logger.LogDebug("Starting process");
    _logger.LogInformation("Processing item");
    _logger.LogWarning("Item count is low");
    _logger.LogError("Failed to process");
    _logger.LogCritical("System failure");
}
`;
      const analysis = detector.analyzeILoggerPatterns(content, 'Service.cs');
      
      expect(analysis.logLevels).toContain('Debug');
      expect(analysis.logLevels).toContain('Information');
      expect(analysis.logLevels).toContain('Warning');
      expect(analysis.logLevels).toContain('Error');
      expect(analysis.logLevels).toContain('Critical');
    });

    it('should detect structured logging', () => {
      const content = `
public void ProcessUser(int userId, string action)
{
    _logger.LogInformation("User {UserId} performed {Action}", userId, action);
}
`;
      const analysis = detector.analyzeILoggerPatterns(content, 'Service.cs');
      
      expect(analysis.usesStructuredLogging).toBe(true);
      expect(analysis.patterns.some(p => p.type === 'structured-log')).toBe(true);
    });

    it('should detect log scopes', () => {
      const content = `
public async Task ProcessOrder(int orderId)
{
    using (_logger.BeginScope("OrderId: {OrderId}", orderId))
    {
        _logger.LogInformation("Processing order");
        await ProcessItems();
        _logger.LogInformation("Order processed");
    }
}
`;
      const analysis = detector.analyzeILoggerPatterns(content, 'OrderService.cs');
      
      expect(analysis.usesLogScopes).toBe(true);
      expect(analysis.patterns.some(p => p.type === 'log-scope')).toBe(true);
    });

    it('should detect high-performance logging with LoggerMessage', () => {
      const content = `
public partial class UserService
{
    [LoggerMessage(Level = LogLevel.Information, Message = "User {UserId} logged in")]
    static partial void LogUserLogin(ILogger logger, int userId);

    private static readonly Action<ILogger, int, Exception?> _logUserCreated =
        LoggerMessage.Define<int>(LogLevel.Information, new EventId(1), "User {UserId} created");
}
`;
      const analysis = detector.analyzeILoggerPatterns(content, 'UserService.cs');
      
      expect(analysis.usesHighPerformanceLogging).toBe(true);
      expect(analysis.patterns.some(p => p.type === 'logger-message')).toBe(true);
    });

    it('should flag string interpolation in log calls', () => {
      const content = `
public void Process(int id)
{
    _logger.LogInformation($"Processing item {id}");
}
`;
      const analysis = detector.analyzeILoggerPatterns(content, 'Service.cs');
      
      expect(analysis.issues.length).toBeGreaterThan(0);
      expect(analysis.issues[0]).toContain('String interpolation');
    });

    it('should flag string concatenation in log calls', () => {
      const content = `
public void Process(string name)
{
    _logger.LogInformation("Processing " + name);
}
`;
      const analysis = detector.analyzeILoggerPatterns(content, 'Service.cs');
      
      expect(analysis.issues.length).toBeGreaterThan(0);
      expect(analysis.issues[0]).toContain('String concatenation');
    });
  });

  describe('detect', () => {
    it('should create violations for string interpolation', async () => {
      const context = {
        content: `
public void Log(int id)
{
    _logger.LogError($"Error processing {id}");
}
`,
        file: 'Service.cs',
        language: 'csharp' as const,
        isTestFile: false,
        isTypeDefinition: false,
      };

      const result = await detector.detect(context);
      
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]?.message).toContain('String interpolation');
    });

    it('should return empty result for non-logging files', async () => {
      const context = {
        content: `
public class Calculator
{
    public int Add(int a, int b) => a + b;
}
`,
        file: 'Calculator.cs',
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
      expect(detector.id).toBe('logging/aspnet-ilogger-patterns');
      expect(detector.category).toBe('logging');
      expect(detector.supportedLanguages).toContain('csharp');
    });
  });
});
