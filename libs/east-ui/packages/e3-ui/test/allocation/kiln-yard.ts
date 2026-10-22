/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The kiln yard, transcribed from docs/proposals/Allocation Spec.html into
 * records of its own (#1371, `Builder Interfaces Spec.md` §6.5): its bins and
 * the days of its plan, which the board writes, and its kilns, its loads and
 * its bays, which it reads — three unloading bays in two areas, 33 drying
 * kilns in six groups, the day's loads and Tue 11 May 2027's plan. Every name,
 * code and figure is generated. Beside them, the board's reading of the plan
 * day (`Allocation.Types.Day(KilnBin)`), each bin its roles and the yard's own
 * row, which the pure functions' specs hold to the spec's worked facts (§0).
 */
import {
    ArrayType, DateTimeType, DictType, FloatType, NullType, OptionType, SortedMap, StringType, StructType, VariantType, compareFor, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { TimeStepType } from "@elaraai/east-ui";
import { Allocation } from "@elaraai/e3-ui";

/**
 * A bin, the yard's own: where it is booked (its bay and its time), the load
 * it books (none: a reservation), its m³, its spec, how long it dries and its
 * split across kilns — the board's roles — and the yard's own fields beside
 * them: the moisture target and grade booked, and as measured on arrival, and
 * its loading instruction.
 */
export const KilnBin = StructType({
    bay: StringType, at: DateTimeType, load: OptionType(StringType),
    m3: FloatType, spec: OptionType(StringType), dryFor: TimeStepType,
    kilns: DictType(StringType, FloatType),
    specBooked: StringType, specMeasured: StringType,
    gradeBooked: StringType, gradeMeasured: StringType, instruction: OptionType(StringType),
});
/** A day of the yard's plan: a draft, or issued and when. */
export const YardDay = StructType({ state: VariantType({ draft: NullType, issued: StructType({ at: DateTimeType }) }) });
/** A bin of the smallest board's: the board's roles alone — its bay, its time, its load, its m³, its split across kilns and how long it dries. */
export const MinimalBin = StructType({
    bay: StringType, at: DateTimeType, load: OptionType(StringType), m3: FloatType, kilns: DictType(StringType, FloatType), dryFor: TimeStepType,
});
/** A drying kiln: its range, the days it usually dries for, and its charges — the one drying now and the next planned. */
export const Kiln = StructType({
    name: StringType, group: StringType, min: FloatType, max: FloatType, days: FloatType, note: OptionType(StringType),
    charges: ArrayType(Allocation.Types.Job),
});
/** An unloading bay: its name, the yard area it stands in, whether it is covered or open, and how far past each hour it takes its bin. */
export const Bay = StructType({ name: StringType, area: StringType, cover: StringType, offset: TimeStepType });
/** A load of sawn timber on its way from a mill. */
export const TimberLoad = StructType({
    code: StringType, mill: StringType, spec: StringType, grade: StringType,
    m3: FloatType, dryingDays: FloatType, due: DateTimeType, from: DateTimeType, to: DateTimeType,
    schedule: StringType, instruction: OptionType(StringType),
});
/** The board's reading of a bin of the yard's: its roles, and the yard's own row. */
export const YardBin = Allocation.Types.Bin(KilnBin);
/** The board's reading of a day of the yard's: its status, and its bins. */
export const YardPlan = Allocation.Types.Day(KilnBin);

const byString = compareFor(StringType);
const byDate = compareFor(DateTimeType);
const DAY = 86_400_000;
/** The plan day the mock opens on: Tue 11 May 2027. */
export const yardDay: Date = new Date("2027-05-11T00:00:00Z");
/** The week before's day, published: Tue 4 May 2027. */
export const yardPublishedDay: Date = new Date("2027-05-04T00:00:00Z");
/** When Tue 4 May was issued. */
export const yardIssuedAt: Date = new Date("2027-05-03T17:40:00Z");
/** A day of loads split across kilns: Wed 12 May 2027. */
export const yardSplitDay: Date = new Date("2027-05-12T00:00:00Z");
/** The unloading bays, by key: two in the north yard, one in the south, B-2 the open one; each takes one bin an hour, at its offset past the hour. */
export const yardBayRows: SortedMap<string, ValueTypeOf<typeof Bay>> = new SortedMap<string, ValueTypeOf<typeof Bay>>([
    ["B-1", { name: "B-1", area: "North", cover: "Covered", offset: variant("minutes", 15) }],
    ["B-2", { name: "B-2", area: "North", cover: "Open", offset: variant("minutes", 35) }],
    ["B-3", { name: "B-3", area: "South", cover: "Covered", offset: variant("minutes", 55) }],
], byString);
export const yardKilns: SortedMap<string, ValueTypeOf<typeof Kiln>> = new SortedMap<string, ValueTypeOf<typeof Kiln>>([
    ["K-101", { name: "K-101", group: "Hall A", min: 16, max: 32, days: 9, note: none, charges: [{ label: "planned", start: new Date("2027-05-20T00:00:00Z"), end: new Date("2027-05-28T00:00:00Z") }] }],
    ["K-102", { name: "K-102", group: "Hall A", min: 16, max: 32, days: 9, note: none, charges: [] }],
    ["K-103", { name: "K-103", group: "Hall A", min: 16, max: 32, days: 8, note: none, charges: [{ label: "C-3141", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-08T00:00:00Z") }, { label: "planned", start: new Date("2027-05-18T00:00:00Z"), end: new Date("2027-05-26T00:00:00Z") }] }],
    ["K-104", { name: "K-104", group: "Hall A", min: 16, max: 32, days: 8, note: none, charges: [{ label: "planned", start: new Date("2027-05-14T00:00:00Z"), end: new Date("2027-05-22T00:00:00Z") }] }],
    ["K-105", { name: "K-105", group: "Hall A", min: 16, max: 32, days: 8, note: none, charges: [{ label: "planned", start: new Date("2027-05-17T00:00:00Z"), end: new Date("2027-05-25T00:00:00Z") }] }],
    ["K-106", { name: "K-106", group: "Hall A", min: 12, max: 24, days: 8, note: none, charges: [{ label: "C-3142", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-08T00:00:00Z") }] }],
    ["K-107", { name: "K-107", group: "Hall A", min: 12, max: 24, days: 8, note: none, charges: [{ label: "planned", start: new Date("2027-05-19T00:00:00Z"), end: new Date("2027-05-27T00:00:00Z") }] }],
    ["K-108", { name: "K-108", group: "Hall A", min: 16, max: 32, days: 7, note: some("the plan had this charge on Wed 12"), charges: [{ label: "C-3143", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-11T00:00:00Z") }, { label: "planned", start: new Date("2027-05-20T00:00:00Z"), end: new Date("2027-05-28T00:00:00Z") }] }],
    ["K-109", { name: "K-109", group: "Hall A", min: 12, max: 24, days: 9, note: none, charges: [{ label: "planned", start: new Date("2027-05-20T00:00:00Z"), end: new Date("2027-05-28T00:00:00Z") }] }],
    ["K-110", { name: "K-110", group: "Hall A", min: 12, max: 24, days: 8, note: none, charges: [{ label: "C-3144", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-08T00:00:00Z") }, { label: "planned", start: new Date("2027-05-14T00:00:00Z"), end: new Date("2027-05-22T00:00:00Z") }] }],
    ["K-201", { name: "K-201", group: "Hall B", min: 20, max: 40, days: 8, note: none, charges: [{ label: "C-3145", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-11T00:00:00Z") }, { label: "planned", start: new Date("2027-05-21T00:00:00Z"), end: new Date("2027-05-29T00:00:00Z") }] }],
    ["K-202", { name: "K-202", group: "Hall B", min: 20, max: 40, days: 8, note: none, charges: [{ label: "planned", start: new Date("2027-05-20T00:00:00Z"), end: new Date("2027-05-28T00:00:00Z") }] }],
    ["K-203", { name: "K-203", group: "Hall B", min: 20, max: 40, days: 7, note: none, charges: [{ label: "planned", start: new Date("2027-05-19T00:00:00Z"), end: new Date("2027-05-27T00:00:00Z") }] }],
    ["K-204", { name: "K-204", group: "Hall B", min: 20, max: 40, days: 8, note: none, charges: [{ label: "planned", start: new Date("2027-05-15T00:00:00Z"), end: new Date("2027-05-23T00:00:00Z") }] }],
    ["K-205", { name: "K-205", group: "Hall B", min: 20, max: 40, days: 8, note: none, charges: [{ label: "C-3146", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-10T00:00:00Z") }, { label: "planned", start: new Date("2027-05-19T00:00:00Z"), end: new Date("2027-05-27T00:00:00Z") }] }],
    ["K-206", { name: "K-206", group: "Hall B", min: 20, max: 40, days: 7, note: none, charges: [{ label: "C-3147", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-09T00:00:00Z") }, { label: "planned", start: new Date("2027-05-18T00:00:00Z"), end: new Date("2027-05-26T00:00:00Z") }] }],
    ["K-207", { name: "K-207", group: "Hall B", min: 20, max: 40, days: 9, note: none, charges: [{ label: "C-3148", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-08T00:00:00Z") }, { label: "planned", start: new Date("2027-05-20T00:00:00Z"), end: new Date("2027-05-28T00:00:00Z") }] }],
    ["K-208", { name: "K-208", group: "Hall B", min: 20, max: 40, days: 8, note: none, charges: [{ label: "C-3149", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-08T00:00:00Z") }, { label: "planned", start: new Date("2027-05-13T00:00:00Z"), end: new Date("2027-05-21T00:00:00Z") }] }],
    ["K-209", { name: "K-209", group: "Hall B", min: 20, max: 40, days: 7, note: none, charges: [{ label: "planned", start: new Date("2027-05-19T00:00:00Z"), end: new Date("2027-05-27T00:00:00Z") }] }],
    ["K-301", { name: "K-301", group: "Compact", min: 4, max: 10, days: 8, note: none, charges: [{ label: "C-3150", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-08T00:00:00Z") }, { label: "planned", start: new Date("2027-05-16T00:00:00Z"), end: new Date("2027-05-24T00:00:00Z") }] }],
    ["K-302", { name: "K-302", group: "Compact", min: 4, max: 10, days: 9, note: none, charges: [{ label: "planned", start: new Date("2027-05-20T00:00:00Z"), end: new Date("2027-05-28T00:00:00Z") }] }],
    ["K-303", { name: "K-303", group: "Compact", min: 4, max: 10, days: 8, note: some("the plan had this charge on Thu 13"), charges: [{ label: "planned", start: new Date("2027-05-20T00:00:00Z"), end: new Date("2027-05-28T00:00:00Z") }] }],
    ["K-304", { name: "K-304", group: "Compact", min: 4, max: 10, days: 7, note: none, charges: [{ label: "planned", start: new Date("2027-05-19T00:00:00Z"), end: new Date("2027-05-27T00:00:00Z") }] }],
    ["K-305", { name: "K-305", group: "Compact", min: 4, max: 10, days: 8, note: none, charges: [{ label: "C-3151", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-11T00:00:00Z") }, { label: "planned", start: new Date("2027-05-20T00:00:00Z"), end: new Date("2027-05-28T00:00:00Z") }] }],
    ["K-401", { name: "K-401", group: "Standard", min: 10, max: 20, days: 9, note: none, charges: [{ label: "planned", start: new Date("2027-05-20T00:00:00Z"), end: new Date("2027-05-28T00:00:00Z") }] }],
    ["K-402", { name: "K-402", group: "Standard", min: 10, max: 20, days: 7, note: none, charges: [{ label: "planned", start: new Date("2027-05-18T00:00:00Z"), end: new Date("2027-05-26T00:00:00Z") }] }],
    ["K-403", { name: "K-403", group: "Standard", min: 10, max: 20, days: 9, note: none, charges: [{ label: "C-3152", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-08T00:00:00Z") }, { label: "planned", start: new Date("2027-05-22T00:00:00Z"), end: new Date("2027-05-30T00:00:00Z") }] }],
    ["K-501", { name: "K-501", group: "Large", min: 24, max: 48, days: 7, note: none, charges: [{ label: "planned", start: new Date("2027-05-19T00:00:00Z"), end: new Date("2027-05-27T00:00:00Z") }] }],
    ["K-502", { name: "K-502", group: "Large", min: 24, max: 48, days: 8, note: none, charges: [{ label: "planned", start: new Date("2027-05-14T00:00:00Z"), end: new Date("2027-05-22T00:00:00Z") }] }],
    ["K-503", { name: "K-503", group: "Large", min: 24, max: 48, days: 9, note: none, charges: [{ label: "C-3153", start: new Date("2027-05-01T00:00:00Z"), end: new Date("2027-05-14T00:00:00Z") }, { label: "planned", start: new Date("2027-05-14T00:00:00Z"), end: new Date("2027-05-22T00:00:00Z") }] }],
    ["K-504", { name: "K-504", group: "Large", min: 24, max: 48, days: 9, note: none, charges: [{ label: "C-3154", start: new Date("2027-05-05T00:00:00Z"), end: new Date("2027-05-15T00:00:00Z") }, { label: "planned", start: new Date("2027-05-14T00:00:00Z"), end: new Date("2027-05-22T00:00:00Z") }] }],
    ["K-601", { name: "K-601", group: "Bulk", min: 40, max: 60, days: 8, note: none, charges: [] }],
    ["K-602", { name: "K-602", group: "Bulk", min: 40, max: 60, days: 8, note: none, charges: [{ label: "C-3155", start: new Date("2027-04-28T00:00:00Z"), end: new Date("2027-05-08T00:00:00Z") }, { label: "planned", start: new Date("2027-05-16T00:00:00Z"), end: new Date("2027-05-24T00:00:00Z") }] }],
], byString);
export const yardArrivals: SortedMap<string, ValueTypeOf<typeof TimberLoad>> = new SortedMap<string, ValueTypeOf<typeof TimberLoad>>([
    ["LD-2231", { code: "LD-2231", mill: "BRK", spec: "MC12", grade: "R2", m3: 21, dryingDays: 8, due: new Date("2027-05-09T00:00:00Z"), from: new Date("2027-05-07T00:00:00Z"), to: new Date("2027-05-10T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2232", { code: "LD-2232", mill: "RDG", spec: "MC10", grade: "R1", m3: 30, dryingDays: 8, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-14T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2233", { code: "LD-2233", mill: "RDG", spec: "MC10", grade: "R1", m3: 26, dryingDays: 8, due: new Date("2027-05-12T00:00:00Z"), from: new Date("2027-05-11T00:00:00Z"), to: new Date("2027-05-15T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2234", { code: "LD-2234", mill: "ASH", spec: "MC12", grade: "P2", m3: 18, dryingDays: 9, due: new Date("2027-05-12T00:00:00Z"), from: new Date("2027-05-11T00:00:00Z"), to: new Date("2027-05-14T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2235", { code: "LD-2235", mill: "MRS", spec: "MC10", grade: "P1", m3: 8, dryingDays: 9, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2236", { code: "LD-2236", mill: "STB", spec: "MC16", grade: "U2", m3: 11, dryingDays: 6, due: new Date("2027-05-13T00:00:00Z"), from: new Date("2027-05-12T00:00:00Z"), to: new Date("2027-05-16T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2201", { code: "LD-2201", mill: "BRK", spec: "MC14", grade: "R1", m3: 35, dryingDays: 8, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-4 · 70 °C dry bulb · continuous venting", instruction: some("Load into K-209 first; any balance goes with bin 3102. Sticker every 600 mm before loading") }],
    ["LD-2202", { code: "LD-2202", mill: "STB", spec: "MC08", grade: "P1", m3: 27, dryingDays: 9, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2203", { code: "LD-2203", mill: "STB", spec: "MC14", grade: "U1", m3: 24, dryingDays: 6, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2204", { code: "LD-2204", mill: "CLY", spec: "MC14", grade: "U1", m3: 47, dryingDays: 6, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-4 · 70 °C dry bulb · continuous venting", instruction: none }],
    ["LD-2205", { code: "LD-2205", mill: "BRK", spec: "MC12", grade: "U1", m3: 39, dryingDays: 6, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-4 · 70 °C dry bulb · continuous venting", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2206", { code: "LD-2206", mill: "ASH", spec: "MC20", grade: "P2", m3: 36, dryingDays: 9, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-6 · 80 °C · equalise 12 h · condition 6 h", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2207", { code: "LD-2207", mill: "ASH", spec: "MC14", grade: "R3", m3: 63, dryingDays: 8, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-6 · 80 °C · equalise 12 h · condition 6 h", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2208", { code: "LD-2208", mill: "RDG", spec: "MC18", grade: "P2", m3: 1, dryingDays: 9, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: none }],
    ["LD-2209", { code: "LD-2209", mill: "BRK", spec: "MC18", grade: "R3", m3: 18, dryingDays: 8, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-4 · 70 °C dry bulb · continuous venting", instruction: none }],
    ["LD-2210", { code: "LD-2210", mill: "FRN", spec: "MC08", grade: "R2", m3: 32, dryingDays: 8, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-7 · 80 °C · equalise 12 h · direct", instruction: none }],
    ["LD-2211", { code: "LD-2211", mill: "FRN", spec: "MC16", grade: "R1", m3: 2, dryingDays: 8, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2212", { code: "LD-2212", mill: "RDG", spec: "MC20", grade: "U2", m3: 20, dryingDays: 6, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-7 · 80 °C · equalise 12 h · direct", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2213", { code: "LD-2213", mill: "STB", spec: "MC22", grade: "R2", m3: 10, dryingDays: 8, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2214", { code: "LD-2214", mill: "BRK", spec: "MC18", grade: "R3", m3: 5, dryingDays: 8, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2215", { code: "LD-2215", mill: "RDG", spec: "MC14", grade: "U2", m3: 15, dryingDays: 6, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2216", { code: "LD-2216", mill: "ASH", spec: "MC14", grade: "U1", m3: 37, dryingDays: 6, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2217", { code: "LD-2217", mill: "CLY", spec: "MC08", grade: "U2", m3: 5, dryingDays: 6, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-7 · 80 °C · equalise 12 h · direct", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2218", { code: "LD-2218", mill: "HLM", spec: "MC08", grade: "P1", m3: 38, dryingDays: 9, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-7 · 80 °C · equalise 12 h · direct", instruction: none }],
    ["LD-2219", { code: "LD-2219", mill: "MRS", spec: "MC20", grade: "R2", m3: 54, dryingDays: 8, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2220", { code: "LD-2220", mill: "RDG", spec: "MC18", grade: "R1", m3: 31, dryingDays: 8, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: none }],
    ["LD-2221", { code: "LD-2221", mill: "FRN", spec: "MC08", grade: "R3", m3: 17, dryingDays: 8, due: new Date("2027-05-11T00:00:00Z"), from: new Date("2027-05-10T00:00:00Z"), to: new Date("2027-05-13T00:00:00Z"), schedule: "Schedule KS-4 · 70 °C dry bulb · continuous venting", instruction: some("Hold the kiln at 40 °C on arrival") }],
], byString);

type Row = ValueTypeOf<typeof KilnBin>;
/** Tue 4 May 2027's bins: the week before's plan, published. */
const publishedBins: [string, Row][] = [
    ["3001", { bay: "B-1", at: new Date("2027-05-04T06:15:00Z"), load: some("LD-2201"), m3: 35, spec: some("MC14"), dryFor: variant("days", 8), kilns: new SortedMap([["K-209", 35]], byString), specBooked: "MC14", specMeasured: "MC14", gradeBooked: "R", gradeMeasured: "R1", instruction: some("Sticker every 600 mm before loading") }],
    ["3002", { bay: "B-2", at: new Date("2027-05-04T06:35:00Z"), load: some("LD-2205"), m3: 39, spec: some("MC12"), dryFor: variant("days", 6), kilns: new SortedMap([["K-203", 39]], byString), specBooked: "MC12", specMeasured: "MC12", gradeBooked: "U", gradeMeasured: "U1", instruction: some("Sticker every 600 mm before loading") }],
    ["3003", { bay: "B-3", at: new Date("2027-05-04T08:55:00Z"), load: some("LD-2213"), m3: 10, spec: some("MC22"), dryFor: variant("days", 8), kilns: new SortedMap([["K-303", 10]], byString), specBooked: "MC22", specMeasured: "MC22", gradeBooked: "R", gradeMeasured: "R2", instruction: some("Sticker every 600 mm before loading") }],
    ["3004", { bay: "B-1", at: new Date("2027-05-04T10:15:00Z"), load: some("LD-2215"), m3: 15, spec: some("MC14"), dryFor: variant("days", 6), kilns: new SortedMap([["K-401", 15]], byString), specBooked: "MC14", specMeasured: "MC14", gradeBooked: "U", gradeMeasured: "U2", instruction: some("Sticker every 600 mm before loading") }],
];
/** Tue 11 May 2027's bins, as the mock opens: 26 bins in 18 slots, 556 m³. */
const planBins: [string, Row][] = [
    ["3101", { bay: "B-3", at: new Date("2027-05-11T01:55:00Z"), load: some("LD-2201"), m3: 35, spec: some("MC14"), dryFor: variant("days", 7), kilns: new SortedMap([["K-209", 35]], byString), specBooked: "MC14", specMeasured: "MC14", gradeBooked: "R", gradeMeasured: "R1", instruction: some("Load into K-209 first; any balance goes with bin 3102. Sticker every 600 mm before loading") }],
    ["3102", { bay: "B-3", at: new Date("2027-05-11T01:56:00Z"), load: some("LD-2202"), m3: 27, spec: some("MC22"), dryFor: variant("days", 9), kilns: new SortedMap([["K-102", 27]], byString), specBooked: "MC08", specMeasured: "MC22", gradeBooked: "P", gradeMeasured: "P1", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["3103", { bay: "B-1", at: new Date("2027-05-11T02:15:00Z"), load: some("LD-2203"), m3: 24, spec: some("MC14"), dryFor: variant("days", 9), kilns: new SortedMap([["K-109", 24]], byString), specBooked: "MC14", specMeasured: "MC14", gradeBooked: "U", gradeMeasured: "U1", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["3104", { bay: "B-1", at: new Date("2027-05-11T03:15:00Z"), load: some("LD-2204"), m3: 47, spec: some("MC14"), dryFor: variant("days", 7), kilns: new SortedMap([["K-501", 47]], byString), specBooked: "MC14", specMeasured: "MC14", gradeBooked: "P", gradeMeasured: "U1", instruction: none }],
    ["3105", { bay: "B-1", at: new Date("2027-05-11T04:15:00Z"), load: some("LD-2205"), m3: 39, spec: some("MC10"), dryFor: variant("days", 7), kilns: new SortedMap([["K-203", 39]], byString), specBooked: "MC12", specMeasured: "MC10", gradeBooked: "P", gradeMeasured: "U1", instruction: some("Sticker every 600 mm before loading") }],
    ["3106", { bay: "B-2", at: new Date("2027-05-11T05:35:00Z"), load: some("LD-2206"), m3: 1, spec: some("MC18"), dryFor: variant("days", 7), kilns: new SortedMap([["K-304", 1]], byString), specBooked: "MC20", specMeasured: "MC18", gradeBooked: "P", gradeMeasured: "P2", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["3107", { bay: "B-2", at: new Date("2027-05-11T05:36:00Z"), load: some("LD-2206"), m3: 35, spec: some("MC18"), dryFor: variant("days", 8), kilns: new SortedMap([["K-201", 35]], byString), specBooked: "MC18", specMeasured: "MC18", gradeBooked: "P", gradeMeasured: "P1", instruction: some("Sticker every 600 mm before loading") }],
    ["3108", { bay: "B-2", at: new Date("2027-05-11T06:35:00Z"), load: some("LD-2207"), m3: 19, spec: some("MC12"), dryFor: variant("days", 7), kilns: new SortedMap([["K-402", 19]], byString), specBooked: "MC14", specMeasured: "MC12", gradeBooked: "P", gradeMeasured: "R3", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["3109", { bay: "B-2", at: new Date("2027-05-11T06:36:00Z"), load: some("LD-2207"), m3: 44, spec: some("MC12"), dryFor: variant("days", 9), kilns: new SortedMap([["K-207", 44]], byString), specBooked: "MC12", specMeasured: "MC12", gradeBooked: "P", gradeMeasured: "P2", instruction: some("Sticker every 600 mm before loading") }],
    ["3110", { bay: "B-1", at: new Date("2027-05-11T09:15:00Z"), load: some("LD-2208"), m3: 1, spec: some("MC18"), dryFor: variant("days", 7), kilns: new SortedMap([["K-304", 1]], byString), specBooked: "MC18", specMeasured: "MC18", gradeBooked: "U", gradeMeasured: "P2", instruction: none }],
    ["3111", { bay: "B-1", at: new Date("2027-05-11T10:15:00Z"), load: some("LD-2209"), m3: 16, spec: some("MC18"), dryFor: variant("days", 9), kilns: new SortedMap([["K-403", 16]], byString), specBooked: "MC18", specMeasured: "MC18", gradeBooked: "P", gradeMeasured: "R3", instruction: none }],
    ["3112", { bay: "B-1", at: new Date("2027-05-11T10:16:00Z"), load: some("LD-2209"), m3: 2, spec: some("MC20"), dryFor: variant("days", 7), kilns: new SortedMap([["K-304", 2]], byString), specBooked: "MC22", specMeasured: "MC20", gradeBooked: "R", gradeMeasured: "R3", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["3113", { bay: "B-2", at: new Date("2027-05-11T10:35:00Z"), load: some("LD-2210"), m3: 32, spec: some("MC22"), dryFor: variant("days", 7), kilns: new SortedMap([["K-108", 32]], byString), specBooked: "MC08", specMeasured: "MC22", gradeBooked: "R", gradeMeasured: "R2", instruction: none }],
    ["3114", { bay: "B-1", at: new Date("2027-05-11T13:15:00Z"), load: some("LD-2211"), m3: 2, spec: some("MC16"), dryFor: variant("days", 7), kilns: new SortedMap([["K-304", 2]], byString), specBooked: "MC16", specMeasured: "MC16", gradeBooked: "R", gradeMeasured: "R1", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["3115", { bay: "B-2", at: new Date("2027-05-11T15:35:00Z"), load: some("LD-2212"), m3: 20, spec: some("MC18"), dryFor: variant("days", 8), kilns: new SortedMap([["K-106", 20]], byString), specBooked: "MC20", specMeasured: "MC18", gradeBooked: "P", gradeMeasured: "U2", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["3116", { bay: "B-3", at: new Date("2027-05-11T16:55:00Z"), load: some("LD-2213"), m3: 10, spec: some("MC20"), dryFor: variant("days", 8), kilns: new SortedMap([["K-303", 10]], byString), specBooked: "MC22", specMeasured: "MC20", gradeBooked: "P", gradeMeasured: "R2", instruction: some("Sticker every 600 mm before loading") }],
    ["3117", { bay: "B-2", at: new Date("2027-05-11T17:35:00Z"), load: some("LD-2214"), m3: 5, spec: some("MC16"), dryFor: variant("days", 8), kilns: new SortedMap([["K-301", 5]], byString), specBooked: "MC18", specMeasured: "MC16", gradeBooked: "R", gradeMeasured: "R3", instruction: some("Sticker every 600 mm before loading") }],
    ["3118", { bay: "B-3", at: new Date("2027-05-11T17:55:00Z"), load: some("LD-2215"), m3: 15, spec: some("MC14"), dryFor: variant("days", 9), kilns: new SortedMap([["K-401", 15]], byString), specBooked: "MC14", specMeasured: "MC14", gradeBooked: "U", gradeMeasured: "U2", instruction: some("Sticker every 600 mm before loading") }],
    ["3119", { bay: "B-3", at: new Date("2027-05-11T17:56:00Z"), load: some("LD-2216"), m3: 37, spec: some("MC12"), dryFor: variant("days", 8), kilns: new SortedMap([["K-205", 37]], byString), specBooked: "MC14", specMeasured: "MC12", gradeBooked: "P", gradeMeasured: "U1", instruction: some("Sticker every 600 mm before loading") }],
    ["3120", { bay: "B-3", at: new Date("2027-05-11T17:57:00Z"), load: some("LD-2217"), m3: 5, spec: some("MC08"), dryFor: variant("days", 9), kilns: new SortedMap([["K-302", 5]], byString), specBooked: "MC08", specMeasured: "MC08", gradeBooked: "U", gradeMeasured: "U2", instruction: some("Sticker every 600 mm before loading") }],
    ["3121", { bay: "B-2", at: new Date("2027-05-11T20:35:00Z"), load: some("LD-2218"), m3: 1, spec: some("MC22"), dryFor: variant("days", 7), kilns: new SortedMap([["K-304", 1]], byString), specBooked: "MC08", specMeasured: "MC22", gradeBooked: "R", gradeMeasured: "P1", instruction: none }],
    ["3122", { bay: "B-2", at: new Date("2027-05-11T20:36:00Z"), load: some("LD-2218"), m3: 37, spec: some("MC16"), dryFor: variant("days", 7), kilns: new SortedMap([["K-206", 37]], byString), specBooked: "MC16", specMeasured: "MC16", gradeBooked: "U", gradeMeasured: "U2", instruction: none }],
    ["3123", { bay: "B-3", at: new Date("2027-05-11T20:55:00Z"), load: some("LD-2219"), m3: 22, spec: some("MC20"), dryFor: variant("days", 8), kilns: new SortedMap([["K-202", 22]], byString), specBooked: "MC20", specMeasured: "MC20", gradeBooked: "R", gradeMeasured: "R2", instruction: some("Sticker every 600 mm before loading") }],
    ["3124", { bay: "B-3", at: new Date("2027-05-11T20:56:00Z"), load: some("LD-2219"), m3: 32, spec: some("MC22"), dryFor: variant("days", 8), kilns: new SortedMap([["K-105", 32]], byString), specBooked: "MC22", specMeasured: "MC22", gradeBooked: "U", gradeMeasured: "U2", instruction: some("Sticker every 600 mm before loading") }],
    ["3125", { bay: "B-2", at: new Date("2027-05-11T22:35:00Z"), load: some("LD-2220"), m3: 31, spec: some("MC18"), dryFor: variant("days", 9), kilns: new SortedMap([["K-101", 31]], byString), specBooked: "MC18", specMeasured: "MC18", gradeBooked: "U", gradeMeasured: "R1", instruction: none }],
    ["3126", { bay: "B-2", at: new Date("2027-05-11T23:35:00Z"), load: some("LD-2221"), m3: 17, spec: some("MC08"), dryFor: variant("days", 8), kilns: new SortedMap([["K-202", 17]], byString), specBooked: "MC08", specMeasured: "MC08", gradeBooked: "U", gradeMeasured: "R3", instruction: some("Hold the kiln at 40 °C on arrival") }],
];
/** Wed 12 May 2027's bins: loads split across kilns, one with a remainder still unallocated. */
const splitBins: [string, Row][] = [
    ["3201", { bay: "B-1", at: new Date("2027-05-12T06:15:00Z"), load: some("LD-2232"), m3: 30, spec: some("MC10"), dryFor: variant("days", 8), kilns: new SortedMap([["K-208", 6], ["K-601", 20]], byString), specBooked: "MC10", specMeasured: "MC10", gradeBooked: "R", gradeMeasured: "R1", instruction: some("Sticker every 600 mm before loading") }],
    ["3202", { bay: "B-2", at: new Date("2027-05-12T07:35:00Z"), load: some("LD-2234"), m3: 18, spec: some("MC12"), dryFor: variant("days", 9), kilns: new SortedMap([["K-107", 12], ["K-110", 6]], byString), specBooked: "MC12", specMeasured: "MC12", gradeBooked: "P", gradeMeasured: "P2", instruction: some("Sticker every 600 mm before loading") }],
    ["3203", { bay: "B-3", at: new Date("2027-05-12T09:55:00Z"), load: some("LD-2236"), m3: 11, spec: some("MC16"), dryFor: variant("days", 6), kilns: new SortedMap([["K-110", 3], ["K-305", 8]], byString), specBooked: "MC16", specMeasured: "MC16", gradeBooked: "U", gradeMeasured: "U2", instruction: some("Sticker every 600 mm before loading") }],
];
/** The yard's bins, every day's, by key: Tue 4 May's four, published; Tue 11's 26, the mock's day; and Wed 12's three, split across kilns. */
export const yardBinRows: SortedMap<string, Row> = new SortedMap<string, Row>([...publishedBins, ...planBins, ...splitBins], byString);
/** The days of the yard's plan: Tue 4 May issued, Tue 11 and Wed 12 drafts. */
export const yardDayRows: SortedMap<Date, ValueTypeOf<typeof YardDay>> = new SortedMap<Date, ValueTypeOf<typeof YardDay>>([
    [yardPublishedDay, { state: variant("issued", { at: yardIssuedAt }) }],
    [yardDay, { state: variant("draft", null) }],
    [yardSplitDay, { state: variant("draft", null) }],
], byDate);
/** The smallest board's bins: the plan day's, their roles alone. */
export const yardMinimalBinRows: SortedMap<string, ValueTypeOf<typeof MinimalBin>> = new SortedMap<string, ValueTypeOf<typeof MinimalBin>>(planBins.map(([id, row]) => [id, {
    bay: row.bay, at: row.at, load: row.load, m3: row.m3, kilns: new SortedMap([...row.kilns], byString), dryFor: row.dryFor,
}] as const), byString);
/**
 * Two years of the yard's bins to Tue 11 May 2027, for the board read a day
 * at a time through its slice: on each day before it, four of the plan day's
 * bins at their times on that day, keyed by how many days before; and the plan
 * day's own.
 */
export const yardBinHistoryRows: SortedMap<string, Row> = (() => {
    const history = new SortedMap<string, Row>(planBins, byString);
    const sample = planBins.slice(0, 4);
    for (let n = 1; n <= 730; n++) {
        for (const [id, row] of sample) {
            history.set(`h${n}-${id}`, { ...row, at: new Date(row.at.getTime() - n * DAY), kilns: new SortedMap([...row.kilns], byString) });
        }
    }
    return history;
})();
/** The days of those two years: each issued six hours before it starts, and the plan day a draft. */
export const yardDayHistoryRows: SortedMap<Date, ValueTypeOf<typeof YardDay>> = (() => {
    const days = new SortedMap<Date, ValueTypeOf<typeof YardDay>>([[yardDay, { state: variant("draft", null) }]], byDate);
    for (let n = 1; n <= 730; n++) {
        const day = new Date(yardDay.getTime() - n * DAY);
        days.set(day, { state: variant("issued", { at: new Date(day.getTime() - 6 * 3_600_000) }) });
    }
    return days;
})();

/**
 * A bin as the board reads it: its roles from the yard's fields — its bay its
 * lane, its load its arrival, its m³ its quantity, its spec its kind, how long
 * it dries its hold, its split its parts — beside the row itself.
 */
function boardBin(row: Row): ValueTypeOf<typeof YardBin> {
    return { lane: row.bay, at: row.at, arrival: row.load, quantity: row.m3, kind: row.spec, hold: row.dryFor, parts: new SortedMap([...row.kilns], byString), row };
}
/** Tue 11 May 2027 as the board reads it: a draft, its 26 bins. */
export const yardPlanDay: ValueTypeOf<typeof YardPlan> = {
    status: variant("draft", null),
    bins: new SortedMap(planBins.map(([id, row]) => [id, boardBin(row)] as const), byString),
};
