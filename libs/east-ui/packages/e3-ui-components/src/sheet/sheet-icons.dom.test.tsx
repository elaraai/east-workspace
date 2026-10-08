/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet's chevrons and its number field's steppers are Font Awesome's
 * solid icons (#1263), never a chevron drawn by hand nor Chakra's own: a
 * group's fold and a line's sub-row chevron are chevron-right — which their
 * buttons turn, never swap — the fold-all is angles-right, and the steppers
 * are chevron-up and chevron-down, named as Ark names them.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, East, IntegerType, StringType, StructType } from "@elaraai/east";
import { Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import { system, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { foreignIcons, markOf } from "@elaraai/east-ui-components/testing";
import { EastChakraSheet, type SheetValue } from "./frame/index.js";
import { boundFrame } from "./frame.test-utils.js";
import { sheetJournal } from "./journal.test-utils.js";

// The frame tall enough that every row of these sheets is mounted.
let restoreFrame: () => void = () => {};
beforeEach(() => { localStorage.clear(); initializeStore(new UIStore()); restoreFrame = boundFrame(2000); });
afterEach(() => { cleanup(); restoreFrame(); });

// jsdom lacks the ResizeObserver the frame watches its width with.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const OpType = StructType({ code: StringType, name: StringType });
const LineType = StructType({ task: StringType, ops: ArrayType(OpType) });
const PlanType = StructType({ id: StringType, name: StringType, lines: ArrayType(LineType) });
const JobType = StructType({ id: StringType, task: StringType, qty: IntegerType });

/** Fixtures at module scope: East bodies never call host helpers. */
const OPS = [{ code: "CUT", name: "Cut to length" }, { code: "DRL", name: "Drill" }];
const PLANS = [
    { id: "P0", name: "Plan 0", lines: [{ task: "Cut 0", ops: OPS }, { task: "Fit 0", ops: [] }] },
    { id: "P1", name: "Plan 1", lines: [{ task: "Cut 1", ops: OPS }, { task: "Fit 1", ops: [] }] },
];
const JOBS = [{ id: "j0", task: "Cut", qty: 12n }, { id: "j1", task: "Drill", qty: 4n }];

/** Two plans, each a band over two lines, the first with two operations as its sub rows, then its blank line. */
const plans = East.function([], SheetPayloadType, ($) => {
    const data = $.let(PLANS, ArrayType(PlanType));
    return Sheet.Payload({
        data,
        columns: { task: Sheet.column.text(LineType, { header: "Task" }) },
        id: "id",
        group: Sheet.group(PlanType, "lines", { title: "name" }),
        subRows: Sheet.subRows(LineType, { ops: (op) => Sheet.subRow({ code: op.code, name: op.name }) }),
    });
});

/** Two jobs, each with a whole-number quantity, which the number field edits. */
const jobs = East.function([], SheetPayloadType, ($) => {
    const data = $.let(JOBS, ArrayType(JobType));
    return Sheet.Payload({
        data,
        columns: { task: Sheet.column.text(JobType, { header: "Task" }), qty: Sheet.column.integer(JobType, { header: "Qty" }) },
        id: "id",
    });
});

/** A program's sheet, editable, its patches journalled. */
const sheetOf = (program: typeof plans) => sheetJournal(East.compile(program, getRegisteredPlatformImplementations())()).value;

function mount(value: SheetValue) {
    const ui = render(
        <ChakraProvider value={system}>
            <EastChakraSheet value={value} storageKey="sheet-icons-test" />
        </ChakraProvider>,
    );
    const card = ui.container.querySelector("[data-sheet-card]") as HTMLElement;
    /** A group's band, by its id. */
    const band = (id: string) => ui.container.querySelector(`[data-slot="row"][data-band-row][data-row-id="${id}"]`) as HTMLElement;
    /** A group's lines, in order — its blank line last. */
    const lines = (id: string) => [...ui.container.querySelectorAll<HTMLElement>(`[data-slot="row"][data-group-id="${id}"]`)];
    const flush = () => act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    return { ...ui, card, band, lines, flush };
}

describe("the Sheet's chevrons and steppers are Font Awesome's (#1263)", () => {
    test("a group's fold and a line's sub-row chevron are chevron-right, the fold-all angles-right; folding turns them and never swaps them", () => {
        const ui = mount(sheetOf(plans));
        const foldAll = () => ui.container.querySelector<HTMLElement>('[data-slot="foldAll"]')!;
        const folds = () => ["P0", "P1"].map((id) => markOf(ui.band(id).querySelector('[data-slot="fold"]')));
        // Each plan's first line carries its operations under a chevron; its second line, and the blank line after it, none.
        expect(["P0", "P1"].map((id) => ui.lines(id).map((line) => markOf(line.querySelector('[data-slot="subRowChevron"]')))))
            .toEqual([["fas chevron-right", null, null], ["fas chevron-right", null, null]]);
        expect([folds(), markOf(foldAll()), foldAll().hasAttribute("data-folded")]).toEqual([["fas chevron-right", "fas chevron-right"], "fas angles-right", false]);
        fireEvent.click(foldAll());
        expect([folds(), markOf(foldAll()), foldAll().hasAttribute("data-folded")]).toEqual([["fas chevron-right", "fas chevron-right"], "fas angles-right", true]);
        // Nothing in the sheet draws an icon that is not Font Awesome's.
        expect(foreignIcons(ui.container)).toEqual([]);
    });

    test("the number field's steppers are chevron-up and chevron-down, named as Ark names them", async () => {
        const ui = mount(sheetOf(jobs));
        fireEvent.mouseDown(ui.container.querySelector('[data-slot="row"][data-row="0"] [data-key="qty"]')!, { button: 0 });
        fireEvent.keyDown(ui.card, { key: "Enter" });
        await ui.flush();
        const stepper = ui.container.querySelector<HTMLElement>('[data-slot="editorStepper"]')!;
        expect([...stepper.querySelectorAll('[data-scope="number-input"][data-part$="-trigger"]')].map((trigger) => [trigger.getAttribute("aria-label"), markOf(trigger)]))
            .toEqual([["increment value", "fas chevron-up"], ["decrease value", "fas chevron-down"]]);
        expect(foreignIcons(ui.container)).toEqual([]);
    });
});
