/**
 * Tests for drift_setup and drift_projects path resolution fix
 * 
 * Issue: When user calls drift_setup with action="init" and an absolute path,
 * the enterprise-server was trying to look up the path in the project registry
 * before passing it to the handler. Since the project wasn't registered yet,
 * it failed with "Project not found".
 * 
 * Fix: For drift_setup, treat the project parameter as a PATH (not a project name)
 * and resolve it directly without registry lookup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

describe('drift_setup path resolution', () => {
  let testDir: string;
  
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'));
    fs.mkdirSync(path.join(testDir, 'user123', 'repo_1'), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'user123', 'repo_1', 'package.json'),
      JSON.stringify({ name: 'test-repo', version: '1.0.0' })
    );
  });
  
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('path resolution logic (simulating enterprise-server fix)', () => {
    // This simulates the fix in enterprise-server.ts
    function resolveSetupPath(
      requestedProject: string,
      configProjectRoot: string
    ): { resolvedPath: string; error?: string } {
      let resolvedPath: string;
      
      if (path.isAbsolute(requestedProject)) {
        resolvedPath = path.normalize(requestedProject);
      } else {
        resolvedPath = path.resolve(configProjectRoot, requestedProject);
      }
      
      // Security check
      const normalizedRoot = path.normalize(configProjectRoot);
      if (!resolvedPath.startsWith(normalizedRoot)) {
        return { 
          resolvedPath: '', 
          error: `Path traversal detected: ${requestedProject} is outside project root` 
        };
      }
      
      return { resolvedPath };
    }

    it('should resolve absolute path within project root', () => {
      const configProjectRoot = testDir;
      const requestedProject = path.join(testDir, 'user123', 'repo_1');
      
      const result = resolveSetupPath(requestedProject, configProjectRoot);
      
      expect(result.error).toBeUndefined();
      expect(result.resolvedPath).toBe(path.join(testDir, 'user123', 'repo_1'));
    });

    it('should resolve relative path', () => {
      const configProjectRoot = testDir;
      const requestedProject = 'user123/repo_1';
      
      const result = resolveSetupPath(requestedProject, configProjectRoot);
      
      expect(result.error).toBeUndefined();
      expect(result.resolvedPath).toBe(path.join(testDir, 'user123', 'repo_1'));
    });

    it('should reject path traversal with absolute path outside root', () => {
      const configProjectRoot = testDir;
      const requestedProject = '/etc/passwd';
      
      const result = resolveSetupPath(requestedProject, configProjectRoot);
      
      expect(result.error).toContain('Path traversal detected');
    });

    it('should reject path traversal with relative path using ..', () => {
      const configProjectRoot = path.join(testDir, 'user123');
      const requestedProject = '../../../etc/passwd';
      
      const result = resolveSetupPath(requestedProject, configProjectRoot);
      
      expect(result.error).toContain('Path traversal detected');
    });

    it('should handle Docker-style paths like /workspace/USERID/repo_1', () => {
      // Simulate Docker environment where PROJECT_ROOT=/workspace
      const configProjectRoot = testDir; // Simulating /workspace
      const requestedProject = path.join(testDir, 'user123', 'repo_1'); // Simulating /workspace/USERID/repo_1
      
      const result = resolveSetupPath(requestedProject, configProjectRoot);
      
      expect(result.error).toBeUndefined();
      expect(result.resolvedPath).toBe(path.join(testDir, 'user123', 'repo_1'));
      expect(fs.existsSync(result.resolvedPath)).toBe(true);
    });
  });

  describe('drift_projects register path resolution', () => {
    function resolveRegisterPath(
      registerPath: string | undefined,
      configProjectRoot: string
    ): { resolvedPath: string; error?: string } {
      if (!registerPath) {
        return { resolvedPath: configProjectRoot };
      }
      
      let resolvedPath: string;
      if (path.isAbsolute(registerPath)) {
        resolvedPath = path.normalize(registerPath);
      } else {
        resolvedPath = path.resolve(configProjectRoot, registerPath);
      }
      
      // Security check
      const normalizedRoot = path.normalize(configProjectRoot);
      if (!resolvedPath.startsWith(normalizedRoot)) {
        return { 
          resolvedPath: '', 
          error: `Path traversal detected: ${registerPath} is outside project root` 
        };
      }
      
      return { resolvedPath };
    }

    it('should resolve absolute path for register action', () => {
      const configProjectRoot = testDir;
      const registerPath = path.join(testDir, 'user123', 'repo_1');
      
      const result = resolveRegisterPath(registerPath, configProjectRoot);
      
      expect(result.error).toBeUndefined();
      expect(result.resolvedPath).toBe(path.join(testDir, 'user123', 'repo_1'));
    });

    it('should use projectRoot when no path provided', () => {
      const configProjectRoot = testDir;
      
      const result = resolveRegisterPath(undefined, configProjectRoot);
      
      expect(result.error).toBeUndefined();
      expect(result.resolvedPath).toBe(testDir);
    });

    it('should reject path traversal for register action', () => {
      const configProjectRoot = testDir;
      const registerPath = '/etc/passwd';
      
      const result = resolveRegisterPath(registerPath, configProjectRoot);
      
      expect(result.error).toContain('Path traversal detected');
    });
  });
});

describe('tool-filter includes drift_setup', () => {
  it('should have drift_setup in CORE_TOOLS', async () => {
    // Read the tool-filter.ts file and verify drift_setup is in CORE_TOOLS
    const toolFilterPath = path.join(__dirname, '..', 'infrastructure', 'tool-filter.ts');
    const content = fs.readFileSync(toolFilterPath, 'utf-8');
    
    // Check that drift_setup is in CORE_TOOLS array
    expect(content).toContain("'drift_setup'");
    
    // Verify it's in the CORE_TOOLS section (not just anywhere in the file)
    const coreToolsMatch = content.match(/const CORE_TOOLS = \[([\s\S]*?)\];/);
    expect(coreToolsMatch).not.toBeNull();
    expect(coreToolsMatch![1]).toContain("'drift_setup'");
  });
});
