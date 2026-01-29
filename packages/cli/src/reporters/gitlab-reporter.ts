/**
 * GitLab Reporter - GitLab CI code quality format
 *
 * @requirements 30.3
 */

import * as crypto from 'node:crypto';

import type { Reporter, ReportData } from './types.js';
import type { Severity } from 'driftdetect-core';

/**
 * GitLab Code Quality severity levels
 */
type GitLabSeverity = 'blocker' | 'critical' | 'major' | 'minor' | 'info';

/**
 * Map severity to GitLab Code Quality severity
 */
function severityToGitLab(severity: Severity): GitLabSeverity {
  switch (severity) {
    case 'error':
      return 'critical';
    case 'warning':
      return 'major';
    case 'info':
      return 'minor';
    case 'hint':
    default:
      return 'info';
  }
}

/**
 * GitLab Code Quality issue format
 */
interface GitLabIssue {
  type: 'issue';
  check_name: string;
  description: string;
  content?: {
    body: string;
  };
  categories: string[];
  location: {
    path: string;
    lines: {
      begin: number;
      end: number;
    };
  };
  severity: GitLabSeverity;
  fingerprint: string;
}

/**
 * Generate a fingerprint for a violation
 */
function generateFingerprint(
  patternId: string,
  file: string,
  line: number,
  message: string
): string {
  const content = `${patternId}:${file}:${line}:${message}`;
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * GitLab CI reporter for code quality reports
 *
 * Generates reports in GitLab Code Quality format:
 * https://docs.gitlab.com/ee/ci/testing/code_quality.html
 */
export class GitLabReporter implements Reporter {
  generate(data: ReportData): string {
    const issues: GitLabIssue[] = data.violations.map((violation) => {
      const issue: GitLabIssue = {
        type: 'issue',
        check_name: `drift/${violation.patternId}`,
        description: violation.message,
        categories: ['Style', 'Consistency'],
        location: {
          path: violation.file,
          lines: {
            begin: violation.range.start.line,
            end: violation.range.end.line,
          },
        },
        severity: severityToGitLab(violation.severity),
        fingerprint: generateFingerprint(
          violation.patternId,
          violation.file,
          violation.range.start.line,
          violation.message
        ),
      };

      if (violation.explanation) {
        issue.content = { body: violation.explanation };
      }

      return issue;
    });

    return JSON.stringify(issues, null, 2);
  }
}
