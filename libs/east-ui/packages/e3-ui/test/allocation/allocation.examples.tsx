/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, DictType, East, FunctionType, NullType, StringType, example, none, some, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Field, Reactive, Slice, UIComponentType, VStack } from "@elaraai/east-ui";
import { Allocation, Data, Func, Record } from "@elaraai/e3-ui";
import { Bay, BinValues, Kiln, TimberLoad, yardArrivals, yardBayRows, yardDay, yardHistory, yardKilns, yardPlans } from "./kiln-yard.js";

// The plans the board edits: one per UTC day, each patched as a whole.
export const kilnPlans = e3.record("kiln_plans", Allocation.Types.Days(BinValues), yardPlans);
export const kilnPlansPatch = e3.mutation.patch(kilnPlans);
// Two years of plans, for the board read a day at a time.
export const kilnHistory = e3.record("kiln_plan_history", Allocation.Types.Days(BinValues), yardHistory);
export const kilnHistoryPatch = e3.mutation.patch(kilnHistory);
// The kilns, indexed by group for the narrowing; and by group then max, so a group and a range of max combine, and by name, for a search.
export const kilns = e3.record("kilns", DictType(StringType, Kiln), yardKilns);
export const kilnsByGroup = e3.recordIndex("kilns_by_group", kilns, { on: ["group"] });
export const kilnsByGroupMax = e3.recordIndex("kilns_by_group_max", kilns, { on: ["group", "max"] });
export const kilnsByName = e3.recordIndex("kilns_by_name", kilns, { on: ["name"] });
// Every load the day may book: booked or not, the board tells them apart by the plan; indexed by spec for the narrowing.
export const arrivals = e3.record("arrivals", DictType(StringType, TimberLoad), yardArrivals);
export const arrivalsBySpec = e3.recordIndex("arrivals_by_spec", arrivals, { on: ["spec"] });
// The unloading bays, by key: each takes one bin an hour, at its offset past the hour; indexed by area, and by cover, for the narrowing.
export const yardBays = e3.record("yard_bays", DictType(StringType, Bay), yardBayRows);
export const yardBaysByArea = e3.recordIndex("yard_bays_by_area", yardBays, { on: ["area"] });
export const yardBaysByCover = e3.recordIndex("yard_bays_by_cover", yardBays, { on: ["cover"] });

/** The yard's fit's body: the built-in rules, then a greedy look-ahead over the day's other loads. */
export const yardFitBody = East.function([Allocation.Types.FitRequest(BinValues)], Allocation.Types.FitResult, ($, req) => {
    const answer = $.const(Allocation.answer(BinValues));
    const rule = $.const(Allocation.fit);
    const ahead = $.const(Allocation.lookahead(BinValues));
    return answer(req, East.function([Allocation.Types.Candidate], Allocation.Types.Fit, (_$2, c) => ahead(req, c, rule)),
        "ranked by load, kind and spare days, and what it leaves for the day's other loads");
});
// The yard's fit, on e3: a fit that leaves more of the day's unbooked loads with nowhere to go ranks lower.
export const yardFit = e3.function("yard_fit", yardFitBody);

/** A yard rule over the ready-made fit: a bulk kiln takes no load under 20 m³. */
export const bulkFitBody = East.function([Allocation.Types.FitRequest(BinValues)], Allocation.Types.FitResult, ($, req) => {
    const answer = $.const(Allocation.answer(BinValues));
    const rule = $.const(Allocation.fit);
    return answer(req, East.function([Allocation.Types.Candidate], Allocation.Types.Fit, ($2, c) => {
        $2.if(East.equal(c.resource.group, some("Bulk")).and(() => c.reserve.not()).and(() => East.less(c.quantity, 20.0)), ($3) => {
            $3.return(variant("refused", { group: "Too small", reason: East.str`bulk kilns take 20 m³ and more`, measure: variant("none", null) }));
        });
        return rule(c);
    }), "ranked by load, kind and spare days; bulk kilns take 20 m³ and more");
});
export const bulkFit = e3.function("yard_bulk_fit", bulkFitBody);

export const allocationMinimal = example({
    description: "The smallest board: one plan per day, the bays, the loads and the kilns, and the yard's fit on e3. No library and no inspector; every gesture is still a draft until Save.",
    keywords: ["Allocation", "Record.bind", "Func.bind", "e3.function", "fit", "BuilderFrame", "Save"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        const loads = $.let(Data.bind(arrivals));
        const yard = $.let(Data.bind(kilns));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="760px"><Allocation id="allocationMinimal" days={days} lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit}
            events={Allocation.events(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays),
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }) })}
            resources={Allocation.resources(yard.read(), { label: k => k.name, min: k => k.min, max: k => k.max, jobs: k => k.charges })}
            quantity={{ unit: "m³" }} view={{ date: yardDay }} />
        </Box>;
    }}</Reactive>),
});

export const allocationKilnYard = example({
    description: "The kiln yard's board: 33 kilns and the day's loads, the Events and Resources library, the inspector, the bays narrowed by area or cover, the kilns by group, a range of max within a group or a name's start, and the loads by spec, from one rail over the three records — each source with its icon, headed by the board's noun, and each narrowing every place its rows appear, the Library's tabs included — the bin values as columns, a yard check, and the yard's greedy fit on e3.",
    keywords: ["Allocation", "Record.bind", "Data.bindPaged", "Slice.bindRecords", "Allocation.lanes", "Func.bind", "fit", "links", "Publish", "Library", "narrowing"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        // Every bay, kiln and load is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea, yardBaysByCover] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroupMax, kilnsByName] }));
        const loadIndex = $.let(Data.bindPaged(arrivals, { indexes: [arrivalsBySpec] }));
        const slice = $.let(Slice.bindRecords("ex.allocationKilnYard", {
            lanes: { source: bayIndex, icon: { prefix: "fas", name: "warehouse" },
                fields: { area: { label: "Area", hints: ["North", "South"] }, cover: { label: "Cover", hints: ["Covered", "Open"] } } },
            // A max narrows within a group (one index on group, then max); a name is searched by its start.
            resources: { source: kilnIndex, icon: { prefix: "fas", name: "fire" },
                fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] }, max: { label: "Max m³" }, name: { label: "Name" } } },
            events: { source: loadIndex, icon: { prefix: "fas", name: "truck" }, fields: { spec: { label: "Spec", hints: ["MC08", "MC10", "MC12", "MC14", "MC16", "MC18", "MC20", "MC22"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { resources: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { resources: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        // The yard's check: a bin measured off its booked moisture target is flagged, never refused.
        const check = $.const(East.function([Allocation.Types.CheckContext(BinValues)], ArrayType(Allocation.Types.Issue), ($2, cx) => {
            const issues = $2.let([], ArrayType(Allocation.Types.Issue));
            $2.for(cx.plan.bins, ($3, bin, id) => {
                $3.match(bin.event, { some: ($4, code) => {
                    $4.if(East.notEqual(bin.values.specBooked, bin.values.specMeasured), ($5) => {
                        $5(issues.pushLast({ kind: variant("custom", "Spec mismatch"), tone: variant("neutral", null),
                            title: East.str`${code} · bin ${id}`,
                            detail: East.str`Spec booked ${bin.values.specBooked} · measured ${bin.values.specMeasured} · ${bin.lane} ${bin.at.printFormatted("HH:mm")}`,
                            bin: some(id), resource: none, flag: some("≠ spec"), fix: none }));
                    });
                } });
            });
            return issues;
        }));
        return <Box width="100%" height="900px"><Allocation id="allocationKilnYard" title="Kiln loading" days={days}
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit} check={check}
            events={Allocation.events(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            resources={Allocation.resources(yard.read(), {
                label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })}
            columns={[
                { key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`),
                    tone: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: v => v.gradeMeasured.startsWith(v.gradeBooked).ifElse(() => v.gradeMeasured, () => East.str`booked ${v.gradeBooked} · measured ${v.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: v => v.instruction.unwrap("some", () => "none"), table: false },
            ]}
            slice={{ slice }}
            quantity={{ unit: "m³" }}
            library={[Allocation.library.events(), Allocation.library.resources()]} inspector
            view={{ layout: "timeline", date: yardDay }} />
        </Box>;
    }}</Reactive>),
});

export const allocationTable = example({
    description: "The kiln yard as a Table: one row per bay slot and one per extra bin of a batch, in four foldable time bands, narrowed by the bays' area or cover, the kilns' group, max or name, and the loads' spec; the same drafts, library and inspector as the Timeline.",
    keywords: ["Allocation", "Table", "Record.bind", "Func.bind", "columns", "Chooser", "Slice.bindRecords"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        // Every bay, kiln and load is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea, yardBaysByCover] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroupMax, kilnsByName] }));
        const loadIndex = $.let(Data.bindPaged(arrivals, { indexes: [arrivalsBySpec] }));
        const slice = $.let(Slice.bindRecords("ex.allocationTable", {
            lanes: { source: bayIndex, icon: { prefix: "fas", name: "warehouse" },
                fields: { area: { label: "Area", hints: ["North", "South"] }, cover: { label: "Cover", hints: ["Covered", "Open"] } } },
            // A max narrows within a group (one index on group, then max); a name is searched by its start.
            resources: { source: kilnIndex, icon: { prefix: "fas", name: "fire" },
                fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] }, max: { label: "Max m³" }, name: { label: "Name" } } },
            events: { source: loadIndex, icon: { prefix: "fas", name: "truck" }, fields: { spec: { label: "Spec", hints: ["MC08", "MC10", "MC12", "MC14", "MC16", "MC18", "MC20", "MC22"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { resources: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { resources: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="900px"><Allocation id="allocationTable" title="Kiln loading" days={days} inspector
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit}
            events={Allocation.events(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            resources={Allocation.resources(yard.read(), {
                label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })}
            columns={[
                { key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`),
                    tone: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: v => v.gradeMeasured.startsWith(v.gradeBooked).ifElse(() => v.gradeMeasured, () => East.str`booked ${v.gradeBooked} · measured ${v.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: v => v.instruction.unwrap("some", () => "none"), table: false },
            ]}
            slice={{ slice }} quantity={{ unit: "m³" }}
            library={[Allocation.library.events(), Allocation.library.resources()]}
            view={{ layout: "table", date: yardDay }} />
        </Box>;
    }}</Reactive>),
});

export const allocationLabels = example({
    description: "The kiln yard in its own words: labels={{ lane: \"Bay\", event: { one: \"Delivery\", other: \"Deliveries\" }, resource: \"Kiln\", quantity: \"Vol\" }} names the board's lanes, events, resources and quantity everywhere it writes them — the Table's heads, the Chooser, the placeholders, the drag captions, the banners and the narrowing's summary — and table={{ bands }} sets the Table's time bands to the yard's shifts.",
    keywords: ["Allocation", "labels", "nouns", "Table", "bands", "Record.bind", "Func.bind"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationLabels", {
            lanes: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            resources: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { resources: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { resources: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="900px"><Allocation id="allocationLabels" title="Kiln loading" days={days} inspector
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit}
            events={Allocation.events(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            resources={Allocation.resources(yard.read(), {
                label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })}
            columns={[
                { key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`),
                    tone: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: v => v.gradeMeasured.startsWith(v.gradeBooked).ifElse(() => v.gradeMeasured, () => East.str`booked ${v.gradeBooked} · measured ${v.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: v => v.instruction.unwrap("some", () => "none"), table: false },
            ]}
            slice={{ slice }} quantity={{ unit: "m³" }}
            library={[Allocation.library.events(), Allocation.library.resources()]}
            labels={{ lane: "Bay", event: { one: "Delivery", other: "Deliveries" }, resource: "Kiln", quantity: "Vol" }}
            table={{ bands: [{ from: 0, label: "Night" }, { from: 6, label: "Day shift" }, { from: 18, label: "Evening" }] }}
            view={{ layout: "table", date: yardDay }} />
        </Box>;
    }}</Reactive>),
});

export const allocationPublished = example({
    description: "A published day, Tue 4 May: read-only under its banner; navigation, the narrowing, the focus, links and the inspector still work.",
    keywords: ["Allocation", "Publish", "published", "readOnly", "Record.bind"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationPublished", {
            lanes: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            resources: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { resources: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { resources: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="900px"><Allocation id="allocationPublished" title="Kiln loading" days={days} inspector
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit}
            events={Allocation.events(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            resources={Allocation.resources(yard.read(), {
                label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })}
            columns={[
                { key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`),
                    tone: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: v => v.gradeMeasured.startsWith(v.gradeBooked).ifElse(() => v.gradeMeasured, () => East.str`booked ${v.gradeBooked} · measured ${v.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: v => v.instruction.unwrap("some", () => "none"), table: false },
            ]}
            slice={{ slice }} quantity={{ unit: "m³" }}
            library={[Allocation.library.events(), Allocation.library.resources()]}
            view={{ layout: "timeline", date: new Date("2027-05-04T00:00:00Z") }} />
        </Box>;
    }}</Reactive>),
});

export const allocationNoPublish = example({
    description: "The kiln yard with publish={false}: no status chip and no Publish; Save writes the day as a draft.",
    keywords: ["Allocation", "publish", "Save", "Record.bind"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationNoPublish", {
            lanes: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            resources: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { resources: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { resources: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="900px"><Allocation id="allocationNoPublish" title="Kiln loading" days={days} inspector publish={false}
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit}
            events={Allocation.events(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            resources={Allocation.resources(yard.read(), {
                label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })}
            columns={[
                { key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`),
                    tone: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: v => v.gradeMeasured.startsWith(v.gradeBooked).ifElse(() => v.gradeMeasured, () => East.str`booked ${v.gradeBooked} · measured ${v.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: v => v.instruction.unwrap("some", () => "none"), table: false },
            ]}
            slice={{ slice }} quantity={{ unit: "m³" }}
            library={[Allocation.library.events(), Allocation.library.resources()]}
            view={{ layout: "timeline", date: yardDay }} />
        </Box>;
    }}</Reactive>),
});

export const allocationSplit = example({
    description: "Loads split across kilns on Wed 12 May: each bin's parts on their kilns, one load with 4 m³ unallocated and its Partly allocated issue, and a link to each part.",
    keywords: ["Allocation", "split", "parts", "unallocated", "Find a fit", "links"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationSplit", {
            lanes: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            resources: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { resources: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { resources: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="900px"><Allocation id="allocationSplit" title="Kiln loading" days={days} inspector
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit}
            events={Allocation.events(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            resources={Allocation.resources(yard.read(), {
                label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })}
            columns={[
                { key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`),
                    tone: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: v => v.gradeMeasured.startsWith(v.gradeBooked).ifElse(() => v.gradeMeasured, () => East.str`booked ${v.gradeBooked} · measured ${v.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: v => v.instruction.unwrap("some", () => "none"), table: false },
            ]}
            slice={{ slice }} quantity={{ unit: "m³" }}
            library={[Allocation.library.events(), Allocation.library.resources()]}
            view={{ layout: "timeline", date: new Date("2027-05-12T00:00:00Z") }} />
        </Box>;
    }}</Reactive>),
});

export const allocationWindowed = example({
    description: "Two years of plans read a day at a time: window={Data.bindPaged(plans)} on the same record, so navigation reads the active day and the open picker's month only.",
    keywords: ["Allocation", "Data.bindPaged", "window", "history", "Record.bind"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnHistory, [kilnHistoryPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationWindowed", {
            lanes: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            resources: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { resources: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { resources: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        const history = $.let(Data.bindPaged(kilnHistory));
        return <Box width="100%" height="900px"><Allocation id="allocationWindowed" title="Kiln loading" days={days} window={history} inspector
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit}
            events={Allocation.events(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            resources={Allocation.resources(yard.read(), {
                label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })}
            columns={[
                { key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`),
                    tone: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: v => v.gradeMeasured.startsWith(v.gradeBooked).ifElse(() => v.gradeMeasured, () => East.str`booked ${v.gradeBooked} · measured ${v.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: v => v.instruction.unwrap("some", () => "none"), table: false },
            ]}
            slice={{ slice }} quantity={{ unit: "m³" }}
            library={[Allocation.library.events(), Allocation.library.resources()]}
            view={{ layout: "timeline", date: yardDay }} />
        </Box>;
    }}</Reactive>),
});

export const allocationMobile = example({
    description: "The kiln yard in a 390px container: a card per kiln (or per slot in the Table) with Book, Reserve, Allocate, Unlink and Back to Events in anchored popovers; no drag source or target.",
    keywords: ["Allocation", "mobile", "narrow", "cards", "Record.bind"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationMobile", {
            lanes: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            resources: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { resources: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { resources: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" maxWidth="390px" height="760px"><Allocation id="allocationMobile" title="Kiln loading" days={days} inspector
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit}
            events={Allocation.events(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            resources={Allocation.resources(yard.read(), {
                label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })}
            columns={[
                { key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`),
                    tone: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: v => v.gradeMeasured.startsWith(v.gradeBooked).ifElse(() => v.gradeMeasured, () => East.str`booked ${v.gradeBooked} · measured ${v.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: v => v.instruction.unwrap("some", () => "none"), table: false },
            ]}
            slice={{ slice }} quantity={{ unit: "m³" }}
            library={[Allocation.library.events(), Allocation.library.resources()]}
            view={{ layout: "timeline", date: yardDay }} />
        </Box>;
    }}</Reactive>),
});

export const allocationCustomBin = example({
    description: "inspector={{ bin }}: the yard's own typed bin form, its quantity and its loading instruction, in place of the built-in quantity field and value rows.",
    keywords: ["Allocation", "inspector", "bin", "Field", "typed form"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationCustomBin", {
            lanes: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            resources: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { resources: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { resources: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        const bin = $.const(East.function([Allocation.Types.Bin(BinValues), FunctionType([Allocation.Types.Bin(BinValues)], NullType)], UIComponentType, (_$2, row, update) =>
            <VStack>
                <Field.FloatInput label="Quantity" value={row.quantity} min={0} step={1} onChange={(_$3, quantity) => update({ lane: row.lane, at: row.at, event: row.event,
                    quantity, kind: row.kind, hold: row.hold, parts: row.parts, values: row.values })} />
                <Field.StringInput label="Loading instruction" value={row.values.instruction.unwrap("some", () => "")} onChange={(_$3, text) => update({ lane: row.lane, at: row.at,
                    event: row.event, quantity: row.quantity, kind: row.kind, hold: row.hold, parts: row.parts, values: { specBooked: row.values.specBooked,
                    specMeasured: row.values.specMeasured, gradeBooked: row.values.gradeBooked, gradeMeasured: row.values.gradeMeasured,
                    instruction: East.equal(text, "").ifElse(() => none, () => some(text)) } })} />
            </VStack>));
        return <Box width="100%" height="900px"><Allocation id="allocationCustomBin" title="Kiln loading" days={days} inspector={{ bin }}
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit}
            events={Allocation.events(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            resources={Allocation.resources(yard.read(), {
                label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })}
            columns={[
                { key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`),
                    tone: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: v => v.gradeMeasured.startsWith(v.gradeBooked).ifElse(() => v.gradeMeasured, () => East.str`booked ${v.gradeBooked} · measured ${v.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: v => v.instruction.unwrap("some", () => "none"), table: false },
            ]}
            slice={{ slice }} quantity={{ unit: "m³" }}
            library={[Allocation.library.events(), Allocation.library.resources()]}
            view={{ layout: "timeline", date: yardDay }} />
        </Box>;
    }}</Reactive>),
});

export const allocationFitRule = example({
    description: "The ready-made fit with one yard rule over it, as an e3.function: a bulk kiln takes no load under 20 m³, so LD-2235 (8 m³) fits K-305 alone.",
    keywords: ["Allocation", "fit", "e3.function", "Func.bind", "Allocation.fit", "Allocation.answer", "rule"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationFitRule", {
            lanes: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            resources: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { resources: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { resources: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(bulkFit));
        return <Box width="100%" height="900px"><Allocation id="allocationFitRule" title="Kiln loading" days={days} inspector
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit}
            events={Allocation.events(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            resources={Allocation.resources(yard.read(), {
                label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })}
            columns={[
                { key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`),
                    tone: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: v => v.gradeMeasured.startsWith(v.gradeBooked).ifElse(() => v.gradeMeasured, () => East.str`booked ${v.gradeBooked} · measured ${v.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: v => v.instruction.unwrap("some", () => "none"), table: false },
            ]}
            slice={{ slice }} quantity={{ unit: "m³" }}
            library={[Allocation.library.events(), Allocation.library.resources()]}
            view={{ layout: "timeline", date: yardDay }} />
        </Box>;
    }}</Reactive>),
});
