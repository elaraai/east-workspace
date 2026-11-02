/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/** A period builder's view, kept state: kept for a reload under its scoped key, read only in its shape, cleared at a sign-out. */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { clearKept } from "@elaraai/east-ui-components";
import { keptName, resetKept } from "@elaraai/east-ui-components/internal";
import { usePageView } from "./page-view.js";

/** The view as this version writes it: a date. */
const viewOf = (stored: unknown): { date: number } | undefined => {
    const date = typeof stored === "object" && stored !== null ? (stored as { date?: unknown }).date : undefined;
    return typeof date === "number" ? { date } : undefined;
};

/** A board whose button steps its date. */
function Board() {
    const { view, setView } = usePageView("board.view", { date: 1 }, viewOf);
    return <button data-testid="board" onClick={() => setView({ date: view.date + 1 })}>{view.date}</button>;
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(cleanup);

describe("a period builder's view", () => {
    test("is kept for a reload under the kept state's key, and cleared at a sign-out", () => {
        render(<Board />);
        act(() => { screen.getByTestId("board").click(); });
        expect(window.localStorage.getItem(keptName("board.view"))).toBe(JSON.stringify({ date: 2 }));
        cleanup();
        resetKept();
        render(<Board />);
        expect(screen.getByTestId("board").textContent).toBe("2");
        act(() => { clearKept(); });
        expect(screen.getByTestId("board").textContent).toBe("1");
        expect(window.localStorage.getItem(keptName("board.view"))).toBeNull();
    });

    test("a stored view in a shape this version does not write is removed, and the author's view stands", () => {
        window.localStorage.setItem(keptName("board.view"), JSON.stringify({ date: "x" }));
        render(<Board />);
        expect(screen.getByTestId("board").textContent).toBe("1");
        expect(window.localStorage.getItem(keptName("board.view"))).toBeNull();
    });
});
