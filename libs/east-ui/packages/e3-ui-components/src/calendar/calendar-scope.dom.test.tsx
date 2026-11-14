/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A press's own page (#1621) on e3 itself: the scoped Calendar example, its
 * runs and its crew scoped to the press the page is for — a narrowing the page
 * holds and the viewer cannot clear. What the page says is the press's: the
 * Backlog tab counts the press's unscheduled runs, `2` and never `2 of 3`,
 * since the scope is no choice of the viewer's; a choice of crew member counts
 * out of the press's (`0 of 2`), and its Clear filters clears the choice and
 * keeps the press and the dates. The rail draws no control of the press, and
 * its summary counts the runs in view out of the press's, naming no crew, all
 * of whom the scope holds. A choice builds the Calendar no more (#1354), on a
 * scoped source as on any. The press chosen above the Calendar is a page of its
 * own — its runs, its backlog and its choices — and the first press's choices
 * are kept for it. Search Records finds the press's runs alone, by their keys;
 * a run a choice of crew member hides names that choice, never the press, and a
 * pick of it clears that choice alone.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OptionType, StringType, decodeBeast2For, encodeBeast2For, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceStateType, type RecordSliceChoiceType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as cs from "@elaraai/e3-ui/examples/calendar/calendar-scope";
import { act, e3Harness, programOf, settle, slot, type MountOptions } from "../e3-web-mount.test-utils.js";
import { countBuilds } from "../shared/builds.test-utils.js";
import { eventKey } from "./model.js";
import "./index.js";

const h = e3Harness({ "calendar/calendar-scope": cs }, { main: "data-calendar-main" });
/** The runs' record, as its dataset's requests name it. */
const RUNS = "records.press_runs";
/** The runs a week of either press's page could draw. */
const RUN_KEYS = ["r1", "r2", "r3", "r4", "r5"];
type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];
const decodeState = decodeBeast2For(RecordSliceStateType);
const encodeState = encodeBeast2For(RecordSliceStateType);
const maybeText = printFor(OptionType(StringType));

/** Where the rail keeps a source's narrowing on a press's page: the page's slice is keyed by its press. */
const sourceKey = (press: string, source: string) => `ex.calendarScoped.${press}.${source}`;
/** A source's narrowing on a press's page, as the store keeps it: the runs' unless another is named. */
const whereOf = (store: UIStore, press: string, source = "run"): Where => decodeState(store.read(sourceKey(press, source))!).where;
/** The runs' narrowing on a press's page written whole, as the rail writes it. */
async function narrow(store: UIStore, press: string, where: Where) {
    const key = sourceKey(press, "run");
    const state = decodeState(store.read(key)!);
    await act(async () => { store.write(key, encodeState({ ...state, preset: none, where })); });
    await settle();
}
/** A crew member chosen beside the dates. */
const crew = (member: string, start: ValueTypeOf<RecordSliceChoiceType>): Where =>
    new Map([["crew", variant("values", [maybeText(some(member))])], ["start", start]]);

async function click(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const event = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-calendar-event=${JSON.stringify(eventKey({ kind: "run", key }))}]`);
/** The runs the view draws. */
const drawn = (c: HTMLElement) => RUN_KEYS.filter(key => event(c, key) !== null);
const tabs = (c: HTMLElement) => within(slot(c, "start")).getAllByRole("tab").map(t => t.textContent);
const tab = (c: HTMLElement, name: string) => click(within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith(name)));
/** The open tab's panel: every tab's stays mounted, the others hidden. */
const openPanel = (c: HTMLElement) => slot(c, "start").querySelector<HTMLElement>("[role=tabpanel]:not([hidden])")!;
/** The open tab's mounted cards, by their ids. */
const cards = (c: HTMLElement) => [...openPanel(c).querySelectorAll("[data-library-item]")].map(el => el.getAttribute("data-library-item")).sort();
/** Chooses the page's press in the Select above the Calendar. */
async function choosePress(c: HTMLElement, label: string) {
    // The page's own Select comes first, before the Calendar's.
    await click(c.querySelector<HTMLElement>("[data-scope=select][data-part=trigger]"));
    await click(within(screen.getByRole("listbox")).getAllByRole("option").find(option => option.textContent === label));
}

/** Search Records' box, in the toolbar's row. */
const searchBox = (c: HTMLElement) => slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
/** The box's list — the listbox its input controls — its lines as they read. */
const lines = (c: HTMLElement) => {
    const list = document.getElementById(searchBox(c).querySelector("input")!.getAttribute("aria-controls") ?? "");
    return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map((option) => option.textContent ?? "");
};
/** A query put in the box at once, as a paste is. */
async function pasteIntoSearch(c: HTMLElement, typed: string) {
    const input = searchBox(c).querySelector<HTMLInputElement>("input")!;
    await act(async () => { input.focus(); fireEvent.input(input, { target: { value: typed } }); });
    await settle();
}

/** The page mounted over a store of its own, Press 1's runs drawn. */
async function open(options: MountOptions = {}) {
    const store = new UIStore();
    StateRuntime.initializeStore(store);
    const { container } = await h.mount(cs.calendarScoped, { storageKey: "calendar-scope", ...options });
    await waitFor(() => expect(event(container, "r1")).not.toBeNull());
    await settle();
    return { container, store };
}

describe("a press's own page (#1621)", () => {
    test("it draws the press's runs and counts its backlog out of them, `Backlog 2` and never `2 of 3`; the rail draws no control of the press, and its summary counts the runs in view out of the press's", async () => {
        const { container, store } = await open();
        expect(drawn(container)).toEqual(["r1", "r2", "r3"]);
        // The scope is no choice of the viewer's: the store keeps the dates the navigation writes, and no press.
        expect([...whereOf(store, "P-1").keys()]).toEqual(["start"]);
        expect(tabs(container)).toEqual(["Templates 2", "Backlog 2"]);
        await tab(container, "Backlog");
        expect(cards(container)).toEqual([eventKey({ kind: "run", key: "r6" }), eventKey({ kind: "run", key: "r7" })].sort());
        const toolbar = slot(container, "toolbar");
        expect(toolbar.querySelector('[data-record-slice-field="crew"][data-record-slice-source="run"]')).not.toBeNull();
        expect(container.querySelector('[data-record-slice-field="press"]')).toBeNull();
        const summary = toolbar.querySelector("[data-record-slices-summary]")!;
        expect(summary.querySelector('[data-record-slice-source="run"]')?.textContent).toBe("3 of 5 run events");
        expect(summary.querySelector('[data-record-slice-source="crew"]')).toBeNull();
        // Nothing read the record whole.
        expect(h.requests("read", RUNS)).toEqual([]);
    });

    test("a choice of crew member narrows the backlog out of the press's, `0 of 2`; its Clear filters clears the choice and keeps the press and the dates", async () => {
        const { container, store } = await open();
        const start = whereOf(store, "P-1").get("start")!;
        await narrow(store, "P-1", crew("c1", start));
        expect(drawn(container)).toEqual(["r1", "r3"]);
        expect(tabs(container)[1]).toBe("Backlog 0 of 2");
        await tab(container, "Backlog");
        const empty = openPanel(container).querySelector<HTMLElement>("[data-library-empty][data-narrowed]")!;
        expect(empty.textContent).toContain("No backlog events match the filters");
        await click(within(empty).getByRole("button", { name: "Clear filters" }));
        expect([...whereOf(store, "P-1").keys()]).toEqual(["start"]);
        expect(whereOf(store, "P-1").get("start")).toEqual(start);
        expect(tabs(container)[1]).toBe("Backlog 2");
        expect(drawn(container)).toEqual(["r1", "r2", "r3"]);
    });

    test("a choice on the rail builds the Calendar no more, on a scoped source as on any (#1354)", async () => {
        const builds = countBuilds("Calendar", programOf(cs.calendarScoped));
        const { container, store } = await open({ program: builds.program });
        const mounted = [builds.runs, builds.decodes];
        expect(Math.min(...mounted)).toBeGreaterThan(0);
        await narrow(store, "P-1", crew("c2", whereOf(store, "P-1").get("start")!));
        expect(drawn(container)).toEqual(["r2"]);
        expect(tabs(container)[1]).toBe("Backlog 0 of 2");
        expect([builds.runs, builds.decodes], "no choice runs the body again or decodes a payload").toEqual(mounted);
    });

    test("the press chosen above it is a page of its own: its runs, its backlog and its choices, and the first press's choices kept for it", async () => {
        const { container, store } = await open();
        await narrow(store, "P-1", crew("c1", whereOf(store, "P-1").get("start")!));
        await choosePress(container, "Press 2");
        await waitFor(() => expect(drawn(container)).toEqual(["r4", "r5"]));
        expect(tabs(container)[1]).toBe("Backlog 1");
        expect([...whereOf(store, "P-2").keys()]).toEqual(["start"]);
        await choosePress(container, "Press 1");
        await waitFor(() => expect(drawn(container)).toEqual(["r1", "r3"]));
        expect(tabs(container)[1]).toBe("Backlog 0 of 2");
        expect(h.requests("read", RUNS)).toEqual([]);
    });

    test("Search Records finds the press's runs alone, by their keys — never another press's — and a run a choice of crew member hides names that choice, never the press", async () => {
        const { container, store } = await open();
        const keysListed = () => lines(container).map((line) => line.split(" · ")[0]);
        // r6 is the record's sixth run and the press's fourth: found at its place among the press's.
        await pasteIntoSearch(container, "r6");
        await waitFor(() => expect(keysListed()).toEqual(["r6"]), { timeout: 10_000 });
        await pasteIntoSearch(container, "r");
        await waitFor(() => expect(keysListed()).toEqual(["r1", "r2", "r3", "r6", "r7"]), { timeout: 10_000 });
        // A crew member chosen: the press's runs another member works, or none does, are hidden by that choice alone.
        await narrow(store, "P-1", crew("c1", whereOf(store, "P-1").get("start")!));
        await waitFor(() => {
            const hidden = lines(container).filter((line) => line.includes("hidden by"));
            expect(hidden.map((line) => line.split(" · ")[0])).toEqual(["r2", "r6", "r7"]);
            expect(hidden.every((line) => line.includes("Crew") && !line.includes("Press"))).toBe(true);
        }, { timeout: 10_000 });
        expect(keysListed()).toEqual(["r1", "r2", "r3", "r6", "r7"]);
        expect(h.requests("read", RUNS)).toEqual([]);
    });

    test("a pick of a run the choice of crew member hides clears that choice alone: the press stays, and the run is drawn among the press's, selected", async () => {
        const { container, store } = await open();
        const start = whereOf(store, "P-1").get("start")!;
        await narrow(store, "P-1", crew("c1", start));
        expect(drawn(container)).toEqual(["r1", "r3"]);
        await pasteIntoSearch(container, "r2");
        await waitFor(() => expect(lines(container)).toHaveLength(1), { timeout: 10_000 });
        await waitFor(() => expect(lines(container)[0]).toContain("hidden by Crew"), { timeout: 10_000 });
        await act(async () => { fireEvent.keyDown(searchBox(container).querySelector("input")!, { key: "Enter" }); });
        await settle();
        await waitFor(() => expect(event(container, "r2")?.getAttribute("aria-pressed")).toBe("true"), { timeout: 10_000 });
        // The choice is gone and the dates stay; the press, which the store never held, still holds every read.
        expect([...whereOf(store, "P-1").keys()]).toEqual(["start"]);
        expect(whereOf(store, "P-1").get("start")).toEqual(start);
        expect(drawn(container)).toEqual(["r1", "r2", "r3"]);
        expect(tabs(container)[1]).toBe("Backlog 2");
    });
});
