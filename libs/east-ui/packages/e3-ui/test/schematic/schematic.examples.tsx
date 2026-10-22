/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import {
    ArrayType, BooleanType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, PatchType, StringType, StructType, VariantType, example,
    none, some, variant,
} from "@elaraai/east";
import { Box, Button, Reactive, Slice, State, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Record, Schematic } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// A data centre floor (`Schematic Builder Spec.md` §13, D8): racks with power
// meters, halls and cages, hot and cold aisles, fibre runs, power distribution
// units feeding the racks, and power, cooling, network and structure layers —
// each the app's own record, its fields mapped to the Schematic's roles, and
// its own types: a shape, a pattern or a style is built by an accessor from
// the row's own fields (D35), and the layers are a record of the app's (D36).

/** A system the floor's equipment and areas belong to: a layer of the drawing, its colour a theme token. */
export const DcSystem = StructType({ label: StringType, colour: StringType, order: IntegerType, fixed: BooleanType, dim: FloatType });
export const schematicSystems = e3.record("schematic_systems", DictType(StringType, DcSystem), new Map([
    ["structure", { label: "Structure", colour: "fg.muted", order: 1n, fixed: true, dim: 0.6 }],
    ["power", { label: "Power", colour: "status.warn", order: 2n, fixed: false, dim: 1.0 }],
    ["cooling", { label: "Cooling", colour: "brand.solid", order: 3n, fixed: false, dim: 1.0 }],
    ["network", { label: "Network", colour: "status.pos", order: 4n, fixed: false, dim: 1.0 }],
]));
/** The systems' patch door: another session's change of a layer — its colour, say — which the floor redraws. */
export const schematicSystemsPatch = e3.mutation.patch(schematicSystems);
// ============================================================================

// ----------------------------------------------------------------------------
// The smallest: one hall's racks, read only
// ----------------------------------------------------------------------------

export const FloorRack = StructType({ name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, model: StringType, kw: FloatType, capacity: FloatType });
export const schematicFloorRacks = e3.record("schematic_floor_racks", DictType(StringType, FloorRack), new Map([
    ["A01", { name: "A01", x: 2.4, y: 2.9, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 5.2, capacity: 8.0 }],
    ["A02", { name: "A02", x: 6.0, y: 2.9, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 7.4, capacity: 8.0 }],
    ["A03", { name: "A03", x: 9.6, y: 2.9, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 3.9, capacity: 8.0 }],
    ["A04", { name: "A04", x: 13.2, y: 2.9, w: 3.2, h: 1.2, model: "48U · 12 kW", kw: 9.6, capacity: 12.0 }],
    ["B01", { name: "B01", x: 2.4, y: 8.6, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 6.1, capacity: 8.0 }],
    ["B02", { name: "B02", x: 6.0, y: 8.6, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 2.8, capacity: 8.0 }],
]));
/** The floor's racks' patch door: another session's moves of a rack, which the floor redraws. */
export const schematicFloorRacksPatch = e3.mutation.patch(schematicFloorRacks);

export const schematicFloor = example({
    keywords: ["Schematic", "Schematic.items", "Data.bind", "records", "racks", "meter", "read only", "canvas", "id"],
    description: "One hall's racks, read only, with no panes: a record of racks bound with Data.bind, each rack's fields mapped to the Schematic's roles — its centre, its box, its name, its model and its power as a meter",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const racks = $.let(Data.bind(schematicFloorRacks));
            return (
                <Box height="440px">
                    <Schematic
                        id="floor"
                        extent={{ width: 18, height: 12 }}
                        scaleUnit="m"
                        items={{
                            racks: Schematic.items(racks, {
                                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name",
                                sublabel: (r) => r.model,
                                meter: (r) => ({ value: r.kw, max: r.capacity }),
                            }),
                        }}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ----------------------------------------------------------------------------
// Shapes: footprints and zone geometry about their anchors, tones, layers
// ----------------------------------------------------------------------------

/** A corner of a unit's outline, about its centre, in metres. */
export const ShapePoint = StructType({ x: FloatType, y: FloatType });
/** A unit, measured as the site measures it: a cooling tower by its radius, a cooling unit by its outline's corners, or by neither. */
export const ShapeUnit = StructType({
    name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, kind: StringType,
    radius: OptionType(FloatType), outline: ArrayType(ShapePoint), system: StringType, tint: OptionType(StringType),
});
/** A corner of an area's edge, about its box's centre; its bulge curves the edge to the next corner (0 is straight). */
export const ShapeCorner = StructType({ x: FloatType, y: FloatType, bulge: FloatType });
/** What an area is: a hall, outlined, or a duct bank, a hatched band of its width. */
export const ShapeAreaKind = VariantType({ hall: NullType, duct: StructType({ width: FloatType }) });
/** An area: its box, what it is, and its edge's corners. */
export const ShapeArea = StructType({
    name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, kind: ShapeAreaKind, corners: ArrayType(ShapeCorner), system: StringType,
});
export const schematicShapeUnits = e3.record("schematic_shape_units", DictType(StringType, ShapeUnit), new Map([
    ["CRAH-1", { name: "CRAH-1", x: 6.2, y: 4.6, w: 5.0, h: 3.4, kind: "cooling unit", system: "cooling", tint: some("status.info"), radius: none,
        outline: [{ x: -2.2, y: -1.6 }, { x: 2.4, y: -1.1 }, { x: 2.1, y: 1.6 }, { x: -2.5, y: 1.1 }] }],
    ["CT-2", { name: "CT-2", x: 16.4, y: 4.8, w: 4.6, h: 4.6, kind: "cooling tower", system: "cooling", tint: some("heat.3"), radius: some(2.3), outline: [] }],
    ["PDU-3", { name: "PDU-3", x: 22.0, y: 4.6, w: 1.2, h: 0.8, kind: "power distribution unit", system: "power", tint: none, radius: none, outline: [] }],
]));
export const schematicShapeAreas = e3.record("schematic_shape_areas", DictType(StringType, ShapeArea), new Map([
    ["hall-3", { name: "Hall 3", x: 1.6, y: 1.4, w: 9.3, h: 6.6, system: "structure", kind: variant("hall", null),
        corners: [{ x: -4.65, y: -2.5, bulge: 0.0 }, { x: 4.15, y: -3.3, bulge: 0.0 }, { x: 4.65, y: 2.7, bulge: 0.0 }, { x: -4.25, y: 3.3, bulge: 0.0 }] }],
    ["duct", { name: "Duct bank", x: 1.0, y: 9.1, w: 23.8, h: 3.4, system: "power", kind: variant("duct", { width: 1.4 }),
        corners: [
            { x: -11.7, y: 1.0, bulge: 0.0 }, { x: -6.3, y: -0.8, bulge: 0.45 }, { x: -0.1, y: 0.8, bulge: -0.45 }, { x: 5.7, y: -1.0, bulge: 0.35 }, { x: 11.5, y: 0.2, bulge: 0.0 },
        ] }],
]));

export const schematicShapes = example({
    keywords: [
        "Schematic", "Schematic.items", "Schematic.zones", "Schematic.layers", "footprint", "geometry", "accessor", "Schematic.circle", "Schematic.polygon",
        "Schematic.polyline", "Schematic.hatch", "arc", "bulge", "anchor", "tone", "color", "theme token", "layers", "read only",
    ],
    description: "Footprints and zone shapes built by accessors from the rows' own fields and drawn about their anchors — a cooling unit's outline and a tower's radius about each unit's centre, a hall's corners and a duct bank's arcing band about each area's box centre — with theme colour tokens, tones and layers from a systems record, read only",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const units = $.let(Data.bind(schematicShapeUnits));
            const areas = $.let(Data.bind(schematicShapeAreas));
            const systems = $.let(Data.bind(schematicSystems));
            return (
                <Box height="440px">
                    <Schematic
                        id="shapes"
                        extent={{ width: 26.5, height: 14 }}
                        scaleUnit="m"
                        items={{
                            units: Schematic.items(units, {
                                name: "Equipment", icon: "gear", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
                                // A tower by its radius, a unit by its outline's corners, about its centre.
                                footprint: (u) => u.radius.match({
                                    some: (_$2, r) => some(Schematic.circle(r)),
                                    none: (_$2) => u.outline.size().greater(0n).ifElse((_$3) => some(Schematic.polygon(u.outline)), (_$3) => none),
                                }),
                                sublabel: (u) => u.kind,
                                color: (u) => u.tint,
                                fillOpacity: (_u) => some(0.18),
                            }),
                        }}
                        zones={{
                            areas: Schematic.zones(areas, {
                                name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
                                // A hall outlined by its corners; a duct bank hatched, a band of its width along them.
                                pattern: (a) => a.kind.match({
                                    hall: (_$2) => Schematic.outline(),
                                    duct: (_$2) => Schematic.hatch({ tone: "warning" }),
                                }),
                                geometry: (a) => some(a.kind.match({
                                    hall: (_$2) => Schematic.polygon(a.corners),
                                    duct: (_$2, duct) => Schematic.polyline(a.corners, { width: duct.width }),
                                })),
                            }),
                        }}
                        layers={Schematic.layers(systems.read(), {
                            label: (s) => s.label, color: (s) => some(s.colour), order: (s) => s.order, locked: (s) => s.fixed, opacity: (s) => s.dim,
                        })}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ----------------------------------------------------------------------------
// The builder: racks, network frames, cooling units and power distribution
// units; halls, cages and aisles; fibre runs; power feeds; the racks' loads
// ----------------------------------------------------------------------------

/** A rack: placed by its centre, or unplaced until a drop places it. */
export const DcRack = StructType({
    name: StringType, x: OptionType(FloatType), y: OptionType(FloatType), w: FloatType, h: FloatType,
    model: StringType, hall: StringType, system: StringType, owner: StringType,
});
/** A rack's load: what its card's bar, figure and dot draw. */
export const DcLoad = StructType({ kw: FloatType, capacity: FloatType, alarm: VariantType({ ok: NullType, warm: NullType, hot: NullType }) });
/** A network frame or a power distribution unit. */
export const DcUnit = StructType({ name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, kind: StringType, system: StringType });
/** A cooling unit: round, drawn by its radius. */
export const DcCooling = StructType({
    name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, radius: FloatType, setpoint: FloatType, system: StringType,
});
/** What an area is: a room or a cage, outlined, or a cold or a hot aisle, hatched. */
export const DcAreaKind = VariantType({ room: NullType, cold: NullType, hot: NullType });
/** A hall, a cage or an aisle. */
export const DcArea = StructType({ name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, kind: DcAreaKind, system: StringType });
/** A fibre run's end: a rack, or a network frame. */
export const DcEnd = VariantType({ rack: StringType, frame: StringType });
/** A bend of a fibre run's path, in metres. */
export const DcPoint = StructType({ x: FloatType, y: FloatType });
/** What a run carries: fibre, drawn solid, or a logical link — management, a cross-connect — drawn dashed. */
export const DcCable = VariantType({ fibre: NullType, logical: NullType });
/** A fibre run between two ends. */
export const DcFibre = StructType({
    from: DcEnd, to: DcEnd, path: ArrayType(DcPoint), label: OptionType(StringType), speed: OptionType(StringType), cable: DcCable, system: StringType,
});
/** A power feed: power distribution units feeding racks. */
export const DcFeed = StructType({ supply: ArrayType(StringType), racks: ArrayType(StringType), label: StringType, load: StringType, system: StringType });
/** A fibre trunk: one cable gathering several racks' runs into a frame. */
export const DcTrunk = StructType({ racks: ArrayType(StringType), frames: ArrayType(StringType), label: OptionType(StringType), system: StringType });
/** What a rack template gives a new rack: every field of a rack but its centre, which the drop places. */
export const DcRackValues = StructType({ name: StringType, w: FloatType, h: FloatType, model: StringType, hall: StringType, system: StringType, owner: StringType });
/** A rack template: its card's name and group, and the rack it creates. */
export const DcRackTemplate = StructType({ name: StringType, group: StringType, values: DcRackValues });
/** What a fibre template gives a run: every field of a run but its ends. */
export const DcFibreValues = StructType({
    path: ArrayType(DcPoint), label: OptionType(StringType), speed: OptionType(StringType), cable: DcCable, system: StringType,
});
/** A fibre template: its card's name and system, and what it gives a run. */
export const DcFibreTemplate = StructType({ name: StringType, system: StringType, values: DcFibreValues });
/** A tenant of the floor: the owner a rack is let to, and who looks after its racks. */
export const DcOwner = StructType({ name: StringType, contact: StringType });

export const schematicRacks = e3.record("schematic_racks", DictType(StringType, DcRack), new Map([
    ["A01", { name: "A01", x: some(2.4), y: some(2.9), w: 3.2, h: 1.2, model: "42U · 8 kW", hall: "Cage A", system: "power", owner: "Harbour Labs" }],
    ["A02", { name: "A02", x: some(6.0), y: some(2.9), w: 3.2, h: 1.2, model: "42U · 8 kW", hall: "Cage A", system: "power", owner: "Harbour Labs" }],
    ["A03", { name: "A03", x: some(9.6), y: some(2.9), w: 3.2, h: 1.2, model: "42U · 8 kW", hall: "Cage A", system: "power", owner: "Northwind Media" }],
    ["A04", { name: "A04", x: some(13.2), y: some(2.9), w: 3.2, h: 1.2, model: "48U · 12 kW", hall: "Cage A", system: "power", owner: "Northwind Media" }],
    ["A05", { name: "A05", x: some(16.8), y: some(2.9), w: 3.2, h: 1.2, model: "48U · 12 kW", hall: "Cage A", system: "power", owner: "Elmway College" }],
    ["A06", { name: "A06", x: none, y: none, w: 3.2, h: 1.2, model: "48U · 12 kW", hall: "Cage A", system: "power", owner: "Elmway College" }],
    ["A07", { name: "A07", x: none, y: none, w: 3.2, h: 1.2, model: "42U · 8 kW", hall: "Cage A", system: "power", owner: "" }],
]));
export const schematicRacksPatch = e3.mutation.patch(schematicRacks);
export const schematicRacksByName = e3.recordIndex("schematic_racks_by_name", schematicRacks, { on: ["name"] });
export const schematicRacksByHall = e3.recordIndex("schematic_racks_by_hall", schematicRacks, { on: ["hall"] });
export const schematicRacksByOwner = e3.recordIndex("schematic_racks_by_owner", schematicRacks, { on: ["owner"] });
export const schematicRackLoads = e3.record("schematic_rack_loads", DictType(StringType, DcLoad), new Map([
    ["A01", { kw: 5.2, capacity: 8.0, alarm: variant("ok", null) }],
    ["A02", { kw: 7.4, capacity: 8.0, alarm: variant("warm", null) }],
    ["A03", { kw: 3.9, capacity: 8.0, alarm: variant("ok", null) }],
    ["A04", { kw: 11.6, capacity: 12.0, alarm: variant("hot", null) }],
    ["A05", { kw: 0.0, capacity: 12.0, alarm: variant("ok", null) }],
]));
/** The racks' loads' patch door: a rack's capacity edited in the inspector's details. */
export const schematicRackLoadsPatch = e3.mutation.patch(schematicRackLoads);
export const schematicFrames = e3.record("schematic_frames", DictType(StringType, DcUnit), new Map([
    ["MMR-1", { name: "MMR-1", x: 24.2, y: 2.9, w: 4.0, h: 1.2, kind: "demarc · 48 ports", system: "network" }],
    ["ODF-1", { name: "ODF-1", x: 8.4, y: 9.6, w: 12.8, h: 1.0, kind: "fibre frame · 288 F", system: "network" }],
    ["CORE-1", { name: "CORE-1", x: 23.2, y: 9.7, w: 4.0, h: 1.2, kind: "core · 64 ports", system: "network" }],
]));
export const schematicPdus = e3.record("schematic_pdus", DictType(StringType, DcUnit), new Map([
    ["PDU-A", { name: "PDU-A", x: 1.6, y: 4.2, w: 1.2, h: 0.6, kind: "PDU · 32 A", system: "power" }],
    ["PDU-B", { name: "PDU-B", x: 18.6, y: 4.2, w: 1.2, h: 0.6, kind: "PDU · 32 A", system: "power" }],
]));
export const schematicCooling = e3.record("schematic_cooling", DictType(StringType, DcCooling), new Map([
    ["CRAH-1", { name: "CRAH-1", x: 3.0, y: 11.9, w: 1.4, h: 1.4, radius: 0.7, setpoint: 22.0, system: "cooling" }],
    ["CRAH-2", { name: "CRAH-2", x: 9.0, y: 11.9, w: 1.4, h: 1.4, radius: 0.7, setpoint: 22.0, system: "cooling" }],
    ["CRAH-3", { name: "CRAH-3", x: 15.0, y: 11.9, w: 1.4, h: 1.4, radius: 0.7, setpoint: 23.0, system: "cooling" }],
]));
export const schematicCoolingPatch = e3.mutation.patch(schematicCooling);
export const schematicAreas = e3.record("schematic_areas", DictType(StringType, DcArea), new Map([
    ["cage-a", { name: "Cage A", x: 0.6, y: 0.6, w: 19.6, h: 4.6, kind: variant("room", null), system: "structure" }],
    ["mmr", { name: "Meet-me room", x: 21.0, y: 0.6, w: 6.4, h: 4.6, kind: variant("room", null), system: "structure" }],
    ["cold-a", { name: "Cold aisle A · 1.2 m", x: 0.6, y: 6.0, w: 26.8, h: 1.2, kind: variant("cold", null), system: "cooling" }],
    ["net-room", { name: "Network room", x: 19.0, y: 7.8, w: 8.4, h: 3.8, kind: variant("room", null), system: "structure" }],
    ["hot-a", { name: "Hot aisle A · 1.0 m", x: 0.6, y: 12.9, w: 18.0, h: 0.9, kind: variant("hot", null), system: "cooling" }],
]));
/** The floor's fibre runs, as its record and the frozen floor's hold them. */
const dcFibreRuns = new Map([
    ["u1", { from: variant("rack", "A01"), to: variant("frame", "ODF-1"), path: [], label: some("uplink"), speed: some("100G"), cable: variant("fibre", null), system: "network" }],
    ["u2", { from: variant("rack", "A02"), to: variant("frame", "ODF-1"), path: [], label: some("uplink"), speed: some("100G"), cable: variant("fibre", null), system: "network" }],
    ["u2m", { from: variant("rack", "A02"), to: variant("frame", "ODF-1"), path: [], label: some("OOB mgmt"), speed: none, cable: variant("logical", null), system: "network" }],
    ["u3", { from: variant("rack", "A03"), to: variant("frame", "ODF-1"), path: [], label: none, speed: none, cable: variant("fibre", null), system: "network" }],
    ["u4", { from: variant("rack", "A04"), to: variant("frame", "ODF-1"), path: [], label: none, speed: some("2 × 100G"), cable: variant("fibre", null), system: "network" }],
    ["x1", { from: variant("frame", "MMR-1"), to: variant("frame", "CORE-1"), path: [{ x: 26.0, y: 6.6 }], label: none, speed: some("2 × 10G"), cable: variant("logical", null), system: "network" }],
]);
export const schematicFibre = e3.record("schematic_fibre", DictType(StringType, DcFibre), dcFibreRuns);
export const schematicFibrePatch = e3.mutation.patch(schematicFibre);
/** The fibre runs of a floor whose cabling is frozen: the same runs, which no Save changes. */
export const schematicFrozenFibre = e3.record("schematic_frozen_fibre", DictType(StringType, DcFibre), dcFibreRuns);
/** The frozen floor's door, a checked one: it refuses every change, naming why — what a Save over it is answered. */
export const schematicFrozenFibrePatch = e3.mutation.reduce("patch", schematicFrozenFibre,
    East.function([DictType(StringType, DcFibre), PatchType(DictType(StringType, DcFibre))], DictType(StringType, DcFibre), ($, runs, _patch) => {
        $.error("the fibre runs are frozen");
        return runs;
    }));
export const schematicFeeds = e3.record("schematic_feeds", DictType(StringType, DcFeed), new Map([
    ["feed-a", { supply: ["PDU-A"], racks: ["A01", "A02", "A03"], label: "PDU-A · A side", load: "16.5 kW", system: "power" }],
    ["feed-b", { supply: ["PDU-B"], racks: ["A04", "A05"], label: "PDU-B · A side", load: "11.6 kW", system: "power" }],
]));
export const schematicFeedsPatch = e3.mutation.patch(schematicFeeds);
/** The floor's fibre trunks: none yet — a Shift-connect from racks to a frame gathers their runs into one. */
export const schematicTrunks = e3.record("schematic_trunks", DictType(StringType, DcTrunk), new Map());
export const schematicTrunksPatch = e3.mutation.patch(schematicTrunks);
export const schematicRackTemplates = e3.record("schematic_rack_templates", DictType(StringType, DcRackTemplate), new Map([
    ["r42", { name: "42U rack · 8 kW", group: "Racks", values: { name: "New 42U rack", w: 3.2, h: 1.2, model: "42U · 8 kW", hall: "Cage A", system: "power", owner: "" } }],
    ["r48", { name: "48U rack · 12 kW", group: "Racks", values: { name: "New 48U rack", w: 3.2, h: 1.2, model: "48U · 12 kW", hall: "Cage A", system: "power", owner: "" } }],
    ["half", { name: "Half rack · 4 kW", group: "Half racks", values: { name: "New half rack", w: 1.6, h: 1.2, model: "24U · 4 kW", hall: "Cage A", system: "power", owner: "" } }],
]));
export const schematicRackTemplatesByGroup = e3.recordIndex("schematic_rack_templates_by_group", schematicRackTemplates, { on: ["group"] });
export const schematicFibreTemplates = e3.record("schematic_fibre_templates", DictType(StringType, DcFibreTemplate), new Map([
    ["uplink", { name: "Uplink · 100G", system: "network",
        values: { path: [], label: some("uplink"), speed: some("100G"), cable: variant("fibre", null), system: "network" } }],
    ["oob", { name: "Out-of-band management", system: "network",
        values: { path: [], label: some("OOB mgmt"), speed: none, cable: variant("logical", null), system: "network" } }],
]));
export const schematicFibreTemplatesBySystem = e3.recordIndex("schematic_fibre_templates_by_system", schematicFibreTemplates, { on: ["system"] });
export const schematicOwners = e3.record("schematic_owners", DictType(StringType, DcOwner), new Map([
    ["elmway", { name: "Elmway College", contact: "IT services" }],
    ["harbour", { name: "Harbour Labs", contact: "Network desk" }],
    ["northwind", { name: "Northwind Media", contact: "Facilities" }],
]));

export const schematicDataCentre = example({
    keywords: [
        "Schematic", "Schematic.items", "Schematic.zones", "Schematic.links", "Schematic.nets", "Schematic.details", "Schematic.templates",
        "Schematic.layers", "Schematic.library", "Schematic.library.tab", "Schematic.patch", "Record.bind", "Data.bindPaged", "Slice.bindRecords", "records",
        "details", "templates", "backlog", "layers", "narrowed", "inspector", "accessor", "id", "onSelect", "canConnect", "Schematic.Types.Ref",
        "Schematic.Types.Candidate", "veto", "editing", "Save", "undo", "Move", "Connect", "nets", "drag and drop", "drop",
    ],
    description: "A data centre floor over the app's records, each holding its own fields: racks read through their source of the slice, editable with their patch door, their loads as details on each card, editable in the inspector; network frames, round cooling units with their own Details and power distribution units; halls, cages and aisles, outlined or hatched by what they are; fibre runs between racks and frames, solid or dashed by their cable, a run between two frames refused in the veto's words; power feeds, and fibre trunks a Shift-connect gathers runs into; every gesture a step of one history, Save writing each record through its patch door; the inspector; the whole selection kept by the host; and in the library every kind's templates, dropped on the canvas or on a fibre run, the racks with no position, a drop placing one, the zones' index, the layers, a systems record, and the floor's owners, an owner's card dropped on a rack making it the rack's owner",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const racks = $.let(Record.bind(schematicRacks, [schematicRacksPatch]));
            const rackEntries = $.let(Data.bindPaged(schematicRacks));
            // The racks' loads, edited in the inspector: their patch door, read by key beside the racks' source.
            const loads = $.let(Record.bind(schematicRackLoads, [schematicRackLoadsPatch]));
            const loadEntries = $.let(Data.bindPaged(schematicRackLoads));
            const frames = $.let(Data.bind(schematicFrames));
            const pdus = $.let(Data.bind(schematicPdus));
            const cooling = $.let(Record.bind(schematicCooling, [schematicCoolingPatch]));
            const areas = $.let(Data.bind(schematicAreas));
            const fibre = $.let(Record.bind(schematicFibre, [schematicFibrePatch]));
            const feeds = $.let(Record.bind(schematicFeeds, [schematicFeedsPatch]));
            const trunks = $.let(Record.bind(schematicTrunks, [schematicTrunksPatch]));
            const systems = $.let(Data.bind(schematicSystems));
            const rackTemplates = $.let(Data.bind(schematicRackTemplates));
            const fibreTemplates = $.let(Data.bind(schematicFibreTemplates));
            const owners = $.let(Data.bind(schematicOwners));
            // A cooling unit's own Details: its setpoint, and a button that lowers it — the edited unit goes back through `update`.
            const coolingDetails = $.const(East.function([DcCooling, FunctionType([DcCooling], NullType)], UIComponentType, ($2, unit, update) => {
                const lower = $2.const(East.function([], NullType, ($3) => {
                    // East has no struct spread: the unit, rebuilt with its new setpoint.
                    const edited = $3.const({
                        name: unit.name, x: unit.x, y: unit.y, w: unit.w, h: unit.h, radius: unit.radius, setpoint: unit.setpoint.subtract(1.0), system: unit.system,
                    }, DcCooling);
                    $3(update(edited));
                }));
                return (
                    <VStack gap="2" align="stretch">
                        <Text>{East.str`${unit.name} holds ${East.Float.printFixed(unit.setpoint, 1n)} °C`}</Text>
                        <Button variant="outline" onClick={lower}>Lower the setpoint by 1 °C</Button>
                    </VStack>
                );
            }));
            // The whole selection, after each change — items, zones, links and nets alike, each by its kind's slot and
            // key — kept where the rest of the app reads it.
            const selected = $.let(State.bind([ArrayType(Schematic.Types.Ref)], "ex.schematicDataCentre.selected", []));
            const onSelect = $.const(East.function([ArrayType(Schematic.Types.Ref)], NullType, ($2, refs) => {
                $2(selected.write(refs));
            }));
            // Two frames are joined by a cross-connect, never a fibre run: the veto's words refuse the pair, and the
            // draft shows them.
            const canConnect = $.const(East.function([Schematic.Types.Candidate], OptionType(StringType), ($2, candidate) => {
                const reason = $2.let(none, OptionType(StringType));
                $2.if(candidate.from.kind.equal("network").and(() => candidate.to.kind.equal("network")), ($3) => {
                    $3.assign(reason, some("Two frames are joined by a cross-connect"));
                });
                return reason;
            }));
            // One rail: the racks by name, hall and owner, and each templates list by its group or system.
            const slice = $.let(Slice.bindRecords("ex.schematicDataCentre", {
                racks: { source: Data.bindPaged(schematicRacks, { indexes: [schematicRacksByName, schematicRacksByHall, schematicRacksByOwner] }), icon: { prefix: "fas", name: "server" },
                    search: ["name", "owner"], fields: {
                        name: { label: "Rack" }, hall: { label: "Hall", hints: ["Cage A"] }, owner: { label: "Owner", hints: ["Harbour Labs", "Northwind Media", "Elmway College"] },
                    } },
                rackTemplates: { source: Data.bindPaged(schematicRackTemplates, { indexes: [schematicRackTemplatesByGroup] }), fields: { group: { label: "Group", hints: ["Racks", "Half racks"] } } },
                fibreTemplates: { source: Data.bindPaged(schematicFibreTemplates, { indexes: [schematicFibreTemplatesBySystem] }), fields: { system: { label: "System", hints: ["network"] } } },
            }));
            return (
                <Box height="640px">
                    <Schematic
                        id="dataCentre"
                        inspector
                        extent={{ width: 28, height: 14 }}
                        scaleUnit="m"
                        slice={{ slice }}
                        narrowed="dim"
                        onSelect={onSelect}
                        canConnect={canConnect}
                        items={{
                            racks: Schematic.items(racks, {
                                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system", entries: rackEntries,
                                sublabel: (r) => r.model,
                                details: Schematic.details(loads, {
                                    entries: loadEntries,
                                    meter: (l) => ({ value: l.kw, max: l.capacity }),
                                    metric: (l) => some(East.str`${East.Float.printFixed(l.kw, 1n)} kW`),
                                    status: { field: "alarm", cases: {
                                        ok: { label: "OK", tone: variant("success", null), ring: false },
                                        warm: { label: "Warm", tone: variant("warning", null), ring: false },
                                        hot: { label: "Hot", tone: variant("danger", null), ring: false },
                                    } },
                                }),
                                templates: Schematic.templates(rackTemplates.read(), {
                                    name: (t) => t.name, group: (t) => some(t.group), values: (t) => t.values, source: "rackTemplates",
                                }),
                            }),
                            network: Schematic.items(frames, {
                                name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
                                sublabel: (f) => f.kind,
                            }),
                            cooling: Schematic.items(cooling, {
                                name: "Cooling unit", icon: "fan", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
                                footprint: (c) => some(Schematic.circle(c.radius)),
                                sublabel: (c) => East.str`set ${East.Float.printFixed(c.setpoint, 1n)} °C`,
                                inspector: coolingDetails,
                            }),
                            pdus: Schematic.items(pdus, {
                                name: "Power distribution unit", icon: "plug", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
                                sublabel: (p) => p.kind,
                            }),
                        }}
                        zones={{
                            areas: Schematic.zones(areas, {
                                name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
                                pattern: (a) => a.kind.match({
                                    room: (_$2) => Schematic.outline(),
                                    cold: (_$2) => Schematic.hatch({ tone: "brand" }),
                                    hot: (_$2) => Schematic.hatch({ tone: "warning" }),
                                }),
                            }),
                        }}
                        links={{
                            fibre: Schematic.links(fibre, {
                                name: "Fibre run", icon: "bolt", layer: "system", via: "path",
                                from: { field: "from", of: { rack: "racks", frame: "network" } },
                                to: { field: "to", of: { rack: "racks", frame: "network" } },
                                label: (f) => f.label, metric: (f) => f.speed,
                                style: (f) => f.cable.match({ fibre: (_$2) => Schematic.solid(), logical: (_$2) => Schematic.dashed() }),
                                templates: Schematic.templates(fibreTemplates.read(), {
                                    name: (t) => t.name, group: (t) => some(t.system), values: (t) => t.values, source: "fibreTemplates",
                                }),
                            }),
                        }}
                        nets={{
                            feeds: Schematic.nets(feeds, {
                                name: "Power feed", icon: "plug-circle-bolt", layer: "system",
                                sources: { field: "supply", of: "pdus" }, destinations: { field: "racks", of: "racks" },
                                label: (f) => some(f.label), metric: (f) => some(f.load),
                            }),
                            // A Shift-connect from racks to a frame grows its first run into a trunk of them.
                            trunks: Schematic.nets(trunks, {
                                name: "Fibre trunk", icon: "diagram-project", layer: "system",
                                sources: { field: "racks", of: "racks" }, destinations: { field: "frames", of: "network" },
                                label: (t) => t.label,
                            }),
                        }}
                        layers={Schematic.layers(systems.read(), {
                            label: (s) => s.label, color: (s) => some(s.colour), order: (s) => s.order, locked: (s) => s.fixed, opacity: (s) => s.dim,
                        })}
                        library={[
                            Schematic.library.templates(),
                            Schematic.library.backlog(),
                            Schematic.library.index(),
                            Schematic.library.layers(),
                            // The floor's owners: a card dropped on a rack — its patch is over a rack's row — makes it the rack's owner.
                            Schematic.library.tab(owners.read(), {
                                name: "Owners", icon: "building", label: (o) => o.name, meta: (o) => some(o.contact),
                                drop: (o) => Schematic.patch(DcRack, { owner: o.name }),
                            }),
                        ]}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
