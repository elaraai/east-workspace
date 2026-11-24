/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A value's format, as its menu offers it (#1672): as its field's — a value
 * holds no format of its own — or a format of its own: a plain number, a
 * percentage, or an amount of a currency.
 *
 * A value stores `Option<ValueFormat>`, east-ui's own format type, as a
 * source's field does. Its menu edits the choice
 * ({@link StudioFormatChoiceType}): "as its field's" a case of its own, and
 * only the formats that print a Studio number differently — a visual prints
 * every number short from ten thousand, so a compact format reads as a plain
 * number, and a date or a time pattern is no number's. Plain TypeScript over
 * decoded values, through which the inspector's renderer edits.
 *
 * @packageDocumentation
 */

import { NullType, StringType, VariantType, isVariant, none, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import type { ValueFormatType } from "@elaraai/east-ui/internal";
import { isOf } from "./kind.js";

/**
 * How a value's numbers are shown, as its menu offers it.
 *
 * @property auto - As its field's format says
 * @property number - A plain number, whatever its field's format
 * @property percent - A percentage: 0.42 reads 42%
 * @property currency - An amount of a currency, by its code — `AUD`
 */
export const StudioFormatChoiceType = VariantType({
    auto: NullType,
    number: NullType,
    percent: NullType,
    currency: StringType,
});

/** Type representing how a value's numbers are shown, as its menu offers it. */
export type StudioFormatChoiceType = typeof StudioFormatChoiceType;

/** A format choice, decoded. */
export type StudioFormatChoice = ValueTypeOf<StudioFormatChoiceType>;

/** A value's format, decoded: east-ui's. */
type ValueFormat = ValueTypeOf<typeof ValueFormatType>;

/**
 * The choice a value's format is.
 *
 * @param format - The value's format
 * @returns The choice its menu shows
 *
 * @remarks
 * - A value with no format of its own is as its field's.
 * - A compact format is a plain number: a visual prints both alike.
 * - A date or a time pattern, which only a seed can give a value, is shown as
 *   its field's: the menu offers none, and any choice replaces it.
 */
export function formatChoice(format: option<ValueFormat>): StudioFormatChoice {
    if (format.type === "none") return variant("auto", null);
    const held = format.value;
    switch (held.type) {
        case "number": case "compact": return variant("number", null);
        case "percent": return variant("percent", null);
        case "currency": return variant("currency", held.value.code);
        case "date": case "time": case "datetime": return variant("auto", null);
    }
}

/**
 * The format a choice stores: none for as its field's.
 *
 * @param choice - The choice
 * @param was - The format the value held, whose currency's compact flag a currency chosen keeps
 * @returns The value's format
 */
export function choiceFormat(choice: StudioFormatChoice, was: option<ValueFormat> = none): option<ValueFormat> {
    switch (choice.type) {
        case "auto": return none;
        case "number": return some(variant("number", null));
        case "percent": return some(variant("percent", null));
        case "currency": {
            const compact = was.type === "some" && was.value.type === "currency" ? was.value.value.compact : false;
            return some(variant("currency", { code: choice.value, compact }));
        }
    }
}

/**
 * Whether text is a currency's code as a format takes one: three letters, as
 * ISO 4217 writes them — `AUD`.
 *
 * @param code - The text
 * @returns Whether it is a code
 */
export function isCurrencyCode(code: string): boolean {
    return /^[A-Z]{3}$/.test(code);
}

/**
 * A format choice with a form's edit of it applied: another case picked, or a
 * currency's code set.
 *
 * @param choice - The choice as it stands
 * @param path - The edit's path under the choice: none for a case picked, `["currency"]` for a currency's code
 * @param next - The edit's value: the case picked, whatever it holds; or the code
 * @param currency - The code a currency picked starts as: its field's
 * @returns The choice; or that the edit is refused — its `value` no choice,
 *   or a currency's `code` not three letters
 *
 * @remarks
 * - A currency picked starts as the one given; the case the choice holds
 *   picked again leaves it as it is.
 * - A code typed is taken in capitals.
 */
export function editedFormatChoice(
    choice: StudioFormatChoice, path: readonly string[], next: unknown, currency: string,
): { readonly choice: StudioFormatChoice } | { readonly refused: "value" | "code" } {
    if (path.length === 0) {
        if (!isVariant(next)) return { refused: "value" };
        if (next.type === choice.type) return { choice };
        switch (next.type) {
            case "auto": case "number": case "percent": return { choice: variant(next.type, null) };
            case "currency": return isCurrencyCode(currency) ? { choice: variant("currency", currency) } : { refused: "code" };
            default: return { refused: "value" };
        }
    }
    if (choice.type !== "currency" || path[0] !== "currency" || !isOf(next, StringType)) return { refused: "value" };
    const code = next.toUpperCase();
    return isCurrencyCode(code) ? { choice: variant("currency", code) } : { refused: "code" };
}
