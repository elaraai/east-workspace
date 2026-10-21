/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, DateTimeType, DictType, East, FunctionType, NullType, StringType, example, none, some, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Field, Reactive, Slice, UIComponentType, VStack } from "@elaraai/east-ui";
import { Allocation, Data, Func, Record, Schedule } from "@elaraai/e3-ui";
import {
    Bay, Kiln, KilnBin, MinimalBin, TimberLoad, YardDay, yardArrivals, yardBayRows, yardBinHistoryRows, yardBinRows, yardDay, yardDayHistoryRows,
    yardDayRows, yardKilns, yardMinimalBinRows, yardPublishedDay, yardSplitDay,
} from "./kiln-yard.js";

// The kiln yard's own records (`Builder Interfaces Spec.md` §6.5): its bins and the days of its plan, which the board
// writes, each through its patch door; and what it reads — its kilns, its loads and its bays.

/** The bins, every day's, each the yard's own row. */
export const kilnBins = e3.record("kiln_bins", DictType(StringType, KilnBin), yardBinRows);
export const kilnBinsPatch = e3.mutation.patch(kilnBins);
/** The bins by their time: what the board's slice reads a day of them through, its navigation writing the range. */
export const kilnBinsByTime = e3.recordIndex("kiln_bins_by_time", kilnBins, { interval: { from: "at", to: "at" } });
/** The days of the yard's plan, what the board publishes: Tue 4 May issued, Tue 11 and Wed 12 drafts. */
export const yardDays = e3.record("yard_days", DictType(DateTimeType, YardDay), yardDayRows);
export const yardDaysPatch = e3.mutation.patch(yardDays);
/** Two years of the yard's bins, for the board read a day at a time through its slice. */
export const kilnBinHistory = e3.record("kiln_bin_history", DictType(StringType, KilnBin), yardBinHistoryRows);
export const kilnBinHistoryPatch = e3.mutation.patch(kilnBinHistory);
export const kilnBinHistoryByTime = e3.recordIndex("kiln_bin_history_by_time", kilnBinHistory, { interval: { from: "at", to: "at" } });
/** The days of those two years, read by key. */
export const yardDayHistory = e3.record("yard_day_history", DictType(DateTimeType, YardDay), yardDayHistoryRows);
export const yardDayHistoryPatch = e3.mutation.patch(yardDayHistory);
// The kilns, indexed by group for the narrowing; and by group then max, so a group and a range of max combine, and by name, for a search.
export const kilns = e3.record("kilns", DictType(StringType, Kiln), yardKilns);
export const kilnsByGroup = e3.recordIndex("kilns_by_group", kilns, { on: ["group"] });
export const kilnsByGroupMax = e3.recordIndex("kilns_by_group_max", kilns, { on: ["group", "max"] });
export const kilnsByName = e3.recordIndex("kilns_by_name", kilns, { on: ["name"] });
// The kilns' patch door: another session's edit of the yard's kilns, as the renderer's tests on e3 commit it (#1376).
export const kilnsPatch = e3.mutation.patch(kilns);
// Every load the day may book: booked or not, the board tells them apart by its bins; indexed by spec for the narrowing.
export const arrivals = e3.record("arrivals", DictType(StringType, TimberLoad), yardArrivals);
export const arrivalsBySpec = e3.recordIndex("arrivals_by_spec", arrivals, { on: ["spec"] });
// The unloading bays, by key: each takes one bin an hour, at its offset past the hour; indexed by area, and by cover, for the narrowing.
export const yardBays = e3.record("yard_bays", DictType(StringType, Bay), yardBayRows);
export const yardBaysByArea = e3.recordIndex("yard_bays_by_area", yardBays, { on: ["area"] });
export const yardBaysByCover = e3.recordIndex("yard_bays_by_cover", yardBays, { on: ["cover"] });
// The smallest board's own bins (§6.5): the board's roles alone.
export const minimalBins = e3.record("kiln_minimal_bins", DictType(StringType, MinimalBin), yardMinimalBinRows);
export const minimalBinsPatch = e3.mutation.patch(minimalBins);

/** The yard's fit's body: the built-in rules, then a greedy look-ahead over the day's other loads. */
export const yardFitBody = East.function([Allocation.Types.FitRequest(KilnBin)], Allocation.Types.FitResult, ($, req) => {
    const answer = $.const(Allocation.answer(KilnBin));
    const rule = $.const(Allocation.fit);
    const ahead = $.const(Allocation.lookahead(KilnBin));
    return answer(req, East.function([Allocation.Types.Candidate], Allocation.Types.Fit, (_$2, c) => ahead(req, c, rule)),
        "ranked by load, kind and spare days, and what it leaves for the day's other loads");
});
// The yard's fit, on e3: a fit that leaves more of the day's unbooked loads with nowhere to go ranks lower.
export const yardFit = e3.function("yard_fit", yardFitBody);

/** A yard rule over the ready-made fit: a bulk kiln takes no load under 20 m³. */
export const bulkFitBody = East.function([Allocation.Types.FitRequest(KilnBin)], Allocation.Types.FitResult, ($, req) => {
    const answer = $.const(Allocation.answer(KilnBin));
    const rule = $.const(Allocation.fit);
    return answer(req, East.function([Allocation.Types.Candidate], Allocation.Types.Fit, ($2, c) => {
        $2.if(East.equal(c.resource.group, some("Bulk")).and(() => c.reserve.not()).and(() => East.less(c.quantity, 20.0)), ($3) => {
            $3.return(variant("refused", { group: "Too small", reason: East.str`bulk kilns take 20 m³ and more`, measure: variant("none", null) }));
        });
        return rule(c);
    }), "ranked by load, kind and spare days; bulk kilns take 20 m³ and more");
});
export const bulkFit = e3.function("yard_bulk_fit", bulkFitBody);

/** The smallest board's fit's body (§6.5): the built-in rules over its own bins. */
export const minimalFitBody = East.function([Allocation.Types.FitRequest(MinimalBin)], Allocation.Types.FitResult, ($, req) => {
    const answer = $.const(Allocation.answer(MinimalBin));
    const rule = $.const(Allocation.fit);
    return answer(req, rule, "ranked by load, kind and spare days");
});
export const minimalFit = e3.function("yard_minimal_fit", minimalFitBody);

export const allocationMinimal = example({
    description: "The smallest board over the app's own records: bins with only the board's roles — their bay, time, load, m³, split across kilns and drying time — the bays, the kilns and the day's loads, and the yard's fit on e3. No library, no inspector and no Publish; every gesture is still a draft until Save.",
    keywords: ["Allocation", "Schedule.events", "Schedule.resources", "Allocation.arrivals", "Record.bind", "Func.bind", "e3.function", "fit", "minimal", "BuilderFrame", "Save"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(minimalBins, [minimalBinsPatch]));
        const loads = $.let(Data.bind(arrivals));
        const yard = $.let(Data.bind(kilns));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(minimalFit));
        return <Box width="100%" height="760px"><Allocation id="allocationMinimal" fit={fit} view={{ date: yardDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box",
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor",
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max, jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays) })} />
        </Box>;
    }}</Reactive>),
});

export const allocationKilnYard = example({
    description: "The kiln yard's board over its own records: its bins, each with the yard's spec and grade beside the board's roles, read a day at a time through the slice; the days it publishes; a check over the bins' own fields; the rail over the bays, the kilns and the loads — each source with its icon, and each narrowing every place its rows appear, the Library's tabs included; the yard's fields as columns; the Arrivals and Resources library; the inspector; and the yard's greedy fit on e3.",
    keywords: ["Allocation", "Schedule.events", "Schedule.resources", "Schedule.periods", "Allocation.arrivals", "Slice.bindRecords", "Data.bindPaged", "Func.bind", "fit", "check", "columns", "links", "Publish", "Library", "narrowing"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // What the board writes: the bins and the days of the plan, each through its patch door.
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const entries = $.let(Data.bindPaged(kilnBins));
        const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        const days = $.let(Record.bind(yardDays, [yardDaysPatch]));
        // Every bay, kiln and load is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea, yardBaysByCover] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroupMax, kilnsByName] }));
        const loadIndex = $.let(Data.bindPaged(arrivals, { indexes: [arrivalsBySpec] }));
        const slice = $.let(Slice.bindRecords("ex.allocationKilnYard", {
            // The day's bins: the board's navigation writes the range; no chip picks the day.
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, icon: { prefix: "fas", name: "warehouse" },
                fields: { area: { label: "Area", hints: ["North", "South"] }, cover: { label: "Cover", hints: ["Covered", "Open"] } } },
            // A max narrows within a group (one index on group, then max); a name is searched by its start.
            kilns: { source: kilnIndex, icon: { prefix: "fas", name: "fire" },
                fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] }, max: { label: "Max m³" }, name: { label: "Name" } } },
            arrivals: { source: loadIndex, icon: { prefix: "fas", name: "truck" }, fields: { spec: { label: "Spec", hints: ["MC08", "MC10", "MC12", "MC14", "MC16", "MC18", "MC20", "MC22"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { kilns: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { kilns: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { kilns: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { bays: { area: ["North"] }, kilns: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const fit = $.let(Func.bind(yardFit));
        // The yard's check reads its own fields: a bin measured off its booked spec is flagged, never refused.
        const check = $.const(East.function([Allocation.Types.CheckContext(KilnBin)], ArrayType(Allocation.Types.Issue), ($2, cx) => {
            const issues = $2.let([], ArrayType(Allocation.Types.Issue));
            $2.for(cx.plan.bins, ($3, bin, id) => {
                $3.match(bin.arrival, { some: ($4, code) => {
                    $4.if(East.notEqual(bin.row.specBooked, bin.row.specMeasured), ($5) => {
                        $5(issues.pushLast({ kind: variant("custom", "Spec mismatch"), tone: variant("neutral", null),
                            title: East.str`${code} · bin ${id}`,
                            detail: East.str`Spec booked ${bin.row.specBooked} · measured ${bin.row.specMeasured} · ${bin.lane} ${bin.at.printFormatted("HH:mm")}`,
                            bin: some(id), resource: none, flag: some("≠ spec"), fix: none }));
                    });
                } });
            });
            return issues;
        }));
        return <Box width="100%" height="900px"><Allocation id="allocationKilnYard" title="Kiln loading" fit={fit} check={check} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "timeline", date: yardDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                // A booked bin's own fields: the ones no role maps.
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } })}
            columns={[
                { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
                    tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: b => b.gradeMeasured.startsWith(b.gradeBooked).ifElse(() => b.gradeMeasured, () => East.str`booked ${b.gradeBooked} · measured ${b.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: b => b.instruction.unwrap("some", () => "none"), table: false },
            ]} />
        </Box>;
    }}</Reactive>),
});

export const allocationTable = example({
    description: "The kiln yard as a Table: one row per bay slot and one per extra bin of a batch, in four foldable time bands, narrowed by the bays' area or cover, the kilns' group, max or name, and the loads' spec; the same drafts, library and inspector as the Timeline.",
    keywords: ["Allocation", "Table", "Schedule.events", "Schedule.resources", "Schedule.periods", "Allocation.arrivals", "Func.bind", "columns", "Chooser", "Slice.bindRecords"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const entries = $.let(Data.bindPaged(kilnBins));
        const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        const days = $.let(Record.bind(yardDays, [yardDaysPatch]));
        // Every bay, kiln and load is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea, yardBaysByCover] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroupMax, kilnsByName] }));
        const loadIndex = $.let(Data.bindPaged(arrivals, { indexes: [arrivalsBySpec] }));
        const slice = $.let(Slice.bindRecords("ex.allocationTable", {
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, icon: { prefix: "fas", name: "warehouse" },
                fields: { area: { label: "Area", hints: ["North", "South"] }, cover: { label: "Cover", hints: ["Covered", "Open"] } } },
            // A max narrows within a group (one index on group, then max); a name is searched by its start.
            kilns: { source: kilnIndex, icon: { prefix: "fas", name: "fire" },
                fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] }, max: { label: "Max m³" }, name: { label: "Name" } } },
            arrivals: { source: loadIndex, icon: { prefix: "fas", name: "truck" }, fields: { spec: { label: "Spec", hints: ["MC08", "MC10", "MC12", "MC14", "MC16", "MC18", "MC20", "MC22"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { kilns: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { kilns: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { kilns: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { bays: { area: ["North"] }, kilns: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="900px"><Allocation id="allocationTable" title="Kiln loading" fit={fit} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "table", date: yardDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } })}
            columns={[
                { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
                    tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: b => b.gradeMeasured.startsWith(b.gradeBooked).ifElse(() => b.gradeMeasured, () => East.str`booked ${b.gradeBooked} · measured ${b.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: b => b.instruction.unwrap("some", () => "none"), table: false },
            ]} />
        </Box>;
    }}</Reactive>),
});

export const allocationLabels = example({
    description: "The kiln yard in its own words: labels={{ lane: \"Bay\", arrival: { one: \"Delivery\", other: \"Deliveries\" }, resource: \"Kiln\", quantity: \"Vol\" }} names the board's lanes, arrivals, resources and quantity everywhere it writes them — the Table's heads, the Chooser, the placeholders, the drag captions, the banners and the narrowing's summary — and table={{ bands }} sets the Table's time bands to the yard's shifts.",
    keywords: ["Allocation", "labels", "nouns", "arrival", "Table", "bands", "Schedule.events", "Allocation.arrivals", "Func.bind"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const entries = $.let(Data.bindPaged(kilnBins));
        const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        const days = $.let(Record.bind(yardDays, [yardDaysPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationLabels", {
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            kilns: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { kilns: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { kilns: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { kilns: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { bays: { area: ["North"] }, kilns: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="900px"><Allocation id="allocationLabels" title="Kiln loading" fit={fit} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "table", date: yardDay }}
            labels={{ lane: "Bay", arrival: { one: "Delivery", other: "Deliveries" }, resource: "Kiln", quantity: "Vol" }}
            table={{ bands: [{ from: 0, label: "Night" }, { from: 6, label: "Day shift" }, { from: 18, label: "Evening" }] }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } })}
            columns={[
                { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
                    tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: b => b.gradeMeasured.startsWith(b.gradeBooked).ifElse(() => b.gradeMeasured, () => East.str`booked ${b.gradeBooked} · measured ${b.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: b => b.instruction.unwrap("some", () => "none"), table: false },
            ]} />
        </Box>;
    }}</Reactive>),
});

export const allocationPublished = example({
    description: "A published day, Tue 4 May, its status the yard's own day issued: read-only under its banner; navigation, the narrowing, the focus, links and the inspector still work.",
    keywords: ["Allocation", "Schedule.periods", "Publish", "published", "readOnly", "Record.bind"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const entries = $.let(Data.bindPaged(kilnBins));
        const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        const days = $.let(Record.bind(yardDays, [yardDaysPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationPublished", {
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            kilns: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { kilns: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { kilns: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { kilns: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { bays: { area: ["North"] }, kilns: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="900px"><Allocation id="allocationPublished" title="Kiln loading" fit={fit} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "timeline", date: yardPublishedDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } })}
            columns={[
                { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
                    tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: b => b.gradeMeasured.startsWith(b.gradeBooked).ifElse(() => b.gradeMeasured, () => East.str`booked ${b.gradeBooked} · measured ${b.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: b => b.instruction.unwrap("some", () => "none"), table: false },
            ]} />
        </Box>;
    }}</Reactive>),
});

export const allocationNoPublish = example({
    description: "The kiln yard with no `periods`: no status chip and no Publish; Save writes the day's bins as drafts.",
    keywords: ["Allocation", "periods", "publish", "Save", "Schedule.events", "Record.bind"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const entries = $.let(Data.bindPaged(kilnBins));
        const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationNoPublish", {
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            kilns: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { kilns: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { kilns: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { kilns: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { bays: { area: ["North"] }, kilns: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="900px"><Allocation id="allocationNoPublish" title="Kiln loading" fit={fit} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "timeline", date: yardDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            columns={[
                { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
                    tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: b => b.gradeMeasured.startsWith(b.gradeBooked).ifElse(() => b.gradeMeasured, () => East.str`booked ${b.gradeBooked} · measured ${b.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: b => b.instruction.unwrap("some", () => "none"), table: false },
            ]} />
        </Box>;
    }}</Reactive>),
});

export const allocationSplit = example({
    description: "Loads split across kilns on Wed 12 May: each bin's parts on their kilns, one load with 4 m³ unallocated and its Partly allocated issue, and a link to each part.",
    keywords: ["Allocation", "split", "parts", "unallocated", "Find a fit", "links", "Schedule.events"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const entries = $.let(Data.bindPaged(kilnBins));
        const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        const days = $.let(Record.bind(yardDays, [yardDaysPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationSplit", {
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            kilns: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { kilns: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { kilns: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { kilns: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { bays: { area: ["North"] }, kilns: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="900px"><Allocation id="allocationSplit" title="Kiln loading" fit={fit} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "timeline", date: yardSplitDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } })}
            columns={[
                { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
                    tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: b => b.gradeMeasured.startsWith(b.gradeBooked).ifElse(() => b.gradeMeasured, () => East.str`booked ${b.gradeBooked} · measured ${b.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: b => b.instruction.unwrap("some", () => "none"), table: false },
            ]} />
        </Box>;
    }}</Reactive>),
});

export const allocationWindowed = example({
    description: "Two years of bins read a day at a time through the slice's bin source — an interval index over their times, its range the board's own navigation — and the plan's days by key: only the active day and the open picker's month are requested, never a record whole.",
    keywords: ["Allocation", "Schedule.events", "Schedule.periods", "Slice.bindRecords", "Data.bindPaged", "recordIndex", "interval", "history", "entries", "BuilderFrame", "Save", "Publish"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(kilnBinHistory, [kilnBinHistoryPatch]));
        const entries = $.let(Data.bindPaged(kilnBinHistory));
        const byTime = $.let(Data.bindPaged(kilnBinHistory, { indexes: [kilnBinHistoryByTime] }));
        // The days of the plan read by key: the day, and the open picker's month.
        const days = $.let(Record.bind(yardDayHistory, [yardDayHistoryPatch]));
        const dayEntries = $.let(Data.bindPaged(yardDayHistory));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationWindowed", {
            // The day's bins: the board's navigation writes the range.
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            kilns: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { kilns: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { kilns: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { kilns: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { bays: { area: ["North"] }, kilns: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="900px"><Allocation id="allocationWindowed" title="Kiln loading" fit={fit} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "timeline", date: yardDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" }, entries: dayEntries })}
            columns={[
                { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
                    tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: b => b.gradeMeasured.startsWith(b.gradeBooked).ifElse(() => b.gradeMeasured, () => East.str`booked ${b.gradeBooked} · measured ${b.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: b => b.instruction.unwrap("some", () => "none"), table: false },
            ]} />
        </Box>;
    }}</Reactive>),
});

export const allocationMobile = example({
    description: "The kiln yard in a 390px container: a card per kiln (or per slot in the Table) with Book, Reserve, Allocate, Unlink and Back to Arrivals in anchored popovers; no drag source or target.",
    keywords: ["Allocation", "mobile", "narrow", "cards", "Schedule.events", "Record.bind"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const entries = $.let(Data.bindPaged(kilnBins));
        const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        const days = $.let(Record.bind(yardDays, [yardDaysPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationMobile", {
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            kilns: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { kilns: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { kilns: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { kilns: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { bays: { area: ["North"] }, kilns: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" maxWidth="390px" height="760px"><Allocation id="allocationMobile" title="Kiln loading" fit={fit} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "timeline", date: yardDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } })}
            columns={[
                { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
                    tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: b => b.gradeMeasured.startsWith(b.gradeBooked).ifElse(() => b.gradeMeasured, () => East.str`booked ${b.gradeBooked} · measured ${b.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: b => b.instruction.unwrap("some", () => "none"), table: false },
            ]} />
        </Box>;
    }}</Reactive>),
});

export const allocationCustomBin = example({
    description: "The bin kind's own inspector: the yard's typed bin form — its m³ and its loading instruction, each change the bin written back whole — in place of the built-in quantity field and the row's other fields.",
    keywords: ["Allocation", "Schedule.events", "inspector", "bin", "Field", "typed form"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const entries = $.let(Data.bindPaged(kilnBins));
        const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        const days = $.let(Record.bind(yardDays, [yardDaysPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationCustomBin", {
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            kilns: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { kilns: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { kilns: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { kilns: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { bays: { area: ["North"] }, kilns: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const fit = $.let(Func.bind(yardFit));
        // The bin's own form: its m³ and its loading instruction, each change the bin written back whole.
        const binForm = $.const(East.function([KilnBin, FunctionType([KilnBin], NullType)], UIComponentType, (_$2, row, update) =>
            <VStack>
                <Field.FloatInput label="Quantity" value={row.m3} min={0} step={1} onChange={(_$3, m3) => update({ bay: row.bay, at: row.at, load: row.load,
                    m3, spec: row.spec, dryFor: row.dryFor, kilns: row.kilns, specBooked: row.specBooked, specMeasured: row.specMeasured,
                    gradeBooked: row.gradeBooked, gradeMeasured: row.gradeMeasured, instruction: row.instruction })} />
                <Field.StringInput label="Loading instruction" value={row.instruction.unwrap("some", () => "")} onChange={(_$3, text) => update({ bay: row.bay,
                    at: row.at, load: row.load, m3: row.m3, spec: row.spec, dryFor: row.dryFor, kilns: row.kilns, specBooked: row.specBooked,
                    specMeasured: row.specMeasured, gradeBooked: row.gradeBooked, gradeMeasured: row.gradeMeasured,
                    instruction: East.equal(text, "").ifElse(() => none, () => some(text)) })} />
            </VStack>));
        return <Box width="100%" height="900px"><Allocation id="allocationCustomBin" title="Kiln loading" fit={fit} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "timeline", date: yardDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                inspector: binForm,
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } })}
            columns={[
                { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
                    tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: b => b.gradeMeasured.startsWith(b.gradeBooked).ifElse(() => b.gradeMeasured, () => East.str`booked ${b.gradeBooked} · measured ${b.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: b => b.instruction.unwrap("some", () => "none"), table: false },
            ]} />
        </Box>;
    }}</Reactive>),
});

export const allocationFitRule = example({
    description: "The ready-made fit with one yard rule over it, as an e3.function: a bulk kiln takes no load under 20 m³, so LD-2235 (8 m³) fits K-305 alone.",
    keywords: ["Allocation", "fit", "e3.function", "Func.bind", "Allocation.fit", "Allocation.answer", "rule"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const entries = $.let(Data.bindPaged(kilnBins));
        const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        const days = $.let(Record.bind(yardDays, [yardDaysPatch]));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationFitRule", {
            bin: { source: byTime, range: "at" },
            bays: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            kilns: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { kilns: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { kilns: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { kilns: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { bays: { area: ["North"] }, kilns: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const fit = $.let(Func.bind(bulkFit));
        return <Box width="100%" height="900px"><Allocation id="allocationFitRule" title="Kiln loading" fit={fit} slice={{ slice }} inspector
            library={[Allocation.library.arrivals(), Allocation.library.resources()]} view={{ layout: "timeline", date: yardDay }}
            events={{ bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
            }) }}
            resources={{
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            }}
            arrivals={Allocation.arrivals(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } })}
            columns={[
                { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
                    tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: b => b.gradeMeasured.startsWith(b.gradeBooked).ifElse(() => b.gradeMeasured, () => East.str`booked ${b.gradeBooked} · measured ${b.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: b => b.instruction.unwrap("some", () => "none"), table: false },
            ]} />
        </Box>;
    }}</Reactive>),
});
