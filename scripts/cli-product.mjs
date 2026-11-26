#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildDesktopWebUi } from './build-desktop-web-ui.mjs';
import { extractProductConfigArg } from './product-customization/cli.mjs';
import { ensureProductOutputDirectory, productBuildEnvironment } from './product-customization/projections.mjs';
import { ProductDefinitionError, resolveProductDefinition } from './product-customization/resolver.mjs';
import { writeUiBundleManifest } from './write-ui-bundle-manifest.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PLUGIN_HOST_DIST = join(ROOT, 'src', 'apps', 'extension-host', 'dist');
const PLUGIN_HOST_ENTRIES = ['extension-host.js'];
/** The build variable `src/apps/cli/build.rs` embeds the web UI bundle from. */
export const CLI_WEB_UI_VARIABLE = 'OPENBITFUN_CLI_WEB_UI_DIR';

/**
 * Builds the NSH web UI of this tree into `outDir` and writes its manifest:
 * the CLI embeds it (`src/apps/cli/src/ui_bundle.rs`) so a browser that
 * controls this CLI runs the UI of the same commit. Returns the bundle dir.
 * `OPENBITFUN_CLI_WEB_UI=off` builds a CLI without it on purpose (it then
 * answers `ui_bundle_unavailable`); a failing web build fails the CLI build.
 */
export function prepareCliWebUi(plan, { spawn = spawnSync, write = writeUiBundleManifest } = {}) {
  if (plan.environment[CLI_WEB_UI_VARIABLE]) return plan.environment[CLI_WEB_UI_VARIABLE];
  if (plan.environment.OPENBITFUN_CLI_WEB_UI === 'off') {
    console.warn('[product] OPENBITFUN_CLI_WEB_UI=off: this CLI ships no web UI; browsers cannot open it');
    return null;
  }
  // Default path: reuse the fingerprint-cached web bundle builder so repeated
  // local `cli:build` runs skip the ~15s `nsh package --target web` when UI
  // sources have not changed.
  if (spawn === spawnSync && write === writeUiBundleManifest) {
    try {
      const { bundleDir, bundleId } = buildDesktopWebUi({
        rootDir: ROOT,
        outDir: plan.webUiOutPath,
        product: plan.resolution.assembly.productId,
        env: plan.environment,
      });
      if (!bundleDir) {
        throw new Error('web UI bundle directory was not produced');
      }
      plan.environment[CLI_WEB_UI_VARIABLE] = bundleDir;
      console.log(`[product] embedding the web UI ${bundleId}: ${bundleDir}`);
      return bundleDir;
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; install the NSH toolchain, or set OPENBITFUN_CLI_WEB_UI=off to build a CLI without the web UI`,
      );
    }
  }
  rmSync(plan.webUiOutPath, { recursive: true, force: true });
  const built = spawn('nsh', ['package', 'src/nsh-ui/WebApp.tsx', '--target', 'web', '-o', plan.webUiOutPath], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (built.error || built.status !== 0) {
    throw new Error(
      `nsh package --target web failed (${built.error?.message ?? `status ${built.status}`}); install the NSH toolchain, or set OPENBITFUN_CLI_WEB_UI=off to build a CLI without the web UI`,
    );
  }
  const { bundleDir, bundleId } = write(plan.webUiOutPath, { product: plan.resolution.assembly.productId });
  plan.environment[CLI_WEB_UI_VARIABLE] = bundleDir;
  console.log(`[product] embedding the web UI ${bundleId}: ${bundleDir}`);
  return bundleDir;
}

export function stagePluginHostResources(destination, sourceDirectory = PLUGIN_HOST_DIST) {
  for (const entry of PLUGIN_HOST_ENTRIES) {
    const source = join(sourceDirectory, entry);
    if (!existsSync(source)) {
      throw new Error(
        `Plugin Host resource was not produced: ${source}. Run pnpm run plugin-host:prepare.`,
      );
    }
  }
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  for (const entry of PLUGIN_HOST_ENTRIES) {
    copyFileSync(join(sourceDirectory, entry), join(destination, entry));
  }
}

function stripDelimiter(args) {
  const result = [...args];
  while (result[0] === '--') result.shift();
  return result;
}

function targetDirOverride(argument, nextArgument) {
  if (argument === '--target-dir' || argument.startsWith('--target-dir=')) return true;
  const config = argument === '--config'
    ? nextArgument
    : argument.startsWith('--config=')
      ? argument.slice('--config='.length)
      : undefined;
  return /^\s*build\.target-dir\s*=/.test(config ?? '');
}

function cargoBuildTarget(args, environment) {
  let target = environment.CARGO_BUILD_TARGET?.trim() || undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (targetDirOverride(argument, args[index + 1])) {
      throw new ProductDefinitionError(
        'unsupported_cli_target_dir_override',
        'CLI product builds own the Cargo target directory.',
        'Remove --target-dir or build.target-dir; set CARGO_TARGET_DIR before invoking the build if a custom root is required.',
      );
    }
    if (argument === '--target') target = args[++index];
    else if (argument.startsWith('--target=')) target = argument.slice('--target='.length);
  }
  if (!target) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(target) || target.toLowerCase().endsWith('.json')) {
    throw new ProductDefinitionError(
      'unsupported_cli_build_target',
      `Unsupported CLI build target: ${target}`,
      'Use a standard Rust target triple; custom target specification paths are outside C0a.',
    );
  }
  return target;
}

export function cliBuildPlan(resolution, mode, forwardArgs = [], platform = process.platform) {
  if (!['dev', 'build'].includes(mode)) {
    throw new ProductDefinitionError('invalid_cli_build_mode', `Unsupported CLI build mode: ${mode}`, 'Use dev or build.');
  }
  const environment = { ...process.env, ...productBuildEnvironment(resolution) };
  const manifestPath = join(ROOT, 'src', 'apps', 'cli', 'Cargo.toml');
  const cargoArgs = [mode === 'dev' ? 'run' : 'build', '--manifest-path', manifestPath, '--bin', 'openbitfun'];
  const forwarded = stripDelimiter(forwardArgs);
  if (mode === 'build') cargoArgs.push('--release', ...forwarded);
  else if (forwarded.length) cargoArgs.push('--', ...forwarded);
  const cargoTargetDir = environment.CARGO_TARGET_DIR
    ? resolve(ROOT, environment.CARGO_TARGET_DIR)
    : join(ROOT, 'target');
  const target = cargoBuildTarget(mode === 'build' ? forwarded : [], environment);
  const suffix = target
    ? (target.split('-').includes('windows') ? '.exe' : '')
    : (platform === 'win32' ? '.exe' : '');
  const profileDir = mode === 'build' ? 'release' : 'debug';
  return {
    resolution,
    mode,
    environment,
    cargoArgs,
    internalBinaryPath: join(cargoTargetDir, ...(target ? [target] : []), profileDir, `openbitfun${suffix}`),
    stagedBinaryPath: join(resolution.outputDir, 'package', `${resolution.assembly.binaryName}${suffix}`),
    stagedPluginHostPath: join(
      resolution.outputDir,
      'package',
      'resources',
      'ext-host',
    ),
    webUiOutPath: join(resolution.outputDir, 'web-ui'),
  };
}

export function selectedCliPlan(args, mode) {
  const { productConfig, forwardArgs } = extractProductConfigArg(args);
  const resolution = resolveProductDefinition({ rootDir: ROOT, productConfig, member: 'cli' });
  return cliBuildPlan(resolution, mode, forwardArgs);
}

function run(plan) {
  if (plan.mode === 'build') prepareCliWebUi(plan);
  const result = spawnSync('cargo', plan.cargoArgs, { cwd: ROOT, env: plan.environment, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`cargo exited with status ${result.status}`);
  if (plan.mode === 'build') {
    if (!existsSync(plan.internalBinaryPath)) throw new Error(`CLI binary was not produced: ${plan.internalBinaryPath}`);
    ensureProductOutputDirectory(plan.resolution);
    mkdirSync(join(plan.stagedBinaryPath, '..'), { recursive: true });
    copyFileSync(plan.internalBinaryPath, plan.stagedBinaryPath);
    stagePluginHostResources(plan.stagedPluginHostPath);
    console.log(`[product] staged CLI: ${plan.stagedBinaryPath}`);
    console.log(`[product] staged plugin Host: ${plan.stagedPluginHostPath}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode = 'dev', ...args] = process.argv.slice(2);
    const plan = selectedCliPlan(args, mode);
    console.log(`[product] ${plan.resolution.assembly.member} ${plan.resolution.assembly.assemblyDigest}`);
    run(plan);
  } catch (error) {
    console.error(error instanceof ProductDefinitionError
      ? JSON.stringify({ ok: false, code: error.code, message: error.message, action: error.action })
      : error?.stack || error);
    process.exitCode = 1;
  }
}
