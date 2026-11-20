#!/usr/bin/env node
// Packages the native NSH desktop app for Windows: `target/desktop-nsh/windows/<Name>/`
// and `target/desktop-nsh/<Name>-nsh_<version>_<arch>-windows.zip` (`OpenBitFun` for
// the default product).
//
// Layout (what `nsh-windows-app` and the backend look for; see
// `scripts/desktop-nsh-package-common.mjs`):
//   <binaryName>.exe                     the NSH runner (`openbitfun-nsh`, Win32 + WebView2),
//                                        named like the product's Tauri executable
//                                        (`openbitfun-desktop.exe`): shortcuts, the
//                                        uninstall entry and the Windows Installer
//                                        (`OpenBitFun-Installer`) keep pointing at it
//   openbitfun_desktop_lib.dll           the backend, loaded in-process
//   openbitfun-miniapp-shell.exe         MiniApp windows
//   nsh\{bundle.nshc,app.json,assets,icon.ico}   the UI bundle (app.json: product id/name)
//   nsh-web\                             the same UI for browsers/phones (OBP)
//   resources\{worker_host.js,ext-host\extension-host.js,dsh-profile\}
//   flashgrep\flashgrep-<triple>.exe     workspace search daemon
//   mobile-web\dist                      legacy relay mobile UI, when built
//   bin\{easytier-core,easytier-cli}.exe device mesh sidecar
// `<Name>.package.json` next to the directory records the profile, target and
// product it was built for (read by `OpenBitFun-Installer/scripts/build-installer.cjs`).
//
// Usage: node scripts/package-desktop-nsh-windows.mjs [--profile release|release-fast]
//          [--target x86_64-pc-windows-msvc] [--skip-build] [--product-config <product.jsonc>]
// Requires rustc >= 1.97 for the NSH crates (RUSTUP_TOOLCHAIN=1.98.1 works) and
// the WebView2 runtime on the machine that runs the app. In-place updates of this
// layout are a later step: the native updater refuses to install on Windows and
// points to the download page instead.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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
  writePackageInfo,
} from "./desktop-nsh-package-common.mjs";

const options = parseArgs();
const { identity, productEnv } = resolvePackageProduct(options);
const crossTarget = options.target && options.target.includes("windows");
if (process.platform !== "win32" && !crossTarget) {
  console.error("package-desktop-nsh-windows: run on Windows, or pass --target <triple>-pc-windows-*");
  process.exit(1);
}

const outDir = join(root, "target/desktop-nsh");
const nshOut = join(outDir, "nsh-release");
const webOut = join(outDir, "web-release");
if (!options.skipBuild) await buildAll({ ...options, nshOut, webOut, productEnv });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const appName = identity.fileStem;
const executable = `${identity.binaryName}.exe`;
const app = join(outDir, "windows", appName);
rmSync(app, { recursive: true, force: true });
mkdirSync(join(app, "nsh"), { recursive: true });

const runner = join(cargoOutDir(options), "openbitfun-nsh.exe");
const dll = join(cargoOutDir(options, productEnv), "openbitfun_desktop_lib.dll");
requireFiles([runner, dll, join(nshOut, "bundle.nshc")]);
cpSync(runner, join(app, executable));
cpSync(dll, join(app, "openbitfun_desktop_lib.dll"));
copyUiBundle(nshOut, join(app, "nsh"), identity);
const icon = productIcon(identity, "windows");
if (existsSync(icon)) cpSync(icon, join(app, "nsh/icon.ico"));

const shell = miniAppShellBinary(options);
if (shell) cpSync(shell, join(app, "openbitfun-miniapp-shell.exe"));
else console.warn("MiniApp shell not built (pnpm run prepare:miniapp-shell); Spaces will not open windows");

copyResources(
  backendResources({
    webSite: join(webOut, "OpenBitFun"),
    flashgrep: flashgrepResource(options.target),
    dshProfile: dshProfileResource(),
  }),
  app,
);
// Device mesh sidecar: the official EasyTier binaries (LGPL-3.0, separate
// executables, SHA-256 pinned by scripts/fetch-easytier.mjs) in bin/.
{
  const { hostPlatform, stageEasyTier } = await import("./fetch-easytier.mjs");
  await stageEasyTier(hostPlatform(), join(app, "bin"));
}

const arch = (options.target ?? process.arch).includes("aarch64") || process.arch === "arm64" ? "arm64" : "x64";
writePackageInfo(app, { ...options, identity, version: pkg.version, executable });
const archive = join(outDir, `${appName}-nsh_${pkg.version}_${arch}-windows.zip`);
rmSync(archive, { force: true });
if (process.platform === "win32") {
  run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${app}' -DestinationPath '${archive}'`,
  ]);
} else {
  run("zip", ["-qr", archive, appName], { cwd: join(outDir, "windows") });
}
console.log(`packaged ${app}\narchive ${archive}`);
