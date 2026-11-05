/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `views` prop of a component that switches between views: which of them an
 * instance offers. Each entry is a literal tag (`"people"`) or a value or an
 * expression of the component's view variant, or the whole list is an expression
 * of an array of it, so a page's own state can choose them as it runs. The list
 * chooses and the component orders: its switch shows in its own order, whatever
 * order the entries come in. One view left, no switch shows at all.
 *
 * Nothing is left out by an empty list. Written in the code, one is refused, as
 * saying nothing; read as a page runs — a multi-select with nothing chosen — it
 * means every view, as leaving the prop out does.
 *
 * @packageDocumentation
 */

import { ArrayType, East, variant, type EastType, type SubtypeExprOrValue, type VariantType } from "@elaraai/east";

/**
 * Which views an instance offers: literal tags or variants, or an expression of an array of the variant.
 *
 * @typeParam V - The component's view variant
 * @typeParam L - Its tags, as literals
 */
export type ViewsProp<V extends VariantType, L extends string> = readonly (L | SubtypeExprOrValue<V>)[] | SubtypeExprOrValue<ArrayType<V>>;

/**
 * The tags a `views` prop lists, where the code spells every one.
 *
 * @param given - The prop
 * @returns Its tags; `undefined` for a prop left out, or one holding anything read as the page runs
 */
export function literalViews(given: unknown): readonly string[] | undefined {
    return Array.isArray(given) && given.every(entry => typeof entry === "string") ? given as readonly string[] : undefined;
}

/**
 * The first view a component opens on, where its author named none: the first of its own order the code's `views` lists.
 *
 * @param order - The component's views, in its switch's order
 * @param given - The `views` prop
 * @returns The view; the component's first where the prop lists no literal tags
 */
export function firstView<L extends string>(order: readonly L[], given: unknown): L {
    const listed = literalViews(given);
    return order.find(view => listed === undefined || listed.includes(view)) ?? order[0]!;
}

/**
 * The `views` prop as the payload holds it: every entry a case of the variant, an empty array meaning every view.
 *
 * @param builder - The component's name, for what a refusal says
 * @param type - The component's view variant
 * @param given - The prop
 * @param opening - The view the author opens the component on, when the code names one
 * @param prop - The prop's name, for what a refusal says
 * @returns The array of the variant
 * @throws {Error} Naming the change to make: an empty list written in the code, a literal tag that is no view of the
 *   component, or an `opening` view the code's list leaves out
 */
export function viewsProp<V extends VariantType, L extends string>(builder: string, type: V, given: ViewsProp<V, L> | undefined, opening?: L, prop: string = "views"): SubtypeExprOrValue<ArrayType<V>> {
    const arrayType = ArrayType(type as EastType);
    if (given === undefined) return East.value([], arrayType) as unknown as SubtypeExprOrValue<ArrayType<V>>;
    if (!Array.isArray(given)) return East.value(given as never, arrayType) as unknown as SubtypeExprOrValue<ArrayType<V>>;
    const cases = Object.keys(type.cases).map(tag => `"${tag}"`).join(", ");
    if (given.length === 0) throw new Error(`${builder}: \`${prop}\` lists at least one of ${cases} — leave it out to offer every view`);
    for (const entry of given as readonly unknown[]) {
        if (typeof entry === "string" && !Object.hasOwn(type.cases, entry)) throw new Error(`${builder}: \`${prop}\` holds "${entry}", which is none of ${cases}`);
    }
    const listed = literalViews(given);
    if (opening !== undefined && listed !== undefined && !listed.includes(opening)) {
        throw new Error(`${builder}: it opens on "${opening}", and \`${prop}\` leaves it out — list it, or open on one of ${listed.map(tag => `"${tag}"`).join(", ")}`);
    }
    const entries = (given as readonly unknown[]).map(entry => typeof entry === "string" ? variant(entry, null) : entry);
    return East.value(entries as never, arrayType) as unknown as SubtypeExprOrValue<ArrayType<V>>;
}
