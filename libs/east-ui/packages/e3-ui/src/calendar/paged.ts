/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Calendar's paged resource kind (#1424): its resources a window at a
 * time, as the Plan's paged kind's are (#1199, #1344) — the timeline's rows and
 * the Resources view's columns the windows around the view, through the
 * payload's `paged`. The kind's windows are its own paged read's, in its
 * resources' key order, or — its source of the slice narrowing it — that
 * source's narrowed rows themselves, in the source's index's order
 * (`schedule/pages.ts`). Its Choosers search its own resources by key, in
 * their key order, through its own paged read (`seek`, `entries`), and one
 * resource is read by its key where an event names it (`byKey`). Its
 * resources are never read whole.
 *
 * @packageDocumentation
 */

import {
    ArrayType, East, FunctionType, IntegerType, NullType, OptionType, StringType, StructType, none, some,
    type DictType, type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { scheduleNarrowedWindows, scheduleOwnWindows, type ScheduleBlock, type ScheduleKindWindows } from "../schedule/pages.js";
import type { ScheduleResourceKind } from "../schedule/resources.js";
import { ScheduleResourceRowType } from "../schedule/types.js";
import { scheduleEntryByKey } from "../schedule/window.js";

/**
 * A Calendar's paged resource kind's resources (#1424): see the module docs.
 *
 * @property kind - The paged resource kind's slot
 * @property id - The identity of its windows' source: the source's, the same under every narrowing, when its source of the slice narrows it
 * @property rows - `(offset, limit)` → its resources `[offset, offset + limit)` as the Calendar takes them, in the order its rows and columns draw — their key order, or the narrowing's index's order when its source of the slice narrows the kind; `none` while the window is in flight
 * @property keys - `(offset, limit)` → the texts of the same resources' keys, in the same order: what the Calendar's cell reader places its blocks by, making no row; `none` while the window is in flight
 * @property total - How many resources it has — the narrowing holds, when its source narrows it — once known
 * @property revision - The snapshot of the resources the windows are read at
 * @property refresh - Moves the windows to a snapshot, or to the one they hold now
 * @property query - The narrowing the windows and the total belong to, as text: it moves when a choice does, and the windows are read again under it; `none` when no source narrows the kind
 * @property seek - Where a key search lands among the kind's own resources, in their key order, whatever narrows it: what a Chooser searches the kind by; `none` for a read with no key search
 * @property entries - `(offset, limit)` → the kind's own resources `[offset, offset + limit)`, in their key order, as the Calendar takes them: what a Chooser lists; `none` while the window is in flight
 * @property byKey - One resource by its key's text: `some(some(row))` once read, `some(none)` for a key the kind does not hold, `none` while the read is in flight
 */
export const CalendarPagedType = StructType({
    kind: StringType,
    id: StringType,
    rows: FunctionType([IntegerType, IntegerType], OptionType(ArrayType(ScheduleResourceRowType))),
    keys: FunctionType([IntegerType, IntegerType], OptionType(ArrayType(StringType))),
    total: FunctionType([], OptionType(IntegerType)),
    revision: FunctionType([], OptionType(StringType)),
    refresh: FunctionType([OptionType(StringType)], NullType),
    query: OptionType(FunctionType([], StringType)),
    seek: OptionType(FunctionType([SeekQueryType], OptionType(SeekRangeType))),
    entries: FunctionType([IntegerType, IntegerType], OptionType(ArrayType(ScheduleResourceRowType))),
    byKey: FunctionType([StringType], OptionType(OptionType(ScheduleResourceRowType))),
});

/** Type representing {@link CalendarPagedType}. */
export type CalendarPagedType = typeof CalendarPagedType;

/** A window of resources as the Calendar takes them, while it is in flight. */
const RowsType = OptionType(ArrayType(ScheduleResourceRowType));

/**
 * A window read of a paged kind's resources, as the Calendar takes them: in the order the windows give their keys.
 *
 * @param windows - Where the windows come from
 * @param kind - The paged resource kind: what makes each resource's row
 * @returns `(offset, limit)` → the window's resources; `none` while it is in flight
 */
function windowRows(windows: ScheduleKindWindows, kind: ScheduleResourceKind<EastType, EastType>): ExprType<FunctionType<[IntegerType, IntegerType], typeof RowsType>> {
    return East.function([IntegerType, IntegerType], RowsType, ($, offset, limit) => {
        const read = $.const(windows.read);
        const make = $.const(kind.calendarRow);
        const result = $.let(none, RowsType);
        $.match(read(offset, limit), {
            some: ($2, page) => {
                // A paged kind is keyed by String (`Schedule.resources`): each resource by its key's text, in the order its rows draw.
                const all = $2.let(windows.rows(page)) as unknown as ExprType<DictType<StringType, EastType>>;
                const keys = windows.keys($2 as unknown as ScheduleBlock, page);
                $2.assign(result, some(keys.map(($3, key) => make(all.get(key) as never, key as never))));
            },
        });
        return result;
    });
}

/** A window of keys' texts, while it is in flight. */
const KeysType = OptionType(ArrayType(StringType));

/**
 * A window read of a paged kind's resources' keys' texts, in the order the windows give them.
 *
 * @param windows - Where the windows come from
 * @returns `(offset, limit)` → the window's keys' texts; `none` while it is in flight
 */
function windowKeys(windows: ScheduleKindWindows): ExprType<FunctionType<[IntegerType, IntegerType], typeof KeysType>> {
    return East.function([IntegerType, IntegerType], KeysType, ($, offset, limit) => {
        const read = $.const(windows.read);
        const result = $.let(none, KeysType);
        $.match(read(offset, limit), {
            some: ($2, page) => { $2.assign(result, some(windows.keys($2 as unknown as ScheduleBlock, page))); },
        });
        return result;
    });
}

/**
 * The paged resource kind's resources (see {@link CalendarPagedType}), when a
 * resource kind is given its resources as a paged read.
 *
 * @param resources - The resource kinds, by slot, in order — at most one of them paged (the Calendar refuses more)
 * @param narrowed - The paged kind's source of the slice's narrowed data, when the slice names one after its slot: its windows are then the narrowing's rows
 * @returns The paged resources, or `undefined` when no resource kind is paged
 * @throws {Error} When the kind's paged read is not a paged source of its resources, or its source's rows are not the kind's
 * @internal
 */
export function createCalendarPaged(
    resources: readonly (readonly [string, ScheduleResourceKind<EastType, EastType>])[], narrowed?: ExprType<StructType>,
): ExprType<CalendarPagedType> | undefined {
    const at = resources.find(([, kind]) => kind.window !== undefined);
    if (at === undefined) return undefined;
    const [slot, kind] = at;
    const own = scheduleOwnWindows(kind, `Calendar: resources.${slot}`);
    const pages = narrowed === undefined ? own : scheduleNarrowedWindows(kind, slot, narrowed, "Calendar");
    const handle = pages.handle;
    const find = scheduleEntryByKey(kind.window!, kind.keyType, kind.rowType);
    const ByKey = OptionType(OptionType(ScheduleResourceRowType));
    const byKey = East.function([StringType], ByKey, ($, key) => {
        const read = $.const(find);
        const make = $.const(kind.calendarRow);
        const result = $.let(none, ByKey);
        $.match(read(key), {
            held: ($2, row) => { $2.assign(result, some(some(make(row as never, key as never)))); },
            absent: ($2) => { $2.assign(result, some(none)); },
        });
        return result;
    });
    // A source that names no snapshot is read at none, and moves nowhere.
    const revision = pages.pinned
        ? handle.revision
        : East.function([], OptionType(StringType), (_$) => East.value(none, OptionType(StringType)));
    const refresh = pages.pinned
        ? handle.refresh
        : East.function([OptionType(StringType)], NullType, (_$, _target) => East.value(null, NullType));
    const Query = CalendarPagedType.fields.query;
    return East.value({
        kind: slot,
        id: handle.id,
        rows: windowRows(pages, kind),
        keys: windowKeys(pages),
        total: handle.total,
        revision,
        refresh,
        query: pages.query ? East.value(some(handle.query), Query) : East.value(none, Query),
        // The Choosers search the kind's own resources, in their key order, whatever narrows its windows.
        seek: own.handle.seek,
        entries: windowRows(own, kind),
        byKey,
    } as SubtypeExprOrValue<CalendarPagedType>, CalendarPagedType);
}
