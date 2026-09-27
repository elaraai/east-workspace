/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure helpers for the conflict-resolution Manual editor — the primitive leaf
 * types it edits inline. A draft is East's own text for the value: a Boolean,
 * an Integer or a Float printed and read by East ({@link printFor} /
 * {@link parseFor}), a String as itself, a DateTime as the minute a
 * `datetime-local` input edits — printed and read by East's date format
 * ({@link formatDateTime} / {@link parseDateTimeFormatted}), in UTC as East
 * reads every DateTime. The renderer composes these with a Chakra Input;
 * tests exercise them directly without spinning up React.
 *
 * @packageDocumentation
 */

import {
    BooleanType,
    FloatType,
    IntegerType,
    parseFor,
    printFor,
    type DateTimeType,
    type EastTypeValue,
    type StringType,
    type ValueTypeOf,
} from "@elaraai/east";
import { formatDateTime, parseDateTimeFormatted, tokenizeDateTimeFormat } from "@elaraai/east/internal";

/** The value a Manual resolution carries — a value of one of the leaf types
 *  the editor edits inline. */
export type ManualValue =
    | ValueTypeOf<BooleanType>
    | ValueTypeOf<IntegerType>
    | ValueTypeOf<FloatType>
    | ValueTypeOf<StringType>
    | ValueTypeOf<DateTimeType>;

/** A draft, read: its value, or refused. */
export type ManualDraft = { ok: true; value: ManualValue } | { ok: false };

/** The instant a `datetime-local` input edits — to the minute, in UTC — as
 *  East date-format tokens. */
const DATETIME_LOCAL = tokenizeDateTimeFormat("YYYY-MM-DDTHH:mm");

const readBoolean = parseFor(BooleanType);
const readInteger = parseFor(IntegerType);
const readFloat = parseFor(FloatType);

/**
 * Whether a leaf type supports inline manual editing in the conflict chooser:
 * Boolean, Integer, Float, String and DateTime do. Container leaves
 * (Struct/Array/Dict/Set/Variant/Ref) and the valueless primitives (Null/Blob)
 * don't — the renderer hides the Manual chooser for those.
 *
 * @param leafType - The leaf's East type
 * @returns Whether the Manual chooser shows
 */
export function isPrimitiveLeafType(leafType: EastTypeValue): boolean {
    switch (leafType.type) {
        case "Boolean":
        case "Integer":
        case "Float":
        case "String":
        case "DateTime":
            return true;
        default:
            return false;
    }
}

/**
 * A leaf value as the Manual editor's draft: a Boolean, an Integer or a Float
 * as East prints it, a String as itself, a DateTime as its UTC minute
 * (`YYYY-MM-DDTHH:mm`, what a `datetime-local` input edits).
 *
 * @param leafType - The leaf's East type
 * @param value - A value of `leafType`, or `undefined` when the change leaves
 *   none (a delete)
 * @returns The draft — `""` when there is no value to draft, or the type is
 *   not one the editor edits
 */
export function formatManualDraft(leafType: EastTypeValue, value: unknown): string {
    if (value === undefined) return "";
    switch (leafType.type) {
        case "Boolean":
        case "Integer":
        case "Float":
            return printFor(leafType)(value);
        case "String":
            return value as ValueTypeOf<StringType>;
        case "DateTime":
            return formatDateTime(value as ValueTypeOf<DateTimeType>, DATETIME_LOCAL);
        default:
            return "";
    }
}

/**
 * Read a draft back as a value of its leaf type, with East's own parsers — an
 * Integer in 64-bit range, a Float, a Boolean, a DateTime in UTC. A refused
 * draft leaves the previous value standing: the renderer fires nothing.
 *
 * @param leafType - The leaf's East type
 * @param draft - The input's text
 * @returns The value, or `{ ok: false }` when the draft is not one
 */
export function parseManualDraft(leafType: EastTypeValue, draft: string): ManualDraft {
    switch (leafType.type) {
        case "Boolean": {
            const read = readBoolean(draft);
            return read.success ? { ok: true, value: read.value } : { ok: false };
        }
        case "Integer": {
            const read = readInteger(draft);
            return read.success ? { ok: true, value: read.value } : { ok: false };
        }
        case "Float": {
            const read = readFloat(draft);
            return read.success ? { ok: true, value: read.value } : { ok: false };
        }
        case "String":
            return { ok: true, value: draft };
        case "DateTime": {
            const read = parseDateTimeFormatted(draft, DATETIME_LOCAL);
            return read.success ? { ok: true, value: read.value } : { ok: false };
        }
        default:
            return { ok: false };
    }
}
