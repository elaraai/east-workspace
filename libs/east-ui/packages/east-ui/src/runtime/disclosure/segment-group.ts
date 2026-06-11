/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure JSX tag for {@link SegmentGroupFactory | SegmentGroup} — a compact
 * segmented control where exactly one segment is active. Use it for toolbar
 * view toggles (Summary / Demand / Coverage), time-range pickers, or any
 * mutually-exclusive switch that should read as a single connected control.
 */

import { SegmentGroup as SegmentGroupFactory, type SegmentGroupOptions } from "../../disclosure/segment-group/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** Segment builder surfaced on the `<SegmentGroup>` tag (mirrors the `SegmentGroup` factory namespace). */
type SegmentGroupBuilders = {
    Item: typeof SegmentGroupFactory.Item;
    Types: typeof SegmentGroupFactory.Types;
};

/**
 * Single-select segmented control — the active segment is set by `value` and
 * changes are reported through `onChange`. Segments are the `items` prop, built
 * with {@link SegmentGroupFactory.Item | SegmentGroup.Item} (label is text or
 * any node). Size and palette are flat props; everything follows
 * {@link SegmentGroupOptions}.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { SegmentGroup, UIComponentType } from "@elaraai/east-ui";
 *
 * const viewToggle = East.function([], UIComponentType, _$ => (
 *     <SegmentGroup
 *         value="summary"
 *         size="sm"
 *         items={[
 *             SegmentGroup.Item("summary", "Summary"),
 *             SegmentGroup.Item("demand", "Demand"),
 *             SegmentGroup.Item("coverage", "Coverage"),
 *         ]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `SegmentGroup.Types` (the East data type and style struct) and the
 * {@link SegmentGroupFactory.Item | SegmentGroup.Item} segment builder — one
 * import gives both the tag and the item constructor. Desugars to
 * `SegmentGroup.Root(options)`.
 */
export const SegmentGroup: JsxTag<SegmentGroupOptions> & SegmentGroupBuilders =
    Object.assign(optionsTag(SegmentGroupFactory.Root), {
        Item: SegmentGroupFactory.Item,
        Types: SegmentGroupFactory.Types,
    });
