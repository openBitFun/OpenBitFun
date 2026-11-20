import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildDispatcher,
  classifyParam,
  lowerCamelCase,
  parseCommands,
  snakeCase,
} from './generate-desktop-native-dispatch.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('argument keys keep the historic (heck) casing', () => {
  assert.equal(lowerCamelCase('request'), 'request');
  assert.equal(lowerCamelCase('workspace_id'), 'workspaceId');
  assert.equal(lowerCamelCase('_request'), 'request');
  assert.equal(lowerCamelCase('targetDeviceId'), 'targetDeviceId');
  assert.equal(snakeCase('targetDeviceId'), 'target_device_id');
});

test('parameters are classified as state, host, retired Tauri types or arguments', () => {
  assert.equal(classifyParam({ pattern: 's', type: "State<'_, AppState>" }), 'state');
  assert.equal(classifyParam({ pattern: 's', type: "crate::host::State<'_, X>" }), 'state');
  assert.equal(classifyParam({ pattern: 'app', type: 'HostHandle' }), 'host');
  assert.equal(classifyParam({ pattern: 'app', type: 'tauri::AppHandle' }), 'tauri');
  assert.equal(classifyParam({ pattern: 'w', type: 'tauri::Webview' }), 'tauri');
  assert.equal(classifyParam({ pattern: 'r', type: 'WindowBoundsRequest' }), 'arg');
  assert.equal(classifyParam({ pattern: 'r', type: 'Option<Vec<String>>' }), 'arg');
});

test('generates one arm per registered command with injected and decoded parameters', () => {
  const lib = `
    backend_commands![
        // Group
        api::a::alpha,
        gamma,
    ];
  `;
  const source = `
// @backend-command
pub async fn alpha(
    state: State<'_, AppState>,
    app: HostHandle,
    mut request: AlphaRequest,
    workspace_id: Option<String>,
) -> Result<(), String> { Ok(()) }

// @backend-command
#[cfg(debug_assertions)]
pub async fn gamma(request: GammaRequest) -> Result<u32, String> { Ok(1) }

// @backend-command
#[cfg(not(debug_assertions))]
pub async fn gamma(_request: GammaRequest) -> Result<u32, String> { Ok(0) }
`;
  const result = buildDispatcher(lib, [
    { file: 'api/a.rs', source: source.split('// @backend-command\n#[cfg(debug_assertions)]')[0] },
    { file: 'lib.rs', source: `// @backend-command\n#[cfg(debug_assertions)]${source.split('// @backend-command\n#[cfg(debug_assertions)]')[1]}` },
  ]);
  assert.equal(result.total, 2);
  assert.deepEqual(result.adapters, []);
  assert.match(result.text, /"alpha" => command_alpha\(host, args\),/);
  assert.match(result.text, /fn command_alpha\(host: &Arc<NativeHost>, args: Value\) -> DispatchFuture<'_> \{/);
  assert.match(result.text, /crate::api::a::alpha\(\n\s+host\.command_state\("alpha"\)\?,\n\s+HostHandle::new\(Arc::clone\(host\)\),\n\s+arg\(&args, "request", "alpha"\)\?,\n\s+arg\(&args, "workspaceId", "alpha"\)\?,/);
  assert.match(result.text, /crate::gamma\(\n\s+arg\(&args, "request", "gamma"\)\?,\n\s+\)\.await;/);
});

test('a retired Tauri parameter type is rejected', () => {
  const lib = 'backend_commands![ beta ];';
  const source = '// @backend-command\npub fn beta(app: tauri::AppHandle) -> bool { true }\n';
  assert.throws(() => buildDispatcher(lib, [{ file: 'lib.rs', source }]), /Tauri host is retired/);
});

test('host adapters are registered commands and stale or unregistered ones are rejected', () => {
  const lib = 'backend_commands![ backend_protocol::native_commands::window_cmd, plain ];';
  const commands = `
// @backend-command
pub async fn plain(request: R) -> Result<(), String> { Ok(()) }
`;
  const adapter = (name) => ({
    file: 'backend_protocol/native_commands/mod.rs',
    source: `pub(super) fn ${name}(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> { todo!() }`,
  });
  const result = buildDispatcher(lib, [{ file: 'api/w.rs', source: commands }, adapter('window_cmd')]);
  assert.deepEqual(result.adapters, ['window_cmd']);
  assert.match(result.text, /"window_cmd" => super::native_commands::window_cmd\(host, args\),/);
  assert.match(result.text, /\("window_cmd", NativeCommandSupport::Adapter\)/);
  assert.throws(
    () => buildDispatcher(lib, [{ file: 'api/w.rs', source: commands }, adapter('window_cmd'), adapter('plain')]),
    /stale native adapter/,
  );
  assert.throws(
    () => buildDispatcher(lib, [{ file: 'api/w.rs', source: commands }, adapter('window_cmd'), adapter('missing')]),
    /without a registered command/,
  );
  assert.throws(
    () => buildDispatcher('backend_commands![ window_cmd, plain ];', [{ file: 'api/w.rs', source: commands }, adapter('window_cmd')]),
    /register it as backend_protocol::native_commands::window_cmd/,
  );
});

test('every marked command must be registered', () => {
  const lib = 'backend_commands![ delta ];';
  const source = `
// @backend-command
pub async fn delta(request: R) -> Result<(), String> { Ok(()) }
// @backend-command
pub async fn epsilon(request: R) -> Result<(), String> { Ok(()) }
`;
  assert.throws(() => buildDispatcher(lib, [{ file: 'lib.rs', source }]), /missing from backend_commands!: epsilon/);
});

test('cfg variants with different argument keys are rejected', () => {
  const lib = 'backend_commands![ delta ];';
  const source = `
// @backend-command
pub async fn delta(request: R) -> Result<(), String> { Ok(()) }
// @backend-command
pub async fn delta(other: R) -> Result<(), String> { Ok(()) }
`;
  assert.throws(() => buildDispatcher(lib, [{ file: 'lib.rs', source }]), /disagree/);
});

test('comments mentioning the marker are not commands', () => {
  const commands = parseCommands('//! uses `// @backend-command` handlers\nfn helper() {}\n', 'x.rs');
  assert.equal(commands.length, 0);
});

test('the checked-in dispatcher is up to date', () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/generate-desktop-native-dispatch.mjs'), '--check'], {
    stdio: 'pipe',
    windowsHide: true,
  });
});
