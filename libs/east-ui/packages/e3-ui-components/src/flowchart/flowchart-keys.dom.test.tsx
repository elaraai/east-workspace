/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart over records keyed by number (#1549), on e3 itself: a bakery's
 * line (`flowchart-keys.fixtures.ts`) — its stations, its steps and its moves
 * each keyed by number. Every key travels as its text; the renderer orders and
 * seeks the keys at their type, never by their texts, which would put 10
 * before 2.
 *
 * - **The order**: the stations stand 2, 9, 10, and the bench's steps — none
 *   with an order of its own — Weigh, Proof and Mix, 2, 9, 10.
 * - **Issues** lists the moves each leaving a step for one no step is
 *   numbered by their numbers: 2, 9, then 10.
 * - **Find state** reads what is typed as a number: `10` finds step 10 and
 *   `2..11` the steps from 2 up to 11, in their numbers' order — among the
 *   steps drawn where they are read whole, and in their record through e3
 *   where the rail reads them — and a name is no number, which the box says.
 * - **A new row's key** is as its kind's key type makes it, each Saved under
 *   it: by number, one past the largest — + LANE, Duplicate and Connect; built
 *   by the kind's `key` — Connect's move under its ends, + STATE's step under
 *   its station and name, a row moving as an edit changes what its key reads,
 *   and a key another row holds refusing the gesture, naming that row; by
 *   DateTime, a placeholder — Save waiting, Issues listing it at its key field,
 *   no row named in its place — until the viewer types its key in the
 *   inspector; and by Blob, which no form types, none: + LANE, + STATE,
 *   Duplicate and the Steps' cards off, each saying why.
 */

import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BlobType, DateTimeType, FloatType, IntegerType, SortedMap, StringType, compareFor, equalFor, printFor, type BlockBuilder } from "@elaraai/east";
import { Slice, type UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Data, Flowchart, Record } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/flowchart/flowchart-keys";
import { slot } from "../e3-web-mount.test-utils.js";
import { act, enabled, flowchartHarness, press, settle, type FlowchartTestProps } from "./flowchart.test-utils.js";
import { measureLibrary } from "./library-measure.test-utils.js";
import { DEFAULT_FLOWCHART_NOUNS, flowchartMessages, flowchartMessagesOf } from "./messages.js";

const h = flowchartHarness({ "flowchart/flowchart-keys.fixtures": fx });
// The trays' Steps tab lays its cards out: each Library alone measured, the canvas as jsdom has it.
measureLibrary();

const m = flowchartMessages;
const SAVE = editingMessages.apply();
const compareFloat = compareFor(FloatType);
const compareText = compareFor(StringType);
const keyEqual = equalFor(StringType);

/** The steps' record, as its dataset's requests name it. */
const STEPS = `records.${fx.keyedSteps.name}`;

/** The line read whole: its stations, its steps and its moves. */
const whole = ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
    const steps = $.let(Data.bind(fx.keyedSteps));
    const moves = $.let(Data.bind(fx.keyedMoves));
    const stations = $.let(Data.bind(fx.keyedStations));
    return {
        states: Flowchart.states(steps, { label: "name", lane: "station" }),
        transitions: Flowchart.transitions(moves, { from: "from", to: "to" }),
        lanes: Flowchart.lanes(stations, { label: "label" }),
    };
};

/** The line, its steps read through their source of the rail. */
const railed = ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
    const slice = $.let(Slice.bindRecords("flowchart.keyed", {
        states: { source: Data.bindPaged(fx.keyedSteps, { indexes: ["flowchart_keyed_steps_by_station"] }) },
    }));
    const steps = $.let(Data.bindPaged(fx.keyedSteps));
    const stations = $.let(Data.bind(fx.keyedStations));
    return {
        slice: { slice },
        states: Flowchart.states(steps, { label: "name", lane: "station" }),
        lanes: Flowchart.lanes(stations, { label: "label" }),
    };
};

/** A step's card, by its key's text — a struct's printing quotes its strings, so it is matched, never written into a selector. */
const node = (c: HTMLElement, key: string): HTMLElement | null =>
    [...c.querySelectorAll<HTMLElement>("[data-flowchart-node]")].find((el) => keyEqual(el.getAttribute("data-flowchart-node") ?? "", key)) ?? null;

/** The lanes the canvas draws a header for, by key, in its order. */
const laneKeys = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-lane-head]")].map((el) => el.getAttribute("data-flowchart-lane-head"));

/** Where the canvas places a card. */
const placeOf = (card: HTMLElement): { readonly top: number; readonly left: number } => ({ top: parseFloat(card.style.top), left: parseFloat(card.style.left) });

/** Some cards of one lane, by key, in the order they stand along it: by where the canvas places each. */
const standing = (c: HTMLElement, keys: readonly string[]): string[] => keys.map((key) => ({ key, at: placeOf(node(c, key)!) }))
    .sort((a, b) => compareFloat(a.at.top, b.at.top) || compareFloat(a.at.left, b.at.left))
    .map(({ key }) => key);

/** The inspector's open tab. */
const panel = (c: HTMLElement): HTMLElement => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;

/** Issues, each as it reads: what it names, and what it says. */
const issues = (c: HTMLElement): (string | null)[][] => [...panel(c).querySelectorAll("[data-inspector-issue]")]
    .map((el) => [el.querySelector("span:first-child")?.textContent ?? null, el.querySelector("[data-kind]")?.textContent ?? null]);

/** Find's lines, as they read. */
const lines = (): (string | null)[] => screen.getAllByRole("option").map((option) => option.textContent);

/** Mounts a line and waits until the canvas draws a step: step 10 unless given. */
async function open(props: ($: BlockBuilder<UIComponentType>) => FlowchartTestProps, first = "10"): Promise<HTMLElement> {
    const { container } = await h.mountFlowchart(props);
    await waitFor(() => expect(node(container, first)).not.toBeNull());
    await settle();
    return container;
}

test("the stations stand by their numbers — 2, 9, 10 — and the bench's steps, none with an order of its own, Weigh, Proof and Mix by theirs (#1549)", async () => {
    const c = await open(whole);
    expect(laneKeys(c)).toEqual(["2", "9", "10"]);
    expect(standing(c, ["10", "2", "9"])).toEqual(["2", "9", "10"]);
});

test("Issues lists the moves each leaving a step for one no step is numbered, by their numbers: 2, 9, then 10 (#1549)", async () => {
    const c = await open(whole);
    const tab = [...slot(c, "end").querySelectorAll("[role='tab']")].find((each) => each.textContent?.startsWith(m.inspectorTab({ tab: "issues" })));
    if (tab === undefined) throw new Error("the inspector holds no Issues tab");
    await act(async () => { fireEvent.click(tab); });
    await settle();
    expect(issues(c)).toEqual([["2", "77"], ["9", "78"], ["10", "79"]].map(([from, to]) => {
        const link = `${from!} → ${to!}`;
        return [m.issueWhere({ kind: "Transition", name: link }), m.issueText({ issue: "end", link, missing: [to!] })];
    }));
});

test("read whole, Find state reads what is typed as a number among the steps drawn: `10` finds step 10, `2..11` the steps from 2 up to 11 in their numbers' order, and a name is no number (#1549)", async () => {
    const c = await open(whole);
    // The box says what it reads a key as.
    const box = within(c).getByPlaceholderText<HTMLInputElement>("Find state (Integer)");
    await userEvent.click(box);
    fireEvent.change(box, { target: { value: "10" } });
    await waitFor(() => expect(within(c).getByText("1 match")).toBeTruthy());
    expect(lines()).toEqual(["10 · Mix"]);
    fireEvent.change(box, { target: { value: "2..11" } });
    await waitFor(() => expect(within(c).getByText("3 matches")).toBeTruthy());
    expect(lines()).toEqual(["2 · Weigh", "9 · Proof", "10 · Mix"]);
    // A pick selects the step, and the box shows its number.
    fireEvent.click(screen.getByRole("option", { name: "9 · Proof" }));
    await waitFor(() => expect(node(c, "9")!.hasAttribute("data-selected")).toBe(true));
    await waitFor(() => expect(box.value).toBe("9"));
    // A name is no step's number: the box says what a key is.
    fireEvent.change(box, { target: { value: "Mix" } });
    await waitFor(() => expect(within(c).getAllByText("Key is Integer").length).toBeGreaterThan(0));
});

test("read through the rail, Find state seeks the steps' record through e3 at their numbers: `10` is one step, and `2..11` those from 2 up to 11 (#1549)", async () => {
    const c = await open(railed);
    const before = h.requests("find", STEPS).length;
    const box = within(c).getByPlaceholderText<HTMLInputElement>("Find state (Integer)");
    await userEvent.click(box);
    fireEvent.change(box, { target: { value: "10" } });
    await waitFor(() => expect(lines()).toEqual(["10 · Mix"]), { timeout: 5_000 });
    // Sought in the record through e3.
    expect(h.requests("find", STEPS).length).toBeGreaterThan(before);
    fireEvent.change(box, { target: { value: "2..11" } });
    await waitFor(() => expect(lines()).toEqual(["2 · Weigh", "9 · Proof", "10 · Mix"]), { timeout: 5_000 });
    fireEvent.click(screen.getByRole("option", { name: "10 · Mix" }));
    await waitFor(() => expect(node(c, "10")!.hasAttribute("data-selected")).toBe(true));
});

// ============================================================================
// A new row's key (#1549)
// ============================================================================

/** Fires a gesture's events, and lets the sessions and the renders settle. */
async function gesture(fire: () => void): Promise<void> {
    await act(async () => { fire(); });
    await settle();
}

/** A pointer pressed on an element at a point of the canvas, moved to another, and let go there. */
async function drag(el: Element, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    await act(async () => { fireEvent.pointerDown(el, { pointerId: 1, pointerType: "mouse", button: 0, clientX: from.x, clientY: from.y }); });
    await act(async () => { fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientX: to.x, clientY: to.y }); });
    await act(async () => { fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse", clientX: to.x, clientY: to.y }); });
    await settle();
}

/** A card's centre on the canvas, as its box places it. */
function centre(c: HTMLElement, key: string): { x: number; y: number } {
    const card = node(c, key)!;
    return { x: parseFloat(card.style.left) + parseFloat(card.style.width) / 2, y: parseFloat(card.style.top) + parseFloat(card.style.height) / 2 };
}

/** A handle's hit target on a step's side. */
const handle = (c: HTMLElement, key: string, side: "left" | "right"): Element =>
    [...c.querySelectorAll("[data-flowchart-ports]")].find((el) => keyEqual(el.getAttribute("data-flowchart-ports") ?? "", key))!
        .querySelector(`[data-flowchart-handle="${side}"]`)!;

/** The moves the canvas draws a line for, by key, in East's order of their texts. */
const linkKeys = (c: HTMLElement): string[] => [...c.querySelectorAll("[data-flowchart-link]")].map((el) => el.getAttribute("data-flowchart-link") ?? "").sort(compareText);

/** A move's line, by its key's text. */
const link = (c: HTMLElement, key: string): HTMLElement | undefined =>
    [...c.querySelectorAll<HTMLElement>("[data-flowchart-link]")].find((el) => keyEqual(el.getAttribute("data-flowchart-link") ?? "", key));

/** What waits on Save, as the footer counts it. */
const pending = (c: HTMLElement): string | null => c.querySelector("[data-flowchart-pending]")?.textContent ?? null;
const pendingText = (n: number): string => ` · ${m.footerPending({ n, count: String(n) })}`;

/** What the footer says of a gesture refused. */
const footer = (c: HTMLElement): string => c.querySelector("[data-flowchart-message]")?.textContent ?? "";

/** Details' head: what it shows. */
const what = (c: HTMLElement): string | null => panel(c).querySelector("[data-inspector-what]")?.textContent ?? null;

/** A field of Details, by its key. */
const field = (c: HTMLElement, key: string): HTMLElement => panel(c).querySelector<HTMLElement>(`[data-field="${key}"]`)!;

/** Opens one of the inspector's tabs, by its name. */
async function openTab(c: HTMLElement, name: string): Promise<void> {
    const tab = [...slot(c, "end").querySelectorAll("[role='tab']")].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `) === true);
    if (tab === undefined) throw new Error(`no inspector tab ${name}`);
    await gesture(() => { fireEvent.click(tab); });
}

/** Picks a row in a select of Details, by its field and its words. */
async function choose(c: HTMLElement, key: string, name: string): Promise<void> {
    const trigger = field(c, key).querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await act(async () => { fireEvent.click(trigger); });
    const listbox = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    await gesture(() => { fireEvent.click(within(listbox).getByRole("option", { name })); });
}

/** Presses Save, and gives the records it wrote, each a request of its own, by name, in East's order. */
async function save(): Promise<string[]> {
    const from = h.requests("mutate").length;
    await press(SAVE);
    return h.requests("mutate").slice(from).map((request) => request.record ?? "").sort(compareText);
}

/** "+ LANE" clicked. */
async function addLane(c: HTMLElement): Promise<void> {
    await gesture(() => { fireEvent.click(c.querySelector("[data-flowchart-addlane]")!); });
}

/** A lane's "+ STATE" ghost clicked into its editor, which asks a label alone — the key is the kind's to make — and ⏎. */
async function addStateNamed(c: HTMLElement, lane: string, label: string): Promise<void> {
    const band = [...c.querySelectorAll("[data-flowchart-band]")].find((el) => keyEqual(el.getAttribute("data-flowchart-band") ?? "", lane))!;
    await gesture(() => { fireEvent.pointerEnter(band); });
    const ghost = [...c.querySelectorAll("[data-flowchart-ghoststate]")].find((el) => keyEqual(el.getAttribute("data-flowchart-ghoststate") ?? "", lane))!;
    await gesture(() => { fireEvent.click(ghost); });
    const editor = c.querySelector("[data-flowchart-stateeditor]")!;
    expect(editor.querySelector("[data-flowchart-key]"), "the editor asks no key").toBeNull();
    const input = editor.querySelector<HTMLInputElement>("[data-flowchart-label]")!;
    await gesture(() => { fireEvent.change(input, { target: { value: label } }); });
    await gesture(() => { fireEvent.keyDown(input, { key: "Enter" }); });
}

/** A step double-clicked into its editor, a label typed, and ⏎. */
async function renameStep(c: HTMLElement, key: string, label: string): Promise<void> {
    await gesture(() => { fireEvent.doubleClick(node(c, key)!); });
    const input = c.querySelector<HTMLInputElement>("[data-flowchart-stateeditor] [data-flowchart-label]")!;
    await gesture(() => { fireEvent.change(input, { target: { value: label } }); });
    await gesture(() => { fireEvent.keyDown(input, { key: "Enter" }); });
}

/**
 * A record's rows with some set, in its keys' order.
 *
 * @param rows - The rows, as e3 holds them
 * @param compare - The order of the record's keys
 * @param set - The rows set, each its key and its row
 * @returns The rows
 */
function withRows<K, V>(rows: ReadonlyMap<K, V>, compare: (a: K, b: K) => number, set: readonly (readonly [K, V])[]): SortedMap<K, V> {
    const out = new SortedMap<K, V>(rows, compare);
    for (const [key, row] of set) out.set(key, row);
    return out;
}

describe("a new row's key, as its kind's key type makes it (#1549)", () => {
    test("keyed by number, + LANE, Duplicate and Connect each key the row one past its kind's largest — station 11, step 12, move 11 — and Save writes each under it", async () => {
        const stations = await h.read(fx.keyedStations), steps = await h.read(fx.keyedSteps), moves = await h.read(fx.keyedMoves);
        const c = await open(($) => {
            const stepsBound = $.let(Record.bind(fx.keyedSteps));
            const movesBound = $.let(Record.bind(fx.keyedMoves));
            const stationsBound = $.let(Record.bind(fx.keyedStations));
            return {
                states: Flowchart.states(stepsBound, { label: "name", lane: "station" }),
                transitions: Flowchart.transitions(movesBound, { from: "from", to: "to" }),
                lanes: Flowchart.lanes(stationsBound, { label: "label" }),
            };
        });
        await addLane(c);
        expect(laneKeys(c)).toEqual(["2", "9", "10", "11"]);
        await gesture(() => { fireEvent.click(node(c, "9")!); });
        await gesture(() => { fireEvent.click(panel(c).querySelector("[data-inspector-action='duplicate']")!); });
        expect(node(c, "12")?.hasAttribute("data-selected")).toBe(true);
        await drag(handle(c, "2", "right"), centre(c, "2"), centre(c, "11"));
        expect(linkKeys(c)).toContain("11");
        expect(await save()).toEqual([fx.keyedMoves.name, fx.keyedStations.name, fx.keyedSteps.name].sort(compareText));
        const compareNumber = compareFor(IntegerType);
        expect(printFor(fx.keyedStations.type)(await h.read(fx.keyedStations)))
            .toBe(printFor(fx.keyedStations.type)(withRows(stations, compareNumber, [[11n, { label: m.newLane({ n: 4, count: "4" }) }]])));
        expect(printFor(fx.keyedSteps.type)(await h.read(fx.keyedSteps))).toBe(printFor(fx.keyedSteps.type)(withRows(steps, compareNumber, [[12n, { name: "Proof", station: 2n }]])));
        expect(printFor(fx.keyedMoves.type)(await h.read(fx.keyedMoves))).toBe(printFor(fx.keyedMoves.type)(withRows(moves, compareNumber, [[11n, { from: 2n, to: 11n }]])));
    });

    test("keyed by their ends, Connect keys a move as the transitions' `key` builds it; an end changed moves it under its new ends, still selected; one that builds a key a move holds is refused, naming that move; and Save writes each under its key", async () => {
        const moves = await h.read(fx.joinedMoves);
        const ends = printFor(fx.MoveEnds);
        const c = await open(($) => {
            const stepsBound = $.let(Record.bind(fx.keyedSteps));
            const movesBound = $.let(Record.bind(fx.joinedMoves));
            const stationsBound = $.let(Data.bind(fx.keyedStations));
            return {
                states: Flowchart.states(stepsBound, { label: "name", lane: "station" }),
                transitions: Flowchart.transitions(movesBound, { name: "Move", from: "from", to: "to", key: (move) => ({ from: move.from, to: move.to }) }),
                lanes: Flowchart.lanes(stationsBound, { label: "label" }),
            };
        });
        await drag(handle(c, "2", "right"), centre(c, "2"), centre(c, "9"));
        expect(linkKeys(c)).toEqual([ends({ from: 10n, to: 9n }), ends({ from: 2n, to: 9n })].sort(compareText));
        await gesture(() => { fireEvent.click(link(c, ends({ from: 2n, to: 9n }))!); });
        expect(what(c)).toBe("Move · 2 → 9");
        // Its far end changed: the move under its new ends, Details still on it.
        await choose(c, "to", "11 · Bake");
        expect([linkKeys(c), what(c)]).toEqual([[ends({ from: 10n, to: 9n }), ends({ from: 2n, to: 11n })].sort(compareText), "Move · 2 → 11"]);
        // Mix to Proof is a move already: from Mix to Proof is refused, naming it, and the move stays as it was.
        await choose(c, "to", "9 · Proof");
        await choose(c, "from", "10 · Mix");
        const said = flowchartMessagesOf({ ...DEFAULT_FLOWCHART_NOUNS, transition: "Move" });
        expect([footer(c), linkKeys(c), what(c)]).toEqual([
            said.gestureRefused({ refusal: "taken", sort: "transitions", from: "Mix", to: "Proof" }), [ends({ from: 10n, to: 9n }), ends({ from: 2n, to: 9n })].sort(compareText),
            "Move · 2 → 9",
        ]);
        expect(footer(c)).toBe("A move from Mix to Proof is there already");
        await choose(c, "to", "11 · Bake");
        expect(await save()).toEqual([fx.joinedMoves.name]);
        expect(printFor(fx.joinedMoves.type)(await h.read(fx.joinedMoves)))
            .toBe(printFor(fx.joinedMoves.type)(withRows(moves, compareFor(fx.MoveEnds), [[{ from: 2n, to: 11n }, { from: 2n, to: 11n }]])));
    });

    test("keyed by station and name, + STATE keys a step as the states' `key` builds it, its editor asking its name alone; Duplicate, building a key a step holds, is refused, naming it; a rename moves the step under its new name; and Save writes each under its key", async () => {
        const steps = await h.read(fx.placedSteps);
        const place = printFor(fx.StepPlace);
        const c = await open(($) => {
            const stepsBound = $.let(Record.bind(fx.placedSteps));
            const stationsBound = $.let(Data.bind(fx.keyedStations));
            return {
                states: Flowchart.states(stepsBound, { label: "name", lane: "station", key: (step) => ({ station: step.station, name: step.name }) }),
                lanes: Flowchart.lanes(stationsBound, { label: "label" }),
            };
        }, place({ station: 2n, name: "Weigh" }));
        await addStateNamed(c, "2", "Knead");
        expect(node(c, place({ station: 2n, name: "Knead" }))?.hasAttribute("data-selected")).toBe(true);
        await gesture(() => { fireEvent.click(node(c, place({ station: 2n, name: "Weigh" }))!); });
        await gesture(() => { fireEvent.click(panel(c).querySelector("[data-inspector-action='duplicate']")!); });
        expect([footer(c), pending(c)]).toEqual([m.gestureRefused({ refusal: "taken", sort: "states", name: "Weigh" }), pendingText(1)]);
        expect(footer(c)).toBe("A state Weigh is there already");
        await renameStep(c, place({ station: 2n, name: "Mix" }), "Fold");
        expect([node(c, place({ station: 2n, name: "Mix" })), node(c, place({ station: 2n, name: "Fold" })) !== null]).toEqual([null, true]);
        expect(await save()).toEqual([fx.placedSteps.name]);
        const placed = withRows(steps, compareFor(fx.StepPlace), [
            [{ station: 2n, name: "Knead" }, { name: "Knead", station: 2n }], [{ station: 2n, name: "Fold" }, { name: "Fold", station: 2n }],
        ]);
        placed.delete({ station: 2n, name: "Mix" });
        expect(printFor(fx.placedSteps.type)(await h.read(fx.placedSteps))).toBe(printFor(fx.placedSteps.type)(placed));
    });

    test("keyed by DateTime, a new shift and a new batch are held under placeholders — Save waiting, Issues listing each at its key field, and no batch taken into the shift — until each key is typed in the inspector, and Save writes each under it", async () => {
        vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
        vi.setSystemTime(new Date("2026-11-07T08:00:00.000Z"));
        try {
            const shifts = await h.read(fx.timedShifts), batches = await h.read(fx.timedBatches);
            const at = printFor(DateTimeType);
            const early = at(fx.EARLY), eight = new Date("2026-11-07T08:00:00.000Z");
            const said = flowchartMessagesOf({ ...DEFAULT_FLOWCHART_NOUNS, state: "Batch", lane: "Shift" });
            const c = await open(($) => {
                const batchesBound = $.let(Record.bind(fx.timedBatches));
                const shiftsBound = $.let(Record.bind(fx.timedShifts));
                return {
                    states: Flowchart.states(batchesBound, { name: "Batch", label: "name", lane: "shift" }),
                    lanes: Flowchart.lanes(shiftsBound, { name: "Shift", label: "label" }),
                };
            }, at(new Date("2026-11-07T06:30:00.000Z")));
            await addLane(c);
            expect(laneKeys(c)).toEqual([early, "lane-2"]);
            // A batch into the new shift: refused, its key still to be typed.
            const band = [...c.querySelectorAll("[data-flowchart-band]")].find((el) => keyEqual(el.getAttribute("data-flowchart-band") ?? "", "lane-2"))!;
            await gesture(() => { fireEvent.pointerEnter(band); });
            await gesture(() => { fireEvent.click(c.querySelector("[data-flowchart-ghoststate='lane-2']")!); });
            await gesture(() => { fireEvent.change(c.querySelector("[data-flowchart-stateeditor] [data-flowchart-label]")!, { target: { value: "Spelt" } }); });
            await gesture(() => { fireEvent.keyDown(c.querySelector("[data-flowchart-stateeditor] [data-flowchart-label]")!, { key: "Enter" }); });
            expect(footer(c)).toBe(said.gestureRefused({ refusal: "placeholder", sort: "lanes" }));
            expect(footer(c)).toBe("Type the new shift's key first");
            await gesture(() => { fireEvent.keyDown(c.querySelector("[data-flowchart-stateeditor] [data-flowchart-label]")!, { key: "Escape" }); });
            // A batch into the Early shift: under a placeholder of its own.
            await addStateNamed(c, early, "Wheat");
            expect(node(c, "state-2")?.hasAttribute("data-selected")).toBe(true);
            // Save waits; Issues lists each at its key field.
            expect(enabled(SAVE)).toBe(false);
            await openTab(c, "Issues");
            expect([...panel(c).querySelectorAll("[data-inspector-issue]")].map((el) => [el.querySelector("span:first-child")?.textContent, el.querySelector("[data-kind]")?.textContent]))
                .toEqual([
                    [said.issueWhere({ kind: "Batch", name: "state-2" }), said.keyPlaceholder({ sort: "states" })],
                    [said.issueWhere({ kind: "Shift", name: said.newLane({ n: 2, count: "2" }) }), said.keyPlaceholder({ sort: "lanes" })],
                ]);
            // The batch's key typed: Set gives it this minute, and the batch moves under it.
            await gesture(() => { fireEvent.click(panel(c).querySelectorAll("[data-inspector-issue]")[0]!); });
            await openTab(c, "Details");
            expect(field(c, "key").getAttribute("data-editor")).toBe("datetime");
            await gesture(() => { fireEvent.click(field(c, "key").querySelector("[data-field-set]")!); });
            expect([node(c, "state-2"), node(c, at(eight))?.hasAttribute("data-selected")]).toEqual([null, true]);
            // The shift's, likewise.
            await gesture(() => { fireEvent.click(c.querySelector("[data-flowchart-lane='lane-2']")!); });
            await gesture(() => { fireEvent.click(field(c, "key").querySelector("[data-field-set]")!); });
            expect(laneKeys(c)).toEqual([early, at(eight)]);
            expect(enabled(SAVE)).toBe(true);
            expect(await save()).toEqual([fx.timedBatches.name, fx.timedShifts.name].sort(compareText));
            const compareTime = compareFor(DateTimeType);
            expect(printFor(fx.timedShifts.type)(await h.read(fx.timedShifts)))
                .toBe(printFor(fx.timedShifts.type)(withRows(shifts, compareTime, [[eight, { label: said.newLane({ n: 2, count: "2" }) }]])));
            expect(printFor(fx.timedBatches.type)(await h.read(fx.timedBatches)))
                .toBe(printFor(fx.timedBatches.type)(withRows(batches, compareTime, [[eight, { name: "Wheat", shift: fx.EARLY }]])));
        } finally {
            vi.useRealTimers();
        }
    });

    test("keyed by Blob, which no form types, neither kind adds a row: + LANE and + STATE are off, saying why; a tray's Duplicate is off, saying why; and the Steps' cards drag nowhere, each saying why", async () => {
        const tray = printFor(BlobType)(new Uint8Array([7])), rack = printFor(BlobType)(fx.RACK_A);
        const c = await open(($) => {
            const slice = $.let(Slice.bindRecords("flowchart.trays", {
                trayCards: { source: Data.bindPaged(fx.trayCards, { indexes: ["flowchart_tray_cards_by_group"] }) },
            }));
            const traysBound = $.let(Record.bind(fx.taggedTrays));
            const racksBound = $.let(Record.bind(fx.taggedRacks));
            const cards = $.let(Data.bind(fx.trayCards));
            return {
                slice: { slice },
                states: Flowchart.states(traysBound, {
                    name: "Tray", label: "name", lane: "rack",
                    templates: Flowchart.templates(cards.read(), { name: (card) => card.name, values: (card) => card.values, source: "trayCards" }),
                }),
                lanes: Flowchart.lanes(racksBound, { name: "Rack", label: "label" }),
                library: [Flowchart.library.states()],
            };
        }, tray);
        const racks = m.keysUntyped({ name: "rack", type: "Blob" }), trays = m.keysUntyped({ name: "tray", type: "Blob" });
        expect([racks, trays]).toEqual([
            "Racks are keyed by Blob, which can't be typed — give the kind `key` to add them", "Trays are keyed by Blob, which can't be typed — give the kind `key` to add them",
        ]);
        // + LANE: off, its tooltip saying why.
        const add = c.querySelector("[data-flowchart-addlane]")!;
        expect([add.getAttribute("aria-disabled"), add.hasAttribute("data-disabled")]).toEqual(["true", true]);
        await gesture(() => { fireEvent.click(add); });
        expect(laneKeys(c)).toEqual([rack]);
        await act(async () => { fireEvent.pointerMove(add); });
        expect((await screen.findByRole("tooltip")).textContent).toBe(racks);
        // + STATE: off, likewise.
        const band = [...c.querySelectorAll("[data-flowchart-band]")].find((el) => keyEqual(el.getAttribute("data-flowchart-band") ?? "", rack))!;
        await gesture(() => { fireEvent.pointerEnter(band); });
        const ghost = [...c.querySelectorAll("[data-flowchart-ghoststate]")].find((el) => keyEqual(el.getAttribute("data-flowchart-ghoststate") ?? "", rack))!;
        expect(ghost.getAttribute("aria-disabled")).toBe("true");
        await gesture(() => { fireEvent.click(ghost); });
        expect(c.querySelector("[data-flowchart-stateeditor]")).toBeNull();
        // Duplicate: off, the line under it saying why.
        await gesture(() => { fireEvent.click(node(c, tray)!); });
        expect([(panel(c).querySelector("[data-inspector-action='duplicate']") as HTMLButtonElement).disabled, panel(c).querySelector("[data-inspector-why]")?.textContent])
            .toEqual([true, trays]);
        // The Steps' card: no drag, its line saying why — and ⏎ on it drops nothing.
        const card = await waitFor(() => {
            const shown = slot(c, "start").querySelector<HTMLElement>("[data-library-item='sesame']");
            expect(shown).not.toBeNull();
            return shown!;
        });
        expect([card.hasAttribute("data-draggable"), card.textContent?.includes(trays)]).toEqual([false, true]);
        await gesture(() => { fireEvent.keyDown(card, { key: "Enter" }); });
        expect(pending(c)).toBe(pendingText(0));
    });
});
