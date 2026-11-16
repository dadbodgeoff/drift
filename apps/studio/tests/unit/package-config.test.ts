// Pins the packaging (scripts/package-config.ts, scripts/package.mjs) and the packaged app's
// drift lookup (electron/drift.ts `bundledDrift`): unsigned builds succeed and say so in every
// artifact name, a release refuses to be unsigned, nothing configures an update feed or remote
// content, and a packaged Studio runs the drift it carries before one on PATH.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundledDrift, resolveDrift } from "../../electron/drift";
import { builderConfig, releaseProblems, signatureLabel } from "../../scripts/package-config";

const META = { version: "0.1.0", electronVersion: "45.2.3", appDir: "release/app", binDir: "release/bin", outDir: "release/out" };
type Section = Record<string, unknown>;
const names = (c: Record<string, unknown>) => ["mac", "dmg", "win", "nsis", "linux"].map((k) => (c[k] as Section).artifactName as string);

describe("packaging configuration", () => {
  it("builds unsigned with no environment, and every artifact name says unsigned", () => {
    const c = builderConfig({}, META, "linux");
    for (const n of names(c)) expect(n).toMatch(/-unsigned\.\$\{ext\}$/);
    const mac = c.mac as Section;
    expect(mac.identity).toBeNull(); // no keychain search, no signing
    expect(mac.notarize).toBe(false);
    expect(c.forceCodeSigning).toBe(false);
  });

  it("drops the label only for what a user's OS will trust", () => {
    const signed = { CSC_LINK: "/k.p12", CSC_KEY_PASSWORD: "x" };
    const notarised = { ...signed, APPLE_API_KEY: "/k.p8", APPLE_API_KEY_ID: "id", APPLE_API_ISSUER: "iss" };
    expect(signatureLabel("mac", signed, "darwin")).toBe("-not-notarised");
    expect(signatureLabel("mac", notarised, "darwin")).toBe("");
    expect((builderConfig(notarised, META, "darwin").mac as Section).notarize).toBe(true);
    expect(signatureLabel("win", { WIN_CSC_LINK: "/c.pfx" }, "linux")).toBe("");
    // CSC_LINK is the Windows certificate only when building on Windows.
    expect(signatureLabel("win", signed, "darwin")).toBe("-unsigned");
    expect(signatureLabel("win", signed, "win32")).toBe("");
    expect(signatureLabel("linux", notarised, "linux")).toBe("-unsigned");
    // A blank variable is not a credential.
    expect(signatureLabel("mac", { CSC_LINK: " " }, "darwin")).toBe("-unsigned");
  });

  it("a release build (STUDIO_RELEASE=1) refuses to be unsigned and closes the inspector fuse", () => {
    expect(releaseProblems(["mac", "win", "linux"], {}, "darwin")).toEqual([]);
    expect(releaseProblems(["mac"], { STUDIO_RELEASE: "1" }, "darwin")).toHaveLength(2);
    expect(releaseProblems(["win"], { STUDIO_RELEASE: "1" }, "win32")).toHaveLength(1);
    expect(releaseProblems(["linux"], { STUDIO_RELEASE: "1" }, "linux")).toEqual([]);
    const ok = { STUDIO_RELEASE: "1", CSC_NAME: "Developer ID Application: X", APPLE_API_KEY: "/k.p8", APPLE_API_KEY_ID: "i", APPLE_API_ISSUER: "s" };
    expect(releaseProblems(["mac"], ok, "darwin")).toEqual([]);
    const c = builderConfig(ok, META, "darwin");
    expect(c.forceCodeSigning).toBe(true);
    expect((c.electronFuses as Section).enableNodeCliInspectArguments).toBe(false);
    expect((c.mac as Section).identity).toBe("Developer ID Application: X");
    // An unsigned build keeps the inspector, which the live end-to-end test drives.
    expect((builderConfig({}, META, "linux").electronFuses as Section).enableNodeCliInspectArguments).toBe(true);
  });

  it("asar on, no update feed, no associations or protocols, no remote URL, the targets asked for", () => {
    const c = builderConfig({}, META, "linux");
    expect(c.asar).toBe(true);
    expect(c.publish).toBeNull();
    expect(JSON.stringify(c)).not.toMatch(/fileAssociations|protocols|https?:\/\//);
    expect((c.electronFuses as Section).runAsNode).toBe(false);
    expect((c.electronFuses as Section).onlyLoadAppFromAsar).toBe(true);
    const targets = (k: string) => ((c[k] as Section).target as { target: string; arch: string[] }[]).map((t) => `${t.target}:${t.arch.join("+")}`);
    expect(targets("mac")).toEqual(["dmg:arm64+x64", "zip:arm64+x64"]);
    expect(targets("win")).toEqual(["nsis:x64"]);
    expect(targets("linux")).toEqual(["AppImage:x64", "deb:x64"]);
    // The drift binary for the platform and architecture being built, as bin/drift[.exe].
    expect(c.extraResources).toEqual([{ from: "release/bin/${os}-${arch}", to: "bin", filter: ["drift", "drift.exe"] }]);
    // Only what vite built: no node_modules, no sources.
    expect(c.files).toEqual(["package.json", "dist/**/*", "dist-electron/**/*"]);
    expect(builderConfig({ STUDIO_APP_ID: "com.example.studio" }, META, "linux").appId).toBe("com.example.studio");
  });

  it("the mac entitlements ask for JIT and nothing else", () => {
    const plist = readFileSync(fileURLToPath(new URL("../../packaging/entitlements.mac.plist", import.meta.url)), "utf8");
    expect([...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1])).toEqual(["com.apple.security.cs.allow-jit"]);
  });

  it("package.mjs refuses to build without a drift to carry", () => {
    const script = fileURLToPath(new URL("../../scripts/package.mjs", import.meta.url));
    const r = spawnSync(process.execPath, [script, "--linux", "--config-only"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("no drift binary for linux-x64");
  });
});

describe("the drift a packaged Studio carries", () => {
  const put = (p: string) => {
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, "#!/bin/sh\n");
    chmodSync(p, 0o755);
  };

  it("lives in the app's resources, and only when there are resources", () => {
    expect(bundledDrift("/opt/Drift Studio/resources", "linux")).toBe(join("/opt/Drift Studio/resources", "bin", "drift"));
    expect(bundledDrift("/opt/Drift Studio/resources", "win32")).toMatch(/drift\.exe$/);
    expect(bundledDrift(null, "linux")).toBeNull();
    expect(bundledDrift("resources", "linux")).toBeNull();
  });

  it.skipIf(process.platform === "win32")("comes after Settings and before PATH", () => {
    const d = mkdtempSync(join(tmpdir(), "bundled-"));
    const carried = join(d, "resources", "bin", "drift");
    const onPath = join(d, "path", "drift");
    const chosen = join(d, "chosen", "drift");
    put(carried);
    put(onPath);
    put(chosen);
    const env = { PATH: join(d, "path") };
    expect(resolveDrift(null, env, "linux", carried)).toEqual({ path: carried, source: "bundled" });
    expect(resolveDrift(chosen, env, "linux", carried)).toEqual({ path: chosen, source: "settings" });
    // Running from source (no bundled binary): PATH, as before.
    expect(resolveDrift(null, env, "linux", null)).toEqual({ path: onPath, source: "path" });
    // A carried file that is not executable is passed over.
    chmodSync(carried, 0o644);
    expect(resolveDrift(null, env, "linux", carried)).toEqual({ path: onPath, source: "path" });
    expect(resolveDrift(null, { PATH: "" }, "linux", join(d, "missing"))).toEqual({ path: null, source: "none" });
  });
});
