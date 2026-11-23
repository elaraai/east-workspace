/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `optimise` prop's binding (#1409, east-workspace#1622): `Func.bind` of
 * the app's `e3.function` from a builder's `OptimiseRequest` — the period in
 * view, the run's number and the page's narrowing, and no row of a record — to
 * its `OptimiseResult`, a patch of each record the builder edits. The function
 * reads what it needs from the workspace, with the page's unsaved edits laid
 * over the records it lists in `drafts`. Each builder names its own types and
 * its own words; the check is one.
 *
 * A builder's `fit` is held by the same check (east-workspace#1624): `Func.bind`
 * of a function from the builder's `FitRequest` — the question and the page's
 * scope — to its `FitResult`, which lists in `drafts` each record it reads
 * that the builder edits. A contract names the prop it holds and its words.
 *
 * @packageDocumentation
 */

import {
    ArrayType, DictType, East, NullType, PatchType, StringType, VariantType, dictPatchOpsType, isTypeEqual, printType, variant,
    type EastType, type ExprType, type FunctionType, type PatchTypeOf, type StructType,
} from "@elaraai/east";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { FuncBindingType, boundFuncSignature } from "../bind/func.js";

/**
 * A request's `slice` (east-workspace#1622): each rail source's narrowing, by
 * the source's name, as a read of that source carries it — a field's chosen
 * values as East prints them, a range, or a prefix (east-ui's
 * `RecordSliceWhereType`), the scope's fields among them. A builder with no
 * rail sends none.
 */
export const OptimiseSliceType = DictType(StringType, RecordSliceWhereType);
/** Type representing {@link OptimiseSliceType}. */
export type OptimiseSliceType = typeof OptimiseSliceType;

/**
 * A request's `period` (east-workspace#1622): what kind of period the planner
 * is looking at, a case with no value — one type for the Calendar, the Plan
 * and the Roster. The Calendar and the Roster name the period they show, the
 * request's `from` and `to` its start and end; the Plan names the unit its
 * axis is zoomed to, `from` and `to` its window, which spans several of them.
 * The range is always `from` to `to`: a function that plans by the kind of
 * period matches on this, and one that wants only the dates never reads it.
 *
 * @property day - A day
 * @property week - A week
 * @property month - A month
 * @property quarter - A quarter
 * @property year - A year
 */
export const OptimisePeriodType = VariantType({ day: NullType, week: NullType, month: NullType, quarter: NullType, year: NullType });
/** Type representing {@link OptimisePeriodType}. */
export type OptimisePeriodType = typeof OptimisePeriodType;

/**
 * The key type a fit's or an optimiser's type is made over (east-workspace#1709, rulings 11 and 12): the key type of
 * the record whose rows its question, its answer or what it reads names by key, its options' `key` — String where the
 * app names none.
 *
 * @param options - The constructor's options, if it was given any
 * @param where - The constructor, as its refusal names it (`Allocation.Types.FitRequest`)
 * @param rows - The rows it names, as the refusal says them (`bins`)
 * @param example - The constructor's options as the refusal suggests them (`{ key: IntegerType }`)
 * @returns The key type
 * @throws {Error} When the options are no object of options — a type given in their place among them — or `key` is no
 *   East type, naming the constructor
 * @internal
 */
export function optionKeyType(options: unknown, where: string, rows: string, example: string): EastType {
    if (options === undefined) return StringType;
    const typeLike = (given: unknown): given is EastType =>
        typeof given === "object" && given !== null && typeof (given as { readonly type?: unknown }).type === "string";
    if (typeof options !== "object" || options === null || typeLike(options)) {
        throw new Error(`${where}: takes nothing, or ${example} — the ${rows}' key type, for ${rows} keyed by other than String`);
    }
    const key = (options as { readonly key?: unknown }).key;
    if (key === undefined) return StringType;
    if (!typeLike(key)) throw new Error(`${where}: \`key\` is the ${rows}' key type, an East type — ${example} for ${rows} keyed by number`);
    return key;
}

/**
 * A `Func.bind` handle of the app's optimiser, as a tag takes it where its
 * edited records' types are its kinds' or its source's — the Calendar's, the
 * Plan's and the Sheet's `optimise` — which TypeScript cannot see from the tag
 * alone: the tag checks the handle at build against the builder's
 * `OptimiseRequest` and its `OptimiseResult` over its records, and refuses
 * another, naming both. Every `Func.bind` handle has this shape; nothing else
 * does that the check would take. The Allocation takes its fit as one too, its
 * types made over its bins' key type (east-workspace#1709).
 *
 * @property call - The function's call, which a run makes once
 * @property read - Its last result, which a run reads once the call lands
 * @property binding - The binding, which names the function, the records it lists in `drafts` and the records it reads
 */
export interface OptimiseHandle {
    call: (...args: never[]) => ExprType<NullType>;
    read: (...args: never[]) => unknown;
    binding: ExprType<typeof FuncBindingType>;
}

/**
 * What a builder holds its `optimise` to, and the words its refusals use.
 *
 * @property builder - The builder, as the refusals name it (`Roster`)
 * @property prop - The prop held, as the refusals name it: `optimise` unless given, or `fit` with its words
 *   (east-workspace#1624) — what a request asks (`the question and the page's scope`), what an answer is, and what a
 *   function that reads a record without its drafts would do (`answer around`)
 * @property request - The request type the function must ask: the builder's `OptimiseRequest`
 * @property result - The result type it must answer: the builder's `OptimiseResult` over the records it edits
 * @property signature - The signature in words, for a value that is no `Func.bind` handle (`from Roster.Types.OptimiseRequest() to Roster.Types.OptimiseResult(D), or from the request given { edges: true }, D the duties' record type`)
 * @property names - The types, as the refusals spell them with what they are given (`Plan.Types.OptimiseRequest`, `Plan.Types.OptimiseResult({ job: … })`)
 * @property edits - The records the builder edits, each by its name in the deployed package, as its binding carries it: what the drafts rule holds the function to
 */
export interface OptimiseContract {
    builder: string;
    prop?: { name: string; asked: string; answers: string; unseen: string };
    request: EastType;
    result: EastType;
    signature: string;
    names: { request: string; result: string };
    edits: readonly ExprType<StringType>[];
}

/**
 * The drafts rule (east-workspace#1622, rule 4): a function that reads a
 * record the builder edits, itself or by an index of it, lists it in `drafts`.
 * One that does not would plan around edits it cannot see.
 *
 * The records are named by values — a handle is a variable while a page is
 * built, and its type is every such handle's — so the rule is held as the
 * page is evaluated: the binding is answered where it holds, and the page
 * fails where it does not, naming the function, the record and the remedy.
 */
const heldToDrafts = East.function([StringType, StringType, StringType, FuncBindingType, ArrayType(StringType)], FuncBindingType, ($, builder, prop, unseen, binding, edits) => {
    const reads = $.const(binding.reads.toSet());
    const drafts = $.const(binding.drafts.toSet());
    $.for(edits, ($, record) => {
        $.if(reads.has(record).and(() => drafts.has(record).not()), ($) => {
            $.error(East.str`${builder}: \`${prop}\` is the function '${binding.name}', which reads the record '${record}' that the ${builder} edits and does not list it in \`drafts\` — it would ${unseen} edits it cannot see: list it, drafts: [${record}], beside the function's inputs`);
        });
    });
    return binding;
});

/** The optimiser's words: what its request asks, and what one that reads a record without its drafts would do. */
const OPTIMISE = { name: "optimise", asked: "the period in view, the run's number and the page's narrowing", unseen: "plan around" };

/**
 * The `optimise` binding, checked: `Func.bind` of an `e3.function` from the
 * builder's `OptimiseRequest` to its `OptimiseResult`, which lists in `drafts`
 * each record it reads that the builder edits. A `fit` is checked the same
 * way, by its contract's `prop` (east-workspace#1624).
 *
 * @param optimise - What the app passed as `optimise`, or as the contract's prop
 * @param contract - The types it is held to, the records the builder edits, and the words
 * @returns The binding's descriptor, which names the function and the records it lists; evaluated, it fails where the
 *   function reads a record the builder edits and does not list it, naming both
 * @throws {Error} When it is not a `Func.bind` handle, or its function asks or answers another type, naming it
 * @internal
 */
export function optimiseBinding(optimise: unknown, contract: OptimiseContract): ExprType<typeof FuncBindingType> {
    const { builder, names } = contract;
    const prop = contract.prop ?? { ...OPTIMISE, answers: `a patch of each record the ${builder} edits` };
    // What goes in, for a value that is no handle: the optimiser's says it shortly, as it always has.
    const into = contract.prop === undefined ? "the period in view and the page's narrowing" : prop.asked;
    // The call passes the page's unsaved edits as drafts: a handle of a function that lists them is read as any other
    const signature = boundFuncSignature(optimise, builder, prop.name, { drafts: true });
    if (signature === undefined) {
        throw new Error(`${builder}: \`${prop.name}\` is Func.bind of the app's e3.function ${contract.signature} — ${into} in, ${prop.answers} out`);
    }
    if (!isTypeEqual(signature.asks, contract.request)) {
        throw new Error(`${builder}: \`${prop.name}\` asks ${printType(signature.asks)}, not ${names.request} — ` +
            `a request carries ${prop.asked}, and no row: the function reads what it needs from the workspace`);
    }
    if (!isTypeEqual(signature.answers, contract.result)) {
        throw new Error(`${builder}: \`${prop.name}\` answers ${printType(signature.answers)}, not ${names.result} — ${prop.answers}`);
    }
    const binding = (optimise as ExprType<StructType<{ binding: typeof FuncBindingType }>>).binding;
    return contract.edits.length === 0 ? binding : heldToDrafts(builder, prop.name, prop.unseen, binding, [...contract.edits]);
}

/**
 * The record type a builder's `Types.OptimiseResult` patches, checked (east-workspace#1622): a Dict of rows by key — the
 * record's type, as the app writes it. Each builder refuses another in its own words.
 *
 * @param given - The type the factory was given; `undefined` for none
 * @param refusal - The factory's refusal, given what it was given in words: its name, and what it takes
 * @returns The record's type
 * @throws {Error} When it is given none, or a type that is no Dict, with the factory's refusal
 * @internal
 */
export function optimisedRecordType(given: EastType | undefined, refusal: (given: string) => string): DictType<EastType, EastType> {
    if (given === undefined || given.type !== "Dict") throw new Error(refusal(given === undefined ? "nothing" : printType(given)));
    return given;
}

/**
 * What an optimiser's answer for one record does, key by key (east-workspace#1622, rule 7): each key the answer touches,
 * with what lands on it — the row the optimiser gave, inserted under its key; an update by a patch of the row; or a
 * delete. A patch of the whole Dict — `replace`, what `East.diff` answers where it judges the rows better replaced — lands
 * key by key too, and never as the record replaced: a row of its `before` that its `after` lacks is deleted, one of its
 * `after` that its `before` lacks inserted, and one in both updated by the patch of the two, where they differ. An
 * `unchanged` patch touches no key. A builder lands an answer through this alone.
 *
 * @typeParam D - The record's type
 * @param record - The record's type, `Dict<K, R>`
 * @returns An East function from a patch of the record to its changes by key: `Dict<K, Variant{ delete: R, insert: R, update: Patch(R) }>`
 * @throws {Error} When the type is no Dict
 * @internal
 */
export function optimiseChangesFor<D extends DictType<EastType, EastType>>(record: D): ExprType<FunctionType<[PatchTypeOf<D>], DictType<D["key"], EastType>>> {
    const given = record as EastType;
    if (given.type !== "Dict") throw new Error(`optimiseChangesFor: takes a record's type, a Dict of rows by key, and was given ${printType(given)}`);
    const rows: DictType<EastType, EastType> = given;
    const changesType = DictType(rows.key, dictPatchOpsType(rows.value));
    const patchType = PatchType(rows) as unknown as EastType;
    return East.function([patchType], changesType, ($, patch) => {
        const changes = $.let(new Map(), changesType);
        const whole = patch as unknown as ExprType<VariantType<{
            unchanged: NullType; replace: StructType<{ before: typeof rows; after: typeof rows }>; patch: typeof changesType;
        }>>;
        $.match(whole, {
            unchanged: (_$2) => { /* no key is touched */ },
            patch: ($2, byKey) => { $2.assign(changes, byKey); },
            replace: ($2, both) => {
                $2.for(both.before, ($3, row, key) => {
                    $3.if(both.after.has(key), ($4) => {
                        const next = $4.const(both.after.get(key));
                        // The rows are of the record's row type, which East holds them to as it runs.
                        $4.if(East.notEqual(row as never, next as never), ($5) => { $5(changes.insert(key, variant("update", East.diff(row as never, next as never)))); });
                    }).else(($4) => { $4(changes.insert(key, variant("delete", row))); });
                });
                $2.for(both.after, ($3, row, key) => {
                    $3.if(both.before.has(key).not(), ($4) => { $4(changes.insert(key, variant("insert", row))); });
                });
            },
        });
        return changes;
    }) as never;
}
