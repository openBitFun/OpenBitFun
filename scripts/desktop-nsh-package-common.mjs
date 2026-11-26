// Shared steps of the native NSH desktop packaging scripts
// (`package-desktop-nsh-{macos,windows,linux}.mjs`): resolving the product
// definition (`products/`, `scripts/product-customization/`), building the UI
// bundle, the backend library and the runner, the
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

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { totalmem } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDesktopWebUiAsync,
  collectSourceFiles,
  readNshVersion,
  resolveNshEnvironment,
} from "./build-desktop-web-ui.mjs";
import { runGcBestEffort } from "./cargo-target-gc.mjs";
import { ensureFlashgrepBinary, flashgrepBinaryName } from "./prepare-flashgrep-resource.mjs";
import { syncVendorAssets } from "./sync-nsh-vendor-assets.mjs";
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
const NATIVE_UI_STAMP_SCHEMA = 1;
const DESKTOP_NSH_SKIP_DIRS = new Set([".nsh", "native", "target", "node_modules", "test", "vendor"]);
const PARALLEL_RELEASE_MIN_RAM_BYTES = 24 * 1024 * 1024 * 1024;

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

export function runAsync(cmd, cmdArgs, opts = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32" && !cmd.endsWith(".exe"),
      ...opts,
    });
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${cmd} ${cmdArgs.join(" ")} failed (status ${code ?? signal ?? "unknown"})`));
    });
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
 * Isolated Cargo target directory for the standalone NSH runner workspace
 * (`src/apps/desktop-nsh/native`), matching CI (`target/desktop-nsh-runner`) so
 * the runner compiles concurrently with `openbitfun-desktop` without contending
 * on root `target/.cargo-lock`.
 */
export function runnerTargetDir(env = process.env) {
  const baseTargetDir = env.CARGO_TARGET_DIR ? resolve(root, env.CARGO_TARGET_DIR) : join(root, "target");
  return join(baseTargetDir, "desktop-nsh-runner");
}

export function runnerBinaryName(target) {
  const windows = target ? target.includes("windows") : process.platform === "win32";
  return windows ? "openbitfun-nsh.exe" : "openbitfun-nsh";
}

/**
 * Stages the compiled `openbitfun-nsh` runner binary next to the workspace's
 * `libopenbitfun_desktop_lib` in `target/<target?>/<profileDir>/` so all dev
 * launchers, smoke tests, and packaging scripts keep their existing paths.
 */
export function stageRunnerBinary({ profileDir, target, env = process.env }) {
  const name = runnerBinaryName(target);
  const src = join(runnerTargetDir(env), ...(target ? [target] : []), profileDir, name);
  const dest = join(cargoOutDir({ profileDir, target }, env), name);
  if (!existsSync(src)) {
    throw new Error(`Runner binary was not produced: ${src}`);
  }
  const srcStat = statSync(src);
  if (existsSync(dest)) {
    const destStat = statSync(dest);
    if (destStat.size === srcStat.size && Math.abs(destStat.mtimeMs - srcStat.mtimeMs) < 1) {
      return dest;
    }
  }
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.stage-${process.pid}-${Date.now()}`;
  try {
    copyFileSync(src, tmp);
    if (!name.endsWith(".exe")) {
      chmodSync(tmp, srcStat.mode | 0o111);
    }
    utimesSync(tmp, srcStat.atime, srcStat.mtime);
    renameSync(tmp, dest);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
  return dest;
}

/**
 * Whether `openbitfun-desktop` and `openbitfun-nsh` runner builds should run
 * concurrently. Non-LTO profiles (`dev`, `desktop-dev`, `release-fast`) always
 * parallelize; `release` (ThinLTO) parallelizes on high-RAM developer hosts and
 * stays sequential on memory-constrained CI runners unless overridden.
 */
export function shouldParallelizeCargo({
  profile = "release",
  env = process.env,
  totalMemBytes = totalmem(),
} = {}) {
  const override = String(env.OPENBITFUN_PARALLEL_CARGO ?? "").trim().toLowerCase();
  if (override === "0" || override === "false" || override === "off") return false;
  if (override === "1" || override === "true" || override === "on") return true;
  if (profile !== "release") return true;
  return !env.CI && totalMemBytes >= PARALLEL_RELEASE_MIN_RAM_BYTES;
}

/**
 * Best-effort Cargo target GC after local (non-CI) dev/package runs, covering
 * both root `target/` and the isolated `target/desktop-nsh-runner/`.
 */
export function runDesktopTargetGc({ profile, target = null, env = process.env } = {}) {
  if (env.CI) return;
  const enabled = !["0", "false", "no"].includes(String(env.OPENBITFUN_TARGET_GC ?? "1").toLowerCase());
  if (!enabled) return;
  const baseTargetDir = env.CARGO_TARGET_DIR ? resolve(root, env.CARGO_TARGET_DIR) : join(root, "target");
  runGcBestEffort({ rootDir: root, targetDir: baseTargetDir, profile, triple: target });
  runGcBestEffort({ rootDir: root, targetDir: runnerTargetDir(env), profile, triple: target });
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

export function nativeUiStampPath(nshOut) {
  return `${resolve(nshOut)}.build-stamp.json`;
}

export function computeNativeUiFingerprint({
  rootDir = root,
  target = undefined,
  release = false,
  nshVersion = "unknown",
} = {}) {
  const apple = target ? target.includes("apple-darwin") : process.platform === "darwin";
  const hash = createHash("sha256");
  const pkgPath = join(rootDir, "package.json");
  const version = existsSync(pkgPath) ? String(JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0.0.0") : "0.0.0";
  hash.update(`schema:${NATIVE_UI_STAMP_SCHEMA}\nversion:${version}\nnsh:${nshVersion}\nrelease:${release}\napple:${apple}\n`);

  for (const entry of collectSourceFiles(join(rootDir, "src", "nsh-ui"))) {
    hash.update(`file:src/nsh-ui/${entry.relative}\0`);
    hash.update(readFileSync(entry.full));
    hash.update("\0");
  }
  for (const entry of collectSourceFiles(join(rootDir, "src", "apps", "desktop-nsh"), "", [], DESKTOP_NSH_SKIP_DIRS)) {
    hash.update(`file:src/apps/desktop-nsh/${entry.relative}\0`);
    hash.update(readFileSync(entry.full));
    hash.update("\0");
  }
  return { fingerprint: hash.digest("hex"), apple };
}

export function planNativeUiBuild({ nshOut, fingerprint, apple, force = false } = {}) {
  if (force) return { shouldBuild: true, reason: "forced rebuild (--force)" };
  const stampPath = nativeUiStampPath(nshOut);
  if (!existsSync(stampPath)) return { shouldBuild: true, reason: "missing build stamp" };
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    return { shouldBuild: true, reason: "unreadable build stamp" };
  }
  if (stamp?.schema !== NATIVE_UI_STAMP_SCHEMA || stamp?.fingerprint !== fingerprint) {
    return { shouldBuild: true, reason: "native UI sources changed" };
  }
  if (!existsSync(join(nshOut, "bundle.nshc")) || !existsSync(join(nshOut, "app.json"))) {
    return { shouldBuild: true, reason: "native UI bundle output incomplete" };
  }
  if (!apple && ["harmonyos-sans", "fira-code"].some(font =>
    !existsSync(join(nshOut, `third-party/fonts/${font}/LICENSE.txt`)))) {
    return { shouldBuild: true, reason: "bundled font notices missing" };
  }
  return { shouldBuild: false, reason: "up to date" };
}

function finalizeNativeUiBuild({ nshOut, app, apple, fingerprint, nshVersion }) {
  if (!apple) {
    const notices = join(nshOut, "third-party/fonts/harmonyos-sans");
    mkdirSync(notices, { recursive: true });
    for (const file of ["LICENSE.txt", "NOTICE.txt"]) {
      cpSync(join(root, app, "assets/fonts/harmonyos-sans", file), join(notices, file));
    }
    const codeNotices = join(nshOut, "third-party/fonts/fira-code");
    mkdirSync(codeNotices, { recursive: true });
    cpSync(join(root, app, "assets/fonts/fira-code/LICENSE.txt"), join(codeNotices, "LICENSE.txt"));
  }
  const stampPath = nativeUiStampPath(nshOut);
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(
    stampPath,
    `${JSON.stringify({ schema: NATIVE_UI_STAMP_SCHEMA, fingerprint, nsh: nshVersion }, null, 2)}\n`,
  );
}

/**
 * Stamps the dev NSH bundle (`target/desktop-nsh/nsh`) with OpenBitFun's app
 * name and 1.0.x icon so running the unbundled runner (`openbitfun-nsh`) shows
 * the real OpenBitFun Dock / taskbar icon instead of the OS generic executable icon.
 */
export function stampDevAppIdentity(appDir, rootDir = root, platform = process.platform) {
  const appJsonPath = join(appDir, "app.json");
  if (existsSync(appJsonPath)) {
    const manifest = JSON.parse(readFileSync(appJsonPath, "utf8"));
    let changed = false;
    if (!manifest.name) {
      manifest.name = "OpenBitFun";
      changed = true;
    }
    if (platform === "darwin") {
      const macIcon = join(rootDir, "src", "apps", "desktop", "icons", "openbitfun-app-icon.icns");
      if (existsSync(macIcon) && manifest.icon !== macIcon) {
        manifest.icon = macIcon;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(appJsonPath, `${JSON.stringify(manifest)}\n`);
    }
  }
  if (platform === "win32") {
    const winIcon = join(rootDir, "src", "apps", "desktop", "icons", "openbitfun-app-icon.ico");
    const destIcon = join(appDir, "icon.ico");
    if (existsSync(winIcon)) {
      copyFileSync(winIcon, destIcon);
    }
  }
}

/** Build the native UI for the target OS, including the notices for its font assets. */
export function buildNativeUi({ nshOut, target, release = false, force = false, env = process.env }) {
  const nshEnv = resolveNshEnvironment(env);
  const nshVersion = readNshVersion(nshEnv);
  const { fingerprint, apple } = computeNativeUiFingerprint({ rootDir: root, target, release, nshVersion });
  const plan = planNativeUiBuild({ nshOut, fingerprint, apple, force });
  if (!plan.shouldBuild) {
    console.log(`[desktop-nsh] Native UI bundle ${plan.reason}`);
    return { built: false, reason: plan.reason };
  }
  syncVendorAssets();
  // NSH leaves unreferenced assets on disk. A cross-build must ship only its own fonts.
  rmSync(nshOut, { recursive: true, force: true });
  const app = "src/apps/desktop-nsh";
  const entry = apple ? app : `${app}/BundledFontsApp.tsx`;
  run("nsh", ["build", entry, ...(release ? ["--release"] : []), "--out", relative(root, nshOut)], { env: nshEnv });
  finalizeNativeUiBuild({ nshOut, app, apple, fingerprint, nshVersion });
  return { built: true, reason: plan.reason };
}

/** Async variant of `buildNativeUi` for parallel build orchestration. */
export async function buildNativeUiAsync({ nshOut, target, release = false, force = false, env = process.env }) {
  const nshEnv = resolveNshEnvironment(env);
  const nshVersion = readNshVersion(nshEnv);
  const { fingerprint, apple } = computeNativeUiFingerprint({ rootDir: root, target, release, nshVersion });
  const plan = planNativeUiBuild({ nshOut, fingerprint, apple, force });
  if (!plan.shouldBuild) {
    console.log(`[desktop-nsh] Native UI bundle ${plan.reason}`);
    return { built: false, reason: plan.reason };
  }
  syncVendorAssets();
  rmSync(nshOut, { recursive: true, force: true });
  const app = "src/apps/desktop-nsh";
  const entry = apple ? app : `${app}/BundledFontsApp.tsx`;
  await runAsync("nsh", ["build", entry, ...(release ? ["--release"] : []), "--out", relative(root, nshOut)], {
    env: nshEnv,
  });
  finalizeNativeUiBuild({ nshOut, app, apple, fingerprint, nshVersion });
  return { built: true, reason: plan.reason };
}

export function runnerCargoArgs({ profile, target, env = process.env }) {
  const targetArgs = target ? ["--target", target] : [];
  const profileArgs = profile && profile !== "dev" ? ["--profile", profile] : [];
  return [
    "build",
    "--locked",
    "--manifest-path",
    "src/apps/desktop-nsh/native/Cargo.toml",
    "--features",
    "runner",
    "--target-dir",
    runnerTargetDir(env),
    ...profileArgs,
    ...targetArgs,
  ];
}

export function backendCargoArgs({ profile, target }) {
  const targetArgs = target ? ["--target", target] : [];
  const profileArgs = profile && profile !== "dev" ? ["--profile", profile] : [];
  return ["build", "-p", "openbitfun-desktop", "--lib", ...profileArgs, ...targetArgs];
}

/**
 * Builds the UI bundle, the web bundle, the backend library, the runner and
 * the DeepSeek Harness profile. Independent steps run in parallel: UI/JS/network
 * work overlaps with Cargo, and the runner builds in its own
 * `target/desktop-nsh-runner` target dir so it never contends on root
 * `target/.cargo-lock`.
 */
export async function buildAll({ profile, target, nshOut, webOut, productEnv = {}, identity = null }) {
  const profileDir = profile === "dev" ? "debug" : profile;
  const parallelCargo = shouldParallelizeCargo({ profile });
  const startedAt = performance.now();

  const buildRunner = async () => {
    await runAsync("cargo", runnerCargoArgs({ profile, target }));
    stageRunnerBinary({ profileDir, target });
  };

  const nonCargoTasks = [
    buildNativeUiAsync({ nshOut, target, release: true }),
    buildDesktopWebUiAsync({ outDir: webOut, product: identity?.productId }),
    // The DeepSeek Harness bridge (a TypeScript compile; fails the build unless
    // OPENBITFUN_SKIP_DSH_PROFILE=1 opts out deliberately).
    runAsync(process.execPath, ["scripts/prepare-dsh-profile.mjs"]),
    // Ensure the OpenCode extension Host bundle exists when Bun is available.
    runAsync(process.execPath, ["scripts/prepare-plugin-host.mjs", "--optional"]),
    // Pre-warm the pinned Flashgrep daemon download/verification in parallel.
    runAsync(process.execPath, ["scripts/prepare-flashgrep-resource.mjs", ...(target ? ["--target", target] : [])]),
  ];

  const backendTask = runAsync("cargo", backendCargoArgs({ profile, target }), {
    env: backendEnv(productEnv),
  });

  if (parallelCargo) {
    await Promise.all([...nonCargoTasks, backendTask, buildRunner()]);
  } else {
    // On memory-constrained release runners, avoid two simultaneous ThinLTO links:
    // overlap all non-Cargo work with `openbitfun-desktop`, then build the runner
    // in `target/desktop-nsh-runner`.
    await Promise.all([...nonCargoTasks, backendTask]);
    await buildRunner();
  }

  console.log(`[desktop-package] buildAll finished in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
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
 * `<package dir>.package.json`.
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
 * Signs `archive` for the in-app updater with the release minisign key
 * (`scripts/sign-release-assets.sh`), writing `<archive>.sig`. Without the key
 * the archive stays unsigned and the release cannot list it.
 */
export function signUpdaterArchive(archive) {
  const signingKey = process.env.OPENBITFUN_SIGNING_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY;
  if (!signingKey) {
    console.warn(`TAURI_SIGNING_PRIVATE_KEY is not set; ${basename(archive)} is not signed for in-app updates`);
    return null;
  }
  const signingPassword =
    process.env.OPENBITFUN_SIGNING_PASSWORD || process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "";
  const signingPubkey = process.env.OPENBITFUN_SIGNING_PUBKEY || process.env.TAURI_UPDATER_PUBKEY || "";
  const signature = `${archive}.sig`;
  rmSync(signature, { force: true });
  run("bash", ["scripts/sign-release-assets.sh", archive], {
    env: {
      ...process.env,
      OPENBITFUN_SIGNING_KEY: signingKey,
      OPENBITFUN_SIGNING_PASSWORD: signingPassword,
      OPENBITFUN_SIGNING_PUBKEY: signingPubkey,
    },
  });
  return signature;
}
