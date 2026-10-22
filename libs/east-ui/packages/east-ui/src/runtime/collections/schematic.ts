/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Schematic>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Schematic as SchematicFactory,
    type SchematicConfig,
    type RowElement,
} from "../../collections/schematic/index.js";
import { UIComponentType } from "../../component.js";

/**
 * `<Schematic>` — a 2D world-coordinate canvas for placing real-world
 * entities (racks, power and cooling units, switches) in space, plus
 * annotation zones (halls, cages, hatched aisles) and key-addressed links —
 * all from flat data tables, each row mapped to its fields. Renders bare like
 * Table; identity chrome is host composition.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, variant, some } from "@elaraai/east";
 * import { Schematic, UIComponentType } from "@elaraai/east-ui";
 *
 * const floor = East.function([], UIComponentType, _$ => (
 *     <Schematic
 *         extent={{ width: 28, height: 12 }}
 *         items={[
 *             { id: "A01", x: 2.4, y: 2.9, kind: "42U · 8 kW", used: 5.2, cap: 8.0,
 *               state: some(variant("success", null)) },
 *         ]}
 *         item={e => ({
 *             key: e.id, x: e.x, y: e.y, label: e.id,
 *             sublabel: e.kind, icon: "server",
 *             status: e.state,
 *             meter: { value: e.used, max: e.cap },
 *         })}
 *         zones={[{ id: "cage-a", name: "Cage A", x: 0.6, y: 0.6, w: 19.6, h: 4.6,
 *                   pattern: Schematic.outline() }]}
 *         zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y,
 *                       width: z.w, height: z.h, pattern: z.pattern })}
 *         scaleUnit="m"
 *     />
 * ));
 * ```
 *
 * @remarks
 * Interaction is opt-in per channel: selection (`selectionMode`, `onSelect`,
 * `onSelectionChange`), camera (`selectZoomFocus`, `onViewportChange`),
 * drill-in (`onItemOpen`), zones (`onSelectZone`, `onZoneSelectionChange`),
 * link / net editing (`linkMode`, `onCreateLink`, `onEditLink`,
 * `onDeleteLink`, gated by `readOnly` / `readOnlyLinks`), item repositioning
 * (`onMoveItem`, gated by `readOnlyItems`), and lazy hover cards
 * (`itemHover` / `zoneHover` / `linkHover`). With no callbacks bound it is a
 * read-only picture. Desugars to `Schematic.Root(items, config)`.
 */
function SchematicTag<
    I extends SubtypeExprOrValue<ArrayType<StructType>>,
    Z extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    L extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    N extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    props: { items: I } & SchematicConfig<RowElement<I>, RowElement<Z>, RowElement<L>, RowElement<N>> & { zones?: Z; links?: L; nets?: N },
): ExprType<UIComponentType> {
    const { items, ...config } = props;
    return SchematicFactory.Root(items, config as never);
}

export const Schematic: typeof SchematicTag & {
    outline: typeof SchematicFactory.outline;
    hatch: typeof SchematicFactory.hatch;
    solid: typeof SchematicFactory.solid;
    dashed: typeof SchematicFactory.dashed;
    rect: typeof SchematicFactory.rect;
    circle: typeof SchematicFactory.circle;
    polyline: typeof SchematicFactory.polyline;
    polygon: typeof SchematicFactory.polygon;
    Types: typeof SchematicFactory.Types;
} = Object.assign(SchematicTag, {
    outline: SchematicFactory.outline,
    hatch: SchematicFactory.hatch,
    solid: SchematicFactory.solid,
    dashed: SchematicFactory.dashed,
    rect: SchematicFactory.rect,
    circle: SchematicFactory.circle,
    polyline: SchematicFactory.polyline,
    polygon: SchematicFactory.polygon,
    Types: SchematicFactory.Types,
});
