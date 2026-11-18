/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An editable collection's batches, committed to an `e3.record` or handed
 * over as the draft of that commit: `Record.onApply` and `Record.toDraft`.
 *
 * `Record.onApply` builds on a bound record's `commit` door: each Apply of a
 * Sheet, a Plan or a SnapGrid is one commit through the record's patch
 * mutation. `Record.toDraft` builds on its `draft` door the same way: the
 * batch a Save would commit, as the draft of that commit, its patch built by
 * the Save's own code.
 *
 * @packageDocumentation
 */

import {
    East,
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    DictType,
    Expr,
    FunctionType,
    OptionType,
    PatchType,
    StringType,
    StructType,
    VariantType,
    dictPatchOpsType,
    isTypeEqual,
    none,
    printType,
    some,
    variant,
    type BlockBuilder,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from '@elaraai/east';
import { RecordCommitInfoType } from '@elaraai/e3-types';
import { Editing } from '@elaraai/east-ui';
import { EditingSaveTypeFor, EditingToDraftResultTypeFor } from '@elaraai/east-ui/internal';
import { FuncDraftType } from './func.js';
import { externalSourceOf, sourcesOfHandle, type RecordBindingSourcesType } from './record-composite.js';
import { RecordOutcomeType } from './record-handle.js';

// ============================================================================
// Apply — an editable collection's batches, committed to the record, or
// handed over as the draft of that commit.
// ============================================================================

/**
 * Options for {@link Record.onApply} and {@link Record.toDraft} over the
 * record's own entries — a Sheet or a Plan whose entries are the record's, each
 * named by its key's text.
 */
export interface RecordApplyOptions {
    /** The patch mutation each Apply commits through — the name the record
     *  declares its `mutation.patch()` under; `patch` when omitted. */
    mutation?: string;
    /** The collection hands keyed batches, `ChangeSet(V, K)`, as the Plan does;
     *  a Sheet hands `ChangeSet(V)`, the default. */
    keyed?: boolean;
}

/**
 * Options for {@link Record.onApply} and {@link Record.toDraft} over a
 * collection inside one entry — the rows of one Array field of one entry,
 * which each Apply's patch reaches and nothing else.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @typeParam C - The collection's row type: a row struct, or the entries of
 *   groups and loose rows a Sheet edits (`Editing.Types.Entry(G, "lines")`),
 *   every arm carrying `idField`
 */
export interface RecordApplyInsideOptions<K extends EastType, V extends EastType, C extends EastType> {
    /** The key of the entry the collection lives in. */
    entry: SubtypeExprOrValue<K>;
    /** The collection, read out of the entry. */
    get: SubtypeExprOrValue<FunctionType<[V], ArrayType<C>>>;
    /** The entry with its collection replaced, and nothing else changed. */
    set: SubtypeExprOrValue<FunctionType<[V, ArrayType<C>], V>>;
    /** The rows' String identity field. */
    idField: string;
    /** The patch mutation each Apply commits through; `patch` when omitted. */
    mutation?: string;
}

/** A bound record whose state is keyed, `Dict<K, V>` — what an Apply writes by key. */
type KeyedRecordHandle<K extends EastType, V extends EastType> =
    ExprType<StructType<{ read: FunctionType<[], DictType<K, V>> }>>;

/** An editable collection's async `onApply`, over the batch type it hands. */
type RecordApplyFunction<B extends EastType> =
    ExprType<AsyncFunctionType<[B], typeof Editing.Types.ApplyResult>>;

/**
 * What {@link Record.toDraft} answers for one batch: the draft of the commit
 * {@link Record.onApply} would make of it, or why there is none.
 *
 * @property draft - The batch as a draft of the record's patch mutation
 *   ({@link FuncDraftType}): what a bound function's call takes among its drafts
 * @property unchanged - The batch changes nothing, so there is no draft
 * @property rejected - Refused as asked, in the words `Record.onApply` refuses
 *   it in before it writes
 * @property conflict - The entry was removed or changed since the edit began,
 *   in the words `Record.onApply` says so in before it writes
 */
export const RecordToDraftResultType = EditingToDraftResultTypeFor(FuncDraftType);

/** Type representing the {@link RecordToDraftResultType} structure. */
export type RecordToDraftResultType = typeof RecordToDraftResultType;

/** An editable collection's batch as a draft, over the batch type it hands. */
type RecordToDraftFunction<B extends EastType> =
    ExprType<FunctionType<[B], RecordToDraftResultType>>;

/**
 * Constructs what {@link Record.onApply} answers over a handle that makes
 * drafts, as every `Record.bind` handle does: the Save, and beside it the same
 * batch as a draft.
 *
 * @remarks
 * A Sheet, a Plan or a SnapGrid takes the struct as its `onApply`, and a
 * Sheet or a Plan handed it can hand its pending Save over as a draft, with
 * nothing more written on the tag. It is one value: a copy bound with
 * `$.const` or `$.let` keeps both.
 *
 * @typeParam B - The batch type the collection hands
 * @param batchType - The batch type: `Editing.Types.ChangeSet(V)`, or `ChangeSet(V, K)` for keyed batches
 * @returns The struct: `apply`, an async East function over the batch that
 *   commits it, answering `Editing.Types.ApplyResult`; `toDraft`, an East
 *   function over the batch that answers the draft of that commit
 *   ({@link RecordToDraftResultType}), as {@link Record.toDraft} does
 */
export function RecordSaveTypeFor<B extends EastType>(batchType: B) {
    return EditingSaveTypeFor(batchType, FuncDraftType);
}

/** What {@link Record.onApply} answers for handle `H`: a Save that carries its draft form where the handle makes drafts, the Save alone where it makes none. */
type RecordSaveOf<H, B extends EastType> =
    H extends { draft: unknown } ? ExprType<ReturnType<typeof RecordSaveTypeFor<B>>> : RecordApplyFunction<B>;

/**
 * An awaited write's outcome as the editing session's answer. A commit is
 * applied at the record state it wrote, which a pinned source installs; a
 * conflict carries the issues naming what went stale; anything else refused
 * the write. A call that got no answer may have committed, so it throws: the
 * session keeps the request, and its retry sends the same request id, which
 * resolves to that commit rather than writing twice.
 */
const settleWrite = East.function(
    [RecordOutcomeType, ArrayType(Editing.Types.Issue)], Editing.Types.ApplyResult,
    ($, outcome, conflicts) => {
        const result = $.let(variant("conflict", conflicts), Editing.Types.ApplyResult);
        $.match(outcome, {
            committed: ($, done) => { $.assign(result, variant("applied", { revision: some(done.stateHash) })); },
            invalid: ($, refused) => {
                $.assign(result, variant("rejected", [{ entry: "", row: none, field: none, message: refused.message }]));
            },
            failed: ($, refused) => {
                $.assign(result, variant("rejected", [{ entry: "", row: none, field: none, message: East.str`The write failed: ${refused.stderr}` }]));
            },
            timed_out: ($, refused) => {
                $.assign(result, variant("rejected", [{ entry: "", row: none, field: none, message: East.str`The write ran out of time after ${refused.ms} ms and wrote nothing` }]));
            },
            transport: ($, lost) => {
                $.error(East.str`The write got no answer, so it may have committed — retry to find out: ${lost.message}`);
            },
        });
        return result;
    },
);

/**
 * What a batch's write comes to before it is made: refused, or the patch to
 * make. `Record.onApply` commits that patch and `Record.toDraft` answers it as
 * a draft, so the two hold one patch for one batch.
 *
 * @param recordType - The record's type
 * @returns `rejected` and `conflict`, each with the issues a Save answers it
 *   with; `write`, with the patch and whether it changes the record
 */
function writePlanType(recordType: EastType): WritePlanType {
    return VariantType({
        rejected: ArrayType(Editing.Types.Issue),
        conflict: ArrayType(Editing.Types.Issue),
        write: StructType({ patch: PatchType(recordType), changes: BooleanType }),
    }) as unknown as WritePlanType;
}

/** {@link writePlanType}'s type, its patch opaque: the record's patch type is the handle's, known as the plan is built. */
type WritePlanType = VariantType<{
    rejected: ArrayType<typeof Editing.Types.Issue>;
    conflict: ArrayType<typeof Editing.Types.Issue>;
    write: StructType<{ patch: EastType; changes: BooleanType }>;
}>;

/** A record's read, whole. Entries are opaque here, as in `Editing.apply`, and their runtime types are exact. */
type RecordRead = ExprType<FunctionType<[], DictType<EastType, StructType<Record<never, never>>>>>;

/** Who changed a record last, for a conflict's words. */
type RecordLastChange = ExprType<FunctionType<[], StringType>>;

/** A batch's write, planned: refused, or its patch ({@link writePlanType}). */
type RecordPlan = ExprType<FunctionType<[EastType], WritePlanType>>;

/** The sources a record's binding names, bound where the write is built; `undefined` where no entry can be a load's. */
type RecordSourcesBound = ExprType<RecordBindingSourcesType> | undefined;

/**
 * The words a write of a loaded entry is refused in, before any commit: the
 * entry as East prints its key, and the external source whose load alone
 * writes it (east-workspace#1465).
 */
const loadWrites = East.function([StringType, StringType], StringType,
    (_$, entry, source) => East.str`entry ${entry} is source ${source}'s, which only its load writes`);

/** A batch's write to a record, checked ({@link checkWrite}). */
interface CheckedWrite {
    /** The patch mutation's name. */
    readonly mutation: string;
    /** The batch the collection hands. */
    readonly batchType: EastType;
    /** Whether the handle makes drafts: it holds its draft doors, the patch mutation's among them. */
    readonly drafts: boolean;
    /** A change's key from its id, over the record's own entries; `undefined` over one entry's rows. */
    readonly keyOf: ExprType<FunctionType<[StringType], EastType>> | undefined;
    /** The sources the handle's binding names, read off the handle; `undefined` where no entry can be a load's ({@link sourcesOfHandle}). */
    readonly sources: RecordSourcesBound;
    /**
     * The one East function that turns a batch into its patch, or into the
     * refusal that comes before any write.
     *
     * @param read - The record, read whole
     * @param lastChange - Who changed the record last
     * @param sources - The binding's sources, where an entry can be a load's
     * @returns The function, over the three as they are bound where the write is built
     */
    plan(read: RecordRead, lastChange: RecordLastChange, sources: RecordSourcesBound): RecordPlan;
}

/**
 * Checks an editable collection's write to a record: what
 * {@link Record.onApply} and {@link Record.toDraft} refuse where they are
 * built, and the plan the two share.
 *
 * @param what - Which of the two is built: it names a refusal, and the doors the handle must hold
 * @param handle - The record, bound with its patch mutation
 * @param options - The entries form's options, or the form over one entry's rows
 * @returns The write, checked
 * @throws {Error} When the record is not a Dict, the mutation is not bound as
 *   its patch door, or `get` / `set` do not fit the entry
 */
function checkWrite(
    what: "onApply" | "toDraft",
    handle: KeyedRecordHandle<EastType, EastType>,
    options: RecordApplyOptions | RecordApplyInsideOptions<EastType, EastType, EastType>,
): CheckedWrite {
    const fields = (Expr.type(handle as unknown as Expr) as StructType).fields;
    const recordType = (fields["read"] as FunctionType).output as EastType;
    if (recordType.type !== "Dict") {
        throw new Error(
            `Record.${what}: an Apply writes a record's entries by key, so the record must be a Dict — ` +
            `this one holds ${printType(recordType)}`);
    }
    const mutation = options.mutation ?? "patch";
    // The doors the patch goes through: the awaited commit, and the draft of it.
    const doorTypes = {
        commit: AsyncFunctionType([StringType, PatchType(recordType)], RecordOutcomeType),
        draft: FunctionType([PatchType(recordType)], FuncDraftType),
    };
    const holds = (kind: "commit" | "draft"): boolean => {
        const doors = fields[kind];
        const door = doors?.type === "Struct" ? doors.fields[mutation] : undefined;
        return door !== undefined && isTypeEqual(door, doorTypes[kind]);
    };
    // A Save needs the commit door. A handle that makes drafts makes this mutation's, and its Save carries the draft
    // form; one that makes none — a handle typed by hand, with its read, its history and its commit — gives the Save alone.
    const drafts = what === "toDraft" || fields["draft"] !== undefined;
    if ((what === "onApply" && !holds("commit")) || (drafts && !holds("draft"))) {
        throw new Error(
            `Record.${what}: "${mutation}" is not bound as this record's patch door — bind the record with ` +
            `${mutation}: mutation.patch() among the mutations it declares`);
    }
    const planType = writePlanType(recordType);
    // Over a composite record the binding names its sources, and a write of an entry an external source's load
    // writes is refused before any commit, by the one check of whose an entry is.
    const named = sourcesOfHandle(handle);
    const whose = named === undefined ? undefined : externalSourceOf(named.keyType);

    if ("entry" in options) {
        const entryType = recordType.value;
        const get = East.value(options.get as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
        const read = Expr.type(get as unknown as Expr) as EastType;
        // The rows are structs, or entries whose every arm is one — a Sheet's
        // groups and loose rows — as `Editing.apply` addresses them.
        const element = read.type === "Function" && read.output.type === "Array" ? read.output.value as EastType : undefined;
        if (read.type !== "Function" || read.inputs.length !== 1 || !isTypeEqual(read.inputs[0]!, entryType) || element === undefined
            || !(element.type === "Struct" || (element.type === "Variant"
                && Object.values(element.cases as Record<string, EastType>).every((arm) => arm.type === "Struct")))) {
            throw new Error(`Record.${what}: \`get\` must be an East function from the record's entry to an Array of rows — row structs, or entries of groups and loose rows`);
        }
        const rowType = element;
        const rowsType = ArrayType(rowType);
        const set = East.value(options.set as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
        const replace = Expr.type(set as unknown as Expr) as EastType;
        if (replace.type !== "Function" || replace.inputs.length !== 2 || !isTypeEqual(replace.inputs[0]!, entryType)
            || !isTypeEqual(replace.inputs[1]!, rowsType) || !isTypeEqual(replace.output, entryType)) {
            throw new Error(`Record.${what}: \`set\` must be an East function from the record's entry and its new rows to the entry`);
        }
        const entryKey = East.value(options.entry as SubtypeExprOrValue<EastType>, recordType.key);
        const apply = Editing.apply(rowType, options.idField);
        const batchType = Editing.Types.ChangeSet(rowType);
        const plan = (read: RecordRead, changedBy: RecordLastChange, sources: RecordSourcesBound) => East.function([batchType], planType, ($, batch) => {
            const rowsOf = $.const(get as ExprType<FunctionType<[EastType], typeof rowsType>>);
            const withRows = $.const(set as ExprType<FunctionType<[EastType, typeof rowsType], EastType>>);
            const applyRows = $.const(apply);
            const key = $.const(entryKey);
            const planned = $.let(variant("conflict", []), planType);
            // The entry's rows, written: the batch applied to the rows it began from.
            const overRows = ($: BlockBuilder<WritePlanType>): void => { $.match(batch.base, {
                revision: ($) => {
                    $.assign(planned, variant("rejected", [{ entry: "", row: none, field: none,
                        message: "Rows inside a record entry are checked against the rows the edit began from — a snapshot, never a revision" }]));
                },
                snapshot: ($, rows) => {
                    $.match(read().tryGet(key), {
                        none: ($) => {
                            $.assign(planned, variant("conflict", [{ entry: "", row: none, field: none,
                                message: East.str`The entry was removed since this edit began${changedBy()}` }]));
                        },
                        some: ($, current) => {
                            $.match(applyRows(rows, batch, none), {
                                conflict: ($, issues) => { $.assign(planned, variant("conflict", issues)); },
                                applied: ($, next) => {
                                    const now = $.const(rowsOf(current));
                                    // Moved since the edit began — unless to this very edit's
                                    // rows, which a retry after an unanswered write finds.
                                    $.if(East.notEqual(now, rows).and(() => East.notEqual(now, next)), ($) => {
                                        $.assign(planned, variant("conflict", [{ entry: "", row: none, field: none,
                                            message: East.str`The entry changed since this edit began${changedBy()}` }]));
                                    }).else(($) => {
                                        // The entry before and after the edit, each alone in a record:
                                        // their diff reaches the entry's rows and nothing else.
                                        const before = $.let(new Map(), recordType);
                                        $(before.insert(key, withRows(current, rows)));
                                        const after = $.let(new Map(), recordType);
                                        $(after.insert(key, withRows(current, next)));
                                        // It changes the record unless the entry holds these rows already:
                                        // a batch of no change, or one a write before this has landed.
                                        $.assign(planned, variant("write", { patch: East.diff(before, after), changes: East.notEqual(now, next) }));
                                    });
                                },
                            });
                        },
                    });
                },
            }); };
            if (whose === undefined || sources === undefined) {
                overRows($ as unknown as BlockBuilder<WritePlanType>);
                return planned;
            }
            // An entry of an external source is its load's, rows and all: refused before any write.
            const whoseEntry = $.const(whose);
            const words = $.const(loadWrites);
            $.match(whoseEntry(key, sources), {
                some: ($, source) => {
                    $.assign(planned, variant("rejected", [{ entry: "", row: none, field: none, message: words(East.print(key), source) }]));
                },
                none: ($) => { overRows($ as unknown as BlockBuilder<WritePlanType>); },
            });
            return planned;
        }) as unknown as RecordPlan;
        return { mutation, batchType, drafts, keyOf: undefined, sources: named?.sources, plan };
    }

    const keyType = recordType.key;
    const entryType = recordType.value as StructType<Record<never, never>>;
    const batchType = "keyed" in options && options.keyed === true
        ? Editing.Types.ChangeSet(entryType, keyType)
        : Editing.Types.ChangeSet(entryType);
    // A change names its entry by the key's text: a String key is its own
    // text, any other key its `.east` printing, read back here.
    const keyOf = (keyType.type === "String"
        ? East.function([StringType], StringType, (_$, id) => id)
        : East.function([StringType], keyType, (_$, id) => id.parse(keyType))) as ExprType<FunctionType<[StringType], EastType>>;
    const plan = (_read: RecordRead, _changedBy: RecordLastChange, sources: RecordSourcesBound) => East.function([batchType], planType, ($, batch) => {
        const keyFrom = $.const(keyOf);
        // Each change is its entry's insert, update or delete, restated by key.
        // The values and entry patches are the batch's own, carrying what each
        // entry was when the edit began, which the record checks.
        const ops = $.let(new Map(), DictType(keyType, dictPatchOpsType(entryType)));
        // Over a composite record, a change of an entry an external source's load writes is refused, each
        // named in the words that say whose it is, and nothing of the batch is written.
        const guard = whose === undefined || sources === undefined ? undefined : {
            whoseEntry: $.const(whose),
            words: $.const(loadWrites),
            sources,
            refused: $.let([], ArrayType(Editing.Types.Issue)),
        };
        $.for(batch.changes, ($, change) => {
            const key = $.const(keyFrom(change.id));
            const restate = ($: BlockBuilder<WritePlanType>): void => { $.match(change.patch, {
                replace: ($, swap) => {
                    $.match(swap.after, {
                        some: ($, after) => {
                            $.match(swap.before, {
                                none: ($) => { $(ops.insert(key, variant("insert", after))); },
                                some: ($, before) => { $(ops.insert(key, variant("update", East.diff(before, after)))); },
                            });
                        },
                        none: ($) => {
                            $.match(swap.before, { some: ($, before) => { $(ops.insert(key, variant("delete", before))); } });
                        },
                    });
                },
                patch: ($, entry) => {
                    $.match(entry, { some: ($, update) => { $(ops.insert(key, variant("update", update))); } });
                },
            }); };
            if (guard === undefined) {
                restate($ as unknown as BlockBuilder<WritePlanType>);
                return;
            }
            $.match(guard.whoseEntry(key, guard.sources), {
                some: ($, source) => {
                    $(guard.refused.pushLast({ entry: change.id, row: none, field: none, message: guard.words(change.id, source) }));
                },
                none: ($) => { restate($ as unknown as BlockBuilder<WritePlanType>); },
            });
        });
        const planned = $.let(variant("write", { patch: variant("patch", ops), changes: ops.size().greater(0n) }), planType);
        if (guard !== undefined) {
            $.if(guard.refused.size().greater(0n), ($) => { $.assign(planned, variant("rejected", guard.refused)); });
        }
        return planned;
    }) as unknown as RecordPlan;
    // Over the record's own entries the patch is the batch's alone: the record is not read.
    return { mutation, batchType, drafts, keyOf, sources: named?.sources, plan };
}

/** What a record's write is built from, each bound once in the block the write is built in ({@link inWriteBlock}). */
interface WriteParts {
    /** The record, read whole. */
    readonly read: RecordRead;
    /** Who changed the record last. A conflict reads the history again before the write settles, so it is current. */
    readonly lastChange: RecordLastChange;
    /** The batch's write, planned. */
    readonly plan: RecordPlan;
}

/**
 * Builds a record's write in a block of its own, which binds what its
 * functions call once: the record's read, who changed it last, and the plan
 * of the write.
 *
 * @remarks
 * A function holds what it reads, and beast2 writes a held value wherever the
 * function is written. The functions built here hold the plan and the doors
 * they call, each bound once in this block, never the handle, whose every
 * door would be written out with each of them. A Save and its draft form
 * call the one plan.
 *
 * @typeParam T - The write's type
 * @param checked - The write, checked
 * @param handle - The record's handle
 * @param type - The write's type: a Save, its draft form, or a struct of the two
 * @param build - Builds the write from the parts, in the block that binds them
 * @returns The write
 */
function inWriteBlock<T extends EastType>(
    checked: CheckedWrite,
    handle: KeyedRecordHandle<EastType, EastType>,
    type: T,
    build: ($: BlockBuilder<T>, parts: WriteParts) => unknown,
): ExprType<T> {
    const bound = handle as unknown as {
        read: RecordRead;
        history: ExprType<FunctionType<[], OptionType<ArrayType<typeof RecordCommitInfoType>>>>;
    };
    const made = East.function([], type, ($) => {
        const read = $.const(bound.read) as RecordRead;
        const history = $.const(bound.history) as typeof bound.history;
        const lastChange = $.const(East.function([], StringType, (_$) => history().match({
            some: (_$2, commits) => commits.tryGet(0n).match({
                some: (_$3, head) => East.str` — last changed by ${head.actor}`,
                none: (_$3) => East.str``,
            }),
            none: (_$2) => East.str``,
        }))) as RecordLastChange;
        // The binding's sources are data: bound once, and held by the plan alone.
        const sources = checked.sources === undefined ? undefined : $.const(checked.sources) as ExprType<RecordBindingSourcesType>;
        const plan = $.const(checked.plan(read, lastChange, sources)) as RecordPlan;
        return build($ as unknown as BlockBuilder<T>, { read, lastChange, plan }) as never;
    });
    return made() as ExprType<T>;
}

/** A record's commit door for one patch mutation: the write awaited, under a request id. */
type RecordCommitDoor = ExprType<AsyncFunctionType<[StringType, EastType], RecordOutcomeType>>;

/** A record's draft door for one patch mutation: the write not made. */
type RecordDraftDoor = ExprType<FunctionType<[EastType], FuncDraftType>>;

/**
 * The Save over a checked write: the plan's refusal, or its patch committed
 * through the record's door and the outcome settled.
 *
 * @param checked - The write, checked
 * @param parts - The write's parts, bound in the block it is built in
 * @param commit - The record's commit door, bound there too
 * @returns An async East function over the collection's batch, answering `Editing.Types.ApplyResult`
 */
function saveOver(checked: CheckedWrite, parts: WriteParts, commit: RecordCommitDoor): ExprType<AsyncFunctionType> {
    const { keyOf } = checked;
    const { plan, read, lastChange } = parts;
    return East.asyncFunction([checked.batchType], Editing.Types.ApplyResult, ($, input) => {
        // Either form's batch: its id, its base and its changes are read alike.
        const batch = input as unknown as ExprType<ReturnType<typeof Editing.Types.ChangeSet<StructType<Record<never, never>>>>>;
        const settle = $.const(settleWrite);
        const result = $.let(variant("conflict", []), Editing.Types.ApplyResult);
        $.match(plan(batch), {
            // Refused before any write, in the plan's words.
            rejected: ($, issues) => { $.assign(result, variant("rejected", issues)); },
            conflict: ($, issues) => { $.assign(result, variant("conflict", issues)); },
            write: ($, made) => {
                const outcome = $.const(commit(batch.requestId, made.patch));
                const conflicts = $.let([], ArrayType(Editing.Types.Issue));
                $.match(outcome, {
                    conflict: ($, lost) => {
                        const by = $.const(lastChange());
                        if (keyOf === undefined) {
                            // One entry's rows: the entry is what moved.
                            $(conflicts.pushLast({ entry: "", row: none, field: none, message: East.str`The entry changed since this edit began${by}` }));
                            return;
                        }
                        const keyFrom = $.const(keyOf);
                        // Either batch's base, a snapshot of the record or a revision of it: its arm alone is read.
                        const base = batch.base as unknown as ExprType<VariantType<{ revision: StringType; snapshot: EastType }>>;
                        $.match(base, {
                            // A session over the record read whole: the entries whose change no
                            // longer applies to the record as it stands are the ones another write moved.
                            snapshot: ($) => {
                                const current = $.const(read());
                                $.for(batch.changes, ($, change) => {
                                    const key = $.const(keyFrom(change.id));
                                    $.try(($) => {
                                        $(East.applyPatch(current.tryGet(key), change.patch));
                                    }).catch(($) => {
                                        $(conflicts.pushLast({ entry: change.id, row: none, field: none, message: East.str`Changed since this edit began${by}` }));
                                    });
                                });
                                $.if(conflicts.size().equal(0n), ($) => {
                                    $(conflicts.pushLast({ entry: "", row: none, field: none, message: East.str`The record changed since this edit began${by}` }));
                                });
                            },
                            // A session over the record a window at a time (#1199): it is never read
                            // here. The record's own issue — what it said of the write, and who changed
                            // it last — and each entry the batch changed in the words one another write
                            // moved is named in: the session reads them at the record's new revision,
                            // and names those it finds moved.
                            revision: ($) => {
                                const said = $.const(lost.detail.match({
                                    some: (_$2, detail) => East.str`: ${detail}`,
                                    none: (_$2) => East.str``,
                                }));
                                $(conflicts.pushLast({ entry: "", row: none, field: none, message: East.str`The record changed since this edit began${said}${by}` }));
                                $.for(batch.changes, ($, change) => {
                                    $(conflicts.pushLast({ entry: change.id, row: none, field: none, message: East.str`Changed since this edit began${by}` }));
                                });
                            },
                        });
                    },
                });
                $.assign(result, settle(outcome, conflicts));
            },
        });
        return result;
    }) as unknown as ExprType<AsyncFunctionType>;
}

/**
 * The draft form over a checked write: the plan's refusal, no change, or its
 * patch as a draft of the record's door.
 *
 * @param checked - The write, checked
 * @param parts - The write's parts, bound in the block it is built in
 * @param draft - The record's draft door, bound there too
 * @returns An East function over the collection's batch, answering {@link RecordToDraftResultType}
 */
function draftOver(checked: CheckedWrite, parts: WriteParts, draft: RecordDraftDoor): ExprType<FunctionType> {
    const { plan } = parts;
    return East.function([checked.batchType], RecordToDraftResultType, ($, batch) => {
        const result = $.let(variant("unchanged", null), RecordToDraftResultType);
        $.match(plan(batch), {
            // Refused where the Save is refused before it writes, in its words.
            rejected: ($, issues) => { $.assign(result, variant("rejected", issues)); },
            conflict: ($, issues) => { $.assign(result, variant("conflict", issues)); },
            write: ($, made) => {
                $.if(made.changes, ($) => { $.assign(result, variant("draft", draft(made.patch))); });
            },
        });
        return result;
    }) as unknown as ExprType<FunctionType>;
}

/** A handle's doors for its mutations, as a write binds the patch mutation's. */
type RecordDoors = {
    commit: Record<string, RecordCommitDoor>;
    draft: Record<string, RecordDraftDoor>;
};

/**
 * Commit an editable collection's batches to an `e3.record` — the `onApply` a
 * Sheet, a Plan or a SnapGrid takes, each Apply one commit through the record's
 * patch door (`mutation.patch()`).
 *
 * @remarks
 * Two forms:
 * - **Over the record's own entries** (`Record.onApply(handle)`): the
 *   collection's entries are the record's, each change naming its entry by
 *   the key's text — a String key as it is, any other its `.east` printing.
 *   Each change is its entry's insert, update or delete: the batch's own
 *   entry patches, restated by key.
 * - **Over a collection inside one entry** (`{ entry, get, set, idField }`):
 *   the rows of one entry's Array field — row structs, or a Sheet's entries of
 *   groups and loose rows, as `Editing.apply` takes them. The batch is applied
 *   to the rows it began from, and the patch is the diff of that entry before
 *   and after — it reaches the rows and nothing else.
 *
 * Every patch carries what the entries were when the edit began, and the
 * record checks it: an entry another write moved is a `conflict` naming it
 * and who changed the record last, and nothing is overwritten. A batch drafted
 * over the record read a window at a time — at a revision, not a snapshot
 * (#1199) — never reads the record whole: its conflict names the record, with
 * what the record said of the write, and each entry the batch changed in the
 * words a moved one takes; the editing session reads them at the record's new
 * revision and keeps those another write moved. A commit is `applied` at the
 * state it wrote; an invalid, failed or timed-out write is `rejected`. A write
 * that got no answer throws, and the session's retry resolves to its commit,
 * if it made one, through the batch's request id.
 *
 * The record must declare the patch mutation and the handle be bound with it —
 * `Record.bind(record)` binds every mutation the record declares — and the
 * record must be a `Dict`.
 *
 * Over a composite record (`e3.recordComposite`) a Save never writes an entry
 * an external source's load writes (east-workspace#1465). A change of one —
 * its key's case an external source among the handle's `binding.sources` — is
 * `rejected` before any commit, each such entry named with its source (`entry
 * .erp "SO-1001" is source erp's, which only its load writes`), and nothing
 * of the batch is written; over one entry's rows, an `entry` of an external
 * source is rejected the same way. The draft form refuses in the same words.
 * The record refuses such a write too, so a handle typed by hand that names
 * no sources is refused by it instead.
 *
 * What it answers is the Save with its draft form: a struct of `apply`, the
 * commit above, and `toDraft`, the same batch as a draft of that commit
 * ({@link Record.toDraft}) — {@link RecordSaveTypeFor}. A Sheet, a Plan or a
 * SnapGrid takes the struct as its `onApply`, and a Sheet or a Plan handed it
 * can hand its pending Save over as a draft, with nothing more written on the
 * tag. The two are one value, so a copy bound with `$.let` or `$.const` keeps
 * both, and they call one plan of the write. To commit a batch yourself, call
 * `apply`.
 *
 * Over a handle that makes no drafts — one typed by hand with its `read`, its
 * `history` and its `commit` alone — it answers the Save alone, the function.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @typeParam H - The handle: whether it makes drafts decides what is answered
 * @param handle - The record, bound with its patch mutation
 * @param options - {@link RecordApplyOptions} for the entries form, or
 *   {@link RecordApplyInsideOptions} for a collection inside one entry
 * @returns The Save with its draft form ({@link RecordSaveTypeFor}), over the
 *   collection's batch; over a handle that makes no drafts, the Save alone, an
 *   async East function over the batch answering `Editing.Types.ApplyResult`
 * @throws {Error} When the record is not a Dict, the mutation is not bound as
 *   its patch door, or `get` / `set` do not fit the entry
 *
 * @example
 * ```tsx
 * import { DictType, East, IntegerType, StringType, StructType } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Record, Sheet } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const JobType = StructType({ task: StringType, qty: IntegerType });
 * const jobs = e3.record("jobs", DictType(StringType, JobType), {
 *     initial: new Map(),
 *     mutations: (mutation) => ({
 *         patch: mutation.patch(),
 *     }),
 * });
 *
 * // Mirrors `recordSheetApply` in test/bind/record/record.examples.tsx.
 * const jobSheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const rows = $.let(Data.bindPaged(jobs));
 *         const record = $.let(Record.bind(jobs));
 *         return (
 *             <Box height="360px">
 *                 <Sheet
 *                     data={rows}
 *                     columns={{
 *                         task: Sheet.column.text(JobType, { header: "Task", width: "220px" }),
 *                         qty:  Sheet.column.integer(JobType, { header: "Qty", width: "96px" }),
 *                     }}
 *                     onApply={Record.onApply(record)}
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 *
 * @example
 * ```ts
 * // The Save with its draft form, held in a block: over the bindery's jobs of Record.toDraft's example.
 * import { East, OptionType, StringType, none, some, variant } from "@elaraai/east";
 * import { Editing } from "@elaraai/east-ui";
 * import { Record } from "@elaraai/e3-ui";
 *
 * // Mirrors `recordSaveDraft` in test/bind/record/record-draft.examples.ts.
 * const recordSaveDraft = East.function([], StringType, ($) => {
 *     const board = $.let(Record.bind(binderyJobs));
 *     // One value, held in a block: a Sheet or a Plan takes it as its onApply
 *     const save = $.const(Record.onApply(board, { keyed: true }));
 *     const folded = $.const(some({ task: "Fold", qty: 200n }), OptionType(BinderyJobType));
 *     const refolded = $.const(some({ task: "Fold", qty: 250n }), OptionType(BinderyJobType));
 *     const pending = $.const({
 *         requestId: "", base: variant("revision", "a41c09d2"), label: "Fold 250",
 *         changes: [{ id: "b1", patch: East.diff(folded, refolded), place: none }],
 *     }, Editing.Types.ChangeSet(BinderyJobType, StringType));
 *     // `save.apply(pending)` would commit the batch; `save.toDraft(pending)` answers it as a draft of that commit
 *     return save.toDraft(pending).match({
 *         draft: (_$, draft) => East.str`a draft of ${draft.record}.${draft.mutation}, of ${East.print(draft.args.size())} argument`,
 *         unchanged: _$ => East.str`nothing to send`,
 *         rejected: (_$, issues) => East.str`refused: ${issues.map((_$, issue) => issue.message).stringJoin("; ")}`,
 *         conflict: (_$, issues) => East.str`changed since the edit began: ${issues.map((_$, issue) => issue.message).stringJoin("; ")}`,
 *     });
 * });
 * // a draft of bindery_jobs.patch, of 1 argument
 * ```
 */
export function applyToRecord<K extends EastType, V extends EastType, H>(
    handle: KeyedRecordHandle<K, V> & H,
    options?: RecordApplyOptions & { keyed?: false },
): RecordSaveOf<H, ReturnType<typeof Editing.Types.ChangeSet<V>>>;
/**
 * The entries form for a collection that hands keyed batches — the Plan.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @typeParam H - The handle: whether it makes drafts decides what is answered
 * @param handle - The record, bound with its patch mutation
 * @param options - `{ keyed: true }`, and the patch mutation's name when it has one
 * @returns The Save with its draft form, or the Save alone, over `Editing.Types.ChangeSet(V, K)`
 */
export function applyToRecord<K extends EastType, V extends EastType, H>(
    handle: KeyedRecordHandle<K, V> & H,
    options: RecordApplyOptions & { keyed: true },
): RecordSaveOf<H, ReturnType<typeof Editing.Types.ChangeSet<V, K>>>;
/**
 * The form over a collection inside one entry.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @typeParam C - The collection's row type: a row struct, or entries of groups and loose rows
 * @typeParam H - The handle: whether it makes drafts decides what is answered
 * @param handle - The record, bound with its patch mutation
 * @param options - The entry, how its rows are read and replaced, and their identity field
 * @returns The Save with its draft form, or the Save alone, over `Editing.Types.ChangeSet(C)`
 */
export function applyToRecord<K extends EastType, V extends EastType, C extends EastType, H>(
    handle: KeyedRecordHandle<K, V> & H,
    options: RecordApplyInsideOptions<K, V, C>,
): RecordSaveOf<H, ReturnType<typeof Editing.Types.ChangeSet<C>>>;
export function applyToRecord(
    handle: KeyedRecordHandle<EastType, EastType>,
    options: RecordApplyOptions | RecordApplyInsideOptions<EastType, EastType, EastType> = {},
): unknown {
    const checked = checkWrite("onApply", handle, options);
    const doors = handle as unknown as RecordDoors;
    if (!checked.drafts) {
        // A handle that makes no drafts: the Save alone.
        return inWriteBlock(checked, handle, AsyncFunctionType([checked.batchType], Editing.Types.ApplyResult),
            ($, parts) => saveOver(checked, parts, $.const(doors.commit[checked.mutation]!) as RecordCommitDoor));
    }
    const saveType = RecordSaveTypeFor(checked.batchType);
    return inWriteBlock(checked, handle, saveType, ($, parts) => {
        const commit = $.const(doors.commit[checked.mutation]!) as RecordCommitDoor;
        const draft = $.const(doors.draft[checked.mutation]!) as RecordDraftDoor;
        return East.value({ apply: saveOver(checked, parts, commit), toDraft: draftOver(checked, parts, draft) } as never, saveType);
    });
}

/**
 * An editable collection's batch as a draft of an `e3.record`'s patch
 * mutation — {@link Record.onApply}'s twin: the same options, the same batch,
 * and the commit that Save would make answered as a draft, with nothing
 * committed. It is the `toDraft` of what `Record.onApply` answers, alone: for
 * where no Save is made. A bound function that lists the record in its `drafts` takes the
 * draft with its call, and reads the record with the batch laid over it.
 *
 * @remarks
 * The patch is built by the code `Record.onApply` builds its commit's patch
 * with, in each of its forms, so for one batch the draft's patch equals the
 * patch that Save commits. It carries what each entry was when the edit began,
 * which the record checks as it lays the draft: a record that changed under
 * the edit ends the function's call `conflict`, as it would have refused the
 * Save.
 *
 * - A batch that changes nothing answers `unchanged`, and there is no draft.
 * - Over one entry's rows, where `Record.onApply` refuses before it writes —
 *   a batch drafted at a revision, an entry removed or changed since the edit
 *   began — it answers that refusal, and there is no draft. An entry that
 *   holds the batch's rows already answers `unchanged`.
 * - Over the record's own entries the record is not read: a draft is built
 *   from the batch alone.
 *
 * It commits nothing and waits on nothing.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @param handle - The record, bound with its patch mutation
 * @param options - {@link RecordApplyOptions} for the entries form, or
 *   {@link RecordApplyInsideOptions} for a collection inside one entry: the
 *   options `Record.onApply` takes
 * @returns An East function over the collection's batch, answering with
 *   {@link RecordToDraftResultType}
 * @throws {Error} When the record is not a Dict, the mutation is not bound as
 *   its patch door, or `get` / `set` do not fit the entry
 *
 * @example
 * ```ts
 * import { DictType, East, IntegerType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
 * import { Editing } from "@elaraai/east-ui";
 * import { Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const BinderyJobType = StructType({ task: StringType, qty: IntegerType });
 * const binderyJobs = e3.record("bindery_jobs", DictType(StringType, BinderyJobType), {
 *     initial: new Map(),
 *     mutations: (mutation) => ({
 *         patch: mutation.patch(),
 *     }),
 * });
 *
 * // Mirrors `recordToDraft` in test/bind/record/record-draft.examples.ts.
 * const recordToDraft = East.function([], StringType, ($) => {
 *     const board = $.let(Record.bind(binderyJobs));
 *     // The twin of `Record.onApply(board, { keyed: true })`: the same options, the same batch
 *     const toDraft = $.const(Record.toDraft(board, { keyed: true }));
 *     // What an editing surface hands its Save: each entry's change from what it was as the edit began
 *     const folded = $.const(some({ task: "Fold", qty: 200n }), OptionType(BinderyJobType));
 *     const refolded = $.const(some({ task: "Fold", qty: 250n }), OptionType(BinderyJobType));
 *     const absent = $.const(none, OptionType(BinderyJobType));
 *     const stitched = $.const(some({ task: "Stitch", qty: 250n }), OptionType(BinderyJobType));
 *     const pending = $.const({
 *         requestId: "", base: variant("revision", "a41c09d2"), label: "Fold and stitch 250",
 *         changes: [
 *             { id: "b1", patch: East.diff(folded, refolded), place: none },
 *             { id: "b2", patch: East.diff(absent, stitched), place: some(variant("keyOrder", null)) },
 *         ],
 *     }, Editing.Types.ChangeSet(BinderyJobType, StringType));
 *     return toDraft(pending).match({
 *         // The draft a bound function that lists the record takes with its call
 *         draft: (_$, draft) => East.str`a draft of ${draft.record}.${draft.mutation}`,
 *         unchanged: _$ => East.str`nothing to send`,
 *         rejected: (_$, issues) => East.str`refused: ${issues.map((_$, issue) => issue.message).stringJoin("; ")}`,
 *         conflict: (_$, issues) => East.str`changed since the edit began: ${issues.map((_$, issue) => issue.message).stringJoin("; ")}`,
 *     });
 * });
 * // a draft of bindery_jobs.patch
 * ```
 */
export function draftOfRecord<K extends EastType, V extends EastType>(
    handle: KeyedRecordHandle<K, V>,
    options?: RecordApplyOptions & { keyed?: false },
): RecordToDraftFunction<ReturnType<typeof Editing.Types.ChangeSet<V>>>;
/**
 * The entries form for a collection that hands keyed batches — the Plan.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @param handle - The record, bound with its patch mutation
 * @param options - `{ keyed: true }`, and the patch mutation's name when it has one
 * @returns An East function over `Editing.Types.ChangeSet(V, K)`
 */
export function draftOfRecord<K extends EastType, V extends EastType>(
    handle: KeyedRecordHandle<K, V>,
    options: RecordApplyOptions & { keyed: true },
): RecordToDraftFunction<ReturnType<typeof Editing.Types.ChangeSet<V, K>>>;
/**
 * The form over a collection inside one entry.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @typeParam C - The collection's row type: a row struct, or entries of groups and loose rows
 * @param handle - The record, bound with its patch mutation
 * @param options - The entry, how its rows are read and replaced, and their identity field
 * @returns An East function over `Editing.Types.ChangeSet(C)`
 */
export function draftOfRecord<K extends EastType, V extends EastType, C extends EastType>(
    handle: KeyedRecordHandle<K, V>,
    options: RecordApplyInsideOptions<K, V, C>,
): RecordToDraftFunction<ReturnType<typeof Editing.Types.ChangeSet<C>>>;
export function draftOfRecord(
    handle: KeyedRecordHandle<EastType, EastType>,
    options: RecordApplyOptions | RecordApplyInsideOptions<EastType, EastType, EastType> = {},
): ExprType<FunctionType> {
    const checked = checkWrite("toDraft", handle, options);
    const doors = handle as unknown as RecordDoors;
    return inWriteBlock(checked, handle, FunctionType([checked.batchType], RecordToDraftResultType),
        ($, parts) => draftOver(checked, parts, $.const(doors.draft[checked.mutation]!) as RecordDraftDoor)) as unknown as ExprType<FunctionType>;
}
