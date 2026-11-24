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
 * The keyboard map as a model (#819): what every key does from every kind of
 * grid item — rows, sections, charts, strips, a links focus's bands and the
 * bands standing for a paged source's unloaded runs — and how a move across a
 * band waits for its rows.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import {
    indexRows, type LinkFamily, type PlanBodyItem, type PlanFocusBand, type PlanFocusCtx, type PlanFocusRole, type PlanRowValue, type VisibleRow,
} from "../model.js";
import { planNavItems, planNavKey, resolveNavIntent, type PlanNavItem } from "./keyboard.js";
import { rowId } from "../plan.test-utils.js";

/** One canvas row. The keyboard map treats keys as opaque, so these key by
 *  the test's own words (`r:G` is `G`'s item) rather than their ids' text. */
function row(key: string, kind: unknown, parent?: string): PlanRowValue {
    return {
        id: rowId(key),
        key,
        parent: parent !== undefined ? some(parent) : none,
        gutter: { label: key, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind,
        collapsed: false, pinned: false, height: none, status: none, expand: none,
        duplicateOf: undefined,
    } as unknown as PlanRowValue;
}
const span = () => variant("span", { runs: [], decisions: [], ports: [], rollup: none });
const group = (): PlanRowValue["kind"] => variant("group", { summary: variant("none", null) });
const chart = (expandable: boolean) => variant("chart", {
    layers: [], left: none, right: none, height: variant("spark", null), expandedHeight: none, expandable,
    grid: true, legend: true, tooltip: true,
});

const G = row("G", group());
const P = row("P", span(), "G");
const C1 = row("c1", span(), "P");
const C2 = row("c2", span(), "P");
const K = row("k", chart(true));
const INDEX = indexRows([G, P, C1, C2, K]);
const vis = (r: PlanRowValue, depth: number, collapsed = false): PlanBodyItem =>
    ({ kind: "row", row: { row: r, depth, collapsed } as VisibleRow });

/** A links focus's family that gathers nothing but the focused row. */
const NO_FAMILY: LinkFamily = { upstream: new Set(), downstream: new Set(), all: new Set() };

/** A row focus, as the canvas holds it — a links focus with no family. */
const focusOf = (focus: { kind: "links" | "expand"; key: string }): PlanFocusCtx =>
    (focus.kind === "links" ? { ...focus, links: { family: NO_FAMILY, others: false } } : focus);

/** The grid as the keyboard sees it — every item 32px tall. */
function items(body: PlanBodyItem[], opts: { chartsExpanded?: string[]; focus?: { kind: "links" | "expand"; key: string } } = {}): PlanNavItem[] {
    return planNavItems({
        pinned: [], pinnedHeights: [],
        items: body, heights: body.map(() => 32),
        index: INDEX,
        chartsExpanded: new Set(opts.chartsExpanded ?? []),
        focusCtx: opts.focus !== undefined ? focusOf(opts.focus) : undefined,
    });
}

const OPEN = [vis(G, 0), vis(P, 1), vis(C1, 2), vis(C2, 2), vis(K, 0)];

describe("rows (#819)", () => {
    test("↑ / ↓ step between items, and stop at the ends", () => {
        const nav = items(OPEN);
        expect(planNavKey(nav, "r:G", "ArrowDown", 0)).toEqual({ t: "focus", key: "r:P", align: "auto" });
        expect(planNavKey(nav, "r:c1", "ArrowUp", 0)).toEqual({ t: "focus", key: "r:P", align: "auto" });
        expect(planNavKey(nav, "r:k", "ArrowDown", 0)).toEqual({ t: "none" });
        expect(planNavKey(nav, "r:G", "ArrowUp", 0)).toEqual({ t: "none" });
    });

    test("Home / End go to the first and last rows; PgUp / PgDn a viewport at a time", () => {
        const nav = items(OPEN);
        expect(planNavKey(nav, "r:c2", "Home", 0)).toEqual({ t: "focus", key: "r:G", align: "auto" });
        expect(planNavKey(nav, "r:P", "End", 0)).toEqual({ t: "focus", key: "r:k", align: "auto" });
        expect(planNavKey(nav, "r:G", "Home", 0)).toEqual({ t: "none" });
        // 70px of viewport, 32px rows: a page is three rows on.
        expect(planNavKey(nav, "r:G", "PageDown", 70)).toEqual({ t: "focus", key: "r:c2", align: "auto" });
        expect(planNavKey(nav, "r:k", "PageUp", 70)).toEqual({ t: "focus", key: "r:P", align: "auto" });
        // A page past the end stops at the last row.
        expect(planNavKey(nav, "r:c2", "PageDown", 1000)).toEqual({ t: "focus", key: "r:k", align: "auto" });
    });

    test("← closes an open section, then steps to its parent; → opens a closed one, then steps into it", () => {
        const nav = items(OPEN);
        expect(planNavKey(nav, "r:P", "ArrowLeft", 0))
            .toEqual({ t: "event", event: { t: "group.toggle", key: "P" }, focus: "r:P" });
        expect(planNavKey(nav, "r:c1", "ArrowLeft", 0)).toEqual({ t: "focus", key: "r:P", align: "auto" });
        expect(planNavKey(nav, "r:P", "ArrowRight", 0)).toEqual({ t: "focus", key: "r:c1", align: "auto" });
        // A leaf has nowhere further in.
        expect(planNavKey(nav, "r:c1", "ArrowRight", 0)).toEqual({ t: "none" });
        const closed = items([vis(G, 0), vis(P, 1, true), vis(K, 0)]);
        expect(planNavKey(closed, "r:P", "ArrowRight", 0))
            .toEqual({ t: "event", event: { t: "group.toggle", key: "P" }, focus: "r:P" });
        // A closed section's ← steps out, to its group.
        expect(planNavKey(closed, "r:P", "ArrowLeft", 0)).toEqual({ t: "focus", key: "r:G", align: "auto" });
    });

    test("an expandable chart opens and closes on → / ← and Space, like a section", () => {
        expect(planNavKey(items(OPEN), "r:k", "ArrowRight", 0))
            .toEqual({ t: "event", event: { t: "chart.toggle", key: "k" }, focus: "r:k" });
        const open = items(OPEN, { chartsExpanded: ["k"] });
        expect(planNavKey(open, "r:k", "ArrowLeft", 0))
            .toEqual({ t: "event", event: { t: "chart.toggle", key: "k" }, focus: "r:k" });
        expect(planNavKey(open, "r:k", " ", 0))
            .toEqual({ t: "event", event: { t: "chart.toggle", key: "k" }, focus: "r:k" });
    });

    test("Enter does what a click does: a row selects, a group band toggles; Space toggles, or does nothing", () => {
        const nav = items(OPEN);
        expect(planNavKey(nav, "r:c1", "Enter", 0))
            .toEqual({ t: "event", event: { t: "row.select", key: "c1" }, focus: "r:c1" });
        expect(planNavKey(nav, "r:G", "Enter", 0))
            .toEqual({ t: "event", event: { t: "group.toggle", key: "G" }, focus: "r:G" });
        expect(planNavKey(nav, "r:G", " ", 0))
            .toEqual({ t: "event", event: { t: "group.toggle", key: "G" }, focus: "r:G" });
        expect(planNavKey(nav, "r:c1", " ", 0)).toEqual({ t: "none" });
    });

    test("the canvas-wide keys are not the row map's", () => {
        const nav = items(OPEN);
        for (const key of ["Escape", "n", "[", "]", "g", "Tab", "x"]) expect(planNavKey(nav, "r:G", key, 0)).toBeUndefined();
        expect(planNavKey(nav, "r:gone", "ArrowDown", 0)).toBeUndefined();
    });
});

describe("strips and a links focus's bands (#819, #1680's review)", () => {
    test("a context strip, and a pinned row a links focus does not gather, return on Enter, and have no caret to toggle", () => {
        const strips = items(OPEN, { focus: { kind: "expand", key: "c1" } });
        expect(planNavKey(strips, "r:k", "Enter", 0)).toEqual({ t: "event", event: { t: "focus.clear" }, focus: "r:k" });
        expect(planNavKey(strips, "r:k", " ", 0)).toEqual({ t: "none" });
        // The focused row itself still selects.
        expect(planNavKey(strips, "r:c1", "Enter", 0))
            .toEqual({ t: "event", event: { t: "row.select", key: "c1" }, focus: "r:c1" });
        // Pinned, above the body, the expandable chart strips under a links focus that does not gather it.
        const pinned = planNavItems({
            pinned: [{ row: { ...K, pinned: true }, depth: 0, collapsed: false }], pinnedHeights: [16],
            items: [], heights: [], index: INDEX, chartsExpanded: new Set(), focusCtx: focusOf({ kind: "links", key: "c1" }),
        });
        expect(planNavKey(pinned, "r:k", "Enter", 0)).toEqual({ t: "event", event: { t: "focus.clear" }, focus: "r:k" });
        expect(planNavKey(pinned, "r:k", " ", 0)).toEqual({ t: "none" });
    });

    test("a role's band is a heading; a row it gathers steps ← to it and opens nothing; the others' band opens and folds as a section does", () => {
        const gathered = (r: PlanRowValue, role: PlanFocusRole): PlanBodyItem =>
            ({ kind: "row", row: { row: r, depth: 1, collapsed: false, gathered: { role, path: ["G"] } } });
        const band = (role: PlanFocusBand["role"], open = true): PlanBodyItem => ({ kind: "focus", band: { role, count: 1, open } });
        const body = [band("upstream"), gathered(P, "upstream"), band("focused"), gathered(C1, "focused"), band("downstream"), band("others", false)];
        const nav = items(body, { focus: { kind: "links", key: "c1" } });
        expect(planNavKey(nav, "l:upstream", "Enter", 0)).toEqual({ t: "none" });
        expect(planNavKey(nav, "l:upstream", " ", 0)).toEqual({ t: "none" });
        expect(planNavKey(nav, "l:upstream", "ArrowDown", 0)).toEqual({ t: "focus", key: "r:P", align: "auto" });
        // P nests c1 and c2, but gathered, it opens nothing: its subtree is the others'.
        expect(planNavKey(nav, "r:P", "ArrowLeft", 0)).toEqual({ t: "focus", key: "l:upstream", align: "auto" });
        expect(planNavKey(nav, "r:P", "ArrowRight", 0)).toEqual({ t: "none" });
        expect(planNavKey(nav, "r:P", "Enter", 0)).toEqual({ t: "event", event: { t: "row.select", key: "P" }, focus: "r:P" });
        // Folded, Enter, Space and → open the others' band; open, ← and Space fold it, and → goes nowhere.
        for (const key of ["Enter", " ", "ArrowRight"]) {
            expect(planNavKey(nav, "l:others", key, 0)).toEqual({ t: "event", event: { t: "focus.others" }, focus: "l:others" });
        }
        const open = items([...body.slice(0, -1), band("others")], { focus: { kind: "links", key: "c1" } });
        for (const key of ["ArrowLeft", " "]) {
            expect(planNavKey(open, "l:others", key, 0)).toEqual({ t: "event", event: { t: "focus.others" }, focus: "l:others" });
        }
        expect(planNavKey(open, "l:others", "ArrowRight", 0)).toEqual({ t: "none" });
    });

    test("a lane band is no item: ↓ steps over it, and the row above takes its height, so a page travels as far as the rows do (#1680's review)", () => {
        const gathered = (r: PlanRowValue): PlanBodyItem =>
            ({ kind: "row", row: { row: r, depth: 1, collapsed: false, gathered: { role: "upstream", path: [] } } });
        const lane: PlanBodyItem = { kind: "lanes", lanes: { rule: 1, px: 12, above: K.key } };
        const nav = items([gathered(P), lane, gathered(K)], { focus: { kind: "links", key: "P" } });
        // Every item 32 tall in this grid: P takes the band's 32 with its own.
        expect(nav.map((n) => [n.key, n.h])).toEqual([["r:P", 64], [`r:${K.key}`, 32]]);
        expect(planNavKey(nav, "r:P", "ArrowDown", 0)).toEqual({ t: "focus", key: `r:${K.key}`, align: "auto" });
    });
});

describe("bands (#819)", () => {
    const head: PlanBodyItem = { kind: "band", band: { block: 0, at: "head", from: 0, to: 399, px: 12_800 } };
    const tail: PlanBodyItem = { kind: "band", band: { block: 0, at: "tail", from: 800, to: 4_999, px: 134_400 } };
    const PAGED = [head, vis(C1, 0), vis(C2, 0), tail];

    test("a step past the rows read asks for the window beside the run, the focus waiting where it is — never on the run, no scroll (#1398, CL10)", () => {
        const nav = items(PAGED);
        expect(planNavKey(nav, "r:c2", "ArrowDown", 0)).toEqual({
            t: "fetch", demand: { kind: "band", block: 0, at: "tail" }, intent: { t: "step", from: "r:c2", dir: 1 },
        });
        expect(planNavKey(nav, "r:c1", "ArrowUp", 0)).toEqual({
            t: "fetch", demand: { kind: "band", block: 0, at: "head" }, intent: { t: "step", from: "r:c1", dir: -1 },
        });
    });

    test("Home and End past a run read the source's first or last window where it is — the view staying put — and land on its row once it is in (#1398, CL10)", () => {
        const nav = items(PAGED);
        expect(planNavKey(nav, "r:c1", "Home", 0)).toEqual({ t: "edge", edge: "first" });
        expect(planNavKey(nav, "r:c1", "End", 0)).toEqual({ t: "edge", edge: "last" });
        // From the run itself too: the run at the end is no row to stop on.
        expect(planNavKey(nav, "b:0:tail", "End", 0)).toEqual({ t: "edge", edge: "last" });
    });

    test("a band names its block — a move past the rows read asks that block (#823)", () => {
        const second: PlanBodyItem = { kind: "band", band: { block: 2, at: "head", from: 0, to: 199, px: 640 } };
        const nav = items([vis(C1, 0), vis(C2, 0), second]);
        expect(planNavKey(nav, "r:c2", "ArrowDown", 0)).toEqual({
            t: "fetch", demand: { kind: "band", block: 2, at: "head" }, intent: { t: "step", from: "r:c2", dir: 1 },
        });
    });

    test("a page onto a band asks for the window past it, headed the rest of its way (#1398, CL10)", () => {
        const nav = items(PAGED);
        // 1,000px of viewport: c2 is 32px on, and the rest of the page waits past the band.
        expect(planNavKey(nav, "r:c1", "PageDown", 1000)).toEqual({
            t: "fetch", demand: { kind: "band", block: 0, at: "tail" }, intent: { t: "page", from: "r:c2", dir: 1, rest: 968, by: "px" },
        });
        expect(planNavKey(nav, "r:c2", "PageUp", 70)).toEqual({
            t: "fetch", demand: { kind: "band", block: 0, at: "head" }, intent: { t: "page", from: "r:c1", dir: -1, rest: 38, by: "px" },
        });
        // A viewport not yet measured pages by rows.
        expect(planNavKey(nav, "r:c2", "PageDown", 0)).toEqual({
            t: "fetch", demand: { kind: "band", block: 0, at: "tail" }, intent: { t: "page", from: "r:c2", dir: 1, rest: 10, by: "items" },
        });
    });

    test("a key that moves through a run holding the focus waits for its rows (#1398, CL10)", () => {
        const nav = items(PAGED);
        for (const key of ["ArrowDown", "ArrowUp", "PageDown", "PageUp"] as const) expect(planNavKey(nav, "b:0:tail", key, 70)).toEqual({ t: "wait", key });
        expect(planNavKey(nav, "b:0:head", "PageDown", 70)).toEqual({ t: "wait", key: "PageDown" });
    });

    test("a page across a band lands a page on once the rows past it land — never at the loaded edge, never on a band (#1398, CL10)", () => {
        const intent = { t: "page" as const, from: "r:c2", dir: 1 as const, rest: 70, by: "px" as const };
        // The window past the band is still on its way.
        expect(resolveNavIntent(items(PAGED), intent, MIDDLE)).toEqual({ t: "pending" });
        const [C3, C4, C5, C6] = ["c3", "c4", "c5", "c6"].map((key) => row(key, span()));
        const landed = (rows: PlanRowValue[], after: PlanBodyItem[] = [tail]) => planNavItems({
            pinned: [], pinnedHeights: [],
            items: [head, vis(C1, 0), vis(C2, 0), ...rows.map((r) => vis(r, 0)), ...after], heights: [1, 32, 32, ...rows.map(() => 32), ...after.map(() => 1)],
            index: indexRows([C1, C2, ...rows]), chartsExpanded: new Set(), focusCtx: undefined,
        });
        // Landed: 70px on from c2 is three rows on.
        expect(resolveNavIntent(landed([C3!, C4!, C5!, C6!]), intent, MIDDLE)).toEqual({ t: "resolved", key: "r:c5" });
        // Fewer rows landed than the page: never the last before the band still unread — the window past it is asked for,
        // and the page waits for it.
        expect(resolveNavIntent(landed([C3!]), intent, MIDDLE)).toEqual({ t: "pending", ask: { kind: "band", block: 0, at: "tail" } });
        // The source's end on the way: its last row.
        expect(resolveNavIntent(landed([C3!], []), intent, MIDDLE)).toEqual({ t: "resolved", key: "r:c3" });
        // By rows, where the viewport was not measured.
        expect(resolveNavIntent(landed([C3!, C4!, C5!, C6!]), { ...intent, rest: 2, by: "items" }, MIDDLE)).toEqual({ t: "resolved", key: "r:c4" });
        // The row it set out from is gone: cancelled.
        expect(resolveNavIntent(items([head, vis(C1, 0), tail]), intent, MIDDLE)).toEqual({ t: "cancel" });
    });

    const MIDDLE = { loading: false, atStart: false, atEnd: false };
    const WHOLE = { loading: false, atStart: true, atEnd: true };

    test("a pending move resolves to the row its key was headed for, once that row has landed", () => {
        const intent = { t: "step" as const, from: "r:c2", dir: 1 as const };
        expect(resolveNavIntent(items(PAGED), intent, MIDDLE)).toEqual({ t: "pending" });
        const C3 = row("c3", span());
        const landed = planNavItems({
            pinned: [], pinnedHeights: [],
            items: [head, vis(C1, 0), vis(C2, 0), vis(C3, 0), tail], heights: [1, 32, 32, 32, 1],
            index: indexRows([C1, C2, C3]), chartsExpanded: new Set(), focusCtx: undefined,
        });
        expect(resolveNavIntent(landed, intent, MIDDLE)).toEqual({ t: "resolved", key: "r:c3" });
        // The row it set out from is gone (evicted, collapsed away): cancelled.
        expect(resolveNavIntent(items([head, vis(C1, 0), tail]), intent, MIDDLE)).toEqual({ t: "cancel" });
    });

    test("with no band past the last row, the move waits while a window loads, and ends once nothing will", () => {
        // A source that reports no total has no bands, while its windows are on the wire.
        const loaded = items([vis(C1, 0), vis(C2, 0)]);
        const intent = { t: "step" as const, from: "r:c2", dir: 1 as const };
        expect(resolveNavIntent(loaded, intent, { ...MIDDLE, loading: true })).toEqual({ t: "pending" });
        expect(resolveNavIntent(loaded, intent, WHOLE)).toEqual({ t: "cancel" });
    });

    test("Home and End resolve only once the source's own first and last elements are resident", () => {
        const loaded = items([vis(C1, 0), vis(C2, 0)]);
        // The rows showing are not the source's ends while its windows load.
        expect(resolveNavIntent(loaded, { t: "last", from: "r:c1" }, { loading: true, atStart: true, atEnd: false })).toEqual({ t: "pending" });
        expect(resolveNavIntent(loaded, { t: "first", from: "r:c2" }, { loading: true, atStart: false, atEnd: true })).toEqual({ t: "pending" });
        expect(resolveNavIntent(loaded, { t: "last", from: "r:c1" }, WHOLE)).toEqual({ t: "resolved", key: "r:c2" });
        expect(resolveNavIntent(loaded, { t: "first", from: "r:c2" }, WHOLE)).toEqual({ t: "resolved", key: "r:c1" });
        // A band at the end is never the answer.
        expect(resolveNavIntent(items(PAGED), { t: "first", from: "r:c2" }, WHOLE)).toEqual({ t: "pending" });
    });

    test("Home and End are cancelled once the row they set out from is gone before the far end is in — the rows they waited among another's now (#1398, CL10)", () => {
        // A new narrowing's rows, the row Home set out from not among them, the source's start not yet resident.
        const other = items([vis(C2, 0), tail]);
        expect(resolveNavIntent(other, { t: "first", from: "r:c1" }, MIDDLE)).toEqual({ t: "cancel" });
        expect(resolveNavIntent(other, { t: "last", from: "r:c1" }, MIDDLE)).toEqual({ t: "cancel" });
        // In: it lands, wherever it set out from.
        expect(resolveNavIntent(items([vis(C2, 0)]), { t: "last", from: "r:c1" }, WHOLE)).toEqual({ t: "resolved", key: "r:c2" });
    });

    test("a failed window is a row of its own — a move onto it resolves there", () => {
        const failed: PlanBodyItem = { kind: "failed", failure: { block: 0, w: 2, from: 400, to: 599, px: 64, error: "boom" } };
        const nav = items([vis(C1, 0), failed, vis(C2, 0)]);
        expect(planNavKey(nav, "r:c1", "ArrowDown", 0)).toEqual({ t: "focus", key: "f:0:2", align: "auto" });
        expect(resolveNavIntent(nav, { t: "step", from: "r:c1", dir: 1 }, MIDDLE)).toEqual({ t: "resolved", key: "f:0:2" });
    });
});
