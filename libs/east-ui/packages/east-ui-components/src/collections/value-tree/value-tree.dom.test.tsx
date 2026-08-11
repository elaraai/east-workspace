/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * ValueTree renderer (#360): flattened rows from the materialized node
 * IR with END-USER labels (humanized fields, content-derived item
 * titles, struct previews), default-depth expand with persisted
 * toggles, ghost "Add …" rows on expanded editable collections, and the
 * typed edit surface — leaf editors report `onEdit(path, leaf)`, append
 * rows `onInsert` (arrays with a terminal `append` step, dicts with the
 * new `key`), option Set/Clear and variant tag switches `onTag`.
 * Arrow keys traverse rows. Without callbacks the tree is a read-only
 * inspector. Dict entries display their `label` but echo their
 * round-trippable `key` in path steps; non-string-keyed dicts edit
 * entry VALUES only (no entry insert/remove).
 */

import { useState } from "react";
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    variant, some, none,
    StructType, ArrayType, DictType, OptionType, VariantType, DateTimeType, IntegerType, StringType,
} from "@elaraai/east";
import { ValueTree } from "@elaraai/east-ui";
import { system } from "../../theme/index.js";
import { EastChakraValueTree, type ValueTreeValue, type ValueTreeNodeValue, type ValueTreeLeafValue, type ValueTreePaging, type ValueTreePagedRow } from "./index.js";

afterEach(cleanup);

const leaf = (l: unknown): ValueTreeNodeValue => variant("leaf", l) as unknown as ValueTreeNodeValue;
const str = (s: string) => leaf(variant("string", s));
const int = (n: bigint) => leaf(variant("integer", n));
const flt = (n: number) => leaf(variant("float", n));
const bool = (b: boolean) => leaf(variant("boolean", b));
const structN = (fields: [string, ValueTreeNodeValue][]): ValueTreeNodeValue =>
    variant("struct", { fields: fields.map(([name, node]) => ({ name, node })) }) as unknown as ValueTreeNodeValue;
const arrN = (items: ValueTreeNodeValue[]): ValueTreeNodeValue =>
    variant("array", { items }) as unknown as ValueTreeNodeValue;
const dictN = (entries: [string, ValueTreeNodeValue][], editable = true): ValueTreeNodeValue =>
    variant("dict", {
        entries: entries.map(([key, node]) => ({ key, label: key, node })),
        editable,
    }) as unknown as ValueTreeNodeValue;
const optN = (inner?: ValueTreeNodeValue): ValueTreeNodeValue =>
    variant("option", { value: inner !== undefined ? some(inner) : none }) as unknown as ValueTreeNodeValue;
const varN = (tag: string, tags: string[], value: ValueTreeNodeValue): ValueTreeNodeValue =>
    variant("variant", { tag, tags, value }) as unknown as ValueTreeNodeValue;
const opaqueN = (s: string): ValueTreeNodeValue =>
    variant("opaque", s) as unknown as ValueTreeNodeValue;

interface Cbs {
    onEdit?: (path: unknown[], leaf: unknown) => void;
    onInsert?: (path: unknown[]) => void;
    onRemove?: (path: unknown[]) => void;
    onTag?: (path: unknown[], tag: string) => void;
}

function rootValue(root: ValueTreeNodeValue, cbs: Cbs = {}, style?: { openDepth?: bigint; toolbar?: boolean; height?: string }): ValueTreeValue {
    return {
        root,
        onEdit: cbs.onEdit !== undefined ? some(cbs.onEdit) : none,
        onInsert: cbs.onInsert !== undefined ? some(cbs.onInsert) : none,
        onRemove: cbs.onRemove !== undefined ? some(cbs.onRemove) : none,
        onTag: cbs.onTag !== undefined ? some(cbs.onTag) : none,
        style: style !== undefined
            ? some({
                height: style.height !== undefined ? some(style.height) : none,
                maxHeight: none,
                openDepth: style.openDepth !== undefined ? some(style.openDepth) : none,
                toolbar: style.toolbar !== undefined ? some(style.toolbar) : none,
            })
            : none,
    } as unknown as ValueTreeValue;
}

let keyCounter = 0;
function renderTree(value: ValueTreeValue, scrollToRow?: number) {
    keyCounter += 1;
    return render(
        <ChakraProvider value={system}>
            <EastChakraValueTree value={value} storageKey={`vt-test-${keyCounter}`} scrollToRow={scrollToRow} />
        </ChakraProvider>,
    );
}

describe("EastChakraValueTree", () => {
    test("renders struct fields as read-only rows with formatted leaves", () => {
        renderTree(rootValue(structN([
            ["rate", flt(0.15)],
            ["label", str("Base")],
            ["on", bool(true)],
        ])));
        expect(screen.getByText("Rate")).toBeTruthy();
        expect(screen.getByText("0.15")).toBeTruthy();
        expect(screen.getByText("Base")).toBeTruthy();
        expect(screen.getByText("true")).toBeTruthy();
        // Read-only: no editors mounted.
        expect(document.querySelector("input")).toBeNull();
    });

    test("humanizes struct field labels for end users", () => {
        renderTree(rootValue(structN([
            ["flowRate", flt(2.5)],
            ["max_pressure", flt(9.0)],
        ])));
        expect(screen.getByText("Flow rate")).toBeTruthy();
        expect(screen.getByText("Max pressure")).toBeTruthy();
    });

    test("titles array elements from their first string leaf, never [i]", () => {
        renderTree(rootValue(structN([
            ["machines", arrN([
                structN([["name", str("Press")], ["rate", flt(2.5)]]),
                structN([["name", str("Mill")], ["rate", flt(1.25)]]),
                flt(4.0),
            ])],
        ])));
        // The title appears as the row label (and again as the child
        // Name field's value row, since items start expanded).
        expect(screen.getAllByText("Press").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Mill").length).toBeGreaterThan(0);
        // A leaf element falls back to a 1-based human title.
        expect(screen.getByText("Item 3")).toBeTruthy();
        expect(screen.queryByText("[0]")).toBeNull();
    });

    test("struct rows preview their leaf values instead of field counts", () => {
        renderTree(rootValue(structN([
            ["machine", structN([
                ["name", str("Press")],
                ["rate", flt(2.5)],
                ["state", varN("running", ["down", "running"], leaf(variant("null", null)))],
            ])],
        ])));
        expect(screen.getByText("Press · 2.5 · Running")).toBeTruthy();
        expect(screen.queryByText("3 fields")).toBeNull();
    });

    test("expands nested branches on toggle beyond the default depth", () => {
        renderTree(rootValue(structN([
            ["outer", structN([
                ["inner", structN([["deep", structN([["n", int(7n)]])]])],
            ])],
        ])));
        // One level starts expanded: `outer` (depth 0) is open, so `inner`
        // (depth 1) is visible but collapsed — `deep` is not.
        expect(screen.getByText("Inner")).toBeTruthy();
        expect(screen.queryByText("Deep")).toBeNull();
        const innerRow = screen.getByText("Inner").closest("[data-part=row]")!;
        fireEvent.click(innerRow.querySelector("button[aria-label=Expand]")!);
        expect(screen.getByText("Deep")).toBeTruthy();
        expect(screen.queryByText("N")).toBeNull();
        const deepRow = screen.getByText("Deep").closest("[data-part=row]")!;
        fireEvent.click(deepRow.querySelector("button[aria-label=Expand]")!);
        expect(screen.getByText("N")).toBeTruthy();
        fireEvent.click(deepRow.querySelector("button[aria-label=Collapse]")!);
        expect(screen.queryByText("N")).toBeNull();
    });

    test("style.openDepth overrides the default and 0 starts fully collapsed", () => {
        renderTree(rootValue(structN([
            ["outer", structN([["inner", int(1n)]])],
        ]), {}, { openDepth: 0n }));
        expect(screen.getByText("Outer")).toBeTruthy();
        expect(screen.queryByText("Inner")).toBeNull();
    });

    test("the toolbar collapses and expands everything", () => {
        renderTree(rootValue(structN([
            ["outer", structN([["inner", structN([["deep", int(7n)]])]])],
        ]), {}, { toolbar: true }));
        // Default: outer open, inner visible-collapsed.
        expect(screen.getByText("Inner")).toBeTruthy();
        fireEvent.click(screen.getByText("Expand all"));
        expect(screen.getByText("Deep")).toBeTruthy();
        fireEvent.click(screen.getByText("Collapse all"));
        expect(screen.queryByText("Inner")).toBeNull();
        expect(screen.getByText("Outer")).toBeTruthy();
    });

    test("Alt-click collapses the entire subtree, not just the row", () => {
        renderTree(rootValue(structN([
            ["outer", structN([["inner", structN([["deep", int(7n)]])]])],
        ]), {}, { toolbar: true }));
        fireEvent.click(screen.getByText("Expand all"));
        expect(screen.getByText("Deep")).toBeTruthy();
        const outerRow = screen.getByText("Outer").closest("[data-part=row]")!;
        // Alt-collapse the root row: descendants close too, so a plain
        // re-expand shows a collapsed subtree (inner visible, deep hidden).
        fireEvent.click(outerRow.querySelector("button[aria-label=Collapse]")!, { altKey: true });
        expect(screen.queryByText("Inner")).toBeNull();
        fireEvent.click(outerRow.querySelector("button[aria-label=Expand]")!);
        expect(screen.getByText("Inner")).toBeTruthy();
        expect(screen.queryByText("Deep")).toBeNull();
    });

    test("onEdit reports the path and new leaf from a string editor", async () => {
        const onEdit = vi.fn();
        renderTree(rootValue(dictN([["name", str("Press")]]), { onEdit }));
        const input = document.querySelector("input")!;
        fireEvent.change(input, { target: { value: "Mill" } });
        await waitFor(() => expect(onEdit).toHaveBeenCalled());
        const [path, leafArg] = onEdit.mock.calls[0] as [unknown[], { type: string; value: unknown }];
        expect(path).toEqual([variant("key", "name")]);
        expect(leafArg.type).toBe("string");
        expect(leafArg.value).toBe("Mill");
    });

    test("typing retains focus while the host round-trips each keystroke", async () => {
        function Harness() {
            const [name, setName] = useState("P");
            const value = rootValue(dictN([["name", str(name)]]), {
                onEdit: (_path, leafArg) => {
                    setName((leafArg as ValueTreeLeafValue).value as string);
                },
            });
            return <EastChakraValueTree value={value} storageKey={`vt-typing-${keyCounter}`} />;
        }
        keyCounter += 1;
        render(<ChakraProvider value={system}><Harness /></ChakraProvider>);
        const input = document.querySelector("input")! as HTMLInputElement;
        input.focus();
        fireEvent.change(input, { target: { value: "Pr" } });
        await waitFor(() => expect(input.value).toBe("Pr"));
        expect(document.activeElement).toBe(input);
        fireEvent.change(input, { target: { value: "Pre" } });
        await waitFor(() => expect(input.value).toBe("Pre"));
        // The SAME input node keeps focus through the re-render loop.
        expect(document.activeElement).toBe(input);
        expect(document.querySelector("input")).toBe(input);
    });

    test("expanded arrays end in an Add item ghost row with an append path", async () => {
        const onInsert = vi.fn();
        const onRemove = vi.fn();
        renderTree(rootValue(structN([
            ["samples", arrN([flt(1.0), flt(2.5)])],
        ]), { onInsert, onRemove }));
        fireEvent.click(screen.getByLabelText("Add item"));
        await waitFor(() => expect(onInsert).toHaveBeenCalled());
        expect(onInsert.mock.calls[0]?.[0]).toEqual([variant("field", "samples"), variant("append", null)]);
        fireEvent.click(screen.getAllByLabelText("Remove")[1]!);
        await waitFor(() => expect(onRemove).toHaveBeenCalled());
        expect(onRemove.mock.calls[0]?.[0]).toEqual([variant("field", "samples"), variant("index", 1n)]);
    });

    test("collapsing a collection hides its ghost add row", () => {
        const onInsert = vi.fn();
        renderTree(rootValue(structN([
            ["samples", arrN([flt(1.0)])],
        ]), { onInsert }));
        expect(screen.getByLabelText("Add item")).toBeTruthy();
        const row = screen.getByText("Samples").closest("[data-part=row]")!;
        fireEvent.click(row.querySelector("button[aria-label=Collapse]")!);
        expect(screen.queryByLabelText("Add item")).toBeNull();
    });

    test("dict add commits the typed key as a trailing key step", async () => {
        const onInsert = vi.fn();
        renderTree(rootValue(structN([
            ["rates", dictN([["base", flt(0.15)]])],
        ]), { onInsert }));
        fireEvent.click(screen.getByLabelText("Add entry"));
        const keyInput = screen.getByLabelText("New entry key");
        fireEvent.change(keyInput, { target: { value: "peak" } });
        fireEvent.keyDown(keyInput, { key: "Enter" });
        await waitFor(() => expect(onInsert).toHaveBeenCalled());
        expect(onInsert.mock.calls[0]?.[0]).toEqual([variant("field", "rates"), variant("key", "peak")]);
    });

    test("non-string-keyed dicts browse and edit values, never entries", () => {
        const onInsert = vi.fn();
        const onRemove = vi.fn();
        renderTree(rootValue(structN([
            ["codes", dictN([["7", str("critical")], ["12", str("routine")]], false)],
        ]), { onInsert, onRemove }));
        expect(screen.getByText("7")).toBeTruthy();
        expect(screen.getByText("critical")).toBeTruthy();
        // `editable: false` gates entry insert/remove only.
        expect(screen.queryByLabelText("Add entry")).toBeNull();
        expect(screen.queryByLabelText("Remove")).toBeNull();
    });

    test("dict entries display their label but echo their key in paths", async () => {
        const onEdit = vi.fn();
        const entry = { key: '(machine="press", shift=2)', label: "press · 2", node: str("1980") };
        const codes = variant("dict", { entries: [entry], editable: false }) as unknown as ValueTreeNodeValue;
        renderTree(rootValue(codes, { onEdit }));
        // The row shows the display label, never the canonical key text.
        expect(screen.getByText("press · 2")).toBeTruthy();
        expect(screen.queryByText('(machine="press", shift=2)')).toBeNull();
        // The value's leaf editor reports the canonical KEY step.
        const input = document.querySelector("input")!;
        fireEvent.change(input, { target: { value: "2000" } });
        await waitFor(() => expect(onEdit).toHaveBeenCalled());
        expect(onEdit.mock.calls[0]?.[0]).toEqual([variant("key", '(machine="press", shift=2)')]);
    });

    test("option rows read Not set with a Set/Clear affordance", async () => {
        const onTag = vi.fn();
        renderTree(rootValue(structN([
            ["operator", optN()],
            ["fallback", optN(str("dana"))],
        ]), { onTag }));
        expect(screen.getByText("Not set")).toBeTruthy();
        fireEvent.click(screen.getByLabelText("Set value"));
        await waitFor(() => expect(onTag).toHaveBeenCalled());
        expect(onTag.mock.calls[0]).toEqual([[variant("field", "operator")], "some"]);
        fireEvent.click(screen.getByLabelText("Clear value"));
        await waitFor(() => expect(onTag).toHaveBeenCalledTimes(2));
        expect(onTag.mock.calls[1]).toEqual([[variant("field", "fallback")], "none"]);
    });

    test("variant rows mount the tag select and show the payload inline", () => {
        const onTag = vi.fn();
        renderTree(rootValue(structN([
            ["state", varN("down", ["down", "running"], str("belt snapped"))],
        ]), { onTag }));
        expect(screen.getByLabelText("Variant tag")).toBeTruthy();
        // Payload leaf is editable inline under the variant wrapper.
        expect(screen.getByText("State")).toBeTruthy();
    });

    test("read-only variants surface the active tag as humanized text", () => {
        renderTree(rootValue(structN([
            ["state", varN("running", ["down", "running"], leaf(variant("null", null)))],
        ])));
        expect(screen.getByText("Running")).toBeTruthy();
        // The null payload's redundant value is dropped next to the tag.
        expect(screen.queryByText("null")).toBeNull();
    });

    test("opaque nodes render the summarized value read-only", () => {
        renderTree(rootValue(structN([
            ["tags", opaqueN("Set · 2 items")],
        ])));
        expect(screen.getByText("Set · 2 items")).toBeTruthy();
    });

    test("a root collection appends a ghost add row", async () => {
        const onInsert = vi.fn();
        renderTree(rootValue(arrN([flt(1.0), flt(2.5)]), { onInsert }));
        fireEvent.click(screen.getByLabelText("Add item"));
        await waitFor(() => expect(onInsert).toHaveBeenCalled());
        expect(onInsert.mock.calls[0]?.[0]).toEqual([variant("append", null)]);
    });

    test("a leaf root renders as a single Value row", () => {
        renderTree(rootValue(int(42n)));
        expect(screen.getByText("Value")).toBeTruthy();
        expect(screen.getByText("42")).toBeTruthy();
    });

    test("inline scrollToRow highlights the Nth root row (#520)", () => {
        renderTree(rootValue(dictN([
            ["alpha", str("a")],
            ["beta", str("b")],
            ["gamma", str("c")],
        ], false)), 1);
        const beta = screen.getByText("beta").closest("[data-part=row]")!;
        expect(beta.hasAttribute("data-match")).toBe(true);
        expect(screen.getByText("alpha").closest("[data-part=row]")!.hasAttribute("data-match")).toBe(false);
        expect(document.querySelectorAll("[data-match]").length).toBe(1);
    });

    test("rows carry aria tree semantics", () => {
        renderTree(rootValue(structN([
            ["first", flt(1.0)],
            ["second", flt(2.0)],
        ])));
        const first = screen.getByText("First").closest("[data-part=row]")!;
        expect(first.getAttribute("role")).toBe("treeitem");
        expect(first.getAttribute("aria-level")).toBe("1");
        expect(first.getAttribute("aria-posinset")).toBe("1");
        expect(first.getAttribute("aria-setsize")).toBe("2");
    });

    test("arrow keys traverse rows; Right/Left expand and collapse", () => {
        renderTree(rootValue(structN([
            ["outer", structN([
                ["inner", structN([["deep", structN([["n", int(7n)]])]])],
            ])],
        ])));
        const outer = screen.getByText("Outer").closest("[data-part=row]") as HTMLElement;
        expect(outer.getAttribute("tabindex")).toBe("0");
        outer.focus();
        fireEvent.keyDown(outer, { key: "ArrowDown" });
        const inner = screen.getByText("Inner").closest("[data-part=row]") as HTMLElement;
        expect(document.activeElement).toBe(inner);
        // Inner starts collapsed (one level open) — Right expands it.
        expect(inner.getAttribute("aria-expanded")).toBe("false");
        fireEvent.keyDown(inner, { key: "ArrowRight" });
        fireEvent.keyDown(inner, { key: "ArrowDown" });
        const deep = screen.getByText("Deep").closest("[data-part=row]") as HTMLElement;
        expect(document.activeElement).toBe(deep);
        // Right expands the collapsed branch, Left collapses it again.
        expect(deep.getAttribute("aria-expanded")).toBe("false");
        fireEvent.keyDown(deep, { key: "ArrowRight" });
        expect(screen.getByText("N")).toBeTruthy();
        fireEvent.keyDown(deep, { key: "ArrowLeft" });
        expect(screen.queryByText("N")).toBeNull();
        // ArrowUp walks back to the parent row.
        fireEvent.keyDown(deep, { key: "ArrowUp" });
        expect(document.activeElement).toBe(inner);
    });
});

// Remote paging (#497): the tree's root rows come from a host-owned page
// map; the extent spans totalRows, unloaded rows render placeholders, and
// the visible window is requested from the host.
describe("EastChakraValueTree — remote paging", () => {
    const pagedItem = (name: string, i: number): ValueTreePagedRow => ({
        node: structN([["name", str(name)], ["n", int(BigInt(i))]]),
        step: variant("index", BigInt(i)),
    });

    function renderPaged(paging: ValueTreePaging, style?: { height?: string }) {
        keyCounter += 1;
        const value = rootValue(arrN([]), {}, style);
        const view = render(
            <ChakraProvider value={system}>
                <EastChakraValueTree value={value} storageKey={`vt-paged-${keyCounter}`} paging={paging} />
            </ChakraProvider>,
        );
        return {
            ...view,
            rerenderPaging: (next: ValueTreePaging) => view.rerender(
                <ChakraProvider value={system}>
                    <EastChakraValueTree value={value} storageKey={`vt-paged-${keyCounter}`} paging={next} />
                </ChakraProvider>,
            ),
        };
    }

    test("spans totalRows, renders placeholders, and requests the visible window", () => {
        const onNeedRows = vi.fn();
        const view = renderPaged({
            totalRows: 6,
            pageSize: 2,
            pages: new Map([[0, [pagedItem("Press", 0), pagedItem("Mill", 1)]]]),
            onNeedRows,
        });
        // Loaded rows carry content-derived labels and the full extent.
        const press = screen.getAllByText("Press")[0]!.closest("[data-part=row]")!;
        expect(press.getAttribute("aria-setsize")).toBe("6");
        expect(press.getAttribute("aria-posinset")).toBe("1");
        // Unloaded rows (2..5) render as skeleton placeholder rows.
        expect(view.container.querySelectorAll("[data-placeholder-row]").length).toBe(4);
        expect(view.container.querySelector('[data-placeholder-row="2"]')).toBeTruthy();
        expect(view.container.querySelector('[data-placeholder-row="5"]')).toBeTruthy();
        // The mount effect asks the host for the window starting at the top.
        expect(onNeedRows).toHaveBeenCalled();
        expect(onNeedRows.mock.calls[0]?.[0]).toBe(0);
    });

    test("newly loaded pages replace their placeholders", () => {
        const onNeedRows = vi.fn();
        const page0: [number, ValueTreePagedRow[]] = [0, [pagedItem("Press", 0), pagedItem("Mill", 1)]];
        const view = renderPaged({ totalRows: 4, pageSize: 2, pages: new Map([page0]), onNeedRows });
        expect(view.container.querySelectorAll("[data-placeholder-row]").length).toBe(2);
        view.rerenderPaging({
            totalRows: 4,
            pageSize: 2,
            pages: new Map([page0, [1, [pagedItem("Wrapper", 2), pagedItem("Oven", 3)]]]),
            onNeedRows,
        });
        expect(view.container.querySelectorAll("[data-placeholder-row]").length).toBe(0);
        expect(screen.getAllByText("Wrapper").length).toBeGreaterThan(0);
        const oven = screen.getAllByText("Oven")[0]!.closest("[data-part=row]")!;
        expect(oven.getAttribute("aria-posinset")).toBe("4");
    });

    test("loaded paged rows expand like ordinary rows with global path steps", () => {
        renderPaged({
            totalRows: 3,
            pageSize: 2,
            pages: new Map([[0, [pagedItem("Press", 0), pagedItem("Mill", 1)]]]),
            onNeedRows: () => { /* not exercised */ },
        });
        // Depth-0 rows start expanded, so the struct's fields are visible.
        expect(screen.getAllByText("Name").length).toBe(2);
        const press = screen.getAllByText("Press")[0]!.closest("[data-part=row]")!;
        fireEvent.click(press.querySelector("button[aria-label=Collapse]")!);
        expect(screen.getAllByText("Name").length).toBe(1);
    });

    // Controlled jump (#520): scrollToRow scrolls the target root row into
    // view, transiently highlights it, and requests its window so an
    // unloaded target self-loads.
    test("scrollToRow highlights the target root row, not its neighbours or children", () => {
        renderPaged({
            totalRows: 6,
            pageSize: 2,
            pages: new Map([[0, [pagedItem("Press", 0), pagedItem("Mill", 1)]]]),
            onNeedRows: () => { /* not exercised */ },
            scrollToRow: 1,
        });
        const mill = screen.getAllByText("Mill")[0]!.closest("[data-part=row]")!;
        expect(mill.hasAttribute("data-match")).toBe(true);
        const press = screen.getAllByText("Press")[0]!.closest("[data-part=row]")!;
        expect(press.hasAttribute("data-match")).toBe(false);
        // Children of the matched row carry no highlight of their own.
        expect(document.querySelectorAll("[data-match]").length).toBe(1);
    });

    test("a jump to an unloaded row highlights its placeholder", () => {
        const view = renderPaged({
            totalRows: 6,
            pageSize: 2,
            pages: new Map([[0, [pagedItem("Press", 0), pagedItem("Mill", 1)]]]),
            onNeedRows: () => { /* not exercised */ },
            scrollToRow: 3,
        });
        const target = view.container.querySelector('[data-placeholder-row="3"]')!;
        expect(target.hasAttribute("data-match")).toBe(true);
        expect(view.container.querySelector('[data-placeholder-row="2"]')!.hasAttribute("data-match")).toBe(false);
    });

    test("scrollToRow scrolls a bounded tree to the target and requests its window", () => {
        const onNeedRows = vi.fn();
        const view = renderPaged({
            totalRows: 1000,
            pageSize: 2,
            pages: new Map([[0, [pagedItem("Press", 0), pagedItem("Mill", 1)]]]),
            onNeedRows,
            scrollToRow: 500,
        }, { height: "300px" });
        // Page 0's two loaded roots flatten to 6 rows (struct children start
        // expanded); rows 2..499 are one placeholder each — flat 504 — and
        // the jump leaves two context rows above.
        const scrollEl = view.container.querySelector('[role="tree"]')!.firstElementChild as HTMLElement;
        expect(scrollEl.scrollTop).toBe((504 - 2) * 32);
        expect(
            onNeedRows.mock.calls.some(([start, end]) => (start as number) <= 500 && 500 < (end as number)),
            "the destination window was requested",
        ).toBe(true);
    });
});

// The host-side materialize/applyEdit pair (in @elaraai/east-ui) that the e3
// preview uses to render + edit a DECODED value (rather than an Expr).
describe("ValueTree.materialize / applyEdit (host)", () => {
    const Row = StructType({
        n: IntegerType,
        tags: ArrayType(StringType),
        opt: OptionType(IntegerType),
        pick: VariantType({ a: IntegerType, b: StringType }),
        bag: DictType(StringType, IntegerType),
    });
    const sample = () => ({
        n: 3n,
        tags: ["x", "y"],
        opt: none as unknown,
        pick: variant("a", 7n) as unknown,
        bag: new Map<string, bigint>([["k", 1n]]),
    });
    const tagOf = (v: unknown) => (v as { type: string }).type;

    test("materialize walks the type into the fixed node shape", () => {
        const root = ValueTree.materialize(Row, sample()) as { type: string; value: { fields: Array<{ name: string; node: { type: string } }> } };
        expect(root.type).toBe("struct");
        const byName = Object.fromEntries(root.value.fields.map(f => [f.name, f.node.type]));
        expect(byName).toEqual({ n: "leaf", tags: "array", opt: "option", pick: "variant", bag: "dict" });
    });

    test("edit replaces the addressed leaf", () => {
        const next = ValueTree.applyEdit(Row, sample(), [variant("field", "n")], { kind: "edit", leaf: variant("integer", 9n) }) as { n: bigint };
        expect(next.n).toBe(9n);
    });

    test("array append then remove", () => {
        const added = ValueTree.applyEdit(Row, sample(), [variant("field", "tags"), variant("append", null)], { kind: "insert" }) as { tags: string[] };
        expect(added.tags).toEqual(["x", "y", ""]);
        const dropped = ValueTree.applyEdit(Row, sample(), [variant("field", "tags"), variant("index", 0n)], { kind: "remove" }) as { tags: string[] };
        expect(dropped.tags).toEqual(["y"]);
    });

    test("dict key add then remove", () => {
        const added = ValueTree.applyEdit(Row, sample(), [variant("field", "bag"), variant("key", "z")], { kind: "insert" }) as { bag: Map<string, bigint> };
        expect(added.bag.get("z")).toBe(0n);
        const dropped = ValueTree.applyEdit(Row, sample(), [variant("field", "bag"), variant("key", "k")], { kind: "remove" }) as { bag: Map<string, bigint> };
        expect(dropped.bag.has("k")).toBe(false);
    });

    test("variant tag switch resets to the case zero", () => {
        const next = ValueTree.applyEdit(Row, sample(), [variant("field", "pick")], { kind: "tag", tag: "b" }) as { pick: { type: string; value: unknown } };
        expect(tagOf(next.pick)).toBe("b");
        expect(next.pick.value).toBe("");
    });

    test("option toggle none → some(zero) and back", () => {
        const on = ValueTree.applyEdit(Row, sample(), [variant("field", "opt")], { kind: "tag", tag: "some" }) as { opt: { type: string; value: unknown } };
        expect(tagOf(on.opt)).toBe("some");
        expect(on.opt.value).toBe(0n);
        const off = ValueTree.applyEdit(Row, { ...sample(), opt: some(5n) }, [variant("field", "opt")], { kind: "tag", tag: "none" }) as { opt: { type: string } };
        expect(tagOf(off.opt)).toBe("none");
    });

    test("edit nested through an option's some payload", () => {
        const start = { ...sample(), opt: some(2n) };
        const next = ValueTree.applyEdit(Row, start, [variant("field", "opt"), variant("some", null)], { kind: "edit", leaf: variant("integer", 42n) }) as { opt: { value: bigint } };
        expect(next.opt.value).toBe(42n);
    });

    test("struct-keyed dict entries label as field summaries, never [object Object]", () => {
        const MachineKey = StructType({ machine: StringType, line: StringType, shift: IntegerType });
        const Machines = DictType(MachineKey, StructType({ units: IntegerType }));
        const value = new Map([
            [{ machine: "press", line: "L4", shift: 2n }, { units: 1980n }],
            [{ machine: "mill", line: "L2", shift: 2n }, { units: 1980n }],
        ]);
        const root = ValueTree.materialize(Machines, value) as unknown as {
            type: string; value: { editable: boolean; entries: Array<{ key: string; label: string }> };
        };
        expect(root.type).toBe("dict");
        expect(root.value.editable).toBe(false);
        const labels = root.value.entries.map(e => e.label);
        expect(labels).toContain("press · L4 · 2");
        expect(labels).toContain("mill · L2 · 2");
        // Entry keys carry the canonical East print — identity, not display.
        const keys = root.value.entries.map(e => e.key);
        expect(keys).toContain('(machine="press", line="L4", shift=2)');
        for (const k of [...keys, ...labels]) expect(k.includes("[object Object]")).toBe(false);
    });

    test("struct-keyed dict edits resolve the real entry through the materialized key", () => {
        const MachineKey = StructType({ machine: StringType, shift: IntegerType });
        const Machines = DictType(MachineKey, StructType({ units: IntegerType }));
        const value = new Map([
            [{ machine: "press", shift: 2n }, { units: 1980n }],
            [{ machine: "mill", shift: 1n }, { units: 1200n }],
        ]);
        const root = ValueTree.materialize(Machines, value) as unknown as {
            value: { entries: Array<{ key: string; label: string }> };
        };
        // Close the renderer loop: edit through the entry's own key text.
        const key = root.value.entries.find(e => e.label === "press · 2")!.key;
        const next = ValueTree.applyEdit(Machines, value,
            [variant("key", key), variant("field", "units")],
            { kind: "edit", leaf: variant("integer", 2000n) }) as Map<unknown, { units: bigint }>;
        // The REAL entry updated — no phantom string-keyed entry appears.
        expect(next.size).toBe(2);
        const entries = [...next.entries()] as Array<[{ machine: string; shift: bigint }, { units: bigint }]>;
        expect(entries.find(([k]) => k.machine === "press")![1].units).toBe(2000n);
        expect(entries.find(([k]) => k.machine === "mill")![1].units).toBe(1200n);
        for (const [k] of entries) expect(typeof k).toBe("object");
    });

    test("datetime-keyed dict edits round-trip through the canonical print", () => {
        const Series = DictType(DateTimeType, IntegerType);
        const t0 = new Date("2024-06-01T00:00:00.000Z");
        const t1 = new Date("2024-06-02T00:00:00.000Z");
        const value = new Map([[t0, 10n], [t1, 20n]]);
        const root = ValueTree.materialize(Series, value) as unknown as {
            value: { entries: Array<{ key: string }> };
        };
        const next = ValueTree.applyEdit(Series, value,
            [variant("key", root.value.entries[0]!.key)],
            { kind: "edit", leaf: variant("integer", 99n) }) as Map<Date, bigint>;
        expect(next.size).toBe(2);
        expect([...next.values()]).toEqual([99n, 20n]);
    });

    test("non-string-keyed dict removes drop the addressed entry by value", () => {
        const Codes = DictType(IntegerType, StringType);
        const value = new Map([[7n, "critical"], [12n, "routine"]]);
        const next = ValueTree.applyEdit(Codes, value,
            [variant("key", "7")], { kind: "remove" }) as Map<bigint, string>;
        expect(next.size).toBe(1);
        expect(next.has(12n)).toBe(true);
    });

    test("dict inserts keep canonical key order for re-encoding", () => {
        const added = ValueTree.applyEdit(Row, sample(),
            [variant("field", "bag"), variant("key", "a")], { kind: "insert" }) as { bag: Map<string, bigint> };
        // The rebuilt dict is a sorted East container — a prepended key
        // lands in canonical position, not JS insertion order.
        expect([...added.bag.keys()]).toEqual(["a", "k"]);
    });

    test("a stale key step throws instead of fabricating a phantom entry", () => {
        const Codes = DictType(IntegerType, StringType);
        const value = new Map([[7n, "critical"]]);
        expect(() => ValueTree.applyEdit(Codes, value,
            [variant("key", "12")], { kind: "edit", leaf: variant("string", "x") })).toThrow(/no dict entry/);
        expect(() => ValueTree.applyEdit(Codes, value,
            [variant("key", "not-a-key")], { kind: "edit", leaf: variant("string", "x") })).toThrow(/canonical print/);
    });

    test("materialization never degrades entries to [object Object] rows mid-list", () => {
        // Thousands of identical option-heavy records — every entry must
        // materialize as a real struct node regardless of its position, and
        // any budget-driven truncation must label itself honestly.
        const Rec = StructType({
            grade: OptionType(StringType),
            site: StringType,
            station: StringType,
            slots: IntegerType,
            active: OptionType(StringType),
        });
        const Table = DictType(StringType, Rec);
        const record = { grade: none as unknown, site: "S1", station: "N2", slots: 0n, active: none as unknown };
        const value = new Map(Array.from({ length: 5000 }, (_, i) => [`B${4000 + i}B`, record] as const));
        const root = ValueTree.materialize(Table, value) as {
            type: string; value: { entries: Array<{ key: string; node: { type: string; value: unknown } }> };
        };
        expect(root.value.entries.length).toBe(5000);
        for (const e of root.value.entries) {
            expect(e.node.type).toBe("struct");
        }
        const json = JSON.stringify(root, (_k, v) => (typeof v === "bigint" ? String(v) : v as unknown));
        expect(json.includes("[object Object]")).toBe(false);
    });
});
