/**
 * Package Detector
 * 
 * @license Apache-2.0
 * 
 * Detects packages in monorepos across different package managers.
 * Supports npm/pnpm/yarn workspaces, Python, Go, Java, C#, PHP, and Rust.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  PackageManager,
  DetectedPackage,
  MonorepoStructure,
  ContextEvent,
  ContextEventType,
} from './types.js';

// =============================================================================
// Constants
// =============================================================================

const LANGUAGE_MAP: Record<PackageManager, string> = {
  npm: 'typescript',
  pnpm: 'typescript',
  yarn: 'typescript',
  pip: 'python',
  poetry: 'python',
  cargo: 'rust',
  go: 'go',
  maven: 'java',
  gradle: 'java',
  composer: 'php',
  nuget: 'csharp',
  unknown: 'unknown',
};

// =============================================================================
// Package Detector
// =============================================================================

/**
 * Detects packages in monorepos
 */
export class PackageDetector extends EventEmitter {
  private readonly rootDir: string;
  private cache: MonorepoStructure | null = null;

  constructor(rootDir: string) {
    super();
    this.rootDir = rootDir;
  }


  /**
   * Detect monorepo structure
   */
  async detect(): Promise<MonorepoStructure> {
    if (this.cache) {
      return this.cache;
    }

    const structure: MonorepoStructure = {
      rootDir: this.rootDir,
      isMonorepo: false,
      packages: [],
      packageManager: 'unknown',
    };

    const detectors = [
      this.detectNpmWorkspaces.bind(this),
      this.detectPnpmWorkspaces.bind(this),
      this.detectYarnWorkspaces.bind(this),
      this.detectPythonPackages.bind(this),
      this.detectGoModules.bind(this),
      this.detectMavenModules.bind(this),
      this.detectGradleModules.bind(this),
      this.detectComposerPackages.bind(this),
      this.detectDotNetProjects.bind(this),
      this.detectCargoWorkspaces.bind(this),
    ];

    for (const detector of detectors) {
      try {
        const result = await detector();
        if (result.packages && result.packages.length > 0) {
          structure.packages.push(...result.packages);
          if (result.packageManager) {
            structure.packageManager = result.packageManager;
          }
          if (result.workspaceConfig) {
            structure.workspaceConfig = result.workspaceConfig;
          }
          structure.isMonorepo = result.packages.length > 1;
          break;
        }
      } catch {
        // Continue to next detector
      }
    }

    if (structure.packages.length === 0) {
      const rootPackage = await this.detectRootPackage();
      if (rootPackage) {
        structure.packages.push(rootPackage);
        structure.packageManager = rootPackage.packageManager;
      }
    }

    this.cache = structure;
    this.emitEvent('monorepo:detected', undefined, {
      isMonorepo: structure.isMonorepo,
      packageCount: structure.packages.length,
      packageManager: structure.packageManager,
    });

    return structure;
  }

  /**
   * Get a specific package by name or path
   */
  async getPackage(nameOrPath: string): Promise<DetectedPackage | null> {
    const structure = await this.detect();
    
    const byName = structure.packages.find(p => p.name === nameOrPath);
    if (byName) {return byName;}

    const normalizedPath = nameOrPath.replace(/\\/g, '/');
    const byPath = structure.packages.find(p => 
      p.path === normalizedPath || 
      p.path.endsWith(normalizedPath) ||
      normalizedPath.endsWith(p.path)
    );
    if (byPath) {return byPath;}

    const byPartialName = structure.packages.find(p => 
      p.name.includes(nameOrPath) || nameOrPath.includes(p.name)
    );
    return byPartialName || null;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache = null;
  }


  // ===========================================================================
  // NPM/PNPM/Yarn Detection
  // ===========================================================================

  private async detectNpmWorkspaces(): Promise<Partial<MonorepoStructure>> {
    const pkgPath = path.join(this.rootDir, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as Record<string, unknown>;

    const workspacesRaw = pkg['workspaces'];
    if (!workspacesRaw) {
      return { packages: [], packageManager: 'npm' };
    }

    const workspaces = Array.isArray(workspacesRaw) 
      ? workspacesRaw as string[]
      : ((workspacesRaw as Record<string, unknown>)['packages'] as string[] || []);

    const packages = await this.resolveWorkspaceGlobs(workspaces, 'npm');
    
    return {
      packages,
      packageManager: 'npm',
      workspaceConfig: 'package.json',
    };
  }

  private async detectPnpmWorkspaces(): Promise<Partial<MonorepoStructure>> {
    const workspacePath = path.join(this.rootDir, 'pnpm-workspace.yaml');
    
    try {
      const content = await fs.readFile(workspacePath, 'utf-8');
      const packagesMatch = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (!packagesMatch?.[1]) {
        return { packages: [], packageManager: 'pnpm' };
      }

      const workspaces = packagesMatch[1]
        .split('\n')
        .map(line => line.replace(/^\s*-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
        .filter(line => line.length > 0);

      const packages = await this.resolveWorkspaceGlobs(workspaces, 'pnpm');
      
      return {
        packages,
        packageManager: 'pnpm',
        workspaceConfig: 'pnpm-workspace.yaml',
      };
    } catch {
      return { packages: [], packageManager: 'pnpm' };
    }
  }

  private async detectYarnWorkspaces(): Promise<Partial<MonorepoStructure>> {
    const result = await this.detectNpmWorkspaces();
    if (result.packages && result.packages.length > 0) {
      try {
        await fs.access(path.join(this.rootDir, 'yarn.lock'));
        return { ...result, packageManager: 'yarn' };
      } catch {
        // Not yarn
      }
    }
    return { packages: [], packageManager: 'yarn' };
  }


  private async resolveWorkspaceGlobs(
    globs: string[],
    packageManager: PackageManager
  ): Promise<DetectedPackage[]> {
    const packages: DetectedPackage[] = [];

    for (const glob of globs) {
      const basePath = glob.replace(/\/?\*.*$/, '');
      const fullBasePath = path.join(this.rootDir, basePath);

      try {
        const entries = await fs.readdir(fullBasePath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (!entry.isDirectory()) {continue;}
          
          const pkgDir = path.join(fullBasePath, entry.name);
          const pkgJsonPath = path.join(pkgDir, 'package.json');
          
          try {
            const pkgContent = await fs.readFile(pkgJsonPath, 'utf-8');
            const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
            
            const relativePath = path.relative(this.rootDir, pkgDir).replace(/\\/g, '/');
            const pkgName = (pkg['name'] as string) || entry.name;
            const pkgVersion = pkg['version'] as string | undefined;
            const pkgDescription = pkg['description'] as string | undefined;
            
            const detectedPkg: DetectedPackage = {
              name: pkgName,
              path: relativePath,
              absolutePath: pkgDir,
              packageManager,
              language: this.detectLanguageFromPackage(pkg),
              internalDependencies: this.extractInternalDeps(pkg, packages),
              externalDependencies: this.extractExternalDeps(pkg),
              isRoot: false,
            };

            if (pkgVersion) {detectedPkg.version = pkgVersion;}
            if (pkgDescription) {detectedPkg.description = pkgDescription;}

            packages.push(detectedPkg);
            this.emitEvent('package:detected', pkgName);
          } catch {
            // Not a valid package
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return packages;
  }

  private detectLanguageFromPackage(pkg: Record<string, unknown>): string {
    const deps = { 
      ...(pkg['dependencies'] as Record<string, string> || {}),
      ...(pkg['devDependencies'] as Record<string, string> || {}),
    };

    if (deps['typescript'] || deps['@types/node']) {return 'typescript';}
    if (deps['react'] || deps['vue'] || deps['@angular/core']) {return 'typescript';}
    return 'javascript';
  }

  private extractInternalDeps(
    pkg: Record<string, unknown>,
    knownPackages: DetectedPackage[]
  ): string[] {
    const deps = { 
      ...(pkg['dependencies'] as Record<string, string> || {}),
      ...(pkg['devDependencies'] as Record<string, string> || {}),
    };
    
    const knownNames = new Set(knownPackages.map(p => p.name));
    return Object.keys(deps).filter(dep => knownNames.has(dep));
  }

  private extractExternalDeps(pkg: Record<string, unknown>): string[] {
    const deps = pkg['dependencies'] as Record<string, string> || {};
    return Object.keys(deps).slice(0, 20);
  }


  // ===========================================================================
  // Python Detection
  // ===========================================================================

  private async detectPythonPackages(): Promise<Partial<MonorepoStructure>> {
    const packages: DetectedPackage[] = [];

    try {
      const pyprojectPath = path.join(this.rootDir, 'pyproject.toml');
      const content = await fs.readFile(pyprojectPath, 'utf-8');
      
      if (content.includes('[tool.poetry]')) {
        const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
        const versionMatch = content.match(/version\s*=\s*["']([^"']+)["']/);
        
        const detectedPkg: DetectedPackage = {
          name: nameMatch?.[1] || path.basename(this.rootDir),
          path: '.',
          absolutePath: this.rootDir,
          packageManager: 'poetry',
          language: 'python',
          internalDependencies: [],
          externalDependencies: this.extractPythonDeps(content),
          isRoot: true,
        };

        if (versionMatch?.[1]) {detectedPkg.version = versionMatch[1];}
        packages.push(detectedPkg);
      }
    } catch {
      // No pyproject.toml
    }

    try {
      const srcPath = path.join(this.rootDir, 'src');
      const entries = await fs.readdir(srcPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('_')) {
          const initPath = path.join(srcPath, entry.name, '__init__.py');
          try {
            await fs.access(initPath);
            packages.push({
              name: entry.name,
              path: `src/${entry.name}`,
              absolutePath: path.join(srcPath, entry.name),
              packageManager: 'pip',
              language: 'python',
              internalDependencies: [],
              externalDependencies: [],
              isRoot: false,
            });
          } catch {
            // Not a Python package
          }
        }
      }
    } catch {
      // No src directory
    }

    const pm = packages.length > 0 ? packages[0]!.packageManager : 'pip';
    return { packages, packageManager: pm };
  }

  private extractPythonDeps(content: string): string[] {
    const deps: string[] = [];
    const depsMatch = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\[|$)/);
    if (depsMatch?.[1]) {
      const lines = depsMatch[1].split('\n');
      for (const line of lines) {
        const match = line.match(/^(\w[\w-]*)\s*=/);
        if (match?.[1] && match[1] !== 'python') {
          deps.push(match[1]);
        }
      }
    }
    return deps.slice(0, 20);
  }


  // ===========================================================================
  // Go Detection
  // ===========================================================================

  private async detectGoModules(): Promise<Partial<MonorepoStructure>> {
    const packages: DetectedPackage[] = [];

    try {
      const goModPath = path.join(this.rootDir, 'go.mod');
      const content = await fs.readFile(goModPath, 'utf-8');
      
      const moduleMatch = content.match(/module\s+(\S+)/);
      const moduleName = moduleMatch?.[1] || path.basename(this.rootDir);

      packages.push({
        name: moduleName,
        path: '.',
        absolutePath: this.rootDir,
        packageManager: 'go',
        language: 'go',
        internalDependencies: [],
        externalDependencies: this.extractGoDeps(content),
        isRoot: true,
      });

      const internalDirs = ['internal', 'pkg', 'cmd'];
      for (const dir of internalDirs) {
        try {
          const dirPath = path.join(this.rootDir, dir);
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          
          for (const entry of entries) {
            if (entry.isDirectory()) {
              packages.push({
                name: `${moduleName}/${dir}/${entry.name}`,
                path: `${dir}/${entry.name}`,
                absolutePath: path.join(dirPath, entry.name),
                packageManager: 'go',
                language: 'go',
                internalDependencies: [],
                externalDependencies: [],
                isRoot: false,
              });
            }
          }
        } catch {
          // Directory doesn't exist
        }
      }
    } catch {
      // No go.mod
    }

    return { packages, packageManager: 'go' };
  }

  private extractGoDeps(content: string): string[] {
    const deps: string[] = [];
    const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/);
    if (requireMatch?.[1]) {
      const lines = requireMatch[1].split('\n');
      for (const line of lines) {
        const match = line.match(/^\s*(\S+)\s+v/);
        if (match?.[1]) {
          deps.push(match[1]);
        }
      }
    }
    return deps.slice(0, 20);
  }


  // ===========================================================================
  // Java Detection (Maven/Gradle)
  // ===========================================================================

  private async detectMavenModules(): Promise<Partial<MonorepoStructure>> {
    const packages: DetectedPackage[] = [];

    try {
      const pomPath = path.join(this.rootDir, 'pom.xml');
      const content = await fs.readFile(pomPath, 'utf-8');
      
      const artifactMatch = content.match(/<artifactId>([^<]+)<\/artifactId>/);
      const groupMatch = content.match(/<groupId>([^<]+)<\/groupId>/);
      const versionMatch = content.match(/<version>([^<]+)<\/version>/);

      const detectedPkg: DetectedPackage = {
        name: `${groupMatch?.[1] || 'unknown'}:${artifactMatch?.[1] || 'unknown'}`,
        path: '.',
        absolutePath: this.rootDir,
        packageManager: 'maven',
        language: 'java',
        internalDependencies: [],
        externalDependencies: [],
        isRoot: true,
      };

      if (versionMatch?.[1]) {detectedPkg.version = versionMatch[1];}
      packages.push(detectedPkg);

      const modulesMatch = content.match(/<modules>([\s\S]*?)<\/modules>/);
      if (modulesMatch?.[1]) {
        const moduleMatches = modulesMatch[1].matchAll(/<module>([^<]+)<\/module>/g);
        for (const match of moduleMatches) {
          if (match[1]) {
            packages.push({
              name: match[1],
              path: match[1],
              absolutePath: path.join(this.rootDir, match[1]),
              packageManager: 'maven',
              language: 'java',
              internalDependencies: [],
              externalDependencies: [],
              isRoot: false,
            });
          }
        }
      }
    } catch {
      // No pom.xml
    }

    return { packages, packageManager: 'maven' };
  }

  private async detectGradleModules(): Promise<Partial<MonorepoStructure>> {
    const packages: DetectedPackage[] = [];

    try {
      const settingsPath = path.join(this.rootDir, 'settings.gradle');
      let content: string;
      
      try {
        content = await fs.readFile(settingsPath, 'utf-8');
      } catch {
        content = await fs.readFile(path.join(this.rootDir, 'settings.gradle.kts'), 'utf-8');
      }

      const rootNameMatch = content.match(/rootProject\.name\s*=\s*['"]([^'"]+)['"]/);
      
      packages.push({
        name: rootNameMatch?.[1] || path.basename(this.rootDir),
        path: '.',
        absolutePath: this.rootDir,
        packageManager: 'gradle',
        language: 'java',
        internalDependencies: [],
        externalDependencies: [],
        isRoot: true,
      });

      const includeMatches = content.matchAll(/include\s*\(?['"]([^'"]+)['"]\)?/g);
      for (const match of includeMatches) {
        if (match[1]) {
          const modulePath = match[1].replace(/:/g, '/');
          packages.push({
            name: match[1],
            path: modulePath,
            absolutePath: path.join(this.rootDir, modulePath),
            packageManager: 'gradle',
            language: 'java',
            internalDependencies: [],
            externalDependencies: [],
            isRoot: false,
          });
        }
      }
    } catch {
      // No settings.gradle
    }

    return { packages, packageManager: 'gradle' };
  }


  // ===========================================================================
  // PHP Detection
  // ===========================================================================

  private async detectComposerPackages(): Promise<Partial<MonorepoStructure>> {
    const packages: DetectedPackage[] = [];

    try {
      const composerPath = path.join(this.rootDir, 'composer.json');
      const content = await fs.readFile(composerPath, 'utf-8');
      const composer = JSON.parse(content) as Record<string, unknown>;

      const detectedPkg: DetectedPackage = {
        name: (composer['name'] as string) || path.basename(this.rootDir),
        path: '.',
        absolutePath: this.rootDir,
        packageManager: 'composer',
        language: 'php',
        internalDependencies: [],
        externalDependencies: Object.keys((composer['require'] as Record<string, string>) || {}).slice(0, 20),
        isRoot: true,
      };

      const version = composer['version'] as string | undefined;
      const description = composer['description'] as string | undefined;
      if (version) {detectedPkg.version = version;}
      if (description) {detectedPkg.description = description;}

      packages.push(detectedPkg);
    } catch {
      // No composer.json
    }

    return { packages, packageManager: 'composer' };
  }

  // ===========================================================================
  // .NET Detection
  // ===========================================================================

  private async detectDotNetProjects(): Promise<Partial<MonorepoStructure>> {
    const packages: DetectedPackage[] = [];

    try {
      const entries = await fs.readdir(this.rootDir);
      const slnFile = entries.find(e => e.endsWith('.sln'));
      
      if (slnFile) {
        const slnPath = path.join(this.rootDir, slnFile);
        const content = await fs.readFile(slnPath, 'utf-8');
        
        const projectMatches = content.matchAll(/Project\([^)]+\)\s*=\s*"([^"]+)",\s*"([^"]+)"/g);
        
        for (const match of projectMatches) {
          const projectName = match[1];
          const projectPath = match[2]?.replace(/\\/g, '/');
          
          if (projectName && projectPath?.endsWith('.csproj')) {
            packages.push({
              name: projectName,
              path: path.dirname(projectPath),
              absolutePath: path.join(this.rootDir, path.dirname(projectPath)),
              packageManager: 'nuget',
              language: 'csharp',
              internalDependencies: [],
              externalDependencies: [],
              isRoot: packages.length === 0,
            });
          }
        }
      }
    } catch {
      // No .sln file
    }

    return { packages, packageManager: 'nuget' };
  }


  // ===========================================================================
  // Rust Detection
  // ===========================================================================

  private async detectCargoWorkspaces(): Promise<Partial<MonorepoStructure>> {
    const packages: DetectedPackage[] = [];

    try {
      const cargoPath = path.join(this.rootDir, 'Cargo.toml');
      const content = await fs.readFile(cargoPath, 'utf-8');
      
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);

      const detectedPkg: DetectedPackage = {
        name: nameMatch?.[1] || path.basename(this.rootDir),
        path: '.',
        absolutePath: this.rootDir,
        packageManager: 'cargo',
        language: 'rust',
        internalDependencies: [],
        externalDependencies: [],
        isRoot: true,
      };

      if (versionMatch?.[1]) {detectedPkg.version = versionMatch[1];}
      packages.push(detectedPkg);

      const workspaceMatch = content.match(/\[workspace\]([\s\S]*?)(?:\[|$)/);
      if (workspaceMatch?.[1]) {
        const membersMatch = workspaceMatch[1].match(/members\s*=\s*\[([\s\S]*?)\]/);
        if (membersMatch?.[1]) {
          const members = membersMatch[1].match(/"([^"]+)"/g) || [];
          for (const member of members) {
            const memberPath = member.replace(/"/g, '');
            packages.push({
              name: memberPath,
              path: memberPath,
              absolutePath: path.join(this.rootDir, memberPath),
              packageManager: 'cargo',
              language: 'rust',
              internalDependencies: [],
              externalDependencies: [],
              isRoot: false,
            });
          }
        }
      }
    } catch {
      // No Cargo.toml
    }

    return { packages, packageManager: 'cargo' };
  }

  // ===========================================================================
  // Root Package Detection
  // ===========================================================================

  private async detectRootPackage(): Promise<DetectedPackage | null> {
    const manifests: Array<{ file: string; pm: PackageManager }> = [
      { file: 'package.json', pm: 'npm' },
      { file: 'pyproject.toml', pm: 'poetry' },
      { file: 'setup.py', pm: 'pip' },
      { file: 'Cargo.toml', pm: 'cargo' },
      { file: 'go.mod', pm: 'go' },
      { file: 'pom.xml', pm: 'maven' },
      { file: 'build.gradle', pm: 'gradle' },
      { file: 'composer.json', pm: 'composer' },
    ];

    for (const { file, pm } of manifests) {
      try {
        const manifestPath = path.join(this.rootDir, file);
        await fs.access(manifestPath);
        
        const content = await fs.readFile(manifestPath, 'utf-8');
        let name = path.basename(this.rootDir);
        let version: string | undefined;
        let description: string | undefined;

        if (file === 'package.json') {
          const pkg = JSON.parse(content) as Record<string, unknown>;
          name = (pkg['name'] as string) || name;
          version = pkg['version'] as string | undefined;
          description = pkg['description'] as string | undefined;
        }

        const detectedPkg: DetectedPackage = {
          name,
          path: '.',
          absolutePath: this.rootDir,
          packageManager: pm,
          language: LANGUAGE_MAP[pm],
          internalDependencies: [],
          externalDependencies: [],
          isRoot: true,
        };

        if (version) {detectedPkg.version = version;}
        if (description) {detectedPkg.description = description;}

        return detectedPkg;
      } catch {
        // Manifest doesn't exist
      }
    }

    return null;
  }


  // ===========================================================================
  // Events
  // ===========================================================================

  private emitEvent(
    type: ContextEventType,
    packageName?: string,
    details?: Record<string, unknown>
  ): void {
    const event: ContextEvent = {
      type,
      timestamp: new Date().toISOString(),
    };
    if (packageName) {event.packageName = packageName;}
    if (details) {event.details = details;}
    
    this.emit(type, event);
    this.emit('*', event);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a package detector
 */
export function createPackageDetector(rootDir: string): PackageDetector {
  return new PackageDetector(rootDir);
}
