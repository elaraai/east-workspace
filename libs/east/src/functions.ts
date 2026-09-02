/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Cross-language East functions (#628): export, import, link.
 *
 * A function authored in one host language is exported as pure IR — its
 * `Function` node, the declared `FunctionType`, and the platform functions
 * it calls — in a **function manifest** (`FunctionManifestType`, one beast2
 * value per package). Code in the other language refers to it with
 * `East.importFunction(package, name, type)`: a typed, callable function
 * expression whose IR is a `Platform` node named {@link IMPORT_PLATFORM}
 * carrying the package and function names — no new IR node kind, and loud
 * if it ever reaches a compiler unresolved. `linkImports` resolves every
 * such node against the manifests: the declared type must equal the
 * exported type exactly, and the exported IR is embedded as a `Let`-bound
 * constant at the top of the importing function's body (nested uses
 * capture it), so the linked program is self-contained IR that runs on any
 * runner. The python twin is `east.functions` (`East.export_functions`,
 * `East.import_function`, `East.link_imports`).
 *
 * @packageDocumentation
 */

import { ArrayType, BooleanType, NullType, OptionType, StringType, StructType, type EastType, type FunctionType, type AsyncFunctionType, type ValueTypeOf } from "./types.js";
import { EastTypeType, isTypeValueEqual, toEastTypeValue, type EastTypeValue } from "./type_of_type.js";
import { IRType, type IR, type FunctionIR, type AsyncFunctionIR, type PlatformIR, type VariableIR } from "./ir.js";
import { walkIR, literalValueOf } from "./walker.js";
import { variant, some, none } from "./containers/variant.js";
import { printTypeValue } from "./compile.js";
import { encodeBeast2For, decodeBeast2For } from "./serialization/beast2/index.js";
import { Expr } from "./expr/expr.js";
import type { CallableFunctionExpr } from "./expr/function.js";
import type { CallableAsyncFunctionExpr } from "./expr/asyncfunction.js";
import { get_location_id } from "./location.js";

/** The platform name an unresolved `East.importFunction` carries in IR. */
export const IMPORT_PLATFORM = "east.importFunction";

/**
 * One platform function an exported function calls: its name and
 * signature as the IR emits them, and — when the exporter could tell —
 * the platform package that implements it (`provider`).
 *
 * Fields are declared alphabetically in both languages so the wire layout
 * cannot depend on declaration order.
 */
export const PlatformDependencyType = StructType({
  async: BooleanType,
  inputs: ArrayType(EastTypeType),
  name: StringType,
  optional: BooleanType,
  output: EastTypeType,
  provider: OptionType(StringType),
  type_parameters: ArrayType(EastTypeType),
});

/** One exported function: its IR, declared type, and platform dependencies. */
export const FunctionExportType = StructType({
  ir: IRType,
  name: StringType,
  platforms: ArrayType(PlatformDependencyType),
  type: EastTypeType,
});

/** A package's exported functions — what `east-py export-functions` / `East.exportFunctions` write. */
export const FunctionManifestType = StructType({
  functions: ArrayType(FunctionExportType),
  package: StringType,
  version: StringType,
});

export type PlatformDependency = ValueTypeOf<typeof PlatformDependencyType>;
export type FunctionExport = ValueTypeOf<typeof FunctionExportType>;
export type FunctionManifest = ValueTypeOf<typeof FunctionManifestType>;

/** An import `linkImports` resolved: where it came from and what it needs. */
export interface LinkedImport {
  /** The exporting package (the manifest's `package`). */
  package: string;
  /** The function's name in that package. */
  name: string;
  /** Its type (the declared type, equal to the exported one). */
  type: EastTypeValue;
  /** The platform functions the embedded IR calls. */
  platforms: PlatformDependency[];
}

/** The result of {@link linkImports}. */
export interface Linked {
  /** The IR with every import embedded. */
  ir: IR;
  /** The imports that were resolved, in first-use order. */
  imports: LinkedImport[];
}

// ── the IR behind a function ────────────────────────────────────────────────

/**
 * The IR value behind an `East.function` result, an `EastIR` bundle, or an
 * IR value: what every function-level API here takes.
 *
 * @param fnOrIr - A built function expression, its `toIR()`, or an IR node
 * @returns The IR node
 * @throws {TypeError} For anything else
 */
export function functionIR(fnOrIr: unknown): IR {
  if (fnOrIr instanceof Expr) {
    const toIR = (fnOrIr as any).toIR;
    if (typeof toIR !== "function") throw new TypeError("expected a function expression, not a plain expression");
    return toIR.call(fnOrIr).ir as IR;
  }
  const v = fnOrIr as any;
  if (v !== null && typeof v === "object" && v.ir !== undefined && typeof v.ir.type === "string") {
    return v.ir as IR; // an EastIR / AsyncEastIR
  }
  if (v !== null && typeof v === "object" && typeof v.type === "string" && "value" in v) {
    return v as IR;
  }
  throw new TypeError("expected an East.function result, an EastIR, or an IR value");
}

/**
 * The `Function` / `AsyncFunction` node of a function's IR: the root, or the
 * last statement of the `Block[Let…, Function]` a python build with hoisted
 * constants emits.
 */
function rootFunction(ir: IR, what: string): FunctionIR | AsyncFunctionIR {
  let root: IR = ir;
  if (root.type === "Block") {
    const statements = root.value.statements as IR[];
    root = statements[statements.length - 1]!;
  }
  if (root.type !== "Function" && root.type !== "AsyncFunction") {
    throw new Error(`${what}: expected a function's IR, got a ${ir.type} node`);
  }
  return root as FunctionIR | AsyncFunctionIR;
}

// ── platform dependencies ───────────────────────────────────────────────────

/**
 * The platform functions an IR calls, in first-use order — the name,
 * signature and asyncness each `Platform` node carries. Unresolved imports
 * ({@link IMPORT_PLATFORM}) are not dependencies and are skipped.
 *
 * @param fnOrIr - A function expression, its `toIR()`, or an IR value
 * @param providers - Platform name → the package that implements it, when known
 * @returns The dependencies
 */
export function platformDependencies(fnOrIr: unknown, providers: Record<string, string> = {}): PlatformDependency[] {
  const ir = functionIR(fnOrIr);
  const seen = new Map<string, PlatformDependency>();
  walkIR(ir, node => {
    if (node.type !== "Platform") return;
    const p = (node as PlatformIR).value;
    if (p.name === IMPORT_PLATFORM || seen.has(p.name)) return;
    const provider = Object.prototype.hasOwnProperty.call(providers, p.name) ? some(providers[p.name]!) : none;
    seen.set(p.name, {
      async: p.async,
      inputs: (p.arguments as IR[]).map(a => a.value.type as EastTypeValue),
      name: p.name,
      optional: p.optional,
      output: p.type,
      provider,
      type_parameters: [...p.type_parameters],
    });
  });
  return [...seen.values()];
}

// ── export ──────────────────────────────────────────────────────────────────

/** Options for {@link exportFunctions}. */
export interface ExportFunctionsOptions {
  /** Platform name → the package that implements it (recorded per dependency). */
  providers?: Record<string, string>;
}

/**
 * Builds a package's function manifest from its named functions.
 *
 * Every function exports as a closed value: a function with captures (a
 * closure over the enclosing body) is rejected, as is one that itself holds
 * an unresolved import — link before exporting; v1 does not chain. The
 * exported IR carries no location ids (a manifest has no source map).
 *
 * @param pkg - The exporting package's name (what importers name)
 * @param version - Its version
 * @param functions - Name → `East.function` result, `EastIR`, or IR value
 * @param options - Platform providers to record
 * @returns The manifest value (encode it with {@link encodeFunctionManifest})
 * @throws {Error} For a function that is not a closed value
 *
 * @example
 * ```ts
 * const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
 * const manifest = East.exportFunctions("maths", "1.0.0", { double });
 * writeFileSync("maths.functions.beast2", East.encodeFunctionManifest(manifest));
 * ```
 */
export function exportFunctions(pkg: string, version: string, functions: Record<string, unknown>, options: ExportFunctionsOptions = {}): FunctionManifest {
  if (!pkg) throw new Error("exportFunctions: the package name is empty");
  const exports: FunctionExport[] = [];
  for (const name of Object.keys(functions).sort()) {
    const ir = functionIR(functions[name]);
    const root = rootFunction(ir, `exportFunctions: ${name}`);
    const captures = (root.value.captures as VariableIR[]).map(v => v.value.name);
    if (captures.length > 0) {
      throw new Error(
        `exportFunctions: ${name} captures ${captures.join(", ")} — an exported function is a closed value; ` +
        `only functions with no captures export`);
    }
    let imports = 0;
    walkIR(ir, node => { if (node.type === "Platform" && node.value.name === IMPORT_PLATFORM) imports += 1; });
    if (imports > 0) {
      throw new Error(`exportFunctions: ${name} holds ${imports} unresolved import(s) — link it (linkImports) before exporting; exports do not chain`);
    }
    exports.push({
      ir: stripLocations(ir),
      name,
      platforms: platformDependencies(ir, options.providers ?? {}),
      type: root.value.type,
    });
  }
  return { functions: exports, package: pkg, version };
}

/**
 * The IR with every `loc_id` zeroed. A manifest carries no source map, so
 * the exporter's location ids would only collide with the importer's; an
 * embedded function reports no location instead.
 */
function stripLocations(ir: IR): IR {
  const stripped = mapChildren(ir, stripLocations);
  return variant(stripped.type, { ...stripped.value, loc_id: 0n }) as IR;
}

const manifestEncoder = encodeBeast2For(FunctionManifestType);
const manifestDecoder = decodeBeast2For(FunctionManifestType);

/**
 * Encodes a function manifest as beast2 — the file `east-node
 * export-functions` / `east-py export-functions` write and `e3 export` /
 * `linkImports` read, in either language.
 */
export function encodeFunctionManifest(manifest: FunctionManifest): Uint8Array {
  return manifestEncoder(manifest);
}

/** Decodes a function manifest written by either language. */
export function decodeFunctionManifest(data: Uint8Array): FunctionManifest {
  return manifestDecoder(data);
}

// ── import ──────────────────────────────────────────────────────────────────

/**
 * Refers to a function exported by another package (in either language) as a
 * typed, callable function expression.
 *
 * Unresolved, the reference is a `Platform` node named
 * {@link IMPORT_PLATFORM} whose arguments are the package and function
 * names: compiling it without linking fails naming that platform.
 * `linkImports` — which `e3 export` runs on every task — replaces it with
 * the exported IR, checked for exact type equality with `type`.
 *
 * @param pkg - The exporting package's name (the manifest's `package`)
 * @param name - The function's name in that package
 * @param type - The function's declared type, checked exactly at link
 * @returns A callable function expression of `type`
 * @throws {TypeError} When `type` is not a function type
 *
 * @example
 * ```ts
 * const score = East.importFunction("pricing", "score", FunctionType([RowType], FloatType));
 * const total = East.function([ArrayType(RowType)], FloatType, ($, rows) =>
 *   rows.map(($, r) => score(r)).sum());
 * ```
 */
export function importFunction<I extends EastType[], O extends EastType>(pkg: string, name: string, type: FunctionType<I, O>): CallableFunctionExpr<I, O>;
export function importFunction<I extends EastType[], O extends EastType>(pkg: string, name: string, type: AsyncFunctionType<I, O>): CallableAsyncFunctionExpr<I, O>;
export function importFunction(pkg: string, name: string, type: EastType): unknown {
  if (type.type !== "Function" && type.type !== "AsyncFunction") {
    throw new TypeError(`importFunction: ${pkg}.${name} needs a FunctionType or AsyncFunctionType, got ${type.type}`);
  }
  if (!pkg || !name) throw new TypeError("importFunction: the package and function names are required");
  const literal = (s: string) => ({ ast_type: "Value" as const, type: StringType, loc_id: get_location_id(), value: s });
  return Expr.fromAst({
    ast_type: "Platform",
    type,
    loc_id: get_location_id(),
    name: IMPORT_PLATFORM,
    type_parameters: [],
    arguments: [literal(pkg), literal(name)],
    async: false,
    optional: false,
  } as any);
}

/** The (package, name) an import node names — both must be string literals. */
function importTarget(node: PlatformIR): { pkg: string; name: string } {
  const args = node.value.arguments as IR[];
  if (args.length !== 2 || args[0]!.type !== "Value" || args[1]!.type !== "Value") {
    throw new Error(`${IMPORT_PLATFORM}: the package and function names must be string literals`);
  }
  return { pkg: String(literalValueOf(args[0] as any)), name: String(literalValueOf(args[1] as any)) };
}

// ── link ────────────────────────────────────────────────────────────────────

/**
 * Resolves every `East.importFunction` reference in a function's IR against
 * the given manifests and embeds the exported IR.
 *
 * For each distinct (package, function): the manifest for the package must
 * be present, the function must be in it, and the reference's declared type
 * must equal the exported type exactly — each failure is an error naming the
 * import (and, for a type mismatch, both types). The exported IR becomes a
 * `Let`-bound constant at the top of the importing function's body; a use
 * inside a nested function captures it, so the nested functions' `captures`
 * are extended. The result is self-contained IR with no import left.
 *
 * @param fnOrIr - A function expression, its `toIR()`, or an IR value
 * @param manifests - The exporting packages' manifests
 * @returns The linked IR and the imports it resolved (with their platform dependencies)
 * @throws {Error} For an unresolvable import or a type mismatch
 */
export function linkImports(fnOrIr: unknown, manifests: FunctionManifest[]): Linked {
  const ir = functionIR(fnOrIr);
  const byPackage = new Map<string, FunctionManifest>();
  for (const m of manifests) byPackage.set(m.package, m);

  // Which imports the IR holds, and whether any use sits inside a nested
  // function (the binding is then captured).
  const targets = new Map<string, { pkg: string; name: string; type: EastTypeValue; nested: boolean }>();
  const keyOf = (pkg: string, name: string) => `${pkg} ${name}`;
  const scan = (node: IR, depth: number): void => {
    if (node.type === "Platform" && node.value.name === IMPORT_PLATFORM) {
      const { pkg, name } = importTarget(node as PlatformIR);
      const key = keyOf(pkg, name);
      const hit = targets.get(key);
      if (hit === undefined) {
        targets.set(key, { pkg, name, type: node.value.type, nested: depth > 0 });
      } else {
        if (!isTypeValueEqual(hit.type, node.value.type)) {
          throw new Error(
            `linkImports: ${pkg}.${name} is imported at two types — ${printTypeValue(hit.type)} and ${printTypeValue(node.value.type)}`);
        }
        hit.nested = hit.nested || depth > 0;
      }
      return;
    }
    const nested = node.type === "Function" || node.type === "AsyncFunction";
    for (const child of children(node)) scan(child, nested ? depth + 1 : depth);
  };
  const root = rootFunction(ir, "linkImports");
  scan(root.value.body, 0);
  if (targets.size === 0) return { ir, imports: [] };

  // Resolve each against its manifest: present, named, and typed exactly.
  const bindings = new Map<string, { variable: VariableIR; export: FunctionExport }>();
  const imports: LinkedImport[] = [];
  let index = 0;
  for (const [key, target] of targets) {
    const manifest = byPackage.get(target.pkg);
    if (manifest === undefined) {
      throw new Error(
        `linkImports: no function manifest for package "${target.pkg}" (imported ${target.pkg}.${target.name}) — ` +
        `export it (east-py export-functions / East.exportFunctions) and pass the manifest to the linker`);
    }
    const exported = manifest.functions.find(f => f.name === target.name);
    if (exported === undefined) {
      const names = manifest.functions.map(f => f.name).join(", ") || "(none)";
      throw new Error(`linkImports: package "${target.pkg}" exports no function "${target.name}" — it exports ${names}`);
    }
    if (!isTypeValueEqual(target.type, exported.type)) {
      throw new Error(
        `linkImports: ${target.pkg}.${target.name} is imported as ${printTypeValue(target.type)} ` +
        `but exported as ${printTypeValue(exported.type)}`);
    }
    const variable: VariableIR = variant("Variable", {
      type: target.type,
      name: `_import${index}_${identifier(target.pkg)}_${identifier(target.name)}`,
      loc_id: 0n,
      mutable: false,
      captured: target.nested,
    });
    index += 1;
    bindings.set(key, { variable, export: exported });
    imports.push({ package: target.pkg, name: target.name, type: target.type, platforms: [...exported.platforms] });
  }
  const byVariable = new Map<string, VariableIR>();
  for (const b of bindings.values()) byVariable.set(b.variable.value.name, b.variable);

  // Rewrite: references in place, captures on every enclosing nested function.
  const rebuild = (node: IR, captureStack: Set<string>[]): IR => {
    if (node.type === "Platform" && node.value.name === IMPORT_PLATFORM) {
      const { pkg, name } = importTarget(node as PlatformIR);
      const binding = bindings.get(keyOf(pkg, name))!;
      for (const set of captureStack) set.add(binding.variable.value.name);
      return variant("Variable", { ...binding.variable.value, loc_id: node.value.loc_id }) as IR;
    }
    if (node.type === "Function" || node.type === "AsyncFunction") {
      const mine = new Set<string>();
      const body = rebuild(node.value.body, [...captureStack, mine]);
      const extra = [...mine].map(n => byVariable.get(n)!);
      return variant(node.type, { ...node.value, body, captures: [...(node.value.captures as VariableIR[]), ...extra] }) as IR;
    }
    return mapChildren(node, child => rebuild(child, captureStack));
  };
  const body = rebuild(root.value.body, []);
  const lets: IR[] = [...bindings.values()].map(b => variant("Let", {
    type: toEastTypeValue(NullType),
    loc_id: 0n,
    variable: b.variable,
    value: b.export.ir,
  }) as IR);
  const statements = body.type === "Block" ? [...lets, ...(body.value.statements as IR[])] : [...lets, body];
  const linkedBody: IR = variant("Block", {
    type: (statements[statements.length - 1]!).value.type,
    loc_id: body.value.loc_id,
    statements,
  }) as IR;
  const linkedRoot = variant(root.type, { ...root.value, body: linkedBody }) as IR;
  let linked: IR = linkedRoot;
  if (ir.type === "Block") {
    const outer = ir.value.statements as IR[];
    linked = variant("Block", { ...ir.value, statements: [...outer.slice(0, -1), linkedRoot] }) as IR;
  }
  return { ir: linked, imports };
}

/** A name as an identifier fragment. */
function identifier(name: string): string {
  return name.replace(/[^A-Za-z0-9_]+/g, "_");
}

// ── IR children ─────────────────────────────────────────────────────────────

/** The child IR nodes of a node, in the walker's order. */
function children(node: IR): IR[] {
  const out: IR[] = [];
  mapChildren(node, child => { out.push(child); return child; });
  return out;
}

/**
 * A node with its child IR nodes replaced by `f(child)` — the walker's
 * cases as a rebuild. Leaves come back as they are.
 */
function mapChildren(node: IR, f: (child: IR) => IR): IR {
  const v: any = node.value;
  const re = (payload: Record<string, unknown>): IR => variant(node.type, { ...v, ...payload }) as IR;
  switch (node.type) {
    case "Variable": case "Continue": case "Break": case "Value":
      return node;
    case "Error":
      return re({ message: f(v.message) });
    case "TryCatch":
      return re({ try_body: f(v.try_body), catch_body: f(v.catch_body), finally_body: f(v.finally_body) });
    case "Let": case "Assign": case "As": case "NewRef": case "Variant": case "UnwrapRecursive": case "WrapRecursive": case "Return":
      return re({ value: f(v.value) });
    case "Function": case "AsyncFunction":
      return re({ body: f(v.body) });
    case "Call": case "CallAsync":
      return re({ function: f(v.function), arguments: (v.arguments as IR[]).map(f) });
    case "NewArray": case "NewSet": case "NewVector": case "NewMatrix":
      return re({ values: (v.values as IR[]).map(f) });
    case "NewDict":
      return re({ values: (v.values as { key: IR; value: IR }[]).map(e => ({ key: f(e.key), value: f(e.value) })) });
    case "Struct":
      return re({ fields: (v.fields as { name: string; value: IR }[]).map(x => ({ name: x.name, value: f(x.value) })) });
    case "GetField":
      return re({ struct: f(v.struct) });
    case "Block":
      return re({ statements: (v.statements as IR[]).map(f) });
    case "IfElse":
      return re({
        ifs: (v.ifs as { predicate: IR; body: IR }[]).map(b => ({ predicate: f(b.predicate), body: f(b.body) })),
        else_body: f(v.else_body),
      });
    case "Match":
      return re({ variant: f(v.variant), cases: (v.cases as any[]).map(c => ({ ...c, body: f(c.body) })) });
    case "While":
      return re({ predicate: f(v.predicate), body: f(v.body) });
    case "ForArray":
      return re({ array: f(v.array), body: f(v.body) });
    case "ForSet":
      return re({ set: f(v.set), body: f(v.body) });
    case "ForDict":
      return re({ dict: f(v.dict), body: f(v.body) });
    case "Builtin": case "Platform":
      return re({ arguments: (v.arguments as IR[]).map(f) });
    default:
      throw new Error(`mapChildren: unknown IR node kind ${(node as IR).type}`);
  }
}
