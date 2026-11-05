/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The rail's picks weigh the Flowchart's details (#1522, `Flowchart Records
 * Spec.md` R43–R46), on e3 itself: the depot's states, transitions and lanes
 * read whole (`flowchart.examples.tsx`), and each state's evidence read
 * through a source of the rail (`flowchart-weighed.fixtures.ts`) — its
 * services filed apart by an entries index, its site by an index of its own —
 * which the states' details name.
 *
 * - **The rail's Dict field** (R43): the Service field lists the services the
 *   evidence holds, each counted by the states holding it, from the entries
 *   index alone.
 * - **Weighed** (R44, R45): with no pick, every read draws the row's own; a
 *   pick draws each read the entries hold from the picked services added up
 *   by kind — figures added, the hours bin by bin, the exceptions by name, the
 *   flags joined — and the rest from the row; every service picked draws
 *   exactly what no pick draws. A state holding none of the picks keeps its
 *   card, its weighed reads saying *no data*.
 * - **The source's other field** (R45): a site picked leaves the other site's
 *   rows out, each read as a row there is none of.
 * - **The inspector** (R46): one line names the picks, in the rail's words.
 * - **Reading** (R44): a pick reads its services' ranges of the entries index,
 *   the weighed reads waiting meanwhile; the rows by key are kept, and the
 *   record's own rows are never read. The binding pages neither the entries
 *   index nor its lean rows: a reader reads them by their keys' runs.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import {
    East, Expr, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceStateType, Slice, type RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { StateRuntime, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Flowchart } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import * as fx from "@elaraai/e3-ui/fixtures/flowchart/flowchart-weighed";
import { slot } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, flowchartHarness, settle } from "./flowchart.test-utils.js";
import { flowchartMessages } from "./messages.js";

const h = flowchartHarness({ "flowchart/flowchart-weighed.fixtures": fx });

const m = flowchartMessages;
const compareString = compareFor(StringType);
const printText = printFor(StringType);

/** The evidence's record, as its dataset's requests name it. */
const EVIDENCE = `records.${fx.weighedEvidence.name}`;
/** Its entries index, each service's shares a range of it; and the index of its lean rows beside it. */
const BY_SERVICE = "flowchart_weighed_by_service";
const LEAN_ROWS = `${BY_SERVICE}_rows`;

/** The rail, as `Slice.bindRecords` keys it, and the evidence's source in the UI store. */
const RAIL = "flowchart.weighed";
const EVIDENCE_KEY = `${RAIL}.evidence`;

/** The states the evidence holds a row of, in East's order of their keys. */
const MEASURED = ["ARV", "CH*", "HLD", "RCV", "SRD"];

/** The states' details, in their order: what each read's place is. */
const PARCELS = 0, WAITING = 1, ON_TIME = 2, FLAGS = 3, EQUIPMENT = 4, HOURS = 5, EXCEPTIONS = 6;
/** The reads the picks weigh, on the card: the figure, the flags, the hours and the exceptions. */
const WEIGHED = [PARCELS, FLAGS, HOURS, EXCEPTIONS];

/**
 * Mounts the depot's states over the evidence, through the rail's source, and
 * waits until it is at rest: its states drawn, and every read done — the
 * details landed, the footer's line idle.
 *
 * @returns The render
 */
async function open(): Promise<RenderResult> {
    const ui = await h.mountFlowchart(($) => {
        // The depot's states, transitions and lanes, read whole; the evidence, bound once: the rail's source, and the states' details.
        const states = $.let(Data.bind(ex.depotStates));
        const transitions = $.let(Data.bind(ex.depotTransitions));
        const lanes = $.let(Data.bind(ex.depotLanes));
        const evidence = $.let(Data.bindPaged(fx.weighedEvidence, { indexes: [BY_SERVICE, "flowchart_weighed_by_site"] }));
        const slice = $.let(Slice.bindRecords(RAIL, {
            evidence: {
                source: evidence,
                fields: { byService: { label: "Service", hints: [...fx.WEIGHED_SERVICES] }, site: { label: "Site", hints: ["North", "South"] } },
            },
        }));
        return {
            slice: { slice },
            states: Flowchart.states(states, {
                label: "name", lane: "phase", order: "seq", members: (s) => s.slots,
                details: Flowchart.details(evidence, {
                    source: "evidence",
                    details: [
                        Flowchart.figure("parcels", { label: "Parcels", unit: "parcels" }),
                        Flowchart.figure("waiting", { label: "Still in state", show: "inspector" }),
                        Flowchart.figure("onTime", { label: "On time", weigh: false }),
                        Flowchart.tags("flags", { label: "Flags" }),
                        Flowchart.tags("equipment", { label: "Equipment" }),
                        Flowchart.histogram("hours", { unit: "hours", label: "Time in state", bins: [...fx.WEIGHED_HOURS] }),
                        Flowchart.list("exceptions", { label: "Exceptions", unit: "parcels", top: 2 }),
                    ],
                }),
            }),
            transitions: Flowchart.transitions(transitions, { from: "src", to: "dst", kind: (t) => t.kind }),
            lanes: Flowchart.lanes(lanes, { label: "label", order: "seq" }),
            name: "weighed",
        };
    }, { storageKey: "flowchart-weighed" });
    await settle();
    await waitFor(() => expect(node(ui.container, "SRD")).not.toBeNull());
    await landed(ui.container);
    return ui;
}

/** Waits until every read is done: no card waiting on its reads, the footer's line idle. */
async function landed(c: HTMLElement): Promise<void> {
    await waitFor(() => expect(lineOf(c).hasAttribute("data-idle")).toBe(true));
    await waitFor(() => expect(c.querySelector("[data-flowchart-node] [data-place]")).toBeNull());
    await settle();
}

type Where = ValueTypeOf<RecordSliceWhereType>;

/** A narrowing: each field's values chosen, printed as the rail prints them. */
function where(choices: { readonly [field: string]: readonly string[] }): Where {
    return new SortedMap(Object.entries(choices).map(([field, values]) => [field, variant("values", values.map((value) => printText(value)))]), compareString);
}

/** Writes the evidence's narrowing, as the rail's chips do, and settles. */
async function pick(next: Where): Promise<void> {
    const store = StateRuntime.getStore();
    const held = store.read(EVIDENCE_KEY);
    const state = held === undefined ? { where: next, preset: none, resolution: none } : { ...decodeBeast2For(RecordSliceStateType)(held), preset: none, where: next };
    await act(async () => { store.write(EVIDENCE_KEY, encodeBeast2For(RecordSliceStateType)(state)); });
    await settle();
}

// ── Reading the flowchart ─────────────────────────────────────────────────

/** A state's card. */
const node = (c: HTMLElement, key: string): HTMLElement | null => c.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`);
/** Its words in a part, by its selector. */
const text = (el: Element, selector: string): string | null => el.querySelector(selector)?.textContent ?? null;
/** One read's block on a card, by its place in the details. */
const read = (c: HTMLElement, key: string, index: number): HTMLElement => node(c, key)!.querySelector<HTMLElement>(`[data-card-read="${index}"]`)!;
/** A figure's value: its number and its unit. */
const valueOf = (block: HTMLElement): (string | null)[] => [...block.querySelector("[data-card-value]")?.children ?? []].map((el) => el.textContent);
/** A tag list's tags on a card, line after line. */
const tagsOf = (block: HTMLElement): (string | null)[] => [...block.querySelectorAll("[data-flowchart-tag]")].map((tag) => tag.textContent);
/** A histogram's bars on a card: each its bin and its height. */
const barsOf = (block: HTMLElement): (string | null)[][] =>
    [...block.querySelectorAll<HTMLElement>("[data-card-bars] [data-bin]")].map((bar) => [bar.getAttribute("data-bin"), bar.style.height]);
/** A list's top lines on a card: each its name and its share. */
const linesOf = (block: HTMLElement): (string | null)[][] =>
    [...block.querySelectorAll<HTMLElement>("[data-list-row]")].map((row) => [row.children[0]!.textContent, row.children[2]!.textContent]);
/** What a read says in its values' place: *no data*, *none*. */
const emptyOf = (block: HTMLElement): string | null => text(block, "[data-card-empty]");
/** What each read on a card says in its values' place, by its place: `null` where it draws its values. */
const emptiesOf = (c: HTMLElement, key: string): (string | null)[] =>
    [...node(c, key)!.querySelectorAll<HTMLElement>("[data-card-read]")].map((block) => emptyOf(block));
/** The reads a card waits on, by their places: each a placeholder where its values go. */
const waitingOf = (c: HTMLElement, key: string): number[] =>
    [...node(c, key)!.querySelectorAll<HTMLElement>("[data-card-read]")].filter((block) => block.querySelector("[data-place]") !== null)
        .map((block) => Number(block.getAttribute("data-card-read")));
/** Each measured state's reads on its card, as drawn: what a pick of every service is held to. */
const drawnReads = (c: HTMLElement): string[][] =>
    MEASURED.map((key) => [...node(c, key)!.querySelectorAll<HTMLElement>("[data-card-read]")].map((block) => block.outerHTML));

/** The footer's loading line. */
const lineOf = (c: HTMLElement): HTMLElement => slot(c, "footer").querySelector<HTMLElement>("[data-footer-line]")!;
/** The inspector's open tab. */
const panel = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-frame-slot='end'] [role='tabpanel']:not([hidden])")!;

/** Clicks an element, as a pointer does, and lets the flowchart settle. */
async function click(el: Element): Promise<void> {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

/** The rail's editor of one of the evidence's fields, opened from its chip on the toolbar. */
async function editorOf(c: HTMLElement, field: string): Promise<HTMLElement> {
    const chip = slot(c, "toolbar").querySelector<HTMLElement>(`[data-record-slice-source="evidence"][data-record-slice-field="${field}"]`);
    if (chip === null) throw new Error(`the toolbar holds no chip of the evidence's ${field}`);
    await click(chip);
    return waitFor(() => {
        const editor = document.querySelector<HTMLElement>(`[data-record-slice-editor="${field}"]`);
        if (editor === null) throw new Error(`the ${field} editor has not opened`);
        return editor;
    });
}

/** An editor's values, as the rail lists them: each its label and its count. */
const choicesOf = (editor: HTMLElement): (string | null)[][] =>
    [...editor.querySelectorAll<HTMLElement>("button[aria-pressed]")].map((choice) => [choice.children[0]?.textContent ?? null, choice.children[1]?.textContent ?? null]);

/** The requests of the evidence since a point in the log: each its kind and the index it names. */
const evidenceSince = (from: number): (string | null)[][] =>
    h.requests().slice(from).filter((request) => request.dataset === EVIDENCE).map((request) => [request.kind, request.query.get("index")]);

/** Whether a request reads the evidence's services' ranges, through its entries index. */
const throughEntries = (request: E3Request): boolean => request.dataset === EVIDENCE && request.query.get("index") === BY_SERVICE;

/** The reads of the record's own rows, whole or by key, from the mount on. */
const ownRows = (): E3Request[] => h.requests().filter((request) => request.dataset === EVIDENCE && (request.kind === "read" || request.kind === "rows"));

/**
 * The pages of the record's own rows, from the mount on, each its offset, its limit and its index: the rail's count of
 * the source alone, its total, which a page one row long brings (`record-slice-source.ts`'s `resolve`).
 */
const ownPages = (): (string | null)[][] => h.requests().filter((request) => request.dataset === EVIDENCE && request.kind === "page")
    .map((request) => [request.query.get("offset"), request.query.get("limit"), request.query.get("index")]);

// ============================================================================
// The rail's Dict field
// ============================================================================

test("the rail lists the services the evidence holds as the Service field's values, each counted by the states holding it — from the entries index alone (R43)", async () => {
    const { container: c } = await open();
    const editor = await editorOf(c, "byService");
    await waitFor(() => expect(choicesOf(editor)).toEqual([["Standard", "5"], ["Priority", "2"], ["Economy", "2"], ["International", "1"]]));
    // Counted from the index: the record's rows read neither whole nor by key, its one page the source's total, a row long.
    expect(ownRows()).toEqual([]);
    expect(ownPages()).toEqual([["0", "1", null]]);
    // Each service sought in the entries index, by its name.
    const sought = h.requests().filter((request) => throughEntries(request) && request.kind === "find").flatMap((request) => request.searches.map((search) => JSON.stringify(search)));
    for (const service of fx.WEIGHED_SERVICES) expect(sought.some((search) => search.includes(service)), service).toBe(true);
});

// ============================================================================
// Weighed
// ============================================================================

test("with no pick every read draws the row's own; a pick draws each read the entries hold from the picked services added up by kind, the rest from the row; every service picked draws exactly what no pick draws (R44, R45)", async () => {
    const { container: c } = await open();
    // No pick: Sorted's own — its parcels, its flags, its hours and its exceptions, beside its on-time share and its equipment.
    expect([valueOf(read(c, "SRD", PARCELS)), tagsOf(read(c, "SRD", FLAGS)), linesOf(read(c, "SRD", EXCEPTIONS))])
        .toEqual([["465", "parcels"], ["At risk", "Fragile"], [["Missort", "70%"], ["Damaged packaging", "30%"]]]);
    const own = drawnReads(c);
    const ownBars = barsOf(read(c, "SRD", HOURS));
    // Priority picked on the rail, as a person picks it.
    const editor = await editorOf(c, "byService");
    await waitFor(() => expect(choicesOf(editor)[1]).toEqual(["Priority", "2"]));
    await click(editor.querySelectorAll<HTMLElement>("button[aria-pressed]")[1]!);
    await waitFor(() => expect(valueOf(read(c, "SRD", PARCELS))).toEqual(["130", "parcels"]));
    await landed(c);
    // Sorted: Priority's own parcels, flags, hours and exceptions; its on-time share and its equipment the row's.
    expect([tagsOf(read(c, "SRD", FLAGS)), linesOf(read(c, "SRD", EXCEPTIONS)), valueOf(read(c, "SRD", ON_TIME)), tagsOf(read(c, "SRD", EQUIPMENT))])
        .toEqual([["At risk"], [["Missort", "67%"], ["Damaged packaging", "33%"]], ["0.9"], ["Conveyor"]]);
    // Its bars, Priority's 50, 40, 30 and 10 parcels a bin: each as tall as its count over the tallest.
    const bars = barsOf(read(c, "SRD", HOURS));
    expect(bars.map(([bin]) => bin)).toEqual(["0", "1", "2", "3"]);
    expect(bars).not.toEqual(ownBars);
    const heights = bars.map(([, height]) => parseFloat(height!));
    expect(heights[0]).toBe(Math.max(...heights));
    expect(heights.map((height) => height / heights[0]!)).toEqual([1, 40 / 50, 30 / 50, 10 / 50].map((share) => expect.closeTo(share, 1)));
    // Sort chutes: Priority's 150 parcels, at risk.
    expect([valueOf(read(c, "CH*", PARCELS)), tagsOf(read(c, "CH*", FLAGS))]).toEqual([["150", "parcels"], ["At risk"]]);
    // Every service picked: every card drawn as with no pick.
    await pick(where({ byService: fx.WEIGHED_SERVICES }));
    await waitFor(() => expect(valueOf(read(c, "SRD", PARCELS))).toEqual(["465", "parcels"]));
    await landed(c);
    expect(drawnReads(c)).toEqual(own);
});

test("a state holding none of the picks keeps its card: its weighed reads say no data, its others draw its row's own; a state the evidence holds no row of says no data in each (R45, ruling 22)", async () => {
    const { container: c } = await open();
    await pick(where({ byService: ["International"] }));
    await waitFor(() => expect(valueOf(read(c, "HLD", PARCELS))).toEqual(["680", "parcels"]));
    await landed(c);
    // Held holds International's 680: its weighed reads its share's, its others its own.
    expect([tagsOf(read(c, "HLD", FLAGS)), linesOf(read(c, "HLD", EXCEPTIONS)), tagsOf(read(c, "HLD", EQUIPMENT)), valueOf(read(c, "HLD", ON_TIME))])
        .toEqual([["Customs", "Hazmat"], [["Missing documents", "63%"], ["Duty unpaid", "37%"]], ["Forklift", "X-ray"], ["0.6"]]);
    // Sorted holds none: its card stands, its weighed reads no data, its on-time share and its equipment its own.
    const noData = m.detailsNoData();
    expect(emptiesOf(c, "SRD")).toEqual([noData, null, noData, null, noData, noData]);
    expect([valueOf(read(c, "SRD", ON_TIME)), tagsOf(read(c, "SRD", EQUIPMENT))]).toEqual([["0.9"], ["Conveyor"]]);
    for (const key of ["ARV", "CH*", "RCV"]) expect(emptiesOf(c, key), key).toEqual([noData, null, noData, null, noData, noData]);
    // Dispatched: no row of it, whatever the picks — every read no data.
    expect(emptiesOf(c, "DSP")).toEqual([noData, noData, noData, noData, noData, noData]);
});

// ============================================================================
// The source's other field
// ============================================================================

test("a site picked leaves the other site's rows out, each read as a row there is none of; beside a service picked, the site's rows weighed by it (R45)", async () => {
    const { container: c } = await open();
    const noData = m.detailsNoData();
    const everyRead = [noData, noData, noData, noData, noData, noData];
    await pick(where({ site: ["North"] }));
    await waitFor(() => expect(emptiesOf(c, "HLD")).toEqual(everyRead));
    await landed(c);
    // The South's rows read as rows there are none of — their own reads too; the North's draw their own.
    for (const key of ["ARV", "HLD", "RCV"]) expect(emptiesOf(c, key), key).toEqual(everyRead);
    expect([valueOf(read(c, "SRD", PARCELS)), valueOf(read(c, "CH*", PARCELS))]).toEqual([["465", "parcels"], ["600", "parcels"]]);
    // Priority beside it: the North's weighed by it, the South's still none.
    await pick(where({ site: ["North"], byService: ["Priority"] }));
    await waitFor(() => expect(valueOf(read(c, "SRD", PARCELS))).toEqual(["130", "parcels"]));
    await landed(c);
    expect(valueOf(read(c, "CH*", PARCELS))).toEqual(["150", "parcels"]);
    for (const key of ["ARV", "HLD", "RCV"]) expect(emptiesOf(c, key), key).toEqual(everyRead);
});

// ============================================================================
// The inspector
// ============================================================================

test("over a state's weighed reads the inspector's line names the picks in the rail's words, and with no pick says nothing (R46)", async () => {
    const { container: c } = await open();
    await click(node(c, "SRD")!);
    await waitFor(() => expect(panel(c).querySelector("[data-inspector-reads]")?.getAttribute("data-reads")).toBe("landed"));
    expect(panel(c).querySelector("[data-read-weighed]")).toBeNull();
    await pick(where({ byService: ["Standard", "Priority"] }));
    await waitFor(() => expect(text(panel(c), "[data-read-weighed]")).toBe(m.detailsWeighed({ label: "Service", picks: "Standard, Priority" })));
    // The figures under it, Standard's and Priority's added: Sorted's every parcel, and every one still in it.
    await landed(c);
    const pane = (index: number) => panel(c).querySelector<HTMLElement>(`[data-pane-read='${index}']`)!;
    expect([pane(PARCELS).textContent?.includes("465"), pane(WAITING).textContent?.includes("50")]).toEqual([true, true]);
});

// ============================================================================
// Reading
// ============================================================================

test("a pick reads its services' ranges of the entries index, its weighed reads waiting meanwhile and the rest drawn; the rows by key are kept, and the record's own rows never read (R44, R34)", async () => {
    const { container: c } = await open();
    // The open read the rows by key, through the lean rows beside the entries index — and nothing of the services.
    expect(evidenceSince(0).filter(([, index]) => index === LEAN_ROWS).length).toBeGreaterThan(0);
    expect(h.requests().filter(throughEntries).filter((request) => request.kind !== "find")).toEqual([]);
    const from = h.requests().length;
    const ranges = h.e3.hold(throughEntries);
    await pick(where({ byService: ["Priority"] }));
    await ranges.holding;
    // In flight: the weighed reads wait, each a placeholder; the on-time share and the equipment drawn as they were.
    await waitFor(() => expect(waitingOf(c, "SRD")).toEqual(WEIGHED));
    expect([valueOf(read(c, "SRD", ON_TIME)), tagsOf(read(c, "SRD", EQUIPMENT))]).toEqual([["0.9"], ["Conveyor"]]);
    await act(async () => { ranges.release(); });
    await settle();
    await waitFor(() => expect(valueOf(read(c, "SRD", PARCELS))).toEqual(["130", "parcels"]));
    await landed(c);
    // What the pick read: Priority's range of the entries index — sought, then its run read — and nothing else of the record.
    const asked = evidenceSince(from);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every(([, index]) => index === BY_SERVICE), JSON.stringify(asked)).toBe(true);
    expect(asked.map(([kind]) => kind)).toContain("runs");
    const sought = h.requests().slice(from).filter((request) => throughEntries(request) && request.kind === "find").flatMap((request) => request.searches.map((search) => JSON.stringify(search)));
    expect(sought.length).toBeGreaterThan(0);
    expect(sought.every((search) => search.includes("Priority")), sought.join(" ")).toBe(true);
    // Never the record's own rows, from the mount on: neither whole nor by key, its one page the source's total, a row long.
    expect(ownRows()).toEqual([]);
    expect(ownPages()).toEqual([["0", "1", null]]);
});

test("the binding pages neither the entries index nor its lean rows, each refused in its words: a reader reads them by their keys' runs (R44)", async () => {
    // The evidence's binding, built over e3 as a mounted flowchart's providers build it.
    const bind = () => Data.bindPaged(fx.weighedEvidence, { indexes: [BY_SERVICE, "flowchart_weighed_by_site"] });
    const fn = East.function([], Expr.type(bind()) as EastType, ($) => $.return(bind()));
    const uninstall = await h.install({ fn });
    try {
        const handle = East.compile(fn, getRegisteredPlatformImplementations())() as { readonly page: (index: string, offset: bigint, limit: bigint) => unknown };
        for (const index of [BY_SERVICE, LEAN_ROWS]) {
            expect(() => handle.page(index, 0n, 10n), index).toThrow(`Data.bindPaged: '${index}' files a Dict field of the rows entry by entry, beside its lean rows`);
        }
        // Its site's index pages its lean rows, as a plain index does.
        expect(() => handle.page("flowchart_weighed_by_site", 0n, 10n)).not.toThrow();
    } finally {
        uninstall();
    }
});
