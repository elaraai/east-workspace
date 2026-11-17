/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "@elaraai/east-ui-components";
import { GutterHandle, type GutterHandleProps } from "./gutter-handle.js";

afterEach(cleanup);

const STYLES = { gutterHandle: {} };
const BOUNDS = { min: 168, max: 360 };

function mount(props: Partial<GutterHandleProps> = {}) {
    const apply = vi.fn<(width: number) => void>();
    const commit = vi.fn<(width: number) => void>();
    const dragging = vi.fn<(on: boolean) => void>();
    const view = render(<ChakraProvider value={system}>
        <GutterHandle styles={STYLES} width={240} bounds={BOUNDS} label="Row names width" apply={apply} commit={commit} dragging={dragging} {...props} />
    </ChakraProvider>);
    const handle = within(view.container).getByRole("separator", { name: "Row names width" });
    return { handle, apply, commit, dragging };
}

/** A mouse's pointer event as the page hears it wherever the pointer is, as the pointer core's own test sends one. */
function windowPointer(type: "pointermove" | "pointerup" | "pointercancel", clientX: number, pointerId = 1, buttons = 1): void {
    document.body.dispatchEvent(new PointerEvent(type, { pointerId, clientX, pointerType: "mouse", isPrimary: true, buttons, bubbles: true }));
}

describe("GutterHandle (#1680's review)", () => {
    test("a separator a reader hears with its width and bounds", () => {
        const { handle } = mount();
        expect([handle.getAttribute("aria-orientation"), handle.getAttribute("aria-valuenow"), handle.getAttribute("aria-valuemin"),
            handle.getAttribute("aria-valuemax"), handle.tabIndex]).toEqual(["vertical", "240", "168", "360", 0]);
    });

    test("a drag writes each move where the layout reads it, held to its bounds, and keeps where it is let go", () => {
        const { handle, apply, commit, dragging } = mount();
        fireEvent.pointerDown(handle, { button: 0, buttons: 1, clientX: 500, pointerId: 1, pointerType: "mouse", isPrimary: true });
        expect(dragging.mock.calls).toEqual([[true]]);
        expect(handle.hasAttribute("data-dragging")).toBe(true);
        windowPointer("pointermove", 540);
        windowPointer("pointermove", 900);
        windowPointer("pointermove", 460);
        expect(commit).not.toHaveBeenCalled();
        windowPointer("pointerup", 460, 1, 0);
        expect(apply.mock.calls).toEqual([[280], [360], [200]]);
        expect(commit.mock.calls).toEqual([[200]]);
        expect(dragging.mock.calls).toEqual([[true], [false]]);
        expect(handle.hasAttribute("data-dragging")).toBe(false);
        // Ended once: a later move writes nothing.
        windowPointer("pointermove", 600);
        expect(apply).toHaveBeenCalledTimes(3);
    });

    test("a drag let go of puts the width back where it began, and keeps nothing", () => {
        const { handle, apply, commit, dragging } = mount();
        fireEvent.pointerDown(handle, { button: 0, buttons: 1, clientX: 500, pointerId: 1, pointerType: "mouse", isPrimary: true });
        windowPointer("pointermove", 560);
        windowPointer("pointercancel", 560, 1, 0);
        expect(apply.mock.calls).toEqual([[300], [240]]);
        expect(commit).not.toHaveBeenCalled();
        expect(dragging.mock.calls).toEqual([[true], [false]]);
    });

    test("a release where it began keeps nothing; another button's press is not a drag", () => {
        const { handle, commit, dragging } = mount();
        fireEvent.pointerDown(handle, { button: 2, buttons: 2, clientX: 500, pointerId: 1, pointerType: "mouse", isPrimary: true });
        expect(dragging).not.toHaveBeenCalled();
        fireEvent.pointerDown(handle, { button: 0, buttons: 1, clientX: 500, pointerId: 1, pointerType: "mouse", isPrimary: true });
        windowPointer("pointerup", 500, 1, 0);
        expect(commit).not.toHaveBeenCalled();
    });

    test("the keys step it and keep each step; a key at a bound keeps nothing; other keys pass", () => {
        const { handle, apply, commit } = mount();
        fireEvent.keyDown(handle, { key: "ArrowRight" });
        fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
        fireEvent.keyDown(handle, { key: "End" });
        expect(commit.mock.calls).toEqual([[248], [200], [360]]);
        expect(apply.mock.calls).toEqual(commit.mock.calls);
        const passed = fireEvent.keyDown(handle, { key: "ArrowUp" });
        expect(passed).toBe(true);
        expect(commit).toHaveBeenCalledTimes(3);
    });

    test("a key at the bound it is already at keeps nothing", () => {
        const { handle, commit } = mount({ width: 360 });
        fireEvent.keyDown(handle, { key: "End" });
        fireEvent.keyDown(handle, { key: "ArrowRight" });
        expect(commit).not.toHaveBeenCalled();
    });
});
