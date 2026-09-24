/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * An insertion's destination: a line inserted into a group carries the
 * group's position, and a failed window before the group counts (#853).
 */

import { expect, test } from "vitest";
import { some } from "@elaraai/east";
import { insertionGesture } from "./insertion-gesture.js";
import type { SheetRowValue } from "./values.js";

/** Two resident groups: `g1` at 199, then — window 1 (200–399) failed — `g2` at 400. */
const GROUPS: SheetRowValue[] = ["g1", "g2"].map((id) => ({
    id, owned: false, cells: new Map(), lines: [{ key: "0", cells: new Map(), subRows: [] }], band: some({ sub: "", folded: false }), subRows: [],
}));
const GROUPS_AT = [199, 400];

test("a line inserted into a group carries the group's position, a failed window before it counted", () => {
    const gesture = insertionGesture({ kind: "row", anchor: { entry: "g2", child: "0", side: "after" } }, GROUPS, (i) => GROUPS_AT[i]!, true, false,
        () => "unused", () => "+1");
    if (gesture === undefined || gesture.event.type !== "lineInsert") throw new Error("Expected a line insert");
    expect(gesture.event.value.offset).toBe(400n);
    expect(gesture.event.value.line).toBe("1");
    expect(gesture.child).toBe("+1");
});
