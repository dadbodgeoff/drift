import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname,join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

interface PackedPackage {
  manifest: {
    name: string;
    version: string;
    description?: string;
    license?: string;
    bin?: Record<string, string>;
    exports?: Record<string, { types?: string; import?: string }>;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    os?: string[];
    cpu?: string[];
  };
  files: string[];
  tarballPath: string;
}

interface EnginePackageFixture {
  packageDir: string;
  packageName: string;
  os: string;
  cpu: string;
  targetTriple: string;
  binaryPath: string;
}

async function packWorkspacePackage(packageDir: string): Promise<PackedPackage> {
  const dir = await mkdtemp(join(tmpdir(), "drift-pack-"));
  tempDirs.push(dir);
  const packed = await execFileAsync("pnpm", [
    "--dir", packageDir,
    "pack",
    "--json",
    "--pack-destination", dir
  ]);
  const packResult = parsePnpmPackJson(packed.stdout);
  const extractDir = join(dir, "extract");
  await execFileAsync("mkdir", ["-p", extractDir]);
  await execFileAsync("tar", ["-xzf", packResult.filename, "-C", extractDir]);
  const listed = await execFileAsync("find", [join(extractDir, "package"), "-type", "f"]);
  const packageRoot = join(extractDir, "package");
  const files = listed.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((filePath) => filePath.slice(packageRoot.length + 1))
    .sort();
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  return { manifest, files, tarballPath: packResult.filename };
}

function parsePnpmPackJson(stdout: string): { filename: string } {
  const prettyJsonIndex = stdout.lastIndexOf("{\n  \"name\"");
  const compactJsonIndex = stdout.lastIndexOf("{\"name\"");
  const index = Math.max(prettyJsonIndex, compactJsonIndex);
  if (index < 0) {
    throw new Error(`Unable to parse pnpm pack JSON output:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(index)) as { filename: string };
}

function expectDistOnly(files: string[]): void {
  expect(files.every((file) =>
    file === "package.json" ||
    file === "README.md" ||
    file === "LICENSE" ||
    file.startsWith("dist/")
  )).toBe(true);
  expect(files).toContain("LICENSE");
  expect(files.some((file) => file.startsWith("src/"))).toBe(false);
  expect(files.some((file) => file.startsWith("test/"))).toBe(false);
  expect(files).not.toContain("tsconfig.json");
}

function expectPackageMetadata(manifest: PackedPackage["manifest"]): void {
  expect(manifest.version).toBe("0.1.0");
  expect(manifest.description).toBeTruthy();
  expect(manifest.license).toBe("MIT");
  expect(manifest.engines?.node).toBe(">=20.0.0");
}

function expectNoWorkspaceDependencies(manifest: PackedPackage["manifest"]): void {
  expect(Object.values(manifest.dependencies ?? {}).some((version) => version.startsWith("workspace:"))).toBe(false);
  expect(Object.values(manifest.optionalDependencies ?? {}).some((version) => version.startsWith("workspace:"))).toBe(false);
}

async function packAllWorkspacePackages(): Promise<Record<string, PackedPackage>> {
  const enginePackage = currentEnginePackageFixture();
  const packages = await Promise.all([
    packWorkspacePackage("packages/core"),
    packWorkspacePackage("packages/factgraph"),
    packWorkspacePackage("packages/engine-contract"),
    packWorkspacePackage("packages/storage"),
    packWorkspacePackage("packages/query"),
    packWorkspacePackage(enginePackage.packageDir),
    packWorkspacePackage("packages/cli"),
    packWorkspacePackage("packages/mcp")
  ]);
  return Object.fromEntries(packages.map((packed) => [packed.manifest.name, packed]));
}

async function expectSourcePrepack(packageDir: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  expect(manifest.scripts?.prepack).toBe("pnpm build");
}

function currentEnginePackageFixture(
  platform = process.platform,
  arch = process.arch
): EnginePackageFixture {
  if (platform === "darwin" && arch === "arm64") {
    return {
      packageDir: "packages/engine-darwin-arm64",
      packageName: "@drift/engine-darwin-arm64",
      os: "darwin",
      cpu: "arm64",
      targetTriple: "aarch64-apple-darwin",
      binaryPath: "bin/drift-engine"
    };
  }
  if (platform === "darwin" && arch === "x64") {
    return {
      packageDir: "packages/engine-darwin-x64",
      packageName: "@drift/engine-darwin-x64",
      os: "darwin",
      cpu: "x64",
      targetTriple: "x86_64-apple-darwin",
      binaryPath: "bin/drift-engine"
    };
  }
  if (platform === "linux" && arch === "x64") {
    return {
      packageDir: "packages/engine-linux-x64-gnu",
      packageName: "@drift/engine-linux-x64-gnu",
      os: "linux",
      cpu: "x64",
      targetTriple: "x86_64-unknown-linux-gnu",
      binaryPath: "bin/drift-engine"
    };
  }
  if (platform === "linux" && arch === "arm64") {
    return {
      packageDir: "packages/engine-linux-arm64-gnu",
      packageName: "@drift/engine-linux-arm64-gnu",
      os: "linux",
      cpu: "arm64",
      targetTriple: "aarch64-unknown-linux-gnu",
      binaryPath: "bin/drift-engine"
    };
  }
  if (platform === "win32" && arch === "x64") {
    return {
      packageDir: "packages/engine-win32-x64",
      packageName: "@drift/engine-win32-x64",
      os: "win32",
      cpu: "x64",
      targetTriple: "x86_64-pc-windows-msvc",
      binaryPath: "bin/drift-engine.exe"
    };
  }
  throw new Error(`No current-platform engine package fixture for ${platform}-${arch}.`);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("packed Drift workspace packages", () => {
  it("packs @drift/core as a dist-only runtime package", async () => {
    const packed = await packWorkspacePackage("packages/core");

    await expectSourcePrepack("packages/core");
    expect(packed.manifest.name).toBe("@drift/core");
    expectPackageMetadata(packed.manifest);
    expect(packed.manifest.exports?.["."]?.import).toBe("./dist/index.js");
    expect(packed.files).toContain("dist/index.js");
    expect(packed.files).toContain("dist/index.d.ts");
    expect(packed.files).toContain("README.md");
    expectDistOnly(packed.files);
    expectNoWorkspaceDependencies(packed.manifest);
  }, 30000);

  it("packs @drift/storage as a dist-only runtime package without workspace dependency protocols", async () => {
    const packed = await packWorkspacePackage("packages/storage");

    await expectSourcePrepack("packages/storage");
    expect(packed.manifest.name).toBe("@drift/storage");
    expectPackageMetadata(packed.manifest);
    expect(packed.manifest.exports?.["."]?.import).toBe("./dist/index.js");
    expect(packed.files).toContain("dist/index.js");
    expect(packed.files).toContain("dist/index.d.ts");
    expect(packed.files).toContain("README.md");
    expectDistOnly(packed.files);
    expectNoWorkspaceDependencies(packed.manifest);
  }, 30000);

  it("packs @drift/factgraph as a dist-only runtime package", async () => {
    const packed = await packWorkspacePackage("packages/factgraph");

    await expectSourcePrepack("packages/factgraph");
    expect(packed.manifest.name).toBe("@drift/factgraph");
    expectPackageMetadata(packed.manifest);
    expect(packed.manifest.exports?.["."]?.import).toBe("./dist/index.js");
    expect(packed.files).toContain("dist/index.js");
    expect(packed.files).toContain("dist/index.d.ts");
    expect(packed.files).toContain("README.md");
    expectDistOnly(packed.files);
    expectNoWorkspaceDependencies(packed.manifest);
  }, 30000);

  it("packs @drift/engine-contract as a dist-only runtime package", async () => {
    const packed = await packWorkspacePackage("packages/engine-contract");

    await expectSourcePrepack("packages/engine-contract");
    expect(packed.manifest.name).toBe("@drift/engine-contract");
    expectPackageMetadata(packed.manifest);
    expect(packed.manifest.exports?.["."]?.import).toBe("./dist/index.js");
    expect(packed.files).toContain("dist/index.js");
    expect(packed.files).toContain("dist/index.d.ts");
    expect(packed.files).toContain("README.md");
    expectDistOnly(packed.files);
  }, 30000);

  it("packs @drift/cli with only dist files and a compiled drift bin", async () => {
    const packed = await packWorkspacePackage("packages/cli");

    await expectSourcePrepack("packages/cli");
    expect(packed.manifest.name).toBe("@drift/cli");
    expectPackageMetadata(packed.manifest);
    expect(packed.manifest.bin?.drift).toBe("./dist/main.js");
    expect(packed.manifest.optionalDependencies?.["@drift/engine-darwin-arm64"]).toBe("0.1.0");
    expect(packed.manifest.exports?.["."]?.import).toBe("./dist/index.js");
    expect(packed.files).toContain("dist/main.js");
    expect(packed.files).toContain("dist/index.d.ts");
    expect(packed.files).toContain("README.md");
    expectDistOnly(packed.files);
    expectNoWorkspaceDependencies(packed.manifest);
  }, 30000);

  it("packs @drift/query as a dist-only runtime package", async () => {
    const packed = await packWorkspacePackage("packages/query");

    await expectSourcePrepack("packages/query");
    expect(packed.manifest.name).toBe("@drift/query");
    expectPackageMetadata(packed.manifest);
    expect(packed.manifest.exports?.["."]?.import).toBe("./dist/index.js");
    expect(packed.files).toContain("dist/index.js");
    expect(packed.files).toContain("dist/index.d.ts");
    expect(packed.files).toContain("README.md");
    expectDistOnly(packed.files);
    expectNoWorkspaceDependencies(packed.manifest);
  }, 30000);

  it("packs the current platform Rust engine package with a verified manifest", async () => {
    const enginePackage = currentEnginePackageFixture();
    const packed = await packWorkspacePackage(enginePackage.packageDir);
    const packageRoot = join(dirname(packed.tarballPath), "extract", "package");
    const manifest = JSON.parse(await readFile(join(packageRoot, "engine-manifest.json"), "utf8"));
    const binaryPath = join(packageRoot, manifest.binary_path);
    const binary = await readFile(binaryPath);
    const binaryStat = await stat(binaryPath);
    const sha256 = createHash("sha256").update(binary).digest("hex");

    expect(packed.manifest.name).toBe(enginePackage.packageName);
    expect(packed.manifest.version).toBe("0.1.0");
    expect(packed.manifest.os).toEqual([enginePackage.os]);
    expect(packed.manifest.cpu).toEqual([enginePackage.cpu]);
    expect(packed.files).toContain(enginePackage.binaryPath);
    expect(packed.files).toContain("engine-manifest.json");
    expect(manifest).toMatchObject({
      schema_version: "drift.engine.package.v1",
      package_name: enginePackage.packageName,
      package_version: "0.1.0",
      target_triple: enginePackage.targetTriple,
      platform: enginePackage.os,
      arch: enginePackage.cpu,
      binary_path: enginePackage.binaryPath,
      engine_version: "0.1.0"
    });
    expect(manifest.sha256).toBe(sha256);
    expect(binaryStat.mode & 0o111).toBeGreaterThan(0);
  }, 30000);

  it("packs @drift/mcp with only dist files and a compiled drift-mcp bin", async () => {
    const packed = await packWorkspacePackage("packages/mcp");

    await expectSourcePrepack("packages/mcp");
    expect(packed.manifest.name).toBe("@drift/mcp");
    expectPackageMetadata(packed.manifest);
    expect(packed.manifest.bin?.["drift-mcp"]).toBe("./dist/bin.js");
    expect(packed.manifest.exports?.["."]?.import).toBe("./dist/index.js");
    expect(packed.files).toContain("dist/bin.js");
    expect(packed.files).toContain("dist/index.d.ts");
    expect(packed.files).toContain("README.md");
    expectDistOnly(packed.files);
    expectNoWorkspaceDependencies(packed.manifest);
  }, 30000);

  it("packs all workspace packages with local tarballs available for the installed-flow smoke", async () => {
    const enginePackage = currentEnginePackageFixture();
    const packed = await packAllWorkspacePackages();

    expect(Object.keys(packed).sort()).toEqual([
      "@drift/cli",
      "@drift/core",
      "@drift/engine-contract",
      enginePackage.packageName,
      "@drift/factgraph",
      "@drift/mcp",
      "@drift/query",
      "@drift/storage"
    ]);
    expect(Object.values(packed).every((entry) => entry.tarballPath.endsWith(".tgz"))).toBe(true);
  }, 30000);
});
