/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule.periods(record, config)` (#1367, `Builder Interfaces Spec.md`
 * §4.3): what a builder publishes — the app's own record of periods, one row
 * of the app's per period, keyed by its start (a UTC midnight: a week's first
 * day by the builder's week start, or a day), its status a variant field of
 * the app's whose cases the builder maps.
 *
 * - **Status.** `status.field` names a variant field of the row, not an
 *   Option; `draft` and `published` name two of its cases. The published case
 *   holds Null, or `{ at: DateTime }`, the time it was published. A period in
 *   any other case is read-only, its chip naming the case; a period with no
 *   row is not started.
 * - **Publish** writes the published case, with the time in `at` when the
 *   case holds one. A builder saves the period's drafts first, and writes the
 *   status only once every session reads back confirmed (§7).
 * - **Dismissed**, the Roster's: a `Set<String>` field, the proposals a week
 *   dismissed. Without it the builder dismisses none.
 * - **New rows.** A row the builder creates holds its type's default
 *   (`defaultValue`) in every field it doesn't map: its status the published
 *   case when it publishes, else the draft case, holding its payload's
 *   default.
 * - **Reads.** By key through `entries`, a paged read of the record's own
 *   entries — each span the builder reads (its period, the one before it, the
 *   open picker's) one key search and one page — or the record whole.
 *
 * The periods are one session of the builder's history (`session.ts`), as
 * each of its event kinds is: Save sends their changes through the record's
 * patch door as a request of their own.
 *
 * @packageDocumentation
 */

import {
    BlobType, DateTimeType, DictType, East, Expr, NullType, OptionType, SetType, StringType, StructType, defaultValue, isTypeEqual, none,
    printType, some, toEastTypeValue, variant,
    type EastType, type ExprType, type FunctionType, type IntegerType,
} from "@elaraai/east";
import { SeekQueryType, type SeekRangeType } from "@elaraai/east-ui";
import type { ScheduleCaseOf, ScheduleRecordHandle, ScheduleSetStringField, ScheduleStatusField } from "./events.js";
import { SCHEDULE_DEF } from "./resources.js";
import { scheduleRecordSession } from "./session.js";
import { SchedulePeriodStatusType, SchedulePeriodsKindType } from "./types.js";
import { checkEntries, optionOf, typeText } from "./window.js";

/**
 * What a builder publishes, declared over the app's record of periods (see
 * the module docs).
 *
 * @typeParam R - The period's row type
 * @typeParam SF - The status field
 */
export interface SchedulePeriodsConfig<R extends StructType, SF extends string> {
    /** What a period is: a week from the builder's week start (`"week"`), or a UTC day (`"day"`). */
    every: "week" | "day";
    /** The status: a variant field of the row, and which of its cases are the draft and the published. */
    status: {
        /** The variant field, not an Option. */
        field: SF;
        /** The case a period being planned is in: editable. */
        draft: ScheduleCaseOf<R["fields"][SF]>;
        /** The case Publish writes, read-only: it holds Null, or `{ at: DateTime }`, the time it was published. */
        published: ScheduleCaseOf<R["fields"][SF]>;
    };
    /** The Roster's: the `Set<String>` field holding the proposals a week dismissed. Omitted, the builder dismisses none. */
    dismissed?: ScheduleSetStringField<R>;
    /**
     * A paged read of the record's own entries (`Data.bindPaged(record)`): the periods read by key — the period, the
     * one before it, the open picker's span — never the record whole. Omitted, the record is read whole.
     */
    entries?: unknown;
}

/** What a builder publishes, declared: what its `periods` takes. */
export interface SchedulePeriods {
    /** What it is. */
    readonly [SCHEDULE_DEF]: "periods";
    /** What a period is. */
    readonly every: "week" | "day";
    /** The period's row type. */
    readonly rowType: StructType;
    /**
     * The periods on the wire.
     *
     * @returns The periods, closed: their session, their reads, and each row's status written and read
     */
    build(): ExprType<SchedulePeriodsKindType>;
}

/** The config, erased — what the implementation reads. */
interface AnyPeriodsConfig {
    every: string;
    status?: { field: string; draft: string; published: string };
    dismissed?: string;
    entries?: unknown;
}

/** A paged read of a record's own entries, as the periods' span is read through it. */
type EntriesHandle = ExprType<StructType<{
    page: FunctionType<[IntegerType, IntegerType], OptionType<DictType<EastType, EastType>>>;
    seek: OptionType<FunctionType<[typeof SeekQueryType], OptionType<typeof SeekRangeType>>>;
}>>;

/** A field of a struct as an East expression, by name. */
function fieldOf(row: unknown, name: string): ExprType<EastType> {
    return (row as Record<string, ExprType<EastType>>)[name]!;
}

/** What the published case holds, beside Null: when it was published. */
const StampType = StructType({ at: DateTimeType });

/**
 * Declares what a builder publishes (see the module docs).
 *
 * @typeParam R - The period's row type
 * @typeParam SF - The status field
 * @param record - The app's record of periods, `Record.bind(record, [e3.mutation.patch(record)])`: a `Dict` keyed by each period's start
 * @param config - What a period is, its status field and cases, the Roster's dismissals, and its read by key
 * @returns The periods, for a builder's `periods`
 * @throws {Error} Naming the option: a record not bound with its patch mutation, not keyed by DateTime, or whose rows
 *   are no structs; an `every` that is neither "week" nor "day"; a `status.field` the row lacks, or that is no variant
 *   or is an Option; a `status.draft` or `status.published` that is no case of it, or both naming one; a published case
 *   holding anything but Null or `{ at: DateTime }`; a `dismissed` that is no `Set<String>` field; and `entries` that is
 *   not a paged read of the record's own entries naming its snapshot
 * @example
 * ```tsx
 * import { DateTimeType, DictType, NullType, SetType, StringType, StructType, VariantType } from "@elaraai/east";
 * import { Record, Schedule } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const RotaWeek = StructType({
 *     state: VariantType({ open: NullType, issued: StructType({ at: DateTimeType }) }),
 *     dismissed: SetType(StringType),
 * });
 * const rotaWeeks = e3.record("rota_weeks", DictType(DateTimeType, RotaWeek), new Map());
 * const rotaWeeksPatch = e3.mutation.patch(rotaWeeks);
 *
 * // Inside a builder's Reactive body: a week each, published when it is issued.
 * const periods = Schedule.periods(Record.bind(rotaWeeks, [rotaWeeksPatch]), {
 *     every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed",
 * });
 * ```
 */
export function schedulePeriods<R extends StructType, SF extends ScheduleStatusField<R>>(
    record: ScheduleRecordHandle<DateTimeType, R>,
    config: SchedulePeriodsConfig<R, SF>,
): SchedulePeriods;
export function schedulePeriods(record: unknown, input: unknown): SchedulePeriods {
    const config = input as AnyPeriodsConfig;
    const where = "Schedule.periods";
    const handleType = Expr.type(record as Expr) as EastType;
    const read = handleType.type === "Struct" ? (handleType.fields as Record<string, EastType>)["read"] : undefined;
    if (handleType.type !== "Struct" || read === undefined || read.type !== "Function"
        || (handleType.fields as Record<string, EastType>)["binding"] === undefined) {
        throw new Error(`${where}: \`record\` is the app's record of periods, bound with its patch mutation — Record.bind(record, [e3.mutation.patch(record)])`);
    }
    const recordType = read.output as EastType;
    if (recordType.type !== "Dict" || !isTypeEqual(recordType.key as EastType, DateTimeType)) {
        throw new Error(`${where}: a period's row is keyed by its start — a Dict keyed by DateTime, each key a UTC midnight — and this record holds ${typeText(recordType)}`);
    }
    const rowType = recordType.value as EastType;
    if (rowType.type !== "Struct") {
        throw new Error(`${where}: a period's row is a struct of the app's fields, its status among them — and this record's rows are ${typeText(rowType)}`);
    }
    const fields = rowType.fields as Record<string, EastType>;
    const fieldType = (prop: string, name: string): EastType => {
        const type = fields[name];
        if (type === undefined) throw new Error(`${where}: \`${prop}\` names "${name}", a field the row does not have (${Object.keys(fields).join(", ")})`);
        return type;
    };
    if (config.every !== "week" && config.every !== "day") {
        throw new Error(`${where}: \`every\` is "week" or "day" — a week from the builder's week start, or a day — and it is "${String(config.every)}"`);
    }
    const every = config.every;

    // The status: a variant field of the app's, two of whose cases are the draft and the published.
    const status = config.status;
    if (status === undefined) throw new Error(`${where}: \`status\` names the row's status field and its cases — { field, draft, published }`);
    const statusType = fieldType("status.field", status.field);
    if (statusType.type !== "Variant" || optionOf(statusType) !== undefined) {
        throw new Error(`${where}: \`status.field\` names a variant field, not an Option — "${status.field}" holds ${typeText(statusType)}`);
    }
    const cases = statusType.cases as Record<string, EastType>;
    const names = Object.keys(cases);
    for (const prop of ["draft", "published"] as const) {
        if (!names.includes(status[prop])) {
            throw new Error(`${where}: \`status.${prop}\` names a case of "${status.field}" (${names.join(", ")}) — and it names "${status[prop]}"`);
        }
    }
    if (status.draft === status.published) {
        throw new Error(`${where}: \`status.draft\` and \`status.published\` name two cases of "${status.field}" — and both name "${status.draft}"`);
    }
    // The published case holds nothing, or when it was published.
    const publishedHolds = cases[status.published]!;
    const stamped = isTypeEqual(publishedHolds, StampType);
    if (!stamped && !isTypeEqual(publishedHolds, NullType)) {
        throw new Error(`${where}: the published case "${status.published}" holds Null or { at: DateTime }, the time it was published — and it holds ${printType(publishedHolds)}`);
    }
    // The proposals a week dismissed: the Roster's.
    const dismissedField = config.dismissed;
    if (dismissedField !== undefined) {
        const type = fieldType("dismissed", dismissedField);
        if (!isTypeEqual(type, SetType(StringType))) {
            throw new Error(`${where}: \`dismissed\` names a Set of String field — "${dismissedField}" holds ${typeText(type)}`);
        }
    }
    // The periods read by key, or whole; and their session, declared now, so a record bound without its patch door is
    // refused here.
    const entries = config.entries === undefined ? undefined : checkEntries(config.entries, DateTimeType, rowType, `${where}: \`entries\``);
    const session = scheduleRecordSession(record, DateTimeType, rowType, entries);

    return {
        [SCHEDULE_DEF]: "periods",
        every,
        rowType,
        build(): ExprType<SchedulePeriodsKindType> {
            const { editing, entries: seam } = session.build();
            // The row with one field replaced, and every other as it was.
            const withField = (row: ExprType<EastType>, field: string, value: ExprType<EastType>): ExprType<EastType> =>
                East.value(Object.fromEntries(Object.keys(fields).map((f) => [f, f === field ? value : fieldOf(row, f)])) as never, rowType) as ExprType<EastType>;
            // A period's new row: every field its type's default, its status the draft case.
            const blank = East.value({
                ...(defaultValue(rowType) as object),
                [status.field]: variant(status.draft, defaultValue(cases[status.draft]!)),
            } as never, rowType) as ExprType<EastType>;
            const rowOf = (held: ExprType<OptionType<BlobType>>): ExprType<EastType> => held.match({
                some: (_$, bytes) => bytes.decodeBeast(rowType, "v2") as ExprType<EastType>,
                none: (_$) => blank,
            }) as ExprType<EastType>;

            // The periods starting in [from, to), by their start: one key search and one page of the record's own
            // entries, or the record whole.
            const Rows = OptionType(DictType(DateTimeType, BlobType));
            const rows = entries === undefined
                ? East.function([DateTimeType, DateTimeType], Rows, ($, from, to) => {
                    const held = $.const(session.readAll() as unknown as ExprType<DictType<DateTimeType, EastType>>);
                    const out = $.let(new Map(), DictType(DateTimeType, BlobType));
                    $.for(held, ($2, row, start) => {
                        $2.if(East.greaterEqual(start, from).and(() => East.less(start, to)), ($3) => {
                            $3(out.insert(start, East.Blob.encodeBeast(row, "v2")));
                        });
                    });
                    return East.value(some(out), Rows);
                })
                : East.function([DateTimeType, DateTimeType], Rows, ($, from, to) => {
                    const src = $.const(entries as unknown as EntriesHandle);
                    const result = $.let(East.value(none, Rows), Rows);
                    $.match(src.seek, {
                        none: ($2) => { $2.error(`${where}: \`entries\` finds a span of periods by its key search — Data.bindPaged(record) — and this read has none`); },
                        some: ($2, seek) => {
                            const query = $2.let(variant("range", { from: [East.print(from)], to: [East.print(to)] }), SeekQueryType);
                            $2.match(seek(query), {
                                some: ($3, found) => {
                                    $3.if(found.found.not(), ($4) => {
                                        $4.assign(result, East.value(some(new Map()), Rows));
                                    }).else(($4) => {
                                        $4.match(src.page(found.row, found.count), {
                                            some: ($5, page) => {
                                                const out = $5.let(new Map(), DictType(DateTimeType, BlobType));
                                                $5.for(page, ($6, row, start) => { $6(out.insert(start as ExprType<DateTimeType>, East.Blob.encodeBeast(row, "v2"))); });
                                                $5.assign(result, East.value(some(out), Rows));
                                            },
                                        });
                                    });
                                },
                            });
                        },
                    });
                    return result;
                });

            // A row's status: its draft case, its published case and when, or another case by its name.
            const statusOf = East.function([BlobType], SchedulePeriodStatusType, ($, bytes) => {
                const row = $.const(bytes.decodeBeast(rowType, "v2"));
                const held = fieldOf(row, status.field) as unknown as { match: (arms: object) => ExprType<typeof SchedulePeriodStatusType> };
                return held.match(Object.fromEntries(names.map((c) => [c, (_$2: unknown, payload: ExprType<typeof StampType>) =>
                    c === status.draft ? East.value(variant("draft", null), SchedulePeriodStatusType)
                        : c === status.published ? East.value(variant("published", { at: stamped ? some(payload.at) : none }), SchedulePeriodStatusType)
                            : East.value(variant("other", c), SchedulePeriodStatusType)])));
            });
            // The row, or a new one, with its status the published case at the time given.
            const publish = East.function([OptionType(BlobType), DateTimeType], BlobType, ($, held, at) => {
                const row = $.const(rowOf(held));
                const published = $.const(East.value(variant(status.published, stamped ? { at } : null) as never, statusType) as ExprType<EastType>);
                return East.Blob.encodeBeast(withField(row, status.field, published), "v2");
            });
            // The proposals a row dismissed, and the row, or a new one, dismissing the set given: the Roster's.
            const dismissedOf = East.function([BlobType], SetType(StringType), ($, bytes) => {
                if (dismissedField === undefined) return East.value(new Set<string>(), SetType(StringType));
                const row = $.const(bytes.decodeBeast(rowType, "v2"));
                return fieldOf(row, dismissedField) as ExprType<SetType<StringType>>;
            });
            const dismiss = East.function([OptionType(BlobType), SetType(StringType)], BlobType, ($, held, keys) => {
                const row = $.const(rowOf(held));
                if (dismissedField === undefined) {
                    // The builder offers no Reject without `dismissed` (`dismissible`), so nothing asks this.
                    $.error(`${where}: the builder maps no \`dismissed\` field — give \`dismissed\` to keep the proposals a period dismissed`);
                    return East.Blob.encodeBeast(row, "v2");
                }
                return East.Blob.encodeBeast(withField(row, dismissedField, keys as ExprType<EastType>), "v2");
            });
            return East.value({
                every: variant(every, null),
                editing,
                entries: seam,
                rows,
                status: statusOf,
                publish,
                dismissible: dismissedField !== undefined,
                dismissed: dismissedOf,
                dismiss,
                history: session.history,
                rowType: toEastTypeValue(rowType),
            } as never, SchedulePeriodsKindType);
        },
    };
}
