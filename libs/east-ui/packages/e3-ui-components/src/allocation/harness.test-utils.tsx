/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's examples on e3 itself (#1376, #1372): the kiln yard's
 * module deployed to e3-web (`allocation/allocation`), each test a workspace
 * of its own. The board reads the yard's own records — its bins a day at a
 * time through the slice's bin source, an interval index over their times, or
 * the smallest board's whole; its days whole, or by key; its bays, its kilns
 * and its loads a window at a time through their indexes, as e3 serves them —
 * and every Save and Publish is a real commit through each record's patch
 * door, a request a record. Another session's edit of a record goes in
 * through its own door (`h.patch`), and a record whose reads fail is a fault
 * at the harness's fetch ({@link AllocationHarness.unavailable}). The yard's
 * fits are the examples' own `e3.function`s, called by name on e3
 * (`shared/func/fit-calls.test-utils.ts`). What a test counts it reads from the
 * request log (`h.requests`).
 *
 * Each test runs alone (#1280, `test-runs.test-utils.ts`): a test file takes
 * `act` from here, never from Testing Library.
 *
 * @packageDocumentation
 */
import { vi } from "vitest";
import { East, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Allocation, Data, Func, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import type { E3Dataset } from "../e3-web.test-utils.js";
import { e3Harness, type E3Harness, type Example } from "../e3-web-mount.test-utils.js";
import { fitCalls, type FitCalls } from "../shared/func/fit-calls.test-utils.js";
import "./index.js";
export { act, programOf, settle, slot, width, type Example, type MountOptions } from "../e3-web-mount.test-utils.js";
// A new bin's key, as a test offers it (B15).
export { offering } from "../shared/schedule/keys.test-utils.js";
/** The mock's plan day, Tue 11 May 2027; Tue 4 is published, Wed 12 holds split loads, Thu 13 has no row. */
export const TUE = new Date("2027-05-11T00:00:00Z");
export const TUE_4 = new Date("2027-05-04T00:00:00Z");
export const WED = new Date("2027-05-12T00:00:00Z");
export const THU = new Date("2027-05-13T00:00:00Z");

/** One of the yard's bins, as its record holds it: the board's roles and the yard's own fields. */
export type KilnBin = ValueTypeOf<typeof ex.kilnBins.type.value>;
/** A question to the yard's fit, over the yard's own bin rows. */
const FIT_REQUEST = Allocation.Types.FitRequest(ex.kilnBins.type.value);
/** A question to the yard's fit, and its answer, decoded. */
export type FitRequest = ValueTypeOf<typeof FIT_REQUEST>;
export type FitResult = ValueTypeOf<typeof Allocation.Types.FitResult>;

/** The Allocation's harness: e3 with the kiln yard's module deployed, the fits its board asks, and a record's reads made to fail. */
export interface AllocationHarness extends E3Harness {
    /** The yard's fits, as the board asks them: `yard_fit`, or `yard_bulk_fit`, by name. */
    readonly fits: FitCalls<FitRequest, FitResult>;
    /**
     * Fails every read of a record from now — its pages and its key searches,
     * through any of its indexes — as e3 answers one it cannot serve
     * (`500`, `internal`), until the returned function stops it.
     *
     * @param record - The record
     * @returns What stops it
     */
    unavailable(record: E3Dataset): () => void;
}

/**
 * The kiln yard's records on e3: the module's package deployed once for the
 * file, a workspace of its own for each test.
 *
 * @returns The harness
 */
export function allocationHarness(): AllocationHarness {
    const h = e3Harness({ "allocation/allocation": ex }, { main: "data-allocation-main" });
    return Object.assign(h, {
        fits: fitCalls(h, { request: FIT_REQUEST, result: Allocation.Types.FitResult }),
        unavailable(record: E3Dataset) {
            const dataset = record.path.map((step) => step.value).join(".");
            return h.e3.fail((request) => (request.kind === "page" || request.kind === "find") && request.dataset === dataset,
                { status: 500, type: "internal", message: `${dataset} is unavailable` });
        },
    });
}

/**
 * The kiln yard's board as `allocationKilnYard` mounts it — its bins read a
 * day at a time through the slice's bin source, its days, its bays, kilns and
 * loads, the yard's fit, the library and the inspector — over the records a
 * test needs: the yard's own, or its locked bins or its locked days, whose
 * door refuses every change.
 *
 * @param options - Which of its records is locked, if either
 * @returns The example
 */
export function kilnYard(options: { readonly locked?: "bins" | "days" } = {}): Example {
    const lockedBins = options.locked === "bins", lockedDays = options.locked === "days";
    return { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        // The bins a test needs, the yard's own or its locked ones, each read a day at a time through its interval index.
        const bins = $.let(lockedBins ? Record.bind(ex.kilnLockedBins, [ex.kilnLockedBinsPatch]) : Record.bind(ex.kilnBins, [ex.kilnBinsPatch]));
        const entries = $.let(lockedBins ? Data.bindPaged(ex.kilnLockedBins) : Data.bindPaged(ex.kilnBins));
        const days = $.let(lockedDays ? Record.bind(ex.yardLockedDays, [ex.yardLockedDaysPatch]) : Record.bind(ex.yardDays, [ex.yardDaysPatch]));
        const yard = $.let(Data.bind(ex.kilns));
        const loads = $.let(Data.bind(ex.arrivals));
        const bays = $.let(Data.bind(ex.yardBays));
        // The day's bins through the slice's bin source: their interval index, its range the board's own navigation.
        const slice = $.let(lockedBins
            ? Slice.bindRecords("test.kilnYard", { bin: { source: Data.bindPaged(ex.kilnLockedBins, { indexes: [ex.kilnLockedBinsByTime] }), range: "at" } })
            : Slice.bindRecords("test.kilnYard", { bin: { source: Data.bindPaged(ex.kilnBins, { indexes: [ex.kilnBinsByTime] }), range: "at" } }));
        const fit = $.let(Func.bind(ex.yardFit));
        return Allocation({
            id: "kilnYard", title: "Kiln loading", fit, slice: { slice }, inspector: true,
            library: [Allocation.library.arrivals(), Allocation.library.resources()], view: { layout: "timeline", date: TUE },
            events: { bin: Schedule.events(bins, {
                name: "Bin", icon: "box", entries,
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
            }) },
            resources: {
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
                    min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            },
            arrivals: Allocation.arrivals(loads.read(), {
                label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            }),
            periods: Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } }),
        });
    }))) };
}

/**
 * The smallest board over the yard's own bins, as the drag and Timeline tests
 * mount it: the bins read whole, each one's spec its kind; the bays, the
 * kilns and the loads, which book with their values and no kind of their own;
 * the yard's fit; no library, no inspector and no days.
 *
 * @returns The example
 */
export function smallestYard(): Example {
    return { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const bins = $.let(Record.bind(ex.kilnBins, [ex.kilnBinsPatch]));
        const yard = $.let(Data.bind(ex.kilns));
        const loads = $.let(Data.bind(ex.arrivals));
        const bays = $.let(Data.bind(ex.yardBays));
        const fit = $.let(Func.bind(ex.yardFit));
        return Allocation({
            id: "smallestYard", fit, view: { date: TUE },
            events: { bin: Schedule.events(bins, {
                name: "Bin", icon: "box",
                at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
            }) },
            resources: {
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max, jobs: k => k.charges }),
            },
            arrivals: Allocation.arrivals(loads.read(), {
                label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays),
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            }),
        });
    }))) };
}

/**
 * The board's three boxes the links run between, as a browser lays them out —
 * jsdom lays out nothing: the board at the window's corner, 1200 × 700, so the
 * links' layer, under its 48px head, is the window's px less 48 down; the lane
 * grid from 10, 336 wide; the channel to 395, the rows' leading edge.
 */
export function stubLinkGeometry() {
    const spy = vi.mocked(Element.prototype.getBoundingClientRect);
    const base = spy.getMockImplementation()!;
    spy.mockImplementation(function (this: Element) {
        const box = (left: number, width: number, height: number) => ({ x: left, y: 0, top: 0, left, right: left + width, bottom: height, width, height, toJSON() {} });
        if (this.hasAttribute("data-allocation-timeline")) return box(0, 1200, 700);
        if (this.hasAttribute("data-allocation-grid")) return box(10, 336, 1116);
        if (this.hasAttribute("data-allocation-channel")) return box(347, 48, 700);
        return base.call(this);
    });
}
