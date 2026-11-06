/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart reads its records complete (#1502, `Flowchart Records Spec.md`
 * R5), on e3 itself, over the depot's flowchart (`flowchartDepot`): its states
 * and its transitions read through their sources of the rail, its lanes and
 * its decisions read whole.
 *
 * - **Read complete**: a kind read through its source is read page by page
 *   until done, four pages in flight at most, never by a complete read of its
 *   record — 2,000 states another session commits, narrowed by the rail, all
 *   drawn — and a kind read whole is read once.
 * - **The cold load**: the first read is the frame's, its skeleton over it,
 *   nothing drawn until the states land.
 * - **A new narrowing** keeps what the canvas drew, main busy, while the
 *   footer's loading line says what is read: `Updating states…`.
 * - **A delayed read** — another session's commit, read again — is `Loading
 *   states…` once the reveal's delay has passed, the canvas drawn as it was.
 * - **A failing read** is said once, in a box at the canvas's top-left with
 *   Retry, and in the footer's line, its reason the line's title; Retry, the
 *   fault gone, reads again, and both go.
 *
 * A test commits the depot's states as another session would (`h.patch`) and
 * narrows them as the rail does, through the states' source in the UI store.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import { SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { slot } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, flowchartHarness, settle } from "./flowchart.test-utils.js";

const h = flowchartHarness();

const compareString = compareFor(StringType);
const printText = printFor(StringType);

/** The depot's states' record, as its datasets' requests name it. */
const STATES = `records.${ex.depotStates.name}`;

/** The rail's source for the states, in the UI store: `Slice.bindRecords("flowchart.depot", { states, … })`. */
const STATES_KEY = "flowchart.depot.states";

/** The depot's five lanes, by key. */
const LANES = ["intake", "induct", "sort", "hold", "dispatch"] as const;

/** 2,000 states of a flow of their own, `Bulk`: keyed B0001 to B2000, spread over the five lanes, each lane's in their keys' order. */
const BULK: [string, ValueTypeOf<typeof ex.DepotState>][] = Array.from({ length: 2000 }, (_x, i) => [
    `B${`${i + 1}`.padStart(4, "0")}`,
    { name: `Bay ${i + 1}`, phase: LANES[i % LANES.length]!, seq: Math.floor(i / LANES.length) + 1, slots: none, flow: "Bulk" },
]);

/** The pages of the states' narrowing: read through their source, by the flow's index. */
const statesPages = (request: E3Request): boolean =>
    request.kind === "page" && request.dataset === STATES && request.query.get("index") === "flowchart_states_by_flow";

/** Every state drawn, by its key, in East's order of keys. */
const stateKeys = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("[data-flowchart-node]")].map((el) => el.getAttribute("data-flowchart-node")!).sort(compareString);

/** A state's card. */
const node = (container: HTMLElement, key: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`);

/** The canvas's box, which holds what it says over the drawing. */
const bodyOf = (container: HTMLElement): HTMLElement => slot(container, "main").querySelector<HTMLElement>("[data-flowchart-body]")!;

/** The footer's loading line. */
const lineOf = (container: HTMLElement): HTMLElement => slot(container, "footer").querySelector<HTMLElement>("[data-footer-line]")!;

/** The line's words. */
const lineText = (container: HTMLElement): string | null | undefined => lineOf(container).querySelector("[data-line-text]")?.textContent;

/** The frame. */
const frameOf = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>("[data-builder-frame]")!;

/**
 * Mounts the depot's flowchart and waits until it is at rest: the parcels' states drawn, and its reads done — the
 * footer's line idle. The reader hands the frame what it read in a task of its own, after the last request is answered.
 *
 * @returns The render
 */
async function open(): Promise<RenderResult> {
    const ui = await h.mountExample(ex.flowchartDepot);
    await settle();
    await waitFor(() => expect(node(ui.container, "ARV")).not.toBeNull());
    await waitFor(() => expect(lineOf(ui.container).hasAttribute("data-idle")).toBe(true));
    await settle();
    return ui;
}

/**
 * Narrows the states to one flow, as the rail does: its source's state written in the UI store.
 *
 * @param flow - The flow the states' narrowing keeps
 */
async function narrow(flow: string): Promise<void> {
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(STATES_KEY)!);
    const where = new SortedMap([["flow", variant("values", [printText(flow)])]], compareString);
    await act(async () => { store.write(STATES_KEY, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

/**
 * Another session's commit of the states: one state's label changed, every other row as it was.
 *
 * @param key - The state
 * @param name - Its new label
 */
async function relabel(key: string, name: string): Promise<void> {
    const states = await h.read(ex.depotStates);
    await h.patch(ex.depotStates, new Map([...states, [key, { ...states.get(key)!, name }]]));
}

test("a 2,000-state record narrowed by the rail is read complete and drawn whole: page by page through the states' source, four pages in flight at most, and never read whole (#1502, R5)", async () => {
    const { container } = await open();
    // Another session commits 2,000 states of a flow of their own: the rail keeps the parcels', so none of them is read.
    await h.patch(ex.depotStates, new Map([...await h.read(ex.depotStates), ...BULK]));
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
    expect(node(container, "B0001")).toBeNull();
    // The rail narrows the states to that flow, each page held on its way to e3 and let go one at a time.
    const pages = h.e3.hold(statesPages);
    const from = h.requests().length;
    await narrow("Bulk");
    await pages.holding;
    await settle();
    let most = pages.held;
    while (pages.held > 0) {
        await act(async () => { pages.releaseOne(); });
        await settle();
        most = Math.max(most, pages.held);
    }
    pages.release();
    // Pages asked together, never more than four in flight.
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);
    // Drawn whole: every one of the 2,000, and none of the parcels' — their transitions hidden with their ends.
    await waitFor(() => expect(stateKeys(container)).toHaveLength(BULK.length));
    expect(stateKeys(container)).toEqual(BULK.map(([key]) => key).sort(compareString));
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
    // The request log: the narrowing's pages, from its first row to its last with no gap and no overlap, more than one.
    const read = h.requests().slice(from).filter(statesPages).map((request) => ({ offset: Number(request.query.get("offset")), limit: Number(request.query.get("limit")) }));
    expect(read.length).toBeGreaterThan(1);
    const ends = read.sort((a, b) => a.offset - b.offset).reduce((at, page) => {
        expect(page.offset).toBe(at);
        return page.offset + page.limit;
    }, 0);
    expect(ends).toBe(BULK.length);
    // And no complete read of the states' record, from the mount on; the lanes and the decisions, read whole, each once.
    expect(h.requests("read", STATES)).toEqual([]);
    expect(h.requests("read", `records.${ex.depotLanes.name}`)).toHaveLength(1);
    expect(h.requests("read", `records.${ex.depotDecisions.name}`)).toHaveLength(1);
});

test("the first read is the frame's cold load: its skeleton covers it, and nothing is drawn — no state, no lane — until the states' pages land (#1502, R5)", async () => {
    const pages = h.e3.hold(statesPages);
    const { container } = await h.mountExample(ex.flowchartDepot);
    await pages.holding;
    await settle();
    const frame = frameOf(container);
    expect(frame.hasAttribute("data-loading")).toBe(true);
    expect(frame.querySelector("[data-builder-loading][role='status']")).not.toBeNull();
    // The frame's body under the cover, out of reach and unheard; and main not busy there.
    const body = slot(container, "body");
    expect([body.hasAttribute("inert"), body.getAttribute("aria-hidden"), slot(container, "main").getAttribute("aria-busy")]).toEqual([true, "true", "false"]);
    // Nothing drawn, never as empty: no state, no lane, not the empty records' "+ LANE".
    expect([stateKeys(container), container.querySelectorAll("[data-flowchart-lane]").length, container.querySelector("[data-flowchart-addlane]")]).toEqual([[], 0, null]);
    await act(async () => { pages.release(); });
    await settle();
    await waitFor(() => expect(node(container, "ARV")).not.toBeNull());
    await waitFor(() => expect(frame.hasAttribute("data-loading")).toBe(false));
    expect(frame.querySelector("[data-builder-loading]")).toBeNull();
    expect(container.querySelectorAll("[data-flowchart-lane]")).toHaveLength(LANES.length);
});

test("a new narrowing keeps what the canvas drew, main busy, while the footer's loading line says `Updating states…`; its states drawn once they land (#1502, R5)", async () => {
    const { container } = await open();
    const pages = h.e3.hold(statesPages);
    await narrow("Returns");
    await pages.holding;
    await waitFor(() => expect(lineText(container)).toBe("Updating states…"));
    // The parcels' states stand in, drawn as they were, while the returns' are read.
    expect([node(container, "ARV") !== null, node(container, "RCV")]).toEqual([true, null]);
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("true");
    expect(frameOf(container).hasAttribute("data-loading")).toBe(false);
    await act(async () => { pages.release(); });
    await settle();
    await waitFor(() => expect(stateKeys(container)).toEqual(["INS", "RCV", "RSD"]));
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
});

test("a delayed read — another session's commit, read again — is `Loading states…` once the reveal's delay has passed, main busy, the canvas drawn as it was until the pages land (#1502, R5)", async () => {
    const { container } = await open();
    const pages = h.e3.hold(statesPages);
    await relabel("SCN", "Scanned twice");
    await pages.holding;
    await waitFor(() => expect(lineText(container)).toBe("Loading states…"));
    expect(lineOf(container).getAttribute("data-loading-line")).toBe("loading");
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("true");
    // The state drawn as it was read: its label the one before the commit.
    expect(node(container, "SCN")!.textContent).toContain("Scanned");
    expect(node(container, "SCN")!.textContent).not.toContain("Scanned twice");
    await act(async () => { pages.release(); });
    await settle();
    await waitFor(() => expect(node(container, "SCN")!.textContent).toContain("Scanned twice"));
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
});

test("a failing read is said once — in a box at the canvas's top-left with Retry, and in the footer's line, its reason the line's title — the canvas keeping what it drew; Retry, the fault gone, reads again and both go (#1502, R5)", async () => {
    const { container } = await open();
    const stop = h.e3.fail(statesPages, { status: 500, type: "internal", message: "the store is down" });
    await relabel("SCN", "Scanned twice");
    await waitFor(() => expect(lineOf(container).hasAttribute("data-failed")).toBe(true), { timeout: 15_000 });
    expect(lineText(container)).toBe("Couldn't read states");
    expect(lineOf(container).getAttribute("title")).toContain("the store is down");
    // On the canvas, at its top-left, inside its box: in view however the drawing is scrolled.
    const box = bodyOf(container).querySelector<HTMLElement>(":scope > [data-loading-failed-box]")!;
    expect([box.querySelector("[data-loading-failed-message]")!.textContent, box.style.top, box.style.left]).toEqual(["Couldn't read states", "16px", "16px"]);
    expect(box.querySelector("[data-loading-retry]")).not.toBeNull();
    // Said once: no banner says it too; and the states drawn stay as they were read.
    expect(container.querySelector("[data-flowchart-banner]")).toBeNull();
    expect(node(container, "SCN")!.textContent).not.toContain("Scanned twice");
    expect(node(container, "ARV")).not.toBeNull();
    stop();
    const before = h.requests().filter(statesPages).length;
    await act(async () => { fireEvent.click(box.querySelector("[data-loading-retry]")!); });
    await settle();
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true), { timeout: 15_000 });
    expect(h.requests().filter(statesPages).length).toBeGreaterThan(before);
    expect(bodyOf(container).querySelector("[data-loading-failed-box]")).toBeNull();
    expect(node(container, "SCN")!.textContent).toContain("Scanned twice");
});
