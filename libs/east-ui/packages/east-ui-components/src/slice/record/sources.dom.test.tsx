/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 * @vitest-environment jsdom
 */

/**
 * The rail over several records (#1336): one rail, each source's chips in
 * source order, one summary naming the sources a narrowing hides rows of
 * (#1358), one Clear all, presets over every source — over decoded wire
 * values and the shared store; and how it names its sources (#1339): each
 * source's heading, its icon and its count (#1358). The product's own algebra
 * runs on real indexes in e3-ui-components' `record-sources.spec.ts`.
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
        fields, indexes: fields.map(f => ({ name: f.fieldId, fields: [f.fieldId], sets: new Set<string>(), structured: false, interval: none, area: none, series: none, summary: none })),
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
        readEntry: () => some(none), contains: () => some(false), containsRow: () => some(false),
    };
    return slice;
}

/** How a source names itself in the fixture: its label and its icon's name. */
type Named = Partial<Record<"lanes" | "resources", { label?: string; icon?: string; cover?: boolean }>>;

/**
 * The yard: lanes by area, resources by group, and one preset over both — the product's functions as the East ones run;
 * and, given `crews`, crews with no field of the rail's, narrowed as a host's window narrows a Plan's shifts.
 */
function fixture(store = new UIStore(), named: Named = {}, crews = false) {
    initializeStore(store);
    const north = { id: "north", name: "North, halls" };
    const lanes = part("yard.lanes", [field("area", "Area", ["North", "South"]), ...(named.lanes?.cover === true ? [field("cover", "Cover", ["Covered", "Open"])] : [])],
        [{ ...north, where: new Map([["area", variant("values", ['"North"'])]]) }]);
    const kilns = part("yard.resources", [field("group", "Kiln group", ["Hall A", "Hall B", "Bulk"])],
        [{ ...north, where: new Map([["group", variant("values", ['"Hall A"', '"Hall B"'])]]) }]);
    const shifts = part("yard.crews", [], []);
    const naming = (source: keyof Named) => ({
        label: named[source]?.label === undefined ? none : some(named[source].label),
        icon: named[source]?.icon === undefined ? none : some({ prefix: "fas", name: named[source].icon, label: none, style: none }),
    });
    const parts = [{ source: "lanes", ...naming("lanes"), slice: lanes }, { source: "resources", ...naming("resources"), slice: kilns },
        ...(crews ? [{ source: "crews", label: none, icon: none, slice: shifts }] : [])];
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
    return { lanes, kilns, shifts, product };
}

/** Narrows the lanes to the north and the kilns to the bulk kilns: 7 of 20 each, as the fixture counts. */
function narrowBoth(f: ReturnType<typeof fixture>) {
    f.lanes.choose("area", ['"North"']);
    f.kilns.choose("group", ['"Bulk"']);
}

/** Opens the folded rail's editor. */
async function openEditor(): Promise<HTMLElement> {
    await userEvent.setup().click(screen.getByRole("button", { name: /^Filters:/ }));
    return screen.findByRole("dialog");
}

/** The count a source's heading carries in the editor. */
const headingCount = (dialog: HTMLElement, source: string) => dialog.querySelector<HTMLElement>(`[data-slice-group="source:${source}"] [data-rail-group-count]`);

/** The yard's nouns, the host's. */
const NOUNS = { lanes: "lanes", resources: "kilns" };

/** The rail in one Toolbar, at its widest or its most folded form. */
function Rail({ product, folded = false, persist, nouns = NOUNS, excludeFields }: {
    product: Product; folded?: boolean; persist?: "session"; nouns?: Readonly<Record<string, string>> | null; excludeFields?: readonly string[];
}) {
    const items = useRecordSlicesToolbarItems(product, { ...(nouns === null ? {} : { nouns }), ...(persist === undefined ? {} : { persist }),
        ...(excludeFields === undefined ? {} : { excludeFields }) });
    return folded ? <>{items[0]!.forms.at(-1)}</> : <Toolbar items={items} />;
}
const show = (product: Product, props: { folded?: boolean; persist?: "session"; nouns?: Readonly<Record<string, string>> | null; excludeFields?: readonly string[] } = {}) =>
    render(<ChakraProvider value={system}><Rail product={product} {...props} /></ChakraProvider>);

afterEach(() => { cleanup(); vi.restoreAllMocks(); resetSlicePersistence(); window.sessionStorage.clear(); });

test("one rail holds each source's fields in source order, then the presets; the summary names no source while a narrowing hides none of its rows (#1358)", () => {
    const f = fixture();
    show(f.product);
    const chips = [...document.querySelectorAll<HTMLElement>("[data-record-slice-field]")];
    expect(chips.map(chip => [chip.dataset.recordSliceSource, chip.dataset.recordSliceField])).toEqual([["lanes", "area"], ["resources", "group"]]);
    expect(document.querySelector("[data-record-slices-summary]")).toBeNull();
    expect(screen.getByRole("button", { name: "North, halls" })).toBeTruthy();
});

test("a choice through one source's chip writes only that source's key; the summary names that source alone, counted (#1358)", async () => {
    const f = fixture();
    show(f.product);
    const before = getStore().read("yard.resources");
    const user = userEvent.setup();
    await user.click(document.querySelector<HTMLElement>('[data-record-slice-source="lanes"][data-record-slice-field="area"]')!);
    await user.click(await screen.findByRole("button", { name: "North 3" }));
    expect(f.lanes.read().where.get("area")).toEqual(variant("values", ['"North"']));
    expect(getStore().read("yard.resources")).toBe(before);
    await waitFor(() => expect(document.querySelector("[data-record-slices-summary]")?.textContent).toBe("7 of 20 lanes"));
    const summary = document.querySelector<HTMLElement>("[data-record-slices-summary]")!;
    expect([...summary.querySelectorAll<HTMLElement>("[data-record-slice-source]")].map(part => part.dataset.recordSliceSource)).toEqual(["lanes"]);
    expect(within(summary).getAllByRole("status")).toHaveLength(1);
});

test("a narrowed source whose count is still being read keeps its place in the summary, its count pending, never a zero (#1398, CL1); folded, its source's heading shows it loading (#1358)", async () => {
    const f = fixture();
    narrowBoth(f);
    f.kilns.count.mockImplementation(() => { trackKey("network"); return none; });
    show(f.product);
    const summary = document.querySelector<HTMLElement>("[data-record-slices-summary]")!;
    expect([...summary.querySelectorAll<HTMLElement>("[data-record-slice-source]")].map(part => part.dataset.recordSliceSource)).toEqual(["lanes", "resources"]);
    expect(summary.textContent).toBe("7 of 20 lanes· of 20 kilns");
    const pending = summary.querySelector<HTMLElement>('[data-record-slice-source="resources"]')!;
    expect([within(pending).getByLabelText("Count loading") !== null, within(pending).getByRole("status").getAttribute("aria-busy")]).toEqual([true, "true"]);
    cleanup();
    show(f.product, { folded: true });
    const dialog = await openEditor();
    expect(headingCount(dialog, "lanes")!.textContent).toBe("7 of 20");
    const kilns = headingCount(dialog, "resources")!;
    expect(within(kilns).getByLabelText("Count loading")).toBeTruthy();
    expect(within(kilns).getByRole("status").getAttribute("aria-busy")).toBe("true");
});

test("a pending count's source, once counted, stays only while its narrowing hides rows of it; a source no narrowing is in force over is named nowhere, its count read or not (#1358, #1398)", async () => {
    const f = fixture();
    narrowBoth(f);
    f.kilns.count.mockImplementation(() => { trackKey("network"); return none; });
    show(f.product);
    expect(document.querySelector("[data-record-slices-summary]")!.textContent).toBe("7 of 20 lanes· of 20 kilns");
    // Counted, a narrowing that hides none of its rows names it no more.
    act(() => { f.kilns.count.mockImplementation(() => { trackKey("network"); return some(20n); }); f.kilns.retry(); });
    await waitFor(() => expect(document.querySelector("[data-record-slices-summary]")!.textContent).toBe("7 of 20 lanes"));
    // Its narrowing cleared, its count read again: named nowhere while it is read.
    act(() => { f.kilns.count.mockImplementation(() => { trackKey("network"); return none; }); f.kilns.clearAll(); f.kilns.retry(); });
    await waitFor(() => expect(document.querySelector("[data-record-slices-summary]")!.textContent).toBe("7 of 20 lanes"));
});

test("folded, each source's heading carries its count, as a Library tab counts — the total, N of M while narrowed — and no line repeats them (#1358)", async () => {
    const f = fixture();
    show(f.product, { folded: true });
    const dialog = await openEditor();
    expect([headingCount(dialog, "lanes")!.textContent, headingCount(dialog, "resources")!.textContent]).toEqual(["20", "20"]);
    act(() => { f.lanes.choose("area", ['"North"']); });
    await waitFor(() => expect(headingCount(dialog, "lanes")!.textContent).toBe("7 of 20"));
    expect(headingCount(dialog, "resources")!.textContent).toBe("20");
    // Every source is headed, so no line under the fields counts any.
    expect(dialog.querySelector("[data-record-slices-summary]")).toBeNull();
});

test("a source no heading counts keeps its count in one line under the fields while a narrowing hides rows of it; the toolbar's summary names it too (#1358)", async () => {
    const f = fixture(new UIStore(), {}, true);
    // The crews narrowed as a host's window narrows a Plan's shifts: no field of the rail's holds it.
    act(() => { f.shifts.write({ where: new Map([["start", variant("values", ['"Night"'])]]), preset: none, resolution: none }); });
    show(f.product);
    expect(document.querySelector("[data-record-slices-summary]")!.textContent).toBe("7 of 20 crews");
    cleanup();
    show(f.product, { folded: true });
    const dialog = await openEditor();
    expect(dialog.querySelectorAll("[data-slice-group^='source:']")).toHaveLength(2);
    expect(dialog.querySelector("[data-record-slices-summary]")!.textContent).toBe("7 of 20 crews");
    // A narrowing that hides none of its rows names it nowhere.
    act(() => { f.shifts.count.mockImplementation(() => { trackKey("network"); return some(20n); }); f.shifts.retry(); });
    await waitFor(() => expect(dialog.querySelector("[data-record-slices-summary]")).toBeNull());
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
    // Each source counted once, in its heading.
    expect([...dialog.querySelectorAll("[data-rail-group-count]")].map(count => within(count as HTMLElement).getByRole("status").textContent)).toEqual(["20", "20"]);
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

test("a failed count offers Retry, which retries that source alone; read again, it hides nothing and the summary names no source (#1358)", async () => {
    const f = fixture();
    let failing = true;
    f.kilns.count.mockImplementation(() => { trackKey("network"); if (failing) throw new Error("offline"); return some(20n); });
    show(f.product);
    const kilns = document.querySelector<HTMLElement>('[data-record-slices-summary] [data-record-slice-source="resources"]')!;
    expect(within(kilns).getByRole("alert").textContent).toContain("Could not load count");
    expect(document.querySelector('[data-record-slices-summary] [data-record-slice-source="lanes"]')).toBeNull();
    failing = false;
    await userEvent.setup().click(within(kilns).getByRole("button", { name: "Retry" }));
    expect(f.kilns.retry).toHaveBeenCalledTimes(1);
    expect(f.lanes.retry).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector("[data-record-slices-summary]")).toBeNull());
});

test("folded, the editor heads each source's fields with its name and its icon, then the presets with Presets; the keys move between the fields alone", async () => {
    const f = fixture(new UIStore(), { lanes: { label: "Bays", icon: "warehouse" }, resources: { icon: "fire" } });
    show(f.product, { folded: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Filters:/ }));
    const dialog = await screen.findByRole("dialog");
    const heads = [...dialog.querySelectorAll<HTMLElement>("[data-slice-group]")];
    // A source's label names it; without one, the host's noun does. Each source's count follows its name; the presets have none.
    expect(heads.map(head => [head.dataset.sliceGroup, head.querySelector("[data-rail-group-label]")!.textContent])).toEqual([["source:lanes", "Bays"], ["source:resources", "kilns"], ["presets", "Presets"]]);
    expect(heads.map(head => head.querySelector("[data-rail-group-count]")?.textContent ?? null)).toEqual(["20", "20", null]);
    expect(heads.map(head => head.querySelector("svg")?.getAttribute("data-icon") ?? null)).toEqual(["warehouse", "fire", null]);
    // Each heads its own fields: the next section after it is its source's.
    expect(heads.map(head => (head.nextElementSibling as HTMLElement).dataset.sliceSection)).toEqual(["field:lanes.area", "field:resources.group", "presets"]);
    // A heading is a caption: Arrow Down from one field's trigger lands on the next field's.
    const area = within(dialog).getByRole("button", { name: "Area" });
    area.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Kiln group" }));
});

test("wide, each field carries its source's icon; a source with none keeps the rail's own", () => {
    const f = fixture(new UIStore(), { lanes: { icon: "warehouse" } });
    show(f.product);
    const icon = (label: string) => document.querySelector(`[data-slice-rail] [title="${label}"] svg`)?.getAttribute("data-icon");
    expect(icon("Area")).toBe("warehouse");
    expect(icon("Kiln group")).toBe("filter");
});

test("fields from one source are not headed: the line under them names each source a narrowing hides rows of (#1358)", async () => {
    const f = fixture(new UIStore(), { lanes: { label: "Bays", icon: "warehouse" }, resources: { label: "Kilns" } });
    show(f.product, { folded: true, excludeFields: ["resources.group"] });
    const dialog = await openEditor();
    expect([...dialog.querySelectorAll("[data-slice-section]")].map(section => (section as HTMLElement).dataset.sliceSection)).toEqual(["field:lanes.area", "presets"]);
    expect(dialog.querySelectorAll("[data-slice-group]")).toHaveLength(0);
    expect(dialog.querySelector("[data-record-slices-summary]")).toBeNull();
    act(() => { f.lanes.choose("area", ['"North"']); });
    await waitFor(() => expect(dialog.querySelector("[data-record-slices-summary]")?.textContent).toBe("7 of 20 lanes"));
});

/** The editor's head's count of what narrows: `2 active`. */
const activeCount = (dialog: HTMLElement) => within(dialog).getByText(/^\d+ active$/).textContent;

test("the editor's head counts the rail's own choices — each field it lists that holds one — never a narrowing it leaves out, a source's window or a field it does not offer, which Clear all leaves no count of either", async () => {
    const f = fixture(new UIStore(), {}, true);
    // The crews narrowed as a host's window narrows a Plan's shifts, the kilns on a field the rail does not offer: neither is the rail's.
    act(() => {
        f.shifts.write({ where: new Map([["start", variant("values", ['"Night"'])]]), preset: none, resolution: none });
        f.kilns.choose("group", ['"Bulk"']);
        f.lanes.choose("area", ['"North"']);
    });
    show(f.product, { folded: true, excludeFields: ["resources.group"] });
    const dialog = await openEditor();
    expect(activeCount(dialog)).toBe("1 active");
    // The fields it lists, each holding a choice: Area, and the kilns' group once offered again.
    cleanup();
    show(f.product, { folded: true });
    expect(activeCount(await openEditor())).toBe("2 active");
    await userEvent.setup().click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(activeCount(screen.getByRole("dialog"))).toBe("0 active"));
});

test("the summary counts a source in the host's noun, else its label as running text writes it, else its name", () => {
    const named = fixture(new UIStore(), { lanes: { label: "Bays" }, resources: { label: "SKU" } });
    narrowBoth(named);
    show(named.product, { nouns: null });
    expect(document.querySelector("[data-record-slices-summary]")!.textContent).toBe("7 of 20 bays·7 of 20 SKU");
    cleanup();
    const bare = fixture();
    narrowBoth(bare);
    show(bare.product, { nouns: null });
    expect(document.querySelector("[data-record-slices-summary]")!.textContent).toBe("7 of 20 lanes·7 of 20 resources");
    cleanup();
    const nouned = fixture(new UIStore(), { lanes: { label: "Bays" } });
    narrowBoth(nouned);
    show(nouned.product);
    expect(document.querySelector("[data-record-slices-summary]")!.textContent).toBe("7 of 20 lanes·7 of 20 kilns");
});

test("a source with several fields is headed once, over its first; its fields stay in order under it", async () => {
    const f = fixture(new UIStore(), { lanes: { label: "Bays", icon: "warehouse", cover: true }, resources: { icon: "fire" } });
    show(f.product, { folded: true });
    await userEvent.setup().click(screen.getByRole("button", { name: /^Filters:/ }));
    const dialog = await screen.findByRole("dialog");
    const order = [...dialog.querySelectorAll<HTMLElement>("[data-slice-group], [data-slice-section]")]
        .map(el => el.dataset.sliceGroup !== undefined ? `head:${el.dataset.sliceGroup}` : el.dataset.sliceSection);
    expect(order).toEqual(["head:source:lanes", "field:lanes.area", "field:lanes.cover", "head:source:resources", "field:resources.group", "head:presets", "presets"]);
});
