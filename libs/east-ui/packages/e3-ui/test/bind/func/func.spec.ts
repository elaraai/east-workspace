/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType, DictType, East, Expr, FloatType, FunctionType, IntegerType, NullType, OptionType, StringType, StructType, equalFor, isTypeEqual, variant,
    type BlockBuilder, type EastType,
} from "@elaraai/east";
import { Reactive, Stat, Button, UIComponentType } from "@elaraai/east-ui/internal";
import {
    Func, FuncBindDraftsHandleType, FuncBindHandleType, FuncBindingType, FuncDraftType, FuncDraftedType, FuncErrorType, Record, Data, deriveManifest, ui,
} from "@elaraai/e3-ui";
import e3, { type FunctionDef } from "@elaraai/e3";
import { refusingPlatform } from "../../refusing-platform.js";
import * as ex from "./func.examples.js";

// `Func.bind(def)` takes name and signature from the e3.function def, so the
// tests declare the package-side functions once and bind them everywhere.
const forecastDef = e3.function("forecast",
    East.function([IntegerType, FloatType], FloatType, (_$, _periods, growth) => growth));
const rebalanceDef = e3.function("rebalance",
    East.function([FloatType], FloatType, (_$, target) => target));
const describeDef = e3.function("describe",
    East.function([IntegerType], StringType, (_$, n) => East.print(n)));

// A function that lists `drafts` (#1620): a call may lay unsaved edits over
// each record it lists, and its handle's call takes them.
const boardDef = e3.record("func_spec_board", DictType(StringType, StructType({ press: StringType })), {
    initial: new Map(),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
const pressesDef = e3.record("func_spec_presses", DictType(StringType, StringType), {
    initial: new Map(),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
const jobsOnDef = e3.function("jobs_on", { inputs: [boardDef, pressesDef], drafts: [boardDef, pressesDef], args: [StringType], output: IntegerType },
    (_$, board, _presses, _press) => board.size());

describeEast("Func", (test) => {
    Assert.examples(test, {
        funcBindCall: ex.funcBindCall,
        funcBindInputs: ex.funcBindInputs,
        funcBindStatus: ex.funcBindStatus,
        funcBindCancel: ex.funcBindCancel,
        funcBindSharedChannel: ex.funcBindSharedChannel,
        funcBindDrafts: ex.funcBindDrafts,
        funcBindDrafted: ex.funcBindDrafted,
        funcBindDraftRefused: ex.funcBindDraftRefused,
    });

    test("Func.bind exposes a call closure inside Reactive.Root", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const forecast = $.let(Func.bind(forecastDef));
            const run = $.const(East.function([], NullType, $ => {
                $(forecast.call(12n, 1.05));
            }));
            return Button.Root("Run", { onClick: run });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Func.bind exposes read/status/error/pending/cancel closures", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const describe = $.let(Func.bind(describeDef));
            const _status = $.let(describe.status());
            const _pending = $.let(describe.pending());
            const _error = $.let(describe.error());
            const _value = $.let(describe.read());
            const _cancel = $.const(describe.cancel);
            return Stat.Root({ label: "Status", value: East.print(_status) });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("binding descriptor carries the def's name", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const forecast = $.let(Func.bind(forecastDef));
            $(Assert.equal(forecast.binding.name, "forecast"));
            return Stat.Root({ label: "Name", value: forecast.binding.name });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Func.bind infers the signature from the FunctionDef", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const forecast = $.let(Func.bind(forecastDef));
            const run = $.const(East.function([], NullType, $ => {
                // Positional args type-check against the def's argTypes.
                $(forecast.call(12n, 1.05));
            }));
            void run;
            // read() is Option<Float>, from the def's outputType.
            return Stat.Root({ label: "F", value: East.print(forecast.read()) });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });
}, { platformFns: TestImpl });

/** The call's type checks (#1620): never called — `tsc` checks what each line says. */
function callTypeChecks($: BlockBuilder<NullType>): void {
    const board = $.let(Record.bind(boardDef));
    const plain = $.let(Func.bind(forecastDef));
    const count = $.let(Func.bind(jobsOnDef));
    const moved = $.const(board.draft.patch(East.diff(board.read(), board.read())));
    // A function that lists no drafts keeps today's call: its arguments alone.
    $(plain.call(12n, 1.05));
    // @ts-expect-error — it takes no drafts
    plain.call(12n, 1.05, [moved]);
    // @ts-expect-error — and says nothing of records drafted
    plain.drafted();
    // One that lists drafts takes them last, an Array: one draft, several, or none, a call as saved.
    $(count.call("P1", [moved]));
    $(count.call("P1", [moved, board.draft.patch(East.diff(board.read(), board.read()))]));
    $(count.call("P1", []));
    $.const(count.drafted(), ArrayType(FuncDraftedType));
    // @ts-expect-error — the drafts are the call's last argument
    count.call("P1");
    // @ts-expect-error — and an Array of them
    count.call("P1", moved);
    // A definition held under a type that does not say whether it lists drafts is not bound.
    const unsaid: FunctionDef<[IntegerType, FloatType], FloatType> = forecastDef;
    // @ts-expect-error — the definition's type says which handle it is bound to
    Func.bind(unsaid);
}

// `Func.bind` of a function that lists `drafts` (#1620). What the function runtime does with a call's drafts runs in
// e3-ui-components' function specs, on e3.
describe("Func.bind of a function that lists drafts", () => {
    test("gives a handle whose call takes the drafts last, an Array, with drafted() beside read(); one that lists none keeps today's handle", () => {
        assert.equal(typeof callTypeChecks, "function");
        const drafted = Expr.type(Func.bind(jobsOnDef) as Expr) as EastType;
        assert.ok(drafted.type === "Struct");
        assert.ok(isTypeEqual(drafted, FuncBindDraftsHandleType([StringType], IntegerType)));
        assert.deepEqual(Object.keys(drafted.fields), ["call", "read", "drafted", "status", "error", "pending", "cancel", "binding"]);
        assert.ok(isTypeEqual(drafted.fields["call"]!, FunctionType([StringType, ArrayType(FuncDraftType)], NullType)), "the argument, then the drafts");
        assert.ok(isTypeEqual(drafted.fields["read"]!, FunctionType([], OptionType(IntegerType))));
        assert.ok(isTypeEqual(drafted.fields["drafted"]!, FunctionType([], ArrayType(FuncDraftedType))), "each drafted record and its commit");

        const plain = Expr.type(Func.bind(forecastDef) as Expr) as EastType;
        assert.ok(plain.type === "Struct");
        assert.ok(isTypeEqual(plain, FuncBindHandleType([IntegerType, FloatType], FloatType)));
        assert.deepEqual(Object.keys(plain.fields), ["call", "read", "status", "error", "pending", "cancel", "binding"]);
        assert.ok(isTypeEqual(plain.fields["call"]!, FunctionType([IntegerType, FloatType], NullType)), "the arguments alone");
    });

    test("binding.drafts names the records the function lists, in the order listed, and none for a function that lists none", () => {
        // Compiled against a platform whose every read, write and call refuses: a binding is read without one.
        const bindings = East.compile(East.function([], ArrayType(FuncBindingType), ($) => {
            const count = $.let(Func.bind(jobsOnDef));
            const plain = $.let(Func.bind(forecastDef));
            return [count.binding, plain.binding];
        }), refusingPlatform)();
        assert.ok(equalFor(ArrayType(FuncBindingType))(bindings, [
            { name: "jobs_on", drafts: ["func_spec_board", "func_spec_presses"] },
            { name: "forecast", drafts: [] },
        ]));
    });

    test("a drafted record is its name and the commit it stood at, and the error's kinds gain conflict: the record, the mutation and the refusal's words", () => {
        assert.ok(isTypeEqual(FuncDraftedType, StructType({ record: StringType, commit: StringType })));
        const kinds = FuncErrorType.fields.kind.cases;
        assert.deepEqual(Object.keys(kinds).sort(), ["conflict", "failed", "invalid", "timed_out", "too_large", "transport"]);
        assert.ok(isTypeEqual(kinds.conflict, StructType({ record: StringType, mutation: StringType, message: StringType })));
    });
});

describe("Func.bind of a function with inputs", () => {
    test("gives a handle whose call takes the arguments alone, never the inputs", () => {
        const handle = Expr.type(Func.bind(ex.quoteFn) as Expr) as EastType;
        assert.ok(handle.type === "Struct");
        const call = handle.fields["call"]!;
        assert.ok(call.type === "Function");
        assert.equal(call.inputs.length, 1, "the order alone");
        assert.ok(isTypeEqual(call.inputs[0]!, ArrayType(ex.OrderLineType)));
        const read = handle.fields["read"]!;
        assert.ok(read.type === "Function" && isTypeEqual(read.output, OptionType(ex.QuoteType)), "read() is the quote");
    });
});

describeEast("Func — manifest derivation", (test) => {
    test("deriveManifest collects bound function names", _ => {
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const forecast = $.let(Func.bind(forecastDef));
                return Stat.Root({ label: "F", value: East.print(forecast.read()) });
            })));
        const manifest = deriveManifest(fn);
        assert.deepEqual(manifest.functions, ["forecast"]);
        assert.deepEqual(manifest.paths, []);
    });

    test("deriveManifest dedupes repeated bindings of the same name", _ => {
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const a = $.let(Func.bind(forecastDef));
                const b = $.let(Func.bind(forecastDef));
                const c = $.let(Func.bind(rebalanceDef));
                void a; void b; void c;
                return Stat.Root({ label: "F", value: "x" });
            })));
        const manifest = deriveManifest(fn);
        assert.deepEqual([...manifest.functions].sort(), ["forecast", "rebalance"]);
    });

    test("deriveManifest collects a function that lists drafts by its name, the bind's first argument", _ => {
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const count = $.let(Func.bind(jobsOnDef));
                return Stat.Root({ label: "Jobs", value: East.print(count.read()) });
            })));
        assert.deepEqual(deriveManifest(fn).functions, ["jobs_on"]);
    });

    test("deriveManifest collects Data.bind paths and Func.bind names together", _ => {
        const x = e3.input("x", FloatType, variant("value", 0.0));
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const bound = $.let(Data.bind(x));
                const forecast = $.let(Func.bind(forecastDef));
                void forecast;
                return Stat.Root({ label: "X", value: East.print(bound.read()) });
            })));
        const manifest = deriveManifest(fn);
        assert.equal(manifest.paths.length, 1);
        assert.deepEqual(manifest.functions, ["forecast"]);
    });

    test("ui() records bound function names in the task manifest", _ => {
        const dashboard = ui("dashboard", [], East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const forecast = $.let(Func.bind(forecastDef));
                return Stat.Root({ label: "F", value: East.print(forecast.read()) });
            }))));
        assert.equal(dashboard.role.type, "ui");
        assert.deepEqual(dashboard.role.value!.functions, ["forecast"]);
    });
}, { platformFns: TestImpl });
