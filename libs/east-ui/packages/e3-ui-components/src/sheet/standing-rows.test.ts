/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A drafted row that stands through a carry-over (`standing-rows.ts`, #1599):
 * the rows, read again, have closed over the position a row stood at only
 * where they show the row gone from its place — another row standing there,
 * read at the revision the source reads at now, or the source ending before
 * it — never where its page was merely let go.
 */
import { describe, expect, test } from "vitest";
import { closedOver } from "./standing-rows.js";

/** The rows a sheet draws, by source position: each id at its place, a gap for a position it holds no row of. */
const drawn = (rows: Readonly<Record<number, string>>) => (position: number): string | undefined => rows[position];
/** Every row read at the revision the source reads at now. */
const ALL = (): boolean => true;

describe("whether the rows read again have closed over the position a row stood at", () => {
    test("the row that followed it stands at its position, read at the revision the source reads at now", () => {
        // J9 stood at 1, between J8 and J10.
        expect(closedOver(1, drawn({ 0: "J8", 1: "J10" }), ALL, 2)).toBe(true);
    });
    test("the source's first row: the row that followed it is the first now", () => {
        expect(closedOver(0, drawn({ 0: "J10" }), ALL, 1)).toBe(true);
    });
    test("the source's last row: no row stands at its position, and the source, counted now, ends before it", () => {
        // J10 stood at 2, after J8 and J9.
        expect(closedOver(2, drawn({ 0: "J8", 1: "J9" }), ALL, 2)).toBe(true);
        // The source's only row.
        expect(closedOver(0, drawn({}), ALL, 0)).toBe(true);
    });
    test("the last row of a full page, alone on the page after it: the source ends at the page's end", () => {
        // 200 rows a page: row 200 was alone on the second page.
        expect(closedOver(200, drawn({ 198: "J198", 199: "J199" }), ALL, 200)).toBe(true);
    });
    test("never while the row at its position stands from before the revision the source reads at now", () => {
        expect(closedOver(1, drawn({ 0: "J8", 1: "J10" }), (position) => position !== 1, 2)).toBe(false);
    });
    test("never for a row whose page the sheet let go — scrolled away from: no row stands at its position, in a source that reaches past it", () => {
        expect(closedOver(1, drawn({ 400: "J400", 401: "J401" }), ALL, 2_000)).toBe(false);
        expect(closedOver(0, drawn({ 400: "J400" }), ALL, 2_000)).toBe(false);
    });
    test("never while the source's count at the revision it reads at now is not known", () => {
        expect(closedOver(2, drawn({ 0: "J8", 1: "J9" }), ALL, undefined)).toBe(false);
    });
});
