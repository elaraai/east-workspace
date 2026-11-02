/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * How a table cell's typed text reads (#1438): through its position's format —
 * a percent's `82` or `82%` is `0.82`, and `0.07` opens as `7` — in the
 * viewer's language, through the Sheet's grammar; and the resolution a cell
 * folding several values names, from the least gap between them.
 */

import { describe, it, expect } from "vitest";
import { East } from "@elaraai/east";
import { Format, TickFormatType } from "@elaraai/east-ui/internal";
import { formatters } from "@elaraai/east-ui-components";
import { PlanTypingStore, planZooms, readTyped, resolutionOfValues, typedText, typesAt, zoomApart } from "./typing.js";

/** A percent, as a position's format decodes. */
const PERCENT = East.compile(East.function([], TickFormatType, () => Format.Percent()), [])();
const en = formatters("en-US");
const de = formatters("de-DE");

describe("a table cell's typed text (#1438)", () => {
    it("reads through a percent: 82 and 82% write 0.82, and a value opens as the cell prints it", () => {
        expect([readTyped("82", PERCENT, en), readTyped("82%", PERCENT, en), readTyped("82 %", PERCENT, de)]).toEqual([0.82, 0.82, 0.82]);
        expect([typedText(0.82, PERCENT, en), typedText(0.07, PERCENT, en), typedText(0.125, PERCENT, de)]).toEqual(["82", "7", "12,5"]);
    });

    it("reads a number in the viewer's language, its digit groups and a k or an m as the Sheet's grammar reads them", () => {
        expect([readTyped("1,234.5", undefined, en), readTyped("1.234,5", undefined, de), readTyped("2k", undefined, en)]).toEqual([1234.5, 1234.5, 2000]);
        expect([typedText(1234.5, undefined, en), typedText(1234.5, undefined, de), typedText(undefined, undefined, en)]).toEqual(["1234.5", "1234,5", ""]);
    });

    it("reads no text as the cell cleared, and text that is no number as refused", () => {
        expect(readTyped("", undefined, en)).toBeUndefined();
        expect(readTyped("twelve", undefined, en)).toBeNull();
    });

    it("names the resolution a folded cell's values are at, by the least gap between them", () => {
        const DAY = 86_400_000;
        const from = Date.UTC(2026, 0, 5);
        const every = (step: number, n = 4) => Array.from({ length: n }, (_, i) => from + i * step);
        expect([every(DAY), every(7 * DAY), every(31 * DAY), every(91 * DAY), every(365 * DAY)].map(resolutionOfValues))
            .toEqual(["day", "week", "month", "quarter", "year"]);
        expect(resolutionOfValues([from])).toBeUndefined();
    });
});

describe("the zooms a table cell's typing reads (#1438)", () => {
    it("are the resolution segment's and the one the axis opens at, the finest first, auto none of them", () => {
        expect(planZooms(["month", "week", "year"], "week")).toEqual(["week", "month", "year"]);
        expect(planZooms([], "month")).toEqual(["month"]);
        expect(planZooms(["quarter"], "auto")).toEqual(["quarter"]);
        expect(planZooms([], undefined)).toEqual([]);
    });

    it("let a cell take a number at the finest zoom alone: a coarser one is a summary of the values beneath it", () => {
        expect(typesAt("week", ["week", "month"])).toBe(true);
        expect(typesAt("month", ["week", "month"])).toBe(false);
        expect(typesAt(undefined, ["week"])).toBe(true);
        expect(typesAt("month", [])).toBe(true);
    });

    it("land a zoom from a coarser cell on the row it came from, once that row draws at the zoom, and once", () => {
        const store = new PlanTypingStore();
        store.focusOnZoom({ rowKey: "ledger", at: 1_000, resolution: "week" });
        expect(store.takeFocus("other", "week")).toBeUndefined();
        expect(store.takeFocus("ledger", "month")).toBeUndefined();
        expect(store.takeFocus("ledger", "week")).toBe(1_000);
        expect(store.takeFocus("ledger", "week")).toBeUndefined();
    });

    it("show values apart at the coarsest zoom no coarser than they are, and name no zoom the Plan lacks", () => {
        expect(zoomApart("week", ["week", "month", "quarter"])).toBe("week");
        expect(zoomApart("month", ["week", "quarter"])).toBe("week");
        expect(zoomApart("day", ["week", "month"])).toBeUndefined();
        expect(zoomApart(undefined, ["week"])).toBeUndefined();
    });
});
