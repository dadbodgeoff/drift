/**
 * C# Language Strategies
 *
 * Strategies for ASP.NET Core framework.
 *
 * @module simulation/language-strategies/csharp-strategies
 */

import type { TaskCategory } from '../types.js';
import type { FrameworkDefinition, LanguageStrategyProvider, StrategyTemplate } from './types.js';

// ============================================================================
// ASP.NET Core Strategies
// ============================================================================

const ASPNET_STRATEGIES: StrategyTemplate[] = [
  {
    strategy: 'middleware',
    name: 'ASP.NET Middleware',
    description: 'Implement as ASP.NET Core middleware',
    applicableCategories: ['logging', 'authentication', 'rate-limiting', 'error-handling'],
    filePatterns: ['Middleware', 'Middlewares'],
    pros: ['Pipeline pattern', 'Full request access', 'Standard pattern'],
    cons: ['Order-dependent', 'Global by default'],
    estimatedLines: 40,
    template: `public class {{Name}}Middleware\n{\n    private readonly RequestDelegate _next;\n    public {{Name}}Middleware(RequestDelegate next) => _next = next;\n    public async Task InvokeAsync(HttpContext context)\n    {\n        await _next(context);\n    }\n}`,
  },
  {
    strategy: 'filter',
    name: 'Action Filter',
    description: 'Implement as an MVC action filter',
    applicableCategories: ['logging', 'authorization', 'validation', 'caching'],
    filePatterns: ['Filters', 'Filter'],
    pros: ['MVC-aware', 'Access to action context', 'Attribute-based'],
    cons: ['Only for MVC actions'],
    estimatedLines: 35,
    template: `public class {{Name}}Filter : IActionFilter\n{\n    public void OnActionExecuting(ActionExecutingContext context) { }\n    public void OnActionExecuted(ActionExecutedContext context) { }\n}`,
  },
  {
    strategy: 'decorator',
    name: 'Custom Attribute',
    description: 'Create a custom attribute for declarative behavior',
    applicableCategories: ['authorization', 'caching', 'rate-limiting', 'validation'],
    filePatterns: ['Attributes', 'Attribute'],
    pros: ['Declarative', 'Self-documenting', 'Reusable'],
    cons: ['Requires filter or middleware support'],
    estimatedLines: 25,
    template: `[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]\npublic class {{Name}}Attribute : Attribute\n{\n    public string Value { get; set; }\n}`,
  },
  {
    strategy: 'policy',
    name: 'Authorization Policy',
    description: 'Create an authorization policy with requirements',
    applicableCategories: ['authorization'],
    filePatterns: ['Authorization', 'Policies', 'Requirements'],
    pros: ['Built-in pattern', 'Composable', 'Testable'],
    cons: ['Only for authorization'],
    estimatedLines: 50,
    template: `public class {{Name}}Requirement : IAuthorizationRequirement { }\n\npublic class {{Name}}Handler : AuthorizationHandler<{{Name}}Requirement>\n{\n    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, {{Name}}Requirement requirement)\n    {\n        context.Succeed(requirement);\n        return Task.CompletedTask;\n    }\n}`,
  },
  {
    strategy: 'centralized',
    name: 'Service Class',
    description: 'Create a dedicated service with DI',
    applicableCategories: ['authentication', 'data-access', 'caching'],
    filePatterns: ['Services', 'Service'],
    pros: ['Clean architecture', 'DI-friendly', 'Testable'],
    cons: ['Manual invocation'],
    estimatedLines: 55,
    template: `public interface I{{Name}}Service\n{\n    Task ProcessAsync();\n}\n\npublic class {{Name}}Service : I{{Name}}Service\n{\n    public async Task ProcessAsync() { }\n}`,
  },
  {
    strategy: 'guard',
    name: '[Authorize] Attribute',
    description: 'Use built-in authorization attributes',
    applicableCategories: ['authorization', 'authentication'],
    filePatterns: ['Controllers', 'Controller'],
    pros: ['Built-in', 'Simple', 'Policy-based'],
    cons: ['Limited customization without policies'],
    estimatedLines: 5,
    template: `[Authorize(Policy = "{{Name}}")]\npublic IActionResult SecureAction() => Ok();`,
  },
];

const ASPNET_FRAMEWORK: FrameworkDefinition = {
  name: 'aspnet',
  language: 'csharp',
  detectPatterns: ['WebApplication', 'IActionResult', '[ApiController]', '[HttpGet]', '[HttpPost]', 'ControllerBase'],
  importPatterns: ['Microsoft.AspNetCore', 'using Microsoft.AspNetCore'],
  strategies: ASPNET_STRATEGIES,
};

// ============================================================================
// C# Strategy Provider
// ============================================================================

export class CSharpStrategyProvider implements LanguageStrategyProvider {
  readonly language = 'csharp' as const;
  readonly frameworks: FrameworkDefinition[] = [ASPNET_FRAMEWORK];

  getStrategies(category: TaskCategory, framework?: string): StrategyTemplate[] {
    const fw = framework 
      ? this.frameworks.find(f => f.name === framework)
      : this.frameworks[0];
    
    if (!fw) {return [];}
    
    return fw.strategies.filter(s => 
      s.applicableCategories.includes(category) || 
      s.applicableCategories.includes('generic' as TaskCategory)
    );
  }

  detectFramework(content: string, _filePath: string): string | null {
    for (const fw of this.frameworks) {
      for (const pattern of fw.importPatterns) {
        if (content.includes(pattern)) {
          return fw.name;
        }
      }
      for (const pattern of fw.detectPatterns) {
        if (content.includes(pattern)) {
          return fw.name;
        }
      }
    }
    return null;
  }
}

export const csharpStrategyProvider = new CSharpStrategyProvider();
