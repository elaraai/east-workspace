/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, expect, test } from "vitest";
import { none } from "@elaraai/east";
import type { SheetEntryHold } from "../sheet/index.js";
import type { SheetRowValue } from "../sheet/values.js";
import { createRecordTicks } from "./ticks.js";

/** A row as the Sheet reads it, and what it holds of it. */
function heldOf(id: string): SheetEntryHold {
    const wire: SheetRowValue = { id, owned: false, cells: new Map(), lines: [], band: none, subRows: [], entry: none };
    return { draft: { id }, wire, place: none };
}

describe("a Record's ticks (#1579)", () => {
    test("a tick holds what the Sheet held of its row as it was ticked, and keeps it once the row is read no more", () => {
        const ticks = createRecordTicks();
        const read = new Map([["a", heldOf("a")], ["b", heldOf("b")]]);
        const a = read.get("a")!;
        ticks.holdWith((id) => read.get(id));
        ticks.toggle("a");
        // A scrolled away: the Sheet holds nothing of it, and its tick holds what it held.
        read.delete("a");
        ticks.toggle("c");
        expect([...ticks.held().keys()]).toEqual(["a", "c"]);
        expect(ticks.held().get("a")).toBe(a);
        expect(ticks.held().get("c")).toBeUndefined();
        expect(ticks.size()).toBe(2);
        // Ticked again among others, a row keeps what it held; unticked, it holds nothing.
        ticks.set(["a", "b"]);
        expect(ticks.held().get("a")).toBe(a);
        expect(ticks.held().get("b")).toBe(read.get("b"));
        ticks.toggle("a");
        expect([...ticks.held().keys()]).toEqual(["b"]);
        ticks.clear();
        expect(ticks.size()).toBe(0);
    });
});
