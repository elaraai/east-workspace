/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * Board renderer behaviour that the drag-layer tests can't cover: the
 * duplicate-person guard (a drop onto a cell already holding the person is a
 * no-op), the optimistic add chip, coverage numerals + open-slot
 * placeholders, and the `+N` overflow chip. Pointer geometry is stubbed via
 * `document.elementFromPoint` (jsdom has no layout), as in
 * `dnd/drag-layer.dom.test.tsx`.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none, type ValueTypeOf } from "@elaraai/east";
import { Board } from "@elaraai/east-ui/internal";
import { system } from "../../theme";
import { DragLayerProvider, useDragSourceItem, type DragEventValue } from "../../dnd/drag-layer";
import { EastChakraBoard, type BoardValue } from "./index";

afterEach(cleanup);

type AssignmentValue = ValueTypeOf<typeof Board.Types.Assignment>;

function entity(key: string, label: string): ValueTypeOf<typeof Board.Types.Entity> {
    return { key, label, sublabel: none };
}

function assignment(key: string, person: string, area: string, shift: string,
    state: AssignmentValue["state"] = variant("committed", null)): AssignmentValue {
    return { key, person, area, shift, state };
}

function boardValue(overrides: Partial<BoardValue>): BoardValue {
    return {
        id: "board",
        sources: ["people"],
        mode: variant("edit", null),
        areaHeader: none,
        areas: [entity("icu", "ICU")],
        shifts: [entity("am", "AM"), entity("pm", "PM")],
        people: [entity("patel", "Patel, R."), entity("cho", "Cho, J.")],
        assignments: [],
        requirements: none,
        density: none,
        maxVisible: none,
        summary: none,
        onDrag: none,
        onSelect: none,
        onAccept: none,
        onAddAt: none,
        ...overrides,
    };
}

/** A raw Library card harness (the board only needs a registered source). */
function Card({ library, itemKey, label }: { library: string; itemKey: string; label: string }) {
    const onPointerDown = useDragSourceItem({ library, key: itemKey, label }, <div />);
    return <div data-testid={`card-${itemKey}`} onPointerDown={onPointerDown} />;
}

/** Point `document.elementFromPoint` at the element until restored. */
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

function renderBoard(value: BoardValue, extra?: React.ReactNode) {
    return render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                {extra}
                <EastChakraBoard value={value} storageKey="test" />
            </DragLayerProvider>
        </ChakraProvider>,
    );
}

/** Grid drop cells in area-major order (area0×shift0, area0×shift1, …). */
function cells(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>("[data-drag-cell]"));
}

describe("EastChakraBoard", () => {
    test("add: dropping a person on an empty cell fires onDrag and renders the optimistic chip", async () => {
        const events: DragEventValue[] = [];
        const value = boardValue({
            onDrag: some(((event: DragEventValue) => { events.push(event); }) as never),
        });
        const { container, getByTestId, getByText } = renderBoard(value,
            <Card library="people" itemKey="hasan" label="Hasan, M." />);

        drag(getByTestId("card-hasan"), cells(container)[0]!);
        await microtasks();

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe("add");
        if (events[0]!.type === "add") {
            expect(events[0]!.value.into.row).toBe("icu");
            expect(events[0]!.value.into.slot).toBe("am");
        }
        // Optimistic proposed chip renders the dragged card's label.
        expect(getByText("+Hasan, M.")).toBeTruthy();
    });

    test("duplicate-person guard: dropping a person on a cell already holding them is a no-op", async () => {
        const events: DragEventValue[] = [];
        const value = boardValue({
            assignments: [assignment("x1", "patel", "icu", "am")],
            onDrag: some(((event: DragEventValue) => { events.push(event); }) as never),
        });
        const { container, getByTestId, queryByText } = renderBoard(value,
            <Card library="people" itemKey="patel" label="Patel, R." />);

        drag(getByTestId("card-patel"), cells(container)[0]!);
        await microtasks();

        expect(events).toHaveLength(0);
        expect(queryByText("+Patel, R.")).toBeNull();
    });

    test("coverage: requirements render n/required numerals and open-slot placeholders", () => {
        const value = boardValue({
            assignments: [assignment("x1", "patel", "icu", "am")],
            requirements: some([
                { area: "icu", shift: "am", required: 3n },
                { area: "icu", shift: "pm", required: 1n },
            ]),
        });
        const { container, getByText } = renderBoard(value);

        expect(getByText("1/3")).toBeTruthy();
        expect(getByText("0/1")).toBeTruthy();
        // 2 open in icu·am + 1 open in icu·pm.
        expect(container.querySelectorAll("[aria-label='Open slot']")).toHaveLength(3);
    });

    test("overflow: a cell past maxVisible collapses behind a +N chip", () => {
        const value = boardValue({
            people: [entity("a", "A"), entity("b", "B"), entity("c", "C"), entity("d", "D")],
            assignments: [
                assignment("x1", "a", "icu", "am"),
                assignment("x2", "b", "icu", "am"),
                assignment("x3", "c", "icu", "am"),
                assignment("x4", "d", "icu", "am"),
            ],
            maxVisible: some(2n),
        });
        const { getByText, queryByText } = renderBoard(value);

        expect(getByText("+2")).toBeTruthy();
        expect(getByText("A")).toBeTruthy();
        expect(getByText("B")).toBeTruthy();
        expect(queryByText("C")).toBeNull();
    });

    test("published mode renders committed assignments only", () => {
        const value = boardValue({
            mode: variant("published", null),
            assignments: [
                assignment("x1", "patel", "icu", "am"),
                assignment("x2", "cho", "icu", "pm", variant("proposed", variant("added", null))),
            ],
        });
        const { getByText, queryByText } = renderBoard(value);

        expect(getByText("Patel, R.")).toBeTruthy();
        expect(queryByText("+Cho, J.")).toBeNull();
    });
});
