/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Plot-gutter cascade tests (#147): a lane component must inset its data lane to
 * `[left, W − right]` when a gutter is imposed —
 *   (1) directly from a `PlotGutterProvider` (the context an `<AlignedStack>`
 *       publishes), with the lane's own `plotGutter` winning over the context;
 *   (2) end-to-end through the real `EastChakraAlignedStack` renderer, proving it
 *       publishes its `fixed` gutter to the children it dispatches.
 *
 * The Calendar is the probe: its day band is the only element carrying an inline
 * `grid-template-columns`, and the gutter form switches the 7 day columns to
 * `minmax(0, 1fr)` framed by leading `left` / trailing `right` tracks — so the
 * raw style attribute is a faithful, layout-free assertion target under jsdom.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../theme/index.js";
import { PlotGutterProvider } from "./plot-gutter.js";
import { EastChakraCalendar, type CalendarValue } from "../collections/calendar/index.js";
import { EastChakraAlignedStack, type AlignedStackValue } from "../layout/aligned-stack/index.js";

afterEach(cleanup);

/** Minimal one-cell Calendar; `plotGutter` is its own (own-beats-context) gutter. */
function calendarValue(plotGutter: CalendarValue["plotGutter"] = none): CalendarValue {
    return {
        cells: [{ week: "W1", day: "Mon", value: 5, text: "5", compare: none, summary: none }],
        values: true,
        scale: none,
        domain: none,
        totals: none,
        aggregateRow: none,
        footer: none,
        actionLabel: none,
        onAction: none,
        onSelect: none,
        density: none,
        plotGutter,
        height: none,
        maxHeight: none,
    } as CalendarValue;
}

/** The day band is the lone element with an inline `grid-template-columns`. */
function bandStyle(container: HTMLElement): string {
    const grid = container.querySelector('[style*="grid-template-columns"]');
    expect(grid).not.toBeNull();
    return grid!.getAttribute("style")!;
}

const ui = (node: React.ReactElement) => render(<ChakraProvider value={system}>{node}</ChakraProvider>);

describe("plot-gutter cascade (#147)", () => {
    test("standalone: no imposed gutter, the band keeps its plain 7-column track", () => {
        const { container } = ui(<EastChakraCalendar value={calendarValue()} storageKey="c" />);
        const style = bandStyle(container);
        // Plain form: `<weekColW> repeat(7, minmax(<colDay>, 1fr))` — the
        // density day track, no imposed gutter (no `minmax(0, 1fr)`, no
        // trailing gutter column).
        expect(style).toMatch(/repeat\(7, minmax\(62px/);
        expect(style).not.toContain("minmax(0");
    });

    test("context: a PlotGutterProvider insets the band to [left, W − right]", () => {
        const { container } = ui(
            <PlotGutterProvider value={{ left: "120px", right: "16px" }}>
                <EastChakraCalendar value={calendarValue()} storageKey="c" />
            </PlotGutterProvider>,
        );
        const style = bandStyle(container);
        expect(style).toContain("grid-template-columns: 120px repeat(7, minmax(0, 1fr)) 16px");
    });

    test("own plotGutter wins over the inherited context (per-axis)", () => {
        const { container } = ui(
            <PlotGutterProvider value={{ left: "120px", right: "16px" }}>
                <EastChakraCalendar
                    value={calendarValue(some({ left: some("80px"), right: none }))}
                    storageKey="c"
                />
            </PlotGutterProvider>,
        );
        // Own `left` (80px) overrides the context's 120px; `right` is unset on the
        // own gutter, so it still falls back to the context's 16px.
        const style = bandStyle(container);
        expect(style).toContain("grid-template-columns: 80px repeat(7, minmax(0, 1fr)) 16px");
    });
});

/** An AlignedStack wrapping a single Calendar child, with a `fixed` gutter. */
function stackOverCalendar(): AlignedStackValue {
    return {
        children: [variant("Calendar", calendarValue())],
        style: some({ gap: some("8px"), width: none, height: none, minHeight: none, density: none }),
        gutter: some(variant("fixed", { left: some("120px"), right: some("16px") })),
    } as AlignedStackValue;
}

describe("AlignedStack publishes its gutter to children (#147)", () => {
    test("a Calendar dispatched inside the stack inherits the stack's fixed gutter", () => {
        const { container } = ui(<EastChakraAlignedStack value={stackOverCalendar()} storageKey="s" />);
        const style = bandStyle(container);
        expect(style).toContain("grid-template-columns: 120px repeat(7, minmax(0, 1fr)) 16px");
    });
});
