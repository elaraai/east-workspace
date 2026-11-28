/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The record Slice's own operations for a test: the record arm of the
 * platform, resolved and called as a handle's methods call it, so a test reads
 * and writes a narrowing through the real binding and its controller. The
 * binding's source answers no read: these are tests of the narrowing alone.
 *
 * @packageDocumentation
 */

import {
    ArrayType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, none, some, toEastTypeValue,
    type EastTypeValue, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceConfigType, RecordSliceStateType, type RecordSliceBinding } from "@elaraai/east-ui/internal";
import { RecordSliceImpl } from "./record.js";

type State = ValueTypeOf<RecordSliceStateType>;
type Config = ValueTypeOf<RecordSliceConfigType>;

const encodeState = encodeBeast2For(RecordSliceStateType);
const decodeState = decodeBeast2For(RecordSliceStateType);
const encodeConfig = encodeBeast2For(RecordSliceConfigType);
const decodeConfig = decodeBeast2For(RecordSliceConfigType);

/**
 * A narrowing as the store hands it back: read through its type's codec.
 *
 * @param state - The narrowing
 * @returns It, decoded
 */
export const recordState = (state: State): State => decodeState(encodeState(state));

/** A binding nothing is read through. */
const SOURCE: RecordSliceBinding & { indexes: null; nested: null } = {
    id: "orders", recordId: "orders", defaultIndex: "primary", revision: () => some("A"), refresh: () => null,
    total: () => some(0n), entryKeys: () => [], seek: () => none, page: () => none, indexes: null, nested: null,
};

const byName = new Map(RecordSliceImpl.map(p => [p.name, p.fn]));

/** A record Slice's operations, over one binding. */
export interface RecordArm {
    /**
     * One operation of the record arm, as a handle's method calls it.
     *
     * @param name - The operation: `read`, `write`, `choose`, …
     * @param key - The Slice's store key
     * @param args - The operation's own arguments
     * @returns What it answers
     */
    op(name: string, key: string, ...args: unknown[]): unknown;
    /**
     * The narrowing the Slice under a key holds.
     *
     * @param key - The Slice's store key
     * @returns Its state
     */
    read(key: string): State;
}

/**
 * The record arm over a binding of rows of one type, with one config and one starting narrowing.
 *
 * @param row - The record's row type
 * @param config - The Slice's config: its fields, its indexes and its scope
 * @param initial - The narrowing the Slice is bound with
 * @returns Its operations
 */
export function recordArm(row: StructType, config: Config, initial: State): RecordArm {
    // The binding's type, and the window of joined entries its Slice pages: what the arm's operations are resolved at.
    const types: EastTypeValue[] = [
        toEastTypeValue(StructType({ id: StringType })),
        toEastTypeValue(ArrayType(StructType({ key: StringType, row: OptionType(row) }))),
    ];
    const decoded = decodeConfig(encodeConfig(config));
    const op = (name: string, key: string, ...args: unknown[]): unknown => {
        const resolve = byName.get(`slice_record_${name}`) as (...types: EastTypeValue[]) => (...args: unknown[]) => unknown;
        return resolve(...types)(key, SOURCE, decoded, initial, ...args);
    };
    return { op, read: key => op("read", key) as State };
}
