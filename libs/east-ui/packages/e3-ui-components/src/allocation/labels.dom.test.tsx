/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The board's nouns (#1338) over the kiln yard in its own words —
 * `labels={{ lane: "Bay", event: { one: "Delivery", other: "Deliveries" },
 * resource: "Kiln", quantity: "Vol" }}` — in every place the board writes
 * one: the Table's heads, its placeholders, chips and Chooser, the Timeline's
 * heads and tooltips, the drag captions, the banners, the narrowing's summary
 * and the footer. With no labels the words are the defaults'
 * (`table.dom.test.tsx`, `timeline.dom.test.tsx`).
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { StringType, decodeBeast2For, encodeBeast2For, none, printFor, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import { pointAt } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { pathText } from "../platform/record-paging.test-utils.js";
import { act, allocationHarness, mount, settle, slot } from "./harness.test-utils.js";
import { lower } from "./nouns.js";

const h = allocationHarness();
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
async function open() {
    const store = new UIStore(); StateRuntime.initializeStore(store);
    const r = mount(ex.allocationLabels); await settle();
    return { c: r.container, store };
}
const row = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row="${key}"]`)!;
const FREE = "slot:B-1|2027-05-11T00:15:00.000";

describe("the board's nouns (#1338)", () => {
    test("the Table's heads, its placeholders, chips and chevrons speak the yard's words", async () => {
        const { c } = await open();
        expect([...c.querySelector("[data-allocation-table-head]")!.children].map(e => e.textContent))
            .toEqual(["Time", "Bay", "Delivery", "Vol", "Spec", "Kiln", "Load", "Status"]);
        const free = row(c, FREE);
        expect(free.querySelector("[data-allocation-placeholder=event] [data-say=idle]")!.textContent).toBe("no delivery");
        expect(free.querySelector("[data-allocation-placeholder=resource] [data-say=idle]")!.textContent).toBe("no kiln");
        expect(free.querySelector<HTMLElement>("[data-allocation-placeholder=event]")!.title).toBe("Choose a delivery, or drag one here from Deliveries");
        expect(free.querySelector<HTMLElement>("[data-allocation-placeholder=resource]")!.title).toBe("Choose a kiln, or drag one here from Kilns");
        const bin = row(c, "bin:3101");
        expect(within(bin).getByRole("button", { name: "Replace LD-2201 with another delivery" })).toBeTruthy();
        expect(within(bin).getByRole("button", { name: "Remove LD-2201 from the plan · it moves to Deliveries" })).toBeTruthy();
        expect(within(bin).getByRole("button", { name: "Change the kiln" })).toBeTruthy();
        // The Chooser on a resource cell: its heading and its search.
        await press(within(bin).getByRole("button", { name: "Change the kiln" }));
        const chooser = document.querySelector<HTMLElement>("[data-allocation-choices]")!;
        expect(chooser.querySelector("input")!.getAttribute("placeholder")).toBe("Find a kiln");
        expect(within(document.body).getByText("Kiln · B-3 01:55")).toBeTruthy();
        expect(slot(c, "footer").querySelector("[data-allocation-legend=bin]")!.textContent).toBe("Delivery or kiln");
        await waitFor(() => expect(slot(c, "toolbar").querySelector("[data-record-slices-summary]")!.textContent).toBe("3 of 3 bays·33 of 33 kilns"));
    });

    test("the Timeline's heads and tooltips, and a refused drag's caption", async () => {
        const { c } = await open();
        await press(toolbar(c).getByRole("radio", { name: "Timeline" }));
        expect([...c.querySelectorAll("[data-head-caption]")].map(cap => cap.textContent)).toEqual(["BayHour", "WeekKiln"]);
        expect(c.querySelector<HTMLElement>('[data-allocation-lane="B-1"] > span:last-child')!.title).toBe("Bins booked in this bay today · m³");
        const card = c.querySelector<HTMLElement>('[data-allocation-card="3101"]')!;
        expect(card.title).toBe("LD-2201 · BRK · R1 · spec MC14 · 35 m³ · B-3 01:55 on K-209 · drag to another bay hour to move it");
        expect(card.querySelector("[data-allocation-connector]")!.getAttribute("aria-label"))
            .toBe("Allocated to K-209 · drag the connector onto a kiln to move it · click to choose another");
        // A card's body dragged onto a kiln's row: its refusal in the yard's words.
        await act(async () => {
            pointAt(card); fireEvent.pointerDown(card, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 });
            const rowEl = c.querySelector('[data-allocation-resource="K-101"]')!;
            pointAt(rowEl); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 });
        });
        await settle();
        await act(async () => { pointAt(c.querySelector('[data-allocation-resource="K-101"]')!); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
        await settle();
        expect(document.querySelector("[data-drag-caption]")!.textContent).toBe("bay hours only · drag its connector to change the kiln");
        await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); }); await settle();
    });

    test("the banners: a day not started, and a failed narrowing", async () => {
        const { c, store } = await open();
        await key(c, "]"); await key(c, "]");
        expect(slot(c, "banners").textContent).toContain("Book a delivery or reserve a slot to start this day's plan.");
        await key(c, "["); await key(c, "[");
        h.paging.failing.add(pathText(ex.yardBays.path));
        const key_ = "ex.allocationLabels.lanes";
        const state = decodeBeast2For(RecordSliceStateType)(store.read(key_)!);
        await act(async () => { store.write(key_, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none,
            where: new Map([["area", variant("values", [printFor(StringType)("North")])]]) })); });
        await settle();
        await waitFor(() => expect(within(slot(c, "banners")).queryByText("Bay results unavailable")).not.toBeNull());
    });

    test("table.bands: the yard's shifts head the Table's bands, each counting what it holds", async () => {
        const { c } = await open();
        for (let i = 0; i < 3; i++) await press(c.querySelector<HTMLElement>("[data-allocation-band][aria-expanded=true]")!);
        expect([...c.querySelectorAll("[data-allocation-band]")].map(b => b.textContent)).toEqual([
            "Night207 bins · 13 free · 208 m³ · collapsed", "Day shift4013 bins · 27 free · 208 m³ · collapsed", "Evening206 bins · 14 free · 140 m³ · collapsed",
        ]);
    });

    test("running text writes a noun in lower case, unless it is written in capitals", () => {
        expect([lower("Kiln"), lower("Unloading bay"), lower("SKU"), lower("QTY"), lower("B"), lower("Bay 2")]).toEqual(["kiln", "unloading bay", "SKU", "QTY", "b", "bay 2"]);
    });
});
