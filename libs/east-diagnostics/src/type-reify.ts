/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { TsModule } from "./types.js";
import type { EastModule } from "./east-module.js";

// East's TS-level encoding tags `{ type: "Struct", fields: … }` etc. Each tag
// maps to the companion property the encoding carries (see east's types.ts).
const PRIMITIVE_TAGS = new Set(["Never", "Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"]);

const MAX_DEPTH = 32;

class Bail extends Error {}

interface Ctx {
  readonly t: TsModule;
  readonly checker: ts.TypeChecker;
  readonly east: EastModule;
  depth: number;
  /** Self markers of `RecursiveType` scopes currently being built, innermost last. */
  readonly selves: unknown[];
  /** True once an East-specific shape (Expr, type encoding, variant/ref
   * container) was traversed — raw JS values alone don't count. */
  sawEastShape: boolean;
}

function bail(): never {
  throw new Bail();
}

function propType(ctx: Ctx, type: ts.Type, name: string): ts.Type | undefined {
  const symbol = ctx.checker.getPropertyOfType(type, name);
  if (symbol === undefined) return undefined;
  return ctx.checker.getTypeOfSymbol(symbol);
}

function literalString(type: ts.Type | undefined): string | undefined {
  return type !== undefined && type.isStringLiteral() ? type.value : undefined;
}

function typeArguments(ctx: Ctx, type: ts.Type): readonly ts.Type[] {
  const { t, checker } = ctx;
  if ((type.flags & t.TypeFlags.Object) === 0) return [];
  if (((type as ts.ObjectType).objectFlags & t.ObjectFlags.Reference) === 0) return [];
  return checker.getTypeArguments(type as ts.TypeReference);
}

// Strip `undefined`/`null`-flag members (optional properties) from a union
// before reifying — East types have no undefined.
function stripAbsent(ctx: Ctx, type: ts.Type): ts.Type[] {
  const members = type.isUnion() ? type.types : [type];
  return members.filter((m) => (m.flags & (ctx.t.TypeFlags.Undefined | ctx.t.TypeFlags.Void)) === 0);
}

function reifyUnion(ctx: Ctx, members: readonly ts.Type[]): unknown {
  const reified: unknown[] = [];
  for (const m of members) {
    try {
      reified.push(walk(ctx, m));
    } catch (e) {
      if (!(e instanceof Bail)) throw e;
      // Unreifiable member (e.g. the callback form in SubtypeExprOrValue) — skip.
    }
  }
  if (reified.length === 0) bail();
  // East constructors intern, so structurally identical members are identical.
  const distinct = [...new Set(reified)];
  // SubtypeExprOrValue unions always admit Expr<NeverType>; the bottom type is
  // never the informative member when anything else reified.
  const nonNever = distinct.filter((r) => r !== ctx.east.NeverType);
  const candidates = nonNever.length > 0 ? nonNever : distinct;
  if (candidates.length === 1) return candidates[0];
  // Several distinct members (e.g. the per-case variant forms alongside
  // Expr<VariantType<…>>): fold to the least upper bound when one exists.
  try {
    return candidates.reduce((a, b) => ctx.east.TypeUnion(a, b));
  } catch {
    bail();
  }
}

function structFromProperties(ctx: Ctx, type: ts.Type): unknown {
  const fields: Record<string, unknown> = {};
  for (const prop of ctx.checker.getPropertiesOfType(type)) {
    const name = prop.getName();
    if (name.startsWith("__@")) continue; // unique-symbol members (type ids etc.)
    fields[name] = walk(ctx, ctx.checker.getTypeOfSymbol(prop));
  }
  return ctx.east.StructType(fields);
}

function reifyEncoding(ctx: Ctx, type: ts.Type, tag: string): unknown {
  const { east, checker } = ctx;
  if (PRIMITIVE_TAGS.has(tag)) return east[`${tag}Type` as "NeverType"];
  switch (tag) {
    case "Ref": {
      const v = propType(ctx, type, "value") ?? bail();
      return east.RefType(walk(ctx, v));
    }
    case "Array": {
      const v = propType(ctx, type, "value") ?? bail();
      return east.ArrayType(walk(ctx, v));
    }
    case "Set": {
      const k = propType(ctx, type, "key") ?? bail();
      return east.SetType(walk(ctx, k));
    }
    case "Dict": {
      const k = propType(ctx, type, "key") ?? bail();
      const v = propType(ctx, type, "value") ?? bail();
      return east.DictType(walk(ctx, k), walk(ctx, v));
    }
    case "Vector": {
      const e = propType(ctx, type, "element") ?? bail();
      return east.VectorType(walk(ctx, e));
    }
    case "Matrix": {
      const e = propType(ctx, type, "element") ?? bail();
      return east.MatrixType(walk(ctx, e));
    }
    case "Struct": {
      const fieldsType = propType(ctx, type, "fields") ?? bail();
      const fields: Record<string, unknown> = {};
      for (const prop of checker.getPropertiesOfType(fieldsType)) {
        const name = prop.getName();
        if (name.startsWith("__@")) continue;
        fields[name] = reifyUnion(ctx, stripAbsent(ctx, checker.getTypeOfSymbol(prop)));
      }
      return east.StructType(fields);
    }
    case "Variant": {
      const casesType = propType(ctx, type, "cases") ?? bail();
      const cases: Record<string, unknown> = {};
      for (const prop of checker.getPropertiesOfType(casesType)) {
        const name = prop.getName();
        if (name.startsWith("__@")) continue;
        cases[name] = reifyUnion(ctx, stripAbsent(ctx, checker.getTypeOfSymbol(prop)));
      }
      return east.VariantType(cases);
    }
    case "Function":
    case "AsyncFunction": {
      const inputsType = propType(ctx, type, "inputs") ?? bail();
      if (!checker.isTupleType(inputsType)) bail();
      const inputs = typeArguments(ctx, inputsType).map((i) => walk(ctx, i));
      const output = walk(ctx, propType(ctx, type, "output") ?? bail());
      return tag === "Function" ? east.FunctionType(inputs, output) : east.AsyncFunctionType(inputs, output);
    }
    case "Recursive": {
      const node = propType(ctx, type, "node");
      // The bare marker `{ type: "Recursive" }` is a self-reference to the
      // innermost RecursiveType scope being built.
      if (node === undefined) {
        if (ctx.selves.length === 0) bail();
        return ctx.selves[ctx.selves.length - 1];
      }
      return ctx.east.RecursiveType((self) => {
        ctx.selves.push(self);
        try {
          return walk(ctx, node);
        } finally {
          ctx.selves.pop();
        }
      });
    }
    default:
      bail();
  }
}

// Plain JS values are accepted wherever SubtypeExprOrValue admits them — map
// the common ones the way east's TypeOf<> does.
function reifyRawValue(ctx: Ctx, type: ts.Type): unknown {
  const { t, east, checker } = ctx;
  const f = type.flags;
  if (f & (t.TypeFlags.BigInt | t.TypeFlags.BigIntLiteral)) return east.IntegerType;
  if (f & (t.TypeFlags.Number | t.TypeFlags.NumberLiteral)) return east.FloatType;
  if (f & (t.TypeFlags.String | t.TypeFlags.StringLiteral | t.TypeFlags.TemplateLiteral)) return east.StringType;
  if (f & (t.TypeFlags.Boolean | t.TypeFlags.BooleanLiteral)) return east.BooleanType;
  if (f & t.TypeFlags.Null) return east.NullType;
  if ((f & t.TypeFlags.Object) === 0) bail();

  const name = type.getSymbol()?.getName();
  switch (name) {
    case "Date": return east.DateTimeType;
    case "Uint8Array": return east.BlobType;
    case "Float64Array": return east.VectorType(east.FloatType);
    case "BigInt64Array": return east.VectorType(east.IntegerType);
    case "Uint8ClampedArray": return east.VectorType(east.BooleanType);
    case "Array": case "ReadonlyArray": {
      const [el] = typeArguments(ctx, type);
      if (el === undefined) bail();
      return east.ArrayType(reifyUnion(ctx, stripAbsent(ctx, el)));
    }
    case "Set": case "ReadonlySet": {
      const [el] = typeArguments(ctx, type);
      if (el === undefined) bail();
      return east.SetType(reifyUnion(ctx, stripAbsent(ctx, el)));
    }
    case "Map": case "ReadonlyMap": {
      const [k, v] = typeArguments(ctx, type);
      if (k === undefined || v === undefined) bail();
      return east.DictType(reifyUnion(ctx, stripAbsent(ctx, k)), reifyUnion(ctx, stripAbsent(ctx, v)));
    }
    default: break;
  }

  if (checker.isTupleType(type)) {
    const elements = typeArguments(ctx, type).map((e) => reifyUnion(ctx, stripAbsent(ctx, e)));
    const distinct = new Set(elements);
    if (distinct.size !== 1) bail();
    return east.ArrayType(elements[0]);
  }

  // A plain object literal is a struct value. Anything callable/indexed isn't.
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) bail();
  if (checker.getIndexInfosOfType(type).length > 0) bail();
  const props = checker.getPropertiesOfType(type);
  if (props.length === 0) bail();
  const fields: Record<string, unknown> = {};
  for (const prop of props) {
    const propName = prop.getName();
    if (propName.startsWith("__@")) continue;
    fields[propName] = reifyUnion(ctx, stripAbsent(ctx, checker.getTypeOfSymbol(prop)));
  }
  return east.StructType(fields);
}

function walk(ctx: Ctx, type: ts.Type): unknown {
  if (++ctx.depth > MAX_DEPTH) bail();
  try {
    if (type.isUnion()) return reifyUnion(ctx, stripAbsent(ctx, type));

    // Expr<T> and every subclass carry their East type as the unique-symbol
    // property [TypeSymbol] — instantiated by the checker, so reading it
    // handles IntegerExpr, StructExpr<…>, BlockBuilder lets, all of them.
    const properties = type.getProperties();
    const exprTypeProp = properties.find((p) => p.getName().startsWith("__@TypeSymbol"));
    if (exprTypeProp !== undefined) {
      ctx.sawEastShape = true;
      return walk(ctx, ctx.checker.getTypeOfSymbol(exprTypeProp));
    }

    // The branded value containers. variant must be recognised before the
    // encoding-tag check: its `type` property is the *case name*, and e.g.
    // variant("Array", …) would otherwise be misread as an ArrayType encoding.
    if (properties.some((p) => p.getName().startsWith("__@variant_symbol"))) {
      const caseName = literalString(propType(ctx, type, "type")) ?? bail();
      const payload = propType(ctx, type, "value") ?? bail();
      ctx.sawEastShape = true;
      return ctx.east.VariantType({ [caseName]: reifyUnion(ctx, stripAbsent(ctx, payload)) });
    }
    if (properties.some((p) => p.getName().startsWith("__@ref_symbol"))) {
      const v = propType(ctx, type, "value") ?? bail();
      ctx.sawEastShape = true;
      return ctx.east.RefType(reifyUnion(ctx, stripAbsent(ctx, v)));
    }

    const tag = literalString(propType(ctx, type, "type"));
    if (tag !== undefined) {
      try {
        const result = reifyEncoding(ctx, type, tag);
        ctx.sawEastShape = true;
        return result;
      } catch (e) {
        if (!(e instanceof Bail)) throw e;
        // Not actually an encoding (e.g. a struct *value* with a `type` field)
        // — fall through to the raw-value mapping.
      }
    }

    return reifyRawValue(ctx, type);
  } finally {
    ctx.depth--;
  }
}

export interface ReifiedType {
  /** The `EastType`, built with the project's own constructors. */
  type: unknown;
  /** Whether an East-specific shape was traversed; a reification built purely
   * from raw JS values (e.g. `const s: string = 1`) is not East-related and
   * must not trigger a rewrite. */
  eastShaped: boolean;
}

/**
 * Reify the TypeScript type of an East-related expression into an `EastType`
 * built with the project's own `@elaraai/east` constructors (so it is interned
 * and directly usable with `diffTypes`). Handles `Expr<T>` and subclasses (via
 * the `[TypeSymbol]` property), the `{ type: "…" }` type encodings including
 * recursive types, the raw-value forms `SubtypeExprOrValue` admits, and unions
 * of those. Returns `undefined` for anything it cannot map faithfully.
 */
export function reifyEastType(t: TsModule, checker: ts.TypeChecker, type: ts.Type, east: EastModule): ReifiedType | undefined {
  const ctx: Ctx = { t, checker, east, depth: 0, selves: [], sawEastShape: false };
  try {
    return { type: walk(ctx, type), eastShaped: ctx.sawEastShape };
  } catch (e) {
    if (e instanceof Bail) return undefined;
    // Constructor invariants (e.g. RecursiveType SCC checks) can throw on
    // shapes the checker permits — treat as unreifiable, never crash a host.
    return undefined;
  }
}
