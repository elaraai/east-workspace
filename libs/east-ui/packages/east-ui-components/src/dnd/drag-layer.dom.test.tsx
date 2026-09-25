/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * The drag layer on dnd-kit (#608) — registration, validity matching, event
 * synthesis, the pointer / touch / keyboard sensors, the three defects the
 * rebuild closes, and what it announces. Pointer geometry is faked by stubbing
 * `document.elementFromPoint` (jsdom has no layout), which is exactly the seam
 * the layer hit-tests through; keyboard drags stub the rects they measure.
 *
 * A mouse drag engages once the press has travelled 4px, so every drag here
 * moves before it asserts what a drag in flight shows.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
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
    type DropVeto,
} from "./drag-layer.js";
import { announced, layOut, pointAt, press, stubScrollIntoView, tick } from "./dnd.test-utils.js";

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function Target({ config }: { config: DragTargetConfig }) {
    useDragTarget(config);
    return null;
}

function Cell({ surface, row, slot, disabled, canDrop }: { surface: string; row: string; slot: string; disabled?: boolean; canDrop?: DropVeto }) {
    const ref = useDropCell({ surface, row, slot }, disabled ?? false, canDrop);
    return <div ref={ref} data-testid={`cell-${row}-${slot}`} />;
}

function Card({ library, itemKey, disabled }: { library: string; itemKey: string; disabled?: boolean }) {
    const drag = useDragSourceItem({ library, key: itemKey }, <span>{itemKey}</span>, disabled ?? false);
    return <div data-testid={`card-${itemKey}`} {...drag} />;
}

function Chip({ surface, row, slot, event, disabled }: { surface: string; row: string; slot: string; event: string; disabled?: boolean }) {
    const drag = useDragEventChip({ surface, row, slot, event }, <span>{event}</span>, disabled ?? false);
    return <div data-testid={`chip-${event}`} {...drag} />;
}

function EdgeHandle({ surface, row, slot, event, edge }: { surface: string; row: string; slot: string; event: string; edge: "start" | "end" }) {
    const drag = useDragEventEdge({ surface, row, slot, event }, edge, <span>{event}</span>, false);
    return <div data-testid={`edge-${event}-${edge}`} {...drag} />;
}

function Trash() {
    const ref = useDropSink("trash");
    return <div ref={ref} data-testid="trash" />;
}

function LibraryFrame({ id, children }: { id: string; children?: React.ReactNode }) {
    const ref = useDropSink("library", id);
    return <div ref={ref} data-testid={`library-${id}`}>{children}</div>;
}

interface DragOptions {
    /** Alt held while the drag moves. */
    altKey?: boolean;
    /** Alt held at the release (default: as while moving). */
    releaseAlt?: boolean;
    cancel?: boolean;
    pointerId?: number;
    pointerType?: string;
}

/** Press on `fromEl` and travel past the 4px threshold over `overEl` — the drag is in flight. */
function engage(fromEl: Element, overEl: Element | null, opts?: DragOptions) {
    const pointer = { pointerId: opts?.pointerId ?? 1, pointerType: opts?.pointerType ?? "mouse" };
    fireEvent.pointerDown(fromEl, { ...pointer, clientX: 0, clientY: 0, altKey: opts?.altKey ?? false });
    pointAt(overEl);
    fireEvent.pointerMove(document, { ...pointer, clientX: 10, clientY: 10, altKey: opts?.altKey ?? false });
}

function drag(fromEl: Element, overEl: Element | null, opts?: DragOptions) {
    engage(fromEl, overEl, opts);
    if (opts?.cancel) {
        fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    } else {
        fireEvent.pointerUp(document, {
            pointerId: opts?.pointerId ?? 1, pointerType: opts?.pointerType ?? "mouse",
            clientX: 10, clientY: 10, altKey: opts?.releaseAlt ?? opts?.altKey ?? false,
        });
    }
}

/** The one event a drag delivered — asserts there was exactly one. */
function sole(events: DragEventValue[]): DragEventValue {
    expect(events).toHaveLength(1);
    return events[0]!;
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
        drag(getByTestId("card-patel"), getByTestId("cell-patel-thu"));

        const e = sole(events);
        expect(e.type).toBe("add");
        if (e.type === "add") {
            expect(e.value.from).toEqual({ library: "people", key: "patel" });
            expect(e.value.into.surface).toBe("roster");
            expect(e.value.into.slot).toBe("thu");
            expect(e.value.duplicate).toBe(false);
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

        const e = sole(events);
        expect(e.type).toBe("add");
        if (e.type === "add") expect(e.value.duplicate).toBe(true);
    });

    test("a press that travels under 4px is a click, not a drag", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
            </DragLayerProvider>,
        );
        const card = getByTestId("card-patel");
        const cell = getByTestId("cell-patel-thu");
        fireEvent.pointerDown(card, { pointerId: 1, clientX: 0, clientY: 0 });
        pointAt(cell);
        fireEvent.pointerMove(document, { pointerId: 1, clientX: 2, clientY: 2 });
        expect(card.hasAttribute("data-dragging")).toBe(false);
        expect(cell.hasAttribute("data-drop-valid")).toBe(false);
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 2, clientY: 2 });
        expect(events).toHaveLength(0);
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
        engage(getByTestId("card-bt-014"), cell);
        expect(getByTestId("card-bt-014").hasAttribute("data-dragging")).toBe(true);
        expect(cell.hasAttribute("data-drop-valid")).toBe(false);
        expect(cell.hasAttribute("data-drop-active")).toBe(false);
        fireEvent.pointerUp(document, { pointerId: 1 });

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

        const e = sole(events);
        expect(e.type).toBe("move");
        if (e.type === "move") {
            expect(e.value.from.event.type).toBe("some");
            expect(e.value.from.event.value).toBe("shift-1");
            expect(e.value.to.row).toBe("cho");
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

        const e = sole(events);
        expect(e.type).toBe("remove");
        if (e.type === "remove") expect(e.value.to.type).toBe("trash");
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

        const e = sole(events);
        expect(e.type).toBe("remove");
        if (e.type === "remove") expect(e.value.to.type).toBe("source");
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

        // Engage the drag — the provider portals the zone in, already marked a
        // valid destination (never invalid: structurally valid for removables).
        engage(getByTestId("chip-p1"), null);
        const zone = document.querySelector<HTMLElement>("[data-drag-trash]");
        expect(zone).not.toBeNull();
        expect(zone!.hasAttribute("data-drop-valid")).toBe(true);
        expect(zone!.hasAttribute("data-drop-invalid")).toBe(false);
        expect(zone!.getAttribute("aria-label")).toBe("Remove");

        // Drop on it — the ordinary trash sink path delivers remove/trash.
        pointAt(zone);
        fireEvent.pointerMove(document, { pointerId: 1, clientX: 12, clientY: 12 });
        expect(zone!.hasAttribute("data-drop-active")).toBe(true);
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 12, clientY: 12 });

        const e = sole(events);
        expect(e.type).toBe("remove");
        if (e.type === "remove") expect(e.value.to.type).toBe("trash");
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
        engage(getByTestId("card-patel"), null);
        expect(getByTestId("card-patel").hasAttribute("data-dragging")).toBe(true);
        expect(document.querySelector("[data-drag-trash]")).toBeNull();
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10 });

        // An event drag on a target that does NOT declare kinds.remove.
        engage(getByTestId("chip-p1"), null);
        expect(getByTestId("chip-p1").hasAttribute("data-dragging")).toBe(true);
        expect(document.querySelector("[data-drag-trash]")).toBeNull();
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10 });
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

        const e = sole(events);
        expect(e.type).toBe("resize");
        if (e.type === "resize") {
            expect(e.value.edge.type).toBe("end");
            expect(e.value.event.slot).toBe("2024-01-14T00:00:00.000Z");
            expect(e.value.event.row).toBe("2");
            expect(e.value.event.event.type).toBe("some");
            expect(e.value.event.event.value).toBe("t0");
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
        expect(getByTestId("card-patel").hasAttribute("data-dragging")).toBe(false);
    });

    test("indicators precede the drop: valid cells marked once the drag engages, hover marks active", () => {
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
                <Cell surface="roster" row="cho" slot="fri" disabled />
                <Cell surface="roster" row="kim" slot="sat" />
            </DragLayerProvider>,
        );
        const valid = getByTestId("cell-patel-thu");
        const disabled = getByTestId("cell-cho-fri");
        const other = getByTestId("cell-kim-sat");
        engage(getByTestId("card-patel"), valid);

        expect(valid.hasAttribute("data-drop-valid")).toBe(true);
        expect(valid.hasAttribute("data-drop-active")).toBe(true);
        expect(other.hasAttribute("data-drop-valid")).toBe(true);
        expect(other.hasAttribute("data-drop-active")).toBe(false);
        expect(disabled.hasAttribute("data-drop-valid")).toBe(false);

        fireEvent.pointerUp(document, { pointerId: 1 });
        expect(valid.hasAttribute("data-drop-valid")).toBe(false);
        expect(valid.hasAttribute("data-drop-active")).toBe(false);
    });

    test("disabled source cards produce no drag handle", () => {
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL }} />
                <Card library="people" itemKey="okafor" disabled />
                <Cell surface="roster" row="okafor" slot="thu" />
            </DragLayerProvider>,
        );
        const card = getByTestId("card-okafor");
        expect(card.getAttribute("tabindex")).toBeNull();
        engage(card, getByTestId("cell-okafor-thu"));
        expect(card.hasAttribute("data-dragging")).toBe(false);
        expect(getByTestId("cell-okafor-thu").hasAttribute("data-drop-valid")).toBe(false);
    });
});

describe("the three defects the rebuild closes (#608)", () => {
    test("1 — the delivered add is asked again with its REAL duplicate flag: Alt pressed only at the release is refused by a host that refuses copies", () => {
        const events: DragEventValue[] = [];
        // A host that lets a person move here but never be copied.
        const noCopies: DropVeto = (e) => !(e.type === "add" && e.value.duplicate);
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" canDrop={noCopies} />
            </DragLayerProvider>,
        );
        const cell = getByTestId("cell-patel-thu");

        // Moving without Alt: the candidate is a plain add, so the cell takes it…
        engage(getByTestId("card-patel"), cell);
        expect(cell.hasAttribute("data-drop-active")).toBe(true);
        // …and Alt pressed at the release makes the drop a copy, which the cell refuses.
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10, altKey: true });
        expect(events).toHaveLength(0);

        // Alt held while moving: the ⊘ stage shows before the drop.
        engage(getByTestId("card-patel"), cell, { altKey: true });
        expect(cell.hasAttribute("data-drop-invalid")).toBe(true);
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10, altKey: true });
        expect(events).toHaveLength(0);

        // A plain drop is delivered.
        drag(getByTestId("card-patel"), cell);
        const e = sole(events);
        if (e.type === "add") expect(e.value.duplicate).toBe(false);
    });

    test("2 — a second finger never ends the drag: only the pointer that pressed moves, drops or cancels it", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Card library="people" itemKey="cho" />
                <Cell surface="roster" row="patel" slot="thu" />
                <Cell surface="roster" row="cho" slot="fri" />
            </DragLayerProvider>,
        );
        const card = getByTestId("card-patel");
        const thu = getByTestId("cell-patel-thu");
        const fri = getByTestId("cell-cho-fri");
        engage(card, thu, { pointerId: 1 });
        expect(card.hasAttribute("data-dragging")).toBe(true);

        // A second finger lands on another card: it starts no second drag.
        fireEvent.pointerDown(getByTestId("card-cho"), { pointerId: 2, clientX: 50, clientY: 50 });
        expect(getByTestId("card-cho").hasAttribute("data-dragging")).toBe(false);
        // It moves over another cell: the drag does not follow it.
        pointAt(fri);
        fireEvent.pointerMove(document, { pointerId: 2, clientX: 60, clientY: 60 });
        expect(fri.hasAttribute("data-drop-active")).toBe(false);
        // It lifts: the drag is still in flight, and nothing was dropped.
        fireEvent.pointerUp(document, { pointerId: 2, clientX: 60, clientY: 60 });
        fireEvent.pointerCancel(document, { pointerId: 2 });
        expect(card.hasAttribute("data-dragging")).toBe(true);
        expect(events).toHaveLength(0);

        // The first finger drops where IT is.
        pointAt(thu);
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10 });
        const e = sole(events);
        if (e.type === "add") expect(e.value.into.row).toBe("patel");
        expect(card.hasAttribute("data-dragging")).toBe(false);
    });

    test("3 — a drop whose cell left the screen mid-drag re-reads the drop point, and says so when nothing is there", () => {
        const events: DragEventValue[] = [];
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        function Canvas() {
            const [shown, setShown] = useState(true);
            return (
                <>
                    <button data-testid="hide" onClick={() => setShown(false)} />
                    {shown && <Cell surface="roster" row="patel" slot="thu" />}
                    <Cell surface="roster" row="cho" slot="fri" />
                </>
            );
        }
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Canvas />
            </DragLayerProvider>,
        );
        const hide = getByTestId("hide");
        const fri = getByTestId("cell-cho-fri");

        // The drag rests over Thursday, which then scrolls away (unmounts); the
        // pointer now lies over Friday — the drop lands where it happened.
        engage(getByTestId("card-patel"), getByTestId("cell-patel-thu"));
        act(() => { hide.click(); });
        pointAt(fri);
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10 });
        const e = sole(events);
        if (e.type === "add") expect(e.value.into.row).toBe("cho");
        expect(warn).not.toHaveBeenCalled();
        expect(announced()).toBe("patel was dropped on cho · fri.");
    });

    test("3 — …and with nothing under the drop point, nothing is dropped, and the layer says why", () => {
        const events: DragEventValue[] = [];
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        function Canvas() {
            const [shown, setShown] = useState(true);
            return (
                <>
                    <button data-testid="hide" onClick={() => setShown(false)} />
                    {shown && <Cell surface="roster" row="patel" slot="thu" />}
                </>
            );
        }
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Canvas />
            </DragLayerProvider>,
        );
        const cell = getByTestId("cell-patel-thu");
        engage(getByTestId("card-patel"), cell);
        act(() => { getByTestId("hide").click(); });
        // The pointer still reports the element that is gone: it is no destination.
        pointAt(cell);
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10 });
        expect(events).toHaveLength(0);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(announced()).toBe("patel was not dropped: its target left the screen.");
    });

    test("a layer that leaves mid-drag ends the pointer's drag too — its next move and release are the page's", () => {
        const events: DragEventValue[] = [];
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { getByTestId, unmount } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
            </DragLayerProvider>,
        );
        engage(getByTestId("card-patel"), getByTestId("cell-patel-thu"));
        unmount();

        const move = new PointerEvent("pointermove", { pointerId: 1, clientX: 20, clientY: 20, bubbles: true, cancelable: true });
        document.dispatchEvent(move);
        expect(move.defaultPrevented).toBe(false);
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 20, clientY: 20 });
        expect(events).toHaveLength(0);
        expect(warn).not.toHaveBeenCalled();
    });
});

describe("scrolling under a drag (#608)", () => {
    test("content scrolled under a still pointer is read again — the cell under it now is where the drag rests", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
                <Cell surface="roster" row="patel" slot="fri" />
            </DragLayerProvider>,
        );
        const thu = getByTestId("cell-patel-thu");
        const fri = getByTestId("cell-patel-fri");
        engage(getByTestId("card-patel"), thu);
        expect(thu.hasAttribute("data-drop-active")).toBe(true);

        // A wheel scrolls the content: Friday lies under the pointer, which has not moved.
        pointAt(fri);
        fireEvent.scroll(fri.parentElement!);
        expect(thu.hasAttribute("data-drop-active")).toBe(false);
        expect(fri.hasAttribute("data-drop-active")).toBe(true);
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10 });
        const e = sole(events);
        if (e.type === "add") expect(e.value.into.slot).toBe("fri");
    });
});

describe("touch long-press protocol (#353)", () => {
    test("a swipe (>8px before the hold) stands down — no drag engages", () => {
        vi.useFakeTimers();
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
            </DragLayerProvider>,
        );
        const card = getByTestId("card-patel");
        fireEvent.pointerDown(card, { pointerType: "touch", pointerId: 1, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(document, { pointerType: "touch", pointerId: 1, clientX: 20, clientY: 0 });
        act(() => { vi.advanceTimersByTime(400); });
        expect(card.hasAttribute("data-dragging")).toBe(false);
        fireEvent.pointerUp(document, { pointerType: "touch", pointerId: 1 });
        expect(events).toHaveLength(0);
    });

    test("a stationary 300ms hold engages the drag; release ends it", () => {
        vi.useFakeTimers();
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
            </DragLayerProvider>,
        );
        const card = getByTestId("card-patel");
        const cell = getByTestId("cell-patel-thu");
        fireEvent.pointerDown(card, { pointerType: "touch", pointerId: 1, clientX: 0, clientY: 0 });
        expect(card.hasAttribute("data-dragging")).toBe(false);
        act(() => { vi.advanceTimersByTime(320); });
        expect(card.hasAttribute("data-dragging")).toBe(true);
        expect(cell.hasAttribute("data-drop-valid")).toBe(true);

        // Drop on the connected cell — the pointer path is live post-engage.
        pointAt(cell);
        fireEvent.pointerMove(document, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
        fireEvent.pointerUp(document, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
        expect(card.hasAttribute("data-dragging")).toBe(false);
        const e = sole(events);
        expect(e.type).toBe("add");
    });
});

describe("touch grip fast-path", () => {
    function GripCard({ library, itemKey }: { library: string; itemKey: string }) {
        const drag = useDragSourceItem({ library, key: itemKey }, <span>{itemKey}</span>, false);
        return (
            <div data-testid={`gcard-${itemKey}`} {...drag}>
                <span data-drag-grip="" data-testid={`grip-${itemKey}`} />
            </div>
        );
    }

    test("a touch on a [data-drag-grip] handle engages immediately (no hold)", () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <GripCard library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
            </DragLayerProvider>,
        );
        const card = getByTestId("gcard-patel");
        const cell = getByTestId("cell-patel-thu");
        fireEvent.pointerDown(getByTestId("grip-patel"), { pointerType: "touch", pointerId: 1, clientX: 0, clientY: 0 });
        expect(card.hasAttribute("data-dragging")).toBe(true);

        pointAt(cell);
        fireEvent.pointerMove(document, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
        fireEvent.pointerUp(document, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
        const e = sole(events);
        expect(e.type).toBe("add");
    });
});

// ── The keyboard ─────────────────────────────────────────────────────────

describe("keyboard drags (#608)", () => {
    stubScrollIntoView();

    function Grid({ events }: { events: DragEventValue[] }) {
        return (
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="mon" />
                <Cell surface="roster" row="patel" slot="tue" />
                <Cell surface="roster" row="cho" slot="mon" />
                <Cell surface="roster" row="cho" slot="tue" />
            </DragLayerProvider>
        );
    }

    /** The card at the left, the cells a 2×2 grid to its right. */
    function lay(getByTestId: (id: string) => HTMLElement) {
        layOut(new Map([
            [getByTestId("card-patel"), { left: 0, top: 0, width: 80, height: 30 }],
            [getByTestId("cell-patel-mon"), { left: 200, top: 0, width: 100, height: 40 }],
            [getByTestId("cell-patel-tue"), { left: 300, top: 0, width: 100, height: 40 }],
            [getByTestId("cell-cho-mon"), { left: 200, top: 40, width: 100, height: 40 }],
            [getByTestId("cell-cho-tue"), { left: 300, top: 40, width: 100, height: 40 }],
        ]));
    }

    test("a draggable is a focusable control that describes how to drag it", () => {
        const { getByTestId } = render(<Grid events={[]} />);
        const card = getByTestId("card-patel");
        expect(card.getAttribute("tabindex")).toBe("0");
        expect(card.getAttribute("role")).toBe("button");
        expect(card.getAttribute("aria-roledescription")).toBe("draggable");
        const described = document.getElementById(card.getAttribute("aria-describedby") ?? "");
        expect(described?.textContent).toContain("press Space or Enter");
    });

    test("Space picks up, the arrows move between the cells that take it, Space drops", async () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(<Grid events={events} />);
        lay(getByTestId);
        const card = getByTestId("card-patel");
        card.focus();
        press("Space");
        await tick();
        expect(card.hasAttribute("data-dragging")).toBe(true);
        expect(announced()).toBe("Picked up patel.");

        // Right: onto the nearest cell that way — Monday of the first row.
        press("ArrowRight");
        expect(getByTestId("cell-patel-mon").hasAttribute("data-drop-active")).toBe(true);
        expect(announced()).toBe("patel is over patel · mon.");
        // Right again: Tuesday; Down: the next row, the same column.
        press("ArrowRight");
        press("ArrowDown");
        const target = getByTestId("cell-cho-tue");
        expect(target.hasAttribute("data-drop-active")).toBe(true);
        expect(getByTestId("cell-patel-mon").hasAttribute("data-drop-active")).toBe(false);

        press("Space");
        const e = sole(events);
        expect(e.type).toBe("add");
        if (e.type === "add") {
            expect(e.value.into.row).toBe("cho");
            expect(e.value.into.slot).toBe("tue");
        }
        expect(card.hasAttribute("data-dragging")).toBe(false);
        expect(announced()).toBe("patel was dropped on cho · tue.");
    });

    test("Escape cancels a keyboard drag, and says so", async () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(<Grid events={events} />);
        lay(getByTestId);
        const card = getByTestId("card-patel");
        card.focus();
        press("Space");
        await tick();
        press("ArrowRight");
        press("Escape");
        expect(events).toHaveLength(0);
        expect(card.hasAttribute("data-dragging")).toBe(false);
        expect(getByTestId("cell-patel-mon").hasAttribute("data-drop-valid")).toBe(false);
        expect(announced()).toBe("Dragging patel was cancelled.");
    });

    test("only the arrows move a keyboard drag — Alt or a letter pressed on the way leaves it where it rests, and Alt held makes the drop a copy", async () => {
        const events: DragEventValue[] = [];
        const { getByTestId } = render(<Grid events={events} />);
        lay(getByTestId);
        const card = getByTestId("card-patel");
        const target = getByTestId("cell-cho-mon");
        card.focus();
        press("Space");
        await tick();
        press("ArrowRight");
        press("ArrowDown");
        expect(target.hasAttribute("data-drop-active")).toBe(true);

        fireEvent.keyDown(card, { key: "Alt", code: "AltLeft", altKey: true });
        fireEvent.keyDown(card, { key: "å", code: "KeyA", altKey: true });
        expect(target.hasAttribute("data-drop-active")).toBe(true);
        expect(announced()).toBe("patel is over cho · mon.");

        fireEvent.keyDown(card, { key: " ", code: "Space", altKey: true });
        const e = sole(events);
        expect(e.type).toBe("add");
        if (e.type === "add") {
            expect(e.value.into.row).toBe("cho");
            expect(e.value.into.slot).toBe("mon");
            expect(e.value.duplicate).toBe(true);
        }
    });

    test("a layer that leaves mid-drag ends the drag — nothing it leaves behind answers the page's next key", async () => {
        const events: DragEventValue[] = [];
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { getByTestId, unmount } = render(<Grid events={events} />);
        lay(getByTestId);
        getByTestId("card-patel").focus();
        press("Space");
        await tick();
        press("ArrowRight");
        unmount();

        // The page's next Space is the page's: not swallowed, and nothing dropped.
        const space = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
        document.body.dispatchEvent(space);
        expect(space.defaultPrevented).toBe(false);
        expect(events).toHaveLength(0);
        expect(warn).not.toHaveBeenCalled();
    });

    test("a key pressed in a control inside a draggable never picks it up", async () => {
        function ChipWithInput() {
            const drag = useDragEventChip({ surface: "roster", row: "patel", slot: "mon", event: "s1" }, <span>s1</span>);
            return <div data-testid="chip" {...drag}><input data-testid="amount" /></div>;
        }
        render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: [], kinds: KINDS_ALL }} />
                <ChipWithInput />
            </DragLayerProvider>,
        );
        const input = document.querySelector<HTMLInputElement>("[data-testid='amount']")!;
        input.focus();
        press("Enter");
        await tick();
        expect(document.querySelector("[data-testid='chip']")!.hasAttribute("data-dragging")).toBe(false);
    });
});

describe("announcements (#608)", () => {
    test("pick-up, over, refusal, drop and cancel are said in the layer's words — and a host's table re-words them", () => {
        const refuseFri: DropVeto = (e) => !(e.type === "add" && e.value.into.slot === "fri");
        const { getByTestId, rerender } = render(
            <DragLayerProvider>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: () => {} }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
                <Cell surface="roster" row="patel" slot="fri" canDrop={refuseFri} />
            </DragLayerProvider>,
        );
        engage(getByTestId("card-patel"), getByTestId("cell-patel-thu"));
        expect(announced()).toBe("patel is over patel · thu.");
        pointAt(getByTestId("cell-patel-fri"));
        fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 20 });
        expect(announced()).toBe("patel · fri does not take patel.");
        fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
        expect(announced()).toBe("Dragging patel was cancelled.");

        rerender(
            <DragLayerProvider messages={{ pickedUp: ({ item }) => `${item} aufgenommen.` }}>
                <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: () => {} }} />
                <Card library="people" itemKey="patel" />
                <Cell surface="roster" row="patel" slot="thu" />
                <Cell surface="roster" row="patel" slot="fri" canDrop={refuseFri} />
            </DragLayerProvider>,
        );
        engage(getByTestId("card-patel"), null);
        expect(announced()).toBe("patel aufgenommen.");
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10 });
        expect(announced()).toBe("patel was not dropped.");
    });

    test("a host rendering again with a new inline table mid-drag leaves every cell registered — the drag keeps resting where it rests", () => {
        const events: DragEventValue[] = [];
        function Page({ n }: { n: number }) {
            return (
                <DragLayerProvider messages={{ trash: () => `Remove (${n})` }}>
                    <Target config={{ id: "roster", sources: ["people"], kinds: KINDS_ALL, onDrag: e => events.push(e) }} />
                    <Card library="people" itemKey="patel" />
                    <Cell surface="roster" row="patel" slot="thu" />
                </DragLayerProvider>
            );
        }
        const { getByTestId, rerender } = render(<Page n={1} />);
        const cell = getByTestId("cell-patel-thu");
        engage(getByTestId("card-patel"), cell);
        expect(cell.hasAttribute("data-drop-active")).toBe(true);

        rerender(<Page n={2} />);
        expect(cell.hasAttribute("data-drop-active")).toBe(true);
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10 });
        expect(sole(events).type).toBe("add");
        expect(announced()).toBe("patel was dropped on patel · thu.");
    });
});
