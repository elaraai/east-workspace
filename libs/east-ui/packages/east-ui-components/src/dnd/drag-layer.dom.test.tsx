/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * DragLayerProvider state machine — registration, validity matching, event
 * synthesis. Pointer geometry is faked by stubbing `document.elementFromPoint`
 * (jsdom has no layout), which is exactly the seam the provider hit-tests
 * through.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useEffect } from "react";
import {
    DragLayerProvider,
    useDragTarget,
    useDropCell,
    useDropSink,
    useDragSourceItem,
    useDragEventChip,
    useDragEventEdge,
    type DragEventValue,
    type DragTargetConfig,
} from "./drag-layer.js";

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function Target({ config }: { config: DragTargetConfig }) {
    useDragTarget(config);
    return null;
}

function Cell({ surface, row, slot, disabled }: { surface: string; row: string; slot: string; disabled?: boolean }) {
    const ref = useDropCell({ surface, row, slot }, disabled ?? false);
    return <div ref={ref} data-testid={`cell-${row}-${slot}`} />;
}

function Card({ library, itemKey, disabled }: { library: string; itemKey: string; disabled?: boolean }) {
    const onPointerDown = useDragSourceItem({ library, key: itemKey }, <span>{itemKey}</span>, disabled ?? false);
    return <div data-testid={`card-${itemKey}`} onPointerDown={onPointerDown} />;
}

function Chip({ surface, row, slot, event, disabled }: { surface: string; row: string; slot: string; event: string; disabled?: boolean }) {
    const onPointerDown = useDragEventChip({ surface, row, slot, event }, <span>{event}</span>, disabled ?? false);
    return <div data-testid={`chip-${event}`} onPointerDown={onPointerDown} />;
}

function EdgeHandle({ surface, row, slot, event, edge }: { surface: string; row: string; slot: string; event: string; edge: "start" | "end" }) {
    const onPointerDown = useDragEventEdge({ surface, row, slot, event }, edge, <span>{event}</span>, false);
    return <div data-testid={`edge-${event}-${edge}`} onPointerDown={onPointerDown} />;
}

function Trash() {
    const ref = useDropSink("trash");
    return <div ref={ref} data-testid="trash" />;
}

function LibraryFrame({ id, children }: { id: string; children?: React.ReactNode }) {
    const ref = useDropSink("library", id);
    return <div ref={ref} data-testid={`library-${id}`}>{children}</div>;
}

/** Point `document.elementFromPoint` at the element until restored. */
function pointAt(el: Element | null) {
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => el;
}

function drag(fromEl: Element, overEl: Element | null, opts?: { altKey?: boolean; cancel?: boolean }) {
    fireEvent.pointerDown(fromEl, { clientX: 0, clientY: 0, altKey: opts?.altKey ?? false });
    pointAt(overEl);
    fireEvent.pointerMove(document, { clientX: 10, clientY: 10, altKey: opts?.altKey ?? false });
    if (opts?.cancel) {
        fireEvent.keyDown(document, { key: "Escape" });
    } else {
        fireEvent.pointerUp(document, { clientX: 10, clientY: 10 });
    }
}

const KINDS_ALL = { add: true, move: true, remove: true };

describe("DragLayerProvider", () => {
    test("add: library card dropped on a connected cell synthesizes an add event", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
            </DragLayerProvider>,
        );
        const cell = getByTestId("cell-patel-thu");
        drag(getByTestId("card-patel"), cell);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("add");
        if (events[0].type === "add") {
            expect(events[0].value.from).toEqual({ library: "people", key: "patel" });
            expect(events[0].value.into.surface).toBe("roster");
            expect(events[0].value.into.slot).toBe("thu");
            expect(events[0].value.duplicate).toBe(false);
        }
    });

    test("add: alt-drag sets the duplicate flag", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="cho" />
                <Cell surface="roster" row="cho" slot="fri" />
            </DragLayerProvider>,
        );
        drag(getByTestId("card-cho"), getByTestId("cell-cho-fri"), { altKey: true });

        expect(events).toHaveLength(1);
        if (events[0].type === "add") expect(events[0].value.duplicate).toBe(true);
    });

    test("add: an undeclared library does not connect (no event, no valid marker)", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="vehicles" itemKey="bt-014" />
                <Cell surface="roster" row="patel" slot="thu" />
            </DragLayerProvider>,
        );
        const cell = getByTestId("cell-patel-thu");
        fireEvent.pointerDown(getByTestId("card-bt-014"), { clientX: 0, clientY: 0 });
        expect(cell.hasAttribute("data-drop-valid")).toBe(false);
        pointAt(cell);
        fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
        fireEvent.pointerUp(document);

        expect(events).toHaveLength(0);
    });

    test("move: chip dropped on a same-surface cell synthesizes a move", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: [], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Chip surface="roster" row="patel" slot="mon" event="shift-1" />
                <Cell surface="roster" row="cho" slot="mon" />
            </DragLayerProvider>,
        );
        drag(getByTestId("chip-shift-1"), getByTestId("cell-cho-mon"));

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("move");
        if (events[0].type === "move") {
            expect(events[0].value.from.event.type).toBe("some");
            expect(events[0].value.from.event.value).toBe("shift-1");
            expect(events[0].value.to.row).toBe("cho");
        }
    });

    test("move: cross-surface cells never connect", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster-a", sources: [], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Target config={{ id: "roster-b", sources: [], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Chip surface="roster-a" row="patel" slot="mon" event="shift-1" />
                <Cell surface="roster-b" row="kim" slot="mon" />
            </DragLayerProvider>,
        );
        drag(getByTestId("chip-shift-1"), getByTestId("cell-kim-mon"));

        expect(events).toHaveLength(0);
    });

    test("remove: chip dropped on the trash sink", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "bench", sources: ["materials"], kinds: { add: true, remove: true }, onDrag: e => events.push(e) }} />
                <Chip surface="bench" row="BLEND-318" slot="alloc" event="SRC-204" />
                <Trash />
            </DragLayerProvider>,
        );
        drag(getByTestId("chip-SRC-204"), getByTestId("trash"));

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("remove");
        if (events[0].type === "remove") expect(events[0].value.to.type).toBe("trash");
    });

    test("remove: chip returned to a declared library is a source-sink remove", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "bench", sources: ["materials"], kinds: { add: true, remove: true }, onDrag: e => events.push(e) }} />
                <Chip surface="bench" row="BLEND-318" slot="alloc" event="SRC-204" />
                <LibraryFrame id="materials" />
            </DragLayerProvider>,
        );
        drag(getByTestId("chip-SRC-204"), getByTestId("library-materials"));

        expect(events).toHaveLength(1);
        if (events[0].type === "remove") expect(events[0].value.to.type).toBe("source");
    });

    test("shared trash zone (#267): appears during a remove-capable event drag, delivers remove/trash, and unmounts", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Chip surface="roster" row="patel" slot="mon" event="p1" />
            </DragLayerProvider>,
        );

        // No zone at rest.
        expect(document.querySelector("[data-drag-trash]")).toBeNull();

        // Begin the drag — the provider portals the zone in, already marked a
        // valid destination (never invalid: structurally valid for removables).
        fireEvent.pointerDown(getByTestId("chip-p1"), { clientX: 0, clientY: 0 });
        const zone = document.querySelector<HTMLElement>("[data-drag-trash]");
        expect(zone).not.toBeNull();
        expect(zone!.hasAttribute("data-drop-valid")).toBe(true);
        expect(zone!.hasAttribute("data-drop-invalid")).toBe(false);

        // Drop on it — the ordinary trash sink path delivers remove/trash.
        pointAt(zone);
        fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
        expect(zone!.hasAttribute("data-drop-active")).toBe(true);
        fireEvent.pointerUp(document, { clientX: 10, clientY: 10 });

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("remove");
        if (events[0].type === "remove") expect(events[0].value.to.type).toBe("trash");
        expect(document.querySelector("[data-drag-trash]")).toBeNull();
    });

    test("shared trash zone (#267): absent for item drags and for targets without kinds.remove", () => {
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: { add: true, move: true } }} />
                <Card library="people" itemKey="patel" />
                <Chip surface="roster" row="patel" slot="mon" event="p1" />
            </DragLayerProvider>,
        );

        // An item (Library card) drag never shows the zone — items return to
        // the palette, they are not removable events.
        fireEvent.pointerDown(getByTestId("card-patel"), { clientX: 0, clientY: 0 });
        expect(document.querySelector("[data-drag-trash]")).toBeNull();
        fireEvent.pointerUp(document, { clientX: 5, clientY: 5 });

        // An event drag on a target that does NOT declare kinds.remove.
        fireEvent.pointerDown(getByTestId("chip-p1"), { clientX: 0, clientY: 0 });
        expect(document.querySelector("[data-drag-trash]")).toBeNull();
        fireEvent.pointerUp(document, { clientX: 5, clientY: 5 });
    });

    test("resize (#268): an edge drag over a same-row slot reduces to resize with the destination slot", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "gantt", sources: [], kinds: { resize: true }, onDrag: e => events.push(e) }} />
                <EdgeHandle surface="gantt" row="2" slot="2024-01-10T00:00:00.000Z" event="t0" edge="end" />
                <Cell surface="gantt" row="2" slot="2024-01-14T00:00:00.000Z" />
            </DragLayerProvider>,
        );
        drag(getByTestId("edge-t0-end"), getByTestId("cell-2-2024-01-14T00:00:00.000Z"));

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("resize");
        if (events[0].type === "resize") {
            expect(events[0].value.edge.type).toBe("end");
            expect(events[0].value.event.slot).toBe("2024-01-14T00:00:00.000Z");
            expect(events[0].value.event.row).toBe("2");
            expect(events[0].value.event.event.type).toBe("some");
            expect(events[0].value.event.event.value).toBe("t0");
        }
    });

    test("resize (#268): edges never connect across rows or without kinds.resize", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "gantt", sources: [], kinds: { resize: true }, onDrag: e => events.push(e) }} />
                <Target config={{ id: "flat", sources: [], kinds: { move: true }, onDrag: e => events.push(e) }} />
                <EdgeHandle surface="gantt" row="2" slot="s0" event="t0" edge="start" />
                <EdgeHandle surface="flat" row="1" slot="s0" event="t9" edge="start" />
                <Cell surface="gantt" row="3" slot="s1" />
                <Cell surface="flat" row="1" slot="s1" />
            </DragLayerProvider>,
        );
        // Cross-row edge drag: no valid destination, drop is a no-op.
        drag(getByTestId("edge-t0-start"), getByTestId("cell-3-s1"));
        // Same row but the target lacks kinds.resize: also a no-op.
        drag(getByTestId("edge-t9-start"), getByTestId("cell-1-s1"));

        expect(events).toHaveLength(0);
    });

    test("escape cancels: no event fires, indicators clear", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
            </DragLayerProvider>,
        );
        const cell = getByTestId("cell-patel-thu");
        drag(getByTestId("card-patel"), cell, { cancel: true });

        expect(events).toHaveLength(0);
        expect(cell.hasAttribute("data-drop-valid")).toBe(false);
        expect(cell.hasAttribute("data-drop-active")).toBe(false);
    });

    test("indicators precede the drop: valid cells marked at drag start, hover marks active", () => {
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
                <Cell surface="roster" row="cho" slot="fri" disabled />
            </DragLayerProvider>,
        );
        const valid = getByTestId("cell-patel-thu");
        const disabled = getByTestId("cell-cho-fri");
        fireEvent.pointerDown(getByTestId("card-patel"), { clientX: 0, clientY: 0 });

        expect(valid.hasAttribute("data-drop-valid")).toBe(true);
        expect(disabled.hasAttribute("data-drop-valid")).toBe(false);

        pointAt(valid);
        fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
        expect(valid.hasAttribute("data-drop-active")).toBe(true);

        fireEvent.pointerUp(document);
        expect(valid.hasAttribute("data-drop-valid")).toBe(false);
        expect(valid.hasAttribute("data-drop-active")).toBe(false);
    });

    test("disabled source cards produce no drag handler", () => {
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL }} />
                <Card library="people" itemKey="okafor" disabled />
                <Cell surface="roster" row="okafor" slot="thu" />
            </DragLayerProvider>,
        );
        fireEvent.pointerDown(getByTestId("card-okafor"), { clientX: 0, clientY: 0 });
        expect(getByTestId("cell-okafor-thu").hasAttribute("data-drop-valid")).toBe(false);
    });
});
