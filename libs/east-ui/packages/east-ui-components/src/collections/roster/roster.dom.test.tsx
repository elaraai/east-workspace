/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Roster grid basics: shifts group into person × day cells and render as
 * chips (committed and each proposed flavour), published mode hides
 * non-committed chips, and the summary strip renders. Regression cover for
 * the empty-grid defect where no chips painted at all (#362 audit). An added
 * shift leads with Font Awesome's plus, its name saying so, and the strip's
 * hint names each control by the Font Awesome icon it draws (#1263).
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { faIcons, loneGlyphs } from "../../testing/icons.js";
import { EastChakraRoster, type RosterValue, type RosterShiftValue } from "./index.js";

class ResizeObserverStub { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
(globalThis as never as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(cleanup);

function shift(key: string, person: string, day: string, label: string, state: RosterShiftValue["state"]): RosterShiftValue {
    return { key, person, day, label, state };
}

const committed = variant("committed", null) as RosterShiftValue["state"];
const added = variant("proposed", variant("added", null)) as RosterShiftValue["state"];
const ghost = variant("proposed", variant("model", null)) as RosterShiftValue["state"];

function rosterValue(over: Partial<RosterValue> = {}): RosterValue {
    return {
        id: "r1",
        sources: [],
        mode: variant("edit", null),
        days: ["Mon", "Tue"],
        personHeader: "Operator",
        personWidth: none,
        people: [
            { key: "patel", label: "Patel", sublabel: none, status: none, approval: none },
            { key: "cho", label: "Cho", sublabel: some("26h"), status: none, approval: none },
        ],
        shifts: [
            shift("s1", "patel", "Mon", "8h", committed),
            shift("s2", "patel", "Tue", "6h", added),
            shift("s3", "cho", "Mon", "4h", ghost),
        ],
        density: none,
        height: none,
        maxHeight: none,
        summary: some("1 dirty"),
        onDrag: none,
        canDrop: none,
        onSelect: none,
        onAccept: none,
        onAddAt: none,
        review: none,
        ...over,
    } as RosterValue;
}

describe("EastChakraRoster grid", () => {
    test("edit mode renders a chip for every shift, grouped into person × day cells", () => {
        render(
            <ChakraProvider value={system}>
                <EastChakraRoster value={rosterValue()} storageKey="t1" />
            </ChakraProvider>,
        );
        // Compact labels — state is conveyed by styling (data-state below),
        // added leads with Font Awesome's plus, which its name says (#1263),
        // ghost/removed carry the bare value.
        expect(screen.getByText("8h")).toBeTruthy();      // committed
        const add = screen.getByLabelText("6h, added");   // added
        expect([add.textContent, add.getAttribute("data-state"), faIcons(add.querySelector("[data-chip-sign]")!, "plus").length]).toEqual(["6h", "added", 1]);
        expect(screen.getByText("4h")).toBeTruthy();      // model ghost
        expect(screen.getByText("1 dirty")).toBeTruthy();
        expect(document.querySelectorAll("[data-state=committed]").length).toBe(1);
        expect(document.querySelectorAll("[data-state=added]").length).toBe(1);
        expect(document.querySelectorAll("[data-state=ghost], [data-state=model]").length).toBe(1);
    });

    test("published mode renders committed chips only", () => {
        render(
            <ChakraProvider value={system}>
                <EastChakraRoster value={rosterValue({ mode: variant("published", null) } as Partial<RosterValue>)} storageKey="t2" />
            </ChakraProvider>,
        );
        expect(screen.getByText("8h")).toBeTruthy();
        expect(screen.queryByText("6h")).toBeNull();
        expect(screen.queryByLabelText("6h, added")).toBeNull();
        expect(screen.queryByText("4h")).toBeNull();
    });

    test("an added shift leads with Font Awesome's plus, hidden from a reader, its name saying so; the others carry the bare value — never a written + (#1263)", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraRoster value={rosterValue()} storageKey="t3" />
            </ChakraProvider>,
        );
        const chips = [...container.querySelectorAll<HTMLElement>("[data-state]")].map((chip) => {
            const sign = chip.querySelector("[data-chip-sign]");
            return [chip.getAttribute("data-state"), chip.textContent, chip.getAttribute("aria-label"), sign?.getAttribute("aria-hidden") ?? null, sign === null ? 0 : faIcons(sign, "plus").length];
        });
        expect(chips).toEqual([
            ["committed", "8h", null, null, 0],
            ["added", "6h", "6h, added", "true", 1],
            ["model", "4h", null, null, 0],
        ]);
        expect(loneGlyphs(container, ["+"])).toEqual([]);
    });

    test("the strip's hint names each control by the Font Awesome icon it draws, hidden from a reader, beside its words (#1263)", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraRoster value={rosterValue()} storageKey="t4" />
            </ChakraProvider>,
        );
        const hint = container.querySelector<HTMLElement>("[data-roster-hint]")!;
        expect(hint.textContent!.replace(/\s+/g, " ")).toBe("drag handles · click empty cell to add · accept ghost · remove");
        const beside = [...hint.querySelectorAll("svg")].map((svg) => [
            svg.getAttribute("data-prefix"), svg.getAttribute("data-icon"), svg.getAttribute("aria-hidden"),
            (svg.previousSibling?.textContent ?? "").trim(), (svg.nextSibling?.textContent ?? "").trim(),
        ]);
        expect(beside).toEqual([
            ["fas", "grip-vertical", "true", "drag handles", "· click empty cell to add"],
            ["fas", "check", "true", "·", "accept ghost"],
            ["fas", "trash-can", "true", "·", "remove"],
        ]);
        expect(loneGlyphs(container)).toEqual([]);
    });
});
