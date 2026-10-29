/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * How the decision queue's example apps' models write what they propose
 * (#1447): an option, its optional parts left out, and each change a patch of
 * the record it lands in — the warehouse rota's duties, the print shop's jobs,
 * the workshop's maintenance, the kiln yard's bins or the shop's work orders —
 * built with East's own diff of the rows it touches, as a model diffs them.
 * The ops queue's cases (`ops.ts`) and the previews gallery's (`previews.ts`)
 * are written with them.
 */
import { DictType, SortedMap, SortedSet, StringType, compareFor, diffFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { KilnBin, yardArrivals } from "../allocation/kiln-yard.js";
import { CalendarService, calendarServices } from "../calendar/calendar.examples.js";
import { PrintJob } from "../plan/plan-events.examples.js";
import { WarehouseDuty, warehouseDuties } from "../roster/warehouse.js";
import { OptimiseWorkOrder, optimiseWorkOrderRows } from "../sheet/optimise.examples.js";
import type { OpsOption } from "./ops.js";

/** Keys in East's order of strings. */
export const byString = compareFor(StringType);

/** An option of the app's, its optional parts left out. */
export function option(row: Pick<ValueTypeOf<typeof OpsOption>, "label" | "title" | "summary" | "detail" | "value" | "change">
    & Partial<ValueTypeOf<typeof OpsOption>>): ValueTypeOf<typeof OpsOption> {
    return {
        note: none, confidence: none, question: none, warn: none, refused: none,
        knockOn: new SortedSet<string>([], byString), guesses: new SortedMap<string, number>([], byString), forecast: [], ...row,
    };
}

/** A duty of the warehouse's rota. */
export type DutyRow = ValueTypeOf<typeof WarehouseDuty>;
/** The duties' patch, as a model diffs the rows it touches. */
const diffDuties = diffFor(DictType(StringType, WarehouseDuty));
/**
 * The duties' patch changing the duties given — each to the row it becomes, `undefined` where the model removes it —
 * from the rows as the rota holds them: the patch of those rows alone, a key the rota has not a new duty.
 */
export function dutiesPatch(changes: readonly (readonly [string, DutyRow | undefined])[]) {
    const before = new SortedMap(changes.flatMap(([key]) => {
        const row = warehouseDuties.get(key);
        return row === undefined ? [] : [[key, row] as const];
    }), byString);
    const after = new SortedMap(changes.flatMap(([key, row]) => (row === undefined ? [] : [[key, row] as const])), byString);
    return diffDuties(before, after);
}
/** The duties' patch giving each duty named to the person given, its every other field as the rota holds it. */
export function dutiesTo(changes: readonly (readonly [string, string])[]) {
    return dutiesPatch(changes.map(([key, person]) => [key, { ...warehouseDuties.get(key)!, who: variant("staff", person) }] as const));
}

/** A print job of the shop's. */
export type JobRow = ValueTypeOf<typeof PrintJob>;
/** The jobs' patch, as a model diffs the rows it touches. */
const diffJobs = diffFor(DictType(StringType, PrintJob));
/**
 * The jobs' patch changing the jobs given, each to the row it becomes, from the rows as the record given holds them —
 * or, where one is given beside it, the row as the model last read it: the patch of those rows alone.
 */
export function jobsPatch(jobs: ReadonlyMap<string, JobRow>, changes: readonly (readonly [string, JobRow, JobRow?])[]) {
    const before = new SortedMap(changes.map(([key, , read]) => [key, read ?? jobs.get(key)!] as const), byString);
    const after = new SortedMap(changes.map(([key, row]) => [key, row] as const), byString);
    return diffJobs(before, after);
}

/** A maintenance visit of the workshop's. */
export type ServiceRow = ValueTypeOf<typeof CalendarService>;
/** The maintenance's patch, as a model diffs the rows it touches. */
const diffServices = diffFor(DictType(StringType, CalendarService));
/** The workshop's maintenance, as its record holds it. */
const workshopServices = calendarServices.default!;
/** The maintenance's patch changing one visit to the row it becomes, from the row as the record holds it: the patch of that row alone. */
export function servicesPatch(key: string, row: ServiceRow) {
    return diffServices(new SortedMap([[key, workshopServices.get(key)!]], byString), new SortedMap([[key, row]], byString));
}

/** A bin of the kiln yard's. */
export type BinRow = ValueTypeOf<typeof KilnBin>;
/** The bins' patch, as a model diffs the rows it touches. */
const diffBins = diffFor(DictType(StringType, KilnBin));
/** The bins' patch booking a new bin under the key given: the patch of that row alone. */
export function binPatch(key: string, row: BinRow) {
    return diffBins(new SortedMap<string, BinRow>([], byString), new SortedMap([[key, row]], byString));
}
/** LD-2235, waiting on the yard: 8 m³ of MC10, grade P1, dried 9 days, due Tue 11 May 2027 and taken from the 10th to the 13th. */
const ld2235 = yardArrivals.get("LD-2235")!;
/**
 * LD-2235's bin as the board books one: in bay B-1 at the time given, the whole load in the one kiln given, held the
 * days it dries; the yard's own fields its load's, as the kiln yard's `values` give a booked bin them.
 */
export function ld2235Bin(kiln: string, at: Date): BinRow {
    return {
        bay: "B-1", at, load: some(ld2235.code), m3: ld2235.m3, spec: some(ld2235.spec), dryFor: variant("days", ld2235.dryingDays),
        kilns: new SortedMap([[kiln, ld2235.m3]], byString), specBooked: ld2235.spec, specMeasured: ld2235.spec,
        gradeBooked: ld2235.grade.substring(0, 1), gradeMeasured: ld2235.grade, instruction: ld2235.instruction,
    };
}

/** The work orders' patch, as a model diffs the rows it touches. */
const diffOrders = diffFor(DictType(StringType, OptimiseWorkOrder));
/** The work orders' patch scheduling ready orders, each due on its date: the patch of those rows alone. */
export function ordersPatch(dues: readonly (readonly [string, Date])[]) {
    const before = new SortedMap(dues.map(([key]) => [key, optimiseWorkOrderRows.get(key)!] as const), byString);
    const after = new SortedMap(dues.map(([key, due]) => [key, { ...optimiseWorkOrderRows.get(key)!, status: "Scheduled", due: some(due) }] as const), byString);
    return diffOrders(before, after);
}
