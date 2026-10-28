/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The rows a kind read by area reads, made its stored rows (#1393,
 * `made-rows.ts`): each row made once — read again as it was, the same object
 * or one East holds equal, it is the same stored row, and only the rows a read
 * adds are made, a changed one made again — in key order; a read making rows
 * within its budget, a batch at least, the rest left to the next; past the
 * most it keeps, the rows a read does not ask for go; and a row its maker makes
 * nothing of failing the read, naming it. The maker is a real East function,
 * written as e3-ui's kinds write theirs (`rowsReadOf`), over real East values;
 * the clock the budget is spent on is the test's own.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    ArrayType, BlobType, DictType, East, FloatType, StringType, StructType, decodeBeast2For, equalFor, toEastTypeValue, type ValueTypeOf,
} from "@elaraai/east";
import { MAKE_BATCH, MAKE_BUDGET_MS, RowMaking, type RowMaker, type StoredRows } from "./made-rows.js";

const Rack = StructType({ name: StringType, x: FloatType, y: FloatType });
const Roles = StructType({ label: StringType, x: FloatType });
const Read = ArrayType(StructType({ key: StringType, row: Rack }));
const Stored = DictType(StringType, StructType({ roles: Roles, row: BlobType }));
const stringEqual = equalFor(StringType);
const sameRoles = equalFor(Roles);

/** A kind's `rowsOf`, as e3-ui's kinds write theirs: each row's roles — its label its name, and its x — beside its bytes. */
const rowsOf = East.compile(East.function([BlobType], Stored, ($, bytes) => {
    const read = $.const(bytes.decodeBeast(Read, "v2"));
    return read.toDict(($2, entry) => entry.key, ($2, entry) => ({ roles: { label: entry.row.name, x: entry.row.x }, row: East.Blob.encodeBeast(entry.row, "v2") }));
}), []);
const readOf = decodeBeast2For(Read);

/** How many rows each call of a maker made. */
interface Counted {
    readonly maker: RowMaker;
    readonly calls: number[];
}

/**
 * A maker over the kind's `rowsOf` that counts the rows each call makes, each call spending some of the test's clock.
 *
 * @param spend - How long each call takes, in ms
 * @returns The maker, and the rows each of its calls made
 */
function counted(spend = 0): Counted {
    const calls: number[] = [];
    const maker: RowMaker = {
        rowType: toEastTypeValue(Rack),
        rowsOf: (bytes) => {
            calls.push(readOf(bytes).length);
            if (spend > 0) vi.advanceTimersByTime(spend);
            return rowsOf(bytes);
        },
    };
    return { maker, calls };
}

/** How many rows a maker's calls made in all. */
const made = ({ calls }: Counted): number => calls.reduce((n, rows) => n + rows, 0);

/** Racks keyed `R0000` on, by their numbers: each its name and its place, as a read decodes it. */
function racks(numbers: readonly number[]): Map<string, ValueTypeOf<typeof Rack>> {
    return new Map(numbers.map((n) => [`R${String(n).padStart(4, "0")}`, { name: `Rack ${n}`, x: n, y: 0 }]));
}

/** The numbers from one to before another. */
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

describe("RowMaking", () => {
    // The budget's clock is the test's: it moves only as a maker's call spends it.
    beforeEach(() => { vi.useFakeTimers({ toFake: ["performance"] }); });
    afterEach(() => { vi.useRealTimers(); });

    test("makes each row once, in key order: a row read again — the very row — is the same stored row, and only the rows a read adds are made", () => {
        const making = new RowMaking();
        const maker = counted();
        const rows = racks([3, 1, 2]);
        making.begin();
        const first = making.make(maker.maker, rows)!;
        expect([...first.keys()]).toEqual(["R0001", "R0002", "R0003"]);
        expect(sameRoles(first.get("R0001")!.roles as ValueTypeOf<typeof Roles>, { label: "Rack 1", x: 1 })).toBe(true);
        expect(made(maker)).toBe(3);
        // A window holding two of the same rows and one more: only the new one is made.
        const next = new Map([["R0002", rows.get("R0002")!], ["R0003", rows.get("R0003")!], ...racks([4])]);
        making.begin();
        const second = making.make(maker.maker, next)!;
        expect(made(maker)).toBe(4);
        expect(second.get("R0002")).toBe(first.get("R0002"));
        expect(second.get("R0003")).toBe(first.get("R0003"));
        expect([...second.keys()]).toEqual(["R0002", "R0003", "R0004"]);
    });

    test("a row read again as a value East holds equal — a finer window's decode of it — is the same stored row; a changed one is made again", () => {
        const making = new RowMaking();
        const maker = counted();
        making.begin();
        const first = making.make(maker.maker, racks([1, 2]))!;
        // Decoded afresh — new objects — and the second rack moved.
        const again = racks([1, 2]);
        again.set("R0002", { name: "Rack 2", x: 9, y: 0 });
        making.begin();
        const second = making.make(maker.maker, again)!;
        expect(made(maker)).toBe(3);
        expect(second.get("R0001")).toBe(first.get("R0001"));
        expect(second.get("R0002")).not.toBe(first.get("R0002"));
        expect(sameRoles(second.get("R0002")!.roles as ValueTypeOf<typeof Roles>, { label: "Rack 2", x: 9 })).toBe(true);
    });

    test("a read makes rows until its budget is spent, a batch a call, and leaves the rest to the next — every row made once, the last read whole", () => {
        const SPEND = 5;
        const making = new RowMaking();
        const maker = counted(SPEND);
        const rows = racks(range(0, 500));
        // A call takes 5 ms: a read makes a batch at each 5 ms its budget has left.
        const perRead = Math.ceil(MAKE_BUDGET_MS / SPEND) * MAKE_BATCH;
        const reads: number[] = [];
        let out: StoredRows | undefined;
        while (out === undefined) {
            expect(reads.length).toBeLessThan(10);
            const before = made(maker);
            making.begin();
            out = making.make(maker.maker, rows);
            reads.push(made(maker) - before);
            expect(making.unmade).toBe(out === undefined);
        }
        expect(reads).toEqual([perRead, perRead, 500 - 2 * perRead]);
        expect(maker.calls.every((n) => n <= MAKE_BATCH)).toBe(true);
        expect(out.size).toBe(500);
    });

    test("a read whose budget is spent before it makes a row still makes a batch: every read moves on", () => {
        const making = new RowMaking();
        const maker = counted();
        making.begin();
        vi.advanceTimersByTime(MAKE_BUDGET_MS * 2);
        expect(making.make(maker.maker, racks(range(0, 200)))).toBeUndefined();
        expect(making.unmade).toBe(true);
        expect(made(maker)).toBe(MAKE_BATCH);
    });

    test("past the most it keeps, the rows a read does not ask for go, and are made again when read again", () => {
        const making = new RowMaking({ most: 100 });
        const maker = counted();
        making.begin();
        making.make(maker.maker, racks(range(0, 100)));
        making.begin();
        making.make(maker.maker, racks(range(100, 150)));
        expect(made(maker)).toBe(150);
        // Racks 0 to 99 went as 100 to 149 were made: read again, they are made again.
        making.begin();
        making.make(maker.maker, racks(range(0, 10)));
        expect(made(maker)).toBe(160);
    });

    test("a row the maker makes no stored row of fails the read, naming its key: asked again at every read after, the reads would never end", () => {
        const making = new RowMaking();
        const maker: RowMaker = {
            rowType: toEastTypeValue(Rack),
            rowsOf: (bytes) => new Map([...rowsOf(bytes)].filter(([key]) => !stringEqual(key, "R0002"))),
        };
        making.begin();
        expect(() => making.make(maker, racks([1, 2]))).toThrow('The rows read of "R0002" made it no stored row');
    });
});
