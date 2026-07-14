/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Match` — the hosting slot over a variant (#333): the component-level twin
 * of `variant.match`.
 *
 * A plain `variant.match(…)` selecting between mounted components reconciles
 * same-shape nodes, so swapping component A → B at one slot keeps A mounted —
 * its nested `Reactive` / bind / scroll / open state persists and the content
 * goes stale. `Match` host-mounts only the active case and **remounts on tag
 * change**: each case is a normal, self-contained component built with the
 * existing binds, torn down and rebuilt fresh per key. Same-tag payload/data
 * churn re-renders without losing mounted state.
 *
 * @packageDocumentation
 */

import {
    East,
    StringType,
    variant,
    type BlockBuilder,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    type VariantType,
} from "@elaraai/east";

import { UIComponentType } from "../component.js";

/**
 * The case registry: one body per variant case, receiving `($, payload)` —
 * the inner block builder and that case's typed payload. Typed from the `on`
 * variant so a wrong payload arg is a compile error; every case must be
 * handled (exhaustive), exactly like `variant.match`.
 */
export type MatchCases<C extends { [K in string]: EastType }> = {
    [K in keyof C]: (
        $: BlockBuilder<typeof UIComponentType>,
        payload: ExprType<C[K]>,
    ) => SubtypeExprOrValue<typeof UIComponentType>;
};

/**
 * The input to the `<Match>` hosting slot: the variant expression selecting
 * the active case, plus the typed case registry.
 *
 * @remarks
 * Taking a **variant** (not a bare string/number key) is what lets the case
 * map be typed + exhaustive — model the choice as a variant (a `State`-bound
 * mode, a selection tagged as a variant) to get it. `C` is fixed by `on`, so
 * every `cases` handler is contextually typed.
 */
export interface MatchInput<C extends { [K in string]: EastType }> {
    /** The variant expression selecting the active case — its reads are the reactive subscription. */
    on: ExprType<VariantType<C>>;
    /** One body per case — see {@link MatchCases}. `C` is fixed by `on`, so the handlers are contextually typed. */
    cases: MatchCases<NoInfer<C>>;
}

/**
 * Build a `<Match>` hosting slot from a variant expression + a typed case
 * registry.
 *
 * The nullary `render` re-reads `on` and `match`es the active case to its
 * body. The bodies live in the match arms (in the IR), so the manifest walk
 * collects every case's binds (the union) while only the matched arm executes
 * — the renderer mounts just the active case. The `tag` closure re-reads `on`
 * and yields the active case name; the renderer keys the mounted subtree by
 * it, so the active case remounts exactly on tag change.
 *
 * @param input - The {@link MatchInput} (`on` variant + `cases` registry).
 * @returns A `Match` `UIComponentType` value.
 */
function createMatch<C extends { [K in string]: EastType }>({ on, cases }: MatchInput<C>): ExprType<typeof UIComponentType> {
    // The handlers receive ($, payload) — the exact `variant.match` arm shape —
    // so the registry passes straight through as the match arms.
    const render = East.function([], UIComponentType, ($) => {
        const cur = $.const(on);
        return (cur as unknown as { match(h: unknown): ExprType<typeof UIComponentType> }).match(cases);
    });
    const tag = East.function([], StringType, ($) => {
        const cur = $.const(on);
        return (cur as unknown as { getTag(): ExprType<StringType> }).getTag();
    });
    return East.value(variant("Match", { render, tag }), UIComponentType);
}

/**
 * The `Match` namespace — the general hosting slot over a variant.
 *
 * @remarks
 * Authored as the `<Match on={…} cases={{…}} />` tag; `Match.Root({ on,
 * cases })` is the underlying factory. Use it to swap a **stateful**
 * component (its own `<Reactive>` / binds) at one slot by a reactive key:
 * the active case remounts on tag change. Where the key is a nav route, use
 * `<Route nav routes>` instead — it pins the case map to the
 * `Navigation.config` and hands each body the route payload + nav. For
 * selecting a plain *value* by key (a label, a count), use `variant.match`
 * directly — only mounted subtrees need the hosting slot.
 */
export const Match = {
    /** Build a `<Match>` hosting slot from `{ on, cases }`. See {@link createMatch}. */
    Root: createMatch,
} as const;
