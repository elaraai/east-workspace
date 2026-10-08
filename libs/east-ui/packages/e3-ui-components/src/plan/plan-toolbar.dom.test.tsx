/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan's toolbar items on its frame's one row under width pressure (#952,
 * #1193, PB20, PB21): one ladder over its items — the slice rail's two
 * clusters first, in the rail's order (search, the range, the filter builder,
 * the terminal chip, the icon), then the Plan's own (the user's decision): the
 * summary shortens to its count; the resolution segment folds into its menu,
 * then the grain segment, the summary hides; the key search folds into its
 * icon; the history item folds last, to its buttons. A segment's menu chip
 * draws Font Awesome's caret (#1263). jsdom lays nothing out,
 * so each item's width is stubbed by the form it shows, every fold giving room
 * back; the gap is 10px.
 */

import { describe, test, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider, useSlotRecipe } from "@chakra-ui/react";
import { IntegerType, StringType, StructType, toEastTypeValue, variant, some, none } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import {
    system, formatters, EditSession, editingMessages, buildSliceHandle, UIStore, Toolbar, type HistoryBarProps,
} from "@elaraai/east-ui-components";
import { markOf, sliceConfig } from "@elaraai/east-ui-components/testing";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { usePlanToolbarItems } from "./shell/Toolbar.js";
import type { PlanChrome } from "./root/chrome.js";
import type { PlanEventItemValue, PlanOverlaps } from "./frame/counts.js";
import { scheduleEventKey, scheduleOverlaps } from "../shared/schedule/overlaps.js";
import type { PlanEntryRef } from "./use-plan-editing.js";
import type { PlanScale } from "./scale.js";
import { PLAN_WORDS } from "./words.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver; the toolbar observes its row and items through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/** The stubbed layout: the toolbar row's box. */
const row = { px: 0 };

/** Each item's width in each of its forms, widest first (a hidden form has no box). */
const FORM_PX: Record<string, readonly number[]> = {
    cluster: [300, 240, 160, 110, 40],
    seek: [200, 44],
    grain: [170, 90],
    range: [200, 80],
    resolution: [150, 80],
    summary: [260, 120],
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
const W39 = new Date("2026-09-21T00:00:00Z");

/** A slice over two dated rows, with nothing narrowed. */
function sliceHandle(): PlanChrome["slice"] {
    initializeStore(new UIStore());
    const cfg = sliceConfig({
        at: variant("datetime", { label: "At", accessor: (r: { at: Date }) => r.at, format: none }),
    }, { rangeFieldId: some("at") });
    const initial = {
        range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none,
        resolution: some(variant("week", null)),
    };
    return buildSliceHandle("plan.toolbar.ladder", cfg, initial as never,
        [{ at: W27 }, { at: W39 }] as never, none) as never;
}

/** The scale the toolbar reads its resolution from — the only part of it the items read. */
const WEEKLY = { resolution: "week" } as unknown as PlanScale;

/** A key search over a seekable source's String keys — the toolbar mounts it; nothing here searches. */
const SEARCH: NonNullable<PlanChrome["search"]> = {
    resetKey: "r1", keyType: toEastTypeValue(StringType),
    find: async () => ({ found: false, row: 0, count: 0 }), listRange: async () => [], jump: () => {}, clear: () => {},
};

/** An editing session's history bar props. */
function historyProps(): HistoryBarProps<PlanEntryRef> {
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
    const styles = useSlotRecipe({ key: "plan" })() as unknown as Record<string, Record<string, unknown>>;
    const chrome: PlanChrome = {
        words: PLAN_WORDS, styles, storageKey: "plan.toolbar", scale: WEEKLY,
        slice: undefined, affordances: [], resolutions: [], grain: undefined, transport: undefined, search: undefined,
        diagnostics: { skipped: 0 },
        history: undefined, where: (issue) => issue.entry, footer: [], id: undefined, narrow: false,
        // The inspector's reads: the toolbar takes none.
        inspect: { row: () => undefined, valueAt: () => undefined },
        // The overlaps chip's selection (#1198): its own test hears it.
        selectEvents: () => {},
        ...parts,
    };
    return <Toolbar items={usePlanToolbarItems(chrome, overlaps)} />;
}

/** A canvas with a root group, a bound slice, every chrome affordance and editing. */
function everything(slice: PlanChrome["slice"]): ChromeParts {
    return {
        slice, affordances: ["filter", "search", "range", "resolution", "summary"], resolutions: ["week", "day"], grain: "group",
        history: historyProps(),
    };
}

/** Each item's form of its forms, as the toolbar says it folded them, in the row's order. */
function stateOf(container: HTMLElement): Map<string, number> {
    const text = container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-state")!;
    return new Map(text.split(";").map((part) => {
        const [key, of] = part.split("=");
        return [key!, Number(of!.split("/")[0])] as const;
    }));
}

/** The Plan's ladder, step by step: the rail's (search, the range, the filter
 *  builder, the terminal chip, the icon), then the Plan's own, the history last. */
const LADDER: ReadonlyArray<readonly [string, number]> = [
    ["cluster", 1], ["range", 1], ["cluster", 2], ["cluster", 3], ["cluster", 4],
    ["summary", 1], ["resolution", 1], ["grain", 1], ["summary", 2], ["history", 1],
];

/** A seekable canvas's ladder, its key search in it: the key search's step,
 *  then the history's. */
const SEEK_LADDER: ReadonlyArray<readonly [string, number]> = [["seek", 1], ["history", 1]];

/** Walks a ladder: each configuration on it holds in exactly the row it needs,
 *  and a pixel less takes the next step — and only that one. */
function walk(parts: ChromeParts, start: ReadonlyMap<string, number>, ladder: ReadonlyArray<readonly [string, number]>) {
    let forms = new Map(start);
    row.px = needs(forms);
    const ui = render(<ChakraProvider value={system}><Harness parts={parts} /></ChakraProvider>);
    expect(stateOf(ui.container)).toEqual(forms);
    const at = (px: number) => {
        row.px = px;
        ui.rerender(<ChakraProvider value={system}><Harness parts={parts} /></ChakraProvider>);
        return stateOf(ui.container);
    };
    for (const [key, form] of ladder) {
        const room = needs(forms);
        expect(at(room), `${room}px`).toEqual(forms);
        forms = new Map(forms).set(key, form);
        expect(at(room - 1), `${room - 1}px, the step ${key}→${form}`).toEqual(forms);
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

describe("the Plan's toolbar items (#952, #1193)", () => {
    test("they are one row in §7.1's order: the rail's narrowing, the grain, the range, the resolution; at the end the summary and the history (PB20)", () => {
        row.px = 4000;
        const { container } = render(<ChakraProvider value={system}><Harness parts={everything(sliceHandle())} /></ChakraProvider>);
        expect([...stateOf(container).keys()]).toEqual(["cluster", "grain", "range", "resolution", "summary", "history"]);
        const end = [...container.querySelectorAll("[data-toolbar-item][data-toolbar-end]")].map((el) => el.getAttribute("data-toolbar-item"));
        expect(end).toEqual(["summary"]);
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

    test("a narrowing row folds the rail first, in its order, then the summary shortens, the resolution then the grain fold into menus, the summary hides, and the history folds last (PB21)", () => {
        const start = new Map([["cluster", 0], ["grain", 0], ["range", 0], ["resolution", 0], ["summary", 0], ["history", 0]]);
        const c = walk(everything(sliceHandle()), start, LADDER);
        // Folded all the way: the rail's icon, the range's chip, both segments
        // as menus, no summary, and the history's buttons alone.
        expect(c.querySelector("[data-toolbar-item='cluster'] [data-rail-rung='icon']")).not.toBeNull();
        expect(c.querySelector("[data-plan-segmenu='resolution']")!.textContent).toContain("WEEK");
        expect(c.querySelector("[data-plan-segmenu='grain']")!.textContent).toContain("GROUP");
        // Each menu's chip: its segment's words and Font Awesome's caret, never a written ▾ (#1263).
        expect(["resolution", "grain"].map((name) => markOf(c.querySelector(`[data-plan-segmenu='${name}']`))))
            .toEqual(["fas caret-down WEEK", "fas caret-down GROUP"]);
        expect(c.querySelector("[data-plan-seg]")).toBeNull();
        expect(c.querySelector("[data-slot='toolbarSummary']")).toBeNull();
        expect(c.querySelector("[data-history-form='buttons']")).not.toBeNull();
    });

    test("on a seekable source the key search replaces the rail's search; it folds to its icon after the summary hides, before the history (PB21)", () => {
        const seekable = { ...everything(sliceHandle()), search: SEARCH };
        row.px = 4000;
        const wide = render(<ChakraProvider value={system}><Harness parts={seekable} /></ChakraProvider>);
        // After the rail's narrowing and before the grain, in §7.1's order; its box with room.
        expect([...stateOf(wide.container).keys()]).toEqual(["cluster", "seek", "grain", "range", "resolution", "summary", "history"]);
        expect(wide.container.querySelector('[data-toolbar-item="seek"] [data-part="dataset-key-search"]')).not.toBeNull();
        // The rail no longer offers a search of its own: one word, one meaning.
        expect(wide.container.querySelector('[data-toolbar-item="cluster"] [data-slice-fold="search"], [data-toolbar-item="cluster"] [title="Search"]')).toBeNull();
        cleanup();
        const c = walk({ search: SEARCH, history: historyProps() }, new Map([["seek", 0], ["history", 0]]), SEEK_LADDER);
        // The key search's icon, named in the Plan's words; no box.
        expect(c.querySelector("[data-toolbar-item='seek'] [data-key-search='icon']")!.getAttribute("aria-label")).toBe("Search keys");
        expect(c.querySelector("[data-part='dataset-key-search']")).toBeNull();
        expect(c.querySelector("[data-history-form='buttons']")).not.toBeNull();
    });

    test("the shortened summary is its count alone", () => {
        const slice = sliceHandle();
        // Past the rail's floor, with the summary's first step taken: the
        // full line (260) gives way to the count (120).
        row.px = 40 + 170 + 80 + 150 + 120 + 40;
        const { container } = render(<ChakraProvider value={system}><Harness parts={{
            slice, affordances: ["filter", "search", "range", "resolution", "summary"], resolutions: ["week", "day"], grain: "group",
        }} /></ChakraProvider>);
        expect(stateOf(container).get("summary")).toBe(1);
        expect(container.querySelector("[data-slot='toolbarSummary']")!.textContent).toBe("2 of 2");
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
