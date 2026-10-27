/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The library's Backlog (#1389, `backlog.ts`, SC4): every item kind's rows
 * with no position, the read's with the drafts in place — a stored row listed
 * unless a draft holds it; a drafted row with no position listed, one placed
 * or deleted not; a drafted row the read does not hold waiting in its session,
 * a new one listed always — each kind's in the Schematic's order. Fixtures are
 * real East values typed from the Schematic's East types.
 */

import { describe, expect, test } from "vitest";
import { defaultValue, none, some } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import type { ItemRoles } from "./canvas/drawn.js";
import { backlogEntries } from "./backlog.js";
import type { SchematicHeldRows, SchematicUnplacedRows } from "./data.js";
import type { DraftedRow } from "./drafted.js";

const T = Schematic.Types;

/** A row's roles at a point — or none, unplaced — labelled with its key. */
function row(key: string, position: { x: number; y: number } | undefined): ItemRoles {
    return { ...defaultValue<typeof T.Item>(T.Item), position: position === undefined ? none : some(position), label: key };
}

/** Racks and cooling units, each with a backlog; frames placing every row. */
const KINDS = [{ key: "racks", backlog: true }, { key: "network", backlog: false }, { key: "cooling", backlog: true }];

/** The read holds A01 placed, A06 and A07 with no position; CRAH-9 with none; ODF-1 placed. */
const UNPLACED: SchematicUnplacedRows = new Map([
    ["racks", new Map([["A06", row("A06", undefined)], ["A07", row("A07", undefined)]])],
    ["cooling", new Map([["CRAH-9", row("CRAH-9", undefined)]])],
]);
const HELD: SchematicHeldRows = new Map([
    ["racks", new Map([["A01", { details: undefined }], ["A06", { details: undefined }], ["A07", { details: undefined }]])],
    ["network", new Map([["ODF-1", { details: undefined }]])],
    ["cooling", new Map([["CRAH-9", { details: undefined }]])],
]);

/** The racks' drafts, by key. */
const rackDrafts = (rows: ReadonlyMap<string, DraftedRow<ItemRoles> | undefined>) => new Map([["racks", rows]]);

/** What the Backlog lists, by kind and key. */
const listed = (drafts: ReturnType<typeof rackDrafts> = new Map()) => backlogEntries(KINDS, UNPLACED, HELD, drafts).map((entry) => `${entry.ref.kind}:${entry.ref.key}`);

describe("backlogEntries", () => {
    test("lists each item kind's rows the read holds with no position, in the kinds' order and the read's, a kind placing every row none", () => {
        expect(listed()).toEqual(["racks:A06", "racks:A07", "cooling:CRAH-9"]);
        const first = backlogEntries(KINDS, UNPLACED, HELD, new Map())[0]!;
        expect(first.id).toBe('(kind="racks", key="A06")');
        expect(first.roles.label).toBe("A06");
    });

    test("a draft decides a row: one placing a stored row takes it off; one unplacing a placed row lists it; one deleting a row takes it off", () => {
        expect(listed(rackDrafts(new Map([["A06", { roles: row("A06", { x: 4, y: 5 }), created: false }]])))).toEqual(["racks:A07", "cooling:CRAH-9"]);
        expect(listed(rackDrafts(new Map([["A01", { roles: row("A01", undefined), created: false }]])))).toEqual(["racks:A06", "racks:A07", "racks:A01", "cooling:CRAH-9"]);
        expect(listed(rackDrafts(new Map([["A07", undefined]])))).toEqual(["racks:A06", "cooling:CRAH-9"]);
    });

    test("a new row with no position is listed; a drafted row the read does not hold waits in its session", () => {
        expect(listed(rackDrafts(new Map([["new-1", { roles: row("new-1", undefined), created: true }]])))).toEqual(["racks:A06", "racks:A07", "racks:new-1", "cooling:CRAH-9"]);
        expect(listed(rackDrafts(new Map([["A09", { roles: row("A09", undefined), created: false }]])))).toEqual(["racks:A06", "racks:A07", "cooling:CRAH-9"]);
    });

    test("a kind read by area lists a drafted row with no position wherever its window is, by the row its session began from", () => {
        // The window holds none of the racks: A01 and A02 a gesture unplaced, A06 its stored row already with none, new-1 made.
        const window: SchematicHeldRows = new Map([["racks", new Map()]]);
        const drafts = rackDrafts(new Map([
            ["A01", { roles: row("A01", undefined), created: false, began: row("A01", { x: 2, y: 3 }) }],
            ["A02", { roles: row("A02", undefined), created: false, began: row("A02", { x: 6, y: 3 }) }],
            ["A06", { roles: { ...row("A06", undefined), label: "A06 · spare" }, created: false, began: row("A06", undefined) }],
            ["new-1", { roles: row("new-1", undefined), created: true }],
        ]));
        const area = (held: (key: string) => boolean | undefined) => ({ kinds: new Set(["racks"]), held: (at: { kind: string; key: string }) => held(at.key) });
        const listedBy = (held: (key: string) => boolean | undefined) => backlogEntries(KINDS, new Map(), window, drafts, area(held)).map((entry) => entry.ref.key);
        // A06's stored row has no position: its page lists it, its draft in place.
        expect(listedBy(() => undefined)).toEqual(["A01", "A02", "new-1"]);
        // A02's stored row is not the narrowing's: it waits in its session. A row a gesture made is listed whatever the narrowing.
        expect(listedBy((key) => key !== "A02")).toEqual(["A01", "new-1"]);
        // A kind read otherwise still waits for its read to hold the row.
        expect(backlogEntries(KINDS, new Map(), window, drafts).map((entry) => entry.ref.key)).toEqual(["new-1"]);
    });

    test("a drafted row keeps the roles its draft gives it", () => {
        const renamed = { ...row("A07", undefined), label: "A07 · spare" };
        const entry = backlogEntries(KINDS, UNPLACED, HELD, rackDrafts(new Map([["A07", { roles: renamed, created: false }]]))).find((e) => e.ref.key === "A07")!;
        expect(entry.roles.label).toBe("A07 · spare");
    });
});
