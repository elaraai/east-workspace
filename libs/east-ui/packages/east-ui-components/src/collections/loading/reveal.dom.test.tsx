/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * `useLoadingReveal` on the page's timers (#1398, CL4), under a fake clock: a
 * 100 ms load shows nothing; a 400 ms load shows from 150 ms and for at least
 * 300 ms once shown — under StrictMode too, which renders twice and mounts
 * each effect twice, since the reveal moves only in its effects.
 */

import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useLoadingReveal } from "./reveal.js";

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
