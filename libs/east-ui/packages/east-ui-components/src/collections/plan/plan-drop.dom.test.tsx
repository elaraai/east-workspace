/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan as a drag TARGET (#880) — a job card dropped on a row is a draft
 * of the entry the row came from.
 *
 * Every other target in the grammar has one kind of cell, so "can you drop
 * here" is a question about the cell's contents. A Plan's rows are eight
 * different things, and the property under test is that the answer is settled
 * STRUCTURALLY first: only the kinds holding discrete scheduled objects — and
 * of those, only a series that says where a card lands (`edit`) — register a
 * cell at all. A `chart` / `heat` / `table` row is not "a cell that says no" —
 * it is not a cell, so it cannot light up, cannot be hovered into the invalid
 * stage, and cannot be reached by any predicate. `canDrop` then narrows what
 * remains, before anything is drafted.
 *
 * Pointer geometry is stubbed via `document.elementFromPoint` (jsdom has no
 * layout), as in `dnd/drag-layer.dom.test.tsx`.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { DictType, East, StringType, equalFor, variant, type ExprType } from "@elaraai/east";
import { Plan, State, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { DragLayerProvider, useDragSourceItem } from "../../dnd/drag-layer";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import { testKeyOf } from "./plan.test-utils.js";
import {
    JOBS, PHASES, Press, SEED, SURFACE,
    dropCellOf, dropJob, history, marks, mountCanvas, releaseCanvases,
} from "./plan-editing.test-utils.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    releaseCanvases();
    localStorage.clear();
});

// ── One press drawn as every kind of row ─────────────────────────────────────

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
/** Where a job card lands on a kind that takes one — a job of the press, at the bucket it was dropped in. */
const LANDS = { items: "jobs", create: (drop: ExprType<typeof Plan.Types.Drop>) => ({ key: drop.from.key, at: drop.at }) } as const;
/** Press 1 alone. */
const ONE_PRESS = new Map([["p1", SEED.get("p1")!]]);

/** Press 1 as a row of every kind — the kinds holding discrete objects take a job (`edit`), the rest cannot. */
const EVERY_KIND = East.function([], UIComponentType, ($) => {
    const presses = $.const(State.bind([DictType(StringType, Press)], "plan-880.every-kind", ONE_PRESS));
    return Plan.Root({
        axis: Plan.axis({ window: { min: W27, max: W39 }, resolution: "week" }),
        data: presses,
        series: [
            Plan.series.span(Press, { key: "span", title: "Span", label: (p) => p.label, runs: () => [],
                decisions: (p) => p.jobs.map((_$, j) => Plan.decision({ key: j.key, at: j.at, applied: false })), edit: LANDS }),
            Plan.series.chart(Press, { key: "chart", title: "Chart", label: (p) => p.label, layers: () => [] }),
            Plan.series.buckets(Press, { key: "buckets", title: "Buckets", label: (p) => p.label,
                events: (p) => p.jobs.map((_$, j) => Plan.event({ key: j.key, at: j.at, state: "confirmed" })), edit: LANDS }),
            Plan.series.heat(Press, { key: "heat", title: "Heat", label: (p) => p.label, cells: () => Plan.heatCells([]) }),
            Plan.series.cards(Press, { key: "cards", title: "Cards", label: (p) => p.label,
                chips: (p) => p.jobs.map((_$, j) => Plan.chip({ key: j.key, from: j.at, to: j.at, label: j.key, state: "confirmed" })), edit: LANDS }),
            Plan.series.table(Press, { key: "table", title: "Table", label: (p) => p.label, cells: () => Plan.tableCells([]) }),
            Plan.series.events(Press, { key: "events", title: "Events", label: (p) => p.label,
                marks: (p) => p.jobs.map((_$, j) => Plan.mark({ key: j.key, at: j.at, kind: "milestone" })), edit: LANDS }),
        ],
        editing: { onUpdate: presses.write },
        id: SURFACE,
        sources: [JOBS],
    });
});

/** The every-kind canvas, compiled — `everyRowDroppable` flags every row as taking a drop, as no series could. */
function everyKind(everyRowDroppable = false): PlanRootValue {
    const ui = East.compile(EVERY_KIND, getRegisteredPlatformImplementations())();
    if (ui.type !== "Plan") throw new Error(`Expected a Plan, got ${ui.type}`);
    const root = ui.value as PlanRootValue;
    if (!everyRowDroppable || root.rows.type !== "inline") return root;
    const blocks = root.rows.value.map((b) => ({ ...b, rows: b.rows.map((r) => ({ ...r, edits: { ...r.edits, drop: true } })) }));
    return { ...root, rows: variant("inline", blocks) as PlanRootValue["rows"] };
}

function JobCard() {
    const onPointerDown = useDragSourceItem({ library: JOBS, key: "job-1", label: "job-1" }, <div />);
    return <div data-testid="job-job-1" onPointerDown={onPointerDown} />;
}

function renderEveryKind(root: PlanRootValue) {
    return render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <JobCard />
                <EastChakraPlan value={root} storageKey="plan-880-every-kind" />
            </DragLayerProvider>
        </ChakraProvider>,
    );
}

/** The series of every row that registered a drop cell. */
function dropRows(container: HTMLElement): string[] {
    return [...container.querySelectorAll<HTMLElement>("[data-drag-cell]")].map((el) => {
        const key = el.closest("[data-plan-row]")?.getAttribute("data-plan-row") ?? "";
        return /series="([^"]*)"/.exec(key)?.[1] ?? `? ${testKeyOf(key)}`;
    });
}

describe("Plan drop target (#880)", () => {
    test("only the kinds holding discrete objects take a job — span, buckets, cards and events, where a series says where it lands", () => {
        const { container } = renderEveryKind(everyKind());
        expect(dropRows(container).sort()).toEqual(["buckets", "cards", "events", "span"]);
        // A row that cannot take a job has nothing that could ever light up.
        expect(container.querySelectorAll("[data-plan-drop-preview]")).toHaveLength(4);
    }, 30_000);

    test("a chart, heat or table row flagged as taking a drop still registers nothing — the kind decides first", () => {
        const { container } = renderEveryKind(everyKind(true));
        expect(dropRows(container).sort()).toEqual(["buckets", "cards", "events", "span"]);
    }, 30_000);

    test("without an editing session no row is a destination — a drop with nowhere to go would lose work", async () => {
        const { container } = await mountCanvas({ arm: "inline", editing: false });
        expect(container.querySelectorAll("[data-drag-cell]")).toHaveLength(0);
    }, 30_000);

    test("without an `id` no row is a destination — an unnamed surface cannot be addressed", async () => {
        const { container } = await mountCanvas({ arm: "inline", target: false });
        expect(container.querySelectorAll("[data-drag-cell]")).toHaveLength(0);
    }, 30_000);

    test("a library the canvas does not declare is not a source for it — its card never lights a row, and drafts nothing", async () => {
        const canvas = await mountCanvas({ arm: "inline", sources: ["other-library"] });
        const cell = dropCellOf(canvas.container, "p1")!;
        // The cell exists — the KIND takes a card — but this payload does not connect to it.
        fireEvent.pointerDown(canvas.getByTestId("job-job-1"), { clientX: 0, clientY: 0 });
        expect(cell.hasAttribute("data-drop-valid")).toBe(false);
        fireEvent.pointerUp(document, { clientX: 0, clientY: 0 });
        await dropJob(canvas, "job-1", "p1");
        expect(canvas.patches).toEqual([]);
        expect(marks(canvas.container)).toEqual({});
    }, 30_000);

    const sameInstant = equalFor(Plan.Types.Instant);
    for (const [axis, at] of [
        ["time", variant("time", W27)],
        ["number", variant("number", 1)],
        ["ordinal", variant("ordinal", PHASES[0]!)],
    ] as const) {
        test(`a ${axis} axis: the job lands at the start of the bucket it was dropped in, on the axis's arm`, async () => {
            const canvas = await mountCanvas({ arm: "inline", axis });
            await dropJob(canvas, "job-1", "p1");
            await history(canvas, "Apply changes");
            const jobs = canvas.stored().get("p1")!.jobs;
            expect(jobs.map((j) => j.key)).toEqual(["job-1"]);
            // jsdom's zero-width rect puts the pointer in the FIRST bucket.
            expect(sameInstant(jobs[0]!.at, at)).toBe(true);
        }, 30_000);
    }
});
