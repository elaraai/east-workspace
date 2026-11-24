/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Chooser (#1322): A48's sections, search, keys and hover, as the
 * Allocation's resource cell lays them out — Current, `Gaps that fit` best
 * first with their reasons, then `Doesn't fit` — and the choice it hands back,
 * which the host runs (A49). And as the one picker of the query builder's slots
 * and a filter's condition rows (#1673): options its host filters, the
 * highlight held by key across the lists it gives, its label, an option's icon
 * and words, Tab, ⌘ Enter left to its host, and its bare form — and its search
 * holding the focus by the end of the commit that draws it, so a key pressed as
 * its host draws it afresh is never lost. An option's label and line, each one
 * line that a narrow host cuts, say their whole on hover.
 */

import { useLayoutEffect, useState } from "react";
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { faFilter } from "@fortawesome/free-solid-svg-icons";
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

    test("an option's label and its line each say their whole on hover, as a narrow host — an inspector's pane — ends either in an ellipsis; its name is its words still", () => {
        mount(RESOURCE_CELL);
        const option = screen.getByRole("option", { name: /K-103/ });
        expect(option.querySelector("[data-option-label]")!.getAttribute("title")).toBe("K-103");
        expect(option.querySelector("[data-option-line]")!.getAttribute("title")).toBe("0 d spare to Tue 18 · leaves 32 m³ · takes 16–32");
        // The range is never cut, and says nothing twice.
        expect(option.querySelector("[data-option-range]")!.hasAttribute("title")).toBe(false);
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

    test("A48 — Esc in a Chooser laid in a pane closes it: it takes the key itself and says so (`data-escape-layer`), which a frame's overlay pane leaves to it", () => {
        const onClose = vi.fn();
        const { input } = mount(RESOURCE_CELL, vi.fn(), onClose);
        expect(document.querySelector("[data-chooser]")!.hasAttribute("data-escape-layer")).toBe(true);
        fireEvent.keyDown(input, { key: "Escape" });
        expect(onClose).toHaveBeenCalledOnce();
        cleanup();
        // In a popover the popover takes Esc: the Chooser claims nothing.
        mount(RESOURCE_CELL);
        expect(document.querySelector("[data-chooser]")!.hasAttribute("data-escape-layer")).toBe(false);
    });

    describe("as the one picker of a host that filters its options (#1673)", () => {
        /** A field slot's offers for the text typed: the host's own filter, the value typed offered first. */
        const offers = (text: string): ChooserSection[] => {
            const fields = ["region", "customer", "units"].filter((f) => f.includes(text.trim().toLowerCase()));
            return [
                ...(text.trim() === "" ? [] : [{ label: "Typed", options: [{ key: `typed:${text}`, label: `Use "${text}"`, state: "enabled" as const, words: true }] }]),
                { label: "Fields", options: fields.map((f) => ({ key: f, label: f, line: "text", range: "5 values", state: "enabled" as const, words: true })) },
            ];
        };
        /** A host: the text and the list its own, the Chooser told to show them. */
        function Host({ onChoose, initialKey }: { onChoose: (key: string) => void; initialKey?: string | undefined }) {
            const [text, setText] = useState("");
            return <Chooser sections={offers(text)} placeholder="Type to filter" label="Field" onChoose={onChoose} query={text} onQuery={setText}
                initialKey={initialKey} tabChooses empty="Type a value, then press ⏎." hint="Fields from the checked type" />;
        }
        const host = (initialKey?: string) => {
            const onChoose = vi.fn();
            render(<ChakraProvider value={system}><Host onChoose={onChoose} initialKey={initialKey} /></ChakraProvider>);
            return { onChoose, input: screen.getByRole("combobox", { name: "Field" }) };
        };
        const lit = () => document.querySelector("[data-highlighted]")?.textContent;

        test("the host filters: the Chooser shows the options as given, puts the highlight on the first as text is typed, and holds it by key while the list given again has it", () => {
            const { input } = host();
            expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["regiontext5 values", "customertext5 values", "unitstext5 values"]);
            fireEvent.keyDown(input, { key: "ArrowDown" });
            expect(lit()).toBe("customertext5 values");
            // Typed: the host's list for "u" — the value typed first — and the highlight back on the first.
            fireEvent.change(input, { target: { value: "u" } });
            expect(screen.getAllByRole("option").map((o) => o.textContent?.split("text")[0])).toEqual(['Use "u"', "customer", "units"]);
            expect(lit()).toBe('Use "u"');
            // Moved to `units`, then given the list again for the same text: the highlight stays on `units`.
            fireEvent.keyDown(input, { key: "ArrowUp" });
            expect(lit()).toBe("unitstext5 values");
            fireEvent.change(input, { target: { value: "un" } });
            fireEvent.keyDown(input, { key: "ArrowDown" });
            expect(lit()).toBe("unitstext5 values");
        });

        test("Tab chooses where the host asks, and ⌘ or Ctrl Enter is the host's, never a choice", () => {
            const { input, onChoose } = host();
            fireEvent.keyDown(input, { key: "Enter", metaKey: true });
            fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
            expect(onChoose).not.toHaveBeenCalled();
            fireEvent.keyDown(input, { key: "Tab" });
            expect(onChoose).toHaveBeenCalledWith("region");
        });

        test("it opens on the option its host names, and says its label, its hint and its empty words", () => {
            host("units");
            expect(lit()).toBe("unitstext5 values");
            const root = document.querySelector("[data-chooser]")!;
            expect(root.querySelector("[data-chooser-label]")!.textContent).toBe("Field");
            expect(root.querySelector("[data-chooser-hint]")!.textContent).toBe("Fields from the checked type");
            cleanup();
            // A host with nothing to offer: its own words, in place of `no match`.
            render(<ChakraProvider value={system}>
                <Chooser sections={[]} placeholder="Type or pick a value" onChoose={vi.fn()} query="" onQuery={vi.fn()} empty="Type a value, then press ⏎." />
            </ChakraProvider>);
            expect(document.querySelector("[data-chooser]")!.textContent).toContain("Type a value, then press ⏎.");
        });

        test("an option leads with its icon and reads as words in the body face; bare, it draws no foot", () => {
            render(<ChakraProvider value={system}>
                <Chooser surface="bare" placeholder="Add a step" onChoose={vi.fn()} sections={[{ label: "Steps", options: [
                    { key: "filter", label: "Keep rows", line: "where a condition holds", icon: faFilter, state: "enabled", words: true },
                    { key: "K-1", label: "K-1", state: "enabled" },
                ] }]} />
            </ChakraProvider>);
            const [step, id] = screen.getAllByRole("option");
            expect([step!.hasAttribute("data-icon"), step!.querySelector("svg[data-icon=filter]") !== null, id!.hasAttribute("data-icon")]).toEqual([true, true, false]);
            expect([step!.querySelector("[data-words]") !== null, id!.querySelector("[data-words]")]).toEqual([true, null]);
            const root = document.querySelector("[data-chooser]")!;
            expect([root.getAttribute("data-surface"), root.textContent!.includes("Enter chooses")]).toEqual(["bare", false]);
        });

        test("drawn afresh while its search holds the focus — its host's key moves as its offers arrive — its search has the focus by the end of that commit: a key pressed next is its own", () => {
            const seen: string[] = [];
            /** What holds the focus as a commit's layout effects end, after the Chooser's own: where the next key pressed goes. */
            function Probe({ at }: { at: string }) {
                useLayoutEffect(() => { seen.push(`${at}: ${document.activeElement?.getAttribute("role") ?? "nothing"}`); }, [at]);
                return null;
            }
            /** A value slot's picker, the number typed held by its host: keyed by whether its offers have arrived, as the query builder keys it. */
            const draw = (generation: string) => (
                <ChakraProvider value={system}>
                    <Chooser key={generation} autoFocus sections={offers("100000")} placeholder="Type or pick a value" label="Value" onChoose={vi.fn()} query="100000" onQuery={vi.fn()} />
                    <Probe at={generation} />
                </ChakraProvider>
            );
            const { rerender } = render(draw("waiting"));
            rerender(draw("arrived"));
            // Each time its search — the combobox — holds the focus before anything else runs: never the page, between the two.
            expect(seen).toEqual(["waiting: combobox", "arrived: combobox"]);
            expect((document.activeElement as HTMLInputElement).value).toBe("100000");
        });

        test("a short list its host offers whole draws no search: its options alone, chosen by a click", () => {
            const onChoose = vi.fn();
            render(<ChakraProvider value={system}>
                <Chooser surface="bare" search={false} placeholder="Add a step" onChoose={onChoose} sections={[{ label: "Steps", options: [
                    { key: "filter", label: "Keep rows", state: "enabled", words: true },
                ] }]} />
            </ChakraProvider>);
            expect(screen.queryByRole("combobox")).toBeNull();
            fireEvent.click(screen.getByRole("option", { name: /Keep rows/ }));
            expect(onChoose).toHaveBeenCalledWith("filter");
        });
    });
});
