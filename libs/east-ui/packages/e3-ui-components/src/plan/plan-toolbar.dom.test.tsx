/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan's toolbar items on its frame's one row under width pressure (#952,
 * #1193, PB20, PB21, #1344): one ladder over its items — the record rail of its
 * one `Slice.bindRecords` first, in the rail's order (each field's chip, the
 * terminal Filters chip, the icon), its summary after every step of it, then
 * the Plan's own (the user's decision): the date navigator compacts, the
 * resolution segment folds into its menu, the fold-all toggle into its icon;
 * the key search folds into its icon; the fold toggle and the resolution then
 * fold into the date navigator's View, as Calendar's and Roster's do, and the
 * overlaps chip with them; the history item folds last, to its buttons. The window is the date
 * navigator's on a time axis, so the rows' range field is no chip of the rail;
 * on a number axis the leading source's range is, and another source's range
 * follows it. A segment's menu chip draws Font Awesome's caret (#1263). jsdom
 * lays nothing out, so each item's width is stubbed by the form it shows; the
 * gap is 10px.
 */

import { describe, test, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { useMemo } from "react";
import { act, render, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider, useSlotRecipe } from "@chakra-ui/react";
import { IntegerType, StringType, StructType, printFor, toEastTypeValue, variant, some, none } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import {
    system, formatters, EditSession, editingMessages, UIStore, Toolbar, type HistoryBarProps,
} from "@elaraai/east-ui-components";
import { markOf } from "@elaraai/east-ui-components/testing";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { usePlanToolbarItems } from "./shell/Toolbar.js";
import type { PlanChrome } from "./root/chrome.js";
import type { PlanEventItemValue, PlanOverlaps } from "./frame/counts.js";
import { scheduleEventKey, scheduleOverlaps } from "../shared/schedule/overlaps.js";
import type { PlanEntryRef } from "./use-plan-editing.js";
import { planScale, type PlanScale } from "./scale.js";
import { PLAN_WORDS } from "./words.js";
import { createPlanController } from "./controller/index.js";
import { PlanControllerContext } from "./controller/react.js";
import { rowKey } from "./plan.test-utils.js";
import { recordPart, recordSlices } from "./record-slices.test-utils.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver; the toolbar observes its row and items through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/** The stubbed layout: the toolbar row's box. */
const row = { px: 0 };

/** Each item's width in each of its forms, widest first (a hidden form has no box). */
const FORM_PX: Record<string, readonly number[]> = {
    "record-slices": [300, 240, 160, 110, 40],
    "record-summary": [200],
    seek: [200, 44],
    groups: [170, 90],
    "time-navigation": [260, 180, 220],
    resolution: [150, 80],
    overlaps: [110, 50],
    history: [220, 140],
};

function widthOf(el: Element): number {
    if (el.hasAttribute("data-toolbar")) return row.px;
    const key = el.getAttribute("data-toolbar-item");
    if (key === null) return 0;
    return FORM_PX[key]?.[Number(el.getAttribute("data-toolbar-form"))] ?? 0;
}

const originalRect = Element.prototype.getBoundingClientRect;
const originalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = widthOf(this);
        return { x: 0, y: 0, left: 0, top: 0, width, height: 30, right: width, bottom: 30, toJSON() { return {}; } } as DOMRect;
    };
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
        const style = computed(el, pseudo);
        if (!el.hasAttribute("data-toolbar")) return style;
        return new Proxy(style, { get: (target, prop) => (prop === "columnGap" ? "10px" : Reflect.get(target, prop)) });
    });
});
afterAll(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
    vi.restoreAllMocks();
});

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

/** The window the toolbar's navigator reads: twelve weeks from W27, by the week. */
const WEEKLY: PlanScale = planScale({ kind: "time", window: { min: W27, max: W39 }, resolution: "week", words: PLAN_WORDS })!;

/** A number axis's window: the eight steps `[1, 9)`. */
const STEPS: PlanScale = planScale({ kind: "number", window: { min: 1, max: 9 }, step: 1, words: PLAN_WORDS })!;

/**
 * The rail over the canvas's rows (#1344): one source, `rows`, its owner and
 * hall fields chips of the rail and its range — the window — the date
 * navigator's, nothing narrowed: two rows in the window, as the canvas hands
 * them over.
 *
 * @returns The chrome's narrowing parts
 */
function railParts(): ChromeParts {
    initializeStore(new UIStore());
    const owners = ["Team A", "Team B"];
    const part = recordPart({
        key: "plan.toolbar.ladder.rows",
        range: { id: "at", kind: "datetime", label: "Dates", values: [W27.getTime(), W28.getTime()] },
        strings: [
            { id: "owner", label: "Owner", hints: owners, values: owners },
            { id: "hall", label: "Hall", hints: ["Hall 1"], values: ["Hall 1", "Hall 1"] },
        ],
        window: [W27.getTime(), W39.getTime()], resolution: "week",
    });
    const slices = recordSlices("plan.toolbar.ladder", [{ source: "rows", slice: part }], ["fields", "summary"]);
    const holder = { source: "rows", part };
    return { slices, windowParts: [holder], lead: holder, rowsPart: part, nouns: { rows: "rows" }, affordances: ["fields", "summary"] };
}

/** A key search over a seekable source's String keys — the toolbar mounts it; nothing here searches. */
const SEARCH: NonNullable<PlanChrome["search"]> = {
    resetKey: "r1", requery: 0, keyType: toEastTypeValue(StringType),
    find: async () => ({ found: false, row: 0, count: 0 }), listRange: async () => [], jump: () => {}, clear: () => {},
};

/** An editing session's history bar props — over the session itself, as a test sets its state. */
function historyProps(): HistoryBarProps<PlanEntryRef> & { session: EditSession<PlanEntryRef> } {
    const Run = StructType({ id: StringType, end: IntegerType });
    const session = new EditSession<PlanEntryRef>({
        sourceId: "runs", entryType: Run, draftType: Editing.Types.Draft(Run), idField: "id", auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    const noop = () => {};
    return { session, words: { ...formatters("en-US"), m: editingMessages }, editing: false, onAction: noop, onIssue: noop };
}

/** Two jobs on Press B2 at once on Tuesday 20 October, and the one pair they make (#1198). */
function onePair(): PlanOverlaps {
    const job = (key: string, from: number, to: number): PlanEventItemValue => ({
        kind: "job", key, title: `${key} title`,
        start: some(new Date(Date.UTC(2026, 9, 20, from))), end: some(new Date(Date.UTC(2026, 9, 20, to))),
        resource: some({ kind: "presses", key: "b2" }), status: none, minutes: 60n, due: none,
        state: variant("confirmed", null), quantity: none, lane: none,
    });
    return scheduleOverlaps([[job("J-1018", 6, 12), job("J-1019", 10, 13)]]);
}

/** What a canvas's chrome hands the toolbar — nothing but the styles, until a test gives it more. */
type ChromeParts = Partial<Omit<PlanChrome, "styles">>;

/** The Plan's items on the frame's one row, as its frame lays them out — with the overlaps among its events, when a test gives them. */
function Harness({ parts, overlaps }: { parts: ChromeParts; overlaps?: PlanOverlaps }) {
    const controller = useMemo(() => {
        const value = createPlanController({ grain: parts.grain ?? "resource", collapsed: [] });
        // This layout fixture declares one parent; controller behavior has its own tests.
        value.groupKeys = () => parts.grain === undefined ? [] : [rowKey("group")];
        return value;
    }, [parts.grain]);
    return <PlanControllerContext.Provider value={controller}><Items parts={parts} {...(overlaps === undefined ? {} : { overlaps })} /></PlanControllerContext.Provider>;
}

function Items({ parts, overlaps }: { parts: ChromeParts; overlaps?: PlanOverlaps }) {
    const styles = useSlotRecipe({ key: "plan" })() as unknown as Record<string, Record<string, unknown>>;
    const chrome: PlanChrome = {
        words: PLAN_WORDS, styles, storageKey: "plan.toolbar", scale: WEEKLY,
        slices: undefined, windowParts: [], lead: undefined, rowsPart: undefined, eventParts: [], nouns: {}, windowError: undefined,
        affordances: [], resolutions: [], grain: undefined, transport: undefined, search: undefined,
        diagnostics: { skipped: 0 },
        history: undefined, sessions: [], events: undefined, where: (issue) => issue.entry, footer: [], id: undefined, narrow: false,
        // The inspector's reads: the toolbar takes none.
        inspect: { row: () => undefined, valueAt: () => undefined },
        // The overlaps chip's selection (#1198): its own test hears it.
        selectEvents: () => {},
        // Whether the panel's cards drag (#1259, #1196): the toolbar never reads it.
        takesCards: false,
        takesEvents: false,
        patchKinds: new Set(),
        ...parts,
    };
    return <Toolbar items={usePlanToolbarItems(chrome, overlaps)} />;
}

/** A canvas with a root group, the rail over its rows, the resolutions and editing. */
function everything(): ChromeParts {
    return { ...railParts(), resolutions: ["week", "day"], grain: "group", history: historyProps() };
}

/** Each item's form of its forms, as the toolbar says it folded them, in the row's order. */
function stateOf(container: HTMLElement): Map<string, number> {
    const text = container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-state")!;
    return new Map(text.split(";").map((part) => {
        const [key, of] = part.split("=");
        return [key!, Number(of!.split("/")[0])] as const;
    }));
}

/** One step of a ladder: each item it folds, to its form — several at once where they fold as one bundle. */
type LadderStep = ReadonlyArray<readonly [string, number]>;

/**
 * The Plan's ladder, step by step: the rail's (each field's chip, the
 * terminal chip, the icon) and its summary, then the Plan's own — the date
 * navigator compacts, the resolution folds to its menu, the fold toggle to its
 * icon, and the three fold into the navigator's View together — the history
 * last.
 */
const LADDER: readonly LadderStep[] = [
    [["record-slices", 1]], [["record-slices", 2]], [["record-slices", 3]], [["record-slices", 4]],
    [["record-summary", 1]], [["time-navigation", 1]], [["resolution", 1]], [["groups", 1]],
    [["groups", 2], ["time-navigation", 2], ["resolution", 2]],
    [["history", 1]],
];

/** A seekable canvas's ladder, its key search in it: the key search's step,
 *  then the history's. */
const SEEK_LADDER: readonly LadderStep[] = [[["seek", 1]], [["history", 1]]];

/** The Plan's ladder with an overlapping pair (#1198, #1344): the overlaps chip
 *  shortens after the date navigator compacts, and folds into its View with
 *  the fold toggle and the resolution, one move. */
const OVERLAPS_LADDER: readonly LadderStep[] = [
    [["record-slices", 1]], [["record-slices", 2]], [["record-slices", 3]], [["record-slices", 4]],
    [["record-summary", 1]], [["time-navigation", 1]], [["overlaps", 1]], [["resolution", 1]], [["groups", 1]],
    [["groups", 2], ["time-navigation", 2], ["resolution", 2], ["overlaps", 2]],
    [["history", 1]],
];

/** Walks a ladder: each configuration on it holds in exactly the row it needs,
 *  and a pixel less takes the next step — and only that one — the overlaps
 *  among the events given, when a test gives them. */
function walk(parts: ChromeParts, start: ReadonlyMap<string, number>, ladder: readonly LadderStep[], overlaps?: PlanOverlaps) {
    let forms = new Map(start);
    row.px = needs(forms);
    const harness = () => <ChakraProvider value={system}><Harness parts={parts} {...(overlaps === undefined ? {} : { overlaps })} /></ChakraProvider>;
    const ui = render(harness());
    expect(stateOf(ui.container)).toEqual(forms);
    const at = (px: number) => {
        row.px = px;
        ui.rerender(harness());
        return stateOf(ui.container);
    };
    for (const step of ladder) {
        const room = needs(forms);
        expect(at(room), `${room}px`).toEqual(forms);
        forms = new Map(forms);
        for (const [key, form] of step) forms.set(key, form);
        expect(at(room - 1), `${room - 1}px, the step ${step.map(([key, form]) => `${key}→${form}`).join(" + ")}`).toEqual(forms);
    }
    return ui.container;
}

/** The row a configuration needs: every drawn form's width, and a 10px gap between drawn items. */
function needs(forms: ReadonlyMap<string, number>): number {
    const drawn = [...forms].flatMap(([key, form]) => {
        const px = FORM_PX[key]![form];
        return px === undefined ? [] : [px];
    });
    return drawn.reduce((a, b) => a + b, 0) + 10 * Math.max(0, drawn.length - 1);
}

describe("the Plan's toolbar items (#952, #1193, #1344)", () => {
    test("they are one row in §7.1's order: the rail's chips, the fold toggle, the date navigator, the resolution; at the end the rail's summary and the history (PB20)", () => {
        row.px = 4000;
        const parts = everything();
        const { container } = render(<ChakraProvider value={system}><Harness parts={parts} /></ChakraProvider>);
        expect([...stateOf(container).keys()]).toEqual(["record-slices", "record-summary", "groups", "time-navigation", "resolution", "history"]);
        const end = [...container.querySelectorAll("[data-toolbar-item][data-toolbar-end]")].map((el) => el.getAttribute("data-toolbar-item"));
        expect(end).toEqual(["record-summary"]);
        // The rail holds the rows' fields; their range is the window, the date navigator's — no chip of the rail.
        const chips = [...container.querySelectorAll("[data-toolbar-item='record-slices'] [data-record-slice-field]")]
            .map((el) => `${el.getAttribute("data-record-slice-source")}.${el.getAttribute("data-record-slice-field")}`);
        expect(chips).toEqual(["rows.owner", "rows.hall"]);
        expect(container.querySelector("[data-toolbar-item='time-navigation'] [data-time-navigation='plan']")).not.toBeNull();
        // The window holds every row: the summary names none; a narrowing that hides some names them, in the Plan's words (#1358).
        expect(container.querySelector("[data-toolbar-item='record-summary']")!.textContent).toBe("");
        act(() => { parts.rowsPart!.choose("owner", [printFor(StringType)("Team A")]); });
        expect(container.querySelector("[data-toolbar-item='record-summary']")!.textContent).toBe("1 of 2 rows");
        // A Plan approves and rejects nothing (#1260): no review item, no batch verbs.
        expect(container.querySelector('[data-toolbar-item="review"], [data-review-batch]')).toBeNull();
        // The history item leaves the session's error to the frame's banners.
        const history = historyProps();
        history.session.error = "Refused by the host";
        cleanup();
        const errored = render(<ChakraProvider value={system}><Harness parts={{ history }} /></ChakraProvider>);
        expect(errored.container.querySelector('[data-toolbar-item="history"] [data-slot="history"]')).not.toBeNull();
        expect(errored.container.querySelector('[role="alert"]')).toBeNull();
    });

    test("a narrowing row folds the rail first, then its summary; the date navigator compacts, the resolution and the fold toggle shorten, the three fold into the navigator's View, and the history folds last (PB21)", async () => {
        const start = new Map([["record-slices", 0], ["record-summary", 0], ["groups", 0], ["time-navigation", 0], ["resolution", 0], ["history", 0]]);
        const c = walk(everything(), start, LADDER);
        // Folded all the way: the rail's icon, no summary, the navigator's View, and the history's buttons alone.
        expect(c.querySelector("[data-toolbar-item='record-slices'] [data-rail-rung='icon']")).not.toBeNull();
        expect(c.querySelector("[data-toolbar-item='record-summary']")).toBeNull();
        expect(c.querySelector("[data-toolbar-item='groups'], [data-toolbar-item='resolution'], [data-plan-seg='resolution']")).toBeNull();
        expect(c.querySelector("[data-history-form='buttons']")).not.toBeNull();
        const view = c.querySelector<HTMLElement>("[data-toolbar-item='time-navigation'] [data-time-trigger]")!;
        expect(markOf(view)).toBe("fas calendar-week");
        // The View holds the fold toggle and the resolution, a click away.
        await userEvent.setup().click(view);
        const popover = await screen.findByRole("dialog");
        const toggle = popover.querySelector("[data-plan-fold-all]")!;
        expect(toggle.getAttribute("aria-label")).toBe("Expand all");
        expect(markOf(toggle)).toBe("fas angles-down Expand all");
        expect(within(popover).getByRole("radiogroup", { name: "Resolution" }).getAttribute("data-plan-seg")).toBe("compact-resolution");
    });

    test("the rail's summary folds after every step of the rail; its Filters editor keeps the count of what a narrowing hides (#1340, #1358)", async () => {
        // The rail at its icon, the summary folded: the Plan's own items at their widest; an owner chosen.
        const folded = new Map([["record-slices", 4], ["record-summary", 1], ["groups", 0], ["time-navigation", 0], ["resolution", 0], ["history", 0]]);
        row.px = needs(folded);
        const parts = everything();
        parts.rowsPart!.choose("owner", [printFor(StringType)("Team A")]);
        const { container } = render(<ChakraProvider value={system}><Harness parts={parts} /></ChakraProvider>);
        expect(stateOf(container)).toEqual(folded);
        await userEvent.setup().click(container.querySelector("[data-toolbar-item='record-slices'] [data-slot='railTrigger']")!);
        const editor = await screen.findByRole("dialog");
        expect(editor.querySelector("[data-record-slices-summary]")!.textContent).toBe("1 of 2 rows");
    });

    test("on a seekable source the key search follows the rail and its summary; it folds to its icon after them, before the history (PB21)", () => {
        const seekable = { ...everything(), search: SEARCH };
        row.px = 4000;
        const wide = render(<ChakraProvider value={system}><Harness parts={seekable} /></ChakraProvider>);
        // After the rail's narrowing and before the fold toggle, in §7.1's order; its box with room.
        expect([...stateOf(wide.container).keys()]).toEqual(["record-slices", "record-summary", "seek", "groups", "time-navigation", "resolution", "history"]);
        expect(wide.container.querySelector('[data-toolbar-item="seek"] [data-part="dataset-key-search"]')).not.toBeNull();
        cleanup();
        const c = walk({ search: SEARCH, history: historyProps() }, new Map([["seek", 0], ["history", 0]]), SEEK_LADDER);
        // The key search's icon, named in the Plan's words; no box.
        expect(c.querySelector("[data-toolbar-item='seek'] [data-key-search='icon']")!.getAttribute("aria-label")).toBe("Search Records");
        expect(c.querySelector("[data-part='dataset-key-search']")).toBeNull();
        expect(c.querySelector("[data-history-form='buttons']")).not.toBeNull();
    });

    test("on a time axis the overlaps chip shortens after the date navigator compacts, and folds into its View with the fold toggle and the resolution, one move; the View's chip selects the first pair (#1198, #1344)", async () => {
        const pair = onePair();
        const selected: (readonly string[])[] = [];
        const parts: ChromeParts = { ...everything(), selectEvents: (keys) => { selected.push(keys); } };
        const start = new Map([["record-slices", 0], ["record-summary", 0], ["groups", 0], ["time-navigation", 0], ["resolution", 0], ["overlaps", 0], ["history", 0]]);
        const c = walk(parts, start, OVERLAPS_LADDER, pair);
        // Folded all the way: no chip in the row; the View holds it, beside the fold toggle and the resolution.
        expect(c.querySelector("[data-toolbar-item='overlaps'], [data-plan-overlaps]")).toBeNull();
        await userEvent.setup().click(c.querySelector<HTMLElement>("[data-toolbar-item='time-navigation'] [data-time-trigger]")!);
        const popover = await screen.findByRole("dialog");
        expect(popover.querySelector("[data-plan-fold-all]")).not.toBeNull();
        const chip = popover.querySelector<HTMLElement>("[data-plan-overlaps]")!;
        expect(chip.textContent).toBe("1 overlap");
        expect(chip.getAttribute("aria-label")).toBe("1 overlap — select the first pair");
        fireEvent.click(chip);
        expect(selected).toEqual([[scheduleEventKey(pair.pairs[0]!.first), scheduleEventKey(pair.pairs[0]!.second)]]);
    });

    test("on a number axis the leading source's range is a chip of the rail, and another source's range follows it, out of the rail; no date navigator", () => {
        initializeStore(new UIStore());
        const orders = recordPart({ key: "plan.toolbar.number.orders", range: { id: "day", kind: "integer", label: "Day", values: [1, 2] }, window: [1, 9] });
        const vans = recordPart({ key: "plan.toolbar.number.vans", range: { id: "day", kind: "float", label: "Day", values: [1.5] }, window: [1, 9] });
        const slices = recordSlices("plan.toolbar.number", [{ source: "orders", slice: orders }, { source: "vans", slice: vans }], ["fields"]);
        row.px = 4000;
        const { container } = render(<ChakraProvider value={system}><Harness parts={{
            scale: STEPS, slices, windowParts: [{ source: "orders", part: orders }, { source: "vans", part: vans }],
            lead: { source: "orders", part: orders }, affordances: ["fields"],
        }} /></ChakraProvider>);
        const chips = [...container.querySelectorAll("[data-toolbar-item='record-slices'] [data-record-slice-field]")]
            .map((el) => `${el.getAttribute("data-record-slice-source")}.${el.getAttribute("data-record-slice-field")}`);
        expect(chips).toEqual(["orders.day"]);
        expect(container.querySelector("[data-toolbar-item='time-navigation']")).toBeNull();
    });

    test("the overlaps chip shortens to its glyph and its count, its name the whole words; a click selects both events of the first pair (#1198, PB52)", () => {
        const pair = onePair();
        const selected: (readonly string[])[] = [];
        const parts: ChromeParts = { selectEvents: (keys) => { selected.push(keys); } };
        const chip = () => ui.container.querySelector<HTMLElement>("[data-plan-overlaps]")!;
        row.px = 110;
        const ui = render(<ChakraProvider value={system}><Harness parts={parts} overlaps={pair} /></ChakraProvider>);
        expect(stateOf(ui.container).get("overlaps")).toBe(0);
        expect(chip().getAttribute("data-plan-overlaps")).toBe("");
        expect(chip().textContent).toBe("1 overlap");
        row.px = 109;
        ui.rerender(<ChakraProvider value={system}><Harness parts={parts} overlaps={pair} /></ChakraProvider>);
        expect(stateOf(ui.container).get("overlaps")).toBe(1);
        expect(chip().getAttribute("data-plan-overlaps")).toBe("short");
        expect(chip().textContent).toBe("1");
        expect(chip().getAttribute("aria-label")).toBe("1 overlap — select the first pair");
        fireEvent.click(chip());
        expect(selected).toEqual([[scheduleEventKey(pair.pairs[0]!.first), scheduleEventKey(pair.pairs[0]!.second)]]);
    });

    test("a canvas with no slice, no group to fold, no overlaps and no editing has no items", () => {
        row.px = 4000;
        const { container } = render(<ChakraProvider value={system}><Harness parts={{}} /></ChakraProvider>);
        expect(container.querySelector("[data-toolbar-item]")).toBeNull();
    });
});
