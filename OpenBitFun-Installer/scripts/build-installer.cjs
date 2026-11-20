/**
 * OpenBitFun Installer build script.
 *
 * Steps:
 * 1. Package the native OpenBitFun desktop app for Windows (optional):
 *    `scripts/package-desktop-nsh-windows.mjs`, which writes the package
 *    directory `target/desktop-nsh/windows/OpenBitFun/` and, next to it,
 *    `OpenBitFun.package.json` (the profile, target and product it was built for).
 * 2. Stage that directory as the installer payload, with a manifest of every file.
 * 3. Build the installer app (Tauri), which embeds the payload.
 *
 * The package directory is the native layout the installer installs as is:
 *   openbitfun-desktop.exe         the NSH runner, under the product's legacy
 *                                  executable name (shortcuts, uninstall entry,
 *                                  earlier installs keep pointing at it)
 *   openbitfun_desktop_lib.dll     the backend, loaded in-process
 *   nsh\                           the UI bundle
 *   resources\, flashgrep\, nsh-web\, mobile-web\, bin\   what the backend resolves
 *
 * Usage:
 *   node scripts/build-installer.cjs [--skip-app-build] [--dev] [--mode fast|release] [--app-dir path]
 *   node scripts/build-installer.cjs --fast   # same as --mode fast
 */

const { execSync } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OPENBITFUN_ROOT = path.resolve(ROOT, "..");
const PAYLOAD_DIR = path.join(ROOT, "src-tauri", "payload");
const MAIN_APP_EXE = "openbitfun-desktop.exe";
const DEFAULT_APP_DIR = path.join("target", "desktop-nsh", "windows", "OpenBitFun");

const rawArgs = process.argv.slice(2);
const skipAppBuild = rawArgs.includes("--skip-app-build");
const isDev = rawArgs.includes("--dev");
const showHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
const STRICT_PAYLOAD_VALIDATION = !isDev;
const MIN_APP_EXE_BYTES = 5 * 1024 * 1024;
const REQUIRED_PAYLOAD_FILES = [
  MAIN_APP_EXE,
  "openbitfun_desktop_lib.dll",
  "nsh/bundle.nshc",
  "nsh/app.json",
  "mobile-web/dist/index.html",
  "resources/ext-host/extension-host.js",
  "resources/worker_host.js",
  "flashgrep/flashgrep-x86_64-pc-windows-msvc.exe",
];

function getMode(args) {
  if (args.includes("--fast")) return "fast";
  const modeFlagIndex = args.indexOf("--mode");
  if (modeFlagIndex >= 0 && args[modeFlagIndex + 1]) {
    return args[modeFlagIndex + 1].trim();
  }
  return "release";
}

function getArgValue(args, flag) {
  const flagIndex = args.indexOf(flag);
  if (flagIndex < 0) return null;
  const value = args[flagIndex + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value.trim();
}

const buildMode = getMode(rawArgs);
const validModes = new Set(["fast", "release"]);

function log(msg) {
  console.log(`\x1b[36m[installer]\x1b[0m ${msg}`);
}

function error(msg) {
  console.error(`\x1b[31m[installer]\x1b[0m ${msg}`);
  process.exit(1);
}

function run(cmd, cwd = ROOT) {
  log(`> ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: "inherit", windowsHide: true });
  } catch (_e) {
    error(`Command failed: ${cmd}`);
  }
}

function printHelpAndExit() {
  console.log(`
OpenBitFun Installer build script

Usage:
  node scripts/build-installer.cjs [options]

Options:
  --mode <fast|release>  Build mode (default: release)
  --fast                 Alias for --mode fast
  --skip-app-build       Skip packaging the native OpenBitFun app
  --app-dir <path>       Native Windows package directory to install (default:
                         ${DEFAULT_APP_DIR}). Also OPENBITFUN_INSTALLER_APP_DIR.
  --app-exe <path>       Older spelling: the package's ${MAIN_APP_EXE}; its
                         directory is the package.
  --dev                  Run installer with tauri dev instead of tauri build
                         and allow placeholder payload fallback
  --help, -h             Show this help
`);
  process.exit(0);
}

function getExpectedAppProfile(mode) {
  return mode === "fast" ? "release-fast" : "release";
}

function getMainAppBuildCommand(mode) {
  return `pnpm run desktop-nsh:package:windows -- --profile ${getExpectedAppProfile(mode)}`;
}

function getInstallerBuildCommand(mode, devMode) {
  if (devMode) return "pnpm run tauri:dev";
  if (mode === "fast") return "pnpm run tauri:build:exe:fast";
  return "pnpm run tauri:build:exe";
}

function ensureCleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function sha256File(filePath) {
  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function writeFileWithManifest(src, dest, manifest, payloadRoot) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  const size = fs.statSync(dest).size;
  const rel = path.relative(payloadRoot, dest).replace(/\\/g, "/");
  manifest.files.push({
    path: rel,
    size,
    sha256: sha256File(dest),
  });
}

/** Debug and linker leftovers that never belong in an installed app. */
function shouldCopyPackageFile(fileName) {
  if (fileName.startsWith(".cargo-")) return false;
  const lower = fileName.toLowerCase();
  return !(
    lower.endsWith(".pdb") ||
    lower.endsWith(".d") ||
    lower.endsWith(".exp") ||
    lower.endsWith(".lib") ||
    lower.endsWith(".ilk")
  );
}

function copyPackageWithManifest(srcDir, destDir, manifest, payloadRoot) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyPackageWithManifest(src, dest, manifest, payloadRoot);
    } else if (entry.isFile() && shouldCopyPackageFile(entry.name)) {
      writeFileWithManifest(src, dest, manifest, payloadRoot);
    }
  }
}

function resolveFromRoot(configured) {
  return path.isAbsolute(configured)
    ? path.normalize(configured)
    : path.resolve(OPENBITFUN_ROOT, configured);
}

/**
 * The native Windows package directory to install: `--app-dir`,
 * OPENBITFUN_INSTALLER_APP_DIR, the directory of an older `--app-exe` /
 * OPENBITFUN_INSTALLER_APP_EXE, or the packaging script's output.
 */
function resolveAppDir(args = rawArgs, env = process.env) {
  const dir = getArgValue(args, "--app-dir") || env.OPENBITFUN_INSTALLER_APP_DIR;
  if (dir) return resolveFromRoot(dir);
  const exe = getArgValue(args, "--app-exe") || env.OPENBITFUN_INSTALLER_APP_EXE;
  if (exe) return path.dirname(resolveFromRoot(exe));
  return resolveFromRoot(DEFAULT_APP_DIR);
}

/** `<package dir>.package.json`, written by the packaging script. */
function readPackageInfo(appDir) {
  const infoPath = `${appDir}.package.json`;
  if (!fs.existsSync(infoPath)) return null;
  return JSON.parse(fs.readFileSync(infoPath, "utf8"));
}

/**
 * A strict (release) payload is exactly the requested profile, built for an
 * x86_64 Windows target, with the runner under the installer's executable name.
 */
function validatePackageInfo(info, mode) {
  const expected = getExpectedAppProfile(mode);
  if (!info) {
    throw new Error(
      "The package directory has no <dir>.package.json; package it with " +
        `\`${getMainAppBuildCommand(mode)}\`.`
    );
  }
  if (info.profile !== expected) {
    throw new Error(`The package was built with the ${info.profile} profile, not ${expected}.`);
  }
  if (info.executable !== MAIN_APP_EXE) {
    throw new Error(
      `The package's executable is ${info.executable}; the installer installs ${MAIN_APP_EXE} ` +
        "(a product with another binaryName needs its own installer build)."
    );
  }
  if (info.target && !/^x86_64-pc-windows-/.test(info.target)) {
    throw new Error(`The package targets ${info.target}; the installer ships x86_64 Windows.`);
  }
}

function validateRequiredPayloadFiles(payloadDir, manifest) {
  const manifestPaths = new Set(manifest.files.map((entry) => entry.path));
  const missing = REQUIRED_PAYLOAD_FILES.filter((relativePath) => {
    const diskPath = path.join(payloadDir, ...relativePath.split("/"));
    return !manifestPaths.has(relativePath) || !fs.existsSync(diskPath);
  });
  if (missing.length > 0) {
    throw new Error(
      `Installer payload is incomplete. Missing required files: ${missing.join(", ")}`
    );
  }
}

function main() {
  if (showHelp) {
    printHelpAndExit();
  }

  if (!validModes.has(buildMode)) {
    error(`Invalid mode "${buildMode}". Supported: fast, release`);
  }

  log(`Build mode: ${buildMode}`);
  log(isDev ? "Installer run mode: dev" : "Installer run mode: release (strict payload validation)");

  // Step 1: Package the native OpenBitFun app.
  if (!skipAppBuild) {
    log("Step 1: Packaging the native OpenBitFun application...");
    run(getMainAppBuildCommand(buildMode), OPENBITFUN_ROOT);
  } else {
    log("Step 1: Skipped (--skip-app-build)");
  }

  // Step 2: Prepare payload.
  log("Step 2: Preparing installer payload...");
  const appDir = resolveAppDir();
  const appExePath = path.join(appDir, MAIN_APP_EXE);
  const available = fs.existsSync(appExePath);

  if (!available && STRICT_PAYLOAD_VALIDATION) {
    error(
      `Could not find the native Windows package at ${appDir} (${MAIN_APP_EXE}). ` +
        `Run \`${getMainAppBuildCommand(buildMode)}\`, set OPENBITFUN_INSTALLER_APP_DIR, or pass --app-dir.`
    );
  }

  if (available) {
    const info = readPackageInfo(appDir);
    if (STRICT_PAYLOAD_VALIDATION) {
      try {
        validatePackageInfo(info, buildMode);
      } catch (validationError) {
        error(validationError.message);
      }
    }
    ensureCleanDir(PAYLOAD_DIR);

    const manifest = {
      generatedAt: new Date().toISOString(),
      mode: buildMode,
      sourceExe: MAIN_APP_EXE,
      files: [],
    };
    copyPackageWithManifest(appDir, PAYLOAD_DIR, manifest, PAYLOAD_DIR);
    log(`Copied ${manifest.files.length} files from ${appDir}`);

    const exeSize = fs.statSync(path.join(PAYLOAD_DIR, MAIN_APP_EXE)).size;
    if (STRICT_PAYLOAD_VALIDATION && exeSize < MIN_APP_EXE_BYTES) {
      error(`${MAIN_APP_EXE} in payload is unexpectedly small (${exeSize} bytes). Refusing to continue.`);
    }

    if (STRICT_PAYLOAD_VALIDATION) {
      try {
        validateRequiredPayloadFiles(PAYLOAD_DIR, manifest);
      } catch (validationError) {
        error(validationError.message);
      }
    }

    const manifestPath = path.join(PAYLOAD_DIR, "payload-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    log(`Wrote payload manifest: ${manifestPath}`);
  } else {
    log("No native package found. Payload directory will be empty (dev-only fallback).");
    ensureCleanDir(PAYLOAD_DIR);
  }

  // Step 3: Build installer.
  log("Step 3: Building installer...");
  run(getInstallerBuildCommand(buildMode, isDev));

  const installerTargetProfile = isDev ? "debug" : getExpectedAppProfile(buildMode);
  log("Installer build complete.");
  const outputDir = path.join(ROOT, "src-tauri", "target", installerTargetProfile);
  log(isDev ? `Output directory: ${outputDir}` : `Output: ${path.join(outputDir, "openbitfun-installer.exe")}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  MAIN_APP_EXE,
  REQUIRED_PAYLOAD_FILES,
  copyPackageWithManifest,
  getExpectedAppProfile,
  getMainAppBuildCommand,
  resolveAppDir,
  shouldCopyPackageFile,
  validatePackageInfo,
  validateRequiredPayloadFiles,
};
