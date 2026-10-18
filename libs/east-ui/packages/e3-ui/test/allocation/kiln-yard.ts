/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The kiln yard, transcribed from docs/proposals/Allocation Spec.html: three
 * unloading bays in two areas, 33 drying kilns in six groups, the day's loads and Tue 11
 * May 2027's plan. Every name, code and figure is generated.
 */
import { ArrayType, DateTimeType, FloatType, OptionType, SortedMap, StringType, StructType, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { TimeStepType } from "@elaraai/east-ui";
import { Allocation } from "@elaraai/e3-ui";

/** What each bin carries of the yard's own: the moisture target and grade booked, and as measured on arrival, and its loading instruction. */
export const BinValues = StructType({
    specBooked: StringType, specMeasured: StringType,
    gradeBooked: StringType, gradeMeasured: StringType,
    instruction: OptionType(StringType),
});
/** A drying kiln: its range, the days it usually dries for, and its charges — the one drying now and the next planned. */
export const Kiln = StructType({
    name: StringType, group: StringType, min: FloatType, max: FloatType, days: FloatType, note: OptionType(StringType),
    charges: ArrayType(Allocation.Types.Job),
});
/** An unloading bay: its name, the yard area it stands in, and how far past each hour it takes its bin. */
export const Bay = StructType({ name: StringType, area: StringType, offset: TimeStepType });
/** A load of sawn timber on its way from a mill. */
export const TimberLoad = StructType({
    code: StringType, mill: StringType, spec: StringType, grade: StringType,
    m3: FloatType, dryingDays: FloatType, due: DateTimeType, from: DateTimeType, to: DateTimeType,
    schedule: StringType, instruction: OptionType(StringType),
});
/** A bin of the yard's plans. */
export const YardBin = Allocation.Types.Bin(BinValues);
/** A day of the yard's plans. */
export const YardDay = Allocation.Types.Day(BinValues);

const byString = compareFor(StringType);
const byDate = compareFor(DateTimeType);
/** Midnight UTC, days after Fri 7 May 2027 (the Timeline's first day). */
const day = (n: number): Date => new Date(Date.UTC(2027, 4, 7 + n));
/** A time on that day, in minutes past midnight. */
const at = (n: number, minutes: number): Date => new Date(Date.UTC(2027, 4, 7 + n, 0, minutes));
/** The plan day the mock opens on: Tue 11 May 2027. */
export const yardDay: Date = day(4);
/** The unloading bays, by key: two in the north yard, one in the south; each takes one bin an hour, at its offset past the hour. */
export const yardBayRows: SortedMap<string, ValueTypeOf<typeof Bay>> = new SortedMap<string, ValueTypeOf<typeof Bay>>([
    ["B-1", { name: "B-1", area: "North", offset: variant("minutes", 15) }],
    ["B-2", { name: "B-2", area: "North", offset: variant("minutes", 35) }],
    ["B-3", { name: "B-3", area: "South", offset: variant("minutes", 55) }],
], byString);
/** The same bays as the board's lanes, for the tests that hand it lanes directly. */
export const yardLanes: ValueTypeOf<typeof Allocation.Types.Lane>[] = [
    { key: "B-1", label: "B-1", offset: variant("minutes", 15) },
    { key: "B-2", label: "B-2", offset: variant("minutes", 35) },
    { key: "B-3", label: "B-3", offset: variant("minutes", 55) },
];
export const yardKilns: SortedMap<string, ValueTypeOf<typeof Kiln>> = new SortedMap<string, ValueTypeOf<typeof Kiln>>([
    ["K-101", { name: "K-101", group: "Hall A", min: 16, max: 32, days: 9, note: none, charges: [{ label: "planned", start: day(13), end: day(21) }] }],
    ["K-102", { name: "K-102", group: "Hall A", min: 16, max: 32, days: 9, note: none, charges: [] }],
    ["K-103", { name: "K-103", group: "Hall A", min: 16, max: 32, days: 8, note: none, charges: [{ label: "C-3141", start: day(-9), end: day(1) }, { label: "planned", start: day(11), end: day(19) }] }],
    ["K-104", { name: "K-104", group: "Hall A", min: 16, max: 32, days: 8, note: none, charges: [{ label: "planned", start: day(7), end: day(15) }] }],
    ["K-105", { name: "K-105", group: "Hall A", min: 16, max: 32, days: 8, note: none, charges: [{ label: "planned", start: day(10), end: day(18) }] }],
    ["K-106", { name: "K-106", group: "Hall A", min: 12, max: 24, days: 8, note: none, charges: [{ label: "C-3142", start: day(-9), end: day(1) }] }],
    ["K-107", { name: "K-107", group: "Hall A", min: 12, max: 24, days: 8, note: none, charges: [{ label: "planned", start: day(12), end: day(20) }] }],
    ["K-108", { name: "K-108", group: "Hall A", min: 16, max: 32, days: 7, note: some("the plan had this charge on Wed 12"), charges: [{ label: "C-3143", start: day(-9), end: day(4) }, { label: "planned", start: day(13), end: day(21) }] }],
    ["K-109", { name: "K-109", group: "Hall A", min: 12, max: 24, days: 9, note: none, charges: [{ label: "planned", start: day(13), end: day(21) }] }],
    ["K-110", { name: "K-110", group: "Hall A", min: 12, max: 24, days: 8, note: none, charges: [{ label: "C-3144", start: day(-9), end: day(1) }, { label: "planned", start: day(7), end: day(15) }] }],
    ["K-201", { name: "K-201", group: "Hall B", min: 20, max: 40, days: 8, note: none, charges: [{ label: "C-3145", start: day(-9), end: day(4) }, { label: "planned", start: day(14), end: day(22) }] }],
    ["K-202", { name: "K-202", group: "Hall B", min: 20, max: 40, days: 8, note: none, charges: [{ label: "planned", start: day(13), end: day(21) }] }],
    ["K-203", { name: "K-203", group: "Hall B", min: 20, max: 40, days: 7, note: none, charges: [{ label: "planned", start: day(12), end: day(20) }] }],
    ["K-204", { name: "K-204", group: "Hall B", min: 20, max: 40, days: 8, note: none, charges: [{ label: "planned", start: day(8), end: day(16) }] }],
    ["K-205", { name: "K-205", group: "Hall B", min: 20, max: 40, days: 8, note: none, charges: [{ label: "C-3146", start: day(-9), end: day(3) }, { label: "planned", start: day(12), end: day(20) }] }],
    ["K-206", { name: "K-206", group: "Hall B", min: 20, max: 40, days: 7, note: none, charges: [{ label: "C-3147", start: day(-9), end: day(2) }, { label: "planned", start: day(11), end: day(19) }] }],
    ["K-207", { name: "K-207", group: "Hall B", min: 20, max: 40, days: 9, note: none, charges: [{ label: "C-3148", start: day(-9), end: day(1) }, { label: "planned", start: day(13), end: day(21) }] }],
    ["K-208", { name: "K-208", group: "Hall B", min: 20, max: 40, days: 8, note: none, charges: [{ label: "C-3149", start: day(-9), end: day(1) }, { label: "planned", start: day(6), end: day(14) }] }],
    ["K-209", { name: "K-209", group: "Hall B", min: 20, max: 40, days: 7, note: none, charges: [{ label: "planned", start: day(12), end: day(20) }] }],
    ["K-301", { name: "K-301", group: "Compact", min: 4, max: 10, days: 8, note: none, charges: [{ label: "C-3150", start: day(-9), end: day(1) }, { label: "planned", start: day(9), end: day(17) }] }],
    ["K-302", { name: "K-302", group: "Compact", min: 4, max: 10, days: 9, note: none, charges: [{ label: "planned", start: day(13), end: day(21) }] }],
    ["K-303", { name: "K-303", group: "Compact", min: 4, max: 10, days: 8, note: some("the plan had this charge on Thu 13"), charges: [{ label: "planned", start: day(13), end: day(21) }] }],
    ["K-304", { name: "K-304", group: "Compact", min: 4, max: 10, days: 7, note: none, charges: [{ label: "planned", start: day(12), end: day(20) }] }],
    ["K-305", { name: "K-305", group: "Compact", min: 4, max: 10, days: 8, note: none, charges: [{ label: "C-3151", start: day(-9), end: day(4) }, { label: "planned", start: day(13), end: day(21) }] }],
    ["K-401", { name: "K-401", group: "Standard", min: 10, max: 20, days: 9, note: none, charges: [{ label: "planned", start: day(13), end: day(21) }] }],
    ["K-402", { name: "K-402", group: "Standard", min: 10, max: 20, days: 7, note: none, charges: [{ label: "planned", start: day(11), end: day(19) }] }],
    ["K-403", { name: "K-403", group: "Standard", min: 10, max: 20, days: 9, note: none, charges: [{ label: "C-3152", start: day(-9), end: day(1) }, { label: "planned", start: day(15), end: day(23) }] }],
    ["K-501", { name: "K-501", group: "Large", min: 24, max: 48, days: 7, note: none, charges: [{ label: "planned", start: day(12), end: day(20) }] }],
    ["K-502", { name: "K-502", group: "Large", min: 24, max: 48, days: 8, note: none, charges: [{ label: "planned", start: day(7), end: day(15) }] }],
    ["K-503", { name: "K-503", group: "Large", min: 24, max: 48, days: 9, note: none, charges: [{ label: "C-3153", start: day(-6), end: day(7) }, { label: "planned", start: day(7), end: day(15) }] }],
    ["K-504", { name: "K-504", group: "Large", min: 24, max: 48, days: 9, note: none, charges: [{ label: "C-3154", start: day(-2), end: day(8) }, { label: "planned", start: day(7), end: day(15) }] }],
    ["K-601", { name: "K-601", group: "Bulk", min: 40, max: 60, days: 8, note: none, charges: [] }],
    ["K-602", { name: "K-602", group: "Bulk", min: 40, max: 60, days: 8, note: none, charges: [{ label: "C-3155", start: day(-9), end: day(1) }, { label: "planned", start: day(9), end: day(17) }] }],
], byString);
export const yardArrivals: SortedMap<string, ValueTypeOf<typeof TimberLoad>> = new SortedMap<string, ValueTypeOf<typeof TimberLoad>>([
    ["LD-2231", { code: "LD-2231", mill: "BRK", spec: "MC12", grade: "R2", m3: 21, dryingDays: 8, due: day(2), from: day(0), to: day(3), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2232", { code: "LD-2232", mill: "RDG", spec: "MC10", grade: "R1", m3: 30, dryingDays: 8, due: day(4), from: day(3), to: day(7), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2233", { code: "LD-2233", mill: "RDG", spec: "MC10", grade: "R1", m3: 26, dryingDays: 8, due: day(5), from: day(4), to: day(8), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2234", { code: "LD-2234", mill: "ASH", spec: "MC12", grade: "P2", m3: 18, dryingDays: 9, due: day(5), from: day(4), to: day(7), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2235", { code: "LD-2235", mill: "MRS", spec: "MC10", grade: "P1", m3: 8, dryingDays: 9, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2236", { code: "LD-2236", mill: "STB", spec: "MC16", grade: "U2", m3: 11, dryingDays: 6, due: day(6), from: day(5), to: day(9), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2201", { code: "LD-2201", mill: "BRK", spec: "MC14", grade: "R1", m3: 35, dryingDays: 8, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-4 · 70 °C dry bulb · continuous venting", instruction: some("Load into K-209 first; any balance goes with bin 3102. Sticker every 600 mm before loading") }],
    ["LD-2202", { code: "LD-2202", mill: "STB", spec: "MC08", grade: "P1", m3: 27, dryingDays: 9, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2203", { code: "LD-2203", mill: "STB", spec: "MC14", grade: "U1", m3: 24, dryingDays: 6, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2204", { code: "LD-2204", mill: "CLY", spec: "MC14", grade: "U1", m3: 47, dryingDays: 6, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-4 · 70 °C dry bulb · continuous venting", instruction: none }],
    ["LD-2205", { code: "LD-2205", mill: "BRK", spec: "MC12", grade: "U1", m3: 39, dryingDays: 6, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-4 · 70 °C dry bulb · continuous venting", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2206", { code: "LD-2206", mill: "ASH", spec: "MC20", grade: "P2", m3: 36, dryingDays: 9, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-6 · 80 °C · equalise 12 h · condition 6 h", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2207", { code: "LD-2207", mill: "ASH", spec: "MC14", grade: "R3", m3: 63, dryingDays: 8, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-6 · 80 °C · equalise 12 h · condition 6 h", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2208", { code: "LD-2208", mill: "RDG", spec: "MC18", grade: "P2", m3: 1, dryingDays: 9, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: none }],
    ["LD-2209", { code: "LD-2209", mill: "BRK", spec: "MC18", grade: "R3", m3: 18, dryingDays: 8, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-4 · 70 °C dry bulb · continuous venting", instruction: none }],
    ["LD-2210", { code: "LD-2210", mill: "FRN", spec: "MC08", grade: "R2", m3: 32, dryingDays: 8, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-7 · 80 °C · equalise 12 h · direct", instruction: none }],
    ["LD-2211", { code: "LD-2211", mill: "FRN", spec: "MC16", grade: "R1", m3: 2, dryingDays: 8, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2212", { code: "LD-2212", mill: "RDG", spec: "MC20", grade: "U2", m3: 20, dryingDays: 6, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-7 · 80 °C · equalise 12 h · direct", instruction: some("Hold the kiln at 40 °C on arrival") }],
    ["LD-2213", { code: "LD-2213", mill: "STB", spec: "MC22", grade: "R2", m3: 10, dryingDays: 8, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2214", { code: "LD-2214", mill: "BRK", spec: "MC18", grade: "R3", m3: 5, dryingDays: 8, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-2 · 55 °C dry bulb · 10 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2215", { code: "LD-2215", mill: "RDG", spec: "MC14", grade: "U2", m3: 15, dryingDays: 6, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2216", { code: "LD-2216", mill: "ASH", spec: "MC14", grade: "U1", m3: 37, dryingDays: 6, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2217", { code: "LD-2217", mill: "CLY", spec: "MC08", grade: "U2", m3: 5, dryingDays: 6, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-7 · 80 °C · equalise 12 h · direct", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2218", { code: "LD-2218", mill: "HLM", spec: "MC08", grade: "P1", m3: 38, dryingDays: 9, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-7 · 80 °C · equalise 12 h · direct", instruction: none }],
    ["LD-2219", { code: "LD-2219", mill: "MRS", spec: "MC20", grade: "R2", m3: 54, dryingDays: 8, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: some("Sticker every 600 mm before loading") }],
    ["LD-2220", { code: "LD-2220", mill: "RDG", spec: "MC18", grade: "R1", m3: 31, dryingDays: 8, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-2 · 55 °C dry bulb · 12 % target", instruction: none }],
    ["LD-2221", { code: "LD-2221", mill: "FRN", spec: "MC08", grade: "R3", m3: 17, dryingDays: 8, due: day(4), from: day(3), to: day(6), schedule: "Schedule KS-4 · 70 °C dry bulb · continuous venting", instruction: some("Hold the kiln at 40 °C on arrival") }],
], byString);
/** Tue 11 May 2027's bins, as the mock opens: 26 bins in 18 slots, 556 m³. */
export const yardBins: SortedMap<string, ValueTypeOf<typeof YardBin>> = new SortedMap<string, ValueTypeOf<typeof YardBin>>([
    ["3101", { lane: "B-3", at: at(4, 115), event: some("LD-2201"), quantity: 35, kind: some("MC14"), hold: variant("days", 7), parts: new SortedMap([["K-209", 35]], byString), values: { specBooked: "MC14", specMeasured: "MC14", gradeBooked: "R", gradeMeasured: "R1", instruction: some("Load into K-209 first; any balance goes with bin 3102. Sticker every 600 mm before loading") } }],
    ["3102", { lane: "B-3", at: at(4, 116), event: some("LD-2202"), quantity: 27, kind: some("MC22"), hold: variant("days", 9), parts: new SortedMap([["K-102", 27]], byString), values: { specBooked: "MC08", specMeasured: "MC22", gradeBooked: "P", gradeMeasured: "P1", instruction: some("Hold the kiln at 40 °C on arrival") } }],
    ["3103", { lane: "B-1", at: at(4, 135), event: some("LD-2203"), quantity: 24, kind: some("MC14"), hold: variant("days", 9), parts: new SortedMap([["K-109", 24]], byString), values: { specBooked: "MC14", specMeasured: "MC14", gradeBooked: "U", gradeMeasured: "U1", instruction: some("Hold the kiln at 40 °C on arrival") } }],
    ["3104", { lane: "B-1", at: at(4, 195), event: some("LD-2204"), quantity: 47, kind: some("MC14"), hold: variant("days", 7), parts: new SortedMap([["K-501", 47]], byString), values: { specBooked: "MC14", specMeasured: "MC14", gradeBooked: "P", gradeMeasured: "U1", instruction: none } }],
    ["3105", { lane: "B-1", at: at(4, 255), event: some("LD-2205"), quantity: 39, kind: some("MC10"), hold: variant("days", 7), parts: new SortedMap([["K-203", 39]], byString), values: { specBooked: "MC12", specMeasured: "MC10", gradeBooked: "P", gradeMeasured: "U1", instruction: some("Sticker every 600 mm before loading") } }],
    ["3106", { lane: "B-2", at: at(4, 335), event: some("LD-2206"), quantity: 1, kind: some("MC18"), hold: variant("days", 7), parts: new SortedMap([["K-304", 1]], byString), values: { specBooked: "MC20", specMeasured: "MC18", gradeBooked: "P", gradeMeasured: "P2", instruction: some("Hold the kiln at 40 °C on arrival") } }],
    ["3107", { lane: "B-2", at: at(4, 336), event: some("LD-2206"), quantity: 35, kind: some("MC18"), hold: variant("days", 8), parts: new SortedMap([["K-201", 35]], byString), values: { specBooked: "MC18", specMeasured: "MC18", gradeBooked: "P", gradeMeasured: "P1", instruction: some("Sticker every 600 mm before loading") } }],
    ["3108", { lane: "B-2", at: at(4, 395), event: some("LD-2207"), quantity: 19, kind: some("MC12"), hold: variant("days", 7), parts: new SortedMap([["K-402", 19]], byString), values: { specBooked: "MC14", specMeasured: "MC12", gradeBooked: "P", gradeMeasured: "R3", instruction: some("Hold the kiln at 40 °C on arrival") } }],
    ["3109", { lane: "B-2", at: at(4, 396), event: some("LD-2207"), quantity: 44, kind: some("MC12"), hold: variant("days", 9), parts: new SortedMap([["K-207", 44]], byString), values: { specBooked: "MC12", specMeasured: "MC12", gradeBooked: "P", gradeMeasured: "P2", instruction: some("Sticker every 600 mm before loading") } }],
    ["3110", { lane: "B-1", at: at(4, 555), event: some("LD-2208"), quantity: 1, kind: some("MC18"), hold: variant("days", 7), parts: new SortedMap([["K-304", 1]], byString), values: { specBooked: "MC18", specMeasured: "MC18", gradeBooked: "U", gradeMeasured: "P2", instruction: none } }],
    ["3111", { lane: "B-1", at: at(4, 615), event: some("LD-2209"), quantity: 16, kind: some("MC18"), hold: variant("days", 9), parts: new SortedMap([["K-403", 16]], byString), values: { specBooked: "MC18", specMeasured: "MC18", gradeBooked: "P", gradeMeasured: "R3", instruction: none } }],
    ["3112", { lane: "B-1", at: at(4, 616), event: some("LD-2209"), quantity: 2, kind: some("MC20"), hold: variant("days", 7), parts: new SortedMap([["K-304", 2]], byString), values: { specBooked: "MC22", specMeasured: "MC20", gradeBooked: "R", gradeMeasured: "R3", instruction: some("Hold the kiln at 40 °C on arrival") } }],
    ["3113", { lane: "B-2", at: at(4, 635), event: some("LD-2210"), quantity: 32, kind: some("MC22"), hold: variant("days", 7), parts: new SortedMap([["K-108", 32]], byString), values: { specBooked: "MC08", specMeasured: "MC22", gradeBooked: "R", gradeMeasured: "R2", instruction: none } }],
    ["3114", { lane: "B-1", at: at(4, 795), event: some("LD-2211"), quantity: 2, kind: some("MC16"), hold: variant("days", 7), parts: new SortedMap([["K-304", 2]], byString), values: { specBooked: "MC16", specMeasured: "MC16", gradeBooked: "R", gradeMeasured: "R1", instruction: some("Hold the kiln at 40 °C on arrival") } }],
    ["3115", { lane: "B-2", at: at(4, 935), event: some("LD-2212"), quantity: 20, kind: some("MC18"), hold: variant("days", 8), parts: new SortedMap([["K-106", 20]], byString), values: { specBooked: "MC20", specMeasured: "MC18", gradeBooked: "P", gradeMeasured: "U2", instruction: some("Hold the kiln at 40 °C on arrival") } }],
    ["3116", { lane: "B-3", at: at(4, 1015), event: some("LD-2213"), quantity: 10, kind: some("MC20"), hold: variant("days", 8), parts: new SortedMap([["K-303", 10]], byString), values: { specBooked: "MC22", specMeasured: "MC20", gradeBooked: "P", gradeMeasured: "R2", instruction: some("Sticker every 600 mm before loading") } }],
    ["3117", { lane: "B-2", at: at(4, 1055), event: some("LD-2214"), quantity: 5, kind: some("MC16"), hold: variant("days", 8), parts: new SortedMap([["K-301", 5]], byString), values: { specBooked: "MC18", specMeasured: "MC16", gradeBooked: "R", gradeMeasured: "R3", instruction: some("Sticker every 600 mm before loading") } }],
    ["3118", { lane: "B-3", at: at(4, 1075), event: some("LD-2215"), quantity: 15, kind: some("MC14"), hold: variant("days", 9), parts: new SortedMap([["K-401", 15]], byString), values: { specBooked: "MC14", specMeasured: "MC14", gradeBooked: "U", gradeMeasured: "U2", instruction: some("Sticker every 600 mm before loading") } }],
    ["3119", { lane: "B-3", at: at(4, 1076), event: some("LD-2216"), quantity: 37, kind: some("MC12"), hold: variant("days", 8), parts: new SortedMap([["K-205", 37]], byString), values: { specBooked: "MC14", specMeasured: "MC12", gradeBooked: "P", gradeMeasured: "U1", instruction: some("Sticker every 600 mm before loading") } }],
    ["3120", { lane: "B-3", at: at(4, 1077), event: some("LD-2217"), quantity: 5, kind: some("MC08"), hold: variant("days", 9), parts: new SortedMap([["K-302", 5]], byString), values: { specBooked: "MC08", specMeasured: "MC08", gradeBooked: "U", gradeMeasured: "U2", instruction: some("Sticker every 600 mm before loading") } }],
    ["3121", { lane: "B-2", at: at(4, 1235), event: some("LD-2218"), quantity: 1, kind: some("MC22"), hold: variant("days", 7), parts: new SortedMap([["K-304", 1]], byString), values: { specBooked: "MC08", specMeasured: "MC22", gradeBooked: "R", gradeMeasured: "P1", instruction: none } }],
    ["3122", { lane: "B-2", at: at(4, 1236), event: some("LD-2218"), quantity: 37, kind: some("MC16"), hold: variant("days", 7), parts: new SortedMap([["K-206", 37]], byString), values: { specBooked: "MC16", specMeasured: "MC16", gradeBooked: "U", gradeMeasured: "U2", instruction: none } }],
    ["3123", { lane: "B-3", at: at(4, 1255), event: some("LD-2219"), quantity: 22, kind: some("MC20"), hold: variant("days", 8), parts: new SortedMap([["K-202", 22]], byString), values: { specBooked: "MC20", specMeasured: "MC20", gradeBooked: "R", gradeMeasured: "R2", instruction: some("Sticker every 600 mm before loading") } }],
    ["3124", { lane: "B-3", at: at(4, 1256), event: some("LD-2219"), quantity: 32, kind: some("MC22"), hold: variant("days", 8), parts: new SortedMap([["K-105", 32]], byString), values: { specBooked: "MC22", specMeasured: "MC22", gradeBooked: "U", gradeMeasured: "U2", instruction: some("Sticker every 600 mm before loading") } }],
    ["3125", { lane: "B-2", at: at(4, 1355), event: some("LD-2220"), quantity: 31, kind: some("MC18"), hold: variant("days", 9), parts: new SortedMap([["K-101", 31]], byString), values: { specBooked: "MC18", specMeasured: "MC18", gradeBooked: "U", gradeMeasured: "R1", instruction: none } }],
    ["3126", { lane: "B-2", at: at(4, 1415), event: some("LD-2221"), quantity: 17, kind: some("MC08"), hold: variant("days", 8), parts: new SortedMap([["K-202", 17]], byString), values: { specBooked: "MC08", specMeasured: "MC08", gradeBooked: "U", gradeMeasured: "R3", instruction: some("Hold the kiln at 40 °C on arrival") } }],
], byString);

/** A bin booked from a load. */
const booked = (lane: string, when: Date, code: string, m3: number, spec: string, grade: string, days: number, parts: [string, number][]): ValueTypeOf<typeof YardBin> => ({
    lane, at: when, event: some(code), quantity: m3, kind: some(spec), hold: variant("days", days), parts: new SortedMap(parts, byString),
    values: { specBooked: spec, specMeasured: spec, gradeBooked: grade.slice(0, 1), gradeMeasured: grade, instruction: some("Sticker every 600 mm before loading") },
});
/** Tue 4 May 2027, published: the week before's plan, read-only. */
export const yardPublishedDay: ValueTypeOf<typeof YardDay> = {
    status: variant("published", { at: new Date(Date.UTC(2027, 4, 3, 17, 40)) }),
    bins: new SortedMap([
        ["3001", booked("B-1", at(-3, 375), "LD-2201", 35, "MC14", "R1", 8, [["K-209", 35]])],
        ["3002", booked("B-2", at(-3, 395), "LD-2205", 39, "MC12", "U1", 6, [["K-203", 39]])],
        ["3003", booked("B-3", at(-3, 535), "LD-2213", 10, "MC22", "R2", 8, [["K-303", 10]])],
        ["3004", booked("B-1", at(-3, 615), "LD-2215", 15, "MC14", "U2", 6, [["K-401", 15]])],
    ], byString),
};
/** Wed 12 May 2027: loads split across kilns, one with a remainder still unallocated. */
export const yardSplitDay: ValueTypeOf<typeof YardDay> = {
    status: variant("draft", null),
    bins: new SortedMap([
        ["3201", booked("B-1", at(5, 375), "LD-2232", 30, "MC10", "R1", 8, [["K-601", 20], ["K-208", 6]])],
        ["3202", booked("B-2", at(5, 455), "LD-2234", 18, "MC12", "P2", 9, [["K-107", 12], ["K-110", 6]])],
        ["3203", booked("B-3", at(5, 595), "LD-2236", 11, "MC16", "U2", 6, [["K-305", 8], ["K-110", 3]])],
    ], byString),
};
/** Tue 11 May 2027, a draft: the mock's plan day. */
export const yardPlanDay: ValueTypeOf<typeof YardDay> = { status: variant("draft", null), bins: yardBins };
/** The plans: Tue 4 (published), Tue 11 (the mock's day) and Wed 12 (split loads). */
export const yardPlans: SortedMap<Date, ValueTypeOf<typeof YardDay>> = new SortedMap<Date, ValueTypeOf<typeof YardDay>>([
    [day(-3), yardPublishedDay], [yardDay, yardPlanDay], [day(5), yardSplitDay],
], byDate);
/**
 * Two years of plans to Tue 11 May 2027, for the board read a day at a time:
 * each day published with four of the plan day's bins at its own date, and
 * the plan day itself as the mock opens.
 */
export const yardHistory: SortedMap<Date, ValueTypeOf<typeof YardDay>> = (() => {
    const history = new SortedMap<Date, ValueTypeOf<typeof YardDay>>([], byDate);
    const sample = [...yardBins].slice(0, 4);
    for (let n = -730; n < 0; n++) {
        const date = new Date(yardDay.getTime() + n * 86_400_000);
        const bins = new SortedMap<string, ValueTypeOf<typeof YardBin>>(sample.map(([id, bin]) => [id, {
            ...bin, at: new Date(bin.at.getTime() + n * 86_400_000), parts: new SortedMap([...bin.parts], byString),
        }]), byString);
        history.set(date, { status: variant("published", { at: new Date(date.getTime() - 6 * 3_600_000) }), bins });
    }
    history.set(yardDay, yardPlanDay);
    return history;
})();
