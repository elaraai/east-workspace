/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Authoring names for IR variables (#639).
 *
 * The IR carries a name on every variable; the builders used to mint `_N`.
 * These helpers recover the names the author wrote, with no new API:
 *
 * - a body's **parameters** from the function's own source text
 *   (`Function.prototype.toString()`): `($, items, threshold) => …` names
 *   `items` and `threshold`;
 * - a **`$.let` / `$.const` binding** from the call site the source map
 *   already resolves: the declaration whose initializer is the call at that
 *   position — `const total = $.let(` names `total`.
 *
 * Both are read with the TypeScript compiler's parser (`typescript`, an
 * optional peer dependency loaded through node's `require` on first use),
 * never by matching patterns against text. Where the compiler is absent — a
 * browser, a project without TypeScript — or a source cannot be read (a REPL
 * line that is gone, a native function), the name stays `_N`, exactly as
 * before. Uniqueness is the lowering's job (`ast_to_ir` suffixes a
 * collision), not this module's.
 */

import type { Location } from "./location.js";

type Compiler = typeof import("typescript");
type Node = import("typescript").Node;
type CallExpression = import("typescript").CallExpression;
type SignatureDeclaration = import("typescript").SignatureDeclaration;

let compilerModule: Compiler | null | undefined;

/** The TypeScript compiler, required once from this module's location; `null` where it cannot be. */
function compiler(): Compiler | null {
  if (compilerModule !== undefined) return compilerModule;
  compilerModule = null;
  try {
    const proc = (globalThis as any).process;
    const nodeModule = typeof proc?.getBuiltinModule === "function" ? proc.getBuiltinModule("node:module") : null;
    if (nodeModule) compilerModule = nodeModule.createRequire(import.meta.url)("typescript") as Compiler;
  } catch {
    compilerModule = null;
  }
  return compilerModule;
}

// ── parameter names from the function's source ────────────────────────────

/**
 * The parameter names of a JavaScript function, from its source text, or
 * `null` when they cannot be read (a native or bound function, no compiler).
 *
 * @param fn - The body function (an arrow, a `function`, or a method)
 * @returns The names in order — the block parameter included, at index 0; a
 *   destructured parameter is `""` (it names no slot); nothing past a rest
 *   parameter
 */
export function parameterNames(fn: unknown): string[] | null {
  if (typeof fn !== "function") return null;
  const ts = compiler();
  if (ts === null) return null;
  let text: string;
  try {
    text = Function.prototype.toString.call(fn);
  } catch {
    return null;
  }
  // an arrow or a `function` parses as an expression; a method (`name(a, b) { … }`) as an object literal's member
  const node = functionNode(ts, `(${text})`) ?? functionNode(ts, `({${text}})`);
  if (node === null) return null;
  const names: string[] = [];
  for (const p of node.parameters) {
    if (p.dotDotDotToken !== undefined) break;
    names.push(ts.isIdentifier(p.name) ? p.name.text : "");
  }
  return names;
}

/** The outermost function-like node of `source`, or `null` when it does not parse cleanly. */
function functionNode(ts: Compiler, source: string): SignatureDeclaration | null {
  const file = ts.createSourceFile("body.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics = (file as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) return null;
  let found: SignatureDeclaration | null = null;
  const visit = (node: Node): void => {
    if (found !== null) return;
    if (ts.isFunctionLike(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// ── binding names from the call site ──────────────────────────────────────

/**
 * One call of a source file: its head — the text from the callee through
 * the opening parenthesis, which is where a stack frame's position for the
 * call lands (V8 reports the callee's property name; a source map, the
 * token it maps to) — and the variable the call initializes, if any. Lines
 * and columns are 1-based, as in a `Location`; `from`/`to` are offsets, for
 * telling a call from the one chained onto it.
 */
type Head = {
  fromLine: number, fromColumn: number, toLine: number, toColumn: number,
  from: number, to: number, name: string | null,
};

const bindingCache = new Map<string, Map<number, Head[]> | null>();
const CACHE_LIMIT = 512;

/** A location's file as a path `fs` can open (the source map stores `file://` URLs and relative paths). */
function pathOf(filename: string): string {
  if (filename.startsWith("file://")) {
    try {
      const proc = (globalThis as any).process;
      const url = typeof proc?.getBuiltinModule === "function" ? proc.getBuiltinModule("node:url") : null;
      if (url) return url.fileURLToPath(filename) as string;
    } catch {
      // fall through
    }
  }
  return filename;
}

function scriptKind(ts: Compiler, filename: string): import("typescript").ScriptKind {
  if (filename.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filename.endsWith(".ts") || filename.endsWith(".mts") || filename.endsWith(".cts")) return ts.ScriptKind.TS;
  if (filename.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

/** The variable `call` initializes — `const x = call(…)`, `x = call(…)` — or `null`. */
function bindingOf(ts: Compiler, call: CallExpression): string | null {
  const parent = call.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === call && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isBinaryExpression(parent) && parent.right === call && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(parent.left)) {
    return parent.left.text;
  }
  return null;
}

/** Every call of a source file, by the lines its head spans. */
function indexCalls(ts: Compiler, filename: string, text: string): Map<number, Head[]> {
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, scriptKind(ts, filename));
  const index = new Map<number, Head[]>();
  const visit = (node: Node): void => {
    if (ts.isCallExpression(node)) {
      const from = node.getStart(file);
      const to = node.arguments.pos;
      const start = file.getLineAndCharacterOfPosition(from);
      const end = file.getLineAndCharacterOfPosition(to);
      const head: Head = {
        fromLine: start.line + 1, fromColumn: start.character + 1, toLine: end.line + 1, toColumn: end.character + 1,
        from, to, name: bindingOf(ts, node),
      };
      for (let line = head.fromLine; line <= head.toLine; line++) {
        const heads = index.get(line);
        if (heads === undefined) index.set(line, [head]);
        else heads.push(head);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return index;
}

/** The call index of a file, built once; `null` where the file cannot be read. */
function callsOf(ts: Compiler, filename: string): Map<number, Head[]> | null {
  const hit = bindingCache.get(filename);
  if (hit !== undefined) return hit;
  if (bindingCache.size >= CACHE_LIMIT) bindingCache.clear();
  let index: Map<number, Head[]> | null = null;
  try {
    const proc = (globalThis as any).process;
    const fs = typeof proc?.getBuiltinModule === "function" ? proc.getBuiltinModule("node:fs") : null;
    if (fs) index = indexCalls(ts, filename, fs.readFileSync(filename, "utf-8") as string);
  } catch {
    index = null;
  }
  bindingCache.set(filename, index);
  return index;
}

/**
 * The name a `$.let` / `$.const` call binds: the variable whose declaration
 * (or assignment) has that call as its initializer. Takes the first location
 * (the caller's frame; East's own frames are already filtered out) and the
 * innermost call whose head holds it, so a call inside another call's
 * arguments, or one with a further call chained onto it, is its own.
 *
 * @param frames - The call-site locations, innermost first
 * @returns The binding name, or `null` when the call binds none (a bare
 *   `$.let(...)` statement, a call inside another call's arguments, a chained
 *   `$.let(...).add(...)`, an unreadable file, no compiler)
 */
export function bindingNameAt(frames: readonly Location[]): string | null {
  const frame = frames[0];
  if (frame === undefined) return null;
  const ts = compiler();
  if (ts === null) return null;
  const index = callsOf(ts, pathOf(frame.filename));
  if (index === null) return null;
  const line = Number(frame.line);
  const column = Number(frame.column);
  let innermost: Head | null = null;
  for (const head of index.get(line) ?? []) {
    const afterStart = line > head.fromLine || column >= head.fromColumn;
    const beforeEnd = line < head.toLine || column <= head.toColumn;
    if (!afterStart || !beforeEnd) continue;
    if (innermost === null || head.from > innermost.from || (head.from === innermost.from && head.to < innermost.to)) innermost = head;
  }
  return innermost === null ? null : innermost.name;
}
