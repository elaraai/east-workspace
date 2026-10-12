/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 * @vitest-environment jsdom
 */

import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { DateTimeType, IntegerType, decodeBeast2For, encodeBeast2For, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceConfigType, RecordSliceStateType, recordChoiceWhere, type RecordSliceBindType, type RecordSliceFieldType, type RecordSliceChoiceType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { getStore, initializeStore, trackKey } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { RecordSliceFieldEditor, RecordSliceSummary, useRecordSliceToolbarItems } from "./index.js";
import { RecordSliceBrush } from "./brush.js";

// Ark's positioner and keyboard list scrolling need browser layout APIs.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= () => {};
(globalThis as unknown as { CSS?: { escape?: (value: string) => string } }).CSS ??= {};
(globalThis as unknown as { CSS: { escape?: (value: string) => string } }).CSS.escape ??= value => value.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`);

type Bind = ValueTypeOf<RecordSliceBindType>;
type Field = ValueTypeOf<RecordSliceFieldType>;
const field = (overrides: Partial<Field>): Field => ({ fieldId: "status", label: "Status", kind: "string", optional: false, multiple: true, set: false,
    values: [{ value: '"Ready"', label: "Ready" }, { value: '"Done"', label: "Done" }], format: none, ...overrides });

// Presentation tests use decoded wire values and a tracked async boundary.
// Query planning/count correctness has its own real-index contract tests.
function fixture(fields: Field[]) {
    initializeStore(new UIStore());
    const config = decodeBeast2For(RecordSliceConfigType)(encodeBeast2For(RecordSliceConfigType)({
        fields, indexes: fields.map(f => ({ name: f.fieldId, fields: [f.fieldId], sets: new Set(f.set ? [f.fieldId] : []), interval: none })),
        range: fields.some(f => f.kind === "datetime") ? some(fields.find(f => f.kind === "datetime")!.fieldId) : none,
        search: fields.filter(f => f.kind === "string").map(f => f.fieldId), presets: [],
    }));
    const key = "record.controls";
    const encode = encodeBeast2For(RecordSliceStateType);
    const decode = decodeBeast2For(RecordSliceStateType);
    getStore().write(key, encode({ where: new Map(), preset: none, resolution: none }));
    let revision = 0n;
    const pulse = () => getStore().write("network", encodeBeast2For(IntegerType)(++revision));
    const read = () => { trackKey(key); return decode(getStore().read(key)!); };
    const write = (state: ValueTypeOf<RecordSliceStateType>) => { getStore().write(key, encode(state)); return null; };
    const choose = (id: string, choice: ValueTypeOf<RecordSliceChoiceType> | undefined) => {
        const where = recordChoiceWhere(config.indexes, read().where, id, choice);
        if (where === null) throw new Error("Choose a preceding field");
        return write({ ...read(), where, preset: none });
    };
    const count = vi.fn<Bind["count"]>(() => { trackKey("network"); return some(7n); });
    const domain = vi.fn<Bind["domain"]>(() => { trackKey("network"); return none; });
    const suggest = vi.fn<Bind["suggest"]>(() => { trackKey("network"); return none; });
    const slice: Bind = { key, config, sourceId: "record", read, write,
        choose: (id, values) => choose(id, values.length === 0 ? undefined : variant("values", values)),
        range: vi.fn((id, from, to) => choose(id, variant("range", { from, to }))), prefix: (id, value) => choose(id, variant("prefix", value)),
        clear: id => choose(id, undefined), clearAll: () => write({ ...read(), where: new Map(), preset: none }),
        count, countWhere: count, total: () => some(20n), domain, suggest,
        values: id => { const chosen = read().where.get(id); return config.fields.find(f => f.fieldId === id)!.values.map(value => {
            try { return { ...value, selected: chosen?.type === "values" && chosen.value.includes(value.value), count: count(), error: none }; }
            catch { return { ...value, selected: false, count: none, error: some("offline") }; }
        }); },
        replaces: () => [], togglePreset: () => null, setResolution: resolution => write({ ...read(), resolution }),
        retry: vi.fn(() => { pulse(); return null; }), readEntry: () => some(none), contains: () => some(false),
    };
    const show = (id = fields[0]!.fieldId) => render(<ChakraProvider value={system}>
        <RecordSliceFieldEditor slice={slice} field={config.fields.find(f => f.fieldId === id)!} />
    </ChakraProvider>);
    return { slice, count, domain, suggest, pulse, show };
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

test("folded narrowing has one heading per field and one keyboard-accessible editor at a time", async () => {
    const f = fixture([field({}), field({ fieldId: "due", label: "Due", kind: "datetime", values: [] })]);
    function Rail() { return <>{useRecordSliceToolbarItems(f.slice)[0]!.forms.at(-1)}</>; }
    render(<ChakraProvider value={system}><Rail /></ChakraProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Filters:/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("Status")).toHaveLength(1);
    const status = within(dialog).getByRole("button", { name: "Status" });
    await user.click(status);
    expect(dialog.querySelectorAll('[data-record-slice-editor]')).toHaveLength(1);
    expect(within(dialog).getAllByText("Status")).toHaveLength(1);
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(dialog.querySelector('[data-record-slice-editor="status"]')).toBeNull());
    expect(dialog.querySelectorAll('[data-record-slice-editor]')).toHaveLength(1);
    expect(dialog.querySelector('[data-record-slice-editor="due"]')).not.toBeNull();
    expect(f.slice.read().where.size).toBe(0);
    expect(f.slice.range).not.toHaveBeenCalled();
});

test("known choices distinguish pending, zero and failure; Retry and external state update both editors and summary", async () => {
    const f = fixture([field({})]);
    f.count.mockImplementation(() => { trackKey("network"); return none; });
    f.show();
    render(<ChakraProvider value={system}><RecordSliceSummary slice={f.slice} /></ChakraProvider>);
    expect(screen.getAllByLabelText("Count loading")).toHaveLength(3);
    f.count.mockImplementation(() => { trackKey("network"); return some(0n); });
    act(f.pulse);
    expect(screen.getByRole("button", { name: "Ready 0" })).toBeTruthy();
    expect(screen.queryByLabelText("Count loading")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ready 0" }));
    expect(f.slice.read().where.get("status")).toEqual(variant("values", ['"Ready"']));
    f.count.mockImplementation(() => { trackKey("network"); throw new Error("offline"); });
    act(f.pulse);
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    f.count.mockImplementation(() => { trackKey("network"); return some(7n); });
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]!);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    act(() => { f.slice.choose("status", ['"Done"']); });
    expect(screen.getByRole("button", { name: "Done 7" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Ready 7" }).getAttribute("aria-pressed")).toBe("false");
});

test("optional Boolean, enum and Set choices retain typed identities and explain replacement before applying", () => {
    for (const item of [
        field({ kind: "boolean", optional: true, values: [{ value: ".none", label: "Unset" }, { value: ".some true", label: "Yes" }] }),
        field({ kind: "enum", values: [{ value: ".ready", label: "Ready" }, { value: ".done", label: "Done" }] }),
        field({ fieldId: "skills", label: "Skills", set: true, multiple: false }),
    ]) {
        const f = fixture([item, field({ fieldId: "team", label: "Team" })]);
        act(() => { f.slice.choose("team", ['"Ready"']); });
        f.show();
        expect(screen.getAllByText("Replaces Team: Ready").length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${item.values[0]!.label}`) }));
        expect(f.slice.read().where.get(item.fieldId)).toEqual(variant("values", [item.values[0]!.value]));
        expect(f.slice.read().where.has("team")).toBe(false);
        fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${item.values[1]!.label}`) }));
        expect(f.slice.read().where.get(item.fieldId)).toEqual(variant("values", item.set ? [item.values[1]!.value] : item.values.map(v => v.value)));
        cleanup();
    }
});

test("date presets wait for index bounds and include the last historical millisecond in a half-open window", () => {
    const f = fixture([field({ fieldId: "due", label: "Due", kind: "datetime", values: [] })]);
    const print = printFor(DateTimeType);
    f.show();
    expect((screen.getByRole("button", { name: "Today" }) as HTMLButtonElement).disabled).toBe(true);
    f.domain.mockImplementation(() => { trackKey("network"); return some({
        from: print(new Date("2020-09-30T00:00:00.000Z")), to: print(new Date("2020-10-03T00:00:00.000Z")),
    }); });
    act(f.pulse);
    fireEvent.click(screen.getByRole("button", { name: "Last day" }));
    expect(f.slice.range).toHaveBeenCalledWith("due", print(new Date("2020-10-03T00:00:00.000Z")), print(new Date("2020-10-03T00:00:00.001Z")));
    expect(screen.getByRole("button", { name: "Last day" }).getAttribute("aria-pressed")).toBe("true");
    render(<ChakraProvider value={system}><RecordSliceBrush slice={f.slice} /></ChakraProvider>);
    expect(document.querySelectorAll("[data-brush-track]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-brush-bar]")).toHaveLength(0);
});

test("record search debounces, hides stale suggestions, chooses exact values by keyboard and follows external clearing", async () => {
    const f = fixture([field({ fieldId: "name", label: "Name", values: [] })]);
    let failed = true;
    f.suggest.mockImplementation((_id, query) => { trackKey("network"); return some([{ value: '"Alice"', label: "Alice", count: failed ? none : some(2n), error: failed ? some("offline") : none, selected: false }].filter(v => v.label.startsWith(query))); });
    f.show();
    expect(screen.getByRole("alert").textContent).toContain("Could not load suggestion counts");
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.queryByRole("alert")).toBeNull();
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "Al");
    expect(input.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("option", { name: /^Alice/ })).toBeNull();
    await waitFor(() => expect(input.getAttribute("aria-busy")).toBe("false"));
    expect(f.suggest.mock.calls.map(call => call[1])).not.toContain("A");
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(f.slice.read().where.get("name")).toEqual(variant("values", ['"Alice"'])));
    act(() => { f.slice.clear("name"); });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
    await user.type(input, "Bob");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(f.slice.read().where.get("name")).toEqual(variant("prefix", "Bob")));
});

test("Unset leaves optional String search available, while Set search cannot commit a prefix", async () => {
    const optional = fixture([field({ optional: true, values: [{ value: ".none", label: "Unset" }] })]);
    optional.show();
    expect(screen.getByRole("combobox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Unset/ }));
    expect(optional.slice.read().where.get("status")).toEqual(variant("values", [".none"]));
    fireEvent.click(screen.getByRole("button", { name: "Clear Status" }));
    expect(optional.slice.read().where.has("status")).toBe(false);
    cleanup();
    const member = fixture([field({ set: true, multiple: false, values: [] })]);
    member.show();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "Ac");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("option", { name: /All starting/ })).toBeNull();
    expect(member.slice.read().where.size).toBe(0);
});
