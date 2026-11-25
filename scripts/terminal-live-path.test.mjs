// Static routing guards only: these do not establish live SSH/Peer/relay behavior.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function between(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

for (const path of [
  'src/apps/desktop/src/api/terminal_api.rs',
  'src/apps/cli/src/main.rs',
  'src/apps/sdk-host/src/runtime.rs',
]) {
  test(`static host PATH initialization routing: ${path}`, () => {
    const source = read(path);
    const policy = between(source, 'if let Ok(runtime_manager) = RuntimeManager::new()', 'TerminalApi::new(');
    const windows = between(policy, '#[cfg(windows)]', '#[cfg(not(windows))]');
    assert.match(windows, /runtime_manager\.terminal_path_entries\(\)/);
    assert.match(windows, /set_session_path_entries\(/);
    assert.doesNotMatch(windows, /merged_path_env|std::env::var|\.env\.insert/);
    const other = policy.slice(policy.indexOf('#[cfg(not(windows))]'));
    assert.match(other, /std::env::var\("PATH"\)\.ok\(\)/);
    assert.match(other, /merged_path_env\(process_path\.as_deref\(\)\)/);
    assert.match(other, /\.env\.insert\("PATH"\.to_string\(\), path\)/);
  });
}

test('static local builder routing keeps normalization Windows-only and reads baseline per create', () => {
  const source = read('src/crates/services/terminal/src/session/manager.rs');
  const create = between(source, '// The OS PATH is read here', '// Inject shell integration');
  assert.match(create, /#\[cfg\(windows\)\]\s*let baseline = session_path_baseline\(\)/);
  assert.match(create, /env: self\.build_session_env\(env, baseline\.as_deref\(\)\)/);
  const builder = between(source, '    fn build_session_env(', '    /// Inject shell integration scripts');
  const windows = between(builder, '#[cfg(windows)]', '#[cfg(not(windows))]');
  assert.match(windows, /request_path\.or\(config_path\)\.or_else/);
  assert.match(windows, /compose_session_path/);
  const other = builder.slice(builder.indexOf('#[cfg(not(windows))]'));
  assert.match(builder, /let mut session_env = self\.config\.env\.clone\(\)/);
  assert.match(other, /session_env\.extend\(request_env\)/);
  assert.doesNotMatch(other, /compose_session_path|to_string_lossy|take_session_path_entries/);
  assert.match(read('src/crates/services/terminal/src/config/mod.rs'), /#\[cfg\(windows\)\]\s*mod session_path;/);
});

test('static desktop remote branch returns before local init and never forwards environment', () => {
  const source = read('src/apps/desktop/src/api/terminal_api.rs');
  const create = between(source, 'pub async fn terminal_create(', 'pub async fn terminal_get(');
  const remote = between(create, 'if let Some(connection_id) = request', 'let api = state.get_or_init_api()');
  assert.match(remote, /return spawn_remote_pty_session\(/);
  assert.doesNotMatch(remote, /request\.env|build_session_env|session_path_baseline|merged_path_env|set_session_path_entries/);
  const spawn = between(source, 'async fn spawn_remote_pty_session(', '#[tauri::command]');
  assert.doesNotMatch(spawn, /request\.env|build_session_env|session_path_baseline|merged_path_env|set_session_path_entries/);
  assert.match(spawn, /terminal_manager\s*\.create_session\(/);
});

test('static remote service ShellConfig keeps an empty local environment overlay', () => {
  const source = read('src/crates/services/services-integrations/src/remote_ssh/remote_terminal.rs');
  const configs = [...source.matchAll(/let shell_config = ShellConfig\s*\{([\s\S]*?)\n\s*\};/g)];
  assert.ok(configs.length > 0, 'remote PTY shell configuration must remain visible');
  for (const [, config] of configs) assert.match(config, /env:\s*HashMap::new\(\)/);
  assert.doesNotMatch(source, /build_session_env|session_path_baseline|set_session_path_entries|terminal_path_entries|merged_path_env/);
});
