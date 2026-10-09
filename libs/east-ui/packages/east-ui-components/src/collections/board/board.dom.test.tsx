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
 * placeholders, and the `+N` overflow chip; a proposal's plus and an open
 * slot drawn as Font Awesome's, a proposal's name saying its state in the
 * host's words (#1263). Pointer geometry is stubbed via
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
import { announced, layOut, press, stubScrollIntoView, tick } from "../../testing/drag-layer.js";
import { faIcons, loneGlyphs } from "../../testing/icons.js";
import { AssignmentMessagesProvider, type AssignmentMessages } from "../shared/assignment-messages.js";
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
        areaWidth: none,
        areas: [entity("icu", "ICU")],
        shifts: [entity("am", "AM"), entity("pm", "PM")],
        people: [entity("patel", "Patel, R."), entity("cho", "Cho, J.")],
        assignments: [],
        requirements: none,
        density: none,
        maxVisible: none,
        height: none,
        maxHeight: none,
        summary: none,
        canDrop: none,
        onDrag: none,
        onSelect: none,
        onAccept: none,
        onAddAt: none,
        review: none,
        ...overrides,
    };
}

/** A raw Library card harness (the board only needs a registered source). */
function Card({ library, itemKey, label }: { library: string; itemKey: string; label: string }) {
    const drag = useDragSourceItem({ library, key: itemKey, label }, <div />);
    return <div data-testid={`card-${itemKey}`} {...drag} />;
}

/** Point `document.elementFromPoint` at the element until restored. */
function pointAt(el: Element | null) {
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => el;
}

/** Press and travel past the layer's 4px threshold over `overEl` — the drag is in flight. */
function engage(fromEl: Element, overEl: Element | null) {
    fireEvent.pointerDown(fromEl, { pointerId: 1, clientX: 0, clientY: 0 });
    pointAt(overEl);
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 10, clientY: 10 });
}

function drag(fromEl: Element, overEl: Element | null) {
    engage(fromEl, overEl);
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10 });
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

/** A host's words for a proposal's state — a translation, defined once (#1263). */
const GERMAN: Partial<AssignmentMessages> = {
    added: ({ label }) => `${label}, hinzugefügt`,
    suggested: ({ label }) => `${label}, vorgeschlagen`,
};

describe("EastChakraBoard", () => {
    test("add: dropping a person on an empty cell fires onDrag and renders the optimistic chip", async () => {
        const events: DragEventValue[] = [];
        const value = boardValue({
            onDrag: some(((event: DragEventValue) => { events.push(event); }) as never),
        });
        const { container, getByTestId, getByRole } = renderBoard(value,
            <Card library="people" itemKey="hasan" label="Hasan, M." />);

        drag(getByTestId("card-hasan"), cells(container)[0]!);
        await microtasks();

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe("add");
        if (events[0]!.type === "add") {
            expect(events[0]!.value.into.row).toBe("icu");
            expect(events[0]!.value.into.slot).toBe("am");
        }
        // Optimistic proposed chip renders the dragged card's label, named as added.
        expect(getByRole("button", { name: "Hasan, M., added" }).textContent).toBe("Hasan, M.");
    });

    test("duplicate-person guard: dropping a person on a cell already holding them is a no-op with the invalid treatment", async () => {
        const events: DragEventValue[] = [];
        const value = boardValue({
            assignments: [assignment("x1", "patel", "icu", "am")],
            onDrag: some(((event: DragEventValue) => { events.push(event); }) as never),
        });
        const { container, getByTestId, queryByRole } = renderBoard(value,
            <Card library="people" itemKey="patel" label="Patel, R." />);
        const [cell, pm] = cells(container);

        // The occupied cell is never marked valid (the free one is); hovering it shows ⊘.
        engage(getByTestId("card-patel"), cell!);
        expect(cell!.hasAttribute("data-drop-valid")).toBe(false);
        expect(pm!.hasAttribute("data-drop-valid")).toBe(true);
        expect(cell!.hasAttribute("data-drop-invalid")).toBe(true);
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10 });
        await microtasks();

        expect(events).toHaveLength(0);
        expect(queryByRole("button", { name: "Patel, R., added" })).toBeNull();
        expect(cell!.hasAttribute("data-drop-invalid")).toBe(false);
    });

    test("canDrop veto: a vetoed candidate event shows the invalid treatment and drops nothing", async () => {
        const events: DragEventValue[] = [];
        const value = boardValue({
            // Hasan may not take ICU PM; everything else is allowed. The
            // predicate sees the synthesized candidate event (#261).
            canDrop: some(((event: DragEventValue) =>
                !(event.type === "add" && event.value.from.key === "hasan" && event.value.into.slot === "pm")) as never),
            onDrag: some(((event: DragEventValue) => { events.push(event); }) as never),
        });
        const { container, getByTestId, getByRole, queryByRole } = renderBoard(value,
            <Card library="people" itemKey="hasan" label="Hasan, M." />);
        const [amCell, pmCell] = cells(container);

        // Forbidden cell: not valid, invalid on hover, drop is a no-op.
        engage(getByTestId("card-hasan"), pmCell!);
        expect(pmCell!.hasAttribute("data-drop-valid")).toBe(false);
        expect(amCell!.hasAttribute("data-drop-valid")).toBe(true);
        expect(pmCell!.hasAttribute("data-drop-invalid")).toBe(true);
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 10 });
        await microtasks();
        expect(events).toHaveLength(0);
        expect(queryByRole("button", { name: "Hasan, M., added" })).toBeNull();

        // The allowed cell still accepts the person.
        drag(getByTestId("card-hasan"), amCell!);
        await microtasks();
        expect(events).toHaveLength(1);
        expect(getByRole("button", { name: "Hasan, M., added" })).toBeTruthy();
    });

    test("keyboard (#608): a focused proposed chip picks up with Space, the arrows carry it between cells, Escape puts it back, Space drops it", async () => {
        stubScrollIntoView();
        const events: DragEventValue[] = [];
        const value = boardValue({
            assignments: [assignment("x1", "cho", "icu", "am", variant("proposed", variant("added", null)))],
            onDrag: some(((event: DragEventValue) => { events.push(event); }) as never),
        });
        const { container, getByRole } = renderBoard(value);
        const [am, pm] = cells(container);
        const chip = am!.querySelector<HTMLElement>("[data-draggable]")!;
        expect(chip.getAttribute("tabindex")).toBe("0");
        layOut(new Map([
            [chip, { left: 10, top: 10, width: 60, height: 20 }],
            [am!, { left: 0, top: 0, width: 180, height: 40 }],
            [pm!, { left: 180, top: 0, width: 180, height: 40 }],
        ]));

        // Picked up, carried to PM, and put back.
        chip.focus();
        press("Space");
        await tick();
        press("ArrowRight");
        expect(pm!.hasAttribute("data-drop-active")).toBe(true);
        press("Escape");
        await microtasks();
        expect(announced()).toBe("Dragging Cho, J. was cancelled.");
        expect(chip.hasAttribute("data-dragging")).toBe(false);
        expect(pm!.hasAttribute("data-drop-active")).toBe(false);
        expect(events).toHaveLength(0);

        chip.focus();
        press("Space");
        await tick();
        // Picked up where it sits — over its own cell, named by its area and shift.
        expect(chip.hasAttribute("data-dragging")).toBe(true);
        expect(announced()).toBe("Cho, J. is over ICU · AM.");
        press("ArrowRight");
        expect(pm!.hasAttribute("data-drop-active")).toBe(true);
        expect(announced()).toBe("Cho, J. is over ICU · PM.");
        press("Space");
        await microtasks();
        expect(announced()).toBe("Cho, J. was dropped on ICU · PM.");

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe("move");
        if (events[0]!.type === "move") {
            expect(events[0]!.value.from.slot).toBe("am");
            expect(events[0]!.value.to.slot).toBe("pm");
        }
        // The chip now sits in the PM cell.
        expect(pm!.contains(getByRole("button", { name: "Cho, J., added" }))).toBe(true);
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
        expect(queryByText("Cho, J.")).toBeNull();
    });

    test("a proposal to add — an operator's, or a model's suggestion — leads with Font Awesome's plus, its name saying so, and an open slot is its circle-plus: never a text glyph (#1263)", () => {
        const value = boardValue({
            assignments: [
                assignment("x1", "patel", "icu", "am"),
                assignment("x2", "cho", "icu", "am", variant("proposed", variant("added", null))),
                assignment("x3", "patel", "icu", "pm", variant("proposed", variant("model", null))),
            ],
            requirements: some([{ area: "icu", shift: "am", required: 3n }]),
        });
        const { container, getByRole, getByText } = renderBoard(value);
        const [am] = cells(container);
        // A committed chip is its label alone: no plus, no state in its name.
        const committed = [...am!.querySelectorAll<HTMLElement>("[data-state='committed']")];
        expect(committed.map((c) => [c.textContent, c.getAttribute("aria-label"), faIcons(c, "plus").length])).toEqual([["Patel, R.", null, 0]]);
        // A proposal to add: its label after the plus, which the name says, hidden from a reader itself.
        for (const [name, label] of [["Cho, J., added", "Cho, J."], ["Patel, R., suggested", "Patel, R."]] as const) {
            const chip = getByRole("button", { name });
            const sign = chip.querySelector("[data-chip-sign]")!;
            expect([chip.textContent, sign.getAttribute("aria-hidden"), faIcons(sign, "plus").length], name).toEqual([label, "true", 1]);
        }
        // No chip's text starts with a +.
        expect([...container.querySelectorAll("[data-state]")].map((c) => c.textContent).filter((t) => t?.startsWith("+"))).toEqual([]);
        // The one open slot left in ICU · AM (3 required, 2 filled) is Font Awesome's circle-plus.
        const slot = container.querySelector<HTMLElement>("[aria-label='Open slot']")!;
        expect([slot.textContent, faIcons(slot, "circle-plus").length]).toEqual(["", 1]);
        expect(getByText("2/3")).toBeTruthy();
        expect(loneGlyphs(container)).toEqual([]);
    });

    test("a host's table re-words the state a proposal's name says (#1263)", () => {
        const value = boardValue({
            assignments: [
                assignment("x2", "cho", "icu", "am", variant("proposed", variant("added", null))),
                assignment("x3", "patel", "icu", "pm", variant("proposed", variant("model", null))),
            ],
        });
        const { getByRole } = render(
            <ChakraProvider value={system}>
                <AssignmentMessagesProvider messages={GERMAN}>
                    <DragLayerProvider>
                        <EastChakraBoard value={value} storageKey="test" />
                    </DragLayerProvider>
                </AssignmentMessagesProvider>
            </ChakraProvider>,
        );
        expect([getByRole("button", { name: "Cho, J., hinzugefügt" }).textContent, getByRole("button", { name: "Patel, R., vorgeschlagen" }).textContent])
            .toEqual(["Cho, J.", "Patel, R."]);
    });
});
