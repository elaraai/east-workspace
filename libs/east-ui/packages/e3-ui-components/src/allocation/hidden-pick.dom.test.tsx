/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The hidden pick over the kiln yard's bins (#1398) on e3 itself: a bin Search
 * Records finds that the rail's narrowing hides on the board — its lane, its
 * resource or its arrival narrowed out — is named by the choices that hide
 * it, each as the rail words it, asked of e3 through the record of each source
 * that hides it: one request a choice for the rows the bins the box lists
 * stand on, and none again at the same revision and narrowing; and `hidden by
 * the filters` until e3 has said. A pick of it clears just those choices —
 * every choice of a source that hides it while e3 has not said — the rail's
 * other choices kept, and goes to the bin on its day, selected once the
 * narrowing they leave draws it. On the Timeline, whose lanes draw a bin
 * whatever its resources' narrowing, no choice of the kilns hides one.
 */
import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StringType, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceStateType, RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, allocationHarness, settle, slot, type Example } from "./harness.test-utils.js";

const h = allocationHarness();
/** The bays' record, as its dataset's requests name it. */
const BAYS = "records.yard_bays";

type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];
const printString = printFor(StringType);
const whereEqual = equalFor(RecordSliceWhereType);
const decodeState = decodeBeast2For(RecordSliceStateType);
const encodeState = encodeBeast2For(RecordSliceStateType);
/** One field's values chosen, as the rail's chip chooses them. */
const chosen = (field: string, ...values: string[]): Where => new Map([[field, variant("values", values.map(v => printString(v)))]]);

/** An example mounted over a store of its own, where each source's state is kept. */
async function open(example: Example) {
    const store = new UIStore();
    StateRuntime.initializeStore(store);
    const r = await h.mount(example);
    return { c: r.container, store };
}
/** A source's narrowing written as the rail writes it, under the slot the slice names it by. */
async function narrow(store: UIStore, example: string, source: "bays" | "kilns" | "arrivals", where: Where) {
    const key = `ex.${example}.${source}`;
    await act(async () => { store.write(key, encodeState({ ...decodeState(store.read(key)!), preset: none, where })); });
    await settle();
}
/** A source's narrowing, as the store holds it. */
const whereOf = (store: UIStore, example: string, source: string) => decodeState(store.read(`ex.${example}.${source}`)!).where;

/** Search Records' box, in the toolbar's row. */
const searchBox = (c: HTMLElement) => slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
async function typeIntoSearch(c: HTMLElement, typed: string) {
    const input = searchBox(c).querySelector<HTMLInputElement>("input")!;
    for (const key of typed) {
        const now = input.value + key;
        await userEvent.type(input, key);
        await waitFor(() => expect(input.value).toBe(now));
    }
}
/** The box's list — the listbox its input controls — its lines as they read. */
const lines = (c: HTMLElement) => {
    const list = document.getElementById(searchBox(c).querySelector("input")!.getAttribute("aria-controls") ?? "");
    return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map(option => option.textContent);
};
/** Enter in the box: it picks the first match. */
async function enter(c: HTMLElement) {
    await act(async () => { fireEvent.keyDown(searchBox(c).querySelector("input")!, { key: "Enter" }); });
    await settle();
}
const tableRow = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row="${key}"]`);
const card = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-card="${key}"]`);
/** A membership read's body: the index whose runs it asks of, and the entry keys `(ik=…, k=…)` it asks. */
const withinOf = (request: E3Request) => JSON.parse(new TextDecoder().decode(request.body)) as { index: string; keys: string[] };
/** The row an entry key names: its record key. */
const rowOf = (entry: string) => /k="([^"]+)"\)$/.exec(entry)![1];

/** Tue 4 May's bins, as the box lists a query of `300`: 3001 and 3004 stand in B-1, 3002 in B-2, 3003 in B-3 — the south yard's one bay. */
const LINE = {
    3001: "3001 · LD-2201 · B-1 06:15 · Tue, May 4, 2027",
    3002: "3002 · LD-2205 · B-2 06:35 · Tue, May 4, 2027",
    3003: "3003 · LD-2213 · B-3 08:55 · Tue, May 4, 2027",
    3004: "3004 · LD-2215 · B-1 10:15 · Tue, May 4, 2027",
} as const;
const BY_SOUTH = "hidden by Area: South — picking it clears that filter";

test("Search Records names the choice that hides a bin as the rail words it — its lane's, Area: South — asked of e3 through the bays' index: one request for the lanes the listed bins stand on, and none again", async () => {
    const { c, store } = await open(ex.allocationTable);
    await narrow(store, "allocationTable", "bays", chosen("area", "South"));
    const before = h.requests("within", BAYS).length;
    await typeIntoSearch(c, "300");
    await waitFor(() => expect(lines(c)).toEqual([`${LINE[3001]} · ${BY_SOUTH}`, `${LINE[3002]} · ${BY_SOUTH}`, LINE[3003], `${LINE[3004]} · ${BY_SOUTH}`]), { timeout: 10_000 });
    await settle();
    // Area alone, through the bays' index by area: one request, asking of B-1 and B-2 — the lanes the hidden bins stand on.
    const reads = h.requests("within", BAYS).slice(before).map(withinOf);
    expect(reads.map(read => read.index)).toEqual(["yard_bays_by_area"]);
    expect(reads[0]!.keys.map(rowOf).sort()).toEqual(["B-1", "B-2"]);
    // Listed again, the same rows: named at once, nothing asked again.
    await act(async () => { fireEvent.click(searchBox(c).querySelector("button[aria-label='Clear search']")!); });
    await typeIntoSearch(c, "3004");
    await waitFor(() => expect(lines(c)).toEqual([`${LINE[3004]} · ${BY_SOUTH}`]), { timeout: 10_000 });
    await settle();
    expect(h.requests("within", BAYS).length).toBe(before + 1);
});

test("a bin hidden by its resource is named by the kilns' choice, and by its arrival by the arrivals'; hidden by several sources, by each one's, in the rail's order", async () => {
    const { c, store } = await open(ex.allocationTable);
    // 3001's kiln is K-209, in Hall B; its load LD-2201 is spec MC14.
    await narrow(store, "allocationTable", "kilns", chosen("group", "Compact"));
    await typeIntoSearch(c, "3001");
    await waitFor(() => expect(lines(c)).toEqual([`${LINE[3001]} · hidden by Kiln group: Compact — picking it clears that filter`]), { timeout: 10_000 });
    await narrow(store, "allocationTable", "kilns", new Map());
    await narrow(store, "allocationTable", "arrivals", chosen("spec", "MC12"));
    await waitFor(() => expect(lines(c)).toEqual([`${LINE[3001]} · hidden by Spec: MC12 — picking it clears that filter`]), { timeout: 10_000 });
    await narrow(store, "allocationTable", "bays", chosen("area", "South"));
    await waitFor(() => expect(lines(c)).toEqual([`${LINE[3001]} · hidden by Area: South; Spec: MC12 — picking it clears those filters`]), { timeout: 10_000 });
});

test("a pick of a bin the narrowing hides clears just the choice that hides it, the rail's others kept, and goes to the bin on its day — drawn in the Table at its time, and selected", async () => {
    const { c, store } = await open(ex.allocationTable);
    // The south yard's bays, and the loads of spec MC14: 3001 stands in B-1, its load spec MC14.
    await narrow(store, "allocationTable", "bays", chosen("area", "South"));
    await narrow(store, "allocationTable", "arrivals", chosen("spec", "MC14"));
    await typeIntoSearch(c, "3001");
    await waitFor(() => expect(lines(c)).toEqual([`${LINE[3001]} · ${BY_SOUTH}`]), { timeout: 10_000 });
    await enter(c);
    await waitFor(() => expect(tableRow(c, "bin:3001")?.hasAttribute("data-selected")).toBe(true), { timeout: 10_000 });
    expect(whereOf(store, "allocationTable", "bays").size).toBe(0);
    expect(whereEqual(whereOf(store, "allocationTable", "arrivals"), chosen("spec", "MC14"))).toBe(true);
    expect(tableRow(c, "bin:3001")!.textContent).toContain("06:15");
});

test("until e3 has said which choices hide a bin, its line says the filters do, and a pick of it clears every choice of the source that hides it — the others kept", async () => {
    const { c, store } = await open(ex.allocationTable);
    await narrow(store, "allocationTable", "bays", chosen("area", "South"));
    await narrow(store, "allocationTable", "arrivals", chosen("spec", "MC14"));
    // Which of the bays' choices hide B-1, held on the wire.
    const asking = h.e3.hold(request => request.kind === "within" && request.dataset === BAYS);
    await typeIntoSearch(c, "3001");
    await waitFor(() => expect(asking.held).toBeGreaterThan(0), { timeout: 10_000 });
    await waitFor(() => expect(lines(c)).toEqual([`${LINE[3001]} · hidden by the filters`]), { timeout: 10_000 });
    await enter(c);
    await waitFor(() => expect(tableRow(c, "bin:3001")?.hasAttribute("data-selected")).toBe(true), { timeout: 10_000 });
    expect(whereOf(store, "allocationTable", "bays").size).toBe(0);
    expect(whereEqual(whereOf(store, "allocationTable", "arrivals"), chosen("spec", "MC14"))).toBe(true);
    await act(async () => { asking.release(); });
    await settle();
});

test("on the Timeline, whose lanes draw a bin whatever its resources' narrowing, a choice of the kilns hides no bin: its line names none, and a pick selects it where it is", async () => {
    const { c, store } = await open(ex.allocationKilnYard);
    // 3101 stands in B-3 on Tue 11 May, the day shown; its kiln K-209 is in Hall B.
    await narrow(store, "allocationKilnYard", "kilns", chosen("group", "Compact"));
    await typeIntoSearch(c, "3101");
    await waitFor(() => expect(lines(c)).toEqual(["3101 · LD-2201 · B-3 01:55 · Tue, May 11, 2027"]), { timeout: 10_000 });
    await enter(c);
    await waitFor(() => expect(card(c, "3101")?.getAttribute("aria-pressed")).toBe("true"), { timeout: 10_000 });
    expect(whereEqual(whereOf(store, "allocationKilnYard", "kilns"), chosen("group", "Compact"))).toBe(true);
});
