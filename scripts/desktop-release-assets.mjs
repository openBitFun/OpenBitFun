// Names and platform keys of the native desktop release assets, shared by the
// release manifest scripts (`collect-tauri-updater-assets.mjs`,
// `generate-tauri-latest-json.mjs`) and their tests.
//
// The desktop ships only as the native NSH app:
//   OpenBitFun-nsh_<version>_<aarch64|x86_64>.app.tar.gz (+ .sig)
//       macOS in-app update package. Listed in `latest-v1.json` twice:
//       `darwin-<arch>-nsh` for the native updater and `darwin-<arch>` for an
//       installed Tauri build, whose macOS installer accepts any gzip tar with
//       one `*.app` holding `Contents/MacOS/openbitfun-desktop` (the native
//       bundle carries that name as a link to its runner) and `Info.plist`.
//   OpenBitFun_<version>_<aarch64|x64>.dmg (+ .sig)
//       macOS manual installer (`manual_installers["darwin-<arch>"]`).
//   OpenBitFun-nsh_<version>_<x64|arm64>-windows.zip (+ .sig)
//   OpenBitFun-nsh_<version>_<x86_64|aarch64>-linux.tar.gz (+ .sig)
//       Windows and Linux manual downloads (`manual_installers["windows-*"]`,
//       `manual_installers["linux-*"]`). There is no native installer or
//       in-place updater for them yet, so `platforms` never carries a
//       `windows-*` or `linux-*` key: an older Tauri package under a newer
//       manifest version would make an installed Tauri app reinstall it in a
//       loop, while a missing key makes it report that no package exists.
import { basename } from 'node:path';

const NATIVE_UPDATER = /^OpenBitFun-nsh_(.+)_(aarch64|x86_64)\.app\.tar\.gz$/;
const MAC_DMG = /^OpenBitFun_(.+)_(aarch64|x64)\.dmg$/;
const WINDOWS_ZIP = /^OpenBitFun-nsh_(.+)_(x64|arm64)-windows\.zip$/;
const LINUX_TAR = /^OpenBitFun-nsh_(.+)_(x86_64|aarch64)-linux\.tar\.gz$/;

/** The macOS architectures whose `darwin-<arch>` key bridges installed Tauri builds. */
export const BRIDGED_MAC_ARCHES = ['aarch64', 'x86_64'];

export function nativeUpdaterArchiveName(version, arch) {
  return `OpenBitFun-nsh_${version}_${arch}.app.tar.gz`;
}

export function nativeUpdaterPlatform(arch) {
  return `darwin-${arch}-nsh`;
}

/** The key an installed Tauri build reads for the same machine. */
export function legacyBridgePlatform(arch) {
  return `darwin-${arch}`;
}

/**
 * Classifies one release file by name:
 * - `native-updater`  { platform, arch, version }
 * - `manual`          { platform, version } (DMG, Windows zip, Linux tarball)
 * - `tauri-updater`   a Tauri bundler output that must not be published
 * - `other`           anything else (signatures, files inside an .app, CLI archives)
 */
export function classifyDesktopReleaseAsset(file) {
  const normalized = String(file).replace(/\\/g, '/');
  // Files inside an app bundle are payload, not release assets.
  if (/\.app\//.test(normalized)) return { kind: 'other' };
  const name = basename(normalized);
  if (name.endsWith('.sig') || name.endsWith('.minisig')) return { kind: 'other' };

  let match = NATIVE_UPDATER.exec(name);
  if (match) {
    return { kind: 'native-updater', version: match[1], arch: match[2], platform: nativeUpdaterPlatform(match[2]) };
  }
  match = MAC_DMG.exec(name);
  if (match) {
    return { kind: 'manual', version: match[1], platform: match[2] === 'x64' ? 'darwin-x86_64' : 'darwin-aarch64' };
  }
  match = WINDOWS_ZIP.exec(name);
  if (match) {
    return { kind: 'manual', version: match[1], platform: match[2] === 'x64' ? 'windows-x86_64' : 'windows-aarch64' };
  }
  match = LINUX_TAR.exec(name);
  if (match) {
    return { kind: 'manual', version: match[1], platform: `linux-${match[2]}` };
  }

  const lower = name.toLowerCase();
  if (
    lower.endsWith('.appimage') ||
    lower.endsWith('.appimage.tar.gz') ||
    lower.endsWith('.deb') ||
    lower.endsWith('.rpm') ||
    lower.endsWith('.nsis.zip') ||
    /[-_]setup\.exe$/.test(lower) ||
    lower.endsWith('.app.tar.gz')
  ) {
    return { kind: 'tauri-updater' };
  }
  return { kind: 'other' };
}

/**
 * What an updater archive must contain for both updaters, given its entry list
 * (`tar -tzf`): exactly one top-level `<Name>.app`, with
 * - `Contents/MacOS/OpenBitFun` and `Contents/Resources/nsh/bundle.nshc`, which
 *   the native updater requires (`backend_protocol/native_commands/update.rs`);
 * - `Contents/MacOS/openbitfun-desktop` and `Contents/Info.plist`, which the
 *   macOS installer of an installed Tauri build requires (it looks for its own
 *   executable name); the native bundle carries that name as a link to its runner.
 * Returns the problems found (empty when the archive is acceptable).
 */
export function missingUpdaterArchiveEntries(entries) {
  const names = entries
    .map((entry) => entry.trim().replace(/^\.\//, ''))
    .filter(Boolean);
  const apps = new Set(
    names
      .map((name) => name.split('/')[0])
      .filter((top) => top.endsWith('.app')),
  );
  const tops = new Set(names.map((name) => name.split('/')[0]));
  if (apps.size !== 1 || tops.size !== 1) {
    return [`expected one top-level .app, found ${[...tops].join(', ') || 'nothing'}`];
  }
  const [app] = apps;
  const present = new Set(names.map((name) => name.replace(/\/$/, '')));
  return [
    'Contents/Info.plist',
    'Contents/MacOS/OpenBitFun',
    'Contents/MacOS/openbitfun-desktop',
    'Contents/Resources/nsh/bundle.nshc',
  ]
    .filter((entry) => !present.has(`${app}/${entry}`))
    .map((entry) => `missing ${app}/${entry}`);
}
