#!/usr/bin/env node
// Packages the native NSH desktop app for Linux: `target/desktop-nsh/linux/<Name>/`
// and `target/desktop-nsh/<Name>-nsh_<version>_<arch>-linux.tar.gz` (`OpenBitFun` for
// the default product).
//
// Layout (what `nsh-linux-app` and the backend look for; see
// `scripts/desktop-nsh-package-common.mjs`):
//   openbitfun-nsh                       the NSH runner (GTK 4 + WebKitGTK 6)
//   libopenbitfun_desktop_lib.so         the backend, loaded in-process
//   openbitfun-miniapp-shell             MiniApp windows
//   nsh/{bundle.nshc,app.json,assets}    the UI bundle (app.json: product id/name)
//   nsh-web/                             the same UI for browsers/phones (OBP)
//   resources/{worker_host.js,ext-host/extension-host.js,dsh-profile/}
//   flashgrep/flashgrep-<triple>-musl    workspace search daemon
//   mobile-web/dist                      legacy relay mobile UI, when built
//   bin/{easytier-core,easytier-cli}     device mesh sidecar
//   <productId>.desktop, <productId>.png desktop entry and icon for an installer
//
// Usage: node scripts/package-desktop-nsh-linux.mjs [--profile release|release-fast]
//          [--target x86_64-unknown-linux-gnu] [--skip-build] [--product-config <product.jsonc>]
// Build dependencies: GTK 4, libadwaita and WebKitGTK 6 development packages
// (see the `desktop-nsh-linux` CI job). AppImage/deb packaging and in-place
// updates are a later step: the native updater refuses to install on Linux
// and points to the download page instead.

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const crossTarget = options.target && options.target.includes("linux");
if (process.platform !== "linux" && !crossTarget) {
  console.error("package-desktop-nsh-linux: run on Linux, or pass --target <triple>-unknown-linux-gnu");
  process.exit(1);
}

const outDir = join(root, "target/desktop-nsh");
const nshOut = join(outDir, "nsh-release");
const webOut = join(outDir, "web-release");
if (!options.skipBuild) await buildAll({ ...options, nshOut, webOut, productEnv });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const appName = identity.fileStem;
const app = join(outDir, "linux", appName);
rmSync(app, { recursive: true, force: true });
mkdirSync(join(app, "nsh"), { recursive: true });

const runner = join(cargoOutDir(options), "openbitfun-nsh");
const so = join(cargoOutDir(options, productEnv), "libopenbitfun_desktop_lib.so");
requireFiles([runner, so, join(nshOut, "bundle.nshc")]);
cpSync(runner, join(app, "openbitfun-nsh"));
chmodSync(join(app, "openbitfun-nsh"), 0o755);
cpSync(so, join(app, "libopenbitfun_desktop_lib.so"));
copyUiBundle(nshOut, join(app, "nsh"), identity);

const shell = miniAppShellBinary(options);
if (shell) {
  cpSync(shell, join(app, "openbitfun-miniapp-shell"));
  chmodSync(join(app, "openbitfun-miniapp-shell"), 0o755);
} else {
  console.warn("MiniApp shell not built (pnpm run prepare:miniapp-shell); Spaces will not open windows");
}

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
const icon = productIcon(identity, "linux");
if (existsSync(icon)) cpSync(icon, join(app, `${identity.productId}.png`));
writeFileSync(
  join(app, `${identity.productId}.desktop`),
  `[Desktop Entry]
Type=Application
Name=${identity.displayName}
Exec=openbitfun-nsh %U
Icon=${identity.productId}
Terminal=false
Categories=Development;
StartupWMClass=${identity.bundleId}
`,
);

const arch = (options.target ?? process.arch).includes("aarch64") || process.arch === "arm64" ? "aarch64" : "x86_64";
writePackageInfo(app, { ...options, identity, version: pkg.version, executable: "openbitfun-nsh" });
const archive = join(outDir, `${appName}-nsh_${pkg.version}_${arch}-linux.tar.gz`);
rmSync(archive, { force: true });
run("tar", ["-czf", archive, "-C", join(outDir, "linux"), appName]);
console.log(`packaged ${app}\narchive ${archive}`);
