/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType, AsyncFunctionType, DictType, East, Expr, FunctionType, IntegerType, NullType, PatchType, SortedMap, StringType, StructType, VariantType,
    compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, isTypeEqual, variant,
    type BlockBuilder, type EastType, type ExprType,
} from "@elaraai/east";
import { Editing, Reactive, Stat, Button, UIComponentType } from "@elaraai/east-ui/internal";
import { FuncDraftType, Record, Data, deriveManifest, ui } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import { refusingPlatform } from "../../refusing-platform.js";
import * as ex from "./record.examples.js";

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

// `Record.onApply` (#988): the async onApply each collection takes, built from
// the handle alone. Its behaviour over a record runs in e3-ui-components'
// record-apply spec, against the runtime.
describeEast("Record.onApply", (test) => {
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

    test("over the record's own entries it takes a Sheet's batch, or with keyed a Plan's", _ => {
        const sheet = typeOf($ => {
            const record = $.let(Record.bind(ex.jobs));
            return Record.onApply(record);
        });
        assert.ok(isTypeEqual(sheet, AsyncFunctionType([Editing.Types.ChangeSet(ex.JobType)], Editing.Types.ApplyResult)));
        const plan = typeOf($ => {
            const record = $.let(Record.bind(ex.jobs));
            return Record.onApply(record, { keyed: true });
        });
        assert.ok(isTypeEqual(plan, AsyncFunctionType([Editing.Types.ChangeSet(ex.JobType, StringType)], Editing.Types.ApplyResult)));
    });

    test("over a collection inside one entry it takes that collection's batch", _ => {
        const inside = typeOf($ => {
            const record = $.let(Record.bind(pages));
            return Record.onApply(record, {
                entry: "home",
                get: East.function([Page], ArrayType(Cell), (_$, page) => page.cells),
                set: East.function([Page, ArrayType(Cell)], Page, (_$, page, cells) => ({ title: page.title, cells })),
                idField: "key",
            });
        });
        assert.ok(isTypeEqual(inside, AsyncFunctionType([Editing.Types.ChangeSet(Cell)], Editing.Types.ApplyResult)));
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
        assert.ok(isTypeEqual(inside, AsyncFunctionType([Editing.Types.ChangeSet(Entry)], Editing.Types.ApplyResult)));
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
