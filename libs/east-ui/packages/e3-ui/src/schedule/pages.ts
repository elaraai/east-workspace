/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a paged resource kind's windows come from (#1199, #1344, #1424): the
 * kind's own paged read, its resources in their key order; or, its builder's
 * slice naming a source after its slot, that source's narrowed rows
 * themselves, the narrowing's resources in the source's index's order — never
 * a window of every resource filtered by the keys the source shows. The Plan's
 * paged rows (`plan/event-rows.ts`) and the Calendar's (`calendar/paged.ts`)
 * page through them alike.
 *
 * @packageDocumentation
 */

import {
    ArrayType, East, StringType, isTypeEqual, printType,
    type BlockBuilder, type DictType, type EastType, type ExprType, type FunctionType, type IntegerType, type NullType, type OptionType, type StructType,
} from "@elaraai/east";
import type { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { buildPagedWindow, resolveRowSource } from "@elaraai/east-ui/internal";
import { orderedRowSource } from "../utils/ordered-source.js";
import type { ScheduleResourceKind } from "./resources.js";

/** A block's scope — the `$` of an East function body, its result type erased. */
export type ScheduleBlock = BlockBuilder<EastType>;

/** A paged source's handle, as a builder's paged rows read it: its identity, size, key search, snapshot and — a rail's narrowed source's — narrowing. */
export type SchedulePagedHandle = ExprType<StructType<{
    id: StringType;
    total: FunctionType<[], OptionType<IntegerType>>;
    seek: OptionType<FunctionType<[typeof SeekQueryType], OptionType<typeof SeekRangeType>>>;
    revision: FunctionType<[], OptionType<StringType>>;
    refresh: FunctionType<[OptionType<StringType>], NullType>;
    query: FunctionType<[], StringType>;
}>>;

/** A whole window's read of a paged kind's resources: `(offset, limit)` → the window, `none` while a piece is in flight. */
export type ScheduleWindowRead = ExprType<FunctionType<[IntegerType, IntegerType], OptionType<EastType>>>;

/**
 * Where a paged resource kind's windows come from, and how one read is drawn:
 * the kind's own paged read, in its resources' key order; or its source of the
 * slice, the narrowing's rows in the source's index's order.
 */
export interface ScheduleKindWindows {
    /** The window `[offset, offset + limit)`, whole. */
    readonly read: ScheduleWindowRead;
    /** A window read → its resources, by key. */
    readonly rows: (page: ExprType<EastType>) => ExprType<DictType<EastType, EastType>>;
    /** A window read → the texts of its resources' keys, in the order its rows draw. */
    readonly keys: ($: ScheduleBlock, page: ExprType<EastType>) => ExprType<ArrayType<StringType>>;
    /** Whether a window's rows are drawn in its keys' order rather than the resources' key order: an index's order. */
    readonly indexed: boolean;
    /** The handle: its identity, size, key search, snapshot and narrowing. */
    readonly handle: SchedulePagedHandle;
    /** Whether the handle names its snapshot, `revision` and `refresh`. */
    readonly pinned: boolean;
    /** Whether the handle names the narrowing it serves, `query`: a source of the slice. */
    readonly query: boolean;
}

/**
 * A paged kind's own windows (#1199): its paged read, in its resources' key
 * order.
 *
 * @param kind - The paged resource kind
 * @param where - The kind, as a refusal names it (`Plan: resources.presses`)
 * @returns Its windows
 * @throws {Error} When its paged read is not a paged source of its resources
 */
export function scheduleOwnWindows(kind: ScheduleResourceKind<EastType, EastType>, where: string): ScheduleKindWindows {
    // The resources a window at a time — each window whole, a piece the source cut short read on to its end.
    const resolved = resolveRowSource(kind.window, where);
    if (resolved.kind === "inline") {
        throw new Error(`${where}: a paged kind's resources are a paged read — Data.bindPaged(record) over the resources' record`);
    }
    // A key's text, as the rows name it: a paged kind's keys are Strings, as `Schedule.resources` holds them.
    const keyText = isTypeEqual(kind.keyType, StringType)
        ? (key: ExprType<EastType>) => key as unknown as ExprType<StringType>
        : (key: ExprType<EastType>) => East.print(key);
    return {
        read: buildPagedWindow(resolved),
        rows: (page) => page as unknown as ExprType<DictType<EastType, EastType>>,
        keys: ($, page) => {
            const out = $.let([], ArrayType(StringType));
            $.for(page as unknown as ExprType<DictType<EastType, EastType>>, ($2, _row, key) => { $2(out.pushLast(keyText(key))); });
            return out;
        },
        indexed: false,
        handle: resolved.source as unknown as SchedulePagedHandle,
        pinned: resolved.pinned,
        query: false,
    };
}

/**
 * A paged kind's windows narrowed by its source of the slice (#1344): the
 * narrowing's rows themselves, paged in the source's index's order — never a
 * window of every resource filtered by the keys the source shows.
 *
 * @param kind - The paged resource kind
 * @param slot - Its slot, which names its source
 * @param narrowed - The source's narrowed data, as the builder's payload bound it: a rail's live source of index entries
 * @param builder - The builder, as its refusals name it (`Plan`, `Calendar`)
 * @returns Its windows
 * @throws {Error} When the source's rows are not the kind's, or its entries carry no rows
 */
export function scheduleNarrowedWindows(
    kind: ScheduleResourceKind<EastType, EastType>, slot: string, narrowed: ExprType<StructType>, builder: string,
): ScheduleKindWindows {
    const where = `${builder}: the slice's source "${slot}"`;
    const resolved = resolveRowSource(narrowed, where);
    // The slice binds only a record's indexed reads, so a source is an index's window (`recordSources`).
    if (resolved.kind !== "ordered") throw new Error(`${where} narrows resources.${slot}, and it is no index's window of a record`);
    const ordered = orderedRowSource(resolved, builder);
    const row = ordered.resolved.elementType;
    if (!isTypeEqual(resolved.keyType, kind.keyType) || !isTypeEqual(row, kind.rowType)) {
        throw new Error(`${where} narrows resources.${slot}, and its rows are ${printType(row)} — the kind's are ${printType(kind.rowType)}: ` +
            "bind the source over the kind's own record, Data.bindPaged(record, { indexes })");
    }
    return {
        read: ordered.window as unknown as ScheduleWindowRead,
        rows: (page) => ordered.rows(page as never) as unknown as ExprType<DictType<EastType, EastType>>,
        keys: (_$, page) => ordered.keys(page as never),
        indexed: true,
        handle: resolved.source as unknown as SchedulePagedHandle,
        pinned: resolved.pinned,
        query: resolved.query,
    };
}
