/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A gesture re-renders only the rows it touches (#858): moving the ring, the
 * hover and typing in the editor render the rows they leave and enter, and no
 * other — not the lines of the groups beside them, not a line with sub rows,
 * not a draft row, not a row in a standing range, not the row being edited.
 * Renders are counted with the rows' own probe, so which rows rendered is
 * asserted deterministically. The Plan's #815.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, East, StringType, StructType, type ValueTypeOf } from "@elaraai/east";
import { Sheet, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { EastChakraSheet } from "./index.js";
import { setSheetRowRenderProbe } from "./Rows.js";
import { sheetJournal } from "./journal.test-utils.js";
import type { SheetRootValue } from "./values.js";

beforeEach(() => { localStorage.clear(); initializeStore(new UIStore()); });
afterEach(() => { cleanup(); setSheetRowRenderProbe(undefined); });

// jsdom lacks the ResizeObserver the frame watches its width with.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const JobType = StructType({ id: StringType, task: StringType, code: StringType });
const OpType = StructType({ code: StringType, name: StringType });
const LineType = StructType({ task: StringType, ops: ArrayType(OpType) });
const PlanType = StructType({ id: StringType, name: StringType, lines: ArrayType(LineType) });
const OPS = [{ code: "CUT", name: "Cut to length" }, { code: "DRL", name: "Drill" }];

/** An editable sheet of `n` jobs over two text columns — unbounded and under the virtualizing threshold, so every row is in flow. */
function buildJobs(n: number): SheetRootValue {
    const count = BigInt(n);
    const program = East.function([], UIComponentType, ($) => {
        const total = $.const(count);
        const jobs = $.let(East.Array.range(0n, total).map(($2, i) => $2.const({
            id: East.str`j${i}`, task: East.str`Task ${i}`, code: East.str`C${i}`,
        }, JobType)), ArrayType(JobType));
        return Sheet.Root(jobs, {
            task: Sheet.column.text(JobType, { header: "Task" }),
            code: Sheet.column.text(JobType, { header: "Code" }),
        }, { id: "id" });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return sheetJournal(value.value).value;
}

/** An editable grouped sheet of `n` plans: each a band over two lines, the first with two operations as its sub rows, then its blank line. */
function buildPlans(n: number): SheetRootValue {
    const count = BigInt(n);
    const program = East.function([], UIComponentType, ($) => {
        const ops = $.const(OPS, ArrayType(OpType));
        const noOps = $.const([], ArrayType(OpType));
        const total = $.const(count);
        const plans = $.let(East.Array.range(0n, total).map(($2, i) => $2.const({
            id: East.str`P${i}`, name: East.str`Plan ${i}`,
            lines: [{ task: East.str`Cut ${i}`, ops }, { task: East.str`Fit ${i}`, ops: noOps }],
        }, PlanType)), ArrayType(PlanType));
        return Sheet.Root(plans, {
            task: Sheet.column.text(LineType, { header: "Task" }),
        }, {
            id: "id",
            group: Sheet.group(PlanType, "lines", { title: "name" }),
            subRows: Sheet.subRows(LineType, { ops: (op) => Sheet.subRow({ code: op.code, name: op.name }) }),
        });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return sheetJournal(value.value).value;
}

function mount(value: SheetRootValue) {
    const ui = render(
        <ChakraProvider value={system}>
            <EastChakraSheet value={value} storageKey="sheet-render-test" />
        </ChakraProvider>,
    );
    const card = ui.container.querySelector("[data-sheet-card]") as HTMLElement;
    /** A row-space row — a row, a line or a band — by its index. */
    const row = (r: number) => ui.container.querySelector(`[data-slot="row"][data-row="${r}"]`) as HTMLElement;
    const cell = (r: number, key: string) => row(r).querySelector(`[data-key="${key}"]`) as HTMLElement;
    const input = () => ui.container.querySelector('[data-slot="editorInput"]') as HTMLInputElement | null;
    const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
    const flush = () => act(async () => { await tick(); await tick(); });
    // Every row that renders from here on, by its index; the copies that stick under the header are not rows.
    const rendered: number[] = [];
    setSheetRowRenderProbe((r, copy) => { if (!copy) rendered.push(r); });
    /** The rows that rendered since the last call, ascending, each once. */
    const took = () => {
        const out = [...new Set(rendered)].sort((a, b) => a - b);
        rendered.length = 0;
        return out;
    };
    return { ...ui, card, row, cell, input, flush, took };
}

describe("a gesture re-renders only the rows it touches (#858)", () => {
    test("moving the ring renders the row it leaves and the row it enters — a move within a row, that row", () => {
        const ui = mount(buildJobs(12));
        fireEvent.mouseDown(ui.cell(2, "task"), { button: 0 });
        ui.took();
        fireEvent.keyDown(ui.card, { key: "ArrowDown" });
        expect(ui.cell(3, "task").hasAttribute("data-selected")).toBe(true);
        expect(ui.took()).toEqual([2, 3]);
        fireEvent.keyDown(ui.card, { key: "ArrowRight" });
        expect(ui.cell(3, "code").hasAttribute("data-selected")).toBe(true);
        expect(ui.took()).toEqual([3]);
    });

    test("the hover renders the rows it leaves and enters", () => {
        const ui = mount(buildJobs(12));
        fireEvent.mouseEnter(ui.cell(5, "task"));
        ui.took();
        fireEvent.mouseEnter(ui.cell(6, "code"));
        expect(ui.took()).toEqual([5, 6]);
        fireEvent.mouseEnter(ui.cell(6, "task"));
        expect(ui.took()).toEqual([6]);
    });

    test("typing renders the edited row alone — and a hover beside the open editor never renders it", () => {
        const ui = mount(buildJobs(12));
        fireEvent.mouseDown(ui.cell(4, "task"), { button: 0 });
        fireEvent.keyDown(ui.card, { key: "x" });
        expect(ui.input()).not.toBeNull();
        ui.took();
        fireEvent.input(ui.input()!, { target: { value: "xy" } });
        expect(ui.took()).toEqual([4]);
        fireEvent.input(ui.input()!, { target: { value: "xyz" } });
        expect(ui.took()).toEqual([4]);
        fireEvent.mouseEnter(ui.cell(8, "task"));
        expect(ui.took()).toEqual([8]);
        expect(ui.input()!.value).toBe("xyz");
    });

    test("a draft row and a new row keep still while the ring moves elsewhere; a range keeps still under the hover", async () => {
        const ui = mount(buildJobs(12));
        // Row 1 is edited and committed: a draft.
        fireEvent.mouseDown(ui.cell(1, "task"), { button: 0 });
        fireEvent.keyDown(ui.card, { key: "x" });
        fireEvent.keyDown(ui.input()!, { key: "Enter" });
        await ui.flush();
        expect(ui.row(1).hasAttribute("data-draft")).toBe(true);
        // The first padding row takes a new row — a draft the gutter can discard.
        fireEvent.mouseDown(ui.cell(12, "task"), { button: 0 });
        fireEvent.keyDown(ui.card, { key: "n" });
        fireEvent.keyDown(ui.input()!, { key: "Enter" });
        await ui.flush();
        expect(ui.row(12).querySelector('[data-slot="discardDraft"]')).not.toBeNull();
        fireEvent.mouseDown(ui.cell(6, "task"), { button: 0 });
        ui.took();
        fireEvent.keyDown(ui.card, { key: "ArrowDown" });
        expect(ui.took()).toEqual([6, 7]);
        // A range over rows 2 and 3; the hover moves below it.
        fireEvent.mouseDown(ui.cell(2, "task"), { button: 0 });
        fireEvent.mouseDown(ui.cell(3, "code"), { button: 0, shiftKey: true });
        expect(ui.row(3).querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(2);
        fireEvent.mouseEnter(ui.cell(9, "task"));
        ui.took();
        fireEvent.mouseEnter(ui.cell(10, "task"));
        expect(ui.took()).toEqual([9, 10]);
    });

    test("between two lines of a group, the ring renders those two lines — never a band, another group's lines or a line with sub rows", () => {
        const ui = mount(buildPlans(3));
        const lines = (id: string) => [...ui.container.querySelectorAll(`[data-slot="row"][data-group-id="${id}"]`)] as HTMLElement[];
        const rOf = (el: HTMLElement) => Number(el.getAttribute("data-row"));
        // Each plan's first line carries its operations under a chevron.
        const [cut1, fit1] = lines("P1");
        expect(lines("P0")[0]!.querySelector('[data-slot="subRowChevron"]')).not.toBeNull();
        fireEvent.mouseDown(cut1!.querySelector('[data-key="task"]')!, { button: 0 });
        ui.took();
        fireEvent.keyDown(ui.card, { key: "ArrowDown" });
        expect(fit1!.querySelector('[data-key="task"]')!.hasAttribute("data-selected")).toBe(true);
        expect(ui.took()).toEqual([rOf(cut1!), rOf(fit1!)]);
        // The hover over the next group's band renders the band alone.
        const band2 = ui.container.querySelector('[data-slot="row"][data-band-row][data-row-id="P2"]') as HTMLElement;
        fireEvent.mouseEnter(band2.querySelector('[data-key="$title"]')!);
        expect(ui.took()).toEqual([]);
    });
});
