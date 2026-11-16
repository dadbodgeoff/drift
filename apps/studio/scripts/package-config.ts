// The electron-builder configuration for Drift Studio, as a pure function of the
// environment, so the rules below are unit-tested (tests/unit/package-config.test.ts)
// without the packager. scripts/package.mjs writes it to a JSON file and runs
// electron-builder with it.
//
// What it holds to:
// - The app is what `npm run build` writes (dist/, dist-electron/), staged with a
//   package.json of its own and no node_modules: vite bundles every dependency.
// - asar on; no file associations, no protocols, no publish target, so no update
//   feed and nothing in the app phones anywhere.
// - The window's sandbox, context isolation and CSP are in electron/main.ts and are
//   not touched here.
// - The platform's drift binary rides along as an extra resource (`bin/drift`,
//   electron/drift.ts `bundledDrift`).
// - Signing and notarisation come only from environment variables. When they are
//   absent the build still succeeds and every artifact name says `unsigned`.

/** The environment variables this configuration reads (documented in apps/studio/README.md). */
export type PackageEnv = Record<string, string | undefined>;

export interface PackageMeta {
  /** apps/studio/package.json `version`. */
  version: string;
  /** The installed electron package's version (the Studio's pinned devDependency). */
  electronVersion: string;
  /** The staged app directory (package.json, dist/, dist-electron/), relative to apps/studio. */
  appDir: string;
  /** The staged drift binaries, `<binDir>/<os>-<arch>/drift[.exe]`, relative to apps/studio. */
  binDir: string;
  /** Where artifacts go, relative to apps/studio. */
  outDir: string;
}

/** A placeholder bundle id until the owner picks one (it can never change after the first signed release). */
export const DEFAULT_APP_ID = "io.github.dadbodgeoff.drift-studio";

const set = (env: PackageEnv, k: string) => typeof env[k] === "string" && env[k]!.trim() !== "";

/** A macOS signing identity is configured (a .p12 by CSC_LINK, or a keychain identity by CSC_NAME). */
export const macSigned = (env: PackageEnv) => set(env, "CSC_LINK") || set(env, "CSC_NAME");

/** Notarisation credentials, one of the three sets electron-builder reads. */
export const macNotarised = (env: PackageEnv) =>
  (set(env, "APPLE_API_KEY") && set(env, "APPLE_API_KEY_ID") && set(env, "APPLE_API_ISSUER")) ||
  (set(env, "APPLE_ID") && set(env, "APPLE_APP_SPECIFIC_PASSWORD") && set(env, "APPLE_TEAM_ID")) ||
  (set(env, "APPLE_KEYCHAIN") && set(env, "APPLE_KEYCHAIN_PROFILE"));

/** A Windows code-signing certificate (WIN_CSC_LINK, or CSC_LINK when building on Windows). */
export const winSigned = (env: PackageEnv, hostPlatform: string) => set(env, "WIN_CSC_LINK") || (hostPlatform === "win32" && set(env, "CSC_LINK"));

/**
 * The label every artifact name carries: empty only for a build a user's OS will trust
 * (macOS signed and notarised, Windows signed). Linux packages are not code-signed.
 */
export function signatureLabel(platform: "mac" | "win" | "linux", env: PackageEnv, hostPlatform: string): string {
  if (platform === "mac") return macSigned(env) ? (macNotarised(env) ? "" : "-not-notarised") : "-unsigned";
  if (platform === "win") return winSigned(env, hostPlatform) ? "" : "-unsigned";
  return "-unsigned";
}

/** What a release build (STUDIO_RELEASE=1) is missing; an empty list for any other build. */
export function releaseProblems(platforms: ("mac" | "win" | "linux")[], env: PackageEnv, hostPlatform: string): string[] {
  if (env.STUDIO_RELEASE !== "1") return [];
  const out: string[] = [];
  if (platforms.includes("mac") && !macSigned(env)) out.push("macOS: no signing identity (CSC_LINK and CSC_KEY_PASSWORD, or CSC_NAME)");
  if (platforms.includes("mac") && !macNotarised(env)) out.push("macOS: no notarisation credentials (APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER)");
  if (platforms.includes("win") && !winSigned(env, hostPlatform)) out.push("Windows: no signing certificate (WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD)");
  return out;
}

const name = (platform: "mac" | "win" | "linux", env: PackageEnv, host: string) => `drift-studio-\${version}-\${os}-\${arch}${signatureLabel(platform, env, host)}.\${ext}`;

export function builderConfig(env: PackageEnv, meta: PackageMeta, hostPlatform: string): Record<string, unknown> {
  const release = env.STUDIO_RELEASE === "1";
  const signMac = macSigned(env);
  return {
    appId: env.STUDIO_APP_ID?.trim() || DEFAULT_APP_ID,
    productName: "Drift Studio",
    copyright: "Copyright the Drift authors. Apache-2.0.",
    electronVersion: meta.electronVersion,
    directories: { app: meta.appDir, output: meta.outDir, buildResources: "packaging" },
    files: ["package.json", "dist/**/*", "dist-electron/**/*"],
    extraResources: [{ from: `${meta.binDir}/\${os}-\${arch}`, to: "bin", filter: ["drift", "drift.exe"] }],
    asar: true,
    // Dependencies are bundled by vite; nothing native to rebuild.
    npmRebuild: false,
    nodeGypRebuild: false,
    buildDependenciesFromSource: false,
    // No update feed: the app has no updater and electron-builder writes no app-update.yml.
    publish: null,
    forceCodeSigning: release,
    electronFuses: {
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      // The live end-to-end test drives the packaged app through the inspector, so only a
      // release build closes it.
      enableNodeCliInspectArguments: !release,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
    },
    mac: {
      category: "public.app-category.developer-tools",
      target: [
        { target: "dmg", arch: ["arm64", "x64"] },
        { target: "zip", arch: ["arm64", "x64"] },
      ],
      artifactName: name("mac", env, hostPlatform),
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: "packaging/entitlements.mac.plist",
      entitlementsInherit: "packaging/entitlements.mac.plist",
      // null skips signing entirely (no keychain search on a developer's machine).
      identity: signMac ? (env.CSC_NAME?.trim() || undefined) : null,
      notarize: signMac && macNotarised(env),
    },
    dmg: { artifactName: name("mac", env, hostPlatform) },
    win: {
      target: [{ target: "nsis", arch: ["x64"] }],
      artifactName: name("win", env, hostPlatform),
      executableName: "drift-studio",
    },
    nsis: {
      oneClick: true,
      perMachine: false,
      differentialPackage: false,
      artifactName: name("win", env, hostPlatform),
    },
    linux: {
      target: [
        { target: "AppImage", arch: ["x64"] },
        { target: "deb", arch: ["x64"] },
      ],
      category: "Development",
      executableName: "drift-studio",
      synopsis: "A desktop view of what Drift knows about a codebase",
      maintainer: env.STUDIO_DEB_MAINTAINER?.trim() || "Drift maintainers",
      artifactName: name("linux", env, hostPlatform),
    },
  };
}
