/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Readiness at scale (#859): an evaluation is linear in the rows and the
 * drafts, it is derived once per change of the drafts however often it is
 * read, and a batch of 250,000 failing rows returns its 250,000 issues — no
 * spread into a call throws RangeError past the engine's argument limit.
 */

import { describe, test, expect } from "vitest";
import { ArrayType, IntegerType, StringType, StructType, encodeBeast2For, none, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, SheetEditingType } from "@elaraai/east-ui/internal";
import { authorReadiness } from "./readiness.js";
import { liftDraft } from "./draft-values.js";
import { SheetTransactions, type EntryVersion, type SheetTransactionBinding } from "./transactions.js";
import type { SheetRowValue } from "./values.js";

type Editing = ValueTypeOf<typeof SheetEditingType>;

const Row = StructType({ id: StringType, qty: IntegerType, hidden: StringType });
const Draft = Sheet.Types.Draft(Row);
const encodeRow = encodeBeast2For(Row);
const READY = variant("ready", null);

/** A wire row with nothing drawn — what the session and the checks see of a source row. */
const WIRE = { owned: false, cells: new Map(), lines: [], band: none, subRows: [] };

describe("authorReadiness at scale", () => {
    test("over 100,000 resident rows and 10,000 drafts, each check runs once and each id is read a bounded number of times", () => {
        const n = 100_000;
        const m = 10_000;
        // Every id read is counted, and a read past a linear budget throws: a
        // search of the rows per draft would read 10⁹ ids — it fails here at once.
        const budget = 10 * (n + m);
        let reads = 0;
        const wire = (id: string): SheetRowValue => {
            const row = { ...WIRE } as unknown as SheetRowValue;
            Object.defineProperty(row, "id", {
                enumerable: true,
                get() {
                    reads += 1;
                    if (reads > budget) throw new Error(`more than ${budget} id reads — not linear`);
                    return id;
                },
            });
            return row;
        };
        const resident = Array.from({ length: n }, (_u, i) => wire(`r${i}`));
        const positions = resident.map((_r, i) => i);
        let checks = 0;
        const editing = {
            readyRow: none,
            readyGroup: some(() => { checks += 1; return READY; }),
            draftType: toEastTypeValue(StringType), entryType: toEastTypeValue(StringType),
            children: some("lines"), driverColumn: none, keyed: false,
            readEntry: () => none,
        } as unknown as Editing;
        const entries = new Map<string, EntryVersion>();
        for (let k = 0; k < m; k++) {
            // Half edit a resident row where it stands; half are new rows placed after one.
            const id = k % 2 === 0 ? `r${(k * 7919) % n}` : `n${k}`;
            const place = k % 2 === 0 ? none : some(variant("ordered", variant("after", `r${(k * 104729) % n}`)));
            entries.set(id, { draft: "d", wire: wire(id), place });
        }
        const check = authorReadiness(editing, resident, positions, false)!;
        expect(check(entries)).toEqual(READY);
        expect(checks).toBe(m);
        expect(reads).toBeLessThanOrEqual(budget);
    });
});

describe("the session's readiness", () => {
    const rowOf = (id: string, qty = 1n) => ({ id, qty, hidden: `hidden ${id}` });
    const version = (id: string, qty = 1n): EntryVersion => ({ draft: liftDraft(Draft, rowOf(id, qty)), wire: { ...WIRE, id }, place: none });
    const resident: SheetRowValue[] = ["a", "b", "c"].map((id) => ({ ...WIRE, id }) as unknown as SheetRowValue);
    const binding = (ready: SheetTransactionBinding["ready"]): SheetTransactionBinding => ({
        sourceId: "readiness-859", entryType: Row, draftType: Draft, auto: false,
        apply: () => variant("applied", { revision: some("r2") }), patch: undefined, refresh: undefined, ready,
    });

    test("is derived once per change of the drafts, however often it is read — each draft checked once, each source row read once", () => {
        let checks = 0;
        let sourceReads = 0;
        const editing = {
            readyRow: some(() => { checks += 1; return READY; }),
            readyGroup: none,
            draftType: toEastTypeValue(Draft), entryType: toEastTypeValue(Row),
            children: none, driverColumn: none, keyed: false,
            readEntry: (id: string) => { sourceReads += 1; return some(encodeRow(rowOf(id))); },
        } as unknown as Editing;
        const session = new SheetTransactions(binding(authorReadiness(editing, resident, [0, 1, 2], false)));
        session.observeBase(variant("revision", "r1"));
        /** The checks the next reads cost. */
        const readTimes = (times: number) => {
            const before = checks;
            for (let i = 0; i < times; i++) expect(session.readiness).toEqual(READY);
            void session.canApply;
            return checks - before;
        };
        session.record([
            { id: "a", before: version("a"), after: version("a", 7n) },
            { id: "b", before: version("b"), after: version("b", 8n) },
        ], "typed", "Edit two");
        // The gesture's own patch event derived it: two drafts, two checks, and reads are free.
        expect(checks).toBe(2);
        expect(readTimes(5)).toBe(0);
        session.record([{ id: "c", before: version("c"), after: version("c", 9n) }], "typed", "Edit c");
        expect(checks).toBe(5);
        expect(readTimes(5)).toBe(0);
        session.undo();
        expect(checks).toBe(8);
        expect(readTimes(3)).toBe(0);
        // Four evaluations, one generation of the source: its three rows were read once.
        expect(sourceReads).toBe(3);
        // A new binding — new resident rows, a new check — derives it afresh on the next read, reading them again.
        session.bind(binding(authorReadiness(editing, resident, [0, 1, 2], false)));
        expect(readTimes(3)).toBe(3);
        expect(sourceReads).toBe(6);
    });

    test("250,000 failing rows return 250,000 issues — from the author's check and from the drafts' schema", () => {
        const failing = Array.from({ length: 250_000 }, (_u, i) => ({ entry: `r${i}`, row: none, field: some("qty"), message: "A value is required" }));
        const author = new SheetTransactions(binding(() => variant("incomplete", failing)));
        const fromAuthor = author.readiness;
        expect(fromAuthor.type).toBe("incomplete");
        if (fromAuthor.type !== "ready") expect(fromAuthor.value).toHaveLength(250_000);
        // One group of 250,000 lines, each missing a required field.
        const Group = StructType({ id: StringType, rows: ArrayType(Row) });
        const GroupDraft = Sheet.Types.DraftGroup(Group, "rows");
        const schema = new SheetTransactions({ ...binding(undefined), entryType: Group, draftType: GroupDraft, children: "rows" });
        schema.observeBase(variant("revision", "r1"));
        const draft = {
            id: variant("value", "g"),
            rows: Array.from({ length: 250_000 }, (_u, i) => ({ id: variant("value", `c${i}`), qty: variant("value", 1n), hidden: variant("missing", null) })),
        };
        schema.record([{ id: "g", before: { draft: undefined, wire: undefined, place: none }, after: { draft, wire: undefined, place: none } }], "insert", "Paste lines");
        const fromSchema = schema.readiness;
        expect(fromSchema.type).toBe("incomplete");
        if (fromSchema.type !== "ready") expect(fromSchema.value).toHaveLength(250_000);
    }, 60_000);
});
