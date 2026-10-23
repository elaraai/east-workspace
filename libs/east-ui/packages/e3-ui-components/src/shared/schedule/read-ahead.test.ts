/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A period's neighbours, read ahead (#1398, CL7), pure: nothing until the
 * period itself has landed, then the next and the previous, in that order; a
 * neighbour whose read throws is the neighbour's own. The period readers'
 * DOM tests carry it through e3 (`roster/loading.dom.test.tsx`,
 * `calendar/calendar-slice.dom.test.tsx`).
 */

import { describe, expect, test } from "vitest";
import { readAhead } from "./read-ahead.js";

describe("readAhead", () => {
    test("nothing is read ahead until the period in view has landed", () => {
        const read: string[] = [];
        readAhead(false, ["next", "previous"], (p) => { read.push(p); });
        expect(read).toEqual([]);
    });

    test("once it has, the neighbours are read nearest first: the next, then the previous", () => {
        const read: string[] = [];
        readAhead(true, ["next", "previous"], (p) => { read.push(p); });
        expect(read).toEqual(["next", "previous"]);
    });

    test("a neighbour whose read throws is its own: the other is still read, and the period's read goes on", () => {
        const read: string[] = [];
        expect(() => readAhead(true, ["next", "previous"], (p) => {
            if (p === "next") throw new Error("the store is down");
            read.push(p);
        })).not.toThrow();
        expect(read).toEqual(["previous"]);
    });
});
