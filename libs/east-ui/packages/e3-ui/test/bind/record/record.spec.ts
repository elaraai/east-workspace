/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType, AsyncFunctionType, DictType, East, Expr, IntegerType, NullType, StringType, StructType, isTypeEqual, variant,
    type BlockBuilder, type EastType,
} from "@elaraai/east";
import { Editing, Reactive, Stat, Button, UIComponentType } from "@elaraai/east-ui/internal";
import { Record, Data, deriveManifest, ui } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import * as ex from "./record.examples.js";

// `Record.bind(record, [mutations])` takes the state type from the record def
// and each mutation's name + arg types from its def, so the tests declare the
// package-side record + mutations once and bind them everywhere.
const counter = e3.record("counter", IntegerType, 0n);
const increment = e3.mutation.reduce("increment", counter,
    East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by)));
const reset = e3.mutation.reduce("reset", counter,
    East.function([IntegerType], IntegerType, (_$, _state) => 0n));

describeEast("Record", (test) => {
    Assert.examples(test, {
        recordBindMutate: ex.recordBindMutate,
        recordBindStatus: ex.recordBindStatus,
        recordBindHistory: ex.recordBindHistory,
        recordSheetApply: ex.recordSheetApply,
    });

    test("Record.bind exposes read + a typed mutate closure inside Reactive.Root", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const r = $.let(Record.bind(counter, [increment]));
            const bump = $.const(East.function([], NullType, $ => {
                $(r.mutate.increment(1n));
            }));
            return Button.Root("Increment", { onClick: bump });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Record.bind exposes read/status/history + mutate.{pending,status,error,cancel}", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const r = $.let(Record.bind(counter, [increment, reset]));
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
            const r = $.let(Record.bind(counter, [increment, reset]));
            $(Assert.equal(r.binding.name, "counter"));
            return Stat.Root({ label: "Name", value: r.binding.name });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });
}, { platformFns: TestImpl });

describeEast("Record — bind validation", (_test) => {
    _test("rejects a mutation that writes a different record", _ => {
        const other = e3.record("other", IntegerType, 0n);
        const wrong = e3.mutation.reduce("wrong", other,
            East.function([IntegerType], IntegerType, (_$, s) => s));
        assert.throws(() => Record.bind(counter, [wrong]), /writes record "other"/);
    });
}, { platformFns: TestImpl });

// `Record.onApply` (#988): the async onApply each collection takes, built from
// the handle alone. Its behaviour over a record runs in e3-ui-components'
// record-apply spec, against the runtime.
describeEast("Record.onApply", (test) => {
    const Cell = StructType({ key: StringType, span: IntegerType });
    const Page = StructType({ title: StringType, cells: ArrayType(Cell) });
    const pages = e3.record("pages", DictType(StringType, Page), new Map());
    const pagesPatch = e3.mutation.patch(pages);

    /** The type of what `build` returns, from inside a bound handle's block. */
    function typeOf(build: ($: BlockBuilder<NullType>) => Expr): EastType {
        let type: EastType | undefined;
        East.function([], NullType, $ => { type = Expr.type(build($)) as EastType; });
        return type!;
    }

    test("over the record's own entries it takes a Sheet's batch, or with keyed a Plan's", _ => {
        const sheet = typeOf($ => {
            const record = $.let(Record.bind(ex.jobs, [ex.jobsPatch]));
            return Record.onApply(record);
        });
        assert.ok(isTypeEqual(sheet, AsyncFunctionType([Editing.Types.ChangeSet(ex.JobType)], Editing.Types.ApplyResult)));
        const plan = typeOf($ => {
            const record = $.let(Record.bind(ex.jobs, [ex.jobsPatch]));
            return Record.onApply(record, { keyed: true });
        });
        assert.ok(isTypeEqual(plan, AsyncFunctionType([Editing.Types.ChangeSet(ex.JobType, StringType)], Editing.Types.ApplyResult)));
    });

    test("over a collection inside one entry it takes that collection's batch", _ => {
        const inside = typeOf($ => {
            const record = $.let(Record.bind(pages, [pagesPatch]));
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
            const record = $.let(Record.bind(counter, [increment]));
            return Record.onApply(record as never);
        }), /the record must be a Dict — this one holds \.Integer/);
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(ex.jobs, []));
            return Record.onApply(record);
        }), /"patch" is not bound as this record's patch door/);
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(ex.jobs, [ex.jobsPatch]));
            return Record.onApply(record, { mutation: "save" });
        }), /"save" is not bound as this record's patch door — bind the record with e3.mutation.patch\(record, "save"\)/);
        assert.throws(() => typeOf($ => {
            const record = $.let(Record.bind(pages, [pagesPatch]));
            return Record.onApply(record, {
                entry: "home",
                get: East.function([Page], StringType, (_$, page) => page.title) as never,
                set: East.function([Page, ArrayType(Cell)], Page, (_$, page, cells) => ({ title: page.title, cells })),
                idField: "key",
            });
        }), /`get` must be an East function from the record's entry to an Array of row structs/);
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
                const r = $.let(Record.bind(counter, [increment]));
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
                const a = $.let(Record.bind(counter, [increment]));
                const b = $.let(Record.bind(counter, [reset]));
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
                const r = $.let(Record.bind(counter, [increment]));
                return Stat.Root({ label: "C", value: East.print(r.read()) });
            }))));
        assert.equal(dashboard.role.type, "ui");
        assert.deepEqual(dashboard.role.value!.records, ["counter"]);
    });
}, { platformFns: TestImpl });
