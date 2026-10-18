/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 * @vitest-environment jsdom
 */

/**
 * The rail over several records (#1336): one rail, each source's chips in
 * source order, one summary counting each source, one Clear all, presets over
 * every source — over decoded wire values and the shared store. The product's
 * own algebra runs on real indexes in e3-ui-components' `record-sources.spec.ts`.
 */
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { IntegerType, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import {
    RecordSliceConfigType, RecordSliceStateType, recordChoiceWhere,
    type RecordSliceBindType, type RecordSliceChoiceType, type RecordSliceFieldType, type RecordSlicesBindType,
} from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { getStore, initializeStore, trackKey } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { resetSlicePersistence } from "../../platform/slice/index.js";
import { Toolbar } from "../../toolbar/index.js";
import { useSlicesReactivity } from "../use-slice-reactivity.js";
import { useRecordSlicesToolbarItems } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= () => {};
(globalThis as unknown as { CSS?: { escape?: (value: string) => string } }).CSS ??= {};
(globalThis as unknown as { CSS: { escape?: (value: string) => string } }).CSS.escape ??= value => value.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`);

type Bind = ValueTypeOf<RecordSliceBindType>;
type Product = ValueTypeOf<RecordSlicesBindType>;
type Field = ValueTypeOf<RecordSliceFieldType>;
type State = ValueTypeOf<RecordSliceStateType>;
const encode = encodeBeast2For(RecordSliceStateType);
const decode = decodeBeast2For(RecordSliceStateType);
const field = (fieldId: string, label: string, values: readonly string[]): Field => ({ fieldId, label, kind: "string", optional: false, multiple: true, set: false,
    values: values.map(value => ({ value: `"${value}"`, label: value })), format: none });

/** One part over the shared store, its counts tracked against `network`. */
function part(key: string, fields: Field[], presets: { id: string; name: string; where: State["where"] }[]) {
    const config = decodeBeast2For(RecordSliceConfigType)(encodeBeast2For(RecordSliceConfigType)({
        fields, indexes: fields.map(f => ({ name: f.fieldId, fields: [f.fieldId], sets: new Set<string>(), structured: false, interval: none })),
        range: none, search: [], presets,
    }));
    if (getStore().read(key) === undefined) getStore().write(key, encode({ where: new Map(), preset: none, resolution: none }));
    const read = (): State => { trackKey(key); return decode(getStore().read(key)!); };
    const write = (state: State) => { getStore().write(key, encode(state)); return null; };
    const choose = (id: string, choice: ValueTypeOf<RecordSliceChoiceType> | undefined) => {
        const where = recordChoiceWhere(config.indexes, read().where, id, choice);
        if (where === null) throw new Error("Choose a preceding field");
        return write({ ...read(), where, preset: none });
    };
    const count = vi.fn<Bind["count"]>(() => { trackKey("network"); return some(BigInt(read().where.size === 0 ? 20 : 7)); });
    const clearAll = () => write({ ...read(), where: new Map(), preset: none });
    const retry = vi.fn(() => { getStore().write("network", encodeBeast2For(IntegerType)(BigInt(Date.now()))); return null; });
    const slice: Bind & { count: typeof count; retry: typeof retry } = { key, config, sourceId: key, read, write,
        choose: (id, values) => choose(id, values.length === 0 ? undefined : variant("values", values)),
        range: (id, from, to) => choose(id, variant("range", { from, to })), prefix: (id, value) => choose(id, variant("prefix", value)),
        clear: id => choose(id, undefined), clearAll,
        count, countWhere: count, total: () => some(20n), domain: () => none, suggest: () => none,
        values: id => { const chosen = read().where.get(id); return config.fields.find(f => f.fieldId === id)!.values.map(value =>
            ({ ...value, selected: chosen?.type === "values" && chosen.value.includes(value.value), count: some(3n), error: none })); },
        replaces: () => [],
        togglePreset: id => {
            const state = read();
            if (state.preset.type === "some" && state.preset.value === id) return clearAll();
            const preset = config.presets.find(p => p.id === id);
            if (preset === undefined) throw new Error("Unknown preset");
            return write({ ...state, where: preset.where, preset: some(id) });
        },
        setResolution: resolution => write({ ...read(), resolution }),
        retry,
        readEntry: () => some(none), contains: () => some(false),
    };
    return slice;
}

/** The yard: lanes by area, resources by group, and one preset over both — the product's functions as the East ones run. */
function fixture(store = new UIStore()) {
    initializeStore(store);
    const north = { id: "north", name: "North, halls" };
    const lanes = part("yard.lanes", [field("area", "Area", ["North", "South"])],
        [{ ...north, where: new Map([["area", variant("values", ['"North"'])]]) }]);
    const kilns = part("yard.resources", [field("group", "Kiln group", ["Hall A", "Hall B", "Bulk"])],
        [{ ...north, where: new Map([["group", variant("values", ['"Hall A"', '"Hall B"'])]]) }]);
    const parts = [{ source: "lanes", slice: lanes }, { source: "resources", slice: kilns }];
    const product: Product = { key: "yard", parts, presets: [north],
        clearAll: vi.fn(() => { for (const p of parts) p.slice.clearAll(); return null; }),
        togglePreset: vi.fn((id: string) => {
            const everywhere = parts.every(p => { const preset = p.slice.read().preset; return preset.type === "some" && preset.value === id; });
            for (const p of parts) {
                const preset = p.slice.read().preset;
                if (everywhere) p.slice.clearAll();
                else if (preset.type !== "some" || preset.value !== id) p.slice.togglePreset(id);
            }
            return null;
        }),
    };
    return { lanes, kilns, product };
}

/** The rail in one Toolbar, at its widest or its most folded form. */
function Rail({ product, folded = false, persist }: { product: Product; folded?: boolean; persist?: "session" }) {
    const items = useRecordSlicesToolbarItems(product, { nouns: { lanes: "lanes", resources: "kilns" }, ...(persist === undefined ? {} : { persist }) });
    return folded ? <>{items[0]!.forms.at(-1)}</> : <Toolbar items={items} />;
}
const show = (product: Product, props: { folded?: boolean; persist?: "session" } = {}) =>
    render(<ChakraProvider value={system}><Rail product={product} {...props} /></ChakraProvider>);

afterEach(() => { cleanup(); vi.restoreAllMocks(); resetSlicePersistence(); window.sessionStorage.clear(); });

test("one rail holds each source's fields in source order, then the presets; one summary counts each source", () => {
    const f = fixture();
    show(f.product);
    const chips = [...document.querySelectorAll<HTMLElement>("[data-record-slice-field]")];
    expect(chips.map(chip => [chip.dataset.recordSliceSource, chip.dataset.recordSliceField])).toEqual([["lanes", "area"], ["resources", "group"]]);
    const summary = document.querySelector<HTMLElement>("[data-record-slices-summary]")!;
    expect(summary.textContent).toBe("20 of 20 lanes·20 of 20 kilns");
    expect([...summary.querySelectorAll<HTMLElement>("[data-record-slice-source]")].map(part => part.dataset.recordSliceSource)).toEqual(["lanes", "resources"]);
    expect(within(summary).getAllByRole("status")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "North, halls" })).toBeTruthy();
});

test("a choice through one source's chip writes only that source's key; the summary counts each source alone", async () => {
    const f = fixture();
    show(f.product);
    const before = getStore().read("yard.resources");
    const user = userEvent.setup();
    await user.click(document.querySelector<HTMLElement>('[data-record-slice-source="lanes"][data-record-slice-field="area"]')!);
    await user.click(await screen.findByRole("button", { name: "North 3" }));
    expect(f.lanes.read().where.get("area")).toEqual(variant("values", ['"North"']));
    expect(getStore().read("yard.resources")).toBe(before);
    await waitFor(() => expect(document.querySelector("[data-record-slices-summary]")!.textContent).toBe("7 of 20 lanes·20 of 20 kilns"));
});

test("a pending count is pending in its own source only, never a zero", () => {
    const f = fixture();
    f.kilns.count.mockImplementation(() => { trackKey("network"); return none; });
    show(f.product);
    const summary = document.querySelector<HTMLElement>("[data-record-slices-summary]")!;
    const [lanes, kilns] = [...summary.querySelectorAll<HTMLElement>("[data-record-slice-source]")];
    expect(within(lanes!).queryByLabelText("Count loading")).toBeNull();
    expect(within(kilns!).getByLabelText("Count loading")).toBeTruthy();
    expect(within(kilns!).getByRole("status").getAttribute("aria-busy")).toBe("true");
});

test("Clear all and a preset over both sources each land in one render; a later choice in one source deactivates the preset", async () => {
    const f = fixture();
    const seen: string[] = [];
    function Probe() {
        useSlicesReactivity(["yard.lanes", "yard.resources"]);
        seen.push(`${f.lanes.read().where.size}/${f.lanes.read().preset.type}|${f.kilns.read().where.size}/${f.kilns.read().preset.type}`);
        return null;
    }
    render(<ChakraProvider value={system}><Rail product={f.product} /><Probe /></ChakraProvider>);
    const user = userEvent.setup();
    seen.length = 0;
    await user.click(screen.getByRole("button", { name: "North, halls" }));
    expect(f.product.togglePreset).toHaveBeenCalledWith("north");
    expect(seen).toEqual(["1/some|1/some"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "North, halls" }).getAttribute("aria-pressed")).toBe("true"));
    act(() => { f.kilns.choose("group", ['"Bulk"']); });
    expect(screen.getByRole("button", { name: "North, halls" }).getAttribute("aria-pressed")).toBe("false");
    cleanup();
    // Clear all, from the folded editor's foot.
    render(<ChakraProvider value={system}><Rail product={f.product} folded /><Probe /></ChakraProvider>);
    await user.click(screen.getByRole("button", { name: /^Filters:/ }));
    const dialog = await screen.findByRole("dialog");
    seen.length = 0;
    await user.click(within(dialog).getByRole("button", { name: "Clear all" }));
    expect(f.product.clearAll).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["0/none|0/none"]);
});

test("the folded editor holds every source's field, each section naming its source", async () => {
    const f = fixture();
    show(f.product, { folded: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Filters:/ }));
    const dialog = await screen.findByRole("dialog");
    const sections = [...dialog.querySelectorAll<HTMLElement>("[data-slice-section]")];
    expect(sections.map(section => section.dataset.sliceSection)).toEqual(["field:lanes.area", "field:resources.group", "presets"]);
    const triggers = [...dialog.querySelectorAll<HTMLElement>("[data-record-slice-source][data-record-slice-field]")];
    expect(triggers.map(trigger => `${trigger.dataset.recordSliceSource}.${trigger.dataset.recordSliceField}`)).toEqual(["lanes.area", "resources.group"]);
    await user.click(within(dialog).getByRole("button", { name: "Kiln group" }));
    expect(dialog.querySelector('[data-record-slice-editor="group"]')!.getAttribute("data-record-slice-source")).toBe("resources");
    expect(within(dialog).getAllByRole("status")).toHaveLength(2);
});

test("persistence restores each source from its own key", () => {
    const store = new UIStore();
    initializeStore(store);
    const saved = encode({ where: new Map([["group", variant("values", ['"Bulk"'])]]), preset: none, resolution: none });
    let text = "";
    for (const byte of saved) text += String.fromCharCode(byte);
    window.sessionStorage.setItem("east-ui.slice.yard.resources", btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    const f = fixture(store);
    show(f.product, { persist: "session" });
    expect(f.kilns.read().where.get("group")).toEqual(variant("values", ['"Bulk"']));
    expect(f.lanes.read().where.size).toBe(0);
});

test("a failed count offers Retry, which retries that source alone", async () => {
    const f = fixture();
    let failing = true;
    f.kilns.count.mockImplementation(() => { trackKey("network"); if (failing) throw new Error("offline"); return some(20n); });
    show(f.product);
    const kilns = document.querySelector<HTMLElement>('[data-record-slices-summary] [data-record-slice-source="resources"]')!;
    expect(within(kilns).getByRole("alert").textContent).toContain("Could not load count");
    failing = false;
    await userEvent.setup().click(within(kilns).getByRole("button", { name: "Retry" }));
    expect(f.kilns.retry).toHaveBeenCalledTimes(1);
    expect(f.lanes.retry).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector("[data-record-slices-summary]")!.textContent).toBe("20 of 20 lanes·20 of 20 kilns"));
});
