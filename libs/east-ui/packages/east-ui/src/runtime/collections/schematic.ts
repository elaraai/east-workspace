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
 * `<Schematic>` — a read-only 2D world-coordinate canvas for placing
 * real-world entities (tanks, bays, lines, cells) in space, plus
 * annotation zones (rooms, hatched walkways) and key-addressed links — all
 * from flat data tables with chart-style field encodings. Renders bare like
 * Table / Planner; identity chrome is host composition.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, variant } from "@elaraai/east";
 * import { Schematic, UIComponentType } from "@elaraai/east-ui";
 *
 * const plant = East.function([], UIComponentType, _$ => (
 *     <Schematic
 *         extent={{ width: 30, height: 12 }}
 *         items={[
 *             { id: "UNIT-04", x: 4.0, y: 2.5, kind: "unit · 40 kL", fill: 28.8, cap: 40.0,
 *               state: variant("some", variant("success", null)) },
 *         ]}
 *         item={{
 *             key: e => e.id, x: e => e.x, y: e => e.y, label: e => e.id,
 *             sublabel: e => e.kind, icon: "database",
 *             status: e => e.state,
 *             meter: { value: e => e.fill, max: e => e.cap },
 *         }}
 *         zones={[{ id: "hall-b", name: "Hall B", x: 0.5, y: 0.5, w: 18.0, h: 5.0,
 *                   pattern: Schematic.outline() }]}
 *         zone={{ key: z => z.id, label: z => z.name, x: z => z.x, y: z => z.y,
 *                 width: z => z.w, height: z => z.h, pattern: z => z.pattern }}
 *         scaleUnit="m"
 *     />
 * ));
 * ```
 *
 * @remarks
 * Read-only — single-click selection (`onSelect` receives the item key); no
 * events, no drag & drop. Desugars to `Schematic.Root(items, config)`.
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
