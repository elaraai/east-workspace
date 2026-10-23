/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * `useLoadingReveal` on the page's timers (#1398, CL4), under a fake clock: a
 * 100 ms load shows nothing; a 400 ms load shows from 150 ms and for at least
 * 300 ms once shown — under StrictMode too, which renders twice and mounts
 * each effect twice, since the reveal moves only in its effects. A builder's
 * one clock (`LoadingReveal`) is read where it shows: its flips render those
 * parts, never the frame it wraps.
 */

import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { LoadingReveal, useLoadingReveal, useRevealed } from "./reveal.js";

/** Renders whether a wait shows, as an attribute. */
function Probe({ waiting }: { waiting: boolean }) {
    const shown = useLoadingReveal(waiting);
    return <div data-probe="" data-shown={shown ? "" : undefined} />;
}

const shown = () => document.querySelector("[data-probe]")!.hasAttribute("data-shown");

/** Moves the fake clock on, letting React apply what the timers set. */
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useLoadingReveal (CL4)", () => {
    test("a 100 ms load never shows", () => {
        const view = render(<Probe waiting />);
        expect(shown()).toBe(false);
        advance(100);
        expect(shown()).toBe(false);
        view.rerender(<Probe waiting={false} />);
        advance(1000);
        expect(shown()).toBe(false);
    });

    test("a 400 ms load shows from 150 ms, and for at least 300 ms once shown", () => {
        const view = render(<Probe waiting />);
        advance(149);
        expect(shown()).toBe(false);
        advance(1);
        expect(shown()).toBe(true);
        advance(250);
        expect(shown()).toBe(true);
        // The read lands at 400 ms: shown since 150, the hold keeps it to 450.
        view.rerender(<Probe waiting={false} />);
        expect(shown()).toBe(true);
        advance(49);
        expect(shown()).toBe(true);
        advance(1);
        expect(shown()).toBe(false);
    });

    test("a short load past the delay is held its 300 ms, and a read starting meanwhile keeps it shown", () => {
        const view = render(<Probe waiting />);
        advance(160);
        view.rerender(<Probe waiting={false} />);
        advance(100);
        expect(shown()).toBe(true);
        view.rerender(<Probe waiting />);
        advance(1000);
        expect(shown()).toBe(true);
        view.rerender(<Probe waiting={false} />);
        expect(shown()).toBe(false);
    });

    test("under StrictMode, which renders twice and mounts each effect twice, the reveal keeps one clock", () => {
        const view = render(<StrictMode><Probe waiting /></StrictMode>);
        advance(149);
        expect(shown()).toBe(false);
        advance(1);
        expect(shown()).toBe(true);
        // The read lands as it shows: the hold keeps it to 450 ms.
        view.rerender(<StrictMode><Probe waiting={false} /></StrictMode>);
        advance(299);
        expect(shown()).toBe(true);
        advance(1);
        expect(shown()).toBe(false);
    });
});

describe("LoadingReveal: a builder's one clock, read where it shows (CL4)", () => {
    /** How often the frame the clock wraps has rendered. */
    let frames = 0;
    /** A part of the frame that shows the reveal. */
    function Reader() {
        const revealed = useRevealed();
        return <div data-probe="" data-shown={revealed === true ? "" : undefined} data-scoped={revealed === undefined ? undefined : ""} />;
    }
    /** The builder's frame: everything but the parts that read the clock. */
    function Frame() {
        frames += 1;
        return <Reader />;
    }
    /** The builder: its frame, made by its own render, under its one clock. */
    function Builder({ waiting }: { waiting: boolean }) {
        return <LoadingReveal waiting={waiting}><Frame /></LoadingReveal>;
    }

    test("its flips — at the delay, at the hold's end — render the part that reads it, never the frame it wraps", () => {
        frames = 0;
        const view = render(<Builder waiting />);
        expect([frames, shown()]).toEqual([1, false]);
        advance(150);
        expect([frames, shown()]).toEqual([1, true]);
        advance(50);
        // Landed at 200 ms: the builder renders for its read, the clock holds the reveal to 450 ms on its own.
        view.rerender(<Builder waiting={false} />);
        expect([frames, shown()]).toEqual([2, true]);
        advance(249);
        expect([frames, shown()]).toEqual([2, true]);
        advance(1);
        expect([frames, shown()]).toEqual([2, false]);
    });

    test("outside one, a part shows as its caller says", () => {
        render(<Reader />);
        expect(document.querySelector("[data-probe]")!.hasAttribute("data-scoped")).toBe(false);
    });
});
