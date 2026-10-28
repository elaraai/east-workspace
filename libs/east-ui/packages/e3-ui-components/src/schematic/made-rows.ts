/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows a kind read by area reads, made its stored rows (#1393, `Schematic
 * Builder Spec.md` §10.4): each row's roles beside its bytes, through the
 * kind's `rowsOf` — or its details' — an East function over the rows' bytes,
 * which runs the kind's accessors over every row it is given.
 *
 * - **Each row made once.** What a maker made of a row is kept by the row's
 *   key while the row reads again as it was — the same object, or one East
 *   holds equal (`equalFor`), as a window into finer cells decodes it — so a
 *   window over rows another window made, a zoom into finer cells, which
 *   searches anew, or a pan back makes only the rows it adds, and the rows it
 *   made before are the same stored rows, which the drawing keeps. Past
 *   {@link MAX_MADE_ROWS} kept, those a read does not ask for go.
 * - **A budget a read.** A read makes rows a batch a call
 *   ({@link MAKE_BATCH}), until {@link MAKE_BUDGET_MS} has passed since it
 *   began — a batch at least — and leaves the rest to the next read: a window
 *   of thousands of rows new to it is made over several tasks, a frame
 *   drawing between, never in one long task.
 *
 * @packageDocumentation
 */

import { ArrayType, SortedMap, StringType, StructType, compareFor, encodeBeast2For, equalFor, fromEastTypeValue, type StructType as StructTypeOf } from "@elaraai/east";
import { SCHEMATIC_WINDOW_READ_ROWS } from "@elaraai/e3-ui/internal";

const compareString = compareFor(StringType);

/** A stored row: its roles beside its bytes, as a kind's `rowsOf` makes it. */
export interface StoredRow {
    readonly roles: unknown;
    readonly row: Uint8Array;
}

/** Stored rows, by key. */
export type StoredRows = ReadonlyMap<string, StoredRow>;

/** What makes a kind's stored rows: the kind, or its details — their row type and their `rowsOf`. */
export interface RowMaker {
    /** The row type, as an East type value. */
    readonly rowType: Parameters<typeof fromEastTypeValue>[0];
    /** Makes the stored rows of an Array of `{ key, row }`, given as its bytes. */
    readonly rowsOf: (bytes: Uint8Array) => StoredRows;
}

/** The most rows a maker keeps made — a window's read — past which those a read does not ask for go. */
export const MAX_MADE_ROWS = SCHEMATIC_WINDOW_READ_ROWS;

/**
 * How many rows a maker's `rowsOf` makes in one call: each call's own cost spread over them, and a call a few ms at
 * most — some 10 ms while its functions run cold, under 2 ms once warm — so the budget, checked between calls, is
 * overrun by no more.
 */
export const MAKE_BATCH = 64;

/** How long one read makes rows for, in ms, before the rest are left to the next read: a frame draws between. */
export const MAKE_BUDGET_MS = 12;

/** What a maker made of a row: the row as it was read, and its stored row. */
interface Made {
    readonly row: unknown;
    readonly stored: StoredRow;
}

/** A maker's encoder of the rows it is given, as its `rowsOf` takes them. */
type RowsEncoder = (read: { key: string; row: unknown }[]) => Uint8Array;

/** A maker's equality of the rows it is given: whether a row reads again as it was. */
type RowEqual = (a: unknown, b: unknown) => boolean;

/** How {@link RowMaking} keeps what it made. */
export interface RowMakingOptions {
    /** The most rows a maker keeps made; {@link MAX_MADE_ROWS} unless given. */
    readonly most?: number;
}

/**
 * Rows made their stored rows, each once, a budget a read (see the module
 * docs): one for a reader's every maker — each kind read by area and its
 * details.
 */
export class RowMaking {
    private readonly most: number;
    private readonly made = new WeakMap<RowMaker, Map<string, Made>>();
    private readonly encoders = new WeakMap<RowMaker, RowsEncoder>();
    private readonly equals = new WeakMap<RowMaker, RowEqual>();
    /** When the read under way stops making rows, by `performance.now()`. */
    private deadline = Number.POSITIVE_INFINITY;
    /** Whether the read under way has left rows to make. */
    private left = false;

    /**
     * @param options - The most rows a maker keeps made
     */
    constructor(options: RowMakingOptions = {}) {
        this.most = options.most ?? MAX_MADE_ROWS;
    }

    /** Begins a read: it makes rows for {@link MAKE_BUDGET_MS} — a batch at least — and leaves the rest to the next. */
    begin(): void {
        this.deadline = performance.now() + MAKE_BUDGET_MS;
        this.left = false;
    }

    /** Whether the last read left rows to make: its reader reads again a task later, a frame drawing between. */
    get unmade(): boolean {
        return this.left;
    }

    /**
     * Rows made their stored rows, in key order, as `rowsOf` gives them (see
     * the module docs): a row made before, read again as it was, the same
     * stored row; the rest made a batch a call, until the read's budget is
     * spent — a batch at least — the rest left to the next read.
     *
     * @param maker - The kind, or its details
     * @param rows - The rows, by key: each as it was read
     * @returns Their stored rows, by key; `undefined` while rows are left to make
     * @throws {Error} When the maker's `rowsOf` makes no stored row of a row it was given, naming its key: asked of it at
     *   every read after, the read would never end
     */
    make(maker: RowMaker, rows: ReadonlyMap<string, unknown>): StoredRows | undefined {
        let made = this.made.get(maker);
        if (made === undefined) {
            made = new Map();
            this.made.set(maker, made);
        }
        const same = this.equalOf(maker);
        const missing: { key: string; row: unknown }[] = [];
        for (const [key, row] of rows) {
            const was = made.get(key);
            if (was === undefined || !(Object.is(was.row, row) || same(was.row, row))) missing.push({ key, row });
            // Read again as it was: kept as it was read now, so its next read is the same object.
            else if (!Object.is(was.row, row)) made.set(key, { row, stored: was.stored });
        }
        for (let at = 0; at < missing.length; at += MAKE_BATCH) {
            if (at > 0 && performance.now() >= this.deadline) {
                this.left = true;
                return undefined;
            }
            const batch = missing.slice(at, at + MAKE_BATCH);
            const fresh = maker.rowsOf(this.encoderOf(maker)(batch));
            if (made.size + batch.length > this.most) {
                for (const key of [...made.keys()]) if (!rows.has(key)) made.delete(key);
            }
            for (const { key, row } of batch) {
                const stored = fresh.get(key);
                if (stored === undefined) throw new Error(`The rows read of "${key}" made it no stored row`);
                made.set(key, { row, stored });
            }
        }
        const out = new SortedMap<string, StoredRow>(undefined, compareString);
        for (const key of rows.keys()) {
            const one = made.get(key);
            if (one !== undefined) out.set(key, one.stored);
        }
        return out;
    }

    /** A maker's encoder of the rows it is given, made once a maker. */
    private encoderOf(maker: RowMaker): RowsEncoder {
        let encode = this.encoders.get(maker);
        if (encode === undefined) {
            const row = fromEastTypeValue(maker.rowType) as StructTypeOf;
            encode = encodeBeast2For(ArrayType(StructType({ key: StringType, row }))) as RowsEncoder;
            this.encoders.set(maker, encode);
        }
        return encode;
    }

    /** A maker's equality of its rows, made once a maker. */
    private equalOf(maker: RowMaker): RowEqual {
        let equal = this.equals.get(maker);
        if (equal === undefined) {
            equal = equalFor(fromEastTypeValue(maker.rowType)) as RowEqual;
            this.equals.set(maker, equal);
        }
        return equal;
    }
}
