/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Collection `<Planner.Point>` / `<Planner.Span>` tags — schema-typed planner.
 * Maps to `Planner.Point` / `Planner.Span`.
 *
 * Mirrors the `Planner` namespace as a JSX object whose members are generic
 * tags (like `<Table>`): each threads the data-row generic `T` so the
 * `PlannerConfig` closures (`row` / `slot` / `bucket` …) stay inferred from
 * the data schema. `data` is a flat prop; the config fields spread in.
 */

import type { SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Planner as PlannerFactory,
    type PlannerConfig,
    type RowElement,
} from "../../collections/planner/index.js";
import type { UIElement } from "../runtime.js";

/** `<Planner.Point data={rows} row={r => …} slot={r => …} />` — point-event planner. Maps to `Planner.Point`. */
function PlannerPoint<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T } & PlannerConfig<RowElement<T>>,
): UIElement {
    const { data, ...config } = props;
    return PlannerFactory.Point(data, config as PlannerConfig<RowElement<T>>);
}

/** `<Planner.Span data={rows} row={r => …} slot={r => …} endSlot={r => …} />` — span-event planner. Maps to `Planner.Span`. */
function PlannerSpan<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T } & PlannerConfig<RowElement<T>>,
): UIElement {
    const { data, ...config } = props;
    return PlannerFactory.Span(data, config as PlannerConfig<RowElement<T>>);
}

/** Planner tags keyed by event shape: `<Planner.Point …/>` and `<Planner.Span …/>`. */
export const Planner: { Point: typeof PlannerPoint; Span: typeof PlannerSpan } = {
    Point: PlannerPoint,
    Span: PlannerSpan,
};
