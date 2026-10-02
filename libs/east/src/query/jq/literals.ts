/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A jq program's constants: each literal's East type and value, the ISO-8601
 * text a string literal writes a DateTime as (`devdocs/QUERY.md` §7), and a
 * string's jq text, which is JSON's.
 *
 * The checker and the translator read a literal through these alike: the
 * checker to type it and to report a string that is not a date, the
 * translator to give its value as the type the checker read it as.
 *
 * @packageDocumentation
 */

import { encodeJSONFor, jsonParseDateTime } from "../../serialization/json.js";
import { BooleanType, FloatType, IntegerType, NullType, StringType, type EastType, type ValueTypeOf } from "../../types.js";
import type { JqLiteralType } from "../types.js";

/** A constant a jq program writes: a {@link JqLiteralType} value. */
export type JqLiteral = ValueTypeOf<typeof JqLiteralType>;

/**
 * A literal's East type and value, as the program writes it.
 *
 * @param literal - the literal
 * @returns its type and its value
 *
 * @internal
 */
export function literalValue(literal: JqLiteral): { type: EastType; value: unknown } {
  switch (literal.type) {
    case "boolean": return { type: BooleanType, value: literal.value };
    case "float": return { type: FloatType, value: literal.value };
    case "integer": return { type: IntegerType, value: literal.value };
    case "null": return { type: NullType, value: null };
    case "string": return { type: StringType, value: literal.value };
  }
}

/** A String's JSON, as East's JSON codec writes it: UTF-8 bytes. */
const encodeStringJson = encodeJSONFor(StringType);
const utf8 = new TextDecoder();

/**
 * A string as jq's text writes it: a JSON string, written by East's JSON
 * codec. The twin of python's `json_string`.
 *
 * @param value - the string
 * @returns the string in quotes, with JSON's escapes
 *
 * @remarks
 * Whatever writes jq text writes its strings with this: the printer's string
 * literals and quoted names, a checker's fix and the names its messages quote,
 * a completion, a summary's program. East's own text escapes only a backslash
 * and a quote and keeps control characters as they are, which a jq string
 * cannot hold, so it is not jq's.
 *
 * @internal
 */
export function jsonString(value: string): string {
  return utf8.decode(encodeStringJson(value));
}

/**
 * Reads ISO-8601 text as a DateTime, through East's RFC 3339 reader: a full
 * date-time with its offset, a date-time with none (UTC), or a date (midnight
 * UTC).
 *
 * @param text - the text
 * @returns the DateTime, or `undefined` when the text is not an ISO-8601 date
 *
 * @internal
 */
export function isoDateTime(text: string): Date | undefined {
  const forms = /^\d{4}-\d{2}-\d{2}$/.test(text) ? [`${text}T00:00:00Z`]
    : /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text) ? [`${text}Z`]
    : [text];
  for (const form of forms) {
    const ms = jsonParseDateTime(form);
    if (typeof ms === "number") return new Date(ms);
  }
  return undefined;
}
