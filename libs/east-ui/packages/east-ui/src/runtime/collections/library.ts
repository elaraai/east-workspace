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
 * targets connect by listing that id in their `sources`. Cards dim when
 * filtered out instead of disappearing, keeping a stable mental map.
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
 * Carries the `Library.status` value constructor and `Library.Types`.
 * Secondary dimensions and group-by options are plain discriminated config
 * literals, like Planner column definitions.
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
    Types: typeof LibraryFactory.Types;
} = Object.assign(LibraryTag, {
    status: LibraryFactory.status,
    Types: LibraryFactory.Types,
});
