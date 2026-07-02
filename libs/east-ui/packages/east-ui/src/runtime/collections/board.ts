/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Board>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Board as BoardFactory,
    type BoardConfig,
    type BoardRowElement,
} from "../../collections/board/index.js";
import { UIComponentType } from "../../component.js";

/**
 * `<Board>` — single-day areas × shifts assignment scheduling. Takes the
 * flat tables a dataset naturally provides — `areas` (rows), `shifts`
 * (columns), `people` (chip faces), and `assignments` — each with a
 * chart-style field encoding (`area`, `shift`, `person`, `assignment`); the
 * factory groups assignments into cells by `area × shift` and joins each to
 * `people` by person key. Optional `requirements` (+ `requirement` encoding)
 * add per-cell coverage: `n/required` numerals, dashed open-slot
 * placeholders, under / over tones.
 *
 * Declares the drag & drop **target** role: `sources` lists the Library ids
 * it accepts `add` drags from, and every completed drag (add / move /
 * remove) funnels through `onDrag` as one typed event. Published mode
 * renders committed assignments only, pointer-immutable; edit mode enables
 * grips on proposed assignments, open-slot / empty-cell add (`onAddAt`),
 * and ghost acceptance (`onAccept`). Dropping a person onto a cell that
 * already holds them is a no-op (the duplicate-person guard).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, variant } from "@elaraai/east";
 * import { Board, UIComponentType } from "@elaraai/east-ui";
 *
 * const board = East.function([], UIComponentType, _$ => (
 *     <Board
 *         id="board-tue"
 *         sources={["people"]}
 *         mode="edit"
 *         areas={[{ id: "icu", name: "ICU", wing: "Level 2" }]}
 *         area={a => ({ key: a.id, label: a.name, sublabel: a.wing })}
 *         shifts={[{ id: "am", name: "AM", window: "06:00–14:00" }]}
 *         shift={s => ({ key: s.id, label: s.name, sublabel: s.window })}
 *         people={[{ id: "patel", name: "Patel, R.", role: "Senior RN" }]}
 *         person={p => ({ key: p.id, label: p.name, sublabel: p.role })}
 *         assignments={[
 *             { id: "x1", personId: "patel", areaId: "icu", shiftId: "am", state: variant("committed", null) },
 *         ]}
 *         assignment={x => ({ key: x.id, person: x.personId, area: x.areaId,
 *                             shift: x.shiftId, state: x.state })}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Assignment states are typed `PlannerStateType` values in the data
 * (`variant("committed", null)`, `variant("proposed", variant("model",
 * null))`, …) — `Board.Types.State` names the grammar. The component bakes
 * in no user-facing copy: every string is data or a prop (`summary`,
 * `areaHeader`); toolbar chrome is page composition. Desugars to
 * `Board.Root(areas, shifts, people, assignments, config)`.
 */
function BoardTag<
    A extends SubtypeExprOrValue<ArrayType<StructType>>,
    S extends SubtypeExprOrValue<ArrayType<StructType>>,
    P extends SubtypeExprOrValue<ArrayType<StructType>>,
    X extends SubtypeExprOrValue<ArrayType<StructType>>,
    R extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    props: { areas: A; shifts: S; people: P; assignments: X }
        & BoardConfig<BoardRowElement<A>, BoardRowElement<S>, BoardRowElement<P>, BoardRowElement<X>, BoardRowElement<R>>
        & { requirements?: R },
): ExprType<UIComponentType> {
    const { areas, shifts, people, assignments, ...config } = props;
    return BoardFactory.Root(
        areas, shifts, people, assignments,
        config as BoardConfig<BoardRowElement<A>, BoardRowElement<S>, BoardRowElement<P>, BoardRowElement<X>, BoardRowElement<R>>
            & { requirements?: R },
    );
}

export const Board: typeof BoardTag & {
    Types: typeof BoardFactory.Types;
} = Object.assign(BoardTag, {
    Types: BoardFactory.Types,
});
