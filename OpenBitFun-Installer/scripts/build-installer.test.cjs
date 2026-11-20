const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MAIN_APP_EXE,
  REQUIRED_PAYLOAD_FILES,
  copyPackageWithManifest,
  getExpectedAppProfile,
  getMainAppBuildCommand,
  resolveAppDir,
  shouldCopyPackageFile,
  validatePackageInfo,
  validateRequiredPayloadFiles,
} = require("./build-installer.cjs");

const installerRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(installerRoot, "..");

test("installer modes package and accept only their exact Cargo profile", () => {
  assert.equal(getExpectedAppProfile("release"), "release");
  assert.equal(getExpectedAppProfile("fast"), "release-fast");
  assert.equal(
    getMainAppBuildCommand("fast"),
    "pnpm run desktop-nsh:package:windows -- --profile release-fast"
  );
  const info = { profile: "release", executable: MAIN_APP_EXE, target: null };
  assert.doesNotThrow(() => validatePackageInfo(info, "release"));
  assert.throws(() => validatePackageInfo(info, "fast"), /release profile, not release-fast/);
  assert.throws(() => validatePackageInfo(null, "release"), /package\.json/);
  assert.throws(
    () => validatePackageInfo({ ...info, target: "aarch64-pc-windows-msvc" }, "release"),
    /x86_64 Windows/
  );
  assert.throws(
    () => validatePackageInfo({ ...info, executable: "acme-desktop.exe" }, "release"),
    /installs openbitfun-desktop\.exe/
  );
});

test("the installer installs the native Windows package directory", () => {
  const defaultDir = resolveAppDir([], {});
  assert.match(defaultDir, /target[\\/]desktop-nsh[\\/]windows[\\/]OpenBitFun$/);
  const explicit = path.join(os.tmpdir(), "custom-package", "OpenBitFun");
  assert.equal(resolveAppDir(["--app-dir", explicit], { OPENBITFUN_INSTALLER_APP_DIR: "ignored" }), path.normalize(explicit));
  assert.equal(resolveAppDir([], { OPENBITFUN_INSTALLER_APP_DIR: explicit }), path.normalize(explicit));
  // The older `--app-exe` spelling names the package's executable.
  assert.equal(
    resolveAppDir(["--app-exe", path.join(explicit, MAIN_APP_EXE)], {}),
    path.normalize(explicit)
  );
});

test("the installer executable is the one the Windows package names its runner", () => {
  // `<binaryName>.exe` of the default product definition.
  const product = fs.readFileSync(path.join(repoRoot, "products/openbitfun/product.jsonc"), "utf8");
  assert.match(product, /"binaryName": "openbitfun-desktop",\s*"bundleId"/);
  assert.equal(MAIN_APP_EXE, "openbitfun-desktop.exe");
  const packaging = fs.readFileSync(path.join(repoRoot, "scripts/package-desktop-nsh-windows.mjs"), "utf8");
  assert.match(packaging, /const executable = `\$\{identity\.binaryName\}\.exe`/);
  assert.match(packaging, /writePackageInfo\(app, \{ \.\.\.options, identity, version: pkg\.version, executable \}\)/);
  const modRs = fs.readFileSync(path.join(installerRoot, "src-tauri/src/installer/mod.rs"), "utf8");
  assert.match(modRs, /const MAIN_APP_EXE: &str = "openbitfun-desktop\.exe";/);
});

test("payload validation requires every native runtime surface", () => {
  const payload = fs.mkdtempSync(path.join(os.tmpdir(), "openbitfun-installer-payload-"));
  const manifest = { files: [] };

  for (const relativePath of REQUIRED_PAYLOAD_FILES) {
    const diskPath = path.join(payload, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    fs.writeFileSync(diskPath, relativePath);
    manifest.files.push({ path: relativePath });
  }

  assert.doesNotThrow(() => validateRequiredPayloadFiles(payload, manifest));
  for (const required of ["openbitfun_desktop_lib.dll", "nsh/bundle.nshc", "flashgrep/flashgrep-x86_64-pc-windows-msvc.exe"]) {
    assert.ok(REQUIRED_PAYLOAD_FILES.includes(required), required);
  }
  assert.ok(!REQUIRED_PAYLOAD_FILES.some((file) => file.startsWith("frontend/")), "no WebView frontend");

  fs.rmSync(path.join(payload, "nsh"), { recursive: true, force: true });
  assert.throws(
    () => validateRequiredPayloadFiles(payload, manifest),
    /nsh\/bundle\.nshc/
  );
});

test("the payload is the package directory with a manifest of every file", () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "openbitfun-native-package-"));
  const files = {
    [MAIN_APP_EXE]: "runner",
    "openbitfun_desktop_lib.dll": "backend",
    "openbitfun_desktop_lib.pdb": "symbols",
    "nsh/app.json": "{}",
    "resources/dsh-profile/package.json": "{}",
    "flashgrep/flashgrep-x86_64-pc-windows-msvc.exe": "daemon",
  };
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(app, relative)), { recursive: true });
    fs.writeFileSync(path.join(app, relative), content);
  }
  const payload = fs.mkdtempSync(path.join(os.tmpdir(), "openbitfun-installer-staged-"));
  const manifest = { files: [] };
  copyPackageWithManifest(app, payload, manifest, payload);
  const staged = manifest.files.map((entry) => entry.path).sort();
  assert.deepEqual(staged, Object.keys(files).filter((file) => !file.endsWith(".pdb")).sort());
  for (const entry of manifest.files) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.equal(entry.size, fs.statSync(path.join(payload, entry.path)).size);
  }
});

test("Cargo implementation locks and debug files are not copied into the installer", () => {
  for (const name of [".cargo-lock", ".cargo-artifact-lock", ".cargo-build-lock", "app.pdb", "lib.exp", "lib.lib"]) {
    assert.equal(shouldCopyPackageFile(name), false, name);
  }
  assert.equal(shouldCopyPackageFile(MAIN_APP_EXE), true);
  assert.equal(shouldCopyPackageFile("openbitfun_desktop_lib.dll"), true);
});

test("Rust and JavaScript Tauri package lines stay pinned and aligned", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(installerRoot, "package.json"), "utf8")
  );
  const cargoToml = fs.readFileSync(
    path.join(installerRoot, "src-tauri", "Cargo.toml"),
    "utf8"
  );
  const rustTauri = cargoToml.match(/tauri = \{ version = "=([^"]+)"/)?.[1];
  const rustDialog = cargoToml.match(/tauri-plugin-dialog = "=([^"]+)"/)?.[1];
  const jsTauri = packageJson.dependencies["@tauri-apps/api"];
  const jsDialog = packageJson.dependencies["@tauri-apps/plugin-dialog"];

  assert.match(jsTauri, /^\d+\.\d+\.\d+$/);
  assert.match(jsDialog, /^\d+\.\d+\.\d+$/);
  assert.equal(minorLine(rustTauri), minorLine(jsTauri));
  assert.equal(minorLine(rustDialog), minorLine(jsDialog));
});

test("all Installer validators share the required runtime file contract", () => {
  const buildRs = fs.readFileSync(path.join(installerRoot, "src-tauri", "build.rs"), "utf8");
  const commandsRs = fs.readFileSync(
    path.join(installerRoot, "src-tauri", "src", "installer", "commands.rs"),
    "utf8"
  );
  for (const source of [buildRs, commandsRs]) {
    const declaration = source.match(/const REQUIRED_PAYLOAD_FILES: \[&str; (\d+)\] = \[([\s\S]*?)\];/);
    assert.equal(Number(declaration[1]), REQUIRED_PAYLOAD_FILES.length);
    const files = [...declaration[2].matchAll(/"([^"]+)"|MAIN_APP_EXE/g)]
      .map((match) => match[1] || "openbitfun-desktop.exe");
    assert.deepEqual(files, REQUIRED_PAYLOAD_FILES);
  }
  for (const relativePath of REQUIRED_PAYLOAD_FILES) {
    assert.match(buildRs, new RegExp(escapeRegExp(relativePath)));
    if (relativePath === "openbitfun-desktop.exe") {
      assert.match(commandsRs, /MAIN_APP_EXE/);
    } else {
      assert.match(commandsRs, new RegExp(escapeRegExp(relativePath)));
    }
  }
});

test("standalone Data Migrator is not required by the installer", () => {
  assert.ok(!REQUIRED_PAYLOAD_FILES.includes("openbitfun-data-migrator.exe"));
  const commandsRs = fs.readFileSync(path.join(installerRoot, "src-tauri/src/installer/commands.rs"), "utf8");
  assert.doesNotMatch(commandsRs, /DATA_MIGRATOR_EXE|HandoffStore|launch_trusted_executable/);
  assert.match(commandsRs, /Data Migrator is distributed separately/);
  const themeSetup = fs.readFileSync(path.join(installerRoot, "src/pages/ThemeSetup.tsx"), "utf8");
  assert.doesNotMatch(themeSetup, /migrateLegacyData|onLaunchMigration/);
});

function minorLine(version) {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  return version.split(".").slice(0, 2).join(".");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
