/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's East types (#1386, #1401, `Schematic Builder Spec.md` §4.7,
 * §4.8, §5): the value types its accessors return and its wire carries
 * (`Schematic.Types`) — an app's records hold their own types, which the
 * accessors map (D35) — the references, boxes and the connect veto's candidate
 * the Schematic speaks in, and the kinds' wire: each kind closed over the
 * app's record behind East functions over beast2 bytes, so the payload is one
 * type whatever the rows hold.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DictType, EastTypeType, FloatType, FunctionType, NullType, OptionType, StringType, StructType, VariantType,
} from "@elaraai/east";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { StatusTokenType } from "@elaraai/east-ui";
import { EditingReadinessType, EditingType, FieldSpecType } from "@elaraai/east-ui/internal";
import { ScheduleEntriesType, ScheduleFieldWriteType, ScheduleReadyEntryType } from "../schedule/types.js";
import { RowInspectorType } from "../utils/row-inspector.js";

// ============================================================================
// The value types the accessors return
// ============================================================================

/**
 * Theme tone for zone strokes, hatching, links and items.
 *
 * @remarks
 * Colour stays theme-owned: data selects a tone and the renderer's recipe
 * maps each tone to its token.
 *
 * @property brand - Brand teal
 * @property ink - Foreground ink
 * @property muted - Muted foreground
 * @property success - Status ok
 * @property warning - Status warn
 * @property danger - Status bad
 */
export const SchematicToneType = VariantType({
    /** Brand teal */
    brand: NullType,
    /** Foreground ink */
    ink: NullType,
    /** Muted foreground */
    muted: NullType,
    /** Status ok */
    success: NullType,
    /** Status warn */
    warning: NullType,
    /** Status bad */
    danger: NullType,
});

/** Type representing schematic tones. */
export type SchematicToneType = typeof SchematicToneType;

/**
 * Zone render pattern — each case carries its style configuration.
 *
 * @property outline - Dashed boundary with an eyebrow label (halls, cages)
 * @property hatch - Hatched band (hot and cold aisles, exclusion zones): an annotation, holding no items and taking no tap
 */
export const SchematicZonePatternType = VariantType({
    /** Dashed boundary with an eyebrow label (halls, cages) */
    outline: StructType({
        /** Stroke tone (default `muted`) */
        tone: OptionType(SchematicToneType),
    }),
    /** Hatched band (hot and cold aisles, exclusion zones) */
    hatch: StructType({
        /** Hatch-line tone (default `muted`) */
        tone: OptionType(SchematicToneType),
        /** Line spacing in pixels (default 8) */
        spacing: OptionType(FloatType),
        /** Line angle in degrees (default 45) */
        angle: OptionType(FloatType),
    }),
});

/** Type representing zone patterns. */
export type SchematicZonePatternType = typeof SchematicZonePatternType;

/**
 * Link render style — each case carries its stroke configuration.
 *
 * @property solid - A physical run (fibre, power cable)
 * @property dashed - A routing / logical connection
 */
export const SchematicLinkStyleType = VariantType({
    /** A physical run (fibre, power cable) */
    solid: StructType({
        /** Stroke tone (default: the links' muted ink, #1403) */
        tone: OptionType(SchematicToneType),
        /** Stroke width in pixels (default 2.5) */
        weight: OptionType(FloatType),
    }),
    /** A routing / logical connection */
    dashed: StructType({
        /** Stroke tone (default: the links' muted ink, #1403) */
        tone: OptionType(SchematicToneType),
        /** Stroke width in pixels (default 1.5) */
        weight: OptionType(FloatType),
    }),
});

/** Type representing link styles. */
export type SchematicLinkStyleType = typeof SchematicLinkStyleType;

/**
 * Link routing mode.
 *
 * @remarks
 * `orthogonal` (the default) routes axis-aligned with rounded corners — the
 * conventional cable-plan look; `direct` draws straight segments between
 * anchors. `via` waypoints apply in both modes.
 *
 * @property orthogonal - Axis-aligned with rounded corners
 * @property direct - Straight segments between anchors
 */
export const SchematicRouteType = VariantType({
    /** Axis-aligned with rounded corners */
    orthogonal: StructType({
        /** Corner radius in pixels (default 8) */
        corner: OptionType(FloatType),
    }),
    /** Straight segments between anchors */
    direct: NullType,
});

/** Type representing link routing modes. */
export type SchematicRouteType = typeof SchematicRouteType;

/**
 * A point in world units: an item's centre, or a link's waypoint.
 *
 * @property x - World x
 * @property y - World y
 */
export const SchematicPointType = StructType({
    /** World x */
    x: FloatType,
    /** World y */
    y: FloatType,
});

/** Type representing world points. */
export type SchematicPointType = typeof SchematicPointType;

/**
 * A polyline / polygon vertex — an offset from its entity's anchor in world
 * units, plus a DXF `bulge`.
 *
 * @remarks
 * Geometry is drawn about its entity's anchor (D22): an item's centre, or a
 * zone's box centre. `bulge` encodes the edge from THIS vertex to the NEXT
 * one: `0` is a straight segment; nonzero is a circular arc where
 * `bulge = tan(includedAngle / 4)` and the sign gives the turn direction
 * (positive = counter-clockwise in world space), so curved walls and cable
 * routes are stored exactly. For a closed `polygon`, the last vertex's `bulge`
 * applies to the closing edge back to the first vertex.
 *
 * @property x - Offset from the anchor along x, in world units
 * @property y - Offset from the anchor along y, in world units
 * @property bulge - DXF bulge for the edge to the next vertex (0 = straight)
 */
export const SchematicVertexType = StructType({
    /** Offset from the anchor along x, in world units */
    x: FloatType,
    /** Offset from the anchor along y, in world units */
    y: FloatType,
    /** DXF bulge for the edge to the next vertex (0 = straight; `tan(includedAngle / 4)`) */
    bulge: FloatType,
});

/** Type representing a polyline / polygon vertex. */
export type SchematicVertexType = typeof SchematicVertexType;

/**
 * Shape geometry: an item's `footprint` and a zone's `geometry`, drawn about
 * the entity's anchor (D22) — an item's centre, or a zone's box centre.
 *
 * @remarks
 * Geometry is what the renderer strokes and fills; the entity's box — an
 * item's `width` and `height` about its centre, a zone's `x`, `y`, `width`
 * and `height` — stays its bounds, and geometry outside its box still draws.
 * So an item's outline moves with it, and a template's lands where it is
 * dropped. An import that holds world coordinates subtracts the anchor once.
 *
 * @property rect - The entity's box itself: a zone's rect, an item's card and marker
 * @property circle - A circle centred on the anchor; `radius` in world units (columns, cooling towers)
 * @property polyline - An open, arc-aware polyline, its vertices offsets from the anchor; an optional band `width` in world units
 * @property polygon - A closed, arc-aware polygon (>= 3 vertices, auto-closed), its vertices offsets from the anchor
 */
export const SchematicGeometryType = VariantType({
    /** The entity's box itself. */
    rect: NullType,
    /** A circle centred on the anchor; `radius` in world units. */
    circle: StructType({
        /** Circle radius in world units. */
        radius: FloatType,
    }),
    /** An open, arc-aware polyline about the anchor; optional band width. */
    polyline: StructType({
        /** Vertices, offsets from the anchor, in order (each carries a DXF bulge). */
        vertices: ArrayType(SchematicVertexType),
        /** Optional band width in world units — the stroke widens into a duct bank / aisle. */
        width: OptionType(FloatType),
    }),
    /** A closed, arc-aware polygon about the anchor (>= 3 vertices, auto-closed). */
    polygon: StructType({
        /** Boundary vertices, offsets from the anchor, in order (each carries a DXF bulge). */
        vertices: ArrayType(SchematicVertexType),
    }),
});

/** Type representing shape geometry. */
export type SchematicGeometryType = typeof SchematicGeometryType;

/**
 * How one case of an item's status shows: on its card's dot and its marker.
 *
 * @property label - Its words
 * @property tone - Its tone: success, warning, danger, info or neutral
 * @property ring - Whether it draws as an open ring, as a tentative status does
 */
export const SchematicStatusType = StructType({ label: StringType, tone: StatusTokenType, ring: BooleanType });

/** Type representing a status case's look. */
export type SchematicStatusType = typeof SchematicStatusType;

/**
 * One {@link SchematicStatusType} per case of a status variant: the `cases`
 * an item kind's `status` takes.
 *
 * @typeParam C - The variant's cases
 */
export type SchematicStatusCasesType<C extends Record<string, unknown>> = StructType<{ [K in keyof C]: SchematicStatusType }>;

/**
 * Constructs the status table of a status variant: one
 * {@link SchematicStatusType} per case.
 *
 * @typeParam V - The status variant
 * @param statusType - The status variant
 * @returns A struct with a field per case
 * @throws {Error} When the type is not a variant
 */
export function SchematicStatusCasesFor<V extends VariantType>(statusType: V): SchematicStatusCasesType<V["cases"]> {
    if ((statusType as { type: string }).type !== "Variant") throw new Error("Schematic.Types.StatusCases: a status is a variant, one case per status");
    const cases = Object.keys(statusType.cases);
    return StructType(Object.fromEntries(cases.map((c) => [c, SchematicStatusType]))) as unknown as SchematicStatusCasesType<V["cases"]>;
}

/**
 * A card's bar: how full an item is.
 *
 * @property value - What it holds
 * @property max - What it holds at most
 */
export const SchematicMeterType = StructType({ value: FloatType, max: FloatType });

/** Type representing a card's bar. */
export type SchematicMeterType = typeof SchematicMeterType;

/**
 * An entity, named by its kind's slot and its key: a rack in the `racks`
 * item slot, a fibre run in the `fibre` link slot.
 *
 * @property kind - The kind's slot name
 * @property key - The entity's key
 */
export const SchematicRefType = StructType({ kind: StringType, key: StringType });

/** Type representing an entity's reference. */
export type SchematicRefType = typeof SchematicRefType;

/**
 * A box in world units: its minimum and maximum corners.
 *
 * @property minX - Left edge
 * @property minY - Top edge
 * @property maxX - Right edge
 * @property maxY - Bottom edge
 */
export const SchematicBoxType = StructType({ minX: FloatType, minY: FloatType, maxX: FloatType, maxY: FloatType });

/** Type representing a box in world units. */
export type SchematicBoxType = typeof SchematicBoxType;

/**
 * A named layer — a cross-cutting group of items, zones, links and nets the
 * Layers tab shows, hides, isolates and locks together (§8) — as
 * `Schematic.layers` reads it from the app's record (D36).
 *
 * @remarks
 * Membership is by key: an entity's `layer` names the layer it is on, by the
 * layers record's key. The viewer's choices are view state, which the renderer
 * keeps; `visible` and `locked` here are the author's defaults those choices
 * override.
 *
 * @property key - Layer identity: its record's key, which entities name in their `layer`
 * @property label - Its name
 * @property visible - Author default visibility; absent / `some(true)` ⇒ shown, `some(false)` ⇒ ships hidden
 * @property locked - Author default lock (non-selectable); absent ⇒ unlocked
 * @property opacity - Optional dim (0–1) for the layer's items; absent ⇒ full
 * @property tone - Optional swatch tone
 * @property color - Optional swatch colour: a theme colour token (`status.warn`), over its tone
 */
export const SchematicLayerType = StructType({
    /** Layer identity: its record's key, which entities name in their `layer`. */
    key: StringType,
    /** Its name. */
    label: StringType,
    /** Author default visibility; `some(false)` ships hidden, absent ⇒ shown. */
    visible: OptionType(BooleanType),
    /** Author default lock (non-selectable); absent ⇒ unlocked. */
    locked: OptionType(BooleanType),
    /** Optional dim (0–1) for the layer's items; absent ⇒ full. */
    opacity: OptionType(FloatType),
    /** Optional swatch tone. */
    tone: OptionType(SchematicToneType),
    /** Optional swatch colour: a theme colour token (`status.warn`), over its tone. */
    color: OptionType(StringType),
});

/** Type representing a layer. */
export type SchematicLayerType = typeof SchematicLayerType;

/**
 * Positive emphasis on the rows a narrowing holds, when narrowed-out rows are
 * dimmed rather than hidden (§10.3).
 *
 * @property halo - A static ring on each match
 * @property pulse - A ring that breathes
 */
export const SchematicEmphasisType = VariantType({
    /** A static ring on each match. */
    halo: NullType,
    /** A ring that breathes. */
    pulse: NullType,
});

/** Type representing the matches' emphasis. */
export type SchematicEmphasisType = typeof SchematicEmphasisType;

/**
 * How a narrowed-out row draws (§10.3): hidden, or as context.
 *
 * @property show - `hide` (the default) or `dim`
 * @property opacity - A dimmed row's opacity (0.35 by default)
 * @property desaturate - Whether a dimmed row is drained of colour (on by default)
 * @property dot - Whether a dimmed row draws as a bare marker
 * @property emphasis - A ring on each match, whatever `show` is
 * @property frame - Whether the matches are boxed
 * @property fit - Whether the camera flies to the matches when the narrowing changes
 */
export const SchematicNarrowedType = StructType({
    show: VariantType({ hide: NullType, dim: NullType }),
    opacity: FloatType,
    desaturate: BooleanType,
    dot: BooleanType,
    emphasis: OptionType(SchematicEmphasisType),
    frame: BooleanType,
    fit: BooleanType,
});

/** Type representing how a narrowed-out row draws. */
export type SchematicNarrowedType = typeof SchematicNarrowedType;

// ============================================================================
// The connect veto's candidate
// ============================================================================

/**
 * What a Connect, a Retarget or an Extend would write, as `canConnect` hears
 * it before the draft snaps (§5, D34): the link or net kind the gesture writes
 * and its two items.
 *
 * @property kind - The slot of the link or net kind the gesture writes
 * @property from - The item it would run from: a link's `from`, a net's feeding member
 * @property to - The item it would run to: a link's `to`, a net's fed member
 */
export const SchematicCandidateType = StructType({ kind: StringType, from: SchematicRefType, to: SchematicRefType });

/** Type representing the connect veto's candidate. */
export type SchematicCandidateType = typeof SchematicCandidateType;

// ============================================================================
// The roles a kind's rows give the renderer (§4.8)
// ============================================================================

/**
 * One placed item's roles, as its kind reads them from the app's row: what
 * the canvas draws it by.
 *
 * @property position - Its centre in world units; `none` for a row of a kind with a backlog that has no position yet
 * @property label - Its card's name and its labelled dot
 * @property width - Its box's width about its centre: its card's width and the bounds its footprint lies in
 * @property height - Its box's height about its centre
 * @property footprint - The shape drawn at card zoom, about its centre
 * @property layer - The layer it is on
 * @property icon - Its card's Font Awesome solid icon
 * @property sublabel - Its card's second line
 * @property metric - Its card's figure
 * @property meter - Its card's bar
 * @property status - Its status, as its kind's `status` shows the case its row holds
 * @property tone - An override of the status colour
 * @property color - An override of the status colour: a theme colour token (D14)
 * @property weight - Its footprint's stroke
 * @property fillOpacity - Its footprint's fill
 */
export const SchematicItemType = StructType({
    position: OptionType(SchematicPointType),
    label: StringType,
    width: OptionType(FloatType),
    height: OptionType(FloatType),
    footprint: OptionType(SchematicGeometryType),
    layer: OptionType(StringType),
    icon: OptionType(StringType),
    sublabel: OptionType(StringType),
    metric: OptionType(StringType),
    meter: OptionType(SchematicMeterType),
    status: OptionType(SchematicStatusType),
    tone: OptionType(SchematicToneType),
    color: OptionType(StringType),
    weight: OptionType(FloatType),
    fillOpacity: OptionType(FloatType),
});

/** Type representing an item's roles. */
export type SchematicItemType = typeof SchematicItemType;

/**
 * One zone's roles: a hall, a cage, an aisle.
 *
 * @property x - Its box's top-left corner, in world units
 * @property y - Its box's top
 * @property width - Its box's width
 * @property height - Its box's height
 * @property label - The eyebrow on its boundary
 * @property pattern - Outline, or hatch
 * @property geometry - Its drawn shape, about its box's centre; its box stays its bounds
 * @property layer - The layer it is on
 * @property tone - An override of its pattern's tone
 * @property color - An override of its pattern's tone: a theme colour token (D14)
 * @property fillOpacity - Its fill
 * @property weight - Its stroke
 */
export const SchematicZoneType = StructType({
    x: FloatType,
    y: FloatType,
    width: FloatType,
    height: FloatType,
    label: StringType,
    pattern: SchematicZonePatternType,
    geometry: OptionType(SchematicGeometryType),
    layer: OptionType(StringType),
    tone: OptionType(SchematicToneType),
    color: OptionType(StringType),
    fillOpacity: OptionType(FloatType),
    weight: OptionType(FloatType),
});

/** Type representing a zone's roles. */
export type SchematicZoneType = typeof SchematicZoneType;

/**
 * One link's roles: a fibre run between two items.
 *
 * @property from - The item it runs from
 * @property to - The item it runs to
 * @property via - Its waypoints, in world units, in order
 * @property label - Its caption, on a knockout at its path's middle
 * @property metric - The figure after its label
 * @property style - Solid or dashed, its tone and its weight
 * @property route - Orthogonal or direct
 * @property layer - The layer it is on
 */
export const SchematicLinkType = StructType({
    from: SchematicRefType,
    to: SchematicRefType,
    via: ArrayType(SchematicPointType),
    label: OptionType(StringType),
    metric: OptionType(StringType),
    style: SchematicLinkStyleType,
    route: SchematicRouteType,
    layer: OptionType(StringType),
});

/** Type representing a link's roles. */
export type SchematicLinkType = typeof SchematicLinkType;

/**
 * One net's roles: a trunk joining many items to many, as a power
 * distribution unit feeds a row of racks.
 *
 * @property sources - The items on its feeding side
 * @property destinations - The items on its fed side
 * @property via - Its trunk's waypoints, in world units, in order
 * @property label - Its caption, on a knockout at its trunk's middle
 * @property metric - The figure after its label
 * @property style - Solid or dashed, its tone and its weight
 * @property route - Its trunk: orthogonal or direct
 * @property layer - The layer it is on
 */
export const SchematicNetType = StructType({
    sources: ArrayType(SchematicRefType),
    destinations: ArrayType(SchematicRefType),
    via: ArrayType(SchematicPointType),
    label: OptionType(StringType),
    metric: OptionType(StringType),
    style: SchematicLinkStyleType,
    route: SchematicRouteType,
    layer: OptionType(StringType),
});

/** Type representing a net's roles. */
export type SchematicNetType = typeof SchematicNetType;

/**
 * A details row's roles (§4.5): what an item's card draws from the details
 * record keyed as its kind is.
 *
 * @property status - Its status
 * @property meter - Its card's bar
 * @property metric - Its card's figure
 * @property sublabel - Its card's second line
 */
export const SchematicDetailsRolesType = StructType({
    status: OptionType(SchematicStatusType),
    meter: OptionType(SchematicMeterType),
    metric: OptionType(StringType),
    sublabel: OptionType(StringType),
});

/** Type representing a details row's roles. */
export type SchematicDetailsRolesType = typeof SchematicDetailsRolesType;

/**
 * Which of an item's card's roles its kind's details give (§4.5): what a card
 * keeps the place of while its details row is read, and draws there as a
 * placeholder until the row lands (#1398) — never a value it has not read.
 *
 * @property status - Whether the details give its status
 * @property meter - Whether they give its card's bar
 * @property metric - Whether they give its card's figure
 * @property sublabel - Whether they give its card's second line
 */
export const SchematicCardRolesType = StructType({ status: BooleanType, meter: BooleanType, metric: BooleanType, sublabel: BooleanType });

/** Type representing which of a card's roles its details give. */
export type SchematicCardRolesType = typeof SchematicCardRolesType;

/**
 * One stored row as a kind's `rows` gives it: its roles, read in the pass
 * that reads the row, and the row as bytes at the record's row type — what a
 * write and the editing session take.
 *
 * @typeParam R - The roles' type
 * @param roles - The roles' type
 * @returns The entry's type
 */
export function SchematicEntryType<R extends StructType>(roles: R) {
    return StructType({ roles, row: BlobType });
}

/** One stored item: its roles and its row's bytes. */
export const SchematicItemEntryType = SchematicEntryType(SchematicItemType);
/** One stored zone: its roles and its row's bytes. */
export const SchematicZoneEntryType = SchematicEntryType(SchematicZoneType);
/** One stored link: its roles and its row's bytes. */
export const SchematicLinkEntryType = SchematicEntryType(SchematicLinkType);
/** One stored net: its roles and its row's bytes. */
export const SchematicNetEntryType = SchematicEntryType(SchematicNetType);
/** One stored details row: its roles and its row's bytes. */
export const SchematicDetailsEntryType = SchematicEntryType(SchematicDetailsRolesType);

/**
 * The fields a kind's box is, as its roles name them (§11.4): what an area
 * index its source lists must name too, for the kind to be read by area — an
 * item's placed by its centre, a zone's by its corner.
 *
 * @property x - The field its box's `x` is
 * @property y - The field its box's `y` is
 * @property width - The field its box's width is; `none` for an item kind with no box, whose items are points
 * @property height - The field its box's height is; `none` as `width` is
 */
export const SchematicBoxFieldsType = StructType({ x: StringType, y: StringType, width: OptionType(StringType), height: OptionType(StringType) });

/** Type representing the fields a kind's box is. */
export type SchematicBoxFieldsType = typeof SchematicBoxFieldsType;

/**
 * A link's ends, as Connect and Retarget write them.
 *
 * @property from - The item it runs from
 * @property to - The item it runs to
 */
export const SchematicEndsType = StructType({ from: SchematicRefType, to: SchematicRefType });

/** Type representing a link's ends. */
export type SchematicEndsType = typeof SchematicEndsType;

/**
 * A net's sides, as Connect's Shift session, a leg's Delete and Extend write
 * them.
 *
 * @property sources - The items on its feeding side
 * @property destinations - The items on its fed side
 */
export const SchematicSidesType = StructType({ sources: ArrayType(SchematicRefType), destinations: ArrayType(SchematicRefType) });

/** Type representing a net's sides. */
export type SchematicSidesType = typeof SchematicSidesType;

/**
 * One template, as the library lists it and a drop creates from it (§4.6).
 *
 * @property key - Its key: its record's key
 * @property name - Its card's name
 * @property group - The library's group for it
 * @property icon - Its card's Font Awesome solid icon
 * @property values - Every field of the row but what a drop places, as bytes
 */
export const SchematicTemplateType = StructType({
    key: StringType,
    name: StringType,
    group: OptionType(StringType),
    icon: OptionType(StringType),
    values: BlobType,
});

/** Type representing a template. */
export type SchematicTemplateType = typeof SchematicTemplateType;

// ============================================================================
// The kinds' wire (§4.8)
// ============================================================================

/** A record's commits, newest first, as its handle reads them. */
const HistoryType = FunctionType([], OptionType(ArrayType(RecordCommitInfoType)));

/** The author's check over drafted entries, one result each. */
const ReadyType = FunctionType([ArrayType(ScheduleReadyEntryType)], ArrayType(EditingReadinessType));

/**
 * What every kind and a kind's details carry: how the record is read and
 * written, and the inspector's form.
 *
 * @property editable - Whether the record is bound with its patch door: what its gestures, drops and edits write
 * @property editing - The shared session over the record, with its patch door; `none` for a record bound read only
 * @property entries - The record read by key, for a record read through its source or bound with `Data.bindPaged`; `none` for one read whole
 * @property history - The record's commits, newest first; `none` for a record bound with `Data.bind` or `Data.bindPaged`
 * @property fields - The inspector's form over the fields no role writes (`Fields`)
 * @property inspector - The kind's own Details in place of its form, over bytes
 * @property ready - The app's check on drafted rows, one result each
 * @property set - The row with each field write applied in order — a field at any depth, its value as bytes at the field's type — and every other field as it was: what an author's card dropped on an entity sets (#1390); `none` for a write naming no field of the row
 * @property rowType - The record's row type
 */
const RecordSideFields = {
    editable: BooleanType,
    editing: OptionType(EditingType),
    entries: OptionType(ScheduleEntriesType),
    history: OptionType(HistoryType),
    fields: ArrayType(FieldSpecType),
    inspector: OptionType(RowInspectorType),
    ready: OptionType(ReadyType),
    set: FunctionType([BlobType, ArrayType(ScheduleFieldWriteType)], OptionType(BlobType)),
    rowType: EastTypeType,
} as const;

/**
 * What a reader read of a record by key or by area, made its stored rows
 * (#1393): the rows as beast2 bytes of an `Array` of `{ key: String, row: R }`
 * at the record's row type `R`, each row's roles read in one pass beside its
 * bytes.
 */
const RowsRead = <E extends StructType>(entry: E) => FunctionType([BlobType], DictType(StringType, entry));

/**
 * A kind's details (§4.5), closed: a record of the app's, keyed as its kind
 * is, which the inspector shows beside the row and the cards on screen draw.
 *
 * @property rows - The details read whole, by key, each its roles and its row; `none` while the read is in flight. `none` on the wire for details read by key, whose `entries` read them
 * @property rowsOf - The details rows a reader read by key, as bytes, made their roles beside their bytes: a window's cards' details, one request a window (#1393)
 * @property paged - The `id` of the paged read the details are read by key through, beside a kind read through its source: what a reader asks the rows of a window's cards from, all in one request (#1393); `none` for details read whole
 * @property read - A details row's roles, from its bytes and its key
 * @property roles - Which of the kind's cards' roles they give: what a card keeps the place of, a placeholder, while its details row is read (#1398)
 */
export const SchematicKindDetailsType = StructType({
    ...RecordSideFields,
    rows: OptionType(FunctionType([], OptionType(DictType(StringType, SchematicDetailsEntryType)))),
    rowsOf: RowsRead(SchematicDetailsEntryType),
    paged: OptionType(StringType),
    read: FunctionType([BlobType, StringType], SchematicDetailsRolesType),
    roles: SchematicCardRolesType,
});

/** Type representing a kind's details. */
export type SchematicKindDetailsType = typeof SchematicKindDetailsType;

/**
 * What every kind carries beside its record's side: its slot, its name, its
 * icon and its details.
 *
 * @property key - The kind's slot name
 * @property name - Its name
 * @property icon - Its Font Awesome solid icon; empty for an item kind whose cards' icons are an accessor's
 * @property details - Its details record; `none` for a kind with none
 */
const KindFields = {
    key: StringType,
    name: StringType,
    icon: StringType,
    details: OptionType(SchematicKindDetailsType),
    ...RecordSideFields,
} as const;

/** A kind's stored rows a read holds, by key: each its roles and its row; `none` while the read is in flight. */
const RowsOf = <E extends StructType>(entry: E) => FunctionType([], OptionType(DictType(StringType, entry)));

/**
 * One item kind, closed (§4.1, §4.8).
 *
 * @property backlog - Whether its `x` and `y` are Options: its rows with no position are its backlog
 * @property status - How each case of its status shows
 * @property rows - Its stored items a read holds, by key, each its roles and its row: its record read whole, or its narrowing read complete through its source
 * @property rowsOf - Its rows a reader read by area, or by key, as bytes, made its stored items: a window's (#1393)
 * @property paged - The `id` of the paged read its rows are read by key through, for a kind read through its source: what
 *   a reader asks the far ends of the links and nets touching its window of, all of a window's in one request (#1393);
 *   `none` for a kind read whole
 * @property box - The fields its box is, at its centre: what an area index it is read by names (§11.4)
 * @property read - A drafted row's roles, from its bytes and its key
 * @property write - The row with its position written — `none`, unplaced — and every other field as it was; `none` where it can't be: no position for a kind with no backlog
 * @property create - A new row at a position, every other field from a template's values or its type's default; `none` as `write` refuses
 * @property templates - Its templates
 * @property templatesSource - The slice's source its templates list names
 */
export const SchematicItemKindType = StructType({
    ...KindFields,
    backlog: BooleanType,
    status: ArrayType(StructType({ case: StringType, status: SchematicStatusType })),
    rows: RowsOf(SchematicItemEntryType),
    rowsOf: RowsRead(SchematicItemEntryType),
    paged: OptionType(StringType),
    box: SchematicBoxFieldsType,
    read: FunctionType([BlobType, StringType], SchematicItemType),
    write: FunctionType([BlobType, OptionType(SchematicPointType)], OptionType(BlobType)),
    create: FunctionType([OptionType(SchematicPointType), OptionType(BlobType)], OptionType(BlobType)),
    templates: ArrayType(SchematicTemplateType),
    templatesSource: OptionType(StringType),
});

/** Type representing an item kind. */
export type SchematicItemKindType = typeof SchematicItemKindType;

/**
 * One zone kind, closed (§4.2, §4.8). Zones take no gesture on the canvas:
 * their fields are edited through the inspector.
 *
 * @property rows - Its stored zones a read holds, by key, each its roles and its row: its record read whole, or its narrowing read complete through its source
 * @property rowsOf - Its rows a reader read by area, as bytes, made its stored zones: a window's (#1393)
 * @property box - The fields its box is, at its corner: what an area index it is read by names (§11.4)
 * @property read - A drafted row's roles, from its bytes and its key
 */
export const SchematicZoneKindType = StructType({
    ...KindFields,
    rows: RowsOf(SchematicZoneEntryType),
    rowsOf: RowsRead(SchematicZoneEntryType),
    box: SchematicBoxFieldsType,
    read: FunctionType([BlobType, StringType], SchematicZoneType),
});

/** Type representing a zone kind. */
export type SchematicZoneKindType = typeof SchematicZoneKindType;

/**
 * One link kind, closed (§4.3, §4.8).
 *
 * @property ends - The item slots each end holds keys of
 * @property rows - Its stored links a read holds, by key, each its roles and its row
 * @property read - A drafted row's roles, from its bytes and its key
 * @property write - The row with its ends written and every other field as it was; `none` for an end of a slot its field holds no keys of
 * @property create - A new link between two items, every other field from a template's values or its type's default; `none` as `write` refuses
 * @property templates - Its templates, which retype a link they are dropped on
 * @property templatesSource - The slice's source its templates list names
 */
export const SchematicLinkKindType = StructType({
    ...KindFields,
    ends: StructType({ from: ArrayType(StringType), to: ArrayType(StringType) }),
    rows: RowsOf(SchematicLinkEntryType),
    read: FunctionType([BlobType, StringType], SchematicLinkType),
    write: FunctionType([BlobType, SchematicEndsType], OptionType(BlobType)),
    create: FunctionType([SchematicEndsType, OptionType(BlobType)], OptionType(BlobType)),
    templates: ArrayType(SchematicTemplateType),
    templatesSource: OptionType(StringType),
});

/** Type representing a link kind. */
export type SchematicLinkKindType = typeof SchematicLinkKindType;

/**
 * One net kind, closed (§4.4, §4.8).
 *
 * @property sides - The item slot each side holds keys of
 * @property rows - Its stored nets a read holds, by key, each its roles and its row
 * @property read - A drafted row's roles, from its bytes and its key
 * @property write - The row with its sides written and every other field as it was; `none` for a member of a slot a side holds no keys of
 * @property create - A new net, every other field from a template's values or its type's default; `none` as `write` refuses
 * @property templates - Its templates
 * @property templatesSource - The slice's source its templates list names
 */
export const SchematicNetKindType = StructType({
    ...KindFields,
    sides: StructType({ sources: StringType, destinations: StringType }),
    rows: RowsOf(SchematicNetEntryType),
    read: FunctionType([BlobType, StringType], SchematicNetType),
    write: FunctionType([BlobType, SchematicSidesType], OptionType(BlobType)),
    create: FunctionType([SchematicSidesType, OptionType(BlobType)], OptionType(BlobType)),
    templates: ArrayType(SchematicTemplateType),
    templatesSource: OptionType(StringType),
});

/** Type representing a net kind. */
export type SchematicNetKindType = typeof SchematicNetKindType;
