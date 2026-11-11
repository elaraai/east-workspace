/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry, which needs one as it loads.
 *
 * What the local layer adds to a count of the source's rows and takes off it (#1536): every new row and every row a
 * draft removes — but a Save's, only over a count read at the revision it was drafted at, which holds nothing of it.
 * A count read since holds the Save's rows already, and counting them again made a host's count run over by the rows
 * saved until their source read them again.
 */

import { describe, test, expect } from "vitest";
import { none } from "@elaraai/east";
import { layerCounts } from "./local-rows.js";
import type { LocalLayer } from "./use-editing.js";
import type { SheetRowValue } from "./values.js";

const row = (id: string): SheetRowValue => ({ id, owned: false, cells: new Map(), lines: [], band: none, subRows: [], entry: none });

/** A new row still drafted, one a Save added; a row a draft removes, one a Save removed. */
const layer: LocalLayer = {
    edits: new Map(),
    appended: [row("drafted-new"), row("saved-new")],
    removed: new Set(["drafted-gone", "saved-gone"]),
    placements: new Map(),
};
const savedFrom: ReadonlyMap<string, string> = new Map([["saved-new", "r0"], ["saved-gone", "r0"]]);

describe("layerCounts", () => {
    test("over a count read at the revision the Save was drafted at, its rows count with the drafts", () => {
        expect(layerCounts(layer, savedFrom, "r0")).toEqual({ added: 2, removed: 2 });
    });

    test("over a count read at the revision it committed, its rows are the count's already: only the drafts count", () => {
        expect(layerCounts(layer, savedFrom, "r1")).toEqual({ added: 1, removed: 1 });
    });

    test("over a count whose revision is not known, every row counts", () => {
        expect(layerCounts(layer, savedFrom, undefined)).toEqual({ added: 2, removed: 2 });
    });

    test("a narrowing's count takes off only a removed row among the rows it is of", () => {
        const among = [row("kept"), row("saved-gone")];
        expect(layerCounts(layer, savedFrom, "r0", among)).toEqual({ added: 2, removed: 1 });
        expect(layerCounts(layer, savedFrom, "r1", among)).toEqual({ added: 1, removed: 0 });
    });
});
