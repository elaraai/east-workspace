/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The copilot runner over stub wire functions (Sheet Spec §6.2, §5 rows
 * 10–12): first-yields by position, the cells it never touches, the memo,
 * async work and its settlement, the proposers' cap and rejection memory.
 */

import { describe, test, expect, vi } from "vitest";
import { runSuggest, SuggestMemo, hashRow, type WireProvider, type FillColumn, type SuggestInput } from "./suggest.js";
import { NO_REJECTIONS } from "./sheet-types.js";
import type { SheetCellValue, SheetContextValue, SheetRowValue } from "./values.js";

const cell = (type: string, value: unknown): SheetCellValue => ({ type, value } as SheetCellValue);
const NULL = cell("Null", null);
const yields = (value: SheetCellValue, meta: string) => ({ type: "some", value: { value, meta } });
const NOTHING = { type: "none", value: null };
const row = (cells: Record<string, SheetCellValue>, owned = false): SheetRowValue => ({ id: "r1", owned, cells: new Map(Object.entries(cells)) });
const contextOf = (r: SheetRowValue): SheetContextValue => ({ row: r.cells } as unknown as SheetContextValue);
const sync = (fn: (ctx: SheetContextValue) => unknown): WireProvider => ({ type: "sync", value: fn });
const later = (fn: (ctx: SheetContextValue) => Promise<unknown>): WireProvider => ({ type: "async", value: fn as (ctx: SheetContextValue) => unknown });
const col = (key: string, providers: WireProvider[], kind = "text", editable = true): FillColumn => ({ key, kind: kind as FillColumn["kind"], editable, providers });
const proposal = (activity: string, meta: string) => ({ cells: new Map([["activity", cell("String", activity)]]), meta });

const ANCHOR = row({ activity: cell("String", "Transfer"), vol: NULL, notes: NULL });

function run(over: Partial<SuggestInput> = {}) {
    return runSuggest({
        anchorId: "r1", row: ANCHOR, skipKey: undefined, columns: [], proposers: [], ahead: 2, nextBusy: false,
        driverKey: "Transfer", driverColumn: "activity", rejected: NO_REJECTIONS, contextOf, memo: new SuggestMemo(), ...over,
    });
}

describe("fills", () => {
    test("the first provider that yields wins, by position; an occupied cell, the edited column, a dismissed fill and an owned row are never filled", () => {
        const columns = [
            col("vol", [sync(() => NOTHING), sync(() => yields(cell("Float", 560000), "like r0")), sync(() => yields(cell("Float", 1), "never"))], "quantity"),
            col("notes", [sync(() => yields(cell("String", "phrase"), "phrasing"))]),
        ];
        const out = run({ columns });
        expect(out.sugg?.fill.get("vol")).toEqual({ cell: cell("Float", 560000), meta: "like r0", index: 1 });
        expect(out.sugg?.fill.get("notes")).toEqual({ cell: cell("String", "phrase"), meta: "phrasing", index: 0 });
        expect(out.async).toEqual([]);
        // Occupied: the notes cell holds text.
        const busy = run({ columns, row: row({ activity: cell("String", "Transfer"), vol: NULL, notes: cell("String", "written") }) });
        expect(busy.sugg?.fill.has("notes")).toBe(false);
        // The column being edited is not filled.
        expect(run({ columns, skipKey: "vol" }).sugg?.fill.has("vol")).toBe(false);
        // A dismissed fill is not asked for again on that row.
        expect(run({ columns, rejected: { fills: new Set(["r1|vol"]), follows: new Set() } }).sugg?.fill.has("vol")).toBe(false);
        // An owned row is never touched; a read-only column never filled.
        expect(run({ columns, row: row({ activity: cell("String", "Transfer"), vol: NULL, notes: NULL }, true) }).sugg).toBeNull();
        expect(run({ columns: [col("vol", [sync(() => yields(cell("Float", 1), ""))], "quantity", false)] }).sugg).toBeNull();
    });

    test("the edited link column is predicted into: its providers see the row with that cell blank", () => {
        const seen: unknown[] = [];
        const predicted = cell("Link", { from: [], to: [{ type: "identified", value: { key: "T2141" } }] });
        const columns = [col("tanks", [sync((ctx) => { seen.push((ctx as unknown as { row: Map<string, SheetCellValue> }).row.get("tanks")); return yields(predicted, "same vessels"); })], "link")];
        const half = cell("Link", { from: [{ type: "identified", value: { key: "T2140" } }], to: [] });
        const out = run({ columns, skipKey: "tanks", row: row({ activity: cell("String", "Transfer"), tanks: half }) });
        expect(out.sugg?.fill.get("tanks")?.meta).toBe("same vessels");
        expect(seen[0]).toEqual(NULL);
    });

    test("fills chain in column order: a later column's providers and the proposers see the earlier fills as if taken", () => {
        const seenVol: unknown[] = [];
        const seenByProposer: unknown[] = [];
        const columns = [
            col("vol", [sync(() => yields(cell("Float", 560000), "like r0"))], "quantity"),
            col("notes", [sync((ctx) => { seenVol.push((ctx as unknown as { row: Map<string, SheetCellValue> }).row.get("vol")); return yields(cell("String", "Transfer 560m³"), "phrase"); })]),
        ];
        const proposers = [sync((ctx) => { seenByProposer.push((ctx as unknown as { row: Map<string, SheetCellValue> }).row.get("notes")); return [proposal("Filtration", "follows")]; })];
        const out = run({ columns, proposers });
        expect(seenVol[0]).toEqual(cell("Float", 560000));
        expect(seenByProposer[0]).toEqual(cell("String", "Transfer 560m³"));
        expect(out.sugg?.fill.size).toBe(2);
        expect(out.sugg?.rows).toHaveLength(1);
    });

    test("results are memoised per provisional row: the same row asks a provider once, a changed row asks again", () => {
        const provider = vi.fn(() => yields(cell("Float", 1), "m"));
        const columns = [col("vol", [sync(provider)], "quantity")];
        const memo = new SuggestMemo();
        run({ columns, memo });
        run({ columns, memo });
        expect(provider).toHaveBeenCalledTimes(1);
        run({ columns, memo, row: row({ activity: cell("String", "Filtration"), vol: NULL, notes: NULL }) });
        expect(provider).toHaveBeenCalledTimes(2);
        expect(hashRow(ANCHOR)).not.toBe(hashRow(row({ activity: cell("String", "Filtration"), vol: NULL, notes: NULL })));
    });

    test("a throwing provider yields nothing with a diagnostic, and the next one answers", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const columns = [col("vol", [sync(() => { throw new Error("boom"); }), sync(() => yields(cell("Float", 2), "fallback"))], "quantity")];
        const out = run({ columns });
        expect(out.sugg?.fill.get("vol")?.meta).toBe("fallback");
        expect(error).toHaveBeenCalledWith(expect.stringContaining('fill provider #1 on column "vol"'), expect.any(Error));
        error.mockRestore();
    });

    test("an async provider is returned as work; a later sync provider answers meanwhile; the settlement lands with its position; a re-run re-attaches to the promise, and after it settles the memo answers", async () => {
        let resolve: (v: unknown) => void = () => {};
        const promise = new Promise<unknown>((r) => { resolve = r; });
        const columns = [col("vol", [later(() => promise), sync(() => yields(cell("Float", 2), "meanwhile"))], "quantity")];
        const memo = new SuggestMemo();
        const out = run({ columns, memo });
        expect(out.sugg?.fill.get("vol")).toEqual({ cell: cell("Float", 2), meta: "meanwhile", index: 1 });
        expect(out.sugg?.pending).toEqual(["vol"]);
        expect(out.async.map((w) => [w.key, w.index])).toEqual([["vol", 0]]);
        // A re-run while in flight re-attaches instead of restarting.
        const again = run({ columns, memo });
        expect(again.async).toHaveLength(1);
        resolve(yields(cell("Float", 1), "the model"));
        const landed = await out.async[0]!.run();
        expect(landed).toEqual({ kind: "fill", fill: { cell: cell("Float", 1), meta: "the model", index: 0 } });
        // Settled: the memo answers synchronously, by position — the async result outranks the later sync one.
        const settled = run({ columns, memo });
        expect(settled.sugg?.fill.get("vol")).toEqual({ cell: cell("Float", 1), meta: "the model", index: 0 });
        expect(settled.sugg?.pending).toEqual([]);
        expect(settled.async).toEqual([]);
    });

    test("a rejected async provider lands as nothing, with a diagnostic", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const columns = [col("vol", [later(() => Promise.reject(new Error("nope")))], "quantity")];
        const out = run({ columns });
        expect(out.sugg?.fill.size).toBe(0);
        expect(out.sugg?.pending).toEqual(["vol"]);
        expect(await out.async[0]!.run()).toEqual({ kind: "fill", fill: null });
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });
});

describe("proposals", () => {
    test("the first proposer that returns rows wins, capped at `ahead`; never into an occupied slot; minus the rejected pairings; an async proposer is pending under `rows`", async () => {
        const proposers = [
            sync(() => []),
            sync(() => [proposal("Filtration", "a"), proposal("Media - Add to Tank", "b"), proposal("Transfer", "c")]),
            sync(() => [proposal("Centrifuge", "never")]),
        ];
        const out = run({ proposers });
        expect(out.sugg?.rows.map((r) => r.meta)).toEqual(["a", "b"]);
        expect(run({ proposers, nextBusy: true }).sugg).toBeNull();
        const rejected = run({ proposers, rejected: { fills: new Set(), follows: new Set(["Transfer>Filtration"]) } });
        expect(rejected.sugg?.rows.map((r) => r.meta)).toEqual(["b", "c"]);
        // Async: pending under `rows`, landing with the admitted rows.
        const later1 = run({ proposers: [later(() => Promise.resolve([proposal("Filtration", "model")]))] });
        expect(later1.sugg?.rows).toEqual([]);
        expect(later1.sugg?.pending).toEqual(["rows"]);
        expect(await later1.async[0]!.run()).toEqual({ kind: "rows", rows: [proposal("Filtration", "model")] });
    });
});
