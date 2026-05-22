import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync,readFileSync,realpathSync,statSync } from "node:fs";
import { dirname,join,resolve,sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireFromCli = createRequire(import.meta.url);

export interface RustEngineCommand {
  command: string;
  args: string[];
  cwd?: string;
  source: "env_override" | "packaged_optional_dependency" | "workspace_cargo";
  packageName?: string;
  targetTriple?: string;
  sha256?: string;
}

export interface ResolveRustEngineCommandOptions {
  startDir?: string;
  env?: NodeJS.ProcessEnv;
  allowPackaged?: boolean;
}

export async function runRustEngine(args: string[]): Promise<string> {
  return runRustEngineWithInput(args);
}

interface RunRustEngineOptions extends ResolveRustEngineCommandOptions {}

export async function runRustEngineWithInput(
  args: string[],
  input?: string,
  options: RunRustEngineOptions = {}
): Promise<string> {
  const lines: string[] = [];
  await streamRustEngineLines(args, (line) => {
    lines.push(line);
  }, input, options);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export async function streamRustEngineLines(
  args: string[],
  onLine: (line: string) => void,
  input?: string,
  options: RunRustEngineOptions = {}
): Promise<void> {
  const resolved = resolveRustEngineCommand(options);
  if (!resolved) {
    throw new Error(
      `Drift Rust engine is unavailable: no packaged engine binary found for ${runtimePlatformKey()}. Reinstall @drift/cli without omitting optional dependencies, or set DRIFT_ENGINE_BIN to a trusted drift-engine binary.`
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(resolved.command, [...resolved.args, ...args], {
      cwd: resolved.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdoutRemainder = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutRemainder += chunk;
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().length > 0) {
          onLine(line);
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(new Error(`Drift Rust engine failed to start: ${error.message}`));
    });
    child.on("close", (code) => {
      if (stdoutRemainder.trim().length > 0) {
        onLine(stdoutRemainder);
      }
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim().split(/\r?\n/).slice(-5).join("\n");
      reject(new Error(`Drift Rust engine failed with exit code ${code}.${detail ? `\n${detail}` : ""}`));
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

export function resolveRustEngineCommand(
  options: ResolveRustEngineCommandOptions = {}
): RustEngineCommand | undefined {
  const env = options.env ?? process.env;
  const explicit = env.DRIFT_ENGINE_BIN;
  if (explicit) {
    return validateExplicitEnginePath(explicit);
  }

  const workspaceRoot = findCargoWorkspaceRoot(options.startDir);
  if (workspaceRoot) {
    return {
      command: "cargo",
      args: ["run", "--quiet", "-p", "drift-engine", "--"],
      cwd: workspaceRoot,
      source: "workspace_cargo"
    };
  }

  if (options.allowPackaged !== false) {
    const packaged = resolvePackagedEngine();
    if (packaged) {
      return packaged;
    }
  }

  return undefined;
}

export function findCargoWorkspaceRoot(startDir = dirname(fileURLToPath(import.meta.url))): string | undefined {
  let current = startDir;
  while (current !== dirname(current)) {
    if (existsSync(join(current, "Cargo.toml")) && existsSync(join(current, "crates", "drift-engine"))) {
      return current;
    }
    current = dirname(current);
  }
  return undefined;
}

interface EnginePackageManifest {
  package_name: string;
  package_version: string;
  target_triple: string;
  platform: string;
  arch: string;
  binary_path: string;
  engine_version: string;
  sha256: string;
}

function resolvePackagedEngine(): RustEngineCommand | undefined {
  const packageName = enginePackageNameForRuntime();
  if (!packageName) {
    return undefined;
  }

  let manifestPath: string;
  try {
    manifestPath = requireFromCli.resolve(`${packageName}/engine-manifest.json`);
  } catch {
    return undefined;
  }

  const packageRoot = dirname(manifestPath);
  const manifest = readEnginePackageManifest(manifestPath);
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(
      `Drift Rust engine platform mismatch: packaged binary is ${manifest.platform}-${manifest.arch}, current runtime is ${process.platform}-${process.arch}.`
    );
  }

  const binaryPath = resolve(packageRoot, manifest.binary_path);
  validatePackageOwnedPath(packageRoot, binaryPath);
  validateExecutableFile(binaryPath, "Drift Rust engine is not executable");
  const sha256 = sha256File(binaryPath);
  if (sha256 !== manifest.sha256) {
    throw new Error(
      `Drift Rust engine checksum mismatch: expected ${manifest.sha256}, got ${sha256} for ${binaryPath}. Reinstall @drift/cli.`
    );
  }

  return {
    command: binaryPath,
    args: [],
    source: "packaged_optional_dependency",
    packageName: manifest.package_name,
    targetTriple: manifest.target_triple,
    sha256
  };
}

function validateExplicitEnginePath(value: string): RustEngineCommand {
  const binaryPath = resolve(value);
  try {
    validateExecutableFile(binaryPath, "DRIFT_ENGINE_BIN is invalid");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.startsWith("DRIFT_ENGINE_BIN is invalid")
      ? message
      : `DRIFT_ENGINE_BIN is invalid: ${message}`);
  }
  return {
    command: binaryPath,
    args: [],
    source: "env_override",
    sha256: sha256File(binaryPath)
  };
}

function readEnginePackageManifest(manifestPath: string): EnginePackageManifest {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as EnginePackageManifest;
  for (const key of ["package_name", "package_version", "target_triple", "platform", "arch", "binary_path", "engine_version", "sha256"] as const) {
    if (typeof parsed[key] !== "string" || parsed[key].length === 0) {
      throw new Error(`Invalid Drift engine package manifest ${manifestPath}: missing ${key}.`);
    }
  }
  return parsed;
}

function validatePackageOwnedPath(packageRoot: string, binaryPath: string): void {
  const root = realpathSync(packageRoot);
  const binary = realpathSync(binaryPath);
  if (binary !== root && !binary.startsWith(`${root}${sep}`)) {
    throw new Error(`Drift Rust engine path escapes package directory: ${binaryPath}.`);
  }
}

function validateExecutableFile(binaryPath: string, prefix: string): void {
  if (!existsSync(binaryPath)) {
    throw new Error(`${prefix}: ${binaryPath} does not exist.`);
  }
  const stat = statSync(binaryPath);
  if (!stat.isFile()) {
    throw new Error(`${prefix}: ${binaryPath} is not a regular file.`);
  }
  if (process.platform !== "win32" && (stat.mode & 0o111) === 0) {
    throw new Error(`${prefix}: ${binaryPath}. Reinstall @drift/cli or fix executable permissions.`);
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function enginePackageNameForRuntime(): string | undefined {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "@drift/engine-darwin-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "@drift/engine-darwin-x64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "@drift/engine-linux-x64-gnu";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "@drift/engine-linux-arm64-gnu";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "@drift/engine-win32-x64";
  }
  return undefined;
}

function runtimePlatformKey(): string {
  return `${process.platform}-${process.arch}`;
}
