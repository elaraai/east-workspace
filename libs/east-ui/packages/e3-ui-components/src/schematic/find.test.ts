/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Find over every item kind's record (#1387, #1404, `find.ts`, §6.1): what
 * keeps an item found off the canvas, and how an item reads in Find's list —
 * the rail's filters that leave it out last, as every builder's line names
 * them: hidden by them, or dimmed by them where the narrowing draws what it
 * leaves out as context. The choices a line names once e3 has said are asked
 * of e3 itself, the racks' source of the rail narrowed to Harbour Labs' racks.
 * What a query finds, and the kinds' matches as one list, are every builder's
 * Search Records' (`shared/schedule/search-records.test.ts`); the box's lines,
 * and a pick of one, are `schematic-find.dom.test.tsx`'s and
 * `schematic-keys.dom.test.tsx`'s.
 */

import { describe, test, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { East, SortedMap, StringType, compareFor, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceWhereType, bindRecord, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { formatters, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { askHiding, hiddenOf, useSourceHidden, type RowHidden } from "../shared/schedule/hidden.js";
import { foundLine, foundMark, type FoundItem } from "./find.js";
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
