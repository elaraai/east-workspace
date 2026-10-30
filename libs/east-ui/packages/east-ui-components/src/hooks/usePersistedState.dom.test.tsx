/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 */

/**
 * A component's persisted view state, through the kept state: taken back only
 * in the shape this version writes, kept per person and cleared with them,
 * and never thrown on a storage it cannot reach.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { clearKept, keptName, keptRead } from "../platform/kept.js";
import { usePersistedState } from "./usePersistedState.js";

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** A pane's open tab, kept under `pane.tab`. */
function Pane({ read = true }: { read?: boolean }) {
    const { state, setState, isPersistent } = usePersistedState<{ tab: string }>("pane.tab", { tab: "details" },
        read ? keptRead.record({ tab: keptRead.string }) : undefined);
    return <button data-testid="pane" data-persistent={isPersistent ? "" : undefined} onClick={() => setState({ tab: "history" })}>{state.tab}</button>;
}

describe("usePersistedState", () => {
    test("a value kept by this version comes back before the first draw", () => {
        window.localStorage.setItem(keptName("pane.tab"), JSON.stringify({ tab: "history" }));
        render(<Pane />);
        expect(screen.getByTestId("pane").textContent).toBe("history");
    });

    test("a stored value in a shape this version does not write is removed, and the default stands", () => {
        window.localStorage.setItem(keptName("pane.tab"), JSON.stringify({ tab: 3 }));
        render(<Pane />);
        expect(screen.getByTestId("pane").textContent).toBe("details");
        expect(window.localStorage.getItem(keptName("pane.tab"))).toBeNull();
    });

    test("with no reader, only a value of the default's kind is taken", () => {
        window.localStorage.setItem(keptName("pane.tab"), JSON.stringify(["history"]));
        render(<Pane read={false} />);
        expect(screen.getByTestId("pane").textContent).toBe("details");
    });

    test("what it keeps is cleared with the kept state, as at a sign-out", () => {
        render(<Pane />);
        act(() => { screen.getByTestId("pane").click(); });
        expect(window.localStorage.getItem(keptName("pane.tab"))).toBe(JSON.stringify({ tab: "history" }));
        act(() => { clearKept(); });
        expect(screen.getByTestId("pane").textContent).toBe("details");
        expect(window.localStorage.getItem(keptName("pane.tab"))).toBeNull();
    });

    test("a storage it cannot reach throws nothing, and says it does not persist", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
        render(<Pane />);
        const pane = screen.getByTestId("pane");
        expect(pane.hasAttribute("data-persistent")).toBe(false);
        act(() => { pane.click(); });
        expect(pane.textContent).toBe("history");
    });
});
