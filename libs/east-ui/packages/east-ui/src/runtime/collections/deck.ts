/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Deck>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Deck as DeckFactory,
    type DeckConfig,
} from "../../collections/deck/index.js";
import type { RowElement } from "../../collections/library/index.js";
import { UIComponentType } from "../../component.js";

/**
 * `<Deck>` — a declarative grouped card collection: `data` rows rendered
 * as presentation cards (structured face via the `card` accessor, or a
 * fully custom face via `render`), grouped by named GROUP BY toolbar
 * options, filtered by slice chrome, laid out as a wrapping card grid
 * (desktop rows → one phone column) or a single-column list. Cards are
 * tap targets (`onCardClick`) — for a drag-and-drop palette use
 * `<Library>` instead.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Deck, UIComponentType } from "@elaraai/east-ui";
 *
 * const surface = East.function([], UIComponentType, _$ => (
 *     <Deck
 *         data={[
 *             { id: "a-201", name: "Line A", state: "RUNNING", team: "Alpha", load: 0.62 },
 *             { id: "b-114", name: "Line B", state: "DOWN", team: "Beta", load: 0.0 },
 *         ]}
 *         card={r => ({
 *             key: r.id, title: r.name, sublabel: r.team,
 *             status: Deck.status(r.state, "info"),
 *             facts: [Deck.meter("Load", r.load.multiply(100.0), 100.0, East.print(r.load))],
 *         })}
 *         groupBy={[
 *             { key: "state", label: "Status", value: r => r.state },
 *             { key: "team", label: "Team", value: r => r.team },
 *         ]}
 *         search={r => r.name}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Deck.status` / `Deck.meter` / `Deck.chips` / `Deck.text` value
 * constructors and `Deck.Types`. Desugars to `Deck.Root(data, config)`.
 */
function DeckTag<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T } & DeckConfig<RowElement<T>>,
): ExprType<UIComponentType> {
    const { data, ...config } = props;
    return DeckFactory.Root(data, config as DeckConfig<RowElement<T>>);
}

/** The callable `<Deck>` tag carrying the factory namespace statics. */
export const Deck = Object.assign(DeckTag, DeckFactory);
