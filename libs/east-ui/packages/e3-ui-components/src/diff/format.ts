/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure helpers for the diff rows' text. A leaf prints as East prints it —
 * {@link printFor}, East's own text for every type — so a diff shows exactly
 * what differs, never a rounded or guessed form of it.
 *
 * @packageDocumentation
 */

import { printFor, type EastTypeValue, type FloatType, type ValueTypeOf } from "@elaraai/east";
import type { TreePath } from "@elaraai/e3-types";
import { formatters, type Formatters } from "@elaraai/east-ui-components";

/** A chip shows at most this many characters of a value's text. */
const MAX_INLINE_CHARS = 48;

/**
 * A leaf's value as the diff's chips show it: East's own text for it
 * ({@link printFor}) — an Integer every digit, a DateTime its exact UTC
 * instant, a String quoted, a variant `.case payload` — and a Float as East
 * prints it in the viewer's decimal separator (#850). Text past
 * {@link MAX_INLINE_CHARS} is cut with `…`, except a String's: a string leaf
 * is the change itself, so it prints whole.
 *
 * @param leafType - The leaf's East type, as the walker reports it
 * @param value - A value of `leafType` — the side of the change being shown
 * @param words - The formatters a Float prints through; the runtime locale's
 *   when omitted
 * @returns The chip's text
 */
export function formatLeafValue(leafType: EastTypeValue, value: unknown, words: Formatters = formatters()): string {
    if (leafType.type === "Float") return words.float(value as ValueTypeOf<FloatType>);
    const text = printFor(leafType)(value);
    return leafType.type === "String" ? text : truncate(text);
}

/** Text past {@link MAX_INLINE_CHARS}, cut with `…`. */
function truncate(s: string): string {
    return s.length > MAX_INLINE_CHARS ? s.slice(0, MAX_INLINE_CHARS - 1) + "…" : s;
}

/**
 * A binding's label: the name of the last field on its dataset path, or
 * `(root)` for the root.
 *
 * @param path - The binding's dataset path
 * @returns The label
 */
export function formatBindingLabel(path: TreePath): string {
    const last = path[path.length - 1];
    if (last === undefined) return "(root)";
    switch (last.type) {
        case "field": return last.value;
    }
}
