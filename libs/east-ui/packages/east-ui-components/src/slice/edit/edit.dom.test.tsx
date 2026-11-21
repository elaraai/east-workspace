/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * The edit popover drawn again (#1398, CL9): its trigger's words moving — as a
 * timeline's date navigator's do with each day its view crosses — it draws with
 * its styles made once for the theme and its size, never its recipe's slots
 * worked out again. And Esc closes it from the moment it opens, a layer open
 * over it keeping its own — and a control in its body that takes Esc itself
 * and says so (`data-escape-layer`, a Chooser laid in it: #1673) keeping its
 * own too, the popover staying.
 */

import { useState } from "react";
import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { SliceEditPopover } from "./index.js";

afterEach(cleanup);

/** A closed popover whose trigger says the words it is given. */
function Drawn({ words }: { words: string }) {
    return <ChakraProvider value={system}>
        <SliceEditPopover open={false} onOpenChange={() => undefined} label="Choose date" trigger={<button type="button">{words}</button>}>
            <div>Days</div>
        </SliceEditPopover>
    </ChakraProvider>;
}

describe("the edit popover drawn again (#1398, CL9)", () => {
    test("as its trigger's words move, works out none of its recipe's slots again", () => {
        // Each slot's styles of the popover's recipe at its size, as a recipe works them out.
        const slots = new Set(Object.values(system.sva(structuredClone(system.getSlotRecipe("sliceEdit")))({ size: "sm" }) as Record<string, unknown>)
            .map((style) => JSON.stringify((style as Record<string, unknown>)["@layer recipes"])));
        const { rerender } = render(<Drawn words="1–18 Oct" />);
        // A recipe working a slot's styles out wraps them in the recipes' layer.
        const wrap = vi.spyOn(system.layers, "wrap");
        try {
            for (const words of ["2–19 Oct", "3–20 Oct", "4–21 Oct"]) rerender(<Drawn words={words} />);
            expect(wrap.mock.calls.filter(([, styles]) => slots.has(JSON.stringify(styles))).length).toBe(0);
        } finally {
            wrap.mockRestore();
        }
    });
});

/** A popover its trigger opens, as an app's is: it says each time it is asked to close. */
function Opening({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    return <ChakraProvider value={system}>
        <SliceEditPopover open={open} onOpenChange={(next) => { if (!next) onClose(); setOpen(next); }} label="Autosave" trigger={<button type="button">Choose</button>}>
            <div data-testid="body">Autosave</div>
        </SliceEditPopover>
    </ChakraProvider>;
}

/**
 * A popover whose body lays a picker in it, as a filter's condition rows do: its search takes Esc itself, closing the
 * list alone, and says so (`data-escape-layer`).
 */
function PickerInside({ onClose, onPicker }: { onClose: () => void; onPicker: () => void }) {
    const [open, setOpen] = useState(false);
    return (
        <SliceEditPopover open={open} onOpenChange={(next) => { if (!next) onClose(); setOpen(next); }} label="Add filter" trigger={<button type="button">Choose</button>}>
            <button type="button">Field</button>
            <div data-escape-layer="">
                <input aria-label="Find" onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    e.preventDefault();
                    e.stopPropagation();
                    onPicker();
                }} />
            </div>
        </SliceEditPopover>
    );
}

/** The popover's positioner observes sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}

describe("Esc from the moment the edit popover opens", () => {
    // The page's frames, held: none passes until a test lets one, so "before its own dismissal listens" is no race.
    beforeEach(() => {
        vi.stubGlobal("ResizeObserver", ResizeObserverStub);
        vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    /** An Esc where the focus is, as the keyboard sends one. */
    const escape = (): Promise<void> => act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); await Promise.resolve(); });
    /** The popover opened by a press of its trigger, the focus on the trigger as a press leaves it, and no frame passed. */
    const opened = async (onClose: () => void): Promise<HTMLElement> => {
        render(<Opening onClose={onClose} />);
        const trigger = screen.getByRole("button", { name: "Choose" });
        trigger.focus();
        await act(async () => { fireEvent.click(trigger); await Promise.resolve(); });
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(screen.getByTestId("body")).toBeTruthy();
        return trigger;
    };

    test("pressed in the frame it opens in, before its own dismissal listens, closes it — once", async () => {
        const onClose = vi.fn();
        const trigger = await opened(onClose);
        // No frame has passed: the popover's own dismissal, which begins a frame after it opens, hears nothing yet.
        await escape();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });

    test("is a layer's own while one is open over it, and the popover's again once that has closed", async () => {
        const onClose = vi.fn();
        const trigger = await opened(onClose);
        // A field's list open over it, portaled to the page as a Select's is.
        const list = document.createElement("div");
        list.setAttribute("data-scope", "select");
        list.setAttribute("data-part", "content");
        list.setAttribute("data-state", "open");
        document.body.append(list);
        try {
            await escape();
            expect(onClose).not.toHaveBeenCalled();
            expect(trigger.getAttribute("aria-expanded")).toBe("true");
        } finally {
            list.remove();
        }
        await escape();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("is a control's own that takes it itself and says so, laid in its body — before and after its own dismissal listens — and the popover's again from elsewhere in it", async () => {
        const onClose = vi.fn();
        const onPicker = vi.fn();
        render(<ChakraProvider value={system}>
            <PickerInside onClose={onClose} onPicker={onPicker} />
        </ChakraProvider>);
        const trigger = screen.getByRole("button", { name: "Choose" });
        trigger.focus();
        await act(async () => { fireEvent.click(trigger); await Promise.resolve(); });
        const find = screen.getByRole("textbox", { name: "Find" });
        for (const frames of [0, 4]) {
            for (let frame = 0; frame < frames; frame++) await act(async () => { vi.advanceTimersToNextFrame(); await Promise.resolve(); });
            find.focus();
            await escape();
            expect([onPicker.mock.calls.length, onClose.mock.calls.length, trigger.getAttribute("aria-expanded")], `${frames} frames on`).toEqual([frames === 0 ? 1 : 2, 0, "true"]);
        }
        screen.getByRole("button", { name: "Field" }).focus();
        await escape();
        expect([onClose.mock.calls.length, trigger.getAttribute("aria-expanded")]).toEqual([1, "false"]);
    });

    test("heard once its own dismissal listens too, still closes it once", async () => {
        const onClose = vi.fn();
        const trigger = await opened(onClose);
        // Frames on, its own dismissal listens beside this one.
        for (let frame = 0; frame < 4; frame++) await act(async () => { vi.advanceTimersToNextFrame(); await Promise.resolve(); });
        await escape();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
});
