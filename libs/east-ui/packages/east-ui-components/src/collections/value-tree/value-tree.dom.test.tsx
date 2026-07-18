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
 * inspector; non-string-keyed dicts are browsable but uneditable.
 */

import { useState } from "react";
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastChakraValueTree, type ValueTreeValue, type ValueTreeNodeValue, type ValueTreeLeafValue } from "./index.js";

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
        entries: entries.map(([key, node]) => ({ key, node })),
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

function rootValue(root: ValueTreeNodeValue, cbs: Cbs = {}): ValueTreeValue {
    return {
        root,
        onEdit: cbs.onEdit !== undefined ? some(cbs.onEdit) : none,
        onInsert: cbs.onInsert !== undefined ? some(cbs.onInsert) : none,
        onRemove: cbs.onRemove !== undefined ? some(cbs.onRemove) : none,
        onTag: cbs.onTag !== undefined ? some(cbs.onTag) : none,
        style: none,
    } as unknown as ValueTreeValue;
}

let keyCounter = 0;
function renderTree(value: ValueTreeValue) {
    keyCounter += 1;
    return render(
        <ChakraProvider value={system}>
            <EastChakraValueTree value={value} storageKey={`vt-test-${keyCounter}`} />
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
        // Rows at depth < 2 start expanded, so `deep` (depth 2) is visible
        // but collapsed — its child `n` is not.
        expect(screen.getByText("Deep")).toBeTruthy();
        expect(screen.queryByText("N")).toBeNull();
        const deepRow = screen.getByText("Deep").closest("[data-part=row]")!;
        fireEvent.click(deepRow.querySelector("button[aria-label=Expand]")!);
        expect(screen.getByText("N")).toBeTruthy();
        fireEvent.click(deepRow.querySelector("button[aria-label=Collapse]")!);
        expect(screen.queryByText("N")).toBeNull();
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

    test("non-string-keyed dicts are browsable but uneditable", () => {
        const onInsert = vi.fn();
        const onRemove = vi.fn();
        renderTree(rootValue(structN([
            ["codes", dictN([["7", str("critical")], ["12", str("routine")]], false)],
        ]), { onInsert, onRemove }));
        expect(screen.getByText("7")).toBeTruthy();
        expect(screen.getByText("critical")).toBeTruthy();
        expect(screen.queryByLabelText("Add entry")).toBeNull();
        expect(screen.queryByLabelText("Remove")).toBeNull();
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
