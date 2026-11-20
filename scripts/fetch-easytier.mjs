#!/usr/bin/env node
// Fetches the official EasyTier sidecar binaries (`easytier-core`, `easytier-cli`)
// for the OpenBitFun device mesh, verifies the release archive's SHA-256 and
// stages them in `target/easytier/<platform>/`. Packaging scripts copy that
// directory into the app (`Contents/Resources/bin` on macOS, `bin/` next to the
// executable elsewhere); development builds find it there directly.
//
// EasyTier is LGPL-3.0 and ships as a separate, unmodified executable (never
// linked); see THIRD_PARTY_NOTICES.md. Binaries are never committed.
//
// Version: v2.6.4, the latest stable (non-prerelease) release. Clients and the
// relay node (deploy/easytier) must run the same release. The hashes below
// equal GitHub's recorded asset digests for the v2.6.4 release (the release
// publishes no SHA256SUMS file).
//
// Usage: node scripts/fetch-easytier.mjs [--platform <name>|--all] [--out <dir>]
//   platforms: macos-aarch64 macos-x86_64 windows-x86_64 windows-arm64
//              linux-x86_64 linux-aarch64 (default: this machine)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EASYTIER_VERSION = "2.6.4";

const ARCHIVES = {
  "macos-aarch64": "4be1882d1aa36d31c1d6ba0596f2cf8a097e371f8da124212324b2e0f8df7e4b",
  "macos-x86_64": "89fc28a6e6995259d76ce3f11775220e8a21c760e94df91a6a9db30a69b6982e",
  "windows-x86_64": "27af91e270e554709b048bd32327fefd2dfce5062ae1e8701af7550c6f525f84",
  "windows-arm64": "37023f8a3451c9234b17ee2089a03dc344ce90d803b5b359cb6c46682b0549b4",
  "linux-x86_64": "61b659eaedba658fa66fe47d17e1426cdd77e5d02fa15fed447bb4357c09dfd6",
  "linux-aarch64": "f533ec25a7ea714e09f645615012200278058525795cc3bb690ff011aec1a70f",
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function hostPlatform() {
  const os = { darwin: "macos", win32: "windows", linux: "linux" }[process.platform];
  const arch = { arm64: os === "windows" ? "arm64" : "aarch64", x64: "x86_64" }[process.arch];
  const name = os && arch ? `${os}-${arch}` : null;
  return name && ARCHIVES[name] ? name : null;
}

function binaryNames(platform) {
  const exe = platform.startsWith("windows") ? ".exe" : "";
  return [`easytier-core${exe}`, `easytier-cli${exe}`];
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

function extract(archive, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // bsdtar (macOS, Windows 10+) and unzip (Linux) both read zip archives.
  const options = { stdio: "inherit", windowsHide: true };
  if (process.platform === "linux") execFileSync("unzip", ["-q", "-o", archive, "-d", dir], options);
  else execFileSync("tar", ["-xf", archive, "-C", dir], options);
}

/** Ensures `target/easytier/<platform>` (or `outDir`) holds verified binaries. */
export async function fetchEasyTier(platform, outDir = join(root, "target/easytier", platform)) {
  const expected = ARCHIVES[platform];
  if (!expected) throw new Error(`no EasyTier ${EASYTIER_VERSION} archive for platform ${platform}`);
  const names = binaryNames(platform);
  const stamp = join(outDir, ".easytier-archive-sha256");
  if (names.every((name) => existsSync(join(outDir, name))) && existsSync(stamp)
      && readFileSync(stamp, "utf8").trim() === expected) {
    return outDir;
  }
  const asset = `easytier-${platform}-v${EASYTIER_VERSION}.zip`;
  const cacheDir = join(root, "target/easytier/cache");
  mkdirSync(cacheDir, { recursive: true });
  const archive = join(cacheDir, asset);
  if (!existsSync(archive) || sha256(archive) !== expected) {
    const url = `https://github.com/EasyTier/EasyTier/releases/download/v${EASYTIER_VERSION}/${asset}`;
    console.log(`fetch-easytier: downloading ${url}`);
    await download(url, archive);
  }
  const actual = sha256(archive);
  if (actual !== expected) {
    rmSync(archive, { force: true });
    throw new Error(`fetch-easytier: SHA-256 mismatch for ${asset}: expected ${expected}, got ${actual}`);
  }
  const unpacked = join(cacheDir, `unpacked-${platform}`);
  extract(archive, unpacked);
  mkdirSync(outDir, { recursive: true });
  for (const name of names) {
    const source = join(unpacked, `easytier-${platform}`, name);
    if (!existsSync(source)) throw new Error(`fetch-easytier: ${name} missing in ${asset}`);
    copyFileSync(source, join(outDir, name));
    if (!platform.startsWith("windows")) chmodSync(join(outDir, name), 0o755);
  }
  rmSync(unpacked, { recursive: true, force: true });
  writeFileSync(stamp, `${expected}\n`);
  console.log(`fetch-easytier: EasyTier ${EASYTIER_VERSION} (${platform}) staged in ${outDir}`);
  return outDir;
}

/** Copies the staged sidecar binaries into `destDir` (packaging). */
export async function stageEasyTier(platform, destDir) {
  const source = await fetchEasyTier(platform);
  mkdirSync(destDir, { recursive: true });
  for (const name of binaryNames(platform)) {
    copyFileSync(join(source, name), join(destDir, name));
    if (!platform.startsWith("windows")) chmodSync(join(destDir, name), 0o755);
  }
  return destDir;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const platforms = args.includes("--all")
    ? Object.keys(ARCHIVES)
    : [valueOf("--platform") ?? hostPlatform()];
  if (!platforms[0]) {
    console.error("fetch-easytier: unsupported host platform; pass --platform");
    process.exit(1);
  }
  const out = valueOf("--out");
  for (const platform of platforms) {
    await fetchEasyTier(platform, out && platforms.length === 1 ? resolve(out) : undefined);
  }
}
