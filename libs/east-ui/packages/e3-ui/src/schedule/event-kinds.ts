/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule.events.kinds(record, field, cases, shared)` (#1769): an event kind
 * per case of a variant field of one record's rows. One record often holds
 * every kind of dated thing an app plans, one entry each — a print works'
 * steps: press runs, setups, crew shifts, deliveries — each holding what it is
 * in a variant field whose cases carry their own fields. Each case given is a
 * kind of its own over the rows holding it (`events.ts`' `scheduleCaseEvents`):
 * its own name, icon, way of drawing, title, times, templates and landing, its
 * accessors handed the case's value after the row and its key, as
 * `Schedule.templates`' and `Plan.series.kinds`' are. The kinds share the
 * record's own options (`shared`): its read by key, its keys, the app's check,
 * its form, and the source of the slice they read through — and its one
 * editing session, whose history key is the record's, so a gesture on any of
 * them is a step of it and Save sends the record one request. A Plan takes
 * them; the Calendar, the Roster and the Allocation take none yet.
 *
 * @packageDocumentation
 */

import {
    Expr,
    type BooleanType, type DateTimeType, type EastType, type ExprType, type FunctionType, type NullType, type OptionType, type StringType, type StructType,
    type SubtypeExprOrValue, type VariantType,
} from "@elaraai/east";
import type { UIComponentType } from "@elaraai/east-ui";
import type { EditingReadinessType, FieldHints } from "@elaraai/east-ui/internal";
import type { PlanDrawLiteral } from "../plan/types.js";
import { caseValueOf, variantCasesIn } from "../utils/cases.js";
import type { KindRowKeys } from "../utils/record-kind.js";
import {
    scheduleCaseEvents,
    type ScheduleAtField, type ScheduleEventKind, type ScheduleInstantField, type ScheduleInstantTemplate, type ScheduleLaneField,
    type ScheduleOverlapsLiteral, type ScheduleQuantity, type ScheduleRecordHandle, type ScheduleResourceField, type ScheduleStateField,
    type ScheduleStatusConfig, type ScheduleStatusField, type ScheduleStringField, type ScheduleTemplate,
} from "./events.js";
import type { FieldName } from "./fields.js";
import type { ScheduleTemplates } from "./templates.js";
import type { ScheduleDurationType } from "./types.js";

/** Whether a variant's cases are an Option's. */
type IsOption<C> = "none" extends keyof C ? ("some" extends keyof C ? true : false) : false;

/** A type with its Option taken off, once. */
type Unwrapped<T> = T extends VariantType<infer C> ? (IsOption<C> extends true ? C["some" & keyof C] : T) : T;

/**
 * The cases of a variant field of a row, by name, each what it holds; `never` for a field that is no variant, or an
 * Option.
 *
 * @typeParam R - The row type
 * @typeParam F - The field
 */
export type ScheduleCasesOf<R extends StructType, F extends string> =
    F extends keyof R["fields"] ? (R["fields"][F] extends VariantType<infer C> ? (IsOption<C> extends true ? never : C) : never) : never;

/**
 * An accessor of one case's event: its row, its key, and the value its case holds.
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 * @typeParam V - What the case holds
 * @typeParam O - What the accessor returns
 */
export type ScheduleCaseAccessor<K extends EastType, R extends EastType, V extends EastType, O extends EastType> =
    (row: ExprType<R>, key: ExprType<K>, value: ExprType<V>) => SubtypeExprOrValue<O>;

/** What a resource field's `of` takes for a kind of one case: a slot for some of a variant field's cases, or one slot. */
type CaseResourceOf<T> = T extends StringType ? string : T extends VariantType<infer C> ? { readonly [K in keyof C]?: string } : never;

/**
 * The resource a kind of one case's events are on (#1769): `Schedule.events`' `resource`, its `of` naming a slot for
 * some of a variant field's cases alone — a press's runs and setups land on the presses, a crew's shifts on the crews.
 * A row whose field holds a case `of` names no slot for is on no resource.
 *
 * @typeParam R - The row type
 */
export type ScheduleCaseResource<R extends StructType> = {
    [F in ScheduleResourceField<R>]: { field: F; of: CaseResourceOf<Unwrapped<R["fields"][F]>> }
}[ScheduleResourceField<R>];

/**
 * What every kind of one case takes on its own (`Schedule.events`' options, #1769): its name and icon, how it draws and
 * its roles, each accessor handed the case's value after the row and its key.
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 * @typeParam V - What the case holds
 */
export interface ScheduleCaseKindBase<K extends EastType, R extends StructType, V extends EastType> {
    /** The kind's name: on its events, in the filter and the inspector. */
    name: string;
    /** Its Font Awesome icon. */
    icon: string;
    /** An event's title: a String field of the row, or a function of the row, its key and the case's value. A Plan requires it. */
    title?: ScheduleStringField<R> | ScheduleCaseAccessor<K, R, V, StringType>;
    /** The resource its events are on; given here, over the shared options'. */
    resource?: ScheduleCaseResource<R>;
    /** A variant field shown as the event's status, a Status per case. */
    status?: ScheduleStatusConfig<R, ScheduleStatusField<R>>;
    /** The `EventStateType` field whose lifecycle its events wear. */
    state?: ScheduleStateField<R>;
    /** The Float field a bar prints and a parent's rollup sums, unit by unit. */
    quantity?: ScheduleQuantity<R>;
    /** The field naming the lane a tile sits in. */
    lane?: ScheduleLaneField<R>;
    /** The row beneath its resource an event is on. */
    child?: { field: FieldName<R>; of: string };
    /** Whether two of its events on one resource at once are a conflict (`"warn"`, the default) or run in parallel. */
    overlaps?: ScheduleOverlapsLiteral;
    /** The app's own lock on one event, of the row, its key and the case's value: `true` holds it where it is. */
    locked?: ScheduleCaseAccessor<K, R, V, BooleanType>;
    /** The kind's own inspector for one event: an East function over the event's row and a writer of the edited row. */
    inspector?: SubtypeExprOrValue<FunctionType<[R, FunctionType<[R], NullType>], UIComponentType>>;
}

/**
 * A kind of one case whose events run from a start to an end (#1769).
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 * @typeParam V - What the case holds
 */
export interface ScheduleCaseSpanKind<K extends EastType, R extends StructType, V extends EastType> extends ScheduleCaseKindBase<K, R, V> {
    /** The field an event starts at: a DateTime, or an Option of one, which gives the kind a backlog. */
    start: ScheduleInstantField<R>;
    /** The field an event ends at: of the start's type. */
    end: ScheduleInstantField<R>;
    /** How it draws — bars (`"span"`, the default), tiles in bucket cells, chips over whole buckets, or marks at its start. */
    draw?: PlanDrawLiteral;
    /** For Option times: how long an unscheduled row takes, and when it is due, each of the row, its key and the case's value. */
    backlog?: { duration: ScheduleCaseAccessor<K, R, V, ScheduleDurationType>; due?: ScheduleCaseAccessor<K, R, V, OptionType<DateTimeType>> };
    /** The presets the library lists: each makes a row of the kind's case. */
    templates?: readonly ScheduleTemplate<StructType>[] | ScheduleTemplates<StructType>;
}

/**
 * A kind of one case whose events are each one instant (#1769): a setup, a delivery.
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 * @typeParam V - What the case holds
 */
export interface ScheduleCaseInstantKind<K extends EastType, R extends StructType, V extends EastType> extends ScheduleCaseKindBase<K, R, V> {
    /** The DateTime field an event is at, in place of `start` and `end`. */
    at: ScheduleAtField<R>;
    /** How it draws — marks (the default) or tiles in bucket cells. */
    draw?: "buckets" | "marks";
    /** The presets the library lists: each makes a row of the kind's case, at one time. */
    templates?: readonly ScheduleInstantTemplate<StructType>[] | ScheduleTemplates<StructType>;
}

/**
 * What `Schedule.events.kinds` takes, by case (#1769): a kind for any of the field's cases, each handed the value its
 * case holds. A case given no kind is drawn by none.
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 * @typeParam F - The variant field
 */
export type ScheduleCaseKinds<K extends EastType, R extends StructType, F extends string> = {
    readonly [T in keyof ScheduleCasesOf<R, F> & string]?:
        | ScheduleCaseSpanKind<K, R, ScheduleCasesOf<R, F>[T] & EastType>
        | ScheduleCaseInstantKind<K, R, ScheduleCasesOf<R, F>[T] & EastType>
};

/**
 * What the kinds of one record share (#1769): the record's own options — its read by key, the source of the slice they
 * are read through, its keys, the app's check over a drafted row, its form — which every kind takes alike, and any of
 * the kinds' own roles they take alike, which a kind's own options stand over.
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 */
export interface ScheduleKindsShared<K extends EastType, R extends StructType> extends KindRowKeys<R, K> {
    /** A paged read of the record's own entries (`Data.bindPaged(record)`): one event read by its key, and the session's base. */
    entries?: unknown;
    /** The source of the Plan's slice the kinds read through, one for them all; omitted, each its slot's. */
    source?: string;
    /** The app's check on a drafted row, every case's: a refusal holds Save, naming the row and the field. */
    ready?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<typeof EditingReadinessType>;
    /** Hints for the inspector's form over the row's fields. */
    fields?: FieldHints<R["fields"]>;
    /** The resource the kinds' events are on, where a kind gives none of its own. */
    resource?: ScheduleCaseResource<R>;
    /** A variant field shown as each event's status, a Status per case. */
    status?: ScheduleStatusConfig<R, ScheduleStatusField<R>>;
    /** The `EventStateType` field whose lifecycle the events wear. */
    state?: ScheduleStateField<R>;
    /** The Float field a bar prints. */
    quantity?: ScheduleQuantity<R>;
    /** The field naming the lane a tile sits in. */
    lane?: ScheduleLaneField<R>;
    /** Whether two events of a kind on one resource at once are a conflict. */
    overlaps?: ScheduleOverlapsLiteral;
}

/** The record's own options, given in `shared` alone: its session holds them for every kind of it. */
const RECORD_OPTIONS = ["entries", "source", "ready", "fields", "keyField", "newKey", "rowKey", "window", "backlogWindow"] as const;

/** A kind's accessor of the row and its key, handed the case's value after them. */
type Accessor = (row: ExprType<EastType>, key: ExprType<EastType>, value: ExprType<EastType>) => unknown;

/**
 * Declares an event kind per case of a variant field of one record's rows (see the module docs).
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 * @typeParam F - The variant field
 * @typeParam C - The kinds given, by case
 * @param record - The record, `Record.bind(record)`, its record declaring `patch: mutation.patch()`
 * @param field - The variant field whose cases are the kinds
 * @param cases - A kind for any of its cases: `Schedule.events`' options, each accessor handed the case's value
 * @param shared - What the kinds share: the record's own options, and any of the kinds' own they take alike
 * @returns Each kind, by its case: what a Plan's `events` takes, by slot
 * @throws {Error} Naming the option: a `field` that is no variant field of the rows, or an Option; no case given, or a
 *   case that is none of the field's; a record option (`entries`, `source`, `ready`, `fields`, `keyField`, `newKey`,
 *   `rowKey`, `window`, `backlogWindow`) given by a case rather than in `shared`; and whatever `Schedule.events` refuses
 *   of a kind's options
 * @example
 * ```tsx
 * import { DateTimeType, DictType, East, FloatType, IntegerType, StringType, StructType, VariantType } from "@elaraai/east";
 * import { EventStateType } from "@elaraai/east-ui";
 * import { Data, Record, Schedule } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const StepType = StructType({
 *     on: VariantType({ press: StringType, crew: StringType }),
 *     start: DateTimeType, end: DateTimeType, state: EventStateType,
 *     kind: VariantType({ run: StructType({ title: StringType, sheets: FloatType }), shift: StructType({ people: IntegerType }) }),
 * });
 * const steps = e3.record("steps", DictType(StringType, StepType), {
 *     initial: new Map(),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 * });
 *
 * // Inside a Plan's Reactive body: each kind of step on its own machines, drawn its own way.
 * const kinds = Schedule.events.kinds(Record.bind(steps), "kind", {
 *     run: { name: "Print run", icon: "print", draw: "span", title: (_step, _key, run) => run.title,
 *         start: "start", end: "end", resource: { field: "on", of: { press: "presses" } } },
 *     shift: { name: "Crew shift", icon: "users", draw: "cards", title: (_step, _key, shift) => East.str`Crew of ${shift.people}`,
 *         start: "start", end: "end", resource: { field: "on", of: { crew: "crews" } } },
 * }, { state: "state", entries: Data.bindPaged(steps), source: "steps" });
 * ```
 */
export function scheduleEventKinds<
    K extends EastType, R extends StructType, const F extends ScheduleStatusField<R>, const C extends ScheduleCaseKinds<K, R, F>,
>(
    record: ScheduleRecordHandle<K, R>,
    field: F,
    cases: C,
    shared?: ScheduleKindsShared<K, R>,
    // Inferred from the arguments alone: a builder's `events` the kinds are written into would otherwise infer the cases
    // from its own slots, and leave each accessor's arguments untyped.
): { readonly [T in keyof NoInfer<C> & string]: ScheduleEventKind<NoInfer<K>, NoInfer<R>> } {
    const where = "Schedule.events.kinds";
    // The field's cases, where the record is a bound record of rows: one that is not is refused as `Schedule.events`
    // refuses it, by the first kind.
    const handle = Expr.type(record as unknown as Expr) as EastType;
    const read = handle.type === "Struct" ? (handle.fields as Readonly<Record<string, EastType>>)["read"] : undefined;
    const held = read?.type === "Function" ? read.output as EastType : undefined;
    const row = held?.type === "Dict" ? held.value as EastType : undefined;
    const fields = row?.type === "Struct" ? row.fields as Readonly<Record<string, EastType>> : undefined;
    const known = variantCasesIn(fields, field);
    if (fields !== undefined && (known === undefined || ("none" in known && "some" in known))) {
        throw new Error(`${where}: \`field\` names a variant field of the rows, a kind for each of its cases — and "${field}" is ` +
            `${fields[field] === undefined ? `no field of them (${Object.keys(fields).join(", ")})` : "no variant, or an Option"}`);
    }
    const given = Object.entries(cases as Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>)
        .filter((entry): entry is [string, Readonly<Record<string, unknown>>] => entry[1] !== undefined);
    if (given.length === 0) {
        throw new Error(`${where}: gives no case of "${field}" a kind — give each case drawn its own: { ${Object.keys(known ?? {}).map((c) => `${c}: { … }`).join(", ")} }`);
    }
    const out: Record<string, ScheduleEventKind<EastType, EastType>> = {};
    for (const [tag, config] of given) {
        if (known !== undefined && !Object.hasOwn(known, tag)) {
            throw new Error(`${where}: "${tag}" is no case of "${field}" (${Object.keys(known).join(", ")})`);
        }
        // The record's own options are its session's, every kind's alike: given once, in `shared`.
        const own = RECORD_OPTIONS.find((option) => config[option] !== undefined);
        if (own !== undefined) {
            throw new Error(`${where}: case "${tag}" gives \`${own}\`, the record's own — every kind of it shares its one session: give it in \`shared\`, the last argument`);
        }
        // Each accessor of the row and its key, handed the case's value after them.
        const handed = (fn: unknown): unknown => typeof fn !== "function" ? fn
            : (rowExpr: ExprType<EastType>, key: ExprType<EastType>) => (fn as Accessor)(rowExpr, key, caseValueOf(rowExpr, field, tag));
        const backlog = config["backlog"] as { duration: unknown; due?: unknown } | undefined;
        const kind: Record<string, unknown> = {
            ...shared,
            ...config,
            title: handed(config["title"]),
            locked: handed(config["locked"]),
            ...(backlog === undefined ? {} : { backlog: { duration: handed(backlog.duration), ...(backlog.due === undefined ? {} : { due: handed(backlog.due) }) } }),
        };
        // A key left undefined is no option given.
        for (const key of Object.keys(kind)) if (kind[key] === undefined) delete kind[key];
        out[tag] = scheduleCaseEvents(record, kind, { field, tag });
    }
    return out as unknown as { readonly [T in keyof NoInfer<C> & string]: ScheduleEventKind<NoInfer<K>, NoInfer<R>> };
}
