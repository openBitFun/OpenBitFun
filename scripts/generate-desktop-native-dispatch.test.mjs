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

test('argument keys follow Tauri (heck) casing', () => {
  assert.equal(lowerCamelCase('request'), 'request');
  assert.equal(lowerCamelCase('workspace_id'), 'workspaceId');
  assert.equal(lowerCamelCase('_request'), 'request');
  assert.equal(lowerCamelCase('targetDeviceId'), 'targetDeviceId');
  assert.equal(snakeCase('targetDeviceId'), 'target_device_id');
});

test('parameters are classified as state, host, Tauri-only or arguments', () => {
  assert.equal(classifyParam({ pattern: 's', type: "State<'_, AppState>" }), 'state');
  assert.equal(classifyParam({ pattern: 's', type: "crate::host::State<'_, X>" }), 'state');
  assert.equal(classifyParam({ pattern: 'app', type: 'HostHandle' }), 'host');
  assert.equal(classifyParam({ pattern: 'app', type: 'tauri::AppHandle' }), 'tauri');
  assert.equal(classifyParam({ pattern: 'w', type: 'tauri::Webview' }), 'tauri');
  assert.equal(classifyParam({ pattern: 'w', type: 'tauri::WebviewWindow' }), 'tauri');
  assert.equal(classifyParam({ pattern: 'r', type: "tauri::State<'_, X>" }), 'tauri');
  assert.equal(classifyParam({ pattern: 'r', type: 'WindowBoundsRequest' }), 'arg');
  assert.equal(classifyParam({ pattern: 'r', type: 'Option<Vec<String>>' }), 'arg');
});

test('generates one arm per registered command with injected and decoded parameters', () => {
  const lib = `
    fn x() {}
    .invoke_handler(tauri::generate_handler![
        // Group
        api::a::alpha,
        beta,
        gamma,
    ])
  `;
  const source = `
#[tauri::command]
pub async fn alpha(
    state: State<'_, AppState>,
    app: HostHandle,
    mut request: AlphaRequest,
    workspace_id: Option<String>,
) -> Result<(), String> { Ok(()) }

#[tauri::command]
pub fn beta(app: tauri::AppHandle) -> bool { true }

#[cfg(debug_assertions)]
#[tauri::command]
pub async fn gamma(request: GammaRequest) -> Result<u32, String> { Ok(1) }

#[cfg(not(debug_assertions))]
#[tauri::command]
pub async fn gamma(_request: GammaRequest) -> Result<u32, String> { Ok(0) }
`;
  const result = buildDispatcher(lib, [
    { file: 'api/a.rs', source: source.split('#[tauri::command]\npub fn beta')[0] },
    { file: 'lib.rs', source: `#[tauri::command]\npub fn beta${source.split('#[tauri::command]\npub fn beta')[1]}` },
  ]);
  assert.equal(result.total, 3);
  assert.deepEqual(result.unsupported, ['beta']);
  assert.match(result.text, /"alpha" => command_alpha\(host, args\),/);
  assert.match(result.text, /fn command_alpha\(host: &Arc<NativeHost>, args: Value\) -> DispatchFuture<'_> \{/);
  assert.match(result.text, /crate::api::a::alpha\(\n\s+host\.command_state\("alpha"\)\?,\n\s+HostHandle::Native\(Arc::clone\(host\)\),\n\s+arg\(&args, "request", "alpha"\)\?,\n\s+arg\(&args, "workspaceId", "alpha"\)\?,/);
  assert.match(result.text, /"beta" => Box::pin\(async move \{ unsupported\("beta"\) \}\)/);
  assert.match(result.text, /crate::gamma\(\n\s+arg\(&args, "request", "gamma"\)\?,\n\s+\)\.await;/);
});

test('cfg variants with different argument keys are rejected', () => {
  const lib = 'tauri::generate_handler![ delta ]';
  const source = `
#[tauri::command]
pub async fn delta(request: R) -> Result<(), String> { Ok(()) }
#[tauri::command]
pub async fn delta(other: R) -> Result<(), String> { Ok(()) }
`;
  assert.throws(() => buildDispatcher(lib, [{ file: 'lib.rs', source }]), /disagree/);
});

test('comments mentioning the attribute are not commands', () => {
  const commands = parseCommands('//! uses `#[tauri::command]` handlers\nfn helper() {}\n', 'x.rs');
  assert.equal(commands.length, 0);
});

test('the checked-in dispatcher is up to date', () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/generate-desktop-native-dispatch.mjs'), '--check'], {
    stdio: 'pipe',
    windowsHide: true,
  });
});
