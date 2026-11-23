/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * Search Records over the source of the rows a Plan pages (#1513), on e3 — the
 * works' `rows` source, and the work orders', read through their indexes, the
 * resources their operations land on (#1541): the box finds
 * a row the rail hides, its line names the choices hiding it, and a pick clears
 * just those and goes to the row where the narrowing left holds it, in that
 * narrowing's index's order, its row taking the keyboard. And over rows keyed
 * by a variant, as a composite record keys its rows (east-workspace#1696): the
 * rows source pages them in the key's own order, and the box finds one by its
 * typed key and goes to its row — as the canvas's own key search does over the
 * same rows paged straight from `data`.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import {
    ArrayType, DictType, East, IntegerType, SortedMap, StringType, VariantType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { getStore } from "@elaraai/east-ui-components/internal";
import { Data, Plan } from "@elaraai/e3-ui/internal";
import * as cs from "@elaraai/e3-ui/examples/calendar/calendar-scope";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-nested";
import * as records from "@elaraai/e3-ui/examples/plan/plan-records";
import * as sheet from "@elaraai/e3-ui/examples/sheet/sheet-records";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { rowKeyOf } from "../model.js";
import { act, entry, planHarness, settle, slot } from "./harness.test-utils.js";

/** A run's key as a composite record keys its rows: the ERP's numbered, the plant's own named. */
const Sourced = VariantType({ erp: IntegerType, own: StringType });
/**
 * Press 1's runs keyed by the source each came from — the ERP's numbered 2, 9 and 10, the plant's own named — filed by
 * their press (east-workspace#1696).
 */
const sourcedRuns = e3.record("plan_sourced_runs", DictType(Sourced, cs.PressRun), {
    initial: new SortedMap<ValueTypeOf<typeof Sourced>, ValueTypeOf<typeof cs.PressRun>>([
        [variant("erp", 2n), { title: "Covers", press: "P-1", crew: none, start: some(new Date("2026-10-01T06:00:00Z")), end: some(new Date("2026-10-01T10:00:00Z")), hours: 4.0, due: none }],
        [variant("erp", 9n), { title: "Inserts", press: "P-1", crew: none, start: some(new Date("2026-10-02T06:00:00Z")), end: some(new Date("2026-10-02T10:00:00Z")), hours: 4.0, due: none }],
        [variant("erp", 10n), { title: "Posters", press: "P-1", crew: none, start: some(new Date("2026-10-03T06:00:00Z")), end: some(new Date("2026-10-03T10:00:00Z")), hours: 4.0, due: none }],
        [variant("own", "Annex"), { title: "Leaflets", press: "P-1", crew: none, start: some(new Date("2026-10-04T06:00:00Z")), end: some(new Date("2026-10-04T10:00:00Z")), hours: 4.0, due: none }],
        [variant("own", "Berth"), { title: "Menus", press: "P-1", crew: none, start: some(new Date("2026-10-05T06:00:00Z")), end: some(new Date("2026-10-05T10:00:00Z")), hours: 4.0, due: none }],
    ], compareFor(Sourced)),
    indexes: (index) => ({ sourced_runs_by_press: index.on(["press"]) }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const h = planHarness({ "plan/plan-nested": ex, "plan/plan-records": records, "sheet/sheet-records": sheet, "calendar/calendar-scope": cs, "plan/sourced-runs": { sourcedRuns } });
const KEY = "ex.planNestedAll.rows";

const decodeState = decodeBeast2For(RecordSliceStateType);
const encodeState = encodeBeast2For(RecordSliceStateType);
type State = ValueTypeOf<typeof RecordSliceStateType>;
const compareString = compareFor(StringType);
const text = printFor(StringType);

let restore: (() => void)[] = [];
beforeEach(() => { restore = [boundFrame(700), frameScrolls()]; });
afterEach(() => { for (const undo of restore.reverse()) undo(); });

/** The works' source narrowed, as the rail writes it. */
async function narrow(choices: Readonly<Record<string, string>>) {
    const was = decodeState(getStore().read(KEY)!);
    const where: State["where"] = new SortedMap([], compareString);
    for (const [field, value] of Object.entries(choices)) where.set(field, variant("values", [text(value)]));
    await act(async () => { getStore().write(KEY, encodeState({ ...was, preset: none, where })); });
    await settle();
}
/** The narrowing's fields, and each one's choice as the rail holds it. */
const narrowing = () => [...decodeState(getStore().read(KEY)!).where.keys()];

const box = (c: HTMLElement) => slot(c, "toolbar")!.querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
const input = (c: HTMLElement) => box(c).querySelector<HTMLInputElement>("input")!;
async function paste(c: HTMLElement, typed: string) {
    await act(async () => { input(c).focus(); fireEvent.input(input(c), { target: { value: typed } }); });
    await settle();
}
const lines = (c: HTMLElement) => {
    const list = document.getElementById(input(c).getAttribute("aria-controls") ?? "");
    return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map((option) => option.textContent ?? "");
};
const labels = (c: HTMLElement) => [...slot(c, "main")!.querySelectorAll("[role='treegrid'] [role='row'] [data-plan-gutter-label], [role='treegrid'] [role='row']")]
    .map((row) => row.textContent ?? "");

describe("Search Records over a Plan's rows source (#1513)", () => {
    test("finds a row the rail hides, names what hides it, and a pick clears just that and goes to the row", async () => {
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        // North's works: 10001, 10005, … — 10002 stands in the south.
        await narrow({ site: "north" });
        expect(labels(c).some((label) => label.includes("Works 10002"))).toBe(false);
        await paste(c, "Works 10002");
        await waitFor(() => expect(lines(c)[0]).toBe("Works 10002 · hidden by Site: north — picking it clears that filter"));
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        await waitFor(() => expect(narrowing()).toEqual([]), { timeout: 4000 });
        await waitFor(() => expect(labels(c).some((label) => label.includes("Works 10002"))).toBe(true));
        // Its row takes the keyboard, as every builder's pick hands it over.
        await waitFor(() => expect(document.activeElement?.closest("[role='row']")?.textContent ?? "").toContain("Works 10002"));
    });

    test("a row the narrowing holds, past every row sharing its index key's start, is gone to where the narrowing lays it, nothing cleared", async () => {
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        // North's rows run by status, then key: the last by key among the `running` ones is far from where the record has it.
        await narrow({ site: "north" });
        await paste(c, "Works 10097");
        await waitFor(() => expect(lines(c)[0]).toBe("Works 10097"));
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        expect(narrowing()).toEqual(["site"]);
        await waitFor(() => expect(labels(c).some((label) => label.includes("Works 10097"))).toBe(true));
    });

    test("a pick of a row two choices narrow goes to it, whichever of them hide it", async () => {
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        // Works 10002: south, idle (its number's remainders).
        await narrow({ site: "north", status: "idle" });
        await paste(c, "Works 10002");
        await waitFor(() => expect(lines(c)[0]).toContain("hidden by Site: north"));
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        await waitFor(() => expect(labels(c).some((label) => label.includes("Works 10002"))).toBe(true));
    });
});

/** The press runs' week. */
const PRESS_WEEK = new Date("2026-10-01T00:00:00Z");
/**
 * Press 1's own page as a Plan over the press runs (#1621): its `rows` source the runs, scoped to the press and read
 * through the index on exactly the press, whose key is the press — no field of the viewer's beside it.
 */
const pressRows = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const slice = $.let(Slice.bindRecords("spec.pressRows", {
        rows: {
            source: Data.bindPaged(cs.pressRuns, { indexes: ["press_runs_by_press", "press_runs_by_press_time"] }),
            scope: { press: ["P-1"] }, label: "Runs", fields: {}, search: [],
        },
    }));
    // Each run its own row's bar, where it is scheduled; an unscheduled run's from the week's start.
    const series = $.const([Plan.series.span(cs.PressRun, {
        key: "runs", title: "Runs", label: (r) => r.title, id: true,
        runs: (r, k) => [Plan.run({
            key: k, label: r.title, state: variant("confirmed", null),
            start: r.start.match({ none: () => PRESS_WEEK, some: (_$, at) => at }), end: r.end.match({ none: () => PRESS_WEEK, some: (_$, at) => at }),
        })],
    })], ArrayType(Plan.Types.Series(cs.PressRun)));
    const axis = $.const(Plan.axis({ window: { min: PRESS_WEEK, max: new Date("2026-10-08T00:00:00Z") }, resolution: "day" }));
    return Plan({ axis, series, slice: { slice } });
}))) };

describe("Search Records over a scoped Plan's rows source (#1621)", () => {
    test("lists the press's runs by their keys, which the query is asked of — never by the press the index they are read through names — and a pick puts the key in the box", async () => {
        const { container: c } = await h.mount(pressRows);
        await settle();
        await paste(c, "r");
        await waitFor(() => expect(lines(c)).toEqual(["r1", "r2", "r3", "r6", "r7"]), { timeout: 10_000 });
        // Picked, the box holds the key: what its query is typed against, so typing on from it finds the run again.
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        await waitFor(() => expect(input(c).value).toBe("r1"));
    });
});

/**
 * Press 1's runs keyed by a variant, as a composite record keys its rows (east-workspace#1696): a Plan whose `rows`
 * source pages them through the rail, each its own row's bar.
 */
const sourcedRows = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const slice = $.let(Slice.bindRecords("spec.sourcedRows", {
        rows: { source: Data.bindPaged(sourcedRuns, { indexes: ["sourced_runs_by_press"] }), label: "Runs", fields: { press: { label: "Press", hints: ["P-1"] } }, search: [] },
    }));
    const axis = $.const(Plan.axis({ window: { min: PRESS_WEEK, max: new Date("2026-10-08T00:00:00Z") }, resolution: "day" }));
    // A list of TS, built for the rows' own key type.
    return Plan({
        axis, slice: { slice },
        series: [Plan.series.span(cs.PressRun, {
            key: "runs", title: "Runs", label: (r) => r.title, id: true,
            runs: (r) => [Plan.run({
                key: r.title, label: r.title, state: variant("confirmed", null),
                start: r.start.match({ none: () => PRESS_WEEK, some: (_$, at) => at }), end: r.end.match({ none: () => PRESS_WEEK, some: (_$, at) => at }),
            })],
        })],
    });
}))) };
/** The same runs paged straight from `data`, with no rail (east-workspace#1696): the canvas's own key search seeks them. */
const sourcedData = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const runs = $.let(Data.bindPaged(sourcedRuns));
    const axis = $.const(Plan.axis({ window: { min: PRESS_WEEK, max: new Date("2026-10-08T00:00:00Z") }, resolution: "day" }));
    return Plan({
        axis, data: runs,
        series: [Plan.series.span(cs.PressRun, {
            key: "runs", title: "Runs", label: (r) => r.title, id: true,
            runs: (r) => [Plan.run({
                key: r.title, label: r.title, state: variant("confirmed", null),
                start: r.start.match({ none: () => PRESS_WEEK, some: (_$, at) => at }), end: r.end.match({ none: () => PRESS_WEEK, some: (_$, at) => at }),
            })],
        })],
    });
}))) };
/** The rows the canvas draws, by their ids, in order. */
const drawn = (c: HTMLElement) => [...slot(c, "main")!.querySelectorAll("[data-plan-row]")].map((row) => row.getAttribute("data-plan-row"));
const printSourced = printFor(Sourced);

describe("a Plan's rows source over rows keyed by a variant (east-workspace#1696)", () => {
    test("#1696 — the rows source pages the runs in the key's own order: a variant's cases each one run, a number by its value — never their texts', whose first is the tenth", async () => {
        const { container: c } = await h.mount(sourcedRows);
        await settle();
        await waitFor(() => expect(drawn(c)).toEqual([variant("erp", 2n), variant("erp", 9n), variant("erp", 10n), variant("own", "Annex"), variant("own", "Berth")]
            .map((key) => rowKeyOf(entry("runs", printSourced(key))))), { timeout: 10_000 });
    });

    test("#1696 — Search Records finds a run by its key, typed as a variant reads, lists it by its key, and a pick goes to its row, which takes the keyboard", async () => {
        const { container: c } = await h.mount(sourcedRows);
        await settle();
        await paste(c, ".erp 10");
        await waitFor(() => expect(lines(c)).toEqual([printSourced(variant("erp", 10n))]), { timeout: 10_000 });
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        await waitFor(() => expect(document.activeElement?.closest("[role='row']")?.textContent ?? "").toContain("Posters"));
    });

    test("#1696 — over the runs paged straight from `data`, the canvas's own key search reads a key typed as a variant reads, lists it by its key, and a pick goes to its row, which takes the keyboard", async () => {
        const { container: c } = await h.mount(sourcedData);
        await settle();
        await paste(c, ".erp 10");
        await waitFor(() => expect(lines(c)).toEqual([printSourced(variant("erp", 10n))]), { timeout: 10_000 });
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        await waitFor(() => expect(document.activeElement?.closest("[role='row']")?.textContent ?? "").toContain("Posters"));
    });
});

describe("Search Records over the work orders' rows source, read through their indexes", () => {
    /** The work orders' `rows` source's narrowing, as the rail holds it. */
    const ordersNarrowing = () => [...decodeState(getStore().read("ex.planRecordIndexes.rows")!).where.keys()];

    test("finds an order the rail hides, names what hides it, and a pick clears that and goes to its row", async () => {
        const { container: c } = await h.mount(records.planRecordIndexes);
        await settle();
        // It opens on the Ready orders due in the first fortnight: JOB-10001 is Scheduled, and due later.
        expect(ordersNarrowing().length).toBeGreaterThan(0);
        expect(labels(c).some((label) => label.includes("JOB-10001"))).toBe(false);
        await paste(c, "JOB-10001");
        await waitFor(() => expect(lines(c)[0]).toMatch(/^JOB-10001 · hidden by .*Status: Ready/));
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        await waitFor(() => expect(labels(c).some((label) => label.includes("JOB-10001"))).toBe(true), { timeout: 4000 });
        expect(ordersNarrowing()).not.toContain("status");
        await waitFor(() => expect(document.activeElement?.closest("[role='row']")?.textContent ?? "").toContain("JOB-10001"));
    });

    test("an order one choice hides is gone to with that choice alone cleared, its row taking the keyboard (review of #1481, finding 3)", async () => {
        const { container: c } = await h.mount(records.planRecordIndexes);
        await settle();
        // JOB-10003 is Ready, as the narrowing chooses, and due after the first fortnight: the due window alone hides it.
        await paste(c, "JOB-10003");
        await waitFor(() => expect(lines(c)[0]).toMatch(/^JOB-10003 · hidden by Due: .* — picking it clears that filter$/));
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        await waitFor(() => expect(labels(c).some((label) => label.includes("JOB-10003"))).toBe(true), { timeout: 4000 });
        expect(ordersNarrowing()).toContain("status");
        await waitFor(() => expect(document.activeElement?.closest("[role='row']")?.textContent ?? "").toContain("JOB-10003"));
    });

    test("an order the narrowing holds, far down its rows, is gone to with nothing cleared", async () => {
        const { container: c } = await h.mount(records.planRecordIndexes);
        await settle();
        const before = ordersNarrowing();
        // Ready, due 1 October, as the first is: thousands of the narrowing's rows on.
        await paste(c, "JOB-49960");
        await waitFor(() => expect(lines(c)[0]).toBe("JOB-49960"));
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        await waitFor(() => expect(labels(c).some((label) => label.includes("JOB-49960"))).toBe(true), { timeout: 4000 });
        expect(ordersNarrowing()).toEqual(before);
    });
});
