/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's toolbar items on its frame's one row under width pressure
 * (#1245, `Flowchart Builder Spec.md` §7.1, FB8, FB9; `Flowchart Records
 * Spec.md` R4, R17, R42): one ladder over its items — the rail over its
 * `Slice.bindRecords` first (#1346), in the rail's order (its search field,
 * its field, the terminal chip, the icon), then its summary, then the
 * flowchart's own: the freshness chip goes, LR · TD folds into its one chip,
 * find state's box folds to its icon, and last the zoom's strip and LR · TD
 * fold into find state's popover, the View, one move, so a phone's row keeps
 * the rail. The zoom's strip — Zoom out, Zoom in and Fit (#1519) — says its
 * words and is off where the zoom stands at either end; on a phone, the View
 * is a button beside Search Records, holding it. jsdom lays nothing out,
 * so each item's width is stubbed by the form it shows, every fold giving room
 * back; the gap is 10px. The rail is decoded wire values over the shared
 * store: the states' source's part — the source named after the kind it
 * narrows (R4) — as the shared rail's own tests build one, and as the
 * Schematic's toolbar test builds its own.
 */

import { describe, test, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { act, render, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { StringType, decodeBeast2For, encodeBeast2For, none, printFor, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import {
    RecordSliceConfigType, RecordSliceStateType, recordChoiceWhere,
    type RecordSliceBindType, type RecordSliceChoiceType, type RecordSliceFieldType, type RecordSlicesChromeType,
} from "@elaraai/east-ui/internal";
import { system, UIStore, Toolbar, type KeySearchSource, type ToolbarItem } from "@elaraai/east-ui-components";
import { getStore, initializeStore, trackKey } from "@elaraai/east-ui-components/internal";
import { words } from "./rows.test-utils.js";
import type { ZoomRange } from "../shared/schedule/zoom.js";
import { useFlowchartToolbarItems, type FlowchartToolbarProps } from "./toolbar.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver; the toolbar observes its row and items through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/** The stubbed layout: the toolbar row's box. */
const row = { px: 0 };

/** Each item's width in each of its forms, widest first (a hidden form has no box). */
const FORM_PX: Record<string, readonly number[]> = {
    seek: [200, 44, 44],
    orientation: [80, 56],
    zoom: [96],
    freshness: [150],
    "record-slices": [300, 240, 160, 110, 40],
    "record-summary": [120],
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

type Bind = ValueTypeOf<RecordSliceBindType>;
type State = ValueTypeOf<RecordSliceStateType>;
type Field = ValueTypeOf<RecordSliceFieldType>;
const encodeState = encodeBeast2For(RecordSliceStateType);
const decodeState = decodeBeast2For(RecordSliceStateType);
const printText = printFor(StringType);

/** The rail's key, and its states' source's under it. */
const RAIL = "flowchart.toolbar.ladder";
const STATES_KEY = `${RAIL}.states`;

/** A String field: searched by its values with none of its own, or offering the hints given. */
const field = (fieldId: string, label: string, hints: readonly string[]): Field => ({
    fieldId, label, kind: "string", optional: false, multiple: true, set: false,
    values: hints.map((hint) => ({ value: printText(hint), label: hint })), format: none,
});

/**
 * The `states` source's part, over the shared store: its name searched, its
 * flow chosen from its hints — what the rail mounts; 20 states, 7 of them
 * while a choice narrows it.
 */
function statesPart(): Bind {
    initializeStore(new UIStore());
    const fields = [field("name", "Name", []), field("flow", "Flow", ["Parcels", "Returns"])];
    const config = decodeBeast2For(RecordSliceConfigType)(encodeBeast2For(RecordSliceConfigType)({
        fields, indexes: fields.map((f) => ({ name: f.fieldId, fields: [f.fieldId], sets: new Set<string>(), structured: false, interval: none, area: none, series: none, summary: none, entries: false })),
        range: none, search: ["name"], presets: [],
    }));
    getStore().write(STATES_KEY, encodeState({ where: new Map(), preset: none, resolution: none }));
    const read = (): State => { trackKey(STATES_KEY); return decodeState(getStore().read(STATES_KEY)!); };
    const write = (state: State) => { getStore().write(STATES_KEY, encodeState(state)); return null; };
    const choose = (id: string, choice: ValueTypeOf<RecordSliceChoiceType> | undefined) => {
        const where = recordChoiceWhere(config.indexes, read().where, id, choice);
        if (where === null) throw new Error("Choose a preceding field");
        return write({ ...read(), where, preset: none });
    };
    const clearAll = () => write({ ...read(), where: new Map(), preset: none });
    return {
        key: STATES_KEY, config, sourceId: "states", read, write,
        choose: (id, values) => choose(id, values.length === 0 ? undefined : variant("values", values)),
        range: (id, from, to) => choose(id, variant("range", { from, to })), prefix: (id, value) => choose(id, variant("prefix", value)),
        clear: (id) => choose(id, undefined), clearAll,
        count: () => some(read().where.size === 0 ? 20n : 7n), countWhere: () => some(7n), total: () => some(20n), domain: () => none, suggest: () => none,
        values: (id) => config.fields.find((f) => f.fieldId === id)!.values.map((value) => ({ ...value, selected: false, count: some(3n), error: none })),
        replaces: () => [], togglePreset: () => null, setResolution: (resolution) => write({ ...read(), resolution }), retry: () => null,
        readEntry: () => some(none), contains: () => some(false), containsRow: () => some(false),
    };
}

/** The rail over the flowchart's `Slice.bindRecords`: its states' source, its fields and its summary. */
function chrome(): ValueTypeOf<typeof RecordSlicesChromeType> {
    const part = statesPart();
    return {
        slice: { key: RAIL, parts: [{ source: "states", label: none, icon: none, slice: part }], presets: [],
            clearAll: () => { part.clearAll(); return null; }, togglePreset: () => null },
        affordances: [variant("fields", null), variant("summary", null)],
        persist: none,
    };
}

/** Find state over the states — the toolbar mounts it; nothing here searches. */
const FIND: KeySearchSource = {
    resetKey: "flowchart", keyType: toEastTypeValue(StringType),
    find: async () => ({ found: false, row: 0, count: 0 }), listRange: async () => [], jump: () => {}, clear: () => {},
};

/** What the items take, but for the recipe's styles. */
type Parts = Omit<FlowchartToolbarProps, "styles">;

/** The zoom between its ends: Zoom out and Zoom in both on. */
const ZOOMED: ZoomRange = { atFit: false, atLimit: false };

/** A flowchart with everything on its toolbar: find state, LR · TD, the zoom, the freshness chip and the rail, its states counted in the kind's noun. */
function everything(): Parts {
    return {
        find: FIND, orientation: "LR", onOrientation: () => {},
        freshness: { label: "scans-2026.09", date: undefined },
        chrome: chrome(), nouns: { states: words.m.kindNoun({ sort: "states", n: 2 }) }, words,
        zoom: ZOOMED, onZoom: () => {}, onFit: () => {},
    };
}

/** The flowchart's items on the frame's one row, as its frame lays them out. */
function Harness({ parts }: { parts: Parts }) {
    const styles = useSlotRecipe({ key: "flowchart" })() as Record<string, SystemStyleObject>;
    return <Toolbar items={useFlowchartToolbarItems({ styles, ...parts })} />;
}

/** Each item's form of its forms, as the toolbar says it folded them, in the row's order. */
function stateOf(container: HTMLElement): Map<string, number> {
    const text = container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-state")!;
    return new Map(text.split(";").map((part) => {
        const [key, of] = part.split("=");
        return [key!, Number(of!.split("/")[0])] as const;
    }));
}

/** One step of the ladder: the items it folds, each to the form it leaves it in. */
type Step = ReadonlyArray<readonly [string, number]>;

/** The flowchart's ladder, step by step: the rail's (its search field, its field, the terminal chip, the icon), its
 *  summary, then its own — the freshness chip, LR · TD, find state — and last the zoom's strip and LR · TD into find
 *  state's popover, the View, one move. */
const LADDER: readonly Step[] = [
    [["record-slices", 1]], [["record-slices", 2]], [["record-slices", 3]], [["record-slices", 4]],
    [["record-summary", 1]],
    [["freshness", 1]], [["orientation", 1]], [["seek", 1]],
    [["seek", 2], ["orientation", 2], ["zoom", 1]],
];

/** The row a configuration needs: every drawn form's width, and a 10px gap between drawn items. */
function needs(forms: ReadonlyMap<string, number>): number {
    const drawn = [...forms].flatMap(([key, form]) => {
        const px = FORM_PX[key]![form];
        return px === undefined ? [] : [px];
    });
    return drawn.reduce((a, b) => a + b, 0) + 10 * Math.max(0, drawn.length - 1);
}

/** Walks the ladder: each configuration on it holds in exactly the row it needs,
 *  and a pixel less takes the next step — and only that one. */
function walk(parts: Parts, start: ReadonlyMap<string, number>, ladder: readonly Step[]) {
    let forms = new Map(start);
    row.px = needs(forms);
    const ui = render(<ChakraProvider value={system}><Harness parts={parts} /></ChakraProvider>);
    expect(stateOf(ui.container)).toEqual(forms);
    const at = (px: number) => {
        row.px = px;
        ui.rerender(<ChakraProvider value={system}><Harness parts={parts} /></ChakraProvider>);
        return stateOf(ui.container);
    };
    for (const step of ladder) {
        const room = needs(forms);
        expect(at(room), `${room}px`).toEqual(forms);
        forms = new Map(forms);
        for (const [key, form] of step) forms.set(key, form);
        expect(at(room - 1), `${room - 1}px, the step ${step.map(([key, form]) => `${key}→${form}`).join(" ")}`).toEqual(forms);
    }
    return ui.container;
}

describe("the Flowchart's toolbar items (#1245)", () => {
    test("they are one row in §7.1's order: find state, LR · TD, the zoom and the freshness chip at its start, the rail and its summary at its end (FB8, #1346, R42)", () => {
        row.px = 4000;
        const { container } = render(<ChakraProvider value={system}><Harness parts={everything()} /></ChakraProvider>);
        expect([...stateOf(container).keys()]).toEqual(["seek", "orientation", "zoom", "freshness", "record-slices", "record-summary"]);
        const end = [...container.querySelectorAll("[data-toolbar-item][data-toolbar-end]")].map((el) => el.getAttribute("data-toolbar-item"));
        expect(end).toEqual(["record-summary"]);
        // Each in its widest form: find state's box, LR · TD's strip, the chip, each of the rail's fields.
        expect(container.querySelector("[data-toolbar-item='seek'] [data-part='dataset-key-search']")).not.toBeNull();
        expect(container.querySelector("[data-toolbar-item='orientation'] [data-flowchart-seg='orientation']")).not.toBeNull();
        expect(container.querySelector("[data-toolbar-item='zoom'] [data-flowchart-zoom]")).not.toBeNull();
        expect(container.querySelector("[data-toolbar-item='freshness'] [data-flowchart-freshness]")!.textContent).toBe("scans-2026.09");
        expect([...container.querySelectorAll("[data-toolbar-item='record-slices'] [data-record-slice-field]")].map((chip) => chip.getAttribute("data-record-slice-field")))
            .toEqual(["name", "flow"]);
        // Nothing narrows the states: the summary names no source; a narrowing that hides some of them names them, counted in the kind's noun (#1358).
        expect(container.querySelector("[data-toolbar-item='record-summary'] [data-record-slices-summary]")).toBeNull();
        act(() => { getStore().write(STATES_KEY, encodeState({ where: new Map([["flow", variant("values", [printText("Parcels")])]]), preset: none, resolution: none })); });
        expect(container.querySelector("[data-toolbar-item='record-summary'] [data-record-slices-summary]")!.textContent).toBe("7 of 20 states");
    });

    test("a narrowing row folds the rail first, in its order, then its summary; then the freshness chip goes, LR · TD folds into its chip, find state into its icon, and last the zoom's strip and LR · TD into find state's popover, the View (FB9, #1346, R42)", () => {
        const start = new Map([["seek", 0], ["orientation", 0], ["zoom", 0], ["freshness", 0], ["record-slices", 0], ["record-summary", 0]]);
        const c = walk(everything(), start, LADDER);
        // Folded all the way: the rail's icon, no summary and no freshness chip, find state's popover holding LR · TD and the zoom.
        expect(c.querySelector("[data-toolbar-item='record-slices'] [data-rail-rung='icon']")).not.toBeNull();
        expect(c.querySelector("[data-record-slices-summary]")).toBeNull();
        expect(c.querySelector("[data-flowchart-freshness]")).toBeNull();
        expect(c.querySelector("[data-flowchart-seg], [data-flowchart-segmenu], [data-flowchart-zoom]")).toBeNull();
        expect(c.querySelector("[data-toolbar-item='seek'] [data-key-search='icon']")!.getAttribute("aria-label")).toBe("View");
        expect(c.querySelector("[data-part='dataset-key-search']")).toBeNull();
    });

    test("with no rail, LR · TD folds into its chip, its caret Font Awesome's, and find state into its icon, named for it", () => {
        const start = new Map([["seek", 0], ["orientation", 0], ["zoom", 0], ["freshness", 0]]);
        const c = walk({ ...everything(), chrome: undefined }, start, [[["freshness", 1]], [["orientation", 1]], [["seek", 1]]]);
        // The chip says its orientation and no more: its caret is Font Awesome's solid caret-down, never a glyph.
        expect(c.querySelector("[data-flowchart-segmenu='orientation']")!.textContent).toBe("LR");
        expect(c.querySelector("[data-flowchart-segmenu='orientation'] svg[data-chip-caret][data-prefix='fas'][data-icon='caret-down']")).not.toBeNull();
        expect(c.querySelector("[data-flowchart-seg]")).toBeNull();
        expect(c.querySelector("[data-toolbar-item='seek'] [data-key-search='icon']")!.getAttribute("aria-label")).toBe("Find state");
    });

    test("with no rail, the zoom's strip folds last into find state's View alone: LR · TD keeps its chip (R42)", () => {
        const start = new Map([["seek", 0], ["orientation", 0], ["zoom", 0], ["freshness", 0]]);
        const c = walk({ ...everything(), chrome: undefined }, start, [[["freshness", 1]], [["orientation", 1]], [["seek", 1]], [["seek", 2], ["zoom", 1]]]);
        expect(c.querySelector("[data-flowchart-zoom]")).toBeNull();
        expect(c.querySelector("[data-flowchart-segmenu='orientation']")!.textContent).toBe("LR");
        expect(c.querySelector("[data-toolbar-item='seek'] [data-key-search='icon']")!.getAttribute("aria-label")).toBe("View");
    });

    test("over a flowchart with no state to seek there is no find state, and with no slice or freshness LR · TD and the zoom are the row, the zoom's strip never folding (R42)", () => {
        row.px = 4000;
        const parts: Parts = { find: undefined, orientation: "TD", onOrientation: () => {}, freshness: undefined, words, zoom: ZOOMED, onZoom: () => {}, onFit: () => {} };
        const ui = render(<ChakraProvider value={system}><Harness parts={parts} /></ChakraProvider>);
        expect([...stateOf(ui.container).keys()]).toEqual(["orientation", "zoom"]);
        expect(ui.container.querySelector("[data-flowchart-seg='orientation'] [aria-checked='true']")!.textContent).toBe("TD");
        // With nowhere to fold into, the strip stays however short the row.
        row.px = 60;
        ui.rerender(<ChakraProvider value={system}><Harness parts={parts} /></ChakraProvider>);
        expect(stateOf(ui.container).get("zoom")).toBe(0);
        expect(ui.container.querySelector("[data-toolbar-item='zoom'] [data-flowchart-zoom]")).not.toBeNull();
    });
});

describe("the zoom's strip (#1519, R42)", () => {
    /** The strip's buttons, in their order. */
    const buttons = (c: HTMLElement): HTMLButtonElement[] => [...c.querySelectorAll<HTMLButtonElement>("[data-toolbar-item='zoom'] [data-flowchart-zoom] button")];

    test("Zoom out, Zoom in and Fit, one group named Zoom, each titled with its name and drawn with Font Awesome's solid minus, plus and expand; each zooms ×1.5 out or in, or fits", () => {
        row.px = 4000;
        const asked: string[] = [];
        const parts: Parts = { ...everything(), onZoom: (factor) => asked.push(`zoom ${factor}`), onFit: () => asked.push("fit") };
        const { container } = render(<ChakraProvider value={system}><Harness parts={parts} /></ChakraProvider>);
        const strip = container.querySelector("[data-toolbar-item='zoom'] [data-flowchart-zoom]")!;
        expect([strip.getAttribute("role"), strip.getAttribute("aria-label")]).toEqual(["group", "Zoom"]);
        expect(buttons(container).map((b) => [b.getAttribute("aria-label"), b.getAttribute("title")])).toEqual([["Zoom out", "Zoom out"], ["Zoom in", "Zoom in"], ["Fit", "Fit"]]);
        expect(buttons(container).map((b) => b.querySelector("svg[data-prefix='fas']")?.getAttribute("data-icon"))).toEqual(["minus", "plus", "expand"]);
        for (const b of buttons(container)) fireEvent.click(b);
        expect(asked).toEqual([`zoom ${1 / 1.5}`, "zoom 1.5", "fit"]);
    });

    test("Zoom out is off at Fit, Zoom in at the cards' own size — both on a flowchart that fits — and Fit is on at any zoom", () => {
        row.px = 4000;
        const at = (zoom: ZoomRange) => {
            const { container, unmount } = render(<ChakraProvider value={system}><Harness parts={{ ...everything(), zoom }} /></ChakraProvider>);
            const off = buttons(container).map((b) => b.disabled);
            unmount();
            return off;
        };
        expect(at({ atFit: false, atLimit: false })).toEqual([false, false, false]);
        expect(at({ atFit: true, atLimit: false })).toEqual([true, false, false]);
        expect(at({ atFit: false, atLimit: true })).toEqual([false, true, false]);
        expect(at({ atFit: true, atLimit: true })).toEqual([true, true, false]);
    });

    /** What a phone's frame draws of each item: its one phone form where it has one, its widest form otherwise (`BuilderFrame`). */
    function PhoneRow({ parts }: { parts: Parts }) {
        const styles = useSlotRecipe({ key: "flowchart" })() as Record<string, SystemStyleObject>;
        const items = useFlowchartToolbarItems({ styles, ...parts }).filter((item): item is ToolbarItem => item !== false && item !== undefined);
        return <>{items.map((item) => <div key={item.key} data-phone-item={item.key}>{item.phone === undefined ? item.forms[0] : item.phone.form}</div>)}</>;
    }

    test("on a phone, find state's Search Records keeps a View beside it, holding the zoom's strip and — with a rail — LR · TD, which leave the row", async () => {
        const { container } = render(<ChakraProvider value={system}><PhoneRow parts={everything()} /></ChakraProvider>);
        expect(container.querySelector("[data-phone-item='zoom']")!.childElementCount).toBe(0);
        expect(container.querySelector("[data-phone-item='orientation']")!.childElementCount).toBe(0);
        const view = container.querySelector<HTMLElement>("[data-phone-item='seek'] [data-phone-view]")!;
        expect(view.getAttribute("aria-label")).toBe("View");
        await act(async () => { fireEvent.click(view); });
        const controls = document.querySelector("[data-flowchart-view]")!;
        expect(controls.querySelector("[data-flowchart-seg='orientation']")).not.toBeNull();
        expect([...controls.querySelectorAll("[data-flowchart-zoom] button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Zoom out", "Zoom in", "Fit"]);
    });

    test("on a phone with no rail, the View holds the zoom's strip alone, and LR · TD keeps its place in the row", async () => {
        const { container } = render(<ChakraProvider value={system}><PhoneRow parts={{ ...everything(), chrome: undefined }} /></ChakraProvider>);
        expect(container.querySelector("[data-phone-item='zoom']")!.childElementCount).toBe(0);
        expect(container.querySelector("[data-phone-item='orientation'] [data-flowchart-seg='orientation']")).not.toBeNull();
        await act(async () => { fireEvent.click(container.querySelector<HTMLElement>("[data-phone-item='seek'] [data-phone-view]")!); });
        const controls = document.querySelector("[data-flowchart-view]")!;
        expect(controls.querySelector("[data-flowchart-seg]")).toBeNull();
        expect(controls.querySelector("[data-flowchart-zoom]")).not.toBeNull();
    });
});
