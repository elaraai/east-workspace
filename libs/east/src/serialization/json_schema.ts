/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { toEastTypeValue, type EastTypeValue } from "../type_of_type.js";
import type { EastType } from "../types.js";
import { isVariant } from "../containers/variant.js";

/** A JSON value appearing inside a schema document. */
export type JsonSchemaValue = string | number | boolean | null | JsonSchemaValue[] | JsonSchema;

/** A JSON Schema document, as an ordinary JSON object. */
export type JsonSchema = { [key: string]: JsonSchemaValue };

/**
 * The JSON Schema release a document is emitted in.
 *
 * @remarks
 * A consumer's validator pins a release, so the published contract has to be
 * emitted in the one they can actually read. This selects the spelling of the
 * document, never the encoding it describes — East JSON is the only encoding.
 */
export type JsonSchemaDraft = "2020-12" | "draft-07" | "openapi-3.0";

/** Options for {@link jsonSchemaFor}. */
export interface JsonSchemaOptions {
  /** Which release to emit. Defaults to `"2020-12"`. */
  draft?: JsonSchemaDraft;
}

const SCHEMA_URI: Record<JsonSchemaDraft, string | null> = {
  "2020-12": "https://json-schema.org/draft/2020-12/schema",
  "draft-07": "http://json-schema.org/draft-07/schema#",
  // OpenAPI 3.0 schema objects live inside an OpenAPI document and carry no
  // $schema of their own; stamping one would make the fragment invalid.
  "openapi-3.0": null,
};

/** i64 bounds, as the decoder enforces them. */
const I64_MAX = "9223372036854775807";
const I64_MIN_ABS = "9223372036854775808";

/**
 * A regex alternation matching every decimal string from `"1"` to `max`, with
 * no leading zeros. Zero is excluded so the sign can be attached without
 * admitting `"-0"`, which the encoder never emits.
 *
 * @param max - The inclusive upper bound, as decimal digits
 * @returns An un-anchored alternation body
 *
 * @remarks
 * Generated rather than hand-written because the obvious approximation —
 * `[1-9][0-9]{0,18}` for i64 — accepts every 19-digit value up to
 * 9999999999999999999, so an unsigned 64-bit id passes a producer's validator
 * and then fails on receipt. The construction fixes each prefix of `max` in
 * turn and lets the digit at that position range below `max`'s.
 */
function boundedDigitPattern(max: string): string {
  const k = max.length;
  const alts: string[] = [];
  // Every shorter length is unconditionally below the bound; there are none
  // to add when the bound is itself a single digit.
  if (k >= 2) alts.push(k === 2 ? "[1-9]" : `[1-9][0-9]{0,${k - 2}}`);

  let prefix = "";
  for (let i = 0; i < k; i++) {
    const digit = max.charCodeAt(i) - 48;
    const lo = i === 0 ? 1 : 0;
    if (digit > lo) {
      const cls = digit - 1 === lo ? `${lo}` : `[${lo}-${digit - 1}]`;
      const rest = k - i - 1;
      alts.push(`${prefix}${cls}${rest === 0 ? "" : rest === 1 ? "[0-9]" : `[0-9]{${rest}}`}`);
    }
    prefix += max[i];
  }
  alts.push(max);
  return alts.join("|");
}

/** The exact accepted form of East JSON's `Integer` encoding. */
function integerPattern(): string {
  return `^(?:0|(?:${boundedDigitPattern(I64_MAX)})|-(?:${boundedDigitPattern(I64_MIN_ABS)}))$`;
}

/**
 * The canonical text `DateTime` encodes to — always UTC, always three
 * fractional digits, always an explicit `+00:00` offset.
 *
 * @remarks
 * Stricter than the decoder, deliberately: the decoder also accepts a `Z`
 * suffix and any numeric offset, neither of which the encoder ever emits.
 * Calendar-impossible dates such as `2026-02-30` still match — no regex a
 * schema can carry rules them out — and are rejected when the date is
 * constructed.
 */
const DATETIME_PATTERN =
  "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])" +
  "T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d\\.\\d{3}\\+00:00$";

/** The canonical text `Blob` encodes to — `0x` and an even count of lowercase hex. */
const BLOB_PATTERN = "^0x(?:[0-9a-f]{2})*$";

/** The non-finite floats JSON cannot hold, as the encoder spells them. Sorted for determinism. */
const FLOAT_SPECIALS = ["-0.0", "-Infinity", "Infinity", "NaN"];

/**
 * The exact lexical forms East JSON's scalar encodings take.
 *
 * @remarks
 * Published so a reader can enforce precisely what {@link jsonSchemaFor}
 * describes — the contract and the check are then one definition, not two that
 * have to be kept in step by hand. Each is stricter than the historic decoder,
 * which also accepts hexadecimal and whitespace-padded integers, a `Z` suffix
 * or any numeric offset on a timestamp, and uppercase hex blobs.
 */
export const EAST_JSON_PATTERNS = {
  /** Decimal i64, no leading zeros, no sign on zero. */
  get integer(): string { return integerPattern(); },
  /** RFC 3339 in UTC with three fractional digits and an explicit `+00:00`. */
  datetime: DATETIME_PATTERN,
  /** `0x` followed by an even count of lowercase hex digits. */
  blob: BLOB_PATTERN,
  /** The non-finite floats, as strings, in the order the schema lists them. */
  floatSpecials: FLOAT_SPECIALS as readonly string[],
} as const;

/** Per-walk state: the `$defs` being accumulated and the names already assigned. */
interface DefsContext {
  draft: JsonSchemaDraft;
  defs: JsonSchema;
  /** Recursive type id → def name, assigned in first-encounter order. */
  names: Map<bigint, string>;
}

/** Where definitions live, and how they are referenced, in a given release. */
function defsKeyword(draft: JsonSchemaDraft): string {
  return draft === "2020-12" ? "$defs" : "definitions";
}

/**
 * Emits a JSON Schema describing the East-JSON encoding of an East type.
 *
 * @param type - The East type to describe
 * @param options - Which release to emit
 * @returns A JSON Schema document
 * @throws {Error} When the type has no JSON form — `Never`, `Function` or
 * `AsyncFunction` — naming the offending type
 *
 * @remarks
 * The schema describes what `East.String.printJson` emits and what a strict
 * reader accepts, so a producer validating against it cannot send a payload
 * that would then be rejected. It pins the **encoder's** canonical output
 * rather than the decoder's tolerance: the decoder accepts hexadecimal and
 * whitespace-padded integers, a `Z` suffix on timestamps and uppercase hex
 * blobs, and none of those appear here.
 *
 * The document is deterministic — key order, `$defs` names and case order are
 * fixed by the type, not by process state — so the TypeScript and Python
 * implementations emit byte-identical bytes for the same type and release.
 *
 * @example
 * ```ts
 * const ReadingType = StructType({ sensor: StringType, litres: IntegerType });
 * const schema = jsonSchemaFor(ArrayType(ReadingType), { draft: "draft-07" });
 * writeFileSync("contract.schema.json", JSON.stringify(schema, null, 2));
 * ```
 */
export function jsonSchemaFor(type: EastType | EastTypeValue, options: JsonSchemaOptions = {}): JsonSchema {
  const draft = options.draft ?? "2020-12";
  const typeValue = isVariant(type) ? (type as EastTypeValue) : toEastTypeValue(type as EastType);

  const ctx: DefsContext = { draft, defs: {}, names: new Map() };
  const body = schemaOf(typeValue, ctx);

  const out: JsonSchema = {};
  const uri = SCHEMA_URI[draft];
  if (uri !== null) out["$schema"] = uri;
  for (const [k, v] of Object.entries(body)) out[k] = v;
  if (Object.keys(ctx.defs).length > 0) out[defsKeyword(draft)] = ctx.defs;
  return out;
}

/** The schema for one type node, accumulating any recursive definitions into `ctx`. */
function schemaOf(t: EastTypeValue, ctx: DefsContext): JsonSchema {
  switch (t.type) {
    case "Never":
      throw new Error(
        "jsonSchemaFor cannot describe Never — it has no values, so no JSON document satisfies it");
    case "Function":
      throw new Error(
        "jsonSchemaFor cannot describe Function — JSON has no function form");
    case "AsyncFunction":
      throw new Error(
        "jsonSchemaFor cannot describe AsyncFunction — JSON has no function form");

    case "Null":
      // OpenAPI 3.0 predates the "null" type; `nullable` plus a closed enum is
      // the documented equivalent.
      return ctx.draft === "openapi-3.0"
        ? { nullable: true, enum: [null] }
        : { type: "null" };

    case "Boolean":
      return { type: "boolean" };

    case "String":
      return { type: "string" };

    case "Integer":
      // A JSON number cannot round-trip the upper half of i64, so East JSON
      // encodes Integer as a decimal string and the pattern pins the range.
      return { type: "string", pattern: integerPattern(), "x-east-type": "Integer" };

    case "Float":
      return {
        oneOf: [{ type: "number" }, { type: "string", enum: [...FLOAT_SPECIALS] }],
        "x-east-type": "Float",
      };

    case "DateTime":
      return {
        type: "string",
        format: "date-time",
        pattern: DATETIME_PATTERN,
        "x-east-type": "DateTime",
      };

    case "Blob":
      return { type: "string", pattern: BLOB_PATTERN, "x-east-type": "Blob" };

    case "Array":
      return { type: "array", items: schemaOf(t.value as EastTypeValue, ctx) };

    case "Set":
      return {
        type: "array",
        items: schemaOf(t.value as EastTypeValue, ctx),
        uniqueItems: true,
        "x-east-type": "Set",
      };

    case "Vector":
      return {
        type: "array",
        items: schemaOf(t.value as EastTypeValue, ctx),
        "x-east-type": "Vector",
      };

    case "Matrix":
      // Rows are equal-length, which no release can express without $data; the
      // reader enforces it.
      return {
        type: "array",
        items: { type: "array", items: schemaOf(t.value as EastTypeValue, ctx) },
        "x-east-type": "Matrix",
      };

    case "Ref": {
      // A Ref encodes as a one-element array, or as a relative pointer once the
      // same target has been written already.
      const inner = schemaOf(t.value as EastTypeValue, ctx);
      return {
        oneOf: [
          { type: "array", items: inner, minItems: 1, maxItems: 1 },
          {
            type: "object",
            properties: { $ref: { type: "string" } },
            required: ["$ref"],
            additionalProperties: false,
          },
        ],
        "x-east-type": "Ref",
      };
    }

    case "Dict": {
      const d = t.value as { key: EastTypeValue; value: EastTypeValue };
      return {
        type: "array",
        items: {
          type: "object",
          properties: { key: schemaOf(d.key, ctx), value: schemaOf(d.value, ctx) },
          required: ["key", "value"],
          additionalProperties: false,
        },
        uniqueItems: true,
        "x-east-type": "Dict",
      };
    }

    case "Struct": {
      const fields = t.value as { name: string; type: EastTypeValue }[];
      const properties: JsonSchema = {};
      for (const f of fields) properties[f.name] = schemaOf(f.type, ctx);
      return {
        type: "object",
        properties,
        required: fields.map(f => f.name),
        additionalProperties: false,
      };
    }

    case "Variant": {
      const cases = t.value as { name: string; type: EastTypeValue }[];
      return {
        oneOf: cases.map(c => ({
          type: "object",
          properties: {
            // draft-04 (and so OpenAPI 3.0) has no `const`; a single-valued
            // enum asserts the same thing.
            type: ctx.draft === "openapi-3.0" ? { enum: [c.name] } : { const: c.name },
            value: schemaOf(c.type, ctx),
          },
          required: ["type", "value"],
          additionalProperties: false,
        })),
      };
    }

    case "Recursive": {
      const rec = t.value as { type: "wrapper" | "ref"; value: any };
      if (rec.type === "ref") {
        const name = ctx.names.get(rec.value as bigint);
        if (name === undefined) {
          throw new Error(`jsonSchemaFor: unresolved recursive reference ${rec.value}`);
        }
        return { $ref: `#/${defsKeyword(ctx.draft)}/${name}` };
      }
      const w = rec.value as { id: bigint; inner: EastTypeValue };
      // Named by first-encounter order, never by type id: ids come from a
      // process-global counter, so using them would make the document differ
      // between runs and between languages.
      const name = `Recursive${ctx.names.size + 1}`;
      ctx.names.set(w.id, name);
      // Reserve the slot before recursing so a back-reference resolves.
      ctx.defs[name] = {};
      ctx.defs[name] = schemaOf(w.inner, ctx);
      return { $ref: `#/${defsKeyword(ctx.draft)}/${name}` };
    }

    default:
      throw new Error(`jsonSchemaFor: unhandled type ${(t satisfies never as any).type}`);
  }
}
