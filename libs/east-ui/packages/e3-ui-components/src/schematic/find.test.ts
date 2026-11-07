/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Find over every item kind's record (#1387, #1404, `find.ts`, §6.1): what a
 * query the shared key search's box parsed finds among a kind read whole's
 * keys — a key's start, a quoted key, a range, keys case-sensitive, in East's
 * order at the kind's key type, and as one kind keyed otherwise than the box
 * parses reads the text typed (#1549) — what keeps an item found off the
 * canvas, how an item reads in Find's list — the rail's filters that leave it
 * out last, as every builder's line names them: hidden by them, or dimmed by
 * them where the narrowing draws what it leaves out as context — and the
 * kinds' matches addressed as one list. The choices a line names once e3 has
 * said are asked of e3 itself, the racks' source of the rail narrowed to
 * Harbour Labs' racks; the box's lines, and a pick of one, are
 * `schematic-find.dom.test.tsx`'s and `schematic-keys.dom.test.tsx`'s.
 */

import { describe, test, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { East, IntegerType, SortedMap, StringType, StructType, compareFor, none, printFor, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceWhereType, bindRecord, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { formatters, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { askHiding, hiddenOf, useSourceHidden, type RowHidden } from "../shared/schedule/hidden.js";
import { STRING_KEYS, kindKeys } from "../shared/schedule/kind-keys.js";
import { foundLine, foundMark, kindQuery, runsAt, wholeMatches, type FindKind, type FindRun, type FoundItem } from "./find.js";
import { schematicMessages, type SchematicWords } from "./messages.js";

const h = e3Harness({ "schematic/schematic": ex }, { measure: false });

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

type Bind = ValueTypeOf<RecordSliceBindType>;
type Where = ValueTypeOf<typeof RecordSliceWhereType>;

/** The racks as Find seeks them: through their source of the rail, by owner. */
const racksProgram = East.function([], undefined, ($) => {
    const racks = $.let(Data.bindPaged(ex.schematicRacks, { indexes: ["schematic_racks_by_owner"] }));
    return bindRecord("find.racks", racks, { fields: { owner: { label: "Owner" } } });
});

/** Harbour Labs' racks: A01 and A02 — never Northwind Media's A03. */
const HARBOUR: Where = new SortedMap([["owner", variant("values", [printFor(StringType)("Harbour Labs")])]], compareFor(StringType));

/**
 * What leaves A03 out once e3 has said: the racks' source of the rail narrowed to Harbour Labs' racks, as the rail
 * narrows it, and e3 asked which of its choices hide A03, as Find asks of a row its list shows (the shared hidden pick).
 *
 * @returns The source that leaves A03 out, with what e3 said leaves it out there
 */
async function saidOfA03(): Promise<readonly RowHidden[]> {
    await h.install({ fn: racksProgram });
    const part = East.compile(racksProgram, getRegisteredPlatformImplementations())() as unknown as Bind;
    await act(async () => { part.write({ ...part.read(), where: HARBOUR, preset: none }); });
    await settle();
    const { result } = renderHook(() => useSourceHidden("Schematic", part));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { askHiding([{ pick: result.current, id: "A03" }], true); });
    await settle();
    await waitFor(() => expect(hiddenOf([{ pick: result.current, id: "A03" }])?.[0]?.answer).toBeDefined());
    return hiddenOf([{ pick: result.current, id: "A03" }])!;
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

    test("a kind keyed by another type is sought at it, its keys in their order there — never their texts' (#1549)", () => {
        const ovens = kindKeys(toEastTypeValue(IntegerType));
        const held = ["10", "2", "9"];
        expect(wholeMatches(held, { key: "10" }, ovens)).toEqual(["10"]);
        expect(wholeMatches(held, { from: ["2"] }, ovens)).toEqual(["2", "9", "10"]);
        expect(wholeMatches(held, { from: ["2"], to: ["10"] }, ovens)).toEqual(["2", "9"]);
        // A key's start is a String key's: it finds no number.
        expect(wholeMatches(held, { prefix: "1" }, ovens)).toEqual([]);
    });
});

describe("kindQuery", () => {
    const atString = STRING_KEYS.keyType;
    const ovens = kindKeys(toEastTypeValue(IntegerType));
    const spots = kindKeys(toEastTypeValue(StructType({ row: IntegerType, col: StringType })));

    test("a kind keyed as the box parses is sought by the query as it parsed", () => {
        expect(kindQuery({ prefix: "M" }, atString, STRING_KEYS)).toEqual({ prefix: "M" });
        expect(kindQuery({ key: "10" }, ovens.keyType, ovens)).toEqual({ key: "10" });
    });

    test("the box at String over kinds keyed by several types: a kind keyed otherwise reads the text as typed, at its own type", () => {
        expect(kindQuery({ prefix: "10" }, atString, ovens)).toEqual({ key: "10" });
        expect(kindQuery({ from: ["\"2\""], to: ["\"9\""] }, atString, ovens)).toEqual({ from: ["2"], to: ["9"] });
        expect(kindQuery({ prefix: "1, M" }, atString, spots)).toEqual({ fields: ["1"], prefix: "M" });
        // Text that is no key of the kind's — a name, the empty box, a quoted String — finds none of its rows.
        expect(kindQuery({ prefix: "M1" }, atString, ovens)).toBeUndefined();
        expect(kindQuery({ prefix: "" }, atString, ovens)).toBeUndefined();
        expect(kindQuery({ key: "\"10\"" }, atString, ovens)).toBeUndefined();
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
        expect(foundLine(item("A01", "A01"), undefined, words, false)).toBe("A01 · Rack");
        expect(foundLine(item("A04", "A04"), "layer", words, false)).toBe("A04 · Rack · on a hidden layer");
        expect(foundLine(item("A06", "A06"), "unplaced", words, false)).toBe("A06 · Rack · no position");
        // Until e3 has said which choices leave it out, the filters do — as every builder's line says.
        expect(foundLine(item("A07", "Rack 7", { hidden: unsaid("A07") }), undefined, words, false)).toBe("A07 · Rack 7 · Rack · hidden by the filters");
        expect(foundLine(item("A05", "A05", { hidden: unsaid("A05") }), "layer", words, false)).toBe("A05 · Rack · on a hidden layer · hidden by the filters");
    });

    test("under a narrowing that draws what it leaves out as context, the filters dim an item they leave out, never hide it — until e3 has said which, the filters do", () => {
        expect(foundLine(item("A07", "Rack 7", { hidden: unsaid("A07") }), undefined, words, true)).toBe("A07 · Rack 7 · Rack · dimmed by the filters");
        expect(foundLine(item("A05", "A05", { hidden: unsaid("A05") }), "layer", words, true)).toBe("A05 · Rack · on a hidden layer · dimmed by the filters");
        // An item the filters keep reads as it does under a narrowing that hides: nothing dims it.
        expect(foundLine(item("A01", "A01"), undefined, words, true)).toBe("A01 · Rack");
        expect(foundLine(item("A06", "A06"), "unplaced", words, true)).toBe("A06 · Rack · no position");
    });

    test("once e3 has said, the line names the choices that leave the item out as the rail words them: hidden by them — or dimmed by them, where the narrowing draws it as context", async () => {
        const a03 = item("A03", "A03", { hidden: await saidOfA03() });
        expect(foundLine(a03, undefined, words, false)).toBe("A03 · Rack · hidden by Owner: Harbour Labs — picking it clears that filter");
        expect(foundLine(a03, undefined, words, true)).toBe("A03 · Rack · dimmed by Owner: Harbour Labs — picking it clears that filter");
    });
});

describe("runsAt", () => {
    /** A kind, as a run names it: only its slot is read here. */
    const kind = (slot: string): FindKind => ({
        slot, name: slot, part: undefined, rows: () => none, read: () => { throw new Error("unread"); }, codec: { encode: () => new Uint8Array(), decode: () => null },
        keys: STRING_KEYS,
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
