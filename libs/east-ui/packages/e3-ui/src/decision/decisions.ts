/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `DecisionQueue.decisions(binding, roles)` (#1450, #1458, `Decision Queue
 * Spec.md` §5.1, §5.2): the cases a person decides — one record of the app's,
 * whatever kinds of decision it holds, each row carrying its verdict — read as
 * the Plan and the Sheet read rows: whole, or through the slice's `decisions`
 * source a page at a time, in the order the pages come back (D4, D5).
 *
 * Every role the queue reads is an East function over the app's row — an
 * option's over the option, its key and its case — reified once per row type
 * and held to the type its role takes, so the app's record keeps its own names
 * and shape. A case's options are optional: a case with none is its own one
 * proposal, its option's roles beside the case's (D15). The change role names
 * the app's variant: its tag is the kind of decision, its value a patch of the
 * record that kind changes, and `of` gives each tag the target it draws in —
 * checked against the variant when the code compiles and again at build (D6).
 *
 * The verdict's roles are fields of the case's row, by name, which the queue
 * writes through the record's patch door at Save, as a builder writes only the
 * fields its roles name (D1, D17): every other field reads back as it was.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, East, FloatType, NullType, OptionType, PatchType, SetType, StringType, StructType,
    isTypeEqual, none, printType, some, variant,
    type EastType, type ExprType, type FunctionType, type SubtypeExprOrValue, type TypeOf, type VariantType,
} from "@elaraai/east";
import type { Format } from "@elaraai/east-ui";
import { buildRowSource, resolveRowSource } from "@elaraai/east-ui/internal";
import { scheduleAccessorOver, scheduleAccessorReturns } from "../schedule/accessor.js";
import type { ScheduleCaseOf, ScheduleStatusField } from "../schedule/events.js";
import { fieldOf, type FieldName, type FieldsOf } from "../schedule/fields.js";
import { scheduleRecordSession } from "../schedule/session.js";
import { optionOf, typeText } from "../schedule/window.js";
import { recordBound, recordEntries, rowWith, type RecordBinding } from "../utils/record-side.js";
import { isDecisionTarget, type DecisionQueueTarget } from "./targets.js";
import { DecisionCaseType, DecisionChangeType, DecisionOptionType, DecisionVerdictCaseType, DecisionVerdictType, DecisionsKindType } from "./types.js";

/** The source of the slice the cases are read through. */
export const DECISIONS_SOURCE = "decisions";

// ============================================================================
// The roles, typed
// ============================================================================

/** East's value format: east-ui's `Format`. */
type TickFormat = typeof Format.Types.Tick;

/**
 * A role read from a case: an East function over the case's row and its key.
 *
 * @typeParam C - The case's row type
 * @typeParam T - The type the role takes
 */
export type DecisionCaseRole<C extends StructType, T extends EastType> = (row: ExprType<C>, key: ExprType<StringType>) => SubtypeExprOrValue<T>;

/**
 * A role read from an option: an East function over the option, its key and
 * its case.
 *
 * @typeParam O - The option's row type
 * @typeParam C - The case's row type
 * @typeParam T - The type the role takes
 */
export type DecisionOptionRole<O extends StructType, C extends StructType, T extends EastType> =
    (option: ExprType<O>, key: ExprType<StringType>, row: ExprType<C>) => SubtypeExprOrValue<T>;

/** The record a patch type is of: `DictType(K, R)` for `PatchType(DictType(K, R))`. */
export type DecisionRecordOfPatch<P> = P extends VariantType<infer Cases>
    ? Cases extends { replace: StructType<infer F> } ? F extends { before: infer D extends EastType } ? D : never : never
    : never;

/** The cases of the variant a change role's `from` returns. */
type CasesOf<V> = TypeOf<V> extends VariantType<infer Cases> ? Cases : never;

/** The row type of the options `options.from` returns, a `Dict<String, O>`. */
export type DecisionOptionRowOf<OE> = TypeOf<OE> extends DictType<StringType, infer O extends StructType> ? O : never;

/**
 * A target for each tag of the change role's variant, each over the record its
 * tag's patch is of (D6): `of` in the change role.
 *
 * @typeParam Cases - The variant's cases
 */
export type DecisionTargets<Cases> = { [T in keyof Cases]: DecisionQueueTarget<DecisionRecordOfPatch<Cases[T]>> };

/**
 * What `of` takes for the variant `from` returns: a target for each of its tags
 * ({@link DecisionTargets}). Until `from` is read the variant is `unknown`, and
 * so is `of`: TypeScript's first pass over a call reads no function, and holds
 * `of` to the variant only once `from` has given it.
 *
 * @typeParam V - The variant `from` returns
 */
export type DecisionTargetsOf<V> = unknown extends V ? unknown : DecisionTargets<CasesOf<V>>;

/**
 * The change role of a case that is its own one proposal (D15): the app's
 * variant, read by `from` from the case, and a target for each of its tags in
 * `of`, typed from the variant `from` returns (`NoInfer`).
 *
 * @typeParam C - The case's row type
 * @typeParam V - The variant `from` returns
 */
export interface DecisionChangeRole<C extends StructType, V> {
    /** The change: a variant whose tag is the kind of decision and whose value is a patch of the record that kind changes. */
    from: (row: ExprType<C>, key: ExprType<StringType>) => V;
    /** A target for every tag, `DecisionQueue.change.*`, each over the record its tag's patch is of. */
    of: NoInfer<DecisionTargetsOf<V>>;
}

/**
 * An option's change role: the app's variant, read by `from` from the option,
 * its key and its case, and a target for each of its tags in `of`, typed from
 * the variant `from` returns (`NoInfer`).
 *
 * @typeParam O - The option's row type
 * @typeParam C - The case's row type
 * @typeParam V - The variant `from` returns
 */
export interface DecisionOptionChangeRole<O extends StructType, C extends StructType, V> {
    /** The option's change: a variant whose tag is the kind of decision and whose value is a patch of the record that kind changes. */
    from: (option: ExprType<O>, key: ExprType<StringType>, row: ExprType<C>) => V;
    /** A target for every tag, `DecisionQueue.change.*`, each over the record its tag's patch is of. */
    of: NoInfer<DecisionTargetsOf<V>>;
}

/**
 * The roles read from a case (§5.1).
 *
 * @typeParam C - The case's row type
 */
export interface DecisionCaseRoles<C extends StructType> {
    /** The eyebrow after where it lands (`Inbound · W10`). */
    scope: DecisionCaseRole<C, StringType>;
    /** When it is due: the due words and their tone; `none` for no deadline. */
    due: DecisionCaseRole<C, OptionType<DateTimeType>>;
    /** Whether it is routine: the Routine mark on its card; without it, no mark. */
    routine?: DecisionCaseRole<C, BooleanType>;
    /** The value's word (`saved / wk`). */
    unit: DecisionCaseRole<C, StringType>;
    /** How its values print, east-ui's `Format`; without it, plain numbers. */
    format?: DecisionCaseRole<C, OptionType<TickFormat>>;
    /** What it costs if the recommendation is wrong; without it, `no data`. */
    ifWrong?: DecisionCaseRole<C, OptionType<FloatType>>;
    /** Why's line (`rota-opt · run #204`). */
    model: DecisionCaseRole<C, StringType>;
    /** Why's paragraph. */
    why: DecisionCaseRole<C, StringType>;
}

/** The option's roles a case that is its own one proposal gives beside its own (D15), as the refusals list them. */
const PROPOSAL_ROLES = ["title", "summary", "detail", "value", "confidence", "question", "warn", "refused", "knockOn", "guesses", "change"] as const;

/**
 * An option's roles, each an East function over the option, its key and its
 * case (§5.1): in `options`, for a case with alternatives.
 *
 * @typeParam O - The option's row type
 * @typeParam C - The case's row type
 * @typeParam OV - The variant the option's change role's `from` returns
 */
export interface DecisionOptionRoles<O extends StructType, C extends StructType, OV> {
    /** Its row in Options; its key by default. */
    label?: DecisionOptionRole<O, C, StringType>;
    /** The card's title, when it is the option shown; a receipt's words. */
    title: DecisionOptionRole<O, C, StringType>;
    /** The line beside Proposed / Modified. */
    summary: DecisionOptionRole<O, C, StringType>;
    /** The sentence under Change. */
    detail: DecisionOptionRole<O, C, StringType>;
    /** Its line in Options (`lands at 38 h of 38`). */
    note?: DecisionOptionRole<O, C, OptionType<StringType>>;
    /** The value line, and its figure in Options. */
    value: DecisionOptionRole<O, C, FloatType>;
    /** The model's confidence in it, 0 to 1. */
    confidence?: DecisionOptionRole<O, C, OptionType<FloatType>>;
    /** A question only a person can answer, which gates Apply. */
    question?: DecisionOptionRole<O, C, OptionType<StringType>>;
    /** The warning box's words. */
    warn?: DecisionOptionRole<O, C, OptionType<StringType>>;
    /** Why it is refused: off in Options, its reason on its line. */
    refused?: DecisionOptionRole<O, C, OptionType<StringType>>;
    /** The keys of the target's rows moved because of the change, not by it (P16). */
    knockOn?: DecisionOptionRole<O, C, SetType<StringType>>;
    /** The changed rows the model is unsure of, by key, and its confidence in each (P26). */
    guesses?: DecisionOptionRole<O, C, DictType<StringType, FloatType>>;
    /** Where it lands: the variant, and a target for each of its tags. */
    change: DecisionOptionChangeRole<O, C, OV>;
}

/**
 * A case's alternatives (§5.1): `from` reads them, a `Dict<String, O>` by key,
 * and the option's roles read each `O`. Give `from` first: TypeScript reads the
 * option's type from it for the roles after it.
 *
 * @typeParam C - The case's row type
 * @typeParam OE - What `from` returns
 * @typeParam OV - The variant the option's change role's `from` returns
 */
export interface DecisionOptions<C extends StructType, OE, OV> extends DecisionOptionRoles<DecisionOptionRowOf<OE>, C, OV> {
    /** The case's alternatives, by key, each a struct. */
    from: (row: ExprType<C>, key: ExprType<StringType>) => OE;
}

/**
 * The option's roles of a case that is its own one proposal (D15), each an
 * East function over the case's row and its key, given beside the case's. Such
 * a case needs `title`, `summary`, `detail`, `value` and `change`: the build
 * refuses one left out, naming it, as it refuses them given beside `options`.
 * It shows no Options, so an option's `label` and `note` are not among them:
 * the case's `note` is the verdict's (§5.2).
 *
 * @typeParam C - The case's row type
 * @typeParam V - The variant the change role's `from` returns
 */
export interface DecisionProposalRoles<C extends StructType, V> {
    /** The card's title, and a receipt's words. */
    title?: DecisionCaseRole<C, StringType>;
    /** The line beside Proposed / Modified. */
    summary?: DecisionCaseRole<C, StringType>;
    /** The sentence under Change. */
    detail?: DecisionCaseRole<C, StringType>;
    /** The value line. */
    value?: DecisionCaseRole<C, FloatType>;
    /** The model's confidence in it, 0 to 1. */
    confidence?: DecisionCaseRole<C, OptionType<FloatType>>;
    /** A question only a person can answer, which gates Apply. */
    question?: DecisionCaseRole<C, OptionType<StringType>>;
    /** The warning box's words. */
    warn?: DecisionCaseRole<C, OptionType<StringType>>;
    /** Why it is refused. */
    refused?: DecisionCaseRole<C, OptionType<StringType>>;
    /** The keys of the target's rows moved because of the change, not by it (P16). */
    knockOn?: DecisionCaseRole<C, SetType<StringType>>;
    /** The changed rows the model is unsure of, by key (P26). */
    guesses?: DecisionCaseRole<C, DictType<StringType, FloatType>>;
    /** Where it lands: the variant, and a target for each of its tags. */
    change?: DecisionChangeRole<C, V>;
}

/** What an Option holds. */
type OptionOf<T> = T extends OptionType<infer O> ? O : never;

/** An `Option<String>` field of the row: the option taken, the note. */
export type DecisionStringOptionField<R extends StructType> = FieldsOf<R, OptionType<StringType>>;

/** An Option of a variant field of the row: the answer, the reason. */
export type DecisionChoiceField<R extends StructType> = {
    [F in FieldName<R>]: R["fields"][F] extends OptionType<infer O> ? (O extends VariantType<infer _C> ? F : never) : never
}[FieldName<R>];

/** The cases of an Option of a variant field, by name. */
type ChoiceCase<R extends StructType, F extends string> = ScheduleCaseOf<OptionOf<R["fields"][F]>>;

/**
 * The verdict's roles (§5.2): each a field of the case's row, by name, which
 * the queue writes — never an accessor (D17).
 *
 * @typeParam C - The case's row type
 * @typeParam VF - The verdict field
 * @typeParam AF - The answer field
 * @typeParam RF - The reason field
 */
export interface DecisionVerdictRoles<C extends StructType, VF extends string, AF extends string, RF extends string> {
    /**
     * The verdict: a variant field, not an Option, and which of its cases means which — `waiting` holding Null, as the
     * model writes it on every new case, and each other case Null or `{ at: DateTime }`, the time the verdict was given.
     */
    verdict: {
        /** The variant field. */
        field: VF;
        /** The case a case holds until a person decides it. */
        waiting: ScheduleCaseOf<C["fields"][VF]>;
        /** The case Apply writes. */
        applied: ScheduleCaseOf<C["fields"][VF]>;
        /** The case Override writes. */
        overridden: ScheduleCaseOf<C["fields"][VF]>;
        /** The case Defer writes. */
        deferred: ScheduleCaseOf<C["fields"][VF]>;
        /** The case Hand off writes. */
        handedOff: ScheduleCaseOf<C["fields"][VF]>;
    };
    /** The `Option<String>` field the option taken is written to — for an override, the one started from; none for a proposal. */
    option?: DecisionStringOptionField<C>;
    /** The Option of a variant field the answer to the option's question is written to, and which case means which; without it the card asks none. */
    answer?: {
        /** The field: an Option of a variant of unit cases. */
        field: AF;
        /** The case Yes writes. */
        yes: ChoiceCase<C, AF>;
        /** The case No writes. */
        no: ChoiceCase<C, AF>;
        /** The case Don't know writes. */
        unsure: ChoiceCase<C, AF>;
    };
    /** The Option of a variant field an override's reason is written to, and which case means which; without it Override asks none. */
    reason?: {
        /** The field: an Option of a variant of unit cases. */
        field: RF;
        /** The case Missing context writes. */
        context: ChoiceCase<C, RF>;
        /** The case Data is wrong writes. */
        data: ChoiceCase<C, RF>;
        /** The case Priorities changed writes. */
        priorities: ChoiceCase<C, RF>;
        /** The case Other writes. */
        other: ChoiceCase<C, RF>;
    };
    /** The `Option<String>` field the case's note is written to; without it, no note. */
    note?: DecisionStringOptionField<C>;
}

/**
 * The roles `DecisionQueue.decisions` takes (§5.1, §5.2): the case's; either
 * `recommended` and the option's in `options`, for cases with alternatives, or
 * the option's beside the case's, for cases that are each their own one
 * proposal (D15); and the verdict's, the fields the queue writes. TypeScript
 * types each role from the binding's row; the build refuses the two forms
 * mixed and a required role left out, naming it.
 *
 * @typeParam C - The case's row type
 * @typeParam OE - What `options.from` returns
 * @typeParam OV - The variant an option's change role's `from` returns
 * @typeParam V - The variant a proposal's change role's `from` returns
 * @typeParam VF - The verdict field
 * @typeParam AF - The answer field
 * @typeParam RF - The reason field
 */
export interface DecisionRoles<C extends StructType, OE, OV, V, VF extends string, AF extends string, RF extends string>
    extends DecisionCaseRoles<C>, DecisionProposalRoles<C, V>, DecisionVerdictRoles<C, VF, AF, RF> {
    /**
     * A paged read of the cases' own record, `Data.bindPaged(record)`, beside the slice's `decisions` source: a case
     * read by key — a case drafted, and Save's confirmation (D4). Required beside the source; refused without one.
     */
    entries?: unknown;
    /** The key of the option the card opens on, one of `options`' keys; a key naming none is the case's warning (§12). Required with `options`. */
    recommended?: DecisionCaseRole<C, StringType>;
    /** The case's alternatives and the option's roles; without it, each case is its own one proposal (D15). */
    options?: DecisionOptions<C, OE, OV>;
}

// ============================================================================
// The declaration
// ============================================================================

/** The key `DecisionQueue.decisions`' declaration carries its sort under. */
const DECISIONS: unique symbol = Symbol("DecisionQueue.decisions");

/** The cases, declared: what the queue's `decisions` takes. */
export interface DecisionQueueDecisions {
    /** What it is. */
    readonly [DECISIONS]: true;
    /** The cases' row type. */
    readonly rowType: StructType;
    /** Each target, and the tags it serves, in the variant's order. */
    readonly targets: ReadonlyMap<DecisionQueueTarget<EastType>, readonly string[]>;
    /**
     * The cases' kind on the wire.
     *
     * @param rows - The slice's `decisions` source's narrowed data, bound in the queue's payload; `undefined` with no slice
     * @returns The kind, closed: the cases' reads, the session over their record and how a verdict is written into a row
     * @throws {Error} When the binding and the slice disagree — a source with no `entries` beside it, or `entries` with
     *   no source — or the source pages anything but the cases' own record, its rows joined
     */
    build(rows: ExprType<StructType> | undefined): ExprType<typeof DecisionsKindType>;
}

/**
 * Whether something is `DecisionQueue.decisions`' declaration.
 *
 * @param value - What the queue's `decisions` was given
 * @returns Whether it is one
 */
export function isDecisionQueueDecisions(value: unknown): value is DecisionQueueDecisions {
    return typeof value === "object" && value !== null && DECISIONS in value;
}

/** The declaration, as the refusals name it. */
const WHERE = "DecisionQueue.decisions";

/** What a verdict's case holds beside Null: when it was given. */
const StampType = StructType({ at: DateTimeType });

/** A reified role over its inputs, or `undefined` when not given. */
type Reified<T extends EastType> = ExprType<FunctionType<EastType[], T>> | undefined;

/**
 * Reifies one role, held to its type, refusing a role that is no function or
 * returns another type in the spec's words (§5.1).
 */
function roleOf<T extends EastType>(inputs: readonly EastType[], name: string, out: T, takes: string, fn: unknown, required: boolean): Reified<T> {
    if (fn === undefined) {
        if (required) throw new Error(`${WHERE}: \`${name}\` is required — an East function reading ${takes} from the row`);
        return undefined;
    }
    if (typeof fn !== "function") {
        throw new Error(`${WHERE}: \`${name}\` is an East function over the row and its key — ${name}: (row) => row.field — and it takes ${takes}`);
    }
    return scheduleAccessorOver(inputs, out, fn as (...args: ExprType<EastType>[]) => SubtypeExprOrValue<T>,
        (returns) => `${WHERE}: \`${name}\` returns ${returns} — it takes ${takes}`);
}

/** A reified role's value over its inputs, bound in the block; `otherwise` when the role is not given. */
function called(
    $: { const: (value: unknown) => unknown }, fn: unknown, args: readonly unknown[], wrap: (value: unknown) => unknown, otherwise: unknown,
): unknown {
    if (fn === undefined) return otherwise;
    const bound = $.const(fn) as (...args: unknown[]) => unknown;
    return wrap(bound(...args));
}

/**
 * The change role, checked (D6): `from` returns a variant, and `of` gives
 * every tag a target over the record its patch is of, and no other key.
 *
 * @returns The reified `from`, the variant, its tags and each tag's target
 */
function changeOf(inputs: readonly EastType[], name: string, change: unknown) {
    const role = change as { from?: unknown; of?: unknown } | undefined;
    if (role === undefined || typeof role !== "object" || typeof role.from !== "function" || typeof role.of !== "object" || role.of === null) {
        throw new Error(`${WHERE}: \`${name}\` is { from, of } — from: (o) => o.change, the variant whose tag is the kind of decision, ` +
            "and of: a target for each tag, DecisionQueue.change.*");
    }
    const from = role.from as (...args: ExprType<EastType>[]) => unknown;
    const variantType = scheduleAccessorReturns(inputs, from);
    if (variantType.type !== "Variant" || optionOf(variantType) !== undefined) {
        throw new Error(`${WHERE}: \`${name}.from\` returns ${typeText(variantType)} — it takes a variant, its tag the kind of decision and each tag's ` +
            "value a patch of the record that kind changes, PatchType(DictType(K, R))");
    }
    const cases = variantType.cases as Record<string, EastType>;
    const tags = Object.keys(cases);
    const of = role.of as Record<string, unknown>;
    for (const tag of tags) {
        if (of[tag] === undefined) {
            throw new Error(`${WHERE}: \`${name}.of\` gives no target for the tag '${tag}' — give each of the variant's tags (${tags.join(", ")}) a target, ` +
                "DecisionQueue.change.*: a tag with no target cannot reach the queue (D6)");
        }
    }
    const targets = new Map<string, DecisionQueueTarget<EastType>>();
    for (const [tag, target] of Object.entries(of)) {
        if (!tags.includes(tag)) {
            throw new Error(`${WHERE}: \`${name}.of\` names '${tag}', which is no tag of the variant \`${name}.from\` returns (${tags.join(", ")})`);
        }
        if (!isDecisionTarget(target)) {
            throw new Error(`${WHERE}: \`${name}.of.${tag}\` is a target — DecisionQueue.change.roster(…), .plan, .calendar, .allocation, .sheet, .record, ` +
                ".zones or .projection");
        }
        const patch = cases[tag]!;
        if (!isTypeEqual(patch, PatchType(target.recordType))) {
            // The record the tag's value is a patch of, when it is one.
            const replace = patch.type === "Variant" ? (patch.cases as Record<string, EastType>)["replace"] : undefined;
            const before = replace?.type === "Struct" ? (replace.fields as Record<string, EastType>)["before"] : undefined;
            const patched = before !== undefined && isTypeEqual(patch, PatchType(before)) ? `a patch of ${printType(before)}` : typeText(patch);
            throw new Error(`${WHERE}: \`${name}.of.${tag}\` draws ${printType(target.recordType)} — and the tag's value is ${patched}: ` +
                "give the tag a target over the record its patch is of (D6)");
        }
        targets.set(tag, target);
    }
    // Reified at the variant it returns, so the option's function reads its tags.
    const fn = scheduleAccessorOver(inputs, variantType, from as (...args: ExprType<EastType>[]) => SubtypeExprOrValue<EastType>,
        (returns) => `${WHERE}: \`${name}.from\` returns ${returns}`);
    return { fn, variantType, tags, targets };
}

/** The verdict's role naming a variant field — or an Option of one — and which of its cases each of the queue's means, checked. */
interface Mapped {
    /** The field. */
    readonly field: string;
    /** The variant the field holds, unwrapped of its Option. */
    readonly variant: VariantType;
    /** The app's case each of the queue's means. */
    readonly cases: Readonly<Record<string, string>>;
}

/** The queue's cases of the verdict, in the order its role lists them. */
const VERDICT_CASES = ["waiting", "applied", "overridden", "deferred", "handedOff"] as const;

/**
 * Declares the cases (§5.1, §5.2): the app's record of them with its patch
 * door, the roles that read each part of a card from its rows, and the
 * verdict's fields the queue writes.
 *
 * @typeParam C - The case's row type, from the binding
 * @typeParam OE - What `options.from` returns, inferred
 * @typeParam OV - The variant an option's change role's `from` returns, inferred
 * @typeParam V - The variant a proposal's change role's `from` returns, inferred
 * @typeParam VF - The verdict field
 * @typeParam AF - The answer field
 * @typeParam RF - The reason field
 * @param binding - The cases' record with its patch door, `Record.bind(record)`, its record a `Dict<String, C>` declaring
 *   `patch: mutation.patch()`: read whole, or through the slice's `decisions` source a page at a time
 * @param roles - The case's roles, `recommended` and the option's in `options` — or, for cases that are each their own
 *   one proposal, the option's beside the case's (D15) — the verdict's fields, and `entries` beside the slice's source
 * @returns The cases, for the queue's `decisions`
 * @throws {Error} Naming the role or the binding: a `Data.bind` or a `Data.bindPaged` (the queue writes each verdict into
 *   its case's row), a `Record.bind` without its patch door, or a record that is no `Dict<String, C>` of structs;
 *   `entries` that is no paged read of the cases' own record; a role that is no function or returns another type than its
 *   role takes; a required role left out; `recommended` without `options`, `options` without `recommended`, an option's
 *   role both in `options` and beside the case's, or `label` beside them (D15); a change role whose `from` returns no
 *   variant, whose `of` gives a tag no target or names no tag, or gives a tag a target over another record than its patch
 *   is of (D6); a verdict role naming a field the row lacks, or one of another type; a verdict field that is no variant
 *   or is an Option, a case naming none of its cases, two of the queue's naming one, one of its cases none of the queue's
 *   name, a `waiting` case holding anything but Null or another holding anything but Null or `{ at: DateTime }`; an
 *   answer or a reason field that is no Option of a variant of unit cases, or a case naming none of them; two roles
 *   naming one field
 *
 * @example
 * ```tsx
 * // A record of proposals, each its own one decision, its details a variant, its verdict a field of its own (§3.2)
 * DecisionQueue.decisions(Record.bind(proposals), {
 *     scope: p => p.site, due: p => p.deadline, unit: p => p.metric, model: p => p.run, why: p => p.rationale,
 *     title: p => p.headline, summary: p => p.brief, detail: p => p.description, value: p => p.saving,
 *     change: { from: p => p.details, of: { orders: orderChange, pricing: pricingChange } },
 *     verdict: { field: "verdict", waiting: "waiting", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" },
 * })
 * ```
 */
export function decisionQueueDecisions<C extends StructType, OE, OV, V, VF extends ScheduleStatusField<C>, AF extends DecisionChoiceField<C> = never,
    RF extends DecisionChoiceField<C> = never>(binding: RecordBinding<C>, roles: DecisionRoles<C, OE, OV, V, VF, AF, RF>): DecisionQueueDecisions;
export function decisionQueueDecisions(binding: unknown, roles: unknown): DecisionQueueDecisions {
    const bound = recordBound(binding, WHERE, "the cases are a Dict<String, C>, each case a struct under its key");
    if (bound.form !== "record") {
        throw new Error(`${WHERE}: the queue writes each verdict into its case's row — bind the cases' record with its patch door, ` +
            "Record.bind(record), its record declaring patch: mutation.patch(); cases a task outputs, which nothing writes, are filled into a " +
            "record by the app's own mutation first");
    }
    const given = (roles ?? {}) as Readonly<Record<string, unknown>>;
    const rowType = bound.rowType;
    // A case read by key beside the slice's source: a paged read of the cases' own record.
    const entries = recordEntries(bound, given["entries"], WHERE);
    const caseInputs = [rowType, StringType] as const;
    const options = given["options"] as Readonly<Record<string, unknown>> | undefined;

    // D15: a case with alternatives names its recommendation among them; a case that is its own proposal gives its
    // option's roles beside its own, and shows no Options.
    if (options === undefined && given["recommended"] !== undefined) {
        throw new Error(`${WHERE}: \`recommended\` names one of a case's \`options\` — and no \`options\` are given: give options: { from, … } with the ` +
            "option's roles inside it, or leave `recommended` out for cases that are each their own one proposal, the option's roles beside the case's (D15)");
    }
    if (options === undefined && given["label"] !== undefined) {
        throw new Error(`${WHERE}: \`label\` is an option's row in Options — and a case that is its own one proposal shows none (D15): give the case's ` +
            "alternatives in options: { from, label, … }, or leave `label` out");
    }
    if (options !== undefined) {
        const both = [...PROPOSAL_ROLES, "label"].filter((role) => given[role] !== undefined);
        if (both.length > 0) {
            throw new Error(`${WHERE}: \`${both[0]}\` is given beside the case's roles and \`options\` too — an option's roles go in options: { from, … } for ` +
                "cases with alternatives, or beside the case's for cases that are each their own one proposal, never both (D15)");
        }
        if (typeof options !== "object" || options === null || typeof options["from"] !== "function") {
            throw new Error(`${WHERE}: \`options\` is { from, …the option's roles } — from: (c) => c.options, a Dict<String, O> of the case's alternatives`);
        }
    }

    // The case's roles.
    const scope = roleOf(caseInputs, "scope", StringType, "a String", given["scope"], true);
    const due = roleOf(caseInputs, "due", OptionType(DateTimeType), "an Option<DateTime>", given["due"], true);
    const routine = roleOf(caseInputs, "routine", BooleanType, "a Boolean", given["routine"], false);
    const unit = roleOf(caseInputs, "unit", StringType, "a String", given["unit"], true);
    const format = roleOf(caseInputs, "format", OptionType(DecisionCaseType.fields.format.cases.some), "an Option of east-ui's Format", given["format"], false);
    const ifWrong = roleOf(caseInputs, "ifWrong", OptionType(FloatType), "an Option<Float>", given["ifWrong"], false);
    const model = roleOf(caseInputs, "model", StringType, "a String", given["model"], true);
    const why = roleOf(caseInputs, "why", StringType, "a String", given["why"], true);
    const recommended = options === undefined ? undefined : roleOf(caseInputs, "recommended", StringType, "a String, a key of the case's options", given["recommended"], true);

    // The option's roles: over the option, its key and its case — or, for a proposal, over the case and its key.
    let optionRow: StructType;
    let optionsFrom: Reified<EastType>;
    let optionInputs: readonly EastType[];
    let prefix: string;
    let optionRoles: Readonly<Record<string, unknown>>;
    if (options !== undefined) {
        const read = scheduleAccessorReturns(caseInputs, options["from"] as (...args: ExprType<EastType>[]) => unknown);
        if (read.type !== "Dict" || !isTypeEqual(read.key as EastType, StringType) || (read.value as EastType).type !== "Struct") {
            throw new Error(`${WHERE}: \`options.from\` returns ${typeText(read)} — it takes a Dict<String, O>, the case's alternatives by key, each a struct`);
        }
        optionRow = read.value as StructType;
        optionsFrom = roleOf(caseInputs, "options.from", read, "a Dict<String, O>", options["from"], true);
        optionInputs = [optionRow, StringType, rowType];
        prefix = "options.";
        optionRoles = options;
    } else {
        optionRow = rowType;
        optionsFrom = undefined;
        optionInputs = caseInputs;
        prefix = "";
        optionRoles = given;
    }
    const role = <T extends EastType>(name: string, out: T, takes: string, required: boolean) =>
        roleOf(optionInputs, `${prefix}${name}`, out, takes, optionRoles[name], required);
    // A proposal shows no Options: its row's label and line are an option's alone, and the case's `note` the verdict's (D15).
    const label = options === undefined ? undefined : role("label", StringType, "a String", false);
    const title = role("title", StringType, "a String", true);
    const summary = role("summary", StringType, "a String", true);
    const detail = role("detail", StringType, "a String", true);
    const note = options === undefined ? undefined : role("note", OptionType(StringType), "an Option<String>", false);
    const value = role("value", FloatType, "a Float", true);
    const confidence = role("confidence", OptionType(FloatType), "an Option<Float>", false);
    const question = role("question", OptionType(StringType), "an Option<String>", false);
    const warn = role("warn", OptionType(StringType), "an Option<String>", false);
    const refused = role("refused", OptionType(StringType), "an Option<String>", false);
    const knockOn = role("knockOn", SetType(StringType), "a Set<String>, the target's keys", false);
    const guesses = role("guesses", DictType(StringType, FloatType), "a Dict<String, Float>, the target's keys and the model's confidence in each", false);
    const change = changeOf(optionInputs, `${prefix}change`, optionRoles["change"]);

    // Each target and the tags it serves; a projection reads the option's own row, so it is held to its type.
    const targets = new Map<DecisionQueueTarget<EastType>, string[]>();
    for (const [tag, target] of change.targets) {
        if (target.optionRow !== undefined && !isTypeEqual(target.optionRow, optionRow)) {
            throw new Error(`${WHERE}: \`${prefix}change.of.${tag}\` reads its series from options of ${printType(target.optionRow)} — and the ` +
                `${options === undefined ? "cases, each its own proposal, are" : "options are"} ${printType(optionRow)}: give the projection the option's own row type`);
        }
        targets.set(target, [...(targets.get(target) ?? []), tag]);
    }
    const rowNeeded = [...targets.keys()].some((target) => target.optionRow !== undefined);

    // The verdict's roles: fields of the case's row, by name (§5.2).
    const fields = rowType.fields as Readonly<Record<string, EastType>>;
    const fieldType = (name: string, field: unknown): EastType => {
        if (typeof field !== "string") {
            throw new Error(`${WHERE}: \`${name}\` names a field of the case's row, which the queue writes (D17) — one of ${Object.keys(fields).join(", ")}`);
        }
        const type = fields[field];
        if (type === undefined) {
            throw new Error(`${WHERE}: \`${name}\` names "${field}", a field the row does not have (${Object.keys(fields).join(", ")})`);
        }
        return type;
    };
    // A field naming the variant a role writes — the verdict's a variant itself, the answer's and the reason's an Option of
    // one — and which of its cases each of the queue's means.
    const mapped = (name: string, mapping: unknown, ours: readonly string[], optional: boolean): Mapped | undefined => {
        if (mapping === undefined) return undefined;
        if (typeof mapping !== "object" || mapping === null) {
            throw new Error(`${WHERE}: \`${name}\` is { field, ${ours.join(", ")} } — the field, and which of its cases each means`);
        }
        const map = mapping as Readonly<Record<string, unknown>>;
        const field = map["field"];
        const type = fieldType(`${name}.field`, field);
        const inner = optional ? optionOf(type) : (optionOf(type) === undefined ? type : undefined);
        if (inner === undefined || inner.type !== "Variant") {
            throw new Error(optional
                ? `${WHERE}: \`${name}.field\` names an Option of a variant, its cases ${ours.length} of the app's — "${String(field)}" holds ${typeText(type)}`
                : `${WHERE}: \`${name}.field\` names a variant field, not an Option — "${String(field)}" holds ${typeText(type)}`);
        }
        const variantType = inner as VariantType;
        const held = variantType.cases as Readonly<Record<string, EastType>>;
        const names = Object.keys(held);
        const cases: Record<string, string> = {};
        for (const our of ours) {
            const theirs = map[our];
            if (typeof theirs !== "string" || !names.includes(theirs)) {
                throw new Error(`${WHERE}: \`${name}.${our}\` names a case of "${String(field)}" (${names.join(", ")}) — and it names ` +
                    `${typeof theirs === "string" ? `"${theirs}"` : "none"}`);
            }
            const holds = held[theirs]!;
            if (optional) {
                if (!isTypeEqual(holds, NullType)) {
                    throw new Error(`${WHERE}: \`${name}.${our}\` names "${theirs}", which holds ${printType(holds)} — each of the ${name}'s cases holds Null`);
                }
            } else if (our === "waiting") {
                if (!isTypeEqual(holds, NullType)) {
                    throw new Error(`${WHERE}: \`verdict.waiting\` names "${theirs}", which holds ${printType(holds)} — the waiting case holds Null, as the ` +
                        "model writes it on every new case");
                }
            } else if (!isTypeEqual(holds, StampType) && !isTypeEqual(holds, NullType)) {
                // A verdict's case holds nothing, or when it was given, as a period's published case does.
                throw new Error(`${WHERE}: the case "${theirs}" holds Null or { at: DateTime }, the time the verdict was given — and it holds ${printType(holds)}`);
            }
            cases[our] = theirs;
        }
        const named = Object.values(cases);
        if (new Set(named).size !== named.length) {
            throw new Error(`${WHERE}: \`${name}\` names a case of "${String(field)}" for each of ${ours.join(", ")} — each a case of its own — and it names ${named.join(", ")}`);
        }
        if (!optional) {
            // The queue reads every case of the verdict, so each is one of its own.
            const unmapped = names.find((theirs) => !named.includes(theirs));
            if (unmapped !== undefined) {
                throw new Error(`${WHERE}: \`verdict\` names every case of "${String(field)}" — "${unmapped}" is none of ${ours.join(", ")}: a case the ` +
                    "queue reads is waiting, or holds one of the four verdicts");
            }
        }
        return { field: field as string, variant: variantType, cases };
    };
    const stringOption = (name: string, field: unknown): string | undefined => {
        if (field === undefined) return undefined;
        const type = fieldType(name, field);
        if (!isTypeEqual(type, OptionType(StringType))) throw new Error(`${WHERE}: \`${name}\` names an Option<String> field — "${String(field)}" holds ${typeText(type)}`);
        return field as string;
    };
    if (given["verdict"] === undefined) {
        throw new Error(`${WHERE}: \`verdict\` names the case's verdict field and its cases — { field, ${VERDICT_CASES.join(", ")} }: the queue writes it`);
    }
    const verdict = mapped("verdict", given["verdict"], VERDICT_CASES, false)!;
    const answer = mapped("answer", given["answer"], ["yes", "no", "unsure"], true);
    const reason = mapped("reason", given["reason"], ["context", "data", "priorities", "other"], true);
    const option = stringOption("option", given["option"]);
    const verdictNote = stringOption("note", given["note"]);
    const written = [verdict.field, answer?.field, reason?.field, option, verdictNote].filter((f): f is string => f !== undefined);
    const twice = written.find((f, i) => written.indexOf(f) !== i);
    if (twice !== undefined) throw new Error(`${WHERE}: two roles name "${twice}" — each part of the verdict is written to a field of its own`);

    // The session over the cases' record, declared now, so a record bound without its patch door is refused here: its base
    // the record read whole — or, beside the slice's source, its revision, a case read by key through `entries`.
    const session = scheduleRecordSession(bound.handle, StringType, rowType, entries);

    // One option, from its row: over the option, its key and its case — or, for a proposal, the case and its key.
    const toOption = East.function([...optionInputs], DecisionOptionType, ($, ...args) => {
        const key = options === undefined ? none : some(args[1]);
        const changed = $.const(called($, change.fn, args, (v) => v, undefined) as ExprType<VariantType>);
        return East.value({
            key,
            label: called($, label, args, (l) => l, options === undefined ? "" : args[1]),
            title: called($, title, args, (t) => t, ""),
            summary: called($, summary, args, (s) => s, ""),
            detail: called($, detail, args, (d) => d, ""),
            note: called($, note, args, (n) => n, none),
            value: called($, value, args, (v) => v, 0.0),
            confidence: called($, confidence, args, (c) => c, none),
            question: called($, question, args, (q) => q, none),
            warn: called($, warn, args, (w) => w, none),
            refused: called($, refused, args, (r) => r, none),
            knockOn: called($, knockOn, args, (k) => k, East.value(new Set<string>(), SetType(StringType))),
            guesses: called($, guesses, args, (g) => g, East.value(new Map<string, number>(), DictType(StringType, FloatType))),
            change: (changed as unknown as { match: (arms: object) => unknown }).match(Object.fromEntries(change.tags.map((tag) =>
                [tag, (_$2: unknown, patch: ExprType<EastType>) => East.value({ tag, patch: East.Blob.encodeBeast(patch, "v2") }, DecisionChangeType)]))),
            row: rowNeeded ? some(East.Blob.encodeBeast(args[0] as ExprType<EastType>, "v2")) : none,
        } as never, DecisionOptionType);
    });

    // The verdict a row holds, as the queue reads it: `none` while it waits, else which of the four it is.
    const Read = OptionType(DecisionVerdictCaseType);
    const ours = Object.fromEntries(Object.entries(verdict.cases).map(([our, theirs]) => [theirs, our]));
    const verdictOf = (row: ExprType<EastType>): ExprType<EastType> =>
        (fieldOf(row, verdict.field) as unknown as { match: (arms: object) => ExprType<EastType> }).match(Object.fromEntries(
            Object.entries(ours).map(([theirs, our]) => [theirs, (_$2: unknown) => our === "waiting"
                ? East.value(none, Read)
                : East.value(some(variant(our, null)) as never, Read)])));

    // One case, from its row, its key and its bytes.
    const caseOf = East.function([rowType, StringType, BlobType], DecisionCaseType, ($, row, key, bytes) => {
        const args = [row, key];
        const toCase = $.const(toOption) as (...args: unknown[]) => unknown;
        let optionsOf: unknown;
        if (optionsFrom !== undefined) {
            const from = $.const(optionsFrom) as (...args: unknown[]) => ExprType<DictType<StringType, StructType>>;
            optionsOf = from(row, key).toArray(($2, o, k) => toCase(o, k, row) as never);
        } else {
            optionsOf = East.value([toCase(row, key)] as never, ArrayType(DecisionOptionType));
        }
        return East.value({
            key,
            scope: called($, scope, args, (s) => s, ""),
            due: called($, due, args, (d) => d, none),
            routine: called($, routine, args, (r) => r, false),
            unit: called($, unit, args, (u) => u, ""),
            format: called($, format, args, (f) => f, none),
            ifWrong: called($, ifWrong, args, (w) => w, none),
            model: called($, model, args, (m) => m, ""),
            why: called($, why, args, (w) => w, ""),
            recommended: called($, recommended, args, (r) => some(r), none),
            options: optionsOf,
            verdict: verdictOf(row as ExprType<EastType>),
            option: option === undefined ? East.value(none, OptionType(StringType)) : fieldOf(row, option),
            row: bytes,
        } as never, DecisionCaseType);
    });

    return {
        [DECISIONS]: true,
        rowType,
        targets,
        build(rows) {
            if (rows !== undefined && entries === undefined) {
                throw new Error(`${WHERE}: \`entries\` reads a case by key beside the slice's \`decisions\` source — a case drafted, and Save's ` +
                    "confirmation: give entries: Data.bindPaged(record), the cases' own record (D4)");
            }
            if (rows === undefined && entries !== undefined) {
                throw new Error(`${WHERE}: \`entries\` reads a case by key beside the slice's \`decisions\` source — and the queue has no slice, so its ` +
                    "cases are read whole: leave `entries` out, or give slice={{ slice: Slice.bindRecords(key, { decisions: { source, … } }) }}");
            }
            const { editing, entries: seam } = session.build();
            const Cases = ArrayType(DecisionCaseType);
            let cases: unknown;
            if (rows === undefined) {
                // Read whole, in the record's key order.
                const readAll = (bound.handle as unknown as { read: () => ExprType<DictType<StringType, StructType>> }).read;
                cases = variant("whole", East.function([], OptionType(Cases), ($) => {
                    const toCase = $.const(caseOf);
                    const held = $.const(readAll());
                    return some(held.toArray(($2, row, key) => toCase(row, key, East.Blob.encodeBeast(row, "v2"))));
                }));
            } else {
                // A page at a time through the slice's source, in the order its index gives them: a live source, its windows
                // read under the narrowing as it stands, its count e3's (D4, D5).
                const resolved = resolveRowSource(rows, "DecisionQueue.slice's decisions");
                const joined = resolved.kind === "ordered" && resolved.elementType.type === "Struct" ? resolved.elementType.fields.row : undefined;
                const pages = resolved.kind === "ordered" && resolved.query && isTypeEqual(resolved.keyType, StringType)
                    && joined?.type === "Variant" && joined.cases.some !== undefined && isTypeEqual(joined.cases.some, rowType);
                if (!pages) {
                    throw new Error(`DecisionQueue: \`slice\`'s \`decisions\` source pages the cases' own record, its rows joined — Data.bindPaged(record, ` +
                        `{ indexes }) over the record the cases are bound to, ${printType(rowType)} — and this one pages ${printType(resolved.collectionType)}`);
                }
                type Entry = StructType<{ key: StringType; row: OptionType<StructType> }>;
                cases = variant("paged", buildRowSource(resolved, Cases, (collection) => (collection as unknown as ExprType<ArrayType<Entry>>).map(($, entry) => {
                    const row = $.let(entry.row.unwrap("some"));
                    return caseOf(row, entry.key, East.Blob.encodeBeast(row, "v2"));
                })).unwrap("live"));
            }
            // A drafted row read as its case: the verdict a draft holds, over the rows the source read.
            const read = East.function([BlobType, StringType], DecisionCaseType, ($, bytes, key) => {
                const toCase = $.const(caseOf);
                return toCase(bytes.decodeBeast(rowType, "v2"), key, bytes);
            });
            // A choice — an answer or a reason — as the app's field holds it: the case each of the queue's means.
            const choiceOf = (mapping: Mapped, chosen: ExprType<OptionType<VariantType>>): ExprType<EastType> => {
                const Field = OptionType(mapping.variant);
                return chosen.match({
                    none: (_$) => East.value(none, Field),
                    some: (_$, picked) => (picked as unknown as { match: (arms: object) => ExprType<EastType> }).match(Object.fromEntries(
                        Object.entries(mapping.cases).map(([our, theirs]) => [our, (_$2: unknown) => East.value(some(variant(theirs, null)) as never, Field)]))),
                }) as ExprType<EastType>;
            };
            // The verdict written into the case's row: the fields its roles map written, every other field as it was.
            const write = East.function([BlobType, DecisionVerdictType], BlobType, ($, bytes, decided) => {
                const row = $.const(bytes.decodeBeast(rowType, "v2") as ExprType<EastType>);
                const at = $.const(decided.at);
                const verdictCase = $.const((decided.verdict as unknown as { match: (arms: object) => ExprType<EastType> }).match(Object.fromEntries(
                    VERDICT_CASES.filter((our) => our !== "waiting").map((our) => {
                        const theirs = verdict.cases[our]!;
                        const stamp = isTypeEqual((verdict.variant.cases as Readonly<Record<string, EastType>>)[theirs]!, StampType);
                        return [our, (_$2: unknown) => East.value(variant(theirs, stamp ? { at } : null) as never, verdict.variant)];
                    }))) as ExprType<EastType>);
                const set: Record<string, unknown> = { [verdict.field]: verdictCase };
                if (option !== undefined) set[option] = decided.option;
                if (verdictNote !== undefined) set[verdictNote] = decided.note;
                if (answer !== undefined) set[answer.field] = choiceOf(answer, decided.answer as unknown as ExprType<OptionType<VariantType>>);
                if (reason !== undefined) set[reason.field] = choiceOf(reason, decided.reason as unknown as ExprType<OptionType<VariantType>>);
                return East.Blob.encodeBeast(rowWith(rowType, row, set), "v2");
            });
            return East.value({
                cases,
                read,
                editing,
                entries: seam,
                write,
                roles: { option: option !== undefined, answer: answer !== undefined, reason: reason !== undefined, note: verdictNote !== undefined },
            } as never, DecisionsKindType) as ExprType<typeof DecisionsKindType>;
        },
    };
}
