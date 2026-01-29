/**
 * PHP Language Strategies
 *
 * Strategies for Laravel framework.
 *
 * @module simulation/language-strategies/php-strategies
 */

import type { TaskCategory } from '../types.js';
import type { FrameworkDefinition, LanguageStrategyProvider, StrategyTemplate } from './types.js';

// ============================================================================
// Laravel Strategies
// ============================================================================

const LARAVEL_STRATEGIES: StrategyTemplate[] = [
  {
    strategy: 'middleware',
    name: 'Laravel Middleware',
    description: 'Implement as Laravel HTTP middleware',
    applicableCategories: ['authentication', 'authorization', 'rate-limiting', 'logging'],
    filePatterns: ['Middleware', 'Http/Middleware'],
    pros: ['Laravel standard', 'Route-assignable', 'Terminable'],
    cons: ['Order matters', 'Global vs route middleware'],
    estimatedLines: 30,
    template: `class {{Name}}Middleware\n{\n    public function handle(Request $request, Closure $next)\n    {\n        return $next($request);\n    }\n}`,
  },
  {
    strategy: 'policy',
    name: 'Laravel Policy',
    description: 'Create an authorization policy',
    applicableCategories: ['authorization'],
    filePatterns: ['Policies', 'Policy'],
    pros: ['Model-centric', 'Built-in pattern', 'Gate integration'],
    cons: ['Only for authorization'],
    estimatedLines: 40,
    template: `class {{Name}}Policy\n{\n    public function view(User $user, Model $model): bool\n    {\n        return true;\n    }\n}`,
  },
  {
    strategy: 'guard',
    name: 'Laravel Gate',
    description: 'Define authorization gates',
    applicableCategories: ['authorization'],
    filePatterns: ['Providers', 'AuthServiceProvider'],
    pros: ['Simple', 'Closure-based', 'Global'],
    cons: ['Can become messy at scale'],
    estimatedLines: 15,
    template: `Gate::define('{{name}}', function (User $user) {\n    return true;\n});`,
  },
  {
    strategy: 'centralized',
    name: 'Laravel Service',
    description: 'Create a service class with DI',
    applicableCategories: ['authentication', 'data-access', 'caching'],
    filePatterns: ['Services', 'Service'],
    pros: ['Clean architecture', 'Testable', 'DI-friendly'],
    cons: ['Not a Laravel convention'],
    estimatedLines: 50,
    template: `class {{Name}}Service\n{\n    public function process(): void\n    {\n        // Implementation\n    }\n}`,
  },
  {
    strategy: 'decorator',
    name: 'Form Request',
    description: 'Create a Form Request for validation',
    applicableCategories: ['validation'],
    filePatterns: ['Requests', 'Http/Requests'],
    pros: ['Laravel standard', 'Authorization + validation', 'Reusable'],
    cons: ['Only for validation'],
    estimatedLines: 25,
    template: `class {{Name}}Request extends FormRequest\n{\n    public function authorize(): bool { return true; }\n    public function rules(): array { return []; }\n}`,
  },
  {
    strategy: 'wrapper',
    name: 'Laravel Observer',
    description: 'Create a model observer for lifecycle events',
    applicableCategories: ['logging', 'data-access', 'caching'],
    filePatterns: ['Observers', 'Observer'],
    pros: ['Model lifecycle hooks', 'Decoupled', 'Automatic'],
    cons: ['Only for Eloquent events'],
    estimatedLines: 35,
    template: `class {{Name}}Observer\n{\n    public function created(Model $model): void { }\n    public function updated(Model $model): void { }\n}`,
  },
  {
    strategy: 'aspect',
    name: 'Event Listener',
    description: 'Create event listeners for cross-cutting concerns',
    applicableCategories: ['logging', 'caching', 'error-handling'],
    filePatterns: ['Listeners', 'Events'],
    pros: ['Decoupled', 'Async-capable', 'Queued'],
    cons: ['Event dispatch required'],
    estimatedLines: 30,
    template: `class {{Name}}Listener\n{\n    public function handle(Event $event): void\n    {\n        // Implementation\n    }\n}`,
  },
];

const LARAVEL_FRAMEWORK: FrameworkDefinition = {
  name: 'laravel',
  language: 'php',
  detectPatterns: ['Illuminate\\', 'extends Controller', 'Route::', 'Eloquent', 'artisan'],
  importPatterns: ['use Illuminate\\', 'use App\\'],
  strategies: LARAVEL_STRATEGIES,
};

// ============================================================================
// PHP Strategy Provider
// ============================================================================

export class PHPStrategyProvider implements LanguageStrategyProvider {
  readonly language = 'php' as const;
  readonly frameworks: FrameworkDefinition[] = [LARAVEL_FRAMEWORK];

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

export const phpStrategyProvider = new PHPStrategyProvider();
