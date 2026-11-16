/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * What a drop on the Plan would do (`candidate.ts`, #1541 U7): the one
 * candidate made of an event kind's gesture and of a gesture on a data
 * series' row, and the veto asked of it.
 */

import { describe, expect, test, vi } from "vitest";
import { equalFor, none, some, variant, type option } from "@elaraai/east";
import { PlanCandidateType } from "@elaraai/e3-ui/internal";
import { timeAt } from "../plan.test-utils.js";
import { rowKeyOf } from "../row-key.js";
import { entry } from "../row-id.test-utils.js";
import { movedCandidate } from "./use-carry.js";
import { createPlanVeto, eventCandidate, itemCandidate, type PlanCandidateGesture, type PlanCandidateValue } from "./candidate.js";
import type { PlanMovable } from "./store.js";

const sameCandidate = equalFor(PlanCandidateType);
const ADD = variant("add", { duplicate: false }) as PlanCandidateGesture;
const MOVE = variant("move", null) as PlanCandidateGesture;
const at = (day: string) => timeAt(`2026-10-${day}T00:00:00`);

describe("the candidate of an event kind's gesture", () => {
    test("a template landing: its kind, the resource's row and its times, on no event", () => {
        const row = entry("presses", "hall-a", "a1");
        const made = eventCandidate(ADD, "job", variant("template", "brochure"), { row, start: at("05"), end: at("06") });
        expect(sameCandidate(made, {
            gesture: ADD, into: variant("kind", "job"), from: variant("template", "brochure"), onto: none,
            row: some(row), lane: none, start: some(at("05")), end: some(at("06")),
        })).toBe(true);
    });

    test("an author's card landing on an event names the event; an event taken off the canvas lands on no row, at no time", () => {
        const card = eventCandidate(ADD, "job", variant("card", { library: "plan.tab.rush", key: "rush" }), { row: entry("presses", "a1") }, { kind: "job", key: "J-1" });
        expect(sameCandidate(card, {
            gesture: ADD, into: variant("kind", "job"), from: variant("card", { library: "plan.tab.rush", key: "rush" }),
            onto: some(variant("event", { kind: "job", key: "J-1" })), row: some(entry("presses", "a1")), lane: none, start: none, end: none,
        })).toBe(true);
        const off = eventCandidate(variant("remove", variant("source", null)) as PlanCandidateGesture, "job", variant("event", { kind: "job", key: "J-1" }));
        expect([off.row.type, off.lane.type, off.start.type, off.end.type, off.onto.type]).toEqual(["none", "none", "none", "none", "none"]);
        expect(off.gesture.type === "remove" ? off.gesture.value.type : "").toBe("source");
    });
});

describe("the candidate of a gesture on a data series' row", () => {
    test("a card landing: the row's series, the card, the bucket's start, and no end — its series makes the item as it lands", () => {
        const row = entry("press", "p03");
        const made = itemCandidate(variant("add", { duplicate: true }) as PlanCandidateGesture, "press", variant("card", { library: "palette", key: "job" }), { row, start: at("05") });
        expect(sameCandidate(made, {
            gesture: variant("add", { duplicate: true }), into: variant("series", "press"), from: variant("card", { library: "palette", key: "job" }),
            onto: none, row: some(row), lane: none, start: some(at("05")), end: none,
        })).toBe(true);
    });

    /** A run of Press 3's jobs, a day long, which moves and resizes. */
    const run = (rowKey: string): PlanMovable => ({
        key: "j1", rowKey, kind: "run", label: "J1", items: "Job", resize: true, span: { start: at("05"), end: at("06") },
    } as unknown as PlanMovable);

    test("an item moved across rows is a `move` into the row it lands on, named by the row it came from; one end moved, a `resize` by that end", () => {
        const from = entry("press", "p03");
        const to = entry("press", "p04");
        const fromKey = movedCandidate(run("from"), { rowKey: "nonsense", span: { start: at("07"), end: at("08") } });
        // A landing on a row whose key is no row id asks nothing.
        expect(fromKey).toBeUndefined();
        const moved = movedCandidate(run(rowKeyOf(from)), { rowKey: rowKeyOf(to), span: { start: at("07"), end: at("08") } })!;
        expect(sameCandidate(moved, {
            gesture: MOVE, into: variant("series", "press"), from: variant("item", { row: rowKeyOf(from), key: "j1" }), onto: none,
            row: some(to), lane: none, start: some(at("07")), end: some(at("08")),
        })).toBe(true);
        const resized = movedCandidate(run(rowKeyOf(from)), { rowKey: rowKeyOf(from), span: { start: at("05"), end: at("09") } })!;
        expect(resized.gesture.type === "resize" ? resized.gesture.value.type : "").toBe("end");
        expect(sameCandidate({ ...resized, gesture: MOVE }, {
            gesture: MOVE, into: variant("series", "press"), from: variant("item", { row: rowKeyOf(from), key: "j1" }), onto: none,
            row: some(from), lane: none, start: some(at("05")), end: some(at("09")),
        })).toBe(true);
    });
});

describe("the veto", () => {
    const candidate = (key: string): PlanCandidateValue => eventCandidate(ADD, "job", variant("template", key), { row: entry("presses", "a1") });

    test("no check, no veto: every drop the rows take lands", () => {
        expect(createPlanVeto(undefined)).toBeUndefined();
    });

    test("its refusal's words, or none; each candidate asked once while the check is the same function", () => {
        const asked: string[] = [];
        const veto = createPlanVeto((c): option<string> => {
            const key = c.from.type === "template" ? c.from.value : "";
            asked.push(key);
            return key === "poster" ? some("No posters this week") : none;
        })!;
        expect(veto.refusal(candidate("poster"))).toBe("No posters this week");
        expect(veto.refusal(candidate("brochure"))).toBeUndefined();
        // Asked again, by an equal candidate made anew: answered from what it said.
        expect(veto.refusal(candidate("poster"))).toBe("No posters this week");
        expect(veto.refusal(candidate("brochure"))).toBeUndefined();
        expect(asked).toEqual(["poster", "brochure"]);
    });

    test("a check that throws lets the drop land, and says so once", () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const veto = createPlanVeto(() => { throw new Error("broken"); })!;
            expect(veto.refusal(candidate("poster"))).toBeUndefined();
            expect(veto.refusal(candidate("poster"))).toBeUndefined();
            expect(logged).toHaveBeenCalledTimes(1);
        } finally {
            logged.mockRestore();
        }
    });
});
