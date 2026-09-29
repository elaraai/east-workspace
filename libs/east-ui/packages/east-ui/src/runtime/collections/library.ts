/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Library>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Library as LibraryFactory,
    type LibraryConfig,
    type RowElement,
} from "../../collections/library/index.js";
import { UIComponentType } from "../../component.js";

/**
 * `<Library>` — a draggable palette of things that get assigned onto grid
 * surfaces (Roster, Blend): people, assets, vehicles, rooms. Each card
 * carries a primary identity (`item` accessor via `Library.card`) plus
 * configurable secondary dimensions that are filterable, groupable, and
 * visible on the card. Declares the drag & drop **source** role under `id`;
 * targets connect by listing that id in their `sources`. The quick search
 * and the Filter menu (`filters`) hide unmatched cards (the footer shows the
 * hidden count + Show all); the `filtered` card-face field dims a card
 * instead — the host's deliberate de-emphasis (e.g. `Slice.partition`'s
 * unmatched rows). A card may carry a trailing glyph (`Library.glyph` — a lock,
 * a status dot) and a `placed` state, the brand border and tint of the item
 * already on the target; `onCardClick` hears a click on a card.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Library, UIComponentType } from "@elaraai/east-ui";
 *
 * const palette = East.function([], UIComponentType, _$ => (
 *     <Library
 *         id="people"
 *         data={[
 *             { id: "patel", name: "Patel, R.", role: "Senior SE", hours: 38.0, skills: ["React", "Node"] },
 *             { id: "cho", name: "Cho, J.", role: "Senior SE", hours: 26.0, skills: ["Go", "SQL"] },
 *         ]}
 *         item={p => ({ key: p.id, label: p.name, sublabel: p.role, icon: "user" })}
 *         dimensions={[
 *             { kind: "meter", key: "hours", label: "Hours", value: p => p.hours, max: 40.0,
 *               format: h => East.str`${h}h` },
 *             { kind: "chips", key: "skills", label: "Skills", values: p => p.skills },
 *         ]}
 *         search={p => p.name}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries the `Library.status` and `Library.glyph` value constructors and
 * `Library.Types`. Secondary dimensions, group-by options and filter facets
 * are plain config literals.
 * Desugars to `Library.Root(data, config)`.
 */
function LibraryTag<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T } & LibraryConfig<RowElement<T>>,
): ExprType<UIComponentType> {
    const { data, ...config } = props;
    return LibraryFactory.Root(data, config as LibraryConfig<RowElement<T>>);
}

export const Library: typeof LibraryTag & {
    status: typeof LibraryFactory.status;
    glyph: typeof LibraryFactory.glyph;
    Types: typeof LibraryFactory.Types;
} = Object.assign(LibraryTag, {
    status: LibraryFactory.status,
    glyph: LibraryFactory.glyph,
    Types: LibraryFactory.Types,
});
