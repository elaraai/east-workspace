/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The `<Match>` hosting-slot tag (#333). */

import type { EastType } from "@elaraai/east";
import { Match as MatchFactory, type MatchInput } from "../../reactive/match.js";
import type { UIElement } from "../runtime.js";

/**
 * Hosting slot over a variant — the component-level twin of `variant.match`:
 * host-mounts only the active case and **remounts it on tag change**, so a
 * stateful component (its own `<Reactive>` / binds) swapped at one slot is
 * torn down and rebuilt fresh per key instead of keeping the previous case's
 * mounted state. Same-tag payload/data churn re-renders without remounting.
 * `cases` are keyed by the variant's case names, exhaustive, and each handler
 * receives that case's typed payload — exactly like `variant.match`. Where
 * the key is a nav route, use `<Route nav routes>` instead; for selecting a
 * plain *value* by key, use `variant.match` directly.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, NullType, StringType, UIComponentType, VariantType } from "@elaraai/east";
 * import { Match, Reactive, State, Text } from "@elaraai/east-ui";
 *
 * const ModeType = VariantType({ list: NullType, detail: StringType });
 *
 * const slot = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const modeBind = $.let(State.bind([ModeType], "app.mode", East.value(variant("list", null), ModeType)));
 *         const mode = $.let(modeBind.read());
 *         return <Match on={mode} cases={{
 *             list: (_$) => <Text>All items</Text>,
 *             detail: (_$, id) => <Text>{East.str`Item ${id}`}</Text>,
 *         }} />;
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Desugars to `Match.Root({ on, cases })`. A generic function declaration
 * (merged with the `Match` namespace) so it is a valid generic JSX component.
 */
export function Match<C extends { [K in string]: EastType }>(props: MatchInput<C>): UIElement {
    return MatchFactory.Root(props) as UIElement;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Match {
    /** The underlying factory: `Match.Root({ on, cases })`. */
    export const Root = MatchFactory.Root;
}
