/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Roster>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Roster as RosterFactory,
    type RosterConfig,
    type RowElement,
} from "../../collections/roster/index.js";
import { UIComponentType } from "../../component.js";

/**
 * `<Roster>` — people × days-of-week shift scheduling. Takes the two flat
 * tables a dataset naturally provides — `people` and `shifts` — each with a
 * chart-style field encoding (`person`, `shift`); the factory joins them by
 * person key. The component owns the week (`days` defaults to Mon–Sun).
 *
 * Declares the drag & drop **target** role: `sources` lists the Library ids
 * it accepts `add` drags from, and every completed drag (add / move /
 * remove) funnels through `onDrag` as one typed event. Published mode
 * renders committed shifts only, pointer-immutable; edit mode enables
 * grips, empty-cell add (`onAddAt`), and ghost acceptance (`onAccept`).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, variant } from "@elaraai/east";
 * import { Roster, UIComponentType } from "@elaraai/east-ui";
 *
 * const roster = East.function([], UIComponentType, _$ => (
 *     <Roster
 *         id="roster-se"
 *         sources={["people"]}
 *         mode="edit"
 *         people={[
 *             { id: "patel", name: "Patel", target: "38h → 30h" },
 *         ]}
 *         person={p => ({ key: p.id, label: p.name, sublabel: p.target })}
 *         shifts={[
 *             { id: "p1", person: "patel", day: "Mon", hours: 8n, state: variant("committed", null) },
 *             { id: "p2", person: "patel", day: "Wed", hours: 4n, state: variant("proposed", variant("model", null)) },
 *         ]}
 *         shift={s => ({ key: s.id, person: s.person, day: s.day,
 *                        hours: s.hours, state: s.state })}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Shift states are typed `PlannerStateType` values in the data
 * (`variant("committed", null)`, `variant("proposed", variant("model",
 * null))`, …) — `Roster.Types.State` names the grammar. Desugars to
 * `Roster.Root(people, shifts, config)`.
 */
function RosterTag<
    P extends SubtypeExprOrValue<ArrayType<StructType>>,
    S extends SubtypeExprOrValue<ArrayType<StructType>>,
>(
    props: { people: P; shifts: S } & RosterConfig<RowElement<P>, RowElement<S>>,
): ExprType<UIComponentType> {
    const { people, shifts, ...config } = props;
    return RosterFactory.Root(people, shifts, config as RosterConfig<RowElement<P>, RowElement<S>>);
}

export const Roster: typeof RosterTag & {
    Types: typeof RosterFactory.Types;
} = Object.assign(RosterTag, {
    Types: RosterFactory.Types,
});
