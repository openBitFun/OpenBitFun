// OpenUI Lang for the NSH surface: tokenizer, statement parser and evaluator.
//
// A GenerativeUI answer is OpenUI Lang source (`createSurface.source` with
// `kind: "openui-lang"`, streamed as `GenUIStream` deltas). The desktop's React
// renderer used `@openuidev/lang-core`; an NSH bundle cannot load that package,
// so this module reads the same language: `name = Expression` statements,
// positional component calls, `$state` with defaults, `@Builtin(...)` functions
// and `@Action` steps, hoisting, and a streamed source whose last statement is
// still incomplete. Component signatures (argument order) come from the
// product library the host prompts the model with (`genuiSignatures.ts`).
//
// Evaluation is pure: it maps the parsed program and the current state onto an
// element tree that `GenUIView.tsx` draws. Actions stay unevaluated closures and
// run when pressed, against the state at that moment.

import { ACTION_STEPS, COMPONENT_SIGNATURES } from "./genuiSignatures";
import { callBuiltin } from "./genuiFunctions";

// --- Tokens ---------------------------------------------------------------

type TokenKind = "num" | "str" | "ident" | "state" | "fn" | "op" | "nl" | "eof";

interface Token {
  kind: TokenKind;
  value: string;
  /** Offset in the source, for diagnostics. */
  at: number;
}

const OPERATORS = ["==", "!=", ">=", "<=", "&&", "||", "+", "-", "*", "/", "%", ">", "<", "!", "?", ":", "(", ")", "[", "]", "{", "}", ",", ".", "="];

export class OpenUiSyntaxError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let depth = 0;
  const length = source.length;
  while (index < length) {
    const char = source[index];
    if (char === "\n") {
      if (depth === 0) tokens.push({ kind: "nl", value: "\n", at: index });
      index += 1;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      while (index < length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = "";
      let cursor = index + 1;
      let closed = false;
      while (cursor < length) {
        const next = source[cursor];
        if (next === "\\") {
          const escaped = source[cursor + 1];
          if (escaped === undefined) break;
          if (escaped === "n") value += "\n";
          else if (escaped === "t") value += "\t";
          else if (escaped === "r") value += "\r";
          else if (escaped === "u" && /^[0-9a-fA-F]{4}$/.test(source.slice(cursor + 2, cursor + 6))) {
            value += String.fromCharCode(parseInt(source.slice(cursor + 2, cursor + 6), 16));
            cursor += 4;
          } else value += escaped;
          cursor += 2;
          continue;
        }
        if (next === quote) {
          closed = true;
          break;
        }
        value += next;
        cursor += 1;
      }
      if (!closed) throw new OpenUiSyntaxError("unterminated string", index);
      tokens.push({ kind: "str", value, at: index });
      index = cursor + 1;
      continue;
    }
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[index + 1] ?? ""))) {
      const match = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(source.slice(index));
      const text = match ? match[0] : char;
      tokens.push({ kind: "num", value: text, at: index });
      index += text.length;
      continue;
    }
    if (char === "$" || char === "@" || /[A-Za-z_]/.test(char)) {
      let cursor = index;
      let kind: TokenKind = "ident";
      if (char === "$") {
        kind = "state";
        cursor += 1;
      } else if (char === "@") {
        kind = "fn";
        cursor += 1;
        // The prompt lists library functions as `@@Name`; both spellings call it.
        if (source[cursor] === "@") cursor += 1;
      }
      const start = cursor;
      while (cursor < length && /[A-Za-z0-9_]/.test(source[cursor])) cursor += 1;
      const name = source.slice(start, cursor);
      if (!name) throw new OpenUiSyntaxError(`expected a name after ${char}`, index);
      tokens.push({ kind, value: name, at: index });
      index = cursor;
      continue;
    }
    const operator = OPERATORS.find(op => source.startsWith(op, index));
    if (!operator) throw new OpenUiSyntaxError(`unexpected character ${JSON.stringify(char)}`, index);
    if (operator === "(" || operator === "[" || operator === "{") depth += 1;
    if (operator === ")" || operator === "]" || operator === "}") depth = Math.max(0, depth - 1);
    tokens.push({ kind: "op", value: operator, at: index });
    index += operator.length;
  }
  tokens.push({ kind: "eof", value: "", at: length });
  return tokens;
}

// --- Syntax tree -------------------------------------------------------------

export type Expr =
  | { kind: "literal"; value: unknown }
  | { kind: "array"; items: Expr[] }
  | { kind: "object"; entries: Array<[string, Expr]> }
  | { kind: "ref"; name: string }
  | { kind: "state"; name: string }
  | { kind: "call"; name: string; args: Expr[] }
  | { kind: "fn"; name: string; args: Expr[] }
  | { kind: "unary"; op: string; operand: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "ternary"; test: Expr; then: Expr; otherwise: Expr }
  | { kind: "member"; target: Expr; name: string }
  | { kind: "index"; target: Expr; index: Expr };

export interface Statement {
  name: string;
  /** `$name = …` declares a state variable and its default. */
  state: boolean;
  expr: Expr;
}

class Parser {
  private position = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== "eof") this.position += 1;
    return token;
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token.kind === "op" && token.value === value;
  }

  private expect(value: string): void {
    const token = this.next();
    if (token.kind !== "op" || token.value !== value) {
      throw new OpenUiSyntaxError(`expected ${value}`, token.at);
    }
  }

  atEnd(): boolean {
    return this.peek().kind === "eof";
  }

  skipNewlines(): void {
    while (this.peek().kind === "nl") this.next();
  }

  /** One statement; throws on anything else, leaving the caller to resynchronize. */
  statement(): Statement {
    const head = this.next();
    if ((head.kind !== "ident" && head.kind !== "state") || !this.isOp("=")) {
      throw new OpenUiSyntaxError("expected `name = expression`", head.at);
    }
    this.next();
    const expr = this.expression();
    const end = this.peek();
    if (end.kind !== "nl" && end.kind !== "eof") throw new OpenUiSyntaxError("expected the end of the statement", end.at);
    return { name: head.value, state: head.kind === "state", expr };
  }

  /** Skips to the token after the next top-level newline. */
  recover(): void {
    while (!this.atEnd() && this.peek().kind !== "nl") this.next();
  }

  expression(): Expr {
    const test = this.or();
    if (this.isOp("?")) {
      this.next();
      const then = this.expression();
      this.expect(":");
      const otherwise = this.expression();
      return { kind: "ternary", test, then, otherwise };
    }
    return test;
  }

  private binaryLevel(operators: string[], operand: () => Expr): Expr {
    let left = operand();
    while (this.peek().kind === "op" && operators.includes(this.peek().value)) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: operand() };
    }
    return left;
  }

  private or(): Expr {
    return this.binaryLevel(["||"], () => this.and());
  }

  private and(): Expr {
    return this.binaryLevel(["&&"], () => this.equality());
  }

  private equality(): Expr {
    return this.binaryLevel(["==", "!="], () => this.comparison());
  }

  private comparison(): Expr {
    return this.binaryLevel([">", "<", ">=", "<="], () => this.additive());
  }

  private additive(): Expr {
    return this.binaryLevel(["+", "-"], () => this.multiplicative());
  }

  private multiplicative(): Expr {
    return this.binaryLevel(["*", "/", "%"], () => this.unary());
  }

  private unary(): Expr {
    if (this.isOp("!") || this.isOp("-")) {
      const op = this.next().value;
      return { kind: "unary", op, operand: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let target = this.primary();
    for (;;) {
      if (this.isOp(".")) {
        this.next();
        const name = this.next();
        if (name.kind !== "ident") throw new OpenUiSyntaxError("expected a field name", name.at);
        target = { kind: "member", target, name: name.value };
      } else if (this.isOp("[")) {
        this.next();
        const index = this.expression();
        this.expect("]");
        target = { kind: "index", target, index };
      } else {
        return target;
      }
    }
  }

  private list(close: string): Expr[] {
    const items: Expr[] = [];
    while (!this.isOp(close)) {
      if (this.atEnd()) throw new OpenUiSyntaxError(`expected ${close}`, this.peek().at);
      items.push(this.expression());
      if (this.isOp(",")) this.next();
      else if (!this.isOp(close)) throw new OpenUiSyntaxError(`expected , or ${close}`, this.peek().at);
    }
    this.next();
    return items;
  }

  private primary(): Expr {
    const token = this.next();
    switch (token.kind) {
      case "num":
        return { kind: "literal", value: Number(token.value) };
      case "str":
        return { kind: "literal", value: token.value };
      case "state":
        return { kind: "state", name: token.value };
      case "fn": {
        this.expect("(");
        return { kind: "fn", name: token.value, args: this.list(")") };
      }
      case "ident": {
        if (token.value === "true") return { kind: "literal", value: true };
        if (token.value === "false") return { kind: "literal", value: false };
        if (token.value === "null") return { kind: "literal", value: null };
        if (this.isOp("(")) {
          this.next();
          return { kind: "call", name: token.value, args: this.list(")") };
        }
        return { kind: "ref", name: token.value };
      }
      case "op": {
        if (token.value === "(") {
          const inner = this.expression();
          this.expect(")");
          return inner;
        }
        if (token.value === "[") return { kind: "array", items: this.list("]") };
        if (token.value === "{") {
          const entries: Array<[string, Expr]> = [];
          while (!this.isOp("}")) {
            const key = this.next();
            if (key.kind !== "ident" && key.kind !== "str") throw new OpenUiSyntaxError("expected a key", key.at);
            this.expect(":");
            entries.push([key.value, this.expression()]);
            if (this.isOp(",")) this.next();
            else if (!this.isOp("}")) throw new OpenUiSyntaxError("expected , or }", this.peek().at);
          }
          this.next();
          return { kind: "object", entries };
        }
        throw new OpenUiSyntaxError(`unexpected ${token.value}`, token.at);
      }
      default:
        throw new OpenUiSyntaxError("unexpected end of input", token.at);
    }
  }
}

export interface ParsedProgram {
  statements: Map<string, Statement>;
  /** Declared state variables with their default expressions, in order. */
  stateDefaults: Map<string, Expr>;
  /** Statements that did not parse (the last one while streaming is usually incomplete). */
  errors: Array<{ message: string; at: number }>;
}

/**
 * Parses a whole or partial source. A statement that does not parse is skipped
 * (and reported); a later definition of a name replaces an earlier one, the way
 * an edited program does.
 */
export function parseOpenUi(source: string): ParsedProgram {
  const statements = new Map<string, Statement>();
  const stateDefaults = new Map<string, Expr>();
  const errors: Array<{ message: string; at: number }> = [];
  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch (error) {
    // A string still streaming: parse what precedes the line it starts on.
    const at = error instanceof OpenUiSyntaxError ? error.at : source.length;
    const cut = source.lastIndexOf("\n", at);
    if (cut <= 0) return { statements, stateDefaults, errors: [{ message: errorMessage(error), at }] };
    const head = parseOpenUi(source.slice(0, cut));
    head.errors.push({ message: errorMessage(error), at });
    return head;
  }
  const parser = new Parser(tokens);
  parser.skipNewlines();
  while (!parser.atEnd()) {
    try {
      const statement = parser.statement();
      if (statement.state) stateDefaults.set(statement.name, statement.expr);
      else statements.set(statement.name, statement);
    } catch (error) {
      errors.push({ message: errorMessage(error), at: error instanceof OpenUiSyntaxError ? error.at : 0 });
      parser.recover();
    }
    parser.skipNewlines();
  }
  return { statements, stateDefaults, errors };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Evaluation --------------------------------------------------------------

/** A rendered component: its library name, its props by name, and its state bindings. */
export interface GenElement {
  kind: "element";
  component: string;
  props: Record<string, unknown>;
  /** Prop name → the `$variable` the prop reads and writes. */
  bindings: Record<string, string>;
  /** Stable within one evaluation: the path of statements and positions that made it. */
  key: string;
}

/** A pressable action: steps evaluated when it runs, in the scope it was written in. */
export interface GenAction {
  kind: "action";
  steps: Expr[];
  scope: Scope;
}

export interface Scope {
  vars: Record<string, unknown>;
}

export type ActionStep =
  | { kind: "toAssistant"; message: string; context?: unknown }
  | { kind: "openUrl"; url: string }
  | { kind: "set"; name: string; value: unknown }
  | { kind: "reset"; names: string[] }
  | { kind: "copy"; text: string };

export function isGenElement(value: unknown): value is GenElement {
  return Boolean(value) && typeof value === "object" && (value as GenElement).kind === "element";
}

export function isGenAction(value: unknown): value is GenAction {
  return Boolean(value) && typeof value === "object" && (value as GenAction).kind === "action";
}

export interface Evaluation {
  root: GenElement | null;
  /** Names the source referenced that it never defined (yet, while streaming). */
  unresolved: string[];
  /** Components and functions this renderer does not know. */
  unknown: string[];
}

const MAX_DEPTH = 64;

export class Evaluator {
  private readonly cache = new Map<string, unknown>();
  private readonly active = new Set<string>();
  readonly unresolved = new Set<string>();
  readonly unknown = new Set<string>();

  constructor(
    private readonly program: ParsedProgram,
    private readonly state: Record<string, unknown>,
  ) {}

  evaluateRoot(): Evaluation {
    const rootName = this.program.statements.has("root")
      ? "root"
      : [...this.program.statements.keys()][0];
    const value = rootName ? this.reference(rootName, `s:${rootName}`) : null;
    return {
      root: isGenElement(value) ? value : null,
      unresolved: [...this.unresolved],
      unknown: [...this.unknown],
    };
  }

  /** A state variable's current value: what the user set, else its declared default. */
  stateValue(name: string): unknown {
    if (Object.prototype.hasOwnProperty.call(this.state, name)) return this.state[name];
    const fallback = this.program.stateDefaults.get(name);
    return fallback ? this.evaluate(fallback, { vars: {} }, `default:${name}`, 0) : null;
  }

  private reference(name: string, key: string): unknown {
    if (this.cache.has(name)) return this.cache.get(name);
    const statement = this.program.statements.get(name);
    if (!statement) {
      this.unresolved.add(name);
      return null;
    }
    if (this.active.has(name)) return null;
    this.active.add(name);
    const value = this.evaluate(statement.expr, { vars: {} }, key, 0);
    this.active.delete(name);
    this.cache.set(name, value);
    return value;
  }

  evaluate(expr: Expr, scope: Scope, key: string, depth: number): unknown {
    if (depth > MAX_DEPTH) return null;
    const next = depth + 1;
    switch (expr.kind) {
      case "literal":
        return expr.value;
      case "array":
        return expr.items.map((item, index) => this.evaluate(item, scope, `${key}.${index}`, next));
      case "object": {
        const out: Record<string, unknown> = {};
        for (const [name, value] of expr.entries) out[name] = this.evaluate(value, scope, `${key}.${name}`, next);
        return out;
      }
      case "ref":
        if (Object.prototype.hasOwnProperty.call(scope.vars, expr.name)) return scope.vars[expr.name];
        return this.reference(expr.name, `s:${expr.name}`);
      case "state":
        return this.stateValue(expr.name);
      case "unary": {
        const operand = this.evaluate(expr.operand, scope, key, next);
        return expr.op === "!" ? !truthy(operand) : -toNumber(operand);
      }
      case "binary":
        return this.binary(expr, scope, key, next);
      case "ternary":
        return truthy(this.evaluate(expr.test, scope, key, next))
          ? this.evaluate(expr.then, scope, `${key}?`, next)
          : this.evaluate(expr.otherwise, scope, `${key}:`, next);
      case "member":
        return member(this.evaluate(expr.target, scope, key, next), expr.name);
      case "index": {
        const target = this.evaluate(expr.target, scope, key, next);
        const index = this.evaluate(expr.index, scope, key, next);
        if (Array.isArray(target) && typeof index === "number") return target[index < 0 ? target.length + index : index] ?? null;
        if (typeof target === "string" && typeof index === "number") return target[index] ?? null;
        if (target && typeof target === "object" && (typeof index === "string" || typeof index === "number")) {
          return (target as Record<string, unknown>)[String(index)] ?? null;
        }
        return null;
      }
      case "fn":
        return this.callFunction(expr, scope, key, next);
      case "call":
        return this.callComponent(expr, scope, key, next);
    }
  }

  private binary(expr: Extract<Expr, { kind: "binary" }>, scope: Scope, key: string, depth: number): unknown {
    if (expr.op === "&&") {
      const left = this.evaluate(expr.left, scope, key, depth);
      return truthy(left) ? this.evaluate(expr.right, scope, key, depth) : left;
    }
    if (expr.op === "||") {
      const left = this.evaluate(expr.left, scope, key, depth);
      return truthy(left) ? left : this.evaluate(expr.right, scope, key, depth);
    }
    const left = this.evaluate(expr.left, scope, key, depth);
    const right = this.evaluate(expr.right, scope, key, depth);
    switch (expr.op) {
      case "+":
        if (typeof left === "string" || typeof right === "string") return `${display(left)}${display(right)}`;
        return toNumber(left) + toNumber(right);
      case "-":
        return toNumber(left) - toNumber(right);
      case "*":
        return toNumber(left) * toNumber(right);
      case "/": {
        const divisor = toNumber(right);
        return divisor === 0 ? null : toNumber(left) / divisor;
      }
      case "%": {
        const divisor = toNumber(right);
        return divisor === 0 ? null : toNumber(left) % divisor;
      }
      case "==":
        return looseEqual(left, right);
      case "!=":
        return !looseEqual(left, right);
      case ">":
        return compare(left, right) > 0;
      case "<":
        return compare(left, right) < 0;
      case ">=":
        return compare(left, right) >= 0;
      case "<=":
        return compare(left, right) <= 0;
      default:
        return null;
    }
  }

  private callFunction(expr: Extract<Expr, { kind: "fn" }>, scope: Scope, key: string, depth: number): unknown {
    if (ACTION_STEPS.has(expr.name)) return { kind: "action", steps: [expr], scope } satisfies GenAction;
    if (expr.name === "Each") {
      const list = this.evaluate(expr.args[0] ?? { kind: "literal", value: [] }, scope, key, depth);
      const variable = this.evaluate(expr.args[1] ?? { kind: "literal", value: "item" }, scope, key, depth);
      const template = expr.args[2];
      if (!Array.isArray(list) || typeof variable !== "string" || !template) return [];
      return list.map((item, index) =>
        this.evaluate(template, { vars: { ...scope.vars, [variable]: item } }, `${key}#${index}`, depth),
      );
    }
    const args = expr.args.map((arg, index) => this.evaluate(arg, scope, `${key}.${index}`, depth));
    const result = callBuiltin(expr.name, args);
    if (result === undefined) {
      this.unknown.add(`@${expr.name}`);
      return null;
    }
    return result;
  }

  private callComponent(expr: Extract<Expr, { kind: "call" }>, scope: Scope, key: string, depth: number): unknown {
    if (expr.name === "Action") {
      const first = expr.args[0];
      const steps = first && first.kind === "array" ? first.items : expr.args;
      return { kind: "action", steps, scope } satisfies GenAction;
    }
    const signature = COMPONENT_SIGNATURES[expr.name];
    if (!signature) {
      this.unknown.add(expr.name);
      return null;
    }
    const props: Record<string, unknown> = {};
    const bindings: Record<string, string> = {};
    const elementKey = `${key}/${expr.name}`;
    expr.args.forEach((arg, index) => {
      const name = signature[index];
      if (!name) return;
      if (arg.kind === "state") bindings[name] = arg.name;
      props[name] = this.evaluate(arg, scope, `${elementKey}.${name}`, depth);
    });
    return { kind: "element", component: expr.name, props, bindings, key: elementKey } satisfies GenElement;
  }

  /** Turns an action's steps into concrete operations against the current state. */
  resolveAction(action: GenAction): ActionStep[] {
    const out: ActionStep[] = [];
    for (const step of action.steps) {
      if (step.kind === "ref") {
        const value = this.evaluate(step, action.scope, "action", 0);
        if (isGenAction(value)) out.push(...this.resolveAction(value));
        continue;
      }
      if (step.kind !== "fn") continue;
      const arg = (index: number) => (step.args[index] ? this.evaluate(step.args[index], action.scope, "action", 0) : undefined);
      switch (step.name) {
        case "ToAssistant":
          out.push({ kind: "toAssistant", message: display(arg(0)), ...(step.args[1] ? { context: arg(1) } : {}) });
          break;
        case "OpenUrl":
          out.push({ kind: "openUrl", url: display(arg(0)) });
          break;
        case "Set": {
          const target = step.args[0];
          if (target?.kind === "state") out.push({ kind: "set", name: target.name, value: arg(1) ?? null });
          break;
        }
        case "Reset":
          out.push({ kind: "reset", names: step.args.flatMap(target => (target.kind === "state" ? [target.name] : [])) });
          break;
        case "CopyToClipboard":
          out.push({ kind: "copy", text: display(arg(0)) });
          break;
      }
    }
    return out;
  }

  /** The declared default of a state variable, for `@Reset`. */
  defaultOf(name: string): unknown {
    const fallback = this.program.stateDefaults.get(name);
    return fallback ? this.evaluate(fallback, { vars: {} }, `default:${name}`, 0) : null;
  }
}

// --- Value helpers -----------------------------------------------------------

export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** How a value reads as text: numbers without float noise, nothing for null. */
export function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e10) / 1e10);
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map(display).join(", ");
  if (isGenElement(value) || isGenAction(value)) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function member(target: unknown, name: string): unknown {
  if (Array.isArray(target)) {
    if (name === "length") return target.length;
    // Plucks the field from every row: `rows.score`.
    return target.map(item => (item && typeof item === "object" ? (item as Record<string, unknown>)[name] ?? null : null));
  }
  if (typeof target === "string" && name === "length") return target.length;
  if (target && typeof target === "object") return (target as Record<string, unknown>)[name] ?? null;
  return null;
}

function looseEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if ((left === null || left === undefined) && (right === null || right === undefined)) return true;
  if (typeof left === "number" && typeof right === "string") return String(left) === right;
  if (typeof left === "string" && typeof right === "number") return left === String(right);
  return false;
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === "string" && typeof right === "string") return left < right ? -1 : left > right ? 1 : 0;
  return toNumber(left) - toNumber(right);
}

/** The initial state: every declared variable's default. */
export function initialState(program: ParsedProgram, seed: Record<string, unknown> = {}): Record<string, unknown> {
  const evaluator = new Evaluator(program, {});
  const state: Record<string, unknown> = {};
  for (const name of program.stateDefaults.keys()) state[name] = evaluator.defaultOf(name);
  return { ...state, ...seed };
}
