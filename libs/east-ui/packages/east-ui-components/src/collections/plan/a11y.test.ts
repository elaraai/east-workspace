/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's words (#819): every element's accessible name carries what its
 * look encodes — a bar's state, a cell's value, a chart's shape — and a window
 * landing is announced as the elements it added. Every phrase is the message
 * table's and every number and date the locale's (#820).
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import {
    cellName, chartSummary, chipName, decisionName, heatValueText, landedText, markName, runName,
    segmentsText, stateText, tablePartsText, tileName, weightValueText, type PlanStateValue,
} from "./a11y.js";
import { planScale } from "./scale.js";
import type { PlanInstantValue } from "./instant.js";
import type { ChartKindValue } from "./rows/chart-geometry.js";
import { planMessages } from "./messages.js";
import { PLAN_WORDS as w, planWords } from "./words.js";

const t = (s: string): PlanInstantValue => variant("time", new Date(s)) as PlanInstantValue;
const window = { min: new Date("2026-06-29T00:00:00Z"), max: new Date("2026-09-21T00:00:00Z") };
const scale = planScale({ kind: "time", window, resolution: "week" })!;

describe("element names (#819)", () => {
    test("every lifecycle state has its words — the proposal flavours included", () => {
        const s = (tag: string, value: unknown = null) => variant(tag, value) as PlanStateValue;
        expect(stateText(s("estimated"), w)).toBe("estimated");
        expect(stateText(s("proposed", variant("added", null)), w)).toBe("proposed");
        expect(stateText(s("proposed", variant("recommended", null)), w)).toBe("recommended");
        expect(stateText(s("proposed", variant("removed", null)), w)).toBe("proposed removal");
        expect(stateText(s("confirmed"), w)).toBe("confirmed");
        expect(stateText(s("in-progress"), w)).toBe("in progress");
        expect(stateText(s("actual"), w)).toBe("actual");
        expect(stateText(s("rejected"), w)).toBe("rejected");
    });

    test("a run bar says its label, its span, its state — and what its look adds", () => {
        const run = {
            key: "b214", start: t("2026-06-29T00:00:00Z"), end: t("2026-07-27T00:00:00Z"), label: "B-214",
            quantity: some({ value: 96, unit: some("t"), format: none, text: none }), state: variant("actual", null),
            status: some(variant("warning", null)), moved: some(2n), icon: none,
        };
        expect(runName(run as never, scale, w)).toBe("B-214, Jun 29, 2026 – Jul 27, 2026, actual, 96 t, moved 2 times, warning");
        const plain = { ...run, quantity: none, status: none, moved: none, state: variant("confirmed", null) };
        expect(runName(plain as never, scale, w)).toBe("B-214, Jun 29, 2026 – Jul 27, 2026, confirmed");
    });

    test("a run's quantity says its caption — its text, else its value through its format, then its unit (#824)", () => {
        const at = (quantity: unknown) => runName({
            key: "r", start: t("2026-06-29T00:00:00Z"), end: t("2026-07-06T00:00:00Z"), label: "R",
            quantity: some(quantity), state: variant("confirmed", null), status: none, moved: none, icon: none,
        } as never, scale, w);
        const oneDp = variant("number", { minimumFractionDigits: some(1n), maximumFractionDigits: some(1n), signDisplay: none });
        expect(at({ value: 1234.25, unit: some("t"), format: some(oneDp), text: none })).toMatch(/, 1,234\.3 t$/u);
        expect(at({ value: 3, unit: none, format: none, text: none })).toMatch(/, 3$/u);
        // A caption override is what is said — the value still sums elsewhere.
        expect(at({ value: 24, unit: some("t"), format: none, text: some("−24 t") })).toMatch(/, −24 t$/u);
    });

    test("a decision diamond, a tile, a chip and a mark each name their instant and their meaning", () => {
        expect(decisionName({ key: "d", at: t("2026-07-13T00:00:00Z"), applied: true }, scale, w))
            .toBe("Decision, Jul 13, 2026, applied");
        const ev = {
            key: "e1", at: t("2026-07-06T00:00:00Z"), lane: some("am"), label: none, icon: none,
            state: variant("proposed", variant("added", null)), tone: some(variant("warning", null)),
            color: none, colorPalette: none, stretch: none, content: none, animation: none,
        };
        expect(tileName(ev as never, scale.buckets[1]!, "AM", scale, w)).toBe("Event, Week of Jul 6, 2026, AM, proposed, warning");
        expect(tileName({ ...ev, label: some("Pour"), tone: none } as never, scale.buckets[1]!, undefined, scale, w))
            .toBe("Pour, Week of Jul 6, 2026, proposed");
        expect(chipName({
            key: "c1", from: t("2026-06-29T00:00:00Z"), to: t("2026-07-13T00:00:00Z"), label: "D. OKAFOR",
            state: variant("confirmed", null), icon: none,
        } as never, scale, w)).toBe("D. OKAFOR, Jun 29, 2026 – Jul 13, 2026, confirmed");
        const mark = (kind: unknown, label?: string) => ({
            key: "k", at: t("2026-06-29T00:00:00Z"), kind, icon: none, label: label !== undefined ? some(label) : none,
        }) as never;
        expect(markName(mark(variant("milestone", null), "KICKOFF"), scale, w)).toBe("KICKOFF, milestone, Jun 29, 2026");
        expect(markName(mark(variant("decision", { applied: false })), scale, w)).toBe("Decision, pending, Jun 29, 2026");
        expect(markName(mark(variant("exception", null)), scale, w)).toBe("Exception, Jun 29, 2026");
    });

    test("a colour-only cell says its value: heat depth, booked weight, segment shares, table numerals", () => {
        expect(heatValueText(72, undefined, false, w)).toBe("72");
        expect(heatValueText(72, "72%", false, w)).toBe("72%");
        expect(heatValueText(91, undefined, true, w)).toBe("91, at or above the warning threshold");
        expect(heatValueText(1234.5, undefined, false, w)).toBe("1,234.5");
        expect(heatValueText(undefined, undefined, false, w)).toBe("no data");
        expect(weightValueText(0.6, false, w)).toBe("60% booked");
        expect(weightValueText(1.4, true, w)).toBe("100% booked, planned");
        // An arm's declared format is what a fraction is said in (#824).
        const oneDpPct = variant("percent", { minimumFractionDigits: some(1n), maximumFractionDigits: some(1n), signDisplay: none });
        expect(weightValueText(0.625, false, w, oneDpPct)).toBe("62.5% booked");
        expect(segmentsText([
            { fill: variant("brand", null), weight: 5, label: none },
            { fill: variant("slack", null), weight: 3, label: none },
        ] as never, w, oneDpPct)).toBe("booked 62.5%, slack 37.5%");
        expect(segmentsText([
            { fill: variant("brand", null), weight: 3, label: none },
            { fill: variant("slack", null), weight: 1, label: some("25 %") },
        ] as never, w)).toBe("booked 75%, slack 25 %");
        expect(segmentsText([], w)).toBe("no data");
        expect(tablePartsText(["1,204", "—"], w)).toBe("1,204, no value");
        expect(cellName(scale, scale.buckets[0]!, "72", w)).toBe("Week of Jun 29, 2026: 72");
    });
});

describe("chart summary (#819)", () => {
    const pts = (ys: number[]) => ys.map((y, i) => ({ t: t(new Date(Date.UTC(2026, 5, 29 + 7 * i)).toISOString()), y }));
    const kind = (layers: unknown[]): ChartKindValue => ({ layers, left: none, right: none } as unknown as ChartKindValue);

    test("each data layer's min, max and last inside the window — and its breaches, which only colour shows", () => {
        const line = variant("line", { points: pts([3, 7, 5]), axis: variant("left", null), breach: some(variant("above", 6)) });
        const cols = variant("column", { points: pts([2, 4]), axis: variant("left", null), series: none, breach: none });
        const ref = variant("refLine", { y: 5, axis: variant("left", null), label: some("TARGET") });
        expect(chartSummary(kind([line, cols, ref]), scale, w))
            .toBe("Chart: line min 3, max 7, last 5, 1 beyond threshold; columns min 2, max 4, last 4");
    });

    test("points outside the window and gaps are not summarised; two layers of a kind are numbered", () => {
        const before = { t: t("2026-06-01T00:00:00Z"), y: 99 };
        const a = variant("line", { points: [before, ...pts([1, NaN, 2])], axis: variant("left", null), breach: none });
        const b = variant("line", { points: [before], axis: variant("left", null), breach: none });
        const band = variant("band", {
            points: [{ t: t("2026-06-29T00:00:00Z"), lo: 1, hi: 4 }], axis: variant("left", null),
        });
        expect(chartSummary(kind([a, b, band]), scale, w))
            .toBe("Chart: line 1 min 1, max 2, last 2; line 2 no data in the window; range min 1, max 4, last 1–4");
        expect(chartSummary(kind([]), scale, w)).toBe("Chart: no data");
    });
});

describe("window landings (#819)", () => {
    test("say the elements that became resident — at either end, or a whole run on a rebase", () => {
        expect(landedText(undefined, { from: 0, to: 200 }, 5000, w)).toBe("Loaded elements 1–200 of 5,000");
        expect(landedText({ from: 0, to: 200 }, { from: 0, to: 400 }, 5000, w)).toBe("Loaded elements 201–400 of 5,000");
        expect(landedText({ from: 400, to: 800 }, { from: 200, to: 800 }, undefined, w)).toBe("Loaded elements 201–400");
        expect(landedText({ from: 0, to: 400 }, { from: 2000, to: 2200 }, 5000, w)).toBe("Loaded elements 2,001–2,200 of 5,000");
    });

    test("an eviction or an unmoved run says nothing", () => {
        expect(landedText({ from: 0, to: 600 }, { from: 200, to: 600 }, 5000, w)).toBeUndefined();
        expect(landedText({ from: 0, to: 600 }, { from: 0, to: 600 }, 5000, w)).toBeUndefined();
        expect(landedText({ from: 0, to: 600 }, undefined, 5000, w)).toBeUndefined();
    });
});

describe("the words a name is said in (#820)", () => {
    // German numbers and dates, and a table whose every message is marked, so
    // each phrase and each formatted part can be told apart in the result.
    const de = planWords("de-DE", planMessages);
    const deScale = planScale({ kind: "time", window, resolution: "week", words: de })!;

    test("numbers and dates are the locale's, the phrases the table's", () => {
        const run = {
            key: "b214", start: t("2026-06-29T00:00:00Z"), end: t("2026-07-27T00:00:00Z"), label: "B-214",
            quantity: none, state: variant("actual", null), status: none, moved: some(1200n), icon: none,
        };
        expect(runName(run as never, deScale, de)).toBe("B-214, 29. Juni 2026 – 27. Juli 2026, actual, moved 1.200 times");
        // A quantity's value is the locale's number too (#824).
        const heavy = { ...run, moved: none, quantity: some({ value: 1234.5, unit: some("t"), format: none, text: none }) };
        expect(runName(heavy as never, deScale, de)).toBe("B-214, 29. Juni 2026 – 27. Juli 2026, actual, 1.234,5 t");
        expect(heatValueText(1234.5, undefined, false, de)).toBe("1.234,5");
        expect(cellName(deScale, deScale.buckets[0]!, "72", de)).toBe("Week of 29. Juni 2026: 72");
        expect(landedText({ from: 0, to: 400 }, { from: 2000, to: 2200 }, 5000, de)).toBe("Loaded elements 2.001–2.200 of 5.000");
        expect(weightValueText(0.6, false, de)).toMatch(/^60\s%/u);
    });

    test("every phrase comes from the table — a stub table's mark leads each name", () => {
        const marked = Object.fromEntries(Object.entries(planMessages).map(([k, f]) =>
            [k, (p: never) => `⟦${(f as (p: never) => string)(p)}`])) as unknown as typeof planMessages;
        const stub = planWords("en-US", marked);
        const run = {
            key: "b214", start: t("2026-06-29T00:00:00Z"), end: t("2026-07-27T00:00:00Z"), label: "B-214",
            quantity: none, state: variant("confirmed", null), status: none, moved: none, icon: none,
        };
        expect(runName(run as never, scale, stub)).toMatch(/^⟦/u);
        expect(heatValueText(undefined, undefined, false, stub)).toBe("⟦no data");
        expect(segmentsText([], stub)).toBe("⟦no data");
        expect(chartSummary({ layers: [], left: none, right: none } as unknown as ChartKindValue, scale, stub)).toBe("⟦Chart: no data");
        expect(landedText(undefined, { from: 0, to: 200 }, 5000, stub)).toBe("⟦Loaded elements 1–200 of 5,000");
    });
});
