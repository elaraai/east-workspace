/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The step layer's reads of jq nodes: whether a node reads a variable
 * (#1670) — `$now`, which a program binds as `.now as $now` only where it is
 * read — walked as East's checker walks a program.
 */

import { describe, expect, it } from "vitest";
import { parseJq, type JqNode } from "@elaraai/east";
import { readsVariable } from "./jq.js";

/** A jq node, as a filter holds it. */
function node(text: string): JqNode {
    const parsed = parseJq(text);
    if (parsed.program.type === "none") throw new Error(`does not parse: ${text}`);
    return parsed.program.value;
}

describe("readsVariable", () => {
    it("finds $now wherever it is read: a comparison, a call's argument, an object's shorthand key, a string's interpolation, a def's body", () => {
        for (const text of [
            `.at >= ($now | datetime_add(-7; "day"))`,
            `if .open then .at < $now else false end`,
            `{$now} | .now`,
            `"asked at \\($now)" | length > 0`,
            `def recent: .at >= $now; recent`,
            `[.items[] | select(.at >= $now)] | length > 0`,
            `try (.at >= $now) catch false`,
        ]) expect(readsVariable(node(text), "now"), text).toBe(true);
    });

    it("finds no other: another variable, a longer name, a field or a string named so, or none at all", () => {
        for (const text of [`.at >= $then`, `.at >= $nowhere`, `.now >= .at`, `.label == "$now"`, `.export`]) {
            expect(readsVariable(node(text), "now"), text).toBe(false);
        }
    });

    it("counts a $now the node binds itself: a reader that binds it before binds one it need not, and never misses one it needs", () => {
        expect(readsVariable(node(`.at as $now | $now > 0`), "now")).toBe(true);
    });
});
