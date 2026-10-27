/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Find over every item kind's record (#1387, #1404, `find.ts`, §6.1): what a
 * query the shared key search's box parsed finds among a kind read whole's
 * keys — a key's start, a quoted key, a range, keys case-sensitive, in East's
 * order — what keeps an item found off the canvas, how an item reads in Find's
 * list — the rail's filters that leave it out last, as every builder's line
 * names them — and the kinds' matches addressed as one list. The choices a
 * line names once e3 has said are `schematic-find.dom.test.tsx`'s, on e3.
 */

import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { none } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { useSourceHidden, type RowHidden } from "../shared/schedule/hidden.js";
import { foundLine, foundMark, runsAt, wholeMatches, type FindKind, type FindRun, type FoundItem } from "./find.js";
import { schematicMessages, type SchematicWords } from "./messages.js";

const words: SchematicWords = { ...formatters("en-US"), m: schematicMessages };

/** An item found, by its kind's slot and name, its key and its label, where it stands and what keeps it off the canvas. */
const item = (key: string, label: string, over: Partial<FoundItem> = {}): FoundItem => ({
    id: `racks:${key}`, ref: { kind: "racks", key }, label, kind: "Rack", position: { x: 1, y: 2 }, layer: undefined, hidden: undefined, ...over,
});

/** What leaves an item out on the rail before e3 has said which choices do: its kind's hidden pick, which has been told nothing. */
function unsaid(key: string): readonly RowHidden[] {
    const { result } = renderHook(() => useSourceHidden("Schematic", undefined));
    return [{ pick: result.current, id: key, answer: undefined }];
}

describe("wholeMatches", () => {
    const keys = ["A03", "A01", "B02", "A02", "a04"];

    test("a key's start finds the keys it starts, in East's order — keys are case-sensitive", () => {
        expect(wholeMatches(keys, { prefix: "A0" })).toEqual(["A01", "A02", "A03"]);
        expect(wholeMatches(keys, { prefix: "a0" })).toEqual(["a04"]);
        expect(wholeMatches(keys, { prefix: "C" })).toEqual([]);
    });

    test("an empty box finds every key, in order", () => {
        expect(wholeMatches(keys, { prefix: "" })).toEqual(["A01", "A02", "A03", "B02", "a04"]);
    });

    test("a quoted key finds that key alone; text that is no key's literal finds none", () => {
        expect(wholeMatches(keys, { key: "\"A02\"" })).toEqual(["A02"]);
        expect(wholeMatches(keys, { key: "\"A09\"" })).toEqual([]);
        expect(wholeMatches(keys, { key: "A02" })).toEqual([]);
    });

    test("a range finds the keys from its start, up to its end", () => {
        expect(wholeMatches(keys, { from: ["\"A02\""], to: ["\"B\""] })).toEqual(["A02", "A03"]);
        expect(wholeMatches(keys, { from: ["\"B\""] })).toEqual(["B02", "a04"]);
    });
});

describe("foundMark", () => {
    const hidden = new Set(["cooling"]);

    test("no position first, then a hidden layer — the rail's filters are no mark of theirs: the line names their choices, and a pick clears them", () => {
        expect(foundMark(item("A06", "A06", { position: undefined, layer: "cooling" }), hidden)).toBe("unplaced");
        expect(foundMark(item("A04", "A04", { layer: "cooling" }), hidden)).toBe("layer");
        expect(foundMark(item("A01", "A01", { layer: "power" }), hidden)).toBeUndefined();
        expect(foundMark(item("A03", "A03", { hidden: unsaid("A03") }), hidden)).toBeUndefined();
        expect(foundMark(item("A05", "A05", { hidden: unsaid("A05"), layer: "cooling" }), hidden)).toBe("layer");
    });
});

describe("foundLine", () => {
    test("an item reads as its key, its label where it is not its key, its kind's name, what keeps it off the canvas and, last, the filters that leave it out", () => {
        expect(foundLine(item("A01", "A01"), undefined, words)).toBe("A01 · Rack");
        expect(foundLine(item("A04", "A04"), "layer", words)).toBe("A04 · Rack · on a hidden layer");
        expect(foundLine(item("A06", "A06"), "unplaced", words)).toBe("A06 · Rack · no position");
        // Until e3 has said which choices leave it out, the filters do — as every builder's line says.
        expect(foundLine(item("A07", "Rack 7", { hidden: unsaid("A07") }), undefined, words)).toBe("A07 · Rack 7 · Rack · hidden by the filters");
        expect(foundLine(item("A05", "A05", { hidden: unsaid("A05") }), "layer", words)).toBe("A05 · Rack · on a hidden layer · hidden by the filters");
    });
});

describe("runsAt", () => {
    /** A kind, as a run names it: only its slot is read here. */
    const kind = (slot: string): FindKind => ({
        slot, name: slot, part: undefined, rows: () => none, read: () => { throw new Error("unread"); }, codec: { encode: () => new Uint8Array(), decode: () => null },
    });
    const runs: FindRun[] = [
        { kind: kind("racks"), start: 40, count: 3, keys: undefined },
        { kind: kind("network"), start: 0, count: 0, keys: [] },
        { kind: kind("cooling"), start: 0, count: 2, keys: ["A01", "A02"] },
    ];
    const at = (row: number, limit: number) => runsAt(runs, row, limit).map(({ run, offset, n, at: row0 }) => `${run.kind.slot} ${offset}+${n}@${row0}`);

    test("each kind's matches follow the one before's, a kind with none taking no row", () => {
        expect(at(0, 20)).toEqual(["racks 0+3@0", "cooling 0+2@3"]);
        expect(at(2, 2)).toEqual(["racks 2+1@2", "cooling 0+1@3"]);
        expect(at(4, 1)).toEqual(["cooling 1+1@4"]);
        expect(at(5, 3)).toEqual([]);
    });
});
