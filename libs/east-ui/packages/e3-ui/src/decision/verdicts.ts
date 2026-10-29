/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `DecisionQueue.verdicts(binding, roles)` (#1450, `Decision Queue Spec.md`
 * §5.2): the app's record of verdicts, which the queue writes — one row under
 * each decided case's key, through the record's patch door at Save, as every
 * editing builder writes its records (Q2, D3).
 *
 * Each role names a field of the verdict's row, never an accessor: the queue
 * writes it, as a builder writes only the fields its roles name, and every
 * other field of a row reads back as it was — a new row's its type's default.
 * The verdicts are read by key, the keys of the cases read, through `entries`,
 * never whole (D4): a case shows while no verdict, saved or drafted, holds its
 * key (D1).
 *
 * @packageDocumentation
 */

import {
    BlobType, DateTimeType, East, NullType, OptionType, StringType, StructType, defaultValue, isTypeEqual, none, printType, some, variant,
    type EastType, type ExprType, type VariantType,
} from "@elaraai/east";
import type { ScheduleCaseOf, ScheduleStatusField } from "../schedule/events.js";
import type { FieldName, FieldsOf } from "../schedule/fields.js";
import { scheduleRecordSession } from "../schedule/session.js";
import { optionOf, typeText } from "../schedule/window.js";
import { recordBound, recordEntries, rowWith, type RecordBinding } from "../utils/record-side.js";
import { DecisionVerdictType, DecisionVerdictsKindType } from "./types.js";

/** The declaration, as the refusals name it. */
const WHERE = "DecisionQueue.verdicts";

/** What a verdict's case holds beside Null: when it was given. */
const StampType = StructType({ at: DateTimeType });

/** What an Option holds. */
type OptionOf<T> = T extends OptionType<infer V> ? V : never;

/** An `Option<String>` field of the row: the option taken, the note. */
export type DecisionStringOptionField<R extends StructType> = FieldsOf<R, OptionType<StringType>>;

/** An Option of a variant field of the row: the answer, the reason. */
export type DecisionChoiceField<R extends StructType> = {
    [F in FieldName<R>]: R["fields"][F] extends OptionType<infer V> ? (V extends VariantType<infer _C> ? F : never) : never
}[FieldName<R>];

/** The cases of an Option of a variant field, by name. */
type ChoiceCase<R extends StructType, F extends string> = ScheduleCaseOf<OptionOf<R["fields"][F]>>;

/**
 * The verdicts' roles (§5.2): each a field of the verdict's row, by name.
 *
 * @typeParam R - The verdict's row type
 * @typeParam VF - The verdict field
 * @typeParam AF - The answer field
 * @typeParam RF - The reason field
 */
export interface DecisionVerdictRoles<R extends StructType, VF extends string, AF extends string, RF extends string> {
    /** A paged read of the record's own entries, `Data.bindPaged(record)`: the verdicts read by key, the keys of the cases read. */
    entries: unknown;
    /**
     * The verdict: a variant field, not an Option, and which of its cases means which — each holding Null, or
     * `{ at: DateTime }`, the time the verdict was given.
     */
    verdict: {
        /** The variant field. */
        field: VF;
        /** The case Apply writes. */
        applied: ScheduleCaseOf<R["fields"][VF]>;
        /** The case Override case writes. */
        overridden: ScheduleCaseOf<R["fields"][VF]>;
        /** The case Defer writes. */
        deferred: ScheduleCaseOf<R["fields"][VF]>;
        /** The case Hand off writes. */
        handedOff: ScheduleCaseOf<R["fields"][VF]>;
    };
    /** The `Option<String>` field the option taken is written to — for an override, the one started from; none for a proposal. */
    option?: DecisionStringOptionField<R>;
    /** The Option of a variant field the answer to the option's question is written to, and which case means which; without it the card asks none. */
    answer?: {
        /** The field: an Option of a variant of unit cases. */
        field: AF;
        /** The case Yes writes. */
        yes: ChoiceCase<R, AF>;
        /** The case No writes. */
        no: ChoiceCase<R, AF>;
        /** The case Don't know writes. */
        unsure: ChoiceCase<R, AF>;
    };
    /** The Option of a variant field an override's reason is written to, and which case means which; without it Override asks none. */
    reason?: {
        /** The field: an Option of a variant of unit cases. */
        field: RF;
        /** The case Missing context writes. */
        context: ChoiceCase<R, RF>;
        /** The case Data is wrong writes. */
        data: ChoiceCase<R, RF>;
        /** The case Priorities changed writes. */
        priorities: ChoiceCase<R, RF>;
        /** The case Other writes. */
        other: ChoiceCase<R, RF>;
    };
    /** The `Option<String>` field the case's note is written to; without it, no note. */
    note?: DecisionStringOptionField<R>;
}

/** The key `DecisionQueue.verdicts`' declaration carries its sort under. */
const VERDICTS: unique symbol = Symbol("DecisionQueue.verdicts");

/** The verdicts, declared: what the queue's `verdicts` takes. */
export interface DecisionQueueVerdicts {
    /** What it is. */
    readonly [VERDICTS]: true;
    /** The verdict's row type. */
    readonly rowType: StructType;
    /**
     * The verdicts' kind on the wire.
     *
     * @returns The kind, closed: the session over the record, its read by key and the verdict's write
     */
    build(): ExprType<typeof DecisionVerdictsKindType>;
}

/**
 * Whether something is `DecisionQueue.verdicts`' declaration.
 *
 * @param value - What the queue's `verdicts` was given
 * @returns Whether it is one
 */
export function isDecisionQueueVerdicts(value: unknown): value is DecisionQueueVerdicts {
    return typeof value === "object" && value !== null && VERDICTS in value;
}

/** The roles, erased: what the implementation reads. */
interface AnyRoles {
    entries?: unknown;
    verdict?: Readonly<Record<string, unknown>>;
    option?: unknown;
    answer?: Readonly<Record<string, unknown>>;
    reason?: Readonly<Record<string, unknown>>;
    note?: unknown;
}

/** A role naming a variant field — or an Option of one — and which of its cases each of the queue's means, checked. */
interface Mapped {
    /** The field. */
    readonly field: string;
    /** The variant the field holds, unwrapped of its Option. */
    readonly variant: VariantType;
    /** The app's case each of the queue's means. */
    readonly cases: Readonly<Record<string, string>>;
    /** Whether the app's cases hold when the verdict was given. */
    readonly stamped: boolean;
}

/**
 * Declares the verdicts (§5.2): the app's record the queue writes a verdict
 * into under each decided case's key, and the fields its roles name.
 *
 * @typeParam R - The verdict's row type, from the binding
 * @typeParam VF - The verdict field
 * @typeParam AF - The answer field
 * @typeParam RF - The reason field
 * @param binding - The verdicts' record with its patch door, `Record.bind(record), its record declaring patch:
 *   mutation.patch()`, a `Dict<String, V>` keyed by the case's key
 * @param roles - Its `entries`, and the field each part of the verdict is written to
 * @returns The verdicts, for the queue's `verdicts`
 * @throws {Error} Naming the role or the binding: a binding read only or without its patch door, or of a record of
 *   another type; no `entries`, or no paged read of the record's own entries; a role naming a field the row lacks, or
 *   one of another type; a verdict field that is no variant or is an Option, a case naming none of its cases, two of
 *   the queue's naming one, or a case holding anything but Null or `{ at: DateTime }`; an answer or a reason field that
 *   is no Option of a variant of unit cases, or a case naming none of them
 *
 * @example
 * ```tsx
 * DecisionQueue.verdicts(Record.bind(opsVerdicts), {
 *     entries: Data.bindPaged(opsVerdicts),
 *     verdict: { field: "verdict", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" },
 *     option: "option",
 *     answer: { field: "answer", yes: "yes", no: "no", unsure: "unsure" },
 *     note: "note",
 * })
 * ```
 */
export function decisionQueueVerdicts<R extends StructType, VF extends ScheduleStatusField<R>, AF extends DecisionChoiceField<R> = never,
    RF extends DecisionChoiceField<R> = never>(binding: RecordBinding<R>, roles: DecisionVerdictRoles<R, VF, AF, RF>): DecisionQueueVerdicts;
export function decisionQueueVerdicts(binding: unknown, input: unknown): DecisionQueueVerdicts {
    const roles = (input ?? {}) as AnyRoles;
    const bound = recordBound(binding, WHERE, "the verdicts are a Dict<String, V>, each verdict a struct under its case's key");
    if (bound.form !== "record") {
        throw new Error(`${WHERE}: the queue writes each verdict — bind the record with its patch door, Record.bind(record), its record declaring patch: mutation.patch(), ` +
            "and read it by key beside it, entries: Data.bindPaged(record)");
    }
    const entries = recordEntries(bound, roles.entries, WHERE);
    if (entries === undefined) {
        throw new Error(`${WHERE}: \`entries\` reads the verdicts by key — the keys of the cases read — never whole: give entries: Data.bindPaged(record), ` +
            "the record's own entries");
    }
    const rowType = bound.rowType;
    const fields = rowType.fields as Readonly<Record<string, EastType>>;
    const fieldType = (role: string, name: unknown): EastType => {
        const type = typeof name === "string" ? fields[name] : undefined;
        if (type === undefined) {
            throw new Error(`${WHERE}: \`${role}\` names "${String(name)}", a field the row does not have (${Object.keys(fields).join(", ")})`);
        }
        return type;
    };

    // A field naming the variant a role writes — the verdict's a variant itself, the answer's and the reason's an Option of
    // one — and which of its cases each of the queue's means.
    const mapped = (role: string, given: Readonly<Record<string, unknown>> | undefined, ours: readonly string[], optional: boolean): Mapped | undefined => {
        if (given === undefined) return undefined;
        const field = given["field"];
        const type = fieldType(`${role}.field`, field);
        const inner = optional ? optionOf(type) : (optionOf(type) === undefined ? type : undefined);
        if (inner === undefined || inner.type !== "Variant") {
            throw new Error(optional
                ? `${WHERE}: \`${role}.field\` names an Option of a variant, its cases ${ours.length} of the app's — "${String(field)}" holds ${typeText(type)}`
                : `${WHERE}: \`${role}.field\` names a variant field, not an Option — "${String(field)}" holds ${typeText(type)}`);
        }
        const variantType = inner as VariantType;
        const held = variantType.cases as Readonly<Record<string, EastType>>;
        const names = Object.keys(held);
        const cases: Record<string, string> = {};
        let stamped: boolean | undefined;
        for (const our of ours) {
            const name = given[our];
            if (typeof name !== "string" || !names.includes(name)) {
                throw new Error(`${WHERE}: \`${role}.${our}\` names a case of "${String(field)}" (${names.join(", ")}) — and it names "${String(name)}"`);
            }
            const holds = held[name]!;
            if (optional) {
                if (!isTypeEqual(holds, NullType)) {
                    throw new Error(`${WHERE}: \`${role}.${our}\` names "${name}", which holds ${printType(holds)} — each of the ${role}'s cases holds Null`);
                }
            } else {
                // A verdict's case holds nothing, or when it was given, as a period's published case does.
                const stamp = isTypeEqual(holds, StampType);
                if (!stamp && !isTypeEqual(holds, NullType)) {
                    throw new Error(`${WHERE}: the case "${name}" holds Null or { at: DateTime }, the time the verdict was given — and it holds ${printType(holds)}`);
                }
                stamped = (stamped ?? false) || stamp;
            }
            cases[our] = name;
        }
        const named = Object.values(cases);
        if (new Set(named).size !== named.length) {
            throw new Error(`${WHERE}: \`${role}\` names a case of "${String(field)}" for each of ${ours.join(", ")} — each a case of its own — and it names ${named.join(", ")}`);
        }
        return { field: field as string, variant: variantType, cases, stamped: stamped ?? false };
    };
    const stringOption = (role: string, name: unknown): string | undefined => {
        if (name === undefined) return undefined;
        const type = fieldType(role, name);
        if (!isTypeEqual(type, OptionType(StringType))) throw new Error(`${WHERE}: \`${role}\` names an Option<String> field — "${String(name)}" holds ${typeText(type)}`);
        return name as string;
    };

    if (roles.verdict === undefined) {
        throw new Error(`${WHERE}: \`verdict\` names the row's verdict field and its cases — { field, applied, overridden, deferred, handedOff }`);
    }
    const verdict = mapped("verdict", roles.verdict, ["applied", "overridden", "deferred", "handedOff"], false)!;
    const answer = mapped("answer", roles.answer, ["yes", "no", "unsure"], true);
    const reason = mapped("reason", roles.reason, ["context", "data", "priorities", "other"], true);
    const option = stringOption("option", roles.option);
    const note = stringOption("note", roles.note);
    const written = [verdict.field, answer?.field, reason?.field, option, note].filter((f): f is string => f !== undefined);
    const twice = written.find((f, i) => written.indexOf(f) !== i);
    if (twice !== undefined) throw new Error(`${WHERE}: two roles name "${twice}" — each part of the verdict is written to a field of its own`);

    // The session over the verdicts, declared now, so a record bound without its patch door is refused here.
    const session = scheduleRecordSession(bound.handle, StringType, rowType, entries);

    return {
        [VERDICTS]: true,
        rowType,
        build() {
            const { editing, entries: seam } = session.build();
            const blank = East.value(defaultValue(rowType) as never, rowType) as ExprType<EastType>;
            // A choice — an answer or a reason — as the app's field holds it: the case each of the queue's means.
            const choiceOf = (role: Mapped, given: ExprType<OptionType<VariantType>>): ExprType<EastType> => {
                const Field = OptionType(role.variant);
                return given.match({
                    none: (_$) => East.value(none, Field),
                    some: (_$, picked) => (picked as unknown as { match: (arms: object) => ExprType<EastType> }).match(Object.fromEntries(
                        Object.entries(role.cases).map(([our, theirs]) => [our, (_$2: unknown) => East.value(some(variant(theirs, null)) as never, Field)]))),
                }) as ExprType<EastType>;
            };
            // The verdict written into its row — the stored one, or a new row of the type's defaults — the fields its roles
            // map written and every other field as it was.
            const write = East.function([OptionType(BlobType), DecisionVerdictType], BlobType, ($, held, given) => {
                const row = $.const(held.match({
                    some: (_$2, bytes) => bytes.decodeBeast(rowType, "v2") as ExprType<EastType>,
                    none: (_$2) => blank,
                }) as ExprType<EastType>);
                const at = $.const(given.at);
                const decided = $.const((given.verdict as unknown as { match: (arms: object) => ExprType<EastType> }).match(Object.fromEntries(
                    Object.entries(verdict.cases).map(([our, theirs]) => {
                        const stamp = isTypeEqual((verdict.variant.cases as Readonly<Record<string, EastType>>)[theirs]!, StampType);
                        return [our, (_$2: unknown) => East.value(variant(theirs, stamp ? { at } : null) as never, verdict.variant)];
                    }))) as ExprType<EastType>);
                const set: Record<string, unknown> = { [verdict.field]: decided };
                if (option !== undefined) set[option] = given.option;
                if (note !== undefined) set[note] = given.note;
                if (answer !== undefined) set[answer.field] = choiceOf(answer, given.answer as unknown as ExprType<OptionType<VariantType>>);
                if (reason !== undefined) set[reason.field] = choiceOf(reason, given.reason as unknown as ExprType<OptionType<VariantType>>);
                return East.Blob.encodeBeast(rowWith(rowType, row, set), "v2");
            });
            return East.value({
                editing,
                entries: seam.unwrap(),
                write,
                roles: { option: option !== undefined, answer: answer !== undefined, reason: reason !== undefined, note: note !== undefined },
            } as never, DecisionVerdictsKindType) as ExprType<typeof DecisionVerdictsKindType>;
        },
    };
}
