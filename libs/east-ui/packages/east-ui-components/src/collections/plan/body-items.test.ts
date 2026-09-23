/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas body's items (`body-items.ts`) — the links focus's elision (R1
 * at scale) and link graph, and where a failed window's band goes (#811).
 *
 * (Split out of `model.test.ts` with the module it tests, #815: every
 * test moved verbatim.)
 */

import { describe, test, expect } from "vitest";
import { some, none, variant } from "@elaraai/east";
import {
    deriveLinkFamily, elideForFocus, indexRows, linkedRowKeys, placeFailures, firstDiagnosticItem,
    type PlanBodyItem, type PlanLinkValue, type PlanRowValue, type PlanWindowFailure, type VisibleRow,
} from "./model.js";

function row(kind: unknown, opts?: { sub?: string; stacked?: boolean; expand?: unknown }): PlanRowValue {
    return {
        key: "r",
        parent: none,
        gutter: {
            label: "R", id: none,
            sub: opts?.sub !== undefined ? some(opts.sub) : none,
            value: none, meta: none,
            stacked: opts?.stacked === true ? some(true) : none,
            swatches: [],
        },
        kind,
        pinned: none, height: none, status: none, approval: none,
        expand: opts?.expand !== undefined ? some(opts.expand) : none,
    } as unknown as PlanRowValue;
}

function visible(r: PlanRowValue, opts?: { collapsed?: boolean }): VisibleRow {
    return { row: r, depth: 0, collapsed: opts?.collapsed === true };
}
const spanKind = variant("span", { runs: [], decisions: [], ports: [], rollup: none, bands: [] });

describe("Plan links-focus elision (R1 at scale)", () => {
    const groupKind = variant("group", { summary: none, summaryAggregate: none, collapsed: none });
    const mk = (key: string, kind: unknown = spanKind, extra?: Partial<PlanRowValue>): PlanRowValue =>
        ({ ...row(kind), key, ...extra } as PlanRowValue);
    const withParent = (r: PlanRowValue, parent: string): PlanRowValue =>
        ({ ...r, parent: some(parent) } as PlanRowValue);
    const focusOn = (key: string, family: string[]) =>
        ({ kind: "links" as const, key, family: new Set(family) });

    test("a LONE unrelated data row stays a rail entry; a run coalesces to ONE gap", () => {
        const rows = [mk("f"), mk("x"), mk("a"), mk("y1"), mk("y2"), mk("y3"), mk("b")];
        const items = elideForFocus(rows.map((r) => visible(r)), indexRows(rows), focusOn("f", ["a", "b"]));
        expect(items.map((i) => (i.kind === "row" ? i.row.row.key : i.kind === "gap" ? `gap:${i.gap.rows}` : "band")))
            .toEqual(["f", "x", "a", "gap:3", "b"]);
    });

    test("a family-less group and its subtree join the gap; a group HOLDING family keeps its band", () => {
        const rows = [
            mk("f"),
            mk("g-empty", groupKind), withParent(mk("t1"), "g-empty"), withParent(mk("t2"), "g-empty"),
            mk("g-fam", groupKind), withParent(mk("fam"), "g-fam"),
        ];
        const items = elideForFocus(rows.map((r) => visible(r)), indexRows(rows), focusOn("f", ["fam"]));
        expect(items.map((i) => (i.kind === "row" ? i.row.row.key : i.kind === "gap" ? `gap:${i.gap.rows}/${i.gap.groups}` : "band")))
            .toEqual(["f", "gap:2/1", "g-fam", "fam"]);
    });

    test("a collapsed elided group counts its hidden subtree; the gap wears the worst hidden tone", () => {
        const rows = [
            mk("f"),
            mk("g", groupKind), withParent(mk("t1"), "g"), withParent(mk("t2"), "g"),
            mk("w", spanKind, { status: some(variant("warning", null)) } as Partial<PlanRowValue>),
            mk("d", spanKind, { status: some(variant("danger", null)) } as Partial<PlanRowValue>),
            mk("fam"),
        ];
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
    const link = (from: string, to: string): PlanLinkValue => ({
        fromRow: from, fromRun: "a", toRow: to, toRun: "b", quantity: 10, label: "10 t",
    } as unknown as PlanLinkValue);

    test("linkedRowKeys collects every touched row", () => {
        expect([...linkedRowKeys([link("a", "b"), link("b", "c")])].sort()).toEqual(["a", "b", "c"]);
    });

    test("deriveLinkFamily walks the TRANSITIVE closure both ways, across chains", () => {
        // a → b → focus → c → d, plus unrelated x → y.
        const links = [link("a", "b"), link("b", "f"), link("f", "c"), link("c", "d"), link("x", "y")];
        const fam = deriveLinkFamily(links, "f");
        expect([...fam.upstream].sort()).toEqual(["a", "b"]);
        expect([...fam.downstream].sort()).toEqual(["c", "d"]);
        expect(fam.all.has("x")).toBe(false);
        // A diamond back-edge lands a row in BOTH sets (the LINKED tag).
        const both = deriveLinkFamily([link("f", "m"), link("m", "f")], "f");
        expect(both.upstream.has("m")).toBe(true);
        expect(both.downstream.has("m")).toBe(true);
    });
});

/** One decoded row at a key, optionally parented. */
function trow(key: string, parent: string | undefined, kind: unknown): PlanRowValue {
    return {
        key,
        parent: parent !== undefined ? some(parent) : none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind,
        pinned: none, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanRowValue;
}

describe("Plan failed-window placement (#811)", () => {
    const rowItem = (key: string, collapsed = false): PlanBodyItem =>
        ({ kind: "row", row: { row: trow(key, undefined, spanKind), depth: 0, collapsed } });
    const failure = (w: number): PlanWindowFailure => ({ w, from: w * 200, to: w * 200 + 199, px: 200, error: "boom" });
    const keys = (items: readonly PlanBodyItem[]) => items.map((i) =>
        (i.kind === "row" ? i.row.row.key : i.kind === "failed" ? `F${i.failure.w}` : i.kind));

    test("each band goes after the last row of an EARLIER window — at the head, in a seam, at the tail", () => {
        // G is a parent windows 1 and 3 both emit: attributed to the LATER
        // one, it walks first but must not anchor window 2's seam early.
        const items = [rowItem("G"), rowItem("a"), rowItem("b"), rowItem("c")];
        const origin = new Map([["G", 3], ["a", 1], ["b", 1], ["c", 3]]);
        const placed = placeFailures(items, [failure(5), failure(2), failure(0)], origin);
        expect(keys(placed)).toEqual(["F0", "G", "a", "b", "F2", "c", "F5"]);
        // Nothing failed: the very same items.
        expect(placeFailures(items, [], origin)).toBe(items);
    });

    test("the chip seeks the first diagnostic row — or the collapsed group hiding it", () => {
        const rows = [
            trow("G", undefined, variant("group", { summary: none, summaryAggregate: none, collapsed: none })),
            trow("bad", "G", spanKind),
            trow("x", undefined, spanKind),
            trow("bad2", undefined, spanKind),
        ];
        const index = indexRows(rows);
        const diag = new Map([["bad", { kind: "axis" as const, found: "time" as const, expected: "number" as const }],
            ["bad2", { kind: "axis" as const, found: "time" as const, expected: "number" as const }]]);
        // G collapsed: its band is the first thing on screen that holds one.
        expect(firstDiagnosticItem([rowItem("G", true), rowItem("x"), rowItem("bad2")], index, diag)).toBe(0);
        // G open: the row itself.
        expect(firstDiagnosticItem([rowItem("G"), rowItem("bad"), rowItem("x"), rowItem("bad2")], index, diag)).toBe(1);
        expect(firstDiagnosticItem([rowItem("x")], index, new Map())).toBeUndefined();
    });
});
