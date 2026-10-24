/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic (#1381): the 2D world-coordinate drawing of the app's own
 * records, e3-ui's as the Plan, the Sheet and the Flowchart are.
 * `<Schematic>` declares its kinds over the app's records — items, zones,
 * links and nets, each record's fields mapped to the Schematic's roles — and
 * returns its payload through the `Schematic` carrier, which
 * e3-ui-components' renderer draws.
 *
 * - `types.ts` — the value types its accessors return, the references, boxes
 *   and the connect veto's candidate the Schematic speaks in, and the kinds'
 *   wire (`Schematic.Types.*`).
 * - `kinds.ts` — `Schematic.items`, `zones`, `links`, `nets` and `details`:
 *   each role's check, the binding a kind's read takes, and the closed
 *   functions over beast2 bytes.
 * - `templates.ts` — `Schematic.templates`, a kind's presets read from a
 *   record.
 * - `layers.ts` — `Schematic.layers`, the layers read from the app's record.
 * - `window.ts` — a kind's reads: whole, or complete through its source of
 *   the slice; and, read by area, which index and searches its window reads,
 *   the agreement of the index's box with its roles, and the density's raster.
 * - `library.ts` — `Schematic.library`, the library pane's tabs, and their
 *   wire.
 * - `shapes.ts` — the pattern, style and geometry helpers.
 * - `payload.ts` — the payload, its carrier, the shared keys, the props and
 *   their refusals.
 * - `schematic.ts` — the tag.
 *
 * @packageDocumentation
 */

import { SchedulePatchTypeFor, schedulePatch } from "../schedule/patch.js";
import { schematicDetails, schematicItems, schematicLinks, schematicNets, schematicZones } from "./kinds.js";
import { schematicLayers } from "./layers.js";
import { SchematicLibraryFactories, SchematicLibraryTabType, type SchematicLibrary } from "./library.js";
import { SchematicComponent, SchematicPayloadType, createSchematicPayload } from "./payload.js";
import { SchematicTag, type SchematicTagType } from "./schematic.js";
import { SchematicShapes } from "./shapes.js";
import { schematicTemplates } from "./templates.js";
import {
    SchematicBoxType, SchematicCandidateType, SchematicCardRolesType, SchematicDetailsEntryType, SchematicDetailsRolesType, SchematicKindDetailsType, SchematicEmphasisType,
    SchematicEndsType, SchematicGeometryType, SchematicItemEntryType, SchematicItemKindType, SchematicItemType, SchematicLayerType,
    SchematicLinkEntryType, SchematicLinkKindType, SchematicLinkStyleType, SchematicLinkType, SchematicMeterType, SchematicNarrowedType,
    SchematicNetEntryType, SchematicNetKindType, SchematicNetType, SchematicPointType, SchematicRefType, SchematicRouteType, SchematicSidesType,
    SchematicStatusCasesFor, SchematicStatusType, SchematicTemplateType, SchematicToneType, SchematicVertexType, SchematicZoneEntryType,
    SchematicZoneKindType, SchematicZonePatternType, SchematicZoneType,
} from "./types.js";

export { SchematicTag, type SchematicTagType } from "./schematic.js";
export {
    SCHEMATIC_DEF,
    isSchematicKind,
    schematicDetails,
    schematicItems,
    schematicLinks,
    schematicNets,
    schematicZones,
    type SchematicDetails,
    type SchematicDetailsConfig,
    type SchematicEnd,
    type SchematicEndField,
    type SchematicFloatField,
    type SchematicItems,
    type SchematicItemsConfig,
    type SchematicLinks,
    type SchematicLinksConfig,
    type SchematicMembersField,
    type SchematicNets,
    type SchematicNetsConfig,
    type SchematicPlaceField,
    type SchematicRecord,
    type SchematicSide,
    type SchematicStatusConfig,
    type SchematicStringField,
    type SchematicValuesOf,
    type SchematicViaField,
    type SchematicZones,
    type SchematicZonesConfig,
} from "./kinds.js";
export {
    SCHEMATIC_TEMPLATES,
    checkedSchematicTemplates,
    isSchematicTemplates,
    schematicTemplates,
    type SchematicTemplates,
    type SchematicTemplatesConfig,
} from "./templates.js";
export {
    SCHEMATIC_WINDOW_READ_ROWS,
    SCHEMATIC_WINDOW_ROWS,
    schematicAreaIndexes,
    schematicDensityCells,
    schematicRaster,
    schematicSourceRows,
    schematicUnplacedPlan,
    schematicWholeRows,
    schematicWindowPlan,
    type SchematicAreaIndexes,
    type SchematicDensityCell,
    type SchematicKindPart,
    type SchematicRaster,
    type SchematicUnplacedPlan,
    type SchematicWindowPlan,
} from "./window.js";
export { isSchematicLayers, schematicLayers, type SchematicLayers, type SchematicLayersConfig } from "./layers.js";
export {
    SchematicLibraryCardType,
    SchematicLibraryFactories,
    SchematicLibraryTabType,
    buildSchematicLibrary,
    schematicTabSources,
    type SchematicLibrary,
    type SchematicLibraryContext,
    type SchematicLibraryKind,
    type SchematicLibraryTab,
    type SchematicLibraryTabConfig,
} from "./library.js";
export {
    SchematicShapes,
    type SchematicPatternConfig,
    type SchematicPolylineConfig,
    type SchematicToneLiteral,
    type SchematicVertexInput,
    type SchematicVertices,
} from "./shapes.js";
export {
    SchematicComponent,
    SchematicPayloadType,
    createSchematicPayload,
    schematicKeys,
    type SchematicNarrowedOptions,
    type SchematicProps,
} from "./payload.js";

/** The East types a Schematic is written with — `Schematic.Types` (§4.7). */
export interface SchematicTypes {
    /** Shape geometry, drawn about its entity's anchor: a footprint, a zone's shape ({@link SchematicGeometryType}). */
    Geometry: typeof SchematicGeometryType;
    /** A polyline's or a polygon's vertex: an offset from the anchor, and its bulge ({@link SchematicVertexType}). */
    Vertex: typeof SchematicVertexType;
    /** A point in world units: a link's waypoint ({@link SchematicPointType}). */
    Point: typeof SchematicPointType;
    /** A theme tone ({@link SchematicToneType}). */
    Tone: typeof SchematicToneType;
    /** A zone's pattern — outline or hatch ({@link SchematicZonePatternType}). */
    ZonePattern: typeof SchematicZonePatternType;
    /** A link's style — solid or dashed ({@link SchematicLinkStyleType}). */
    LinkStyle: typeof SchematicLinkStyleType;
    /** A link's routing — orthogonal or direct ({@link SchematicRouteType}). */
    Route: typeof SchematicRouteType;
    /** How one case of a status shows ({@link SchematicStatusType}). */
    Status: typeof SchematicStatusType;
    /** `StatusCases(V)` — a Status per case of a status variant ({@link SchematicStatusCasesFor}). */
    StatusCases: typeof SchematicStatusCasesFor;
    /** `Patch(R)` — a patch over a kind's row type, every field an `Option` ({@link SchedulePatchTypeFor}). */
    Patch: typeof SchedulePatchTypeFor;
    /** A card's bar ({@link SchematicMeterType}). */
    Meter: typeof SchematicMeterType;
    /** An entity, named by its kind's slot and its key ({@link SchematicRefType}). */
    Ref: typeof SchematicRefType;
    /** A box in world units ({@link SchematicBoxType}). */
    Box: typeof SchematicBoxType;
    /** A layer ({@link SchematicLayerType}). */
    Layer: typeof SchematicLayerType;
    /** The matches' emphasis — halo or pulse ({@link SchematicEmphasisType}). */
    Emphasis: typeof SchematicEmphasisType;
    /** What a Connect, a Retarget or an Extend would write, as `canConnect` hears it ({@link SchematicCandidateType}). */
    Candidate: typeof SchematicCandidateType;
    /** An item's roles, as its kind reads them from the app's row ({@link SchematicItemType}). */
    Item: typeof SchematicItemType;
    /** A zone's roles ({@link SchematicZoneType}). */
    Zone: typeof SchematicZoneType;
    /** A link's roles ({@link SchematicLinkType}). */
    Link: typeof SchematicLinkType;
    /** A net's roles ({@link SchematicNetType}). */
    Net: typeof SchematicNetType;
}

/** The East types a Schematic is written with. */
const TYPES: SchematicTypes = {
    Geometry: SchematicGeometryType,
    Vertex: SchematicVertexType,
    Point: SchematicPointType,
    Tone: SchematicToneType,
    ZonePattern: SchematicZonePatternType,
    LinkStyle: SchematicLinkStyleType,
    Route: SchematicRouteType,
    Status: SchematicStatusType,
    StatusCases: SchematicStatusCasesFor,
    Patch: SchedulePatchTypeFor,
    Meter: SchematicMeterType,
    Ref: SchematicRefType,
    Box: SchematicBoxType,
    Layer: SchematicLayerType,
    Emphasis: SchematicEmphasisType,
    Candidate: SchematicCandidateType,
    Item: SchematicItemType,
    Zone: SchematicZoneType,
    Link: SchematicLinkType,
    Net: SchematicNetType,
};

/**
 * The type of the {@link Schematic} namespace: `<Schematic>`, its kinds, its
 * templates, its patches, its library's tabs, the pattern and geometry helpers
 * and its East types.
 */
export interface SchematicNamespace extends SchematicTagType {
    /** One kind of placed item over the app's record ({@link schematicItems}). */
    items: typeof schematicItems;
    /** One kind of zone over the app's record ({@link schematicZones}). */
    zones: typeof schematicZones;
    /** One kind of link over the app's record ({@link schematicLinks}). */
    links: typeof schematicLinks;
    /** One kind of net over the app's record ({@link schematicNets}). */
    nets: typeof schematicNets;
    /** A kind's details: a record of the app's keyed as its kind is ({@link schematicDetails}). */
    details: typeof schematicDetails;
    /** A kind's templates, read from a record ({@link schematicTemplates}). */
    templates: typeof schematicTemplates;
    /** The layers, read from the app's record ({@link schematicLayers}). */
    layers: typeof schematicLayers;
    /** A patch over a kind's row type: what an author's card dropped on an entity sets ({@link schedulePatch}). */
    patch: typeof schedulePatch;
    /** The library pane's tabs, each a factory `library` lists ({@link SchematicLibrary}). */
    library: SchematicLibrary;
    /** An `outline` zone pattern — the dashed boundary with an eyebrow label. */
    outline: typeof SchematicShapes.outline;
    /** A `hatch` zone pattern — the hatched band. */
    hatch: typeof SchematicShapes.hatch;
    /** A `solid` link style — a physical run. */
    solid: typeof SchematicShapes.solid;
    /** A `dashed` link style — a routing or logical connection. */
    dashed: typeof SchematicShapes.dashed;
    /** A `rect` geometry — the entity's box itself. */
    rect: typeof SchematicShapes.rect;
    /** A `circle` geometry — centred on the entity's anchor. */
    circle: typeof SchematicShapes.circle;
    /** A `polyline` geometry — about the entity's anchor, optionally a band. */
    polyline: typeof SchematicShapes.polyline;
    /** A `polygon` geometry — about the entity's anchor. */
    polygon: typeof SchematicShapes.polygon;
    /** The East types a Schematic is written with ({@link SchematicTypes}). */
    Types: SchematicTypes;
}

/** The namespace's members — everything `Schematic` carries beside the tag itself. */
const MEMBERS = {
    items: schematicItems,
    zones: schematicZones,
    links: schematicLinks,
    nets: schematicNets,
    details: schematicDetails,
    templates: schematicTemplates,
    layers: schematicLayers,
    patch: schedulePatch,
    library: SchematicLibraryFactories,
    ...SchematicShapes,
    Types: TYPES,
};

/**
 * `<Schematic>` — the 2D world-coordinate drawing of the app's own records:
 * placed items (racks, cooling units, power distribution units), zones (halls,
 * cages, hot and cold aisles), links between two items (fibre runs) and nets
 * joining many to many (a power distribution unit feeding a row of racks).
 *
 * @remarks
 * - **Its kinds** are the app's records (§1): `items`, `zones`, `links` and
 *   `nets` each map a slot to a kind — `Schematic.items(record, { … })` and
 *   the rest — whose roles are the record's fields, named, or accessors over
 *   a row and its key. A role naming a missing field, or one of another type,
 *   is refused when the surface is built. A slot names the kind in the
 *   payload, and the source of the slice that narrows it.
 * - **Editable or read only by its binding** (§1, rule 4): a kind bound with
 *   its patch door, `Record.bind(record, [e3.mutation.patch(record)])`, is
 *   editable; one bound `Data.bind(record)`, or `Data.bindPaged(record)` read
 *   through its source, is read only. `readOnly` makes every kind so.
 * - **Its details** (`Schematic.details`): a record keyed as its kind is,
 *   whose status, bar, figure and second line the cards draw.
 * - **Its narrowing** is one `Slice.bindRecords`: a source named after a
 *   kind's slot narrows that kind, read complete through it, and each other
 *   source the templates list or the author's tab that names it.
 * - **Geometry is drawn about its entity's anchor** (D22): an item's centre,
 *   or a zone's box centre, so an outline moves with its item. A footprint
 *   or a zone's shape is an accessor building it from the row's own fields
 *   (`Schematic.circle`, `polygon`, …), so the app's record keeps its own
 *   types (D35).
 * - **Its props are the Plan's, the Roster's and the Calendar's** (D31–D34,
 *   D36): `id`, an inspector you opt into, library tabs over every kind,
 *   `onSelect` hearing the whole selection, `canConnect` answering a candidate
 *   with the refusal's words, and layers read from the app's record
 *   (`Schematic.layers`).
 * - **Refused when the surface is built**, each naming the form that
 *   replaces it: rows and their mappers, the callbacks for an edit,
 *   `linkMode`, the per-domain read-only switches, the hover cards, the
 *   slice's effect props, `sliceSelectField`, `selectionMode`, `navigator`,
 *   `height` and `maxHeight`, `onSelectZone`, `onSelectionChange`,
 *   `onZoneSelectionChange`, `onSelectLink`, `onViewportChange`, `onItemOpen`,
 *   `selectZoomFocus`, `name`, an `inspector` object and a `layers` list (§2).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { DictType, East, FloatType, StringType, StructType } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Schematic } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const FloorRack = StructType({ name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, model: StringType, kw: FloatType, capacity: FloatType });
 * export const schematicFloorRacks = e3.record("schematic_floor_racks", DictType(StringType, FloorRack), new Map([
 *     ["A01", { name: "A01", x: 2.4, y: 2.9, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 5.2, capacity: 8.0 }],
 *     ["A02", { name: "A02", x: 6.0, y: 2.9, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 7.4, capacity: 8.0 }],
 *     ["A03", { name: "A03", x: 9.6, y: 2.9, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 3.9, capacity: 8.0 }],
 *     ["A04", { name: "A04", x: 13.2, y: 2.9, w: 3.2, h: 1.2, model: "48U · 12 kW", kw: 9.6, capacity: 12.0 }],
 *     ["B01", { name: "B01", x: 2.4, y: 8.6, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 6.1, capacity: 8.0 }],
 *     ["B02", { name: "B02", x: 6.0, y: 8.6, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 2.8, capacity: 8.0 }],
 * ]));
 *
 * const schematicFloor = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const racks = $.let(Data.bind(schematicFloorRacks));
 *         return (
 *             <Box height="440px">
 *                 <Schematic
 *                     id="floor"
 *                     extent={{ width: 18, height: 12 }}
 *                     scaleUnit="m"
 *                     items={{
 *                         racks: Schematic.items(racks, {
 *                             name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name",
 *                             sublabel: (r) => r.model,
 *                             meter: (r) => ({ value: r.kw, max: r.capacity }),
 *                         }),
 *                     }}
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export const Schematic: SchematicNamespace = Object.assign(SchematicTag, MEMBERS);

/**
 * The type of the internal Schematic namespace — the public one, the payload
 * the tag returns through its carrier, the carrier the renderer registers
 * against, and the payload's own East types.
 */
export interface SchematicInternalNamespace extends SchematicNamespace {
    /** Creates the Schematic's payload alone — what `<Schematic>` returns through the `Schematic` carrier ({@link createSchematicPayload}). */
    Payload: typeof createSchematicPayload;
    /** The `Schematic` carrier ({@link SchematicComponent}). */
    Component: typeof SchematicComponent;
    /** The East types a Schematic is written with, and its payload's. */
    Types: SchematicTypes & {
        /** The renderer's payload ({@link SchematicPayloadType}). */
        Payload: typeof SchematicPayloadType;
        /** An item kind, closed ({@link SchematicItemKindType}). */
        ItemKind: typeof SchematicItemKindType;
        /** A zone kind, closed ({@link SchematicZoneKindType}). */
        ZoneKind: typeof SchematicZoneKindType;
        /** A link kind, closed ({@link SchematicLinkKindType}). */
        LinkKind: typeof SchematicLinkKindType;
        /** A net kind, closed ({@link SchematicNetKindType}). */
        NetKind: typeof SchematicNetKindType;
        /** A kind's details, closed ({@link SchematicKindDetailsType}). */
        Details: typeof SchematicKindDetailsType;
        /** A details row's roles ({@link SchematicDetailsRolesType}). */
        DetailsRoles: typeof SchematicDetailsRolesType;
        /** Which of a card's roles its kind's details give ({@link SchematicCardRolesType}). */
        CardRoles: typeof SchematicCardRolesType;
        /** A stored item: its roles and its row's bytes ({@link SchematicItemEntryType}). */
        ItemEntry: typeof SchematicItemEntryType;
        /** A stored zone ({@link SchematicZoneEntryType}). */
        ZoneEntry: typeof SchematicZoneEntryType;
        /** A stored link ({@link SchematicLinkEntryType}). */
        LinkEntry: typeof SchematicLinkEntryType;
        /** A stored net ({@link SchematicNetEntryType}). */
        NetEntry: typeof SchematicNetEntryType;
        /** A stored details row ({@link SchematicDetailsEntryType}). */
        DetailsEntry: typeof SchematicDetailsEntryType;
        /** A link's ends, as a gesture writes them ({@link SchematicEndsType}). */
        Ends: typeof SchematicEndsType;
        /** A net's sides, as a gesture writes them ({@link SchematicSidesType}). */
        Sides: typeof SchematicSidesType;
        /** One template ({@link SchematicTemplateType}). */
        Template: typeof SchematicTemplateType;
        /** How a narrowed-out row draws ({@link SchematicNarrowedType}). */
        Narrowed: typeof SchematicNarrowedType;
        /** One tab of the library ({@link SchematicLibraryTabType}). */
        LibraryTab: typeof SchematicLibraryTabType;
    };
}

/** `<Schematic>`, for the internal namespace: the tag, on an object of its own, so the public `Schematic` carries none of the internal members. */
function SchematicInternalTag(props: Parameters<SchematicTagType>[0]): ReturnType<SchematicTagType> {
    return SchematicTag(props);
}

/**
 * The internal Schematic namespace — `@elaraai/e3-ui/internal`'s `Schematic`:
 * the public one, `Schematic.Payload`, the `Schematic` carrier and the
 * payload's types, for the renderer and the tests.
 *
 * @internal
 */
export const SchematicInternal: SchematicInternalNamespace = Object.assign(SchematicInternalTag as SchematicTagType, MEMBERS, {
    Payload: createSchematicPayload,
    Component: SchematicComponent,
    Types: {
        ...TYPES,
        Payload: SchematicPayloadType,
        ItemKind: SchematicItemKindType,
        ZoneKind: SchematicZoneKindType,
        LinkKind: SchematicLinkKindType,
        NetKind: SchematicNetKindType,
        Details: SchematicKindDetailsType,
        DetailsRoles: SchematicDetailsRolesType,
        CardRoles: SchematicCardRolesType,
        ItemEntry: SchematicItemEntryType,
        ZoneEntry: SchematicZoneEntryType,
        LinkEntry: SchematicLinkEntryType,
        NetEntry: SchematicNetEntryType,
        DetailsEntry: SchematicDetailsEntryType,
        Ends: SchematicEndsType,
        Sides: SchematicSidesType,
        Template: SchematicTemplateType,
        Narrowed: SchematicNarrowedType,
        LibraryTab: SchematicLibraryTabType,
    },
});
