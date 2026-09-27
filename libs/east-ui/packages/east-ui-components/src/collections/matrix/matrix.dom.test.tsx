/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Matrix's rows nest (#955): the rows arrive in pre-order, a parent is a
 * full row — its header, indented with a fold caret, and its own cells — and
 * its caret folds exactly its subtree, the fold persisting by path. Events
 * keep addressing a row by its key, at any depth. The trees are built by the
 * east-ui factory and COMPILED, so the renderer reads what an author's
 * program produces.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DictType, East, FloatType, RecursiveType, StringType, StructType, some, type ValueTypeOf,
} from "@elaraai/east";
import { Matrix, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { EastChakraMatrix, type MatrixRootValue } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => {
    initializeStore(new UIStore());
    localStorage.clear();
});
afterEach(cleanup);

type UIValue = ValueTypeOf<typeof UIComponentType>;

// ── Fixtures, at module scope ───────────────────────────────────────────────

/** A tree row: a name, its bookings, and its own rows. */
const Node = RecursiveType((self) => StructType({
    name: StringType,
    booked: DictType(StringType, FloatType),
    rows: ArrayType(self),
}));

/**
 * a        [0]            booked 0.5
 *   a1     [0, 0]         booked 0.4
 *     x    [0, 0, 0]      booked 0.3   (a parent key repeated in another subtree)
 *       y  [0, 0, 0, 0]   booked 0.25
 *   a2     [0, 1]         booked 0.2
 * b        [1]            booked 0.1   (declared collapsed)
 *   x      [1, 0]         booked 0.6
 *     z    [1, 0, 0]      booked 0.35
 */
const TREE = [
    { name: "a", booked: new Map([["mon", 0.5]]), rows: [
        { name: "a1", booked: new Map([["mon", 0.4]]), rows: [
            { name: "x", booked: new Map([["mon", 0.3]]), rows: [
                { name: "y", booked: new Map([["mon", 0.25]]), rows: [] },
            ] },
        ] },
        { name: "a2", booked: new Map([["mon", 0.2]]), rows: [] },
    ] },
    { name: "b", booked: new Map([["mon", 0.1]]), rows: [
        { name: "x", booked: new Map([["mon", 0.6]]), rows: [
            { name: "z", booked: new Map([["mon", 0.35]]), rows: [] },
        ] },
    ] },
];

/** The tree as a compiled Matrix, `b` declared collapsed. */
const NESTED = East.compile(East.function([], UIComponentType, ($) => {
    const tree = $.const(TREE, ArrayType(Node));
    return Matrix.Root(tree, {
        columns: [Matrix.column({ key: "mon", label: "Mon" })],
        rowKey: (r) => r.name,
        tree: { children: (r) => r.rows, collapsed: (r) => r.name.equal("b") },
        cell: (r, col) => Matrix.cell({ segments: [
            Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
            Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
        ] }),
    });
}), getRegisteredPlatformImplementations())() as UIValue;

/** Two flat rows. */
const FLAT = East.compile(East.function([], UIComponentType, ($) => {
    const rows = $.const([{ name: "p", booked: new Map([["mon", 0.5]]) }, { name: "q", booked: new Map([["mon", 0.7]]) }],
        ArrayType(StructType({ name: StringType, booked: DictType(StringType, FloatType) })));
    return Matrix.Root(rows, {
        columns: [Matrix.column({ key: "mon", label: "Mon" })],
        rowKey: (r) => r.name,
        cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
    });
}), getRegisteredPlatformImplementations())() as UIValue;

/** The compiled value's Matrix root, optionally with a host callback. */
function rootOf(ui: UIValue, extra: Partial<MatrixRootValue> = {}): MatrixRootValue {
    return { ...((ui as unknown as { value: MatrixRootValue }).value), ...extra };
}

function renderMatrix(value: MatrixRootValue, key: string) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraMatrix value={value} storageKey={key} />
        </ChakraProvider>,
    );
}

/** The rows on show, as `key@depth`, in display order. */
function shown(container: HTMLElement): string[] {
    return [...container.querySelectorAll<HTMLElement>("[data-row-key]")]
        .map((r) => `${r.getAttribute("data-row-key")}@${r.getAttribute("data-depth") ?? "-"}`);
}

/** The first row on show with a key, at a depth. */
function rowAt(container: HTMLElement, key: string, depth: number): HTMLElement {
    const row = [...container.querySelectorAll<HTMLElement>(`[data-row-key="${key}"]`)].find((r) => r.getAttribute("data-depth") === String(depth));
    if (row === undefined) throw new Error(`no row ${key}@${depth}; rows: ${shown(container).join(", ")}`);
    return row;
}

describe("nested Matrix rows (#955)", () => {
    test("rows show in pre-order at their depths, a declared-collapsed parent closed, a caret on the parents only", () => {
        const { container } = renderMatrix(rootOf(NESTED), "matrix-tree-display");
        expect(shown(container)).toEqual(["a@0", "a1@1", "x@2", "y@3", "a2@1", "b@0"]);
        const rows = [...container.querySelectorAll<HTMLElement>("[data-row-key]")];
        expect(rows.map((r) => r.hasAttribute("data-parent"))).toEqual([true, true, true, false, false, true]);
        expect(rows.map((r) => r.querySelector('[data-slot="treeToggle"]') !== null)).toEqual([true, true, true, false, false, true]);
        expect(rows.map((r) => (r.querySelector('[data-slot="treeIndent"]') as HTMLElement).style.getPropertyValue("--table-depth")))
            .toEqual(["0", "1", "2", "3", "1", "0"]);
        expect(rowAt(container, "b", 0).querySelector('[data-slot="treeToggle"]')!.getAttribute("aria-expanded")).toBe("false");
    });

    test("a parent is a full row: its header and its own cells", () => {
        const { container } = renderMatrix(rootOf(NESTED), "matrix-tree-cells");
        const a = rowAt(container, "a", 0);
        expect(a.querySelector('[data-slot="rowHeaderName"]')!.textContent).toBe("a");
        expect(a.querySelectorAll('[data-slot="cell"] [data-slot="seg"]').length).toBe(2);
    });

    test("folding a parent hides exactly its subtree, and the folds persist", () => {
        const first = renderMatrix(rootOf(NESTED), "matrix-tree-fold");
        fireEvent.click(rowAt(first.container, "a1", 1).querySelector('[data-slot="treeToggle"]')!);
        expect(shown(first.container)).toEqual(["a@0", "a1@1", "a2@1", "b@0"]);
        fireEvent.click(rowAt(first.container, "b", 0).querySelector('[data-slot="treeToggle"]')!);
        expect(shown(first.container)).toEqual(["a@0", "a1@1", "a2@1", "b@0", "x@1", "z@2"]);
        first.unmount();

        // Remounted under the same key, both folds hold.
        const second = renderMatrix(rootOf(NESTED), "matrix-tree-fold");
        expect(shown(second.container)).toEqual(["a@0", "a1@1", "a2@1", "b@0", "x@1", "z@2"]);
        fireEvent.click(rowAt(second.container, "a", 0).querySelector('[data-slot="treeToggle"]')!);
        expect(shown(second.container)).toEqual(["a@0", "b@0", "x@1", "z@2"]);
    });

    test("a fold belongs to its row's path, so two parents sharing a key fold apart", () => {
        const { container } = renderMatrix(rootOf(NESTED), "matrix-tree-keys");
        fireEvent.click(rowAt(container, "b", 0).querySelector('[data-slot="treeToggle"]')!);
        // Fold b's x: a1's x stays open.
        fireEvent.click(rowAt(container, "x", 1).querySelector('[data-slot="treeToggle"]')!);
        expect(shown(container)).toEqual(["a@0", "a1@1", "x@2", "y@3", "a2@1", "b@0", "x@1"]);
    });

    test("a cell click names its row by key, at any depth", async () => {
        const clicks: unknown[] = [];
        const { container } = renderMatrix(rootOf(NESTED, {
            onCellClick: some((e: { row: string; column: string }) => { clicks.push(e); return null; }),
        } as unknown as Partial<MatrixRootValue>), "matrix-tree-click");
        fireEvent.click(rowAt(container, "x", 2).querySelector('[data-slot="cell"]')!.firstElementChild!);
        await act(async () => { await Promise.resolve(); });
        expect(clicks).toEqual([{ row: "x", column: "mon" }]);
    });

    test("a flat matrix draws no indent and no caret", () => {
        const { container } = renderMatrix(rootOf(FLAT), "matrix-flat");
        expect(shown(container)).toEqual(["p@-", "q@-"]);
        expect(container.querySelector('[data-slot="treeIndent"]')).toBeNull();
    });
});
