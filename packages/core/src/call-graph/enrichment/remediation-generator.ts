/**
 * Remediation Generator
 *
 * Generates actionable remediation guidance for security findings.
 * Provides step-by-step instructions, code examples, and effort estimates.
 */

import type {
  SecurityFinding,
  FindingCategory,
  DataImpact,
  RemediationGuidance,
  RemediationStep,
  CodeExample,
  RemediationEffort,
  Reference,
} from './types.js';

// ============================================================================
// Remediation Templates
// ============================================================================

interface RemediationTemplate {
  summary: string;
  steps: string[];
  codeExamples: CodeExample[];
  effort: RemediationEffort;
  references: Reference[];
}

/**
 * Category-specific remediation templates
 */
const REMEDIATION_TEMPLATES: Record<FindingCategory, RemediationTemplate> = {
  injection: {
    summary: 'Use parameterized queries or prepared statements to prevent injection attacks',
    steps: [
      'Identify all user input that flows into the vulnerable code path',
      'Replace string concatenation with parameterized queries',
      'Use ORM methods instead of raw SQL where possible',
      'Implement input validation as defense in depth',
      'Add automated tests to verify the fix',
    ],
    codeExamples: [
      {
        description: 'SQL Injection - Use parameterized queries',
        language: 'typescript',
        vulnerable: `const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
db.query(query);`,
        fixed: `const query = 'SELECT * FROM users WHERE id = $1';
db.query(query, [userId]);`,
      },
      {
        description: 'SQL Injection - Use ORM',
        language: 'typescript',
        vulnerable: `db.query(\`SELECT * FROM users WHERE email = '\${email}'\`);`,
        fixed: `await prisma.user.findUnique({ where: { email } });`,
      },
      {
        description: 'Command Injection - Use safe APIs',
        language: 'typescript',
        vulnerable: `exec(\`ls \${userInput}\`);`,
        fixed: `execFile('ls', [userInput], { shell: false });`,
      },
    ],
    effort: {
      time: 'hours',
      complexity: 'simple',
      regressionRisk: 'low',
    },
    references: [
      {
        title: 'OWASP SQL Injection Prevention Cheat Sheet',
        url: 'https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html',
        type: 'owasp',
      },
      {
        title: 'CWE-89: SQL Injection',
        url: 'https://cwe.mitre.org/data/definitions/89.html',
        type: 'cwe',
      },
    ],
  },

  'broken-auth': {
    summary: 'Implement secure authentication with proper session management',
    steps: [
      'Review authentication flow for weaknesses',
      'Implement secure password hashing (bcrypt, argon2)',
      'Use secure session tokens with proper expiration',
      'Implement rate limiting on authentication endpoints',
      'Add multi-factor authentication for sensitive operations',
      'Log authentication events for monitoring',
    ],
    codeExamples: [
      {
        description: 'Secure password hashing',
        language: 'typescript',
        vulnerable: `const hash = md5(password);`,
        fixed: `const hash = await bcrypt.hash(password, 12);`,
      },
      {
        description: 'Secure session configuration',
        language: 'typescript',
        vulnerable: `app.use(session({ secret: 'secret' }));`,
        fixed: `app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 3600000
  }
}));`,
      },
    ],
    effort: {
      time: 'days',
      complexity: 'moderate',
      regressionRisk: 'medium',
    },
    references: [
      {
        title: 'OWASP Authentication Cheat Sheet',
        url: 'https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html',
        type: 'owasp',
      },
    ],
  },

  'sensitive-exposure': {
    summary: 'Protect sensitive data with encryption and access controls',
    steps: [
      'Identify all sensitive data in the affected code path',
      'Encrypt sensitive data at rest and in transit',
      'Remove sensitive data from logs and error messages',
      'Implement proper access controls',
      'Review data retention policies',
    ],
    codeExamples: [
      {
        description: 'Remove sensitive data from logs',
        language: 'typescript',
        vulnerable: `logger.info('User login', { email, password });`,
        fixed: `logger.info('User login', { email, password: '[REDACTED]' });`,
      },
      {
        description: 'Encrypt sensitive fields',
        language: 'typescript',
        vulnerable: `await db.user.create({ data: { ssn: userSSN } });`,
        fixed: `const encryptedSSN = await encrypt(userSSN);
await db.user.create({ data: { ssn: encryptedSSN } });`,
      },
    ],
    effort: {
      time: 'days',
      complexity: 'moderate',
      regressionRisk: 'medium',
    },
    references: [
      {
        title: 'OWASP Cryptographic Storage Cheat Sheet',
        url: 'https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html',
        type: 'owasp',
      },
    ],
  },

  xxe: {
    summary: 'Disable external entity processing in XML parsers',
    steps: [
      'Identify all XML parsing in the application',
      'Disable DTD processing and external entities',
      'Use JSON instead of XML where possible',
      'Validate and sanitize XML input',
    ],
    codeExamples: [
      {
        description: 'Disable XXE in XML parser',
        language: 'typescript',
        vulnerable: `const parser = new DOMParser();
parser.parseFromString(xmlInput, 'text/xml');`,
        fixed: `import { XMLParser } from 'fast-xml-parser';
const parser = new XMLParser({
  allowBooleanAttributes: true,
  ignoreDeclaration: true,
  processEntities: false
});
parser.parse(xmlInput);`,
      },
    ],
    effort: {
      time: 'hours',
      complexity: 'simple',
      regressionRisk: 'low',
    },
    references: [
      {
        title: 'OWASP XXE Prevention Cheat Sheet',
        url: 'https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html',
        type: 'owasp',
      },
      {
        title: 'CWE-611: XXE',
        url: 'https://cwe.mitre.org/data/definitions/611.html',
        type: 'cwe',
      },
    ],
  },

  'broken-access': {
    summary: 'Implement proper authorization checks at every access point',
    steps: [
      'Map all access control requirements for affected resources',
      'Implement authorization checks before data access',
      'Use role-based or attribute-based access control',
      'Deny by default - require explicit grants',
      'Log access control decisions for audit',
    ],
    codeExamples: [
      {
        description: 'Add authorization check',
        language: 'typescript',
        vulnerable: `app.get('/users/:id', async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.params.id } });
  res.json(user);
});`,
        fixed: `app.get('/users/:id', authorize('users:read'), async (req, res) => {
  if (req.user.id !== req.params.id && !req.user.isAdmin) {
    throw new ForbiddenError('Cannot access other users');
  }
  const user = await db.user.findUnique({ where: { id: req.params.id } });
  res.json(user);
});`,
      },
    ],
    effort: {
      time: 'days',
      complexity: 'moderate',
      regressionRisk: 'medium',
    },
    references: [
      {
        title: 'OWASP Authorization Cheat Sheet',
        url: 'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html',
        type: 'owasp',
      },
    ],
  },

  misconfig: {
    summary: 'Review and harden security configuration',
    steps: [
      'Review security headers and CORS configuration',
      'Disable debug mode and verbose errors in production',
      'Remove default credentials and unnecessary features',
      'Implement security hardening checklist',
      'Set up configuration validation in CI/CD',
    ],
    codeExamples: [
      {
        description: 'Add security headers',
        language: 'typescript',
        vulnerable: `app.use(cors());`,
        fixed: `app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(','),
  credentials: true
}));`,
      },
    ],
    effort: {
      time: 'hours',
      complexity: 'simple',
      regressionRisk: 'low',
    },
    references: [
      {
        title: 'OWASP Secure Headers Project',
        url: 'https://owasp.org/www-project-secure-headers/',
        type: 'owasp',
      },
    ],
  },

  xss: {
    summary: 'Sanitize output and use context-aware encoding',
    steps: [
      'Identify all user input that is rendered in responses',
      'Apply context-appropriate output encoding',
      'Use Content Security Policy headers',
      'Implement input validation as defense in depth',
      'Use frameworks with automatic XSS protection',
    ],
    codeExamples: [
      {
        description: 'Escape HTML output',
        language: 'typescript',
        vulnerable: `element.innerHTML = userInput;`,
        fixed: `element.textContent = userInput;
// Or use a sanitization library:
element.innerHTML = DOMPurify.sanitize(userInput);`,
      },
      {
        description: 'React - avoid dangerouslySetInnerHTML',
        language: 'typescript',
        vulnerable: `<div dangerouslySetInnerHTML={{ __html: userContent }} />`,
        fixed: `<div>{userContent}</div>
// Or sanitize if HTML is required:
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />`,
      },
    ],
    effort: {
      time: 'hours',
      complexity: 'simple',
      regressionRisk: 'low',
    },
    references: [
      {
        title: 'OWASP XSS Prevention Cheat Sheet',
        url: 'https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html',
        type: 'owasp',
      },
      {
        title: 'CWE-79: XSS',
        url: 'https://cwe.mitre.org/data/definitions/79.html',
        type: 'cwe',
      },
    ],
  },

  deserialization: {
    summary: 'Avoid deserializing untrusted data or use safe alternatives',
    steps: [
      'Identify all deserialization of external data',
      'Replace unsafe deserialization with JSON parsing',
      'Implement integrity checks (signatures) if serialization is required',
      'Use allowlists for permitted classes',
      'Monitor for deserialization attacks',
    ],
    codeExamples: [
      {
        description: 'Avoid unsafe deserialization',
        language: 'typescript',
        vulnerable: `const obj = eval('(' + userInput + ')');`,
        fixed: `const obj = JSON.parse(userInput);
// Validate the parsed object against a schema
const validated = schema.parse(obj);`,
      },
    ],
    effort: {
      time: 'days',
      complexity: 'moderate',
      regressionRisk: 'medium',
    },
    references: [
      {
        title: 'OWASP Deserialization Cheat Sheet',
        url: 'https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html',
        type: 'owasp',
      },
    ],
  },

  components: {
    summary: 'Update vulnerable dependencies and implement dependency management',
    steps: [
      'Update the vulnerable package to a patched version',
      'Review changelog for breaking changes',
      'Run tests to verify compatibility',
      'Set up automated dependency scanning in CI/CD',
      'Consider using lockfiles and pinned versions',
    ],
    codeExamples: [],
    effort: {
      time: 'hours',
      complexity: 'simple',
      regressionRisk: 'medium',
    },
    references: [
      {
        title: 'OWASP Dependency Check',
        url: 'https://owasp.org/www-project-dependency-check/',
        type: 'owasp',
      },
    ],
  },

  logging: {
    summary: 'Implement comprehensive security logging and monitoring',
    steps: [
      'Add logging for security-relevant events',
      'Ensure logs do not contain sensitive data',
      'Implement log aggregation and alerting',
      'Set up monitoring for suspicious patterns',
      'Define incident response procedures',
    ],
    codeExamples: [
      {
        description: 'Add security event logging',
        language: 'typescript',
        vulnerable: `// No logging
await authenticateUser(email, password);`,
        fixed: `const result = await authenticateUser(email, password);
if (!result.success) {
  securityLogger.warn('Authentication failed', {
    email,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    reason: result.reason
  });
}`,
      },
    ],
    effort: {
      time: 'days',
      complexity: 'moderate',
      regressionRisk: 'low',
    },
    references: [
      {
        title: 'OWASP Logging Cheat Sheet',
        url: 'https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html',
        type: 'owasp',
      },
    ],
  },

  ssrf: {
    summary: 'Validate and restrict outbound requests to prevent SSRF',
    steps: [
      'Validate and sanitize all URLs from user input',
      'Use allowlists for permitted domains/IPs',
      'Block requests to internal networks and metadata endpoints',
      'Disable unnecessary URL schemes',
      'Implement network segmentation',
    ],
    codeExamples: [
      {
        description: 'Validate URLs before fetching',
        language: 'typescript',
        vulnerable: `const response = await fetch(userProvidedUrl);`,
        fixed: `const url = new URL(userProvidedUrl);
if (!ALLOWED_HOSTS.includes(url.hostname)) {
  throw new Error('Host not allowed');
}
if (url.protocol !== 'https:') {
  throw new Error('Only HTTPS allowed');
}
const response = await fetch(url.toString());`,
      },
    ],
    effort: {
      time: 'hours',
      complexity: 'moderate',
      regressionRisk: 'low',
    },
    references: [
      {
        title: 'OWASP SSRF Prevention Cheat Sheet',
        url: 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
        type: 'owasp',
      },
    ],
  },

  other: {
    summary: 'Review and address the security finding based on its specific context',
    steps: [
      'Analyze the finding to understand the vulnerability',
      'Research best practices for this type of issue',
      'Implement appropriate mitigations',
      'Add tests to verify the fix',
      'Document the remediation for future reference',
    ],
    codeExamples: [],
    effort: {
      time: 'hours',
      complexity: 'moderate',
      regressionRisk: 'medium',
    },
    references: [
      {
        title: 'OWASP Cheat Sheet Series',
        url: 'https://cheatsheetseries.owasp.org/',
        type: 'owasp',
      },
    ],
  },
};

// ============================================================================
// Remediation Generator
// ============================================================================

/**
 * Generates remediation guidance for security findings
 */
export class RemediationGenerator {
  /**
   * Generate remediation guidance for a finding
   */
  generate(
    finding: SecurityFinding,
    dataImpact: DataImpact
  ): RemediationGuidance {
    const template = REMEDIATION_TEMPLATES[finding.category];

    // Build context-aware steps
    const steps = this.buildSteps(finding, dataImpact, template.steps);

    // Filter relevant code examples
    const codeExamples = this.filterCodeExamples(finding, template.codeExamples);

    // Adjust effort based on data impact
    const effort = this.adjustEffort(template.effort, dataImpact);

    // Build references including CWE/OWASP from finding
    const references = this.buildReferences(finding, template.references);

    return {
      summary: this.buildSummary(finding, dataImpact, template.summary),
      steps,
      codeExamples,
      effort,
      references,
    };
  }

  /**
   * Build context-aware summary
   */
  private buildSummary(
    _finding: SecurityFinding,
    dataImpact: DataImpact,
    baseSummary: string
  ): string {
    let summary = baseSummary;

    // Add data impact context
    if (dataImpact.sensitiveFields.length > 0) {
      const fieldTypes = [...new Set(
        dataImpact.sensitiveFields.map((f) => f.field.sensitivityType)
      )];
      summary += `. This vulnerability can reach ${fieldTypes.join(', ')} data`;
    }

    // Add regulatory context
    if (dataImpact.regulations.length > 0) {
      summary += `. Regulatory implications: ${dataImpact.regulations.join(', ')}`;
    }

    return summary;
  }

  /**
   * Build context-aware remediation steps
   */
  private buildSteps(
    finding: SecurityFinding,
    dataImpact: DataImpact,
    baseSteps: string[]
  ): RemediationStep[] {
    const steps: RemediationStep[] = baseSteps.map((description, index) => ({
      order: index + 1,
      description,
      file: index === 0 ? finding.file : undefined,
      line: index === 0 ? finding.line : undefined,
    }));

    // Add data-specific steps if sensitive data is involved
    if (dataImpact.sensitiveFields.length > 0) {
      steps.push({
        order: steps.length + 1,
        description: `Review access to sensitive fields: ${dataImpact.sensitiveFields
          .slice(0, 3)
          .map((f) => `${f.field.table}.${f.field.field}`)
          .join(', ')}${dataImpact.sensitiveFields.length > 3 ? '...' : ''}`,
      });
    }

    // Add regulatory compliance step if needed
    if (dataImpact.regulations.length > 0) {
      steps.push({
        order: steps.length + 1,
        description: `Verify compliance with ${dataImpact.regulations.join(', ')} requirements after remediation`,
      });
    }

    return steps;
  }

  /**
   * Filter code examples relevant to the finding
   */
  private filterCodeExamples(
    _finding: SecurityFinding,
    examples: CodeExample[]
  ): CodeExample[] {
    // For now, return all examples for the category
    // Could be enhanced to filter based on language, framework, etc.
    return examples;
  }

  /**
   * Adjust effort estimate based on data impact
   */
  private adjustEffort(
    baseEffort: RemediationEffort,
    dataImpact: DataImpact
  ): RemediationEffort {
    const effort = { ...baseEffort };

    // Increase complexity if many sensitive fields are involved
    if (dataImpact.sensitiveFields.length > 5) {
      if (effort.complexity === 'simple') {effort.complexity = 'moderate';}
      else if (effort.complexity === 'moderate') {effort.complexity = 'complex';}
    }

    // Increase regression risk if many tables are affected
    if (dataImpact.tables.length > 3) {
      if (effort.regressionRisk === 'low') {effort.regressionRisk = 'medium';}
      else if (effort.regressionRisk === 'medium') {effort.regressionRisk = 'high';}
    }

    // Increase time if attack surface is large
    if (dataImpact.attackSurfaceSize > 20) {
      if (effort.time === 'minutes') {effort.time = 'hours';}
      else if (effort.time === 'hours') {effort.time = 'days';}
    }

    return effort;
  }

  /**
   * Build comprehensive references
   */
  private buildReferences(
    finding: SecurityFinding,
    baseReferences: Reference[]
  ): Reference[] {
    const references = [...baseReferences];

    // Add CWE references from finding
    if (finding.cwe) {
      for (const cwe of finding.cwe) {
        const cweId = cwe.replace('CWE-', '');
        references.push({
          title: `CWE-${cweId}`,
          url: `https://cwe.mitre.org/data/definitions/${cweId}.html`,
          type: 'cwe',
        });
      }
    }

    // Add OWASP references from finding
    if (finding.owasp) {
      for (const owasp of finding.owasp) {
        references.push({
          title: `OWASP ${owasp}`,
          url: `https://owasp.org/Top10/`,
          type: 'owasp',
        });
      }
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    return references.filter((ref) => {
      if (seen.has(ref.url)) {return false;}
      seen.add(ref.url);
      return true;
    });
  }
}

/**
 * Create a new remediation generator
 */
export function createRemediationGenerator(): RemediationGenerator {
  return new RemediationGenerator();
}
