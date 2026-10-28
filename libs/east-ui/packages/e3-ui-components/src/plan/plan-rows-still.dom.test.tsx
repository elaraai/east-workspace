/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A Plan's rows hold still while its dates move (#1344), on e3 itself: the
 * dates on screen never decide which rows are listed. The work orders Plan
 * (`planRecordIndexes`) pages its work orders, a resource kind, through its
 * slice's `orders` source, whose Due is a field of the rail; the operations'
 * source holds the window. A pan, a step of the date navigator and the horizon
 * brush move it — written into the operations' source — read no work order,
 * leave the rows in view as they are and read only the operations' cells the
 * canvas does not hold; the resolution reads no work order either, and the
 * rail's Due still narrows the rows when the viewer sets it. The ops plan
 * (`slicePlanChrome`), whose slice has no source holding the window, holds its
 * own: a pan and a step move it and read no task. The tabs that list what is
 * in the dates on screen follow them, their sources holding the window: the
 * target state's Deliveries and the measures' Weeks keep their lists while the
 * new dates are read, then list what is in them. What is counted is read from
 * the request log (`h.requests`).
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, decodeBeast2For, encodeBeast2For, printFor, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { getStore } from "@elaraai/east-ui-components/internal";
import * as records from "@elaraai/e3-ui/examples/plan/plan-records";
import * as plans from "@elaraai/e3-ui/examples/plan/plan";
import * as sheet from "@elaraai/e3-ui/examples/sheet/sheet-records";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { el } from "./frame/harness.test-utils.js";
import "./index.js";

const h = e3Harness({ "plan/plan-records": records, "sheet/sheet-records": sheet, "plan/plan": plans }, { main: "data-plan-body" });

const DAY = 86_400_000;
/** The requests that read rows of a record: whole, a page, a key search, several runs or keys in one, a placement or a membership. */
const READS = new Set<E3Request["kind"]>(["read", "page", "find", "runs", "rows", "place", "within"]);
/** The reads of a record's rows since a point in the request log. */
const readsOf = (dataset: string, from: number) => h.requests().slice(from).filter((r) => r.dataset === dataset && READS.has(r.kind));
/** The work orders' record, the operations' and the ops plan's tasks', as their requests name them. */
const ORDERS = `records.${sheet.indexedWorkOrders.name}`;
const OPERATIONS = `records.${records.planOperations.name}`;
const TASKS = `records.${plans.planSliceJobs.name}`;

/**
 * The operations' cells the series index was searched for since a point in the
 * request log: each search's fields — its tile's start and its work order, as
 * the index files them.
 */
const cellsSearched = (from: number) => h.requests().slice(from)
    .filter((r) => r.dataset === OPERATIONS && r.kind === "find" && r.query.get("index") === records.planOperationsByWorkWeek.name)
    .flatMap((r) => r.searches.map((search) => ("fields" in search ? search.fields.join(" ") : JSON.stringify(search))));

/** The keys of the rows the canvas draws, in order. */
const keysOf = (c: HTMLElement) => [...slot(c, "main").querySelectorAll("[data-plan-row]")].map((el) => el.getAttribute("data-plan-row"));
/** The date the navigator shows the window from, in ms. */
const anchorOf = (c: HTMLElement) => Number(slot(c, "toolbar").querySelector("[data-time-navigation='plan']")!.getAttribute("data-time-anchor"));
/** Presses a key on the canvas's grid, as a reader does with a row focused. */
const press = async (c: HTMLElement, key: string) => {
    await act(async () => { fireEvent.keyDown(slot(c, "main").querySelector('[role="treegrid"]')!, { key }); });
    await settle();
};
/** Steps the date navigator on, as its Next button does. */
const next = async (c: HTMLElement, name: string) => {
    await act(async () => { fireEvent.click(within(slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='time-navigation']")!).getByRole("button", { name })); });
    await settle();
};
const printDate = printFor(DateTimeType);
const decodeState = decodeBeast2For(RecordSliceStateType);
const encodeState = encodeBeast2For(RecordSliceStateType);
/** A source's state of the work orders Plan's rail, as the store keeps it. */
const stateOf = (source: string) => decodeState(getStore().read(`ex.planRecordIndexes.${source}`)!);
/** A range of dates, as the rail's state holds one: its bounds printed, the end exclusive. */
const range = (from: Date, to: Date) => variant("range", { from: printDate(from), to: printDate(to) });
/** A day of October 2026. */
const OCT = (day: number) => new Date(Date.UTC(2026, 9, day));
/** JOB-10000's operation's bar: drawn once the canvas has read its first cells. */
const FIRST_BAR = el("data-run", "operation", "JOB-10000-run");

describe("the work orders Plan: its rows hold still while its dates move", () => {
    test("a pan, a step of the date navigator and the horizon brush move the window, written into the operations' source, reading no work order: the rows in view stay, and only the operations' cells the canvas does not hold are read; nor does the resolution read any work order", async () => {
        const ui = await h.mount(records.planRecordIndexes);
        const c = ui.container;
        await waitFor(() => expect(c.querySelector(FIRST_BAR)).not.toBeNull());
        await settle();
        const keys = keysOf(c);
        expect(keys.length).toBeGreaterThan(0);
        const from = anchorOf(c);
        expect(from).toBe(OCT(1).getTime());
        // The operations' source holds the window, the fortnight from the first of October.
        expect(stateOf("operation").where.get("start")).toEqual(range(OCT(1), OCT(15)));
        // Every cell searched so far — those of the first fifty orders over the weeks of 21 September to 19 October.
        const searched = new Set(cellsSearched(0));
        expect(searched.size).toBe(5 * 50);
        let at = h.requests().length;
        /** The window `moved` days on, ending `ends` days on: no work order read, the rows as they were, the cells it read none read before. */
        const still = (moved: number, ends: number, cells: number) => {
            expect(anchorOf(c)).toBe(from + moved * DAY);
            expect(stateOf("operation").where.get("start")).toEqual(range(OCT(1 + moved), OCT(15 + ends)));
            expect(readsOf(ORDERS, at)).toEqual([]);
            expect(keysOf(c)).toEqual(keys);
            const read = cellsSearched(at);
            expect(read.filter((cell) => searched.has(cell))).toEqual([]);
            expect(read).toHaveLength(cells);
            for (const cell of read) searched.add(cell);
            at = h.requests().length;
        };
        // A pan, `]`: a day on — the weeks the canvas reads, two days either side of the window, and one either side of
        // those, are the ones it holds.
        await press(c, "]");
        still(1, 1, 0);
        // A step of the date navigator: a day on again, the same weeks.
        await next(c, "Next day");
        still(2, 2, 0);
        // A pan into the week of 19 October's edge: the week after it is wanted, its first fifty orders' cells read alone.
        await press(c, "]");
        still(3, 3, 50);
        // The brush: its horizon the operations' dates, the ninety days from the first of October in whole days, on a
        // 1800px track — twenty a day — its low edge dragged from 4 October three days on. The weeks it reads are held.
        expect(within(slot(c, "main")).getByText("HORIZON · 90 D")).toBeTruthy();
        const track = slot(c, "main").querySelector<HTMLElement>("[data-brush-track]")!;
        Object.defineProperty(track, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, right: 1800, bottom: 32, width: 1800, height: 32, x: 0, y: 0, toJSON: () => ({}) }),
        });
        await act(async () => {
            fireEvent.pointerDown(track, { clientX: 60, pointerId: 1, buttons: 1 });
            fireEvent.pointerMove(track, { clientX: 120, pointerId: 1, buttons: 1 });
            fireEvent.pointerUp(track, { pointerId: 1 });
        });
        await settle();
        still(6, 3, 0);
        // A resolution re-buckets the window: no part of the orders' narrowing, so it reads none of them, and of the
        // operations only the cells of the weeks it reads that the canvas does not hold.
        await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("radio", { name: "WEEK" })); });
        await settle();
        expect(readsOf(ORDERS, at)).toEqual([]);
        expect(keysOf(c)).toEqual(keys);
        expect(cellsSearched(at).filter((cell) => searched.has(cell))).toEqual([]);
    });

    test("the rail's Due is a field of the rail: the viewer's choice of it narrows the work orders, read from e3, and moves no date on screen, nor the operations' window", async () => {
        const ui = await h.mount(records.planRecordIndexes);
        const c = ui.container;
        await waitFor(() => expect(c.querySelector(FIRST_BAR)).not.toBeNull());
        await settle();
        // Its chip is the rail's, as every field of the work orders' is.
        expect(slot(c, "toolbar").querySelector("[data-record-slice-source='orders'][data-record-slice-field='due']")).not.toBeNull();
        const keys = keysOf(c);
        const from = anchorOf(c);
        const at = h.requests().length;
        // The orders due from 8 October to 22 October, as the Due editor writes the rail's state.
        const state = stateOf("orders");
        await act(async () => {
            getStore().write("ex.planRecordIndexes.orders", encodeState({ ...state, where: new Map(state.where).set("due", range(OCT(8), OCT(22))) }));
        });
        await waitFor(() => expect(keysOf(c)).not.toEqual(keys));
        await settle();
        expect(readsOf(ORDERS, at).length).toBeGreaterThan(0);
        expect(anchorOf(c)).toBe(from);
        expect(stateOf("operation").where.get("start")).toEqual(range(OCT(1), OCT(15)));
    });
});

describe("the ops plan: a slice with no source holding the window, the canvas holding its own", () => {
    test("a pan and a step of the date navigator move the canvas's own window, reading no task: the rows in view stay", async () => {
        const ui = await h.mount(plans.slicePlanChrome);
        const c = ui.container;
        await waitFor(() => expect(keysOf(c).length).toBeGreaterThan(0));
        await settle();
        const keys = keysOf(c);
        const from = anchorOf(c);
        expect(from).toBe(Date.UTC(2024, 0, 1));
        let at = h.requests().length;
        const still = (weeks: number) => {
            expect(anchorOf(c)).toBe(from + weeks * 7 * DAY);
            expect(readsOf(TASKS, at)).toEqual([]);
            expect(keysOf(c)).toEqual(keys);
            at = h.requests().length;
        };
        // A pan, `]`: a week on.
        await press(c, "]");
        still(1);
        // A step of the date navigator: a week on again.
        await next(c, "Next week");
        still(2);
    });
});

describe("the tabs that list what is in the dates on screen follow them", () => {
    /** The library pane's open tab's cards, by their names. */
    const cardsOf = (c: HTMLElement) => [...slot(c, "start").querySelectorAll('[role="tabpanel"]:not([hidden]) [data-library-item]')].map((card) => card.textContent);
    /** Opens a library tab, by its name. */
    const openTab = async (c: HTMLElement, name: string) => {
        const tab = [...slot(c, "start").querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith(name));
        if (tab === undefined) throw new Error(`no library tab ${name}`);
        await act(async () => { fireEvent.click(tab); });
        await settle();
    };
    /** A pan's new narrowing of a tab's source held on its way: the tab keeps its cards; let go, it lists the new dates'. */
    const followsThePan = async (c: HTMLElement, dataset: string) => {
        const before = cardsOf(c);
        expect(before.length).toBeGreaterThan(0);
        const held = h.e3.hold((r) => r.dataset === dataset && READS.has(r.kind));
        await press(c, "]");
        expect(held.held).toBeGreaterThan(0);
        // The dates have moved; their cards are read: the tab keeps what it listed, never a blank.
        expect(cardsOf(c)).toEqual(before);
        await act(async () => { held.release(); });
        await settle();
        const after = cardsOf(c);
        expect(after.length).toBeGreaterThan(0);
        expect(after).not.toEqual(before);
    };

    test("the target state's Deliveries: the deliveries in the window, kept while a pan's are read, then the new window's", async () => {
        const ui = await h.mount(plans.planTargetState);
        await openTab(ui.container, "Deliveries");
        await followsThePan(ui.container, `records.${plans.planTargetDeliveries.name}`);
    });

    test("the measures' Weeks: the weeks in the window, kept while a pan's are read, then the new window's", async () => {
        const ui = await h.mount(plans.planMeasures);
        await openTab(ui.container, "Weeks");
        await followsThePan(ui.container, `records.${plans.planMeasureWeeks.name}`);
    });
});
