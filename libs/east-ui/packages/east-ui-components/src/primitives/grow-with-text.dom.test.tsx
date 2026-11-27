/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A textarea as tall as its text (`grow-with-text.ts`, east-workspace#1779):
 * its height its text's, set as the text is drawn and again as it changes, by
 * typing or from code; within its max-height, past which it scrolls; left as it
 * is where it lays out nowhere; its own again when it stops growing; fitted
 * again as its width changes — and its text never touched: a value its host
 * sets from code never reaches the host's `onChange` as typing, as it did
 * through Zag's `autoresize`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useState, type CSSProperties } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useGrowWithText } from "./grow-with-text.js";

afterEach(cleanup);

/** The widths a box is laid out at, and the ResizeObserver callbacks that hear them change. */
let observed: (() => void)[] = [];
let width = 300;
class ResizeObserverStub {
    constructor(private readonly hear: () => void) { observed.push(() => this.hear()); }
    observe() {}
    disconnect() {}
}

/**
 * jsdom lays nothing out: the height a box's text needs at its width, as a browser measures it with the box's own
 * height let go — 60 for three rows of a short text, a row of 20 more for each 20 characters past 30 at 300px wide,
 * twice as many rows at half the width.
 */
function measured(this: HTMLTextAreaElement): number {
    const rows = Math.max(3, Math.ceil((this.value.length * (300 / width)) / 20) + 1);
    return rows * 20;
}

beforeEach(() => {
    observed = [];
    width = 300;
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", { configurable: true, get: measured });
    Object.defineProperty(HTMLTextAreaElement.prototype, "clientWidth", { configurable: true, get: () => width });
});
afterEach(() => {
    vi.unstubAllGlobals();
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
    delete (HTMLTextAreaElement.prototype as { clientWidth?: number }).clientWidth;
});

/** A 1px border above and below, as the app's fields draw. */
const BORDERED: CSSProperties = { boxSizing: "border-box", borderStyle: "solid", borderTopWidth: "1px", borderBottomWidth: "1px" };

/** A host's box that grows: its text the host's, typed into or set from code; what its `onChange` hears. */
function mount(options: { initial?: string; style?: CSSProperties; grows?: boolean } = {}) {
    const typed = vi.fn<(text: string) => void>();
    let setText: (text: string) => void = () => {};
    let setGrows: (grows: boolean) => void = () => {};
    function Host() {
        const [text, set] = useState(options.initial ?? "");
        const [grows, toGrow] = useState(options.grows ?? true);
        const [box, setBox] = useState<HTMLTextAreaElement | null>(null);
        setText = set;
        setGrows = toGrow;
        useGrowWithText(box, text, grows);
        return <textarea ref={setBox} aria-label="box" rows={3} value={text} style={options.style ?? BORDERED}
            onChange={(e) => { typed(e.target.value); set(e.target.value); }} />;
    }
    render(<Host />);
    const box = screen.getByLabelText("box") as HTMLTextAreaElement;
    return {
        box, typed,
        set: (text: string) => act(() => { setText(text); }),
        grow: (grows: boolean) => act(() => { setGrows(grows); }),
    };
}

describe("useGrowWithText (east-workspace#1779)", () => {
    test("its height is its text's, borders and all, set as it mounts and again as the text changes — typed, or set from code", () => {
        const { box, set } = mount({ initial: "Short." });
        expect([box.style.height, box.style.overflowY]).toEqual(["62px", "hidden"]);
        fireEvent.change(box, { target: { value: "x".repeat(70) } });
        expect(box.style.height).toBe("102px");
        set("Short again.");
        expect(box.style.height).toBe("62px");
    });

    test("a value its host sets from code never reaches the host's onChange as typing; what is typed does, once", async () => {
        const { box, set, typed } = mount({ initial: "Generated sentence." });
        set("Restored from code.");
        await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 20); }); });
        expect(typed).not.toHaveBeenCalled();
        fireEvent.change(box, { target: { value: "Typed." } });
        expect(typed.mock.calls).toEqual([["Typed."]]);
    });

    test("past its max-height it stands at it and scrolls; back under it, it holds its text whole again", () => {
        const { box, set } = mount({ initial: "x".repeat(90), style: { ...BORDERED, maxHeight: "90px" } });
        expect([box.style.height, box.style.overflowY]).toEqual(["90px", "auto"]);
        set("Short.");
        expect([box.style.height, box.style.overflowY]).toEqual(["62px", "hidden"]);
    });

    test("its lines break anew as its width changes: narrowed, it is fitted again; a change of its own height alone fits nothing", () => {
        const { box } = mount({ initial: "x".repeat(50) });
        expect(box.style.height).toBe("82px");
        box.style.height = "1px";
        for (const hear of observed) act(hear);
        expect(box.style.height).toBe("1px");
        width = 150;
        for (const hear of observed) act(hear);
        expect(box.style.height).toBe("122px");
    });

    test("a box laid out nowhere is left as it is; turned off, its height is its own again", () => {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", { configurable: true, get: () => 0 });
        const hidden = mount({ initial: "Short." });
        expect([hidden.box.style.height, hidden.box.style.overflowY]).toEqual(["", ""]);
        cleanup();
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", { configurable: true, get: measured });
        const { box, grow } = mount({ initial: "Short." });
        expect(box.style.height).toBe("62px");
        grow(false);
        expect([box.style.height, box.style.overflowY]).toEqual(["", ""]);
    });
});
