/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * ValueTree renderer (#360): flattened rows from the materialized node IR
 * (labels, leaf text, branch summaries, opaque prints), default-depth
 * expand with persisted toggles, and the typed edit surface — leaf
 * editors report `onEdit(path, leaf)`, array/dict controls report
 * `onInsert` / `onRemove`, option toggles and variant tag switches
 * report `onTag`. Without callbacks the tree is a read-only inspector.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastChakraValueTree, type ValueTreeValue, type ValueTreeNodeValue } from "./index.js";

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
const dictN = (entries: [string, ValueTreeNodeValue][]): ValueTreeNodeValue =>
    variant("dict", { entries: entries.map(([key, node]) => ({ key, node })) }) as unknown as ValueTreeNodeValue;
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
        expect(screen.getByText("rate")).toBeTruthy();
        expect(screen.getByText("0.15")).toBeTruthy();
        expect(screen.getByText("Base")).toBeTruthy();
        expect(screen.getByText("true")).toBeTruthy();
        // Read-only: no editors mounted.
        expect(document.querySelector("input")).toBeNull();
    });

    test("expands nested branches on toggle beyond the default depth", () => {
        renderTree(rootValue(structN([
            ["outer", structN([
                ["inner", structN([["deep", structN([["n", int(7n)]])]])],
            ])],
        ])));
        // Rows at depth < 2 start expanded, so `deep` (depth 2) is visible
        // but collapsed — its child `n` is not.
        expect(screen.getByText("deep")).toBeTruthy();
        expect(screen.queryByText("n")).toBeNull();
        const deepRow = screen.getByText("deep").closest("[data-part=row]")!;
        fireEvent.click(deepRow.querySelector("button[aria-label=Expand]")!);
        expect(screen.getByText("n")).toBeTruthy();
        fireEvent.click(deepRow.querySelector("button[aria-label=Collapse]")!);
        expect(screen.queryByText("n")).toBeNull();
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

    test("array rows expose add and per-item remove controls", async () => {
        const onInsert = vi.fn();
        const onRemove = vi.fn();
        renderTree(rootValue(structN([
            ["samples", arrN([flt(1.0), flt(2.5)])],
        ]), { onInsert, onRemove }));
        fireEvent.click(screen.getByLabelText("Add item"));
        await waitFor(() => expect(onInsert).toHaveBeenCalled());
        expect(onInsert.mock.calls[0]?.[0]).toEqual([variant("field", "samples")]);
        fireEvent.click(screen.getAllByLabelText("Remove")[1]!);
        await waitFor(() => expect(onRemove).toHaveBeenCalled());
        expect(onRemove.mock.calls[0]?.[0]).toEqual([variant("field", "samples"), variant("index", 1n)]);
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

    test("option toggles report onTag some/none at the option path", async () => {
        const onTag = vi.fn();
        renderTree(rootValue(structN([
            ["operator", optN()],
            ["fallback", optN(str("dana"))],
        ]), { onTag }));
        // none → "Set value"; some → "Clear value".
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
        expect(screen.getByText("state")).toBeTruthy();
    });

    test("read-only variants surface the active tag as text", () => {
        renderTree(rootValue(structN([
            ["state", varN("running", ["down", "running"], leaf(variant("null", null)))],
        ])));
        expect(screen.getByText("running")).toBeTruthy();
        // The null payload's redundant "null" is dropped next to the tag.
        expect(screen.queryByText("null")).toBeNull();
    });

    test("opaque nodes render the printed value read-only", () => {
        renderTree(rootValue(structN([
            ["matrix", opaqueN("[[1.0, 2.0], [3.0, 4.0]]")],
        ])));
        expect(screen.getByText("[[1.0, 2.0], [3.0, 4.0]]")).toBeTruthy();
    });

    test("a root collection appends a trailing add row", async () => {
        const onInsert = vi.fn();
        renderTree(rootValue(arrN([flt(1.0), flt(2.5)]), { onInsert }));
        fireEvent.click(screen.getByLabelText("Add item"));
        await waitFor(() => expect(onInsert).toHaveBeenCalled());
        expect(onInsert.mock.calls[0]?.[0]).toEqual([]);
    });

    test("a leaf root renders as a single 'value' row", () => {
        renderTree(rootValue(int(42n)));
        expect(screen.getByText("value")).toBeTruthy();
        expect(screen.getByText("42")).toBeTruthy();
    });
});
