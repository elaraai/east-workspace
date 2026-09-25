/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan as a drag TARGET.
 *
 * Every other target in the grammar has one kind of cell, so "can you drop
 * here" is a question about the cell's contents. A Plan's rows are nine
 * different things, and the property under test is that the answer is settled
 * STRUCTURALLY first: only the kinds holding discrete scheduled objects
 * register a cell at all. A `chart` / `heat` / `table` row is not "a cell that
 * says no" — it is not a cell, so it cannot light up, cannot be hovered into
 * the invalid stage, and cannot be reached by any predicate. `canDrop` then
 * narrows what remains.
 *
 * That distinction is the one a permissive implementation loses: registering
 * every row and vetoing the wrong ones in `canDrop` would pass a "the drop
 * does nothing" test while washing the whole canvas with candidate outlines
 * during a drag and putting ⊘ on rows that were never destinations.
 *
 * Pointer geometry is stubbed via `document.elementFromPoint` (jsdom has no
 * layout), as in `dnd/drag-layer.dom.test.tsx`.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { parseFor, variant, some, none } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { DragLayerProvider, useDragSourceItem, type DragEventValue } from "../../dnd/drag-layer";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanWireRow } from "./model.js";
import { oneBlock, rowId, rowIdEqual, rowKey, testKeyOf } from "./plan.test-utils.js";

afterEach(cleanup);

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const W27 = new Date("2026-06-29T00:00:00Z");
const W31 = new Date("2026-07-27T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

/** One WIRE row of a given kind — every kind's minimal empty payload (#822). */
function row(key: string, kind: PlanWireRow["kind"]): PlanWireRow {
    return {
        id: rowId(key),
        parent: none,
        gutter: { label: key, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind,
        collapsed: false, pinned: false, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanWireRow;
}

const KINDS = {
    span:    variant("span", { runs: [], decisions: [], ports: [], rollup: none }),
    buckets: variant("buckets", { lanes: [], events: [], markers: [] }),
    cards:   variant("cards", { chips: [] }),
    events:  variant("events", { marks: [] }),
    chart:   variant("chart", {
        layers: [], left: none, right: none,
        height: variant("spark", null), expandedHeight: none, expandable: false,
    }),
    heat:    variant("heat", {
        cells: variant("heat", { cells: [], scale: { min: none, max: none, warnAt: none }, fold: variant("mean", null), format: none }),
        aggregate: none, scale: none,
    }),
    table:   variant("table", {
        series: [], split: variant("horizontal", null),
        aggregate: none, format: none, emphasis: variant("body", null),
    }),
    group:   variant("group", { summary: variant("none", null) }),
} as unknown as Record<string, PlanWireRow["kind"]>;

interface PlanOpts {
    /** The surface's DnD id — `null` for none (#824: an Option, never an empty-string sentinel). */
    id?: string | null;
    sources?: string[];
    onDrag?: (e: DragEventValue) => void;
    canDrop?: (e: DragEventValue) => boolean;
    /** The axis kind (#631) — time by default; number = `[1, 13)` at step 1; ordinal = twelve phases. */
    axis?: "time" | "number" | "ordinal";
}

const PHASES = Array.from({ length: 12 }, (_u, i) => `P${i + 1}`);

function axisOf(kind: PlanOpts["axis"]): unknown {
    switch (kind) {
        case "number":
            return variant("number", { window: some({ min: 1, max: 13 }), step: 1, now: some(5), format: none });
        case "ordinal":
            return variant("ordinal", { values: PHASES, now: some("P5") });
        default:
            return variant("time", {
                window: some({ min: W27, max: W39 }), resolution: variant("week", null),
                resolutions: [], now: some(W31), format: none,
            });
    }
}

function planRoot(rows: PlanWireRow[], opts: PlanOpts = {}): PlanRootValue {
    return {
        rows: variant("inline", oneBlock(rows)),
        links: [],
        axis: axisOf(opts.axis),
        grain: none, popover: none, hover: none,
        expandRender: none, expandGutter: none,
        review: none, pick: none, slice: none, footer: [],
        id: opts.id === null ? none : some(opts.id ?? "ops-plan"),
        sources: opts.sources ?? ["cards"],
        onDrag: opts.onDrag !== undefined ? some(opts.onDrag) : none,
        canDrop: opts.canDrop !== undefined ? some(opts.canDrop) : none,
        onSelect: none, onElementClick: none, onGroupToggle: none, onGrainChange: none,
        ui: none, style: none,
    } as unknown as PlanRootValue;
}

/** A bare Library card — the target only needs a registered source. */
function Card({ itemKey }: { itemKey: string }) {
    const onPointerDown = useDragSourceItem({ library: "cards", key: itemKey, label: itemKey }, <div />);
    return <div data-testid={`card-${itemKey}`} onPointerDown={onPointerDown} />;
}

function pointAt(el: Element | null) {
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => el;
}

function drag(fromEl: Element, overEl: Element | null) {
    fireEvent.pointerDown(fromEl, { clientX: 0, clientY: 0 });
    pointAt(overEl);
    fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 10 });
}

const microtasks = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

function renderPlan(value: PlanRootValue) {
    initializeStore(new UIStore());
    return render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <Card itemKey="job-1" />
                <EastChakraPlan value={value} storageKey="plan-drop" />
            </DragLayerProvider>
        </ChakraProvider>,
    );
}

/** The registered drop cells, named by the row each one belongs to. */
function dropRows(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll<HTMLElement>("[data-drag-cell]"))
        .map((el) => {
            const row = el.closest("[data-plan-row]")?.getAttribute("data-plan-row");
            return row !== null && row !== undefined ? testKeyOf(row) : "?";
        });
}

const ALL_KINDS = [
    row("a-span", KINDS["span"]!),
    row("b-chart", KINDS["chart"]!),
    row("c-buckets", KINDS["buckets"]!),
    row("d-heat", KINDS["heat"]!),
    row("e-cards", KINDS["cards"]!),
    row("f-table", KINDS["table"]!),
    row("g-events", KINDS["events"]!),
    row("h-group", KINDS["group"]!),
];

describe("Plan drop target", () => {
    test("only the kinds holding discrete objects register a cell", () => {
        const { container } = renderPlan(planRoot(ALL_KINDS, { onDrag: () => {} }));
        // Span, buckets, cards and events receive. Chart / heat / table render
        // DERIVED values and the group strip is wayfinding — they register
        // nothing, so they are inert before any predicate runs.
        expect(dropRows(container).sort()).toEqual(["a-span", "c-buckets", "e-cards", "g-events"]);
    });

    test("the landing band exists on exactly the rows that can receive", () => {
        // Geometry cannot be asserted here — jsdom reports a zero-width rect, so
        // the band has no position to check (the real placement is covered by a
        // Playwright pass against a live browser). What IS checkable, and what
        // matters structurally, is that a row which registers no drop cell also
        // renders no landing band: an inert row must have nothing that could
        // ever light up.
        const { container } = renderPlan(planRoot(ALL_KINDS, { onDrag: () => {} }));
        const bands = container.querySelectorAll("[data-plan-drop-preview]");
        expect(bands).toHaveLength(dropRows(container).length);
        expect(bands).toHaveLength(4);
    });

    test("no target ⇒ no landing band anywhere", () => {
        const { container } = renderPlan(planRoot(ALL_KINDS));
        expect(container.querySelectorAll("[data-plan-drop-preview]")).toHaveLength(0);
    });

    test("a drop reports `add` with the row's id as its canonical text, and the bucket instant", async () => {
        const events: DragEventValue[] = [];
        const { container, getByTestId } = renderPlan(
            planRoot(ALL_KINDS, { onDrag: (e) => { events.push(e); } }));

        const spanCell = container.querySelectorAll<HTMLElement>("[data-drag-cell]")[0]!;
        drag(getByTestId("card-job-1"), spanCell);
        await microtasks();

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe("add");
        if (events[0]!.type === "add") {
            const add = events[0]!.value;
            expect(add.from.library).toBe("cards");
            expect(add.from.key).toBe("job-1");
            expect(add.into.surface).toBe("ops-plan");
            // The row is its id's canonical text (#822) — the shared drag
            // grammar stays string-based, and the host parses it straight back
            // to the typed id (`row.parse(Plan.Types.RowId)`), no lookup table.
            expect(add.into.row).toBe(rowKey("a-span"));
            const parsed = parseFor(Plan.Types.RowId)(add.into.row);
            if (!parsed.success) throw new Error(`the drop's row is no id: ${parsed.error}`);
            expect(rowIdEqual(parsed.value, rowId("a-span"))).toBe(true);
            // The slot is the bucket the pointer was over, named by its START
            // instant. jsdom reports a zero-width rect, so the pointer resolves
            // into the FIRST bucket — deterministic here, and the encoding is
            // what matters: Z-less ISO, so it parses as an East DateTime.
            expect(add.into.slot).toBe("2026-06-29T00:00:00.000");
            expect(new Date(`${add.into.slot}Z`).getTime()).toBe(W27.getTime());
        }
    });

    test("the slot speaks the axis's arm (#631): a number axis reports the bucket start as a decimal, an ordinal one the value", async () => {
        for (const [axis, expected] of [["number", "1"], ["ordinal", "P1"]] as const) {
            cleanup();
            const events: DragEventValue[] = [];
            const { container, getByTestId } = renderPlan(
                planRoot(ALL_KINDS, { onDrag: (e) => { events.push(e); }, axis }));
            const spanCell = container.querySelectorAll<HTMLElement>("[data-drag-cell]")[0]!;
            drag(getByTestId("card-job-1"), spanCell);
            await microtasks();
            expect(events).toHaveLength(1);
            expect(events[0]!.type).toBe("add");
            if (events[0]!.type === "add") {
                // jsdom's zero-width rect resolves the pointer into the FIRST
                // bucket: `1` on the number axis (parses with `parse(FloatType)`),
                // the first declared value on the ordinal one.
                expect(events[0]!.value.into.slot).toBe(expected);
            }
        }
    });

    test("canDrop vetoes a candidate — ⊘ on hover, and the drop is a no-op", async () => {
        const events: DragEventValue[] = [];
        const { container, getByTestId } = renderPlan(planRoot(ALL_KINDS, {
            onDrag: (e) => { events.push(e); },
            // This canvas takes the card on `events` rows only.
            canDrop: (e) => e.type === "add" && e.value.into.row === rowKey("g-events"),
        }));
        const cells = container.querySelectorAll<HTMLElement>("[data-drag-cell]");
        const spanCell = cells[0]!;
        const eventsCell = cells[3]!;

        fireEvent.pointerDown(getByTestId("card-job-1"), { clientX: 0, clientY: 0 });
        // The drag-start sweep consults `canDrop` for the ROW — which is known
        // without a pointer — so a row that will always refuse never lights up
        // as a candidate. Promising a drop and taking it back on hover is the
        // thing this asserts against.
        expect(spanCell.hasAttribute("data-drop-valid")).toBe(false);
        expect(eventsCell.hasAttribute("data-drop-valid")).toBe(true);
        pointAt(spanCell);
        fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
        expect(spanCell.hasAttribute("data-drop-invalid")).toBe(true);
        // Not a candidate AND refused: this row was never marked, so the two
        // frames cannot layer here.
        //
        // The attributes are NOT mutually exclusive in general — `data-drop-valid`
        // is the drag layer's own record of structural validity (`onMove` reads it
        // back to pick its branch), so a cell whose predicate depends on the SLOT
        // can be valid and hovered-invalid at once. That case is handled where it
        // shows: `global-css.ts` guards the candidate frame with
        // `:not([data-drop-invalid])`, so exactly one stage ever paints.
        expect(spanCell.hasAttribute("data-drop-valid")).toBe(false);
        fireEvent.pointerUp(document, { clientX: 10, clientY: 10 });
        await microtasks();
        expect(events).toHaveLength(0);

        // The admitted row still accepts.
        drag(getByTestId("card-job-1"), eventsCell);
        await microtasks();
        expect(events).toHaveLength(1);
    });

    test("no `onDrag` registers no target — nothing on the canvas is a destination", () => {
        // A drop with nowhere to report is a gesture that silently loses work,
        // so the surface does not offer one.
        const { container } = renderPlan(planRoot(ALL_KINDS));
        expect(dropRows(container)).toEqual([]);
    });

    test("no `id` registers no target — an unnamed surface cannot be addressed", () => {
        // Cells are addressed `surface × row × slot`; without a surface name
        // the delivered ref would name nothing the host could act on.
        const { container } = renderPlan(planRoot(ALL_KINDS, { id: null, onDrag: () => {} }));
        expect(dropRows(container)).toEqual([]);
    });

    test("a library the canvas does not declare is not a source for it", () => {
        const { container, getByTestId } = renderPlan(
            planRoot(ALL_KINDS, { sources: ["some-other-palette"], onDrag: () => {} }));
        const spanCell = container.querySelectorAll<HTMLElement>("[data-drag-cell]")[0]!;
        // The cell exists (the KIND accepts drops) but this payload does not
        // connect to it, so it is never marked a candidate.
        fireEvent.pointerDown(getByTestId("card-job-1"), { clientX: 0, clientY: 0 });
        expect(spanCell.hasAttribute("data-drop-valid")).toBe(false);
        fireEvent.pointerUp(document, { clientX: 0, clientY: 0 });
    });
});
