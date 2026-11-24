// Shared steps of the native NSH desktop packaging scripts
// (`package-desktop-nsh-{macos,windows,linux}.mjs`): resolving the product
// definition (`products/`, `scripts/product-customization/`), building the UI
// bundle, the backend library, the runner and the MiniApp window shell, the
// resource list the backend looks for, and the in-app updater archive.
//
// The backend finds its resources relative to the executable, so each
// platform script only chooses the directory these land in (the "resource
// root": `Contents/Resources` on macOS, the package directory elsewhere):
//   nsh-web/                          `backend_protocol/ws` (with `ui-bundle.json`,
//                                     `writeWebBundleManifest`: browsers load
//                                     this exact UI from the device)
//   resources/worker_host.js          `api/app_state.rs::resolve_worker_host_path`
//   resources/ext-host/               OpenCode extension Host
//   resources/dsh-profile/            DeepSeek Harness bridge
//                                     (`acp/src/client/dsh_profile.rs::bundled_profile_source`)
//   flashgrep/flashgrep-<triple>      workspace search daemon
//                                     (`services-integrations/src/workspace_search/service.rs`)
//
// Product customization: `--product-config <path>` selects a product
// definition (default `products/openbitfun/product.jsonc`). The package takes
// its name, bundle identifier / NSH app id, legacy executable name and icons
// from it (`desktopPackageIdentity`), writes them into the UI bundle's
// `app.json` (`projectNshAppJson`), and builds the backend with the product's
// compile-time identity and data namespace (`productBuildEnvironment`) in a
// product-scoped Cargo target directory. The default product keeps the
// regular target directory and the compiled-in defaults.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureFlashgrepBinary, flashgrepBinaryName } from "./prepare-flashgrep-resource.mjs";
import { extractProductConfigArg } from "./product-customization/cli.mjs";
import {
  desktopPackageIdentity,
  productBuildEnvironment,
  projectNshAppJson,
} from "./product-customization/projections.mjs";
import { resolveProductDefinition } from "./product-customization/resolver.mjs";
import { writeUiBundleManifest } from "./write-ui-bundle-manifest.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The build stamp of a compiled DeepSeek Harness profile (`scripts/prepare-dsh-profile.mjs`). */
const DSH_PROFILE_DIR = join(root, "packages/dsh-acp/dist-profile");
const DSH_PROFILE_STAMP = ".openbitfun-bridge.json";

/**
 * `--profile <p>`, `--target <triple>`, `--skip-build`, `--updater-archive`,
 * `--product-config <path>`.
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const { productConfig, forwardArgs } = extractProductConfigArg(argv.filter(arg => arg !== "--"));
  const value = name => (forwardArgs.includes(name) ? forwardArgs[forwardArgs.indexOf(name) + 1] : undefined);
  const profile = value("--profile") ?? "release";
  return {
    profile,
    target: value("--target"),
    skipBuild: forwardArgs.includes("--skip-build"),
    updaterArchive: forwardArgs.includes("--updater-archive"),
    profileDir: profile === "dev" ? "debug" : profile,
    productConfig,
  };
}

/**
 * The product this package is built for: its resolution, the identity the
 * package uses and the environment of the backend build. Only a non-default
 * product changes the backend build (compile-time identity, data namespace
 * and a product-scoped target directory); the default product builds exactly
 * like `cargo build`, so packaging reuses the regular build cache.
 */
export function resolvePackageProduct({ productConfig } = {}) {
  const resolution = resolveProductDefinition({ rootDir: root, productConfig, member: "desktop" });
  const identity = desktopPackageIdentity(resolution);
  const productEnv = resolution.isDefaultProduct ? {} : productBuildEnvironment(resolution);
  console.log(`[product] ${identity.productId} ${identity.bundleId} "${identity.displayName}" ${identity.assemblyDigest}`);
  if (!identity.icons && !identity.isDefaultProduct) {
    console.warn(`[product] ${identity.productId} declares no members.desktop.icons; the package uses the OpenBitFun icons`);
  }
  return { resolution, identity, productEnv };
}

/** The product's icon for `platform`, or the OpenBitFun one. */
export function productIcon(identity, platform) {
  if (identity.icons?.[platform]) return identity.icons[platform];
  const extension = { macos: "icns", windows: "ico", linux: "png" }[platform];
  return join(root, `src/apps/desktop/icons/openbitfun-app-icon.${extension}`);
}

export function run(cmd, cmdArgs, opts = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32" && !cmd.endsWith(".exe"),
    ...opts,
  });
}

/**
 * Where cargo puts `profileDir` outputs for `target` (or the host), under
 * `env`'s `CARGO_TARGET_DIR` (a non-default product's backend build) or the
 * repository's `target`.
 */
export function cargoOutDir({ profileDir, target }, env = process.env) {
  const targetDir = env.CARGO_TARGET_DIR ? resolve(root, env.CARGO_TARGET_DIR) : join(root, "target");
  return join(targetDir, ...(target ? [target] : []), profileDir);
}

/**
 * The environment of the backend build: the product's compile-time identity
 * and the release signing key the native updater verifies packages with
 * (`backend_protocol/native_commands/update.rs`), the Tauri updater's public key.
 */
export function backendEnv(productEnv = {}, base = process.env) {
  const env = { ...base, ...productEnv };
  if (env.TAURI_UPDATER_PUBKEY && !env.OPENBITFUN_NATIVE_UPDATER_PUBKEY) {
    env.OPENBITFUN_NATIVE_UPDATER_PUBKEY = env.TAURI_UPDATER_PUBKEY;
  }
  return env;
}

/**
 * Builds the UI bundle, the web bundle, the backend library, the runner, the
 * MiniApp shell and the DeepSeek Harness profile. The runner and the MiniApp
 * shell carry no product identity, so they stay in the regular target dir.
 */
export async function buildAll({ profile, target, nshOut, webOut, productEnv = {} }) {
  // NSH builds the `openbitfun/native` module, which needs rustc >= 1.97.
  const nshEnv = { ...process.env, RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? "1.98.1" };
  // The app ships its own copy of the shared UI's document renderers.
  const { syncVendorAssets } = await import("./sync-nsh-vendor-assets.mjs");
  syncVendorAssets();
  run("nsh", ["build", "src/apps/desktop-nsh", "--release", "--out", nshOut], { env: nshEnv });
  rmSync(webOut, { recursive: true, force: true });
  run("nsh", ["package", "src/nsh-ui/WebApp.tsx", "--target", "web", "-o", webOut]);
  const targetArgs = target ? ["--target", target] : [];
  run("cargo", ["build", "-p", "openbitfun-desktop", "--lib", "--profile", profile, ...targetArgs], {
    env: backendEnv(productEnv),
  });
  run("cargo", [
    "build",
    "--manifest-path",
    "src/apps/desktop-nsh/native/Cargo.toml",
    "--features",
    "runner",
    "--target-dir",
    process.env.CARGO_TARGET_DIR ?? "target",
    "--profile",
    profile,
    ...targetArgs,
  ], { env: nshEnv });
  const { prepareMiniAppShell } = await import("./prepare-miniapp-shell.mjs");
  prepareMiniAppShell({ target, profile: profile === "dev" ? "debug" : profile });
  // The DeepSeek Harness bridge (a TypeScript compile; fails the build unless
  // OPENBITFUN_SKIP_DSH_PROFILE=1 opts out deliberately).
  run(process.execPath, ["scripts/prepare-dsh-profile.mjs"]);
}

/** The Rust triple packages are built for: `--target`, or the host. */
export function packageTargetTriple(target) {
  if (target) return target;
  const result = spawnSync("rustc", ["-vV"], { cwd: root, encoding: "utf8", windowsHide: true });
  const host = String(result.stdout ?? "").match(/^host:\s*(\S+)$/m)?.[1];
  if (!host) throw new Error(`rustc -vV did not report the host target triple: ${result.stderr ?? result.error}`);
  return host;
}

/**
 * The workspace search daemon of `target`: the pinned Flashgrep release
 * (`resources/flashgrep/VERSION.json`), downloaded and verified once into
 * `resources/flashgrep/`. Returns `[source, "flashgrep/<name>"]`. Without it
 * workspace search reports the daemon as missing, so packaging fails instead.
 */
export function flashgrepResource(target, { ensure = ensureFlashgrepBinary } = {}) {
  const triple = packageTargetTriple(target);
  const binary = ensure({ target: triple });
  return [binary, `flashgrep/${flashgrepBinaryName({ target: triple })}`];
}

/**
 * The compiled DeepSeek Harness profile, `[source, "resources/dsh-profile"]`,
 * or null when it was never built. An unstamped directory (a deliberate
 * `OPENBITFUN_SKIP_DSH_PROFILE=1` build) is still copied: the backend rejects
 * it and reports that this build ships no bridge.
 */
export function dshProfileResource(source = DSH_PROFILE_DIR) {
  if (!existsSync(source)) {
    console.warn(`DeepSeek Harness profile not built (pnpm run prepare:dsh-profile): ${source}`);
    return null;
  }
  if (!existsSync(join(source, DSH_PROFILE_STAMP))) {
    console.warn(`DeepSeek Harness profile has no build stamp; this package ships no DeepSeek bridge: ${source}`);
  }
  return [source, "resources/dsh-profile"];
}

/**
 * The MiniApp window executable (`src/apps/miniapp-shell`): the backend
 * launches it next to its own executable (`miniapp_desktop::launcher`).
 */
export function miniAppShellBinary({ profileDir, target }) {
  const windows = target ? target.includes("windows") : process.platform === "win32";
  const extension = windows ? ".exe" : "";
  const name = `openbitfun-miniapp-shell${extension}`;
  const candidates = [
    join(cargoOutDir({ profileDir, target }), name),
    join(root, "target", ...(target ? [target] : []), "miniapp-shell", name),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

/**
 * `[source, destination relative to the resource root]` the backend reads.
 * `flashgrep` and `dshProfile` come from `flashgrepResource` and
 * `dshProfileResource`.
 */
export function backendResources({ webSite, flashgrep = null, dshProfile = null }) {
  const desktop = join(root, "src/apps/desktop");
  return [
    [webSite, "nsh-web"],
    [join(desktop, "resources/worker_host.js"), "resources/worker_host.js"],
    // Built-in companion pet sprite sets (`api/companion_pet_api.rs`).
    [join(desktop, "resources/agent-companion-pets"), "resources/agent-companion-pets"],
    [join(root, "src/apps/extension-host/dist/extension-host.js"), "resources/ext-host/extension-host.js"],
    [join(root, "THIRD_PARTY_NOTICES.md"), "THIRD_PARTY_NOTICES.md"],
    [join(root, "src/crates/services/services-integrations/assets/models-dev.LICENSE.txt"), "third-party/models.dev/LICENSE.txt"],
    [join(root, "src/crates/services/services-integrations/assets/models-dev.provenance.json"), "third-party/models.dev/provenance.json"],
    ...(flashgrep ? [flashgrep] : []),
    ...(dshProfile ? [dshProfile] : []),
  ];
}

/**
 * Writes the web bundle's `ui-bundle.json` (`write-ui-bundle-manifest.mjs`)
 * over the untouched `nsh package` output, as the package ships it: a
 * browser controlling this device loads exactly these files, so the id
 * equals the one of every other package built from the same tree. Returns
 * the bundle id, or null (reported) when there is no web bundle; the
 * package then answers `ui_bundle_unavailable`.
 */
export function writeWebBundleManifest(webSite, identity, write = writeUiBundleManifest) {
  if (!existsSync(join(webSite, "index.html"))) {
    console.warn(`no web bundle at ${webSite}; browsers cannot load this device's UI`);
    return null;
  }
  const { manifest, bundleId } = write(webSite, { product: identity?.productId });
  console.log(`[ui-bundle] ${manifest.files.length} files, bundleId ${bundleId}`);
  return bundleId;
}

/** Copies what exists; a missing optional resource is reported, not fatal. */
export function copyResources(pairs, destRoot) {
  for (const [src, dest] of pairs) {
    if (!src || !existsSync(src)) {
      console.warn(`optional resource not built, skipped: ${src}`);
      continue;
    }
    mkdirSync(dirname(join(destRoot, dest)), { recursive: true });
    cpSync(src, join(destRoot, dest), { recursive: true, dereference: true });
  }
}

/**
 * Copies the UI bundle without its source map and plain-JS copy, and writes
 * the product's identity into its `app.json` (see `projectNshAppJson`).
 */
export function copyUiBundle(nshOut, dest, identity) {
  cpSync(nshOut, dest, {
    recursive: true,
    filter: src => !src.endsWith(".map") && !src.endsWith("bundle.js"),
  });
  if (identity) {
    const appJson = join(dest, "app.json");
    const current = existsSync(appJson) ? JSON.parse(readFileSync(appJson, "utf8")) : {};
    writeFileSync(appJson, `${JSON.stringify(projectNshAppJson(current, identity))}\n`);
  }
}

export function requireFiles(files) {
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`missing build output: ${file}`);
      process.exit(1);
    }
  }
}

/**
 * Records how a package directory was built next to it (not inside it):
 * `<package dir>.package.json`. The Windows Installer reads it to package
 * only the profile it was asked for.
 */
export function writePackageInfo(packageDir, { profile, target, identity, version, executable }) {
  const info = {
    schemaVersion: 1,
    profile,
    target: target ?? null,
    version,
    productId: identity.productId,
    bundleId: identity.bundleId,
    displayName: identity.displayName,
    executable,
    assemblyDigest: identity.assemblyDigest,
  };
  writeFileSync(`${packageDir}.package.json`, `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

/**
 * Signs `archive` for the in-app updater with the release key, as the Tauri
 * build signs its updater artifacts (`TAURI_SIGNING_PRIVATE_KEY`, minisign),
 * writing `<archive>.sig`. Without the key the archive stays unsigned and the
 * release cannot list it.
 */
export function signUpdaterArchive(archive) {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    console.warn(`TAURI_SIGNING_PRIVATE_KEY is not set; ${basename(archive)} is not signed for in-app updates`);
    return null;
  }
  // The minisign format of the Tauri updater key (root `@tauri-apps/cli`).
  run("pnpm", ["exec", "tauri", "signer", "sign", archive]);
  return `${archive}.sig`;
}
