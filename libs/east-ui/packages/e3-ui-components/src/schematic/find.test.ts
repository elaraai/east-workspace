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
 * list, and the kinds' matches addressed as one list.
 */

import { describe, test, expect } from "vitest";
import { none } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { foundLine, foundMark, runsAt, wholeMatches, type FindKind, type FindRun, type FoundItem } from "./find.js";
import { schematicMessages, type SchematicWords } from "./messages.js";

const words: SchematicWords = { ...formatters("en-US"), m: schematicMessages };

/** An item found, by its kind's slot and name, its key and its label, where it stands and what keeps it off the canvas. */
const item = (key: string, label: string, over: Partial<FoundItem> = {}): FoundItem => ({
    id: `racks:${key}`, ref: { kind: "racks", key }, label, kind: "Rack", position: { x: 1, y: 2 }, layer: undefined, filtered: false, ...over,
});

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

    test("no position first, then the rail's filters — dimmed where the narrowing draws what it leaves out — then a hidden layer", () => {
        expect(foundMark(item("A06", "A06", { position: undefined, filtered: true }), false, hidden)).toBe("unplaced");
        expect(foundMark(item("A03", "A03", { filtered: true, layer: "cooling" }), false, hidden)).toBe("hidden");
        expect(foundMark(item("A03", "A03", { filtered: true }), true, hidden)).toBe("dimmed");
        expect(foundMark(item("A04", "A04", { layer: "cooling" }), false, hidden)).toBe("layer");
        expect(foundMark(item("A01", "A01", { layer: "power" }), false, hidden)).toBeUndefined();
    });
});

describe("foundLine", () => {
    test("an item reads as its key, its label where it is not its key, its kind's name, and what keeps it off the canvas", () => {
        expect(foundLine(item("A01", "A01"), undefined, words)).toBe("A01 · Rack");
        expect(foundLine(item("A07", "Rack 7"), "hidden", words)).toBe("A07 · Rack 7 · Rack · hidden");
        expect(foundLine(item("A07", "Rack 7"), "dimmed", words)).toBe("A07 · Rack 7 · Rack · dimmed");
        expect(foundLine(item("A04", "A04"), "layer", words)).toBe("A04 · Rack · on a hidden layer");
        expect(foundLine(item("A06", "A06"), "unplaced", words)).toBe("A06 · Rack · no position");
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
