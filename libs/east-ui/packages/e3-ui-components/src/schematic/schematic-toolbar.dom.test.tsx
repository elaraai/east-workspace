/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic's toolbar items on its frame's one row under width pressure
 * (#1387, `Schematic Builder Spec.md` §6.1, SC24): one ladder over its items —
 * the rail over its `Slice.bindRecords` first, in the rail's order (its search
 * field, its filter field, the terminal chip, the icon), then its summary,
 * then the Schematic's own: the tools' strip drops its words for its icons,
 * Find's box folds to its icon, the strip folds into one chip naming the tool,
 * and last the tools, the zoom, Fit and the steps fold into Find's popover, the
 * View, one move — so a phone's row holds the rail's icon and the View. jsdom
 * lays nothing out, so each item's width is stubbed by the form it shows,
 * every fold giving room back; the gap is 10px. The rail is decoded wire
 * values over the shared store: one source's part, as the shared rail's own
 * tests build one.
 */

import { describe, test, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { act, render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { StringType, decodeBeast2For, encodeBeast2For, none, printFor, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import {
    RecordSliceConfigType, RecordSliceStateType, recordChoiceWhere,
    type RecordSliceBindType, type RecordSliceChoiceType, type RecordSliceFieldType, type RecordSlicesChromeType,
} from "@elaraai/east-ui/internal";
import { system, formatters, UIStore, Toolbar, type KeySearchSource } from "@elaraai/east-ui-components";
import { getStore, initializeStore, trackKey } from "@elaraai/east-ui-components/internal";
import { schematicMessages, type SchematicWords } from "./messages.js";
import { useSchematicToolbarItems, type SchematicToolbarProps } from "./toolbar.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver; the toolbar observes its row and items through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/** The stubbed layout: the toolbar row's box. */
const row = { px: 0 };

/** Each item's width in each of its forms, widest first (a hidden form has no box). */
const FORM_PX: Record<string, readonly number[]> = {
    "record-slices": [300, 240, 160, 110, 40],
    "record-summary": [120],
    tools: [330, 150, 90],
    zoom: [96],
    seek: [200, 44, 44],
    step: [64],
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

/** A String field: searched by its values with none of its own, or offering the hints given. */
const field = (fieldId: string, label: string, hints: readonly string[]): Field => ({
    fieldId, label, kind: "string", optional: false, multiple: true, set: false,
    values: hints.map((hint) => ({ value: printText(hint), label: hint })), format: none,
});

/**
 * The `racks` source's part, over the shared store: its name searched, its
 * hall chosen from its hints — what the rail mounts; 7 racks, 2 of them while
 * a choice narrows it.
 */
function racksPart(): Bind {
    initializeStore(new UIStore());
    const key = "schematic.toolbar.ladder.racks";
    const fields = [field("name", "Rack", []), field("hall", "Hall", ["Cage A", "Cage B"])];
    const config = decodeBeast2For(RecordSliceConfigType)(encodeBeast2For(RecordSliceConfigType)({
        fields, indexes: fields.map((f) => ({
            name: f.fieldId, fields: [f.fieldId], sets: new Set<string>(), structured: false, interval: none, area: none, series: none, summary: none,
        })),
        range: none, search: ["name"], presets: [],
    }));
    getStore().write(key, encodeState({ where: new Map(), preset: none, resolution: none }));
    const read = (): State => { trackKey(key); return decodeState(getStore().read(key)!); };
    const write = (state: State) => { getStore().write(key, encodeState(state)); return null; };
    const choose = (id: string, choice: ValueTypeOf<RecordSliceChoiceType> | undefined) => {
        const where = recordChoiceWhere(config.indexes, read().where, id, choice);
        if (where === null) throw new Error("Choose a preceding field");
        return write({ ...read(), where, preset: none });
    };
    const clearAll = () => write({ ...read(), where: new Map(), preset: none });
    return {
        key, config, sourceId: "racks", read, write,
        choose: (id, values) => choose(id, values.length === 0 ? undefined : variant("values", values)),
        range: (id, from, to) => choose(id, variant("range", { from, to })), prefix: (id, value) => choose(id, variant("prefix", value)),
        clear: (id) => choose(id, undefined), clearAll,
        count: () => some(read().where.size === 0 ? 7n : 2n), countWhere: () => some(2n), total: () => some(7n), domain: () => none, suggest: () => none,
        values: (id) => config.fields.find((f) => f.fieldId === id)!.values.map((value) => ({ ...value, selected: false, count: some(3n), error: none })),
        replaces: () => [], togglePreset: () => null, setResolution: (resolution) => write({ ...read(), resolution }), retry: () => null,
        readEntry: () => some(none), contains: () => some(false), containsRow: () => some(false),
    };
}

/** The rail over the Schematic's `Slice.bindRecords`: its one `racks` source, its fields and its summary. */
function chrome(): ValueTypeOf<typeof RecordSlicesChromeType> {
    const part = racksPart();
    return {
        slice: { key: "schematic.toolbar.ladder", parts: [{ source: "racks", label: none, icon: none, slice: part }], presets: [],
            clearAll: () => { part.clearAll(); return null; }, togglePreset: () => null },
        affordances: [variant("fields", null), variant("summary", null)],
        persist: none,
    };
}

/** Find over the items — the toolbar mounts it; nothing here searches. */
const FIND: KeySearchSource = {
    resetKey: "schematic", keyType: toEastTypeValue(StringType),
    find: async () => ({ found: false, row: 0, count: 0 }), listRange: async () => [], jump: () => {}, clear: () => {},
};

const WORDS: SchematicWords = { ...formatters("en-US"), m: schematicMessages };

/** What the items take, but for the recipe's styles. */
type Parts = Omit<SchematicToolbarProps, "styles">;

/** A Schematic with everything on its toolbar: the rail, every tool, Find, and something selected. */
function everything(over: Partial<Parts> = {}): Parts {
    return {
        words: WORDS, chrome: chrome(), nouns: { racks: "racks" },
        tools: ["select", "zoom", "marquee", "connect", "move"], held: { tool: "select", link: "fibre" },
        links: [{ key: "fibre", name: "Fibre run" }], onTools: () => {}, find: FIND,
        onZoom: () => {}, zoom: { atFit: false, atLimit: false }, onFit: () => {}, selected: true, onStep: () => {},
        ...over,
    };
}

/** The Schematic's items on the frame's one row, as its frame lays them out. */
function Harness({ parts }: { parts: Parts }) {
    const styles = useSlotRecipe({ key: "schematic" })() as Record<string, SystemStyleObject>;
    return <Toolbar items={useSchematicToolbarItems({ styles, ...parts })} />;
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

/** The Schematic's ladder, step by step: the rail's, its summary, then its own — the tools' words, Find's box, the tools' strip — and last
 *  the tools, the zoom, Find and the steps into the View, one move. */
const LADDER: readonly Step[] = [
    [["record-slices", 1]], [["record-slices", 2]], [["record-slices", 3]], [["record-slices", 4]],
    [["record-summary", 1]],
    [["tools", 1]], [["seek", 1]], [["tools", 2]],
    [["tools", 3], ["zoom", 1], ["seek", 2], ["step", 1]],
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

describe("the Schematic's toolbar items (#1387)", () => {
    test("they are one row in §6.1's order: the rail and its summary, the tools, the zoom and Fit, Find, and the steps while something is selected (SC24)", () => {
        row.px = 4000;
        const { container } = render(<ChakraProvider value={system}><Harness parts={everything()} /></ChakraProvider>);
        expect([...stateOf(container).keys()]).toEqual(["record-slices", "record-summary", "tools", "zoom", "seek", "step"]);
        // Each in its widest form: the tools named, the zoom's − / + and Fit, Find's box, the steps.
        const tools = container.querySelector("[data-toolbar-item='tools'] [data-schematic-tools='']")!;
        expect([...tools.querySelectorAll("[role=radio]")].map((radio) => radio.textContent)).toEqual(["Select", "Zoom box", "Marquee", "Connect", "Move"]);
        expect(tools.querySelector("[role=radio][aria-checked=true]")!.textContent).toBe("Select");
        expect([...container.querySelectorAll("[data-toolbar-item='zoom'] [data-schematic-zoom] button")].map((b) => b.getAttribute("aria-label")))
            .toEqual(["Zoom out", "Zoom in", "Fit"]);
        expect(container.querySelector("[data-toolbar-item='seek'] [data-part='dataset-key-search'] input")!.getAttribute("placeholder")).toBe("Find item");
        expect([...container.querySelectorAll("[data-toolbar-item='step'] [data-schematic-step] button")].map((b) => b.getAttribute("aria-label")))
            .toEqual(["Previous item", "Next item"]);
        // Every icon is Font Awesome's solid.
        for (const svg of container.querySelectorAll("[data-toolbar-item='tools'] svg, [data-toolbar-item='zoom'] svg, [data-toolbar-item='step'] svg")) {
            expect(svg.getAttribute("data-prefix")).toBe("fas");
        }
    });

    test("Zoom out takes no press at Fit, and Zoom in none at the zoom's limit; between them both zoom (#1393)", () => {
        row.px = 4000;
        const onZoom = vi.fn();
        const buttons = (zoom: Parts["zoom"]) => {
            cleanup();
            const { container } = render(<ChakraProvider value={system}><Harness parts={everything({ zoom, onZoom })} /></ChakraProvider>);
            const [out, into] = [...container.querySelectorAll<HTMLButtonElement>("[data-toolbar-item='zoom'] [data-schematic-zoom] button")];
            return { out: out!, into: into! };
        };
        const atFit = buttons({ atFit: true, atLimit: false });
        expect([atFit.out.disabled, atFit.into.disabled]).toEqual([true, false]);
        fireEvent.click(atFit.out);
        expect(onZoom).not.toHaveBeenCalled();
        const atLimit = buttons({ atFit: false, atLimit: true });
        expect([atLimit.out.disabled, atLimit.into.disabled]).toEqual([false, true]);
        fireEvent.click(atLimit.into);
        expect(onZoom).not.toHaveBeenCalled();
        const between = buttons({ atFit: false, atLimit: false });
        fireEvent.click(between.out);
        fireEvent.click(between.into);
        expect(onZoom.mock.calls.map(([factor]) => factor > 1)).toEqual([false, true]);
    });

    test("a narrowing row folds the rail first, then its summary; then the tools' words, Find's box and the tools' strip; last the View, one move (SC24)", () => {
        const start = new Map([["record-slices", 0], ["record-summary", 0], ["tools", 0], ["zoom", 0], ["seek", 0], ["step", 0]]);
        const c = walk(everything(), start, LADDER);
        // Folded all the way: the rail's icon and the View; no summary, no tools, no zoom and no steps of their own.
        expect(c.querySelector("[data-toolbar-item='record-slices'] [data-rail-rung='icon']")).not.toBeNull();
        expect(c.querySelector("[data-record-slices-summary]")).toBeNull();
        expect(c.querySelector("[data-schematic-tools], [data-schematic-segmenu], [data-schematic-zoom], [data-schematic-step]")).toBeNull();
        expect(c.querySelector("[data-toolbar-item='seek'] [data-key-search='icon']")!.getAttribute("aria-label")).toBe("View");
    });

    test("the tools' icons alone are named by their words, and the tools' chip names the tool held", () => {
        const start = new Map([["record-slices", 0], ["record-summary", 0], ["tools", 0], ["zoom", 0], ["seek", 0], ["step", 0]]);
        const c = walk(everything({ held: { tool: "marquee", link: "fibre" } }), start, LADDER.slice(0, 6));
        const icons = c.querySelector("[data-schematic-tools='icons']")!;
        expect([...icons.querySelectorAll("[role=radio]")].map((radio) => [radio.getAttribute("aria-label"), radio.textContent]))
            .toEqual([["Select", ""], ["Zoom box", ""], ["Marquee", ""], ["Connect", ""], ["Move", ""]]);
        row.px = needs(new Map([["record-slices", 4], ["record-summary", 1], ["tools", 2], ["zoom", 0], ["seek", 1], ["step", 0]]));
        const ui = render(<ChakraProvider value={system}><Harness parts={everything({ held: { tool: "marquee", link: "fibre" } })} /></ChakraProvider>);
        expect(ui.container.querySelector("[data-schematic-segmenu='tools']")!.textContent).toBe("Marquee");
    });

    test("the View holds the tools, icons named by their words, the zoom and Fit, and the steps; a tool picked there closes it", async () => {
        const onTools = vi.fn();
        row.px = needs(new Map([["record-slices", 4], ["record-summary", 1], ["tools", 3], ["zoom", 1], ["seek", 2], ["step", 1]]));
        const { container } = render(<ChakraProvider value={system}><Harness parts={everything({ onTools })} /></ChakraProvider>);
        const view = container.querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-key-search='icon']")!;
        await act(async () => { fireEvent.click(view); });
        const popover = await waitFor(() => {
            const found = document.querySelector<HTMLElement>("[data-schematic-view]");
            if (found === null) throw new Error("the View has not opened");
            return found;
        });
        expect([...popover.querySelectorAll("[data-schematic-seg='tools'] [role=radio]")].map((radio) => radio.getAttribute("aria-label")))
            .toEqual(["Select", "Zoom box", "Marquee", "Connect", "Move"]);
        expect(popover.querySelector("[data-schematic-zoom]")).not.toBeNull();
        expect(popover.querySelector("[data-schematic-step]")).not.toBeNull();
        // Find's box is in the View, under the controls.
        expect(document.querySelector("[data-key-search='popover'] [data-part='dataset-key-search']")).not.toBeNull();
        await act(async () => { fireEvent.click(popover.querySelector("[data-schematic-seg='tools'] [aria-label='Marquee']")!); });
        expect(onTools).toHaveBeenCalledWith({ tool: "marquee", link: "fibre" });
        await waitFor(() => expect(view.getAttribute("data-state")).toBe("closed"));
    });

    test("with nothing selected there are no steps; with no rail, the tools fold, then Find, then the View", () => {
        const parts = everything({ chrome: undefined, nouns: undefined, selected: false });
        const start = new Map([["tools", 0], ["zoom", 0], ["seek", 0]]);
        const c = walk(parts, start, [[["tools", 1]], [["seek", 1]], [["tools", 2]], [["tools", 3], ["zoom", 1], ["seek", 2]]]);
        expect(c.querySelector("[data-toolbar-item='step']")).toBeNull();
        expect(c.querySelector("[data-toolbar-item='seek'] [data-key-search='icon']")!.getAttribute("aria-label")).toBe("View");
    });

    test("a read-only Schematic offers Select, Zoom box and Marquee alone", () => {
        row.px = 4000;
        const { container } = render(<ChakraProvider value={system}><Harness parts={everything({ tools: ["select", "zoom", "marquee"], links: [], held: { tool: "select", link: undefined } })} /></ChakraProvider>);
        expect([...container.querySelectorAll("[data-schematic-seg='tools'] [role=radio]")].map((radio) => radio.textContent)).toEqual(["Select", "Zoom box", "Marquee"]);
        expect(container.querySelector("[data-schematic-segmenu='link']")).toBeNull();
    });

    test("over several editable link kinds, Connect's menu beside the strip picks the kind it draws; folded, the chip's menu holds Connect once per kind", async () => {
        const onTools = vi.fn();
        const links = [{ key: "fibre", name: "Fibre run" }, { key: "uplinks", name: "Uplink" }];
        row.px = 4000;
        const wide = render(<ChakraProvider value={system}><Harness parts={everything({ links, onTools })} /></ChakraProvider>);
        const menu = wide.container.querySelector<HTMLElement>("[data-schematic-segmenu='link']")!;
        expect(menu.getAttribute("aria-label")).toBe("Connect draws");
        expect(menu.textContent).toBe("Fibre run");
        await act(async () => { fireEvent.click(menu); });
        await waitFor(() => expect([...document.querySelectorAll("[role=menuitem]")].map((item) => item.textContent)).toEqual(["Fibre run", "Uplink"]));
        // Picked as a pointer does: pressed on it, then its click.
        const uplink = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent === "Uplink")!;
        await act(async () => { fireEvent.pointerDown(uplink); });
        await act(async () => { fireEvent.click(uplink); });
        expect(onTools).toHaveBeenCalledWith({ tool: "connect", link: "uplinks" });
        await waitFor(() => expect(document.querySelector("[role=menu]")).toBeNull());
        wide.unmount();
        // Folded into one chip: Connect once per kind it may draw, and the chip names the one held.
        row.px = needs(new Map([["record-slices", 4], ["record-summary", 1], ["tools", 2], ["zoom", 0], ["seek", 1], ["step", 0]]));
        const narrow = render(<ChakraProvider value={system}><Harness parts={everything({ links, onTools, held: { tool: "connect", link: "uplinks" } })} /></ChakraProvider>);
        const chip = narrow.container.querySelector<HTMLElement>("[data-schematic-segmenu='tools']")!;
        expect(chip.textContent).toBe("Connect · Uplink");
        await act(async () => { fireEvent.click(chip); });
        await waitFor(() => expect([...document.querySelectorAll("[role=menuitem]")].map((item) => item.textContent))
            .toEqual(["Select", "Zoom box", "Marquee", "Connect · Fibre run", "Connect · Uplink", "Move"]));
    });
});
