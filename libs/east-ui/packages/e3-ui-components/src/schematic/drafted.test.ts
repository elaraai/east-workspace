/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The drawing with the drafts in place (#1388, `drafted.ts`, SC23): a drafted
 * row the read holds draws as drafted, or nowhere when its draft deletes or
 * unplaces it; a new row draws though no read holds it; a drafted row the
 * read does not hold — a narrowing hides it — waits in its session, drawing
 * once a read holds it again; and what a drafted row draws is kept by the
 * roles it was drawn from. What waits is made as its draft has it, for Issues
 * to check beside the drawing, and where it stands is what Go to issue flies
 * to (ruled 27 Oct 2026). Fixtures are real East values typed from the
 * Schematic's East types, compared through East.
 */

import { describe, expect, test } from "vitest";
import { ArrayType, StringType, defaultValue, equalFor, none, some } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import {
    EMPTY_DRAWN, SchematicDrawnItemType, SchematicDrawnLinkType, drawnItem, drawnLink, drawnNet, drawnZone, entityId,
    type DetailsRoles, type ItemRoles, type LinkRoles, type NetRoles, type SchematicDrawn, type SchematicRef, type ZoneRoles,
} from "./canvas/drawn.js";
import type { SchematicHeldRows } from "./data.js";
import {
    NO_DRAFTS, draftedDrawing, waitingDrafts, waitingPoint, withWaiting, type DraftedCache, type DraftedRow, type SchematicDrafts,
} from "./drafted.js";

const T = Schematic.Types;
const itemsEqual = equalFor(ArrayType(SchematicDrawnItemType));
const linksEqual = equalFor(ArrayType(SchematicDrawnLinkType));
const stringEqual = equalFor(StringType);

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

    test("a kind read by area's drafted row its window doesn't hold draws where its draft has it — unless the hidden narrowing leaves it out, when it waits in its session", () => {
        // The window holds A01 alone: A02, moved by a draft, is off it.
        const window: SchematicHeldRows = new Map([["racks", new Map([["A01", { details: undefined }]])], ["fibre", new Map([["u1", { details: undefined }]])]]);
        const narrowed: SchematicDrawn = { ...STORED, items: [stored(A01, 2, 3)] };
        const drafts = rackDrafts(new Map([["A02", { roles: rack(A02, { x: 9, y: 5 }), created: false }]]));
        const racks = new Set(["racks"]);
        expect(draftedDrawing(narrowed, window, drafts, new WeakMap(), racks).items.map((item) => [item.key, item.x, item.y]))
            .toEqual([[entityId(A01), 2, 3], [entityId(A02), 9, 5]]);
        // The row its session began from is not the hidden narrowing's: A02 is drawn nowhere.
        const leftOut = (at: SchematicRef) => at.kind === A02.kind && at.key === A02.key;
        expect(draftedDrawing(narrowed, window, drafts, new WeakMap(), racks, leftOut).items.map((item) => item.key)).toEqual([entityId(A01)]);
        // A row a gesture created draws whatever the narrowing.
        const made = rackDrafts(new Map([["new-1", { roles: rack(NEW, { x: 12, y: 3 }), created: true }]]));
        expect(draftedDrawing(narrowed, window, made, new WeakMap(), racks, () => true).items.map((item) => item.key)).toEqual([entityId(A01), entityId(NEW)]);
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

/** The read under a narrowing that hides A02 and u1: it holds A01 alone. */
const NARROWED_HELD: SchematicHeldRows = new Map([["racks", new Map([["A01", { details: undefined }]])], ["fibre", new Map()]]);

/** The stored drawing under that narrowing: A01. */
const NARROWED: SchematicDrawn = { items: [stored(A01, 2, 3)], zones: [], links: [], nets: [] };

describe("waitingDrafts", () => {
    test("a drafted row the narrowing leaves out waits in its session, drawn nowhere, and is made as its draft has it: what Issues checks beside the drawing", () => {
        const moved = { roles: rack(A02, { x: 30, y: 5 }), created: false };
        const drafts = rackDrafts(new Map([["A02", moved]]));
        const waiting = waitingDrafts(NARROWED_HELD, drafts);
        expect(itemsEqual(waiting.items, [drawnItem(A02, moved.roles, undefined)!])).toBe(true);
        // The drawing draws none of it; beside it, Issues checks both.
        const drawing = draftedDrawing(NARROWED, NARROWED_HELD, drafts, new WeakMap());
        expect(drawing.items.map((item) => item.key)).toEqual([entityId(A01)]);
        expect(withWaiting(drawing, waiting).items.map((item) => item.key)).toEqual([entityId(A01), entityId(A02)]);
    });

    test("a drafted row the read holds, and one a gesture created, draw — none waits; a row its draft deletes is no row", () => {
        const drafts = rackDrafts(new Map<string, DraftedRow<ItemRoles> | undefined>([
            ["A01", { roles: rack(A01, { x: 9, y: 5 }), created: false }], ["new-1", { roles: rack(NEW, { x: 12, y: 3 }), created: true }], ["A02", undefined],
        ]));
        expect(waitingDrafts(NARROWED_HELD, drafts)).toBe(EMPTY_DRAWN);
        // With nothing waiting, the drawing is what Issues checks.
        expect(withWaiting(NARROWED, EMPTY_DRAWN)).toBe(NARROWED);
    });

    test("a kind read by area's drafted row its window doesn't hold waits only while the hidden narrowing leaves it out; an unplaced one is no row of a drawing", () => {
        const racks = new Set(["racks"]);
        const offWindow = rackDrafts(new Map([["A02", { roles: rack(A02, { x: 9, y: 5 }), created: false }]]));
        // The narrowing holds the row its session began from: it draws where its draft has it, and waits for nothing.
        expect(waitingDrafts(NARROWED_HELD, offWindow, racks).items).toEqual([]);
        // It leaves it out: it waits.
        const leftOut = (at: SchematicRef) => stringEqual(at.kind, A02.kind) && stringEqual(at.key, A02.key);
        expect(waitingDrafts(NARROWED_HELD, offWindow, racks, leftOut).items.map((item) => [item.key, item.x, item.y])).toEqual([[entityId(A02), 9, 5]]);
        // A draft that unplaces a row draws nowhere on any drawing: no row waits for it.
        const unplaced = rackDrafts(new Map([["A02", { roles: rack(A02, undefined), created: false }]]));
        expect(waitingDrafts(NARROWED_HELD, unplaced, racks, leftOut)).toBe(EMPTY_DRAWN);
    });

    test("a link, a zone and a net wait as an item does, each made as its kind draws it", () => {
        const run: LinkRoles = { ...defaultValue<typeof T.Link>(T.Link), from: A01, to: ODF };
        const drafts: SchematicDrafts = { ...NO_DRAFTS, links: new Map([["fibre", new Map([["u1", { roles: run, created: false }]])]]) };
        expect(linksEqual(waitingDrafts(NARROWED_HELD, drafts).links, [drawnLink(ref("fibre", "u1"), run)])).toBe(true);
    });
});

describe("waitingPoint", () => {
    const hall: ZoneRoles = { ...defaultValue<typeof T.Zone>(T.Zone), label: "Hall 3", x: 2, y: 4, width: 6, height: 2 };
    const feed: NetRoles = { ...defaultValue<typeof T.Net>(T.Net), sources: [A01], destinations: [A02, A06] };
    /** What waits: A02 moved to 30, 5; the hall; a run from A01 to ODF-1, one from A01 to A02, one from ODF-1 to a rack nothing places; and a feed. */
    const WAITING: SchematicDrawn = {
        items: [drawnItem(A02, rack(A02, { x: 30, y: 5 }), undefined)!],
        zones: [drawnZone(ref("areas", "hall"), hall)],
        links: [
            drawnLink(ref("fibre", "u1"), { ...defaultValue<typeof T.Link>(T.Link), from: A01, to: ODF }),
            drawnLink(ref("fibre", "u2"), { ...defaultValue<typeof T.Link>(T.Link), from: A01, to: A02 }),
            drawnLink(ref("fibre", "u9"), { ...defaultValue<typeof T.Link>(T.Link), from: ODF, to: ref("racks", "A99") }),
        ],
        nets: [drawnNet(ref("feeds", "feed-a"), feed)],
    };

    test("an item stands where its draft places it, a zone at its box's centre", () => {
        expect(waitingPoint(entityId(A02), WAITING, NARROWED)).toEqual({ x: 30, y: 5 });
        expect(waitingPoint(entityId(ref("areas", "hall")), WAITING, NARROWED)).toEqual({ x: 5, y: 5 });
    });

    test("a link or a net stands at its placed members' box's centre — each where the drawing or a waiting row places it — and nowhere with none placed", () => {
        // ODF-1 is placed by neither: the run stands at A01.
        expect(waitingPoint(entityId(ref("fibre", "u1")), WAITING, NARROWED)).toEqual({ x: 2, y: 3 });
        // A01 drawn at 2, 3, A02 waiting at 30, 5.
        expect(waitingPoint(entityId(ref("fibre", "u2")), WAITING, NARROWED)).toEqual({ x: 16, y: 4 });
        expect(waitingPoint(entityId(ref("feeds", "feed-a")), WAITING, NARROWED)).toEqual({ x: 16, y: 4 });
        expect(waitingPoint(entityId(ref("fibre", "u9")), WAITING, NARROWED)).toBeUndefined();
        // What does not wait stands nowhere here.
        expect(waitingPoint(entityId(A01), WAITING, NARROWED)).toBeUndefined();
    });
});
