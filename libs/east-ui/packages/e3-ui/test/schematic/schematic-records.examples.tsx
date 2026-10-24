/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, DictType, East, FloatType, IntegerType, NullType, StringType, StructType, VariantType, example, some, variant } from "@elaraai/east";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Schematic } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// A floor of ten halls read a window at a time (`Schematic Builder Spec.md`
// §10.4, §11, §13): its racks each placed by its centre and filed once in an
// area index at a 1 cm cell, so the canvas reads the window it shows from the
// index alone; past 5,000 racks in view, the density of the index's cells.
// The same pure generator seeds the record and runs as an e3 task, as the
// Sheet's indexed work orders' does. It seeds 20,000 racks, the first 20 rows
// of each hall, so neither the showcase nor a test deploys the 50,000 a full
// floor holds (ruled 23 Oct 2026): the budget run (`E3_UI_PERF=1`) fills the
// floor through the racks' and the loads' patch doors, as the lens benchmark
// fills its million rows.

/** A rack of the floor: its hall and model, placed by its centre, its box 0.6 m by 1.2 m. */
export const StressRack = StructType({ name: StringType, hall: StringType, model: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType });
/** How hot a rack runs. */
export const StressAlarm = VariantType({ ok: NullType, warm: NullType, hot: NullType });
/** A rack's load: what its card's bar, figure and dot draw. */
export const StressLoad = StructType({ kw: FloatType, capacity: FloatType, alarm: StressAlarm });
/** A hall of the floor: its box and its name. */
export const StressHall = StructType({ name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType });

const StressRacks = DictType(StringType, StressRack);
const StressLoads = DictType(StringType, StressLoad);

/**
 * The floor's racks, a row of 100 in each of the ten halls in turn — five
 * halls to a row of the floor, each holding 50 rows, 0.7 m apart along a row
 * and 2.4 m from row to row — so any count fills every hall's rows from the
 * front: 20,000 racks fill each hall's first 20, and 50,000 the floor. The
 * budget run makes the floor's 50,000 with it, and patches in what the seed's
 * 20,000 lack.
 */
export const generateRacks = East.function([IntegerType], StressRacks, ($, count) => {
    const racks = $.let(new Map(), StressRacks);
    const models = $.const(["42U · 8 kW", "48U · 12 kW", "24U · 4 kW"], ArrayType(StringType));
    const i = $.let(0n);
    $.while(i.less(count), ($2) => {
        const hall = $2.const(i.divide(100n).remainder(10n));
        const row = $2.const(i.divide(1000n));
        const key = $2.const(East.str`R${i.add(100000n)}`);
        $2(racks.insert(key, {
            name: key,
            hall: East.str`Hall ${hall.add(1n)}`,
            model: models.get(i.remainder(3n)),
            x: hall.remainder(5n).toFloat().multiply(76.0).add(i.remainder(100n).toFloat().multiply(0.7)).add(3.3),
            y: hall.divide(5n).toFloat().multiply(126.0).add(row.toFloat().multiply(2.4)).add(3.6),
            w: 0.6,
            h: 1.2,
        }));
        $2.assign(i, i.add(1n));
    });
    return racks;
});

/** The racks' loads, keyed as the racks are: up to 12 kW of a 12 kW rack, warm past 9.6 and hot past 10.8. The budget run makes the floor's with it. */
export const generateLoads = East.function([IntegerType], StressLoads, ($, count) => {
    const loads = $.let(new Map(), StressLoads);
    const i = $.let(0n);
    $.while(i.less(count), ($2) => {
        const kw = $2.const(i.multiply(37n).remainder(120n).toFloat().divide(10.0));
        const alarm = $2.let(variant("ok", null), StressAlarm);
        $2.if(kw.greater(9.6), ($3) => { $3.assign(alarm, variant("warm", null)); });
        $2.if(kw.greater(10.8), ($3) => { $3.assign(alarm, variant("hot", null)); });
        $2(loads.insert(East.str`R${i.add(100000n)}`, { kw, capacity: 12.0, alarm }));
        $2.assign(i, i.add(1n));
    });
    return loads;
});

export const schematicStressRackCount = e3.input("schematic_stress_rack_count", IntegerType, variant("value", 20000n));
export const schematicStressRacksGenerated = e3.task("schematic_stress_racks_generated", [schematicStressRackCount], generateRacks);
export const schematicStressRacks = e3.record("schematic_stress_racks", StressRacks, East.compile(generateRacks, [])(20000n));
/** The racks' patch door: the budget run fills the floor through it. */
export const schematicStressRacksPatch = e3.mutation.patch(schematicStressRacks);
/** The window, whatever the rail chooses: every rack filed once by its box, at a 1 cm cell. */
export const schematicStressRacksByArea = e3.recordIndex.area("schematic_stress_racks_by_area", schematicStressRacks, {
    x: "x", y: "y", width: "w", height: "h", at: "centre", cell: 0.01,
});
/** Beside it, a choice of halls and the window in one read. */
export const schematicStressRacksByHallArea = e3.recordIndex.area("schematic_stress_racks_by_hall_area", schematicStressRacks, {
    on: ["hall"], x: "x", y: "y", width: "w", height: "h", at: "centre", cell: 0.01,
});
/** A choice no area index leads: a window under it asks which of its racks the choice holds. */
export const schematicStressRacksByModel = e3.recordIndex("schematic_stress_racks_by_model", schematicStressRacks, { on: ["model"] });
export const schematicStressRackLoads = e3.record("schematic_stress_rack_loads", StressLoads, East.compile(generateLoads, [])(20000n));
/** The loads' patch door: the budget run fills them through it, keyed as the racks it fills. */
export const schematicStressRackLoadsPatch = e3.mutation.patch(schematicStressRackLoads);
/** A rack joined to another across the floor. */
export const StressUplink = StructType({ from: StringType, to: StringType });
/**
 * Uplinks from the front of Hall 1 to the front of Hall 5, 300 m across the floor: links whose far end a window over
 * either hall doesn't hold, which it reads by key (#1393, SC22).
 */
export const schematicStressUplinks = e3.record("schematic_stress_uplinks", DictType(StringType, StressUplink), new Map([
    ["u1", { from: "R100000", to: "R100400" }],
    ["u2", { from: "R100001", to: "R100401" }],
    ["u3", { from: "R100002", to: "R100402" }],
    ["u4", { from: "R100003", to: "R100403" }],
]));
export const schematicStressHalls = e3.record("schematic_stress_halls", DictType(StringType, StressHall), new Map([
    ["hall-1", { name: "Hall 1", x: 2.0, y: 2.0, w: 72.0, h: 122.0 }],
    ["hall-2", { name: "Hall 2", x: 78.0, y: 2.0, w: 72.0, h: 122.0 }],
    ["hall-3", { name: "Hall 3", x: 154.0, y: 2.0, w: 72.0, h: 122.0 }],
    ["hall-4", { name: "Hall 4", x: 230.0, y: 2.0, w: 72.0, h: 122.0 }],
    ["hall-5", { name: "Hall 5", x: 306.0, y: 2.0, w: 72.0, h: 122.0 }],
    ["hall-6", { name: "Hall 6", x: 2.0, y: 128.0, w: 72.0, h: 122.0 }],
    ["hall-7", { name: "Hall 7", x: 78.0, y: 128.0, w: 72.0, h: 122.0 }],
    ["hall-8", { name: "Hall 8", x: 154.0, y: 128.0, w: 72.0, h: 122.0 }],
    ["hall-9", { name: "Hall 9", x: 230.0, y: 128.0, w: 72.0, h: 122.0 }],
    ["hall-10", { name: "Hall 10", x: 306.0, y: 128.0, w: 72.0, h: 122.0 }],
]));

export const schematicRecordIndexes = example({
    keywords: [
        "Schematic", "Schematic.items", "Schematic.zones", "Schematic.details", "Data.bindPaged", "Slice.bindRecords", "e3.recordIndex.area", "area index",
        "window", "paging", "density", "records", "details", "read only", "20,000",
    ],
    description: "A floor of 20,000 racks in ten halls, read a window at a time: the racks bound Data.bindPaged and read through their source of the slice, whose indexes include an area index at a 1 cm cell, so the canvas reads only the racks its view shows, from the index alone, and draws their density from the index's counts while the view holds more than 5,000; a choice of halls reads through the area index the hall leads, and a choice of models through the one led by nothing, asking which of the window's racks the choice holds; each rack's load read by the runs its window's cells are of the area index — e3 reads their keys from the index, so none is sent — every cell not yet read in one request, so a dot draws its rack's alarm as a card does",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const racks = $.let(Data.bindPaged(schematicStressRacks));
            const loads = $.let(Data.bindPaged(schematicStressRackLoads));
            const halls = $.let(Data.bind(schematicStressHalls));
            // One rail: the racks by hall, through the area index the hall leads, and by model, through the one led by nothing.
            const slice = $.let(Slice.bindRecords("ex.schematicRecordIndexes", {
                racks: {
                    source: Data.bindPaged(schematicStressRacks, { indexes: [schematicStressRacksByArea, schematicStressRacksByHallArea, schematicStressRacksByModel] }),
                    icon: { prefix: "fas", name: "server" },
                    fields: {
                        hall: { label: "Hall", hints: ["Hall 1", "Hall 2", "Hall 3", "Hall 4", "Hall 5", "Hall 6", "Hall 7", "Hall 8", "Hall 9", "Hall 10"] },
                        model: { label: "Model", hints: ["42U · 8 kW", "48U · 12 kW", "24U · 4 kW"] },
                    },
                },
            }));
            return (
                <Box height="640px">
                    <Schematic
                        id="recordIndexes"
                        extent={{ width: 382, height: 254 }}
                        scaleUnit="m"
                        slice={{ slice }}
                        items={{
                            racks: Schematic.items(racks, {
                                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name",
                                sublabel: (r) => r.model,
                                details: Schematic.details(loads, {
                                    meter: (l) => ({ value: l.kw, max: l.capacity }),
                                    metric: (l) => some(East.str`${East.Float.printFixed(l.kw, 1n)} kW`),
                                    status: { field: "alarm", cases: {
                                        ok: { label: "OK", tone: variant("success", null), ring: false },
                                        warm: { label: "Warm", tone: variant("warning", null), ring: false },
                                        hot: { label: "Hot", tone: variant("danger", null), ring: false },
                                    } },
                                }),
                            }),
                        }}
                        zones={{
                            halls: Schematic.zones(halls, { name: "Hall", icon: "warehouse", x: "x", y: "y", width: "w", height: "h", label: "name" }),
                        }}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
