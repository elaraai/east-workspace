/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The gutter's number column is as wide as the widest number the sheet shows,
 * measured in the number's own face: what the column is measured by — a flat
 * sheet's last blank padding row, a grouped sheet's widest band, line or blank
 * line number, and apart its widest line number beside a sub rows' chevron —
 * and every width built on the gutter growing with it. The browser's widths
 * are the responsive suite's (`sheet-chrome.spec.ts`); jsdom lays nothing
 * out, so the measure here is a stand-in.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, East, StringType, StructType } from "@elaraai/east";
import { Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import { system, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
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

const JobType = StructType({ id: StringType, task: StringType });
const OpType = StructType({ code: StringType, name: StringType });
const LineType = StructType({ task: StringType, ops: ArrayType(OpType) });
const PlanType = StructType({ id: StringType, name: StringType, lines: ArrayType(LineType) });

/** Twelve jobs on an editable flat sheet: eighteen blank padding rows follow them. */
const JOBS = Array.from({ length: 12 }, (_x, i) => ({ id: `j${i}`, task: `Task ${i}` }));
const FLAT = East.function([], SheetPayloadType, ($) => {
    const jobs = $.const(JOBS, ArrayType(JobType));
    return Sheet.Payload({ data: jobs, columns: { task: Sheet.column.text(JobType, { header: "Task" }) }, id: "id" });
});

/** Two plans on an editable grouped sheet: twelve lines, the tenth with operations as its sub rows; then three, the first with them. */
const OPS = [{ code: "CUT", name: "Cut to length" }];
const PLANS = [
    { id: "P0", name: "Plan 0", lines: Array.from({ length: 12 }, (_x, i) => ({ task: `Step ${i + 1}`, ops: i === 9 ? OPS : [] })) },
    { id: "P1", name: "Plan 1", lines: [{ task: "Cut", ops: OPS }, { task: "Fit", ops: [] }, { task: "Pack", ops: [] }] },
];
const GROUPED = East.function([], SheetPayloadType, ($) => {
    const plans = $.const(PLANS, ArrayType(PlanType));
    return Sheet.Payload({
        data: plans,
        columns: { task: Sheet.column.text(LineType, { header: "Task" }) },
        id: "id",
        group: Sheet.group(PlanType, "lines", { title: "name" }),
        subRows: Sheet.subRows(LineType, { ops: (op) => Sheet.subRow({ code: op.code, name: op.name }) }),
    });
});

// Compiled once; each test gives its sheet an edit channel of its own (`sheetJournal`), so the sheet is writable.
const flatSheet = East.compile(FLAT, getRegisteredPlatformImplementations());
const groupedSheet = East.compile(GROUPED, getRegisteredPlatformImplementations());

function mount(value: SheetValue) {
    const ui = render(
        <ChakraProvider value={system}>
            <EastChakraSheet value={value} storageKey="gutter-number-test" />
        </ChakraProvider>,
    );
    const card = ui.container.querySelector("[data-sheet-card]") as HTMLElement;
    /** What the number column is measured by: each probe's number, and whether it sits beside a chevron. */
    const probes = () => [...card.querySelectorAll(":scope > [data-slot=numberMeasure] > *")]
        .map((n) => ({ number: n.textContent, chevron: n.hasAttribute("data-chevron") }));
    const numbers = () => [...card.querySelectorAll('[data-slot="row"] [data-slot="gutterNumber"]')].map((n) => Number(n.textContent));
    return { ...ui, card, probes, numbers };
}

describe("what the number column is measured by", () => {
    test("a flat sheet's widest number is its last blank padding row's — twelve rows and eighteen blank, 30 — and no chevron sits beside it", () => {
        const ui = mount(sheetJournal(flatSheet()).value);
        expect(Math.max(...ui.numbers())).toBe(30);
        expect(ui.probes()).toEqual([{ number: "30", chevron: false }]);
        // The probe is drawn as the rows draw their numbers, hidden from assistive tech.
        expect(ui.card.querySelector("[data-slot=numberMeasure]")!.getAttribute("aria-hidden")).toBe("true");
    });

    test("a grouped sheet's widest number is its widest line's — a blank line after twelve, 13 — and apart, the widest line beside its sub rows' chevron, 10", () => {
        const ui = mount(sheetJournal(groupedSheet()).value);
        // The bands number 1 and 2; P0's lines 1 to 12 and its blank line 13; P1's 1 to 3 and its blank line 4.
        expect(Math.max(...ui.numbers())).toBe(13);
        const chevrons = [...ui.card.querySelectorAll('[data-slot="row"] [data-slot="gutterNumber"][data-chevron]')].map((n) => n.textContent);
        expect(chevrons).toEqual(["10", "1"]);
        expect(ui.probes()).toEqual([{ number: "13", chevron: false }, { number: "10", chevron: true }]);
    });
});

describe("every width built on the gutter grows with its number column", () => {
    test("measured at 50 px, the number column is 50 px and the gutter 14 px wider — its rows', its header's and the seam lines' gutter", () => {
        // The stand-in measure: the widest probe draws 50 px, as five digits would.
        const measured = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            if (this.parentElement?.getAttribute("data-slot") === "numberMeasure") return { x: 0, y: 0, top: 0, left: 0, right: 50, bottom: 0, width: 50, height: 0, toJSON: () => ({}) } as DOMRect;
            return measured.call(this);
        };
        try {
            const ui = mount(sheetJournal(flatSheet()).value);
            expect(ui.card.style.getPropertyValue("--sheet-number")).toBe("50px");
            expect(ui.card.style.getPropertyValue("--sheet-gutter")).toBe("142px");
            const header = ui.card.querySelector<HTMLElement>('[data-slot="header"]')!;
            const row = ui.card.querySelector<HTMLElement>('[data-slot="row"]')!;
            expect(header.style.gridTemplateColumns.split(" ")[0]).toBe("142px");
            expect(row.style.gridTemplateColumns.split(" ")[0]).toBe("142px");
        } finally {
            Element.prototype.getBoundingClientRect = measured;
        }
    });

    test("measured narrower than its least width, the column keeps its 36 px and the gutter its 128 px", () => {
        const ui = mount(sheetJournal(flatSheet()).value);
        expect(ui.card.style.getPropertyValue("--sheet-number")).toBe("36px");
        expect(ui.card.style.getPropertyValue("--sheet-gutter")).toBe("128px");
    });
});
