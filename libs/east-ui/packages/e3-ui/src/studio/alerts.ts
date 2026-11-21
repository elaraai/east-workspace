/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's alerts (#1674) — the type of the record a solution declares
 * when it wants them, the patch every alert's Save, pause, delete and firing
 * writes it with, and the one East function that decides firing and
 * clearing.
 *
 * An alert is a condition on a visual's rows, set from a bell in the visual's
 * header. It fires while its visual's rows meet it: the visual's program,
 * printed from its page's live version with the alert's filters in place of
 * a reader's, then the rows that meet the condition — so an alert never
 * disagrees with its visual. An open Studio page checks its project's alerts
 * on e3, and writes the latest firing on each.
 *
 * ```ts
 * export const alerts = e3.record("alerts", Studio.Types.Alerts, {
 *     initial: new Map(),
 *     mutations: (mutation) => ({
 *         patch: mutation.patch(),
 *     }),
 * });
 * ```
 *
 * Each write is one patch through it, by the alert's name, carrying what it
 * changes as it was: two people saving one alert meet a conflict that names
 * it, and nothing is overwritten. A solution that declares no such record
 * passes no `alerts`, and no visual shows a bell.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    AsyncFunctionType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    East,
    FunctionType,
    IntegerType,
    JqType,
    NullType,
    OptionType,
    PatchType,
    StringType,
    StructType,
    VariantType,
    none,
    printFor,
    some,
    variant,
    type ExprType,
    type PatchTypeOf,
    type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { Record, RecordOutcomeType } from "../bind/record.js";
import { StudioFilterType } from "./filter.js";
import { StudioKeyType } from "./key.js";

// ============================================================================
// Types
// ============================================================================

/**
 * An alert's latest firing: set when it fires, `cleared` stamped when it
 * stops. A new firing replaces one that has cleared.
 *
 * @property at - When it fired
 * @property count - How many of its visual's rows met its condition then
 * @property rows - Those rows, as self-describing beast2: their type travels with them
 * @property cleared - When no row met it any more; `none` while it fires
 */
export const StudioAlertFiringType = StructType({
    at: DateTimeType,
    count: IntegerType,
    rows: BlobType,
    cleared: OptionType(DateTimeType),
});

/** Type representing an alert's latest firing. */
export type StudioAlertFiringType = typeof StudioAlertFiringType;

const StudioAlertTypeImpl = StructType({
    page: StudioKeyType,
    cell: StringType,
    condition: JqType,
    filters: ArrayType(StudioFilterType),
    paused: BooleanType,
    firing: OptionType(StudioAlertFiringType),
});
type StudioAlertTypeImpl = typeof StudioAlertTypeImpl;

/**
 * Type representing an alert.
 *
 * @remarks
 * An interface, so a type that mentions it refers to it by name in
 * declaration output rather than spelling it out: a jq condition is a deep
 * type, and a patch of it deeper, past the length TypeScript will serialize
 * (TS7056).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioAlertType extends StudioAlertTypeImpl {}

/**
 * An alert: a condition on a visual's rows.
 *
 * @property page - The key of the page the visual is on
 * @property cell - The visual's placement on it
 * @property condition - A jq condition on one of the visual's rows: its groups' keys and its values, by name
 * @property filters - The page's filters when it was made: what the visual's rows are narrowed by, in place of a reader's
 * @property paused - Whether it is left unchecked
 * @property firing - Its latest firing; `none` until it first fires
 */
export const StudioAlertType: StudioAlertType = StudioAlertTypeImpl;

const StudioAlertsTypeImpl = DictType(StringType, StudioAlertType);
type StudioAlertsTypeImpl = typeof StudioAlertsTypeImpl;

/**
 * Type representing the alerts record.
 *
 * @remarks
 * An interface, for the reason {@link StudioAlertType} is one.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioAlertsType extends StudioAlertsTypeImpl {}

/**
 * The alerts record's type — every alert, by its name. A solution declares
 * its record with it: `e3.record("alerts", Studio.Types.Alerts, { initial:
 * new Map(), mutations: … })`, its one mutation a patch.
 */
export const StudioAlertsType: StudioAlertsType = StudioAlertsTypeImpl;

/**
 * Type representing the alerts record's patch.
 *
 * @remarks
 * An interface, for the reason {@link StudioAlertType} is one.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioAlertsPatchType extends PatchTypeOf<StudioAlertsType> {}

/** The alerts record's patch — what every write is. */
export const StudioAlertsPatchType: StudioAlertsPatchType = PatchType(StudioAlertsType);

/**
 * Type representing a batch of writes to alerts.
 *
 * @remarks
 * An interface, for the reason {@link StudioAlertType} is one.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioAlertChangesType extends ReturnType<typeof Editing.Types.ChangeSet<StudioAlertType>> {}

/** A batch of writes to alerts, each by its name — what a Save, a pause, a delete and a firing send ({@link saveAlerts}). */
export const StudioAlertChangesType: StudioAlertChangesType = Editing.Types.ChangeSet(StudioAlertType);

const StudioAlertsHandleTypeImpl = StructType({
    read: FunctionType([], StudioAlertsType),
    history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
    commit: StructType({
        patch: AsyncFunctionType([StringType, StudioAlertsPatchType], RecordOutcomeType),
    }),
});
type StudioAlertsHandleTypeImpl = typeof StudioAlertsHandleTypeImpl;

/**
 * Type representing the bound alerts record.
 *
 * @remarks
 * An interface, for the reason {@link StudioAlertType} is one.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioAlertsHandleType extends StudioAlertsHandleTypeImpl {}

/**
 * The alerts record, bound with its patch — what a page's bells and checks,
 * and `<Studio.AlertBell>`, read and write through: the bound record's
 * `read`, its `history` and its patch write awaited. Their factories take
 * these from `Record.bind(alerts)`.
 *
 * @property read - The record's current state
 * @property history - Its commit chain, newest first — who changed an alert last, for a conflict's words
 * @property commit - Its patch write, awaited: a request id and the patch, answered by the outcome
 */
export const StudioAlertsHandleType: StudioAlertsHandleType = StudioAlertsHandleTypeImpl;

/**
 * The alerts record as the Studio's factories take it — a
 * `Record.bind(alerts)` handle, whose `read`, `history` and patch write they
 * pass on ({@link StudioAlertsHandleType}).
 */
export type StudioAlertsHandle = ExprType<StructType<{
    read: FunctionType<[], StudioAlertsType>;
    history: FunctionType<[], OptionType<ArrayType<typeof RecordCommitInfoType>>>;
    commit: StructType<{ patch: AsyncFunctionType<[typeof StringType, StudioAlertsPatchType], RecordOutcomeType> }>;
}>>;

/**
 * What a check of an alert found: how many of its visual's rows met its
 * condition, and those rows.
 *
 * @property count - How many rows met it
 * @property rows - Those rows, as self-describing beast2
 */
export const StudioAlertCheckType = StructType({
    count: IntegerType,
    rows: BlobType,
});

/** Type representing what a check of an alert found. */
export type StudioAlertCheckType = typeof StudioAlertCheckType;

/**
 * What a check does to an alert's firing.
 *
 * @property unchanged - Nothing: it is still firing, or still not
 * @property fired - It fires: rows meet it, where it was not firing — never fired, or cleared
 * @property cleared - It stops: no row meets it, where it was firing
 */
export const StudioAlertStepType = VariantType({
    unchanged: NullType,
    fired: StudioAlertFiringType,
    cleared: StudioAlertFiringType,
});

/** Type representing what a check does to an alert's firing. */
export type StudioAlertStepType = typeof StudioAlertStepType;

// ============================================================================
// The writes, and the firing
// ============================================================================

/**
 * Saves a batch of writes to alerts: a Save in a visual's alert popover, a
 * pause, a delete, a firing a check writes — one patch through the record's
 * patch write.
 *
 * @remarks
 * `Record.onApply`'s form over the record's own entries, each change naming
 * its alert. The patch carries what each alert was when the edit began, so a
 * Save drafted over an alert another write changed since is a conflict
 * naming it and who changed the record last, and nothing is overwritten.
 */
export const saveAlerts = East.asyncFunction(
    [StudioAlertsHandleType, StudioAlertChangesType],
    Editing.Types.ApplyResult,
    ($, handle, batch) => {
        const apply = $.const(Record.onApply(handle));
        return apply(batch);
    },
);

/**
 * What a check does to an alert's firing (#1674): it fires while rows of its
 * visual meet its condition, and clears when none do.
 *
 * @remarks
 * - **Never fired, or cleared**: rows meet it — it fires, at the check's
 *   instant, with how many and which rows; a new firing replaces one that has
 *   cleared. None meet it — nothing.
 * - **Firing**: it fired once, and stays as it fired while rows meet it; once
 *   none do, it clears, stamped with the check's instant.
 *
 * @example
 * ```ts
 * const step = East.compile(Studio.alertFiring, []);
 * step(none, { count: 2n, rows }, new Date("2026-09-15T12:00:00Z"));
 * // variant("fired", { at: 2026-09-15T12:00Z, count: 2n, rows, cleared: none })
 * ```
 */
export const alertFiring = East.function(
    [OptionType(StudioAlertFiringType), StudioAlertCheckType, DateTimeType],
    StudioAlertStepType,
    ($, firing, check, at) => {
        const meets = $.const(check.count.greater(0n));
        const fires = $.const(variant("fired", { at, count: check.count, rows: check.rows, cleared: none }), StudioAlertStepType);
        const unchanged = $.const(variant("unchanged", null), StudioAlertStepType);
        return firing.match({
            none: (_$2) => meets.ifElse(() => fires, () => unchanged),
            some: (_$2, held) => held.cleared.match({
                // Firing: it stays as it fired, and clears once no row meets it.
                none: (_$3) => meets.ifElse(
                    () => unchanged,
                    () => East.value(variant("cleared", { at: held.at, count: held.count, rows: held.rows, cleared: some(at) }), StudioAlertStepType),
                ),
                // Cleared: a new firing replaces it.
                some: (_$3) => meets.ifElse(() => fires, () => unchanged),
            }),
        });
    },
);

const printKey = printFor(StudioKeyType);

/**
 * The UI-store key the alert a page was opened for is kept under (#1674):
 * `<Studio.AlertBell>` writes an alert's name there as it opens the alert's
 * page with its filters, and the page draws a banner naming it, when it fired
 * and the rows that met it. It holds a `String`.
 *
 * @param page - The page's key
 * @returns The key
 */
export function studioAlertOpenedKey(page: ValueTypeOf<typeof StudioKeyType>): string {
    return `studio.alert.${printKey(page)}`;
}

/**
 * The bound alerts record as a payload holds it: its read, its history and
 * its patch write — never the handle's other doors.
 *
 * @param alerts - The record, bound with its patch — `Record.bind(alerts)`
 * @returns The payload's field
 */
export function alertsPayload(alerts: StudioAlertsHandle) {
    return { read: alerts.read, history: alerts.history, commit: { patch: alerts.commit.patch } };
}
