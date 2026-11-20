#!/usr/bin/env node
// Generates the command dispatcher of the desktop backend (the only command
// entry: the in-process NSH host, OBP WebSocket and mesh connections all go
// through `BackendService::dispatch`).
//
// Input: the `backend_commands![...]` list in `src/apps/desktop/src/lib.rs`
// (the product command vocabulary) and the command definitions under
// `src/apps/desktop/src`, each marked by a `// @backend-command` line right
// before its `fn` (`// @backend-command(rename_all = "snake_case")` keeps
// snake_case argument keys).
// Output: `src/apps/desktop/src/backend_protocol/dispatch_generated.rs`, one
// boxed future per command (see the stack-frame note in
// `src/apps/cli/src/peer_host/commands/mod.rs`). Parameters are filled the way
// the retired Tauri host filled them, so clients keep their wire shape:
// managed `State<T>` from the host registry, `HostHandle` as the host, every
// other parameter deserialized from `args[camelCase(name)]` (or the snake_case
// name under `rename_all = "snake_case"`). A registered name may instead be a
// host adapter in `backend_protocol/native_commands/`
// (`pub(super) fn <command>(host: &Arc<NativeHost>, args: Value) ->
// DispatchFuture<'_>`), listed as `backend_protocol::native_commands::<command>`.
//
// Usage: node scripts/generate-desktop-native-dispatch.mjs [--check]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopSrc = path.join(repoRoot, 'src/apps/desktop/src');
const libPath = path.join(desktopSrc, 'lib.rs');
const outputPath = path.join(desktopSrc, 'backend_protocol/dispatch_generated.rs');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.rs')) out.push(full);
  }
  return out.sort();
}

function stripLineComments(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/** Splits at top-level commas, respecting (), [], {} and <> nesting. */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === '>' && text[i - 1] !== '-') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/** heck's `to_lower_camel_case`, which Tauri applies to argument names. */
export function lowerCamelCase(name) {
  const words = [];
  for (const chunk of name.split('_')) {
    if (!chunk) continue;
    let word = '';
    for (let i = 0; i < chunk.length; i += 1) {
      const ch = chunk[i];
      const prev = chunk[i - 1];
      const next = chunk[i + 1];
      const isUpper = ch >= 'A' && ch <= 'Z';
      const boundary =
        word &&
        isUpper &&
        ((prev >= 'a' && prev <= 'z') ||
          (prev >= '0' && prev <= '9') ||
          (prev >= 'A' && prev <= 'Z' && next >= 'a' && next <= 'z'));
      if (boundary) {
        words.push(word);
        word = '';
      }
      word += ch;
    }
    if (word) words.push(word);
  }
  return words
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word[0].toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join('');
}

/** heck's `to_snake_case`. */
export function snakeCase(name) {
  return lowerCamelCase(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

export const COMMAND_MARKER = '// @backend-command';

/** Parses every `// @backend-command` function in one source file. */
export function parseCommands(source, file) {
  const commands = [];
  let index = 0;
  while ((index = source.indexOf(COMMAND_MARKER, index)) !== -1) {
    // Only a marker line counts: skip mentions inside other comments and strings.
    const lineStart = source.lastIndexOf('\n', index - 1) + 1;
    if (source.slice(lineStart, index).trim() !== '') {
      index += 1;
      continue;
    }
    let lineEnd = source.indexOf('\n', index);
    if (lineEnd === -1) lineEnd = source.length;
    const attribute = source.slice(index, lineEnd).trim();
    if (!/^\/\/ @backend-command(\(rename_all = "[a-z_]+"\))?$/.test(attribute)) {
      throw new Error(`${file}: malformed command marker ${attribute}`);
    }
    const attrEnd = lineEnd - 1;
    const fnPattern = /(pub(?:\([^)]*\))?\s+)?(async\s+)?fn\s+([A-Za-z0-9_]+)\s*(<[^(]*>)?\s*\(/g;
    fnPattern.lastIndex = attrEnd;
    const match = fnPattern.exec(source);
    if (!match) throw new Error(`${file}: no fn after ${attribute}`);
    const between = source.slice(attrEnd + 1, match.index);
    if (/\bfn\b|;/.test(stripLineComments(between).replace(/#\[[^\]]*\]/g, ''))) {
      throw new Error(`${file}: unexpected item between ${attribute} and fn ${match[3]}`);
    }
    let cursor = fnPattern.lastIndex;
    let depth = 1;
    while (depth > 0) {
      const ch = source[cursor];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      cursor += 1;
    }
    const paramsText = stripLineComments(source.slice(fnPattern.lastIndex, cursor - 1));
    let end = cursor;
    let angle = 0;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === '<') angle += 1;
      else if (ch === '>' && source[end - 1] !== '-') angle -= 1;
      if (angle === 0 && (ch === '{' || source.startsWith('where', end))) break;
    }
    const returnType = source.slice(cursor, end).trim().replace(/^->\s*/, '').replace(/\s+/g, ' ');
    const renameAll = /rename_all\s*=\s*"([a-z_]+)"/.exec(attribute)?.[1] ?? 'camelCase';
    const params = splitTopLevel(paramsText).map((param) => {
      const colon = param.indexOf(':');
      const pattern = param.slice(0, colon).trim().replace(/^mut\s+/, '');
      const type = param.slice(colon + 1).trim();
      return { pattern, type };
    });
    commands.push({
      file,
      line: source.slice(0, index).split('\n').length,
      name: match[3],
      isAsync: Boolean(match[2]),
      generics: match[4] ?? '',
      renameAll,
      params,
      returnType,
    });
    index = attrEnd;
  }
  return commands;
}

export const REGISTRATION_MACRO = 'backend_commands![';

/** The command paths registered in `backend_commands![...]`. */
export function parseRegisteredHandlers(libSource) {
  const start = libSource.indexOf(REGISTRATION_MACRO);
  if (start === -1) throw new Error('lib.rs: backend_commands! not found');
  const end = libSource.indexOf(']', start + REGISTRATION_MACRO.length);
  const body = stripLineComments(libSource.slice(start + REGISTRATION_MACRO.length, end));
  return splitTopLevel(body).map((entry) => {
    if (!/^[A-Za-z0-9_:]+$/.test(entry)) throw new Error(`lib.rs: unexpected handler entry ${entry}`);
    const segments = entry.split('::');
    return { path: entry, name: segments[segments.length - 1] };
  });
}

const TAURI_ONLY_TYPE =
  /(^|::|\s|<)(AppHandle|Webview|WebviewWindow|Window)\b|tauri::ipc::|tauri::Window|tauri::State/;

/** `state` (managed state), `host` (the host handle), `tauri` (a retired Tauri type: rejected) or `arg`. */
export function classifyParam(param) {
  const type = param.type.replace(/\s+/g, '');
  if (/^(crate::host::)?State<'_,/.test(type) || /^(crate::host::)?State<'[a-z]+,/.test(type)) {
    return 'state';
  }
  if (/^(crate::host::)?HostHandle$/.test(type)) return 'host';
  if (TAURI_ONLY_TYPE.test(param.type)) return 'tauri';
  return 'arg';
}

function argumentKey(command, param) {
  return command.renameAll === 'snake_case' ? snakeCase(param.pattern) : lowerCamelCase(param.pattern);
}

function signatureKey(command) {
  return command.params
    .map((param) => {
      const kind = classifyParam(param);
      return kind === 'arg' ? `arg:${argumentKey(command, param)}` : kind;
    })
    .join(',');
}

const ADAPTER_DIR = 'backend_protocol/native_commands';
const ADAPTER_FN =
  /pub\((?:super|in crate::backend_protocol)\)\s+fn\s+([a-z0-9_]+)\s*\(\s*host:\s*&Arc<NativeHost>,\s*args:\s*Value,?\s*\)\s*->\s*DispatchFuture<'_>/g;

/** Native host adapters: `pub(super) fn <command>(host, args)` under `backend_protocol/native_commands/`. */
export function parseAdapters(files) {
  const adapters = new Map();
  for (const { file, source } of files) {
    if (!file.split(path.sep).join('/').startsWith(`${ADAPTER_DIR}/`)) continue;
    for (const match of stripLineComments(source).matchAll(ADAPTER_FN)) {
      if (adapters.has(match[1])) throw new Error(`duplicate native adapter ${match[1]}`);
      adapters.set(match[1], file);
    }
  }
  return adapters;
}

export function buildDispatcher(libSource, files) {
  const adapters = parseAdapters(files);
  const definitions = new Map();
  for (const { file, source } of files) {
    if (file.split(path.sep).join('/').startsWith(`${ADAPTER_DIR}/`)) continue;
    for (const command of parseCommands(source, file)) {
      if (!definitions.has(command.name)) definitions.set(command.name, []);
      definitions.get(command.name).push(command);
    }
  }
  const registered = parseRegisteredHandlers(libSource);
  const seen = new Set();
  const entries = [];
  for (const handler of registered) {
    if (seen.has(handler.name)) throw new Error(`duplicate handler ${handler.name}`);
    seen.add(handler.name);
    let candidates = definitions.get(handler.name) ?? [];
    const adapter = adapters.has(handler.name);
    if (adapter) {
      if (candidates.length) {
        throw new Error(
          `${handler.name} has a typed command definition; remove its stale native adapter (${adapters.get(handler.name)})`,
        );
      }
      if (handler.path !== `backend_protocol::native_commands::${handler.name}`) {
        throw new Error(
          `${handler.name} is a host adapter; register it as backend_protocol::native_commands::${handler.name}`,
        );
      }
      adapters.delete(handler.name);
      entries.push({ handler, adapter: true });
      continue;
    }
    if (handler.path.includes('::')) {
      const modulePath = handler.path.split('::').slice(0, -1).join('/');
      const narrowed = candidates.filter((candidate) => {
        const file = candidate.file.replace(/\.rs$/, '').replace(/\/mod$/, '');
        return file === modulePath || file.startsWith(`${modulePath}/`);
      });
      if (narrowed.length) candidates = narrowed;
    }
    if (!candidates.length) throw new Error(`no ${COMMAND_MARKER} definition for ${handler.path}`);
    const files = new Set(candidates.map((candidate) => candidate.file));
    if (files.size > 1) {
      throw new Error(
        `ambiguous definitions for ${handler.path}: ${[...files].join(', ')}; qualify the handler path`,
      );
    }
    const keys = new Set(candidates.map(signatureKey));
    const asyncness = new Set(candidates.map((candidate) => candidate.isAsync));
    if (keys.size > 1 || asyncness.size > 1) {
      throw new Error(`cfg variants of ${handler.name} disagree on their command signature`);
    }
    const command = candidates[0];
    if (command.generics) throw new Error(`${handler.name}: generic commands are not supported`);
    const kinds = command.params.map(classifyParam);
    const tauriOnly = command.params.filter((_, i) => kinds[i] === 'tauri');
    if (/\btauri::/.test(command.returnType)) tauriOnly.push({ pattern: '->', type: command.returnType });
    if (tauriOnly.length) {
      throw new Error(
        `${handler.name} takes ${tauriOnly.map((param) => param.type).join(', ')}: the Tauri host is retired; take HostHandle or write a host adapter in ${ADAPTER_DIR}/`,
      );
    }
    entries.push({ handler, command, kinds, adapter: false });
  }
  if (adapters.size) {
    throw new Error(`native adapters without a registered command: ${[...adapters.keys()].join(', ')}`);
  }
  const marked = [...definitions.keys()].filter((name) => !seen.has(name));
  if (marked.length) {
    throw new Error(`${COMMAND_MARKER} functions missing from backend_commands!: ${marked.sort().join(', ')}`);
  }
  entries.sort((a, b) => a.handler.name.localeCompare(b.handler.name));

  const lines = [];
  lines.push('// @generated by scripts/generate-desktop-native-dispatch.mjs. Do not edit by hand.');
  lines.push('// Regenerate with `node scripts/generate-desktop-native-dispatch.mjs` after');
  lines.push('// adding, removing or changing a registered backend command.');
  lines.push('');
  lines.push('// Formatting is the generator\'s, so `--check` stays stable under `fmt:rs`.');
  lines.push('#![cfg_attr(rustfmt, rustfmt::skip)]');
  lines.push('#![allow(clippy::let_unit_value, clippy::unit_arg, unused_variables)]');
  lines.push('');
  lines.push('use std::sync::Arc;');
  lines.push('');
  lines.push('use serde_json::Value;');
  lines.push('');
  lines.push('#[allow(unused_imports)]');
  lines.push('use super::dispatch::{arg, unsupported, ResultKind as _, ValueKind as _};');
  lines.push('use super::DispatchFuture;');
  lines.push('use crate::host::{HostHandle, NativeHost};');
  lines.push('');
  lines.push('/// How the backend answers a registered command.');
  lines.push('#[derive(Debug, Clone, Copy, PartialEq, Eq)]');
  lines.push('pub enum NativeCommandSupport {');
  lines.push('    /// A typed command handler (`// @backend-command`).');
  lines.push('    Native,');
  lines.push('    /// A host adapter (`backend_protocol::native_commands`) that works on');
  lines.push('    /// the host and its shell channel directly.');
  lines.push('    Adapter,');
  lines.push('}');
  lines.push('');
  lines.push('/// Every command registered in `backend_commands!`, sorted by name.');
  lines.push('pub const NATIVE_COMMANDS: &[(&str, NativeCommandSupport)] = &[');
  for (const entry of entries) {
    lines.push(
      `    ("${entry.handler.name}", NativeCommandSupport::${entry.adapter ? 'Adapter' : 'Native'}),`,
    );
  }
  lines.push('];');
  lines.push('');
  lines.push('// Select the handler before polling it: each arm lives in its own');
  lines.push('// function so a debug build reserves one handler future per call frame');
  lines.push('// instead of every arm at once (see the note in');
  lines.push('// `src/apps/cli/src/peer_host/commands/mod.rs`).');
  lines.push('pub(super) fn dispatch<\'a>(');
  lines.push('    host: &\'a Arc<NativeHost>,');
  lines.push('    command: &\'a str,');
  lines.push('    args: Value,');
  lines.push(') -> DispatchFuture<\'a> {');
  lines.push('    match command {');
  const handlers = [];
  for (const entry of entries) {
    const { handler } = entry;
    const name = handler.name;
    if (entry.adapter) {
      lines.push(`        "${name}" => super::native_commands::${name}(host, args),`);
      continue;
    }
    const { command, kinds } = entry;
    lines.push(`        "${name}" => command_${name}(host, args),`);
    const callArgs = command.params.map((param, i) => {
      switch (kinds[i]) {
        case 'state':
          return `host.command_state("${name}")?`;
        case 'host':
          return 'HostHandle::new(Arc::clone(host))';
        default:
          return `arg(&args, "${argumentKey(command, param)}", "${name}")?`;
      }
    });
    const call = `crate::${handler.path}(${callArgs.length ? `\n            ${callArgs.join(',\n            ')},\n        ` : ''})`;
    handlers.push('');
    handlers.push('#[inline(never)]');
    handlers.push(`fn command_${name}(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> {`);
    handlers.push('    Box::pin(async move {');
    handlers.push(`        let result = ${call}${command.isAsync ? '.await' : ''};`);
    handlers.push('        (&result).dispatch_kind().finish(result)');
    handlers.push('    })');
    handlers.push('}');
  }
  lines.push('        _ => Box::pin(async move { unsupported(command) }),');
  lines.push('    }');
  lines.push('}');
  lines.push(...handlers);
  lines.push('');
  return {
    text: lines.join('\n'),
    total: entries.length,
    native: entries.filter((entry) => !entry.adapter).length,
    adapters: entries.filter((entry) => entry.adapter).map((entry) => entry.handler.name),
  };
}

function main() {
  const check = process.argv.includes('--check');
  const libSource = fs.readFileSync(libPath, 'utf8');
  const files = walk(desktopSrc)
    .filter((file) => file !== outputPath)
    .map((file) => ({ file: path.relative(desktopSrc, file), source: fs.readFileSync(file, 'utf8') }));
  const result = buildDispatcher(libSource, files);
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  if (check) {
    if (current !== result.text) {
      console.error(
        `${path.relative(repoRoot, outputPath)} is stale; run node scripts/generate-desktop-native-dispatch.mjs`,
      );
      process.exit(1);
    }
    console.log(
      `backend dispatcher is up to date (${result.total} commands: ${result.native} typed, ${result.adapters.length} host adapters)`,
    );
    return;
  }
  if (current !== result.text) fs.writeFileSync(outputPath, result.text);
  console.log(
    `wrote ${path.relative(repoRoot, outputPath)}: ${result.total} commands (${result.native} typed, ${result.adapters.length} host adapters)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
