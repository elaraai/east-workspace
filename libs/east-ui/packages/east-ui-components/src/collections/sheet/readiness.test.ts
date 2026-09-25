/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Readiness at scale (#859): an evaluation is linear in the rows and the
 * drafts, it is derived once per change of the drafts however often it is
 * read, and a batch of 250,000 failing rows returns its 250,000 issues — no
 * spread into a call throws RangeError past the engine's argument limit. The
 * author's row check runs as one batch per evaluation (#882).
 */

import { describe, test, expect } from "vitest";
import { ArrayType, East, IntegerType, NullType, StringType, StructType, decodeBeast2For, encodeBeast2For, none, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, SheetEditingType, SheetReadyBatchType, UIComponentType } from "@elaraai/east-ui/internal";
import { authorReadiness } from "./readiness.js";
import { liftDraft } from "./draft-values.js";
import { SheetTransactions, type EntryVersion, type SheetTransactionBinding } from "./transactions.js";
import type { SheetRowValue } from "./values.js";

type Editing = ValueTypeOf<typeof SheetEditingType>;

const Row = StructType({ id: StringType, qty: IntegerType, hidden: StringType });
const Draft = Sheet.Types.Draft(Row);
const encodeRow = encodeBeast2For(Row);
const decodeBatch = decodeBeast2For(SheetReadyBatchType);
const READY = variant("ready", null);

/** A wire row with nothing drawn — what the session and the checks see of a source row. */
const WIRE = { owned: false, cells: new Map(), lines: [], band: none, subRows: [] };

/**
 * `n` resident rows and `m` drafts whose every id read is counted: a read past
 * a linear budget throws, so a search of the rows per draft — 10⁹ reads at
 * this scale — fails at once. Half the drafts edit a resident row where it
 * stands; half are new rows placed after one.
 */
function countedDrafts(n: number, m: number) {
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
    const entries = new Map<string, EntryVersion>();
    for (let k = 0; k < m; k++) {
        const id = k % 2 === 0 ? `r${(k * 7919) % n}` : `n${k}`;
        const place = k % 2 === 0 ? none : some(variant("ordered", variant("after", `r${(k * 104729) % n}`)));
        entries.set(id, { draft: "d", wire: wire(id), place });
    }
    return { resident, positions, entries, budget, reads: () => reads };
}

describe("authorReadiness at scale", () => {
    test("over 100,000 resident rows and 10,000 drafts, each check runs once and each id is read a bounded number of times", () => {
        const { resident, positions, entries, budget, reads } = countedDrafts(100_000, 10_000);
        let checks = 0;
        const editing = {
            readyRow: none,
            readyGroup: some(() => { checks += 1; return READY; }),
            draftType: toEastTypeValue(StringType), entryType: toEastTypeValue(StringType),
            children: some("lines"), driverColumn: none, keyed: false,
            readEntry: () => none,
        } as unknown as Editing;
        const check = authorReadiness(editing, resident, positions, false)!;
        expect(check(entries)).toEqual(READY);
        expect(checks).toBe(10_000);
        expect(reads()).toBeLessThanOrEqual(budget);
    });

    test("over 100,000 resident rows and 10,000 drafts, one evaluation sends the row check one batch, and each of its 10,000 checks runs once on its own row (#882)", () => {
        const { resident, positions, entries, budget, reads } = countedDrafts(100_000, 10_000);
        let batches = 0;
        let checks = 0;
        let own = 0;
        const editing = {
            readyRow: some((blob: Uint8Array) => {
                batches += 1;
                const batch = decodeBatch(blob);
                // Every row crosses once: the resident rows and the new ones.
                expect(batch.rows).toHaveLength(105_000);
                return batch.checks.map((c) => {
                    checks += 1;
                    if (entries.has(batch.rows[Number(c.index)]!.id)) own += 1;
                    return READY;
                });
            }),
            readyGroup: none,
            draftType: toEastTypeValue(StringType), entryType: toEastTypeValue(StringType),
            children: none, driverColumn: none, keyed: false,
            readEntry: () => none,
        } as unknown as Editing;
        const check = authorReadiness(editing, resident, positions, false)!;
        expect(check(entries)).toEqual(READY);
        expect(batches).toBe(1);
        expect(checks).toBe(10_000);
        expect(own).toBe(10_000);
        expect(reads()).toBeLessThanOrEqual(budget);
    });
});

describe("the author's row check, one batch per evaluation (#882)", () => {
    const Ready = Sheet.Types.Readiness;
    const Context = Sheet.Types.DraftContext(Row);
    const edited = (resident: readonly SheetRowValue[], i: number, qty: bigint): EntryVersion => ({
        draft: liftDraft(Draft, { id: `r${i}`, qty, hidden: `hidden ${i}` }),
        wire: { ...resident[i]!, cells: new Map(resident[i]!.cells).set("qty", variant("Integer", qty)) },
        place: none,
    });

    test("a real row check over 2,000 rows and 500 drafts runs in one call, the author's check once per draft, its issues addressed to their rows", () => {
        let authored = 0;
        const counted = East.platform("test_readiness_882_counted", [], NullType);
        const atMostFive = East.function([Draft, Context], Ready, ($, row) => {
            $(counted());
            return row.qty.hasTag("value").and(() => row.qty.unwrap("value").greater(5n)).ifElse(
                () => East.value(variant("incomplete", [{ field: "qty", message: "Keep it to five" }]), Ready),
                () => East.value(variant("ready", null), Ready),
            );
        });
        const sheet = East.function([ArrayType(Row)], UIComponentType, (_$, data) => Sheet.Root(data, { qty: Sheet.column.integer(Row) }, { id: "id", ready: { row: atMostFive } }))
            .toIR().compile([counted.implement(() => { authored += 1; return null; })]);
        const root = sheet(Array.from({ length: 2_000 }, (_u, i) => ({ id: `r${i}`, qty: 1n, hidden: `hidden ${i}` })));
        if (root.type !== "Sheet" || root.value.rows.type !== "inline" || root.value.editing.readyRow.type !== "some") throw new Error("Expected an inline Sheet with a row check");
        const resident = root.value.rows.value;
        const inner = root.value.editing.readyRow.value;
        let calls = 0;
        const editing = { ...root.value.editing, readyRow: some((blob: Uint8Array) => { calls += 1; return inner(blob); }) };
        const entries = new Map<string, EntryVersion>();
        const expected: unknown[] = [];
        for (let k = 0; k < 500; k++) {
            const i = (k * 7) % 2_000;
            const qty = k % 5 === 0 ? 9n : 2n;
            entries.set(`r${i}`, edited(resident, i, qty));
            if (qty > 5n) expected.push({ entry: `r${i}`, row: none, field: some("qty"), message: "Keep it to five" });
        }
        const check = authorReadiness(editing, resident, resident.map((_r, i) => i), false)!;
        expect(check(entries)).toEqual(variant("incomplete", expected));
        expect(calls).toBe(1);
        expect(authored).toBe(500);
    });

    test("each check carries its row's place, its line and its driver — on a flat sheet and a grouped one", () => {
        const sent: unknown[] = [];
        const editingOf = (children: string | undefined) => ({
            readyRow: some((blob: Uint8Array) => {
                const batch = decodeBatch(blob);
                sent.push(batch.checks);
                return batch.checks.map(() => READY);
            }),
            readyGroup: none,
            draftType: toEastTypeValue(StringType), entryType: toEastTypeValue(StringType),
            children: children === undefined ? none : some(children), driverColumn: some("activity"), keyed: false,
            readEntry: () => none,
        }) as unknown as Editing;
        const cells = (activity: string) => new Map([["activity", variant("String", activity)]]);
        // Flat: drafts on c and a, checked in the drafts' order, each at its own row.
        const flat = ["a", "b", "c"].map((id) => ({ ...WIRE, id, cells: cells(`${id} work`) }) as unknown as SheetRowValue);
        const flatDrafts = new Map<string, EntryVersion>([["c", { draft: "d", wire: flat[2]!, place: none }], ["a", { draft: "d", wire: flat[0]!, place: none }]]);
        expect(authorReadiness(editingOf(undefined), flat, [0, 1, 2], false)!(flatDrafts)).toEqual(READY);
        expect(sent.pop()).toEqual([
            { index: 2n, line: none, driver: some("c work") },
            { index: 0n, line: none, driver: some("a work") },
        ]);
        // Grouped: a draft on the second group checks each of its lines, at the group's place.
        const line = (key: string, activity: string) => ({ key, cells: cells(activity), subRows: [] });
        const groups = [
            { ...WIRE, id: "g1", lines: [line("0", "Weld")] },
            { ...WIRE, id: "g2", lines: [line("0", "Paint"), line("1", "Pack")] },
        ] as unknown as SheetRowValue[];
        const groupDrafts = new Map<string, EntryVersion>([["g2", { draft: "d", wire: groups[1]!, place: none }]]);
        expect(authorReadiness(editingOf("lines"), groups, [0, 1], false)!(groupDrafts)).toEqual(READY);
        expect(sent.pop()).toEqual([
            { index: 1n, line: some(0n), driver: some("Paint") },
            { index: 1n, line: some(1n), driver: some("Pack") },
        ]);
    });

    test("with loose rows between the groups (#846) a loose row is checked as a row of its own — no line — and the group check runs for the groups alone", () => {
        const Line = StructType({ id: StringType, activity: StringType });
        const Group = StructType({ id: StringType, lines: ArrayType(Line) });
        const Entry = Sheet.Types.Entry(Group, "lines");
        const DraftEntry = Sheet.Types.DraftEntry(Entry);
        const sent: unknown[] = [];
        const groupChecked: string[] = [];
        const decodeEntryDraft = decodeBeast2For(DraftEntry);
        const editing = {
            readyRow: some((blob: Uint8Array) => {
                const batch = decodeBatch(blob);
                sent.push(batch.checks);
                return batch.checks.map(() => READY);
            }),
            readyGroup: some((blob: Uint8Array) => {
                const draft = decodeEntryDraft(blob);
                groupChecked.push(draft.type);
                return READY;
            }),
            draftType: toEastTypeValue(DraftEntry), entryType: toEastTypeValue(Entry),
            children: some("lines"), driverColumn: some("activity"), keyed: false,
            readEntry: () => none,
        } as unknown as Editing;
        const cells = (activity: string) => new Map([["activity", variant("String", activity)]]);
        const rows = [
            { ...WIRE, id: "l1", cells: cells("Brief") },
            { ...WIRE, id: "g", band: some({ sub: "", folded: false }), lines: [{ key: "0", cells: cells("Weld"), subRows: [] }, { key: "1", cells: cells("Paint"), subRows: [] }] },
            { ...WIRE, id: "l2", cells: cells("Hand over") },
        ] as unknown as SheetRowValue[];
        const version = (i: number, entry: unknown): EntryVersion => ({ draft: liftDraft(DraftEntry, entry), wire: rows[i]!, place: none });
        const drafts = new Map<string, EntryVersion>([
            ["l2", version(2, variant("row", { id: "l2", activity: "Hand over" }))],
            ["g", version(1, variant("group", { id: "g", lines: [{ id: "a", activity: "Weld" }, { id: "b", activity: "Paint" }] }))],
            ["l1", version(0, variant("row", { id: "l1", activity: "Brief" }))],
        ]);
        expect(authorReadiness(editing, rows, [0, 1, 2], false)!(drafts)).toEqual(READY);
        expect(sent.pop()).toEqual([
            { index: 2n, line: none, driver: some("Hand over") },
            { index: 1n, line: some(0n), driver: some("Weld") },
            { index: 1n, line: some(1n), driver: some("Paint") },
            { index: 0n, line: none, driver: some("Brief") },
        ]);
        expect(groupChecked).toEqual(["group"]);
    });

    test("a batch whose rows cannot be built marks every check invalid with the reason", () => {
        const resident = ["a", "b"].map((id) => ({ ...WIRE, id }) as unknown as SheetRowValue);
        const editing = {
            readyRow: some(() => { throw new Error("rows unavailable"); }),
            readyGroup: none,
            draftType: toEastTypeValue(Draft), entryType: toEastTypeValue(Row),
            children: none, driverColumn: none, keyed: false,
            readEntry: () => none,
        } as unknown as Editing;
        const entries = new Map<string, EntryVersion>(["a", "b"].map((id) => [id, { draft: liftDraft(Draft, { id, qty: 1n, hidden: id }), wire: { ...WIRE, id } as unknown as SheetRowValue, place: none }]));
        const check = authorReadiness(editing, resident, [0, 1], false)!;
        expect(check(entries)).toEqual(variant("invalid", ["a", "b"].map((entry) => ({ entry, row: none, field: some(""), message: "Row readiness failed: rows unavailable" }))));
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
            readyRow: some((blob: Uint8Array) => decodeBatch(blob).checks.map(() => { checks += 1; return READY; })),
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
