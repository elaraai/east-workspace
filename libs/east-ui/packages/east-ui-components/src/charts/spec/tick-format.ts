/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How an axis prints a tick: a declared format through the shared format
 * module's one interpreter (#850), a date pattern through East's own printer
 * and parser. Shared with the `Slice.Rail` brush axis and the Deck (#190).
 *
 * @packageDocumentation
 */

import { formatters, formatPattern, parsePattern, tickFormatOf } from "../../format/index.js";
import { instantOfKey, type ScaleKind, type TickFormat } from "./context.js";

/** Format a Date against an East datetime format pattern — the shared
 *  format module's {@link formatPattern} (#850): East's own tokenizer and
 *  printer, in UTC (#326), so a chart axis and `DateTime.printFormatted`
 *  agree on every pattern. */
export function formatDatePattern(pattern: string, d: Date): string {
    return formatPattern(pattern, d);
}

/** Parse text against an East datetime format pattern — the shared format
 *  module's {@link parsePattern}: East's OWN parser, the twin of
 *  {@link formatDatePattern}, so a calendar entry form is a pattern the
 *  language already knows, never a second grammar. `undefined` when the text
 *  is not that pattern. UTC, like the printer. */
export function parseDatePattern(pattern: string, text: string): Date | undefined {
    return parsePattern(pattern, text);
}

/** A tick value as the instant a date arm prints — a time scale's `Date`
 *  tick, an epoch-ms number, or a key a band / time domain carries (East's
 *  spelling, {@link instantOfKey}). The scales hand these over untyped. */
function instantOf(v: unknown): Date {
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);
    return instantOfKey(String(v));
}

/**
 * Build a tick formatter for an axis from its optional {@link TickFormat} +
 * scale kind. Shared with the `Slice.Rail` brush axis (#190). It is the shared
 * format module's one interpreter (#850): a declared format reaches it through
 * {@link tickFormatOf}, so a `Chart.format.*` spec prints exactly as its
 * `Format.*` twin does.
 *
 * @param fmt - The axis's declared format, when it has one
 * @param kind - The axis's scale kind
 * @param locale - The BCP 47 locale numbers and default dates format in; the
 *   runtime's default when omitted (a component passes its app locale)
 * @returns The formatter
 */
export function tickFormatter(fmt: TickFormat | undefined, kind: ScaleKind, locale?: string): (v: unknown) => string {
    const f = formatters(locale);
    if (fmt === undefined) {
        if (kind === "time") return v => f.numericDate(instantOf(v));
        if (kind === "band") return v => String(v);
        return v => f.number(Number(v));
    }
    const spec = tickFormatOf(fmt);
    const dated = spec.type === "date" || spec.type === "time" || spec.type === "datetime";
    return v => f.value(dated ? instantOf(v).getTime() : Number(v), spec);
}
