/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Interaction tests for `Pick.Panel` (#590).
 *
 * The panel mounts against a **fake pick closure** — a plain JS object over
 * mutable state implementing the `PickBindType` contract (`key` / `state` /
 * `items`). That is the whole surface the renderer consumes, so the fake is
 * faithful by construction, and it exercises the React layer without compiling
 * East IR or standing up a store.
 *
 * The behaviours worth pinning are the ones that were deliberate decisions
 * rather than mechanics: that state names what is HIDDEN (so an unknown id is
 * inert and a new item shows), that the handler reads LIVE state (so two clicks
 * inside one frame compose instead of clobbering), and that a switched-off row
 * dims as one rule on the row rather than per part.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some } from "@elaraai/east";
import { system } from "../theme/index.js";
import { EastChakraPickPanel } from "./panel/index.js";

afterEach(cleanup);

/** One descriptor, with the optional fields defaulted the way the factory does. */
function item(id: string, title: string, extra: Record<string, unknown> = {}) {
    return { id, title, subtitle: none, icon: none, count: none, narrowed: false, ...extra };
}

/** A minimal `PickBindType` closure over mutable JS state. */
function fakePick(items: ReturnType<typeof item>[], hidden: string[] = []) {
    let s = [...hidden];
    return {
        key: "test.pick",
        state: {
            read: () => s,
            write: (next: string[]) => { s = next; },
            has: () => true,
        },
        items,
        /** Test-only peek at what the panel wrote. */
        current: () => s,
    };
}

function mount(pick: ReturnType<typeof fakePick>, title = "Series") {
    return render(
        <ChakraProvider value={system}>
            <EastChakraPickPanel value={{ pick, title } as never} />
        </ChakraProvider>,
    );
}

describe("Pick.Panel", () => {
    test("renders one row per item, with the author's noun as the heading", () => {
        mount(fakePick([item("a", "Machine jobs"), item("b", "Line load")]));
        expect(screen.getByText("Series")).toBeTruthy();
        expect(screen.getByText("Machine jobs")).toBeTruthy();
        expect(screen.getByText("Line load")).toBeTruthy();
    });

    test("the heading counts what is SHOWING, not what exists", () => {
        mount(fakePick([item("a", "A"), item("b", "B"), item("c", "C")], ["b"]));
        expect(screen.getByText("2 of 3")).toBeTruthy();
    });

    test("a hidden row is marked off as ONE rule on the row", () => {
        mount(fakePick([item("a", "A"), item("b", "B")], ["b"]));
        const rows = screen.getAllByRole("button");
        expect(rows[0]?.getAttribute("data-on")).toBe("true");
        expect(rows[1]?.getAttribute("data-on")).toBe("false");
        // aria carries the same fact, so the state is not colour-only.
        expect(rows[1]?.getAttribute("aria-pressed")).toBe("false");
    });

    test("clicking a shown row hides it; clicking again brings it back", () => {
        const pick = fakePick([item("a", "A"), item("b", "B")]);
        mount(pick);
        fireEvent.click(screen.getByLabelText("Toggle A"));
        expect(pick.current()).toEqual(["a"]);
        fireEvent.click(screen.getByLabelText("Toggle A"));
        expect(pick.current()).toEqual([]);
    });

    test("two toggles COMPOSE — the handler reads live state, not the render snapshot", () => {
        const pick = fakePick([item("a", "A"), item("b", "B"), item("c", "C")]);
        mount(pick);
        // Both clicks land before React commits a re-render. A snapshot-based
        // handler would write ["a"] then ["b"], losing the first.
        fireEvent.click(screen.getByLabelText("Toggle A"));
        fireEvent.click(screen.getByLabelText("Toggle B"));
        expect(new Set(pick.current())).toEqual(new Set(["a", "b"]));
    });

    test("an id in the state that names no item is inert — a rename cannot break the panel", () => {
        const pick = fakePick([item("a", "A"), item("b", "B")], ["gone"]);
        mount(pick);
        // Nothing is hidden, because nothing carries that id.
        expect(screen.getByText("2 of 2")).toBeTruthy();
        const rows = screen.getAllByRole("button");
        expect(rows.every(r => r.getAttribute("data-on") === "true")).toBe(true);
    });

    test("a zero count is flagged — a series switched on to no effect says so", () => {
        mount(fakePick([item("a", "A", { count: some(0n) }), item("b", "B", { count: some(24n) })]));
        const zero = screen.getByText("0");
        expect(zero.getAttribute("data-zero")).not.toBeNull();
        expect(screen.getByText("24").getAttribute("data-zero")).toBeNull();
    });

    test("a narrowed count is marked, so a collapsed row still says it is filtered", () => {
        mount(fakePick([item("a", "A", { count: some(18n), narrowed: true })]));
        expect(screen.getByText("18").getAttribute("data-narrowed")).not.toBeNull();
    });

    test("no count renders no count cell at all (what a paged source must say)", () => {
        mount(fakePick([item("a", "A")]));
        expect(screen.queryByText("0")).toBeNull();
    });

    test("the sub-line renders only when present", () => {
        mount(fakePick([item("a", "A", { subtitle: some("one row per machine") }), item("b", "B")]));
        expect(screen.getByText("one row per machine")).toBeTruthy();
    });
});
