/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Pure; the flowchart's modules load east-ui-components' entry, which needs a
 * DOM as it loads.
 */

/**
 * The details' words and axes (#1510, `Flowchart Records Spec.md` R28, R29,
 * R36, R41): durations from each unit, a bin's words, a histogram's caption, a
 * share under one percent, and the ticks an axis draws at a card's width, the
 * pane's and a phone's — on both scales, from the app's ticks and without
 * them — as the visual spec lays them out.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { formatters } from "@elaraai/east-ui-components";
import type { FlowchartBins } from "./details.js";
import { CARD_TICK_CHAR, PANE_TICK_CHAR, axisTicks, binText, durationOf, durationText, marksText, shareText, type FlowchartTick } from "./details-words.js";
import { flowchartMessages, type FlowchartWords } from "./messages.js";
import { words } from "./rows.test-utils.js";

/** The depot's bins, in hours: a quarter hour apiece at first, then hours, days and a week (`Flowchart Records Spec.md` §2). */
const DEPOT = [0, 0.25, 0.5, 1, 2, 4, 8, 12, 24, 48, 96, 168];
/** The depot's ticks: 1h, 12h, 2d and 1w. */
const DEPOT_TICKS = [1, 12, 48, 168].map((at) => ({ at, label: undefined }));
/** A card's axis, the pane's, and a phone's pane's, in px. */
const CARD_W = 246;
const PANE_W = 288;
const PHONE_W = 200;

const band: FlowchartBins = { edges: DEPOT, scale: "band" };
const linear: FlowchartBins = { edges: DEPOT, scale: "linear" };

/** What each tick says, and where it starts, to a tenth of a px. */
const placed = (ticks: readonly FlowchartTick[]) => ticks.map((tick) => [tick.text, Math.round(tick.x * 10) / 10]);

/** No tick on another, none past the axis: each 6 clear of the one before it, and inside the width. */
function clear(ticks: readonly FlowchartTick[], width: number): void {
    ticks.forEach((tick, i) => {
        expect(tick.x).toBeGreaterThanOrEqual(0);
        expect(tick.x + tick.w).toBeLessThanOrEqual(width + 1e-9);
        if (i > 0) expect(tick.x).toBeGreaterThanOrEqual(ticks[i - 1]!.x + ticks[i - 1]!.w + 6 - 1e-9);
    });
}

describe("durations (R41)", () => {
    test("each step from the unit: 0 alone, minutes, hours, days and whole weeks", () => {
        expect(DEPOT.map((h) => durationText(h, "hours", words))).toEqual(["0", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "2d", "4d", "1w"]);
        expect([0, 1, 5, 90, 480, 1440, 2880, 10080, 20160].map((m) => durationText(m, "minutes", words)))
            .toEqual(["0", "1m", "5m", "1.5h", "8h", "1d", "2d", "1w", "2w"]);
        expect([0.5, 1, 3, 7, 10, 14].map((d) => durationText(d, "days", words))).toEqual(["12h", "1d", "3d", "1w", "10d", "2w"]);
    });

    test("the number in the app's locale", () => {
        const german: FlowchartWords = { ...formatters("de-DE"), m: flowchartMessages };
        expect(durationText(1.5, "hours", german)).toBe("1,5h");
        expect(durationOf(36, "hours")).toEqual({ step: "days", n: 1.5 });
        expect(durationText(36, "hours", words)).toBe("1.5d");
    });
});

describe("a bin's words, and a histogram's caption (R36, R41)", () => {
    test("a bin by its edges, the last open", () => {
        expect(binText(DEPOT, 5, "hours", words)).toBe("4h – 8h");
        expect(binText(DEPOT, 0, "hours", words)).toBe("0 – 15m");
        expect(binText(DEPOT, 11, "hours", words)).toBe("1w or more");
    });

    test("half and nine in ten: within the end of the bin each reaches", () => {
        // Half reach the 2h – 4h bin's end, nine in ten the 1d – 2d bin's.
        const counts = [10, 10, 10, 10, 10, 20, 10, 8, 7, 4, 1, 0];
        expect(marksText(DEPOT, counts, "hours", words)).toBe("Half within 4h · nine in ten within 2d");
    });

    test("over the last edge where the counts reach the open bin", () => {
        const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 9];
        expect(marksText(DEPOT, counts, "hours", words)).toBe("Half over 1w · nine in ten over 1w");
    });

    test("nothing counted: no caption", () => {
        expect(marksText(DEPOT, DEPOT.map(() => 0), "hours", words)).toBeUndefined();
        expect(marksText([], [], "hours", words)).toBeUndefined();
    });
});

describe("shares (R29, R41)", () => {
    test("a whole percent; under one percent but above nothing, <1%", () => {
        expect(shareText(0.46, words)).toBe("46%");
        expect(shareText(0.004, words)).toBe("<1%");
        expect(shareText(0, words)).toBe("0%");
        expect(shareText(1, words)).toBe("100%");
    });
});

describe("the axis's ticks (R28)", () => {
    test("on a card's band axis: the first edge and every tick the app lists, the last edge's open", () => {
        const ticks = axisTicks(band, "hours", DEPOT_TICKS, CARD_W, CARD_TICK_CHAR, words);
        // The visual spec's: 0 at the start; each tick a px in from its edge's place, a bin each 20.5 across.
        expect(placed(ticks)).toEqual([["0", 0], ["1h", 62.5], ["12h", 144.5], ["2d", 185.5], ["1w+", 226.5]]);
        clear(ticks, CARD_W);
    });

    test("in the pane, on a band and a linear axis", () => {
        expect(placed(axisTicks(band, "hours", DEPOT_TICKS, PANE_W, PANE_TICK_CHAR, words)))
            .toEqual([["0", 0], ["1h", 73], ["12h", 169], ["2d", 217], ["1w+", 265]]);
        const ticks = axisTicks(linear, "hours", DEPOT_TICKS, PANE_W, PANE_TICK_CHAR, words);
        // To scale, the hours crowd the start: 1h, 2.2 in, is too close to 0 and left out; 12h, 2d and 1w stand clear.
        expect(placed(ticks)).toEqual([["0", 0], ["12h", 15.4], ["2d", 58.6], ["1w+", 202.6]]);
        clear(ticks, PANE_W);
    });

    test("a tick that would pass the end ends there; one too close to the next is left out", () => {
        // A phone's pane: the last tick's words would pass the end, and end there; every tick still clear.
        const phone = axisTicks(band, "hours", DEPOT_TICKS, PHONE_W, PANE_TICK_CHAR, words);
        expect(placed(phone)).toEqual([["0", 0], ["1h", 51], ["12h", 117.7], ["2d", 151], ["1w+", 182]]);
        clear(phone, PHONE_W);
        // Narrower still: 2d would crowd 12h, and is left out — the last kept, as it clears the first.
        const narrow = axisTicks(band, "hours", DEPOT_TICKS, 120, PANE_TICK_CHAR, words);
        expect(placed(narrow)).toEqual([["0", 0], ["1h", 31], ["12h", 71], ["1w+", 102]]);
        clear(narrow, 120);
        // The app's own words at the last edge, past the end at once: they end there.
        const past = axisTicks(band, "hours", [{ at: 168, label: "a week" }], 60, PANE_TICK_CHAR, words);
        expect(placed(past)).toEqual([["0", 0], ["a week", 24]]);
        // Each that ends there is drawn from the end, whatever its words measure — a browser that rounds a
        // character to a whole pixel draws them wider than the estimate — and every other from its start.
        expect([phone, narrow, past].map((ticks) => ticks.map((tick) => [tick.text, tick.end]))).toEqual([
            [["0", false], ["1h", false], ["12h", false], ["2d", false], ["1w+", true]],
            [["0", false], ["1h", false], ["12h", false], ["1w+", true]],
            [["0", false], ["a week", true]],
        ]);
    });

    test("the last only where it meets the first: never the first left out", () => {
        const ticks = axisTicks(band, "hours", [{ at: 0.25, label: undefined }], CARD_W, CARD_TICK_CHAR, words);
        // 15m starts 21.5 in, 15.8 clear of 0's 5.7: shown.
        expect(placed(ticks)).toEqual([["0", 0], ["15m", 21.5]]);
        const crowded = axisTicks(band, "hours", [{ at: 0.25, label: "a quarter hour" }], 60, CARD_TICK_CHAR, words);
        expect(placed(crowded)).toEqual([["0", 0]]);
    });

    test("the app's own words, as given — and left out, as any tick is, where they crowd the last", () => {
        const bins: FlowchartBins = { edges: [0, 1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440], scale: "band" };
        const listed = [{ at: 5, label: undefined }, { at: 60, label: undefined }, { at: 480, label: "a shift" }, { at: 1440, label: "a day" }];
        // On a card the last two stand in neighbouring bins, 20.5 apart: a shift's words would crowd a day's.
        const card = axisTicks(bins, "minutes", listed, CARD_W, CARD_TICK_CHAR, words);
        expect(placed(card)).toEqual([["0", 0], ["5m", 62.5], ["1h", 144.5], ["a day", 217.5]]);
        clear(card, CARD_W);
        // With room for both, both show.
        const wide = axisTicks(bins, "minutes", listed, 600, CARD_TICK_CHAR, words);
        expect(wide.map((tick) => tick.text)).toEqual(["0", "5m", "1h", "a shift", "a day"]);
        clear(wide, 600);
    });

    test("without the app's ticks: round durations it has room for", () => {
        const ticks = axisTicks(band, "hours", undefined, CARD_W, CARD_TICK_CHAR, words);
        expect(ticks[0]!.text).toBe("0");
        expect(ticks[ticks.length - 1]!.text).toBe("1w+");
        expect(ticks.length).toBeGreaterThan(3);
        clear(ticks, CARD_W);
        // Every one a round duration, on its bin's edge or as far across its bin as it is across its span.
        for (const tick of ticks.slice(1, -1)) expect(["15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "2d", "4d"]).toContain(tick.text);
    });

    test("no edges: no ticks", () => {
        expect(axisTicks({ edges: [], scale: "band" }, "hours", DEPOT_TICKS, CARD_W, CARD_TICK_CHAR, words)).toEqual([]);
    });
});
