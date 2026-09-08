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
  OptionType,
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
import type { JsonSchema, JsonSchemaDraft, JsonSchemaValue } from "./json_schema.js";

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

/** Whether a document object carries `key` itself — `in` would also find `Object.prototype`'s. */
function has(node: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(node, key);
}

/**
 * A schema scalar as a message spells it — JSON's `null`, `true` and `false`,
 * anything else as itself — so the two language twins word a refusal the same.
 */
function spell(value: JsonSchemaValue | undefined): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  return String(value);
}

/** The `$schema` values this converter recognises, normalised, and the release each names. */
const SCHEMA_URI_DRAFTS: Record<string, JsonSchemaDraft> = {
  "https://json-schema.org/draft/2020-12/schema": "2020-12",
  "https://json-schema.org/draft-07/schema": "draft-07",
};

/**
 * The release a document declares.
 *
 * @throws {JsonSchemaUnsupportedError} On a release this converter cannot read
 *
 * @remarks
 * A document that declares a release is taken at its word, so one written for
 * draft-04 (or a release later than these) is refused by name rather than
 * structurally guessed at and quietly mis-read. The scheme and a trailing `#`
 * carry no meaning in a `$schema` value, so both are normalised away.
 */
function draftOfSchemaUri(uri: string, path: string[]): JsonSchemaDraft {
  const key = uri.replace(/#$/, "").replace(/^http:/, "https:");
  const draft = SCHEMA_URI_DRAFTS[key];
  if (draft === undefined) {
    fail(
      `typeFromJsonSchema cannot read the JSON Schema release "${uri}" — it reads 2020-12, ` +
      "draft-07, and OpenAPI 3.0 schema objects, which carry no $schema of their own", path);
  }
  return draft;
}

/**
 * Where a document keeps its definitions.
 *
 * @remarks
 * The declared release says which keyword to expect, but a document that
 * declares one and uses the other still resolves: only the prefix its `$ref`s
 * are written against actually matters, and that is read back from whichever
 * keyword is present.
 */
function definitionsOf(
  root: JsonSchema,
  draft: JsonSchemaDraft | undefined,
): { defs: Record<string, JsonSchema>; keyword: string } {
  const asDefs = (v: JsonSchemaValue | undefined): Record<string, JsonSchema> | null =>
    v !== undefined && typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, JsonSchema>)
      : null;

  const order: string[] = draft === "draft-07" ? ["definitions", "$defs"] : ["$defs", "definitions"];
  for (const keyword of order) {
    const defs = asDefs(root[keyword]);
    if (defs !== null) return { defs, keyword };
  }
  return { defs: {}, keyword: draft === "draft-07" ? "definitions" : "$defs" };
}

/** The definition name a local `$ref` points at, or null when it is not local. */
function refTarget(ref: string, keyword: string): string | null {
  const prefix = `#/${keyword}/`;
  if (!ref.startsWith(prefix)) return null;
  return ref.slice(prefix.length).replace(/~1/g, "/").replace(/~0/g, "~");
}

/** A cyclic group of definitions, and the one definition every cycle in it passes through. */
interface CycleGroup {
  members: string[];
  binder: string;
}

/** A binder under construction: its self marker, and the group members built beneath it. */
interface Scope {
  marker: RecursiveTypeMarker;
  /** Members built inside this scope capture the marker, so they are shared only within it. */
  built: Map<string, EastType>;
}

interface Context {
  defsKeyword: string;
  defs: Record<string, JsonSchema>;
  /** Every definition on a cycle, mapped to its group. */
  groups: Map<string, CycleGroup>;
  /** Binders currently under construction. */
  building: Map<string, Scope>;
  /** Completed definitions that capture no marker, so a shared definition is built once. */
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
 * | `nullable: true` beside a type, or `{"type":["string","null"]}` | `Option<String>` |
 *
 * The last two read as an Option because East JSON writes a `none` whose
 * payload cannot itself be null as `null`, so the nulls such a contract
 * permits are exactly what the reader accepts. A node whose own spelling
 * already admits null — the null type, a union with null, an Option
 * annotation — is left as it is.
 *
 * Definitions are resolved through `$defs` or `definitions`, whichever the
 * document uses. Cycles among definitions become `RecursiveType`s, one per
 * cycle group: `Node → NodeList → Node`, the ordinary way a recursive schema is
 * written, is the single type `RecursiveType(self => Struct({ children:
 * Array(self) }))` with the alias inlined. A group whose cycles do not all pass
 * through one definition would need two binders, which East does not support,
 * and is refused naming the group.
 *
 * A `$schema` is honoured when present, and a release this cannot read — a
 * draft-04 document, say — is refused by name instead of being structurally
 * guessed at. It is not required: an OpenAPI 3.0 schema object is a fragment of
 * a larger document and carries none, so demanding one would reject what
 * `jsonSchemaFor(T, { draft: "openapi-3.0" })` emits.
 *
 * @example
 * ```ts
 * const T = typeFromJsonSchema(JSON.parse(readFileSync("contract.schema.json", "utf-8")));
 * ```
 */
export function typeFromJsonSchema(schema: JsonSchema): EastType {
  // A declared release is honoured; its absence is not an error, because an
  // OpenAPI 3.0 schema object is a fragment of a larger document and carries no
  // $schema of its own — refusing that would refuse what jsonSchemaFor writes
  // for `draft: "openapi-3.0"`. An explicit null is present, not absent.
  let draft: JsonSchemaDraft | undefined;
  if (has(schema, "$schema")) {
    const declared = schema["$schema"];
    if (typeof declared !== "string") {
      fail("typeFromJsonSchema expected \"$schema\" to be a string", ["$schema"]);
    }
    draft = draftOfSchemaUri(declared, ["$schema"]);
  }

  const { defs, keyword } = definitionsOf(schema, draft);
  const ctx: Context = {
    defsKeyword: keyword,
    defs,
    groups: cycleGroups(defs, keyword),
    building: new Map(),
    done: new Map(),
  };
  return build(schema, ctx, []);
}

/**
 * The cyclic groups among the definitions, each with the one definition its
 * cycles all pass through.
 *
 * @throws {JsonSchemaUnsupportedError} On a group whose cycles do not all
 * pass through one definition — East binds one `RecursiveType` per group, so
 * such a group would need two
 *
 * @remarks
 * East's rule is one recursive binder per strongly connected group of
 * definitions, not one definition per cycle. The binder is the first
 * definition, in document order, whose removal leaves the rest of its group
 * acyclic; document order alone decides it, so the two language twins choose
 * the same one. Reachability is a closure, never a walk that stops at its
 * first hit, so nothing here depends on the order `$ref`s appear in.
 */
function cycleGroups(defs: Record<string, JsonSchema>, keyword: string): Map<string, CycleGroup> {
  const names = Object.keys(defs);
  const edges = new Map<string, string[]>();
  for (const name of names) {
    const seen = new Set<string>();
    collectRefs(defs[name]!, keyword, seen);
    edges.set(name, [...seen].filter(target => has(defs, target)));
  }

  /** Every definition reachable from `from` through definitions `allowed` admits. */
  const reach = (from: string, allowed: (name: string) => boolean): Set<string> => {
    const out = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const at = stack.pop()!;
      for (const next of edges.get(at) ?? []) {
        if (!allowed(next) || out.has(next)) continue;
        out.add(next);
        stack.push(next);
      }
    }
    return out;
  };
  const closure = new Map<string, Set<string>>();
  for (const name of names) closure.set(name, reach(name, () => true));

  const groups = new Map<string, CycleGroup>();
  for (const name of names) {
    if (groups.has(name) || !closure.get(name)!.has(name)) continue;
    const members = names.filter(
      other => other === name || (closure.get(name)!.has(other) && closure.get(other)!.has(name)));
    const inGroup = new Set(members);
    let binder: string | null = null;
    for (const candidate of members) {
      const allowed = (other: string) => inGroup.has(other) && other !== candidate;
      if (members.every(member => member === candidate || !reach(member, allowed).has(member))) {
        binder = candidate;
        break;
      }
    }
    if (binder === null) {
      const quoted = members.map(member => `"${member}"`);
      const list = `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
      throw new JsonSchemaUnsupportedError(
        `definitions ${list} are mutually recursive in a way East cannot express — every cycle ` +
        "among them must pass through one definition, and East binds one RecursiveType per group",
        pointerOf([keyword, name]));
    }
    const group: CycleGroup = { members, binder };
    for (const member of members) groups.set(member, group);
  }
  return groups;
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
    if (has(node, keyword)) {
      fail(`typeFromJsonSchema cannot express "${keyword}" — ${reason}`, [...path, keyword]);
    }
  }

  // OpenAPI 3.0 spells "this or null" as `nullable: true`. Beside nothing typed
  // it is the Null spelling itself; beside a type it reads as an Option of that
  // type — East JSON writes a `none` whose payload cannot be null as `null`, so
  // the nulls the partner's contract permits are exactly what the reader
  // accepts. A node that already admits null — the null type, a union with
  // null, an Option annotation — is left as it is: wrapping it would make its
  // nulls a tagged `none`, which is not what the document says.
  const nullable = node["nullable"] === true;
  if (nullable && !has(node, "type") && !has(node, "$ref") && !has(node, "oneOf") && !has(node, "x-east-type")) {
    return NullType;
  }
  const built = buildTyped(node, ctx, path);
  return nullable && !admitsNull(node) ? OptionType(built) : built;
}

/** Whether a node's own spelling already allows `null`, so `nullable` beside it adds nothing. */
function admitsNull(node: JsonSchema): boolean {
  const type = node["type"];
  return type === "null"
    || (Array.isArray(type) && type.includes("null"))
    || node["x-east-type"] === "Option";
}

/** The node's type, `nullable` aside. */
function buildTyped(node: JsonSchema, ctx: Context, path: string[]): EastType {
  const ref = node["$ref"];
  if (typeof ref === "string") return buildRef(ref, ctx, [...path, "$ref"]);

  // An annotated document says outright what it came from.
  const annotation = node["x-east-type"];
  if (typeof annotation === "string") return buildAnnotated(annotation, node, ctx, path);

  if (has(node, "oneOf")) return buildVariant(node, ctx, path);

  const type = node["type"];
  if (Array.isArray(type)) {
    // JSON Schema's own spelling of "this or null": one type beside "null"
    // reads as an Option of it, for the reason `nullable` does. Anything wider
    // is a union East has no discriminated form for.
    const others = type.filter(t => t !== "null");
    if (others.length < type.length && others.length <= 1) {
      if (others.length === 0) return NullType;
      return OptionType(buildTyped({ ...node, type: others[0]! }, ctx, path));
    }
    fail(
      `typeFromJsonSchema cannot express a union of primitive types [${type.map(spell).join(", ")}] — ` +
      "East unions are discriminated variants, and only one type beside \"null\" reads, as an Option",
      [...path, "type"]);
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
      fail(`typeFromJsonSchema does not recognise the type "${spell(type)}"`, [...path, "type"]);
  }
}

function buildRef(ref: string, ctx: Context, path: string[]): EastType {
  const name = refTarget(ref, ctx.defsKeyword);
  if (name === null) {
    fail(
      `typeFromJsonSchema cannot resolve "${ref}" — only local #/${ctx.defsKeyword}/… references are supported`,
      path);
  }
  if (!has(ctx.defs, name)) {
    fail(`typeFromJsonSchema cannot resolve "${ref}" — no such definition`, path);
  }
  const defPath = [ctx.defsKeyword, name];
  const def = asSchema(ctx.defs[name], defPath, `definition "${name}"`);

  const group = ctx.groups.get(name);
  if (group === undefined) {
    // On no cycle: nothing it builds captures a marker, so build once and share.
    const cached = ctx.done.get(name);
    if (cached !== undefined) return cached;
    const built = build(def, ctx, defPath);
    ctx.done.set(name, built);
    return built;
  }

  const scope = ctx.building.get(group.binder);
  if (name === group.binder) {
    if (scope !== undefined) return scope.marker as unknown as EastType;
    const cached = ctx.done.get(name);
    if (cached !== undefined) return cached;
    const built = RecursiveType(self => {
      ctx.building.set(name, { marker: self, built: new Map() });
      try {
        return build(def, ctx, defPath);
      } finally {
        ctx.building.delete(name);
      }
    }) as EastType;
    ctx.done.set(name, built);
    return built;
  }

  if (scope !== undefined) {
    // Inside its binder: the member captures the marker, so it is built inline
    // and shared only within this scope.
    const cached = scope.built.get(name);
    if (cached !== undefined) return cached;
    const built = build(def, ctx, defPath);
    scope.built.set(name, built);
    return built;
  }

  // Outside its binder: references to the binder resolve to the completed
  // RecursiveType, so the member captures nothing and can be shared.
  const cached = ctx.done.get(name);
  if (cached !== undefined) return cached;
  const built = build(def, ctx, defPath);
  ctx.done.set(name, built);
  return built;
}

function buildItems(node: JsonSchema, ctx: Context, path: string[]): EastType {
  if (!has(node, "items")) {
    fail("typeFromJsonSchema needs \"items\" on an array — East arrays are homogeneous", path);
  }
  return build(asSchema(node["items"], [...path, "items"], "items"), ctx, [...path, "items"]);
}

function buildStruct(node: JsonSchema, ctx: Context, path: string[]): EastType {
  const additional = node["additionalProperties"];
  if (additional !== false) {
    fail(
      "typeFromJsonSchema needs \"additionalProperties\": false on an object — " +
      "East structs are closed, so an open record has no East type", path);
  }

  if (!has(node, "properties")) {
    fail("typeFromJsonSchema needs \"properties\" on an object", path);
  }
  const props = asSchema(node["properties"], [...path, "properties"], "properties");

  const required = node["required"];
  const requiredNames = new Set<string>(
    Array.isArray(required) ? required.filter((r): r is string => typeof r === "string") : []);

  // Names come from the document, so the accumulator must have no prototype:
  // assigning "__proto__" on a plain object sets the prototype instead of a
  // field, silently dropping it. The python twin uses a list of pairs.
  const fields: Record<string, EastType> = Object.create(null) as Record<string, EastType>;
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

  // As above — and reading `cases["constructor"]` on a plain object finds
  // Object.prototype's, which reported a false duplicate case.
  const cases: Record<string, EastType> = Object.create(null) as Record<string, EastType>;
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
    if (!has(properties, "value")) {
      fail("typeFromJsonSchema needs a \"value\" property on each variant case", [...altPath, "properties"]);
    }
    if (cases[tag] !== undefined) {
      fail(`typeFromJsonSchema found the variant case "${tag}" twice`, altPath);
    }
    cases[tag] = build(
      asSchema(properties["value"], [...altPath, "properties", "value"], "value"),
      ctx, [...altPath, "properties", "value"]);
  }
  return VariantType(cases);
}

/** Whether a node is one of the spellings of `Null` the generator emits. */
function isNullSchema(node: JsonSchema): boolean {
  if (node["type"] === "null") return true;
  const choices = node["enum"];
  return node["nullable"] === true && !has(node, "type")
    && Array.isArray(choices) && choices.length === 1 && choices[0] === null;
}

function buildAnnotated(annotation: string, node: JsonSchema, ctx: Context, path: string[]): EastType {
  switch (annotation) {
    case "Option": {
      // A flat Option: null, or the payload. The tagged form carries no
      // annotation and reads structurally, as the Variant it is.
      const alternatives = node["oneOf"];
      if (!Array.isArray(alternatives) || alternatives.length !== 2) {
        fail(
          "typeFromJsonSchema needs an Option's \"oneOf\" to hold exactly two alternatives — null and the payload",
          [...path, "oneOf"]);
      }
      const schemas = alternatives.map((a, i) => asSchema(a, [...path, "oneOf", String(i)], `oneOf[${i}]`));
      const nulls = schemas.map(isNullSchema);
      if (nulls[0] === nulls[1]) {
        fail(
          "typeFromJsonSchema needs an Option's \"oneOf\" to hold one null alternative and one payload",
          [...path, "oneOf"]);
      }
      const at = nulls[0] ? 1 : 0;
      return OptionType(build(schemas[at]!, ctx, [...path, "oneOf", String(at)]));
    }
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
      if (!has(properties, "key") || !has(properties, "value")) {
        fail("typeFromJsonSchema needs \"key\" and \"value\" on a Dict entry", [...entryPath, "properties"]);
      }
      return DictType(
        build(asSchema(properties["key"], [...entryPath, "properties", "key"], "key"), ctx, [...entryPath, "properties", "key"]),
        build(asSchema(properties["value"], [...entryPath, "properties", "value"], "value"), ctx, [...entryPath, "properties", "value"]));
    }
    case "Ref":
      return RefType(buildItems(node, ctx, path));
    default:
      fail(`typeFromJsonSchema does not recognise the x-east-type "${annotation}"`, [...path, "x-east-type"]);
  }
}
