#!/usr/bin/env node
// Packages the native NSH desktop app for macOS: `target/desktop-nsh/OpenBitFun.app`.
//
// Layout (mirrors what the backend looks for; see `src/apps/desktop/src/native_host.rs`,
// `backend_protocol/ws`, `api/app_state.rs::resolve_worker_host_path`):
//   Contents/MacOS/OpenBitFun                        the NSH runner (`openbitfun-nsh`)
//   Contents/Frameworks/libopenbitfun_desktop_lib.dylib  the backend, loaded in-process
//   Contents/Resources/nsh/{bundle.nshc,app.json,assets}  the UI bundle
//   Contents/Resources/nsh-web/                      the same UI for browsers/phones (OBP)
//   Contents/Resources/resources/{worker_host.js,ext-host/extension-host.js}
//   Contents/Resources/mobile-web/dist               legacy relay mobile UI, when built
//
// Usage: node scripts/package-desktop-nsh-macos.mjs [--profile release|release-fast] [--skip-build]
// Requires rustc >= 1.97 for the NSH crates (RUSTUP_TOOLCHAIN=1.98.1 works).

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const profile = args.includes("--profile") ? args[args.indexOf("--profile") + 1] : "release";
const skipBuild = args.includes("--skip-build");

if (process.platform !== "darwin") {
  console.error("package-desktop-nsh-macos: macOS only");
  process.exit(1);
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", ...opts });
}

const outDir = join(root, "target/desktop-nsh");
const nshOut = join(outDir, "nsh-release");
const webOut = join(outDir, "web-release");
const profileDir = profile === "dev" ? "debug" : profile;

if (!skipBuild) {
  run("nsh", ["build", "src/apps/desktop-nsh", "--release", "--out", nshOut]);
  run("nsh", ["package", "src/nsh-ui", "--target", "web", "-o", webOut]);
  run("cargo", ["build", "-p", "openbitfun-desktop", "--lib", "--profile", profile]);
  run("cargo", [
    "build",
    "--manifest-path",
    "src/apps/desktop-nsh/native/Cargo.toml",
    "--features",
    "runner",
    "--target-dir",
    "target",
    "--profile",
    profile,
  ]);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const nshJson = JSON.parse(readFileSync(join(root, "src/apps/desktop-nsh/nsh.json"), "utf8"));
const appName = "OpenBitFun";
const app = join(outDir, `${appName}.app`);
const contents = join(app, "Contents");

rmSync(app, { recursive: true, force: true });
for (const dir of ["MacOS", "Frameworks", "Resources/nsh", "Resources/resources/ext-host"]) {
  mkdirSync(join(contents, dir), { recursive: true });
}

const runner = join(root, "target", profileDir, "openbitfun-nsh");
const dylib = join(root, "target", profileDir, "libopenbitfun_desktop_lib.dylib");
for (const file of [runner, dylib, join(nshOut, "bundle.nshc")]) {
  if (!existsSync(file)) {
    console.error(`missing build output: ${file}`);
    process.exit(1);
  }
}
cpSync(runner, join(contents, "MacOS", appName));
cpSync(dylib, join(contents, "Frameworks/libopenbitfun_desktop_lib.dylib"));
cpSync(nshOut, join(contents, "Resources/nsh"), {
  recursive: true,
  filter: src => !src.endsWith(".map") && !src.endsWith("bundle.js"),
});

const webSite = join(webOut, "OpenBitFun");
if (existsSync(webSite)) cpSync(webSite, join(contents, "Resources/nsh-web"), { recursive: true });
else console.warn("no web bundle; browsers and phones will get the build hint page");

const desktop = join(root, "src/apps/desktop");
const resources = [
  [join(desktop, "resources/worker_host.js"), "Resources/resources/worker_host.js"],
  [join(root, "src/apps/extension-host/dist/extension-host.js"), "Resources/resources/ext-host/extension-host.js"],
  [join(root, "THIRD_PARTY_NOTICES.md"), "Resources/THIRD_PARTY_NOTICES.md"],
  [join(root, "src/crates/services/services-integrations/assets/models-dev.LICENSE.txt"), "Resources/third-party/models.dev/LICENSE.txt"],
  [join(root, "src/crates/services/services-integrations/assets/models-dev.provenance.json"), "Resources/third-party/models.dev/provenance.json"],
  [join(root, "src/mobile-web/dist"), "Resources/mobile-web/dist"],
  [join(desktop, "icons/openbitfun-app-icon.icns"), "Resources/AppIcon.icns"],
];
for (const [src, dest] of resources) {
  if (!existsSync(src)) {
    console.warn(`optional resource not built, skipped: ${src}`);
    continue;
  }
  mkdirSync(dirname(join(contents, dest)), { recursive: true });
  cpSync(src, join(contents, dest), { recursive: true });
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key><string>en</string>
	<key>CFBundleExecutable</key><string>${appName}</string>
	<key>CFBundleIdentifier</key><string>${nshJson.id}</string>
	<key>CFBundleName</key><string>${appName}</string>
	<key>CFBundleDisplayName</key><string>${appName}</string>
	<key>CFBundleIconFile</key><string>AppIcon</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>${pkg.version}</string>
	<key>CFBundleVersion</key><string>${pkg.version}</string>
	<key>CFBundleSupportedPlatforms</key><array><string>MacOSX</string></array>
	<key>LSMinimumSystemVersion</key><string>14.0</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>NSPrincipalClass</key><string>NSApplication</string>
	<key>NSMicrophoneUsageDescription</key><string>OpenBitFun uses the microphone for voice input and local speech transcription.</string>
</dict>
</plist>
`;
writeFileSync(join(contents, "Info.plist"), plist);

// Ad hoc signature for local runs; release signing and notarization belong to the release pipeline.
run("codesign", ["--force", "--deep", "--sign", "-", app]);
console.log(`packaged ${app}`);
