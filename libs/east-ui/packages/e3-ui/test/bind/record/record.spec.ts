/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType, AsyncFunctionType, DictType, East, Expr, FunctionType, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType, VariantType,
    compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, some, variant, walkIR,
    type BlockBuilder, type EastType, type ExprType, type IR, type ValueTypeOf,
} from "@elaraai/east";
import { Editing, Reactive, Stat, Button, UIComponentType } from "@elaraai/east-ui/internal";
import { FuncDraftType, Record, RecordOutcomeType, RecordSaveTypeFor, RecordToDraftResultType, Data, deriveManifest, ui } from "@elaraai/e3-ui";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import e3 from "@elaraai/e3";
import { refusingPlatform } from "../../refusing-platform.js";
import * as ex from "./record.examples.js";
import * as draftEx from "./record-draft.examples.js";

// `Record.bind(record, names?)` takes the state type from the record def
// and each mutation's name + arg types from its def, so the tests declare the
// package-side record + mutations once and bind them everywhere.
const counter = e3.record("counter", IntegerType, {
    initial: 0n,
    mutations: (mutation) => ({
        increment: mutation.reduce(East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))),
        reset: mutation.reduce(East.function([IntegerType], IntegerType, (_$, _state) => 0n)),
    }),
});

describeEast("Record", (test) => {
    Assert.examples(test, {
        recordBindMutate: ex.recordBindMutate,
        recordBindStatus: ex.recordBindStatus,
        recordBindHistory: ex.recordBindHistory,
        recordSheetApply: ex.recordSheetApply,
        recordBindDraft: ex.recordBindDraft,
    });

    test("Record.bind exposes read + a typed mutate closure inside Reactive.Root", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const r = $.let(Record.bind(counter, ["increment"]));
            const bump = $.const(East.function([], NullType, $ => {
                $(r.mutate.increment(1n));
            }));
            return Button.Root("Increment", { onClick: bump });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Record.bind exposes read/status/history + mutate.{pending,status,error,cancel}", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const r = $.let(Record.bind(counter));
            const _value = $.let(r.read());
            const _status = $.let(r.status());
            const _history = $.let(r.history());
            const _pending = $.let(r.mutate.pending());
            const _mstatus = $.let(r.mutate.status());
            const _error = $.let(r.mutate.error());
            const _cancel = $.const(r.mutate.cancel);
            return Stat.Root({ label: "Counter", value: East.print(_value) });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("binding descriptor carries the record name + mutation names", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const r = $.let(Record.bind(counter));
            $(Assert.equal(r.binding.name, "counter"));
            return Stat.Root({ label: "Name", value: r.binding.name });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });
}, { platformFns: TestImpl });

describe("Record.bind's mutations", () => {
    /** The mutations a handle exposes on `mutate`, by name, from its East type. */
    const mutated = (handle: unknown): string[] => Object.keys(((Expr.type(handle as Expr) as StructType).fields.mutate as StructType).fields)
        .filter((name) => !["pending", "status", "error", "cancel"].includes(name));

    hostTest("binds every mutation the record declares, those named, or none", () => {
        assert.deepEqual(mutated(Record.bind(counter)), ["increment", "reset"]);
        assert.deepEqual(mutated(Record.bind(counter, ["reset"])), ["reset"]);
        assert.deepEqual(mutated(Record.bind(counter, [])), []);
    });
});

/** `draft.<name>`'s type checks (#1620): never called — `tsc` checks what each line says. */
function draftTypeChecks($: BlockBuilder<NullType>): void {
    const tally = $.let(Record.bind(counter));
    const board = $.let(Record.bind(ex.jobs));
    // What fits: the arguments `mutate.<name>` takes, and one type whatever the record.
    const bumped: ExprType<FuncDraftType> = tally.draft.increment(1n);
    const cleared: ExprType<FuncDraftType> = tally.draft.reset();
    const moved: ExprType<FuncDraftType> = board.draft.patch(East.diff(board.read(), board.read()));
    $.const([bumped, cleared, moved], ArrayType(FuncDraftType));
    // @ts-expect-error — `increment` takes an Integer, as `mutate.increment` does
    tally.draft.increment("one");
    // @ts-expect-error — and one of them
    tally.draft.increment();
    // @ts-expect-error — `rename` is no mutation of the counter
    tally.draft.rename("tally");
    // @ts-expect-error — a handle bound with `reset` alone has no draft of `increment`
    $.let(Record.bind(counter, ["reset"])).draft.increment(1n);
}

// `draft.<name>` (#1620): a mutation's call as a draft — what `mutate.<name>` takes, not committed. What the record
// runtime does with one runs in e3-ui-components' record-runtime spec, on e3.
describe("Record.bind's drafts", () => {
    /** A handle's `mutate` and `draft` doors, by mutation, from its East type. */
    const doors = (handle: unknown) => {
        const fields = (Expr.type(handle as Expr) as StructType).fields;
        return { mutate: (fields.mutate as StructType).fields as { [name: string]: FunctionType }, draft: (fields.draft as StructType).fields as { [name: string]: EastType } };
    };

    hostTest("a draft of each mutation the handle binds, of the arguments `mutate.<name>` takes, each answering the one draft type", () => {
        assert.equal(typeof draftTypeChecks, "function");
        for (const handle of [Record.bind(counter), Record.bind(counter, ["reset"]), Record.bind(counter, []), Record.bind(ex.jobs)]) {
            const { mutate, draft } = doors(handle);
            assert.deepEqual(Object.keys(draft), Object.keys(mutate).filter((name) => !["pending", "status", "error", "cancel"].includes(name)));
            for (const [name, door] of Object.entries(draft)) {
                assert.ok(isTypeEqual(door, FunctionType(mutate[name]!.inputs, FuncDraftType)), `draft.${name} takes what mutate.${name} takes`);
            }
        }
    });

    hostTest("a draft names its record and its mutation and holds each argument as a commit sends it; drafts of two records are one list, and nothing of either record is read or written", () => {
        const Jobs = ex.jobs.type;
        const cut = new SortedMap([["a", { task: "Cut", qty: 2n }]], compareFor(StringType));
        // Compiled against a platform whose every read, write and call refuses: making a draft reaches none of them.
        const drafts = East.compile(East.function([], ArrayType(FuncDraftType), ($) => {
            const tally = $.let(Record.bind(counter));
            const board = $.let(Record.bind(ex.jobs));
            const before = $.const(new Map(), Jobs);
            const after = $.const(cut, Jobs);
            return [tally.draft.increment(3n), tally.draft.reset(), board.draft.patch(East.diff(before, after))];
        }), refusingPlatform)();
        const [bumped, cleared, added] = drafts;
        assert.ok(equalFor(FuncDraftType)(bumped!, { record: "counter", mutation: "increment", args: [encodeBeast2For(IntegerType)(3n)] }));
        assert.ok(equalFor(FuncDraftType)(cleared!, { record: "counter", mutation: "reset", args: [] }), "a mutation of no arguments holds none");
        assert.deepEqual([added!.record, added!.mutation, added!.args.length], ["jobs", "patch", 1]);
        assert.ok(equalFor(PatchType(Jobs))(decodeBeast2For(PatchType(Jobs))(added!.args[0]!), diffFor(Jobs)(new Map(), cut)), "the patch, at the patch door's type");
    });
});

describeEast("Record — bind validation", (_test) => {
    _test("refuses a mutation the record does not declare, naming those it does", _ => {
        // @ts-expect-error 'wrong' is not one of the counter's mutations
        assert.throws(() => Record.bind(counter, ["wrong"]), /^Error: Record\.bind: record 'counter' declares no mutation 'wrong' — it declares 'increment', 'reset'$/);
    });
}, { platformFns: TestImpl });

// A page whose cells a layout edits inside its one entry: what `Record.onApply` and `Record.toDraft` take in their
// form over a collection inside one entry.
const Cell = StructType({ key: StringType, span: IntegerType });
const Page = StructType({ title: StringType, cells: ArrayType(Cell) });
const pages = e3.record("pages", DictType(StringType, Page), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The type of what `build` returns, from inside a bound handle's block. */
function typeOf(build: ($: BlockBuilder<NullType>) => Expr): EastType {
    let type: EastType | undefined;
    East.function([], NullType, $ => { type = Expr.type(build($)) as EastType; });
    return type!;
}

/** A Save with its draft form over a batch, as its two fields: the Save, and the same batch as a draft. */
function isSaveOver(type: EastType, batch: EastType): boolean {
    return isTypeEqual(type, RecordSaveTypeFor(batch))
        && isTypeEqual(type, StructType({
            apply: AsyncFunctionType([batch], Editing.Types.ApplyResult),
            toDraft: FunctionType([batch], RecordToDraftResultType),
        }));
}

/**
 * The jobs' record as a handle typed by hand: its read, its history and its commit door, and no draft door — what a
 * function that takes a record's handle as a parameter may declare, as the Studio's pages do.
 */
const JobsCommitHandle = StructType({
    read: FunctionType([], ex.jobs.type),
    history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
    commit: StructType({ patch: AsyncFunctionType([StringType, PatchType(ex.jobs.type)], RecordOutcomeType) }),
});

/** The type of what `build` returns over a handle of `handleType`, a function's parameter. */
function typeOver<H extends EastType>(handleType: H, build: (handle: ExprType<H>) => unknown): EastType {
    let type: EastType | undefined;
    East.function([handleType], NullType, (_$, handle) => { type = Expr.type(build(handle as ExprType<H>) as Expr) as EastType; });
    return type!;
}

/** Each function a program makes as a value: one called where it is made is never a value, so never written. */
function functionValues(ir: IR): Extract<IR, { type: "Function" | "AsyncFunction" }>[] {
    const found: Extract<IR, { type: "Function" | "AsyncFunction" }>[] = [];
    walkIR(ir, (node, { parent }) => {
        if (node.type !== "Function" && node.type !== "AsyncFunction") return;
        if (parent !== null && (parent.type === "Call" || parent.type === "CallAsync") && Object.is(parent.value.function, node)) return;
        found.push(node);
    });
    return found;
}

/** How many times a program writes out a String literal. */
function literals(ir: IR, text: string): number {
    let count = 0;
    walkIR(ir, (node) => {
        if (node.type === "Value" && node.value.value.type === "String" && node.value.value.value === text) count++;
    });
    return count;
}

// `Record.onApply` (#988): the Save each collection takes, built from the handle alone, and with it the draft form of
// that Save (#1620). Its behaviour over a record runs in e3-ui-components' record-apply spec, against the runtime.
describeEast("Record.onApply", (test) => {
    test("over the record's own entries it answers the Save with its draft form over a Sheet's batch, or with keyed a Plan's", _ => {
        const sheet = typeOf($ => {
            const record = $.let(Record.bind(ex.jobs));
            return Record.onApply(record);
        });
        assert.ok(isSaveOver(sheet, Editing.Types.ChangeSet(ex.JobType)));
        const plan = typeOf($ => {
            const record = $.let(Record.bind(ex.jobs));
            return Record.onApply(record, { keyed: true });
        });
        assert.ok(isSaveOver(plan, Editing.Types.ChangeSet(ex.JobType, StringType)));
    });

    test("over a collection inside one entry the Save and its draft form take that collection's batch", _ => {
        const inside = typeOf($ => {
            const record = $.let(Record.bind(pages));
            return Record.onApply(record, {
                entry: "home",
                get: East.function([Page], ArrayType(Cell), (_$, page) => page.cells),
                set: East.function([Page, ArrayType(Cell)], Page, (_$, page, cells) => ({ title: page.title, cells })),
                idField: "key",
            });
        });
        assert.ok(isSaveOver(inside, Editing.Types.ChangeSet(Cell)));
    });

    test("a copy bound in a block is the Save with its draft form still: its type holds both", _ => {
        const copy = typeOf($ => {
            const record = $.let(Record.bind(ex.jobs));
            return $.const(Record.onApply(record, { keyed: true }));
        });
        assert.ok(isSaveOver(copy, Editing.Types.ChangeSet(ex.JobType, StringType)));
    });

    test("over a handle that makes no drafts, typed by hand with its read, its history and its commit, it answers the Save alone; one that holds drafts and none of the patch mutation is refused", _ => {
        const alone = typeOver(JobsCommitHandle, (handle) => Record.onApply(handle, { keyed: true }));
        assert.ok(isTypeEqual(alone, AsyncFunctionType([Editing.Types.ChangeSet(ex.JobType, StringType)], Editing.Types.ApplyResult)));
        const Drafting = StructType({ ...JobsCommitHandle.fields, draft: StructType({}) });
        assert.throws(() => typeOver(Drafting, (handle) => Record.onApply(handle as never, { keyed: true })),
            /Record\.onApply: "patch" is not bound as this record's patch door/);
    });

    test("the Save and its draft form call one plan of the write, written out once, and hold what they call: no function the program makes holds the handle", _ => {
        const refusal = "Rows inside a record entry are checked against the rows the edit began from — a snapshot, never a revision";
        const options = {
            entry: "home",
            get: East.function([Page], ArrayType(Cell), (_$: unknown, page: ExprType<typeof Page>) => page.cells),
            set: East.function([Page, ArrayType(Cell)], Page, (_$: unknown, page: ExprType<typeof Page>, cells: ExprType<ArrayType<typeof Cell>>) => ({ title: page.title, cells })),
            idField: "key",
        };
        let handleType: EastType | undefined;
        const program = East.function([], NullType, ($) => {
            const record = $.let(Record.bind(pages));
            handleType = Expr.type(record as unknown as Expr) as EastType;
            $.const(Record.onApply(record, options));
        }).toIR().ir;
        assert.equal(literals(program, refusal), 1, "the plan's refusal is written once, for the Save and its draft form");
        const made = functionValues(program);
        assert.ok(made.length >= 3, "the plan, the Save and its draft form");
        const holding = made.flatMap((fn) => fn.value.captures.filter((capture) => isTypeEqual(fromEastTypeValue(capture.value.type), handleType!)));
        assert.deepEqual(holding.map((capture) => capture.value.name), []);
        // The Save alone and the draft form alone hold no handle either.
        const alone = East.function([], NullType, ($) => {
            const record = $.let(Record.bind(pages));
            $.const(Record.toDraft(record, options));
        }).toIR().ir;
        assert.equal(literals(alone, refusal), 1);
        assert.deepEqual(functionValues(alone).flatMap((fn) => fn.value.captures.filter((capture) => isTypeEqual(fromEastTypeValue(capture.value.type), handleType!))), []);
    });

    test("refuses a record that is not keyed, a handle bound without the patch door, and a get that does not fit", _ => {
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(counter, ["increment"]));
            return Record.onApply(record as never);
        }), /the record must be a Dict — this one holds \.Integer/);
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(ex.jobs, []));
            return Record.onApply(record);
        }), /"patch" is not bound as this record's patch door/);
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(ex.jobs));
            return Record.onApply(record, { mutation: "save" });
        }), /"save" is not bound as this record's patch door — bind the record with save: mutation.patch\(\) among the mutations it declares/);
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(pages));
            return Record.onApply(record, {
                entry: "home",
                get: East.function([Page], StringType, (_$, page) => page.title) as never,
                set: East.function([Page, ArrayType(Cell)], Page, (_$, page, cells) => ({ title: page.title, cells })),
                idField: "key",
            });
        }), /`get` must be an East function from the record's entry to an Array of rows — row structs, or entries of groups and loose rows/);
    });

    test("inside one entry the rows may be entries of groups and loose rows — a Sheet's — each arm carrying the id", _ => {
        const Line = StructType({ id: StringType, task: StringType });
        const Group = StructType({ id: StringType, name: StringType, lines: ArrayType(Line) });
        const Entry = Editing.Types.Entry(Group, "lines");
        const Plan = StructType({ entries: ArrayType(Entry) });
        const plans = e3.record("loose_plans", DictType(StringType, Plan), {
            initial: new Map(),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
        });
        const inside = typeOf($ => {
            const record = $.let(Record.bind(plans));
            return Record.onApply(record, {
                entry: "week",
                get: East.function([Plan], ArrayType(Entry), (_$, plan) => plan.entries),
                set: East.function([Plan, ArrayType(Entry)], Plan, (_$, _plan, entries) => ({ entries })),
                idField: "id",
            });
        });
        assert.ok(isSaveOver(inside, Editing.Types.ChangeSet(Entry)));
        // An arm that is not a struct is no row; an arm without the id names no entry.
        const Odd = VariantType({ group: Group, note: StringType });
        const Oddly = StructType({ entries: ArrayType(Odd) });
        const odd = e3.record("odd_plans", DictType(StringType, Oddly), {
            initial: new Map(),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
        });
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(odd));
            return Record.onApply(record, {
                entry: "week",
                get: East.function([Oddly], ArrayType(Odd), (_$, plan) => plan.entries),
                set: East.function([Oddly, ArrayType(Odd)], Oddly, (_$, _plan, entries) => ({ entries })),
                idField: "id",
            });
        }), /an Array of rows — row structs, or entries of groups and loose rows/);
        const Unnamed = VariantType({ group: Group, row: StructType({ task: StringType }) });
        const Unnamedly = StructType({ entries: ArrayType(Unnamed) });
        const unnamed = e3.record("unnamed_plans", DictType(StringType, Unnamedly), {
            initial: new Map(),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
        });
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(unnamed));
            return Record.onApply(record, {
                entry: "week",
                get: East.function([Unnamedly], ArrayType(Unnamed), (_$, plan) => plan.entries),
                set: East.function([Unnamedly, ArrayType(Unnamed)], Unnamedly, (_$, _plan, entries) => ({ entries })),
                idField: "id",
            });
        }), /"id" must be a String field on every entry/);
    });

    test("the Sheet over a record binds the record and pages it — no new platform bind", _ => {
        const manifest = deriveManifest(ex.recordSheetApply.fn as never);
        assert.deepEqual(manifest.records, ["jobs"]);
    });
}, { platformFns: TestImpl });

// The examples of `Record.toDraft` and of the draft form a Save carries run against the platform whose every read,
// write and call refuses: over a record's own entries a draft is built from the batch alone.
describeEast("Record.toDraft — its example, and the draft form a Save carries", (test) => {
    Assert.examples(test, {
        recordToDraft: draftEx.recordToDraft,
        recordSaveDraft: draftEx.recordSaveDraft,
    });
}, { platformFns: [...TestImpl, ...refusingPlatform] });

// `Record.toDraft` (#1620): `Record.onApply`'s twin — the same options, the same batch, and the patch that Save
// commits answered as a draft. Over the record's own entries it reads nothing of the record, so it runs here; over one
// entry's rows it reads the record, and that — with the patch it shares with the Save, compared to the one e3 is sent —
// runs in e3-ui-components' record-apply spec, on e3.
describe("Record.toDraft", () => {
    const Jobs = ex.jobs.type;
    const KeyedBatch = Editing.Types.ChangeSet(ex.JobType, StringType);
    type Job = ValueTypeOf<typeof ex.JobType>;
    const jobKeys = compareFor(StringType);
    const change = diffFor(OptionType(ex.JobType));
    const CUT: Job = { task: "Cut", qty: 2n };
    const CUT_MORE: Job = { task: "Cut", qty: 3n };
    const GLUE: Job = { task: "Glue", qty: 1n };
    const SPRAY: Job = { task: "Spray", qty: 4n };
    /** The cut taken from 2 to 3, the glue job removed and a spray job added, drafted at a revision. */
    const EDIT: ValueTypeOf<typeof KeyedBatch> = {
        requestId: "", base: variant("revision", "r0"), label: "",
        changes: [
            { id: "a", patch: change(some(CUT), some(CUT_MORE)), place: none },
            { id: "b", patch: change(some(GLUE), none), place: none },
            { id: "c", patch: change(none, some(SPRAY)), place: some(variant("keyOrder", null)) },
        ],
    };
    const sameAnswer = equalFor(RecordToDraftResultType);

    hostTest("in each of Record.onApply's forms it takes the batch that Save takes and answers at once: the draft, no change, or the Save's refusal", () => {
        const sheet = typeOf($ => {
            const record = $.let(Record.bind(ex.jobs));
            return Record.toDraft(record);
        });
        assert.ok(isTypeEqual(sheet, FunctionType([Editing.Types.ChangeSet(ex.JobType)], RecordToDraftResultType)));
        const plan = typeOf($ => {
            const record = $.let(Record.bind(ex.jobs));
            return Record.toDraft(record, { keyed: true });
        });
        assert.ok(isTypeEqual(plan, FunctionType([KeyedBatch], RecordToDraftResultType)));
        const inside = typeOf($ => {
            const record = $.let(Record.bind(pages));
            return Record.toDraft(record, {
                entry: "home",
                get: East.function([Page], ArrayType(Cell), (_$, page) => page.cells),
                set: East.function([Page, ArrayType(Cell)], Page, (_$, page, cells) => ({ title: page.title, cells })),
                idField: "key",
            });
        });
        assert.ok(isTypeEqual(inside, FunctionType([Editing.Types.ChangeSet(Cell)], RecordToDraftResultType)));
        // The draft is e3's, one type for every record; a refusal is a Save's.
        assert.deepEqual(Object.keys(RecordToDraftResultType.cases).sort(), ["conflict", "draft", "rejected", "unchanged"]);
        assert.ok(isTypeEqual(RecordToDraftResultType.cases.draft, FuncDraftType));
        assert.ok(isTypeEqual(RecordToDraftResultType.cases.conflict, Editing.Types.ApplyResult.cases.conflict));
        assert.ok(isTypeEqual(RecordToDraftResultType.cases.rejected, Editing.Types.ApplyResult.cases.rejected));
    });

    hostTest("refuses what Record.onApply refuses where it is built, in its own name: a record that is not keyed, a handle bound without the patch door, and a get that does not fit", () => {
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(counter, ["increment"]));
            return Record.toDraft(record as never);
        }), /Record\.toDraft: an Apply writes a record's entries by key, so the record must be a Dict — this one holds \.Integer/);
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(ex.jobs, []));
            return Record.toDraft(record);
        }), /Record\.toDraft: "patch" is not bound as this record's patch door/);
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(ex.jobs));
            return Record.toDraft(record, { mutation: "save" });
        }), /Record\.toDraft: "save" is not bound as this record's patch door — bind the record with save: mutation.patch\(\) among the mutations it declares/);
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(pages));
            return Record.toDraft(record, {
                entry: "home",
                get: East.function([Page], StringType, (_$, page) => page.title) as never,
                set: East.function([Page, ArrayType(Cell)], Page, (_$, page, cells) => ({ title: page.title, cells })),
                idField: "key",
            });
        }), /Record\.toDraft: `get` must be an East function from the record's entry to an Array of rows — row structs, or entries of groups and loose rows/);
    });

    hostTest("over the record's own entries the draft is the batch's patch — each change its entry's insert, update or delete, carrying what the entry was — built from the batch alone, nothing of the record read or written; a batch of no change is no draft", () => {
        // Compiled against a platform whose every read, write and call refuses: the draft reaches none of them.
        const toDraft = East.compile(East.function([KeyedBatch], RecordToDraftResultType, ($, batch) => {
            const board = $.let(Record.bind(ex.jobs));
            const draft = $.const(Record.toDraft(board, { keyed: true }));
            return draft(batch);
        }), refusingPlatform);
        const answer = toDraft(EDIT);
        if (answer.type !== "draft") assert.fail(`expected a draft, got ${answer.type}`);
        assert.deepEqual([answer.value.record, answer.value.mutation, answer.value.args.length], ["jobs", "patch", 1]);
        // The patch the jobs' own diff is, before the edit to after it: what the record checks as it lays the draft.
        const before = new SortedMap([["a", CUT], ["b", GLUE]], jobKeys);
        const after = new SortedMap([["a", CUT_MORE], ["c", SPRAY]], jobKeys);
        assert.ok(equalFor(PatchType(Jobs))(decodeBeast2For(PatchType(Jobs))(answer.value.args[0]!), diffFor(Jobs)(before, after)), "the patch, at the patch door's type");
        assert.ok(sameAnswer(toDraft({ ...EDIT, changes: [] }), variant("unchanged", null)));
        // An entry whose patch changes nothing of it is no change either.
        assert.ok(sameAnswer(toDraft({ ...EDIT, changes: [{ id: "a", patch: change(some(CUT), some(CUT)), place: none }] }), variant("unchanged", null)));
    });

    hostTest("the draft form the Save carries answers what Record.toDraft answers of the same batch, through a copy bound in a block too, and reaches nothing of the record", () => {
        // Compiled against a platform whose every read, write and call refuses: neither reaches any of them.
        const direct = East.compile(East.function([KeyedBatch], RecordToDraftResultType, ($, batch) => {
            const board = $.let(Record.bind(ex.jobs));
            const draft = $.const(Record.toDraft(board, { keyed: true }));
            return draft(batch);
        }), refusingPlatform);
        const carried = East.compile(East.function([KeyedBatch], RecordToDraftResultType, ($, batch) => {
            const board = $.let(Record.bind(ex.jobs));
            // The Save as a builder's author may hold it: a copy, bound in a block.
            const save = $.const(Record.onApply(board, { keyed: true }));
            return save.toDraft(batch);
        }), refusingPlatform);
        assert.ok(sameAnswer(carried(EDIT), direct(EDIT)));
        assert.equal(carried(EDIT).type, "draft");
        assert.ok(sameAnswer(carried({ ...EDIT, changes: [] }), variant("unchanged", null)));
    });
});

describeEast("Record — manifest derivation", (test) => {
    test("deriveManifest collects the bound record name and its dataset path", _ => {
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const r = $.let(Record.bind(counter, ["increment"]));
                return Stat.Root({ label: "C", value: East.print(r.read()) });
            })));
        const manifest = deriveManifest(fn);
        assert.deepEqual(manifest.records, ["counter"]);
        // The record path is recorded too, so its value is preloaded + polled.
        assert.equal(manifest.paths.length, 1);
        assert.deepEqual(manifest.paths[0]!.map(s => s.value), ["records", "counter"]);
    });

    test("deriveManifest dedupes repeated record binds and collects Data + Record together", _ => {
        const x = e3.input("x", IntegerType, variant("value", 0n));
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const a = $.let(Record.bind(counter, ["increment"]));
                const b = $.let(Record.bind(counter, ["reset"]));
                const d = $.let(Data.bind(x));
                void a; void b;
                return Stat.Root({ label: "X", value: East.print(d.read()) });
            })));
        const manifest = deriveManifest(fn);
        assert.deepEqual(manifest.records, ["counter"]);
        // The input path (.inputs.x) + the deduped record path (.records.counter).
        assert.equal(manifest.paths.length, 2);
    });

    test("ui() records bound record names in the task manifest", _ => {
        const dashboard = ui("dashboard", [], East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const r = $.let(Record.bind(counter, ["increment"]));
                return Stat.Root({ label: "C", value: East.print(r.read()) });
            }))));
        assert.equal(dashboard.role.type, "ui");
        assert.deepEqual(dashboard.role.value!.records, ["counter"]);
    });
}, { platformFns: TestImpl });
