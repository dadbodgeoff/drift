/**
 * Python Language Strategies
 *
 * Strategies for FastAPI, Django, and Flask frameworks.
 *
 * @module simulation/language-strategies/python-strategies
 */

import type { TaskCategory } from '../types.js';
import type { FrameworkDefinition, LanguageStrategyProvider, StrategyTemplate } from './types.js';

// ============================================================================
// FastAPI Strategies
// ============================================================================

const FASTAPI_STRATEGIES: StrategyTemplate[] = [
  {
    strategy: 'dependency',
    name: 'FastAPI Dependency',
    description: 'Implement as a FastAPI dependency injection',
    applicableCategories: ['authentication', 'authorization', 'rate-limiting', 'validation', 'data-access'],
    filePatterns: ['dependencies', 'deps', 'auth'],
    pros: ['Built-in pattern', 'Type-safe', 'Reusable', 'Testable'],
    cons: ['FastAPI-specific'],
    estimatedLines: 25,
    template: `async def {{name}}_dependency(request: Request):\n    # Implementation\n    return result`,
  },
  {
    strategy: 'middleware',
    name: 'Starlette Middleware',
    description: 'Implement as ASGI middleware',
    applicableCategories: ['logging', 'rate-limiting', 'authentication', 'error-handling'],
    filePatterns: ['middleware', 'middlewares'],
    pros: ['Intercepts all requests', 'ASGI standard', 'Access to raw request/response'],
    cons: ['Lower level than dependencies', 'More complex'],
    estimatedLines: 45,
    template: `class {{Name}}Middleware(BaseHTTPMiddleware):\n    async def dispatch(self, request, call_next):\n        response = await call_next(request)\n        return response`,
  },
  {
    strategy: 'decorator',
    name: 'Python Decorator',
    description: 'Create a decorator for route handlers',
    applicableCategories: ['caching', 'logging', 'rate-limiting', 'authorization'],
    filePatterns: ['decorators', 'utils'],
    pros: ['Pythonic', 'Explicit', 'Composable'],
    cons: ['Manual application required'],
    estimatedLines: 20,
    template: `def {{name}}(func):\n    @wraps(func)\n    async def wrapper(*args, **kwargs):\n        return await func(*args, **kwargs)\n    return wrapper`,
  },
  {
    strategy: 'centralized',
    name: 'Service Class',
    description: 'Create a dedicated service class',
    applicableCategories: ['authentication', 'data-access', 'caching'],
    filePatterns: ['services', 'core'],
    pros: ['Clean architecture', 'Testable', 'Reusable'],
    cons: ['More boilerplate'],
    estimatedLines: 60,
  },
];

const FASTAPI_FRAMEWORK: FrameworkDefinition = {
  name: 'fastapi',
  language: 'python',
  detectPatterns: ['FastAPI()', '@app.get', '@app.post', 'Depends(', 'APIRouter'],
  importPatterns: ['from fastapi', 'import fastapi'],
  strategies: FASTAPI_STRATEGIES,
};


// ============================================================================
// Django Strategies
// ============================================================================

const DJANGO_STRATEGIES: StrategyTemplate[] = [
  {
    strategy: 'middleware',
    name: 'Django Middleware',
    description: 'Implement as Django middleware class',
    applicableCategories: ['authentication', 'logging', 'rate-limiting', 'error-handling'],
    filePatterns: ['middleware', 'middlewares'],
    pros: ['Django standard', 'Intercepts all requests', 'Well-documented'],
    cons: ['Synchronous by default', 'Order matters'],
    estimatedLines: 40,
    template: `class {{Name}}Middleware:\n    def __init__(self, get_response):\n        self.get_response = get_response\n    def __call__(self, request):\n        response = self.get_response(request)\n        return response`,
  },
  {
    strategy: 'decorator',
    name: 'View Decorator',
    description: 'Create a decorator for view functions',
    applicableCategories: ['authentication', 'authorization', 'caching', 'rate-limiting'],
    filePatterns: ['decorators', 'utils'],
    pros: ['Django pattern', 'Explicit', 'Composable with @login_required etc.'],
    cons: ['Manual application'],
    estimatedLines: 25,
    template: `def {{name}}_required(view_func):\n    @wraps(view_func)\n    def wrapper(request, *args, **kwargs):\n        return view_func(request, *args, **kwargs)\n    return wrapper`,
  },
  {
    strategy: 'mixin',
    name: 'View Mixin',
    description: 'Create a mixin class for class-based views',
    applicableCategories: ['authentication', 'authorization', 'logging'],
    filePatterns: ['mixins', 'views'],
    pros: ['Reusable with CBVs', 'Django pattern', 'Composable'],
    cons: ['Only for class-based views'],
    estimatedLines: 30,
    template: `class {{Name}}Mixin:\n    def dispatch(self, request, *args, **kwargs):\n        return super().dispatch(request, *args, **kwargs)`,
  },
  {
    strategy: 'centralized',
    name: 'Django Service',
    description: 'Create a service module',
    applicableCategories: ['data-access', 'authentication', 'caching'],
    filePatterns: ['services', 'utils'],
    pros: ['Clean separation', 'Testable'],
    cons: ['Not a Django convention'],
    estimatedLines: 50,
  },
];

const DJANGO_FRAMEWORK: FrameworkDefinition = {
  name: 'django',
  language: 'python',
  detectPatterns: ['from django', 'Django', 'HttpResponse', 'render(', 'models.Model'],
  importPatterns: ['from django', 'import django'],
  strategies: DJANGO_STRATEGIES,
};

// ============================================================================
// Flask Strategies
// ============================================================================

const FLASK_STRATEGIES: StrategyTemplate[] = [
  {
    strategy: 'decorator',
    name: 'Flask Decorator',
    description: 'Create a decorator for route handlers',
    applicableCategories: ['authentication', 'authorization', 'rate-limiting', 'logging', 'caching'],
    filePatterns: ['decorators', 'utils', 'auth'],
    pros: ['Flask pattern', 'Explicit', 'Composable'],
    cons: ['Manual application'],
    estimatedLines: 20,
    template: `def {{name}}_required(f):\n    @wraps(f)\n    def decorated(*args, **kwargs):\n        return f(*args, **kwargs)\n    return decorated`,
  },
  {
    strategy: 'middleware',
    name: 'Flask Before/After Request',
    description: 'Use before_request/after_request hooks',
    applicableCategories: ['logging', 'authentication', 'rate-limiting'],
    filePatterns: ['app', 'hooks'],
    pros: ['Simple', 'Global effect'],
    cons: ['Less granular control'],
    estimatedLines: 15,
    template: `@app.before_request\ndef {{name}}_before():\n    pass`,
  },
  {
    strategy: 'centralized',
    name: 'Flask Extension',
    description: 'Create or use a Flask extension',
    applicableCategories: ['authentication', 'caching', 'data-access'],
    filePatterns: ['extensions', 'ext'],
    pros: ['Reusable', 'Flask ecosystem'],
    cons: ['More complex setup'],
    estimatedLines: 70,
  },
  {
    strategy: 'wrapper',
    name: 'Context Manager',
    description: 'Use Python context managers for resource management',
    applicableCategories: ['data-access', 'error-handling', 'logging'],
    filePatterns: ['utils', 'context'],
    pros: ['Pythonic', 'Clean resource handling'],
    cons: ['Limited to specific use cases'],
    estimatedLines: 25,
  },
];

const FLASK_FRAMEWORK: FrameworkDefinition = {
  name: 'flask',
  language: 'python',
  detectPatterns: ['Flask(__name__)', '@app.route', 'flask.', 'Blueprint('],
  importPatterns: ['from flask', 'import flask'],
  strategies: FLASK_STRATEGIES,
};

// ============================================================================
// Python Strategy Provider
// ============================================================================

export class PythonStrategyProvider implements LanguageStrategyProvider {
  readonly language = 'python' as const;
  readonly frameworks: FrameworkDefinition[] = [
    FASTAPI_FRAMEWORK,
    DJANGO_FRAMEWORK,
    FLASK_FRAMEWORK,
  ];

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

export const pythonStrategyProvider = new PythonStrategyProvider();
