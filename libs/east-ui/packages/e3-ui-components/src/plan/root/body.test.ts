/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * Where the canvas says the view stands in each block it shows beside the one
 * under its center (#1710): rows beside a group at the Plan's top are two
 * blocks over the same windows, both on screen, and each block's demand
 * follows its own rows in view. The driver's side — each block's demand moved,
 * the windows it shows read — is the Plan's DOM tests' (`plan-grouped-examples`).
 */

import { describe, test, expect } from "vitest";
import type { PlanBodyItem } from "../model.js";
import { besideAnchors } from "./body.js";

/** A row of a block, by its key: what the anchors read of it. */
const row = (block: number, key: string): PlanBodyItem => ({ kind: "row", row: { row: { block, key } } }) as never;
/** A band of a block's unloaded windows, at its head or its tail, so many pixels tall. */
const band = (block: number, at: "head" | "tail", px: number): PlanBodyItem => ({ kind: "band", band: { block, at, px, from: 0, to: 0 } }) as never;
/** A failed window of a block. */
const failed = (block: number, w: number): PlanBodyItem => ({ kind: "failed", failure: { block, w, px: 40 } }) as never;
/** A links focus's band: it names no block. */
const focus: PlanBodyItem = { kind: "focus", band: { role: "others" } } as never;

describe("where the view stands in each other block it shows (#1710)", () => {
    test("the halls as rows above the halls as groups, the center in the groups: the rows' block stands at its row nearest the center", () => {
        // Block 0: six halls not read yet, then halls 7 and 8; block 1: the first hall's group and its rows.
        const items = [band(0, "head", 192), row(0, "H-107"), row(0, "H-108"), row(1, "g-101"), row(1, "f-101-1"), row(1, "f-101-2"), row(1, "b-101-1")];
        expect(besideAnchors(items, { startIndex: 0, endIndex: 6 }, 5)).toEqual([{ kind: "row", key: "H-108" }]);
        // The center in the rows' block: the groups' block stands at its row nearest it.
        expect(besideAnchors(items, { startIndex: 0, endIndex: 6 }, 1)).toEqual([{ kind: "row", key: "g-101" }]);
    });

    test("a block whose nearest item is a band stands at the band's edge nearest the center: its bottom above, its top below", () => {
        // Block 0 only a band above the center; block 2 only a band below it.
        const items = [band(0, "tail", 320), row(1, "a"), row(1, "b"), row(1, "c"), band(2, "head", 640)];
        expect(besideAnchors(items, { startIndex: 0, endIndex: 4 }, 2)).toEqual([
            { kind: "band", block: 0, at: "tail", px: 319 },
            { kind: "band", block: 2, at: "head", px: 0 },
        ]);
    });

    test("a failed window names its own window; the center's own block, a links focus's band, and anything outside the mounted range stand nowhere", () => {
        const items = [row(0, "far"), failed(0, 3), focus, row(1, "a"), row(1, "b"), row(2, "c")];
        expect(besideAnchors(items, { startIndex: 1, endIndex: 4 }, 3)).toEqual([{ kind: "window", block: 0, w: 3 }]);
        // One block alone in view: none beside it.
        expect(besideAnchors([row(0, "a"), row(0, "b")], { startIndex: 0, endIndex: 1 }, 0)).toEqual([]);
    });
});
