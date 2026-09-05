/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
  ArrayType,
  BlobType,
  BooleanType,
  DateTimeType,
  DictType,
  FloatType,
  IntegerType,
  MatrixType,
  NullType,
  RecursiveType,
  RefType,
  SetType,
  StringType,
  StructType,
  VariantType,
  VectorType,
  type EastType,
  type RecursiveTypeMarker,
} from "../types.js";
import type { JsonSchema, JsonSchemaValue } from "./json_schema.js";

/**
 * Raised when a schema cannot be expressed as an East type.
 *
 * @remarks
 * Carries the RFC 6901 pointer to the offending node, because a contract
 * document is large and "unsupported keyword" without a location is not
 * actionable.
 */
export class JsonSchemaUnsupportedError extends Error {
  /** RFC 6901 pointer to the schema node that could not be converted. */
  readonly pointer: string;

  constructor(message: string, pointer: string) {
    super(pointer === "" ? message : `${message} (at ${pointer})`);
    this.name = "JsonSchemaUnsupportedError";
    this.pointer = pointer;
  }
}

/** Keywords East's type system has no counterpart for, and why. */
const UNSUPPORTED: Record<string, string> = {
  allOf: "East types have no intersection; rewrite it as one object schema",
  not: "East types have no negation",
  if: "East types have no conditionals",
  then: "East types have no conditionals",
  else: "East types have no conditionals",
  anyOf: "East variants are discriminated; use oneOf with a constant tag per case",
  patternProperties: "East has no pattern-keyed record; use a Dict encoding",
  dependentSchemas: "East types have no conditionals",
  dependentRequired: "East structs require every field",
  propertyNames: "East has no constraint on property names",
  unevaluatedProperties: "East structs are closed; use additionalProperties: false",
  unevaluatedItems: "East arrays are homogeneous",
  prefixItems: "East has no tuple type; use a Struct",
  additionalItems: "East has no tuple type; use a Struct",
  contains: "East has no containment constraint",
};

/** RFC 6901 pointer from a path of already-escaped-free segments. */
function pointerOf(path: string[]): string {
  if (path.length === 0) return "";
  return "/" + path.map(s => s.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}

function fail(message: string, path: string[]): never {
  throw new JsonSchemaUnsupportedError(message, pointerOf(path));
}

function asSchema(v: JsonSchemaValue | undefined, path: string[], what: string): JsonSchema {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    fail(`expected ${what} to be a schema object`, path);
  }
  return v as JsonSchema;
}

/** Where a document keeps its definitions, whichever release wrote it. */
function definitionsOf(root: JsonSchema): { defs: Record<string, JsonSchema>; keyword: string } {
  const modern = root["$defs"];
  if (modern !== undefined && typeof modern === "object" && modern !== null && !Array.isArray(modern)) {
    return { defs: modern as Record<string, JsonSchema>, keyword: "$defs" };
  }
  const legacy = root["definitions"];
  if (legacy !== undefined && typeof legacy === "object" && legacy !== null && !Array.isArray(legacy)) {
    return { defs: legacy as Record<string, JsonSchema>, keyword: "definitions" };
  }
  return { defs: {}, keyword: "$defs" };
}

/** The definition name a local `$ref` points at, or null when it is not local. */
function refTarget(ref: string, keyword: string): string | null {
  const prefix = `#/${keyword}/`;
  if (!ref.startsWith(prefix)) return null;
  return ref.slice(prefix.length).replace(/~1/g, "/").replace(/~0/g, "~");
}

interface Context {
  defsKeyword: string;
  defs: Record<string, JsonSchema>;
  /** Definitions that reference themselves, so must become a RecursiveType. */
  cyclic: Set<string>;
  /** Self markers for definitions currently under construction. */
  building: Map<string, RecursiveTypeMarker>;
  /** Completed non-cyclic definitions, so a shared def is built once. */
  done: Map<string, EastType>;
}

/**
 * Builds an East type from a JSON Schema document.
 *
 * @param schema - The schema document
 * @returns The East type the schema describes
 * @throws {JsonSchemaUnsupportedError} When the schema uses a keyword East's
 * type system cannot express, naming the keyword and its RFC 6901 pointer
 *
 * @remarks
 * This is the one place the full JSON Schema vocabulary is confronted, and it
 * runs at build time, so nothing it rejects can reach a runtime.
 *
 * A document emitted by {@link jsonSchemaFor} carries `x-east-type`
 * annotations and inverts exactly — JSON Schema alone cannot tell `DateTime`
 * from a `String` with `format: date-time`, `Set` from `Array`, or `Dict`
 * from an array of two-property objects. A foreign document without those
 * annotations still converts, under the structural mapping below, but does
 * not promise to round-trip:
 *
 * | schema | East type |
 * |---|---|
 * | `{"type":"null"}`, or OpenAPI 3.0's `nullable` + `enum: [null]` | `Null` |
 * | `{"type":"boolean"}` | `Boolean` |
 * | `{"type":"string"}` | `String` |
 * | `{"type":"number"}`, `{"type":"integer"}` | `Float`, `Integer` |
 * | `{"type":"array","items":X}` | `Array<X>` |
 * | a closed object with `required` covering every property | `Struct` |
 * | `oneOf` of objects tagged by a constant `type` | `Variant` |
 *
 * Definitions are resolved through `$defs` or `definitions`, whichever the
 * document uses. A self-referential definition becomes a `RecursiveType`;
 * mutually recursive definitions are refused, because East supports only
 * self-recursion.
 *
 * @example
 * ```ts
 * const T = typeFromJsonSchema(JSON.parse(readFileSync("contract.schema.json", "utf-8")));
 * ```
 */
export function typeFromJsonSchema(schema: JsonSchema): EastType {
  const { defs, keyword } = definitionsOf(schema);
  const ctx: Context = {
    defsKeyword: keyword,
    defs,
    cyclic: findSelfReferential(defs, keyword),
    building: new Map(),
    done: new Map(),
  };
  return build(schema, ctx, []);
}

/**
 * Definition names that reach themselves.
 *
 * @throws {JsonSchemaUnsupportedError} On a cycle spanning more than one
 * definition — East supports self-recursion only.
 */
function findSelfReferential(defs: Record<string, JsonSchema>, keyword: string): Set<string> {
  const edges = new Map<string, Set<string>>();
  for (const [name, def] of Object.entries(defs)) {
    const seen = new Set<string>();
    collectRefs(def, keyword, seen);
    edges.set(name, seen);
  }

  const selfReferential = new Set<string>();
  for (const name of edges.keys()) {
    // Reachability from `name` back to `name`.
    const stack = [...(edges.get(name) ?? [])];
    const visited = new Set<string>();
    const route: string[] = [];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (next === name) { selfReferential.add(name); break; }
      if (visited.has(next)) continue;
      visited.add(next);
      route.push(next);
      for (const onward of edges.get(next) ?? []) stack.push(onward);
    }
    // A definition that reaches itself only by way of another definition is a
    // cycle East cannot represent.
    if (selfReferential.has(name)) {
      for (const via of route) {
        if ((edges.get(via) ?? new Set()).has(name)) {
          throw new JsonSchemaUnsupportedError(
            `definitions "${name}" and "${via}" are mutually recursive; East supports self-recursion only`,
            `/${keyword}/${name}`);
        }
      }
    }
  }
  return selfReferential;
}

/** Every local definition name referenced anywhere inside a schema node. */
function collectRefs(node: JsonSchemaValue, keyword: string, out: Set<string>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, keyword, out);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") {
      const target = refTarget(value, keyword);
      if (target !== null) out.add(target);
      continue;
    }
    collectRefs(value, keyword, out);
  }
}

function build(node: JsonSchema, ctx: Context, path: string[]): EastType {
  for (const [keyword, reason] of Object.entries(UNSUPPORTED)) {
    if (node[keyword] !== undefined) {
      fail(`typeFromJsonSchema cannot express "${keyword}" — ${reason}`, [...path, keyword]);
    }
  }

  const ref = node["$ref"];
  if (typeof ref === "string") return buildRef(ref, ctx, [...path, "$ref"]);

  // An annotated document says outright what it came from.
  const annotation = node["x-east-type"];
  if (typeof annotation === "string") return buildAnnotated(annotation, node, ctx, path);

  if (node["oneOf"] !== undefined) return buildVariant(node, ctx, path);

  const type = node["type"];

  // OpenAPI 3.0 has no "null" type and spells it with `nullable`.
  if (type === undefined && node["nullable"] === true) return NullType;

  if (Array.isArray(type)) {
    fail(
      `typeFromJsonSchema cannot express a union of primitive types [${type.join(", ")}] — ` +
      "East unions are discriminated variants", [...path, "type"]);
  }

  switch (type) {
    case "null": return NullType;
    case "boolean": return BooleanType;
    case "string": return StringType;
    case "number": return FloatType;
    case "integer": return IntegerType;
    case "array": return ArrayType(buildItems(node, ctx, path));
    case "object": return buildStruct(node, ctx, path);
    case undefined:
      fail(
        "typeFromJsonSchema needs a \"type\" (or a $ref, oneOf, or x-east-type annotation) — " +
        "an unconstrained schema has no East type", path);
      break;
    default:
      fail(`typeFromJsonSchema does not recognise the type "${String(type)}"`, [...path, "type"]);
  }
}

function buildRef(ref: string, ctx: Context, path: string[]): EastType {
  const name = refTarget(ref, ctx.defsKeyword);
  if (name === null) {
    fail(
      `typeFromJsonSchema cannot resolve "${ref}" — only local #/${ctx.defsKeyword}/… references are supported`,
      path);
  }
  const marker = ctx.building.get(name);
  if (marker !== undefined) return marker as unknown as EastType;

  const cached = ctx.done.get(name);
  if (cached !== undefined) return cached;

  const def = ctx.defs[name];
  if (def === undefined) {
    fail(`typeFromJsonSchema cannot resolve "${ref}" — no such definition`, path);
  }

  const defPath = [ctx.defsKeyword, name];
  if (ctx.cyclic.has(name)) {
    const built = RecursiveType(self => {
      ctx.building.set(name, self);
      try {
        return build(def, ctx, defPath);
      } finally {
        ctx.building.delete(name);
      }
    }) as EastType;
    ctx.done.set(name, built);
    return built;
  }

  const built = build(def, ctx, defPath);
  ctx.done.set(name, built);
  return built;
}

function buildItems(node: JsonSchema, ctx: Context, path: string[]): EastType {
  const items = node["items"];
  if (items === undefined) {
    fail("typeFromJsonSchema needs \"items\" on an array — East arrays are homogeneous", path);
  }
  return build(asSchema(items, [...path, "items"], "items"), ctx, [...path, "items"]);
}

function buildStruct(node: JsonSchema, ctx: Context, path: string[]): EastType {
  const additional = node["additionalProperties"];
  if (additional !== false) {
    fail(
      "typeFromJsonSchema needs \"additionalProperties\": false on an object — " +
      "East structs are closed, so an open record has no East type", path);
  }

  const properties = node["properties"];
  if (properties === undefined) {
    fail("typeFromJsonSchema needs \"properties\" on an object", path);
  }
  const props = asSchema(properties, [...path, "properties"], "properties");

  const required = node["required"];
  const requiredNames = new Set<string>(
    Array.isArray(required) ? required.filter((r): r is string => typeof r === "string") : []);

  const fields: Record<string, EastType> = {};
  for (const [name, value] of Object.entries(props)) {
    if (!requiredNames.has(name)) {
      fail(
        `typeFromJsonSchema needs every property required — "${name}" is optional, and East ` +
        "structs have no absent field; model it as an Option",
        [...path, "properties", name]);
    }
    fields[name] = build(
      asSchema(value, [...path, "properties", name], `property "${name}"`),
      ctx, [...path, "properties", name]);
  }
  return StructType(fields);
}

/** The constant tag an alternative pins, or null when it pins none. */
function tagOf(alternative: JsonSchema): string | null {
  const properties = alternative["properties"];
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return null;
  const tag = (properties as JsonSchema)["type"];
  if (tag === null || typeof tag !== "object" || Array.isArray(tag)) return null;
  const constant = (tag as JsonSchema)["const"];
  if (typeof constant === "string") return constant;
  // draft-04 (and so OpenAPI 3.0) has no `const`; a single-valued enum is the
  // same assertion.
  const choices = (tag as JsonSchema)["enum"];
  if (Array.isArray(choices) && choices.length === 1 && typeof choices[0] === "string") {
    return choices[0];
  }
  return null;
}

function buildVariant(node: JsonSchema, ctx: Context, path: string[]): EastType {
  const alternatives = node["oneOf"];
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    fail("typeFromJsonSchema needs a non-empty \"oneOf\"", [...path, "oneOf"]);
  }

  const cases: Record<string, EastType> = {};
  for (let i = 0; i < alternatives.length; i++) {
    const altPath = [...path, "oneOf", String(i)];
    const alternative = asSchema(alternatives[i], altPath, `oneOf[${i}]`);
    const tag = tagOf(alternative);
    if (tag === null) {
      fail(
        "typeFromJsonSchema needs each oneOf alternative to pin a constant \"type\" tag — " +
        "an untagged union is not an East variant", altPath);
    }
    const properties = asSchema(alternative["properties"], [...altPath, "properties"], "properties");
    const payload = properties["value"];
    if (payload === undefined) {
      fail("typeFromJsonSchema needs a \"value\" property on each variant case", [...altPath, "properties"]);
    }
    if (cases[tag] !== undefined) {
      fail(`typeFromJsonSchema found the variant case "${tag}" twice`, altPath);
    }
    cases[tag] = build(
      asSchema(payload, [...altPath, "properties", "value"], "value"),
      ctx, [...altPath, "properties", "value"]);
  }
  return VariantType(cases);
}

function buildAnnotated(annotation: string, node: JsonSchema, ctx: Context, path: string[]): EastType {
  switch (annotation) {
    case "Integer": return IntegerType;
    case "Float": return FloatType;
    case "DateTime": return DateTimeType;
    case "Blob": return BlobType;
    case "Set": return SetType(buildItems(node, ctx, path));
    case "Vector": return VectorType(buildItems(node, ctx, path));
    case "Matrix": {
      const rows = asSchema(node["items"], [...path, "items"], "items");
      return MatrixType(buildItems(rows, ctx, [...path, "items"]));
    }
    case "Dict": {
      const entry = asSchema(node["items"], [...path, "items"], "items");
      const entryPath = [...path, "items"];
      const properties = asSchema(entry["properties"], [...entryPath, "properties"], "properties");
      const key = properties["key"];
      const value = properties["value"];
      if (key === undefined || value === undefined) {
        fail("typeFromJsonSchema needs \"key\" and \"value\" on a Dict entry", [...entryPath, "properties"]);
      }
      return DictType(
        build(asSchema(key, [...entryPath, "properties", "key"], "key"), ctx, [...entryPath, "properties", "key"]),
        build(asSchema(value, [...entryPath, "properties", "value"], "value"), ctx, [...entryPath, "properties", "value"]));
    }
    case "Ref": {
      const alternatives = node["oneOf"];
      if (!Array.isArray(alternatives) || alternatives.length === 0) {
        fail("typeFromJsonSchema needs \"oneOf\" on a Ref", [...path, "oneOf"]);
      }
      const inner = asSchema(alternatives[0], [...path, "oneOf", "0"], "oneOf[0]");
      return RefType(buildItems(inner, ctx, [...path, "oneOf", "0"]));
    }
    default:
      fail(`typeFromJsonSchema does not recognise the x-east-type "${annotation}"`, [...path, "x-east-type"]);
  }
}
