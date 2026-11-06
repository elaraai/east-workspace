/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What the Flowchart draws of its details (#1510, `Flowchart Records Spec.md`
 * R22, R25–R34, R39), on e3 itself, over the depot's flowchart
 * (`flowchartDepot`): each state's evidence on its card, each transition's
 * under its evidence, and the legend's rows and groups for them — read by the
 * drawn rows' keys; and over the desk's minutes drawn to scale
 * (`flowchartTicketMinutesLinear`).
 *
 * - **A card**: its head — its label and its ×n over its key — then the
 *   reads the details show on the canvas, in the app's order: a figure in the
 *   app's locale with its unit; tag lists beside one label column, each tag in
 *   its definition's look, wrapping, three lines then +n naming the rest; bars
 *   a bin, equal widths on the band axis, each as tall as its count over the
 *   card's tallest, over the axis's ticks; a list's top lines with their
 *   shares. On a linear axis, each bar as wide as its span and as tall as its
 *   count over it — one too thin for the room to the next flush with it, a
 *   pixel at least — the ticks to scale.
 * - **No row, and nothing to show** (R33, R41): a state there is no row of
 *   says *no data* in each read, a tag list with no tags *none*; a transition
 *   with none keeps its evidence alone; an in-place transition draws no label.
 * - **A label's lines** (R32): under its evidence, its region's top line.
 * - **The legend** (R31): a row for each figure, histogram and list drawn,
 *   in the details' order — the states', then the transitions' — and a group
 *   for each tag list it lists, the defined tags the cards show in the order
 *   defined, following what the rail narrows the states to.
 * - **Not landed, or failed** (R34): placeholders where the reads go, on the
 *   cards, the labels and in the inspector, while the footer's line says
 *   `Loading state details…`; a failed read said once, in the box at the
 *   canvas's top-left and in the line, its Retry reading again.
 * - **Selection** (R39): a card and a label selected are marked so, for the
 *   recipe's looks.
 *
 * jsdom lays nothing out and measures no word: the cards' words are the
 * visual spec's estimate, a character at a time, so where a tag list wraps
 * is the estimate's; the responsive invariant measures them in a browser.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import { SortedMap, SortedSet, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { slot } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, flowchartHarness, settle } from "./flowchart.test-utils.js";
import { flowchartMessages } from "./messages.js";

const h = flowchartHarness();

const m = flowchartMessages;
const compareString = compareFor(StringType);
const printText = printFor(StringType);

/** The states' evidence and the transitions', as their datasets' requests name them. */
const STATE_EVIDENCE = `records.${ex.stateEvidence.name}`;
const MOVE_EVIDENCE = `records.${ex.moveEvidence.name}`;

/** A read of a record's rows, as the details read them: by the drawn rows' keys. */
const readOf = (dataset: string) => (request: E3Request): boolean =>
    request.dataset === dataset && (request.kind === "rows" || request.kind === "find" || request.kind === "page");

/** The rail's source for the states, in the UI store: `Slice.bindRecords("flowchart.depot", { states, … })`. */
const STATES_KEY = "flowchart.depot.states";

// ── Reading the flowchart ─────────────────────────────────────────────────

/** A state's card. */
const node = (c: HTMLElement, key: string): HTMLElement | null => c.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`);
/** Its words in a part, by its selector. */
const text = (el: Element, selector: string): string | null => el.querySelector(selector)?.textContent ?? null;
/** The reads a card shows, in order: each its place in the details, and its kind. */
const readsOf = (c: HTMLElement, key: string): [number, string | null][] =>
    [...node(c, key)!.querySelectorAll("[data-card-read]")].map((el) => [Number(el.getAttribute("data-card-read")), el.getAttribute("data-read")]);
/** One read's block on a card, by its place in the details. */
const read = (c: HTMLElement, key: string, index: number): HTMLElement => node(c, key)!.querySelector<HTMLElement>(`[data-card-read="${index}"]`)!;
/** A figure's value: its number and its unit. */
const valueOf = (block: HTMLElement): (string | null)[] => [...block.querySelector("[data-card-value]")?.children ?? []].map((el) => el.textContent);
/** A tag's words and its look; a +n's words, its look and its title. */
const tagOf = (tag: Element): (string | null)[] => tag.hasAttribute("data-flowchart-more")
    ? [tag.textContent, tag.getAttribute("data-look"), tag.getAttribute("title")]
    : [tag.textContent, tag.getAttribute("data-look")];
/** A tag list's lines on a card: each its tags, the last ending in its +n. */
const tagLinesOf = (block: HTMLElement): (string | null)[][][] =>
    [...block.querySelectorAll("[data-tag-line]")].map((line) => [...line.querySelectorAll("[data-flowchart-tag], [data-flowchart-more]")].map(tagOf));
/** What a read says in its values' place: *no data*, *none*. */
const emptyOf = (block: HTMLElement): string | null => text(block, "[data-card-empty]");
/** A transition's label. */
const label = (c: HTMLElement, key: string): SVGGElement | null => c.querySelector<SVGGElement>(`g[data-flowchart-label="${key}"]`);
/** A label's lines under its evidence: each a line of its details, or a placeholder's. */
const labelLines = (c: HTMLElement, key: string): (string | null)[][] | null => {
    const g = label(c, key);
    return g === null ? null : [...g.querySelectorAll("[data-line]")].map((el) => [el.getAttribute("data-line"), el.textContent]);
};
/** A label's evidence line. */
const evidenceOf = (c: HTMLElement, key: string): string | null => label(c, key)?.querySelector("text:not([data-line])")?.textContent ?? null;

/** The canvas's box, which holds what it says over the drawing. */
const bodyOf = (c: HTMLElement): HTMLElement => slot(c, "main").querySelector<HTMLElement>("[data-flowchart-body]")!;
/** The footer's loading line. */
const lineOf = (c: HTMLElement): HTMLElement => slot(c, "footer").querySelector<HTMLElement>("[data-footer-line]")!;
/** The line's words. */
const lineText = (c: HTMLElement): string | null | undefined => lineOf(c).querySelector("[data-line-text]")?.textContent;

/** The inspector's open tab. */
const panel = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-frame-slot='end'] [role='tabpanel']:not([hidden])")!;

/** Clicks an element, as a pointer does, and lets the flowchart settle. */
async function click(el: Element): Promise<void> {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

/**
 * Mounts the depot's flowchart and waits until it is at rest: its states
 * drawn, and every read done — the details' with them, the footer's line idle.
 *
 * @returns The render
 */
async function open(): Promise<RenderResult> {
    const ui = await h.mountExample(ex.flowchartDepot);
    await settle();
    await waitFor(() => expect(node(ui.container, "ARV")).not.toBeNull());
    await waitFor(() => expect(lineOf(ui.container).hasAttribute("data-idle")).toBe(true));
    await waitFor(() => expect(node(ui.container, "CH*")!.querySelector("[data-place]")).toBeNull());
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
 * A record's rows with one row set, or taken out.
 *
 * @param rows - The rows, as e3 holds them
 * @param key - The row's key
 * @param row - Its row; `undefined`, none
 * @returns The rows
 */
function withRow<V>(rows: ReadonlyMap<string, V>, key: string, row: V | undefined): SortedMap<string, V> {
    const out = new SortedMap<string, V>(rows, compareString);
    if (row === undefined) out.delete(key);
    else out.set(key, row);
    return out;
}

// ============================================================================
// A card
// ============================================================================

test("a card draws its head, then the reads its details show on the canvas in the app's order: a figure in the app's locale with its unit; tag lists beside one label column, each tag in its look, wrapping; bars a bin, equal widths, as tall as each count over the card's tallest, over the axis's ticks; a list's top lines and their shares (R22, R25, R26, R28, R29, R30)", async () => {
    const { container: c } = await open();
    const card = node(c, "CH*")!;
    expect([card.hasAttribute("data-details"), text(card, "[data-card-name]"), text(card, "[data-flowchart-members]"), text(card, "[data-card-key]")])
        .toEqual([true, "Sort chutes (class)", "×14", "CH*"]);
    // Still in state and Exceptions are the inspector's: the card shows the rest, in the details' order.
    expect(readsOf(c, "CH*")).toEqual([[0, "figure"], [2, "tags"], [3, "tags"], [4, "tags"], [5, "histogram"], [6, "list"]]);
    // Parcels: its label, then its value in the app's locale with its unit.
    expect([text(read(c, "CH*", 0), "[data-read-label]"), valueOf(read(c, "CH*", 0))]).toEqual(["Parcels", ["18,290", "parcels"]]);
    // The tag lists one after another share a label column; each tag in its definition's look, a list wrapping.
    const columns = [2, 3, 4].map((i) => read(c, "CH*", i).querySelector<HTMLElement>("[data-read-label]")!.style.width);
    expect(parseFloat(columns[0]!)).toBeGreaterThan(0);
    expect(columns).toEqual([columns[0], columns[0], columns[0]]);
    expect([2, 3, 4].map((i) => [text(read(c, "CH*", i), "[data-read-label]"), tagLinesOf(read(c, "CH*", i))])).toEqual([
        ["Flags", [[["At risk", "wash"]]]],
        ["Equipment", [[["Conveyor", "wash"], ["Scanner", "wash"]]]],
        // Early and Late subtle in a palette, Night solid — the Tag's own — and Weekend gray: the neutral look.
        ["Shifts", [[["Early", "wash"], ["Late", "wash"], ["Night", "recipe"]], [["Weekend", "neutral"]]]],
    ]);
    // Time in state: a bar a bin that counts any, as tall as its count over the card's tallest, 27 at most.
    const hours = read(c, "CH*", 5);
    expect(text(hours, "[data-read-label]")).toBe("Time in state");
    const bars = [...hours.querySelectorAll<HTMLElement>("[data-card-bars] [data-bin]")];
    expect(bars.map((bar) => [bar.getAttribute("data-bin"), bar.style.height]))
        .toEqual([["0", "6px"], ["1", "17px"], ["2", "27px"], ["3", "17px"], ["4", "7px"], ["5", "3px"], ["6", "1px"]]);
    // On the band axis, the default, each bar a twelfth of it — the same span on every card — 2 short of the next.
    bars.forEach((bar, i) => expect(parseFloat(bar.style.left)).toBeCloseTo((i * 100) / 12, 6));
    expect(bars.map((bar) => bar.style.width)).toEqual(bars.map(() => bars[0]!.style.width));
    expect(bars[0]!.style.width).toMatch(/^calc\(8\.333\d*% - 2px\)$/);
    // What the bars say to a screen reader: where half and nine in ten of its parcels fall.
    expect(hours.querySelector("[data-card-bars]")!.getAttribute("aria-label")).toBe("Half within 1h · nine in ten within 4h");
    // The axis: the first edge, then the app's ticks, each as far across its bin as it is across its span — the last open.
    expect([...hours.querySelectorAll<HTMLElement>("[data-card-axis] [data-tick]")].map((tick) => [tick.textContent, tick.style.left]))
        .toEqual([["0", "0px"], ["1h", "62.5px"], ["12h", "144.5px"], ["2d", "185.5px"], ["1w+", "226.5px"]]);
    // Service: its top two by value, each its name, a track filled to its share, and the share.
    const service = read(c, "CH*", 6);
    const rows = [...service.querySelectorAll<HTMLElement>("[data-list-row]")];
    expect([text(service, "[data-read-label]"), rows.map((row) => [row.children[0]!.textContent, row.children[2]!.textContent])])
        .toEqual(["Service", [["Standard", "57%"], ["Priority", "24%"]]]);
    expect(rows.map((row) => parseFloat(row.querySelector<HTMLElement>("[aria-hidden] > span")!.style.width))).toEqual([expect.closeTo(57, 0), expect.closeTo(24, 0)]);
});

test("on a linear axis each bar is as wide as its span — the open last as wide as the one before it, one too thin for the room to the next drawn flush, a pixel at least — and as tall as its count over that span; the ticks to scale, the app's words as given; the legend says to scale (R26, R28, R31)", async () => {
    // The desk's minutes in state, in the app's bins, drawn to scale.
    const edges = [0, 1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440];
    const { container: c } = await h.mountExample(ex.flowchartTicketMinutesLinear);
    await waitFor(() => expect(node(c, "WIP")?.querySelector("[data-card-bars]")).not.toBeNull());
    // Eleven spans and the open last, as wide as the one before it: 2,400 minutes across.
    const across = 1440 + 960;
    const bars = [...read(c, "WIP", 0).querySelectorAll<HTMLElement>("[data-card-bars] [data-bin]")];
    expect(bars.map((bar) => bar.getAttribute("data-bin"))).toEqual(edges.map((_, i) => String(i)));
    // Each 2 short of its span, the room to the next — or, too thin for that, its span alone, flush with its neighbours
    // and a pixel at least: the first half hour's six bins, 3px of the card's 246 between them.
    bars.forEach((bar, i) => {
        const span = (edges[i + 1] ?? across) - edges[i]!;
        const flush = i < 6;
        expect(parseFloat(bar.style.left), `bin ${i}`).toBeCloseTo((edges[i]! / across) * 100, 6);
        const width = (flush ? /^([\d.e-]+)%$/ : /^calc\(([\d.e-]+)% - 2px\)$/).exec(bar.style.width);
        expect(parseFloat(width?.[1] ?? "NaN"), `bin ${i}`).toBeCloseTo((span / across) * 100, 6);
        expect([bar.hasAttribute("data-flush"), bar.style.minWidth], `bin ${i}`).toEqual(flush ? [true, "1px"] : [false, ""]);
    });
    // Each as tall as its count over its span, against the card's densest: in progress, 120 tickets over the 5 minutes from 10.
    expect(bars.map((bar) => bar.style.height)).toEqual(["3px", "9px", "15px", "22px", "27px", "11px", "5px", "2px", "1px", "1px", "1px", "1px"]);
    // The ticks to scale: 5m and 1h crowd 0 at the start and are left out; the app's words as given.
    expect([...read(c, "WIP", 0).querySelectorAll<HTMLElement>("[data-card-axis] [data-tick]")].map((tick) => [tick.textContent, parseFloat(tick.style.left)]))
        .toEqual([["0", 0], ["a shift", expect.closeTo(50.2, 6)], ["a day", expect.closeTo(148.6, 6)]]);
    expect(text(c.querySelector("[data-flowchart-legend]")!, "[data-legend-read='states:0'] > span:last-child")).toBe("Time in state · 0 to 1d+, to scale");
});

test("a tag list wraps to three lines at most, then +n, its title naming the rest; the inspector shows every one (R30, R36)", async () => {
    // Another session gives the held parcels ten flags: six the app gives looks, four it does not.
    const rows = await h.read(ex.stateEvidence);
    const flags = new SortedSet(["Hazmat", "At risk", "Customs", "Oversize", "Fragile", "Cold chain", "Perishable", "Signature", "Insured", "Recalled"], compareString);
    await h.patch(ex.stateEvidence, withRow(rows, "HLD", { ...rows.get("HLD")!, flags }));
    const { container: c } = await open();
    await waitFor(() => expect(node(c, "HLD")!.querySelector("[data-flowchart-more]")).not.toBeNull());
    // Those with looks first, in the order defined; then the rest in the row's order — wrapping, and the third line's end +3.
    expect(tagLinesOf(read(c, "HLD", 2))).toEqual([
        [["Hazmat", "recipe"], ["At risk", "wash"], ["Customs", "recipe"]],
        [["Oversize", "wash"], ["Fragile", "wash"]],
        [["Cold chain", "wash"], ["Insured", "neutral"], ["+3", "neutral", m.detailsRest({ tags: ["Perishable", "Recalled", "Signature"] })]],
    ]);
    // The inspector shows every tag, in the same order, and counts them.
    await click(node(c, "HLD")!);
    await waitFor(() => expect(panel(c).querySelector("[data-inspector-reads]")?.getAttribute("data-reads")).toBe("landed"));
    const pane = panel(c).querySelector<HTMLElement>("[data-pane-read='2']")!;
    expect([text(pane, "[data-read-total]"), [...pane.querySelectorAll("[data-flowchart-tag]")].map((tag) => tag.textContent), pane.querySelector("[data-flowchart-more]")])
        .toEqual(["10", ["Hazmat", "At risk", "Customs", "Oversize", "Fragile", "Cold chain", "Insured", "Perishable", "Recalled", "Signature"], null]);
});

test("a state there is no row of says no data in each read; a tag list with no tags says none (R33, R41)", async () => {
    const { container: c } = await open();
    // Dispatched: the evidence task wrote no row of it.
    expect(readsOf(c, "DSP")).toEqual(readsOf(c, "CH*"));
    expect([...node(c, "DSP")!.querySelectorAll<HTMLElement>("[data-card-read]")].map((block) => [text(block, "[data-read-label]"), emptyOf(block)])).toEqual([
        ["Parcels", m.detailsNoData()], ["Flags", m.detailsNoData()], ["Equipment", m.detailsNoData()], ["Shifts", m.detailsNoData()],
        ["Time in state", m.detailsNoData()], ["Service", m.detailsNoData()],
    ]);
    // Arrived: no flags, its equipment its own.
    expect([emptyOf(read(c, "ARV", 2)), tagLinesOf(read(c, "ARV", 2)), tagLinesOf(read(c, "ARV", 3))]).toEqual([m.detailsNone(), [], [[["Conveyor", "wash"]]]]);
});

// ============================================================================
// A transition's label
// ============================================================================

test("a transition's label draws its region's top line under its evidence; one there is no row of keeps its evidence alone; an in-place transition, and one with nothing measured and no row, draw none (R29, R32, R33)", async () => {
    const { container: c } = await open();
    expect([evidenceOf(c, "l1"), labelLines(c, "l1")]).toEqual(["18,460 parcels · 412", [["detail", "Metro 46%"]]]);
    expect(labelLines(c, "l6")).toEqual([["detail", "Overseas 72%"]]);
    // In place, and the one to Delivered: neither weighed, and no row.
    expect([label(c, "l3"), label(c, "l10")]).toEqual([null, null]);
    // Another session takes the loading dock's row away: read again, its label keeps its evidence alone.
    await h.patch(ex.moveEvidence, withRow(await h.read(ex.moveEvidence), "l9", undefined));
    await waitFor(() => expect(labelLines(c, "l9")).toEqual([]));
    expect(evidenceOf(c, "l9")).toBe("17,030 parcels · 378");
});

// ============================================================================
// The legend
// ============================================================================

test("the legend adds a row for each figure, histogram and list the cards and labels draw, in the details' order, and a group for each tag list it lists: the defined tags the cards show, in the order defined — following the rail (R31, D21)", async () => {
    const { container: c } = await open();
    const legend = c.querySelector<HTMLElement>("[data-flowchart-legend]")!;
    expect([...legend.querySelectorAll("[data-legend-read]")].map((row) => [
        row.getAttribute("data-legend-read"), row.querySelector("[data-legend-mark]")!.getAttribute("data-legend-mark"), text(row, ":scope > span:last-child"),
    ])).toEqual([
        ["states:0", "figure", "Parcels · a figure on each card"],
        ["states:5", "bars", "Time in state · 0 to 1w+, a bar a bin"],
        ["states:6", "lines", "Service · top 2, by share"],
        ["transitions:0", "label", "Region · top 1, under the evidence"],
    ]);
    // Today's four rows first.
    expect([...legend.querySelectorAll("[data-legend-line]")].map((row) => row.getAttribute("data-legend-line"))).toEqual(["planned", "observed", "decision", "inPlace"]);
    const groups = () => [...c.querySelectorAll("[data-flowchart-legend] [data-legend-group]")].map((group) => [
        group.firstElementChild!.textContent, [...group.querySelectorAll("[data-flowchart-tag]")].map(tagOf),
    ]);
    // Flags and Equipment ask for it; Shifts does not.
    expect(groups()).toEqual([
        ["Flags", [["Hazmat", "recipe"], ["At risk", "wash"], ["Customs", "recipe"], ["Oversize", "wash"], ["Fragile", "wash"], ["Cold chain", "wash"]]],
        ["Equipment", [["Conveyor", "wash"], ["Scanner", "wash"], ["Forklift", "recipe"], ["Label printer", "recipe"], ["X-ray", "recipe"]]],
    ]);
    // The rail narrows the states to the returns': the groups list the tags their cards show.
    await narrow("Returns");
    await waitFor(() => expect(node(c, "RCV")?.querySelector("[data-card-value]")).not.toBeNull());
    await waitFor(() => expect(groups()).toEqual([
        ["Flags", [["At risk", "wash"], ["Customs", "recipe"], ["Fragile", "wash"]]],
        ["Equipment", [["Scanner", "wash"], ["X-ray", "recipe"]]],
    ]));
});

// ============================================================================
// Not landed, or failed
// ============================================================================

test("until its row lands a card draws a placeholder where each read's values go, its labels drawn, a label its lines' placeholders, the inspector its own and the legend each group's label alone, while the footer's line says `Loading state details…`; landed, each draws (R31, R34)", async () => {
    const states = h.e3.hold(readOf(STATE_EVIDENCE));
    const moves = h.e3.hold(readOf(MOVE_EVIDENCE));
    const { container: c } = await h.mountExample(ex.flowchartDepot);
    await waitFor(() => expect(node(c, "CH*")).not.toBeNull());
    await states.holding;
    await moves.holding;
    await waitFor(() => expect(lineText(c)).toBe(`Loading ${m.detailsNoun({ sort: "states" })}…`));
    expect(lineOf(c).getAttribute("data-loading-line")).toBe("loading");
    // Each read's label, and the shared placeholder shape where its values go: a list's as many as its top.
    expect([...node(c, "CH*")!.querySelectorAll<HTMLElement>("[data-card-read]")].map((block) => [
        text(block, "[data-read-label]"), [...block.querySelectorAll("[data-place]")].map((place) => place.getAttribute("data-place")),
    ])).toEqual([
        ["Parcels", ["figure"]], ["Flags", ["tags"]], ["Equipment", ["tags"]], ["Shifts", ["tags"]], ["Time in state", ["bars"]], ["Service", ["row", "row"]],
    ]);
    // A label: its evidence, then a placeholder for its region's line.
    expect([evidenceOf(c, "l1"), labelLines(c, "l1")]).toEqual(["18,460 parcels · 412", [["placeholder", ""]]]);
    // The legend: each group that asks for it, its label alone until a card shows a tag of its.
    const groups = () => [...c.querySelectorAll("[data-flowchart-legend] [data-legend-group]")].map((group) => [
        group.firstElementChild!.textContent, group.querySelectorAll("[data-flowchart-tag]").length,
    ]);
    expect(groups()).toEqual([["Flags", 0], ["Equipment", 0]]);
    // The inspector: each read's label, its placeholder in its values' place.
    await click(node(c, "CH*")!);
    const reads = panel(c).querySelector<HTMLElement>("[data-inspector-reads]")!;
    expect([reads.getAttribute("data-reads"), [...reads.querySelectorAll("[data-place]")].map((place) => place.getAttribute("data-place"))])
        .toEqual(["landing", ["stat", "stat", "tags", "tags", "tags", "bars", "row", "row"]]);
    await act(async () => {
        states.release();
        moves.release();
    });
    await settle();
    await waitFor(() => expect(lineOf(c).hasAttribute("data-idle")).toBe(true));
    await waitFor(() => expect(node(c, "CH*")!.querySelector("[data-place]")).toBeNull());
    expect([valueOf(read(c, "CH*", 0)), labelLines(c, "l1"), panel(c).querySelector("[data-inspector-reads]")!.getAttribute("data-reads"), groups()])
        .toEqual([["18,290", "parcels"], [["detail", "Metro 46%"]], "landed", [["Flags", 6], ["Equipment", 5]]]);
});

test("a failing read is said once — in the box at the canvas's top-left with Retry, and in the footer's line — the cards' placeholders standing; Retry, the fault gone, reads again and the reads draw (R34)", async () => {
    const stop = h.e3.fail(readOf(STATE_EVIDENCE), { status: 500, type: "internal", message: "the store is down" });
    const { container: c } = await h.mountExample(ex.flowchartDepot);
    await waitFor(() => expect(lineOf(c).hasAttribute("data-failed")).toBe(true), { timeout: 15_000 });
    const failed = `Couldn't read ${m.detailsNoun({ sort: "states" })}`;
    expect([lineText(c), lineOf(c).getAttribute("title")?.includes("the store is down")]).toEqual([failed, true]);
    const box = bodyOf(c).querySelector<HTMLElement>(":scope > [data-loading-failed-box]")!;
    expect([text(box, "[data-loading-failed-message]"), box.querySelector("[data-loading-retry]") !== null]).toEqual([failed, true]);
    // Said once: no banner says it too; and the cards wait as they were.
    expect(c.querySelector("[data-flowchart-banner]")).toBeNull();
    expect(node(c, "CH*")!.querySelector("[data-place='figure']")).not.toBeNull();
    stop();
    await act(async () => { fireEvent.click(box.querySelector("[data-loading-retry]")!); });
    await settle();
    await waitFor(() => expect(lineOf(c).hasAttribute("data-idle")).toBe(true), { timeout: 15_000 });
    await waitFor(() => expect(valueOf(read(c, "CH*", 0))).toEqual(["18,290", "parcels"]));
    expect(bodyOf(c).querySelector("[data-loading-failed-box]")).toBeNull();
});

// ============================================================================
// Selection
// ============================================================================

test("a card selected, and a label — its transition selected — are marked so, for the recipe's looks (R39)", async () => {
    const { container: c } = await open();
    await click(node(c, "CH*")!);
    expect([node(c, "CH*")!.hasAttribute("data-selected"), label(c, "l1")!.hasAttribute("data-selected")]).toEqual([true, false]);
    await click(c.querySelector("[data-flowchart-link='l1']")!);
    expect([node(c, "CH*")!.hasAttribute("data-selected"), label(c, "l1")!.hasAttribute("data-selected"), label(c, "l5")!.hasAttribute("data-selected")])
        .toEqual([false, true, false]);
});
