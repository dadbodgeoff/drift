/**
 * Java Language Strategies
 *
 * Strategies for Spring Boot framework.
 *
 * @module simulation/language-strategies/java-strategies
 */

import type { TaskCategory } from '../types.js';
import type { FrameworkDefinition, LanguageStrategyProvider, StrategyTemplate } from './types.js';

// ============================================================================
// Spring Boot Strategies
// ============================================================================

const SPRING_STRATEGIES: StrategyTemplate[] = [
  {
    strategy: 'aspect',
    name: 'Spring AOP Aspect',
    description: 'Implement as an aspect using Spring AOP',
    applicableCategories: ['logging', 'caching', 'rate-limiting', 'authorization'],
    filePatterns: ['aspect', 'aspects', 'aop'],
    pros: ['Non-invasive', 'Powerful pointcut expressions', 'Separation of concerns'],
    cons: ['Can be "magical"', 'Debugging complexity', 'Learning curve'],
    estimatedLines: 45,
    template: `@Aspect\n@Component\npublic class {{Name}}Aspect {\n    @Around("@annotation({{name}})")\n    public Object around(ProceedingJoinPoint pjp) throws Throwable {\n        return pjp.proceed();\n    }\n}`,
  },
  {
    strategy: 'filter',
    name: 'Servlet Filter',
    description: 'Implement as a servlet filter',
    applicableCategories: ['authentication', 'logging', 'rate-limiting'],
    filePatterns: ['filter', 'filters', 'security'],
    pros: ['Low-level access', 'Standard Java EE', 'Runs before Spring'],
    cons: ['No Spring context by default', 'More boilerplate'],
    estimatedLines: 50,
    template: `@Component\npublic class {{Name}}Filter implements Filter {\n    @Override\n    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) {\n        chain.doFilter(req, res);\n    }\n}`,
  },
  {
    strategy: 'interceptor',
    name: 'Spring Interceptor',
    description: 'Implement as a Spring HandlerInterceptor',
    applicableCategories: ['logging', 'authentication', 'rate-limiting'],
    filePatterns: ['interceptor', 'interceptors'],
    pros: ['Spring-aware', 'Access to handler info', 'Pre/post processing'],
    cons: ['Only for Spring MVC', 'After filters'],
    estimatedLines: 40,
    template: `@Component\npublic class {{Name}}Interceptor implements HandlerInterceptor {\n    @Override\n    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {\n        return true;\n    }\n}`,
  },
  {
    strategy: 'decorator',
    name: 'Custom Annotation',
    description: 'Create a custom annotation with AOP or argument resolver',
    applicableCategories: ['authorization', 'caching', 'rate-limiting', 'validation'],
    filePatterns: ['annotation', 'annotations'],
    pros: ['Declarative', 'Self-documenting', 'Reusable'],
    cons: ['Requires AOP or resolver setup'],
    estimatedLines: 35,
    template: `@Target(ElementType.METHOD)\n@Retention(RetentionPolicy.RUNTIME)\npublic @interface {{Name}} {\n    String value() default "";\n}`,
  },
  {
    strategy: 'centralized',
    name: 'Spring Service',
    description: 'Create a dedicated @Service class',
    applicableCategories: ['authentication', 'data-access', 'caching'],
    filePatterns: ['service', 'services'],
    pros: ['Spring standard', 'Dependency injection', 'Testable'],
    cons: ['Manual invocation required'],
    estimatedLines: 60,
    template: `@Service\npublic class {{Name}}Service {\n    public void process() {\n        // Implementation\n    }\n}`,
  },
  {
    strategy: 'guard',
    name: '@PreAuthorize / Method Security',
    description: 'Use Spring Security method-level annotations',
    applicableCategories: ['authorization'],
    filePatterns: ['controller', 'service'],
    pros: ['Declarative', 'SpEL expressions', 'Built-in'],
    cons: ['Requires Spring Security', 'Can be complex'],
    estimatedLines: 5,
    frameworkNotes: 'Requires @EnableMethodSecurity',
    template: `@PreAuthorize("hasRole('ADMIN')")\npublic void adminOnly() { }`,
  },
];

const SPRING_FRAMEWORK: FrameworkDefinition = {
  name: 'spring',
  language: 'java',
  detectPatterns: ['@SpringBootApplication', '@RestController', '@Service', '@Autowired', '@GetMapping', '@PostMapping'],
  importPatterns: ['org.springframework', 'import org.springframework'],
  strategies: SPRING_STRATEGIES,
};

// ============================================================================
// Java Strategy Provider
// ============================================================================

export class JavaStrategyProvider implements LanguageStrategyProvider {
  readonly language = 'java' as const;
  readonly frameworks: FrameworkDefinition[] = [SPRING_FRAMEWORK];

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

export const javaStrategyProvider = new JavaStrategyProvider();
