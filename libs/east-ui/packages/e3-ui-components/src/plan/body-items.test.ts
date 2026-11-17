/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 */

/**
 * The canvas body's items (`body-items.ts`) — the bands a links focus gathers
 * its family under and the link graph, and where a failed window's band goes
 * (#811).
 *
 * (Split out of `model.test.ts` with the module it tests, #815.)
 */

import { describe, test, expect } from "vitest";
import { some, none, variant } from "@elaraai/east";
import {
    deriveLinkFamily, focusBodyItems, focusGathers, focusRoleCounts, focusRoleOf, indexRows, linkedRowKeys, placeFailures,
    firstDiagnosticItem, toCanvasRows,
    type PlanBodyItem, type PlanLinkValue, type PlanWindowFailure, type PlanWireRow,
} from "./model.js";
import { rowId, rowKey, testKeyOf } from "./plan.test-utils.js";

/** One WIRE row at a test key, optionally nested, pinned and with a status. */
function wire(key: string, kind: unknown, opts?: { parent?: string; status?: string; pinned?: boolean }): PlanWireRow {
    return {
        id: rowId(key),
        parent: opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        gutter: { label: key.toUpperCase(), id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind,
        collapsed: false, pinned: opts?.pinned === true, height: none,
        status: opts?.status !== undefined ? some(variant(opts.status, null)) : none,
        expand: none,
    } as unknown as PlanWireRow;
}

const spanKind = variant("span", { runs: [], decisions: [], ports: [], rollup: none });
const groupKind: PlanWireRow["kind"] = variant("group", { summary: variant("none", null) });

describe("a links focus's body (#1680's review)", () => {
    // A link names its ends by run ref — a row id and a run key.
    const link = (from: string, to: string): PlanLinkValue => ({
        key: `${from}-${to}`, from: { row: rowId(from), run: "a" }, to: { row: rowId(to), run: "b" }, quantity: none,
    } as unknown as PlanLinkValue);
    /** What a body says, item by item: a band's role and count (`+` open), a row's key with its depth and its path. */
    const words = (items: readonly PlanBodyItem[]) => items.map((i) => {
        switch (i.kind) {
            case "focus": return `[${i.band.role} ${i.band.count}${i.band.open ? "+" : ""}]`;
            case "row": return `${testKeyOf(i.row.row.key)}@${i.row.depth}${i.row.gathered !== undefined ? ` ${i.row.gathered.role}:${i.row.gathered.path.join("/")}` : ""}`;
            default: return i.kind;
        }
    });

    // Hall 1 holds the focused row's upstream u and a row both ways, m; Hall 2 the downstream d and an unrelated x; y
    // stands alone, and a pinned chart p is linked downstream of the focus.
    const rows = toCanvasRows([
        wire("p", spanKind, { pinned: true }),
        wire("h1", groupKind), wire("u", spanKind, { parent: "h1" }), wire("m", spanKind, { parent: "h1" }),
        wire("h2", groupKind), wire("f", spanKind, { parent: "h2" }), wire("d", spanKind, { parent: "h2" }), wire("x", spanKind, { parent: "h2" }),
        wire("y", spanKind),
    ]);
    const index = indexRows(rows);
    const links = [link("u", "f"), link("f", "m"), link("m", "f"), link("f", "d"), link("f", "p")];
    const family = deriveLinkFamily(links, rowKey("f"));

    test("each role's band stands over its rows, in their order, one level in, each saying what it nests under; every other row folds into one band, counted", () => {
        const items = focusBodyItems(index, rowKey("f"), family, { open: false, items: [] });
        expect(words(items)).toEqual([
            "[upstream 1+]", "u@1 upstream:H1",
            "[focused 1+]", "f@1 focused:H2",
            "[linked 1+]", "m@1 linked:H1",
            // d under the band; the pinned p, downstream too, counted with it where it draws, above the body.
            "[downstream 2+]", "d@1 downstream:H2",
            // x and y: the other data rows — the halls' bands not counted, the pinned row above the body not either.
            "[others 2]",
        ]);
    });

    test("a family row the canvas has placed but does not hold — a paged source's evicted window's — counts with its role; one it has never placed does not", () => {
        // f → z and f → w: z sits in an evicted window, w the canvas has never seen.
        const far = deriveLinkFamily([link("f", "d"), link("f", "z"), link("f", "w")], rowKey("f"));
        const placed = (key: string) => key === rowKey("z");
        const items = focusBodyItems(index, rowKey("f"), far, { open: false, items: [] }, placed);
        expect(words(items)).toEqual([
            "[upstream 0+]", "[focused 1+]", "f@1 focused:H2", "[downstream 2+]", "d@1 downstream:H2", "[others 4]",
        ]);
        // Inline, nothing is placed that the canvas does not hold: the rows under the band are the role's.
        expect(words(focusBodyItems(index, rowKey("f"), far, { open: false, items: [] }))[3]).toBe("[downstream 1+]");
    });

    test("opened, the others' band holds the items it is handed, after it", () => {
        const rest: PlanBodyItem[] = [{ kind: "band", band: { block: 0, at: "tail", from: 0, to: 9, px: 320 } }];
        const items = focusBodyItems(index, rowKey("f"), family, { open: true, items: rest });
        expect(words(items).slice(-2)).toEqual(["[others 2+]", "band"]);
        expect(items[items.length - 1]).toBe(rest[0]);
    });

    test("a role with no rows keeps its band, saying none; the Linked band stands only where a row is both ways", () => {
        const one = deriveLinkFamily([link("f", "d")], rowKey("f"));
        expect(words(focusBodyItems(index, rowKey("f"), one, { open: false, items: [] }))).toEqual([
            "[upstream 0+]", "[focused 1+]", "f@1 focused:H2", "[downstream 1+]", "d@1 downstream:H2", "[others 4]",
        ]);
    });

    test("a row is gathered however its section is folded, and a row at the top says no path", () => {
        // y, at the top, upstream of the focus; a row nested two deep says both its parents, outermost first.
        const deep = toCanvasRows([
            wire("s", groupKind), wire("g", groupKind, { parent: "s" }), wire("f", spanKind, { parent: "g" }), wire("y", spanKind),
        ]);
        const items = focusBodyItems(indexRows(deep), rowKey("f"), deriveLinkFamily([link("y", "f")], rowKey("f")), { open: false, items: [] });
        expect(words(items)).toEqual(["[upstream 1+]", "y@1 upstream:", "[focused 1+]", "f@1 focused:S/G", "[downstream 0+]", "[others 0]"]);
    });

    test("a row's role: the focused row, linked both ways, else upstream or downstream; a row the focus does not gather has none", () => {
        expect(["f", "u", "m", "d", "x"].map((k) => focusRoleOf(family, rowKey("f"), rowKey(k))))
            .toEqual(["focused", "upstream", "linked", "downstream", undefined]);
        const focus = { kind: "links" as const, key: rowKey("f"), links: { family, others: false } };
        expect(["f", "u", "p", "x"].map((k) => focusGathers(focus, rowKey(k)))).toEqual([true, true, true, false]);
        // No other focus gathers a row.
        expect(focusGathers({ kind: "expand", key: rowKey("f") }, rowKey("f"))).toBe(false);
    });

    test("the caption counts each role band's rows; a body with no links focus counts none", () => {
        expect(focusRoleCounts(focusBodyItems(index, rowKey("f"), family, { open: false, items: [] })))
            .toEqual({ upstream: 1, linked: 1, downstream: 2 });
        expect(focusRoleCounts([{ kind: "band", band: { block: 0, at: "head", from: 0, to: 9, px: 320 } }])).toBeUndefined();
    });
});

describe("Plan link graph (R1)", () => {
    // A link names its ends by run ref — a row id (#822) and a run key (#824);
    // the graph keys by the ids' text.
    const link = (from: string, to: string): PlanLinkValue => ({
        key: `${from}-${to}`, from: { row: rowId(from), run: "a" }, to: { row: rowId(to), run: "b" },
        quantity: some({ value: 10, unit: some("k sheets"), format: none, text: none }),
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
        // A diamond back-edge lands a row in BOTH sets (gathered under the Linked band).
        const both = deriveLinkFamily([link("f", "m"), link("m", "f")], rowKey("f"));
        expect(both.upstream.has(rowKey("m"))).toBe(true);
        expect(both.downstream.has(rowKey("m"))).toBe(true);
    });

    test("two series' rows over one entry are two ends — never merged by the entry's key", () => {
        // `views` puts one entry on several rows; a link to its chart row is
        // not a link to its span row.
        const links = [{
            key: "l", from: { row: rowId("p03", "press-jobs"), run: "a" }, to: { row: rowId("p04", "press-jobs"), run: "b" },
            quantity: none,
        } as unknown as PlanLinkValue];
        const fam = deriveLinkFamily(links, rowKey("p03", "press-jobs"));
        expect([...fam.downstream]).toEqual([rowKey("p04", "press-jobs")]);
        expect(deriveLinkFamily(links, rowKey("p03", "press-util")).all.size).toBe(0);
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
