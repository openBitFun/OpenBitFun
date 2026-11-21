#!/usr/bin/env node
// Packages the native NSH desktop app for macOS: `target/desktop-nsh/<Name>.app`
// (`OpenBitFun.app` for the default product).
//
// Layout (mirrors what the backend looks for; see `scripts/desktop-nsh-package-common.mjs`):
//   Contents/MacOS/<Name>                            the NSH runner (`openbitfun-nsh`)
//   Contents/MacOS/<binaryName> -> <Name>            the product's Tauri executable name
//                                                    (`openbitfun-desktop`, the upgrade bridge)
//   Contents/MacOS/openbitfun-miniapp-shell          MiniApp windows (`src/apps/miniapp-shell`)
//   Contents/Frameworks/libopenbitfun_desktop_lib.dylib  the backend, loaded in-process
//   Contents/Resources/nsh/{bundle.nshc,app.json,assets}  the UI bundle (app.json: product id/name)
//   Contents/Resources/nsh-web/                      the same UI for browsers/phones (OBP)
//   Contents/Resources/resources/{worker_host.js,ext-host/extension-host.js}
//   Contents/Resources/resources/dsh-profile/        DeepSeek Harness bridge
//   Contents/Resources/resources/agent-companion-pets/  built-in companion pet sprites
//   Contents/Resources/flashgrep/flashgrep-<triple>  workspace search daemon
//
// Usage: node scripts/package-desktop-nsh-macos.mjs [--profile release|release-fast] [--skip-build]
//          [--updater-archive] [--product-config <product.jsonc>]
// `--updater-archive` also writes `<Name>-nsh_<version>_<arch>.app.tar.gz` (and its
// minisign `.sig` when TAURI_SIGNING_PRIVATE_KEY is set): the native app's in-app update
// package, listed in the release manifest as `platforms["darwin-<arch>-nsh"]`
// (`src/apps/desktop/src/backend_protocol/native_commands/update.rs`). Release builds pass
// TAURI_UPDATER_PUBKEY so the backend verifies packages with the release key.
// Requires rustc >= 1.97 for the NSH crates (RUSTUP_TOOLCHAIN=1.98.1 works).

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  backendResources,
  buildAll,
  cargoOutDir,
  copyResources,
  copyUiBundle,
  dshProfileResource,
  flashgrepResource,
  miniAppShellBinary,
  parseArgs,
  productIcon,
  requireFiles,
  resolvePackageProduct,
  root,
  run,
  signUpdaterArchive,
  writePackageInfo,
  writeWebBundleManifest,
} from "./desktop-nsh-package-common.mjs";

if (process.platform !== "darwin") {
  console.error("package-desktop-nsh-macos: macOS only");
  process.exit(1);
}

const options = parseArgs();
const { identity, productEnv } = resolvePackageProduct(options);
const outDir = join(root, "target/desktop-nsh");
const nshOut = join(outDir, "nsh-release");
const webOut = join(outDir, "web-release");
if (!options.skipBuild) await buildAll({ ...options, nshOut, webOut, productEnv });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const appName = identity.displayName;
const executable = identity.fileStem;
const app = join(outDir, `${appName}.app`);
const contents = join(app, "Contents");

rmSync(app, { recursive: true, force: true });
for (const dir of ["MacOS", "Frameworks", "Resources/nsh"]) {
  mkdirSync(join(contents, dir), { recursive: true });
}

const runner = join(cargoOutDir(options), "openbitfun-nsh");
const dylib = join(cargoOutDir(options, productEnv), "libopenbitfun_desktop_lib.dylib");
requireFiles([runner, dylib, join(nshOut, "bundle.nshc")]);
cpSync(runner, join(contents, "MacOS", executable));
// Upgrade bridge from the retired Tauri desktop: an installed Tauri build reads
// `platforms["darwin-<arch>"]` and installs this same bundle. Its installer
// (`update_maintenance/macos.rs` of that release) requires
// `Contents/MacOS/<its mainBinaryName>` (`openbitfun-desktop`, the product's
// `binaryName`) and restarts that path, and an existing launch-at-login entry
// points at it, so the legacy name stays as a link to the native runner. A name
// that differs only in case is already the runner on macOS's case-insensitive volumes.
if (identity.binaryName.toLowerCase() !== executable.toLowerCase()) {
  symlinkSync(executable, join(contents, "MacOS", identity.binaryName));
}
cpSync(dylib, join(contents, "Frameworks/libopenbitfun_desktop_lib.dylib"));
const miniAppShell = miniAppShellBinary(options);
if (miniAppShell) cpSync(miniAppShell, join(contents, "MacOS/openbitfun-miniapp-shell"));
else console.warn("MiniApp shell not built (pnpm run prepare:miniapp-shell); Spaces will not open windows");
copyUiBundle(nshOut, join(contents, "Resources/nsh"), identity);

const webSite = join(webOut, "OpenBitFun");
if (!existsSync(webSite)) console.warn("no web bundle; browsers and phones will get the build hint page");
writeWebBundleManifest(webSite, identity);
const flashgrep = flashgrepResource(options.target);
copyResources(
  [
    ...backendResources({ webSite, flashgrep, dshProfile: dshProfileResource() }),
    [productIcon(identity, "macos"), "AppIcon.icns"],
  ],
  join(contents, "Resources"),
);
// The downloaded daemon carries the linker's ad hoc signature; give the copy
// in the bundle its own so the sealed bundle verifies (release signing
// replaces it with the Developer ID signature, `scripts/ci/package-native-macos-release.sh`).
run("codesign", ["--force", "--sign", "-", join(contents, "Resources", flashgrep[1])]);


const xml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key><string>en</string>
	<key>CFBundleExecutable</key><string>${xml(executable)}</string>
	<key>CFBundleIdentifier</key><string>${xml(identity.bundleId)}</string>
	<key>CFBundleName</key><string>${xml(appName)}</string>
	<key>CFBundleDisplayName</key><string>${xml(appName)}</string>
	<key>CFBundleIconFile</key><string>AppIcon</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>${pkg.version}</string>
	<key>CFBundleVersion</key><string>${pkg.version}</string>
	<key>CFBundleSupportedPlatforms</key><array><string>MacOSX</string></array>
	<key>LSMinimumSystemVersion</key><string>14.0</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>NSPrincipalClass</key><string>NSApplication</string>
	<key>NSMicrophoneUsageDescription</key><string>${xml(appName)} uses the microphone for voice input and local speech transcription.</string>
	<key>NSSpeechRecognitionUsageDescription</key><string>${xml(appName)} turns what you dictate into text in the composer.</string>
</dict>
</plist>
`;
writeFileSync(join(contents, "Info.plist"), plist);

// Ad hoc signature for local runs; release signing and notarization belong to the release pipeline.
run("codesign", ["--force", "--deep", "--sign", "-", app]);
writePackageInfo(app, { ...options, identity, version: pkg.version, executable: `Contents/MacOS/${executable}` });
console.log(`packaged ${app}`);

if (options.updaterArchive) {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const archive = join(outDir, `${identity.fileStem}-nsh_${pkg.version}_${arch}.app.tar.gz`);
  rmSync(archive, { force: true });
  run("tar", ["-czf", archive, "-C", outDir, `${appName}.app`], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const signature = signUpdaterArchive(archive);
  console.log(`updater archive ${archive}${signature ? ` (signature ${signature})` : " (unsigned)"}`);
}
