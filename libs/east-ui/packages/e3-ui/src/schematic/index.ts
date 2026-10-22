/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic (#1384): the 2D world-coordinate canvas, e3-ui's as the Plan
 * (#1177), the Sheet (#1179) and the Flowchart (#1243) are. `<Schematic>`
 * takes the props east-ui's took, and returns the schematic's root through the
 * `Schematic` carrier, which e3-ui-components' renderer draws.
 *
 * - `types.ts` — the row, closed-set and event types (`Schematic.Types.*`).
 * - `payload.ts` — the root, `<Schematic>`'s props, the carrier, the
 *   factories, and the pattern and geometry builders.
 * - `schematic.ts` — the tag.
 *
 * @packageDocumentation
 */

import { SchematicTag, type SchematicTagType } from "./schematic.js";
import { SchematicBuilders, SchematicComponent, SchematicTypes, createSchematicPayload, createSchematicRoot } from "./payload.js";

export { SchematicTag, type SchematicTagType } from "./schematic.js";
export {
    SchematicBuilders,
    SchematicComponent,
    SchematicRootType,
    SchematicTypes,
    createSchematicPayload,
    createSchematicRoot,
    type RowElement,
    type SchematicConfig,
    type SchematicItemFields,
    type SchematicZoneFields,
    type SchematicLinkFields,
    type SchematicNetFields,
    type SchematicLayerInput,
    type SchematicPatternConfig,
    type SchematicPolylineConfig,
    type SchematicVertexInput,
    type SchematicVertices,
    type SchematicToneLiteral,
    type SchematicEmphasisLiteral,
    type SchematicSelectionModeLiteral,
    type SchematicLinkModeLiteral,
} from "./payload.js";

/**
 * The type of the {@link Schematic} namespace: `<Schematic>`, the pattern and
 * geometry builders a schematic's rows are written with, and its East types.
 */
export interface SchematicNamespace extends SchematicTagType {
    /** An `outline` zone pattern — the dashed boundary with an eyebrow label (halls, cages). */
    outline: typeof SchematicBuilders.outline;
    /** A `hatch` zone pattern — the hatched band (hot and cold aisles, exclusion zones). */
    hatch: typeof SchematicBuilders.hatch;
    /** A `solid` link style — a physical run (fibre, power cable). */
    solid: typeof SchematicBuilders.solid;
    /** A `dashed` link style — a routing / logical connection. */
    dashed: typeof SchematicBuilders.dashed;
    /** A `rect` geometry — the axis-aligned box; equals omitting `geometry` / `footprint`. */
    rect: typeof SchematicBuilders.rect;
    /** A `circle` geometry — centred on the entity's anchor, its radius in world units. */
    circle: typeof SchematicBuilders.circle;
    /** A `polyline` geometry — an open, arc-aware polyline in world coordinates, optionally a band. */
    polyline: typeof SchematicBuilders.polyline;
    /** A `polygon` geometry — a closed, arc-aware polygon in world coordinates. */
    polygon: typeof SchematicBuilders.polygon;
    /** East types for the schematic's root, rows, closed-set fields and events ({@link SchematicTypes}). */
    Types: typeof SchematicTypes;
}

/** The namespace's members — everything `Schematic` carries beside the tag itself. */
const MEMBERS = { ...SchematicBuilders, Types: SchematicTypes };

/**
 * `<Schematic>` — a 2D world-coordinate canvas for placing real-world entities
 * (racks, power and cooling units, switches) in space, plus annotation zones
 * (halls, cages, hatched aisles), key-addressed links and nets — all from flat
 * data tables: `items` with its `item` row mapper, and optionally `zones`,
 * `links` and `nets`, each with its mapper unless its rows are already
 * `Schematic.Types.*`. Links address their endpoints by item key, so they
 * survive repositioning, and `via` waypoints route them around zones; a hot or
 * cold aisle is a zone with `pattern: Schematic.hatch()`. Renders bare like
 * Table; identity chrome is host composition.
 *
 * @remarks
 * Interaction is opt-in per channel: selection (`selectionMode`, `onSelect`,
 * `onSelectionChange`), camera (`selectZoomFocus`, `onViewportChange`),
 * drill-in (`onItemOpen`), zones (`onSelectZone`, `onZoneSelectionChange`),
 * link / net editing (`linkMode`, `onCreateLink`, `onEditLink`,
 * `onDeleteLink`, `onEditNet`, `canConnect`, gated by `readOnly` /
 * `readOnlyLinks`), item repositioning (`onMoveItem`, gated by
 * `readOnlyItems`), lazy hover cards (`itemHover` / `zoneHover` /
 * `linkHover`), layers (`layers`) and the bound slice (`slice`,
 * `affordances`, and the `slice*` effect props). With no callbacks bound it is
 * a read-only picture.
 *
 * It moved here from east-ui (#1384): a surface that wrote east-ui's
 * `<Schematic>` imports `Schematic` from `@elaraai/e3-ui`, its props as they
 * were. The closed-set fields in data (`status`, `pattern`, `style`) are typed
 * variant values, `Schematic.Types.*`, and the pattern and geometry builders
 * (`Schematic.outline()`, `Schematic.hatch()`, `Schematic.solid()`,
 * `Schematic.dashed()`, `Schematic.rect()`, `Schematic.circle()`,
 * `Schematic.polyline()`, `Schematic.polygon()`) write them.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East, ArrayType, variant, some, none } from "@elaraai/east";
 * import { UIComponentType } from "@elaraai/east-ui";
 * import { Schematic } from "@elaraai/e3-ui";
 *
 * const floor = East.function([], UIComponentType, ($) => {
 *     const equipment = $.const([
 *         { id: "A01", x: 2.4, y: 2.9, kind: "42U · 8 kW", used: 5.2, cap: 8.0, metric: "5.2 kW", state: some(variant("success", null)), w: 3.2 },
 *         { id: "A02", x: 6.0, y: 2.9, kind: "42U · 8 kW", used: 7.4, cap: 8.0, metric: "7.4 kW", state: some(variant("warning", null)), w: 3.2 },
 *         { id: "A03", x: 9.6, y: 2.9, kind: "42U · 8 kW", used: 3.9, cap: 8.0, metric: "3.9 kW", state: some(variant("success", null)), w: 3.2 },
 *         { id: "A04", x: 13.2, y: 2.9, kind: "48U · 12 kW", used: 9.6, cap: 12.0, metric: "9.6 kW", state: some(variant("success", null)), w: 3.2 },
 *         { id: "A05", x: 16.8, y: 2.9, kind: "48U · 12 kW", used: 0.0, cap: 12.0, metric: "reserved", state: some(variant("neutral", null)), w: 3.2 },
 *         { id: "MMR-1", x: 24.2, y: 2.9, kind: "demarc · 48 ports", used: 31.0, cap: 48.0, metric: "31 / 48", state: some(variant("info", null)), w: 4.0 },
 *         { id: "ODF-1", x: 8.4, y: 9.6, kind: "fibre frame · 288 F", used: 196.0, cap: 288.0, metric: "196 / 288", state: some(variant("success", null)), w: 12.8 },
 *         { id: "CORE-1", x: 23.2, y: 9.7, kind: "core · 64 ports", used: 41.0, cap: 64.0, metric: "41 / 64", state: some(variant("success", null)), w: 4.0 },
 *     ]);
 *     const areas = $.const([
 *         { id: "cage-a", name: "Cage A", x: 0.6, y: 0.6, w: 19.6, h: 4.6, pattern: Schematic.outline() },
 *         { id: "mmr", name: "Meet-me room", x: 21.0, y: 0.6, w: 6.4, h: 4.6, pattern: Schematic.outline() },
 *         { id: "cold-a", name: "Cold aisle A · 1.2 m", x: 0.6, y: 6.0, w: 26.8, h: 1.2, pattern: Schematic.hatch() },
 *         { id: "net-room", name: "Network room", x: 19.0, y: 7.8, w: 8.4, h: 3.8, pattern: Schematic.outline() },
 *     ]);
 *     // Already the resolved link type — passed through with no `link` mapper.
 *     const orthogonal = variant("orthogonal", { corner: none });
 *     // u2 + u2m share the same endpoint pair — the renderer fans them into
 *     // parallel lanes (#180) so both edges (the uplink and the out-of-band
 *     // management link) stay readable; labels/metrics render mid-path at
 *     // label zoom.
 *     const fibre = $.const([
 *         { key: "u1", from: "A01", to: "ODF-1", label: some("uplink"), metric: some("100G"), style: Schematic.solid(), route: orthogonal, via: [], layer: none },
 *         { key: "u2", from: "A02", to: "ODF-1", label: some("uplink"), metric: some("100G"), style: Schematic.solid(), route: orthogonal, via: [], layer: none },
 *         { key: "u2m", from: "A02", to: "ODF-1", label: some("OOB mgmt"), metric: none, style: Schematic.dashed(), route: orthogonal, via: [], layer: none },
 *         { key: "u3", from: "A03", to: "ODF-1", label: none, metric: none, style: Schematic.solid(), route: orthogonal, via: [], layer: none },
 *         { key: "u4", from: "A04", to: "ODF-1", label: none, metric: some("2 × 100G"), style: Schematic.solid(), route: orthogonal, via: [], layer: none },
 *         { key: "x1", from: "MMR-1", to: "CORE-1", label: none, metric: some("2 × 10G"), style: Schematic.dashed(), route: orthogonal, via: [{ x: 26.0, y: 6.6 }], layer: none },
 *     ], ArrayType(Schematic.Types.Link));
 *     return (
 *         <Schematic
 *             extent={{ width: 28, height: 12 }}
 *             height="440px"
 *             items={equipment}
 *             item={e => ({
 *                 key: e.id, x: e.x, y: e.y, label: e.id,
 *                 sublabel: e.kind, icon: "server",
 *                 status: e.state,
 *                 meter: { value: e.used, max: e.cap },
 *                 metric: e.metric,
 *                 width: e.w,
 *             })}
 *             zones={areas}
 *             zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h, pattern: z.pattern })}
 *             links={fibre}
 *             scaleUnit="m"
 *             grid={true}
 *         />
 *     );
 * });
 * ```
 */
export const Schematic: SchematicNamespace = Object.assign(SchematicTag, MEMBERS);

/**
 * The type of the internal Schematic namespace — the public one, the factory
 * the tag maps to, the root it returns through its carrier, and the carrier
 * the renderer registers against.
 */
export interface SchematicInternalNamespace extends SchematicNamespace {
    /** Creates the schematic — its root, through the `Schematic` carrier (the `<Schematic>` tag's factory, {@link createSchematicRoot}). */
    Root: typeof createSchematicRoot;
    /** Creates the schematic's root alone — what `Root` returns through the carrier ({@link createSchematicPayload}). */
    Payload: typeof createSchematicPayload;
    /** The `Schematic` carrier ({@link SchematicComponent}). */
    Component: typeof SchematicComponent;
}

/** `<Schematic>`, for the internal namespace: the tag, on an object of its own, so the public `Schematic` carries none of the internal members. */
function SchematicInternalTag(props: Parameters<SchematicTagType>[0]): ReturnType<SchematicTagType> {
    return SchematicTag(props);
}

/**
 * The internal Schematic namespace — `@elaraai/e3-ui/internal`'s `Schematic`:
 * the public one, `Schematic.Root`, `Schematic.Payload` and the `Schematic`
 * carrier, for the renderer and the tests.
 *
 * @internal
 */
export const SchematicInternal: SchematicInternalNamespace = Object.assign(SchematicInternalTag as SchematicTagType, MEMBERS, {
    Root: createSchematicRoot,
    Payload: createSchematicPayload,
    Component: SchematicComponent,
});
