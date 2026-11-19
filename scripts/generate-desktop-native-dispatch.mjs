#!/usr/bin/env node
// Generates the native (Tauri-free) command dispatcher of the desktop backend.
//
// Input: the `tauri::generate_handler![...]` list in `src/apps/desktop/src/lib.rs`
// and the `#[tauri::command]` definitions under `src/apps/desktop/src`.
// Output: `src/apps/desktop/src/backend_protocol/dispatch_generated.rs`, one
// boxed future per command (see the stack-frame note in
// `src/apps/cli/src/peer_host/commands/mod.rs`). Parameters are filled the
// way Tauri fills them: managed `State<T>` from the native host registry,
// `HostHandle` as the native host, every other parameter deserialized from
// `args[camelCase(name)]` (or the snake_case name under
// `rename_all = "snake_case"`). Commands that take a Tauri webview, window,
// raw IPC request or `tauri::AppHandle` get an explicit unsupported arm.
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

/** Parses every `#[tauri::command]` function in one source file. */
export function parseCommands(source, file) {
  const commands = [];
  let index = 0;
  while ((index = source.indexOf('#[tauri::command', index)) !== -1) {
    // Only attributes count: skip mentions in comments and string literals.
    const lineStart = source.lastIndexOf('\n', index - 1) + 1;
    if (source.slice(lineStart, index).trim() !== '') {
      index += 1;
      continue;
    }
    let attrEnd = index;
    let depth = 0;
    for (; attrEnd < source.length; attrEnd += 1) {
      if (source[attrEnd] === '[') depth += 1;
      else if (source[attrEnd] === ']') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const attribute = source.slice(index, attrEnd + 1);
    const fnPattern = /(pub(?:\([^)]*\))?\s+)?(async\s+)?fn\s+([A-Za-z0-9_]+)\s*(<[^(]*>)?\s*\(/g;
    fnPattern.lastIndex = attrEnd;
    const match = fnPattern.exec(source);
    if (!match) throw new Error(`${file}: no fn after ${attribute}`);
    const between = source.slice(attrEnd + 1, match.index);
    if (/\bfn\b|;/.test(stripLineComments(between).replace(/#\[[^\]]*\]/g, ''))) {
      throw new Error(`${file}: unexpected item between ${attribute} and fn ${match[3]}`);
    }
    let cursor = fnPattern.lastIndex;
    depth = 1;
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

/** The handler paths registered in `tauri::generate_handler![...]`. */
export function parseRegisteredHandlers(libSource) {
  const start = libSource.indexOf('tauri::generate_handler![');
  if (start === -1) throw new Error('lib.rs: generate_handler! not found');
  const end = libSource.indexOf(']', start + 'tauri::generate_handler!['.length);
  const body = stripLineComments(libSource.slice(start + 'tauri::generate_handler!['.length, end));
  return splitTopLevel(body).map((entry) => {
    if (!/^[A-Za-z0-9_:]+$/.test(entry)) throw new Error(`lib.rs: unexpected handler entry ${entry}`);
    const segments = entry.split('::');
    return { path: entry, name: segments[segments.length - 1] };
  });
}

const TAURI_ONLY_TYPE =
  /(^|::|\s|<)(AppHandle|Webview|WebviewWindow|Window)\b|tauri::ipc::|tauri::Window|tauri::State/;

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

export function buildDispatcher(libSource, files) {
  const definitions = new Map();
  for (const { file, source } of files) {
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
    if (handler.path.includes('::')) {
      const modulePath = handler.path.split('::').slice(0, -1).join('/');
      const narrowed = candidates.filter((candidate) => {
        const file = candidate.file.replace(/\.rs$/, '').replace(/\/mod$/, '');
        return file === modulePath || file.startsWith(`${modulePath}/`);
      });
      if (narrowed.length) candidates = narrowed;
    }
    if (!candidates.length) throw new Error(`no #[tauri::command] definition for ${handler.path}`);
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
    // A raw Tauri IPC response (binary body) has no JSON projection.
    if (/\btauri::/.test(command.returnType)) {
      tauriOnly.push({ pattern: '->', type: command.returnType });
    }
    entries.push({ handler, command, kinds, supported: tauriOnly.length === 0, tauriOnly });
  }
  entries.sort((a, b) => a.handler.name.localeCompare(b.handler.name));

  const lines = [];
  lines.push('// @generated by scripts/generate-desktop-native-dispatch.mjs. Do not edit by hand.');
  lines.push('// Regenerate with `node scripts/generate-desktop-native-dispatch.mjs` after');
  lines.push('// adding, removing or changing a registered `#[tauri::command]`.');
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
  lines.push('/// Whether the native host runs a registered command.');
  lines.push('#[derive(Debug, Clone, Copy, PartialEq, Eq)]');
  lines.push('pub enum NativeCommandSupport {');
  lines.push('    /// Runs in the native host.');
  lines.push('    Native,');
  lines.push('    /// Needs a Tauri webview, window, raw IPC request or app handle; the');
  lines.push('    /// native host rejects it with `unsupported_in_native_host: <command>`.');
  lines.push('    Unsupported,');
  lines.push('}');
  lines.push('');
  lines.push('/// Every command registered in `tauri::generate_handler!`, sorted by name.');
  lines.push('pub const NATIVE_COMMANDS: &[(&str, NativeCommandSupport)] = &[');
  for (const entry of entries) {
    lines.push(
      `    ("${entry.handler.name}", NativeCommandSupport::${entry.supported ? 'Native' : 'Unsupported'}),`,
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
    const { handler, command, kinds } = entry;
    const name = handler.name;
    if (!entry.supported) {
      const reason = entry.tauriOnly.map((param) => param.type.replace(/\s+/g, ' ')).join(', ');
      lines.push(`        // Tauri-only: ${reason}`);
      lines.push(`        "${name}" => Box::pin(async move { unsupported("${name}") }),`);
      continue;
    }
    lines.push(`        "${name}" => command_${name}(host, args),`);
    const callArgs = command.params.map((param, i) => {
      switch (kinds[i]) {
        case 'state':
          return `host.command_state("${name}")?`;
        case 'host':
          return 'HostHandle::Native(Arc::clone(host))';
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
    native: entries.filter((entry) => entry.supported).length,
    unsupported: entries.filter((entry) => !entry.supported).map((entry) => entry.handler.name),
  };
}

function main() {
  const check = process.argv.includes('--check');
  const list = process.argv.includes('--list-unsupported');
  const libSource = fs.readFileSync(libPath, 'utf8');
  const files = walk(desktopSrc)
    .filter((file) => file !== outputPath)
    .map((file) => ({ file: path.relative(desktopSrc, file), source: fs.readFileSync(file, 'utf8') }));
  const result = buildDispatcher(libSource, files);
  if (list) {
    console.log(result.unsupported.join('\n'));
    return;
  }
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  if (check) {
    if (current !== result.text) {
      console.error(
        `${path.relative(repoRoot, outputPath)} is stale; run node scripts/generate-desktop-native-dispatch.mjs`,
      );
      process.exit(1);
    }
    console.log(`native dispatcher is up to date (${result.native}/${result.total} commands native)`);
    return;
  }
  if (current !== result.text) fs.writeFileSync(outputPath, result.text);
  console.log(
    `wrote ${path.relative(repoRoot, outputPath)}: ${result.native}/${result.total} commands native, ${result.unsupported.length} unsupported`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
