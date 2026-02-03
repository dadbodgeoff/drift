/**
 * Integration tests for drift_setup handler
 * 
 * Tests the actual handleSetup function to ensure it works correctly
 * with absolute paths in Docker-like environments.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { handleSetup } from '../tools/setup/handler.js';

describe('handleSetup integration', () => {
  let testDir: string;
  let repoPath: string;
  
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-setup-test-'));
    repoPath = path.join(testDir, 'user123', 'repo_1');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(
      path.join(repoPath, 'package.json'),
      JSON.stringify({ name: 'test-repo', version: '1.0.0' })
    );
    fs.writeFileSync(
      path.join(repoPath, 'index.ts'),
      'export const hello = () => console.log("hello");'
    );
  });
  
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('status action', () => {
    it('should return not initialized for new project', async () => {
      const result = await handleSetup(
        { action: 'status' },
        { projectRoot: repoPath, cache: null }
      );
      
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '{}';
      const data = JSON.parse(text);
      expect(data.data.initialized).toBe(false);
      expect(data.data.projectPath).toBe(repoPath);
    });

    it('should work with absolute path in project parameter', async () => {
      // This simulates the Docker scenario where:
      // - projectRoot is the container's workspace root
      // - project parameter is the absolute path to a specific repo
      const result = await handleSetup(
        { action: 'status', project: repoPath },
        { projectRoot: testDir, cache: null }
      );
      
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '{}';
      const data = JSON.parse(text);
      expect(data.data.initialized).toBe(false);
      // The path should be resolved correctly
      expect(data.data.projectPath).toBe(repoPath);
    });
  });

  describe('init action', () => {
    it('should initialize drift in project directory', async () => {
      const result = await handleSetup(
        { action: 'init' },
        { projectRoot: repoPath, cache: null }
      );
      
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '{}';
      const data = JSON.parse(text);
      expect(data.data.success).toBe(true);
      expect(data.data.projectPath).toBe(repoPath);
      
      // Verify .drift directory was created
      expect(fs.existsSync(path.join(repoPath, '.drift'))).toBe(true);
      expect(fs.existsSync(path.join(repoPath, '.drift', 'config.json'))).toBe(true);
    });

    it('should initialize with absolute path in project parameter (Docker scenario)', async () => {
      // This is the exact scenario from the bug report:
      // - Docker container has PROJECT_ROOT=/workspace (simulated by testDir)
      // - User calls drift_setup with project="/workspace/USERID/repo_1" (simulated by repoPath)
      const result = await handleSetup(
        { action: 'init', project: repoPath },
        { projectRoot: testDir, cache: null }
      );
      
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '{}';
      const data = JSON.parse(text);
      expect(data.data.success).toBe(true);
      expect(data.data.projectPath).toBe(repoPath);
      
      // Verify .drift directory was created in the correct location
      expect(fs.existsSync(path.join(repoPath, '.drift'))).toBe(true);
      expect(fs.existsSync(path.join(repoPath, '.drift', 'config.json'))).toBe(true);
    });

    it('should initialize with relative path in project parameter', async () => {
      const result = await handleSetup(
        { action: 'init', project: 'user123/repo_1' },
        { projectRoot: testDir, cache: null }
      );
      
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '{}';
      const data = JSON.parse(text);
      expect(data.data.success).toBe(true);
      expect(data.data.projectPath).toBe(repoPath);
      
      // Verify .drift directory was created
      expect(fs.existsSync(path.join(repoPath, '.drift'))).toBe(true);
    });

    it('should reject path traversal attempts', async () => {
      const result = await handleSetup(
        { action: 'init', project: '../../../etc' },
        { projectRoot: repoPath, cache: null }
      );
      
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '{}';
      const data = JSON.parse(text);
      expect(data.error.message).toContain('Path traversal');
    });
  });

  describe('full action', () => {
    it('should run full setup with absolute path (Docker scenario)', async () => {
      const result = await handleSetup(
        { action: 'full', project: repoPath },
        { projectRoot: testDir, cache: null }
      );
      
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '{}';
      const data = JSON.parse(text);
      expect(data.data.success).toBe(true);
      
      // Verify drift was initialized
      expect(fs.existsSync(path.join(repoPath, '.drift'))).toBe(true);
    }, 30000); // Allow 30s for full setup
  });
});
