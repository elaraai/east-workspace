/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Chooser (#1322): A48's sections, search, keys and hover, as the
 * Allocation's resource cell lays them out — Current, `Gaps that fit` best
 * first with their reasons, then `Doesn't fit` — and the choice it hands back,
 * which the host runs (A49).
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { Chooser, type ChooserSection } from "./index.js";

afterEach(cleanup);

/** A bin's resource cell, as the mock opens it for bin 3113 on K-108. */
const RESOURCE_CELL: ChooserSection[] = [
    { label: "Current", options: [{ key: "K-108", label: "K-108", line: "current", range: "16–32 m³", state: "current" }] },
    { label: "Gaps that fit", options: [
        { key: "K-103", label: "K-103", line: "0 d spare to Tue 18 · leaves 32 m³ · takes 16–32", range: "16–32 m³", state: "enabled", match: "K-103 Hall A · 32 m³" },
        { key: "K-601", label: "K-601", line: "open gap · leaves 32 m³ · min 40 · 8 short", range: "40–60 m³", state: "enabled", match: "K-601 Bulk · 60 m³" },
    ] },
    { label: "Doesn't fit", options: [
        { key: "K-503", label: "K-503", line: "busy until Fri 14", range: "24–48 m³", state: "refused", match: "K-503 Large · 48 m³" },
        { key: "K-207", label: "K-207", line: "over max by 36 m³", range: "20–40 m³", state: "refused", match: "K-207 Hall B · 40 m³" },
    ] },
];
/** An event cell's Allocated section: events already on the board, muted, never chosen. */
const EVENT_CELL: ChooserSection[] = [
    { label: "Book here", options: [{ key: "LD-2231", label: "LD-2231", line: "BRK · R2 · spec MC12 · overdue", range: "21 m³", state: "enabled", warn: true }] },
    { label: "Allocated", options: [{ key: "LD-2201", label: "LD-2201", line: "in B-3 01:55 on K-209", range: "35 m³", state: "disabled" }] },
];

const mount = (sections: ChooserSection[], onChoose = vi.fn(), onClose?: () => void) => {
    render(<ChakraProvider value={system}><Chooser sections={sections} placeholder="Find a resource" onChoose={onChoose} onClose={onClose} /></ChakraProvider>);
    return { onChoose, input: screen.getByRole("combobox", { name: "Find a resource" }) };
};
const highlighted = () => document.querySelector("[data-highlighted]")?.getAttribute("id")?.split("-").slice(-2).join("-");

describe("the Chooser", () => {
    test("A48 — a resource cell's sections in order: Current checked, the fits best first with their reasons, then what doesn't fit with a × and its reason", () => {
        mount(RESOURCE_CELL);
        const groups = screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
        expect(groups).toEqual(["Current", "Gaps that fit", "Doesn't fit"]);
        const current = screen.getByRole("option", { name: /K-108/ });
        expect(current.getAttribute("aria-selected")).toBe("true");
        expect(within(current).getByLabelText("Current")).toBeTruthy();
        const refused = screen.getByRole("option", { name: /K-503/ });
        expect(refused.getAttribute("aria-disabled")).toBe("true");
        expect(refused.getAttribute("data-state")).toBe("refused");
        expect(within(refused).getByLabelText("Doesn't fit")).toBeTruthy();
        expect(refused.textContent).toContain("busy until Fri 14");
        expect(screen.getAllByRole("option", { name: /K-10|K-60/ }).map((o) => o.textContent?.slice(0, 5))).toEqual(["K-108", "K-103", "K-601"]);
        expect(document.querySelector("[data-chooser]")!.textContent).toContain("move · Enter chooses · Esc closes");
    });

    test("A48 — ↑↓ move through the options a choice can take, cycling and skipping what doesn't fit; Enter chooses the highlighted one", () => {
        const { onChoose, input } = mount(RESOURCE_CELL);
        expect(highlighted()).toBe("K-108");
        fireEvent.keyDown(input, { key: "ArrowDown" });
        expect(highlighted()).toBe("K-103");
        fireEvent.keyDown(input, { key: "ArrowDown" });
        expect(highlighted()).toBe("K-601");
        fireEvent.keyDown(input, { key: "ArrowDown" });
        expect(highlighted()).toBe("K-108");
        fireEvent.keyDown(input, { key: "ArrowUp" });
        expect(highlighted()).toBe("K-601");
        expect(input.getAttribute("aria-activedescendant")).toMatch(/K-601$/);
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onChoose).toHaveBeenCalledWith("K-601");
    });

    test("A48 — hovering an option highlights it; a click chooses it; one that doesn't fit takes neither", () => {
        const { onChoose } = mount(RESOURCE_CELL);
        fireEvent.mouseEnter(screen.getByRole("option", { name: /K-601/ }));
        expect(highlighted()).toBe("K-601");
        fireEvent.mouseEnter(screen.getByRole("option", { name: /K-503/ }));
        expect(highlighted()).toBe("K-601");
        fireEvent.click(screen.getByRole("option", { name: /K-503/ }));
        expect(onChoose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("option", { name: /K-103/ }));
        expect(onChoose).toHaveBeenCalledWith("K-103");
    });

    test("A48 — search filters by label and line, drops an emptied section, puts the highlight on the first, and says `no match`", () => {
        const { input } = mount(RESOURCE_CELL);
        fireEvent.keyDown(input, { key: "ArrowDown" });
        fireEvent.change(input, { target: { value: "bulk" } });
        expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Gaps that fit"]);
        expect(screen.getAllByRole("option").map((o) => o.textContent?.slice(0, 5))).toEqual(["K-601"]);
        expect(highlighted()).toBe("K-601");
        // An option's own `match` is what the search reads: a resource is found by its name and group, not its reason.
        fireEvent.change(input, { target: { value: "busy" } });
        expect(screen.queryAllByRole("option")).toHaveLength(0);
        fireEvent.change(input, { target: { value: "K-5" } });
        expect(screen.getAllByRole("option").map((o) => o.textContent?.slice(0, 5))).toEqual(["K-503"]);
        expect(highlighted()).toBeUndefined();
        fireEvent.change(input, { target: { value: "nothing like this" } });
        expect(screen.queryAllByRole("option")).toHaveLength(0);
        expect(document.querySelector("[data-chooser]")!.textContent).toContain("no match");
    });

    test("A48 — an event cell's Allocated events are muted, with no ×, and never chosen; an overdue one's line is in the warning text", () => {
        const { onChoose, input } = mount(EVENT_CELL);
        const taken = screen.getByRole("option", { name: /LD-2201/ });
        expect(taken.getAttribute("data-state")).toBe("disabled");
        expect(within(taken).queryByLabelText("Doesn't fit")).toBeNull();
        expect(screen.getByRole("option", { name: /LD-2231/ }).hasAttribute("data-warn")).toBe(true);
        fireEvent.keyDown(input, { key: "ArrowDown" });
        expect(highlighted()).toBe("LD-2231");
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onChoose).toHaveBeenCalledWith("LD-2231");
    });

    test("A48 — with no `match` of its own, an option is found by its label and its line", () => {
        const { input } = mount(EVENT_CELL);
        fireEvent.change(input, { target: { value: "overdue" } });
        expect(screen.getAllByRole("option").map((o) => o.textContent?.slice(0, 7))).toEqual(["LD-2231"]);
        fireEvent.change(input, { target: { value: "K-209" } });
        expect(screen.getAllByRole("option").map((o) => o.textContent?.slice(0, 7))).toEqual(["LD-2201"]);
    });

    test("A48 — Esc in a Chooser laid in a pane closes it", () => {
        const onClose = vi.fn();
        const { input } = mount(RESOURCE_CELL, vi.fn(), onClose);
        fireEvent.keyDown(input, { key: "Escape" });
        expect(onClose).toHaveBeenCalledOnce();
    });
});
