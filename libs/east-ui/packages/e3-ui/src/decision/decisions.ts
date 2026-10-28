/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `DecisionQueue.decisions(binding, roles)` (#1450, `Decision Queue Spec.md`
 * §5.1): the cases a person decides, read only, from one source of the app's —
 * a record, or a task's output — whatever kinds of decision it holds.
 *
 * Every role is an East function over the app's row — an option's over the
 * option, its key and its case — reified once per row type and held to the
 * type its role takes, so the app's record keeps its own names and shape. A
 * case's options are optional: a case with none is its own one proposal, its
 * option's roles beside the case's (D15). The change role names the app's
 * variant: its tag is the kind of decision, its value a patch of the record
 * that kind changes, and `of` gives each tag the target it draws in — checked
 * against the variant when the code compiles and again at build (D6).
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, PatchType, SetType, StringType,
    isTypeEqual, none, printType, some, variant,
    type EastType, type ExprType, type FunctionType, type StructType, type SubtypeExprOrValue, type TypeOf, type VariantType,
} from "@elaraai/east";
import type { Format } from "@elaraai/east-ui";
import type { RecordSliceStateType, RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { scheduleAccessorOver, scheduleAccessorReturns } from "../schedule/accessor.js";
import { optionOf, typeText } from "../schedule/window.js";
import { schematicSourceRows, schematicWholeRows } from "../schematic/window.js";
import { recordBound, type RecordBinding } from "../utils/record-side.js";
import { isDecisionTarget, type DecisionQueueTarget } from "./targets.js";
import { DecisionCaseType, DecisionCasesType, DecisionChangeType, DecisionOptionType, DecisionsKindType } from "./types.js";

/** Past this many cases the queue reads none: its banner names the count (§12). */
export const DECISION_QUEUE_CASES = 1_000n;

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
    /** When it is due, which places it in a section; `none` for no deadline. */
    due: DecisionCaseRole<C, OptionType<DateTimeType>>;
    /** Whether it belongs to the Routine band; without it, no band. */
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

/** The option's roles, by name, as the refusals list them. */
const OPTION_ROLES = ["label", "title", "summary", "detail", "note", "value", "confidence", "question", "warn", "refused", "knockOn", "guesses", "change"] as const;

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
    /** The value line, its figure, its share of the section's total. */
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
 *
 * @typeParam C - The case's row type
 * @typeParam V - The variant the change role's `from` returns
 */
export interface DecisionProposalRoles<C extends StructType, V> {
    /** Its words in a receipt; unused in Options, which a proposal has none of. */
    label?: DecisionCaseRole<C, StringType>;
    /** The card's title. */
    title?: DecisionCaseRole<C, StringType>;
    /** The line beside Proposed / Modified. */
    summary?: DecisionCaseRole<C, StringType>;
    /** The sentence under Change. */
    detail?: DecisionCaseRole<C, StringType>;
    /** A line under its title. */
    note?: DecisionCaseRole<C, OptionType<StringType>>;
    /** The value line and its share of the section's total. */
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

/**
 * The roles `DecisionQueue.decisions` takes (§5.1): the case's, and either
 * `recommended` and the option's in `options`, for cases with alternatives, or
 * the option's beside the case's, for cases that are each their own one
 * proposal (D15). TypeScript types each role from the binding's row; the build
 * refuses the two forms mixed and a required role left out, naming it.
 *
 * @typeParam C - The case's row type
 * @typeParam OE - What `options.from` returns
 * @typeParam OV - The variant an option's change role's `from` returns
 * @typeParam V - The variant a proposal's change role's `from` returns
 */
export interface DecisionRoles<C extends StructType, OE, OV, V> extends DecisionCaseRoles<C>, DecisionProposalRoles<C, V> {
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
    /** How the cases are bound: `data`, read whole; `paged`, read through the slice's `decisions` source. */
    readonly form: "data" | "paged";
    /** The cases' row type. */
    readonly rowType: StructType;
    /** Each target, and the tags it serves, in the variant's order. */
    readonly targets: ReadonlyMap<DecisionQueueTarget<EastType>, readonly string[]>;
    /**
     * The cases' kind on the wire.
     *
     * @param part - The slice's `decisions` source, bound in the queue's payload; `undefined` with no slice
     * @returns The kind, closed
     * @throws {Error} When the binding and the slice disagree: `Data.bind` beside a source of the slice, `Data.bindPaged`
     *   with none, or a source narrowing another record
     */
    build(part: ExprType<StructType> | undefined): ExprType<typeof DecisionsKindType>;
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

/** The cases a read holds, as a function: the record read whole, or the source's narrowing read complete. */
type RowsRead = ExprType<FunctionType<[], OptionType<DictType<StringType, EastType>>>>;

/**
 * How many cases the slice's `decisions` source's narrowing holds, counted
 * before any is read: past {@link DECISION_QUEUE_CASES}, none is.
 *
 * @param part - The source, bound in the payload
 * @returns `()` → the count; `none` while it is in flight
 */
function sourceCount(part: ExprType<StructType>): ExprType<FunctionType<[], OptionType<IntegerType>>> {
    return East.function([], OptionType(IntegerType), ($) => {
        const source = $.const(part as unknown as ExprType<StructType<{
            read: FunctionType<[], typeof RecordSliceStateType>;
            countWhere: FunctionType<[typeof RecordSliceWhereType], OptionType<IntegerType>>;
        }>>);
        const read = $.const(source.read);
        const count = $.const(source.countWhere);
        const state = $.const(read());
        return count(state.where);
    });
}

/**
 * Declares the cases (§5.1): the app's source of them, read only, and the roles
 * that read each part of a card from its rows.
 *
 * @typeParam C - The case's row type, from the binding
 * @typeParam OE - What `options.from` returns, inferred
 * @typeParam OV - The variant an option's change role's `from` returns, inferred
 * @typeParam V - The variant a proposal's change role's `from` returns, inferred
 * @param binding - The cases: `Data.bind(source)` — a record of the app's, or a task's output — read whole, or
 *   `Data.bindPaged(record)`, read through the slice's `decisions` source; a `Dict<String, C>`
 * @param roles - The case's roles, `recommended` and the option's in `options` — or, for cases that are each their own
 *   one proposal, the option's beside the case's (D15)
 * @returns The cases, for the queue's `decisions`
 * @throws {Error} Naming the role or the binding: a `Record.bind` (the queue writes no case), a source that is no
 *   `Dict<String, C>` of structs; a role that is no function or returns another type than its role takes; a required
 *   role left out; `recommended` without `options`, `options` without `recommended`, or an option's role both in
 *   `options` and beside the case's (D15); a change role whose `from` returns no variant, whose `of` gives a tag no
 *   target or names no tag, or gives a tag a target over another record than its patch is of (D6)
 *
 * @example
 * ```tsx
 * // A record of proposals, each its own one decision, its details a variant (§3.2)
 * DecisionQueue.decisions(cases, {
 *     scope: p => p.site, due: p => p.deadline, unit: p => p.metric, model: p => p.run, why: p => p.rationale,
 *     title: p => p.headline, summary: p => p.brief, detail: p => p.description, value: p => p.saving,
 *     change: { from: p => p.details, of: { orders: orderChange, pricing: pricingChange } },
 * })
 * ```
 */
export function decisionQueueDecisions<C extends StructType, OE, OV, V>(binding: RecordBinding<C>, roles: DecisionRoles<C, OE, OV, V>): DecisionQueueDecisions;
export function decisionQueueDecisions(binding: unknown, roles: unknown): DecisionQueueDecisions {
    const bound = recordBound(binding, WHERE, "the cases are a Dict<String, C>, each case a struct under its key");
    if (bound.form === "record") {
        throw new Error(`${WHERE}: the cases are read only — bind them Data.bind(source) to read them whole, or Data.bindPaged(record) to read them ` +
            "through the slice's `decisions` source: the queue writes no case, only its verdict");
    }
    const given = (roles ?? {}) as Readonly<Record<string, unknown>>;
    const rowType = bound.rowType;
    const caseInputs = [rowType, StringType] as const;
    const options = given["options"] as Readonly<Record<string, unknown>> | undefined;

    // D15: a case with alternatives names its recommendation among them; a case that is its own proposal gives its
    // option's roles beside its own.
    if (options === undefined && given["recommended"] !== undefined) {
        throw new Error(`${WHERE}: \`recommended\` names one of a case's \`options\` — and no \`options\` are given: give options: { from, … } with the ` +
            "option's roles inside it, or leave `recommended` out for cases that are each their own one proposal, the option's roles beside the case's (D15)");
    }
    if (options !== undefined) {
        const both = OPTION_ROLES.filter((role) => given[role] !== undefined);
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
    const label = role("label", StringType, "a String", false);
    const title = role("title", StringType, "a String", true);
    const summary = role("summary", StringType, "a String", true);
    const detail = role("detail", StringType, "a String", true);
    const note = role("note", OptionType(StringType), "an Option<String>", false);
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

    // One case, from its row and its key.
    const caseOf = East.function([rowType, StringType], DecisionCaseType, ($, row, key) => {
        const args = [row, key];
        const option = $.const(toOption) as (...args: unknown[]) => unknown;
        let optionsOf: unknown;
        if (optionsFrom !== undefined) {
            const from = $.const(optionsFrom) as (...args: unknown[]) => ExprType<DictType<StringType, StructType>>;
            optionsOf = from(row, key).toArray(($2, o, k) => option(o, k, row) as never);
        } else {
            optionsOf = East.value([option(row, key)] as never, ArrayType(DecisionOptionType));
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
        } as never, DecisionCaseType);
    });

    return {
        [DECISIONS]: true,
        form: bound.form,
        rowType,
        targets,
        build(part) {
            let rows: RowsRead;
            let count: ExprType<FunctionType<[], OptionType<IntegerType>>> | undefined;
            if (part === undefined) {
                if (bound.form === "paged") {
                    throw new Error(`${WHERE}: Data.bindPaged(record) reads the cases through the slice's \`decisions\` source — give ` +
                        "slice={{ slice: Slice.bindRecords(key, { decisions: { source: Data.bindPaged(record, { indexes }) } }) }}, or bind Data.bind(source) " +
                        "to read them whole");
                }
                rows = schematicWholeRows(bound.handle, rowType) as RowsRead;
                count = undefined;
            } else {
                if (bound.form === "data") {
                    throw new Error(`${WHERE}: Data.bind(source) reads the cases whole, which the slice's \`decisions\` source exists to avoid — bind them ` +
                        "Data.bindPaged(record) to read them through it, or leave the slice out");
                }
                rows = schematicSourceRows(part, DECISIONS_SOURCE, rowType, WHERE) as RowsRead;
                count = sourceCount(part);
            }
            const Cases = DecisionCasesType;
            const read = East.function([], OptionType(Cases), ($) => {
                const readRows = $.const(rows);
                const toCase = $.const(caseOf);
                const cap = $.const(DECISION_QUEUE_CASES, IntegerType);
                const result = $.let(none, OptionType(Cases));
                // The cases as read, made cards — or, past the cap, how many there are.
                const take = ($2: typeof $) => {
                    $2.match(readRows(), {
                        some: ($3, held) => {
                            $3.if(held.size().greater(cap), ($4) => {
                                $4.assign(result, some(variant("tooMany", held.size())));
                            }).else(($4) => {
                                $4.assign(result, some(variant("cases", held.toArray(($5, row, key) => toCase(row as never, key)))));
                            });
                        },
                    });
                };
                if (count === undefined) {
                    take($);
                } else {
                    // Counted before a case is read: past the cap, none is.
                    const counted = $.const(count);
                    $.match(counted(), {
                        some: ($2, n) => {
                            $2.if(n.greater(cap), ($3) => { $3.assign(result, some(variant("tooMany", n))); }).else(($3) => { take($3 as never); });
                        },
                    });
                }
                return result;
            });
            return East.value({ read }, DecisionsKindType);
        },
    };
}
