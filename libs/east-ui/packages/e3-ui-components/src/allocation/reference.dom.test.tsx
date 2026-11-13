/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The record the board's check reads beside its bins (#1551), on e3: the
 * mills' delivery schedule, the slice's `reference` source. The board writes
 * its day into it as into the bins' source, and the check is given that day's
 * deliveries — read through the schedule's interval index, never the record
 * whole — which nothing draws: the rail offers none of the schedule. Another
 * session's change of the schedule reaches the check, and a read of it that
 * fails is the day's, said once with Retry.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { SortedMap, StringType, compareFor, decodeBeast2For, equalFor } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { getStore } from "@elaraai/east-ui-components/internal";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, settle, slot, TUE } from "./harness.test-utils.js";
import { issuesTab, key, tab, text } from "./inspector.test-utils.js";

const h = allocationHarness();
/** The schedule, as the request log names its dataset. */
const DELIVERIES = `records.${ex.yardDeliveries.name}`;
const HOUR = 3_600_000;
const decodeState = decodeBeast2For(RecordSliceStateType);
const sameChoice = equalFor(RecordSliceStateType.fields.where.value);
/** A source's narrowing, as the page's store holds it under the example's slice. */
const source = (name: string) => decodeState(getStore().read(`ex.allocationDeliveries.${name}`)!);
/** The day each source holds: the bins' under their `at`, the schedule's under its `from`. */
const windows = () => ({ bins: source("bin").where.get("at"), schedule: source("reference").where.get("from") });
/** The check's issues the Issues tab lists, by the name the yard gives each kind: each one's title and detail. */
const checked = (c: HTMLElement) => Object.fromEntries([...issuesTab(c).querySelectorAll<HTMLElement>('[data-allocation-issue-group^="custom:"]')].map(group => [
    group.getAttribute("data-allocation-issue-group")!.slice("custom:".length),
    [...group.querySelectorAll<HTMLElement>('[data-allocation-issue="custom"]')].map(line => [text(line.querySelector("[title]")), text(line.children[1])]),
]));
/** What the check finds on Tue 11 May, the plan day. */
const TUESDAY = {
    "Delivery moved": [["LD-2210 · bin 3113", "Delivered to B-3 at 12:00 now · booked B-2 10:35"]],
    "No delivery on the day": [["LD-2214 · bin 3117", "The mills' schedule delivers LD-2214 on another day"]],
    "Delivery not booked": [["LD-2233", "Delivered to B-1 at 19:00"]],
};

describe("the schedule the check reads beside the bins (#1551)", () => {
    test("the board writes its day into the schedule's source as into the bins', and a step of the day moves both", async () => {
        const { container: c } = await h.mount(ex.allocationDeliveries);
        const tuesday = windows();
        expect(tuesday.bins).toBeDefined();
        expect(sameChoice(tuesday.schedule!, tuesday.bins!)).toBe(true);
        await key(c, "]");
        const wednesday = windows();
        expect(sameChoice(wednesday.schedule!, wednesday.bins!)).toBe(true);
        expect(sameChoice(wednesday.schedule!, tuesday.schedule!)).toBe(false);
        await key(c, "[");
        expect(sameChoice(windows().schedule!, tuesday.schedule!)).toBe(true);
    });

    test("the check is given the day's deliveries alone: a bin booked off its load's bay and hour, one whose load the day delivers none of, and a delivery the day books no bin of; the next day's are the next day's", async () => {
        const { container: c } = await h.mount(ex.allocationDeliveries);
        await tab(c, "Issues");
        expect(checked(c)).toEqual(TUESDAY);
        // Wed 12 May books no bin, and LD-2214, moved there, is the delivery to book.
        await key(c, "]");
        expect(checked(c)).toEqual({ "Delivery not booked": [["LD-2214", "Delivered to B-2 at 09:00"]] });
        await key(c, "[");
        expect(checked(c)).toEqual(TUESDAY);
    });

    test("while the day's bins and the schedule are read the Issues tab shows it is loading, its count unsaid, and never says there are no issues; read, it says what the check finds (#1595)", async () => {
        const { container: c } = await h.mount(ex.allocationDeliveries);
        await tab(c, "Issues");
        expect(checked(c)).toEqual(TUESDAY);
        const issuesTabButton = () => within(slot(c, "end")).getByRole("tab", { name: /^Issues/ });
        // Thu 13 May, two days on: a day the board has not read ahead, the schedule's reads held.
        const held = h.e3.hold(request => ["page", "find", "runs", "rows"].includes(request.kind) && request.dataset === DELIVERIES);
        await key(c, "]"); await key(c, "]");
        expect(issuesTab(c).querySelector("[data-allocation-issues-loading]")).not.toBeNull();
        expect(issuesTab(c).querySelector("[data-allocation-issues-empty]")).toBeNull();
        expect(issuesTabButton().textContent).toBe("Issues");
        await act(async () => { held.release(); });
        await settle();
        await waitFor(() => expect(issuesTab(c).querySelector("[data-allocation-issues-loading]")).toBeNull(), { timeout: 15_000 });
        expect(issuesTabButton().textContent).toMatch(/^Issues\s*\d*$/u);
    });

    test("the schedule is read through its interval index, never the record whole", async () => {
        const { container: c } = await h.mount(ex.allocationDeliveries);
        await key(c, "]");
        const reads = h.requests().filter(request => request.dataset === DELIVERIES);
        expect(reads.filter(request => request.kind === "find").length).toBeGreaterThan(0);
        expect(reads.filter(request => request.kind === "read")).toEqual([]);
        expect(reads.filter(request => request.kind === "find" && request.query.get("index") !== "yard_deliveries_by_time")).toEqual([]);
    });

    test("another session's change of the schedule reaches the check: LD-2210 delivered to B-2 in its bin's hour is booked as delivered", async () => {
        const { container: c } = await h.mount(ex.allocationDeliveries);
        await tab(c, "Issues");
        expect(checked(c)).toEqual(TUESDAY);
        const schedule = new SortedMap(await h.read(ex.yardDeliveries), compareFor(StringType));
        schedule.set("LD-2210", { bay: "B-2", from: new Date(TUE.getTime() + 10 * HOUR), to: new Date(TUE.getTime() + 11 * HOUR) });
        await h.patch(ex.yardDeliveries, schedule);
        const { "Delivery moved": _moved, ...rest } = TUESDAY;
        await waitFor(() => expect(checked(c)).toEqual(rest), { timeout: 15_000 });
    });

    test("a read of the schedule that fails is the day's: said once, with Retry, on the board and on the footer's line; Retry, the fault gone, lands the day", async () => {
        const { container: c } = await h.mount(ex.allocationDeliveries);
        const said = () => [...slot(c, "main").querySelectorAll<HTMLElement>("[data-allocation-read-line]")];
        const stop = h.unavailable(ex.yardDeliveries);
        // Thu 13 May, two days on: a day the board has not read ahead.
        await key(c, "]"); await key(c, "]");
        await waitFor(() => expect(said()).toHaveLength(1), { timeout: 15_000 });
        expect(said()[0]!.getAttribute("data-allocation-read-line")).toBe("failed");
        expect(said()[0]!.textContent).toMatch(/^Couldn't read .+Retry$/);
        expect(slot(c, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-failed")).toBe(true);
        stop();
        await act(async () => { fireEvent.click(within(said()[0]!).getByRole("button", { name: "Retry" })); });
        await settle();
        // The day lands: its line goes, and the footer's line is idle.
        await waitFor(() => {
            expect(said()).toEqual([]);
            expect(slot(c, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true);
        }, { timeout: 15_000 });
    });

    test("nothing draws the schedule: the rail names no source of it", async () => {
        const { container: c } = await h.mount(ex.allocationDeliveries);
        expect(c.querySelector('[data-record-slice-source="reference"]')).toBeNull();
        expect(document.querySelector('[data-record-slice-source="reference"]')).toBeNull();
        await key(c, "]");
        expect(document.querySelector('[data-record-slice-source="reference"]')).toBeNull();
    });
});
