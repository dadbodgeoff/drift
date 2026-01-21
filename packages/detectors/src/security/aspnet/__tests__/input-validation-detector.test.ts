/**
 * Tests for ASP.NET Input Validation Detector
 */

import { describe, it, expect } from 'vitest';
import { InputValidationDetector } from '../input-validation-detector.js';

describe('InputValidationDetector', () => {
  const detector = new InputValidationDetector();

  describe('analyzeInputValidation', () => {
    it('should detect DataAnnotations', () => {
      const content = `
public class CreateUserRequest
{
    [Required]
    [StringLength(100, MinimumLength = 3)]
    public string Name { get; set; }

    [Required]
    [EmailAddress]
    public string Email { get; set; }

    [Range(18, 120)]
    public int Age { get; set; }
}
`;
      const analysis = detector.analyzeInputValidation(content, 'CreateUserRequest.cs');
      
      expect(analysis.dataAnnotations).toContain('Required');
      expect(analysis.dataAnnotations).toContain('StringLength');
      expect(analysis.dataAnnotations).toContain('EmailAddress');
      expect(analysis.dataAnnotations).toContain('Range');
      expect(analysis.patterns.filter(p => p.type === 'data-annotation').length).toBeGreaterThan(0);
    });

    it('should detect FluentValidation', () => {
      const content = `
public class CreateUserRequestValidator : AbstractValidator<CreateUserRequest>
{
    public CreateUserRequestValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty()
            .MaximumLength(100);

        RuleFor(x => x.Email)
            .NotEmpty()
            .EmailAddress();
    }
}
`;
      const analysis = detector.analyzeInputValidation(content, 'CreateUserRequestValidator.cs');
      
      expect(analysis.usesFluentValidation).toBe(true);
      expect(analysis.patterns.some(p => p.type === 'fluent-validation')).toBe(true);
    });

    it('should detect ModelState checking', () => {
      const content = `
[HttpPost]
public IActionResult Create([FromBody] CreateUserRequest request)
{
    if (!ModelState.IsValid)
    {
        return BadRequest(ModelState);
    }
    
    // Process request
    return Ok();
}
`;
      const analysis = detector.analyzeInputValidation(content, 'UsersController.cs');
      
      expect(analysis.checksModelState).toBe(true);
      expect(analysis.patterns.some(p => p.type === 'model-state')).toBe(true);
    });

    it('should detect custom validation attributes', () => {
      const content = `
public class ValidEmailDomainAttribute : ValidationAttribute
{
    private readonly string _allowedDomain;

    public ValidEmailDomainAttribute(string allowedDomain)
    {
        _allowedDomain = allowedDomain;
    }

    protected override ValidationResult IsValid(object value, ValidationContext context)
    {
        if (value is string email && email.EndsWith(_allowedDomain))
        {
            return ValidationResult.Success;
        }
        return new ValidationResult("Invalid email domain");
    }
}
`;
      const analysis = detector.analyzeInputValidation(content, 'ValidEmailDomainAttribute.cs');
      
      expect(analysis.patterns.some(p => p.type === 'custom-attribute')).toBe(true);
    });

    it('should detect manual validation', () => {
      const content = `
public void Validate(string input)
{
    if (string.IsNullOrEmpty(input))
    {
        throw new ArgumentException("Input cannot be empty");
    }
    
    if (string.IsNullOrWhiteSpace(input))
    {
        throw new ArgumentException("Input cannot be whitespace");
    }
}
`;
      const analysis = detector.analyzeInputValidation(content, 'Validator.cs');
      
      expect(analysis.patterns.some(p => p.type === 'manual-validation')).toBe(true);
    });
  });

  describe('detect', () => {
    it('should return patterns for validation files', async () => {
      const context = {
        content: `
public class ProductDto
{
    [Required]
    public string Name { get; set; }
    
    [Range(0, 10000)]
    public decimal Price { get; set; }
}
`,
        file: 'ProductDto.cs',
        language: 'csharp' as const,
        isTestFile: false,
        isTypeDefinition: false,
      };

      const result = await detector.detect(context);
      
      expect(result.patterns.length).toBeGreaterThan(0);
    });

    it('should return empty result for non-validation files', async () => {
      const context = {
        content: `
public class MathService
{
    public int Add(int a, int b) => a + b;
}
`,
        file: 'MathService.cs',
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
      expect(detector.id).toBe('security/aspnet-input-validation');
      expect(detector.category).toBe('security');
      expect(detector.supportedLanguages).toContain('csharp');
    });
  });
});
