/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { insideBlockScope } from "../block-scope.js";

const NAME = "no-compile-time-seed-data";
const CODE = 990021;

function fire(ctx: RuleContext, target: ts.Node, messageText: string): void {
  const sf = ctx.sourceFile;
  const start = target.getStart(sf);
  ctx.report({ ruleName: NAME, code: CODE, start, length: target.getEnd() - start, messageText, category: "warning" });
}

/** The `ImportDeclaration` a symbol's (local, un-aliased) declaration belongs to. */
function importDeclOfSymbol(sym: ts.Symbol | undefined, t: TsModule): ts.ImportDeclaration | undefined {
  for (const d of sym?.declarations ?? []) {
    let n: ts.Node = d;
    // ImportSpecifier -> NamedImports -> ImportClause -> ImportDeclaration; a
    // NamespaceImport sits one level higher; a DEFAULT import binds the
    // ImportClause itself (`import e3 from "@elaraai/e3"`).
    if (t.isImportSpecifier(n)) n = n.parent.parent.parent;
    else if (t.isNamespaceImport(n)) n = n.parent.parent;
    else if (t.isImportClause(n)) n = n.parent;
    else continue;
    if (t.isImportDeclaration(n)) return n;
  }
  return undefined;
}

/** Does `id` resolve to a binding imported from any `@elaraai/*` package? (Keyed by
 * SYMBOL → import specifier, like the other host-vs-East rules — never the text.) */
function resolvesToEastImport(id: ts.Identifier, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const imp = importDeclOfSymbol(ctx.checker.getSymbolAtLocation(id), t);
  return imp !== undefined && t.isStringLiteral(imp.moduleSpecifier) && imp.moduleSpecifier.text.startsWith("@elaraai/");
}

/** Is `node` a call `<e3>.input(...)` where `<e3>` is the DEFAULT import of `@elaraai/e3`? */
function isE3InputCall(node: ts.CallExpression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const callee = node.expression;
  if (!t.isPropertyAccessExpression(callee) || callee.name.text !== "input") return false;
  if (!t.isIdentifier(callee.expression)) return false;
  const imp = importDeclOfSymbol(ctx.checker.getSymbolAtLocation(callee.expression), t);
  return imp !== undefined && t.isStringLiteral(imp.moduleSpecifier) && imp.moduleSpecifier.text === "@elaraai/e3";
}

/** The root identifier a call/member chain is rooted on (`a.b.c(...)` -> `a`). */
function rootIdentifier(node: ts.Node, t: TsModule): ts.Identifier | undefined {
  let cur: ts.Node = node;
  for (;;) {
    if (t.isPropertyAccessExpression(cur) || t.isElementAccessExpression(cur)) cur = cur.expression;
    else if (t.isCallExpression(cur)) cur = cur.expression;
    else break;
  }
  return t.isIdentifier(cur) ? cur : undefined;
}

// The host constructors that REPRESENT a constant East value (per east's
// `ValueTypeOf`): `Map` (DictType), `Set` (SetType), `Date` (DateTimeType), the
// typed arrays + `ArrayBuffer` (BlobType / VectorType). Constructing one is
// authoring a constant value, not computing data — its arguments are still walked,
// so `new Map(readCsv(...))` still fires on the inner host call.
const VALUE_CTORS = new Set([
  "Map", "Set", "Date", "ArrayBuffer",
  "Uint8Array", "Int8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
]);

/**
 * Does `expr` embed HOST COMPUTATION — a call to a non-`@elaraai` function (`num`,
 * `BigInt`, `Number`, `readCsv`, a JS Array method, …), or a `new` of something
 * other than a value-representation constructor (`Map`/`Set`/`Date`) or an
 * `@elaraai` one? East value constructors (`variant`/`some`/`none`/`East.value`),
 * primitive literals, `Map`/`Set`/array/object literals, constant concatenation and
 * template labels are NOT host computation — they author a constant East value.
 */
function embedsHostComputation(expr: ts.Expression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  let bad = false;
  const visit = (n: ts.Node): void => {
    if (bad) return;
    if (t.isCallExpression(n)) {
      const root = rootIdentifier(n.expression, t);
      if (root === undefined || !resolvesToEastImport(root, ctx)) {
        bad = true;
        return;
      }
    } else if (t.isNewExpression(n)) {
      const ctor = n.expression;
      const ok = t.isIdentifier(ctor) && (VALUE_CTORS.has(ctor.text) || resolvesToEastImport(ctor, ctx));
      if (!ok) {
        bad = true;
        return;
      }
    }
    t.forEachChild(n, visit);
  };
  visit(expr);
  return bad;
}

const MUTATORS = new Set(["set", "add", "push", "unshift", "splice", "delete", "clear", "fill", "sort", "copyWithin", "pop", "shift"]);

function isAssignmentOp(kind: ts.SyntaxKind, t: TsModule): boolean {
  const k = t.SyntaxKind;
  return (
    kind === k.EqualsToken || kind === k.PlusEqualsToken || kind === k.MinusEqualsToken ||
    kind === k.AsteriskEqualsToken || kind === k.SlashEqualsToken || kind === k.PercentEqualsToken ||
    kind === k.AmpersandEqualsToken || kind === k.BarEqualsToken || kind === k.CaretEqualsToken ||
    kind === k.LessThanLessThanEqualsToken || kind === k.GreaterThanGreaterThanEqualsToken ||
    kind === k.GreaterThanGreaterThanGreaterThanEqualsToken || kind === k.AsteriskAsteriskEqualsToken ||
    kind === k.QuestionQuestionEqualsToken || kind === k.BarBarEqualsToken || kind === k.AmpersandAmpersandEqualsToken
  );
}

/** Is `node` lexically inside a host loop (`for`/`for-of`/`for-in`/`while`/`do`)? */
function insideLoop(node: ts.Node, t: TsModule): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined) {
    if (t.isForStatement(cur) || t.isForOfStatement(cur) || t.isForInStatement(cur) || t.isWhileStatement(cur) || t.isDoStatement(cur)) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

/** Is the binding `sym` HOST-FILLED anywhere in the file — mutated in place
 * (`sym.set(...)` / `.push(...)` / `sym[k] = …`) EITHER inside a host loop (the
 * Cartesian-product / CSV-overlay fill pattern) OR from a host-computed value? A
 * handful of literal `.set("a", 1n)` calls outside any loop is just an imperatively
 * authored constant and is NOT flagged. */
function isHostFilled(sym: ts.Symbol, ctx: RuleContext): boolean {
  const t = ctx.ts;
  let filled = false;
  const isSym = (n: ts.Node): boolean => t.isIdentifier(n) && ctx.checker.getSymbolAtLocation(n) === sym;
  const visit = (n: ts.Node): void => {
    if (filled) return;
    if (
      t.isCallExpression(n) &&
      t.isPropertyAccessExpression(n.expression) &&
      MUTATORS.has(n.expression.name.text) &&
      isSym(n.expression.expression)
    ) {
      if (insideLoop(n, t) || n.arguments.some((a) => embedsHostComputation(a, ctx))) {
        filled = true;
        return;
      }
    }
    if (t.isBinaryExpression(n) && isAssignmentOp(n.operatorToken.kind, t)) {
      const root = rootIdentifier(n.left, t);
      if (root !== undefined && isSym(root) && (insideLoop(n, t) || embedsHostComputation(n.right, ctx))) {
        filled = true;
        return;
      }
    }
    t.forEachChild(n, visit);
  };
  visit(ctx.sourceFile);
  return filled;
}

// `e3.input(name, type, seed?)` declares a WRITABLE dataset; the optional 3rd arg
// is only a default/genesis value, overwritten the moment anything writes to the
// dataset. It must therefore be a small AUTHORED CONSTANT — a literal, an
// empty/literal Map/Set/array/struct, or an East value (`variant`/`some`/`none`/
// `East.value`) — or omitted. Computing it from build-time data (a `new Map()`
// filled by host `for`-loops over parsed CSV, or an object literal of `num(cfg.x)`
// calls) bakes a non-portable, non-reactive snapshot into the deployed program.
// Real/bulk data belongs at RUNTIME: a `BlobType` input parsed with
// `blob.decodeCsv(...)` inside an `e3.task`, a platform `FileSystem.readFile` in a
// task, or `e3.record(...)` + `e3.mutation` for set-once root state.
export const noCompileTimeSeedData: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag host-computed data passed as the seed (3rd arg) of e3.input — the default must be a small authored constant; load real data at runtime.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node) || !isE3InputCall(node, ctx)) return;
    if (insideBlockScope(node, ctx)) return; // e3.input only legitimately appears at module scope

    const seedArg = node.arguments[2];
    if (seedArg === undefined) return; // no default — value arrives at runtime (correct)

    // Resolve an identifier seed to its initializer; keep the symbol so we can see
    // whether an authored-empty collection is then host-filled. An opaque seed
    // (imported const, parameter, no initializer) is left silent — we only judge
    // what we can see.
    let expr: ts.Expression = seedArg;
    let sym: ts.Symbol | undefined;
    if (t.isIdentifier(seedArg)) {
      sym = ctx.checker.getSymbolAtLocation(seedArg);
      const decl = sym?.valueDeclaration;
      if (decl === undefined || !t.isVariableDeclaration(decl) || decl.initializer === undefined) return;
      expr = decl.initializer;
    }
    while (t.isAsExpression(expr) || t.isSatisfiesExpression(expr) || t.isParenthesizedExpression(expr)) {
      expr = expr.expression;
    }

    const hostComputed = embedsHostComputation(expr, ctx);
    const hostFilled = sym !== undefined && isHostFilled(sym, ctx);
    if (!hostComputed && !hostFilled) return;

    const nameArg = node.arguments[0];
    const name = nameArg !== undefined && t.isStringLiteralLike(nameArg) ? nameArg.text : "…";
    const reason = hostFilled
      ? "this seed is an authored-empty collection then filled in place by host code (a `for`-loop / `.set(...)`)"
      : "this seed is assembled by host calls (`num(...)`, `BigInt(...)`, parsed config) at module-evaluation time";
    fire(
      ctx,
      seedArg,
      `Host-computed data passed as the \`e3.input("${name}", …)\` seed bakes a build-time snapshot into the deployed program — ${reason}. The default (3rd arg) must be a small AUTHORED CONSTANT (a literal, an empty/literal Map/Set/array/struct, or an East value \`variant\`/\`some\`/\`none\`/\`East.value\`) or omitted. Load real/bulk data at RUNTIME: put the bytes in a \`BlobType\` input and parse with \`blob.decodeCsv(...)\` inside an \`e3.task\`, read files in a task via a platform \`FileSystem.readFile\`, or use \`e3.record(...)\` + \`e3.mutation\` for set-once root state.`,
    );
  },
};
