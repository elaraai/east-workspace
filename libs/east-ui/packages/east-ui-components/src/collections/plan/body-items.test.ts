/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas body's items (`body-items.ts`) — the links focus's elision (R1
 * at scale) and link graph, and where a failed window's band goes (#811).
 *
 * (Split out of `model.test.ts` with the module it tests, #815.)
 */

import { describe, test, expect } from "vitest";
import { some, none, variant } from "@elaraai/east";
import {
    deriveLinkFamily, elideForFocus, indexRows, linkedRowKeys, placeFailures, firstDiagnosticItem, toCanvasRows,
    type PlanBodyItem, type PlanLinkValue, type PlanRowValue, type PlanWindowFailure, type PlanWireRow, type VisibleRow,
} from "./model.js";
import { rowId, rowKey, testKeyOf } from "./plan.test-utils.js";

/** One WIRE row at a test key, optionally nested and with a status. */
function wire(key: string, kind: unknown, opts?: { parent?: string; status?: string }): PlanWireRow {
    return {
        id: rowId(key),
        parent: opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        gutter: { label: key, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind,
        collapsed: false, pinned: false, height: none,
        status: opts?.status !== undefined ? some(variant(opts.status, null)) : none,
        approval: none, expand: none,
    } as unknown as PlanWireRow;
}

function visible(r: PlanRowValue, opts?: { collapsed?: boolean }): VisibleRow {
    return { row: r, depth: 0, collapsed: opts?.collapsed === true };
}
const spanKind = variant("span", { runs: [], decisions: [], ports: [], rollup: none });
const groupKind = variant("group", { summary: variant("none", null) });

describe("Plan links-focus elision (R1 at scale)", () => {
    const focusOn = (key: string, family: string[]) =>
        ({ kind: "links" as const, key: rowKey(key), family: new Set(family.map((k) => rowKey(k))) });
    const words = (items: readonly PlanBodyItem[]) => items.map((i) => (i.kind === "row" ? testKeyOf(i.row.row.key)
        : i.kind === "gap" ? `gap:${i.gap.rows}/${i.gap.groups}` : "band"));

    test("a LONE unrelated data row stays a rail entry; a run coalesces to ONE gap", () => {
        const rows = toCanvasRows(["f", "x", "a", "y1", "y2", "y3", "b"].map((k) => wire(k, spanKind)));
        const items = elideForFocus(rows.map((r) => visible(r)), indexRows(rows), focusOn("f", ["a", "b"]));
        expect(words(items)).toEqual(["f", "x", "a", "gap:3/0", "b"]);
    });

    test("a family-less group and its subtree join the gap; a group HOLDING family keeps its band", () => {
        const rows = toCanvasRows([
            wire("f", spanKind),
            wire("g-empty", groupKind), wire("t1", spanKind, { parent: "g-empty" }), wire("t2", spanKind, { parent: "g-empty" }),
            wire("g-fam", groupKind), wire("fam", spanKind, { parent: "g-fam" }),
        ]);
        const items = elideForFocus(rows.map((r) => visible(r)), indexRows(rows), focusOn("f", ["fam"]));
        expect(words(items)).toEqual(["f", "gap:2/1", "g-fam", "fam"]);
    });

    test("a collapsed elided group counts its hidden subtree; the gap wears the worst hidden tone", () => {
        const rows = toCanvasRows([
            wire("f", spanKind),
            wire("g", groupKind), wire("t1", spanKind, { parent: "g" }), wire("t2", spanKind, { parent: "g" }),
            wire("w", spanKind, { status: "warning" }),
            wire("d", spanKind, { status: "danger" }),
            wire("fam", spanKind),
        ]);
        const index = indexRows(rows);
        // The group is collapsed: only its band is visible; t1/t2 hide inside.
        const vis = [visible(rows[0]!), visible(rows[1]!, { collapsed: true }),
            visible(rows[4]!), visible(rows[5]!), visible(rows[6]!)];
        const items = elideForFocus(vis, index, focusOn("f", ["fam"]));
        expect(items).toHaveLength(3);
        const gap = items[1]!;
        expect(gap.kind).toBe("gap");
        if (gap.kind === "gap") {
            expect(gap.gap.rows).toBe(4);        // t1 + t2 (through the collapse) + w + d
            expect(gap.gap.groups).toBe(1);
            expect(gap.gap.tone).toBe("danger"); // pessimistic over warning
        }
    });
});

describe("Plan link graph (R1)", () => {
    // A link names its ends by run ref — a row id (#822) and a run key (#824);
    // the graph keys by the ids' text.
    const link = (from: string, to: string): PlanLinkValue => ({
        key: `${from}-${to}`, from: { row: rowId(from), run: "a" }, to: { row: rowId(to), run: "b" },
        quantity: some({ value: 10, unit: some("t"), format: none, text: none }),
    } as unknown as PlanLinkValue);
    const sorted = (keys: Iterable<string>) => [...keys].map(testKeyOf).sort();

    test("linkedRowKeys collects every touched row", () => {
        const keys = linkedRowKeys([link("a", "b"), link("b", "c")]);
        expect(sorted(keys)).toEqual(["a", "b", "c"]);
        expect(keys.has(rowKey("a"))).toBe(true);
    });

    test("deriveLinkFamily walks the TRANSITIVE closure both ways, across chains", () => {
        // a → b → focus → c → d, plus unrelated x → y.
        const links = [link("a", "b"), link("b", "f"), link("f", "c"), link("c", "d"), link("x", "y")];
        const fam = deriveLinkFamily(links, rowKey("f"));
        expect(sorted(fam.upstream)).toEqual(["a", "b"]);
        expect(sorted(fam.downstream)).toEqual(["c", "d"]);
        expect(fam.all.has(rowKey("x"))).toBe(false);
        // A diamond back-edge lands a row in BOTH sets (the LINKED tag).
        const both = deriveLinkFamily([link("f", "m"), link("m", "f")], rowKey("f"));
        expect(both.upstream.has(rowKey("m"))).toBe(true);
        expect(both.downstream.has(rowKey("m"))).toBe(true);
    });

    test("two series' rows over one entry are two ends — never merged by the entry's key", () => {
        // `views` puts one entry on several rows; a link to its chart row is
        // not a link to its span row.
        const links = [{
            key: "l", from: { row: rowId("m03", "machine-jobs"), run: "a" }, to: { row: rowId("m04", "machine-jobs"), run: "b" },
            quantity: none,
        } as unknown as PlanLinkValue];
        const fam = deriveLinkFamily(links, rowKey("m03", "machine-jobs"));
        expect([...fam.downstream]).toEqual([rowKey("m04", "machine-jobs")]);
        expect(deriveLinkFamily(links, rowKey("m03", "machine-util")).all.size).toBe(0);
    });
});

describe("Plan failed-window placement (#811)", () => {
    const rowItem = (key: string, collapsed = false): PlanBodyItem =>
        ({ kind: "row", row: { row: toCanvasRows([wire(key, spanKind)])[0]!, depth: 0, collapsed } });
    const failure = (w: number): PlanWindowFailure => ({ block: 0, w, from: w * 200, to: w * 200 + 199, px: 200, error: "boom" });
    const keys = (items: readonly PlanBodyItem[]) => items.map((i) =>
        (i.kind === "row" ? testKeyOf(i.row.row.key) : i.kind === "failed" ? `F${i.failure.w}` : i.kind));

    test("each band goes after the last row of an EARLIER window — at the head, in a seam, at the tail", () => {
        // One block's rows, in window order (#823); a row no window placed (a
        // fixed row) anchors no seam.
        const items = [rowItem("S"), rowItem("a"), rowItem("b"), rowItem("c")];
        const origin = new Map([[rowKey("a"), 1], [rowKey("b"), 1], [rowKey("c"), 3]]);
        const placed = placeFailures(items, [failure(5), failure(2), failure(0)], (k) => origin.get(k));
        expect(keys(placed)).toEqual(["F0", "S", "a", "b", "F2", "c", "F5"]);
        // Nothing failed: the very same items.
        expect(placeFailures(items, [], (k) => origin.get(k))).toBe(items);
    });

    test("the chip seeks the first diagnostic row — or the collapsed group hiding it", () => {
        const rows = toCanvasRows([
            wire("G", groupKind),
            wire("bad", spanKind, { parent: "G" }),
            wire("x", spanKind),
            wire("bad2", spanKind),
        ]);
        const index = indexRows(rows);
        const diag = new Map([[rowKey("bad"), { kind: "axis" as const, found: "time" as const, expected: "number" as const }],
            [rowKey("bad2"), { kind: "axis" as const, found: "time" as const, expected: "number" as const }]]);
        // G collapsed: its band is the first thing on screen that holds one.
        expect(firstDiagnosticItem([rowItem("G", true), rowItem("x"), rowItem("bad2")], index, diag)).toBe(0);
        // G open: the row itself.
        expect(firstDiagnosticItem([rowItem("G"), rowItem("bad"), rowItem("x"), rowItem("bad2")], index, diag)).toBe(1);
        expect(firstDiagnosticItem([rowItem("x")], index, new Map())).toBeUndefined();
    });
});
