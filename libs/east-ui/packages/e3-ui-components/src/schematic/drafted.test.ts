/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The drawing with the drafts in place (#1388, `drafted.ts`, SC23): a drafted
 * row the read holds draws as drafted, or nowhere when its draft deletes or
 * unplaces it; a new row draws though no read holds it; a drafted row the
 * read does not hold — a narrowing hides it — waits in its session, drawing
 * once a read holds it again; and what a drafted row draws is kept by the
 * roles it was drawn from. Fixtures are real East values typed from the
 * Schematic's East types, compared through East.
 */

import { describe, expect, test } from "vitest";
import { ArrayType, defaultValue, equalFor, none, some } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import {
    SchematicDrawnItemType, drawnItem, drawnLink, entityId, type DetailsRoles, type ItemRoles, type LinkRoles, type SchematicDrawn, type SchematicRef,
} from "./canvas/drawn.js";
import type { SchematicHeldRows } from "./data.js";
import { NO_DRAFTS, draftedDrawing, type DraftedCache, type DraftedRow, type SchematicDrafts } from "./drafted.js";

const T = Schematic.Types;
const itemsEqual = equalFor(ArrayType(SchematicDrawnItemType));

const ref = (kind: string, key: string): SchematicRef => ({ kind, key });
const A01 = ref("racks", "A01"), A02 = ref("racks", "A02"), A06 = ref("racks", "A06"), NEW = ref("racks", "new-1");
const ODF = ref("network", "ODF-1");

/** A rack's roles at a point — or none, unplaced — labelled with its key. */
function rack(at: SchematicRef, position: { x: number; y: number } | undefined): ItemRoles {
    return { ...defaultValue<typeof T.Item>(T.Item), position: position === undefined ? none : some(position), label: at.key };
}

/** A rack drawn as the reader draws a stored one. */
const stored = (at: SchematicRef, x: number, y: number) => drawnItem(at, rack(at, { x, y }), undefined)!;

/** The stored drawing: A01 and A02 placed, u1 from A01 to ODF-1. */
const STORED: SchematicDrawn = {
    items: [stored(A01, 2, 3), stored(A02, 6, 3)],
    zones: [],
    links: [drawnLink(ref("fibre", "u1"), { ...defaultValue<typeof T.Link>(T.Link), from: A01, to: ODF })],
    nets: [],
};

/** The read holds A01, A02 and A06 — A06 unplaced — A02's details a meter. */
const LOAD: DetailsRoles = { ...defaultValue<typeof T.DetailsRoles>(T.DetailsRoles), meter: some({ value: 7.4, max: 8 }) };
const HELD: SchematicHeldRows = new Map([
    ["racks", new Map([["A01", { details: undefined }], ["A02", { details: LOAD }], ["A06", { details: undefined }]])],
    ["fibre", new Map([["u1", { details: undefined }]])],
]);

/** Drafts of the racks, by key. */
function rackDrafts(rows: ReadonlyMap<string, DraftedRow<ItemRoles> | undefined>): SchematicDrafts {
    return { ...NO_DRAFTS, items: new Map([["racks", rows]]) };
}

describe("draftedDrawing", () => {
    test("with no drafts, it is the stored drawing itself", () => {
        expect(draftedDrawing(STORED, HELD, NO_DRAFTS, new WeakMap())).toBe(STORED);
    });

    test("a drafted row the read holds draws as drafted, in its place, its details beside it", () => {
        const moved = { roles: rack(A02, { x: 9, y: 5 }), created: false };
        const drawn = draftedDrawing(STORED, HELD, rackDrafts(new Map([["A02", moved]])), new WeakMap());
        expect(itemsEqual(drawn.items, [stored(A01, 2, 3), drawnItem(A02, moved.roles, LOAD)!])).toBe(true);
        // What the drafts leave alone stays as the reader drew it.
        expect(drawn.items[0]).toBe(STORED.items[0]);
        expect(drawn.links).toBe(STORED.links);
    });

    test("a row its draft deletes, or unplaces, draws nothing", () => {
        const drawn = draftedDrawing(STORED, HELD, rackDrafts(new Map<string, DraftedRow<ItemRoles> | undefined>([
            ["A01", undefined], ["A02", { roles: rack(A02, undefined), created: false }],
        ])), new WeakMap());
        expect(drawn.items).toEqual([]);
    });

    test("a new row draws though no read holds it; an unplaced row a draft places draws too", () => {
        const drawn = draftedDrawing(STORED, HELD, rackDrafts(new Map([
            ["new-1", { roles: rack(NEW, { x: 12, y: 3 }), created: true }],
            ["A06", { roles: rack(A06, { x: 14, y: 3 }), created: false }],
        ])), new WeakMap());
        expect(drawn.items.map((item) => item.key)).toEqual([entityId(A01), entityId(A02), entityId(NEW), entityId(A06)]);
    });

    test("a drafted row no read holds — a narrowing hides it — waits in its session, and draws once a read holds it again (SC23)", () => {
        const hidden: SchematicHeldRows = new Map([["racks", new Map([["A01", { details: undefined }]])], ["fibre", new Map([["u1", { details: undefined }]])]]);
        const narrowed: SchematicDrawn = { ...STORED, items: [stored(A01, 2, 3)] };
        const drafts = rackDrafts(new Map([["A02", { roles: rack(A02, { x: 9, y: 5 }), created: false }]]));
        expect(draftedDrawing(narrowed, hidden, drafts, new WeakMap()).items.map((item) => item.key)).toEqual([entityId(A01)]);
        // The narrowing cleared: the read holds A02 again, and it draws where its draft has it.
        const again = draftedDrawing(STORED, HELD, drafts, new WeakMap());
        expect(again.items.map((item) => [item.key, item.x, item.y])).toEqual([[entityId(A01), 2, 3], [entityId(A02), 9, 5]]);
    });

    test("a drafted link draws from its drafted roles, and a deleted one goes", () => {
        const roles: LinkRoles = { ...defaultValue<typeof T.Link>(T.Link), from: A02, to: ODF };
        const drafts: SchematicDrafts = { ...NO_DRAFTS, links: new Map([["fibre", new Map<string, DraftedRow<LinkRoles> | undefined>([
            ["u1", undefined], ["new-run", { roles, created: true }],
        ])]]) };
        const drawn = draftedDrawing(STORED, HELD, drafts, new WeakMap());
        expect(drawn.links.map((link) => [link.key, link.from, link.to])).toEqual([[entityId(ref("fibre", "new-run")), entityId(A02), entityId(ODF)]]);
    });

    test("what a drafted row draws is kept by the roles it was drawn from: a render that moves no draft draws each the same", () => {
        const cache: DraftedCache = new WeakMap();
        const drafts = rackDrafts(new Map([["A02", { roles: rack(A02, { x: 9, y: 5 }), created: false }]]));
        const first = draftedDrawing(STORED, HELD, drafts, cache);
        const second = draftedDrawing(STORED, HELD, drafts, cache);
        expect(second.items[1]).toBe(first.items[1]);
        // Its details moving draws it again.
        const loaded: SchematicHeldRows = new Map([...HELD, ["racks", new Map([...HELD.get("racks")!, ["A02", { details: undefined }]])]]);
        expect(draftedDrawing(STORED, loaded, drafts, cache).items[1]).not.toBe(first.items[1]);
    });
});
