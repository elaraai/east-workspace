/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A Plan's rows hold still while its dates move (#1344), on e3 itself: the
 * dates on screen never decide which rows are listed. The work orders Plan
 * (`planRecordIndexes`) pages its rows from its slice's `rows` source, whose
 * Due is a field of the rail: no source holds the window, so the canvas holds
 * its own — a pan, a step of the date navigator and the horizon brush move it,
 * read no window of the rows and leave the rows in view as they are, and the
 * resolution reads none either; the rail's Due still narrows the rows when the
 * viewer sets it. The tabs that list what is in the dates on screen follow
 * them, their sources holding the window: the target state's Deliveries and
 * the measures' Weeks keep their lists while the new dates are read, then list
 * what is in them. What is counted is read from the request log (`h.requests`).
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
import "./index.js";

const h = e3Harness({ "plan/plan-records": records, "sheet/sheet-records": sheet, "plan/plan": plans }, { main: "data-plan-body" });

const DAY = 86_400_000;
/** The requests that read rows of a record: whole, a page, a key search, several runs or keys in one, a placement or a membership. */
const READS = new Set<E3Request["kind"]>(["read", "page", "find", "runs", "rows", "place", "within"]);
/** The reads of a record's rows since a point in the request log. */
const readsOf = (dataset: string, from: number) => h.requests().slice(from).filter((r) => r.dataset === dataset && READS.has(r.kind));
/** The work orders' record, as its requests name it. */
const ORDERS = `records.${sheet.indexedWorkOrders.name}`;

/** The keys of the rows the canvas draws, in order. */
const keysOf = (c: HTMLElement) => [...slot(c, "main").querySelectorAll("[data-plan-row]")].map((el) => el.getAttribute("data-plan-row"));
/** The date the navigator shows the window from, in ms. */
const anchorOf = (c: HTMLElement) => Number(slot(c, "toolbar").querySelector("[data-time-navigation='plan']")!.getAttribute("data-time-anchor"));
/** Presses a key on the canvas's grid, as a reader does with a row focused. */
const press = async (c: HTMLElement, key: string) => {
    await act(async () => { fireEvent.keyDown(slot(c, "main").querySelector('[role="treegrid"]')!, { key }); });
    await settle();
};
const printDate = printFor(DateTimeType);

describe("the work orders Plan: its rows hold still while its dates move", () => {
    test("a pan, a step of the date navigator and the horizon brush move the canvas's own window, reading no window of rows; the rows in view stay; nor does the resolution read any", async () => {
        const ui = await h.mount(records.planRecordIndexes);
        const c = ui.container;
        await waitFor(() => expect(c.querySelector('[data-run="JOB-10000-run"]')).not.toBeNull());
        await settle();
        const keys = keysOf(c);
        expect(keys.length).toBeGreaterThan(0);
        const from = anchorOf(c);
        expect(from).toBe(Date.UTC(2026, 9, 1));
        let at = h.requests().length;
        const still = (moved: number) => {
            expect(anchorOf(c)).toBe(from + moved * DAY);
            expect(readsOf(ORDERS, at)).toEqual([]);
            expect(keysOf(c)).toEqual(keys);
            at = h.requests().length;
        };
        // A pan: `]`, a day on.
        await press(c, "]");
        still(1);
        // A step of the date navigator: a day on again.
        await act(async () => { fireEvent.click(within(slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='time-navigation']")!).getByRole("button", { name: "Next day" })); });
        await settle();
        still(2);
        // The brush: its horizon the axis's two weeks and the window shown, Oct 1 to 17, with the window's fourteen days
        // again either side — Sep 17 to Oct 31, forty-four days on a 4,400px track — its low edge dragged from Oct 3 three
        // days on.
        const track = slot(c, "main").querySelector<HTMLElement>("[data-brush-track]")!;
        Object.defineProperty(track, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, right: 4400, bottom: 32, width: 4400, height: 32, x: 0, y: 0, toJSON: () => ({}) }),
        });
        await act(async () => {
            fireEvent.pointerDown(track, { clientX: 1600, pointerId: 1, buttons: 1 });
            fireEvent.pointerMove(track, { clientX: 1900, pointerId: 1, buttons: 1 });
            fireEvent.pointerUp(track, { pointerId: 1 });
        });
        await settle();
        still(5);
        // A resolution re-buckets the window: no part of the rows' narrowing, so it reads none of them.
        await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("radio", { name: "WEEK" })); });
        await settle();
        expect(readsOf(ORDERS, at)).toEqual([]);
        expect(keysOf(c)).toEqual(keys);
    });

    test("the rail's Due is a field of the rail: the viewer's choice of it narrows the rows, read from e3, and moves no date on screen", async () => {
        const ui = await h.mount(records.planRecordIndexes);
        const c = ui.container;
        await waitFor(() => expect(c.querySelector('[data-run="JOB-10000-run"]')).not.toBeNull());
        await settle();
        // Its chip is the rail's, as every field of the work orders' is.
        expect(slot(c, "toolbar").querySelector("[data-record-slice-source='rows'][data-record-slice-field='due']")).not.toBeNull();
        const keys = keysOf(c);
        const from = anchorOf(c);
        const at = h.requests().length;
        // The orders due from 8 October to 22 October, as the Due editor writes the rail's state.
        const key = "ex.planRecordIndexes.rows";
        const state = decodeBeast2For(RecordSliceStateType)(getStore().read(key)!);
        const due = variant("range", { from: printDate(new Date("2026-10-08T00:00:00Z")), to: printDate(new Date("2026-10-22T00:00:00Z")) });
        await act(async () => { getStore().write(key, encodeBeast2For(RecordSliceStateType)({ ...state, where: new Map(state.where).set("due", due) })); });
        await waitFor(() => expect(keysOf(c)).not.toEqual(keys));
        await settle();
        expect(readsOf(ORDERS, at).length).toBeGreaterThan(0);
        expect(anchorOf(c)).toBe(from);
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
